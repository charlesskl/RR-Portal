const APP_BASE = window.APP_BASE || (() => {
  const marker = '/static/';
  const index = window.location.pathname.indexOf(marker);
  return index > 0 ? window.location.pathname.slice(0, index) : '';
})();

function appPath(path) {
  return `${APP_BASE}${path}`;
}

const TYPE_LABEL = {
  inbound_raw: '来料入库',
  issue: '领料',
  finished: '成品入库',
  semi_finished: '半成品入库',
  semi_inbound: '入库',
  semi_outbound: '出库',
};

const XINGXIN_DEPARTMENT = '兴信B来料仓';
const ASSEMBLY_DEPARTMENT = '东莞车间';
const SEMI_FINISHED_DEPARTMENT = '碟片半成品';
const OUTSOURCE_DEPARTMENT = '东莞加工厂利鸿';
const HONGYA_DEPARTMENT = '东莞加工厂鸿亚';
const OUTSOURCE_DEPARTMENTS = [OUTSOURCE_DEPARTMENT, HONGYA_DEPARTMENT];
const HEYUAN_DEPARTMENT = '河源华兴';
const SHAOYANG_DEPARTMENT = '邵阳华登';
const XINSHAO_DEPARTMENT = '新邵';
const NFC_MATERIAL = 'NFC贴纸';
const PCBA_MATERIAL = '77794-PCBA板';

let ME = null;
let RECORDS = [];
let ENTRY_TYPE_OPTIONS = [];
let ACTIVE_ENTRY_TYPE = '';
let ACTIVE_ENTRY_MATERIAL = '';
let DEPARTMENTS = [];
let SUPPLIERS = [];
let MATERIALS = [];
let STICKER_TYPES = [];
let SELECTED_RECORD_IDS = new Set();
let editingId = null;
let editingMaterialId = null;
let editingSupplierId = null;
let editingStickerTypeId = null;

function el(id) {
  return document.getElementById(id);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmt(n) {
  return Number(n || 0).toLocaleString('zh-CN');
}

function fmtNonZero(n) {
  const value = Number(n || 0);
  return value ? fmt(value) : '';
}

function hasMonthlyQuantity(total, values, key) {
  if (Number(total || 0) !== 0) return true;
  return (values || []).some(value => Number(((value || {})[key]) || 0) !== 0);
}

function isXingxin() {
  return ME && ME.department === XINGXIN_DEPARTMENT;
}

function isOutsource() {
  return ME && OUTSOURCE_DEPARTMENTS.includes(ME.department);
}

function isLihong() {
  return ME && ME.department === OUTSOURCE_DEPARTMENT;
}

function isHongya() {
  return ME && ME.department === HONGYA_DEPARTMENT;
}

function shouldHideLocationForType(type) {
  return type === 'inbound_raw'
    || (ME && ME.department === SEMI_FINISHED_DEPARTMENT && type !== 'semi_outbound')
    || isOutsource();
}

function isHeyuan() {
  return ME && ME.department === HEYUAN_DEPARTMENT;
}

function isShaoyang() {
  return ME && ME.department === SHAOYANG_DEPARTMENT;
}

function isXinshao() {
  return ME && ME.department === XINSHAO_DEPARTMENT;
}

function supportsPoCustomer() {
  return isShaoyang() || isXinshao();
}

function shouldShowPoCustomer() {
  return supportsPoCustomer() && el('recType').value === 'finished';
}

function typeLabel(type) {
  if (isXingxin()) {
    if (type === 'inbound_raw') return '入库';
    if (type === 'issue') return '出库';
  }
  if (ME && ME.department === ASSEMBLY_DEPARTMENT) {
    if (type === 'finished') return '成品入库';
    if (type === 'semi_finished') return '半成品入库';
  }
  if (ME && ME.department === SEMI_FINISHED_DEPARTMENT) {
    if (type === 'semi_inbound') return '入库';
    if (type === 'semi_outbound') return '出库';
  }
  if (isLihong()) {
    if (type === 'semi_finished') return '半成品出库';
  }
  if (isOutsource()) {
    if (type === 'finished') return '成品入库';
    if (type === 'semi_finished') return '半成品入库';
  }
  if (isHeyuan() || supportsPoCustomer()) {
    if (type === 'finished') return '成品入库';
  }
  return TYPE_LABEL[type] || type;
}

function entryTypeOptionsForDepartment() {
  if (isXingxin()) {
    return [
      {value: 'inbound_raw', label: '入库'},
      {value: 'issue', label: '出库'},
    ];
  }
  if (ME && ME.department === ASSEMBLY_DEPARTMENT) {
    return [
      {value: 'issue', label: '领料'},
      {value: 'finished', label: '成品入库'},
      {value: 'semi_finished', label: '半成品入库'},
    ];
  }
  if (ME && ME.department === SEMI_FINISHED_DEPARTMENT) {
    return [
      {value: 'semi_inbound', label: '入库'},
      {value: 'semi_outbound', label: '出库'},
    ];
  }
  if (isLihong()) {
    return [
      {value: 'issue', label: '领料'},
      {value: 'semi_finished', label: '半成品出库'},
    ];
  }
  if (isOutsource()) {
    return [
      {value: 'issue', label: '领料'},
      {value: 'finished', label: '成品入库'},
      {value: 'semi_finished', label: '半成品入库'},
    ];
  }
  if (isHeyuan() || isShaoyang() || isXinshao()) {
    return [
      {value: 'issue', label: '领料'},
      {value: 'finished', label: '成品入库'},
    ];
  }
  return [
    {value: 'inbound_raw', label: '来料入库'},
    {value: 'issue', label: '领料'},
    {value: 'finished', label: '成品入库'},
  ];
}

function renderEntryTypeTabs() {
  const tabs = el('entryTypeTabs');
  if (!tabs) return;
  tabs.innerHTML = ENTRY_TYPE_OPTIONS.map(opt => {
    const active = opt.value === ACTIVE_ENTRY_TYPE ? ' active' : '';
    return `<button type="button" class="entry-type-tab${active}" data-entry-type="${esc(opt.value)}">${esc(opt.label)}</button>`;
  }).join('');
  tabs.querySelectorAll('[data-entry-type]').forEach(btn => {
    btn.addEventListener('click', () => setEntryType(btn.dataset.entryType || ''));
  });
}

function setEntryType(type) {
  if (!ENTRY_TYPE_OPTIONS.some(opt => opt.value === type)) return;
  if (editingId && ACTIVE_ENTRY_TYPE !== type) cancelEdit();
  ACTIVE_ENTRY_TYPE = type;
  el('recType').value = type;
  onTypeChange();
  renderEntryTypeTabs();
  renderRecordsTable();
}

function entryMaterialOptions() {
  if (isLihong()) return MATERIALS.filter(m => m.name === PCBA_MATERIAL);
  if (isHongya()) return MATERIALS.filter(m => m.name === NFC_MATERIAL);
  const preferred = [NFC_MATERIAL, PCBA_MATERIAL];
  const byName = new Map(MATERIALS.map(m => [m.name, m]));
  const ordered = preferred
    .filter(name => byName.has(name))
    .map(name => byName.get(name));
  MATERIALS.forEach(m => {
    if (!preferred.includes(m.name)) ordered.push(m);
  });
  return ordered;
}

function renderEntryMaterialTabs() {
  const tabs = el('entryMaterialTabs');
  if (!tabs) return;
  const materials = entryMaterialOptions();
  tabs.innerHTML = materials.map(mat => {
    const active = mat.name === ACTIVE_ENTRY_MATERIAL ? ' active' : '';
    return `<button type="button" class="entry-type-tab${active}" data-entry-material="${esc(mat.name)}">${esc(mat.name)}</button>`;
  }).join('');
  tabs.querySelectorAll('[data-entry-material]').forEach(btn => {
    btn.addEventListener('click', () => setEntryMaterial(btn.dataset.entryMaterial || ''));
  });
}

function setEntryMaterial(material) {
  if (!entryMaterialOptions().some(mat => mat.name === material)) return;
  if (editingId && ACTIVE_ENTRY_MATERIAL !== material) cancelEdit();
  ACTIVE_ENTRY_MATERIAL = material;
  el('material').value = material;
  onMaterialChange();
  renderEntryMaterialTabs();
  renderRecordsTable();
}

async function api(path, opts) {
  const r = await fetch(appPath(path), opts);
  if (r.status === 401) {
    location.href = appPath('/');
    throw new Error('unauth');
  }
  return r;
}

function filterQuery() {
  const params = new URLSearchParams();
  const from = el('filterFrom').value;
  const to = el('filterTo').value;
  const docNo = el('filterDocNo').value.trim();
  if (from) params.set('date_from', from);
  if (to) params.set('date_to', to);
  if (docNo) params.set('doc_no', docNo);
  return params.toString();
}

function withFilters(path) {
  const query = filterQuery();
  return path + (query ? '?' + query : '');
}

function withEntryExportFilters(path) {
  const params = new URLSearchParams(filterQuery());
  if (ACTIVE_ENTRY_MATERIAL) params.set('material', ACTIVE_ENTRY_MATERIAL);
  const query = params.toString();
  return path + (query ? '?' + query : '');
}

function updateFilterText() {
  const from = el('filterFrom').value;
  const to = el('filterTo').value;
  const docNo = el('filterDocNo').value.trim();
  const parts = [];
  if (from && to) {
    parts.push(`日期：${from} 至 ${to}`);
  } else if (from) {
    parts.push(`日期：${from} 之后`);
  } else if (to) {
    parts.push(`日期：${to} 之前`);
  }
  if (docNo) parts.push(`单号：${docNo}`);
  el('currentFilterText').textContent = parts.length ? parts.join('，') : '当前显示全部日期';
}

function renderCurrentUser() {
  el('who').textContent = `${ME.username}（${ME.role === 'admin' ? '管理员' : '录入员'}） - ${ME.department}`;
  el('deptTitle').textContent = `${ME.department}工作台`;
}

function configureAdminDepartmentSwitcher() {
  const panel = document.getElementById('adminDepartmentSwitcher');
  if (!panel) return;
  if (!ME || ME.role !== 'admin') {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = '';
  const select = el('currentDepartmentSelect');
  select.innerHTML = DEPARTMENTS.map(name =>
    `<option value="${esc(name)}" ${name === ME.department ? 'selected' : ''}>${esc(name)}</option>`
  ).join('');
}

async function reloadWorkspaceAfterDepartmentSwitch() {
  SELECTED_RECORD_IDS.clear();
  cancelEdit();
  ACTIVE_ENTRY_TYPE = '';
  ACTIVE_ENTRY_MATERIAL = '';
  await loadLocations();
  await loadMaterials();
  await loadStickerTypes();
  await loadSuppliers();
  configureEntryForDepartment();
  onTypeChange();
  await loadRecords();
  if (el('summary').style.display !== 'none') await loadSummary();
  if (el('users').style.display !== 'none') await loadUsers();
}

async function switchCurrentDepartment() {
  const select = el('currentDepartmentSelect');
  const department = select.value;
  if (!department || department === ME.department) return;
  const previousDepartment = ME.department;
  const r = await api('/api/me/department', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({department}),
  });
  if (r.ok) {
    ME = await r.json();
    renderCurrentUser();
    configureAdminDepartmentSwitcher();
    await reloadWorkspaceAfterDepartmentSwitch();
    setMessage('entryErr', `已切换到 ${ME.department}`, true);
  } else {
    select.value = previousDepartment;
    const e = await r.json();
    alert(e.detail || '切换部门失败');
  }
}

async function init() {
  const r = await api('/api/me');
  ME = await r.json();
  renderCurrentUser();

  el('matTabBtn').style.display = '';
  el('supTabBtn').style.display = '';
  if (ME.role === 'admin') {
    el('usersTabBtn').style.display = '';
    await loadDepartments();
  } else {
    configureAdminDepartmentSwitcher();
  }

  await loadLocations();
  await loadMaterials();
  await loadStickerTypes();
  await loadSuppliers();
  configureEntryForDepartment();
  onTypeChange();
  updateFilterText();
  await loadRecords();
  showTab('entry');
}

async function loadDepartments() {
  const r = await api('/api/departments');
  DEPARTMENTS = await r.json();
  const sel = el('newDepartment');
  if (sel) {
    sel.innerHTML = DEPARTMENTS
      .map(name => `<option value="${esc(name)}">${esc(name)}</option>`)
      .join('');
  }
  configureAdminDepartmentSwitcher();
  configureClearDataPanel();
}

function configureEntryForDepartment() {
  const recType = el('recType');
  ENTRY_TYPE_OPTIONS = entryTypeOptionsForDepartment();
  recType.innerHTML = ENTRY_TYPE_OPTIONS
    .map(opt => `<option value="${esc(opt.value)}">${esc(opt.label)}</option>`)
    .join('');
  if (!ENTRY_TYPE_OPTIONS.some(opt => opt.value === ACTIVE_ENTRY_TYPE)) {
    ACTIVE_ENTRY_TYPE = ENTRY_TYPE_OPTIONS[0] ? ENTRY_TYPE_OPTIONS[0].value : '';
  }
  recType.value = ACTIVE_ENTRY_TYPE;
  renderEntryTypeTabs();
}

async function loadLocations() {
  const r = await api('/api/locations');
  const locs = await r.json();
  el('locationId').innerHTML = entryLocationOptions(locs)
    .map(l => `<option value="${l.id}">${esc(l.name)}</option>`)
    .join('');
}

function entryLocationOptions(locs) {
  if (!ME || !ME.department) return locs;
  return locs.filter(loc => loc.name !== ME.department);
}

async function loadMaterials() {
  const r = await api('/api/materials');
  const allMats = await r.json();
  const preferred = [NFC_MATERIAL, PCBA_MATERIAL, 'PCBA板'];
  const mats = allMats.slice().sort((a, b) => {
    const ai = preferred.indexOf(a.name);
    const bi = preferred.indexOf(b.name);
    if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    return a.id - b.id;
  });
  MATERIALS = mats;
  const entryMats = entryMaterialOptions();

  el('material').innerHTML = entryMats
    .map(m => `<option value="${esc(m.name)}">${esc(m.name)}</option>`)
    .join('');
  if (!entryMats.some(m => m.name === ACTIVE_ENTRY_MATERIAL)) {
    ACTIVE_ENTRY_MATERIAL = entryMats[0] ? entryMats[0].name : '';
  }
  el('material').value = ACTIVE_ENTRY_MATERIAL;
  renderEntryMaterialTabs();
  configureClearDataPanel();

  const form = el('materialForm');
  if (form) form.style.display = '';
  const tb = document.querySelector('#matTable tbody');
  if (tb) {
    tb.innerHTML = mats.map(m => {
      const ops = `<button class="btn-edit btn-sm" onclick="startMaterialEdit(${m.id})">修改</button>` +
        `<button class="btn-danger btn-sm" onclick="delMaterial(${m.id})">删除</button>`;
      return `<tr><td>${esc(m.name)}</td><td>${ops}</td></tr>`;
    }).join('');
  }
  onMaterialChange();
}

async function loadStickerTypes() {
  const r = await api('/api/sticker-types');
  STICKER_TYPES = await r.json();
  renderStickerPicker();
  renderStickerTypeTable();
}

function renderStickerPicker() {
  const grid = el('stickerTypeGrid');
  if (!grid) return;
  grid.innerHTML = STICKER_TYPES.map(s => `<div id="stickerItem-${s.id}" class="sticker-item">
    <label>
      <input id="stickerCheck-${s.id}" type="checkbox" class="sticker-check" data-id="${s.id}" data-name="${esc(s.name)}" onchange="onStickerCheckChange(${s.id})">
      <span>${esc(s.name)}</span>
    </label>
    <input id="stickerQty-${s.id}" type="number" min="0" placeholder="数量" disabled>
  </div>`).join('');
}

function onStickerCheckChange(id) {
  const checked = el('stickerCheck-' + id).checked;
  const qty = el('stickerQty-' + id);
  const item = el('stickerItem-' + id);
  qty.disabled = !checked;
  if (item) item.classList.toggle('selected', checked);
  if (!checked) {
    qty.value = '';
  } else {
    qty.focus();
  }
}

function getSelectedStickerItems() {
  const items = [];
  let invalid = false;
  document.querySelectorAll('.sticker-check:checked').forEach(box => {
    const qtyEl = el('stickerQty-' + box.dataset.id);
    const qty = Number(qtyEl.value);
    if (!qty || qty <= 0) {
      invalid = true;
      return;
    }
    items.push({sticker_type: box.dataset.name, qty});
  });
  return {items, invalid};
}

function clearStickerSelection() {
  document.querySelectorAll('.sticker-check').forEach(box => {
    box.checked = false;
    const qty = el('stickerQty-' + box.dataset.id);
    const item = el('stickerItem-' + box.dataset.id);
    if (qty) {
      qty.value = '';
      qty.disabled = true;
    }
    if (item) item.classList.remove('selected');
  });
}

function setStickerSelection(stickerType, qty) {
  clearStickerSelection();
  const item = STICKER_TYPES.find(s => s.name === stickerType);
  if (!item) return;
  const box = el('stickerCheck-' + item.id);
  const qtyEl = el('stickerQty-' + item.id);
  const itemEl = el('stickerItem-' + item.id);
  box.checked = true;
  qtyEl.disabled = false;
  qtyEl.value = qty || '';
  if (itemEl) itemEl.classList.add('selected');
}

function onMaterialChange() {
  const isSticker = el('material').value === NFC_MATERIAL;
  const picker = el('stickerPicker');
  if (picker) picker.style.display = isSticker ? '' : 'none';
  el('qty').style.display = isSticker ? 'none' : '';
  if (!isSticker) clearStickerSelection();
}

function renderStickerTypeTable() {
  const form = el('stickerTypeForm');
  if (form) form.style.display = '';
  const tb = document.querySelector('#stickerTypeTable tbody');
  if (!tb) return;
  tb.innerHTML = STICKER_TYPES.map(s => {
    const ops = `<button class="btn-edit btn-sm" onclick="startStickerTypeEdit(${s.id})">修改</button>` +
      `<button class="btn-danger btn-sm" onclick="delStickerType(${s.id})">删除</button>`;
    return `<tr><td>${esc(s.name)}</td><td>${fmt(s.sort)}</td><td>${ops}</td></tr>`;
  }).join('') || '<tr><td colspan="3">暂无贴纸类型</td></tr>';
}

function startStickerTypeEdit(id) {
  const item = STICKER_TYPES.find(s => s.id === id);
  editingStickerTypeId = id;
  el('newStickerType').value = item ? item.name : '';
  el('stickerTypeSubmitBtn').textContent = '保存修改';
  el('stickerTypeCancelBtn').style.display = '';
}

function cancelStickerTypeEdit() {
  editingStickerTypeId = null;
  el('newStickerType').value = '';
  el('stickerTypeSubmitBtn').textContent = '新增贴纸类型';
  el('stickerTypeCancelBtn').style.display = 'none';
}

async function saveStickerType() {
  const name = el('newStickerType').value.trim();
  const path = editingStickerTypeId ? '/api/sticker-types/' + editingStickerTypeId : '/api/sticker-types';
  const method = editingStickerTypeId ? 'PUT' : 'POST';
  const r = await api(path, {
    method,
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({name}),
  });
  if (r.ok) {
    cancelStickerTypeEdit();
    setMessage('stickerTypeErr', '', false);
    await loadStickerTypes();
  } else {
    const e = await r.json();
    setMessage('stickerTypeErr', e.detail || '保存失败', false);
  }
}

async function delStickerType(id) {
  if (!confirm('确定删除这个贴纸类型？已录入的历史记录不受影响。')) return;
  const r = await api('/api/sticker-types/' + id, {method: 'DELETE'});
  if (r.ok) await loadStickerTypes();
  else {
    const e = await r.json();
    alert(e.detail || '删除失败');
  }
}

async function loadSuppliers() {
  const r = await api('/api/suppliers');
  SUPPLIERS = await r.json();
  const sel = el('supplier');
  if (sel) {
    sel.innerHTML = '<option value="">供应商</option>' +
      SUPPLIERS.map(s => `<option value="${esc(s.name)}">${esc(s.name)}</option>`).join('');
  }
  const form = el('supplierForm');
  if (form) form.style.display = '';
  const tb = document.querySelector('#supTable tbody');
  if (tb) {
    tb.innerHTML = SUPPLIERS.map(s =>
      `<tr><td>${esc(s.name)}</td><td>${esc(s.created_at)}</td><td>${
        `<button class="btn-edit btn-sm" onclick="startSupplierEdit(${s.id})">修改</button><button class="btn-danger btn-sm" onclick="delSupplier(${s.id})">删除</button>`
      }</td></tr>`
    ).join('');
  }
}

function startSupplierEdit(id) {
  const item = SUPPLIERS.find(s => s.id === id);
  editingSupplierId = id;
  el('newSupplier').value = item ? item.name : '';
  el('supplierSubmitBtn').textContent = '保存修改';
  el('supplierCancelBtn').style.display = '';
}

function cancelSupplierEdit() {
  editingSupplierId = null;
  el('newSupplier').value = '';
  el('supplierSubmitBtn').textContent = '新增供应商';
  el('supplierCancelBtn').style.display = 'none';
}

async function saveSupplier() {
  const name = el('newSupplier').value.trim();
  const path = editingSupplierId ? '/api/suppliers/' + editingSupplierId : '/api/suppliers';
  const method = editingSupplierId ? 'PUT' : 'POST';
  const r = await api(path, {
    method,
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({name}),
  });
  if (r.ok) {
    cancelSupplierEdit();
    setMessage('supErr', '', false);
    await loadSuppliers();
  } else {
    const e = await r.json();
    setMessage('supErr', e.detail || '新增失败', false);
  }
}

async function delSupplier(id) {
  if (!confirm('确定删除这个供应商？已录入的记录不受影响。')) return;
  const r = await api('/api/suppliers/' + id, {method: 'DELETE'});
  if (r.ok) await loadSuppliers();
  else {
    const e = await r.json();
    alert(e.detail || '删除失败');
  }
}

function startMaterialEdit(id) {
  const item = MATERIALS.find(m => m.id === id);
  editingMaterialId = id;
  el('newMaterial').value = item ? item.name : '';
  el('materialSubmitBtn').textContent = '保存修改';
  el('materialCancelBtn').style.display = '';
}

function cancelMaterialEdit() {
  editingMaterialId = null;
  el('newMaterial').value = '';
  el('materialSubmitBtn').textContent = '新增物料';
  el('materialCancelBtn').style.display = 'none';
}

async function saveMaterial() {
  const name = el('newMaterial').value.trim();
  const path = editingMaterialId ? '/api/materials/' + editingMaterialId : '/api/materials';
  const method = editingMaterialId ? 'PUT' : 'POST';
  const r = await api(path, {
    method,
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({name}),
  });
  if (r.ok) {
    cancelMaterialEdit();
    setMessage('matErr', '', false);
    await loadMaterials();
  } else {
    const e = await r.json();
    setMessage('matErr', e.detail || '新增失败', false);
  }
}

async function delMaterial(id) {
  if (!confirm('确定删除这个物料名称？已录入的记录不受影响。')) return;
  const r = await api('/api/materials/' + id, {method: 'DELETE'});
  if (r.ok) await loadMaterials();
  else {
    const e = await r.json();
    alert(e.detail || '删除失败');
  }
}

function onTypeChange() {
  const t = el('recType').value;
  const hideLocation = shouldHideLocationForType(t);
  el('locationId').style.display = hideLocation ? 'none' : '';
  el('supplier').style.display = isXingxin() ? '' : 'none';

  const showPoCustomer = shouldShowPoCustomer();
  el('poNo').style.display = showPoCustomer ? '' : 'none';
  el('customerName').style.display = showPoCustomer ? '' : 'none';
  if (!showPoCustomer) {
    el('poNo').value = '';
    el('customerName').value = '';
  }
  onMaterialChange();
}

async function saveRecord() {
  const t = el('recType').value;
  const hideLocation = shouldHideLocationForType(t);
  const material = el('material').value || PCBA_MATERIAL;
  const isSticker = material === NFC_MATERIAL;
  const body = {
    rec_type: t,
    location_id: hideLocation ? null : Number(el('locationId').value),
    material,
    rec_date: el('recDate').value || null,
    doc_no: el('docNo').value,
    remark: el('remark').value,
  };
  if (isXingxin()) body.supplier = el('supplier').value;
  if (shouldShowPoCustomer()) {
    body.po_no = el('poNo').value;
    body.customer_name = el('customerName').value;
  }

  let path = editingId ? '/api/records/' + editingId : '/api/records';
  let method = editingId ? 'PUT' : 'POST';
  if (isSticker) {
    const selected = getSelectedStickerItems();
    if (selected.invalid) {
      setMessage('entryErr', '已选择的贴纸类型必须填写大于 0 的数量', false);
      return;
    }
    if (!selected.items.length) {
      setMessage('entryErr', '请选择贴纸类型并填写数量', false);
      return;
    }
    if (editingId && selected.items.length !== 1) {
      setMessage('entryErr', '修改单条记录时只能选择一种贴纸类型', false);
      return;
    }
    if (editingId) {
      body.qty = selected.items[0].qty;
      body.sticker_type = selected.items[0].sticker_type;
    } else {
      body.items = selected.items;
      path = '/api/records/batch';
      method = 'POST';
    }
  } else {
    body.qty = Number(el('qty').value);
  }

  const r = await api(path, {
    method,
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  });
  if (r.ok) {
    setMessage('entryErr', '', false);
    cancelEdit();
    await loadRecords();
    if (el('summary').style.display !== 'none') await loadSummary();
  } else {
    const e = await r.json();
    setMessage('entryErr', e.detail || '提交失败', false);
  }
}

function startEdit(id) {
  const rec = RECORDS.find(x => x.id === id);
  if (!rec) return;
  if (ENTRY_TYPE_OPTIONS.some(opt => opt.value === rec.rec_type)) {
    ACTIVE_ENTRY_TYPE = rec.rec_type;
    renderEntryTypeTabs();
  }
  if (entryMaterialOptions().some(mat => mat.name === rec.material)) {
    ACTIVE_ENTRY_MATERIAL = rec.material;
    renderEntryMaterialTabs();
  }
  el('recType').value = rec.rec_type;
  onTypeChange();
  if (rec.location_id) el('locationId').value = rec.location_id;
  el('material').value = rec.material || PCBA_MATERIAL;
  onMaterialChange();
  if (isXingxin()) el('supplier').value = rec.supplier || '';
  if (supportsPoCustomer() && rec.rec_type === 'finished') {
    el('poNo').value = rec.po_no || '';
    el('customerName').value = rec.customer_name || '';
  }
  el('recDate').value = rec.rec_date || '';
  el('docNo').value = rec.doc_no || '';
  if (rec.material === NFC_MATERIAL) {
    setStickerSelection(rec.sticker_type, rec.qty);
  } else {
    el('qty').value = rec.qty;
  }
  el('remark').value = rec.remark || '';
  editingId = id;
  el('submitBtn').textContent = '保存修改';
  el('cancelBtn').style.display = '';
  el('editBanner').textContent = '正在修改 #' + id;
  window.scrollTo({top: 0, behavior: 'smooth'});
}

function cancelEdit() {
  editingId = null;
  el('qty').value = '';
  clearStickerSelection();
  el('docNo').value = '';
  el('poNo').value = '';
  el('customerName').value = '';
  el('remark').value = '';
  el('recDate').value = '';
  if (isXingxin()) el('supplier').value = '';
  el('submitBtn').textContent = '提交';
  el('cancelBtn').style.display = 'none';
  el('editBanner').textContent = '';
}

async function loadRecords() {
  const r = await api(withFilters('/api/records'));
  RECORDS = await r.json();
  SELECTED_RECORD_IDS.clear();
  renderRecordsTable();
}

function visibleEntryRecords() {
  return RECORDS.filter(x =>
    (!ACTIVE_ENTRY_TYPE || x.rec_type === ACTIVE_ENTRY_TYPE) &&
    (!ACTIVE_ENTRY_MATERIAL || x.material === ACTIVE_ENTRY_MATERIAL)
  );
}

function canDeleteRecord(rec) {
  return !!rec && !rec.source_record_id && (ME.role === 'admin' || rec.created_by === ME.id);
}

function updateRecordSelectionUi(visibleRecords = null) {
  const records = visibleRecords || visibleEntryRecords();
  const deletable = records.filter(canDeleteRecord);
  const deletableIds = new Set(deletable.map(x => x.id));
  SELECTED_RECORD_IDS = new Set([...SELECTED_RECORD_IDS].filter(id => deletableIds.has(id)));
  const selectedCount = SELECTED_RECORD_IDS.size;
  const text = el('recordSelectedText');
  if (text) text.textContent = `已选择 ${selectedCount} 条`;
  const bulkBtn = el('bulkDeleteBtn');
  if (bulkBtn) bulkBtn.disabled = selectedCount === 0;
  const all = document.getElementById('recordSelectAll');
  if (all) {
    all.disabled = deletable.length === 0;
    all.checked = deletable.length > 0 && selectedCount === deletable.length;
    all.indeterminate = selectedCount > 0 && selectedCount < deletable.length;
  }
}

function onRecordSelectChange(id, checked) {
  if (checked) SELECTED_RECORD_IDS.add(id);
  else SELECTED_RECORD_IDS.delete(id);
  updateRecordSelectionUi();
}

function toggleRecordSelectionAll(checked) {
  visibleEntryRecords().forEach(x => {
    if (!canDeleteRecord(x)) return;
    if (checked) SELECTED_RECORD_IDS.add(x.id);
    else SELECTED_RECORD_IDS.delete(x.id);
  });
  renderRecordsTable();
}

function renderRecordsTable() {
  renderRecordHeader();
  const tb = document.querySelector('#recTable tbody');
  const emptyColspan = 11 + (isXingxin() ? 1 : 0) + (supportsPoCustomer() ? 2 : 0);
  const visibleRecords = visibleEntryRecords();
  updateRecordSelectionUi(visibleRecords);
  tb.innerHTML = visibleRecords.map(x => {
    const canEdit = ME.role === 'admin' || x.created_by === ME.id;
    const canDelete = canDeleteRecord(x);
    const checkTitle = x.source_record_id ? '自动生成记录不能直接删除' : '选择删除';
    const ops = canEdit
      ? `<button class="btn-edit btn-sm" onclick="startEdit(${x.id})">修改</button>` +
        `<button class="btn-danger btn-sm" onclick="delRecord(${x.id})">删除</button>`
      : '';
    return `<tr>
      <td class="select-col"><input type="checkbox" class="record-check" title="${checkTitle}" onchange="onRecordSelectChange(${x.id}, this.checked)" ${SELECTED_RECORD_IDS.has(x.id) ? 'checked' : ''} ${canDelete ? '' : 'disabled'}></td>
      <td>${esc(typeLabel(x.rec_type))}</td>
      <td>${esc(x.material)}</td>
      <td>${esc(x.sticker_type)}</td>
      <td>${esc(x.location_name)}</td>
      ${isXingxin() ? `<td>${esc(x.supplier)}</td>` : ''}
      <td>${esc(x.rec_date)}</td>
      <td>${esc(x.doc_no)}</td>
      ${supportsPoCustomer() ? `<td>${esc(x.po_no)}</td><td>${esc(x.customer_name)}</td>` : ''}
      <td>${fmt(x.qty)}</td>
      <td>${esc(x.remark)}</td>
      <td>${esc(x.created_by_name)}</td>
      <td>${ops}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="${emptyColspan}">当前页面暂无记录</td></tr>`;
  updateRecordSelectionUi(visibleRecords);
}

function renderRecordHeader() {
  const supplierHead = isXingxin() ? '<th>供应商</th>' : '';
  const poCustomerHead = supportsPoCustomer() ? '<th>PO</th><th>客名</th>' : '';
  document.querySelector('#recTable thead').innerHTML = `<tr>
    <th class="select-col"><input id="recordSelectAll" type="checkbox" title="全选可删除记录" onchange="toggleRecordSelectionAll(this.checked)"></th>
    <th>类型</th><th>物料名称</th><th>贴纸类型</th><th>加工点</th>${supplierHead}<th>日期</th><th>单据编号</th>${poCustomerHead}
    <th>数量</th><th>备注</th><th>录入人</th><th>操作</th>
  </tr>`;
}

async function delRecord(id) {
  if (!confirm('确定删除这条记录？')) return;
  const r = await api('/api/records/' + id, {method: 'DELETE'});
  if (r.ok) {
    if (editingId === id) cancelEdit();
    await loadRecords();
    if (el('summary').style.display !== 'none') await loadSummary();
  } else {
    const e = await r.json();
    alert(e.detail || '删除失败');
  }
}

async function deleteSelectedRecords() {
  const ids = [...SELECTED_RECORD_IDS];
  if (!ids.length) return;
  if (!confirm(`确定删除选中的 ${ids.length} 条记录？源记录的自动联动记录会一并删除。`)) return;
  const r = await api('/api/records/bulk-delete', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ids}),
  });
  if (r.ok) {
    const data = await r.json();
    SELECTED_RECORD_IDS.clear();
    if (ids.includes(editingId)) cancelEdit();
    await loadRecords();
    if (el('summary').style.display !== 'none') await loadSummary();
    setMessage('entryErr', `已删除 ${data.deleted || ids.length} 条记录`, true);
  } else {
    const e = await r.json();
    alert(e.detail || '批量删除失败');
  }
}

function configureClearDataPanel() {
  const panel = document.getElementById('clearDataPanel');
  if (!panel) return;
  if (!ME || ME.role !== 'admin') {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = '';
  const dept = el('clearDepartment');
  const material = el('clearMaterial');
  if (DEPARTMENTS.length) {
    const current = dept.value || ME.department;
    dept.innerHTML = DEPARTMENTS.map(name =>
      `<option value="${esc(name)}" ${name === current ? 'selected' : ''}>${esc(name)}</option>`
    ).join('');
  }
  if (MATERIALS.length) {
    const currentMaterial = material.value || ACTIVE_ENTRY_MATERIAL;
    material.innerHTML = MATERIALS.map(m =>
      `<option value="${esc(m.name)}" ${m.name === currentMaterial ? 'selected' : ''}>${esc(m.name)}</option>`
    ).join('');
  }
}

async function clearRecordsByDepartmentMaterial() {
  const department = el('clearDepartment').value;
  const material = el('clearMaterial').value;
  if (!department || !material) {
    setMessage('entryErr', '请选择要清空的部门和物料', false);
    return;
  }
  const ok = confirm(`确定清空「${department} / ${material}」的所有流水数据？此操作不可撤销。`);
  if (!ok) return;
  const r = await api('/api/records/clear', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({department, material}),
  });
  if (r.ok) {
    const data = await r.json();
    SELECTED_RECORD_IDS.clear();
    cancelEdit();
    await loadRecords();
    if (el('summary').style.display !== 'none') await loadSummary();
    setMessage('entryErr', `已清空 ${department} / ${material}，删除 ${data.deleted || 0} 条记录`, true);
  } else {
    const e = await r.json();
    setMessage('entryErr', e.detail || '清空失败', false);
  }
}

async function loadSummary() {
  const r = await api(withFilters('/api/summary'));
  const s = await r.json();
  renderSummaryCards(s);
  renderMaterialSummary(s.materials || []);
  renderStickerSummary(s.sticker_types || []);

  if (ME && ME.department === SEMI_FINISHED_DEPARTMENT) {
    el('sumTable').innerHTML =
      '<thead><tr><th>半成品入库总数</th><th>半成品出库总数</th><th>半成品应存</th></tr></thead>' +
      `<tbody><tr><td>${fmt(s.raw.inbound)}</td><td>${fmt(s.raw.outbound)}</td><td>${fmt(s.raw.balance)}</td></tr></tbody>`;
    return;
  }
  if (isLihong()) {
    el('sumTable').innerHTML =
      '<thead><tr><th>领料总数</th><th>半成品出库总数</th><th>应存数</th></tr></thead>' +
      `<tbody><tr><td>${fmt(s.raw.issue)}</td><td>${fmt(s.raw.semi_finished_inbound)}</td><td>${fmt(s.raw.balance)}</td></tr></tbody>`;
    return;
  }
  if (isOutsource()) {
    el('sumTable').innerHTML =
      '<thead><tr><th>领料总数</th><th>成品入库总数</th><th>半成品入库总数</th><th>应存数</th></tr></thead>' +
      `<tbody><tr><td>${fmt(s.raw.issue)}</td><td>${fmt(s.raw.finished_inbound)}</td><td>${fmt(s.raw.semi_finished_inbound)}</td><td>${fmt(s.raw.balance)}</td></tr></tbody>`;
    return;
  }
  if (s.monthly_locations) {
    el('sumTable').innerHTML = renderMonthlyLocationSummary(s.monthly_locations);
    return;
  }

  let html = '<thead><tr><th>范围</th><th>领料数</th><th>成品完成数</th><th>应存数</th></tr></thead><tbody>';
  for (const row of s.locations) {
    html += `<tr><td>${esc(row.location)}</td><td>${fmt(row.issue)}</td><td>${fmt(row.finished)}</td><td>${fmt(row.balance)}</td></tr>`;
  }
  html += `<tr class="subtotal"><td>小计</td><td>${fmt(s.subtotal.issue)}</td><td>${fmt(s.subtotal.finished)}</td><td>${fmt(s.subtotal.balance)}</td></tr>`;
  html += `<tr><th>来料仓入仓总数</th><th>来料仓出库总数</th><th>货仓应存</th><th></th></tr>`;
  html += `<tr><td>${fmt(s.raw.inbound)}</td><td>${fmt(s.raw.outbound)}</td><td>${fmt(s.raw.balance)}</td><td></td></tr>`;
  html += '</tbody>';
  el('sumTable').innerHTML = html;
}

function renderMonthlyLocationSummary(summary) {
  const months = summary.months || [
    {label: '6月月结'}, {label: '7月'}, {label: '8月'}, {label: '9月'},
    {label: '10月'}, {label: '11月'}, {label: '12月'},
  ];
  const monthHeads = months.map(month => `<th>${esc(month.label)}</th>`).join('');
  const monthCells = (values, key) => months.map((_, index) =>
    `<td>${fmtNonZero((values[index] || {})[key])}</td>`
  ).join('');
  const dataRow = (scope, material, item, total, values, key, className = '') => {
    if (!hasMonthlyQuantity(total, values, key)) return '';
    return `<tr class="${className}"><td>${esc(scope)}</td><td>${esc(material || '')}</td><td>${esc(item)}</td><td>${fmtNonZero(total)}</td>${monthCells(values || [], key)}<td></td></tr>`;
  };

  let html = `<thead><tr><th>范围</th><th>物料名称</th><th>项目</th><th>累计总数</th>${monthHeads}<th>备注</th></tr></thead><tbody>`;
  for (const row of summary.locations || []) {
    html += dataRow(row.location, row.material, '领料数', row.issue, row.values, 'issue');
    html += dataRow(row.location, row.material, '成品完成数', row.finished, row.values, 'finished');
    html += dataRow(row.location, row.material, '应存数', row.balance, row.values, 'balance');
  }
  const subtotal = summary.subtotal || {};
  html += dataRow('小计', '全部物料', '领料数', subtotal.issue, subtotal.values, 'issue', 'subtotal');
  html += dataRow('小计', '全部物料', '成品完成数', subtotal.finished, subtotal.values, 'finished', 'subtotal');
  html += dataRow('小计', '全部物料', '应存数', subtotal.balance, subtotal.values, 'balance', 'subtotal');
  const raw = summary.raw || {};
  html += '<tr class="summary-spacer"><td colspan="12"></td></tr>';
  html += dataRow('来料仓', '全部物料', '入仓总数', raw.inbound, raw.values, 'inbound');
  html += dataRow('来料仓', '全部物料', '出库总数', raw.outbound, raw.values, 'outbound');
  html += dataRow('货仓', '全部物料', '应存', raw.balance, raw.values, 'balance');
  html += '</tbody>';
  return html;
}

function renderSummaryCards(s) {
  const raw = s.raw || {};
  const cards = [
    ['入库合计', raw.inbound || 0],
    ['出库/领料', raw.outbound || 0],
    ['当前结余', raw.balance || 0],
    ['物料分类', (s.materials || []).length],
  ];
  el('summaryCards').innerHTML = cards.map(([label, value]) =>
    `<div class="metric-card"><span>${label}</span><strong>${fmt(value)}</strong></div>`
  ).join('');
}

function renderMaterialSummary(materials) {
  el('materialSummaryRows').innerHTML = materials.map(row => `<tr>
    <td>${esc(row.material)}</td>
    <td>${fmt(row.inbound)}</td>
    <td>${fmt(row.outbound)}</td>
    <td>${fmt(row.balance)}</td>
  </tr>`).join('') || '<tr><td colspan="4">暂无数据</td></tr>';
}

function renderStickerSummary(stickerTypes) {
  const block = el('stickerSummaryBlock');
  if (!block) return;
  block.style.display = stickerTypes.length ? '' : 'none';
  el('stickerSummaryRows').innerHTML = stickerTypes.map(row => `<tr>
    <td>${esc(row.sticker_type)}</td>
    <td>${fmt(row.inbound)}</td>
    <td>${fmt(row.outbound)}</td>
    <td>${fmt(row.balance)}</td>
  </tr>`).join('') || '<tr><td colspan="4">暂无数据</td></tr>';
}

async function applyFilters() {
  updateFilterText();
  await loadRecords();
  if (el('summary').style.display !== 'none') await loadSummary();
}

async function clearFilters() {
  el('filterFrom').value = '';
  el('filterTo').value = '';
  el('filterDocNo').value = '';
  await applyFilters();
}

function exportExcel() {
  location.href = appPath(withFilters('/api/export'));
}

function setMessage(id, message, ok) {
  const node = el(id);
  node.textContent = message;
  node.classList.toggle('ok', !!ok);
}

function chooseImportFile(id) {
  const input = el(id);
  input.value = '';
  input.click();
}

function updateFileName(inputId, labelId) {
  const input = el(inputId);
  const label = el(labelId);
  const file = input.files && input.files[0];
  if (label) label.textContent = file ? file.name : '未选择文件';
}

function downloadRecordTemplate() {
  location.href = appPath('/api/records/import-template');
}

function exportRecords() {
  location.href = appPath(withEntryExportFilters('/api/records/export'));
}

function shaoyangReconcileFormData() {
  const issueFile = el('shaoyangIssueFile').files && el('shaoyangIssueFile').files[0];
  const finishedFile = el('shaoyangFinishedFile').files && el('shaoyangFinishedFile').files[0];
  if (!issueFile || !finishedFile) {
    setMessage('shaoyangReconcileErr', '请先选择两个表格文件', false);
    return null;
  }
  const form = new FormData();
  form.append('month', el('shaoyangReconcileMonth').value || '7');
  form.append('issue_file', issueFile);
  form.append('finished_file', finishedFile);
  return form;
}

async function reconcileShaoyangCd() {
  const form = shaoyangReconcileFormData();
  if (!form) return;
  const r = await api('/api/shaoyang-cd/reconcile', {
    method: 'POST',
    body: form,
  });
  if (!r.ok) {
    const e = await r.json();
    setMessage('shaoyangReconcileErr', e.detail || '核对失败', false);
    return;
  }
  const data = await r.json();
  setMessage('shaoyangReconcileErr', `已完成 ${data.month} 月核对`, true);
  renderShaoyangReconcile(data);
}

async function exportShaoyangIssueWorkbook() {
  const form = shaoyangReconcileFormData();
  if (!form) return;
  const r = await api('/api/shaoyang-cd/export-issue', {
    method: 'POST',
    body: form,
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    setMessage('shaoyangReconcileErr', e.detail || '导出领料表失败', false);
    return;
  }
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = '邵阳77772#CD领料明细-已填成品入仓.xlsx';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setMessage('shaoyangReconcileErr', '已生成导出领料表', true);
}

function renderShaoyangReconcile(data) {
  const totals = data.totals || {};
  const cards = [
    [`${data.month}月成品入仓数`, totals.issue_month_inbound || 0],
    ['第二表小计', totals.finished_total || 0],
    ['差异', totals.difference || 0],
    ['核对行数', (data.rows || []).length],
  ];
  el('shaoyangReconcileCards').innerHTML = cards.map(([label, value]) =>
    `<div class="metric-card"><span>${esc(label)}</span><strong>${fmt(value)}</strong></div>`
  ).join('');

  const rows = data.rows || [];
  const body = el('shaoyangReconcileTable').querySelector('tbody');
  body.innerHTML = rows.map(row => {
    const diff = Number(row.difference || 0);
    const cls = diff === 0 ? 'reconcile-ok' : 'reconcile-diff';
    return `<tr class="${cls}">
      <td>${fmt(row.sticker_no)}</td>
      <td>${esc(row.sticker_name)}</td>
      <td>${esc(row.item_no)}</td>
      <td>${esc(row.minis_name)}</td>
      <td>${fmt(row.issue_month_inbound)}</td>
      <td>${row.finished_total == null ? '' : fmt(row.finished_total)}</td>
      <td>${fmt(diff)}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="7">没有读取到可核对的数据</td></tr>';
}

async function importFile(input, endpoint, errId, afterImport) {
  const file = input.files && input.files[0];
  if (!file) return;
  const form = new FormData();
  form.append('file', file);
  const r = await api(endpoint, {
    method: 'POST',
    body: form,
  });
  if (r.ok) {
    const data = await r.json();
    const count = data.created == null ? data.imported : data.created;
    const parts = [`导入成功：${fmt(count)} 条`];
    if (data.monthly_totals) parts.push(`更新当月汇总 ${fmt(data.monthly_totals)} 项`);
    if (data.skipped) parts.push(`跳过 ${fmt(data.skipped)} 条重复数据`);
    if (data.skipped_documents) parts.push(`跳过 ${fmt(data.skipped_documents)} 张重复单据`);
    if (data.replaced_documents) parts.push(`覆盖 ${fmt(data.replaced_documents)} 张单据`);
    setMessage(errId, parts.join('，'), true);
    if (afterImport) await afterImport();
  } else {
    const e = await r.json().catch(() => ({}));
    setMessage(errId, e.detail || '导入失败', false);
  }
}

function onRecordImportFileSelected(input) {
  updateFileName('recordImportFile', 'recordImportFileName');
  el('recordImportCheckResult').style.display = 'none';
  el('recordImportCheckResult').innerHTML = '';
  setMessage('entryErr', '', false);
}

function selectedRecordImportFile() {
  return el('recordImportFile').files && el('recordImportFile').files[0];
}

function recordImportFormData(includeMode) {
  const file = selectedRecordImportFile();
  if (!file) {
    setMessage('entryErr', '请先选择 Excel 文件', false);
    return null;
  }
  const form = new FormData();
  form.append('file', file);
  if (includeMode) form.append('mode', el('recordImportMode').value || 'skip');
  return form;
}

async function checkRecordImport() {
  const form = recordImportFormData(false);
  if (!form) return;
  const r = await api('/api/records/import-check', {method: 'POST', body: form});
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    setMessage('entryErr', e.detail || '查重失败', false);
    return;
  }
  const data = await r.json();
  const duplicates = data.duplicate_documents || [];
  const result = el('recordImportCheckResult');
  result.style.display = '';
  result.innerHTML = `
    <div class="import-check-summary">
      <strong>查重结果</strong>
      <span>文件单据 ${fmt(data.documents)} 张</span>
      <span>重复 ${fmt(data.duplicates)} 张</span>
      ${data.blank_doc_rows ? `<span>无单号明细 ${fmt(data.blank_doc_rows)} 条</span>` : ''}
    </div>
    ${duplicates.length ? `<div class="duplicate-doc-list">${duplicates.map(row => `
      <span title="文件 ${fmt(row.file_rows)} 条，已有 ${fmt(row.existing_rows)} 条">
        ${esc(row.doc_no)}${row.target_department ? ` · ${esc(row.target_department)}` : ''}
      </span>`).join('')}</div>` : '<p>没有发现重复单据，可以直接导入。</p>'}
  `;
  setMessage('entryErr', duplicates.length ? '查重完成，请选择导入模式' : '查重完成，没有重复单据', true);
}

async function importSelectedRecords() {
  const mode = el('recordImportMode').value || 'skip';
  if (mode === 'replace' && !confirm('覆盖导入会替换文件中同单号的原明细及自动联动记录，确定继续吗？')) {
    return;
  }
  const form = recordImportFormData(true);
  if (!form) return;
  const r = await api('/api/records/import', {method: 'POST', body: form});
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    setMessage('entryErr', e.detail || '导入失败', false);
    return;
  }
  const data = await r.json();
  const parts = [`导入成功：${fmt(data.created || 0)} 条`];
  if (data.monthly_totals) parts.push(`更新当月汇总 ${fmt(data.monthly_totals)} 项`);
  if (data.skipped_documents) parts.push(`跳过 ${fmt(data.skipped_documents)} 张重复单据`);
  if (data.replaced_documents) parts.push(`覆盖 ${fmt(data.replaced_documents)} 张单据`);
  setMessage('entryErr', parts.join('，'), true);
  await (async () => {
    cancelEdit();
    await loadRecords();
    if (el('summary').style.display !== 'none') await loadSummary();
  });
}

async function importRecords(input) {
  onRecordImportFileSelected(input);
  await importSelectedRecords();
}

function exportMaterials() {
  location.href = appPath('/api/materials/export');
}

async function importMaterials(input) {
  await importFile(input, '/api/materials/import', 'matErr', loadMaterials);
}

function exportSuppliers() {
  location.href = appPath('/api/suppliers/export');
}

async function importSuppliers(input) {
  await importFile(input, '/api/suppliers/import', 'supErr', loadSuppliers);
}

function exportStickerTypes() {
  location.href = appPath('/api/sticker-types/export');
}

async function importStickerTypes(input) {
  await importFile(input, '/api/sticker-types/import', 'stickerTypeErr', loadStickerTypes);
}

async function loadUsers() {
  const r = await api('/api/users');
  if (!r.ok) return;
  const users = await r.json();
  const tb = document.querySelector('#userTable tbody');
  tb.innerHTML = users.map(u => {
    const roleSelect = `<select id="userRole-${u.id}" class="table-input">
      <option value="operator" ${u.role === 'operator' ? 'selected' : ''}>录入员</option>
      <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>管理员</option>
    </select>`;
    const deptSelect = `<select id="userDept-${u.id}" class="table-input">
      ${DEPARTMENTS.map(name => `<option value="${esc(name)}" ${u.department === name ? 'selected' : ''}>${esc(name)}</option>`).join('')}
    </select>`;
    const actions = `<div class="inline-actions">
      <button class="btn-edit btn-sm" onclick="saveUser(${u.id})">保存资料</button>
      <input id="userPw-${u.id}" class="table-input" type="password" placeholder="新密码">
      <button class="btn-edit btn-sm" onclick="resetUserPassword(${u.id})">改密码</button>
    </div>`;
    return `<tr>
      <td>${esc(u.username)}</td>
      <td>${roleSelect}</td>
      <td>${deptSelect}</td>
      <td>${esc(u.created_at)}</td>
      <td>${actions}</td>
    </tr>`;
  }).join('');
}

async function createUser() {
  const body = {
    username: el('newUser').value.trim(),
    password: el('newPw').value,
    role: el('newRole').value,
    department: el('newDepartment').value,
  };
  const r = await api('/api/users', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  });
  if (r.ok) {
    el('userErr').textContent = '';
    el('newUser').value = '';
    el('newPw').value = '';
    await loadUsers();
  } else {
    const e = await r.json();
    el('userErr').textContent = e.detail || '新增失败';
  }
}

async function saveUser(id) {
  const body = {
    role: el('userRole-' + id).value,
    department: el('userDept-' + id).value,
  };
  const r = await api('/api/users/' + id, {
    method: 'PUT',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  });
  if (r.ok) {
    el('userErr').textContent = '';
    await loadUsers();
  } else {
    const e = await r.json();
    el('userErr').textContent = e.detail || '修改失败';
  }
}

async function resetUserPassword(id) {
  const password = el('userPw-' + id).value;
  const r = await api('/api/users/' + id + '/password', {
    method: 'PUT',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({password}),
  });
  if (r.ok) {
    el('userErr').textContent = '密码已修改';
    el('userPw-' + id).value = '';
  } else {
    const e = await r.json();
    el('userErr').textContent = e.detail || '密码修改失败';
  }
}

async function changeMyPassword() {
  const password = el('myNewPassword').value;
  const confirmPassword = el('myConfirmPassword').value;
  if (password !== confirmPassword) {
    el('passwordErr').textContent = '两次输入的新密码不一致';
    return;
  }
  const r = await api('/api/me/password', {
    method: 'PUT',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({password}),
  });
  if (r.ok) {
    el('passwordErr').textContent = '密码已修改';
    el('myNewPassword').value = '';
    el('myConfirmPassword').value = '';
  } else {
    const e = await r.json();
    el('passwordErr').textContent = e.detail || '密码修改失败';
  }
}

function showTab(name) {
  for (const id of ['entry', 'summary', 'shaoyangReconcile', 'materials', 'suppliers', 'users', 'password']) {
    el(id).style.display = id === name ? '' : 'none';
  }
  document.querySelectorAll('.tab-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.tab === name)
  );
  if (name === 'summary') loadSummary();
  if (name === 'materials') {
    loadMaterials();
    loadStickerTypes();
  }
  if (name === 'suppliers') loadSuppliers();
  if (name === 'users') loadUsers();
}

async function logout() {
  await fetch(appPath('/api/logout'), {method: 'POST'});
  location.href = appPath('/');
}

init();
