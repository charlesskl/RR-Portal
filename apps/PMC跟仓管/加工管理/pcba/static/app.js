const TYPE_LABEL = {inbound_raw: '来料入仓', issue: '领料', finished: '成品入仓'};
const B = window.APP_BASE || '';   // 反代子路径前缀
let ME = null;
let RECORDS = [];
let editingId = null;

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function api(path, opts) {
  const r = await fetch(B + path, opts);
  if (r.status === 401) { location.href = B + '/'; throw new Error('unauth'); }
  return r;
}

async function init() {
  const r = await api('/api/me');
  ME = await r.json();
  document.getElementById('who').textContent = ME.username + '（' + (ME.role === 'admin' ? '管理员' : '录入员') + '）';
  if (ME.role === 'admin') {
    document.getElementById('usersTabBtn').style.display = '';
    document.getElementById('matTabBtn').style.display = '';
  }
  await loadLocations();
  await loadMaterials();
  onTypeChange();
  await loadRecords();
  showTab('entry');
}

async function loadLocations() {
  const r = await api('/api/locations');
  const locs = await r.json();
  const sel = document.getElementById('locationId');
  sel.innerHTML = locs.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
}

async function loadMaterials() {
  const r = await api('/api/materials');
  const mats = await r.json();
  // 录入页下拉框
  const sel = document.getElementById('material');
  sel.innerHTML = mats.map(m => `<option value="${esc(m.name)}">${esc(m.name)}</option>`).join('');
  // 物料管理表（仅 admin 能删）
  const tb = document.querySelector('#matTable tbody');
  if (tb) {
    tb.innerHTML = mats.map(m => {
      const del = ME && ME.role === 'admin' ? `<button class="btn-danger btn-sm" onclick="delMaterial(${m.id})">删除</button>` : '';
      return `<tr><td>${esc(m.name)}</td><td>${del}</td></tr>`;
    }).join('');
  }
}

async function createMaterial() {
  const name = document.getElementById('newMaterial').value.trim();
  const r = await api('/api/materials', {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name})});
  if (r.ok) {
    document.getElementById('newMaterial').value = '';
    document.getElementById('matErr').textContent = '';
    await loadMaterials();
  } else {
    const e = await r.json();
    document.getElementById('matErr').textContent = e.detail || '新增失败';
  }
}

async function delMaterial(id) {
  if (!confirm('确定删除这个物料名称？（已录入的记录不受影响）')) return;
  const r = await api('/api/materials/' + id, {method: 'DELETE'});
  if (r.ok) await loadMaterials();
  else { const e = await r.json(); alert(e.detail || '删除失败'); }
}

function onTypeChange() {
  const t = document.getElementById('recType').value;
  document.getElementById('locationId').style.display = (t === 'inbound_raw') ? 'none' : '';
}

async function saveRecord() {
  const t = document.getElementById('recType').value;
  const body = {
    rec_type: t,
    location_id: t === 'inbound_raw' ? null : Number(document.getElementById('locationId').value),
    material: document.getElementById('material').value || '77794-PCBA板',
    rec_date: document.getElementById('recDate').value,
    doc_no: document.getElementById('docNo').value,
    qty: Number(document.getElementById('qty').value),
    remark: document.getElementById('remark').value,
  };
  const path = editingId ? '/api/records/' + editingId : '/api/records';
  const method = editingId ? 'PUT' : 'POST';
  const r = await api(path, {
    method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  if (r.ok) {
    document.getElementById('entryErr').textContent = '';
    cancelEdit();        // 清空表单并退出修改模式
    await loadRecords();
  } else {
    const e = await r.json();
    document.getElementById('entryErr').textContent = e.detail || '提交失败';
  }
}

function startEdit(id) {
  const rec = RECORDS.find(x => x.id === id);
  if (!rec) return;
  document.getElementById('recType').value = rec.rec_type;
  onTypeChange();
  if (rec.location_id) document.getElementById('locationId').value = rec.location_id;
  document.getElementById('material').value = rec.material || '77794-PCBA板';
  document.getElementById('recDate').value = rec.rec_date || '';
  document.getElementById('docNo').value = rec.doc_no || '';
  document.getElementById('qty').value = rec.qty;
  document.getElementById('remark').value = rec.remark || '';
  editingId = id;
  document.getElementById('submitBtn').textContent = '保存修改';
  document.getElementById('cancelBtn').style.display = '';
  document.getElementById('editBanner').textContent = '正在修改 #' + id;
  window.scrollTo({top: 0, behavior: 'smooth'});
}

function cancelEdit() {
  editingId = null;
  document.getElementById('qty').value = '';
  document.getElementById('docNo').value = '';
  document.getElementById('remark').value = '';
  document.getElementById('recDate').value = '';
  document.getElementById('submitBtn').textContent = '提交';
  document.getElementById('cancelBtn').style.display = 'none';
  document.getElementById('editBanner').textContent = '';
}

async function loadRecords() {
  const r = await api('/api/records');
  RECORDS = await r.json();
  const tb = document.querySelector('#recTable tbody');
  tb.innerHTML = RECORDS.map(x => {
    const canEdit = ME.role === 'admin' || x.created_by === ME.id;
    const ops = canEdit
      ? `<button class="btn-edit btn-sm" onclick="startEdit(${x.id})">修改</button>` +
        `<button class="btn-danger btn-sm" onclick="delRecord(${x.id})">删除</button>`
      : '';
    return `<tr>
      <td>${TYPE_LABEL[x.rec_type] || esc(x.rec_type)}</td>
      <td>${esc(x.material)}</td>
      <td>${esc(x.rec_date)}</td>
      <td>${esc(x.doc_no)}</td>
      <td>${x.qty}</td>
      <td>${esc(x.remark)}</td>
      <td>${esc(x.created_by_name)}</td>
      <td>${ops}</td>
    </tr>`;
  }).join('');
}

async function delRecord(id) {
  if (!confirm('确定删除这条记录？')) return;
  const r = await api('/api/records/' + id, {method: 'DELETE'});
  if (r.ok) { if (editingId === id) cancelEdit(); await loadRecords(); }
  else { const e = await r.json(); alert(e.detail || '删除失败'); }
}

async function loadSummary() {
  const r = await api('/api/summary');
  const s = await r.json();
  let html = '<tr><th>范围</th><th>领料数</th><th>成品完成数</th><th>应存数</th></tr>';
  for (const row of s.locations) {
    html += `<tr><td>${esc(row.location)}</td><td>${row.issue}</td><td>${row.finished}</td><td>${row.balance}</td></tr>`;
  }
  html += `<tr class="subtotal"><td>小计：</td><td>${s.subtotal.issue}</td><td>${s.subtotal.finished}</td><td>${s.subtotal.balance}</td></tr>`;
  html += `<tr><th>来料仓入仓总数</th><th>来料仓出库总数</th><th>货仓应存</th><th></th></tr>`;
  html += `<tr><td>${s.raw.inbound}</td><td>${s.raw.outbound}</td><td>${s.raw.balance}</td><td></td></tr>`;
  document.getElementById('sumTable').innerHTML = html;
}

function exportExcel() { window.location.href = B + '/api/export'; }

async function loadUsers() {
  const r = await api('/api/users');
  if (!r.ok) return;
  const users = await r.json();
  const tb = document.querySelector('#userTable tbody');
  tb.innerHTML = users.map(u =>
    `<tr><td>${esc(u.username)}</td><td>${u.role === 'admin' ? '管理员' : '录入员'}</td><td>${esc(u.created_at)}</td></tr>`).join('');
}

async function createUser() {
  const body = {
    username: document.getElementById('newUser').value.trim(),
    password: document.getElementById('newPw').value,
    role: document.getElementById('newRole').value,
  };
  const r = await api('/api/users', {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  if (r.ok) { document.getElementById('userErr').textContent = ''; document.getElementById('newUser').value=''; document.getElementById('newPw').value=''; await loadUsers(); }
  else { const e = await r.json(); document.getElementById('userErr').textContent = e.detail || '新增失败'; }
}

function showTab(name) {
  for (const id of ['entry', 'summary', 'materials', 'users'])
    document.getElementById(id).style.display = (id === name) ? '' : 'none';
  document.querySelectorAll('.tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === name));
  if (name === 'summary') loadSummary();
  if (name === 'materials') loadMaterials();
  if (name === 'users') loadUsers();
}

async function logout() {
  await fetch(B + '/api/logout', {method: 'POST'});
  location.href = B + '/';
}

init();
