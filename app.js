// ================= НАСТРОЙКИ =================
const API_URL = 'https://osmotr-layero-proxy-main.layero.app';
const APP_VERSION = '2.1.53';

// ================= СОСТОЯНИЕ =================
const state = {
  user: { name: '' },
  screen: 'loading',
  form: {
    houseId: '',
    kvNumber: '',
    apartment: null,
    editedFields: {},
    divisions: [],
    currentDivisionIndex: 0,
    results: {},
    uploading: {},
    comments: '',
    extraPhotos: [],
    sourceVisitId: null
  },
  submitResult: null,
  pendingDraft: null,
   queueStats: { pendingVisits: 0, brokenVisits: 0, pendingPhotos: 0, totalVisits: 0, syncedVisits: 0, lastQueueBackupAt: null },
  queueList: [],
  draftId: null,
  nameMode: 'first',
  visitsFilter: 'all',
  visitsList: [],
  expandedVisitId: null,
  kvWarning: null,
  settingsMessage: null,
  volumeModal: null,
  apiReachable: null,
  swUpdateAvailable: false,
  visitPreview: null,
  photoLightbox: null,
  queueBackupBusy: false,
  queueBackupMsg: null,
  
  existingVisits: [],     
  selectedVisitId: null,  
  loadingExisting: false, 
  existingVisit: null,    
  
  offlineDownloadScreen: false, 
  offlineSearch: '',
  offlineDownloadedMap: {},
  offlineDownloading: false,
  pendingDownloadState: null,
  offlineKvExpanded: {},
  offlineTree: [],
  offlineKvSelected: {},
  offlineDownloadedClientIds: []
};

let _deletingPhoto = false;

// ================= СТАРТ =================
document.addEventListener('DOMContentLoaded', init);

async function init() {
  registerServiceWorker();
  
  // 1. Проверяем авторизацию
  const token = await window.db.getMeta('authToken');
  if (!token) {
    state.screen = 'login';
    render();
    return;
  }

  // 2. Проверяем имя (как было раньше)
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

// ================= ОБНОВЛЕНИЕ ПРИЛОЖЕНИЯ =================
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    console.log('[SW] зарегистрирован, scope:', reg.scope);
    if (reg.waiting) {
      state.swUpdateAvailable = true;
      if (state.screen !== 'loading' && state.screen !== 'name') render();
    }
    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      if (!newWorker) return;
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          console.log('[SW] Новая версия готова к активации');
          state.swUpdateAvailable = true;
          if (state.screen !== 'loading' && state.screen !== 'name') render();
        }
      });
    });
    setInterval(() => { reg.update().catch(() => {}); }, 30 * 60 * 1000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        reg.update().catch(() => {});
      }
    });
  }).catch((err) => {
    console.warn('[SW] ошибка регистрации:', err);
  });
}

function applySwUpdate() {
  if (!('serviceWorker' in navigator)) { hardReload(); return; }
  if (sessionStorage.getItem('__sw_updated') === '1') {
    sessionStorage.removeItem('__sw_updated');
    hardReload();
    return;
  }
  let reloaded = false;
  const doReload = () => {
    if (reloaded) return;
    reloaded = true;
    sessionStorage.setItem('__sw_updated', '1');
    setTimeout(hardReload, 300);
  };
  navigator.serviceWorker.addEventListener('controllerchange', doReload, { once: true });
  navigator.serviceWorker.getRegistration().then((reg) => {
    if (!reg) { doReload(); return; }
    if (reg.waiting) {
      reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    } else if (reg.installing) {
      reg.installing.addEventListener('statechange', (e) => {
        if (e.target.state === 'installed') {
          e.target.postMessage({ type: 'SKIP_WAITING' });
        }
      });
    } else { doReload(); }
    setTimeout(doReload, 5000);
  }).catch(() => { doReload(); });
}

function hardReload() {
  try {
    const url = new URL(location.href);
    url.searchParams.set('_r', Date.now());
    location.replace(url.toString());
  } catch (e) { location.reload(); }
}

// ================= ПРОДОЛЖЕНИЕ СТАРТА =================
async function continueStartup() {
  if (window.db && window.db.resetStuckSyncing) window.db.resetStuckSyncing(3).catch(() => {});
  if (window.db && window.db.requestPersistentStorage) {
    window.db.requestPersistentStorage().then(r => {
      console.log('[storage] persist:', r);
    }).catch(() => {});
  }
  setTimeout(() => { maybeAutoBackupQueue().catch(() => {}); }, 5000);
  
  // Очистка старых офлайн-осмотров при старте
  if (window.db && window.db.clearAllOfflineVisits) {
    window.db.clearAllOfflineVisits().catch(() => {});
  }

  const draft = await checkDraftOnStart();
  state.pendingDraft = draft;
  state.screen = 'home';
  await refreshQueueStats();
  render();
  if (window.db && window.db.silentUpdateReference) window.db.silentUpdateReference().catch(() => {});
  if (window.sync && window.sync.startAutoSync) window.sync.startAutoSync();
  
  try {
    state.pendingDownloadState = await window.db.getMeta('offline_download_state');
  } catch(e) {}

  window.addEventListener('online', () => {
    if (['home', 'queue', 'visits', 'settings'].includes(state.screen)) render();
  });
  window.addEventListener('offline', () => {
    if (['home', 'queue', 'visits', 'settings'].includes(state.screen)) render();
  });
}

window.onQueueChanged = async function () {
  await refreshQueueStats();
  if (['home', 'queue', 'visits', 'settings'].includes(state.screen)) render();
};

async function refreshQueueStats() {
  if (!window.db || !window.db.getQueueStats) return;
  try { state.queueStats = await window.db.getQueueStats(); } catch (e) {}
  try { state.apiReachable = await window.db.getMeta('apiReachable'); } catch (e) {}
  try { state.queueStats.lastQueueBackupAt = await window.db.getMeta('lastQueueBackupAt'); } catch (e) {}
}

// ================= API =================
async function apiGet(action, payload, timeoutMs) {
  if (!navigator.onLine) throw new Error('Нет сети');
  
  const params = new URLSearchParams();
  params.set('action', action);
  
  // НИКАКИХ манипуляций с houseId. Отправляем весь payload целиком.
  params.set('payload', JSON.stringify(payload || {}));
  params.set('_t', Date.now());
  
  try {
    const token = await window.db.getMeta('authToken');
    if (token) params.set('token', token);
  } catch (e) {}

  const url = API_URL + '?' + params.toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 15000);
  
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
      cache: 'no-store' 
    });
    
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const text = await response.text();
    return parseResponse(text);
  } finally { 
    clearTimeout(timer); 
  }
}
function parseResponse(text) {
  let t = String(text || '').trim();
  const match = t.match(/^[a-zA-Z0-9_$]+\((.*)\);?\s*$/s);
  if (match) t = match[1];
  let result;
  try { result = JSON.parse(t); } catch (err) { throw new Error('Ответ не JSON: ' + t.substring(0, 100)); }
  if (result && result.ok === false) throw new Error(result.error || 'Неизвестная ошибка');
  return result;
}

// ================= РЕНДЕРИНГ =================
function render() {
  const app = document.getElementById('app');
  
  if (state.offlineDownloadScreen) {
    return renderOfflineDownloadScreen(app);
  }

  if (state.screen === 'loading') { app.innerHTML = '<div class="loading">Загрузка...</div>'; return; }
  if (state.screen === 'error') {
    app.innerHTML = `<div class="error-box"><strong>Ошибка:</strong><br>${escapeHtml(state.errorMessage)}</div><button class="btn btn-secondary" onclick="location.reload()">Перезагрузить</button>`;
    return;
  }
  if (state.screen === 'name')        return renderNameInput(app);
  if (state.screen === 'home')        return renderHome(app);
  if (state.screen === 'newVisitHouse') return renderNewVisitHouse(app);
  if (state.screen === 'newVisitKv')  return renderNewVisitKv(app);
  if (state.screen === 'newVisitRef') return renderNewVisitRef(app);
  if (state.screen === 'division')    return renderDivision(app);
  if (state.screen === 'saved')       return renderSaved(app);
  if (state.screen === 'queue')       return renderQueue(app);
  if (state.screen === 'visits')      return renderVisits(app);
  if (state.screen === 'settings')    return renderSettings(app);
    if (state.screen === 'login')        return renderLogin(app);
}

function renderSwUpdateBanner() {
  if (!state.swUpdateAvailable) return '';
  return `
    <div class="card" style="background:#e8f0fe;border:2px solid #1a73e8;margin-bottom:16px;">
      <h2 style="margin-bottom:8px;">🔄 Доступно обновление</h2>
      <p style="color:#1a73e8;font-size:14px;">Вышла новая версия приложения. Нажмите кнопку — приложение обновится и перезагрузится.</p>
      <button class="btn btn-primary btn-large" style="margin-top:12px;" onclick="applySwUpdate()">Обновить сейчас</button>
    </div>
  `;
}

// ================= МОДАЛЬНОЕ ОКНО ОБЪЁМА =================
function openVolumeModal(stateKey, variant, unit, currentValue) {
  state.volumeModal = {
    stateKey: stateKey,
    variant: variant,
    unit: unit || '',
    value: currentValue !== undefined && currentValue !== null ? String(currentValue) : '',
    isNew: !currentValue
  };
  renderVolumeModal();
}

function closeVolumeModal() {
  state.volumeModal = null;
  const el = document.getElementById('volumeModalBackdrop');
  if (el) el.remove();
}

function renderVolumeModal() {
  const existing = document.getElementById('volumeModalBackdrop');
  if (existing) existing.remove();
  const m = state.volumeModal;
  if (!m) return;
  const backdrop = document.createElement('div');
  backdrop.id = 'volumeModalBackdrop';
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="volume-modal" onclick="event.stopPropagation()">
      <div class="volume-modal-header">
        <div class="volume-modal-icon">${iconRuler(20)}</div>
        <div class="volume-modal-title">Объём замечания</div>
      </div>
      <div class="volume-modal-remark">${escapeHtml(m.variant)}</div>
      <div class="volume-modal-input-wrap">
        <input id="volumeInput" class="volume-modal-input" type="text" inputmode="decimal" value="${escapeAttr(m.value)}" placeholder="0" oninput="onVolumeInput(this.value)">
        <div class="volume-modal-unit">${escapeHtml(m.unit || 'ед.')}</div>
      </div>
      <div class="volume-modal-actions">
        <button class="volume-modal-btn volume-modal-btn-secondary" onclick="cancelVolume()">Отмена</button>
        <button class="volume-modal-btn volume-modal-btn-primary" id="volumeOkBtn" onclick="confirmVolume()" ${m.value ? '' : 'disabled'}>Готово</button>
      </div>
    </div>
  `;
  backdrop.onclick = cancelVolume;
  document.body.appendChild(backdrop);
  setTimeout(() => { const inp = document.getElementById('volumeInput'); if (inp) { inp.focus(); inp.select(); } }, 100);
}

function onVolumeInput(value) {
  if (!state.volumeModal) return;
  state.volumeModal.value = value;
  const btn = document.getElementById('volumeOkBtn');
  if (btn) btn.disabled = !String(value || '').trim();
}

function cancelVolume() {
  const m = state.volumeModal;
  if (m && m.isNew && (!m.value || !String(m.value).trim())) {
    const rs = state.form.results[m.stateKey];
    if (rs) {
      const idx = rs.selected.indexOf(m.variant);
      if (idx >= 0) rs.selected.splice(idx, 1);
      if (rs.volumes) delete rs.volumes[m.variant];
      state.form.results[m.stateKey] = rs;
      setTimeout(() => updateObjectCard(m.stateKey), 50);
      autoSave();
    }
  }
  state.volumeModal = null;
  closeVolumeModal();
}

function confirmVolume() {
  const m = state.volumeModal;
  if (!m) return;
  const val = String(m.value || '').trim();
  if (!val) return;
  const rs = state.form.results[m.stateKey] || { selected: [], custom: '', noIssues: false, commonPhotos: [], photosByVariant: {}, volumes: {} };
  if (!rs.volumes) rs.volumes = {};
  rs.volumes[m.variant] = { value: val, unit: m.unit };
  state.form.results[m.stateKey] = rs;
  state.volumeModal = null;
  closeVolumeModal();
  updateObjectCard(m.stateKey);
  autoSave();
}

// ================= ЭКРАН ИМЕНИ =================
// ================= ЭКРАН ЛОГИНА =================
function renderLogin(app) {
  app.innerHTML = `
    <div class="user-greeting"><div class="avatar">🔐</div><div class="email">Вход в систему</div></div>
    <div class="card">
      <div class="step-header"><h2>Авторизация</h2><p>Введите данные, выданные администратором.</p></div>
      
      <div class="field-group">
        <label class="field-label">Логин</label>
        <input id="loginInput" class="field-input" type="text" autocomplete="username" placeholder="Ваш логин">
      </div>
      
      <div class="field-group">
        <label class="field-label">Пароль</label>
        <input id="passwordInput" class="field-input" type="password" autocomplete="current-password" placeholder="Ваш пароль">
      </div>
      
      <div id="loginError" class="error-box" style="display:none; margin-bottom:16px;"></div>
      
      <button class="btn btn-primary btn-large" id="loginBtn" onclick="onLoginClick()">Войти</button>
    </div>
  `;
  setTimeout(() => { const i = document.getElementById('loginInput'); if (i) i.focus(); }, 100);
}

async function onLoginClick() {
  const loginInput = document.getElementById('loginInput');
  const passInput = document.getElementById('passwordInput');
  const errBox = document.getElementById('loginError');
  const btn = document.getElementById('loginBtn');
  
  const login = String((loginInput && loginInput.value) || '').trim();
  const password = String((passInput && passInput.value) || '').trim();
  
  if (!login || !password) {
    errBox.textContent = 'Введите логин и пароль.';
    errBox.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Проверка...';
  errBox.style.display = 'none';

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'login', login: login, password: password })
    });
    
    const text = await res.text();
    const data = parseResponse(text);
    
    if (!data || !data.ok || !data.data || !data.data.token) {
      throw new Error((data && data.error) || 'Неверный логин или пароль');
    }
    
    // Сохраняем токен и заходим
    await window.db.setMeta('authToken', data.data.token);
    await window.db.setMeta('authRole', data.data.role || 'user');
    
    // После успешного входа запрашиваем имя
    const savedName = await window.db.getUserName();
    state.user.name = savedName || '';
    if (!state.user.name) {
      state.nameMode = 'first';
      state.screen = 'name';
    } else {
      await continueStartup();
    }
    render();
    
  } catch (err) {
    errBox.textContent = err.message || 'Ошибка входа';
    errBox.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Войти';
  }
}
function renderNameInput(app) {
  const isFirst = state.nameMode === 'first';
  const currentName = state.user.name || '';
  app.innerHTML = `
    <div class="user-greeting"><div class="avatar">👤</div><div class="email">${isFirst ? 'Добро пожаловать!' : 'Смена имени'}</div></div>
    <div class="card">
      <div class="step-header"><h2>${isFirst ? 'Как вас зовут?' : 'Изменить имя'}</h2><p>Имя будет записано в таблицу вместе с осмотром.</p></div>
      <label class="field-label">Ваше имя</label>
      <input id="nameInput" class="field-input" type="text" autocomplete="off" placeholder="Например: Иванов И.И." value="${escapeHtml(currentName)}" oninput="onNameInput(this.value)">
      <button class="btn btn-primary btn-large" id="nameSaveBtn" onclick="onSaveName()" ${currentName.trim() ? '' : 'disabled'}>${isFirst ? 'Сохранить и продолжить' : 'Сохранить'}</button>
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
    state.screen = 'settings';
    state.settingsMessage = { type: 'ok', text: 'Имя сохранено: ' + name };
    render();
  } else { await continueStartup(); }
}

function cancelNameChange() { state.nameMode = 'first'; state.screen = 'settings'; render(); }

// ================= ГЛАВНЫЙ ЭКРАН =================
function renderHome(app) {
  const hasDraft = !!state.pendingDraft;
  const pending = state.queueStats.pendingVisits || 0;
  const firstName = (state.user.name || '').split(' ')[0] || 'друг';
  const now = new Date();
  const dateStr = now.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  const dateCapitalized = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);

  app.innerHTML = `
    ${renderSwUpdateBanner()}
    <div class="welcome-header"><div class="welcome-greeting">Привет, ${escapeHtml(firstName)} 👋</div><div class="welcome-date">${escapeHtml(dateCapitalized)}</div></div>
    ${renderStatusLine()}
    
    <div class="main-actions">
      <button class="main-action-card green" onclick="startNewVisit()">
        <div class="action-icon">${iconHome(28)}</div>
        <div class="action-info"><div class="action-title">Новый осмотр</div></div>
      </button>
      <button class="main-action-card purple" onclick="showVisits()">
        <div class="action-icon">${iconList(28)}</div>
        <div class="action-info"><div class="action-title">Мои осмотры</div></div>
      </button>
      
    </div>

    ${hasDraft ? `
    <button class="list-row" onclick="continueDraft()">
      <div class="list-row-icon yellow">${iconPencil(22)}</div>
      <div class="list-row-content"><div class="list-row-title">Продолжить черновик</div><div class="list-row-subtitle">Квартира ${escapeHtml(state.pendingDraft.form.kvNumber || '—')}</div></div>
      <div class="list-row-arrow">${iconChevronRight(20)}</div>
    </button>` : ''}
    
    <button class="list-row" onclick="showQueue()">
      <div class="list-row-icon ${pending > 0 ? 'blue' : 'green'}">${pending > 0 ? iconArrowUpCircle(22) : iconCheckCircle(22)}</div>
      <div class="list-row-content"><div class="list-row-title">Очередь отправки</div><div class="list-row-subtitle">${pending > 0 ? pending + ' ' + pluralVisits(pending) + ' ждёт отправки' : 'Всё отправлено'}</div></div>
      <div class="list-row-arrow">${iconChevronRight(20)}</div>
    </button>
    
    <button class="list-row" onclick="showSettings()">
      <div class="list-row-icon blue">${iconGear(22)}</div>
      <div class="list-row-content"><div class="list-row-title">Настройки</div><div class="list-row-subtitle">Профиль, данные, диагностика</div></div>
      <div class="list-row-arrow">${iconChevronRight(20)}</div>
    </button>
  `;
}
function pluralVisits(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'осмотр';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'осмотра';
  return 'осмотров';
}

function renderStatusLine() {
  const online = navigator.onLine;
  const apiMeta = state.apiReachable || null;
  const isBad = apiMeta && apiMeta.ok === false && (Date.now() - apiMeta.at) < 10 * 60 * 1000;
  let cls, text;
  if (!online) { cls = 'offline'; text = 'Офлайн — данные сохраняются локально'; }
  else if (isBad) { cls = 'warning'; text = 'Работают только белые списки'; }
  else { cls = 'online'; text = 'Онлайн'; }
  return `
    <div class="status-line" ontouchstart="startBannerLongPress()" ontouchend="cancelBannerLongPress()" ontouchcancel="cancelBannerLongPress()" onmousedown="startBannerLongPress()" onmouseup="cancelBannerLongPress()" onmouseleave="cancelBannerLongPress()">
      <span class="status-dot ${cls}"></span><span class="status-text">${escapeHtml(text)}</span>
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

// ================= НАСТРОЙКИ =================
async function showSettings() {
  state.settingsMessage = null;
  state.screen = 'settings';
  await refreshQueueStats();
  render();
  window.scrollTo(0, 0);
}
function toggleSettingsBlock(key) {
  if (!state.settingsExpanded) state.settingsExpanded = {};
  state.settingsExpanded[key] = !state.settingsExpanded[key];
  
  // Запоминаем скролл, чтобы страница не прыгала
  const scrollPos = window.scrollY;
  render();
  window.scrollTo(0, scrollPos);
}
async function renderSettings(app) {
  let refCount = 0;

  try {
    const houses = await window.db.getMeta('houses_cache');

    for (const h of (Array.isArray(houses) ? houses : [])) {
      const ref = await window.db.getReference(h.id);

      if (ref && !Object.prototype.hasOwnProperty.call(ref, 'error')) {
        refCount += Object.keys(ref).length;
      }
    }
  } catch (e) {}
  const version = await window.db.getMeta('version');
  
  // Состояние для раскрытых блоков настроек
  if (!state.settingsExpanded) state.settingsExpanded = { profile: true, data: false, diagnostic: false };
  const exp = state.settingsExpanded;

  app.innerHTML = `
    ${renderSwUpdateBanner()}
    
    <!-- ПРОФИЛЬ -->
    <div class="card" style="padding: 0; overflow: hidden; margin-bottom: 12px;">
      <div style="padding: 16px; display: flex; justify-content: space-between; align-items: center; cursor: pointer;" onclick="toggleSettingsBlock('profile')">
        <h3 style="margin: 0; font-size: 16px;">👤 Профиль</h3>
        <div style="transform: rotate(${exp.profile ? '90deg' : '0deg'}); transition: 0.2s;">›</div>
      </div>
      ${exp.profile ? `
      <div style="padding: 0 16px 16px 16px; border-top: 1px solid #f0f0f0;">
        <div class="settings-item" style="margin-top: 12px;"><span class="settings-item-label">Имя осмотрщика</span><span class="settings-item-value">${escapeHtml(state.user.name || '—')}</span></div>
        <button class="btn btn-secondary" style="margin-top:12px;" onclick="openNameChange()">Сменить имя</button>
      </div>
      ` : ''}
    </div>

    <!-- ДАННЫЕ -->
    <div class="card" style="padding: 0; overflow: hidden; margin-bottom: 12px;">
      <div style="padding: 16px; display: flex; justify-content: space-between; align-items: center; cursor: pointer;" onclick="toggleSettingsBlock('data')">
        <h3 style="margin: 0; font-size: 16px;">📥 Данные</h3>
        <div style="transform: rotate(${exp.data ? '90deg' : '0deg'}); transition: 0.2s;">›</div>
      </div>
      ${exp.data ? `
      <div style="padding: 0 16px 16px 16px; border-top: 1px solid #f0f0f0;">
        <div class="settings-item" style="margin-top: 12px;"><span class="settings-item-label">📚 Справочник квартир</span><span class="settings-item-value">${refCount} шт.</span></div>
        
        <button class="btn btn-primary" style="margin-top:16px;" onclick="updateReferenceNow()">🔄 Обновить справочник</button>
        <button class="btn btn-secondary" style="margin-top:8px;" onclick="exportVisitsCsvFromSettings()">📥 Скачать осмотры (CSV)</button>
        
        <hr style="margin:16px 0; border:none; border-top:1px solid #f0f0f0;">
        
        <p style="font-size:13px;color:#5f6368;margin-bottom:8px;">Если осмотры долго не отправляются из очереди — нажмите сюда. Копия уйдёт в облако.</p>
        <button class="btn btn-primary" id="queueBackupBtn" onclick="uploadQueueToDrive()" ${state.queueStats.pendingVisits === 0 ? 'disabled' : ''}>📤 Не отправляется? Нажмите сюда</button>
        ${state.queueBackupMsg ? `<div class="update-info ${state.queueBackupMsg.type === 'error' ? 'error' : 'ok'}" style="margin-top:8px;">${escapeHtml(state.queueBackupMsg.text)}</div>` : ''}
        ${renderQueueBackupStatus()}
      </div>
      ` : ''}
    </div>

    <!-- ОБНОВЛЕНИЕ ПРИЛОЖЕНИЯ -->
    <div class="card" style="margin-bottom: 12px;">
      <h3 style="margin: 0 0 12px 0; font-size: 16px;">🔄 Обновление приложения</h3>
      <p style="font-size:13px;color:#5f6368;margin-bottom:12px;">Проверьте, нет ли новой версии.</p>
      <button class="btn btn-secondary" onclick="checkAndUpdateApp()">Проверить обновление</button>
      ${state.settingsMessage ? `<div class="update-info ${state.settingsMessage.type === 'error' ? 'error' : (state.settingsMessage.type === 'ok' ? 'ok' : '')}" style="margin-top:12px;">${escapeHtml(state.settingsMessage.text)}</div>` : ''}
    </div>


    <!-- ДИАГНОСТИКА -->
    <div class="card" style="padding: 0; overflow: hidden; margin-bottom: 12px;">
      <div style="padding: 16px; display: flex; justify-content: space-between; align-items: center; cursor: pointer;" onclick="toggleSettingsBlock('diagnostic')">
        <h3 style="margin: 0; font-size: 16px;">🛠 Диагностика</h3>
        <div style="transform: rotate(${exp.diagnostic ? '90deg' : '0deg'}); transition: 0.2s;">›</div>
      </div>
      ${exp.diagnostic ? `
      <div style="padding: 0 16px 16px 16px; border-top: 1px solid #f0f0f0;">
        <div class="settings-item" style="margin-top: 12px;"><span class="settings-item-label">Версия приложения</span><span class="settings-item-value">${APP_VERSION}</span></div>
        <div class="settings-item"><span class="settings-item-label">Версия данных</span><span class="settings-item-value">${version ? (version.reference || '0') : '—'}</span></div>
        <button class="btn btn-primary" style="margin-top:12px;" onclick="forcePingCheck()">📡 Проверить API сейчас</button>
        <button class="btn btn-secondary" style="margin-top:8px;" onclick="showDiagnostics()">🔍 Диагностика</button>
      </div>
      ` : ''}
    </div>
<button class="btn btn-secondary" style="margin-top:8px; color:#c5221f;" onclick="logoutUser()">Выйти из аккаунта</button>
    <button class="btn btn-secondary" onclick="goHome()" style="margin-top: 12px;">← На главную</button>
    <div class="app-version" style="margin-top: 24px;">Осмотры квартир · v${APP_VERSION}<br>Работает офлайн</div>
  `;
}
async function logoutUser() {
  if (!confirm('Выйти из аккаунта?')) return;
  await window.db.setMeta('authToken', null);
  state.screen = 'login';
  render();
}
async function openNameChange() { state.nameMode = 'change'; state.screen = 'name'; render(); window.scrollTo(0, 0); }

async function checkAndUpdateApp() {
  if (!('serviceWorker' in navigator)) { alert('Ваш браузер не поддерживает Service Worker.'); return; }
  try {
    state.settingsMessage = { type: '', text: 'Проверка обновлений…' };
    render();
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) { state.settingsMessage = { type: 'error', text: 'Service Worker не зарегистрирован.' }; render(); return; }
    await reg.update();
    await new Promise(r => setTimeout(r, 1500));
    if (reg.waiting) {
      state.swUpdateAvailable = true;
      state.settingsMessage = { type: 'ok', text: '✓ Доступно обновление.' };
      render();
    } else {
      state.settingsMessage = { type: 'ok', text: '✓ У вас последняя версия (' + APP_VERSION + ').' };
      render();
    }
  } catch (err) { state.settingsMessage = { type: 'error', text: 'Ошибка: ' + err.message }; render(); }
}

async function updateReferenceNow() {
  if (!navigator.onLine) {
    state.settingsMessage = {
      type: 'error',
      text: 'Нет интернета.'
    };
    render();
    return;
  }

  state.settingsMessage = {
    type: '',
    text: 'Обновление справочников…'
  };

  render();

  try {
    const counts = await window.db.silentUpdateReference();

    state.settingsMessage = {
      type: 'ok',
      text: 'Справочники обновлены: ' +
        counts.map(x =>
          x.house + ' — ' + x.count + ' квартир'
        ).join('; ')
    };

  } catch (err) {
    state.settingsMessage = {
      type: 'error',
      text: 'Ошибка: ' + err.message
    };
  }

  await refreshQueueStats();
  render();
}

async function exportVisitsCsvFromSettings() {
  try {
    const rows = await window.db.getVisibleVisits();
    exportVisitsCsvData(rows);
  } catch (err) { alert('Не удалось экспортировать: ' + err.message); }
}

// ================= МОИ ОСМОТРЫ =================
async function showVisits() {
  if (!window.db || !window.db.getVisibleVisits) return;
  state.visitsList = await window.db.getVisibleVisits();
  state.expandedVisitId = null;
  state.screen = 'visits';
  render();
  window.scrollTo(0, 0);
}

function setVisitsFilter(filter) { state.visitsFilter = filter; state.expandedVisitId = null; render(); }
function toggleVisitDetails(clientId) { state.expandedVisitId = (state.expandedVisitId === clientId) ? null : clientId; render(); }

async function hideVisitFromList(clientId) {
  if (!confirm('Скрыть этот осмотр из списка?')) return;
  await window.db.hideVisit(clientId);
  state.visitsList = await window.db.getVisibleVisits();
  state.expandedVisitId = null;
  render();
}

function renderVisits(app) {
  const all = state.visitsList || [];
  let filtered = all;
    if (state.visitsFilter === 'synced') filtered = all.filter(v => v.status === 'synced');
  else if (state.visitsFilter === 'pending') filtered = all.filter(v => v.status !== 'synced' && v.status !== 'broken');
  else if (state.visitsFilter === 'broken') filtered = all.filter(v => v.status === 'broken');
  filtered = filtered.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const limited = filtered.slice(0, 200);
  const itemsHtml = limited.length ? limited.map(v => renderVisitCard(v)).join('') : '<div class="hint">Здесь пока ничего нет.</div>';
  app.innerHTML = `
    <div class="card">
      <div class="step-header"><h2>Мои осмотры</h2><p>Всего: ${all.length}. Показано: ${limited.length}.</p></div>
      <div style="margin-bottom:12px;">
        <label class="field-label" style="font-size:13px;">Фильтр</label>
               <select class="field-input" onchange="setVisitsFilter(this.value)" style="width:100%;">
          <option value="all" ${state.visitsFilter === 'all' ? 'selected' : ''}>Все осмотры</option>
          <option value="synced" ${state.visitsFilter === 'synced' ? 'selected' : ''}>Отправленные</option>
          <option value="pending" ${state.visitsFilter === 'pending' ? 'selected' : ''}>В очереди</option>
          <option value="broken" ${state.visitsFilter === 'broken' ? 'selected' : ''}>Без фото (требуют внимания)</option>
        </select>
      </div>
      ${itemsHtml}
      ${all.length > 0 ? `<button class="btn btn-primary btn-large" style="margin-top:16px;" onclick="exportVisitsCsv()">📥 Скачать CSV</button>` : ''}
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
  else if (v.status === 'broken') { statusClass = 'error'; statusText = '🧩 Не хватает фото'; }
  else if (v.status === 'syncing') { statusClass = 'pending'; statusText = '📤 Отправляется'; }
  const isExpanded = state.expandedVisitId === v.clientId;
  let detailsHtml = '';
  if (isExpanded) {
    const visitedAt = v.payload && v.payload.visitedAt ? new Date(v.payload.visitedAt) : null;
    const visitedStr = visitedAt ? visitedAt.toLocaleString('ru-RU') : '—';
    const comments = (v.payload && v.payload.comments) || '';
    const photosCount = v.payload && v.payload.results
      ? Object.keys(v.payload.results).reduce((sum, k) => {
          const rs = v.payload.results[k] || {};
          let n = 0;
          if (Array.isArray(rs.commonPhotos)) n += rs.commonPhotos.length;
          if (Array.isArray(rs.photos)) n += rs.photos.length;
          if (rs.photosByVariant) Object.keys(rs.photosByVariant).forEach(vv => { n += (rs.photosByVariant[vv] || []).length; });
          return sum + n;
        }, 0) : 0;
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
      <div class="visit-card-title"><span class="visit-card-kv">Кв. ${escapeHtml(kv)}</span><span class="visit-card-status ${statusClass}">${statusText}</span></div>
      <div class="visit-card-sub">👤 ${escapeHtml(userName)} · ${escapeHtml(createdStr)}</div>
      ${detailsHtml}
    </div>
  `;
}

function exportVisitsCsv() { exportVisitsCsvData(state.visitsList || []); }

function exportVisitsCsvData(rows) {
  if (!rows.length) { alert('Нет данных для экспорта.'); return; }
  const allLines = [];
  rows.forEach(v => {
    const kv = v.payload && v.payload.kvNumber ? v.payload.kvNumber : '—';
    const userName = (v.payload && v.payload.email) || '—';
    const created = v.createdAt ? new Date(v.createdAt).toLocaleString('ru-RU') : '—';
    const visitedAt = v.payload && v.payload.visitedAt ? new Date(v.payload.visitedAt).toLocaleString('ru-RU') : '—';
    let status = 'в очереди';
    if (v.status === 'synced') status = 'отправлен';
    else if (v.status === 'error') status = 'ошибка';
    else if (v.status === 'syncing') status = 'отправляется';
    allLines.push('');
    allLines.push('=== ОСМОТР ===');
    allLines.push('Квартира;' + csvEscape(kv));
    allLines.push('Осмотрщик;' + csvEscape(userName));
    allLines.push('Создан;' + csvEscape(created));
    allLines.push('Осмотр;' + csvEscape(visitedAt));
    allLines.push('Статус;' + csvEscape(status));
    allLines.push('');
    allLines.push('Объект;Замечания;Фото');
    const results = (v.payload && v.payload.results) || {};
    const stateKeys = Object.keys(results).sort();
    stateKeys.forEach(stateKey => {
      const rs = results[stateKey] || {};
      const objName = stateKeyToRusName(stateKey);
      const commonPhotos = (rs.commonPhotos || []).filter(p => p && p.url).map(p => p.url);
      const oldPhotos = (rs.photos || []).filter(p => p && p.url).map(p => p.url);
      const allCommon = commonPhotos.length ? commonPhotos : oldPhotos;
      if (allCommon.length) allLines.push([csvEscape(objName + ' (общий вид)'), csvEscape('—'), csvEscape(allCommon.join(' ; '))].join(';'));
      const remarksParts = [];
      const photosByVariant = rs.photosByVariant || {};
      if (rs.noIssues) remarksParts.push('Замечаний нет');
      else {
        (rs.selected || []).forEach(variant => {
          const vol = (rs.volumes || {})[variant];
          if (vol && vol.value) remarksParts.push(variant + ' (' + vol.value + (vol.unit ? ' ' + vol.unit : '') + ')');
          else remarksParts.push(variant);
        });
        if (rs.custom && String(rs.custom).trim()) remarksParts.push(rs.custom.trim());
      }
      const variantPhotoUrls = [];
      Object.keys(photosByVariant).forEach(variant => {
        const arr = (photosByVariant[variant] || []).filter(p => p && p.url);
        arr.forEach(p => variantPhotoUrls.push(p.url + ' (' + variant + ')'));
      });
      if (remarksParts.length || variantPhotoUrls.length) allLines.push([csvEscape(objName), csvEscape(remarksParts.join('; ')), csvEscape(variantPhotoUrls.join(' ; '))].join(';'));
    });
    const extraPhotos = (v.payload && v.payload.extraPhotos) || [];
    const extraUrls = extraPhotos.filter(p => p && p.url).map(p => p.url);
    if (extraUrls.length) { allLines.push(''); allLines.push('Дополнительные фото;—;' + csvEscape(extraUrls.join(' ; '))); }
    const comments = (v.payload && v.payload.comments) || '';
    if (comments) allLines.push('Комментарий;' + csvEscape(comments) + ';—');
  });
  const csv = '\uFEFF' + allLines.join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'osmotry_' + new Date().toISOString().substring(0, 10) + '.csv';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
}

function stateKeyToRusName(stateKey) {
  const map = {
    'koridor.vhodnaya_dver': 'Коридор. Входная дверь', 'koridor.steny': 'Коридор. Стены', 'koridor.poly': 'Коридор. Полы', 'koridor.potolki': 'Коридор. Потолки', 'koridor.elektro': 'Коридор. Электроснабжение', 'koridor.shit': 'Коридор. Щит', 'koridor.seti': 'Коридор. Сети связи', 'koridor.ops': 'Коридор. ОПС', 'zhk1.steny': 'ЖК1. Стены', 'zhk1.poly': 'ЖК1. Полы', 'zhk1.potolki': 'ЖК1. Потолки', 'zhk1.elektro': 'ЖК1. Электроснабжение', 'zhk1.okno1': 'ЖК1. Окно №1', 'zhk1.okno2': 'ЖК1. Окно №2', 'zhk1.radiator1': 'ЖК1. Радиатор №1', 'zhk1.radiator2': 'ЖК1. Радиатор №2', 'zhk2.steny': 'ЖК2. Стены', 'zhk2.poly': 'ЖК2. Полы', 'zhk2.potolki': 'ЖК2. Потолки', 'zhk2.elektro': 'ЖК2. Электроснабжение', 'zhk2.okno1': 'ЖК2. Окно №1', 'zhk2.okno2': 'ЖК2. Окно №2', 'zhk2.radiator1': 'ЖК2. Радиатор №1', 'zhk2.radiator2': 'ЖК2. Радиатор №2', 'zhk3.steny': 'ЖК3. Стены', 'zhk3.poly': 'ЖК3. Полы', 'zhk3.potolki': 'ЖК3. Потолки', 'zhk3.elektro': 'ЖК3. Электроснабжение', 'zhk3.okno1': 'ЖК3. Окно №1', 'zhk3.okno2': 'ЖК3. Окно №2', 'zhk3.radiator1': 'ЖК3. Радиатор №1', 'zhk3.radiator2': 'ЖК3. Радиатор №2', 'kuhnya.steny': 'Кухня. Стены', 'kuhnya.poly': 'Кухня. Полы', 'kuhnya.potolki': 'Кухня. Потолки', 'kuhnya.elektro': 'Кухня. Электроснабжение', 'kuhnya.okno1': 'Кухня. Окно №1', 'kuhnya.okno2': 'Кухня. Окно №2', 'kuhnya.radiator1': 'Кухня. Радиатор №1', 'kuhnya.radiator2': 'Кухня. Радиатор №2', 'kuhnya.kanalizaciya': 'Кухня. Канализация', 'kuhnya.ventilyaciya': 'Кухня. Вентиляция', 'su1.steny': 'Сан. узел №1. Стены', 'su1.poly': 'Сан. узел №1. Полы', 'su1.potolki': 'Сан. узел №1. Потолки', 'su1.elektro': 'Сан. узел №1. Электроснабжение', 'su1.kanalizaciya': 'Сан. узел №1. Канализация', 'su1.ventilyaciya': 'Сан. узел №1. Вентиляция', 'su2.steny': 'Сан. узел №2. Стены', 'su2.poly': 'Сан. узел №2. Полы', 'su2.potolki': 'Сан. узел №2. Потолки', 'su2.elektro': 'Сан. узел №2. Электроснабжение', 'su2.kanalizaciya': 'Сан. узел №2. Канализация', 'su2.ventilyaciya': 'Сан. узел №2. Вентиляция', 'vodosnabzhenie.vodosnabzhenie': 'Водоснабжение', 'garderobnaya.steny': 'Гардеробная. Стены', 'garderobnaya.poly': 'Гардеробная. Полы', 'garderobnaya.potolki': 'Гардеробная. Потолки', 'garderobnaya.elektro': 'Гардеробная. Электроснабжение', 'prachechnaya.steny': 'Прачечная. Стены', 'prachechnaya.poly': 'Прачечная. Полы', 'prachechnaya.potolki': 'Прачечная. Потолки', 'prachechnaya.elektro': 'Прачечная. Электроснабжение', 'lodzhiya.obshie': 'Лоджия. Общие замечания', 'lodzhiya.potolki': 'Лоджия. Потолки', 'lodzhiya.okno': 'Лоджия. Окно'
  };
  return map[stateKey] || stateKey;
}

function csvEscape(str) {
  const s = String(str === null || str === undefined ? '' : str);
  if (s.indexOf(';') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// ================= ОЧЕРЕДЬ =================
function renderQueue(app) {
  const visits = state.queueList || [];
  const pending = visits.filter(v => v.status !== 'synced');
  const itemsHtml = pending.length ? pending.map(v => {
    const kv = v.payload && v.payload.kvNumber ? v.payload.kvNumber : '—';
    const when = v.createdAt ? new Date(v.createdAt).toLocaleString('ru-RU') : '';
    const attempts = v.attempts || 0;
       let statusText = '';
    if (v.status === 'pending') statusText = '⏳ Ожидает отправки';
    else if (v.status === 'syncing') {
      if (v.progress && v.progress.stage === 'photos') statusText = '📤 Отправка фото: ' + (v.progress.current || 0) + ' из ' + (v.progress.total || 0);
      else if (v.progress && v.progress.stage === 'submit') statusText = '📤 Отправка данных осмотра…';
      else statusText = '📤 Отправляется…';
    } else if (v.status === 'broken') statusText = '🧩 Не хватает фото: ' + (v.lastError || 'переснимите и отправьте заново');
    else if (v.status === 'error') statusText = '❌ Ошибка (попыток: ' + attempts + '): ' + (v.lastError || '—');
    else statusText = v.status;
    const photoCount = countVisitPhotos(v);
    return `
      <div class="object-card">
        <div class="object-title">Квартира ${escapeHtml(kv)}</div>
        <p style="font-size:14px;color:#5f6368;margin-bottom:8px;">${escapeHtml(when)}</p>
        <p style="font-size:14px;color:${v.status === 'error' ? '#c5221f' : '#5f6368'};">${escapeHtml(statusText)}</p>
        <p style="font-size:13px;color:#5f6368;margin:8px 0;">📷 Фото: ${photoCount}</p>
                      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;">
          <button class="btn btn-secondary" onclick="showVisitPreview('${escapeAttr(v.clientId)}')">👁 Посмотреть</button>
          ${v.status === 'broken'
            ? `<button class="btn btn-primary" onclick="recoverBrokenVisit('${escapeAttr(v.clientId)}')">✏️ Исправить</button>
               <button class="btn btn-secondary" onclick="deleteBrokenVisit('${escapeAttr(v.clientId)}')">🗑 Удалить</button>`
            : `${navigator.onLine ? `<button class="btn btn-secondary" onclick="sendVisitNow('${escapeAttr(v.clientId)}')">📤 Отправить этот</button>` : ''}
               <button class="btn btn-secondary" onclick="resetVisitAttempts('${escapeAttr(v.clientId)}')">🔄 Сбросить</button>`}
        </div>
      </div>
    `;
  }).join('') : '<div class="hint">Очередь пуста.</div>';

  app.innerHTML = `
    <div class="card">
      <div class="step-header"><h2>Очередь отправки</h2><p>Всего в очереди: ${pending.length}</p></div>
      ${itemsHtml}
      ${pending.length ? `<button class="btn btn-primary btn-large" style="margin-top:16px;" onclick="resetAttemptsNow()">🔄 Сбросить все попытки</button>` : ''}
      ${pending.length && navigator.onLine ? `<button class="btn btn-primary btn-large" style="margin-top:8px;" onclick="syncAllNow()">📤 Отправить всё сейчас</button>` : ''}
      ${pending.length ? `
        <hr style="margin:16px 0;border:none;border-top:1px solid #e0e0e0;">
        <button class="btn btn-primary btn-large" id="queueBackupBtnQueue" onclick="uploadQueueToDrive()" ${state.queueBackupBusy ? 'disabled' : ''}>📤 Не отправляется? Нажмите сюда</button>
        <div style="font-size:12px;color:#5f6368;margin-top:6px;">Копия уйдёт в облако</div>
        ${state.queueBackupMsg ? `<div class="update-info ${state.queueBackupMsg.type === 'error' ? 'error' : 'ok'}" style="margin-top:8px;">${escapeHtml(state.queueBackupMsg.text)}</div>` : ''}
        ${renderQueueBackupStatus()}
      ` : ''}
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
  alert('Попытки сброшены.');
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
    let formatStatus = '—', requireVolumeCount = 0, totalVariants = 0, sampleInfo = '', sampleVariant = '';
    if (remarks && Object.keys(remarks).length > 0) {
      const firstType = Object.keys(remarks)[0];
      const firstVariant = Object.keys(remarks[firstType] || {})[0];
      const info = remarks[firstType][firstVariant];
      sampleVariant = firstType + ' / ' + firstVariant;
      if (typeof info === 'string') { formatStatus = '❌ СТАРЫЙ (только текст)'; sampleInfo = '«' + String(info).substring(0, 60) + '»'; }
      else if (info && typeof info === 'object') {
        if (typeof info.requireVolume === 'boolean') formatStatus = '✅ НОВЫЙ (есть requireVolume)';
        else formatStatus = '⚠ Объект, но без requireVolume';
        sampleInfo = JSON.stringify(info).substring(0, 100);
      } else { formatStatus = '⚠ Неизвестный тип: ' + typeof info; sampleInfo = String(info); }
      Object.keys(remarks).forEach(criterion => {
        Object.keys(remarks[criterion] || {}).forEach(variant => {
          totalVariants++;
          const item = remarks[criterion][variant];
          if (item && typeof item === 'object' && item.requireVolume) requireVolumeCount++;
        });
      });
    } else formatStatus = '❌ Замечания в кэше ПУСТЫ';
       alert('🔍 Диагностика\n\nВерсия приложения: ' + APP_VERSION + '\nПользователь: ' + (state.user.name || '—') + '\n\nХранилища (' + stores.length + '):\n' + stores.join(', ') + '\n\nСправочник: ' + refCount + ' квартир\nЗамечания: ' + remCount + ' типов, ' + totalVariants + ' вариантов\n  → требуют объёма: ' + requireVolumeCount + '\nМарки окон: ' + marksCount + '\nВерсия данных: ' + (version ? JSON.stringify(version) : '—') + '\n\n🧪 Формат замечаний:\n  ' + formatStatus + '\n  Пример: ' + sampleVariant + '\n  ' + sampleInfo + '\n\nОчередь осмотров: ' + stats.pendingVisits + '\nБез фото (требуют внимания): ' + (stats.brokenVisits || 0) + '\nОчередь фото: ' + stats.pendingPhotos + '\nВсего осмотров: ' + stats.totalVisits + ' (синхр.: ' + stats.syncedVisits + ')\n\nСеть: ' + (navigator.onLine ? 'онлайн' : 'офлайн'));
  } catch (err) { alert('Ошибка диагностики: ' + err.message); }
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
async function startNewVisit() {
  if (state.startingNewVisit || state.isSubmitting) return;
  state.startingNewVisit = true;
  try {
    const draft = await window.db.loadDraft(true);
    if (draft) {
      state.pendingDraft = draft;
      state.screen = 'home';
      render();
      alert('Есть незавершённый осмотр. Сначала продолжите черновик.');
      return;
    }
    clearTimeout(_autoSaveTimeout);
    state.form = {
      houseId: '', section: '', kvNumber: '', floorNumber: '',
      floorKvNumber: '', apartment: null, editedFields: {}, divisions: [],
      currentDivisionIndex: 0, results: {}, uploading: {}, comments: '',
      extraPhotos: [], sourceVisitId: null
    };
    state.draftId = null;
    state.pendingDraft = null;
    state.submitResult = null;
    state.kvWarning = null;
    state.volumeModal = null;
    state.existingVisits = [];
    state.screen = 'newVisitHouse';
    render();
    window.scrollTo(0, 0);
  } catch (err) {
    alert('Не удалось проверить черновик: ' + err.message);
  } finally {
    state.startingNewVisit = false;
  }
}

function renderNewVisitHouse(app) {
  app.innerHTML = `
    <div class="card">
      <div class="step-header"><div class="step-progress">Шаг 1</div><h2>Выберите дом</h2><p>Укажите литер, по которому будет проходить осмотр.</p></div>
      <div id="housesList"><div class="loading">Загрузка домов...</div></div>
      <button class="btn btn-secondary" onclick="backToHouse()">← Назад к выбору литера</button>
      <button class="btn btn-secondary" onclick="cancelApartmentSelection()">← Отмена</button>
    </div>
  `;
  
   const list = document.getElementById('housesList');
  getHousesSmart().then(houses => {
    if (document.getElementById('housesList') !== list) return;
    if (!houses || houses.length === 0) {
      list.innerHTML = '<div class="error-box">Нет доступных домов. Проверьте интернет и лист "Дома".</div>';
      return;
    }
    list.innerHTML = houses.map(h => `
      <button class="list-row" onclick="selectHouse('${h.id}')">
        <div class="list-row-icon blue">🏢</div>
        <div class="list-row-content"><div class="list-row-title">${escapeHtml(h.name)}</div></div>
        <div class="list-row-arrow">${iconChevronRight(20)}</div>
      </button>
    `).join('');
  }).catch(err => {
        if (document.getElementById('housesList') === list) {
      list.innerHTML = `<div class="error-box">Ошибка: ${escapeHtml(err.message)}</div>`;
    }
  });
}

async function getHousesSmart() {
  if (navigator.onLine) {
    try {
      const res = await apiGet('getHouses');
      const houses = (res && res.data) ? res.data : res;
      if (Array.isArray(houses) && houses.length > 0) {
        await window.db.setMeta('houses_cache', houses);
        return houses;
      }
    } catch (e) {
      console.warn('[houses] Ошибка сети, берем кэш:', e.message);
    }
  }
  return await window.db.getMeta('houses_cache') || [];
}

function selectHouse(houseId) {
  if (state.apartmentTransition || state.screen !== 'newVisitHouse') return;
  clearTimeout(_kvCheckTimeout);
  state.form.houseId = houseId;
  state.form.section = '';
  state.form.kvNumber = '';
  state.form.floorNumber = '';
  state.form.floorKvNumber = '';
  state.form.apartment = null;
  state.form.editedFields = {};
  state.screen = 'newVisitKv';
  render();
}

function backToHouse() {
  if (state.apartmentTransition || state.screen !== 'newVisitKv') return;
  clearTimeout(_kvCheckTimeout);
  state.screen = 'newVisitHouse';
  render();
}

function cancelApartmentSelection() {
  if (state.apartmentTransition) return;
  clearTimeout(_kvCheckTimeout);
  clearTimeout(_autoSaveTimeout);
  const original = state.apartmentSelectionOriginal;
  if (!original) return goHome();
  state.form = original.form;
  state.screen = original.screen;
  state.kvInputMode = original.mode;
  state.apartmentSelectionOriginal = null;
  render();
}
function renderNewVisitKv(app) {
  // Если режим не задан, ставим по умолчанию
  if (!state.kvInputMode) state.kvInputMode = 'main';

  const isMain = state.kvInputMode === 'main';
  const isFloor = state.kvInputMode === 'floor';

  app.innerHTML = `
    <div class="card">
      <div class="step-header"><div class="step-progress">Шаг 2</div><h2>Поиск квартиры</h2><p>Данные подтянутся из справочника.</p></div>

            <div class="field-group">
        <label class="field-label">Секция ${isFloor ? '*' : '(необязательно)'}</label>
        <select id="sectionInput" class="field-input" onchange="onSectionChange(this.value)" disabled>
          <option value="">Загрузка секций...</option>
        </select>
      </div>
      
      <div style="display:flex; gap:8px; margin-bottom:16px;">
        <button class="btn ${isMain ? 'btn-primary' : 'btn-secondary'}" style="flex:1; padding:10px 5px; font-size:14px;" onclick="switchKvInputMode('main')">По номеру</button>
        <button class="btn ${isFloor ? 'btn-primary' : 'btn-secondary'}" style="flex:1; padding:10px 5px; font-size:14px;" onclick="switchKvInputMode('floor')">По этажу</button>
      </div>

      ${isMain ? `
        <div class="field-group">
          <label class="field-label">Номер квартиры по тех.паспорту</label>
          <input id="kvInput" class="field-input" type="text" inputmode="numeric" placeholder="Например: 42" value="${escapeHtml(state.form.kvNumber || '')}" oninput="onKvInput(this.value)">
        </div>
      ` : `
        <div style="display:flex; gap:12px; margin-bottom:12px;">
          <div class="field-group" style="flex:1; margin-bottom:0;">
            <label class="field-label">Этаж</label>
            <input id="kvFloorInput" class="field-input" type="text" inputmode="numeric" placeholder="5" value="${escapeHtml(state.form.floorNumber || '')}" oninput="onFloorInput()">
          </div>
          <div class="field-group" style="flex:1; margin-bottom:0;">
            <label class="field-label">Квартира на этаже</label>
            <input id="kvNumFloorInput" class="field-input" type="text" inputmode="numeric" placeholder="2" value="${escapeHtml(state.form.floorKvNumber || '')}" oninput="onFloorInput()">
          </div>
        </div>
      `}

      <div id="kvResult"></div>
      <button class="btn btn-primary btn-large" id="kvNextBtn" onclick="onKvNext()" disabled>Далее →</button>
      <button class="btn btn-secondary" onclick="cancelApartmentSelection()">← Отмена</button>
    </div>
  `;

  // Восстанавливаем статус кнопки "Далее" и результат, если возвращаемся назад
    loadSectionOptions();
}



async function getSectionReference(houseId) {
  if (!houseId) throw new Error('Сначала выберите дом');
  let ref = await window.db.getReference(houseId);
  const valid = r => r && Object.keys(r).length > 0 &&
    Object.values(r).every(a => a && typeof a === 'object' && 'section' in a);
  if (!valid(ref) && navigator.onLine) {
    const res = await apiGet('getReference', { houseId }, 30000);
    ref = res.data;
    if (valid(ref)) await window.db.setReference(houseId, ref);
  }
  if (!valid(ref)) throw new Error('Обновите справочник при наличии интернета');
  return ref;
}

async function loadSectionOptions() {
  const select = document.getElementById('sectionInput');
  const houseId = state.form.houseId;
  try {
    const ref = await getSectionReference(houseId);
    if (document.getElementById('sectionInput') !== select) return;
    const sections = [...new Set(Object.values(ref)
      .map(a => String(a.section ?? '').trim()).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'ru', { numeric: true }));
    select.innerHTML = (state.kvInputMode === 'main'
  ? '<option value="">Любая секция</option>'
  : '<option value="">Выберите секцию</option>') +
      sections.map(s => `<option value="${escapeHtml(s)}">Секция ${escapeHtml(s)}</option>`).join('');
    select.value = String(state.form.section || '');
    select.disabled = false;
    if (state.form.apartment &&
    (state.kvInputMode === 'main' && !select.value ||
     select.value && String(state.form.apartment.section) === select.value)) {
      renderKvResultBlock();
      document.getElementById('kvNextBtn').disabled = false;
    }
  } catch (err) {
    if (document.getElementById('sectionInput') === select) {
      document.getElementById('kvResult').textContent = err.message;
    }
  }
}

function onSectionChange(value) {
  clearTimeout(_kvCheckTimeout);
  state.form.section = value;
  state.form.kvNumber = '';
  state.form.floorNumber = '';
  state.form.floorKvNumber = '';
  state.form.apartment = null;
  state.form.editedFields = {};
  render();
}

function switchKvInputMode(mode) {
  state.kvInputMode = mode;
  onSectionChange(state.form.section || '');
}

function onKvInput(value) {
  state.form.kvNumber = value;
  scheduleApartmentSearch();
}

function onFloorInput() {
  state.form.floorNumber = document.getElementById('kvFloorInput').value;
  state.form.floorKvNumber = document.getElementById('kvNumFloorInput').value;
  state.form.kvNumber = '';
  scheduleApartmentSearch();
}

function findSectionApartment(ref, section, mode, kv, floor, number) {
  const norm = v => String(v ?? '').trim().toLowerCase();

  return Object.entries(ref).filter(([key, apt]) =>
    (mode === 'main'
      ? norm(key) === norm(kv) &&
        (!norm(section) || norm(apt.section) === norm(section))
      : norm(section) &&
        norm(apt.section) === norm(section) &&
        norm(apt.floor) === norm(floor) &&
        norm(apt.numberOnFloor) === norm(number))
  );
}

function scheduleApartmentSearch() {
  clearTimeout(_kvCheckTimeout);
  const result = document.getElementById('kvResult');
  const btn = document.getElementById('kvNextBtn');
  const { houseId, section, kvNumber, floorNumber, floorKvNumber } = state.form;
  const mode = state.kvInputMode;
  state.form.apartment = null;
  state.form.editedFields = {};
  state.kvWarning = null;
  state.existingVisits = [];
  btn.disabled = true;
  result.textContent = '';
  if (mode === 'floor' && !section) {
  result.textContent = 'Сначала выберите секцию';
  return;
}
  if (mode === 'main' ? !String(kvNumber || '').trim() :
      !String(floorNumber || '').trim() || !String(floorKvNumber || '').trim()) return;
  result.textContent = 'Проверяем…';
  const current = () => document.getElementById('kvResult') === result &&
    state.screen === 'newVisitKv' && state.kvInputMode === mode &&
    state.form.houseId === houseId && state.form.section === section &&
    state.form.kvNumber === kvNumber && state.form.floorNumber === floorNumber &&
    state.form.floorKvNumber === floorKvNumber;
  _kvCheckTimeout = setTimeout(async () => {
    try {
      const ref = await getSectionReference(houseId);
      if (!current()) return;
      const matches = findSectionApartment(ref, section, mode, kvNumber, floorNumber, floorKvNumber);
      if (matches.length !== 1) {
        result.textContent = matches.length ? 'Несколько совпадений. Проверьте справочник.' : (section ? 'Квартира в выбранной секции не найдена' : 'Квартира не найдена');
        return;
      }
      const [kv, apt] = matches[0];
      state.form.kvNumber = kv;
      state.form.apartment = apt;
      renderKvResultBlock();
      btn.disabled = false;
    } catch (err) { if (current()) result.textContent = err.message; }
  }, 400);
}

let _kvCheckTimeout = null;

async function checkServerVisits(kv) {
  try {
    const res = await apiGet('checkVisitExists', { kvNumber: kv }, 10000);
    const data = (res && res.data) ? res.data : res;
    if (!data || !data.found) return;
    if (String(state.form.kvNumber || '').trim() !== String(kv).trim()) return;
    const latest = data.latest || {};
    let dt = '—';
    if (latest.date) { try { dt = new Date(latest.date).toLocaleString('ru-RU'); } catch (e) {} }
    const userName = latest.email || '—';
    const count = data.count || 1;
    state.kvWarning = { type: 'synced', date: dt, userName: userName, source: 'server', count: count };
    renderKvResultBlock();
  } catch (e) { console.warn('[checkServerVisits]', e.message); }
}

function renderKvResultBlock() {
  const result = document.getElementById('kvResult');
  if (!result) return;
  const apt = state.form.apartment;
  if (!apt) { result.innerHTML = ''; return; }
  let html = `
    <div class="apartment-preview">
          <div class="apartment-preview-title">✓ Квартира №${escapeHtml(state.form.kvNumber)}</div>
      <div>Секция: ${escapeHtml(apt.section)}</div>
      <div class="apartment-preview-grid">
        <div><span>Площадь:</span> ${escapeHtml(apt.area || '—')}</div>
        <div><span>Этаж:</span> ${escapeHtml(apt.floor || '—')}</div>
        <div><span>Комнат:</span> ${escapeHtml(apt.roomsNum || '—')}</div>
        <div><span>Санузлов:</span> ${escapeHtml(apt.bathrooms || '—')}</div>
      </div>
    </div>
  `;
  result.innerHTML = html;
}

function removeKvWarningBlock() { const el = document.getElementById('kvWarningBlock'); if (el) el.remove(); }

async function checkApartmentSmart(kv) {
  const kvKey = String(kv).trim().toLowerCase();
  const houseId = state.form.houseId;

  if (!navigator.onLine) {
    const ref = await window.db.getReference(houseId); // <-- передаем houseId
    if (ref && ref[kvKey]) return { found: true, kv: kv, data: ref[kvKey], fromCache: true };
    return { found: false, kv: kv, fromCache: true };
  }
  try {
    const res = await apiGet('checkApartment', { kvNumber: kv, houseId: houseId }, 8000); // <-- передаем houseId
    return res.data || res;
  } catch (netErr) {
    const ref = await window.db.getReference(houseId);
    if (ref && ref[kvKey]) return { found: true, kv: kv, data: ref[kvKey], fromCache: true };
    throw netErr;
  }
}
// Фоновая загрузка фото для онлайна
async function backgroundDownloadPhotos(payload, kv) {
  if (!navigator.onLine) return;
  
  const tasks = [];
  Object.keys(payload.results || {}).forEach(stateKey => {
    const rs = payload.results[stateKey];
    (rs.commonPhotos || []).forEach((p, i) => {
      if (p.url && !p.photoId) tasks.push({ url: p.url, stateKey, variantKey: '', idx: i, isCommon: true });
    });
    Object.keys(rs.photosByVariant || {}).forEach(variant => {
      (rs.photosByVariant[variant] || []).forEach((p, i) => {
        if (p.url && !p.photoId) tasks.push({ url: p.url, stateKey, variantKey: variant, idx: i, isCommon: false });
      });
    });
  });

  (payload.extraPhotos || []).forEach((p, i) => {
    if (p.url && !p.photoId) tasks.push({ url: p.url, stateKey: '__extra__', variantKey: '', idx: i, isCommon: false, isExtra: true });
  });

  if (!tasks.length) return;

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    try {
      const blob = await fetchPhotoAsBlob(task.url);
      if (blob) {
        const base64 = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });

        const photoId = window.db.uuid();
        const fileName = buildFileName(task.stateKey.split('.')[0] || 'server', task.stateKey.split('.')[1] || 'photo', task.idx + 1);
        const remoteData = { url: task.url };

        // Сохраняем в базу
        await window.db.addPhoto({
          photoId: photoId,
          visitClientId: 'bg_' + Date.now(), // Временный ID, так как это фоновая загрузка
          stateKey: task.stateKey,
          variantKey: task.variantKey,
          fileName: fileName,
          kvNumber: kv,
          blob: blob,
          base64: base64,
          status: 'pending',
          attempts: 0,
          lastError: '',
          remote: remoteData,
          localUrl: base64,
          fromServer: true
        });

        // Обновляем данные в памяти
        if (task.isExtra) {
          payload.extraPhotos[task.idx] = { photoId: photoId, localUrl: base64, name: fileName, fromServer: true, remote: remoteData };
        } else {
          const rs = payload.results[task.stateKey];
          if (rs) {
            const arr = task.isCommon ? (rs.commonPhotos || []) : (rs.photosByVariant[task.variantKey] || []);
            arr[task.idx] = { photoId: photoId, localUrl: base64, name: fileName, fromServer: true, remote: remoteData };
            if (task.isCommon) rs.commonPhotos = arr;
            else rs.photosByVariant[task.variantKey] = arr;
          }
        }
      }
    } catch (err) {
      console.warn('[bg download] Ошибка фото:', task.url, err.message);
    }
    await new Promise(r => setTimeout(r, 100));
  }
}
async function onKvNext() {
  if (state.apartmentTransition || state.screen !== 'newVisitKv' ||
      !state.form.apartment || !state.form.houseId) return;
  if (state.kvInputMode === 'floor' && !state.form.section) return;
  if (state.form.section &&
      String(state.form.apartment.section) !== String(state.form.section)) return;

  const candidate = state.form;
  const previousId = state.draftId;
  state.apartmentTransition = true;
  document.getElementById('app').innerHTML = '<div class="loading">Проверяем квартиру…</div>';
  try {
    const ref = await getSectionReference(candidate.houseId);
    const matches = findSectionApartment(ref, candidate.section, state.kvInputMode,
      candidate.kvNumber, candidate.floorNumber, candidate.floorKvNumber);
    if (matches.length !== 1) throw new Error('Квартира не найдена однозначно в справочнике');
    const [kv, apt] = matches[0];
    const original = state.apartmentSelectionOriginal;
    const same = original && original.form.houseId === candidate.houseId &&
      original.form.kvNumber === kv;
    state.form = Object.assign({}, candidate, {
      kvNumber: kv, apartment: Object.assign({}, apt),
      section: String(apt.section ?? '').trim(),
      floorNumber: String(apt.floor ?? ''),
      floorKvNumber: String(apt.numberOnFloor ?? ''),
      editedFields: same ? Object.assign({}, original.form.editedFields) : {},
      sourceVisitId: same ? original.form.sourceVisitId : null
    });
    state.draftId = previousId || window.db.uuid();
    state.screen = 'newVisitRef';
    if (!original && !await autoSave()) throw new Error('Не удалось сохранить черновик');
  } catch (err) {
    state.form = candidate;
    state.draftId = previousId;
    state.screen = 'newVisitKv';
    alert(err.message);
  } finally {
    state.apartmentTransition = false;
    render();
  }
}
// ================= ШАГ 2 =================
function renderNewVisitRef(app) {
  state.isSubmittingRef = false;
  const apt = state.form.apartment || {};
  const edited = state.form.editedFields || {};
  const val = (field, fallback) => edited[field] !== undefined ? edited[field] : (fallback || '');
  const roomsNumRaw = edited.roomsNum !== undefined ? edited.roomsNum : (apt.roomsNum || '');
  const roomsNum = parseInt(String(roomsNumRaw).replace(/\D/g, ''), 10) || 0;
  const showWinR2 = roomsNum >= 2;
  const showWinR3 = roomsNum >= 3;
  app.innerHTML = `
    <div class="card">
      <div class="step-header"><div class="step-progress">Шаг 2</div><h2>Справочные данные</h2><p>Проверьте данные из справочника.</p></div>
      <div class="field-group"><label class="field-label">Площадь, кв.м</label><input class="field-input" type="text" inputmode="decimal" value="${escapeHtml(val('area', apt.area))}" oninput="onRefEdit('area', this.value)"></div>
      <div class="field-group"><label class="field-label">Этаж</label><input class="field-input" type="text" inputmode="numeric" value="${escapeHtml(val('floor', apt.floor))}" oninput="onRefEdit('floor', this.value)"></div>
      <div class="field-group"><label class="field-label">Комнатность</label><input class="field-input" type="text" value="${escapeHtml(val('rooms', apt.rooms))}" oninput="onRefEdit('rooms', this.value)"></div>
      <div class="field-group"><label class="field-label">Комнат (число)</label><input class="field-input" id="roomsNumInput" type="text" inputmode="numeric" value="${escapeHtml(val('roomsNum', apt.roomsNum))}" oninput="onRefEditRoomsNum(this.value)"></div>
      <div class="field-group"><label class="field-label">Санузлов</label><input class="field-input" type="text" inputmode="numeric" value="${escapeHtml(val('bathrooms', apt.bathrooms))}" oninput="onRefEdit('bathrooms', this.value)"></div>
      <div class="field-group"><label class="field-label">Прачечная</label><input class="field-input" type="text" value="${escapeHtml(val('laundry', apt.laundry))}" oninput="onRefEdit('laundry', this.value)"></div>
      <div class="field-group"><label class="field-label">Гардеробная</label><input class="field-input" type="text" value="${escapeHtml(val('wardrobe', apt.wardrobe))}" oninput="onRefEdit('wardrobe', this.value)"></div>
      <div class="field-group"><label class="field-label">Окон в ЖК №1</label><input class="field-input" type="text" inputmode="numeric" value="${escapeHtml(val('winR1', apt.winR1))}" oninput="onRefEdit('winR1', this.value)"></div>
      ${showWinR2 ? `<div class="field-group"><label class="field-label">Окон в ЖК №2</label><input class="field-input" type="text" inputmode="numeric" value="${escapeHtml(val('winR2', apt.winR2))}" oninput="onRefEdit('winR2', this.value)"></div>` : ''}
      ${showWinR3 ? `<div class="field-group"><label class="field-label">Окон в ЖК №3</label><input class="field-input" type="text" inputmode="numeric" value="${escapeHtml(val('winR3', apt.winR3))}" oninput="onRefEdit('winR3', this.value)"></div>` : ''}
      <div class="field-group"><label class="field-label">Окон на кухне</label><input class="field-input" type="text" inputmode="numeric" value="${escapeHtml(val('winK', apt.winK))}" oninput="onRefEdit('winK', this.value)"></div>
      <button class="btn btn-primary btn-large" onclick="onRefNext()">Далее →</button>
      <button class="btn btn-secondary" onclick="backToKv()">← Назад</button>
    </div>
  `;
}

function onRefEdit(field, value) {
  if (state.apartmentTransition) return;
  state.form.editedFields[field] = value;
  debouncedAutoSave();
}

function onRefEditRoomsNum(value) {
  if (state.apartmentTransition) return;
  state.form.editedFields.roomsNum = value;
  const app = document.getElementById('app');
  renderNewVisitRef(app);
  debouncedAutoSave();
  setTimeout(() => {
    const input = document.getElementById('roomsNumInput');
    if (input) { input.focus(); const len = input.value.length; try { input.setSelectionRange(len, len); } catch (e) {} }
  }, 0);
}

// Сопоставление объектов по постоянным ключам, а не по порядку в форме.
function inspectionPhotoIds(form) {
  const ids = new Set();
  const add = arr => (arr || []).forEach(p => { if (p && p.photoId) ids.add(p.photoId); });
  Object.values(form.results || {}).forEach(rs => {
    if (!rs) return;
    add(rs.commonPhotos);
    add(rs.photos);
    Object.values(rs.photosByVariant || {}).forEach(add);
  });
  add(form.extraPhotos);
  return ids;
}

function reconcileInspection(oldForm, divisions) {
  const valid = new Set();
  const labels = new Map();
  (oldForm.divisions || []).forEach(div => div.objects.forEach(obj => {
    labels.set(div.key + '.' + obj.key, div.title + '. ' + obj.label);
  }));
  divisions.forEach(div => div.objects.forEach(obj => {
    valid.add(div.key + '.' + obj.key);
  }));
  const results = {};
  const removed = [];
  Object.entries(oldForm.results || {}).forEach(([key, rs]) => {
    if (!rs) return;
    if (valid.has(key)) {
      results[key] = Object.assign({}, rs);
      delete results[key].error;
      return;
    }
    const photos = (rs.commonPhotos || []).length + (rs.photos || []).length +
      Object.values(rs.photosByVariant || {}).reduce((n, arr) => n + (arr || []).length, 0);
    const answers = (rs.selected || []).length + (String(rs.custom || '').trim() ? 1 : 0);
    if (answers || photos || rs.noIssues || Object.keys(rs.volumes || {}).length) {
      removed.push((labels.get(key) || key) + ' — ' + answers + ' замеч., ' + photos + ' фото' +
        (rs.noIssues ? ', «Замечаний нет»' : ''));
    }
  });
  const kept = inspectionPhotoIds({ results, extraPhotos: oldForm.extraPhotos });
  const removeIds = [...inspectionPhotoIds(oldForm)].filter(id => !kept.has(id));
  return { results, removed, removeIds };
}

async function onRefNext() {
  if (state.apartmentTransition || state.isSubmittingRef || state.isSubmitting ||
      state.screen !== 'newVisitRef' || !state.draftId || !state.form.apartment ||
      !state.form.houseId || !state.form.kvNumber) return;
  if (_deletingPhoto || Object.keys(state.form.uploading || {}).length) {
    alert('Дождитесь сохранения фотографий.');
    return;
  }
  clearTimeout(_autoSaveTimeout);
  state.apartmentTransition = true;
  state.isSubmittingRef = true;
  const candidate = state.form;
  const original = state.apartmentSelectionOriginal;
  const oldForm = original ? original.form : candidate;
  const draftId = state.draftId;
  document.getElementById('app').innerHTML = '<div class="loading">Загрузка...</div>';
  try {
    const apartment = Object.assign({}, candidate.apartment, candidate.editedFields);
    const data = await getFormDataSmart(apartment);
    const divisions = data && data.divisions;
    if (!Array.isArray(divisions) || !divisions.length ||
        divisions.some(d => !d || !d.key || !Array.isArray(d.objects) ||
          d.objects.some(o => !o || !o.key))) {
      throw new Error('Некорректная структура формы');
    }
    const plan = reconcileInspection(oldForm, divisions);
    if (plan.removed.length && !confirm(
      'Из осмотра будут исключены заполненные блоки:\n\n' +
      plan.removed.join('\n') + '\n\nОстальные данные сохранятся. Продолжить?'
    )) return;

    const next = Object.assign({}, candidate, {
      apartment, divisions, results: plan.results,
      currentDivisionIndex: 0, uploading: {},
      comments: oldForm.comments, extraPhotos: oldForm.extraPhotos || []
    });
    // До подтверждённой записи старый черновик и фото не трогаем.
    if (!await saveInspectionDraft(next, 'division')) {
      throw new Error('Не удалось сохранить изменённый черновик');
    }
    state.form = next;
    state.apartmentSelectionOriginal = null;
    state.screen = 'division';

    // Удаляем только локальные записи этого черновика, не используемые новой формой.
    for (const id of plan.removeIds) {
      try {
        const photo = await window.db.getPhoto(id);
        if (photo && photo.visitClientId === draftId) await window.db.deletePhoto(id);
      } catch (err) { console.warn('Не удалена исключённая фотография', err); }
    }
  } catch (err) {
    alert('Не удалось обновить форму: ' + err.message);
  } finally {
    state.isSubmittingRef = false;
    state.apartmentTransition = false;
    render();
    window.scrollTo(0, 0);
  }
}

async function getFormDataSmart(apartment) {
  try {
    const res = await apiGet('getFormData', { apartment: apartment, houseId: state.form.houseId });
    return res.data || res;
  } catch (netErr) {
    console.warn('[form] Сеть недоступна, собираем форму локально:', netErr.message);
    const remarks = await window.db.getRemarks();
    if (remarks && window.localForm && window.localForm.buildFormData) return window.localForm.buildFormData(apartment, remarks);
    throw new Error('Нет сети и нет локального кэша. Откройте приложение один раз онлайн.');
  }
}

async function backToKv() {
  if (state.apartmentTransition || state.isSubmitting || state.isSubmittingRef ||
      state.screen !== 'newVisitRef') return;
  if (_deletingPhoto || Object.keys(state.form.uploading || {}).length) {
    alert('Дождитесь сохранения фотографий.');
    return;
  }
  state.apartmentTransition = true;
  try {
    if (!state.apartmentSelectionOriginal) {
      if (!state.draftId || !await autoSave()) throw new Error('Не удалось сохранить исходный черновик');
      state.apartmentSelectionOriginal = {
        form: state.form, screen: state.screen, mode: state.kvInputMode
      };
      // Поиск работает с отдельной копией реквизитов; исходные ответы не меняются.
      state.form = Object.assign({}, state.form, {
        apartment: Object.assign({}, state.form.apartment),
        editedFields: Object.assign({}, state.form.editedFields)
      });
    }
    clearTimeout(_autoSaveTimeout);
    state.screen = 'newVisitKv';
    render();
  } catch (err) { alert(err.message); }
  finally { state.apartmentTransition = false; }
}

async function goHome() {
  if (state.apartmentTransition || state.isSubmitting || _deletingPhoto ||
      Object.keys(state.form.uploading || {}).length) {
    alert('Дождитесь сохранения данных.');
    return;
  }
  clearTimeout(_autoSaveTimeout);
  if (state.apartmentSelectionOriginal) {
    cancelApartmentSelection();
    return;
  }
  if (['newVisitRef', 'division'].includes(state.screen) && state.draftId) {
    if (!await autoSave()) {
      alert('Не удалось сохранить черновик.');
      return;
    }
  }
  try {
    state.pendingDraft = await window.db.loadDraft(true);
    state.screen = 'home';
    await refreshQueueStats();
    render();
  } catch (err) {
    alert('Не удалось прочитать черновик: ' + err.message);
  }
}

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
      <div class="step-header"><div class="step-progress">${progressText}</div><h2>${escapeHtml(div.title)}</h2><p>Отметьте замечания по каждому объекту.</p></div>
      <div class="objects-list" id="objectsList">${objectsHtml || '<div class="hint">В этом разделе нет объектов.</div>'}</div>
      <button class="btn btn-primary btn-large" onclick="onDivisionNext()">${isLast ? '✓ Завершить и отправить' : 'Далее →'}</button>
      <button class="btn btn-secondary" onclick="onDivisionBack()">← Назад</button>
    </div>
  `;
}

function renderObjectCard(divKey, obj) {
  const stateKey = divKey + '.' + obj.key;
  const objState = state.form.results[stateKey] || { selected: [], custom: '', noIssues: false, commonPhotos: [], photosByVariant: {}, volumes: {} };
  if (!objState.volumes) objState.volumes = {};
  if (!objState.commonPhotos) objState.commonPhotos = [];
  if (!objState.photosByVariant) objState.photosByVariant = {};

  const commonPhotosHtml = (objState.commonPhotos || []).map((p, i) => {
    // ВАЖНО: сначала localUrl (Base64/Blob для офлайна), потом url (ссылка с сервера)
    const imgSrc = p.localUrl || p.url || '';
    return `
    <div class="photo-item">
      <img src="${escapeAttr(imgSrc)}" alt="Фото ${i + 1}" class="photo-thumb">
      <button type="button" class="photo-remove" onclick="removePhotoFromSection('${escapeAttr(stateKey)}', '__common__', ${i})">${iconX(14)}</button>
    </div>
  `}).join('');

  const commonUploading = state.form.uploading[stateKey + '__common__'];
  let commonUploadingHtml = '';
  if (commonUploading) commonUploadingHtml = `<div class="photo-item photo-uploading"><div class="photo-spinner"></div><div class="photo-uploading-text">${commonUploading.current} из ${commonUploading.total}</div></div>`;

  const commonSection = `
    <div class="photo-section common-view">
      <div class="photo-section-title">Общий вид</div>
      <div class="photo-list">${commonPhotosHtml}${commonUploadingHtml}</div>
      <label class="photo-add-label">
        <input type="file" accept="image/*" multiple style="display:none" onchange="onPhotoSelected2(event, '${escapeAttr(stateKey)}', '__common__')">
        <span class="photo-add-btn">${iconCamera(18)}<span>Добавить фото</span></span>
      </label>
    </div>
  `;

  const variantsHtml = (obj.variants || []).map((v) => {
    const isSelected = objState.selected.includes(v.variant);
    const vol = objState.volumes[v.variant];
    
    // Логика бейджа объема
    let volBadge = '';
    if (isSelected) {
      const hasVolume = vol && vol.value;
      const requiresVolume = v.requireVolume;
      
      if (hasVolume) {
        // Если объем уже есть - показываем зеленый бейдж с цифрой
        volBadge = `<span class="volume-badge" onclick="event.stopPropagation(); editVolume('${escapeAttr(stateKey)}', '${escapeAttr(v.variant)}', '${escapeAttr(v.unit || '')}')">${escapeHtml(vol.value)} ${escapeHtml(vol.unit || '')}</span>`;
      } else if (requiresVolume) {
        // Если объем требуется, но его нет - показываем красную кнопку
        volBadge = `<span class="volume-badge" style="background:#FFEBEE; color:#E53935; border: 1px solid #E53935;" onclick="event.stopPropagation(); editVolume('${escapeAttr(stateKey)}', '${escapeAttr(v.variant)}', '${escapeAttr(v.unit || '')}')">⚠ Указать объем</span>`;
      }
    }

    let photosUnderChip = '';
    if (isSelected) {
      const photos = (objState.photosByVariant && objState.photosByVariant[v.variant]) || [];
      const photosHtml = photos.map((p, i) => {
        // ВАЖНО: сначала localUrl (Base64/Blob для офлайна), потом url (ссылка с сервера)
        const imgSrc = p.localUrl || p.url || '';
        return `
        <div class="photo-item">
          <img src="${escapeAttr(imgSrc)}" alt="Фото ${i + 1}" class="photo-thumb">
          <button type="button" class="photo-remove" onclick="removePhotoFromSection('${escapeAttr(stateKey)}', '${escapeAttr(v.variant)}', ${i})">${iconX(14)}</button>
        </div>
      `}).join('');
      
      const uploading = state.form.uploading[stateKey + '__' + v.variant];
      let uploadingHtml = '';
      if (uploading) uploadingHtml = `<div class="photo-item photo-uploading"><div class="photo-spinner"></div><div class="photo-uploading-text">${uploading.current} из ${uploading.total}</div></div>`;

      photosUnderChip = `
        <div class="chip-photos">
          ${(photosHtml || uploadingHtml) ? `<div class="photo-list">${photosHtml}${uploadingHtml}</div>` : ''}
          <label class="photo-add-label">
            <input type="file" accept="image/*" multiple style="display:none" onchange="onPhotoSelected2(event, '${escapeAttr(stateKey)}', '${escapeAttr(v.variant)}')">
            <span class="photo-add-btn small">${iconCamera(16)}<span>Добавить фото</span></span>
          </label>
        </div>
      `;
    }

    return `
      <div class="chip-and-photos">
        <span class="chip-wrap">
          <button type="button" class="chip ${isSelected ? 'chip-selected' : ''}" onclick="onChipClick('${escapeAttr(stateKey)}', '${escapeAttr(v.variant)}', ${v.requireVolume ? 'true' : 'false'}, '${escapeAttr(v.unit || '')}')">${escapeHtml(v.variant)}</button>
          ${volBadge}
        </span>
        ${photosUnderChip}
      </div>
    `;
  }).join('');

  const noIssuesHtml = `<button type="button" class="chip chip-no-issues ${objState.noIssues ? 'chip-selected' : ''}" onclick="toggleNoIssues('${escapeAttr(stateKey)}')">✓ Замечаний нет</button>`;
  const customHtml = `<textarea class="custom-input" rows="2" placeholder="Своё замечание (если нужно)" oninput="onCustomInput('${escapeAttr(stateKey)}', this.value)">${escapeHtml(objState.custom || '')}</textarea>`;
  const error = objState.error ? `<div class="obj-error">${escapeHtml(objState.error)}</div>` : '';

  return `
    <div class="object-card" data-state-key="${escapeAttr(stateKey)}">
      <div class="object-title">${escapeHtml(obj.label)}</div>
      ${commonSection}
      <div class="chips-row">${noIssuesHtml}</div>
      <div class="chips-with-photos">${variantsHtml}</div>
      ${customHtml}
      ${error}
    </div>
  `;
}
function onChipClick(stateKey, variant, requireVolume, unit) {
  const rs = state.form.results[stateKey] || { selected: [], custom: '', noIssues: false, commonPhotos: [], photosByVariant: {}, volumes: {} };
  if (!rs.volumes) rs.volumes = {};
  if (!rs.photosByVariant) rs.photosByVariant = {};
  rs.noIssues = false;
  const i = rs.selected.indexOf(variant);
  const wasSelected = i >= 0;
  if (wasSelected) {
    rs.selected.splice(i, 1);
    delete rs.volumes[variant];
    const photosToDelete = rs.photosByVariant[variant] || [];
    photosToDelete.forEach(p => { if (p && p.photoId && window.db && window.db.deletePhoto) window.db.deletePhoto(p.photoId).catch(() => {}); });
    delete rs.photosByVariant[variant];
    rs.error = null;
    state.form.results[stateKey] = rs;
    updateObjectCard(stateKey);
    autoSave();
    return;
  }
  rs.selected.push(variant);
  rs.error = null;
  state.form.results[stateKey] = rs;
  if (requireVolume) {
    updateObjectCard(stateKey);
    openVolumeModal(stateKey, variant, unit, rs.volumes[variant] ? rs.volumes[variant].value : '');
  } else {
    updateObjectCard(stateKey);
    autoSave();
  }
}

function editVolume(stateKey, variant, unit) {
  const rs = state.form.results[stateKey] || { volumes: {} };
  const current = (rs.volumes && rs.volumes[variant]) ? rs.volumes[variant].value : '';
  openVolumeModal(stateKey, variant, unit, current);
}

function toggleNoIssues(stateKey) {
  const rs = state.form.results[stateKey] || { selected: [], custom: '', noIssues: false, commonPhotos: [], photosByVariant: {}, volumes: {} };
  rs.noIssues = !rs.noIssues;
  if (rs.noIssues) {
    Object.keys(rs.photosByVariant || {}).forEach(variant => {
      (rs.photosByVariant[variant] || []).forEach(p => { if (p && p.photoId && window.db && window.db.deletePhoto) window.db.deletePhoto(p.photoId).catch(() => {}); });
    });
    rs.selected = [];
    rs.volumes = {};
    rs.photosByVariant = {};
  }
  rs.error = null;
  state.form.results[stateKey] = rs;
  updateObjectCard(stateKey);
  autoSave();
}

function onCustomInput(stateKey, value) {
  const rs = state.form.results[stateKey] || { selected: [], custom: '', noIssues: false, commonPhotos: [], photosByVariant: {}, volumes: {} };
  rs.custom = value;
  rs.error = null;
  state.form.results[stateKey] = rs;
  debouncedAutoSave();
}

// ================= ФОТО =================
async function onPhotoSelected2(event, stateKey, variantKey) {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;
  event.target.value = '';

  const rs = state.form.results[stateKey] || { selected: [], custom: '', noIssues: false, commonPhotos: [], photosByVariant: {}, volumes: {} };
  if (!rs.commonPhotos) rs.commonPhotos = [];
  if (!rs.photosByVariant) rs.photosByVariant = {};

  const uploadKey = stateKey + (variantKey === '__common__' ? '__common__' : ('__' + variantKey));
  state.form.uploading[uploadKey] = { current: 0, total: files.length };
  updateObjectCard(stateKey);

  const kv = state.form.kvNumber;
  const divisionKey = stateKey.split('.')[0];
  const objectKey = stateKey.split('.')[1];
  const draftId = state.draftId || (state.draftId = window.db.uuid());
  const isCommon = variantKey === '__common__';
  const photosArray = isCommon ? rs.commonPhotos : (rs.photosByVariant[variantKey] || []);

  for (let i = 0; i < files.length; i++) {
    state.form.uploading[uploadKey] = { current: i + 1, total: files.length };
    updateObjectCard(stateKey);
    try {
      const file = files[i];
      const blob = await compressImageToBlob(file);
      const fileName = buildFileName(divisionKey, objectKey, i + 1 + photosArray.length);
      const photoId = window.db.uuid();
      const localUrl = URL.createObjectURL(blob);

      // НОВОЕ: Сохраняем в OPFS
      const opfsFileName = 'photo_' + photoId + '.jpg';
      const opfsSaved = await window.db.opfsWriteFile(opfsFileName, blob);

      // Fallback на ArrayBuffer, если OPFS недоступен (например, старый Safari)
      let photoData = null;
      let photoType = null;
      if (!opfsSaved) {
        photoData = await blob.arrayBuffer();
        photoType = blob.type || 'image/jpeg';
      }

      const photoRecord = { 
        photoId: photoId, 
        visitClientId: draftId, 
        stateKey: stateKey, 
        variantKey: isCommon ? '' : variantKey, 
        fileName: fileName, 
        kvNumber: kv, 
        opfsFileName: opfsSaved ? opfsFileName : null, // <--- Добавлено поле для OPFS
        photoData: photoData, // Fallback
        photoType: photoType, // Fallback
        status: 'pending', 
        attempts: 0, 
        lastError: '', 
        remote: null, 
        localUrl: localUrl 
      };
      
            if (!await window.db.addPhoto(photoRecord)) {
        throw new Error('Не удалось записать фотографию в локальное хранилище');
      }

      const photoItem = { photoId: photoId, localUrl: localUrl, name: fileName, objectKey: objectKey, divisionKey: divisionKey, variantKey: isCommon ? '' : variantKey };
      
      if (isCommon) rs.commonPhotos.push(photoItem);
      else { 
        if (!rs.photosByVariant[variantKey]) rs.photosByVariant[variantKey] = []; 
        rs.photosByVariant[variantKey].push(photoItem); 
      }
      
      state.form.results[stateKey] = rs;
      updateObjectCard(stateKey);
      autoSave();
    } catch (err) { 
      console.error('Ошибка сохранения фото:', err); 
      alert('Не удалось сохранить фото: ' + (err.message || err)); 
    }
  }
  delete state.form.uploading[uploadKey];
  updateObjectCard(stateKey);
}

function removePhotoFromSection(stateKey, variantKey, index) {
  if (_deletingPhoto) return;
  _deletingPhoto = true;
  setTimeout(() => { _deletingPhoto = false; }, 500);
  const rs = state.form.results[stateKey];
  if (!rs) return;
  if (!confirm('Удалить это фото?')) return;
  const isCommon = variantKey === '__common__';
  const arr = isCommon ? (rs.commonPhotos || []) : ((rs.photosByVariant && rs.photosByVariant[variantKey]) || []);
  const photo = arr[index];
  if (photo && photo.photoId && window.db && window.db.deletePhoto) window.db.deletePhoto(photo.photoId).catch(() => {});
  arr.splice(index, 1);
  if (isCommon) rs.commonPhotos = arr;
  else rs.photosByVariant[variantKey] = arr;
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
        const MAX_WIDTH = 1000;
        const MAX_HEIGHT = 1000;
        let w = img.width, h = img.height;
        if (w > MAX_WIDTH || h > MAX_HEIGHT) { const ratio = Math.min(MAX_WIDTH / w, MAX_HEIGHT / h); w = Math.round(w * ratio); h = Math.round(h * ratio); }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => { if (!blob) reject(new Error('Не удалось сжать изображение')); else resolve(blob); }, 'image/jpeg', 0.7);
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
      <button type="button" class="photo-remove" onclick="removeExtraPhoto(${i})">${iconX(14)}</button>
    </div>
  `).join('');
  let uploadingHtml = '';
  if (uploading) uploadingHtml = `<div class="photo-item photo-uploading"><div class="photo-spinner"></div><div class="photo-uploading-text">${uploading.current} из ${uploading.total}</div></div>`;

  app.innerHTML = `
    <div class="card">
      <div class="step-header"><div class="step-progress">${progressText}</div><h2>${escapeHtml(div.title)}</h2><p>Общий комментарий и дополнительные фото.</p></div>
      <div class="field-group"><label class="field-label">Комментарий</label><textarea class="custom-input" rows="4" placeholder="Если есть что добавить..." oninput="onCommentsInput(this.value)">${escapeHtml(comments)}</textarea></div>
      <div class="field-group">
        <label class="field-label">Дополнительные фото</label>
        <div class="photo-block">
          <div class="photo-list">${photoItemsHtml}${uploadingHtml}</div>
          <label class="photo-add-label">
            <input type="file" accept="image/*" multiple style="display:none" onchange="onExtraPhotoSelected(event)">
            <span class="photo-add-btn">${iconCamera(20)}<span>Добавить фото</span></span>
          </label>
        </div>
      </div>
      <button class="btn btn-primary btn-large" onclick="onDivisionNext()">${isLast ? '✓ Завершить и отправить' : 'Далее →'}</button>
      <button class="btn btn-secondary" onclick="onDivisionBack()">← Назад</button>
    </div>
  `;
}

function onCommentsInput(value) { state.form.comments = value; debouncedAutoSave(); }

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

      // 1. Пытаемся сохранить в OPFS
      const opfsFileName = 'extra_' + photoId + '.jpg';
      const opfsSaved = await window.db.opfsWriteFile(opfsFileName, blob);

      // 2. Fallback на ArrayBuffer, если OPFS недоступен
      let photoData = null;
      let photoType = null;
      if (!opfsSaved) {
        photoData = await blob.arrayBuffer();
        photoType = blob.type || 'image/jpeg';
      }

      const photoRecord = {
        photoId: photoId,
        visitClientId: draftId,
        stateKey: '__extra__',
        variantKey: '',
        fileName: fileName,
        kvNumber: kv,
        opfsFileName: opfsSaved ? opfsFileName : null, // <--- Добавлено поле для OPFS
        photoData: photoData, // Fallback
        photoType: photoType, // Fallback
        status: 'pending',
        attempts: 0,
        lastError: '',
        remote: null,
        localUrl: localUrl
      };

            if (!await window.db.addPhoto(photoRecord)) {
        throw new Error('Не удалось записать фотографию в локальное хранилище');
      }

      state.form.extraPhotos.push({ photoId: photoId, localUrl: localUrl, name: fileName });
      
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
  if (photo && photo.photoId && window.db && window.db.deletePhoto) window.db.deletePhoto(photo.photoId).catch(() => {});
  state.form.extraPhotos.splice(index, 1);
  render();
  autoSave();
}

// ================= НАВИГАЦИЯ =================
async function onDivisionNext() {
  const div = state.form.divisions[state.form.currentDivisionIndex];
  if (!div) return;
  
  if (div.key === 'dopolnitelno') {
    if (state.form.currentDivisionIndex + 1 < state.form.divisions.length) { state.form.currentDivisionIndex++; render(); window.scrollTo(0, 0); autoSave(); return; }
    await submitVisit();
    return;
  }
  
  let hasError = false;
  let firstErrorKey = null;
  
  div.objects.forEach(obj => {
    const stateKey = div.key + '.' + obj.key;
    const rs = state.form.results[stateKey] || { selected: [], custom: '', noIssues: false, commonPhotos: [], photosByVariant: {}, volumes: {} };
    const hasSelection = rs.selected.length > 0;
    const hasCustom = String(rs.custom || '').trim().length > 0;
    const hasNoIssues = rs.noIssues === true;
    
    // 1. Проверка на пустой объект
    if (!hasSelection && !hasCustom && !hasNoIssues) {
      rs.error = 'Отметьте замечание, «Замечаний нет» или впишите своё';
      state.form.results[stateKey] = rs;
      hasError = true;
      if (!firstErrorKey) firstErrorKey = stateKey;
      return;
    }

    // 2. Проверка на наличие фото
    const hasCommonPhotos = (rs.commonPhotos || []).length > 0;
    const hasAnyPhoto = hasCommonPhotos || Object.keys(rs.photosByVariant || {}).some(v => (rs.photosByVariant[v] || []).length > 0);
    if ((hasSelection || hasCustom) && !hasAnyPhoto) {
      rs.error = 'Приложите хотя бы одно фото';
      state.form.results[stateKey] = rs;
      hasError = true;
      if (!firstErrorKey) firstErrorKey = stateKey;
      return;
    }

    // 3. НОВАЯ ПРОВЕРКА: Проверка на заполнение объемов
    if (rs.selected && rs.selected.length > 0) {
      const volumes = rs.volumes || {};
      const missingVolumes = [];
      
      rs.selected.forEach(variantName => {
        // Ищем замечание в списке вариантов этого объекта
        const variantObj = (obj.variants || []).find(v => v.variant === variantName);
        if (variantObj && variantObj.requireVolume) {
          const vol = volumes[variantName];
          if (!vol || !vol.value || String(vol.value).trim() === '') {
             missingVolumes.push(variantName);
          }
        }
      });

      if (missingVolumes.length > 0) {
        rs.error = `Укажите объём для: ${missingVolumes.join(', ')}`;
        state.form.results[stateKey] = rs;
        hasError = true;
        if (!firstErrorKey) firstErrorKey = stateKey;
        return;
      }
    }
  });
  
  if (hasError) {
    render();
    setTimeout(() => {
      let target = null;
      if (firstErrorKey) target = document.querySelector(`[data-state-key="${cssEscape(firstErrorKey)}"]`);
      if (!target) target = document.querySelector('.obj-error');
      if (target) { const y = target.getBoundingClientRect().top + window.pageYOffset - 80; window.scrollTo({ top: y, behavior: 'smooth' }); }
      else window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 50);
    return;
  }
  
  if (state.form.currentDivisionIndex + 1 < state.form.divisions.length) { state.form.currentDivisionIndex++; render(); window.scrollTo(0, 0); autoSave(); return; }
  await submitVisit();
}

function onDivisionBack() {
  if (state.apartmentTransition || state.isSubmitting || _deletingPhoto ||
      Object.keys(state.form.uploading || {}).length) {
    alert('Дождитесь сохранения данных.');
    return;
  }
  if (state.form.currentDivisionIndex > 0) {
    state.form.currentDivisionIndex--;
    render();
    window.scrollTo(0, 0);
  } else {
    state.screen = 'newVisitRef';
    render();
  }
  autoSave();
}
// ================= ОТПРАВКА =================
async function submitVisit() {
  if (state.isSubmitting) return;
  if (!state.form.houseId || !state.form.kvNumber || !state.draftId || !state.form.apartment) {
    alert('В осмотре отсутствуют данные литера, квартиры или черновика. Отправка остановлена.');
    return;
  }
  if (Object.keys(state.form.uploading || {}).length) {
    alert('Дождитесь сохранения фотографий.');
    return;
  }

  // ПРОВЕРКА ОБЪЕМОВ ПЕРЕД ОТПРАВКОЙ
  let missingVolumesError = null;
  let errorDivisionIndex = -1;

  state.form.divisions.forEach((div, divIdx) => {
    div.objects.forEach(obj => {
      const stateKey = div.key + '.' + obj.key;
      const rs = state.form.results[stateKey];
      
      if (rs && rs.selected && rs.selected.length > 0 && !rs.noIssues) {
        const volumes = rs.volumes || {};
        rs.selected.forEach(variantName => {
          const variantObj = (obj.variants || []).find(v => v.variant === variantName);
          if (variantObj && variantObj.requireVolume) {
            const vol = volumes[variantName];
            if (!vol || !vol.value || String(vol.value).trim() === '') {
              missingVolumesError = `В объекте "${obj.label}" не указан объем для замечания "${variantName}"`;
              if (errorDivisionIndex === -1) errorDivisionIndex = divIdx;
            }
          }
        });
      }
    });
  });

  if (missingVolumesError) {
    alert(missingVolumesError);
    // Перекидываем пользователя на тот экран, где есть ошибка
    if (errorDivisionIndex !== -1) {
      state.form.currentDivisionIndex = errorDivisionIndex;
      render();
    }
    return;
  }

  state.isSubmitting = true;
  
  const app = document.getElementById('app');
  app.innerHTML = '<div class="loading">Сохранение…</div>';
  try {
        clearTimeout(_autoSaveTimeout);
    if (!await autoSave(true)) throw new Error('Не удалось сохранить черновик');
    const clientId = state.draftId;
    const cleanResults = {};
    
    Object.keys(state.form.results).forEach(key => {
      const rs = state.form.results[key];
      
      const preparePhotos = (arr) => {
        return (arr || []).map(p => {
          // Для старых фото
          if (p.remote && p.remote.url) {
            return { photoId: p.photoId, name: p.name, url: p.remote.url, remote: p.remote };
          }
          // Для новых фото
          if (p.photoId) {
            return { photoId: p.photoId, name: p.name };
          }
          // Для офлайн-фото
          return { name: p.name };
        });
      };

      cleanResults[key] = {
        selected: rs.selected || [],
        custom: rs.custom || '',
        noIssues: rs.noIssues || false,
        volumes: rs.volumes || {},
        commonPhotos: preparePhotos(rs.commonPhotos),
        photosByVariant: {}
      };
      
      Object.keys(rs.photosByVariant || {}).forEach(variant => {
        cleanResults[key].photosByVariant[variant] = preparePhotos(rs.photosByVariant[variant]);
      });
    });

    const payload = {
            houseId: state.form.houseId,
      section: state.form.section || '',
      apartment: state.form.apartment,
      divisions: state.form.divisions,
      email: state.user.name || 'осмотрщик',
      kvNumber: state.form.kvNumber,
      results: cleanResults,
      extraPhotos: (state.form.extraPhotos || []).map(p => {
        if (p.remote && p.remote.url) {
          return { photoId: p.photoId, name: p.name, url: p.remote.url, remote: p.remote };
        }
        if (p.photoId) {
          return { photoId: p.photoId, name: p.name };
        }
        return { name: p.name };
      }),
      comments: state.form.comments || '',
      visitedAt: new Date().toISOString(),
      sourceVisitId: state.form.sourceVisitId || null,
      clientId: clientId
    };
    
        const saved = await window.db.enqueueDraftVisit({
      clientId: clientId, createdAt: new Date().toISOString(), status: 'pending',
      attempts: 0, lastError: '', hidden: false, payload: payload
    });
    if (!saved) throw new Error('Не удалось записать осмотр в очередь. Черновик сохранён.');
    state.pendingDraft = null;
    await refreshQueueStats();
    if (navigator.onLine && window.sync && window.sync.syncNow) window.sync.syncNow().catch(() => {});
    state.screen = 'saved';
    state.submitResult = { clientId: clientId };
    state.draftId = null;
    state.isSubmitting = false; // Сброс флага
    render();
    window.scrollTo(0, 0);
  } catch (err) {
    state.isSubmitting = false; // Сброс флага при ошибке
    app.innerHTML = `<div class="error-box"><strong>Ошибка сохранения:</strong><br>${escapeHtml(err.message)}</div><button class="btn btn-secondary" onclick="submitVisit()">Попробовать снова</button>`;
  }
}

function renderSaved(app) {
  const online = navigator.onLine;
  const pending = state.queueStats.pendingVisits || 0;
  app.innerHTML = `
    <div class="card" style="text-align:center;">
      <div class="done-icon">✅</div>
      <h2>Осмотр сохранён</h2>
      <p style="margin-top:12px;">${online ? 'Отправляется в таблицу…' : 'Отправится при появлении сети.'}</p>
      ${pending > 0 ? `<p style="margin-top:8px;color:#5f6368;font-size:14px;">Сейчас в очереди: ${pending}</p>` : ''}
      <button class="btn btn-primary btn-large" style="margin-top:24px;" onclick="startNewVisit()">🏠 Оформить ещё один осмотр</button>
      <button class="btn btn-secondary btn-large" onclick="goHome()">← На главную</button>
    </div>
  `;
}

// ================= АВТОСОХРАНЕНИЕ =================
let _autoSaveTimeout = null;

function saveInspectionDraft(form, screen) {
  if (!state.draftId || !window.db || !window.db.saveDraft) return Promise.resolve(false);
  const draft = {
    form: {
      houseId: form.houseId, section: form.section,
      floorNumber: form.floorNumber, floorKvNumber: form.floorKvNumber,
      kvNumber: form.kvNumber, apartment: form.apartment, editedFields: form.editedFields,
      divisions: form.divisions, currentDivisionIndex: form.currentDivisionIndex,
      results: form.results, comments: form.comments, extraPhotos: form.extraPhotos,
      sourceVisitId: form.sourceVisitId
    },
    screen, savedAt: new Date().toISOString(), draftId: state.draftId
  };
  return window.db.saveDraft(draft).catch(err => { console.warn('saveDraft:', err); return false; });
}

function autoSave(force = false) {
  clearTimeout(_autoSaveTimeout);
  if (state.apartmentSelectionOriginal ||
      !['newVisitRef', 'division'].includes(state.screen) ||
      !state.draftId || (!force && state.isSubmitting)) return Promise.resolve(false);
  return saveInspectionDraft(state.form, state.screen);
}

function debouncedAutoSave() {
  if (_autoSaveTimeout) clearTimeout(_autoSaveTimeout);
  _autoSaveTimeout = setTimeout(autoSave, 800);
}

async function checkDraftOnStart() {
  if (!window.db || !window.db.loadDraft) return null;
  try {
    const draft = await window.db.loadDraft();
    if (draft && draft.form && draft.form.kvNumber) { if (draft.draftId) state.draftId = draft.draftId; return draft; }
  } catch (err) { console.warn('checkDraftOnStart:', err); }
  return null;
}

function restoreDraft(draft) {
  if (!draft || !draft.form) return;
   state.form = { houseId: draft.form.houseId || '', section: draft.form.section || '', floorNumber: draft.form.floorNumber || '', floorKvNumber: draft.form.floorKvNumber || '', kvNumber: draft.form.kvNumber || '', apartment: draft.form.apartment || null, editedFields: draft.form.editedFields || {}, divisions: draft.form.divisions || [], currentDivisionIndex: draft.form.currentDivisionIndex || 0, results: draft.form.results || {}, uploading: {}, comments: draft.form.comments || '', extraPhotos: draft.form.extraPhotos || [], sourceVisitId: draft.form.sourceVisitId || null };
    state.form.sourceVisitId = null; // <--- ДОБАВИТЬ ЭТУ СТРОКУ
  state.draftId = draft.draftId || window.db.uuid();
  state.screen = draft.screen || 'newVisitKv';
  if (!state.form.apartment && state.screen === 'newVisitRef') state.screen = 'newVisitKv';
}

// ================= УТИЛИТЫ =================
function escapeHtml(str) { return String(str === null || str === undefined ? '' : str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function escapeAttr(str) { return String(str === null || str === undefined ? '' : str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function cssEscape(str) { return String(str).replace(/[^a-zA-Z0-9_\-\.]/g, '\\$&'); }

// ================= ДИАГНОСТИКА API =================
async function forcePingCheck() {
  const t0 = Date.now();
  let detail = { at: Date.now(), ok: false, elapsed: 0, status: 0, body: '', error: '' };
  try {
    const url = API_URL + '?action=ping&callback=cb&t=' + Date.now();
    const r = await fetch(url, { cache: 'no-store' });
    detail.status = r.status;
    detail.elapsed = Date.now() - t0;
    if (!r.ok) detail.error = 'HTTP ' + r.status;
    else {
      const text = await r.text();
      detail.body = String(text).substring(0, 300);
      const lower = detail.body.toLowerCase();
      detail.ok = lower.indexOf('pong') !== -1 || lower.indexOf('"ok":true') !== -1;
    }
  } catch (e) {
    detail.elapsed = Date.now() - t0;
    detail.error = e.name === 'AbortError' ? 'timeout' : (e.message || String(e));
  }
  try { await window.db.setMeta('apiReachable', { ok: detail.ok, at: Date.now() }); await window.db.setMeta('pingDetail', detail); } catch (e) {}
  state.apiReachable = { ok: detail.ok, at: Date.now() };
  const lines = ['📡 Проверка API', '', 'Результат: ' + (detail.ok ? '✅ ok' : '❌ fail'), 'HTTP статус: ' + (detail.status || '—'), 'Время: ' + detail.elapsed + ' мс', 'Ошибка: ' + (detail.error || '—'), '', 'Тело ответа (первые 300):', detail.body || '(пусто)', '', 'Сеть: ' + (navigator.onLine ? 'онлайн' : 'офлайн'), 'visibilityState: ' + document.visibilityState, 'Соединение: ' + (navigator.connection ? (navigator.connection.effectiveType || '?') : '?')];
  alert(lines.join('\n'));
  render();
}

let _bannerTimer = null;
function startBannerLongPress() { _bannerTimer = setTimeout(() => { _bannerTimer = null; showPingDiagnostics(); }, 600); }
function cancelBannerLongPress() { if (_bannerTimer) { clearTimeout(_bannerTimer); _bannerTimer = null; } }

async function showPingDiagnostics() {
  const detail = (await window.db.getMeta('pingDetail')) || {};
  const apiMeta = state.apiReachable || {};
  const metaAge = apiMeta.at ? Math.round((Date.now() - apiMeta.at) / 1000) + ' сек назад' : '—';
  const lines = ['🔍 Диагностика плашки', '', 'Сеть: ' + (navigator.onLine ? 'онлайн' : 'офлайн'), 'visibilityState: ' + document.visibilityState, 'Соединение: ' + (navigator.connection ? (navigator.connection.effectiveType || '?') : '?'), '', 'Последняя проверка API:', '  Результат: ' + (apiMeta.ok === true ? '✅ ok' : apiMeta.ok === false ? '❌ fail' : '—'), '  Когда: ' + metaAge, '', 'Детали ping:', '  HTTP статус: ' + (detail.status || '—'), '  Время: ' + (detail.elapsed ? detail.elapsed + ' мс' : '—'), '  Ошибка: ' + (detail.error || '—'), '  Тело: ' + (detail.body ? detail.body.substring(0, 200) : '—')];
  alert(lines.join('\n'));
}

// ================= ОЧЕРЕДЬ: вспомогательные =================
function buildVisitRemarksList(visit) {
  const results = (visit.payload && visit.payload.results) || {};
  const lines = [];
  Object.keys(results).sort().forEach(stateKey => {
    const rs = results[stateKey] || {};
    const objName = stateKeyToRusName(stateKey);
    const parts = [];
    if (rs.noIssues) parts.push('замечаний нет');
    else {
      (rs.selected || []).forEach(variant => {
        const vol = (rs.volumes || {})[variant];
        if (vol && vol.value) parts.push(variant + ' (' + vol.value + (vol.unit ? ' ' + vol.unit : '') + ')');
        else parts.push(variant);
      });
      if (rs.custom && String(rs.custom).trim()) parts.push(String(rs.custom).trim());
    }
    if (parts.length) lines.push(objName + ': ' + parts.join(', '));
  });
  return lines;
}

function countVisitPhotos(visit) {
  const results = (visit.payload && visit.payload.results) || {};
  let n = 0;
  Object.keys(results).forEach(stateKey => {
    const rs = results[stateKey] || {};
    if (Array.isArray(rs.commonPhotos)) n += rs.commonPhotos.length;
    if (rs.photosByVariant) Object.keys(rs.photosByVariant).forEach(v => { n += (rs.photosByVariant[v] || []).length; });
  });
  const extra = (visit.payload && visit.payload.extraPhotos) || [];
  n += extra.length;
  return n;
}

// ================= СТАТУС ПОСЛЕДНЕЙ КОПИИ =================
function renderQueueBackupStatus() {
  if (!state.queueStats.pendingVisits) return '';
  const meta = state.queueStats.lastQueueBackupAt;
  if (!meta) return `<div style="font-size:12px;color:#5f6368;margin-top:8px;">Последняя копия: никогда</div>`;
  try {
    const dt = new Date(meta);
    const s = dt.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    return `<div style="font-size:12px;color:#5f6368;margin-top:8px;">Последняя копия: ${escapeHtml(s)}</div>`;
  } catch (e) { return ''; }
}

// ================= ЗАГРУЗКА ОЧЕРЕДИ В ОБЛАКО =================
async function uploadQueueToDrive() {
  if (state.queueBackupBusy) return;
  if (!navigator.onLine) { state.queueBackupMsg = { type: 'error', text: 'Нет интернета. Копия уйдёт, когда появится связь.' }; render(); return; }
  const pending = (state.queueList && state.queueList.length) ? state.queueList.filter(v => v.status !== 'synced') : await window.db.getPendingVisits();
  if (!pending.length) { state.queueBackupMsg = { type: 'error', text: 'Очередь пуста — сохранять нечего.' }; render(); return; }
  state.queueBackupBusy = true;
  state.queueBackupMsg = { type: '', text: 'Сохраняем копию в облако…' };
  render();
  try {
    const payload = { version: APP_VERSION, userName: state.user.name || 'осмотрщик', savedAt: new Date().toISOString(), pendingCount: pending.length, visits: pending.map(v => ({ clientId: v.clientId, createdAt: v.createdAt, status: v.status, attempts: v.attempts || 0, lastError: v.lastError || '', payload: v.payload })) };
    const res = await postApiRaw('uploadQueueBackup', payload);
    const data = (res && res.data) ? res.data : res;
    if (!data || data.ok === false) throw new Error((data && data.error) || 'Сервер вернул ошибку');
    await window.db.setMeta('lastQueueBackupAt', new Date().toISOString());
    state.queueBackupMsg = { type: 'ok', text: '✅ Сохранено в облако: ' + (data.fileName || 'файл') };
    await refreshQueueStats();
  } catch (err) { state.queueBackupMsg = { type: 'error', text: 'Ошибка: ' + (err.message || err) }; }
  state.queueBackupBusy = false;
  render();
}

async function postApiRaw(action, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    let token = null;
    try { token = await window.db.getMeta('authToken'); } catch (e) {}
    
    const response = await fetch(API_URL, { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify({ 
        action: action, 
        payload: payload,
        token: token 
      }), 
      signal: controller.signal 
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const text = await response.text();
    return parseResponse(text);
  } finally { 
    clearTimeout(timer); 
  }
}
// ================= АВТО-ЗАГРУЗКА =================
async function maybeAutoBackupQueue() {
  if (!navigator.onLine) return;
  if (document.visibilityState !== 'visible') return;
  try {
    const stats = await window.db.getQueueStats();
    if (!stats.pendingVisits) return;
    const lastAt = await window.db.getMeta('lastQueueBackupAt');
    const lastMs = lastAt ? new Date(lastAt).getTime() : 0;
    const now = new Date();
    const hour = now.getHours();
    const hoursSince = lastMs ? (Date.now() - lastMs) / (60 * 60 * 1000) : Infinity;
    const shouldRun = (hour >= 18 && hoursSince >= 20) || (hoursSince >= 26);
    if (!shouldRun) return;
    console.log('[auto backup] Запускаем автоматическую загрузку очереди');
    state.queueList = await window.db.getAllVisits();
    await uploadQueueToDrive();
  } catch (e) { console.warn('[auto backup]', e.message); }
}

// ================= ПРОСМОТР ОСМОТРА (модалка) =================
async function showVisitPreview(clientId) {
  const visit = await window.db.getVisit(clientId);
  if (!visit) { alert('Осмотр не найден'); return; }
  const photos = await window.db.getPhotosForVisit(clientId);
  const fresh = photos.map(p => {
    let url = '';
    try {
      if (p.blob && typeof p.blob === 'object') url = URL.createObjectURL(p.blob);
      else if (p.localUrl) url = p.localUrl;
    } catch (e) {}
    return Object.assign({}, p, { freshUrl: url });
  });
  state.visitPreview = { visit: visit, photos: fresh };
  renderVisitPreviewModal();
}

function closeVisitPreview() {
  const preview = state.visitPreview;
  if (preview && preview.photos) {
    preview.photos.forEach(p => {
      if (p.freshUrl && p.freshUrl.indexOf('blob:') === 0) { try { URL.revokeObjectURL(p.freshUrl); } catch (e) {} }
    });
  }
  state.visitPreview = null;
  const el = document.getElementById('visitPreviewBackdrop');
  if (el) el.remove();
}

function renderVisitPreviewModal() {
  const existing = document.getElementById('visitPreviewBackdrop');
  if (existing) existing.remove();
  const preview = state.visitPreview;
  if (!preview) return;
  const v = preview.visit;
  const kv = (v.payload && v.payload.kvNumber) || '—';
  const userName = (v.payload && v.payload.email) || '—';
  const created = v.createdAt ? new Date(v.createdAt).toLocaleString('ru-RU') : '—';
  const visited = (v.payload && v.payload.visitedAt) ? new Date(v.payload.visitedAt).toLocaleString('ru-RU') : '—';
  let statusText = 'В очереди';
  if (v.status === 'error') statusText = 'Ошибка (попыток: ' + (v.attempts || 0) + '): ' + (v.lastError || '');
  else if (v.status === 'syncing') statusText = 'Отправляется';
  else if (v.status === 'pending') statusText = 'Ожидает отправки';
  const results = (v.payload && v.payload.results) || {};
  const comments = (v.payload && v.payload.comments) || '';
  const photosByState = {};
  preview.photos.forEach(p => {
    const sk = p.stateKey || '__unknown__';
    if (!photosByState[sk]) photosByState[sk] = { common: [], variants: {} };
    if (!p.variantKey) photosByState[sk].common.push(p);
    else {
      if (!photosByState[sk].variants[p.variantKey]) photosByState[sk].variants[p.variantKey] = [];
      photosByState[sk].variants[p.variantKey].push(p);
    }
  });
  const allKeys = {};
  Object.keys(results).forEach(k => { allKeys[k] = true; });
  Object.keys(photosByState).forEach(k => { if (k !== '__unknown__') allKeys[k] = true; });
  const stateKeys = Object.keys(allKeys).sort();
  const blocksHtml = stateKeys.map(stateKey => {
    const rs = results[stateKey] || {};
    const objName = stateKeyToRusName(stateKey);
    const ph = photosByState[stateKey] || { common: [], variants: {} };
    const remarks = [];
    if (rs.noIssues) remarks.push('Замечаний нет');
    else {
      (rs.selected || []).forEach(variant => {
        const vol = (rs.volumes || {})[variant];
        if (vol && vol.value) remarks.push(variant + ' (' + vol.value + (vol.unit ? ' ' + vol.unit : '') + ')');
        else remarks.push(variant);
      });
      if (rs.custom && String(rs.custom).trim()) remarks.push(String(rs.custom).trim());
    }
    const renderThumb = (p) => {
      if (p.freshUrl) return `<img src="${escapeAttr(p.freshUrl)}" class="preview-thumb" onclick="openPhotoLightbox('${escapeAttr(p.freshUrl)}')">`;
      return `<div class="preview-thumb-missing">нет фото</div>`;
    };
    const commonHtml = ph.common.length ? `<div class="preview-photo-row"><span class="preview-photo-label">Общий вид:</span><div class="preview-photo-list">${ph.common.map(renderThumb).join('')}</div></div>` : '';
    const variantsHtml = Object.keys(ph.variants).map(variant => {
      const arr = ph.variants[variant];
      if (!arr.length) return '';
      return `<div class="preview-photo-row"><span class="preview-photo-label">${escapeHtml(variant)}:</span><div class="preview-photo-list">${arr.map(renderThumb).join('')}</div></div>`;
    }).join('');
    const photosHtml = (commonHtml || variantsHtml) ? `<div class="preview-photos">${commonHtml}${variantsHtml}</div>` : '';
    return `
      <div class="preview-block">
        <div class="preview-block-title">${escapeHtml(objName)}</div>
        <div class="preview-block-remarks">${remarks.length ? remarks.map(r => escapeHtml(r)).join('<br>') : '—'}</div>
        ${photosHtml}
      </div>
    `;
  }).join('');
  const backdrop = document.createElement('div');
  backdrop.id = 'visitPreviewBackdrop';
  backdrop.className = 'modal-backdrop';
  backdrop.onclick = closeVisitPreview;
  backdrop.innerHTML = `
    <div class="modal-window preview-window" onclick="event.stopPropagation()">
      <div class="preview-header"><h2>Квартира ${escapeHtml(kv)}</h2><button class="preview-close" onclick="closeVisitPreview()">✕</button></div>
      <div class="preview-meta">
        <div>👤 ${escapeHtml(userName)}</div>
        <div>📅 Создан: ${escapeHtml(created)}</div>
        <div>📅 Осмотр: ${escapeHtml(visited)}</div>
        <div class="preview-status">${escapeHtml(statusText)}</div>
      </div>
      <div class="preview-content">
        ${blocksHtml || '<div class="hint">Нет замечаний.</div>'}
        ${comments ? `<div class="preview-block"><div class="preview-block-title">Комментарий</div><div class="preview-block-remarks">${escapeHtml(comments)}</div></div>` : ''}
      </div>
      <button class="btn btn-secondary" onclick="closeVisitPreview()">Закрыть</button>
    </div>
  `;
  document.body.appendChild(backdrop);
}

// ================= ЛАЙТБОКС ФОТО =================
function openPhotoLightbox(url) { state.photoLightbox = { url: url }; renderPhotoLightbox(); }
function closePhotoLightbox() { state.photoLightbox = null; const el = document.getElementById('photoLightboxBackdrop'); if (el) el.remove(); }
function renderPhotoLightbox() {
  const existing = document.getElementById('photoLightboxBackdrop');
  if (existing) existing.remove();
  if (!state.photoLightbox) return;
  const backdrop = document.createElement('div');
  backdrop.id = 'photoLightboxBackdrop';
  backdrop.className = 'modal-backdrop';
  backdrop.onclick = closePhotoLightbox;
  backdrop.innerHTML = `<div class="photo-lightbox" onclick="closePhotoLightbox()"><img src="${escapeAttr(state.photoLightbox.url)}"></div>`;
  document.body.appendChild(backdrop);
}

// ================= ДЕЙСТВИЯ ИЗ КАРТОЧКИ ОЧЕРЕДИ =================
async function sendVisitNow(clientId) {
  if (!navigator.onLine) { alert('Нет интернета. Дождитесь подключения.'); return; }
  if (!confirm('Отправить этот осмотр сейчас?')) return;
  try {
    await window.db.updateVisit(clientId, { attempts: 0, lastAttemptAt: null, status: 'pending', lastError: '' });
    await refreshQueueStats();
    await window.sync.syncNow();
    state.queueList = await window.db.getAllVisits();
    await refreshQueueStats();
    render();
  } catch (err) { alert('Ошибка отправки: ' + (err.message || err)); }
}

// Восстанавливает broken визит в черновик: подтягивает payload, чистит
// ссылки на отсутствующие фото, помечает объекты без фото как ошибки,
// удаляет старый broken визит и открывает форму для дозаполнения.
async function recoverBrokenVisit(clientId) {
  if (state.isSubmitting) return;
  if (!confirm('Открыть осмотр для исправления? Фото, которые утеряны, нужно будет переснять. Старый осмотр будет заменён новым.')) return;

  const visit = await window.db.getVisit(clientId);
  if (!visit || !visit.payload) { alert('Осмотр не найден в локальном хранилище.'); return; }

  const payload = visit.payload;
  const kv = String(payload.kvNumber || '').trim();
  if (!kv) { alert('В осмотре нет номера квартиры — восстановить нельзя.'); return; }

  // 1. Восстанавливаем справочные данные квартиры
  let apartment = null;
  try {
    const ref = await window.db.getReference();
    if (ref && ref[kv.toLowerCase()]) apartment = ref[kv.toLowerCase()];
  } catch (e) {}
  if (!apartment && payload.apartment) apartment = payload.apartment;
  if (!apartment) {
    alert('Квартира ' + kv + ' отсутствует в справочнике. Обновите справочник и попробуйте снова.');
    return;
  }

  // 2. Восстанавливаем структуру формы
  let divisions = [];
  try {
    const data = await getFormDataSmart(apartment);
    divisions = data.divisions || [];
  } catch (e) {
    alert('Не удалось получить структуру формы: ' + e.message);
    return;
  }

  // 3. Собираем photoId, которые реально есть в IDB
  const storedPhotos = await window.db.getPhotosForVisit(clientId);
  const presentIds = new Set(storedPhotos.map(p => p.photoId));

  // 4. Восстанавливаем results с чисткой битых ссылок
  const restoredResults = {};
  const problemKeys = []; // stateKey, где фото стало 0 при наличии замечаний

  Object.keys(payload.results || {}).forEach(stateKey => {
    const src = payload.results[stateKey] || {};
    const rs = {
      selected: Array.isArray(src.selected) ? src.selected.slice() : [],
      custom: src.custom || '',
      noIssues: !!src.noIssues,
      volumes: src.volumes ? JSON.parse(JSON.stringify(src.volumes)) : {},
      commonPhotos: [],
      photosByVariant: {},
      error: null
    };

    const keepIfPresent = (arr) => {
      return (arr || []).filter(p => p && p.photoId && presentIds.has(p.photoId))
        .map(p => {
          // Восстанавливаем объект в том формате, в котором работает форма
          const stored = storedPhotos.find(sp => sp.photoId === p.photoId);
          return {
            photoId: p.photoId,
            name: p.name || (stored && stored.fileName) || '',
            localUrl: stored ? (stored.localUrl || '') : '',
            remote: p.remote || (stored && stored.remote) || null
          };
        });
    };

    rs.commonPhotos = keepIfPresent(src.commonPhotos);
    Object.keys(src.photosByVariant || {}).forEach(variant => {
      const kept = keepIfPresent(src.photosByVariant[variant]);
      if (kept.length) rs.photosByVariant[variant] = kept;
    });

    const totalPhotosLeft = rs.commonPhotos.length +
      Object.keys(rs.photosByVariant).reduce((sum, v) => sum + rs.photosByVariant[v].length, 0);

    const hasRemarks = rs.selected.length > 0 || String(rs.custom || '').trim();
    if (hasRemarks && totalPhotosLeft === 0) {
      rs.error = 'Фото утеряны — приложите хотя бы одно фото заново';
      problemKeys.push(stateKey);
    }

    restoredResults[stateKey] = rs;
  });

  // 5. Восстанавливаем extraPhotos (только те, что живы)
  const restoredExtra = (payload.extraPhotos || [])
    .filter(p => p && p.photoId && presentIds.has(p.photoId))
    .map(p => {
      const stored = storedPhotos.find(sp => sp.photoId === p.photoId);
      return {
        photoId: p.photoId,
        name: p.name || (stored && stored.fileName) || '',
        localUrl: stored ? (stored.localUrl || '') : '',
        remote: p.remote || (stored && stored.remote) || null
      };
    });

  // 6. Переносим "живые" фото-записи на новый draftId, чтобы sync их подхватил
  const newDraftId = window.db.uuid();
  for (const sp of storedPhotos) {
    await window.db.addPhoto(Object.assign({}, sp, { visitClientId: newDraftId }));
  }

  // 7. Заполняем state.form
  state.form = {
    kvNumber: kv,
    apartment: Object.assign({}, apartment),
    editedFields: {},
    divisions: divisions,
    currentDivisionIndex: 0,
    results: restoredResults,
    uploading: {},
    comments: payload.comments || '',
    extraPhotos: restoredExtra,
    sourceVisitId: null
  };
  state.draftId = newDraftId;
  state.screen = 'division';
  state.isSubmitting = false;
  state.pendingDraft = null;

  // 8. Открываем первый раздел, где есть проблема
  if (problemKeys.length > 0) {
    const firstKey = problemKeys[0];
    const divKey = firstKey.split('.')[0];
    const idx = divisions.findIndex(d => d.key === divKey);
    if (idx >= 0) state.form.currentDivisionIndex = idx;
  }

  // 9. Удаляем старый broken визит и его фото
  try {
    for (const sp of storedPhotos) {
      await window.db.deletePhoto(sp.photoId);
    }
    await window.db.deleteVisit(clientId);
  } catch (e) {
    console.warn('[recoverBrokenVisit] не удалось удалить старый визит:', e);
  }

  await autoSave();
  await refreshQueueStats();
  render();
  window.scrollTo(0, 0);
}

async function deleteBrokenVisit(clientId) {
  if (!confirm('Удалить этот осмотр? Фото утеряны, отправить его уже не получится.')) return;
  try {
    const photos = await window.db.getPhotosForVisit(clientId);
    for (const p of photos) {
      if (p && p.photoId) await window.db.deletePhoto(p.photoId);
    }
    await window.db.deleteVisit(clientId);
    state.queueList = await window.db.getAllVisits();
    await refreshQueueStats();
    render();
  } catch (e) {
    alert('Не удалось удалить: ' + (e.message || e));
  }
}

async function resetVisitAttempts(clientId) {
  await window.db.updateVisit(clientId, { attempts: 0, lastAttemptAt: null, status: 'pending', lastError: '' });
  state.queueList = await window.db.getAllVisits();
  await refreshQueueStats();
  render();
}

// ================= ЗАГРУЗКА ПРОШЛЫХ ОСМОТРОВ =================
async function loadExistingVisitsList(kv) {
  // Функция отключена. Прошлые осмотры не загружаются.
  state.existingVisits = [];
  return;
}

async function selectExistingVisit(clientId) {
  if (state.loadingExisting) return;

  if (state.selectedVisitId === clientId) {
    state.selectedVisitId = null;
    state.existingVisit = null;
    renderKvResultBlock();
    return;
  }

  state.selectedVisitId = clientId;
  state.loadingExisting = true;
  renderKvResultBlock();

  try {
    let visitData = null;
    
    // 1. Сначала ищем в памяти (мгновенно)
    const offline = await window.db.getOfflineVisitsByKv(state.form.kvNumber);
    const found = offline.find(v => v.clientId === clientId);
    
    if (found) {
      visitData = { found: true, clientId, payload: found.payload };
    } else if (navigator.onLine) {
      // 2. Если в памяти нет — грузим данные осмотра (БЕЗ фото, чтобы не ждать)
      const res = await apiGet('getVisitById', { clientId: clientId }, 15000);
      const data = (res && res.data) ? res.data : res;
      if (!data || !data.found) throw new Error('Осмотр не найден');
      
      visitData = data;
      
      // Сохраняем сам осмотр в память (фото скачаем отдельно или при офлайн-загрузке)
      await window.db.saveOfflineVisit({
        clientId: visitData.clientId,
        kvNumber: state.form.kvNumber,
        visitedAt: visitData.visitedAt,
        email: visitData.email,
        payload: visitData.payload
      });
    } else {
      throw new Error('Нет интернета и нет скачанных данных.');
    }

    state.existingVisit = visitData;
  } catch (err) {
    console.error('[selectExistingVisit]', err);
    alert('Ошибка загрузки: ' + err.message);
    state.selectedVisitId = null;
    state.existingVisit = null;
  } finally {
    state.loadingExisting = false;
    renderKvResultBlock();
  }
}

async function downloadVisitPhotos(visitData, onProgress) {
  if (!visitData || !visitData.payload) return;

  const payload = visitData.payload;
  const kv = payload.kvNumber || '';
  const tasks = [];

  Object.keys(payload.results || {}).forEach(stateKey => {
    const rs = payload.results[stateKey];
    (rs.commonPhotos || []).forEach((p, i) => {
      if (p.url && !p.photoId) tasks.push({ url: p.url, stateKey, variantKey: '', idx: i, isCommon: true });
    });
    Object.keys(rs.photosByVariant || {}).forEach(variant => {
      (rs.photosByVariant[variant] || []).forEach((p, i) => {
        if (p.url && !p.photoId) tasks.push({ url: p.url, stateKey, variantKey: variant, idx: i, isCommon: false });
      });
    });
  });

  (payload.extraPhotos || []).forEach((p, i) => {
    if (p.url && !p.photoId) tasks.push({ url: p.url, stateKey: '__extra__', variantKey: '', idx: i, isCommon: false, isExtra: true });
  });

  if (!tasks.length) {
    if (onProgress) onProgress(0); 
    return;
  }
  
  let downloaded = 0;

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    try {
      const blob = await fetchPhotoAsBlob(task.url);
      if (blob) {
        // Конвертируем Blob в Base64 строку
        const base64 = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });

        const photoId = window.db.uuid();
        const fileName = buildFileName(task.stateKey.split('.')[0] || 'server', task.stateKey.split('.')[1] || 'photo', task.idx + 1);
        
        // Создаем обычную ссылку для текущей сессии
        const localUrl = URL.createObjectURL(blob);
        const remoteData = { url: task.url };

        window.db.addPhoto({
          photoId: photoId,
          visitClientId: visitData.clientId,
          stateKey: task.stateKey,
          variantKey: task.variantKey,
          fileName: fileName,
          kvNumber: kv,
          blob: blob,
          base64: base64, // <--- СОХРАНЯЕМ ТЕКСТ
          status: 'pending',
          attempts: 0,
          lastError: '',
          remote: remoteData,
          localUrl: localUrl,
          fromServer: true
        }).catch(e => console.warn('Фоновая запись фото:', e));

        const rs = task.isExtra ? null : payload.results[task.stateKey];
     // Используем base64 для отображения!
const imgUrl = base64; 

if (task.isExtra) {
  payload.extraPhotos[task.idx] = { photoId: photoId, localUrl: imgUrl, name: fileName, fromServer: true, remote: remoteData };
} else if (rs) {
  const arr = task.isCommon ? (rs.commonPhotos || []) : (rs.photosByVariant[task.variantKey] || []);
  arr[task.idx] = { photoId: photoId, localUrl: imgUrl, name: fileName, fromServer: true, remote: remoteData };
  if (task.isCommon) rs.commonPhotos = arr;
  else rs.photosByVariant[task.variantKey] = arr;
}
        downloaded++;
      }
    } catch (err) {
      console.warn('[downloadVisitPhotos] Ошибка фото:', task.url, err.message);
    }
    
    if (onProgress) onProgress(1);
    await new Promise(r => setTimeout(r, 100));
  }
}
async function fetchPhotoAsBlob(url) {
  try {
    const match = url.match(/[?&]id=([^&]+)/);
    const fileId = match ? match[1] : null;
    if (!fileId) return null;
    
    // Ждем ответ максимум 20 секунд
    const res = await apiGet('getPhotoBase64', { fileId: fileId }, 20000); 
    const data = (res && res.data) ? res.data : res;
    
    if (!data || !data.ok || !data.base64) return null;
    
    const byteCharacters = atob(data.base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: data.mimeType || 'image/jpeg' });
  } catch (e) {
    console.warn('[fetchPhotoAsBlob] Ошибка или таймаут:', e.message);
    return null;
  }
}

// ================= ОФЛАЙН-СКАЧИВАНИЕ =================
async function openOfflineDownloadScreen() {
   return; // <--- ДОБАВИТЬ ЭТУ СТРОКУ
  state.offlineDownloadScreen = true;
  state.screen = 'settings';
  state.offlineTree = [];
  state.offlineKvSelected = {};
  state.offlineKvExpanded = {};
  state.offlineSearch = '';
  state.offlineDownloadedClientIds = [];
  
  try {
    state.offlineDownloadedMap = await window.db.getAllOfflineVisitsInfo();
    const downloadedVisits = await window.db.getAllOfflineVisits();
    state.offlineDownloadedClientIds = downloadedVisits.map(v => v.clientId);
    state.pendingDownloadState = await window.db.getMeta('offline_download_state');
  } catch (e) {
    state.offlineDownloadedMap = {};
  }

  render(); 

  if (!navigator.onLine) {
    try {
      const offlineVisits = await window.db.getAllOfflineVisits();
      const kvMap = {};
      offlineVisits.forEach(v => {
        const kv = String(v.kvNumber).trim();
        if (!kvMap[kv]) kvMap[kv] = [];
        kvMap[kv].push({ clientId: v.clientId, date: v.visitedAt, email: v.email });
      });
      
      state.offlineTree = Object.keys(kvMap).map(kv => {
        const visits = kvMap[kv].sort((a, b) => new Date(b.date) - new Date(a.date));
        return { kv: kv, visits: visits };
      }).sort((a, b) => a.kv.localeCompare(b.kv, undefined, { numeric: true }));
    } catch (e) { state.offlineTree = []; }
    render();
    return;
  }

  try {
    const res = await apiGet('getAllVisitedApartments');
    let serverList = (res && res.data && Array.isArray(res.data.data)) ? res.data.data : [];
    
    if (serverList.length > 0 && typeof serverList[0] === 'string') {
      serverList = serverList.map(kv => ({ kv: kv, visits: [] }));
    }

    // Оставляем только те квартиры, у которых есть хотя бы один осмотр
    serverList = serverList.filter(item => item.visits && item.visits.length > 0);

    state.offlineTree = serverList;
  } catch (e) {
    console.warn('[offline] Ошибка загрузки с сервера:', e);
    state.offlineTree = [];
  }
  render();
}

function renderOfflineDownloadScreen(app) {
  const search = state.offlineSearch.toLowerCase().trim();
  const tree = state.offlineTree || [];
  const filteredTree = tree.filter(item => item.kv.toLowerCase().includes(search));
  
  const totalSelected = Object.keys(state.offlineKvSelected).length;
  const totalDownloaded = (state.offlineDownloadedClientIds || []).length;
  const isOffline = !navigator.onLine;

  let allVisibleSelected = true;
  let hasVisibleVisits = false;
  filteredTree.forEach(item => {
    item.visits.forEach(v => {
      hasVisibleVisits = true;
      if (!state.offlineKvSelected[v.clientId]) allVisibleSelected = false;
    });
  });
  if (!hasVisibleVisits) allVisibleSelected = false;

  let pendingHtml = '';
  // Если есть прерванная загрузка И мы сейчас НЕ качаем
  if (state.pendingDownloadState && state.pendingDownloadState.pending && state.pendingDownloadState.pending.length > 0 && !state.offlineDownloading) {
    pendingHtml = `
      <div class="card" style="background:#FFF3E0; border:2px solid #FF9800; margin-bottom:16px;">
        <h3 style="color:#E65100; margin-bottom:8px;">⏳ Прерванное скачивание</h3>
        <p style="font-size:14px; margin-bottom:12px;">Осталось скачать осмотров: <b>${state.pendingDownloadState.pending.length}</b></p>
        <button class="btn btn-primary btn-large" style="background:#FF9800; border-color:#FF9800;" onclick="resumeOfflineDownload()">▶️ Продолжить скачивание</button>
        <button class="btn btn-secondary" style="margin-top:8px;" onclick="cancelOfflineDownload()">Отменить</button>
      </div>
    `;
  }

  const treeHtml = filteredTree.map(item => {
    const isExpanded = state.offlineKvExpanded && state.offlineKvExpanded[item.kv];
    const allKvSelected = item.visits.length > 0 && item.visits.every(v => state.offlineKvSelected[v.clientId]);
    
    let visitsHtml = '';
    if (isExpanded) {
      visitsHtml = item.visits.map(v => {
        const isSelected = !!state.offlineKvSelected[v.clientId];
        const isDownloaded = state.offlineDownloadedClientIds && state.offlineDownloadedClientIds.includes(v.clientId);
        
        let dateStr = '—';
        try {
          dateStr = new Date(v.date).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
        } catch(e) {}

        let statusHtml = isDownloaded 
          ? `<span style="color:#00A82D; font-size:11px; margin-left:8px; font-weight:600;">✓ Скачано</span>` 
          : '';

        return `
          <div style="display:flex; align-items:center; padding:10px 12px; margin-left:20px; border-left:2px solid #E0E0E0; cursor:pointer;" onclick="event.stopPropagation(); toggleOfflineVisit('${escapeAttr(v.clientId)}')">
            <div id="visit-checkbox-${v.clientId}" class="kv-checkbox" style="width:18px; height:18px; border-radius:4px; border:2px solid ${isSelected ? '#00A82D' : '#D0D0D0'}; background:${isSelected ? '#00A82D' : '#fff'}; display:flex; align-items:center; justify-content:center; color:#fff; margin-right:12px; flex-shrink:0; font-size:12px;">
              ${isSelected ? '✓' : ''}
            </div>
            <div style="flex:1; font-size:13px;">
              <div style="font-weight:500;">Осмотр от ${dateStr}</div>
              <div style="color:#7A7A7A; font-size:12px;">Осмотрщик: ${escapeHtml(v.email || '—')} ${statusHtml}</div>
            </div>
          </div>
        `;
      }).join('');
    }

    return `
      <div id="kv-block-${cssEscape(item.kv)}" style="margin-bottom:8px; background:#fff; border-radius:10px; border:1px solid #E0E0E0; overflow:hidden;">
        <div style="display:flex; align-items:center; padding:12px; background:${allKvSelected ? '#E6F7EA' : '#FAFAFA'}; cursor:pointer;">
          
          <div id="kv-checkbox-${cssEscape(item.kv)}" class="kv-checkbox" style="width:24px; height:24px; border-radius:6px; border:2px solid ${allKvSelected ? '#00A82D' : '#D0D0D0'}; background:${allKvSelected ? '#00A82D' : '#fff'}; display:flex; align-items:center; justify-content:center; color:#fff; margin-right:12px; flex-shrink:0;" onclick="event.stopPropagation(); toggleOfflineKv('${escapeAttr(item.kv)}')">
            ${allKvSelected ? '✓' : ''}
          </div>
          
          <div style="flex:1; font-size:15px; font-weight:600;" onclick="toggleKvExpand('${escapeAttr(item.kv)}')">
            Квартира ${escapeHtml(item.kv)} <span style="font-size:12px; color:#888; font-weight:normal;">(${item.visits.length} осм.)</span>
          </div>
          
          <div id="kv-arrow-${cssEscape(item.kv)}" style="font-size:18px; color:#888; transform:rotate(${isExpanded ? '90deg' : '0deg'}); transition:transform 0.2s;" onclick="toggleKvExpand('${escapeAttr(item.kv)}')">›</div>
        </div>
        
        ${isExpanded ? `<div style="padding:8px 0; background:#FAFAFA; border-top:1px solid #E0E0E0;">${visitsHtml}</div>` : ''}
      </div>
    `;
  }).join('');

  app.innerHTML = `
    <div class="card">
      <div class="step-header">
        <h2>Скачать для офлайна</h2>
        <p>Скачано осмотров: <b>${totalDownloaded}</b>.</p>
        ${isOffline ? '<div style="color:#c5221f; font-size:13px; margin-top:5px;">📴 Вы офлайн. Показаны только скачанные данные.</div>' : ''}
      </div>
      
      ${pendingHtml}

      <div class="field-group">
        <input class="field-input" type="text" placeholder="Поиск по номеру квартиры..." value="${escapeHtml(state.offlineSearch)}" oninput="onOfflineSearchInput(this.value)">
      </div>

      <div style="display:flex; justify-content:space-between; margin-bottom:12px;">
        <div style="font-size:13px; color:#7A7A7A;">Найдено квартир: ${filteredTree.length}</div>
        <button class="btn btn-secondary" style="width:auto; padding:6px 14px; font-size:13px;" onclick="toggleOfflineSelectAll()">${allVisibleSelected ? 'Снять все' : 'Выбрать все'}</button>
      </div>

      <div style="max-height: 450px; overflow-y: auto; padding: 4px; margin-bottom: 16px;">
        ${filteredTree.length === 0 ? '<div style="text-align:center; padding:20px; color:#9AA0A6;">Список пуст</div>' : treeHtml}
      </div>

      <button class="btn btn-primary btn-large" style="margin-bottom:10px;" id="downloadSelectedBtn" onclick="startSelectedOfflineDownload()" ${totalSelected === 0 ? 'disabled' : ''}>📥 Скачать выбранные (${totalSelected})</button>
      <button class="btn btn-secondary" onclick="closeOfflineDownloadScreen()">← Назад</button>
    </div>
  `;
}

function updateCheckboxUI() {
  const totalSelected = Object.keys(state.offlineKvSelected).length;
  const btn = document.getElementById('downloadSelectedBtn');
  
  if (btn) {
    btn.textContent = `📥 Скачать выбранные (${totalSelected})`;
    btn.disabled = totalSelected === 0;
  }

  const allItems = state.offlineTree || [];
  allItems.forEach(item => {
    const allKvSelected = item.visits.length > 0 && item.visits.every(v => state.offlineKvSelected[v.clientId]);
    
    const kvCheckbox = document.getElementById(`kv-checkbox-${cssEscape(item.kv)}`);
    if (kvCheckbox) {
      kvCheckbox.style.borderColor = allKvSelected ? '#00A82D' : '#D0D0D0';
      kvCheckbox.style.background = allKvSelected ? '#00A82D' : '#fff';
      kvCheckbox.innerHTML = allKvSelected ? '✓' : '';
      
      const headerDiv = kvCheckbox.closest('div[style*="background"]');
      if (headerDiv) {
        headerDiv.style.background = allKvSelected ? '#E6F7EA' : '#FAFAFA';
      }
    }

    item.visits.forEach(v => {
      const visitCheckbox = document.getElementById(`visit-checkbox-${v.clientId}`);
      if (visitCheckbox) {
        const isSelected = !!state.offlineKvSelected[v.clientId];
        visitCheckbox.style.borderColor = isSelected ? '#00A82D' : '#D0D0D0';
        visitCheckbox.style.background = isSelected ? '#00A82D' : '#fff';
        visitCheckbox.innerHTML = isSelected ? '✓' : '';
      }
    });
  });
}

function toggleKvExpand(kv) {
  state.offlineKvExpanded[kv] = !state.offlineKvExpanded[kv];
  const isExpanded = state.offlineKvExpanded[kv];
  
  const arrow = document.getElementById(`kv-arrow-${cssEscape(kv)}`);
  if (arrow) {
    arrow.style.transform = isExpanded ? 'rotate(90deg)' : 'rotate(0deg)';
  }

  const block = document.getElementById(`kv-block-${cssEscape(kv)}`);
  if (block) {
    // Ищем блок с осмотрами (он идет следующим элементом после заголовка)
    const header = block.querySelector('div[style*="padding:12px"]');
    let visitsContainer = block.querySelector('div[style*="padding:8px 0"]');
    
    if (isExpanded && !visitsContainer) {
      // Если раскрываем и контейнера нет — создаем его на лету
      const item = state.offlineTree.find(x => x.kv === kv);
      if (item) {
        visitsContainer = document.createElement('div');
        visitsContainer.style = 'padding:8px 0; background:#FAFAFA; border-top:1px solid #E0E0E0;';
        
        visitsContainer.innerHTML = item.visits.map(v => {
          const isSelected = !!state.offlineKvSelected[v.clientId];
          const isDownloaded = state.offlineDownloadedClientIds && state.offlineDownloadedClientIds.includes(v.clientId);
          let dateStr = '—';
          try { dateStr = new Date(v.date).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch(e) {}
          const statusHtml = isDownloaded ? `<span style="color:#00A82D; font-size:11px; margin-left:8px; font-weight:600;">✓ Скачано</span>` : '';

          return `
            <div style="display:flex; align-items:center; padding:10px 12px; margin-left:20px; border-left:2px solid #E0E0E0; cursor:pointer;" onclick="event.stopPropagation(); toggleOfflineVisit('${escapeAttr(v.clientId)}')">
              <div id="visit-checkbox-${v.clientId}" class="kv-checkbox" style="width:18px; height:18px; border-radius:4px; border:2px solid ${isSelected ? '#00A82D' : '#D0D0D0'}; background:${isSelected ? '#00A82D' : '#fff'}; display:flex; align-items:center; justify-content:center; color:#fff; margin-right:12px; flex-shrink:0; font-size:12px;">
                ${isSelected ? '✓' : ''}
              </div>
              <div style="flex:1; font-size:13px;">
                <div style="font-weight:500;">Осмотр от ${dateStr}</div>
                <div style="color:#7A7A7A; font-size:12px;">Осмотрщик: ${escapeHtml(v.email || '—')} ${statusHtml}</div>
              </div>
            </div>
          `;
        }).join('');
        
        block.appendChild(visitsContainer);
      }
    } else if (!isExpanded && visitsContainer) {
      // Если скрываем — удаляем контейнер
      visitsContainer.remove();
    }
  }
}
function toggleOfflineVisit(clientId) {
  if (state.offlineKvSelected[clientId]) delete state.offlineKvSelected[clientId];
  else state.offlineKvSelected[clientId] = true;
  
  updateCheckboxUI();
}

function toggleOfflineKv(kv) {
  const item = state.offlineTree.find(x => x.kv === kv);
  if (!item) return;
  
  const allSelected = item.visits.length > 0 && item.visits.every(v => state.offlineKvSelected[v.clientId]);
  
  if (allSelected) {
    item.visits.forEach(v => delete state.offlineKvSelected[v.clientId]);
  } else {
    item.visits.forEach(v => state.offlineKvSelected[v.clientId] = true);
  }
  
  updateCheckboxUI();
}

function toggleOfflineSelectAll() {
  if (state.offlineDownloading) return;
  
  const search = state.offlineSearch.toLowerCase().trim();
  const visibleItems = state.offlineTree.filter(item => item.kv.toLowerCase().includes(search));
  
  let allSelected = true;
  let hasVisits = false;
  
  visibleItems.forEach(item => {
    item.visits.forEach(v => {
      hasVisits = true;
      if (!state.offlineKvSelected[v.clientId]) allSelected = false;
    });
  });

  if (!hasVisits) return;

  if (allSelected) {
    visibleItems.forEach(item => {
      item.visits.forEach(v => delete state.offlineKvSelected[v.clientId]);
    });
  } else {
    visibleItems.forEach(item => {
      item.visits.forEach(v => state.offlineKvSelected[v.clientId] = true);
    });
  }
  
  updateCheckboxUI();
}

function onOfflineSearchInput(value) { 
  state.offlineSearch = value; 
  render(); 
}

async function startSelectedOfflineDownload() {
  const selectedIds = Object.keys(state.offlineKvSelected);
  if (!selectedIds.length) {
    alert('Выберите хотя бы один осмотр.');
    return;
  }

  state.offlineDownloading = true;
  state.offlineKvSelected = {}; 
  render(); 

  await window.db.setMeta('offline_download_state', {
    pending: selectedIds, 
    total: selectedIds.length,
    done: [],
    startedAt: new Date().toISOString()
  });

  await processOfflineDownloadQueue();
}

async function processOfflineDownloadQueue() {
  const dlState = await window.db.getMeta('offline_download_state');
  if (!dlState || !dlState.pending || !dlState.pending.length) {
    state.offlineDownloading = false;
    const el = document.getElementById('globalProgressToast');
    if (el) el.remove();
    const appEl = document.getElementById('app');
    if (appEl) appEl.style.paddingTop = '';
    return;
  }

  let successCount = dlState.done.length;
  const total = dlState.total;

  // Создаем или обновляем глобальную плашку
  let toast = document.getElementById('globalProgressToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'globalProgressToast';
    toast.style = 'position:fixed; top:0; left:0; right:0; background:#2A2A2A; color:#fff; padding:16px 20px; border-radius:0 0 12px 12px; box-shadow:0 4px 12px rgba(0,0,0,0.4); z-index:10000; display:flex; flex-direction:column; transition: transform 0.3s ease;';
    document.body.appendChild(toast);
    
    // Сдвигаем контент вниз, чтобы плашка не перекрывала его
    const appEl = document.getElementById('app');
    if (appEl) appEl.style.paddingTop = '100px';
  }

  const updateProgressUI = (text, percent, photoText) => {
    toast.innerHTML = `
      <div style="font-size:14px; font-weight:600; margin-bottom:8px; display:flex; align-items:center; gap:8px;">
        <div class="photo-spinner" style="width:16px; height:16px; border-width:2px; margin:0;"></div>
        ${text}
      </div>
      <div style="width:100%; height:8px; background:#444; border-radius:4px; overflow:hidden; margin-bottom:8px;">
        <div style="width:${percent}%; height:100%; background:#00A82D; transition:width 0.3s ease;"></div>
      </div>
      <div style="font-size:12px; color:#CCC; text-align:right;">${photoText}</div>
    `;
  };

  while (dlState.pending.length > 0) {
    const clientId = dlState.pending[0];
    const currentIndex = successCount + 1;
    const percent = Math.round((successCount / total) * 100);

    updateProgressUI(`Скачиваем (${currentIndex} из ${total})...`, percent, 'Подготовка фото...');

    try {
      const visitRes = await apiGet('getVisitById', { clientId: clientId });
      const visitData = (visitRes && visitRes.data) ? visitRes.data : visitRes;
      
      if (visitData && visitData.found) {
        let totalPhotos = 0;
        Object.keys(visitData.payload.results || {}).forEach(sk => {
          totalPhotos += (visitData.payload.results[sk].commonPhotos || []).length;
          Object.keys(visitData.payload.results[sk].photosByVariant || {}).forEach(v => {
            totalPhotos += (visitData.payload.results[sk].photosByVariant[v] || []).length;
          });
        });
        totalPhotos += (visitData.payload.extraPhotos || []).length;

        let downloadedPhotos = 0;
        
        await downloadVisitPhotos(visitData, (count) => {
          downloadedPhotos += count;
          updateProgressUI(
            `Скачиваем (${currentIndex} из ${total})...`, 
            percent, 
            `Фото: ${downloadedPhotos} из ${totalPhotos}`
          );
        });
        
        await window.db.saveOfflineVisit({
          clientId: visitData.clientId,
          kvNumber: visitData.payload.kvNumber,
          visitedAt: visitData.visitedAt,
          email: visitData.email,
          payload: visitData.payload
        });
      }

      dlState.pending.shift();
      dlState.done.push(clientId);
      successCount++;
      
      await window.db.setMeta('offline_download_state', dlState);
      
      if (!state.offlineDownloadedClientIds.includes(clientId)) {
        state.offlineDownloadedClientIds.push(clientId);
      }
      state.offlineDownloadedMap = await window.db.getAllOfflineVisitsInfo();
      
      // Если мы на экране скачивания, обновляем счетчик
      if (state.offlineDownloadScreen) {
        const countEl = document.querySelector('.step-header p b');
        if (countEl) countEl.textContent = state.offlineDownloadedClientIds.length;
        updateCheckboxUI();
      }

    } catch (err) {
      console.warn('[offline download] Ошибка с ID', clientId, err.message);
      await new Promise(r => setTimeout(r, 2000));
    }
    await new Promise(r => setTimeout(r, 300));
  }

  await window.db.setMeta('offline_download_state', null);
  state.pendingDownloadState = null;
  state.offlineDownloading = false;

  if (toast) {
    toast.style.background = '#00A82D';
    toast.innerHTML = `<div style="text-align:center; font-weight:600;">✅ Готово! Скачано: ${successCount} осм.</div>`;
    setTimeout(() => { 
      toast.remove(); 
      // Возвращаем контент на место
      const appEl = document.getElementById('app');
      if (appEl) appEl.style.paddingTop = ''; 
    }, 3000);
  }
}

async function resumeOfflineDownload() {
  state.offlineDownloading = true;
  await processOfflineDownloadQueue();
}

async function cancelOfflineDownload() {
  if (!confirm('Отменить скачивание? Уже скачанные осмотры останутся в памяти.')) return;
  await window.db.setMeta('offline_download_state', null);
  state.pendingDownloadState = null;
  state.offlineDownloading = false;
  
  const el = document.getElementById('globalProgressToast');
  if (el) el.remove();
  
  const appEl = document.getElementById('app');
  if (appEl) appEl.style.paddingTop = '';
  
  render();
}

function closeOfflineDownloadScreen() {
  state.offlineDownloadScreen = false;
  state.offlineKvSelected = {};
  state.offlineTree = [];
  const el = document.getElementById('inlineDownloadProgress');
  if (el) el.innerHTML = '';
  render();
}

// ================= ЭКСПОРТ ДЛЯ ONCLICK =================
window.forcePingCheck = forcePingCheck;
window.startBannerLongPress = startBannerLongPress;
window.cancelBannerLongPress = cancelBannerLongPress;
window.showPingDiagnostics = showPingDiagnostics;
window.showVisitPreview = showVisitPreview;
window.closeVisitPreview = closeVisitPreview;
window.openPhotoLightbox = openPhotoLightbox;
window.closePhotoLightbox = closePhotoLightbox;
window.uploadQueueToDrive = uploadQueueToDrive;
window.sendVisitNow = sendVisitNow;
window.resetVisitAttempts = resetVisitAttempts;
window.selectExistingVisit = selectExistingVisit;
window.toggleOfflineKv = toggleOfflineKv;
window.toggleOfflineSelectAll = toggleOfflineSelectAll;
window.onOfflineSearchInput = onOfflineSearchInput;
window.startSelectedOfflineDownload = startSelectedOfflineDownload;
window.closeOfflineDownloadScreen = closeOfflineDownloadScreen;
window.startSelectedOfflineDownload = startSelectedOfflineDownload;
window.toggleKvExpand = toggleKvExpand;
window.toggleOfflineVisit = toggleOfflineVisit;
window.resumeOfflineDownload = resumeOfflineDownload;
window.cancelOfflineDownload = cancelOfflineDownload;
window.toggleSettingsBlock = toggleSettingsBlock;

// ================= SVG-ИКОНКИ (стиль Evernote) =================
function iconHome(size) {
  const s = size || 24;
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5L12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9 21v-6h6v6"/></svg>`;
}
function iconList(size) {
  const s = size || 24;
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6"/><path d="M9 12h6"/><path d="M9 16h4"/></svg>`;
}
function iconPencil(size) {
  const s = size || 24;
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>`;
}
function iconArrowUpCircle(size) {
  const s = size || 24;
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 16V8"/><path d="M8 12l4-4 4 4"/></svg>`;
}
function iconCheckCircle(size) {
  const s = size || 24;
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/></svg>`;
}
function iconGear(size) {
  const s = size || 24;
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>`;
}
function iconChevronRight(size) {
  const s = size || 24;
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>`;
}
function iconX(size) {
  const s = size || 24;
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>`;
}
function iconRuler(size) {
  const s = size || 24;
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l14-14 4 4-14 14H3v-4z"/><path d="M14 6l1.5 1.5"/><path d="M11 9l1.5 1.5"/><path d="M8 12l1.5 1.5"/></svg>`;
}
function iconCamera(size) {
  const s = size || 24;
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>`;
}
function iconDownload(size) {
  const s = size || 24;
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
}
