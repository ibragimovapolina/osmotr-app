// ================= Движок синхронизации =================
//
// Следит за очередью осмотров и фото в IndexedDB.
// Запускает отправку при появлении сети, по таймеру и вручную.

const SYNC_INTERVAL_MS = 30 * 1000; // раз в 30 секунд проверяем очередь
const SYNC_RETRY_DELAYS = [5000, 15000, 60000, 300000]; // backoff между попытками

let _syncRunning = false;
let _syncTimer = null;

// ================= ПУБЛИЧНЫЙ API =================

async function syncNow() {
  if (_syncRunning) return { skipped: true };
  if (!navigator.onLine) return { skipped: true, reason: 'offline' };
  _syncRunning = true;
  const result = { sent: 0, failed: 0, errors: [] };
  try {
    const pending = await window.db.getPendingVisits();
    for (const visit of pending) {
      if (!navigator.onLine) break;
      try {
        await sendVisit(visit);
        result.sent++;
      } catch (err) {
        result.failed++;
        result.errors.push({ clientId: visit.clientId, error: err.message });
        await window.db.updateVisit(visit.clientId, {
          status: 'error',
          lastError: err.message,
          attempts: (visit.attempts || 0) + 1,
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

function startAutoSync() {
  stopAutoSync();
  window.addEventListener('online', onOnline);
  _syncTimer = setInterval(() => {
    if (navigator.onLine) syncNow().catch(() => {});
  }, SYNC_INTERVAL_MS);
  // Первый прогон через 3 сек после старта
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

// Уведомить UI, что очередь изменилась
function notifyUI() {
  if (typeof window.onQueueChanged === 'function') {
    try { window.onQueueChanged(); } catch (e) {}
  }
}

// ================= ОТПРАВКА ОДНОГО ОСМОТРА =================

async function sendVisit(visit) {
  await window.db.updateVisit(visit.clientId, { status: 'syncing' });
  const payload = Object.assign({}, visit.payload, { clientId: visit.clientId });

  const res = await apiGet('submitVisit', payload);
  const data = (res && res.data) ? res.data : res;

  await window.db.updateVisit(visit.clientId, {
    status: 'synced',
    syncedAt: new Date().toISOString(),
    serverRow: (data && data.row) || null
  });
  console.log('[sync] Осмотр отправлен:', visit.clientId, 'кв.', visit.payload.kvNumber);
  return data;
}

// ================= ЭКСПОРТ =================

window.sync = {
  syncNow,
  startAutoSync,
  stopAutoSync
};
