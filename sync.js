// ================= Движок синхронизации v6 =================
//
// Отправляет осмотры: фото через POST (с раскладкой по замечаниям) → submitVisit → проверка.

const SYNC_INTERVAL_MS = 30 * 1000;
const REQUEST_TIMEOUT_MS = 60 * 1000;
const PHOTO_PAUSE_MS = 500;

const RETRY_DELAYS = [
  10 * 1000,
  30 * 1000,
  60 * 1000,
  5 * 60 * 1000,
  15 * 60 * 1000,
  60 * 60 * 1000
];

let _syncRunning = false;
let _syncTimer = null;
let _wakeLock = null;

async function syncNow() {
  if (_syncRunning) return { skipped: true, reason: 'already-running' };
  if (!navigator.onLine) return { skipped: true, reason: 'offline' };

  _syncRunning = true;
  await requestWakeLock();

  const result = { sent: 0, failed: 0, photos: 0, skipped: 0, errors: [] };
  try {
    if (window.db.resetStuckSyncing) await window.db.resetStuckSyncing(3);

    const pending = await window.db.getPendingVisits();
    pending.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));

    for (const visit of pending) {
      if (!navigator.onLine) break;
      if (!shouldRetryNow(visit)) { result.skipped++; continue; }

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
          lastAttemptAt: new Date().toISOString(),
          progress: null
        });
      }
    }
  } finally {
    _syncRunning = false;
    releaseWakeLock();
    notifyUI();
  }
  return result;
}

function shouldRetryNow(visit) {
  if (!visit.lastAttemptAt) return true;
  const attempts = visit.attempts || 0;
  const delay = RETRY_DELAYS[Math.min(Math.max(attempts - 1, 0), RETRY_DELAYS.length - 1)];
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
        lastError: '',
        progress: null
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
  await window.db.updateVisit(visit.clientId, {
    status: 'syncing',
    syncingStartedAt: new Date().toISOString(),
    progress: { stage: 'photos', current: 0, total: 0 }
  });

  let photosUploaded = 0;

  const photos = await window.db.getPhotosForVisit(visit.clientId);
  const totalPhotos = photos.length;

  await window.db.updateVisit(visit.clientId, {
    progress: { stage: 'photos', current: 0, total: totalPhotos }
  });
  notifyUI();

  // photoMap: { stateKey: { common: [remote], byVariant: { variant: [remote] } } }
  const photoMap = {};

  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    if (!navigator.onLine) throw new Error('Офлайн, синхронизация прервана');

    if (photo.status === 'uploaded' && photo.remote) {
      pushPhotoToMap(photoMap, photo.stateKey, photo.remote, photo.variantKey);
      continue;
    }

    try {
      const remote = await uploadPhotoPost(photo.blob, photo.fileName, photo.kvNumber);
      await window.db.updatePhoto(photo.photoId, {
        status: 'uploaded',
        remote: remote,
        uploadedAt: new Date().toISOString()
      });
      pushPhotoToMap(photoMap, photo.stateKey, remote, photo.variantKey);
      photosUploaded++;

      await window.db.updateVisit(visit.clientId, {
        progress: { stage: 'photos', current: i + 1, total: totalPhotos }
      });
      notifyUI();

      console.log('[sync] Фото', (i + 1) + '/' + totalPhotos, photo.fileName, '→', remote.fileId);
    } catch (err) {
      await window.db.updatePhoto(photo.photoId, {
        status: 'error',
        lastError: err.message,
        attempts: (photo.attempts || 0) + 1
      });
      throw new Error('Ошибка загрузки фото: ' + err.message);
    }

    if (i < photos.length - 1) {
      await sleep(PHOTO_PAUSE_MS);
    }
  }

  const payload = buildPayloadWithPhotos(visit.payload, photoMap);
  payload.clientId = visit.clientId;

  await window.db.updateVisit(visit.clientId, {
    progress: { stage: 'submit', current: 0, total: 0 }
  });
  notifyUI();

  const res = await postApi('submitVisit', payload);
  const data = (res && res.data) ? res.data : res;

  if (!data || data.ok === false) {
    throw new Error('Сервер вернул ошибку: ' + ((data && data.error) || 'неизвестно'));
  }

  await sleep(500);
  try {
    const check = await apiGet('checkVisitExistsByClientId', { clientId: visit.clientId });
    const checkData = (check && check.data) ? check.data : check;
    if (!checkData || !checkData.found) {
      throw new Error('Отправка не подтверждена: строка не найдена в таблице по ClientID');
    }
    console.log('[sync] ✅ Двойная проверка пройдена. Строка:', checkData.row);
  } catch (checkErr) {
    if (String(checkErr.message).indexOf('не подтверждена') !== -1) {
      throw checkErr;
    }
    console.warn('[sync] Проверка не удалась (сеть):', checkErr.message);
  }

  await window.db.updateVisit(visit.clientId, {
    status: 'synced',
    syncedAt: new Date().toISOString(),
    serverRow: (data && data.row) || null,
    progress: null
  });

  for (const p of photos) {
    await window.db.deletePhoto(p.photoId);
  }

  console.log('[sync] ✅ Осмотр отправлен и подтверждён:', visit.clientId, 'строка', (data && data.row));
  return { photosUploaded };
}

function pushPhotoToMap(map, stateKey, remote, variantKey) {
  if (!map[stateKey]) map[stateKey] = { common: [], byVariant: {} };
  const entry = { fileId: remote.fileId, url: remote.url, name: remote.name };

  if (variantKey && String(variantKey).trim()) {
    const v = String(variantKey).trim();
    if (!map[stateKey].byVariant[v]) map[stateKey].byVariant[v] = [];
    map[stateKey].byVariant[v].push(entry);
  } else {
    map[stateKey].common.push(entry);
  }
}

function buildPayloadWithPhotos(originalPayload, photoMap) {
  const results = JSON.parse(JSON.stringify(originalPayload.results || {}));

  Object.keys(photoMap).forEach(stateKey => {
    if (stateKey === '__extra__') return;
    const rs = results[stateKey] || { selected: [], custom: '', noIssues: false, commonPhotos: [], photosByVariant: {}, volumes: {} };

    if (!rs.commonPhotos) rs.commonPhotos = [];
    if (!rs.photosByVariant) rs.photosByVariant = {};

    const bucket = photoMap[stateKey];
    (bucket.common || []).forEach(r => {
      rs.commonPhotos.push({ fileId: r.fileId, url: r.url, name: r.name });
    });
    Object.keys(bucket.byVariant || {}).forEach(variant => {
      if (!rs.photosByVariant[variant]) rs.photosByVariant[variant] = [];
      bucket.byVariant[variant].forEach(r => {
        rs.photosByVariant[variant].push({ fileId: r.fileId, url: r.url, name: r.name });
      });
    });

    // Убираем старое поле photos, если оно было
    delete rs.photos;

    results[stateKey] = rs;
  });

  const extraPhotos = (originalPayload.extraPhotos || []).filter(p => p && p.url)
    .concat(((photoMap['__extra__'] && photoMap['__extra__'].common) || []).map(r => ({
      fileId: r.fileId, url: r.url, name: r.name
    })));

  return Object.assign({}, originalPayload, {
    results: results,
    extraPhotos: extraPhotos
  });
}

// ================= HTTP =================

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, Object.assign({}, options, { signal: controller.signal }));
    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function postApi(action, payload) {
  const response = await fetchWithTimeout(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: action, payload: payload })
  }, REQUEST_TIMEOUT_MS);
  if (!response.ok) throw new Error('HTTP ' + response.status);
  const text = await response.text();
  return parseResponse(text);
}

async function uploadPhotoPost(blob, fileName, kvNumber) {
  const base64 = await blobToBase64(blob);
  const response = await fetchWithTimeout(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'uploadPhoto',
      base64: base64,
      fileName: fileName,
      kvNumber: kvNumber
    })
  }, REQUEST_TIMEOUT_MS);
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ================= WAKE LOCK =================

async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    if (_wakeLock) return;
    _wakeLock = await navigator.wakeLock.request('screen');
    _wakeLock.addEventListener('release', () => { _wakeLock = null; });
    console.log('[sync] Wake Lock включён');
  } catch (e) {
    console.warn('[sync] Wake Lock не удалось:', e.message);
  }
}

function releaseWakeLock() {
  if (_wakeLock) {
    _wakeLock.release().catch(() => {});
    _wakeLock = null;
    console.log('[sync] Wake Lock выключен');
  }
}

// ================= ЭКСПОРТ =================

window.sync = {
  syncNow,
  startAutoSync,
  stopAutoSync,
  resetAllAttempts
};
