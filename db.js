// ================= IndexedDB v2 =================
//
// Хранилища:
//   drafts    — текущий черновик осмотра (один)
//   reference — справочник квартир      (key: 'all')
//   remarks   — правила замечаний       (key: 'all')
//   marks     — марки окон              (key: 'all')
//   meta      — версии, даты синхронизации
//   visits    — очередь осмотров        (key: clientId)
//   photos    — очередь фото            (key: photoId, индекс по visitClientId)
//
// Все ошибки глушатся — приложение не падает из-за IndexedDB.

const DB_NAME = 'osmotr_db';
const DB_VERSION = 2;
const STORE_DRAFTS    = 'drafts';
const STORE_REFERENCE = 'reference';
const STORE_REMARKS   = 'remarks';
const STORE_MARKS     = 'marks';
const STORE_META      = 'meta';
const STORE_VISITS    = 'visits';
const STORE_PHOTOS    = 'photos';

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

// ================= REFERENCE / REMARKS / MARKS =================

async function getReference() {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_REFERENCE, 'readonly');
    const r = tx.objectStore(STORE_REFERENCE).get('all');
    return (await req(r)) || null;
  } catch (e) { return null; }
}
async function setReference(map) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_REFERENCE, 'readwrite');
    tx.objectStore(STORE_REFERENCE).put(map || {}, 'all');
    return new Promise((resolve) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (e) { return false; }
}

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
  return all.filter(v => v.status !== 'synced');
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
    return await req(r);
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
    return (await req(r)) || [];
  } catch (e) { return []; }
}

async function deletePhoto(photoId) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_PHOTOS, 'readwrite');
    tx.objectStore(STORE_PHOTOS).delete(photoId);
    return new Promise((resolve) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (e) { return false; }
}

// ================= СТАТИСТИКА =================

async function getQueueStats() {
  const visits = await getAllVisits();
  let photos = [];
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_PHOTOS, 'readonly');
    const r = tx.objectStore(STORE_PHOTOS).getAll();
    photos = (await req(r)) || [];
  } catch (e) {}

  return {
    pendingVisits: visits.filter(v => v.status !== 'synced').length,
    pendingPhotos: photos.filter(p => p.status !== 'uploaded').length,
    totalVisits: visits.length
  };
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

// ================= ЭКСПОРТ =================
// Тихое обновление справочника, правил и марок из сети
async function silentUpdateReference() {
  if (!navigator.onLine) return false;
  try {
    const ver = await apiGet('getVersion');
    const serverVersion = (ver && ver.data) ? ver.data : ver;
    const localVersion = await getMeta('version');

    const same =
      localVersion &&
      serverVersion &&
      localVersion.reference === serverVersion.reference &&
      localVersion.remarks === serverVersion.remarks &&
      localVersion.marks === serverVersion.marks;

    if (same) {
      console.log('[sync] Версии совпадают, обновление не нужно');
      return false;
    }

    console.log('[sync] Тянем справочник…');
    const refRes = await apiGet('getReference');
    const refData = (refRes && refRes.data) ? refRes.data : refRes;
    await setReference(refData);

    console.log('[sync] Тянем правила замечаний…');
    const remRes = await apiGet('getRemarks');
    const remData = (remRes && remRes.data) ? remRes.data : remRes;
    await setRemarks(remData);

    console.log('[sync] Тянем марки окон…');
    const markRes = await apiGet('getMarks');
    const markData = (markRes && markRes.data) ? markRes.data : markRes;
    await setMarks(markData);

    await setMeta('version', serverVersion);
    console.log('[sync] Готово. Справочник:', Object.keys(refData).length, 'квартир');
    return true;
  } catch (err) {
    console.warn('[sync] silentUpdateReference:', err.message);
    return false;
  }
}
window.db = {
  saveDraft, loadDraft, clearDraft, hasDraft,
  getMeta, setMeta,
  getReference, setReference,
  getRemarks, setRemarks,
  getMarks, setMarks,
  addVisit, getVisit, updateVisit, getAllVisits, getPendingVisits, deleteVisit,
  addPhoto, getPhoto, updatePhoto, getPhotosForVisit, deletePhoto,
  getQueueStats,
  uuid,
  silentUpdateReference,
  _openDB: openDB
};
