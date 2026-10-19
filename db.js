// ================= IndexedDB v3 =================

const DB_NAME = 'osmotr_db';
const DB_VERSION = 3; // Подняли с 2 до 3
const STORE_DRAFTS         = 'drafts';
const STORE_REFERENCE      = 'reference';
const STORE_REMARKS        = 'remarks';
const STORE_MARKS          = 'marks';
const STORE_META           = 'meta';
const STORE_VISITS         = 'visits';
const STORE_PHOTOS         = 'photos';
const STORE_OFFLINE_VISITS = 'offline_visits'; // Новое хранилище

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
      // Новое хранилище для скачанных осмотров
      if (!db.objectStoreNames.contains(STORE_OFFLINE_VISITS)) {
        const s = db.createObjectStore(STORE_OFFLINE_VISITS, { keyPath: 'clientId' });
        s.createIndex('kvNumber', 'kvNumber', { unique: false });
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

async function getSyncedVisits() {
  const all = await getAllVisits();
  return all.filter(v => v.status === 'synced');
}

// Скрытые записи (hidden: true) — не показываем в списке
async function getVisibleVisits() {
  const all = await getAllVisits();
  return all.filter(v => !v.hidden);
}

// Все осмотры по конкретному номеру квартиры (для предупреждения)
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

// Автосброс «зависших» осмотров в статусе syncing, старше N минут
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

async function getAllPhotos() {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_PHOTOS, 'readonly');
    const r = tx.objectStore(STORE_PHOTOS).getAll();
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
    pendingVisits: visits.filter(v => v.status !== 'synced' && !v.hidden).length,
    pendingPhotos: photos.filter(p => p.status !== 'uploaded').length,
    totalVisits: visits.length,
    syncedVisits: visits.filter(v => v.status === 'synced').length
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

    const noVersionYet =
      !serverVersion ||
      String(serverVersion.reference) === '0' ||
      String(serverVersion.reference) === '';

    const same =
      !noVersionYet &&
      localVersion &&
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
    const remRes = await apiGet('getRemarksFull');
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

// ================= ЭКСПОРТ =================
window.db = {
  saveDraft, loadDraft, clearDraft, hasDraft,
  getMeta, setMeta,
  getReference, setReference,
  getRemarks, setRemarks,
  getMarks, setMarks,
  addVisit, getVisit, updateVisit, getAllVisits, getPendingVisits, getSyncedVisits,
  getVisibleVisits, findVisitsByKv, hideVisit, unhideVisit, deleteVisit,
  resetStuckSyncing,
  saveOfflineVisit, getOfflineVisitsByKv, getAllOfflineVisits, // Экспорт новых функций
  addPhoto, getPhoto, updatePhoto, getPhotosForVisit, getAllPhotos, deletePhoto,
  getPhotoCountsForVisit,
  getQueueStats,
  uuid,
  getUserName, setUserName,
  silentUpdateReference,
  _openDB: openDB
};
