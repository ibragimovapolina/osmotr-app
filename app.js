// ================= НАСТРОЙКИ =================
const API_URL = 'https://verdant-nasturtium-c02297.netlify.app/api';

// ================= СОСТОЯНИЕ =================
const state = {
  user: { name: '' },
  screen: 'loading',
  form: {
    kvNumber: '',
    apartment: null,
    editedFields: {},
    divisions: [],
    currentDivisionIndex: 0,
    results: {},
    uploading: {},
    comments: '',
    extraPhotos: []
  },
  submitResult: null,
  pendingDraft: null,
  queueStats: { pendingVisits: 0, pendingPhotos: 0, totalVisits: 0, syncedVisits: 0 },
  queueList: [],
  draftId: null,
  nameMode: 'first',
  visitsFilter: 'all',       // 'all' | 'synced' | 'pending'
  visitsList: [],
  expandedVisitId: null,     // какой осмотр раскрыт в подробностях
  kvWarning: null            // предупреждение о повторном осмотре
};

// ================= СТАРТ =================
document.addEventListener('DOMContentLoaded', init);

async function init() {
  const savedName = await window.db.getUserName();
  state.user.name = savedName || '';

  if (!state.user.name) {
    state.nameMode = 'first';
    state.screen = 'name';
    render();
    return;
  }

  await continueStartup();
}

async function continueStartup() {
  if (window.db && window.db.resetStuckSyncing) {
    window.db.resetStuckSyncing(3).catch(() => {});
  }

  const draft = await checkDraftOnStart();
  state.pendingDraft = draft;
  state.screen = 'home';
  await refreshQueueStats();
  render();

  if (window.db && window.db.silentUpdateReference) {
    window.db.silentUpdateReference().catch(() => {});
  }

  if (window.sync && window.sync.startAutoSync) {
    window.sync.startAutoSync();
  }

  window.addEventListener('online', () => {
    if (['home', 'queue', 'visits'].includes(state.screen)) render();
  });
  window.addEventListener('offline', () => {
    if (['home', 'queue', 'visits'].includes(state.screen)) render();
  });
}

window.onQueueChanged = async function () {
  await refreshQueueStats();
  if (['home', 'queue', 'visits'].includes(state.screen)) render();
};

async function refreshQueueStats() {
  if (!window.db || !window.db.getQueueStats) return;
  try {
    state.queueStats = await window.db.getQueueStats();
  } catch (e) { /* ignore */ }
}

// ================= API =================
async function apiGet(action, payload) {
  const params = new URLSearchParams();
  params.set('action', action);
  params.set('payload', JSON.stringify(payload || {}));
  const url = API_URL + '?' + params.toString();

  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Accept': 'application/json' }
  });
  if (!response.ok) throw new Error('HTTP ' + response.status);

  const text = await response.text();
  return parseResponse(text);
}

function parseResponse(text) {
  let t = String(text || '').trim();
  const match = t.match(/^[a-zA-Z0-9_$]+\((.*)\);?\s*$/s);
  if (match) t = match[1];

  let result;
  try {
    result = JSON.parse(t);
  } catch (err) {
    throw new Error('Ответ не JSON: ' + t.substring(0, 100));
  }

  if (result && result.ok === false) {
    throw new Error(result.error || 'Неизвестная ошибка');
  }
  return result;
}

// ================= РЕНДЕРИНГ =================
function render() {
  const app = document.getElementById('app');
  if (state.screen === 'loading') { app.innerHTML = '<div class="loading">Загрузка...</div>'; return; }
  if (state.screen === 'error') {
    app.innerHTML = `
      <div class="error-box"><strong>Ошибка:</strong><br>${escapeHtml(state.errorMessage)}</div>
      <button class="btn btn-secondary" onclick="location.reload()">Перезагрузить</button>
    `;
    return;
  }
  if (state.screen === 'name')        return renderNameInput(app);
  if (state.screen === 'home')        return renderHome(app);
  if (state.screen === 'newVisitKv')  return renderNewVisitKv(app);
  if (state.screen === 'newVisitRef') return renderNewVisitRef(app);
  if (state.screen === 'division')    return renderDivision(app);
  if (state.screen === 'saved')       return renderSaved(app);
  if (state.screen === 'queue')       return renderQueue(app);
  if (state.screen === 'visits')      return renderVisits(app);
}

// ================= ЭКРАН ИМЕНИ =================
function renderNameInput(app) {
  const isFirst = state.nameMode === 'first';
  const currentName = state.user.name || '';

  app.innerHTML = `
    <div class="user-greeting">
      <div class="avatar">👤</div>
      <div class="email">${isFirst ? 'Добро пожаловать!' : 'Смена имени'}</div>
    </div>
    <div class="card">
      <div class="step-header">
        <h2>${isFirst ? 'Как вас зовут?' : 'Изменить имя'}</h2>
        <p>Имя будет записано в таблицу вместе с осмотром.</p>
      </div>
      <label class="field-label">Ваше имя</label>
      <input id="nameInput" class="field-input" type="text" autocomplete="off"
             placeholder="Например: Иванов И.И."
             value="${escapeHtml(currentName)}"
             oninput="onNameInput(this.value)">
      <button class="btn btn-primary btn-large" id="nameSaveBtn"
              onclick="onSaveName()" ${currentName.trim() ? '' : 'disabled'}>
        ${isFirst ? 'Сохранить и продолжить' : 'Сохранить'}
      </button>
      ${!isFirst ? `<button class="btn btn-secondary" onclick="cancelNameChange()">← Отмена</button>` : ''}
    </div>
  `;
  setTimeout(() => { const i = document.getElementById('nameInput'); if (i) i.focus(); }, 100);
}

function onNameInput(value) {
  const btn = document.getElementById('nameSaveBtn');
  if (btn) btn.disabled = !String(value || '').trim();
}

async function onSaveName() {
  const input = document.getElementById('nameInput');
  const name = String((input && input.value) || '').trim();
  if (!name) { alert('Пожалуйста, введите имя.'); return; }
  await window.db.setUserName(name);
  state.user.name = name;

  if (state.nameMode === 'change') {
    state.nameMode = 'first';
    state.screen = 'home';
    await refreshQueueStats();
    render();
  } else {
    await continueStartup();
  }
}

function cancelNameChange() {
  state.nameMode = 'first';
  state.screen = 'home';
  render();
}

function openNameChange() {
  state.nameMode = 'change';
  state.screen = 'name';
  render();
  window.scrollTo(0, 0);
}

// ================= ГЛАВНЫЙ ЭКРАН =================
function renderHome(app) {
  const hasDraft = !!state.pendingDraft;
  const draftInfo = hasDraft && state.pendingDraft.form
    ? `Квартира ${state.pendingDraft.form.kvNumber || '—'}` : '';

  const pending = state.queueStats.pendingVisits || 0;
  const online = navigator.onLine;

  app.innerHTML = `
    <div class="user-greeting">
      <div class="avatar">${escapeHtml((state.user.name || '?').charAt(0).toUpperCase())}</div>
      <div class="email">👤 ${escapeHtml(state.user.name || '—')}</div>
      <button class="btn btn-secondary" style="margin-top:12px;max-width:220px;margin-left:auto;margin-right:auto;" onclick="openNameChange()">⚙ Сменить имя</button>
    </div>

    <div class="card" style="padding:12px 16px;background:${online ? '#e6f4ea' : '#fce8e6'};border:1px solid ${online ? '#34a853' : '#ea4335'};">
      <div style="font-size:14px;color:${online ? '#137333' : '#c5221f'};">
        ${online ? '🟢 Онлайн' : '🔴 Офлайн — данные сохраняются локально'}
      </div>
    </div>

    ${hasDraft ? `
    <div class="card" style="background:#fff8e1;border:1px solid #f9ab00;">
      <h2 style="margin-bottom:8px;">📋 Незавершённый осмотр</h2>
      <p style="color:#b06000;font-size:14px;">У вас есть сохранённый черновик: ${escapeHtml(draftInfo)}.</p>
      <button class="btn btn-primary btn-large" style="margin-top:12px;" onclick="continueDraft()">▶ Продолжить черновик</button>
      <button class="btn btn-secondary" style="margin-top:8px;" onclick="discardDraft()">🗑 Удалить черновик</button>
    </div>` : ''}

    ${pending > 0 ? `
    <div class="card" style="background:#e8f0fe;border:1px solid #1a73e8;">
      <h2 style="margin-bottom:8px;">📤 Ожидают отправки: ${pending}</h2>
      <p style="color:#1a73e8;font-size:14px;">${online ? 'Идёт отправка…' : 'Появятся в сети — отправятся автоматически.'}</p>
      <button class="btn btn-primary" style="margin-top:12px;" onclick="showQueue()">📋 Открыть очередь</button>
      ${online ? `<button class="btn btn-secondary" style="margin-top:8px;" onclick="syncAllNow()">🔄 Отправить всё сейчас</button>` : ''}
    </div>` : ''}

    <div class="card">
      <button class="btn btn-primary btn-large" onclick="startNewVisit()">🏠 Новый осмотр</button>
      <button class="btn btn-secondary" onclick="showVisits()">📋 Мои осмотры</button>
      <button class="btn btn-secondary" onclick="showDiagnostics()">🔍 Диагностика</button>
    </div>
  `;
}

async function syncAllNow() {
  if (!window.sync) return;
  if (window.sync.resetAllAttempts) await window.sync.resetAllAttempts();
  await window.sync.syncNow();
  await refreshQueueStats();
  render();
}

async function showQueue() {
  if (!window.db || !window.db.getAllVisits) return;
  state.queueList = await window.db.getAllVisits();
  state.screen = 'queue';
  render();
  window.scrollTo(0, 0);
}

// ================= ЭКРАН «МОИ ОСМОТРЫ» =================
async function showVisits() {
  if (!window.db || !window.db.getVisibleVisits) return;
  state.visitsList = await window.db.getVisibleVisits();
  state.expandedVisitId = null;
  state.screen = 'visits';
  render();
  window.scrollTo(0, 0);
}

function setVisitsFilter(filter) {
  state.visitsFilter = filter;
  state.expandedVisitId = null;
  render();
}

function toggleVisitDetails(clientId) {
  state.expandedVisitId = (state.expandedVisitId === clientId) ? null : clientId;
  render();
}

async function hideVisitFromList(clientId) {
  if (!confirm('Скрыть этот осмотр из списка? Запись останется в базе, но не будет показываться.')) return;
  await window.db.hideVisit(clientId);
  state.visitsList = await window.db.getVisibleVisits();
  state.expandedVisitId = null;
  render();
}

function renderVisits(app) {
  const all = state.visitsList || [];

  // Применяем фильтр
  let filtered = all;
  if (state.visitsFilter === 'synced') filtered = all.filter(v => v.status === 'synced');
  else if (state.visitsFilter === 'pending') filtered = all.filter(v => v.status !== 'synced');

  // Сортировка: свежие сверху
  filtered = filtered.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  // Не больше 200
  const limited = filtered.slice(0, 200);

  const filterBtn = (key, label) => `
    <button class="filter-btn ${state.visitsFilter === key ? 'active' : ''}"
            onclick="setVisitsFilter('${key}')">${label}</button>
  `;

  const itemsHtml = limited.length
    ? limited.map(v => renderVisitCard(v)).join('')
    : '<div class="hint">Здесь пока ничего нет.</div>';

  app.innerHTML = `
    <div class="card">
      <div class="step-header">
        <h2>Мои осмотры</h2>
        <p>Всего: ${all.length}. Показано: ${limited.length}.</p>
      </div>

      <div class="visits-filter">
        ${filterBtn('all', 'Все')}
        ${filterBtn('synced', 'Отправленные')}
        ${filterBtn('pending', 'В очереди')}
      </div>

      ${itemsHtml}

      ${all.length > 0 ? `
        <button class="btn btn-primary btn-large" style="margin-top:16px;" onclick="exportVisitsCsv()">📥 Скачать CSV</button>
      ` : ''}
      <button class="btn btn-secondary" onclick="goHome()">← На главную</button>
    </div>
  `;
}

function renderVisitCard(v) {
  const kv = v.payload && v.payload.kvNumber ? v.payload.kvNumber : '—';
  const userName = (v.payload && v.payload.email) || '—';
  const created = v.createdAt ? new Date(v.createdAt) : null;
  const createdStr = created ? created.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

  let statusClass = 'pending';
  let statusText = '⏳ В очереди';
  if (v.status === 'synced') { statusClass = 'synced'; statusText = '✅ Отправлен'; }
  else if (v.status === 'error') { statusClass = 'error'; statusText = '❌ Ошибка'; }
  else if (v.status === 'syncing') { statusClass = 'pending'; statusText = '📤 Отправляется'; }

  const isExpanded = state.expandedVisitId === v.clientId;

  let detailsHtml = '';
  if (isExpanded) {
    const visitedAt = v.payload && v.payload.visitedAt ? new Date(v.payload.visitedAt) : null;
    const visitedStr = visitedAt ? visitedAt.toLocaleString('ru-RU') : '—';
    const comments = (v.payload && v.payload.comments) || '';
    const photosCount = v.payload && v.payload.results
      ? Object.keys(v.payload.results).reduce((sum, k) => sum + ((v.payload.results[k].photos || []).length), 0)
      : 0;
    const extraCount = (v.payload && v.payload.extraPhotos) ? v.payload.extraPhotos.length : 0;
    const totalPhotos = photosCount + extraCount;

    detailsHtml = `
      <div class="visit-card-details">
        <p><strong>Осмотрщик:</strong> ${escapeHtml(userName)}</p>
        <p><strong>Дата осмотра:</strong> ${escapeHtml(visitedStr)}</p>
        <p><strong>Фото:</strong> ${totalPhotos}</p>
        ${comments ? `<p><strong>Комментарии:</strong> ${escapeHtml(comments)}</p>` : ''}
        ${v.lastError ? `<p style="color:#c5221f;"><strong>Ошибка:</strong> ${escapeHtml(v.lastError)}</p>` : ''}
        <div class="visit-card-actions">
          <button class="btn btn-secondary" onclick="event.stopPropagation(); hideVisitFromList('${escapeAttr(v.clientId)}')">🚫 Скрыть из списка</button>
        </div>
      </div>
    `;
  }

  return `
    <div class="visit-card" onclick="toggleVisitDetails('${escapeAttr(v.clientId)}')">
      <div class="visit-card-title">
        <span class="visit-card-kv">Кв. ${escapeHtml(kv)}</span>
        <span class="visit-card-status ${statusClass}">${statusText}</span>
      </div>
      <div class="visit-card-sub">👤 ${escapeHtml(userName)} · ${escapeHtml(createdStr)}</div>
      ${detailsHtml}
    </div>
  `;
}

function exportVisitsCsv() {
  const rows = state.visitsList || [];
  if (!rows.length) { alert('Нет данных для экспорта.'); return; }

  const header = ['Квартира', 'Осмотрщик', 'Дата создания', 'Дата осмотра', 'Статус', 'Комментарии'];
  const lines = [header.map(csvEscape).join(';')];

  rows.forEach(v => {
    const kv = v.payload && v.payload.kvNumber ? v.payload.kvNumber : '';
    const userName = (v.payload && v.payload.email) || '';
    const created = v.createdAt ? new Date(v.createdAt).toLocaleString('ru-RU') : '';
    const visited = v.payload && v.payload.visitedAt ? new Date(v.payload.visitedAt).toLocaleString('ru-RU') : '';
    let status = 'в очереди';
    if (v.status === 'synced') status = 'отправлен';
    else if (v.status === 'error') status = 'ошибка';
    const comments = (v.payload && v.payload.comments) || '';

    lines.push([kv, userName, created, visited, status, comments].map(csvEscape).join(';'));
  });

  const csv = '\uFEFF' + lines.join('\r\n'); // BOM для Excel + CRLF
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = 'osmotry_' + new Date().toISOString().substring(0, 10) + '.csv';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 500);
}

function csvEscape(str) {
  const s = String(str === null || str === undefined ? '' : str);
  if (s.indexOf(';') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// ================= ОЧЕРЕДЬ =================
function renderQueue(app) {
  const visits = state.queueList || [];
  const pending = visits.filter(v => v.status !== 'synced');

  const itemsHtml = pending.length
    ? pending.map(v => {
        const kv = v.payload && v.payload.kvNumber ? v.payload.kvNumber : '—';
        const when = v.createdAt ? new Date(v.createdAt).toLocaleString('ru-RU') : '';
        const attempts = v.attempts || 0;

        let statusText = '';
        if (v.status === 'pending') statusText = '⏳ Ожидает отправки';
        else if (v.status === 'syncing') {
          if (v.progress && v.progress.stage === 'photos') {
            const cur = v.progress.current || 0;
            const tot = v.progress.total || 0;
            statusText = '📤 Отправка фото: ' + cur + ' из ' + tot;
          } else if (v.progress && v.progress.stage === 'submit') {
            statusText = '📤 Отправка данных осмотра…';
          } else {
            statusText = '📤 Отправляется…';
          }
        } else if (v.status === 'error') {
          statusText = '❌ Ошибка (попыток: ' + attempts + '): ' + (v.lastError || '—');
        } else {
          statusText = v.status;
        }

        return `
          <div class="object-card">
            <div class="object-title">Квартира ${escapeHtml(kv)}</div>
            <p style="font-size:14px;color:#5f6368;margin-bottom:8px;">${escapeHtml(when)}</p>
            <p style="font-size:14px;color:${v.status === 'error' ? '#c5221f' : '#5f6368'};">${escapeHtml(statusText)}</p>
            <button class="btn btn-secondary" style="margin-top:8px;" onclick="deleteQueuedVisit('${escapeAttr(v.clientId)}')">🗑 Удалить из очереди</button>
          </div>
        `;
      }).join('')
    : '<div class="hint">Очередь пуста.</div>';

  app.innerHTML = `
    <div class="card">
      <div class="step-header">
        <h2>Очередь отправки</h2>
        <p>Всего в очереди: ${pending.length}</p>
      </div>
      ${itemsHtml}
      ${pending.length ? `
        <button class="btn btn-primary btn-large" style="margin-top:16px;" onclick="resetAttemptsNow()">🔄 Сбросить попытки</button>
      ` : ''}
      ${pending.length && navigator.onLine ? `<button class="btn btn-primary btn-large" style="margin-top:8px;" onclick="syncAllNow()">📤 Отправить всё сейчас</button>` : ''}
      <button class="btn btn-secondary" onclick="goHome()">← На главную</button>
    </div>
  `;
}

async function resetAttemptsNow() {
  if (!window.sync || !window.sync.resetAllAttempts) return;
  await window.sync.resetAllAttempts();
  await refreshQueueStats();
  state.queueList = await window.db.getAllVisits();
  render();
  alert('Попытки сброшены. Можете нажать «Отправить всё сейчас».');
}

async function deleteQueuedVisit(clientId) {
  if (!confirm('Удалить осмотр из очереди? Данные и фото не будут отправлены.')) return;

  try {
    const photos = await window.db.getPhotosForVisit(clientId);
    for (const p of photos) {
      await window.db.deletePhoto(p.photoId);
    }
  } catch (e) { console.warn('Не удалось удалить фото:', e); }

  if (window.db && window.db.deleteVisit) {
    await window.db.deleteVisit(clientId);
  }
  await refreshQueueStats();
  state.queueList = await window.db.getAllVisits();
  render();
}

// ================= ДИАГНОСТИКА =================
async function showDiagnostics() {
  try {
    const db = await window.db._openDB();
    const stores = Array.from(db.objectStoreNames);
    const stats = await window.db.getQueueStats();

    let ref = null, remarks = null, marks = null, version = null;
    try { ref = await window.db.getReference(); } catch(e) {}
    try { remarks = await window.db.getRemarks(); } catch(e) {}
    try { marks = await window.db.getMarks(); } catch(e) {}
    try { version = await window.db.getMeta('version'); } catch(e) {}

    const refCount = ref ? Object.keys(ref).length : 0;
    const remCount = remarks ? Object.keys(remarks).length : 0;
    const marksCount = marks ? Object.keys(marks).length : 0;

    alert(
      '🔍 Диагностика IndexedDB\n\n' +
      'Пользователь: ' + (state.user.name || '—') + '\n\n' +
      'Хранилища (' + stores.length + '):\n' + stores.join(', ') + '\n\n' +
      'Справочник: ' + refCount + ' квартир\n' +
      'Замечания: ' + remCount + ' типов\n' +
      'Марки окон: ' + marksCount + '\n' +
      'Версия данных: ' + (version ? JSON.stringify(version) : '—') + '\n\n' +
      'Очередь осмотров: ' + stats.pendingVisits + '\n' +
      'Очередь фото: ' + stats.pendingPhotos + '\n' +
      'Всего осмотров: ' + stats.totalVisits + ' (синхр.: ' + stats.syncedVisits + ')\n\n' +
      'Сеть: ' + (navigator.onLine ? 'онлайн' : 'офлайн')
    );
  } catch (err) {
    alert('Ошибка диагностики: ' + err.message);
  }
}

async function continueDraft() {
  if (!state.pendingDraft) return;
  restoreDraft(state.pendingDraft);
  state.pendingDraft = null;
  render();
  window.scrollTo(0, 0);
}

async function discardDraft() {
  if (!confirm('Удалить черновик?')) return;
  if (state.draftId) {
    try {
      const photos = await window.db.getPhotosForVisit(state.draftId);
      for (const p of photos) await window.db.deletePhoto(p.photoId);
    } catch (e) {}
  }
  if (window.db && window.db.clearDraft) await window.db.clearDraft();
  state.pendingDraft = null;
  state.draftId = null;
  render();
}

// ================= ШАГ 1 =================
function startNewVisit() {
  state.form = {
    kvNumber: '', apartment: null, editedFields: {},
    divisions: [], currentDivisionIndex: 0, results: {}, uploading: {},
    comments: '', extraPhotos: []
  };
  state.submitResult = null;
  state.pendingDraft = null;
  state.kvWarning = null;
  state.draftId = window.db.uuid();
  state.screen = 'newVisitKv';
  if (window.db && window.db.clearDraft) window.db.clearDraft().catch(() => {});
  render();
}

function renderNewVisitKv(app) {
  const warning = state.kvWarning;
  const warningHtml = warning ? `
    <div class="kv-warning">
      ${warning.type === 'synced'
        ? `<strong>⚠ Квартира уже осматривалась.</strong><br>Дата: ${escapeHtml(warning.date)}<br>Осмотрщик: ${escapeHtml(warning.userName)}<br><br>Вы можете осмотреть её ещё раз — ничего не блокируется.`
        : `<strong>⏳ Квартира уже в очереди на отправку.</strong><br>Дата: ${escapeHtml(warning.date)}<br>Осмотрщик: ${escapeHtml(warning.userName)}<br><br>Если это повторный осмотр — можно продолжить.`}
    </div>
  ` : '';

  app.innerHTML = `
    <div class="card">
      <div class="step-header">
        <div class="step-progress">Шаг 1</div>
        <h2>Номер квартиры</h2>
        <p>Введите номер по тех.паспорту — данные подтянутся из справочника.</p>
      </div>
      <label class="field-label">Номер квартиры</label>
      <input id="kvInput" class="field-input" type="text" inputmode="numeric" autocomplete="off"
             placeholder="Например: 42" value="${escapeHtml(state.form.kvNumber)}"
             oninput="onKvInput(this.value)">
      <div id="kvResult"></div>
      ${warningHtml}
      <button class="btn btn-primary btn-large" id="kvNextBtn" onclick="onKvNext()" disabled>Далее →</button>
      <button class="btn btn-secondary" onclick="goHome()">← Отмена</button>
    </div>
  `;
  setTimeout(() => { const i = document.getElementById('kvInput'); if (i) i.focus(); }, 100);
}

let _kvCheckTimeout = null;

function onKvInput(value) {
  state.form.kvNumber = value;
  state.kvWarning = null;
  const btn = document.getElementById('kvNextBtn');
  const result = document.getElementById('kvResult');
  if (btn) btn.disabled = true;
  if (result) result.innerHTML = '<div class="hint">Проверяем…</div>';

  if (_kvCheckTimeout) clearTimeout(_kvCheckTimeout);
  _kvCheckTimeout = setTimeout(async () => {
    const kv = String(value || '').trim();
    if (!kv) { if (result) result.innerHTML = ''; return; }
    try {
      const res = await checkApartmentSmart(kv);
      const data = res;

      if (data && data.found) {
        state.form.apartment = data.data;

        // Ищем предыдущие осмотры этой квартиры
        let previous = [];
        try {
          previous = await window.db.findVisitsByKv(kv);
        } catch (e) { /* ignore */ }

        if (previous.length > 0) {
          const latest = previous[0];
          const dt = latest.createdAt ? new Date(latest.createdAt).toLocaleString('ru-RU') : '—';
          const userName = (latest.payload && latest.payload.email) || '—';
          const type = latest.status === 'synced' ? 'synced' : 'pending';
          state.kvWarning = { type, date: dt, userName };
        } else {
          state.kvWarning = null;
        }

        render();
      } else {
        state.form.apartment = null;
        state.kvWarning = null;
        if (result) result.innerHTML = `<div class="apartment-not-found">⚠ Квартира "${escapeHtml(kv)}" не найдена в справочнике.</div>`;
      }
    } catch (err) {
      if (result) result.innerHTML = `<div class="error-box">${escapeHtml(err.message)}</div>`;
    }
  }, 400);
}

// Рендер результата проверки квартиры (без полной перерисовки)
function renderKvResult() {
  const result = document.getElementById('kvResult');
  const btn = document.getElementById('kvNextBtn');
  if (!result) return;

  const apt = state.form.apartment;
  if (!apt) { result.innerHTML = ''; if (btn) btn.disabled = true; return; }

  result.innerHTML = `
    <div class="apartment-preview">
      <div class="apartment-preview-title">✓ Найдено в справочнике</div>
      <div class="apartment-preview-grid">
        <div><span>Площадь:</span> ${escapeHtml(apt.area || '—')}</div>
        <div><span>Этаж:</span> ${escapeHtml(apt.floor || '—')}</div>
        <div><span>Комнат:</span> ${escapeHtml(apt.roomsNum || '—')}</div>
        <div><span>Санузлов:</span> ${escapeHtml(apt.bathrooms || '—')}</div>
      </div>
    </div>
  `;
  if (btn) btn.disabled = false;
}

async function checkApartmentSmart(kv) {
  const kvKey = String(kv).trim().toLowerCase();
  try {
    const res = await apiGet('checkApartment', { kvNumber: kv });
    return res.data || res;
  } catch (netErr) {
    const ref = await window.db.getReference();
    if (ref && ref[kvKey]) {
      return { found: true, kv: kv, data: ref[kvKey], fromCache: true };
    }
    throw netErr;
  }
}

function onKvNext() {
  if (!state.form.apartment) return;
  state.screen = 'newVisitRef';
  render();
  autoSave();
}

// ================= ШАГ 2 =================
function renderNewVisitRef(app) {
  const apt = state.form.apartment || {};
  const edited = state.form.editedFields || {};
  const val = (field, fallback) => edited[field] !== undefined ? edited[field] : (fallback || '');

  const roomsNumRaw = edited.roomsNum !== undefined ? edited.roomsNum : (apt.roomsNum || '');
  const roomsNum = parseInt(String(roomsNumRaw).replace(/\D/g, ''), 10) || 0;
  const showWinR2 = roomsNum >= 2;
  const showWinR3 = roomsNum >= 3;

  app.innerHTML = `
    <div class="card">
      <div class="step-header">
        <div class="step-progress">Шаг 2</div>
        <h2>Справочные данные</h2>
        <p>Проверьте данные из справочника. Если что-то не так — исправьте.</p>
      </div>

      <div class="field-group"><label class="field-label">Площадь, кв.м</label>
        <input class="field-input" type="text" inputmode="decimal" value="${escapeHtml(val('area', apt.area))}" oninput="onRefEdit('area', this.value)"></div>

      <div class="field-group"><label class="field-label">Этаж</label>
        <input class="field-input" type="text" inputmode="numeric" value="${escapeHtml(val('floor', apt.floor))}" oninput="onRefEdit('floor', this.value)"></div>

      <div class="field-group"><label class="field-label">Комнатность</label>
        <input class="field-input" type="text" value="${escapeHtml(val('rooms', apt.rooms))}" oninput="onRefEdit('rooms', this.value)"></div>

      <div class="field-group"><label class="field-label">Комнат (число)</label>
        <input class="field-input" id="roomsNumInput" type="text" inputmode="numeric" value="${escapeHtml(val('roomsNum', apt.roomsNum))}" oninput="onRefEditRoomsNum(this.value)"></div>

      <div class="field-group"><label class="field-label">Санузлов</label>
        <input class="field-input" type="text" inputmode="numeric" value="${escapeHtml(val('bathrooms', apt.bathrooms))}" oninput="onRefEdit('bathrooms', this.value)"></div>

      <div class="field-group"><label class="field-label">Прачечная</label>
        <input class="field-input" type="text" value="${escapeHtml(val('laundry', apt.laundry))}" oninput="onRefEdit('laundry', this.value)"></div>

      <div class="field-group"><label class="field-label">Гардеробная</label>
        <input class="field-input" type="text" value="${escapeHtml(val('wardrobe', apt.wardrobe))}" oninput="onRefEdit('wardrobe', this.value)"></div>

      <div class="field-group"><label class="field-label">Окон в ЖК №1</label>
        <input class="field-input" type="text" inputmode="numeric" value="${escapeHtml(val('winR1', apt.winR1))}" oninput="onRefEdit('winR1', this.value)"></div>

      ${showWinR2 ? `
      <div class="field-group"><label class="field-label">Окон в ЖК №2</label>
        <input class="field-input" type="text" inputmode="numeric" value="${escapeHtml(val('winR2', apt.winR2))}" oninput="onRefEdit('winR2', this.value)"></div>` : ''}

      ${showWinR3 ? `
      <div class="field-group"><label class="field-label">Окон в ЖК №3</label>
        <input class="field-input" type="text" inputmode="numeric" value="${escapeHtml(val('winR3', apt.winR3))}" oninput="onRefEdit('winR3', this.value)"></div>` : ''}

      <div class="field-group"><label class="field-label">Окон на кухне</label>
        <input class="field-input" type="text" inputmode="numeric" value="${escapeHtml(val('winK', apt.winK))}" oninput="onRefEdit('winK', this.value)"></div>

      <button class="btn btn-primary btn-large" onclick="onRefNext()">Далее →</button>
      <button class="btn btn-secondary" onclick="backToKv()">← Назад</button>
    </div>
  `;
}

function onRefEdit(field, value) {
  state.form.editedFields[field] = value;
  debouncedAutoSave();
}

function onRefEditRoomsNum(value) {
  state.form.editedFields.roomsNum = value;
  const app = document.getElementById('app');
  renderNewVisitRef(app);
  debouncedAutoSave();
  setTimeout(() => {
    const input = document.getElementById('roomsNumInput');
    if (input) { input.focus(); const len = input.value.length; try { input.setSelectionRange(len, len); } catch (e) {} }
  }, 0);
}

async function onRefNext() {
  const apt = state.form.apartment || {};
  const edited = state.form.editedFields || {};
  state.form.apartment = Object.assign({}, apt, edited);

  try {
    const data = await getFormDataSmart(state.form.apartment);
    state.form.divisions = data.divisions || [];
    state.form.currentDivisionIndex = 0;
    state.screen = 'division';
    render();
    window.scrollTo(0, 0);
    autoSave();
  } catch (err) {
    alert('Ошибка загрузки разделов: ' + err.message);
  }
}

async function getFormDataSmart(apartment) {
  try {
    const res = await apiGet('getFormData', { apartment: apartment });
    return res.data || res;
  } catch (netErr) {
    console.warn('[form] Сеть недоступна, собираем форму локально:', netErr.message);
    const remarks = await window.db.getRemarks();
    if (remarks && window.localForm && window.localForm.buildFormData) {
      return window.localForm.buildFormData(apartment, remarks);
    }
    throw new Error('Нет сети и нет локального кэша. Откройте приложение один раз онлайн.');
  }
}

function backToKv() { state.screen = 'newVisitKv'; render(); }
function goHome() { state.screen = 'home'; refreshQueueStats().then(render); }

// ================= РАЗДЕЛ =================
function renderDivision(app) {
  const divs = state.form.divisions || [];
  const idx = state.form.currentDivisionIndex;
  const div = divs[idx];

  if (!div) { app.innerHTML = `<div class="error-box">Раздел не найден.</div>`; return; }

  const totalDivisions = divs.length;
  const progressText = `Шаг ${idx + 3} из ${totalDivisions + 2}`;
  const isLast = (idx + 1 === totalDivisions);

  if (div.key === 'dopolnitelno') return renderExtraInfo(app, div, progressText, isLast);

  const objectsHtml = div.objects.map(obj => renderObjectCard(div.key, obj)).join('');

  app.innerHTML = `
    <div class="card">
      <div class="step-header">
        <div class="step-progress">${progressText}</div>
        <h2>${escapeHtml(div.title)}</h2>
        <p>Отметьте замечания по каждому объекту.</p>
      </div>
      <div class="objects-list" id="objectsList">
        ${objectsHtml || '<div class="hint">В этом разделе нет объектов.</div>'}
      </div>
      <button class="btn btn-primary btn-large" onclick="onDivisionNext()">
        ${isLast ? '✓ Завершить и отправить' : 'Далее →'}
      </button>
      <button class="btn btn-secondary" onclick="onDivisionBack()">← Назад</button>
    </div>
  `;
}

function renderObjectCard(divKey, obj) {
  const stateKey = divKey + '.' + obj.key;
  const objState = state.form.results[stateKey] || { selected: [], custom: '', noIssues: false, photos: [] };

  const variantsHtml = (obj.variants || []).map((v) => {
    const isSelected = objState.selected.includes(v.variant);
    return `<button type="button" class="chip ${isSelected ? 'chip-selected' : ''}"
              onclick="toggleVariant('${escapeAttr(stateKey)}', '${escapeAttr(v.variant)}')">${escapeHtml(v.variant)}</button>`;
  }).join('');

  const noIssuesHtml = `<button type="button"
    class="chip chip-no-issues ${objState.noIssues ? 'chip-selected' : ''}"
    onclick="toggleNoIssues('${escapeAttr(stateKey)}')">Замечаний нет</button>`;

  const customHtml = `<textarea class="custom-input" rows="2" placeholder="Своё замечание (если нужно)"
    oninput="onCustomInput('${escapeAttr(stateKey)}', this.value)">${escapeHtml(objState.custom || '')}</textarea>`;

  const photoBlockHtml = renderPhotoBlock(stateKey, objState);
  const error = objState.error ? `<div class="obj-error">${escapeHtml(objState.error)}</div>` : '';

  return `
    <div class="object-card" data-state-key="${escapeAttr(stateKey)}">
      <div class="object-title">${escapeHtml(obj.label)}</div>
      <div class="chips-row">${noIssuesHtml}${variantsHtml}</div>
      ${customHtml}
      ${photoBlockHtml}
      ${error}
    </div>
  `;
}

function renderPhotoBlock(stateKey, objState) {
  const photos = objState.photos || [];
  const uploading = state.form.uploading[stateKey];

  let photoItemsHtml = photos.map((p, i) => `
    <div class="photo-item">
      <img src="${escapeAttr(p.url || p.localUrl || '')}" alt="Фото ${i + 1}" class="photo-thumb">
      <button type="button" class="photo-remove" onclick="removePhoto('${escapeAttr(stateKey)}', ${i})">×</button>
    </div>
  `).join('');

  let uploadingHtml = '';
  if (uploading) {
    uploadingHtml = `
      <div class="photo-item photo-uploading">
        <div class="photo-spinner"></div>
        <div class="photo-uploading-text">${uploading.current} из ${uploading.total}</div>
      </div>
    `;
  }

  return `
    <div class="photo-block">
      <div class="photo-list">${photoItemsHtml}${uploadingHtml}</div>
      <label class="photo-add-label">
        <input type="file" accept="image/*" multiple style="display:none"
               onchange="onPhotoSelected(event, '${escapeAttr(stateKey)}')">
        <span class="photo-add-btn">📷 Добавить фото</span>
      </label>
    </div>
  `;
}

function toggleVariant(stateKey, variant) {
  const rs = state.form.results[stateKey] || { selected: [], custom: '', noIssues: false, photos: [] };
  rs.noIssues = false;
  const i = rs.selected.indexOf(variant);
  if (i >= 0) rs.selected.splice(i, 1); else rs.selected.push(variant);
  rs.error = null;
  state.form.results[stateKey] = rs;
  updateObjectCard(stateKey);
  autoSave();
}

function toggleNoIssues(stateKey) {
  const rs = state.form.results[stateKey] || { selected: [], custom: '', noIssues: false, photos: [] };
  rs.noIssues = !rs.noIssues;
  if (rs.noIssues) rs.selected = [];
  rs.error = null;
  state.form.results[stateKey] = rs;
  updateObjectCard(stateKey);
  autoSave();
}

function onCustomInput(stateKey, value) {
  const rs = state.form.results[stateKey] || { selected: [], custom: '', noIssues: false, photos: [] };
  rs.custom = value;
  rs.error = null;
  state.form.results[stateKey] = rs;
  debouncedAutoSave();
}

// ================= ФОТО =================
async function onPhotoSelected(event, stateKey) {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;
  event.target.value = '';

  const rs = state.form.results[stateKey] || { selected: [], custom: '', noIssues: false, photos: [] };
  if (!rs.photos) rs.photos = [];
  state.form.results[stateKey] = rs;

  state.form.uploading[stateKey] = { current: 0, total: files.length };
  updateObjectCard(stateKey);

  const kv = state.form.kvNumber;
  const divisionKey = stateKey.split('.')[0];
  const objectKey = stateKey.split('.')[1];
  const draftId = state.draftId || (state.draftId = window.db.uuid());

  for (let i = 0; i < files.length; i++) {
    state.form.uploading[stateKey] = { current: i + 1, total: files.length };
    updateObjectCard(stateKey);

    try {
      const file = files[i];
      const blob = await compressImageToBlob(file);
      const fileName = buildFileName(divisionKey, objectKey, i + 1 + rs.photos.length);
      const photoId = window.db.uuid();
      const localUrl = URL.createObjectURL(blob);

      await window.db.addPhoto({
        photoId: photoId,
        visitClientId: draftId,
        stateKey: stateKey,
        fileName: fileName,
        kvNumber: kv,
        blob: blob,
        status: 'pending',
        attempts: 0,
        lastError: '',
        remote: null,
        localUrl: localUrl
      });

      rs.photos.push({
        photoId: photoId,
        localUrl: localUrl,
        name: fileName,
        objectKey: objectKey,
        divisionKey: divisionKey
      });
      state.form.results[stateKey] = rs;
      updateObjectCard(stateKey);
      autoSave();
    } catch (err) {
      console.error('Ошибка сохранения фото:', err);
      alert('Не удалось сохранить фото: ' + (err.message || err));
    }
  }

  delete state.form.uploading[stateKey];
  updateObjectCard(stateKey);
}

function removePhoto(stateKey, index) {
  const rs = state.form.results[stateKey];
  if (!rs || !rs.photos) return;
  if (!confirm('Удалить это фото?')) return;
  const photo = rs.photos[index];
  if (photo && photo.photoId && window.db && window.db.deletePhoto) {
    window.db.deletePhoto(photo.photoId).catch(() => {});
  }
  rs.photos.splice(index, 1);
  state.form.results[stateKey] = rs;
  updateObjectCard(stateKey);
  autoSave();
}

function compressImageToBlob(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const MAX_WIDTH = 700;
        const MAX_HEIGHT = 700;
        let w = img.width, h = img.height;
        if (w > MAX_WIDTH || h > MAX_HEIGHT) {
          const ratio = Math.min(MAX_WIDTH / w, MAX_HEIGHT / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(
          (blob) => {
            if (!blob) reject(new Error('Не удалось сжать изображение'));
            else resolve(blob);
          },
          'image/jpeg',
          0.6
        );
      };
      img.onerror = () => reject(new Error('Не удалось прочитать изображение'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.readAsDataURL(file);
  });
}

function buildFileName(divisionKey, objectKey, num) {
  const ts = Date.now();
  const safeName = (divisionKey + '_' + objectKey + '_' + num + '_' + ts).replace(/[^a-zA-Z0-9_\-\.]/g, '_');
  return safeName + '.jpg';
}

function updateObjectCard(stateKey) {
  const div = state.form.divisions[state.form.currentDivisionIndex];
  if (!div) return;
  const obj = div.objects.find(o => (div.key + '.' + o.key) === stateKey);
  if (!obj) return;

  const cardEl = document.querySelector(`[data-state-key="${cssEscape(stateKey)}"]`);
  if (!cardEl) return;

  const newHtml = renderObjectCard(div.key, obj);
  const temp = document.createElement('div');
  temp.innerHTML = newHtml;
  const newCard = temp.firstElementChild;
  cardEl.replaceWith(newCard);
}

// ================= ДОП. ИНФОРМАЦИЯ =================
function renderExtraInfo(app, div, progressText, isLast) {
  const comments = state.form.comments || '';
  const extraPhotos = state.form.extraPhotos || [];
  const uploading = state.form.uploading['__extra__'];

  let photoItemsHtml = extraPhotos.map((p, i) => `
    <div class="photo-item">
      <img src="${escapeAttr(p.url || p.localUrl || '')}" alt="Фото ${i + 1}" class="photo-thumb">
      <button type="button" class="photo-remove" onclick="removeExtraPhoto(${i})">×</button>
    </div>
  `).join('');

  let uploadingHtml = '';
  if (uploading) {
    uploadingHtml = `
      <div class="photo-item photo-uploading">
        <div class="photo-spinner"></div>
        <div class="photo-uploading-text">${uploading.current} из ${uploading.total}</div>
      </div>
    `;
  }

  app.innerHTML = `
    <div class="card">
      <div class="step-header">
        <div class="step-progress">${progressText}</div>
        <h2>${escapeHtml(div.title)}</h2>
        <p>Общий комментарий и дополнительные фото.</p>
      </div>
      <div class="field-group">
        <label class="field-label">Комментарий</label>
        <textarea class="custom-input" rows="4" placeholder="Если есть что добавить..."
          oninput="onCommentsInput(this.value)">${escapeHtml(comments)}</textarea>
      </div>
      <div class="field-group">
        <label class="field-label">Дополнительные фото</label>
        <div class="photo-block">
          <div class="photo-list">${photoItemsHtml}${uploadingHtml}</div>
          <label class="photo-add-label">
            <input type="file" accept="image/*" multiple style="display:none"
                   onchange="onExtraPhotoSelected(event)">
            <span class="photo-add-btn">📷 Добавить фото</span>
          </label>
        </div>
      </div>
      <button class="btn btn-primary btn-large" onclick="onDivisionNext()">
        ${isLast ? '✓ Завершить и отправить' : 'Далее →'}
      </button>
      <button class="btn btn-secondary" onclick="onDivisionBack()">← Назад</button>
    </div>
  `;
}

function onCommentsInput(value) {
  state.form.comments = value;
  debouncedAutoSave();
}

async function onExtraPhotoSelected(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;
  event.target.value = '';

  if (!state.form.extraPhotos) state.form.extraPhotos = [];
  state.form.uploading['__extra__'] = { current: 0, total: files.length };
  render();

  const kv = state.form.kvNumber;
  const draftId = state.draftId || (state.draftId = window.db.uuid());

  for (let i = 0; i < files.length; i++) {
    state.form.uploading['__extra__'] = { current: i + 1, total: files.length };
    render();
    try {
      const file = files[i];
      const blob = await compressImageToBlob(file);
      const fileName = buildFileName('extra', 'photo', i + 1 + state.form.extraPhotos.length);
      const photoId = window.db.uuid();
      const localUrl = URL.createObjectURL(blob);

      await window.db.addPhoto({
        photoId: photoId,
        visitClientId: draftId,
        stateKey: '__extra__',
        fileName: fileName,
        kvNumber: kv,
        blob: blob,
        status: 'pending',
        attempts: 0,
        lastError: '',
        remote: null,
        localUrl: localUrl
      });

      state.form.extraPhotos.push({
        photoId: photoId,
        localUrl: localUrl,
        name: fileName
      });
      render();
      autoSave();
    } catch (err) {
      console.error('Ошибка сохранения доп. фото:', err);
      alert('Не удалось сохранить фото: ' + (err.message || err));
    }
  }
  delete state.form.uploading['__extra__'];
  render();
}

function removeExtraPhoto(index) {
  if (!state.form.extraPhotos) return;
  if (!confirm('Удалить это фото?')) return;
  const photo = state.form.extraPhotos[index];
  if (photo && photo.photoId && window.db && window.db.deletePhoto) {
    window.db.deletePhoto(photo.photoId).catch(() => {});
  }
  state.form.extraPhotos.splice(index, 1);
  render();
  autoSave();
}

// ================= НАВИГАЦИЯ =================
async function onDivisionNext() {
  const div = state.form.divisions[state.form.currentDivisionIndex];
  if (!div) return;

  if (div.key === 'dopolnitelno') {
    if (state.form.currentDivisionIndex + 1 < state.form.divisions.length) {
      state.form.currentDivisionIndex++;
      render();
      window.scrollTo(0, 0);
      autoSave();
      return;
    }
    await submitVisit();
    return;
  }

  let hasError = false;
  let firstErrorKey = null;

  div.objects.forEach(obj => {
    const stateKey = div.key + '.' + obj.key;
    const rs = state.form.results[stateKey] || { selected: [], custom: '', noIssues: false, photos: [] };
    const hasSelection = rs.selected.length > 0;
    const hasCustom = String(rs.custom || '').trim().length > 0;
    const hasNoIssues = rs.noIssues === true;
    const hasPhotos = (rs.photos || []).length > 0;

    if (!hasSelection && !hasCustom && !hasNoIssues) {
      rs.error = 'Отметьте замечание, «Замечаний нет» или впишите своё';
      state.form.results[stateKey] = rs;
      hasError = true;
      if (!firstErrorKey) firstErrorKey = stateKey;
      return;
    }

    const hasActualIssues = hasSelection || hasCustom;
    if (hasActualIssues && !hasPhotos) {
      rs.error = 'Приложите хотя бы одно фото';
      state.form.results[stateKey] = rs;
      hasError = true;
      if (!firstErrorKey) firstErrorKey = stateKey;
    }
  });

  if (hasError) {
    render();
    setTimeout(() => {
      let target = null;
      if (firstErrorKey) target = document.querySelector(`[data-state-key="${cssEscape(firstErrorKey)}"]`);
      if (!target) target = document.querySelector('.obj-error');
      if (target) {
        const y = target.getBoundingClientRect().top + window.pageYOffset - 80;
        window.scrollTo({ top: y, behavior: 'smooth' });
      } else window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 50);
    return;
  }

  if (state.form.currentDivisionIndex + 1 < state.form.divisions.length) {
    state.form.currentDivisionIndex++;
    render();
    window.scrollTo(0, 0);
    autoSave();
    return;
  }

  await submitVisit();
}

function onDivisionBack() {
  if (state.form.currentDivisionIndex > 0) {
    state.form.currentDivisionIndex--;
    render();
    window.scrollTo(0, 0);
  } else {
    state.screen = 'newVisitRef';
    render();
  }
}

// ================= ОТПРАВКА =================
async function submitVisit() {
  const app = document.getElementById('app');
  app.innerHTML = '<div class="loading">Сохранение…</div>';

  try {
    const clientId = state.draftId || window.db.uuid();

    const cleanResults = {};
    Object.keys(state.form.results).forEach(key => {
      const rs = state.form.results[key];
      cleanResults[key] = {
        selected: rs.selected || [],
        custom: rs.custom || '',
        noIssues: rs.noIssues || false,
        photos: (rs.photos || []).map(p => ({
          photoId: p.photoId,
          name: p.name
        }))
      };
    });

    const payload = {
      email: state.user.name || 'осмотрщик',
      kvNumber: state.form.kvNumber,
      results: cleanResults,
      extraPhotos: (state.form.extraPhotos || []).map(p => ({
        photoId: p.photoId,
        name: p.name
      })),
      comments: state.form.comments || '',
      visitedAt: new Date().toISOString()
    };

    await window.db.addVisit({
      clientId: clientId,
      createdAt: new Date().toISOString(),
      status: 'pending',
      attempts: 0,
      lastError: '',
      hidden: false,
      payload: payload
    });

    if (window.db && window.db.clearDraft) await window.db.clearDraft();

    await refreshQueueStats();

    if (navigator.onLine && window.sync && window.sync.syncNow) {
      window.sync.syncNow().catch(() => {});
    }

    state.screen = 'saved';
    state.submitResult = { clientId: clientId };
    state.draftId = null;
    render();
    window.scrollTo(0, 0);
  } catch (err) {
    app.innerHTML = `
      <div class="error-box"><strong>Ошибка сохранения:</strong><br>${escapeHtml(err.message)}</div>
      <button class="btn btn-secondary" onclick="submitVisit()">Попробовать снова</button>
    `;
  }
}

function renderSaved(app) {
  const online = navigator.onLine;
  const pending = state.queueStats.pendingVisits || 0;

  app.innerHTML = `
    <div class="card" style="text-align:center;">
      <div class="done-icon">✅</div>
      <h2>Осмотр сохранён</h2>
      <p style="margin-top:12px;">
        ${online
          ? 'Отправляется в таблицу…'
          : 'Отправится при появлении сети.'}
      </p>
      ${pending > 0 ? `<p style="margin-top:8px;color:#5f6368;font-size:14px;">Сейчас в очереди: ${pending}</p>` : ''}
      <button class="btn btn-primary btn-large" style="margin-top:24px;" onclick="startNewVisit()">🏠 Оформить ещё один осмотр</button>
      <button class="btn btn-secondary btn-large" onclick="goHome()">← На главную</button>
    </div>
  `;
}

// ================= АВТОСОХРАНЕНИЕ =================
let _autoSaveTimeout = null;

function autoSave() {
  if (!window.db || !window.db.saveDraft) return;
  const draft = {
    form: {
      kvNumber: state.form.kvNumber,
      apartment: state.form.apartment,
      editedFields: state.form.editedFields,
      divisions: state.form.divisions,
      currentDivisionIndex: state.form.currentDivisionIndex,
      results: state.form.results,
      comments: state.form.comments,
      extraPhotos: state.form.extraPhotos
    },
    screen: state.screen,
    savedAt: new Date().toISOString(),
    draftId: state.draftId
  };
  window.db.saveDraft(draft).catch(err => console.warn('saveDraft:', err));
}

function debouncedAutoSave() {
  if (_autoSaveTimeout) clearTimeout(_autoSaveTimeout);
  _autoSaveTimeout = setTimeout(autoSave, 800);
}

async function checkDraftOnStart() {
  if (!window.db || !window.db.loadDraft) return null;
  try {
    const draft = await window.db.loadDraft();
    if (draft && draft.form && draft.form.kvNumber) {
      if (draft.draftId) state.draftId = draft.draftId;
      return draft;
    }
  } catch (err) { console.warn('checkDraftOnStart:', err); }
  return null;
}

function restoreDraft(draft) {
  if (!draft || !draft.form) return;
  state.form = {
    kvNumber: draft.form.kvNumber || '',
    apartment: draft.form.apartment || null,
    editedFields: draft.form.editedFields || {},
    divisions: draft.form.divisions || [],
    currentDivisionIndex: draft.form.currentDivisionIndex || 0,
    results: draft.form.results || {},
    uploading: {},
    comments: draft.form.comments || '',
    extraPhotos: draft.form.extraPhotos || []
  };
  state.draftId = draft.draftId || window.db.uuid();
  state.screen = draft.screen || 'newVisitKv';
  if (!state.form.apartment && state.screen === 'newVisitRef') state.screen = 'newVisitKv';
}

// ================= УТИЛИТЫ =================
function escapeHtml(str) {
  return String(str === null || str === undefined ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeAttr(str) {
  return String(str === null || str === undefined ? '' : str)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function cssEscape(str) {
  return String(str).replace(/[^a-zA-Z0-9_\-\.]/g, '\\$&');
}
