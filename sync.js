// ================= Движок синхронизации v9 =================
const SYNC_INTERVAL_OK_MS = 30 * 1000;
const SYNC_INTERVAL_BAD_MS = 2 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 60 * 1000;
const PING_TIMEOUT_MS = 7000;
const PHOTO_PAUSE_MS = 500;

const RETRY_DELAYS = [10 * 1000, 30 * 1000, 60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000, 60 * 60 * 1000];

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
    const reachable = await checkApiReachable();
    if (reachable === null) {
      result.skipped = 1;
      result.reason = 'background';
      return result;
    }

    await window.db.setMeta('apiReachable', { ok: reachable, at: Date.now() });
    if (!reachable) {
      result.skipped = 1;
      result.reason = 'api-unreachable';
      return result;
    }

    if (window.db.resetStuckSyncing) await window.db.resetStuckSyncing(3);

    const pending = await window.db.getPendingVisits();
    pending.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));

    for (const visit of pending) {
      if (!navigator.onLine) break;
      if (!shouldRetryNow(visit)) { result.skipped++; continue; }

      if (result.sent > 0) {
        const stillReachable = await checkApiReachable();
        if (stillReachable === null) break;
        await window.db.setMeta('apiReachable', { ok: stillReachable, at: Date.now() });
        if (!stillReachable) {
          result.reason = 'api-lost';
          break;
        }
      }

      try {
        const r = await syncVisit(visit);
        result.sent++;
        result.photos += r.photosUploaded;
            } catch (err) {
        result.failed++;
        result.errors.push({ clientId: visit.clientId, error: err.message });

        const isBroken = String(err.message || '').indexOf('Фото отсутствует в локальном хранилище') !== -1;

        if (isBroken) {
          // Не инкрементим attempts — иначе уйдёт в 60-минутный бэкофф.
          // Пользователь должен сразу увидеть проблему в UI и переснять.
          await window.db.updateVisit(visit.clientId, {
            status: 'broken',
            lastError: err.message,
            lastAttemptAt: new Date().toISOString(),
            progress: null
          });
        } else {
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
    }
  } finally {
    _syncRunning = false;
    releaseWakeLock();
    notifyUI();
  }
  return result;
}

async function checkApiReachable() {
  if (document.visibilityState !== 'visible') return null;

  const t0 = Date.now();
  const detail = { at: Date.now(), ok: false, elapsed: 0, status: 0, body: '', error: '' };

  try {
    const url = API_URL + '?action=ping&callback=cb&t=' + Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
    try {
      const response = await fetch(url, { method: 'GET', signal: controller.signal, cache: 'no-store' });
      detail.status = response.status;
      detail.elapsed = Date.now() - t0;

      if (!response.ok) {
        detail.error = 'HTTP ' + response.status;
        await savePingDetail(detail);
        return false;
      }
      const text = await response.text();
      detail.body = String(text).substring(0, 300);
      const lower = detail.body.toLowerCase();
      const ok = lower.indexOf('pong') !== -1 || lower.indexOf('"ok":true') !== -1;
      detail.ok = ok;
      await savePingDetail(detail);
      return ok;
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    detail.elapsed = Date.now() - t0;
    detail.error = e.name === 'AbortError' ? 'timeout' : (e.message || String(e));
    await savePingDetail(detail);
    return false;
  }
}

async function savePingDetail(detail) {
  try {
    if (window.db && window.db.setMeta) {
      await window.db.setMeta('pingDetail', detail);
    }
  } catch (e) {}
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
    if (v.status !== 'synced' && v.status !== 'broken') {
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
  window.addEventListener('offline', onOffline);
  document.addEventListener('visibilitychange', onVisibilityChange);

  setTimeout(() => {
    if (navigator.onLine) syncNow().catch(() => {});
  }, 1000);

  scheduleNext();
}

function scheduleNext() {
  if (_syncTimer) { clearTimeout(_syncTimer); _syncTimer = null; }

  window.db.getMeta('apiReachable').then(meta => {
    const isBad = meta && !meta.ok && (Date.now() - meta.at) < 10 * 60 * 1000;
    const interval = isBad ? SYNC_INTERVAL_BAD_MS : SYNC_INTERVAL_OK_MS;
    _syncTimer = setTimeout(async () => {
      if (navigator.onLine) {
        try { await syncNow(); } catch (e) {}
      }
      scheduleNext();
    }, interval);
  }).catch(() => {
    _syncTimer = setTimeout(async () => {
      if (navigator.onLine) {
        try { await syncNow(); } catch (e) {}
      }
      scheduleNext();
    }, SYNC_INTERVAL_OK_MS);
  });
}

function stopAutoSync() {
  if (_syncTimer) { clearTimeout(_syncTimer); _syncTimer = null; }
  window.removeEventListener('online', onOnline);
  window.removeEventListener('offline', onOffline);
  document.removeEventListener('visibilitychange', onVisibilityChange);
}

function onOnline() {
  setTimeout(async () => {
    try { await syncNow(); } catch (e) {}
    scheduleNext();
  }, 500);
}

function onOffline() {
  notifyUI();
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible' && navigator.onLine) {
    setTimeout(async () => {
      try { await syncNow(); } catch (e) {}
      scheduleNext();
    }, 500);
  }
}

function notifyUI() {
  if (typeof window.onQueueChanged === 'function') {
    try { window.onQueueChanged(); } catch (e) {}
  }
}

async function syncVisit(visit) {
  const original = visit.payload;
  if (!original || !original.houseId || !original.kvNumber || !visit.clientId) {
    throw new Error('Не определены литер, квартира или ClientID. Осмотр оставлен в очереди.');
  }
  if (original.clientId && original.clientId !== visit.clientId) {
    throw new Error('Идентификаторы осмотра не совпадают');
  }
  const scope = {
    houseId: original.houseId,
    kvNumber: original.kvNumber,
    clientId: visit.clientId,
    visitedAt: original.visitedAt || visit.createdAt
  };
  if (!scope.visitedAt || !Number.isFinite(new Date(scope.visitedAt).getTime())) {
    throw new Error('Не определена дата осмотра');
  }
  if (!await window.db.updateVisit(visit.clientId, {
    status: 'syncing', syncingStartedAt: new Date().toISOString(),
    progress: { stage: 'photos', current: 0, total: 0 }
  })) throw new Error('Не удалось записать статус отправки');

  const allPhotos = await window.db.getPhotosForVisit(visit.clientId);
  const photosById = new Map(allPhotos.map(p => [p.photoId, p]));
  const needed = new Map();
  const payload = JSON.parse(JSON.stringify(original));
  payload.clientId = scope.clientId;
  payload.visitedAt = scope.visitedAt;
  payload.sourceVisitId = original.sourceVisitId || null;

  const urlOf = p => p && (p.url || (p.remote && p.remote.url));
  const validUrl = url => typeof url === 'string' && /^https:\/\//i.test(url);
  function referencePhoto(p) {
    // Уже загруженные фото остаются по прежней ссылке.
    if (validUrl(urlOf(p))) return { url: urlOf(p), name: p.name || '' };
    if (!p) throw new Error('Фото отсутствует в локальном хранилище');
    let photo = p.photoId ? photosById.get(p.photoId) : null;
    if (!p.photoId && p.name) {
      const matches = allPhotos.filter(x => x.fileName === p.name);
      if (matches.length > 1) throw new Error('Неоднозначное имя фото: ' + p.name);
      photo = matches[0];
    }
    if (!photo || !photo.photoId) {
      throw new Error('Фото отсутствует в локальном хранилище: ' + (p.photoId || p.name || 'без ID'));
    }
    needed.set(photo.photoId, photo);
    return { photoId: photo.photoId };
  }
  function convert(arr) { return (arr || []).map(referencePhoto); }
  Object.values(payload.results || {}).forEach(rs => {
    rs.commonPhotos = convert(rs.commonPhotos).concat(convert(rs.photos));
    delete rs.photos;
    Object.keys(rs.photosByVariant || {}).forEach(v => {
      rs.photosByVariant[v] = convert(rs.photosByVariant[v]);
    });
  });
  payload.extraPhotos = convert(payload.extraPhotos);

  const photos = [...needed.values()];
  const uploaded = new Map();
  let photosUploaded = 0;
  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    if (!navigator.onLine) throw new Error('Офлайн, синхронизация прервана');
    let remote = photo.status === 'uploaded' ? photo.remote : null;
    if (!remote || !remote.fileId || !validUrl(remote.url)) {
      if (!photo.blob || !photo.blob.size) {
        throw new Error('Фото отсутствует в локальном хранилище: ' + photo.photoId);
      }
      try {
        remote = await uploadPhotoPost(photo.blob, photo.fileName, scope, photo.photoId);
        if (!remote || !remote.fileId || !validUrl(remote.url)) {
          throw new Error('Сервер не подтвердил загрузку фото');
        }
        if (!await window.db.updatePhoto(photo.photoId, {
          status: 'uploaded', remote: remote, uploadedAt: new Date().toISOString()
        })) throw new Error('Не удалось сохранить подтверждение загрузки фото');
        photosUploaded++;
      } catch (err) {
        await window.db.updatePhoto(photo.photoId, {
          status: 'error', lastError: err.message, attempts: (photo.attempts || 0) + 1
        });
        throw err;
      }
    }
    uploaded.set(photo.photoId, { fileId: remote.fileId, url: remote.url, name: remote.name || photo.fileName });
    await window.db.updateVisit(visit.clientId, {
      progress: { stage: 'photos', current: i + 1, total: photos.length }
    });
    notifyUI();
    if (i < photos.length - 1) await sleep(PHOTO_PAUSE_MS);
  }

  // Подставляем ссылки строго на место исходных photoId, а не по названию блока.
  function resolve(arr) {
    return (arr || []).map(p => {
      const remote = p.photoId ? uploaded.get(p.photoId) : p;
      if (!remote || !validUrl(remote.url)) throw new Error('Не подтверждена загрузка фото');
      return remote;
    });
  }
  Object.values(payload.results || {}).forEach(rs => {
    rs.commonPhotos = resolve(rs.commonPhotos);
    Object.keys(rs.photosByVariant || {}).forEach(v => {
      rs.photosByVariant[v] = resolve(rs.photosByVariant[v]);
    });
  });
  payload.extraPhotos = resolve(payload.extraPhotos);

  await window.db.updateVisit(visit.clientId, {
    progress: { stage: 'submit', current: 0, total: 0 }
  });
  notifyUI();
  const res = await postApi('submitVisitScoped', payload);
  const data = res && res.data;
  if (!res || res.ok !== true || !data || data.ok !== true ||
      data.clientId !== visit.clientId || !Number.isInteger(data.row) || data.row < 2) {
    throw new Error('Сервер не подтвердил запись именно этого осмотра');
  }
  if (!await window.db.updateVisit(visit.clientId, {
    status: 'synced', syncedAt: new Date().toISOString(),
    serverRow: data.row, progress: null, lastError: '', payload: payload
  })) throw new Error('Не удалось сохранить подтверждение отправки');

  // Только после подтверждения сервера и локальной записи статуса.
  for (const p of photos) await window.db.deletePhoto(p.photoId);
  return { photosUploaded };
}

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
  let token = null;
  try { token = await window.db.getMeta('authToken'); } catch (e) {}
  
  const response = await fetchWithTimeout(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      action: action, 
      payload: payload,
      token: token 
    })
  }, REQUEST_TIMEOUT_MS);
  if (!response.ok) throw new Error('HTTP ' + response.status);
  const text = await response.text();
  return parseResponse(text);
}

async function uploadPhotoPost(blob, fileName, scope, photoId) {
  const base64 = await blobToBase64(blob);
  let token = null;
  try { token = await window.db.getMeta('authToken'); } catch (e) {}
  
  const response = await fetchWithTimeout(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
            action: 'uploadPhotoScoped',
      base64: base64,
      fileName: fileName,
      houseId: scope.houseId,
      kvNumber: scope.kvNumber,
      clientId: scope.clientId,
      visitedAt: scope.visitedAt,
      photoId: photoId,
      token: token
    })
  }, REQUEST_TIMEOUT_MS);
  if (!response.ok) throw new Error('HTTP ' + response.status);
  const text = await response.text();
  const result = parseResponse(text);
  const data = (result && result.data) ? result.data : result;
    if (!data || !data.fileId || typeof data.url !== 'string' || !/^https:\/\//i.test(data.url)) {
    throw new Error('Сервер не подтвердил загрузку фото');
  }
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

async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    if (_wakeLock) return;
    _wakeLock = await navigator.wakeLock.request('screen');
    _wakeLock.addEventListener('release', () => { _wakeLock = null; });
  } catch (e) {}
}

function releaseWakeLock() {
  if (_wakeLock) {
    _wakeLock.release().catch(() => {});
    _wakeLock = null;
  }
}

window.sync = {
  syncNow,
  startAutoSync,
  stopAutoSync,
  resetAllAttempts,
  checkApiReachable

};
