// ================= IndexedDB v2 =================
//
// Хранилища:
//   drafts    — текущий черновик осмотра (один)
//   reference — справочник квартир      (key: kv)
//   remarks   — правила замечаний       (key: type)
//   marks     — марки окон              (key: kv)
//   meta      — версии, даты синхронизации
//   visits    — очередь осмотров        (key: clientId)
//   photos    — очередь фото            (key: photoId, index по visitClientId)
//
// Всё асинхронное, errors не пробрасываются наружу — везде тихий console.warn,
// чтобы приложение не падало из-за IndexedDB.

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
      const oldVersion = event.oldVersion || 0;

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

// Универсальный helper: выполнить операцию над store
async function withStore(storeName, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    try {
      result = fn(store);
    } catch (err) {
      reject(err);
      return;
    }
    tx.oncomplete = () => resolve(result && result.__req ? result.__req.result : result);
    tx.onerror = () => reject(tx.error || new Error('Ошибка транзакции'));
    tx.onabort = () => reject(tx.error || new Error('Транзакция прервана'));
  });
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
// Храним весь справочник одним объектом под ключом 'all' — так быстрее читать.

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

// ================= VISITS (очередь осмотров) =================
// Формат записи:
// {
//   clientId: 'uuid',
//   createdAt: ISO,
//   status: 'pending' | 'syncing' | 'synced' | 'error',
//   attempts: 0,
//   lastError: '',
//   payload: { ...то, что отправляем в submitVisit... }
// }

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
    const updated = Object.assign({}, existing, patch);
    return await addVisit(updated);
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

// ================= PHOTOS (очередь фото) =================
// Формат записи:
// {
//   photoId: 'uuid',
//   visitClientId: 'uuid',
//   stateKey: 'koridor.steny' | '__extra__',
//   fileName: 'koridor_steny_1_...jpg',
//   kvNumber: '179',
//   blob: Blob,
//   status: 'pending' | 'uploading' | 'uploaded' | 'error',
//   attempts: 0,
//   lastError: '',
//   remote: null | { fileId, url, name }
// }

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
    const updated = Object.assign({}, existing, patch);
    return await addPhoto(updated);
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

// ================= СТАТИСТИКА ОЧЕРЕДИ =================

async function getQueueStats() {
  const [visits, allPhotos] = await Promise.all([
    getAllVisits(),
    (async () => {
      try {
        const db = await openDB();
        const tx = db.transaction(STORE_PHOTOS, 'readonly');
        const r = tx.objectStore(STORE_PHOTOS).getAll();
        return (await req(r)) || [];
      } catch (e) { return []; }
    })()
  ]);

  const pendingVisits = visits.filter(v => v.status !== 'synced').length;
  const pendingPhotos = allPhotos.filter(p => p.status !== 'uploaded').length;

  return {
    pendingVisits,
    pendingPhotos,
    totalVisits: visits.length
  };
}

// ================= UUID =================

function uuid() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// ================= ЭКСПОРТ =================

window.db = {
  // drafts
  saveDraft, loadDraft, clearDraft, hasDraft,
  // meta
  getMeta, setMeta,
  // справочники
  getReference, setReference,
  getRemarks, setRemarks,
  getMarks, setMarks,
  // visits
  addVisit, getVisit, updateVisit, getAllVisits, getPendingVisits, deleteVisit,
  // photos
  addPhoto, getPhoto, updatePhoto, getPhotosForVisit, deletePhoto,
  // утилиты
  getQueueStats,
  uuid,
  // низкоуровневый доступ (для отладки)
  _openDB: openDB
};
