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
const ASSEMBLY_DEPARTMENT = '装配';
const SEMI_FINISHED_DEPARTMENT = '半成品';
const OUTSOURCE_DEPARTMENT = '外发';
const HEYUAN_DEPARTMENT = '河源华兴';
const SHAOYANG_DEPARTMENT = '邵阳';
const XINSHAO_DEPARTMENT = '新邵';
const NFC_MATERIAL = 'NFC贴纸';

let ME = null;
let RECORDS = [];
let DEPARTMENTS = [];
let SUPPLIERS = [];
let MATERIALS = [];
let STICKER_TYPES = [];
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

function isXingxin() {
  return ME && ME.department === XINGXIN_DEPARTMENT;
}

function isOutsource() {
  return ME && ME.department === OUTSOURCE_DEPARTMENT;
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
  if (isOutsource()) {
    if (type === 'finished') return '成品入库';
    if (type === 'semi_finished') return '半成品入库';
  }
  if (isHeyuan() || supportsPoCustomer()) {
    if (type === 'finished') return '成品入库';
  }
  return TYPE_LABEL[type] || type;
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

async function init() {
  const r = await api('/api/me');
  ME = await r.json();
  el('who').textContent = `${ME.username}（${ME.role === 'admin' ? '管理员' : '录入员'}） - ${ME.department}`;
  el('deptTitle').textContent = `${ME.department}工作台`;

  el('matTabBtn').style.display = '';
  el('supTabBtn').style.display = '';
  if (ME.role === 'admin') {
    el('usersTabBtn').style.display = '';
    await loadDepartments();
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
}

function configureEntryForDepartment() {
  const recType = el('recType');
  if (isXingxin()) {
    recType.innerHTML = '<option value="inbound_raw">入库</option><option value="issue">出库</option>';
  } else if (ME && ME.department === ASSEMBLY_DEPARTMENT) {
    recType.innerHTML = '<option value="issue">领料</option><option value="finished">成品入库</option><option value="semi_finished">半成品入库</option>';
  } else if (ME && ME.department === SEMI_FINISHED_DEPARTMENT) {
    recType.innerHTML = '<option value="semi_inbound">入库</option><option value="semi_outbound">出库</option>';
  } else if (isOutsource()) {
    recType.innerHTML = '<option value="finished">成品入库</option><option value="semi_finished">半成品入库</option>';
  } else if (isHeyuan() || isShaoyang() || isXinshao()) {
    recType.innerHTML = '<option value="issue">领料</option><option value="finished">成品入库</option>';
  } else {
    recType.innerHTML = '<option value="inbound_raw">来料入库</option><option value="issue">领料</option><option value="finished">成品入库</option>';
  }
}

async function loadLocations() {
  const r = await api('/api/locations');
  const locs = await r.json();
  el('locationId').innerHTML = locs
    .map(l => `<option value="${l.id}">${esc(l.name)}</option>`)
    .join('');
}

async function loadMaterials() {
  const r = await api('/api/materials');
  const allMats = await r.json();
  const preferred = [NFC_MATERIAL, 'PCBA板'];
  const mats = allMats.slice().sort((a, b) => {
    const ai = preferred.indexOf(a.name);
    const bi = preferred.indexOf(b.name);
    if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    return a.id - b.id;
  });
  MATERIALS = mats;

  el('material').innerHTML = mats
    .map(m => `<option value="${esc(m.name)}">${esc(m.name)}</option>`)
    .join('');

  const form = el('materialForm');
  if (form) form.style.display = ME && ME.role === 'admin' ? '' : 'none';
  const tb = document.querySelector('#matTable tbody');
  if (tb) {
    tb.innerHTML = mats.map(m => {
      const ops = ME && ME.role === 'admin'
        ? `<button class="btn-edit btn-sm" onclick="startMaterialEdit(${m.id})">修改</button>` +
          `<button class="btn-danger btn-sm" onclick="delMaterial(${m.id})">删除</button>`
        : '<span class="readonly-text">只读</span>';
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
  grid.innerHTML = STICKER_TYPES.map(s => `<div class="sticker-item">
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
  qty.disabled = !checked;
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
    if (qty) {
      qty.value = '';
      qty.disabled = true;
    }
  });
}

function setStickerSelection(stickerType, qty) {
  clearStickerSelection();
  const item = STICKER_TYPES.find(s => s.name === stickerType);
  if (!item) return;
  const box = el('stickerCheck-' + item.id);
  const qtyEl = el('stickerQty-' + item.id);
  box.checked = true;
  qtyEl.disabled = false;
  qtyEl.value = qty || '';
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
  if (form) form.style.display = ME && ME.role === 'admin' ? '' : 'none';
  const tb = document.querySelector('#stickerTypeTable tbody');
  if (!tb) return;
  tb.innerHTML = STICKER_TYPES.map(s => {
    const ops = ME && ME.role === 'admin'
      ? `<button class="btn-edit btn-sm" onclick="startStickerTypeEdit(${s.id})">修改</button>` +
        `<button class="btn-danger btn-sm" onclick="delStickerType(${s.id})">删除</button>`
      : '<span class="readonly-text">只读</span>';
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
    el('stickerTypeErr').textContent = '';
    await loadStickerTypes();
  } else {
    const e = await r.json();
    el('stickerTypeErr').textContent = e.detail || '保存失败';
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
  if (form) form.style.display = ME && ME.role === 'admin' ? '' : 'none';
  const tb = document.querySelector('#supTable tbody');
  if (tb) {
    tb.innerHTML = SUPPLIERS.map(s =>
      `<tr><td>${esc(s.name)}</td><td>${esc(s.created_at)}</td><td>${
        ME && ME.role === 'admin'
          ? `<button class="btn-edit btn-sm" onclick="startSupplierEdit(${s.id})">修改</button><button class="btn-danger btn-sm" onclick="delSupplier(${s.id})">删除</button>`
          : '<span class="readonly-text">只读</span>'
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
    el('supErr').textContent = '';
    await loadSuppliers();
  } else {
    const e = await r.json();
    el('supErr').textContent = e.detail || '新增失败';
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
    el('matErr').textContent = '';
    await loadMaterials();
  } else {
    const e = await r.json();
    el('matErr').textContent = e.detail || '新增失败';
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
  const hideLocation = t === 'inbound_raw' || (ME && ME.department === SEMI_FINISHED_DEPARTMENT) || isOutsource();
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
  const hideLocation = t === 'inbound_raw' || (ME && ME.department === SEMI_FINISHED_DEPARTMENT) || isOutsource();
  const material = el('material').value || 'PCBA板';
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
      el('entryErr').textContent = '已选择的贴纸类型必须填写大于 0 的数量';
      return;
    }
    if (!selected.items.length) {
      el('entryErr').textContent = '请选择贴纸类型并填写数量';
      return;
    }
    if (editingId && selected.items.length !== 1) {
      el('entryErr').textContent = '修改单条记录时只能选择一种贴纸类型';
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
    el('entryErr').textContent = '';
    cancelEdit();
    await loadRecords();
    if (el('summary').style.display !== 'none') await loadSummary();
  } else {
    const e = await r.json();
    el('entryErr').textContent = e.detail || '提交失败';
  }
}

function startEdit(id) {
  const rec = RECORDS.find(x => x.id === id);
  if (!rec) return;
  el('recType').value = rec.rec_type;
  onTypeChange();
  if (rec.location_id) el('locationId').value = rec.location_id;
  el('material').value = rec.material || 'PCBA板';
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
  renderRecordHeader();
  const tb = document.querySelector('#recTable tbody');
  const emptyColspan = 10 + (isXingxin() ? 1 : 0) + (supportsPoCustomer() ? 2 : 0);
  tb.innerHTML = RECORDS.map(x => {
    const canEdit = ME.role === 'admin' || x.created_by === ME.id;
    const ops = canEdit
      ? `<button class="btn-edit btn-sm" onclick="startEdit(${x.id})">修改</button>` +
        `<button class="btn-danger btn-sm" onclick="delRecord(${x.id})">删除</button>`
      : '';
    return `<tr>
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
  }).join('') || `<tr><td colspan="${emptyColspan}">暂无记录</td></tr>`;
}

function renderRecordHeader() {
  const supplierHead = isXingxin() ? '<th>供应商</th>' : '';
  const poCustomerHead = supportsPoCustomer() ? '<th>PO</th><th>客名</th>' : '';
  document.querySelector('#recTable thead').innerHTML = `<tr>
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
  if (isOutsource()) {
    el('sumTable').innerHTML =
      '<thead><tr><th>成品入库总数</th><th>半成品入库总数</th><th>入库合计</th></tr></thead>' +
      `<tbody><tr><td>${fmt(s.raw.finished_inbound)}</td><td>${fmt(s.raw.semi_finished_inbound)}</td><td>${fmt(s.raw.inbound)}</td></tr></tbody>`;
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
  for (const id of ['entry', 'summary', 'materials', 'suppliers', 'users', 'password']) {
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
