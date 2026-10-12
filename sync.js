// ================= Движок синхронизации v2 =================
//
// Следит за очередью осмотров и фото в IndexedDB.
// Порядок отправки одного осмотра:
//   1) загружаем все фото по одному (POST) → получаем fileId/url
//   2) собираем актуальный payload.results с url фото
//   3) отправляем submitVisit

const SYNC_INTERVAL_MS = 30 * 1000;
const MAX_ATTEMPTS = 5;

let _syncRunning = false;
let _syncTimer = null;

// ================= ПУБЛИЧНЫЙ API =================

async function syncNow() {
  if (_syncRunning) return { skipped: true, reason: 'already-running' };
  if (!navigator.onLine) return { skipped: true, reason: 'offline' };
  _syncRunning = true;

  const result = { sent: 0, failed: 0, photos: 0, errors: [] };
  try {
    const pending = await window.db.getPendingVisits();
    // Сортируем по дате создания — сначала старые
    pending.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));

    for (const visit of pending) {
      if (!navigator.onLine) break;
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
        // Если слишком много попыток — пропускаем этот осмотр до следующей сессии
        if (attempts >= MAX_ATTEMPTS) {
          console.warn('[sync] Слишком много попыток для', visit.clientId);
        }
      }
    }
  } finally {
    _syncRunning = false;
    notifyUI();
  }
  return result;
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

  // 1. Загружаем все фото, привязанные к этому осмотру
  const photos = await window.db.getPhotosForVisit(visit.clientId);
  const photoMap = {}; // stateKey → [{fileId, url, name}, ...]

  for (const photo of photos) {
    if (!navigator.onLine) throw new Error('Офлайн, синхронизация прервана');

    if (photo.status === 'uploaded' && photo.remote) {
      // Уже загружено — переиспользуем
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

  // 2. Собираем payload с актуальными url
  const payload = buildPayloadWithPhotos(visit.payload, photoMap);

  // 3. Отправляем осмотр
  payload.clientId = visit.clientId;
  const res = await apiGet('submitVisit', payload);
  const data = (res && res.data) ? res.data : res;

  await window.db.updateVisit(visit.clientId, {
    status: 'synced',
    syncedAt: new Date().toISOString(),
    serverRow: (data && data.row) || null
  });

  // 4. Удаляем отправленные фото из IndexedDB
  for (const p of photos) {
    await window.db.deletePhoto(p.photoId);
  }

  console.log('[sync] Осмотр отправлен:', visit.clientId);
  return { photosUploaded: photosUploaded };
}

function pushPhotoToMap(map, stateKey, remote) {
  if (!map[stateKey]) map[stateKey] = [];
  map[stateKey].push(remote);
}

// ================= СБОРКА PAYLOAD С ФОТО =================

function buildPayloadWithPhotos(originalPayload, photoMap) {
  const results = JSON.parse(JSON.stringify(originalPayload.results || {}));

  Object.keys(photoMap).forEach(stateKey => {
    if (stateKey === '__extra__') return; // обрабатываем отдельно
    const rs = results[stateKey] || { selected: [], custom: '', noIssues: false, photos: [] };
    // Уже загруженные ранее фото (если осмотр отправляется частично)
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

// ================= POST ДЛЯ ФОТО =================

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
  stopAutoSync
};
