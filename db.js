// ================= IndexedDB v3 =================

const DB_NAME = 'osmotr_db';
const DB_VERSION = 4;
const STORE_DRAFTS         = 'drafts';
const STORE_REFERENCE      = 'reference';
const STORE_REMARKS        = 'remarks';
const STORE_MARKS          = 'marks';
const STORE_META           = 'meta';
const STORE_VISITS         = 'visits';
const STORE_PHOTOS         = 'photos';
const STORE_OFFLINE_VISITS = 'offline_visits';
const STORE_SERVER_HISTORY = 'server_history';

const DRAFT_KEY = 'current_draft';

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(new Error('Не удалось открыть IndexedDB'));
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains(STORE_DRAFTS)) {
        db.createObjectStore(STORE_DRAFTS);
      }
      if (!db.objectStoreNames.contains(STORE_REFERENCE)) {
        db.createObjectStore(STORE_REFERENCE);
      }
      if (!db.objectStoreNames.contains(STORE_REMARKS)) {
        db.createObjectStore(STORE_REMARKS);
      }
      if (!db.objectStoreNames.contains(STORE_MARKS)) {
        db.createObjectStore(STORE_MARKS);
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META);
      }
      if (!db.objectStoreNames.contains(STORE_VISITS)) {
        const s = db.createObjectStore(STORE_VISITS, { keyPath: 'clientId' });
        s.createIndex('status', 'status', { unique: false });
        s.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_PHOTOS)) {
        const s = db.createObjectStore(STORE_PHOTOS, { keyPath: 'photoId' });
        s.createIndex('visitClientId', 'visitClientId', { unique: false });
        s.createIndex('status', 'status', { unique: false });
      }
            if (!db.objectStoreNames.contains(STORE_OFFLINE_VISITS)) {
        const s = db.createObjectStore(STORE_OFFLINE_VISITS, { keyPath: 'clientId' });
        s.createIndex('kvNumber', 'kvNumber', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_SERVER_HISTORY)) {
        const s = db.createObjectStore(STORE_SERVER_HISTORY, { keyPath: 'clientId' });
        s.createIndex('kv', 'kv', { unique: false });
        s.createIndex('visitedAt', 'visitedAt', { unique: false });
      }
    };
  });
  return _dbPromise;
}

function req(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ================= DRAFTS =================
async function saveDraft(data) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_DRAFTS, 'readwrite');
    tx.objectStore(STORE_DRAFTS).put(data, DRAFT_KEY);
    return new Promise((resolve) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (e) { console.warn('saveDraft:', e); return false; }
}

async function loadDraft() {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_DRAFTS, 'readonly');
    const r = tx.objectStore(STORE_DRAFTS).get(DRAFT_KEY);
    return await req(r);
  } catch (e) { console.warn('loadDraft:', e); return null; }
}

async function clearDraft() {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_DRAFTS, 'readwrite');
    tx.objectStore(STORE_DRAFTS).delete(DRAFT_KEY);
    return new Promise((resolve) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (e) { console.warn('clearDraft:', e); return false; }
}

async function hasDraft() {
  const d = await loadDraft();
  return !!d;
}

// ================= META =================
async function getMeta(key) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_META, 'readonly');
    const r = tx.objectStore(STORE_META).get(key);
    return await req(r);
  } catch (e) { return null; }
}

async function setMeta(key, value) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_META, 'readwrite');
    tx.objectStore(STORE_META).put(value, key);
    return new Promise((resolve) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (e) { return false; }
}

// ================= REFERENCE =================
async function getReference(houseId) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_REFERENCE, 'readonly');
    const r = tx.objectStore(STORE_REFERENCE).get(houseId || 'all');
    return (await req(r)) || null;
  } catch (e) { return null; }
}
async function setReference(houseId, map) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_REFERENCE, 'readwrite');
    tx.objectStore(STORE_REFERENCE).put(map || {}, houseId || 'all');
    return new Promise((resolve) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (e) { return false; }
}

// ================= REMARKS =================
async function getRemarks() {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_REMARKS, 'readonly');
    const r = tx.objectStore(STORE_REMARKS).get('all');
    return (await req(r)) || null;
  } catch (e) { return null; }
}
async function setRemarks(map) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_REMARKS, 'readwrite');
    tx.objectStore(STORE_REMARKS).put(map || {}, 'all');
    return new Promise((resolve) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (e) { return false; }
}

// ================= MARKS =================
async function getMarks() {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_MARKS, 'readonly');
    const r = tx.objectStore(STORE_MARKS).get('all');
    return (await req(r)) || null;
  } catch (e) { return null; }
}
async function setMarks(map) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_MARKS, 'readwrite');
    tx.objectStore(STORE_MARKS).put(map || {}, 'all');
    return new Promise((resolve) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (e) { return false; }
}

// ================= VISITS =================
async function addVisit(visit) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_VISITS, 'readwrite');
    tx.objectStore(STORE_VISITS).put(visit);
    return new Promise((resolve) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (e) { console.warn('addVisit:', e); return false; }
}

async function getVisit(clientId) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_VISITS, 'readonly');
    const r = tx.objectStore(STORE_VISITS).get(clientId);
    return await req(r);
  } catch (e) { return null; }
}

async function updateVisit(clientId, patch) {
  try {
    const existing = await getVisit(clientId);
    if (!existing) return false;
    return await addVisit(Object.assign({}, existing, patch));
  } catch (e) { return false; }
}

async function getAllVisits() {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_VISITS, 'readonly');
    const r = tx.objectStore(STORE_VISITS).getAll();
    return (await req(r)) || [];
  } catch (e) { return []; }
}

async function getPendingVisits() {
  const all = await getAllVisits();
  const pending = all.filter(v => v.status !== 'synced' && v.status !== 'broken');

  // Помечаем визиты, у которых в payload есть ссылки на фото, но самих
  // записей в STORE_PHOTOS нет (iOS вытеснил Blob). Такие визиты НЕ отдаём
  // в отправку — иначе они уйдут без фото молча.
  const broken = [];
  for (const v of pending) {
    const ok = await _visitPhotosIntact(v);
    if (!ok) {
      broken.push(v);
      await updateVisit(v.clientId, {
        status: 'broken',
        lastError: 'Часть фото отсутствует в локальном хранилище. Переснимите и отправьте заново.',
        brokenAt: new Date().toISOString()
      });
    }
  }

  if (broken.length) {
    console.warn('[db] getPendingVisits: помечено как broken:', broken.length);
  }

  return pending.filter(v => !broken.some(b => b.clientId === v.clientId));
}

// Проверяет, что все photoId, на которые ссылается payload, реально есть в STORE_PHOTOS.
async function _visitPhotosIntact(visit) {
  try {
    const payload = visit && visit.payload;
    if (!payload) return true;

    const referencedIds = _collectReferencedPhotoIds(payload);
    if (!referencedIds.size) return true;

    const photos = await getPhotosForVisit(visit.clientId);
    const presentIds = new Set(photos.map(p => p.photoId));
    for (const id of referencedIds) {
      if (!presentIds.has(id)) return false;
    }
    return true;
  } catch (e) {
    // Если проверка упала — не блокируем отправку, но фиксируем.
    console.warn('[_visitPhotosIntact]', e);
    return true;
  }
}

function _collectReferencedPhotoIds(payload) {
  const ids = new Set();
  const push = (arr) => {
    (arr || []).forEach(p => {
      if (p && p.photoId) ids.add(p.photoId);
    });
  };
  const results = (payload && payload.results) || {};
  Object.keys(results).forEach(sk => {
    const rs = results[sk] || {};
    push(rs.commonPhotos);
    const byVar = rs.photosByVariant || {};
    Object.keys(byVar).forEach(v => push(byVar[v]));
  });
  push(payload.extraPhotos);
  return ids;
}

async function getSyncedVisits() {
  const all = await getAllVisits();
  return all.filter(v => v.status === 'synced');
}

async function getVisibleVisits() {
  const all = await getAllVisits();
  return all.filter(v => !v.hidden);
}

async function findVisitsByKv(kvNumber) {
  const all = await getAllVisits();
  const kv = String(kvNumber || '').trim().toLowerCase();
  return all
    .filter(v => !v.hidden && v.payload && String(v.payload.kvNumber || '').trim().toLowerCase() === kv)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

async function hideVisit(clientId) {
  return await updateVisit(clientId, { hidden: true });
}

async function unhideVisit(clientId) {
  return await updateVisit(clientId, { hidden: false });
}

async function deleteVisit(clientId) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_VISITS, 'readwrite');
    tx.objectStore(STORE_VISITS).delete(clientId);
    return new Promise((resolve) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (e) { return false; }
}

async function resetStuckSyncing(maxAgeMinutes) {
  const maxAge = (maxAgeMinutes || 3) * 60 * 1000;
  const now = Date.now();
  const all = await getAllVisits();
  let count = 0;
  for (const v of all) {
    if (v.status === 'syncing') {
      const startedAt = v.syncingStartedAt ? new Date(v.syncingStartedAt).getTime() : 0;
      if (!startedAt || (now - startedAt) > maxAge) {
        await updateVisit(v.clientId, {
          status: 'pending',
          lastError: 'Автосброс: превышено время синхронизации'
        });
        count++;
      }
    }
  }
  if (count > 0) console.log('[db] resetStuckSyncing вернул в pending:', count);
  return count;
}

// ================= OFFLINE VISITS =================
async function saveOfflineVisit(visit) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_OFFLINE_VISITS, 'readwrite');
    tx.objectStore(STORE_OFFLINE_VISITS).put(visit);
    return new Promise((resolve) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (e) { console.warn('saveOfflineVisit:', e); return false; }
}

async function getOfflineVisitsByKv(kv) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_OFFLINE_VISITS, 'readonly');
    const idx = tx.objectStore(STORE_OFFLINE_VISITS).index('kvNumber');
    const r = idx.getAll(String(kv).trim());
    return (await req(r)) || [];
  } catch (e) { return []; }
}

async function getAllOfflineVisits() {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_OFFLINE_VISITS, 'readonly');
    const r = tx.objectStore(STORE_OFFLINE_VISITS).getAll();
    return (await req(r)) || [];
  } catch (e) { return []; }
}

// Функция для получения статистики по скачанным квартирам
async function getAllOfflineVisitsInfo() {
  try {
    const visits = await getAllOfflineVisits();
    const map = {};
    visits.forEach(v => {
      const kv = String(v.kvNumber).trim();
      const date = v.visitedAt ? new Date(v.visitedAt).getTime() : 0;
      if (!map[kv] || date > map[kv].date) {
        map[kv] = { date: date, visitedAt: v.visitedAt };
      }
    });
    return map;
  } catch (e) { return {}; }
}
async function clearAllOfflineVisits() {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_OFFLINE_VISITS, 'readwrite');
    tx.objectStore(STORE_OFFLINE_VISITS).clear();
    return new Promise((resolve) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (e) { 
    console.warn('clearAllOfflineVisits:', e); 
    return false; 
  }
}
// ================= PHOTOS =================
async function addPhoto(photo) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_PHOTOS, 'readwrite');
    tx.objectStore(STORE_PHOTOS).put(photo);
    return new Promise((resolve) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (e) { console.warn('addPhoto:', e); return false; }
}

async function getPhoto(photoId) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_PHOTOS, 'readonly');
    const r = tx.objectStore(STORE_PHOTOS).get(photoId);
    const photo = await req(r);
    if (!photo) return null;

    // 1. Если есть opfsFileName — читаем из OPFS
    if (photo.opfsFileName) {
      const file = await opfsReadFile(photo.opfsFileName);
      if (file) {
        photo.blob = file;
        return photo;
      }
      // Если файл в OPFS пропал (крайне редко), падаем на ArrayBuffer
      console.warn('[db] OPFS файл не найден, пробуем ArrayBuffer:', photo.opfsFileName);
    }

    // 2. Fallback на ArrayBuffer (старый формат или если OPFS не сработал)
    if (photo.photoData && photo.photoType && !photo.blob) {
      photo.blob = new Blob([photo.photoData], { type: photo.photoType });
    }
    return photo;
  } catch (e) { return null; }
}
async function updatePhoto(photoId, patch) {
  try {
    const existing = await getPhoto(photoId);
    if (!existing) return false;
    return await addPhoto(Object.assign({}, existing, patch));
  } catch (e) { return false; }
}

async function getPhotosForVisit(visitClientId) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_PHOTOS, 'readonly');
    const idx = tx.objectStore(STORE_PHOTOS).index('visitClientId');
    const r = idx.getAll(visitClientId);
    const photos = (await req(r)) || [];
    
    // Восстанавливаем Blob из OPFS или ArrayBuffer
    for (const p of photos) {
      if (p.opfsFileName) {
        const file = await opfsReadFile(p.opfsFileName);
        if (file) {
          p.blob = file;
          continue; // Успешно прочитали из OPFS, идем к следующему
        }
        console.warn('[db] OPFS файл не найден для', p.photoId, ', пробуем ArrayBuffer');
      }
      
      // Fallback на ArrayBuffer
      if (p.photoData && p.photoType && !p.blob) {
        p.blob = new Blob([p.photoData], { type: p.photoType });
      }
    }
    
    return photos;
  } catch (e) { return []; }
}

async function getAllPhotos() {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_PHOTOS, 'readonly');
    const r = tx.objectStore(STORE_PHOTOS).getAll();
    const photos = (await req(r)) || [];
    
    // Восстанавливаем Blob из OPFS или ArrayBuffer
    for (const p of photos) {
      if (p.opfsFileName) {
        const file = await opfsReadFile(p.opfsFileName);
        if (file) {
          p.blob = file;
          continue;
        }
        console.warn('[db] OPFS файл не найден для', p.photoId, ', пробуем ArrayBuffer');
      }
      
      if (p.photoData && p.photoType && !p.blob) {
        p.blob = new Blob([p.photoData], { type: p.photoType });
      }
    }
    
    return photos;
  } catch (e) { return []; }
}

async function deletePhoto(photoId) {
  try {
    const db = await openDB();
    
    // 1. Сначала достаем запись, чтобы узнать имя файла в OPFS
    const txRead = db.transaction(STORE_PHOTOS, 'readonly');
    const photo = await req(txRead.objectStore(STORE_PHOTOS).get(photoId));
    
    // 2. Если есть файл в OPFS — удаляем его
    if (photo && photo.opfsFileName) {
      await opfsDeleteFile(photo.opfsFileName);
    }

    // 3. Удаляем саму запись из IndexedDB
    const tx = db.transaction(STORE_PHOTOS, 'readwrite');
    tx.objectStore(STORE_PHOTOS).delete(photoId);
    return new Promise((resolve) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (e) { 
    console.warn('deletePhoto error:', e);
    return false; 
  }
}

async function getPhotoCountsForVisit(visitClientId) {
  const photos = await getPhotosForVisit(visitClientId);
  return {
    total: photos.length,
    uploaded: photos.filter(p => p.status === 'uploaded').length
  };
}

// ================= СТАТИСТИКА =================
async function getQueueStats() {
  const visits = await getAllVisits();
  const photos = await getAllPhotos();

  return {
    pendingVisits: visits.filter(v => v.status !== 'synced' && v.status !== 'broken' && !v.hidden).length,
    brokenVisits: visits.filter(v => v.status === 'broken' && !v.hidden).length,
    pendingPhotos: photos.filter(p => p.status !== 'uploaded').length,
    totalVisits: visits.length,
    syncedVisits: visits.filter(v => v.status === 'synced').length
  };
}
// ================= PERSISTENT STORAGE =================
async function requestPersistentStorage() {
  try {
    if (!navigator.storage || !navigator.storage.persist) {
      return { supported: false, granted: false };
    }
    const already = await navigator.storage.persisted();
    if (already) {
      await setMeta('persistentStorage', { granted: true, at: Date.now(), already: true });
      return { supported: true, granted: true, already: true };
    }
    const granted = await navigator.storage.persist();
    await setMeta('persistentStorage', { granted: granted, at: Date.now(), already: false });
    return { supported: true, granted: granted, already: false };
  } catch (e) {
    return { supported: false, granted: false, error: String(e && e.message || e) };
  }
}
// ================= UUID =================
function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// ================= ИМЯ ОСМОТРЩИКА =================
async function getUserName() {
  const v = await getMeta('userName');
  return v ? String(v) : '';
}
async function setUserName(name) {
  return await setMeta('userName', String(name || '').trim());
}

// ================= ТИХОЕ ОБНОВЛЕНИЕ СПРАВОЧНИКА =================
async function silentUpdateReference() {
  if (!navigator.onLine) return false;
  if (typeof apiGet !== 'function') return false;
  try {
    const ver = await apiGet('getVersion');
    const serverVersion = (ver && ver.data) ? ver.data : ver;
    const localVersion = await getMeta('version');

    const noVersionYet = !serverVersion || String(serverVersion.reference) === '0' || String(serverVersion.reference) === '';
    const same = !noVersionYet && localVersion && localVersion.reference === serverVersion.reference && localVersion.remarks === serverVersion.remarks && localVersion.marks === serverVersion.marks;

    if (same) {
      console.log('[sync] Версии совпадают, обновление справочника не нужно');
      return false;
    }

    console.log('[sync] Тянем общие правила...');
    const remRes = await apiGet('getRemarksFull');
    const remData = (remRes && remRes.data) ? remRes.data : remRes;
    if (remData) await setRemarks(remData);

    const markRes = await apiGet('getMarks');
    const markData = (markRes && markRes.data) ? markRes.data : markRes;
    if (markData) await setMarks(markData);

    console.log('[sync] Тянем список домов...');
    const housesRes = await apiGet('getHouses');
    const houses = (housesRes && housesRes.data) ? housesRes.data : housesRes;
    if (Array.isArray(houses) && houses.length > 0) {
      await setMeta('houses_cache', houses);
      
      // Скачиваем справочник для каждого дома
      for (const h of houses) {
        console.log('[sync] Тянем справочник для дома:', h.name);
        const refRes = await apiGet('getReference', { houseId: h.id });
        const refData = (refRes && refRes.data) ? refRes.data : refRes;
        if (refData) await setReference(h.id, refData);
      }
    }

    await setMeta('version', serverVersion);
    console.log('[sync] Готово.');
    return true;
  } catch (err) {
    console.warn('[sync] silentUpdateReference:', err.message);
    return false;
  }
}
// ================= OPFS =================
async function opfsWriteFile(fileName, blob) {
  try {
    if (!navigator.storage || !navigator.storage.getDirectory) return false;
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    return true;
  } catch (e) {
    console.warn('[OPFS] write error:', e);
    return false;
  }
}

async function opfsReadFile(fileName) {
  try {
    if (!navigator.storage || !navigator.storage.getDirectory) return null;
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle(fileName);
    return await fileHandle.getFile(); // Возвращает File (это Blob)
  } catch (e) {
    console.warn('[OPFS] read error:', e);
    return null;
  }
}

async function opfsDeleteFile(fileName) {
  try {
    if (!navigator.storage || !navigator.storage.getDirectory) return false;
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(fileName);
    return true;
  } catch (e) {
    console.warn('[OPFS] delete error:', e);
    return false;
  }
}

// ================= ЭКСПОРТ =================
window.db = { opfsWriteFile,
  opfsReadFile,
  opfsDeleteFile,
  saveDraft,  saveOfflineVisit, getOfflineVisitsByKv, getAllOfflineVisits, getAllOfflineVisitsInfo,
  clearAllOfflineVisits, loadDraft, clearDraft, hasDraft,
  getMeta, setMeta,
  getReference, setReference,
  getRemarks, setRemarks,
  getMarks, setMarks,
  addVisit, getVisit, updateVisit, getAllVisits, getPendingVisits, getSyncedVisits,
  getVisibleVisits, findVisitsByKv, hideVisit, unhideVisit, deleteVisit,
  resetStuckSyncing,
  saveOfflineVisit, getOfflineVisitsByKv, getAllOfflineVisits, getAllOfflineVisitsInfo,
  addPhoto, getPhoto, updatePhoto, getPhotosForVisit, getAllPhotos, deletePhoto,
  getPhotoCountsForVisit,
  getQueueStats,
  uuid,
  getUserName, setUserName,
    silentUpdateReference,
  requestPersistentStorage,
  _openDB: openDB
};
