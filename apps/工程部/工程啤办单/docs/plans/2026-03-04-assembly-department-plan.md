# Assembly Department (装配部) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a fully functional assembly department page with order CRUD, login, supervisor approval, printing, and dashboard integration.

**Architecture:** Extend the existing CRUD factory in `server.js` to include `assembly`. Create `assembly.html` by cloning and simplifying `engineering.html` to a single order type with 5 item fields. Wire into `supervisor.html`, `print.html`, and `index.html`.

**Tech Stack:** Node.js/Express, Bootstrap 5.3.2, vanilla JS, JSON file storage.

---

### Task 1: Initialize data.json with assembly keys

**Files:**
- Modify: `server.js:39-49` (initData function)

**Step 1: Add assembly arrays to initData()**

In `server.js`, find the `initData()` function (line 39) and add the three assembly keys:

```js
function initData() {
  return {
    injection_orders: [], injection_items: [],
    slush_orders: [],    slush_items: [],
    spray_orders: [],    spray_items: [],
    assembly_orders: [],  assembly_items: [],
    problems: [],
    material_prices: DEFAULT_MATERIAL_PRICES.slice(),
    material_requisitions: [],
    assembly_users: [],
    nextId: 1
  };
}
```

**Step 2: Add migration for existing data.json**

In the `loadData()` function (line 26), after the `material_requisitions` check (line 32), add:

```js
if (!data.assembly_orders) data.assembly_orders = [];
if (!data.assembly_items) data.assembly_items = [];
if (!data.assembly_users) data.assembly_users = [];
```

**Step 3: Verify server starts**

Run: `node server.js`
Expected: Server starts without errors, prints startup message.

**Step 4: Commit**

```bash
git add server.js
git commit -m "feat: initialize assembly data keys in server.js"
```

---

### Task 2: Add assembly to the CRUD route factory

**Files:**
- Modify: `server.js:181` (route factory loop)

**Step 1: Extend the route factory array**

Change line 181 from:
```js
['injection', 'slush', 'spray'].forEach(type => {
```
to:
```js
['injection', 'slush', 'spray', 'assembly'].forEach(type => {
```

This gives assembly all the same endpoints: GET/POST `/api/assembly`, GET/PUT/DELETE `/api/assembly/:id`, PATCH `/api/assembly/:id/status`, PATCH `/api/assembly/:id/items`.

**Step 2: Adjust status transition logic for assembly**

The existing PATCH `/status` handler (line 209-261) has special logic:
- `reviewStatuses` includes `'待经理审核'` — assembly skips this, going directly `待审核 → 待生产`
- The `'待生产'` status check assumes `reviewer_role || 'manager'` — for assembly, it should be `'supervisor'`

The current code at line 212-221:
```js
const reviewStatuses = ['待经理审核', '待生产', '已驳回'];
if (reviewStatuses.includes(status)) {
  if (!pin || !reviewer_name) {
    return res.status(403).json({ error: 'PIN验证失败' });
  }
  const role = reviewer_role || (status === '待生产' ? 'manager' : 'supervisor');
  if (!verifyPin(reviewer_name, pin, role)) {
    return res.status(403).json({ error: 'PIN验证失败' });
  }
}
```

This already works for assembly because:
- When supervisor approves an assembly order (`待审核 → 待生产`), the frontend sends `reviewer_role: 'supervisor'` in the request body
- The server uses `reviewer_role` if provided, only defaults to `'manager'` if not sent
- So no server change needed here — just ensure the frontend sends `reviewer_role: 'supervisor'`

**Step 3: Verify the API works**

Run server, then test:
```bash
curl http://localhost:3000/api/assembly
```
Expected: `[]` (empty array)

**Step 4: Commit**

```bash
git add server.js
git commit -m "feat: add assembly to CRUD route factory"
```

---

### Task 3: Update stats and pending-reviews endpoints

**Files:**
- Modify: `server.js:438-454` (pending-reviews endpoint)
- Modify: `server.js:539-548` (stats endpoint)

**Step 1: Update `/api/pending-reviews` to include assembly**

Find the `pending-reviews` handler (line 439). Currently it only checks `injection_orders`. Change it to also check `assembly_orders`:

```js
app.get('/api/pending-reviews', (req, res) => {
  const data = loadData();
  const role = req.query.role;
  const name = req.query.name ? decodeURIComponent(req.query.name) : '';

  if (role === 'supervisor' && name) {
    const injPending = (data.injection_orders || []).filter(o => o.status === '待审核' && o.supervisor === name);
    const asmPending = (data.assembly_orders || []).filter(o => o.status === '待审核' && o.supervisor === name);
    const allPending = [...injPending, ...asmPending];
    return res.json({
      count: allPending.length,
      orders: allPending.map(o => ({
        id: o.id, order_number: o.order_number, client_name: o.client_name, date: o.date,
        type: injPending.includes(o) ? 'injection' : 'assembly'
      }))
    });
  }
  if (role === 'manager') {
    const pending = (data.injection_orders || []).filter(o => o.status === '待经理审核');
    return res.json({ count: pending.length, orders: pending.map(o => ({ id: o.id, order_number: o.order_number, client_name: o.client_name, date: o.date, supervisor: o.supervisor })) });
  }
  res.json({ count: 0, orders: [] });
});
```

**Step 2: Update `/api/stats` to include assembly**

Find the stats handler (line 539). Add assembly:

```js
app.get('/api/stats', (req, res) => {
  const data = loadData();
  const count = (arr, status) => status ? arr.filter(o => o.status === status).length : arr.length;
  const stat = type => ({
    total:      count(data[`${type}_orders`] || []),
    pending:    count(data[`${type}_orders`] || [], '待生产'),
    inProgress: count(data[`${type}_orders`] || [], '生产中'),
    done:       count(data[`${type}_orders`] || [], '已完成')
  });
  res.json({ injection: stat('injection'), slush: stat('slush'), spray: stat('spray'), assembly: stat('assembly') });
});
```

**Step 3: Verify**

```bash
curl http://localhost:3000/api/stats
```
Expected: JSON with `assembly: {total:0, pending:0, inProgress:0, done:0}`

**Step 4: Commit**

```bash
git add server.js
git commit -m "feat: include assembly in stats and pending-reviews"
```

---

### Task 4: Update startup message

**Files:**
- Modify: `server.js:560-575` (startup log)

**Step 1: Add assembly to startup log**

After the line `console.log('  原料仓库: http://${ip}:${PORT}/warehouse.html');` (line 573), add:

```js
console.log(`  装配部:  http://${ip}:${PORT}/assembly.html`);
```

**Step 2: Commit**

```bash
git add server.js
git commit -m "feat: add assembly to server startup message"
```

---

### Task 5: Create assembly.html

**Files:**
- Create: `public/assembly.html`

**Step 1: Create the file**

Create `public/assembly.html` with the following structure. This is a simplified version of `engineering.html` — single order type, simpler item fields, PIN-based login, blue `#2980b9` theme.

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>装配部 - 生产订单管理</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
  <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css" rel="stylesheet">
  <link href="style.css" rel="stylesheet">
  <style>
    .items-table input[type=text] { min-width: 60px; }
    .items-table input[type=number] { min-width: 60px; max-width: 90px; }
    .items-table input.w-date { min-width: 90px; max-width: 100px; }
    .items-table input:focus { position: relative; z-index: 10; min-width: 200px; box-shadow: 0 0 0 3px rgba(41,128,185,.3); }
    .items-table td { overflow: visible; }
  </style>
</head>
<body class="bg-light">

<!-- 导航栏 -->
<nav class="navbar navbar-dark" style="background:#2980b9">
  <div class="container-fluid">
    <span class="navbar-brand"><i class="bi bi-gear-wide-connected me-2"></i>装配部 — 生产订单管理</span>
    <div class="d-flex gap-2 align-items-center">
      <span id="navUserBadge" class="badge bg-light text-dark" style="font-size:.85rem;cursor:pointer" onclick="switchUser()" title="点击切换用户"></span>
      <a href="index.html" class="nav-dept-link"><i class="bi bi-house me-1"></i>主页</a>
    </div>
  </div>
</nav>

<div class="container-fluid mt-3">
  <!-- 操作栏 -->
  <div class="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
    <div class="d-flex flex-wrap align-items-center gap-2">
      <div class="status-filter d-flex flex-wrap gap-1">
        <button class="btn btn-sm btn-outline-secondary active" onclick="filterStatus('',this)">全部</button>
        <button class="btn btn-sm" style="background:#fd7e14;color:#fff;border-color:#fd7e14" onclick="filterStatus('待审核',this)">待审核</button>
        <button class="btn btn-sm btn-warning" onclick="filterStatus('待生产',this)">待生产</button>
        <button class="btn btn-sm btn-info" onclick="filterStatus('生产中',this)">生产中</button>
        <button class="btn btn-sm btn-success" onclick="filterStatus('已完成',this)">已完成</button>
        <button class="btn btn-sm btn-danger" onclick="filterStatus('已驳回',this)">已驳回</button>
      </div>
    </div>
    <div class="d-flex gap-2">
      <button class="btn btn-outline-secondary" onclick="loadOrders()"><i class="bi bi-arrow-clockwise me-1"></i>刷新</button>
      <button class="btn btn-primary" style="background:#2980b9;border-color:#2980b9" onclick="openNewModal()">
        <i class="bi bi-plus-lg me-1"></i>新建装配单
      </button>
    </div>
  </div>

  <!-- 订单列表 -->
  <div class="card shadow-sm">
    <div class="card-body p-0">
      <div id="orderList"><div class="empty-state"><i class="bi bi-inbox"></i><p class="mt-2">加载中...</p></div></div>
    </div>
  </div>
</div>

<!-- ═══════════════════ 装配单 Modal ═══════════════════ -->
<div class="modal fade" id="asmModal" tabindex="-1" data-bs-backdrop="static">
  <div class="modal-dialog modal-xl">
    <div class="modal-content">
      <div class="modal-header" style="background:#2980b9;color:#fff">
        <h5 class="modal-title"><i class="bi bi-gear-wide-connected me-2"></i><span id="asmModalTitle">新建装配单</span></h5>
        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
      </div>
      <div class="modal-body">
        <input type="hidden" id="asm-id">
        <input type="hidden" id="asm-status" value="待审核">
        <div class="row g-3 mb-3">
          <div class="col-md-3"><label class="form-label fw-bold">产品编号</label><input class="form-control" id="asm-order_number" placeholder="如 ZP2026001"></div>
          <div class="col-md-3"><label class="form-label fw-bold">产品名称</label><input class="form-control" id="asm-product_name" placeholder="产品名称"></div>
          <div class="col-md-3"><label class="form-label fw-bold">客名</label>
            <select class="form-select" id="asm-client_name"><option value="">请选择客户</option></select>
          </div>
          <div class="col-md-3"><label class="form-label fw-bold">日期</label><input type="date" class="form-control" id="asm-date"></div>
          <div class="col-md-3"><label class="form-label fw-bold">主管</label>
            <select class="form-select" id="asm-supervisor">
              <option value="">请选择主管</option>
              <option>段新辉</option><option>唐海林</option><option>蒙海欢</option><option>万志勇</option>
              <option>章发东</option><option>刘际维</option><option>甘勇辉</option><option>王玉国</option>
            </select>
          </div>
          <div class="col-md-9"><label class="form-label fw-bold">备注</label><input class="form-control" id="asm-notes" placeholder="备注信息"></div>
        </div>
        <div class="d-flex justify-content-between align-items-center mb-2">
          <strong>明细行</strong>
          <button class="btn btn-sm btn-outline-primary" onclick="addRow()"><i class="bi bi-plus-lg me-1"></i>添加行</button>
        </div>
        <div class="items-table-wrap">
          <table class="table table-bordered table-sm items-table" id="asmItemsTable">
            <thead>
              <tr>
                <th>产品编号</th><th>产品名称</th><th>数量</th><th>要求完成日期</th><th>备注</th><th style="width:40px"></th>
              </tr>
            </thead>
            <tbody id="asmItemsBody"></tbody>
          </table>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" data-bs-dismiss="modal">取消</button>
        <button class="btn btn-primary" style="background:#2980b9;border-color:#2980b9" onclick="saveOrder()"><i class="bi bi-save me-1"></i>保存</button>
      </div>
    </div>
  </div>
</div>

<!-- 订单详情 Modal -->
<div class="modal fade" id="detailModal" tabindex="-1">
  <div class="modal-dialog modal-xl">
    <div class="modal-content">
      <div class="modal-header" style="background:#2980b9;color:#fff">
        <h5 class="modal-title"><i class="bi bi-file-text me-2"></i>订单详情 — <span id="detailLabel"></span></h5>
        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
      </div>
      <div class="modal-body" id="detailBody"><div class="text-center text-muted py-4">加载中...</div></div>
      <div class="modal-footer">
        <button class="btn btn-secondary" data-bs-dismiss="modal">关闭</button>
        <button class="btn btn-outline-primary" id="detailEditBtn"><i class="bi bi-pencil me-1"></i>编辑</button>
        <button class="btn btn-outline-secondary" id="detailPrintBtn"><i class="bi bi-printer me-1"></i>打印</button>
      </div>
    </div>
  </div>
</div>

<!-- Toast -->
<div class="position-fixed bottom-0 end-0 p-3" style="z-index:9999">
  <div id="toast" class="toast align-items-center text-white border-0" role="alert">
    <div class="d-flex">
      <div class="toast-body" id="toastMsg">操作成功</div>
      <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
    </div>
  </div>
</div>

<!-- 登录 Modal -->
<div class="modal fade" id="loginModal" tabindex="-1" data-bs-backdrop="static" data-bs-keyboard="false">
  <div class="modal-dialog modal-sm modal-dialog-centered">
    <div class="modal-content">
      <div class="modal-header" style="background:#2980b9;color:#fff">
        <h5 class="modal-title"><i class="bi bi-person-circle me-2"></i>装配部登录</h5>
      </div>
      <div class="modal-body">
        <label class="form-label fw-bold">您的姓名</label>
        <input type="text" id="loginName" class="form-control" placeholder="输入您的姓名"
          onkeydown="if(event.key==='Enter')document.getElementById('loginPin').focus()">
        <div class="invalid-feedback">请输入姓名</div>
        <label class="form-label fw-bold mt-3">PIN 密码</label>
        <input type="password" id="loginPin" class="form-control" placeholder="请输入 4 位 PIN" maxlength="8"
          onkeydown="if(event.key==='Enter')doLogin()">
        <div id="loginError" class="text-danger small mt-2 d-none">
          <i class="bi bi-exclamation-circle me-1"></i>姓名或 PIN 错误
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-primary w-100" style="background:#2980b9;border-color:#2980b9" onclick="doLogin()">
          <i class="bi bi-box-arrow-in-right me-1"></i>确认登录
        </button>
      </div>
    </div>
  </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js"></script>
<script src="utils.js"></script>
<script>
// ─── State ──────────────────────────────────────────────────────────────────
let currentUser = sessionStorage.getItem('assembly_user') || '';
let currentFilter = '';

const statusBadge = s => ({
  '待审核': '<span class="badge" style="background:#fd7e14">待审核</span>',
  '待生产': '<span class="badge badge-pending">待生产</span>',
  '生产中': '<span class="badge badge-progress">生产中</span>',
  '已完成': '<span class="badge badge-done">已完成</span>',
  '已驳回': '<span class="badge bg-danger">已驳回</span>'
}[s] || `<span class="badge bg-secondary">${esc(s)}</span>`);

const itemFields = ['product_number', 'product_name', 'quantity', 'completion_time', 'notes'];

// ─── Login ──────────────────────────────────────────────────────────────────
function showLoginModal() {
  new bootstrap.Modal(document.getElementById('loginModal')).show();
  document.getElementById('loginName').focus();
}

async function doLogin() {
  const name = document.getElementById('loginName').value.trim();
  const pin = document.getElementById('loginPin').value;
  if (!name) { document.getElementById('loginName').classList.add('is-invalid'); return; }
  document.getElementById('loginName').classList.remove('is-invalid');

  // Verify against assembly_users via a simple check
  // Assembly uses its own user list — verified server-side
  try {
    const r = await fetch('/api/assembly-users/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, pin })
    });
    const d = await r.json();
    if (!d.success) {
      document.getElementById('loginError').classList.remove('d-none');
      document.getElementById('loginPin').value = '';
      document.getElementById('loginPin').focus();
      return;
    }
  } catch (e) {
    document.getElementById('loginError').classList.remove('d-none');
    return;
  }

  currentUser = name;
  sessionStorage.setItem('assembly_user', name);
  sessionStorage.setItem('assembly_pin', pin);
  document.getElementById('navUserBadge').textContent = '\uD83D\uDC64 ' + name;
  document.getElementById('loginError').classList.add('d-none');
  bootstrap.Modal.getInstance(document.getElementById('loginModal'))?.hide();
}

function switchUser() {
  sessionStorage.removeItem('assembly_user');
  sessionStorage.removeItem('assembly_pin');
  currentUser = '';
  document.getElementById('loginName').value = '';
  document.getElementById('loginPin').value = '';
  showLoginModal();
}

// ─── Order List ─────────────────────────────────────────────────────────────
function filterStatus(status, el) {
  currentFilter = status;
  document.querySelectorAll('.status-filter .btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  loadOrders();
}

function loadOrders() {
  document.getElementById('orderList').innerHTML = '<div class="text-center p-4 text-muted">加载中...</div>';
  fetch('/api/assembly')
    .then(r => r.json())
    .then(orders => {
      if (currentFilter) orders = orders.filter(o => o.status === currentFilter);
      orders.sort((a, b) => {
        const so = { '待审核':0, '待生产':1, '生产中':2, '已完成':3, '已驳回':4 };
        const oa = so[a.status] ?? 9, ob = so[b.status] ?? 9;
        if (oa !== ob) return oa - ob;
        return b.id - a.id;
      });
      renderOrderList(orders);
    })
    .catch(() => showToast('加载失败', 'danger'));
}

function renderOrderList(orders) {
  if (!orders.length) {
    document.getElementById('orderList').innerHTML = '<div class="empty-state"><i class="bi bi-inbox"></i><p class="mt-2">暂无单据</p></div>';
    return;
  }
  // Show completion_time from first item for display
  const rows = orders.map(o => {
    const firstItem = (o.items || [])[0] || {};
    const canEdit = o.created_by === currentUser && ['待审核', '已驳回'].includes(o.status);
    const canChangeStatus = o.created_by === currentUser;
    return `
    <tr style="cursor:pointer" onclick="viewDetail(${o.id},'${(o.order_number||'').replace(/'/g,'')}')">
      <td><strong>${esc(o.order_number || '-')}</strong></td>
      <td>${esc(o.product_name || '-')}</td>
      <td>${esc(o.client_name || '-')}</td>
      <td>${esc(o.date ? o.date.slice(5) : '-')}</td>
      <td>${esc(o.supervisor || '-')}</td>
      <td>${esc(o.created_by || '-')}</td>
      <td>${statusBadge(o.status)}</td>
      <td onclick="event.stopPropagation()">
        <div class="btn-group btn-group-sm">
          ${canEdit ? `<button class="btn btn-outline-primary btn-sm" onclick="editOrder(${o.id})"><i class="bi bi-pencil"></i></button>` : ''}
          ${canEdit ? `<button class="btn btn-outline-danger btn-sm" onclick="deleteOrder(${o.id})"><i class="bi bi-trash"></i></button>` : ''}
          ${o.status === '待生产' && canChangeStatus ? `<button class="btn btn-info btn-sm" onclick="changeStatus(${o.id},'生产中')">开始生产</button>` : ''}
          ${o.status === '生产中' && canChangeStatus ? `<button class="btn btn-success btn-sm" onclick="changeStatus(${o.id},'已完成')">完成</button>` : ''}
          <button class="btn btn-outline-secondary btn-sm" onclick="window.open('print.html?type=assembly&id=${o.id}','_blank')" title="打印"><i class="bi bi-printer"></i></button>
        </div>
      </td>
    </tr>`;
  }).join('');

  document.getElementById('orderList').innerHTML = `
    <table class="table table-hover table-sm mb-0">
      <thead class="table-dark">
        <tr><th>产品编号</th><th>产品名称</th><th>客名</th><th>日期</th><th>主管</th><th>创建人</th><th>状态</th><th>操作</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ─── View Detail ────────────────────────────────────────────────────────────
let detailOrderId = null;

function viewDetail(id, orderNum) {
  detailOrderId = id;
  document.getElementById('detailLabel').textContent = orderNum || '#' + id;
  document.getElementById('detailBody').innerHTML = '<div class="text-center text-muted py-4">加载中...</div>';
  new bootstrap.Modal(document.getElementById('detailModal')).show();

  fetch(`/api/assembly/${id}`)
    .then(r => r.json())
    .then(order => {
      const items = order.items || [];
      const header = `
        <div class="row g-2 mb-3 p-2 rounded" style="background:#e3f2fd">
          <div class="col-6 col-md-3"><small class="text-muted">产品编号</small><div class="fw-bold">${esc(order.order_number||'-')}</div></div>
          <div class="col-6 col-md-3"><small class="text-muted">产品名称</small><div>${esc(order.product_name||'-')}</div></div>
          <div class="col-6 col-md-3"><small class="text-muted">客名</small><div>${esc(order.client_name||'-')}</div></div>
          <div class="col-6 col-md-3"><small class="text-muted">日期</small><div>${esc(order.date||'-')}</div></div>
          <div class="col-6 col-md-3"><small class="text-muted">主管</small><div>${esc(order.supervisor||'-')}</div></div>
          <div class="col-6 col-md-3"><small class="text-muted">创建人</small><div>${esc(order.created_by||'-')}</div></div>
          <div class="col-6 col-md-3"><small class="text-muted">状态</small><div>${statusBadge(order.status)}</div></div>
          ${order.notes ? `<div class="col-12"><small class="text-muted">备注</small><div>${esc(order.notes)}</div></div>` : ''}
        </div>`;
      const rows = items.map((it, i) => `<tr>
        <td>${i+1}</td><td>${esc(it.product_number||'-')}</td><td>${esc(it.product_name||'-')}</td>
        <td>${esc(it.quantity||'-')}</td><td>${esc(it.completion_time||'-')}</td><td>${esc(it.notes||'-')}</td>
      </tr>`).join('');
      const table = items.length ? `<div class="table-responsive"><table class="table table-bordered table-sm">
        <thead class="table-light"><tr><th>序号</th><th>产品编号</th><th>产品名称</th><th>数量</th><th>要求完成日期</th><th>备注</th></tr></thead>
        <tbody>${rows}</tbody></table></div>` : '<div class="text-muted small">（无明细行）</div>';
      document.getElementById('detailBody').innerHTML = header + table;

      // Wire up edit/print buttons
      const canEdit = order.created_by === currentUser && ['待审核', '已驳回'].includes(order.status);
      document.getElementById('detailEditBtn').style.display = canEdit ? '' : 'none';
      document.getElementById('detailEditBtn').onclick = () => {
        bootstrap.Modal.getInstance(document.getElementById('detailModal'))?.hide();
        editOrder(id);
      };
      document.getElementById('detailPrintBtn').onclick = () => window.open(`print.html?type=assembly&id=${id}`, '_blank');
    })
    .catch(() => { document.getElementById('detailBody').innerHTML = '<div class="text-danger">加载失败</div>'; });
}

// ─── Create / Edit ──────────────────────────────────────────────────────────
function addRow() {
  const tbody = document.getElementById('asmItemsBody');
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="text" class="form-control form-control-sm" name="product_number"></td>
    <td><input type="text" class="form-control form-control-sm" name="product_name"></td>
    <td><input type="number" class="form-control form-control-sm" name="quantity" min="0"></td>
    <td><input type="date" class="form-control form-control-sm w-date" name="completion_time"></td>
    <td><input type="text" class="form-control form-control-sm" name="notes"></td>
    <td><button class="btn btn-sm btn-outline-danger" onclick="this.closest('tr').remove()"><i class="bi bi-x"></i></button></td>`;
  tbody.appendChild(tr);
}

function collectItems() {
  const rows = document.querySelectorAll('#asmItemsBody tr');
  return Array.from(rows).map(tr => {
    const obj = {};
    itemFields.forEach(f => { obj[f] = tr.querySelector(`[name="${f}"]`)?.value || ''; });
    return obj;
  });
}

function openNewModal() {
  if (!currentUser) { showLoginModal(); return; }
  document.getElementById('asmModalTitle').textContent = '新建装配单';
  document.getElementById('asm-id').value = '';
  document.getElementById('asm-status').value = '待审核';
  document.getElementById('asm-order_number').value = '';
  document.getElementById('asm-product_name').value = '';
  document.getElementById('asm-client_name').value = '';
  document.getElementById('asm-date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('asm-supervisor').value = '';
  document.getElementById('asm-notes').value = '';
  document.getElementById('asmItemsBody').innerHTML = '';
  addRow();
  new bootstrap.Modal(document.getElementById('asmModal')).show();
}

function editOrder(id) {
  if (!currentUser) { showLoginModal(); return; }
  fetch(`/api/assembly/${id}`)
    .then(r => r.json())
    .then(order => {
      document.getElementById('asmModalTitle').textContent = `编辑装配单 #${id}`;
      document.getElementById('asm-id').value = order.id;
      document.getElementById('asm-status').value = order.status === '已驳回' ? '待审核' : order.status;
      document.getElementById('asm-order_number').value = order.order_number || '';
      document.getElementById('asm-product_name').value = order.product_name || '';
      document.getElementById('asm-client_name').value = order.client_name || '';
      document.getElementById('asm-date').value = order.date || '';
      document.getElementById('asm-supervisor').value = order.supervisor || '';
      document.getElementById('asm-notes').value = order.notes || '';

      const tbody = document.getElementById('asmItemsBody');
      tbody.innerHTML = '';
      (order.items || []).forEach(it => {
        addRow();
        const tr = tbody.lastElementChild;
        itemFields.forEach(f => {
          const inp = tr.querySelector(`[name="${f}"]`);
          if (inp) inp.value = it[f] || '';
        });
      });
      if (!order.items?.length) addRow();
      new bootstrap.Modal(document.getElementById('asmModal')).show();
    });
}

function saveOrder() {
  if (!currentUser) { showLoginModal(); return; }
  const id = document.getElementById('asm-id').value;
  const body = {
    order_number: document.getElementById('asm-order_number').value,
    product_name: document.getElementById('asm-product_name').value || null,
    client_name: document.getElementById('asm-client_name').value || null,
    date: document.getElementById('asm-date').value,
    status: document.getElementById('asm-status').value,
    supervisor: document.getElementById('asm-supervisor').value || null,
    workshop: '装配车间',
    created_by: currentUser,
    notes: document.getElementById('asm-notes').value || null,
    items: collectItems()
  };

  const url = id ? `/api/assembly/${id}` : '/api/assembly';
  const method = id ? 'PUT' : 'POST';
  fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-User': encodeURIComponent(currentUser) },
    body: JSON.stringify(body)
  })
    .then(r => r.json())
    .then(data => {
      if (data.error) { showToast(data.error, 'danger'); return; }
      bootstrap.Modal.getInstance(document.getElementById('asmModal'))?.hide();
      showToast(id ? '更新成功！' : '创建成功！', 'success');
      loadOrders();
    })
    .catch(() => showToast('保存失败', 'danger'));
}

// ─── Delete / Status ────────────────────────────────────────────────────────
function deleteOrder(id) {
  if (!confirm('确定删除这条单据吗？删除后无法恢复。')) return;
  fetch(`/api/assembly/${id}`, {
    method: 'DELETE',
    headers: { 'X-User': encodeURIComponent(currentUser) }
  })
    .then(r => r.json())
    .then(d => {
      if (d.error) { showToast(d.error, 'danger'); return; }
      showToast('删除成功', 'success');
      loadOrders();
    })
    .catch(() => showToast('删除失败', 'danger'));
}

function changeStatus(id, newStatus) {
  fetch(`/api/assembly/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-User': encodeURIComponent(currentUser) },
    body: JSON.stringify({ status: newStatus })
  })
    .then(r => r.json())
    .then(d => {
      if (d.error) { showToast(d.error, 'danger'); return; }
      showToast('状态已更新', 'success');
      loadOrders();
    })
    .catch(() => showToast('操作失败', 'danger'));
}

// ─── Utils ──────────────────────────────────────────────────────────────────
function showToast(msg, type = 'success') {
  const el = document.getElementById('toast');
  const colors = { success: '#198754', danger: '#dc3545', warning: '#ffc107' };
  el.style.background = colors[type] || '#333';
  document.getElementById('toastMsg').textContent = msg;
  new bootstrap.Toast(el, { delay: 2500 }).show();
}

// ─── Init ───────────────────────────────────────────────────────────────────
// Load clients for dropdown
fetch('/api/clients').then(r => r.json()).then(clients => {
  const sel = document.getElementById('asm-client_name');
  clients.forEach(c => { const o = document.createElement('option'); o.value = c; o.textContent = c; sel.appendChild(o); });
}).catch(() => {});

// Auto-restore login
if (currentUser) {
  const savedPin = sessionStorage.getItem('assembly_pin');
  if (savedPin) {
    fetch('/api/assembly-users/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: currentUser, pin: savedPin })
    }).then(r => r.json()).then(d => {
      if (d.success) {
        document.getElementById('navUserBadge').textContent = '\uD83D\uDC64 ' + currentUser;
      } else {
        sessionStorage.removeItem('assembly_user');
        sessionStorage.removeItem('assembly_pin');
        currentUser = '';
        window.addEventListener('load', showLoginModal);
      }
    });
  } else {
    document.getElementById('navUserBadge').textContent = '\uD83D\uDC64 ' + currentUser;
  }
} else {
  window.addEventListener('load', showLoginModal);
}

loadOrders();
setInterval(loadOrders, 30000);
</script>

</body>
</html>
```

**Step 2: Add assembly user verification endpoint to server.js**

Add this endpoint in `server.js` before the stats route:

```js
// ─── 装配部用户验证 ──────────────────────────────────────────────────────────
app.post('/api/assembly-users/verify', (req, res) => {
  const { name, pin } = req.body;
  if (!name || !pin) return res.json({ success: false });
  const data = loadData();
  const user = (data.assembly_users || []).find(u => u.name === name && u.pin === String(pin));
  res.json({ success: !!user });
});

app.get('/api/assembly-users', (req, res) => {
  const data = loadData();
  // Return names only, never expose PINs
  res.json((data.assembly_users || []).map(u => ({ name: u.name })));
});

app.post('/api/assembly-users', (req, res) => {
  const { name, pin } = req.body;
  if (!name || !pin) return res.status(400).json({ error: '姓名和PIN必填' });
  const data = loadData();
  if (!data.assembly_users) data.assembly_users = [];
  if (data.assembly_users.find(u => u.name === name)) {
    return res.status(400).json({ error: '用户已存在' });
  }
  data.assembly_users.push({ name, pin: String(pin) });
  saveData(data);
  res.status(201).json({ success: true });
});
```

**Step 3: Verify the page loads**

Open `http://localhost:3000/assembly.html` in a browser. The login modal should appear.

**Step 4: Commit**

```bash
git add public/assembly.html server.js
git commit -m "feat: add assembly.html page with login and order CRUD"
```

---

### Task 6: Add assembly to print.html

**Files:**
- Modify: `public/print.html:78-98` (typeMap and render logic)

**Step 1: Add assembly to typeMap**

Change line 78-79 from:
```js
const typeMap = { injection: '啤办单', slush: '搪胶单', spray: '喷油单' };
```
to:
```js
const typeMap = { injection: '啤办单', slush: '搪胶单', spray: '喷油单', assembly: '装配单' };
```

**Step 2: Add renderAssembly function and update the render switch**

Change line 91-93 from:
```js
el.innerHTML = type === 'injection' ? renderInjection(order)
             : type === 'slush'     ? renderSlush(order)
             :                        renderSpray(order);
```
to:
```js
el.innerHTML = type === 'injection' ? renderInjection(order)
             : type === 'slush'     ? renderSlush(order)
             : type === 'assembly'  ? renderAssembly(order)
             :                        renderSpray(order);
```

**Step 3: Add the renderAssembly function**

Add this function after `renderSpray`:

```js
function renderAssembly(o) {
  const items = o.items || [];
  const minRows = 10;
  const allItems = [...items];
  while (allItems.length < minRows) allItems.push({});

  const rows = allItems.map((it, i) => `
    <tr style="height:18px">
      <td style="text-align:center">${i < items.length ? i + 1 : ''}</td>
      <td>${v(it.product_number)}</td>
      <td>${v(it.product_name)}</td>
      <td style="text-align:center">${v(it.quantity)}</td>
      <td>${v(it.completion_time)}</td>
      <td>${v(it.notes)}</td>
    </tr>`).join('');

  return `
    <div class="print-header" style="margin-bottom:4px">
      <div class="company-name">东莞兴信塑胶制品有限公司</div>
      <div style="font-size:12pt;font-weight:bold;margin:4px 0">装配通知单</div>
    </div>
    <div style="border:1px solid #333;border-bottom:none;padding:4px 8px;font-size:10pt;display:flex;gap:0">
      <span style="flex:2"><strong>客户：</strong>${v(o.client_name)}</span>
      <span style="flex:3"><strong>产品编号：</strong>${v(o.order_number)}</span>
      <span style="flex:3"><strong>产品名称：</strong>${v(o.product_name)}</span>
    </div>
    <div style="border:1px solid #333;border-top:none;border-bottom:none;padding:4px 8px;font-size:10pt;display:flex;gap:0">
      <span style="flex:2"><strong>日期：</strong>${v(o.date)}</span>
      <span style="flex:2"><strong>主管：</strong>${v(o.supervisor)}</span>
      <span style="flex:2;text-align:right"><strong>创建人：</strong>${v(o.created_by)}</span>
    </div>
    ${o.notes ? `<div style="border:1px solid #333;border-top:none;border-bottom:none;padding:4px 8px;font-size:10pt"><strong>备注：</strong>${v(o.notes)}</div>` : ''}
    <table class="print-table">
      <thead>
        <tr>
          <th style="width:40px">序号</th>
          <th>产品编号</th>
          <th>产品名称</th>
          <th>数量</th>
          <th>要求完成日期</th>
          <th>备注</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}
```

**Step 4: Commit**

```bash
git add public/print.html
git commit -m "feat: add assembly print format to print.html"
```

---

### Task 7: Add assembly to supervisor.html

**Files:**
- Modify: `public/supervisor.html`

**Step 1: Add assembly tab**

Find the tabs section (line 104-106) and add an assembly tab:

```html
<ul class="nav nav-tabs type-tabs mb-3" id="supTabs">
  <li class="nav-item"><a class="nav-link active" href="#" onclick="return switchSupTab('injection',this)"><i class="bi bi-box-seam me-1"></i>啤办单</a></li>
  <li class="nav-item"><a class="nav-link" href="#" onclick="return switchSupTab('assembly',this)"><i class="bi bi-gear-wide-connected me-1"></i>装配单</a></li>
</ul>
```

Note: The first tab already has an `onclick` implicit via the existing code. Check that `switchSupTab` exists and works — it does (line 243).

**Step 2: Update renderSupDetails to handle assembly orders**

Find `renderSupDetails` (line 351). Add an `assembly` branch to the if/else chain (before the spray `else`):

```js
} else if (type === 'assembly') {
  thead = '<tr><th>序号</th><th>产品编号</th><th>产品名称</th><th>数量</th><th>要求完成日期</th><th>备注</th></tr>';
  rows = items.map((it, i) => `<tr>
    <td>${i+1}</td><td>${esc(it.product_number||'-')}</td><td>${esc(it.product_name||'-')}</td>
    <td>${esc(it.quantity||'-')}</td><td>${esc(it.completion_time||'-')}</td><td>${esc(it.notes||'-')}</td>
  </tr>`).join('');
}
```

**Step 3: Fix the approval status for assembly**

In `submitSupReview` (line 397), when approving, the code currently sends `newStatus = '待经理审核'`. For assembly, approval should go directly to `'待生产'` (skipping manager).

Update the function:

```js
async function submitSupReview(action) {
  const rejectReason = document.getElementById('supRejectReason').value.trim();
  // Assembly skips manager — goes directly to 待生产
  const approveStatus = supTab === 'assembly' ? '待生产' : '待经理审核';
  const newStatus = action === 'approve' ? approveStatus : '已驳回';
  const pin = sessionStorage.getItem('sup_pin') || '';
  // ... rest stays the same
```

Also update the toast message at line 421:
```js
showToast(action === 'approve'
  ? (supTab === 'assembly' ? '审核通过！已转为待生产' : '审核通过！已转交经理审核')
  : '已驳回', action === 'approve' ? 'success' : 'danger');
```

**Step 4: Commit**

```bash
git add public/supervisor.html
git commit -m "feat: add assembly tab to supervisor review page"
```

---

### Task 8: Add assembly card to index.html dashboard

**Files:**
- Modify: `public/index.html`

**Step 1: Add CSS class for assembly card**

Add to the `<style>` block (after `.spray .card-header`):
```css
.asm .card-header { background: #2980b9; color: #fff; }
```

**Step 2: Add assembly card HTML**

After the spray card closing `</div>` (around line 135), before the `</div>` that closes the row, add:

```html
<!-- 装配部 -->
<div class="col-md-6 col-lg-3">
  <div class="card dept-card-big asm h-100">
    <div class="card-header"><i class="bi bi-gear-wide-connected me-2"></i>装配部</div>
    <div class="card-body d-flex flex-column">
      <p class="text-muted small mb-3">创建和管理装配任务单据</p>
      <div class="row text-center mb-3 g-2">
        <div class="col-4">
          <div class="stat-num text-warning" id="asm-pending">-</div>
          <div class="stat-label">待生产</div>
        </div>
        <div class="col-4">
          <div class="stat-num text-info" id="asm-progress">-</div>
          <div class="stat-label">生产中</div>
        </div>
        <div class="col-4">
          <div class="stat-num text-success" id="asm-done">-</div>
          <div class="stat-label">已完成</div>
        </div>
      </div>
      <a href="assembly.html" class="btn go-btn mt-auto w-100" style="background:#2980b9;color:#fff">进入装配部</a>
    </div>
  </div>
</div>
```

**Step 3: Update the stats JS**

In the `loadStats` function, add assembly stats after spray:

```js
document.getElementById('asm-pending').textContent  = s.assembly?.pending || 0;
document.getElementById('asm-progress').textContent = s.assembly?.inProgress || 0;
document.getElementById('asm-done').textContent     = s.assembly?.done || 0;
```

Also update the engineering (total) counts to include assembly:

```js
document.getElementById('eng-pending').textContent  = (s.injection.pending||0) + (s.slush.pending||0) + (s.spray.pending||0) + (s.assembly?.pending||0);
document.getElementById('eng-progress').textContent = (s.injection.inProgress||0) + (s.slush.inProgress||0) + (s.spray.inProgress||0) + (s.assembly?.inProgress||0);
document.getElementById('eng-done').textContent     = (s.injection.done||0) + (s.slush.done||0) + (s.spray.done||0) + (s.assembly?.done||0);
```

**Step 4: Commit**

```bash
git add public/index.html
git commit -m "feat: add assembly card to dashboard"
```

---

### Task 9: Seed an initial assembly user for testing

**Files:**
- Manual action via curl or browser console

**Step 1: Add a test user**

After starting the server, run:

```bash
curl -X POST http://localhost:3000/api/assembly-users \
  -H "Content-Type: application/json" \
  -H "X-User: admin" \
  -d '{"name":"测试用户","pin":"1234"}'
```

**Step 2: Test the full flow**

1. Open `http://localhost:3000/assembly.html`
2. Log in with name: `测试用户`, PIN: `1234`
3. Create a new assembly order with at least one item
4. Verify it appears in the order list
5. Open supervisor.html, switch to the 装配单 tab, verify the order appears
6. Print the order — verify 兴信 format renders
7. Check dashboard — verify assembly stats appear

**Step 3: Commit (if any fixes were needed)**

```bash
git add -A
git commit -m "fix: assembly integration fixes from testing"
```

---

### Task 10: Final verification

**Step 1: Verify all pages load without errors**

Open each page and check browser console for JS errors:
- `http://localhost:3000/` (dashboard)
- `http://localhost:3000/assembly.html`
- `http://localhost:3000/supervisor.html`
- `http://localhost:3000/print.html?type=assembly&id=<test_id>`

**Step 2: Verify the complete workflow**

1. Assembly user creates order → status is `待审核`
2. Supervisor approves → status becomes `待生产` (not `待经理审核`)
3. Assembly user clicks "开始生产" → status becomes `生产中`
4. Assembly user clicks "完成" → status becomes `已完成`, `completed_date` is set
5. Rejected orders can be re-edited and resubmitted

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: assembly department complete - order CRUD, login, approval, print, dashboard"
```
