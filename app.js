// ================= НАСТРОЙКИ =================
const API_URL = 'https://verdant-nasturtium-c02297.netlify.app/api';

// ================= СОСТОЯНИЕ =================
const state = {
  user: null,
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
  pendingDraft: null
};

// ================= СТАРТ =================
document.addEventListener('DOMContentLoaded', init);

async function init() {
  state.user = { email: 'осмотрщик' };
  const draft = await checkDraftOnStart();
  state.pendingDraft = draft;
  state.screen = 'home';
  render();

  // Попробовать тихо обновить справочник, если функция есть
  if (window.db && window.db.silentUpdateReference) {
    window.db.silentUpdateReference().catch(() => {});
  }
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
  if (state.screen === 'home')        return renderHome(app);
  if (state.screen === 'newVisitKv')  return renderNewVisitKv(app);
  if (state.screen === 'newVisitRef') return renderNewVisitRef(app);
  if (state.screen === 'division')    return renderDivision(app);
  if (state.screen === 'done')        return renderDone(app);
}

// ================= ГЛАВНЫЙ ЭКРАН =================
function renderHome(app) {
  const hasDraft = !!state.pendingDraft;
  const draftInfo = hasDraft && state.pendingDraft.form
    ? `Квартира ${state.pendingDraft.form.kvNumber || '—'}` : '';

  app.innerHTML = `
    <div class="user-greeting">
      <div class="avatar">О</div>
      <div class="email">Осмотр квартир</div>
    </div>
    ${hasDraft ? `
    <div class="card" style="background:#fff8e1;border:1px solid #f9ab00;">
      <h2 style="margin-bottom:8px;">📋 Незавершённый осмотр</h2>
      <p style="color:#b06000;font-size:14px;">У вас есть сохранённый черновик: ${escapeHtml(draftInfo)}.</p>
      <button class="btn btn-primary btn-large" style="margin-top:12px;" onclick="continueDraft()">▶ Продолжить черновик</button>
      <button class="btn btn-secondary" style="margin-top:8px;" onclick="discardDraft()">🗑 Удалить черновик</button>
    </div>` : ''}
    <div class="card">
      <button class="btn btn-primary btn-large" onclick="startNewVisit()">🏠 Новый осмотр</button>
      <button class="btn btn-secondary" onclick="showDiagnostics()">🔍 Диагностика</button>
      <button class="btn btn-secondary" onclick="testNetwork()">📡 Тест сети</button>
    </div>
  `;
}

// ================= ТЕСТ СЕТИ =================
async function testNetwork() {
  const lines = [];
  lines.push('=== Тест связи с GAS ===');
  lines.push('Сеть: ' + (navigator.onLine ? 'онлайн' : 'офлайн'));
  lines.push('API_URL: ' + API_URL);
  lines.push('');

  // Тест 1: ping
  try {
    lines.push('1) ping…');
    const r = await apiGet('ping');
    lines.push('   OK: ' + JSON.stringify(r).substring(0, 120));
  } catch (e) {
    lines.push('   ОШИБКА: ' + e.message);
  }

  // Тест 2: getVersion
  try {
    lines.push('2) getVersion…');
    const r = await apiGet('getVersion');
    lines.push('   OK: ' + JSON.stringify(r).substring(0, 200));
  } catch (e) {
    lines.push('   ОШИБКА: ' + e.message);
  }

  // Тест 3: getReference
  try {
    lines.push('3) getReference…');
    const r = await apiGet('getReference');
    const data = (r && r.data) ? r.data : r;
    const cnt = data && typeof data === 'object' ? Object.keys(data).length : '?';
    lines.push('   OK, квартир: ' + cnt);
    if (cnt > 0) {
      const sampleKey = Object.keys(data)[0];
      lines.push('   Пример ключа: ' + sampleKey);
    }
  } catch (e) {
    lines.push('   ОШИБКА: ' + e.message);
  }

  // Тест 4: запись в IndexedDB
  try {
    lines.push('4) Запись в IndexedDB…');
    await window.db.setReference({ sample: 1 });
    const r = await window.db.getReference();
    lines.push('   OK, записано: ' + (r ? Object.keys(r).length : '?'));
    await window.db.setReference({});
  } catch (e) {
    lines.push('   ОШИБКА: ' + e.message);
  }

  alert(lines.join('\n'));
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
      'Хранилища (' + stores.length + '):\n' + stores.join(', ') + '\n\n' +
      'Справочник: ' + refCount + ' квартир\n' +
      'Замечания: ' + remCount + ' типов\n' +
      'Марки окон: ' + marksCount + '\n' +
      'Версия данных: ' + (version ? JSON.stringify(version) : '—') + '\n\n' +
      'Очередь осмотров: ' + stats.pendingVisits + '\n' +
      'Очередь фото: ' + stats.pendingPhotos + '\n\n' +
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
  if (window.db && window.db.clearDraft) await window.db.clearDraft();
  state.pendingDraft = null;
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
  state.screen = 'newVisitKv';
  if (window.db && window.db.clearDraft) window.db.clearDraft().catch(() => {});
  render();
}

function renderNewVisitKv(app) {
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
      <button class="btn btn-primary btn-large" id="kvNextBtn" onclick="onKvNext()" disabled>Далее →</button>
      <button class="btn btn-secondary" onclick="goHome()">← Отмена</button>
    </div>
  `;
  setTimeout(() => { const i = document.getElementById('kvInput'); if (i) i.focus(); }, 100);
}

let _kvCheckTimeout = null;

function onKvInput(value) {
  state.form.kvNumber = value;
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
        if (result) {
          result.innerHTML = `
            <div class="apartment-preview">
              <div class="apartment-preview-title">✓ ${data.fromCache ? 'Найдено в кэше' : 'Найдено в справочнике'}</div>
              <div class="apartment-preview-grid">
                <div><span>Площадь:</span> ${escapeHtml(data.data.area || '—')}</div>
                <div><span>Этаж:</span> ${escapeHtml(data.data.floor || '—')}</div>
                <div><span>Комнат:</span> ${escapeHtml(data.data.roomsNum || '—')}</div>
                <div><span>Санузлов:</span> ${escapeHtml(data.data.bathrooms || '—')}</div>
              </div>
            </div>
          `;
        }
        if (btn) btn.disabled = false;
      } else {
        state.form.apartment = null;
        if (result) result.innerHTML = `<div class="apartment-not-found">⚠ Квартира "${escapeHtml(kv)}" не найдена в справочнике.</div>`;
      }
    } catch (err) {
      if (result) result.innerHTML = `<div class="error-box">${escapeHtml(err.message)}</div>`;
    }
  }, 400);
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
    throw netErr;
  }
}

function backToKv() { state.screen = 'newVisitKv'; render(); }
function goHome() { state.screen = 'home'; render(); }

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

  for (let i = 0; i < files.length; i++) {
    state.form.uploading[stateKey] = { current: i + 1, total: files.length };
    updateObjectCard(stateKey);

    try {
      const file = files[i];
      const compressed = await compressImage(file);
      const fileName = buildFileName(divisionKey, objectKey, i + 1 + rs.photos.length);

      const photoResult = await uploadPhotoInChunks(compressed, fileName, kv);

      rs.photos.push({
        fileId: photoResult.fileId,
        url: photoResult.url,
        name: fileName,
        objectKey: objectKey,
        divisionKey: divisionKey
      });
      state.form.results[stateKey] = rs;
      updateObjectCard(stateKey);
      autoSave();
    } catch (err) {
      console.error('Ошибка загрузки фото:', err);
      alert('Не удалось загрузить фото: ' + (err.message || err));
    }
  }

  delete state.form.uploading[stateKey];
  updateObjectCard(stateKey);
}

async function uploadPhotoInChunks(base64, fileName, kvNumber) {
  const uploadId = 'up_' + Date.now() + '_' + Math.random().toString(36).substring(2, 10);
  const CHUNK_SIZE = 1800;
  const totalChunks = Math.ceil(base64.length / CHUNK_SIZE);

  let finalResult = null;
  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
    const start = chunkIndex * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, base64.length);
    const chunkData = base64.substring(start, end);

    const chunkRes = await apiGet('uploadPhotoChunk', {
      uploadId: uploadId,
      chunkIndex: chunkIndex,
      totalChunks: totalChunks,
      data: chunkData,
      fileName: fileName,
      kvNumber: kvNumber
    });

    const result = chunkRes.data || chunkRes;
    if (result && result.fileId) {
      finalResult = result;
    }
  }

  if (!finalResult || !finalResult.fileId) {
    throw new Error('Фото не собралось из кусков');
  }
  return finalResult;
}

function removePhoto(stateKey, index) {
  const rs = state.form.results[stateKey];
  if (!rs || !rs.photos) return;
  rs.photos.splice(index, 1);
  state.form.results[stateKey] = rs;
  updateObjectCard(stateKey);
  autoSave();
}

function compressImage(file) {
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
        const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
        const base64 = dataUrl.split(',')[1];
        resolve(base64);
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
  for (let i = 0; i < files.length; i++) {
    state.form.uploading['__extra__'] = { current: i + 1, total: files.length };
    render();
    try {
      const file = files[i];
      const compressed = await compressImage(file);
      const fileName = buildFileName('extra', 'photo', i + 1 + state.form.extraPhotos.length);

      const photoResult = await uploadPhotoInChunks(compressed, fileName, kv);

      state.form.extraPhotos.push({
        fileId: photoResult.fileId,
        url: photoResult.url,
        name: fileName
      });
      render();
      autoSave();
    } catch (err) {
      console.error('Ошибка загрузки доп. фото:', err);
      alert('Не удалось загрузить фото: ' + (err.message || err));
    }
  }
  delete state.form.uploading['__extra__'];
  render();
}

function removeExtraPhoto(index) {
  if (!state.form.extraPhotos) return;
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
  app.innerHTML = '<div class="loading">Отправка…</div>';

  try {
    const payload = {
      email: (state.user && state.user.email) || '',
      kvNumber: state.form.kvNumber,
      results: state.form.results,
      extraPhotos: state.form.extraPhotos || [],
      comments: state.form.comments || '',
      visitedAt: new Date().toISOString()
    };

    await apiGet('submitVisit', payload);
    await new Promise(resolve => setTimeout(resolve, 2000));

    if (window.db && window.db.clearDraft) await window.db.clearDraft();

    state.screen = 'done';
    state.submitResult = { row: null };
    render();
    window.scrollTo(0, 0);
  } catch (err) {
    app.innerHTML = `
      <div class="error-box"><strong>Ошибка отправки:</strong><br>${escapeHtml(err.message)}</div>
      <button class="btn btn-secondary" onclick="submitVisit()">Попробовать снова</button>
    `;
  }
}

function renderDone(app) {
  app.innerHTML = `
    <div class="card" style="text-align:center;">
      <div class="done-icon">✅</div>
      <h2>Осмотр отправлен</h2>
      <p style="margin-top:12px;">Данные записаны в таблицу.</p>
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
    savedAt: new Date().toISOString()
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
    if (draft && draft.form && draft.form.kvNumber) return draft;
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
