/* ========== 全局变量 ========== */
var config = { workshops: [], customers: [], supervisors: [] };
var projects = [];
var selectedIds = new Set();
var pendingImportData = [];

/* ========== 初始化 ========== */
document.addEventListener('DOMContentLoaded', async function () {
  await loadConfig();
  await loadProjects();
  bindEvents();
});

/* ========== 加载配置 ========== */
async function loadConfig() {
  try {
    var res = await fetch('/api/config');
    config = await res.json();
  } catch (e) {
    console.error('加载配置失败', e);
  }
  fillSelect('filterWorkshop', config.workshops, true);
  fillSelect('filterCustomer', config.customers, true);
  fillSelect('filterSupervisor', config.supervisors, true);
  fillSelect('formWorkshop', config.workshops, false);
  fillSelect('formCustomer', config.customers, false);
  fillSelect('formSupervisor', config.supervisors, false);
}

function fillSelect(id, items, keepAll) {
  var sel = document.getElementById(id);
  if (!sel) return;
  var old = sel.value;
  if (keepAll) {
    sel.innerHTML = '<option value="">全部</option>';
  } else {
    sel.innerHTML = '<option value="">--</option>';
  }
  items.forEach(function (v) {
    var opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    sel.appendChild(opt);
  });
  sel.value = old;
}

/* ========== 加载项目 ========== */
async function loadProjects() {
  var params = new URLSearchParams();
  var w = document.getElementById('filterWorkshop').value;
  var c = document.getElementById('filterCustomer').value;
  var s = document.getElementById('filterSupervisor').value;
  var k = document.getElementById('filterKeyword').value.trim();
  if (w) params.set('workshop', w);
  if (c) params.set('customer', c);
  if (s) params.set('supervisor', s);
  if (k) params.set('keyword', k);
  try {
    var res = await fetch('/api/projects?' + params.toString());
    projects = await res.json();
  } catch (e) {
    console.error('加载项目失败', e);
    projects = [];
  }
  selectedIds.clear();
  document.getElementById('checkAll').checked = false;
  document.getElementById('btnBatchDelete').disabled = true;
  renderTable(projects);
}

/* ========== 渲染表格 ========== */
function renderTable(list) {
  var tbody = document.getElementById('projectBody');
  tbody.innerHTML = '';
  list.forEach(function (p, idx) {
    var tr = document.createElement('tr');

    // checkbox
    var tdCk = document.createElement('td');
    tdCk.className = 'checkbox-col';
    var ck = document.createElement('input');
    ck.type = 'checkbox';
    ck.dataset.id = p.id;
    ck.checked = selectedIds.has(p.id);
    ck.addEventListener('change', function () {
      if (this.checked) selectedIds.add(p.id);
      else selectedIds.delete(p.id);
      document.getElementById('btnBatchDelete').disabled = selectedIds.size === 0;
    });
    tdCk.appendChild(ck);
    tr.appendChild(tdCk);

    // 序号
    addTd(tr, idx + 1);

    // editable fields
    addEditableTd(tr, p, 'workshop', p.workshop);
    addEditableTd(tr, p, 'supervisor', p.supervisor);
    addEditableTd(tr, p, 'engineer', p.engineer);
    addEditableTd(tr, p, 'customer', p.customer);
    addEditableTd(tr, p, 'product_name', p.product_name);

    // 图片
    var tdImg = document.createElement('td');
    tdImg.style.textAlign = 'center';
    if (p.product_image) {
      var img = document.createElement('img');
      img.className = 'thumb-img';
      img.src = 'uploads/' + p.product_image;
      img.title = '点击查看大图';
      img.addEventListener('click', function () { window.open(this.src); });
      tdImg.appendChild(img);
    }
    var uploadIcon = document.createElement('i');
    uploadIcon.className = 'bi bi-camera upload-icon ms-1';
    uploadIcon.title = '上传图片';
    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.hidden = true;
    fileInput.addEventListener('change', function () { uploadImage(p.id, this); });
    uploadIcon.addEventListener('click', function () { fileInput.click(); });
    tdImg.appendChild(uploadIcon);
    tdImg.appendChild(fileInput);
    tr.appendChild(tdImg);

    addEditableTd(tr, p, 'mold_sets', p.mold_sets);
    addEditableTd(tr, p, 'age_grade', p.age_grade);
    addEditableTd(tr, p, 'estimated_qty', p.estimated_qty);
    addEditableTd(tr, p, 'unit_price_usd', p.unit_price_usd);
    addEditableTd(tr, p, 'tax_rebate', p.tax_rebate);

    // schedule fields
    var scheduleFields = ['dev_start', 'fs', 'ep', 'fep', 'pp', 'bom_plastic', 'bom_purchase', 'po1_date'];
    scheduleFields.forEach(function (key) {
      var val = p.schedule ? p.schedule[key] : '';
      var td = document.createElement('td');
      td.className = 'editable stage-' + getStageStatus(p, key);
      td.dataset.field = 'schedule.' + key;
      td.dataset.id = p.id;
      td.innerHTML = formatScheduleDisplay(val, key);
      tr.appendChild(td);
    });

    // po1_qty (not a stage, just text)
    addEditableTd(tr, p, 'schedule.po1_qty', p.schedule ? p.schedule.po1_qty : '');

    addEditableTd(tr, p, 'outsource_hunan', p.outsource_hunan);
    addEditableTd(tr, p, 'remarks', p.remarks);

    // 操作列
    var tdAct = document.createElement('td');
    tdAct.style.whiteSpace = 'nowrap';
    var btnEdit = document.createElement('button');
    btnEdit.className = 'btn btn-outline-primary btn-action';
    btnEdit.innerHTML = '<i class="bi bi-pencil"></i>';
    btnEdit.title = '编辑';
    btnEdit.addEventListener('click', function () { openEditModal(p); });
    var btnDel = document.createElement('button');
    btnDel.className = 'btn btn-outline-danger btn-action';
    btnDel.innerHTML = '<i class="bi bi-trash"></i>';
    btnDel.title = '删除';
    btnDel.addEventListener('click', function () { deleteProject(p.id); });
    tdAct.appendChild(btnEdit);
    tdAct.appendChild(btnDel);
    tr.appendChild(tdAct);

    tbody.appendChild(tr);
  });

  // bind inline edit
  tbody.querySelectorAll('.editable').forEach(function (td) {
    td.addEventListener('click', function () { startInlineEdit(this); });
  });
}

function addTd(tr, text) {
  var td = document.createElement('td');
  td.textContent = text != null ? text : '';
  tr.appendChild(td);
}

function addEditableTd(tr, project, field, value) {
  var td = document.createElement('td');
  td.className = 'editable';
  td.dataset.field = field;
  td.dataset.id = project.id;
  if ((field === 'remarks' || field === 'schedule.ep' || field === 'schedule.pp' || field === 'ep' || field === 'pp') && value) {
    td.innerHTML = String(value).replace(/\n/g, '<br>');
  } else {
    td.textContent = value != null ? value : '';
  }
  tr.appendChild(td);
}

function formatScheduleDisplay(val, key) {
  if (!val) return '';
  var s = String(val);
  if (key === 'ep' || key === 'pp') {
    return s.replace(/\n/g, '<br>');
  }
  return s;
}

/* ========== 进度判定 ========== */
function extractLastDate(text) {
  if (!text) return null;
  var matches = [];
  var regex = /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/g;
  var m;
  while ((m = regex.exec(String(text))) !== null) {
    matches.push(m);
  }
  if (matches.length === 0) return null;
  var last = matches[matches.length - 1];
  return new Date(parseInt(last[1]), parseInt(last[2]) - 1, parseInt(last[3]));
}

function getStageDate(project, key) {
  var val = project.schedule ? project.schedule[key] : null;
  if (!val) return null;
  return extractLastDate(val);
}

function getStageStatus(project, stageKey) {
  var stages = ['dev_start', 'fs', 'ep', 'fep', 'pp', 'bom_plastic', 'bom_purchase', 'po1_date'];
  var idx = stages.indexOf(stageKey);
  if (idx < 0) return 'none';
  var today = new Date();
  today.setHours(0, 0, 0, 0);

  var date = getStageDate(project, stageKey);
  var prevKey = idx > 0 ? stages[idx - 1] : null;
  var nextKey = idx < stages.length - 1 ? stages[idx + 1] : null;
  var prevDate = prevKey ? getStageDate(project, prevKey) : null;
  var nextDate = nextKey ? getStageDate(project, nextKey) : null;

  if (date && date <= today) {
    if (stageKey === 'po1_date') return 'delayed';
    if (nextDate) return 'done';
    return 'delayed';
  }
  if (date && date > today) return 'active';
  if (idx === 0) return 'active';
  if (prevDate && prevDate <= today) return 'active';
  return 'none';
}

/* ========== 行内编辑 ========== */
function startInlineEdit(td) {
  if (td.querySelector('input, select, textarea')) return;
  var field = td.dataset.field;
  var projectId = td.dataset.id;
  var project = projects.find(function (p) { return String(p.id) === String(projectId); });
  if (!project) return;

  var currentVal = getFieldValue(project, field);
  var editor;

  if (field === 'workshop' || field === 'customer' || field === 'supervisor') {
    editor = document.createElement('select');
    editor.className = 'form-select form-select-sm';
    editor.innerHTML = '<option value="">--</option>';
    var list = field === 'workshop' ? config.workshops : field === 'customer' ? config.customers : config.supervisors;
    list.forEach(function (v) {
      var opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      if (v === currentVal) opt.selected = true;
      editor.appendChild(opt);
    });
  } else if (field === 'outsource_hunan') {
    editor = document.createElement('select');
    editor.className = 'form-select form-select-sm';
    ['', '是', '否', '待定'].forEach(function (v) {
      var opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v || '--';
      if (v === currentVal) opt.selected = true;
      editor.appendChild(opt);
    });
  } else if (field === 'remarks' || field === 'schedule.ep' || field === 'schedule.pp') {
    editor = document.createElement('textarea');
    editor.className = 'form-control form-control-sm';
    editor.rows = 2;
    editor.value = currentVal || '';
  } else {
    editor = document.createElement('input');
    editor.type = 'text';
    editor.className = 'form-control form-control-sm';
    editor.value = currentVal || '';
  }

  td.textContent = '';
  td.appendChild(editor);
  editor.focus();

  function finish() {
    var newVal = editor.value;
    if (newVal !== (currentVal || '')) {
      saveInlineEdit(projectId, field, newVal);
    } else {
      loadProjects();
    }
  }

  editor.addEventListener('blur', finish);
  editor.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && editor.tagName !== 'TEXTAREA') {
      e.preventDefault();
      editor.blur();
    }
    if (e.key === 'Escape') {
      editor.removeEventListener('blur', finish);
      loadProjects();
    }
  });
}

function getFieldValue(project, field) {
  if (field.startsWith('schedule.')) {
    var key = field.split('.')[1];
    return project.schedule ? (project.schedule[key] || '') : '';
  }
  return project[field] || '';
}

async function saveInlineEdit(projectId, field, value) {
  var body = {};
  if (field.startsWith('schedule.')) {
    var key = field.split('.')[1];
    body.schedule = {};
    body.schedule[key] = value;
  } else {
    body[field] = value;
  }
  try {
    var res = await fetch('/api/projects/' + projectId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error('保存失败');
  } catch (e) {
    alert('保存失败: ' + e.message);
  }
  await loadProjects();
}

/* ========== CRUD ========== */
function openAddModal() {
  document.getElementById('editProjectId').value = '';
  document.getElementById('projectForm').reset();
  document.getElementById('projectModalLabel').textContent = '添加项目';
  new bootstrap.Modal(document.getElementById('projectModal')).show();
}

function openEditModal(p) {
  document.getElementById('editProjectId').value = p.id;
  document.getElementById('projectModalLabel').textContent = '编辑项目';
  document.getElementById('formWorkshop').value = p.workshop || '';
  document.getElementById('formSupervisor').value = p.supervisor || '';
  document.getElementById('formEngineer').value = p.engineer || '';
  document.getElementById('formCustomer').value = p.customer || '';
  document.getElementById('formProductName').value = p.product_name || '';
  document.getElementById('formMoldSets').value = p.mold_sets || '';
  document.getElementById('formAgeGrade').value = p.age_grade || '';
  document.getElementById('formEstimatedQty').value = p.estimated_qty || '';
  document.getElementById('formUnitPrice').value = p.unit_price_usd || '';
  document.getElementById('formTaxRebate').value = p.tax_rebate || '';
  var sch = p.schedule || {};
  document.getElementById('formDevStart').value = sch.dev_start || '';
  document.getElementById('formFs').value = sch.fs || '';
  document.getElementById('formEp').value = sch.ep || '';
  document.getElementById('formFep').value = sch.fep || '';
  document.getElementById('formPp').value = sch.pp || '';
  document.getElementById('formBomPlastic').value = sch.bom_plastic || '';
  document.getElementById('formBomPurchase').value = sch.bom_purchase || '';
  document.getElementById('formPo1Date').value = sch.po1_date || '';
  document.getElementById('formPo1Qty').value = sch.po1_qty || '';
  document.getElementById('formOutsource').value = p.outsource_hunan || '';
  document.getElementById('formRemarks').value = p.remarks || '';
  new bootstrap.Modal(document.getElementById('projectModal')).show();
}

async function saveProject() {
  var id = document.getElementById('editProjectId').value;
  var data = {
    workshop: document.getElementById('formWorkshop').value,
    supervisor: document.getElementById('formSupervisor').value,
    engineer: document.getElementById('formEngineer').value,
    customer: document.getElementById('formCustomer').value,
    product_name: document.getElementById('formProductName').value,
    mold_sets: document.getElementById('formMoldSets').value,
    age_grade: document.getElementById('formAgeGrade').value,
    estimated_qty: document.getElementById('formEstimatedQty').value,
    unit_price_usd: parseFloat(document.getElementById('formUnitPrice').value) || null,
    tax_rebate: parseFloat(document.getElementById('formTaxRebate').value) || null,
    schedule: {
      dev_start: document.getElementById('formDevStart').value,
      fs: document.getElementById('formFs').value,
      ep: document.getElementById('formEp').value,
      fep: document.getElementById('formFep').value,
      pp: document.getElementById('formPp').value,
      bom_plastic: document.getElementById('formBomPlastic').value,
      bom_purchase: document.getElementById('formBomPurchase').value,
      po1_date: document.getElementById('formPo1Date').value,
      po1_qty: document.getElementById('formPo1Qty').value
    },
    outsource_hunan: document.getElementById('formOutsource').value,
    remarks: document.getElementById('formRemarks').value
  };

  try {
    var url = id ? '/api/projects/' + id : '/api/projects';
    var method = id ? 'PUT' : 'POST';
    var res = await fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('操作失败');
    bootstrap.Modal.getInstance(document.getElementById('projectModal')).hide();
    await loadProjects();
  } catch (e) {
    alert('保存失败: ' + e.message);
  }
}

async function deleteProject(id) {
  if (!confirm('确定删除该项目？')) return;
  try {
    var res = await fetch('/api/projects/' + id, { method: 'DELETE' });
    if (!res.ok) throw new Error('删除失败');
    await loadProjects();
  } catch (e) {
    alert('删除失败: ' + e.message);
  }
}

async function batchDelete() {
  if (selectedIds.size === 0) return;
  if (!confirm('确定删除选中的 ' + selectedIds.size + ' 个项目？')) return;
  try {
    var res = await fetch('/api/projects/batch', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: Array.from(selectedIds) })
    });
    if (!res.ok) throw new Error('批量删除失败');
    await loadProjects();
  } catch (e) {
    alert('批量删除失败: ' + e.message);
  }
}

async function uploadImage(projectId, input) {
  if (!input.files || !input.files[0]) return;
  var fd = new FormData();
  fd.append('image', input.files[0]);
  try {
    var res = await fetch('/api/projects/' + projectId + '/image', {
      method: 'POST',
      body: fd
    });
    if (!res.ok) throw new Error('上传失败');
    await loadProjects();
  } catch (e) {
    alert('图片上传失败: ' + e.message);
  }
}

/* ========== Excel 导入 ========== */
function handleImportFile(e) {
  var file = e.target.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function (evt) {
    try {
      var wb = XLSX.read(evt.target.result, { type: 'array' });
      pendingImportData = parseExcelData(wb);
      showImportPreview(pendingImportData);
    } catch (err) {
      alert('解析 Excel 失败: ' + err.message);
    }
    document.getElementById('importFile').value = '';
  };
  reader.readAsArrayBuffer(file);
}

function excelDateToStr(val) {
  if (!val) return '';
  if (typeof val === 'number') {
    var d = new Date((val - 25569) * 86400000);
    var y = d.getUTCFullYear();
    var m = String(d.getUTCMonth() + 1).padStart(2, '0');
    var dd = String(d.getUTCDate()).padStart(2, '0');
    return y + '-' + m + '-' + dd;
  }
  return String(val);
}

function parseExcelData(wb) {
  var results = [];
  wb.SheetNames.forEach(function (name) {
    var sheet = wb.Sheets[name];
    var rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    // 跳过前2行 (标题+表头)
    for (var i = 2; i < rows.length; i++) {
      var row = rows[i];
      if (!row || row.length === 0) continue;
      // 跳过备注行
      if (row[0] && String(row[0]).includes('备注')) continue;
      // 跳过空行 (产品名称为空)
      var productName = row[5];
      if (!productName && !row[4] && !row[0]) continue;

      var workshop = row[0] ? String(row[0]).trim() : '';
      // 如果厂区为空，尝试用sheet名
      if (!workshop && name) workshop = name;
      // 厂区代码映射为中文名
      var workshopMap = {
        'XX-A': '兴信A', 'XX-B': '兴信B', 'HD': '华登',
        'xx-a': '兴信A', 'xx-b': '兴信B', 'hd': '华登',
        'Xx-A': '兴信A', 'Xx-B': '兴信B', 'Hd': '华登'
      };
      if (workshopMap[workshop]) workshop = workshopMap[workshop];

      results.push({
        workshop: workshop,
        engineer: row[2] ? String(row[2]) : '',
        customer: row[4] ? String(row[4]) : '',
        product_name: row[5] ? String(row[5]) : '',
        mold_sets: row[7] ? String(row[7]) : '',
        age_grade: row[8] ? String(row[8]) : '',
        estimated_qty: row[9] ? String(row[9]) : '',
        unit_price_usd: row[10] ? parseFloat(row[10]) || null : null,
        tax_rebate: row[11] ? parseFloat(row[11]) || null : null,
        schedule: {
          dev_start: excelDateToStr(row[12]),
          fs: excelDateToStr(row[13]),
          ep: excelDateToStr(row[14]),
          fep: excelDateToStr(row[15]),
          pp: excelDateToStr(row[16]),
          bom_plastic: excelDateToStr(row[17]),
          bom_purchase: excelDateToStr(row[18]),
          po1_date: excelDateToStr(row[19]),
          po1_qty: row[20] ? String(row[20]) : ''
        },
        outsource_hunan: row[21] ? String(row[21]) : '',
        remarks: row[22] ? String(row[22]) : ''
      });
    }
  });
  return results;
}

function showImportPreview(data) {
  document.getElementById('importCount').textContent = '共解析到 ' + data.length + ' 条记录';
  var tbody = document.getElementById('importPreviewBody');
  tbody.innerHTML = '';
  data.forEach(function (d, i) {
    var tr = document.createElement('tr');
    [i + 1, d.workshop, d.engineer, d.customer, d.product_name, d.mold_sets,
     d.estimated_qty, d.unit_price_usd || '', d.schedule.dev_start, d.outsource_hunan, d.remarks
    ].forEach(function (v) {
      var td = document.createElement('td');
      td.textContent = v != null ? v : '';
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  new bootstrap.Modal(document.getElementById('importModal')).show();
}

async function confirmImport() {
  if (pendingImportData.length === 0) return;
  try {
    var res = await fetch('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pendingImportData)
    });
    if (!res.ok) throw new Error('导入失败');
    var result = await res.json();
    bootstrap.Modal.getInstance(document.getElementById('importModal')).hide();
    alert('导入成功！共导入 ' + (result.count || pendingImportData.length) + ' 条记录');
    pendingImportData = [];
    await loadProjects();
  } catch (e) {
    alert('导入失败: ' + e.message);
  }
}

/* ========== Excel 导出 ========== */
function exportExcel() {
  var params = new URLSearchParams();
  var w = document.getElementById('filterWorkshop').value;
  var c = document.getElementById('filterCustomer').value;
  var s = document.getElementById('filterSupervisor').value;
  if (w) params.set('workshop', w);
  if (c) params.set('customer', c);
  if (s) params.set('supervisor', s);
  window.location.href = '/api/export?' + params.toString();
}

/* ========== 事件绑定 ========== */
function bindEvents() {
  document.getElementById('btnSearch').addEventListener('click', function () { loadProjects(); });
  document.getElementById('btnClearFilter').addEventListener('click', function () {
    document.getElementById('filterWorkshop').value = '';
    document.getElementById('filterCustomer').value = '';
    document.getElementById('filterSupervisor').value = '';
    document.getElementById('filterKeyword').value = '';
    loadProjects();
  });
  document.getElementById('filterKeyword').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') loadProjects();
  });
  document.getElementById('btnAdd').addEventListener('click', openAddModal);
  document.getElementById('btnSaveProject').addEventListener('click', saveProject);
  document.getElementById('btnImport').addEventListener('click', function () {
    document.getElementById('importFile').click();
  });
  document.getElementById('importFile').addEventListener('change', handleImportFile);
  document.getElementById('btnExport').addEventListener('click', exportExcel);
  document.getElementById('btnBatchDelete').addEventListener('click', batchDelete);
  document.getElementById('btnConfirmImport').addEventListener('click', confirmImport);
  document.getElementById('checkAll').addEventListener('change', function () {
    var checked = this.checked;
    selectedIds.clear();
    document.querySelectorAll('#projectBody input[type="checkbox"]').forEach(function (cb) {
      cb.checked = checked;
      if (checked) selectedIds.add(cb.dataset.id);
    });
    document.getElementById('btnBatchDelete').disabled = selectedIds.size === 0;
  });
}
