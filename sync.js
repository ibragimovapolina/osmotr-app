// ================= Движок синхронизации v3 =================
//
// Отправка осмотра: фото через POST → сам осмотр через POST.
// Никаких «застрял навсегда»: вместо лимита попыток — backoff по времени.
// Ошибки НЕ удаляют осмотр, он остаётся в очереди до успеха.

const SYNC_INTERVAL_MS = 30 * 1000;

// Задержки между попытками для одного осмотра (в миллисекундах):
// после 1-й ошибки — 10 сек, после 2-й — 30 сек, потом 1 мин, 5 мин, 15 мин, 1 час.
const RETRY_DELAYS = [10 * 1000, 30 * 1000, 60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000, 60 * 60 * 1000];

let _syncRunning = false;
let _syncTimer = null;

// ================= ПУБЛИЧНЫЙ API =================

async function syncNow() {
  if (_syncRunning) return { skipped: true, reason: 'already-running' };
  if (!navigator.onLine) return { skipped: true, reason: 'offline' };
  _syncRunning = true;

  const result = { sent: 0, failed: 0, photos: 0, skipped: 0, errors: [] };
  try {
    const pending = await window.db.getPendingVisits();
    pending.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));

    for (const visit of pending) {
      if (!navigator.onLine) break;

      // Проверяем — не пора ли пробовать снова
      if (!shouldRetryNow(visit)) {
        result.skipped++;
        continue;
      }

      try {
        const r = await syncVisit(visit);
        result.sent++;
        result.photos += r.photosUploaded;
      } catch (err) {
        result.failed++;
        result.errors.push({ clientId: visit.clientId, error: err.message });
        const attempts = (visit.attempts || 0) + 1;
        await window.db.updateVisit(visit.clientId, {
          status: 'error',
          lastError: err.message,
          attempts: attempts,
          lastAttemptAt: new Date().toISOString()
        });
      }
    }
  } finally {
    _syncRunning = false;
    notifyUI();
  }
  return result;
}

function shouldRetryNow(visit) {
  if (!visit.lastAttemptAt) return true;
  const delay = RETRY_DELAYS[Math.min((visit.attempts || 0) - 1, RETRY_DELAYS.length - 1)];
  if (delay === undefined) return true;
  const since = Date.now() - new Date(visit.lastAttemptAt).getTime();
  return since >= delay;
}

async function resetAllAttempts() {
  const all = await window.db.getAllVisits();
  for (const v of all) {
    if (v.status !== 'synced') {
      await window.db.updateVisit(v.clientId, {
        attempts: 0,
        lastAttemptAt: null,
        status: 'pending',
        lastError: ''
      });
    }
  }
  notifyUI();
  return true;
}

function startAutoSync() {
  stopAutoSync();
  window.addEventListener('online', onOnline);
  _syncTimer = setInterval(() => {
    if (navigator.onLine) syncNow().catch(() => {});
  }, SYNC_INTERVAL_MS);
  setTimeout(() => syncNow().catch(() => {}), 3000);
}

function stopAutoSync() {
  if (_syncTimer) { clearInterval(_syncTimer); _syncTimer = null; }
  window.removeEventListener('online', onOnline);
}

function onOnline() {
  console.log('[sync] Сеть появилась, отправляем очередь');
  setTimeout(() => syncNow().catch(() => {}), 500);
}

function notifyUI() {
  if (typeof window.onQueueChanged === 'function') {
    try { window.onQueueChanged(); } catch (e) {}
  }
}

// ================= ОТПРАВКА ОДНОГО ОСМОТРА =================

async function syncVisit(visit) {
  console.log('[sync] Начинаем осмотр', visit.clientId, 'кв.', visit.payload && visit.payload.kvNumber);
  await window.db.updateVisit(visit.clientId, { status: 'syncing' });

  let photosUploaded = 0;

  // 1. Загружаем все фото (по одному POST)
  const photos = await window.db.getPhotosForVisit(visit.clientId);
  const photoMap = {};

  for (const photo of photos) {
    if (!navigator.onLine) throw new Error('Офлайн, синхронизация прервана');

    if (photo.status === 'uploaded' && photo.remote) {
      pushPhotoToMap(photoMap, photo.stateKey, photo.remote);
      continue;
    }

    try {
      const remote = await uploadPhotoPost(photo.blob, photo.fileName, photo.kvNumber);
      await window.db.updatePhoto(photo.photoId, {
        status: 'uploaded',
        remote: remote,
        uploadedAt: new Date().toISOString()
      });
      pushPhotoToMap(photoMap, photo.stateKey, remote);
      photosUploaded++;
      console.log('[sync] Фото загружено:', photo.fileName, '→', remote.fileId);
    } catch (err) {
      await window.db.updatePhoto(photo.photoId, {
        status: 'error',
        lastError: err.message,
        attempts: (photo.attempts || 0) + 1
      });
      throw new Error('Ошибка загрузки фото: ' + err.message);
    }
  }

  // 2. Собираем payload с URL фото
  const payload = buildPayloadWithPhotos(visit.payload, photoMap);
  payload.clientId = visit.clientId;

  // 3. Отправляем сам осмотр ЧЕРЕЗ POST
  const res = await postApi('submitVisit', payload);
  const data = (res && res.data) ? res.data : res;

  await window.db.updateVisit(visit.clientId, {
    status: 'synced',
    syncedAt: new Date().toISOString(),
    serverRow: (data && data.row) || null
  });

  // 4. Удаляем отправленные фото
  for (const p of photos) {
    await window.db.deletePhoto(p.photoId);
  }

  console.log('[sync] ✅ Осмотр отправлен:', visit.clientId, 'строка', (data && data.row));
  return { photosUploaded: photosUploaded };
}

function pushPhotoToMap(map, stateKey, remote) {
  if (!map[stateKey]) map[stateKey] = [];
  map[stateKey].push(remote);
}

function buildPayloadWithPhotos(originalPayload, photoMap) {
  const results = JSON.parse(JSON.stringify(originalPayload.results || {}));

  Object.keys(photoMap).forEach(stateKey => {
    if (stateKey === '__extra__') return;
    const rs = results[stateKey] || { selected: [], custom: '', noIssues: false, photos: [] };
    const existing = (rs.photos || []).filter(p => p && p.url);
    const fresh = photoMap[stateKey].map(r => ({
      fileId: r.fileId,
      url: r.url,
      name: r.name
    }));
    rs.photos = existing.concat(fresh);
    results[stateKey] = rs;
  });

  const extraPhotos = (originalPayload.extraPhotos || []).filter(p => p && p.url)
    .concat((photoMap['__extra__'] || []).map(r => ({
      fileId: r.fileId,
      url: r.url,
      name: r.name
    })));

  return Object.assign({}, originalPayload, {
    results: results,
    extraPhotos: extraPhotos
  });
}

// ================= POST-ЗАПРОСЫ =================

async function postApi(action, payload) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: action, payload: payload })
  });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  const text = await response.text();
  return parseResponse(text);
}

async function uploadPhotoPost(blob, fileName, kvNumber) {
  const base64 = await blobToBase64(blob);
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'uploadPhoto',
      base64: base64,
      fileName: fileName,
      kvNumber: kvNumber
    })
  });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  const text = await response.text();
  const result = parseResponse(text);
  const data = (result && result.data) ? result.data : result;
  if (!data || !data.fileId) throw new Error('Сервер не вернул fileId');
  return data;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const base64 = dataUrl.split(',')[1] || '';
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Не удалось прочитать Blob'));
    reader.readAsDataURL(blob);
  });
}

// ================= ЭКСПОРТ =================

window.sync = {
  syncNow,
  startAutoSync,
  stopAutoSync,
  resetAllAttempts
};
