// ================= IndexedDB для хранения черновика =================
//
// Модуль хранит один черновик осмотра в браузере на телефоне.
// Данные не теряются при перезагрузке вкладки или вылета браузера.

const DB_NAME = 'osmotr_db';
const DB_VERSION = 1;
const STORE_NAME = 'drafts';
const DRAFT_KEY = 'current_draft';

// Открыть (или создать) базу данных
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(new Error('Не удалось открыть базу данных браузера'));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

// Сохранить черновик
async function saveDraft(data) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(data, DRAFT_KEY);

      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(new Error('Не удалось сохранить черновик'));
    });
  } catch (err) {
    console.warn('saveDraft:', err);
    return false;
  }
}

// Загрузить черновик
async function loadDraft() {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(DRAFT_KEY);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(new Error('Не удалось загрузить черновик'));
    });
  } catch (err) {
    console.warn('loadDraft:', err);
    return null;
  }
}

// Удалить черновик
async function clearDraft() {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(DRAFT_KEY);

      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(new Error('Не удалось удалить черновик'));
    });
  } catch (err) {
    console.warn('clearDraft:', err);
    return false;
  }
}

// Проверить, есть ли черновик
async function hasDraft() {
  const draft = await loadDraft();
  return !!draft;
}

// Экспорт в глобальную область
window.db = {
  saveDraft,
  loadDraft,
  clearDraft,
  hasDraft
};
