/* ══════════════════════════════════════════
   兴信 QMS · app.js  v2
   修复：图表初始化时序 / localStorage回退 / 
         全部图表有数据 / 错误不中断页面
══════════════════════════════════════════ */

/* ════════════════════════════════════════
   §0  SEED DATA — 22 条真实+补充模拟数据
════════════════════════════════════════ */
const SEED_RECORDS = [
  { id:1,  date:'2026-04-02', inspDate:'2026-04-02', supplier:'伟创',     client:'ZURU',    productNo:'15751', productName:'157食物系列-热肠狗51',       deliveryNo:'0002403',      type:'成品',   qty:1945, sampleQty:125, pass:125, fail:0,  defectRate:'0.00%',  result:'PASS', defect:'',                    qc:'颜丽莎', remark:'' },
  { id:2,  date:'2026-04-02', inspDate:'2026-04-02', supplier:'壹加一',   client:'ZURU',    productNo:'15784', productName:'橙色怪',                    deliveryNo:'0002008',      type:'半成品', qty:1080, sampleQty:80,  pass:68,  fail:12, defectRate:'15.00%', result:'REJ',  defect:'止口偏大，眼贴歪',    qc:'李燕娜', remark:'' },
  { id:3,  date:'2026-04-04', inspDate:'2026-04-04', supplier:'政英',     client:'ZURU',    productNo:'15782', productName:'5"钥匙扣浅粉色熊',           deliveryNo:'2025486',      type:'成品',   qty:4029, sampleQty:200, pass:200, fail:0,  defectRate:'0.00%',  result:'PASS', defect:'',                    qc:'颜丽莎', remark:'' },
  { id:4,  date:'2026-04-04', inspDate:'2026-04-04', supplier:'荣生',     client:'ZURU',    productNo:'15782', productName:'5"钥匙扣黄色熊',            deliveryNo:'0000992',      type:'成品',   qty:2090, sampleQty:125, pass:109, fail:16, defectRate:'12.80%', result:'REJ',  defect:'大小眼，眼贴歪',      qc:'颜丽莎', remark:'' },
  { id:5,  date:'2026-04-04', inspDate:'2026-04-04', supplier:'文泰',     client:'ZURU',    productNo:'15784', productName:'黑粉拼接怪',                deliveryNo:'20260404005',   type:'成品',   qty:192,  sampleQty:20,  pass:20,  fail:0,  defectRate:'0.00%',  result:'PASS', defect:'',                    qc:'颜丽莎', remark:'' },
  { id:6,  date:'2026-04-13', inspDate:'2026-04-13', supplier:'庆龙',     client:'ZURU',    productNo:'15790', productName:'嘎嘎小姐',                  deliveryNo:'0155813',      type:'成品',   qty:55,   sampleQty:13,  pass:13,  fail:0,  defectRate:'0.00%',  result:'PASS', defect:'',                    qc:'颜丽莎', remark:'' },
  { id:7,  date:'2026-04-09', inspDate:'2026-04-07', supplier:'和鑫',     client:'ZURU',    productNo:'15782', productName:'5"钥匙扣绿色熊',            deliveryNo:'0001554',      type:'成品',   qty:1313, sampleQty:125, pass:125, fail:0,  defectRate:'0.00%',  result:'PASS', defect:'',                    qc:'颜丽莎', remark:'' },
  { id:8,  date:'2026-04-18', inspDate:'2026-04-18', supplier:'龙川顺灵', client:'ZURU',    productNo:'15786', productName:'绿色怪',                    deliveryNo:'000001',       type:'成品',   qty:100,  sampleQty:20,  pass:15,  fail:5,  defectRate:'25.00%', result:'REJ',  defect:'大小脚',              qc:'颜丽莎', remark:'' },
  { id:9,  date:'2026-03-09', inspDate:'2026-03-09', supplier:'嘉乐',     client:'Goliath', productNo:'935373',productName:'切斯特屁股公仔棕色头发海虎毛', deliveryNo:'0001055',      type:'成品',   qty:800,  sampleQty:80,  pass:69,  fail:11, defectRate:'13.75%', result:'REJ',  defect:'线头，爆口，形状不良', qc:'颜丽莎', remark:'' },
  { id:10, date:'2026-04-01', inspDate:'2026-04-01', supplier:'浩鑫',     client:'ZURU',    productNo:'15760', productName:'5"锁扣斜纹怪',              deliveryNo:'0000229',      type:'成品',   qty:1500, sampleQty:125, pass:125, fail:0,  defectRate:'0.00%',  result:'PASS', defect:'',                    qc:'颜丽莎', remark:'' },
  { id:11, date:'2026-04-01', inspDate:'2026-03-31', supplier:'名发',     client:'JP',      productNo:'93018', productName:'索菲娅短裙',                deliveryNo:'260027',       type:'成品',   qty:3000, sampleQty:125, pass:125, fail:0,  defectRate:'0.00%',  result:'PASS', defect:'',                    qc:'颜丽莎', remark:'' },
  { id:12, date:'2026-04-01', inspDate:'2026-03-31', supplier:'名发',     client:'ZURU',    productNo:'15755', productName:'9"蓝色熊',                  deliveryNo:'260027',       type:'成品',   qty:212,  sampleQty:32,  pass:32,  fail:0,  defectRate:'0.00%',  result:'PASS', defect:'',                    qc:'颜丽莎', remark:'' },
  { id:13, date:'2026-04-01', inspDate:'2026-03-31', supplier:'名发',     client:'ZURU',    productNo:'15790', productName:'比利',                      deliveryNo:'260027',       type:'成品',   qty:300,  sampleQty:50,  pass:38,  fail:12, defectRate:'24.00%', result:'REJ',  defect:'色差，缝线不匀',      qc:'颜丽莎', remark:'' },
  { id:14, date:'2026-04-01', inspDate:'2026-04-01', supplier:'嘉乐',     client:'ZURU',    productNo:'15754', productName:'9"泰勒',                    deliveryNo:'0000028',      type:'成品',   qty:3607, sampleQty:200, pass:156, fail:44, defectRate:'22.00%', result:'REJ',  defect:'大小眼，斜眼',        qc:'颜丽莎', remark:'' },
  { id:15, date:'2026-04-01', inspDate:'2026-04-01', supplier:'嘉乐',     client:'ZURU',    productNo:'15784', productName:'橙色怪',                    deliveryNo:'0000028',      type:'成品',   qty:4030, sampleQty:200, pass:200, fail:0,  defectRate:'0.00%',  result:'PASS', defect:'',                    qc:'颜丽莎', remark:'' },
  { id:16, date:'2026-04-01', inspDate:'2026-04-01', supplier:'嘉乐',     client:'ZURU',    productNo:'15784', productName:'豹纹怪',                    deliveryNo:'0000028',      type:'成品',   qty:6800, sampleQty:200, pass:200, fail:0,  defectRate:'0.00%',  result:'PASS', defect:'',                    qc:'颜丽莎', remark:'' },
  { id:17, date:'2026-04-01', inspDate:'2026-04-01', supplier:'嘉乐',     client:'ZURU',    productNo:'15786', productName:'虎纹怪',                    deliveryNo:'0000028',      type:'成品',   qty:7500, sampleQty:200, pass:196, fail:4,  defectRate:'2.00%',  result:'PASS', defect:'轻微色差',            qc:'颜丽莎', remark:'' },
  { id:18, date:'2026-04-08', inspDate:'2026-04-08', supplier:'新万利',   client:'ZURU',    productNo:'15751', productName:'食物系列混合款',            deliveryNo:'0003011',      type:'成品',   qty:2500, sampleQty:125, pass:125, fail:0,  defectRate:'0.00%',  result:'PASS', defect:'',                    qc:'颜丽莎', remark:'' },
  { id:19, date:'2026-04-10', inspDate:'2026-04-10', supplier:'丰业',     client:'ZURU',    productNo:'15782', productName:'5"熊系列',                  deliveryNo:'0004521',      type:'成品',   qty:3200, sampleQty:200, pass:200, fail:0,  defectRate:'0.00%',  result:'PASS', defect:'',                    qc:'李燕娜', remark:'' },
  { id:20, date:'2026-04-15', inspDate:'2026-04-15', supplier:'壹加一',   client:'ZURU',    productNo:'15784', productName:'蓝色怪',                    deliveryNo:'0002145',      type:'半成品', qty:800,  sampleQty:80,  pass:64,  fail:16, defectRate:'20.00%', result:'REJ',  defect:'眼贴歪，止口偏大，咪咪眼', qc:'李燕娜', remark:'' },
  { id:21, date:'2026-04-16', inspDate:'2026-04-16', supplier:'荣生',     client:'ZURU',    productNo:'15782', productName:'5"钥匙扣红色熊',            deliveryNo:'0001203',      type:'成品',   qty:1800, sampleQty:125, pass:125, fail:0,  defectRate:'0.00%',  result:'PASS', defect:'',                    qc:'颜丽莎', remark:'' },
  { id:22, date:'2026-04-20', inspDate:'2026-04-20', supplier:'名发',     client:'ZURU',    productNo:'15755', productName:'9"粉色熊',                  deliveryNo:'0005501',      type:'成品',   qty:600,  sampleQty:80,  pass:72,  fail:8,  defectRate:'10.00%', result:'REJ',  defect:'大小脚，斜眼',        qc:'颜丽莎', remark:'' },
  /* 补充额外批次让图表曲线更丰富 */
  { id:23, date:'2026-03-30', inspDate:'2026-03-30', supplier:'嘉乐',     client:'ZURU',    productNo:'15754', productName:'9"猫王',                    deliveryNo:'0000020',      type:'成品',   qty:800,  sampleQty:80,  pass:72,  fail:8,  defectRate:'10.00%', result:'REJ',  defect:'斜眼，咪咪眼',        qc:'颜丽莎', remark:'' },
  { id:24, date:'2026-03-30', inspDate:'2026-03-30', supplier:'名发',     client:'ZURU',    productNo:'15782', productName:'5"钥匙扣紫色熊',            deliveryNo:'260010',       type:'成品',   qty:1200, sampleQty:125, pass:119, fail:6,  defectRate:'4.80%',  result:'PASS', defect:'轻微色差',            qc:'颜丽莎', remark:'' },
  { id:25, date:'2026-03-31', inspDate:'2026-03-31', supplier:'壹加一',   client:'ZURU',    productNo:'15784', productName:'粉色怪',                    deliveryNo:'0001980',      type:'半成品', qty:960,  sampleQty:80,  pass:76,  fail:4,  defectRate:'5.00%',  result:'PASS', defect:'止口略偏',            qc:'李燕娜', remark:'' },
  { id:26, date:'2026-04-06', inspDate:'2026-04-06', supplier:'嘉乐',     client:'Goliath', productNo:'935374',productName:'切斯特公仔白色头发',         deliveryNo:'0001060',      type:'成品',   qty:1200, sampleQty:125, pass:125, fail:0,  defectRate:'0.00%',  result:'PASS', defect:'',                    qc:'颜丽莎', remark:'' },
  { id:27, date:'2026-04-07', inspDate:'2026-04-07', supplier:'荣生',     client:'ZURU',    productNo:'15782', productName:'5"钥匙扣橙色熊',            deliveryNo:'0001010',      type:'成品',   qty:1500, sampleQty:125, pass:111, fail:14, defectRate:'11.20%', result:'REJ',  defect:'大小眼，爆口',        qc:'颜丽莎', remark:'' },
  { id:28, date:'2026-04-11', inspDate:'2026-04-11', supplier:'丰业',     client:'ZURU',    productNo:'15786', productName:'虎纹怪中文标',              deliveryNo:'0004600',      type:'成品',   qty:5000, sampleQty:200, pass:200, fail:0,  defectRate:'0.00%',  result:'PASS', defect:'',                    qc:'李燕娜', remark:'' },
  { id:29, date:'2026-04-12', inspDate:'2026-04-12', supplier:'龙川顺灵', client:'ZURU',    productNo:'15784', productName:'绿色怪中文标',              deliveryNo:'000005',       type:'成品',   qty:300,  sampleQty:50,  pass:38,  fail:12, defectRate:'24.00%', result:'REJ',  defect:'大小脚，眼贴歪',      qc:'颜丽莎', remark:'' },
  { id:30, date:'2026-04-17', inspDate:'2026-04-17', supplier:'浩鑫',     client:'ZURU',    productNo:'15760', productName:'5"锁扣彩虹怪',              deliveryNo:'0000300',      type:'成品',   qty:2000, sampleQty:125, pass:125, fail:0,  defectRate:'0.00%',  result:'PASS', defect:'',                    qc:'颜丽莎', remark:'' },
];

/* ════════════════════════════════════════
   §1  STATE & STORAGE
════════════════════════════════════════ */
/* 兴信专用 localStorage 前缀，避免与其他 QMS 项目数据混用 */
const STORAGE_PREFIX = 'xingxin_qms_';
const STORAGE_KEYS = {
  records:      STORAGE_PREFIX + 'records',
  theme:        STORAGE_PREFIX + 'theme',
  users:        STORAGE_PREFIX + 'users',         /* 账号列表 */
  session:      STORAGE_PREFIX + 'session',        /* 当前登录会话 */
  defectLib:    STORAGE_PREFIX + 'defect_library', /* 不良描述内容库 */
};
const LS_KEY = STORAGE_KEYS.records;   /* 主数据 key */
let state        = { records: [], nextId: 31 };
let editingId    = null;
let chartInst    = {};          // { chartId: echartsInstance }
let currentPage  = 'dashboard';
let filteredRecs = [];

/* ════════════════════════════════════════
   §1.5  AUTH — 账号 / 会话 / 权限
════════════════════════════════════════ */

/* ── 简单密码 hash（djb2，纯前端，非安全级，仅防止明文存储）── */
function _hashPwd(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  return (h >>> 0).toString(16);
}

/* ── 权限表 ── */
const ROLE_PERMS = {
  admin: {
    createRecord:true, editRecord:true, deleteRecord:true, batchDelete:true,
    importData:true,   exportData:true,  exportPdf:true,   manageUsers:true,
  },
  manager: {
    createRecord:true, editRecord:true,  deleteRecord:false, batchDelete:false,
    importData:true,   exportData:true,  exportPdf:true,    manageUsers:false,
  },
  viewer: {
    createRecord:false, editRecord:false, deleteRecord:false, batchDelete:false,
    importData:false,   exportData:true,  exportPdf:true,    manageUsers:false,
  },
};

const ROLE_LABELS = { admin:'主账号', manager:'管理账号', viewer:'查看账号' };

/* ── 初始化账号数据（首次启动自动创建默认主账号 jc / qqwwee）── */
function initUsers() {
  const raw = localStorage.getItem(STORAGE_KEYS.users);
  if (!raw) {
    const defaultUsers = [{
      username:    'jc',
      password:    _hashPwd('qqwwee'),
      role:        'admin',
      enabled:     true,
      createdAt:   new Date().toISOString(),
      lastLoginAt: null,
    }];
    localStorage.setItem(STORAGE_KEYS.users, JSON.stringify(defaultUsers));
  }
}

function _getUsers() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.users)) || []; }
  catch(e) { return []; }
}
function _saveUsers(users) {
  localStorage.setItem(STORAGE_KEYS.users, JSON.stringify(users));
}

/* ── 会话操作 ── */
function getCurrentUser() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.session)); }
  catch(e) { return null; }
}

function _saveSession(user) {
  const sess = { username: user.username, role: user.role, loginTime: new Date().toISOString() };
  localStorage.setItem(STORAGE_KEYS.session, JSON.stringify(sess));
}

function _clearSession() {
  localStorage.removeItem(STORAGE_KEYS.session);
}

/* ── 权限判断 ── */
function can(action) {
  const u = getCurrentUser();
  if (!u) return false;
  const perms = ROLE_PERMS[u.role];
  return perms ? (perms[action] === true) : false;
}

/* ── 登录 ── */
function login() {
  const unameEl = document.getElementById('loginUsername');
  const pwdEl   = document.getElementById('loginPassword');
  const errEl   = document.getElementById('loginError');
  const username = (unameEl?.value || '').trim();
  const password = (pwdEl?.value || '').trim();

  if (!username || !password) {
    if (errEl) { errEl.textContent = '请输入用户名和密码'; errEl.style.display = ''; }
    return;
  }

  const users = _getUsers();
  const user  = users.find(u => u.username === username);

  if (!user || user.password !== _hashPwd(password)) {
    if (errEl) { errEl.textContent = '用户名或密码错误'; errEl.style.display = ''; }
    if (pwdEl) { pwdEl.value = ''; pwdEl.focus(); }
    return;
  }
  if (!user.enabled) {
    if (errEl) { errEl.textContent = '账号已停用，请联系管理员'; errEl.style.display = ''; }
    return;
  }

  /* 更新最后登录时间 */
  user.lastLoginAt = new Date().toISOString();
  _saveUsers(users);
  _saveSession(user);

  /* 进入系统 */
  _showApp();
}

/* 按 Enter 键登录 */
function loginOnEnter(e) {
  if (e.key === 'Enter') login();
}

/* ── 退出登录 ── */
function logout() {
  _clearSession();
  _showLogin();
}

/* ── 显示 / 隐藏登录页 ── */
function _showLogin() {
  document.getElementById('loginScreen').style.display  = 'flex';
  document.getElementById('appWrapper').style.display   = 'none';
  /* 清空输入 */
  const u = document.getElementById('loginUsername');
  const p = document.getElementById('loginPassword');
  const e = document.getElementById('loginError');
  if (u) u.value = '';
  if (p) p.value = '';
  if (e) { e.textContent = ''; e.style.display = 'none'; }
}

function _showApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appWrapper').style.display  = '';
  _renderUserBadge();
  applyPermissions();
  /* 关键：登录后必须主动渲染仪表板（DOMContentLoaded 的 RAF 已过期）
     用 RAF 等 appWrapper 完成布局后再渲染图表，确保 ECharts 拿到正确尺寸 */
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      try {
        showPage('dashboard');
        /* 顶部 KPI 在 showPage 之外，需单独刷新 */
        if (typeof updateTopKpis === 'function') updateTopKpis();
      } catch(e) { console.error('[_showApp] render error:', e); }
    });
  });
}

/* ── 渲染右上角用户徽章 ── */
function _renderUserBadge() {
  const u = getCurrentUser();
  const el = document.getElementById('userBadge');
  if (!el || !u) return;
  el.innerHTML =
    `<span class="user-badge-name">${u.username}</span>` +
    `<span class="user-badge-role">${ROLE_LABELS[u.role] || u.role}</span>` +
    `<button class="user-badge-logout" onclick="logout()">退出</button>`;
}

/* ── 权限应用（按角色显示/隐藏按钮）── */
function applyPermissions() {
  const u = getCurrentUser();
  if (!u) return;

  /* 新增验货按钮 */
  const canCreate = can('createRecord');
  document.querySelectorAll('.btn-add, [data-perm="createRecord"]').forEach(el => {
    el.style.display = canCreate ? '' : 'none';
  });

  /* 批量删除区 */
  const canDel = can('deleteRecord');
  const batchDelWrap = document.getElementById('batchDelWrap');
  if (batchDelWrap) batchDelWrap.style.display = canDel ? '' : 'none';

  /* 数据导入菜单项 */
  const importNav = document.querySelector('.nav-item[data-page="import"]');
  if (importNav) importNav.style.display = can('importData') ? '' : 'none';

  /* 账号管理菜单（仅 admin）*/
  const usersNav = document.querySelector('.nav-item[data-page="users"]');
  if (usersNav) usersNav.style.display = can('manageUsers') ? '' : 'none';

  /* 新增记录按钮（records 页）*/
  const addRecordBtn = document.getElementById('btnAddRecord');
  if (addRecordBtn) addRecordBtn.style.display = canCreate ? '' : 'none';
}

/* ── requireLogin：启动时鉴权 ── */
function requireLogin() {
  initUsers();
  const sess = getCurrentUser();
  if (!sess) { _showLogin(); return; }

  /* 验证 session 中的用户是否仍有效且未被停用 */
  const users = _getUsers();
  const user  = users.find(u => u.username === sess.username);
  if (!user || !user.enabled) { _clearSession(); _showLogin(); return; }

  _showApp();
}

/* ════════════════════════════════════════
   §1.6  USER MANAGEMENT PAGE
════════════════════════════════════════ */

function renderUsersPage() {
  if (!can('manageUsers')) {
    showToast('当前账号无权限执行此操作', 'error'); return;
  }
  const el = document.getElementById('page-users');
  if (!el) return;
  const users = _getUsers();
  const me    = getCurrentUser();

  el.innerHTML = `
  <div class="page-header">
    <h2 class="page-title">账号管理</h2>
    <button class="btn-primary" onclick="_openUserModal()">＋ 新增账号</button>
  </div>
  <div class="table-wrap" style="margin-top:12px">
    <table style="table-layout:fixed;width:100%">
      <colgroup>
        <col style="width:130px"/><col style="width:100px"/><col style="width:80px"/>
        <col style="width:160px"/><col style="width:160px"/><col style="width:180px"/>
      </colgroup>
      <thead><tr>
        <th style="text-align:left">用户名</th>
        <th style="text-align:left">角色</th>
        <th style="text-align:center">状态</th>
        <th style="text-align:left">创建时间</th>
        <th style="text-align:left">最后登录</th>
        <th style="text-align:center">操作</th>
      </tr></thead>
      <tbody>
        ${users.map(u => {
          const isSelf = u.username === me?.username;
          const statusBadge = u.enabled
            ? '<span class="badge badge-pass">启用</span>'
            : '<span class="badge badge-rej">停用</span>';
          const created  = u.createdAt  ? u.createdAt.slice(0,10)  : '—';
          const lastLogin= u.lastLoginAt? u.lastLoginAt.slice(0,16).replace('T',' ') : '从未';
          return `<tr>
            <td style="font-weight:500;color:#e8edf5">${u.username}${isSelf?' <span style="font-size:10px;color:var(--accent)">(我)</span>':''}</td>
            <td>${ROLE_LABELS[u.role]||u.role}</td>
            <td style="text-align:center">${statusBadge}</td>
            <td style="font-size:11px">${created}</td>
            <td style="font-size:11px">${lastLogin}</td>
            <td style="text-align:center">
              <button class="action-btn" onclick="_openUserModal('${u.username}')">编辑</button>
              ${!isSelf ? `<button class="action-btn ${u.enabled?'':'badge-pass'}" onclick="_toggleUser('${u.username}')">${u.enabled?'停用':'启用'}</button>` : ''}
              ${!isSelf ? `<button class="action-btn del" onclick="_deleteUser('${u.username}')">删除</button>` : ''}
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>

  <!-- 新增/编辑账号弹框 -->
  <div id="userModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:2000;align-items:center;justify-content:center">
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:28px 32px;width:380px;max-width:95vw">
      <h3 id="userModalTitle" style="margin:0 0 20px;color:var(--text-hi);font-size:16px">新增账号</h3>
      <div style="margin-bottom:14px">
        <label class="form-label">用户名</label>
        <input id="umUsername" class="form-input" placeholder="字母/数字，至少2位" autocomplete="off"/>
      </div>
      <div style="margin-bottom:14px">
        <label class="form-label">密码 <span id="umPwdHint" style="font-size:10px;color:var(--text-dim)">（留空则不修改）</span></label>
        <input id="umPassword" type="password" class="form-input" placeholder="至少6位" autocomplete="new-password"/>
      </div>
      <div style="margin-bottom:14px">
        <label class="form-label">确认密码</label>
        <input id="umPassword2" type="password" class="form-input" placeholder="再次输入密码" autocomplete="new-password"/>
      </div>
      <div style="margin-bottom:20px">
        <label class="form-label">角色</label>
        <select id="umRole" class="form-input">
          <option value="admin">主账号（admin）</option>
          <option value="manager" selected>管理账号（manager）</option>
          <option value="viewer">查看账号（viewer）</option>
        </select>
      </div>
      <div id="userModalErr" style="display:none;color:var(--red);font-size:12px;margin-bottom:12px"></div>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button class="btn-secondary" onclick="_closeUserModal()">取消</button>
        <button class="btn-primary" onclick="_saveUser()">保存</button>
      </div>
    </div>
  </div>
  `;
}

let _editingUsername = null;

function _openUserModal(username) {
  _editingUsername = username || null;
  const modal = document.getElementById('userModal');
  if (!modal) return;
  modal.style.display = 'flex';

  const titleEl = document.getElementById('userModalTitle');
  const hintEl  = document.getElementById('umPwdHint');

  if (username) {
    /* 编辑模式 */
    const users = _getUsers();
    const u     = users.find(x => x.username === username);
    if (!u) return;
    if (titleEl) titleEl.textContent = `编辑账号：${username}`;
    if (hintEl)  hintEl.style.display = '';
    document.getElementById('umUsername').value = u.username;
    document.getElementById('umUsername').disabled = true;
    document.getElementById('umPassword').value  = '';
    document.getElementById('umPassword2').value = '';
    document.getElementById('umRole').value = u.role;
  } else {
    /* 新增模式 */
    if (titleEl) titleEl.textContent = '新增账号';
    if (hintEl)  hintEl.style.display = 'none';
    document.getElementById('umUsername').value = '';
    document.getElementById('umUsername').disabled = false;
    document.getElementById('umPassword').value  = '';
    document.getElementById('umPassword2').value = '';
    document.getElementById('umRole').value = 'manager';
  }
  const errEl = document.getElementById('userModalErr');
  if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
}

function _closeUserModal() {
  const modal = document.getElementById('userModal');
  if (modal) modal.style.display = 'none';
  _editingUsername = null;
}

function _saveUser() {
  const errEl  = document.getElementById('userModalErr');
  const show   = msg => { if(errEl){ errEl.textContent=msg; errEl.style.display=''; } };

  const uname  = (document.getElementById('umUsername')?.value||'').trim();
  const pwd    = (document.getElementById('umPassword')?.value||'').trim();
  const pwd2   = (document.getElementById('umPassword2')?.value||'').trim();
  const role   = document.getElementById('umRole')?.value || 'viewer';

  if (!uname || uname.length < 2) { show('用户名至少2位'); return; }
  if (!/^[a-zA-Z0-9_一-龥]+$/.test(uname)) { show('用户名只能含字母、数字、下划线或汉字'); return; }

  const users = _getUsers();

  if (_editingUsername) {
    /* 编辑模式 */
    const u = users.find(x => x.username === _editingUsername);
    if (!u) { show('账号不存在'); return; }
    if (pwd) {
      if (pwd.length < 6) { show('密码至少6位'); return; }
      if (pwd !== pwd2)   { show('两次密码不一致'); return; }
      u.password = _hashPwd(pwd);
    }
    u.role = role;
    /* 确保至少1个 admin */
    const admins = users.filter(x => x.role === 'admin' && x.enabled);
    if (admins.length === 0) { show('至少保留一个启用的主账号'); return; }
  } else {
    /* 新增模式 */
    if (users.find(x => x.username === uname)) { show('用户名已存在'); return; }
    if (!pwd) { show('请输入密码'); return; }
    if (pwd.length < 6) { show('密码至少6位'); return; }
    if (pwd !== pwd2)   { show('两次密码不一致'); return; }
    users.push({
      username:    uname,
      password:    _hashPwd(pwd),
      role,
      enabled:     true,
      createdAt:   new Date().toISOString(),
      lastLoginAt: null,
    });
  }

  _saveUsers(users);
  _closeUserModal();
  showToast('✓ 账号已保存', 'success');
  renderUsersPage();
}

function _toggleUser(username) {
  const users = _getUsers();
  const u     = users.find(x => x.username === username);
  if (!u) return;
  const me = getCurrentUser();
  if (u.username === me?.username) { showToast('不能停用当前登录账号', 'error'); return; }

  /* 确保至少1个启用的 admin */
  if (u.role === 'admin' && u.enabled) {
    const admins = users.filter(x => x.role === 'admin' && x.enabled && x.username !== username);
    if (admins.length === 0) { showToast('至少保留一个启用的主账号', 'error'); return; }
  }

  u.enabled = !u.enabled;
  _saveUsers(users);
  showToast(u.enabled ? '✓ 账号已启用' : '账号已停用', u.enabled ? 'success' : 'info');
  renderUsersPage();
}

function _deleteUser(username) {
  const me = getCurrentUser();
  if (username === me?.username) { showToast('不能删除当前登录账号', 'error'); return; }
  if (!confirm(`确认删除账号「${username}」？此操作不可撤销。`)) return;

  const users = _getUsers();
  const u     = users.find(x => x.username === username);
  if (u?.role === 'admin') {
    const admins = users.filter(x => x.role === 'admin' && x.username !== username);
    if (admins.length === 0) { showToast('至少保留一个主账号', 'error'); return; }
  }

  const newUsers = users.filter(x => x.username !== username);
  _saveUsers(newUsers);
  showToast('✓ 账号已删除', 'success');
  renderUsersPage();
}


function initData() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.records) && parsed.records.length > 0) {
        state = parsed;
        return;
      }
    }
  } catch (e) { /* ignore */ }
  /* 没有或损坏时加载种子数据 */
  state = { records: SEED_RECORDS.map(r => Object.assign({}, r)), nextId: 31 };
  persist();
}

function persist() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch(e) {}
}

function recs() { return state.records; }

/* ════════════════════════════════════════
   §2  HELPERS
════════════════════════════════════════ */
function isFail(r) {
  const v = (r.result || '').toUpperCase();
  return v === 'REJ' || v === 'FAIL';
}
function isPass(r) { return (r.result || '').toUpperCase() === 'PASS'; }

function groupBy(arr, key) {
  return arr.reduce((acc, item) => {
    const k = item[key] || '未知';
    (acc[k] = acc[k] || []).push(item);
    return acc;
  }, {});
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function pad(n) { return String(n).padStart(2, '0'); }

function weekStart(dateStr) {
  const dt = dateStr ? new Date(dateStr) : new Date();
  const day = dt.getDay();
  const diff = dt.getDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(dt.setDate(diff));
  return `${mon.getFullYear()}-${pad(mon.getMonth()+1)}-${pad(mon.getDate())}`;
}
function weekEnd(ws) {
  const d = new Date(ws);
  d.setDate(d.getDate() + 6);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

/* parseRate: 解析不良率字符串 → 数值
   ★ 规则：空字符串 / null / sampleQty缺失 → 返回 null（不参与平均）
           有效数字字符串 → 返回 float（0~100）
*/
function parseRate(s) {
  if (s == null || s === '') return null;          /* 无抽查数据 → null */
  const n = parseFloat(String(s).replace('%', ''));
  return isNaN(n) ? null : n;
}
/* 向后兼容：需要数值时用 parseRate(s) ?? 0 */

/* 判断一条记录是否有有效不良率数据（可参与平均计算） */
function _hasRate(r) {
  return r.sampleQty != null && r.defectRate != null && r.defectRate !== '';
}

/* ─────────────────────────────────────────
   _isValidDefect(str) — 不良现象文字清洗
   返回 true  = 真实问题描述，参与统计
   返回 false = 无效值（占位符/数值/空白），过滤掉
   ─────────────────────────────────────────
   过滤条件（任一命中即为无效）：
   ① 空字符串 / 纯空白
   ② 占位符：- / — / N/A / 无 / 无不良 / PASS / OK / 正常 / 合格 等
   ③ 纯数字 ± 百分号：0 / 0.00% / 1071 等（不良率误入字段）
   ④ 字符串超过 30 字（极可能是误把整行写进来）
───────────────────────────────────────── */
function _isValidDefect(str) {
  if (!str) return false;
  const s = String(str).trim();
  if (!s) return false;
  if (s.length > 30) return false;          /* 异常长文本 */

  /* 明确的无效占位符（大小写不敏感） */
  const INVALID = new Set([
    '-','—','——','--','－','n/a','na',
    '无','无不良','暂无','无不良现象','无问题','无异常',
    '正常','合格','良好','pass','ok','/',
    '0','0.0','0.00',
  ]);
  if (INVALID.has(s.toLowerCase())) return false;

  /* 纯数字（含逗号千分位）± 百分号 → 不良率误入不良现象字段 */
  if (/^[\d,]+(\.\d+)?%?$/.test(s)) return false;

  return true;
}

/* 统一的不良现象拆分 + 清洗入口
   输入：一条记录的 defect 字段
   输出：已清洗的有效子项数组
*/
function _splitDefect(raw) {
  if (!raw) return [];
  return String(raw)
    .split(/[，,、；;\s]+/)
    .map(d => d.trim())
    .filter(d => _isValidDefect(d));
}

/* 计算一组记录的平均不良率（只含有抽查数据的记录）
   返回 { avg: number|null, counted: number, total: number }
   avg=null 表示该组全部无抽查数据
*/
function _defectRateAvg(arr) {
  const valid = arr.filter(r => _hasRate(r));
  if (!valid.length) return { avg: null, counted: 0, total: arr.length };
  const sum = valid.reduce((s, r) => s + (parseRate(r.defectRate) ?? 0), 0);
  return { avg: +(sum / valid.length).toFixed(1), counted: valid.length, total: arr.length };
}
function fmtPct(n)    { return (n * 100).toFixed(1) + '%'; }

function getRisk(failRate) {
  if (failRate >= 0.15) return 'high';
  if (failRate >= 0.05) return 'mid';
  return 'low';
}

/* ════════════════════════════════════════
   §3  CLOCK
════════════════════════════════════════ */
function tickClock() {
  try {
    const n = new Date();
    const el1 = document.getElementById('sidebarTime');
    const el2 = document.getElementById('sidebarDate');
    if (el1) el1.textContent = `${pad(n.getHours())}:${pad(n.getMinutes())}:${pad(n.getSeconds())}`;
    if (el2) el2.textContent = `${n.getFullYear()}/${pad(n.getMonth()+1)}/${pad(n.getDate())}`;
  } catch(e) {}
}
setInterval(tickClock, 1000);

/* ════════════════════════════════════════
   §4  NAVIGATION
════════════════════════════════════════ */
const PAGE_TITLES = {
  dashboard:        '质量仪表板',
  records:          '验货明细',
  analysis:         '统计分析',
  suppliers:        '供应商管理',
  daily:            '品质日报',
  weekly:           '品质周报',
  monthly:          '品质月报',
  yearly:           '品质年报',
  'supplier-report':'供应商质量报告',
  import:           '数据导入',
  users:            '账号管理',
  defectlib:        '不良描述库',
};

function showPage(name) {
  /* 账号管理越权防护：非 admin 调用 users 页面，强制返回仪表板 */
  if (name === 'users' && !can('manageUsers')) {
    showToast('当前账号无权限访问', 'error');
    name = 'dashboard';
  }
  currentPage = name;
  /* 切换 active page */
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const pg  = document.getElementById('page-' + name);
  const nav = document.querySelector(`.nav-item[data-page="${name}"]`);
  if (pg)  pg.classList.add('active');
  if (nav) nav.classList.add('active');
  const titleEl = document.getElementById('pageTitle');
  if (titleEl) titleEl.textContent = PAGE_TITLES[name] || name;

  /*
   * ★ 关键：等一个 RAF，让浏览器先把 display:block 的页面渲染出来
   *   (offsetWidth/offsetHeight 只在 layout 后才返回真实值)
   *   然后再初始化/刷新图表
   */
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      try {
        if (name === 'dashboard')        renderDashboard();
        if (name === 'records')          renderRecordsTable();
        if (name === 'analysis')         renderAnalysis();
        if (name === 'suppliers')        renderSuppliers();
        if (name === 'daily')            renderDailyReport();
        if (name === 'weekly')           renderWeeklyReport();
        if (name === 'monthly')          renderMonthlyReport();
        if (name === 'yearly')           renderYearlyReport();
        if (name === 'supplier-report')  populateSupplierSelect();
        if (name === 'import')           _backupStats();
        if (name === 'users')            renderUsersPage();
        if (name === 'defectlib')        renderDefectLibPage();
      } catch(e) { console.error('[showPage] render error:', e); }
    });
  });
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('collapsed');
  document.querySelector('.main-wrap').classList.toggle('full');
  /* sidebar 收起/展开后图表需要 resize */
  setTimeout(resizeAllCharts, 300);
}

/* ════════════════════════════════════════
   §5  TOP-BAR KPIs
════════════════════════════════════════ */
function updateTopKpis() {
  try {
    const data = recs();
    const today = todayStr();
    const ws    = weekStart();
    const we    = weekEnd(ws);
    const todayR = data.filter(r => r.date === today || r.inspDate === today);
    const passT  = todayR.filter(r => isPass(r)).length;
    const rateT  = todayR.length ? fmtPct(passT / todayR.length) : 'N/A';

    const weekR  = data.filter(r => r.date >= ws && r.date <= we);
    const weekF  = weekR.filter(r => isFail(r)).length;

    const byS = groupBy(data, 'supplier');
    const hiRisk = Object.values(byS).filter(list => {
      if (list.length < 2) return false;
      return list.filter(r => isFail(r)).length / list.length >= 0.15;
    }).length;

    setText('kpiPassRate',  rateT);
    setText('kpiWeekFail',  weekF);
    setText('kpiHighRisk',  hiRisk);
    setText('kpiWeekBatch', weekR.length);
  } catch(e) { console.error('[updateTopKpis]', e); }
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

/* ════════════════════════════════════════
   §6  DASHBOARD
════════════════════════════════════════ */
/* 仪表板「数据月份」筛选：'' = 全部月份，'YYYY-MM' = 指定月 */
let _dashMonth = '';

/* 在概要卡上方注入/刷新月份选择器；选项来自记录中实际出现的月份（倒序） */
function ensureDashMonthFilter() {
  const cards = document.getElementById('summaryCards');
  if (!cards || !cards.parentNode) return;
  let bar = document.getElementById('dashMonthBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'dashMonthBar';
    bar.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap;';
    bar.innerHTML =
      '<span style="font-size:13px;color:var(--text-dim)">数据月份</span>' +
      '<select id="dashMonthSel" class="filter-select" style="width:auto;min-width:130px"></select>' +
      '<span id="dashMonthHint" style="font-size:12px;color:var(--text-muted)"></span>';
    cards.parentNode.insertBefore(bar, cards);
    bar.querySelector('#dashMonthSel').addEventListener('change', function () {
      _dashMonth = this.value;
      renderDashboard();
    });
  }
  const months = Array.from(new Set(recs().map(r => (r.date || '').slice(0, 7)).filter(Boolean))).sort().reverse();
  const sel = document.getElementById('dashMonthSel');
  if (sel) {
    sel.innerHTML = '<option value="">全部月份</option>' +
      months.map(m => `<option value="${m}">${m.slice(0,4)}年${m.slice(5,7)}月</option>`).join('');
    sel.value = _dashMonth;
  }
}

function renderDashboard() {
  ensureDashMonthFilter();
  let data = recs();
  if (_dashMonth) data = data.filter(r => r.date && r.date.startsWith(_dashMonth));
  const hint = document.getElementById('dashMonthHint');
  if (hint) hint.textContent = _dashMonth ? ('· 本月 ' + data.length + ' 条记录') : ('· 全部 ' + data.length + ' 条记录');
  updateTopKpis();
  renderSummaryCards(data);
  renderRiskTable(data);
  renderRiskMatrix(data);
  /* 图表统一在 initCharts() 中初始化（接收已按月过滤的 data） */
  initCharts(data);
}

function renderSummaryCards(data) {
  const el = document.getElementById('summaryCards');
  if (!el) return;
  const total    = data.length;
  const failCnt  = data.filter(r => isFail(r)).length;
  const passCnt  = total - failCnt;
  const passRate = total ? fmtPct(passCnt / total) : '0.0%';
  const totalQty = data.reduce((s, r) => s + (r.qty || 0), 0);
  const ws = weekStart(), we = weekEnd(ws);
  const weekR = data.filter(r => r.date >= ws && r.date <= we);

  el.innerHTML = `
    <div class="summary-card green">
      <div class="card-icon">✓</div>
      <div class="card-label">总体通过率</div>
      <div class="card-value text-green">${passRate}</div>
      <div class="card-sub">${passCnt} / ${total} 非REJ批次</div>
    </div>
    <div class="summary-card red">
      <div class="card-icon">✕</div>
      <div class="card-label">总 FAIL 批次</div>
      <div class="card-value text-red">${failCnt}</div>
      <div class="card-sub">本周 ${weekR.filter(r=>isFail(r)).length} 批</div>
    </div>
    <div class="summary-card accent">
      <div class="card-icon">⬡</div>
      <div class="card-label">累计验货批次</div>
      <div class="card-value">${total}</div>
      <div class="card-sub">本周 ${weekR.length} 批</div>
    </div>
    <div class="summary-card blue">
      <div class="card-icon">◈</div>
      <div class="card-label">累计来料数量</div>
      <div class="card-value">${(totalQty/10000).toFixed(1)}<span style="font-size:14px">万</span></div>
      <div class="card-sub">共 ${totalQty.toLocaleString()} 件</div>
    </div>
    <div class="summary-card yellow">
      <div class="card-icon">◉</div>
      <div class="card-label">活跃供应商</div>
      <div class="card-value text-yellow">${Object.keys(groupBy(data,'supplier')).length}</div>
      <div class="card-sub">家参与本期验货</div>
    </div>`;
}

/* ════════════════════════════════════════
   §7  CHART ENGINE
   ★  所有 ECharts 图表在这里统一初始化
      必须在 DOM 可见 (display:block) 后调用
════════════════════════════════════════ */

/* 安全初始化单个 ECharts 实例 */
function makeChart(id) {
  try {
    const el = document.getElementById(id);
    if (!el) { console.warn('[makeChart] 找不到容器:', id); return null; }
    /* 如果已有实例先销毁 */
    if (chartInst[id]) {
      try { chartInst[id].dispose(); } catch(e) {}
      delete chartInst[id];
    }
    /* ECharts 5 不再有内置 dark 主题名，
       用 'dark' 会报找不到注册主题。
       直接 init 不传主题，通过 option 设背景色 */
    const inst = echarts.init(el);
    chartInst[id] = inst;
    return inst;
  } catch(e) {
    console.error('[makeChart]', id, e);
    return null;
  }
}

/* 公共 tooltip 样式（动态，随主题变化） */
/* 使用方式：...(_cc().tt) 替代 ...TT */
const TT = {   /* 保留 TT 作为深色默认兜底，图表内改用 _cc().tt */
  backgroundColor: '#10141c',
  borderColor: '#2a3d52',
  textStyle: { color: '#e8edf5', fontSize: 12 },
};

/* 公共 grid */
function G(top=30, right=16, bottom=30, left=50) {
  return { top, right, bottom, left, containLabel: true };
}

/* ─── §7.1  初始化仪表板所有图表 ─── */
function initCharts(data) {
  /* 按顺序逐个初始化，catch 独立，互不影响 */
  safeInit(() => chartDailyTrend(data),     'chartDailyTrend');
  safeInit(() => chartResultPie(data),      'chartResultPie');
  safeInit(() => chartSupplierRank(data),   'chartSupplierRank');
  safeInit(() => chartDefectTop(data),      'chartDefectTop');
  safeInit(() => chartClientPie(data),      'chartClientPie');
  safeInit(() => chartWeeklyTrend(data),    'chartWeeklyTrend');
  /* chartRiskMatrix 用 HTML 渲染，不用 ECharts */
}

/* 初始化分析页图表 */
function initAnalysisCharts(data) {
  safeInit(() => chartWeeklySupplier(data), 'chartWeeklySupplier');
  safeInit(() => chartProductType(data),    'chartProductType');
  safeInit(() => chartFailMonth(data),      'chartFailMonth');
  safeInit(() => chartDefectHeatmap(data),  'chartDefectHeatmap');
}

function safeInit(fn, label) {
  try { fn(); } catch(e) { console.error('[chart]', label, e); }
}

/* ─── §7.2  具体图表实现 ─── */

/* 1. 每日验货 + PASS率 */
function chartDailyTrend(data) {
  const c = makeChart('chartDailyTrend');
  if (!c) return;
  const byDate = groupBy(data, 'date');
  const dates  = Object.keys(byDate).sort();
  const totals = dates.map(d => byDate[d].length);
  const fails  = dates.map(d => byDate[d].filter(r => isFail(r)).length);
  const rates  = dates.map((d, i) => totals[i] ? +((totals[i]-fails[i])/totals[i]*100).toFixed(1) : 100);

  c.setOption({
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis', ...(_cc().tt) },
    legend: {
      data:      ['验货批次','PASS率(%)'],
      textStyle: { color: _cc().text, fontSize: 11 },
      top:       6,
      right:     28,
      itemGap:   22,
      itemWidth: 14,
      itemHeight: 9,
    },
    grid: G(44, 60, 28, 48),
    xAxis: {
      type:'category', data: dates.map(d => d.slice(5)),
      axisLabel:{ color:_cc().textDim, fontSize:10 },
      axisLine:{ lineStyle:{ color:_cc().axis } },
    },
    yAxis: [
      { type:'value', name:'批次', nameTextStyle:{color:_cc().textDim,fontSize:10},
        axisLabel:{ color:_cc().textDim, fontSize:10 },
        splitLine:{ lineStyle:{ color:_cc().grid, type:'dashed' } } },
      { type:'value', name:'PASS率', min:0, max:100,
        nameTextStyle:{color:_cc().textDim,fontSize:10},
        axisLabel:{ color:_cc().textDim, fontSize:10, formatter:'{value}%' },
        splitLine:{ show:false } },
    ],
    series: [
      { name:'验货批次', type:'bar', data:totals,
        itemStyle:{ color:'#0090bb', borderRadius:[3,3,0,0] },
        barMaxWidth: 30 },
      { name:'PASS率(%)', type:'line', yAxisIndex:1, data:rates,
        smooth:true, symbol:'circle', symbolSize:5,
        lineStyle:{ color:'#00e596', width:2 },
        itemStyle:{ color:'#00e596' },
        areaStyle:{ color:'rgba(0,229,150,0.07)' } },
    ],
  });
}

/* 2. 判定结果饼图 */
function chartResultPie(data) {
  const c = makeChart('chartResultPie');
  if (!c) return;
  const pass = data.filter(r => isPass(r)).length;
  const fail = data.filter(r => isFail(r)).length;
  const cond = data.filter(r => r.result === 'COND').length;
  const hold = data.filter(r => r.result === 'HOLD').length;

  c.setOption({
    backgroundColor:'transparent',
    tooltip:{ trigger:'item', ...(_cc().tt),
      formatter: p => {
        const label = p.name === 'PASS' ? '纯 PASS 占比' :
                      p.name === 'REJ'  ? 'REJ 占比'     :
                      p.name + ' 占比';
        return `<b>${p.name}：${p.value}批</b><br/>`
          + `${label}：${p.percent.toFixed(2)}%<br/>`
          + `<span style="color:#8899aa;font-size:10px">注：总体通过率含非REJ批次，PASS占比仅统计纯PASS</span>`;
      }
    },
    legend:{ bottom:4, textStyle:{ color:_cc().text, fontSize:10 }, itemWidth:10, itemHeight:10 },
    series:[{
      type:'pie', radius:['48%','72%'], center:['50%','44%'],
      label:{ show:false },
      emphasis:{ label:{ show:true, fontSize:13, fontWeight:'bold', color:_cc().textHi } },
      data:[
        { value:pass, name:'PASS',   itemStyle:{ color:'#00e596' } },
        { value:fail, name:'REJ',    itemStyle:{ color:'#ff3d5a' } },
        { value:cond, name:'有条件', itemStyle:{ color:'#f5c842' } },
        { value:hold, name:'待定',   itemStyle:{ color:'#3b82f6' } },
      ].filter(d => d.value > 0),
    }],
  });
}

/* 3. 供应商批次不良率排名（REJ批次 / 验货批次 × 100%，与供应商管理口径一致）*/
function chartSupplierRank(data) {
  const c = makeChart('chartSupplierRank');
  if (!c) return;

  /* 复用 getSupplierTopRate（batchRate口径，rej>0 才进入排名） */
  const list = getSupplierTopRate(data, 10);

  if (!list.length) {
    c.setOption({
      backgroundColor: 'transparent',
      graphic: [{ type:'text', left:'center', top:'middle',
        style:{ text:'暂无供应商不良率数据', fill:_cc().textDim, fontSize:12 } }],
    });
    return;
  }

  /* 横向条图，供应商名称在 Y 轴，不被截断 */
  const names = list.map(d => d.name).reverse();
  const bars  = list.map(d => d.batchRate).reverse();
  const ttList = list.slice().reverse();

  c.setOption({
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis', ...(_cc().tt),
      formatter: p => {
        const d = ttList[p[0].dataIndex];
        const qr = d.qtyRate != null ? d.qtyRate.toFixed(1) + '%' : '—';
        return `<b>${d.name}</b><br/>` +
               `验货批次：${d.total}<br/>` +
               `REJ批次：${d.rej}<br/>` +
               `批次不良率：<strong>${d.batchRate.toFixed(1)}%</strong><br/>` +
               `数量不良率：${qr}（参考）`;
      },
    },
    grid: { top: 8, left: 8, right: 44, bottom: 8, containLabel: true },
    xAxis: {
      type: 'value',
      name: '批次不良率',
      nameTextStyle: { color: _cc().textDim, fontSize: 10 },
      axisLabel: { color: _cc().textDim, fontSize: 10, formatter: '{value}%' },
      splitLine: { lineStyle: { color: _cc().grid, type: 'dashed' } },
    },
    yAxis: {
      type: 'category', data: names,
      axisLabel: { color: _cc().text, fontSize: 10 },
      axisLine: { lineStyle: { color: _cc().axis } },
    },
    series: [{
      type: 'bar', barMaxWidth: 20,
      data: bars.map(v => ({
        value: v,
        itemStyle: {
          color: v >= 30 ? '#ff3d5a' : v >= 10 ? '#f5c842' : '#00e596',
          borderRadius: [0, 3, 3, 0],
        },
      })),
      label: {
        show: true, position: 'right',
        color: _cc().text, fontSize: 10,
        formatter: p => p.value.toFixed(1) + '%',
      },
    }],
  });
}

/* 4. 不良类型 TOP（横向柱图） */
function chartDefectTop(data) {
  const c = makeChart('chartDefectTop');
  if (!c) return;
  const dm = {};
  data.forEach(r => {
    _splitDefect(r.defect).forEach(d => {
      dm[d] = (dm[d] || 0) + 1;
    });
  });

  const hasData = Object.keys(dm).length > 0;
  /* 无不良时显示空状态，不用占位数据 */
  if (!hasData) {
    c.setOption({
      backgroundColor: 'transparent',
      graphic: [{
        type: 'text', left: 'center', top: 'middle',
        style: { text: '暂无不良数据', fill: '#3a4858', fontSize: 13 },
      }],
    });
    return;
  }

  const list = Object.entries(dm).sort((a,b)=>b[1]-a[1]).slice(0,8);
  const COLS = ['#ff3d5a','#ff6b35','#f5c842','#f5c842','#00c8ff','#3b82f6','#3b82f6','#a855f7'];

  c.setOption({
    backgroundColor:'transparent',
    tooltip:{ trigger:'axis', ...(_cc().tt) },
    grid: G(10, 50, 10, 10),
    xAxis:{ type:'value',
      axisLabel:{ color:_cc().textDim, fontSize:10 },
      splitLine:{ lineStyle:{ color:_cc().grid, type:'dashed' } } },
    yAxis:{ type:'category', data:list.map(d=>d[0]).reverse(),
      axisLabel:{ color:_cc().text, fontSize:11 } },
    series:[{
      type:'bar', barMaxWidth:18,
      data: list.map((d,i) => ({
        value:d[1],
        itemStyle:{ color:COLS[i]||'#3b82f6', borderRadius:[0,3,3,0] },
      })).reverse(),
      label:{ show:true, position:'right', color:_cc().text, fontSize:10,
        formatter: p => p.value + '次' },
    }],
  });
}

/* 5. 客户占比环形图 */
function chartClientPie(data) {
  const c = makeChart('chartClientPie');
  if (!c) return;

  const byC   = groupBy(data, 'client');
  const total = data.length || 1;
  const COLS  = ['#00c8ff','#00e596','#f5c842','#ff6b35','#ff3d5a','#3b82f6','#a855f7','#ec4899'];

  /* 按批次数降序排列 */
  const sorted = Object.entries(byC)
    .map(([name, arr]) => ({ name, value: arr.length }))
    .sort((a, b) => b.value - a.value);

  /* 合并规则：
     ① 超过 7 个客户 → 保留 TOP 7，其余合入"其他"
     ② 占比 < 3% 的客户合入"其他"（无论总数多少）
  */
  const THRESHOLD = 0.03;
  const MAX_SLICES = 7;

  const main  = [];
  let otherVal = 0;

  sorted.forEach((d, i) => {
    const pct = d.value / total;
    if (i < MAX_SLICES && pct >= THRESHOLD) {
      main.push(d);
    } else {
      otherVal += d.value;
    }
  });

  if (otherVal > 0) {
    main.push({ name: '其他', value: otherVal });
  }

  /* 计算每项占比，用于按项控制标签显示 */
  const totalVal = main.reduce((s, d) => s + d.value, 0) || 1;
  /* 分配颜色 + 按占比控制标签/引导线 */
  const SHOW_PCT = 8;   /* >= 8% 才显示外部标签 */
  const list = main.map((d, i) => {
    const pct = d.value / totalVal * 100;
    const showLbl = pct >= SHOW_PCT;
    return {
      value:     d.value,
      name:      d.name,
      itemStyle: { color: d.name === '其他' ? '#4a5568' : COLS[i % COLS.length] },
      label:     { show: showLbl },
      labelLine: { show: showLbl },
    };
  });

  c.setOption({
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item', ...(_cc().tt),
      confine: true,
      formatter: p => `${p.name}<br/>批次：${p.value}<br/>占比：${p.percent.toFixed(1)}%`,
    },
    legend: {
      type:       'scroll',
      orient:     'horizontal',
      bottom:     2,
      left:       10,
      right:      10,
      itemWidth:  10,
      itemHeight: 10,
      itemGap:    10,
      textStyle:     { color: _cc().text,   fontSize: 11 },
      pageTextStyle: { color: _cc().textHi, fontSize: 11 },
      pageIconColor:         _cc().blue || '#00c8ff',
      pageIconInactiveColor: _cc().pageInactive,
    },
    series: [{
      type:              'pie',
      radius:            ['42%', '62%'],
      center:            ['50%', '42%'],
      avoidLabelOverlap: true,           /* 恢复自动避让，配合按项控制 */
      minShowLabelAngle: 8,
      label: {
        show:       true,
        position:   'outside',
        fontSize:   11,
        fontWeight: 600,
        lineHeight: 14,
        color:      _cc().textHi,
        formatter:  p => `${p.name}\n${p.percent.toFixed(0)}%`,
      },
      labelLine: {
        show:      true,
        length:    14,
        length2:   14,
        smooth:    false,
        lineStyle: { color: _cc().labelLine, width: 1.2 },
      },
      labelLayout:  { hideOverlap: true },  /* 仍存在的重叠标签自动隐藏 */
      emphasis: {
        label: {
          show:      true,
          fontSize:  12,
          formatter: p => `${p.name}\n${p.percent.toFixed(1)}%`,
        },
      },
      data: list,
    }],
  });
}

/* 6. 本周批次不良率趋势（折线）
   Y轴：每周批次不良率 = REJ批次 / 总批次 × 100%（与供应商排名口径一致）
   某周无验货数据 → null（折线断开，不显示 0%）
*/
function chartWeeklyTrend(data) {
  const c = makeChart('chartWeeklyTrend');
  if (!c) return;
  const bw = {};
  data.forEach(r => {
    const ws = weekStart(r.date);
    if (!bw[ws]) bw[ws] = { total: 0, fail: 0 };
    bw[ws].total++;
    if (isFail(r)) bw[ws].fail++;
  });
  const weeks = Object.keys(bw).sort();

  /* 批次不良率 = REJ批次 / 总批次；某周无记录则 null */
  const weekData = weeks.map(w => {
    const d = bw[w];
    if (!d || d.total === 0) return { rate: null, total: 0, fail: 0 };
    return {
      rate:  +(d.fail / d.total * 100).toFixed(1),
      total: d.total,
      fail:  d.fail,
    };
  });

  c.setOption({
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis', ...(_cc().tt),
      formatter: p => {
        const idx = p[0].dataIndex;
        const d   = weekData[idx];
        if (!d || d.total === 0) {
          return `W${idx + 1}（${weeks[idx].slice(5)}）<br/>无验货记录`;
        }
        const rateStr = d.rate != null ? d.rate.toFixed(1) + '%' : '—';
        return `<b>W${idx + 1}（${weeks[idx].slice(5)}）</b><br/>` +
               `验货批次：${d.total}<br/>` +
               `REJ批次：${d.fail}<br/>` +
               `批次不良率：<strong>${rateStr}</strong>`;
      },
    },
    grid: G(24, 14, 28, 48),
    xAxis: {
      type: 'category', data: weeks.map((_, i) => `W${i + 1}`),
      axisLabel: { color: _cc().textDim, fontSize: 10 },
      axisLine: { lineStyle: { color: _cc().axis } },
    },
    yAxis: {
      type: 'value', name: '批次不良率',
      nameTextStyle: { color: _cc().textDim, fontSize: 10 },
      axisLabel: { color: _cc().textDim, fontSize: 10, formatter: '{value}%' },
      splitLine: { lineStyle: { color: _cc().grid, type: 'dashed' } },
    },
    series: [{
      type: 'line',
      data: weekData.map(d => d.rate),   /* null = 该周无记录，折线断开 */
      connectNulls: false,
      smooth: true, symbol: 'circle', symbolSize: 6,
      lineStyle: { color: '#f5c842', width: 2 },
      itemStyle: { color: '#f5c842' },
      areaStyle: { color: 'rgba(245,200,66,0.08)' },
      markLine: {
        data: [{ type: 'average', name: '均值',
          lineStyle: { color: '#ff3d5a', type: 'dashed', width: 1 } }],
        label: { color: '#ff3d5a', fontSize: 10 },
        silent: true,
      },
    }],
  });
}

/* 7. 风险矩阵（HTML 渲染，不用 ECharts） */
function renderRiskMatrix(data) {
  const el = document.getElementById('chartRiskMatrix');
  if (!el) return;

  const SEVERITY = {
    '爆口':'high','大小眼':'high','斜眼':'high','大小脚':'high','形状不良':'high',
    '线头':'medium','咪咪眼':'medium','眼贴歪':'medium','止口偏大':'medium','色差':'medium',
    '缝线不匀':'medium','轻微色差':'low',
  };

  const dm = {};
  data.forEach(r => {
    _splitDefect(r.defect).forEach(d => {
      dm[d] = (dm[d] || 0) + 1;
    });
  });

  const items = Object.entries(dm).sort((a,b)=>b[1]-a[1]).slice(0,10);
  const maxCnt = items[0]?.[1] || 1;

  if (!items.length) {
    el.innerHTML = '<div class="empty-state" style="padding:30px"><div class="empty-icon">✓</div><div class="empty-text">暂无不良记录</div></div>';
    return;
  }

  el.className = 'chart-body risk-body';
  el.innerHTML = '<div class="risk-matrix-wrap">' +
    items.map(([name, cnt]) => {
      const lv  = SEVERITY[name] || (cnt>=4?'high':cnt>=2?'medium':'low');
      const pct = Math.round(cnt / maxCnt * 100);
      const tag = { high:'高风险', medium:'风险', low:'正常' }[lv];
      const bc  = { high:'badge-rej', medium:'badge-cond', low:'badge-pass' }[lv];
      return `<div class="risk-item ${lv}">
        <span class="risk-name">${name}</span>
        <div class="risk-bar-wrap"><div class="risk-bar" style="width:${pct}%"></div></div>
        <span class="risk-count">${cnt}次</span>
        <span class="badge ${bc}">${tag}</span>
      </div>`;
    }).join('') + '</div>';
}

/* 8. 每周供应商批次不良率趋势（分析页）
   Y轴：各供应商每周批次不良率 = REJ批次 / 总批次 × 100%（与供应商排名口径一致）
   某供应商某周无验货 → null，折线断开
*/
function chartWeeklySupplier(data) {
  const c = makeChart('chartWeeklySupplier');
  if (!c) return;
  /* 按周、供应商分组 */
  const bw = {};
  data.forEach(r => {
    const ws = weekStart(r.date);
    if (!bw[ws]) bw[ws] = {};
    const s = r.supplier;
    if (!bw[ws][s]) bw[ws][s] = { total: 0, fail: 0 };
    bw[ws][s].total++;
    if (isFail(r)) bw[ws][s].fail++;
  });
  const weeks = Object.keys(bw).sort();

  /* 取批次不良率最高的前5供应商（按整体 REJ批次/总批次 排序） */
  const top5 = Object.keys(groupBy(data, 'supplier'))
    .map(s => {
      const allRecs = data.filter(r => r.supplier === s);
      const total   = allRecs.length;
      const fail    = allRecs.filter(r => isFail(r)).length;
      return { s, rate: total > 0 ? fail / total : 0 };
    })
    .filter(d => d.rate > 0)                          /* 只显示有 REJ 的供应商 */
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 5)
    .map(d => d.s);

  if (!top5.length) {
    c.setOption({ backgroundColor:'transparent',
      graphic:[{ type:'text', left:'center', top:'middle',
        style:{ text:'本期无 REJ 批次', fill:_cc().textDim, fontSize:13 } }] });
    return;
  }

  const COLS = ['#ff3d5a', '#f5c842', '#00c8ff', '#00e596', '#a855f7'];

  c.setOption({
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis', ...(_cc().tt),
      formatter: params => {
        const idx  = params[0].dataIndex;
        const week = `W${idx + 1}（${weeks[idx].slice(5)}）`;
        const lines = params.map(p => {
          const s = top5[p.seriesIndex];
          const d = bw[weeks[idx]] && bw[weeks[idx]][s];
          if (!d) return `<span style="color:${COLS[p.seriesIndex]}">● ${s}：无验货数据</span>`;
          const rate = p.value != null ? p.value.toFixed(1) + '%' : '—';
          return `<span style="color:${COLS[p.seriesIndex]}">●</span> ${s}：验货${d.total}批 / REJ${d.fail}批 / 批次不良率 ${rate}`;
        });
        return week + '<br/>' + lines.join('<br/>');
      },
    },
    legend: { data: top5, textStyle: { color: _cc().text, fontSize: 10 }, top: 4, right: 6 },
    grid: G(34, 14, 28, 48),
    xAxis: {
      type: 'category', data: weeks.map((_, i) => `W${i + 1}`),
      axisLabel: { color: _cc().textDim, fontSize: 10 },
      axisLine: { lineStyle: { color: _cc().axis } },
    },
    yAxis: {
      type: 'value', name: '批次不良率',
      nameTextStyle: { color: _cc().textDim, fontSize: 10 },
      axisLabel: { color: _cc().textDim, fontSize: 10, formatter: '{value}%' },
      splitLine: { lineStyle: { color: _cc().grid, type: 'dashed' } },
    },
    series: top5.map((s, i) => ({
      name: s, type: 'line', smooth: true,
      connectNulls: false,
      data: weeks.map(w => {
        const d = bw[w] && bw[w][s];
        if (!d || d.total === 0) return null;
        /* 批次不良率 = REJ批次 / 总批次 × 100 */
        return +(d.fail / d.total * 100).toFixed(1);
      }),
      symbol: 'circle', symbolSize: 5,
      lineStyle: { color: COLS[i], width: 2 },
      itemStyle: { color: COLS[i] },
    })),
  });
}

/* 9. 成品 vs 半成品 */
function chartProductType(data) {
  const c = makeChart('chartProductType');
  if (!c) return;
  const byT  = groupBy(data, 'type');
  const COLS = ['#00c8ff','#f5c842','#00e596'];

  c.setOption({
    backgroundColor: 'transparent',
    tooltip: {
      trigger:   'item', ...(_cc().tt),
      formatter: p => `${p.name}<br/>批次：${p.value}<br/>占比：${p.percent.toFixed(1)}%`,
    },
    legend: {
      type:       'scroll',
      orient:     'horizontal',
      bottom:     2,
      left:       'center',
      itemWidth:  10,
      itemHeight: 10,
      textStyle:  { color: _cc().text, fontSize: 10 },
      pageTextStyle:        { color: _cc().text, fontSize: 9 },
      pageIconColor:        '#00c8ff',
      pageIconInactiveColor:_cc().pageInactive,
    },
    series: [{
      type:   'pie',
      radius: ['42%', '70%'],
      center: ['50%', '44%'],
      label:      { show: false },   /* 关闭外部标签，避免重叠 */
      labelLine:  { show: false },
      emphasis: {
        label: {
          show:     true,
          fontSize: 12,
          fontWeight: 'bold',
          color:    _cc().textHi,
          formatter: '{b}\n{d}%',   /* hover 时才显示 */
        },
      },
      data: Object.entries(byT).map(([name, arr], i) => ({
        value:     arr.length,
        name,
        itemStyle: { color: COLS[i % COLS.length] },
      })),
    }],
  });
}

/* 10. FAIL 批次月度汇总 */
function chartFailMonth(data) {
  const c = makeChart('chartFailMonth');
  if (!c) return;
  const bm = {};
  data.forEach(r => {
    const m = r.date.slice(0,7);
    if (!bm[m]) bm[m] = { total:0, fail:0 };
    bm[m].total++;
    if (isFail(r)) bm[m].fail++;
  });
  const months = Object.keys(bm).sort();
  c.setOption({
    backgroundColor:'transparent',
    tooltip:{ trigger:'axis', ...(_cc().tt) },
    legend:{ data:['总批次','FAIL批次'], textStyle:{ color:_cc().text, fontSize:10 }, top:4 },
    grid: G(34, 14, 28, 40),
    xAxis:{ type:'category', data:months.map(m=>m.slice(5)+'月'),
      axisLabel:{ color:_cc().textDim, fontSize:10 },
      axisLine:{ lineStyle:{ color:_cc().axis } } },
    yAxis:{ type:'value',
      axisLabel:{ color:_cc().textDim, fontSize:10 },
      splitLine:{ lineStyle:{ color:_cc().grid, type:'dashed' } } },
    series:[
      { name:'总批次',  type:'bar', barMaxWidth:24,
        data:months.map(m=>bm[m].total),
        itemStyle:{ color:'#0090bb', borderRadius:[3,3,0,0] } },
      { name:'FAIL批次', type:'bar', barMaxWidth:24,
        data:months.map(m=>bm[m].fail),
        itemStyle:{ color:'#ff3d5a', borderRadius:[3,3,0,0] } },
    ],
  });
}

/* 11. 不良现象热力图（供应商 × 不良类型） */
function chartDefectHeatmap(data) {
  const c = makeChart('chartDefectHeatmap');
  if (!c) return;

  const suppliers = [...new Set(data.map(r=>r.supplier))].slice(0,8);
  const defTypes = new Set();
  data.forEach(r => {
    _splitDefect(r.defect).forEach(d => defTypes.add(d));
  });
  const dList = [...defTypes].slice(0,8);

  /* 如果没有不良数据，放假数据避免空白 */
  if (!dList.length) dList.push('暂无不良');

  const heatData = [];
  suppliers.forEach((s,si) => {
    dList.forEach((d,di) => {
      const cnt = data.filter(r=>r.supplier===s&&r.defect&&r.defect.includes(d)).length;
      heatData.push([di, si, cnt]);
    });
  });

  c.setOption({
    backgroundColor:'transparent',
    tooltip:{ position:'top', ...(_cc().tt),
      formatter: p => `${suppliers[p.value[1]]} × ${dList[p.value[0]]}: ${p.value[2]}次` },
    grid: G(32, 20, 60, 80),
    xAxis:{ type:'category', data:dList,
      axisLabel:{ color:_cc().text, fontSize:10, rotate:20 },
      splitArea:{ show:true, areaStyle:{ color:_cc().heatArea } } },
    yAxis:{ type:'category', data:suppliers,
      axisLabel:{ color:_cc().text, fontSize:11 },
      splitArea:{ show:true, areaStyle:{ color:_cc().heatArea } } },
    visualMap:{
      min:0, max:5, calculable:true, orient:'horizontal',
      left:'center', bottom:4,
      textStyle:{ color:_cc().text, fontSize:10 },
      inRange:{ color:_cc().heatRange },
    },
    series:[{
      type:'heatmap', data:heatData,
      label:{ show:true, color:_cc().heatLabel, fontSize:10,
        formatter: p => p.value[2] > 0 ? p.value[2] : '' },
      emphasis:{ itemStyle:{ shadowBlur:8, shadowColor:'rgba(0,0,0,.5)' } },
    }],
  });
}

/* ════════════════════════════════════════
   §8  RISK TABLE
════════════════════════════════════════ */
function renderRiskTable(data) {
  const el = document.getElementById('riskTableWrap');
  if (!el) return;
  const failR = data.filter(r=>isFail(r)).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,12);
  if (!failR.length) {
    el.innerHTML = '<div class="empty-state" style="padding:40px"><div class="empty-icon">✓</div><div class="empty-text">暂无高风险批次</div></div>';
    return;
  }
  el.innerHTML = `<table style="table-layout:fixed;width:100%">
    <colgroup>
      <col style="width:100px"/><col style="width:110px"/><col style="width:100px"/>
      <col style="width:auto"/><col style="width:90px"/><col style="width:80px"/>
      <col style="width:80px"/><col style="width:180px"/><col style="width:90px"/>
    </colgroup>
    <thead><tr>
      <th style="text-align:left">日期</th>
      <th style="text-align:left">供应商</th>
      <th style="text-align:left">货号</th>
      <th style="text-align:left">款式</th>
      <th style="text-align:right">来料数</th>
      <th style="text-align:right">抽查数</th>
      <th style="text-align:right">不良率</th>
      <th style="text-align:left">不良现象</th>
      <th style="text-align:center">风险等级</th>
    </tr></thead>
    <tbody>${failR.map(r => {
      const rt = parseRate(r.defectRate) ?? 0;
      const cls = rt>=20 ? 'risk-red' : 'risk-yellow';
      const lbl = rt>=20 ? '高风险' : '风险';
      return `<tr>
        <td style="font-family:var(--font-mono);font-size:11px;white-space:nowrap">${r.date}</td>
        <td style="font-weight:500;color:#e8edf5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${r.supplier}">${r.supplier}</td>
        <td style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:var(--font-mono);font-size:11px" title="${r.productNo||''}">${r.productNo||'-'}</td>
        <td style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.productName||''}">${r.productName||'-'}</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums">${(r.qty||0).toLocaleString()}</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums">${r.sampleQty != null ? r.sampleQty : '<span style="color:var(--text-muted)">—</span>'}</td>
        <td style="text-align:right" class="${cls}">${r.sampleQty != null ? (r.defectRate||'-') : '<span style="color:var(--text-muted)">—</span>'}</td>
        <td style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px" title="${r.defect||''}">${r.defect||'-'}</td>
        <td style="text-align:center"><span class="badge ${rt>=20?'badge-rej':'badge-cond'}">${lbl}</span></td>
      </tr>`;
    }).join('')}</tbody></table>`;
}

/* ════════════════════════════════════════
   §9  ANALYSIS PAGE
════════════════════════════════════════ */
function renderAnalysis() {
  const data = recs();
  const total = data.length;
  const fail  = data.filter(r=>isFail(r)).length;
  const passR = total ? ((total-fail)/total*100).toFixed(1) : 0;
  const defCt = data.filter(r=>r.defect&&r.defect.trim()).length;
  const avgQty= total ? Math.round(data.reduce((s,r)=>s+(Number(r.qty)||0),0)/total) : 0;

  const el = document.getElementById('analysisSummary');
  if (el) el.innerHTML = `
    <div class="summary-card green"><div class="card-label">总体通过率</div>
      <div class="card-value text-green">${passR}%</div><div class="card-sub">${total}批次统计</div></div>
    <div class="summary-card red"><div class="card-label">总FAIL批次</div>
      <div class="card-value text-red">${fail}</div><div class="card-sub">占比${total?(fail/total*100).toFixed(1):0}%</div></div>
    <div class="summary-card yellow"><div class="card-label">有不良记录</div>
      <div class="card-value text-yellow">${defCt}</div><div class="card-sub">批次含不良描述</div></div>
    <div class="summary-card blue"><div class="card-label">平均批次数量</div>
      <div class="card-value">${avgQty.toLocaleString()}</div><div class="card-sub">件/批次</div></div>`;

  initAnalysisCharts(data);
}

/* ════════════════════════════════════════
   §10  SUPPLIERS PAGE
════════════════════════════════════════ */
function renderSuppliers() {
  const data = recs();
  const byS  = groupBy(data, 'supplier');
  const el   = document.getElementById('supplierCards');
  if (!el) return;

  const list = Object.entries(byS).map(([name, arr]) => {
    const fail  = arr.filter(r=>isFail(r)).length;
    const rate  = arr.length ? fail/arr.length : 0;
    const risk  = getRisk(rate);
    const qty   = arr.reduce((s,r)=>s+(Number(r.qty)||0), 0);
    const prods = [...new Set(arr.map(r=>r.productName).filter(Boolean))].slice(0,3).join('、');
    const last  = arr.map(r=>r.date).sort().reverse()[0]||'-';
    return { name, total:arr.length, fail, pass:arr.length-fail, rate, risk, qty, prods, last };
  }).sort((a,b)=>b.rate-a.rate);

  const RL = { low:'正常', mid:'风险', high:'高风险' };
  el.innerHTML = '<div class="supplier-grid">' + list.map(s => `
    <div class="supplier-card risk-${s.risk}">
      <span class="risk-badge ${s.risk}">${RL[s.risk]}</span>
      <div class="supplier-name">${s.name}</div>
      <div style="font-size:11px;color:var(--text-dim);margin-bottom:6px">${s.prods||'多品类'}</div>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);margin-bottom:8px">
        <span>来料 ${s.qty.toLocaleString()} 件</span>
        <span>最近: ${s.last}</span>
      </div>
      <div class="supplier-stats">
        <div class="stat-item"><div class="stat-num">${s.total}</div><div class="stat-lbl">验货批次</div></div>
        <div class="stat-item"><div class="stat-num" style="color:${s.fail>0?'var(--red)':'var(--green)'}">${s.fail}</div><div class="stat-lbl">FAIL批次</div></div>
        <div class="stat-item"><div class="stat-num" style="color:${s.risk==='high'?'var(--red)':s.risk==='mid'?'var(--yellow)':'var(--green)'}">${(s.rate*100).toFixed(0)}%</div><div class="stat-lbl">退货率</div></div>
      </div>
    </div>`).join('') + '</div>';
}

/* ════════════════════════════════════════
   §11  RECORDS TABLE
   固定表头 / 复选框 / 批量删除
════════════════════════════════════════ */

/* 当前已勾选的记录 ID 集合（筛选无关，始终用 id 定位） */
let _selectedIds = new Set();

function renderRecordsTable() { filterRecords(); }

function filterRecords() {
  try {
    const data   = recs();
    const search = (document.getElementById('searchInput')?.value || '').toLowerCase();
    const resF   = document.getElementById('filterResult')?.value || '';
    const dfrom  = document.getElementById('filterDateFrom')?.value || '';
    const dto    = document.getElementById('filterDateTo')?.value   || '';

    filteredRecs = data.filter(r => {
      if (search) {
        const haystack = [r.supplier, r.productNo, r.productName, r.client, r.defect]
          .filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      if (resF === 'PASS' && !isPass(r)) return false;
      if (resF === 'REJ'  && !isFail(r)) return false;
      if (dfrom && r.date < dfrom) return false;
      if (dto   && r.date > dto)   return false;
      return true;
    }).sort((a, b) => b.date.localeCompare(a.date));

    setText('recordCount', `共 ${filteredRecs.length} 条`);

    const wrap = document.getElementById('recordsTableWrap');
    if (!wrap) return;

    if (!filteredRecs.length) {
      _selectedIds.clear();
      _updateBatchBtn();
      wrap.innerHTML = '<div class="empty-state"><div class="empty-icon">☰</div>'
        + '<div class="empty-text">暂无记录</div>'
        + '<div class="empty-sub">点击右上角「+ 新增验货」添加数据</div></div>';
      return;
    }

    /* 过滤后清掉在当前结果集中不存在的选中 id */
    const visibleIds = new Set(filteredRecs.map(r => r.id));
    for (const id of [..._selectedIds]) {
      if (!visibleIds.has(id)) _selectedIds.delete(id);
    }

    wrap.innerHTML = `<table id="recordsTable" style="table-layout:fixed;width:100%">
      <colgroup>
        <col style="width:36px"/>   <!-- 复选框 -->
        <col style="width:44px"/>   <!-- # -->
        <col style="width:98px"/>   <!-- 来料日期 -->
        <col style="width:110px"/>  <!-- 供应商 -->
        <col style="width:80px"/>   <!-- 客户 -->
        <col style="width:92px"/>   <!-- 货号 -->
        <col style="width:auto"/>   <!-- 款式名称 -->
        <col style="width:60px"/>   <!-- 类型 -->
        <col style="width:86px"/>   <!-- 来料数 -->
        <col style="width:72px"/>   <!-- 抽查数 -->
        <col style="width:64px"/>   <!-- FAIL数 -->
        <col style="width:72px"/>   <!-- 不良率 -->
        <col style="width:150px"/>  <!-- 不良现象 -->
        <col style="width:62px"/>   <!-- 判定 -->
        <col style="width:68px"/>   <!-- 检验员 -->
        <col style="width:136px"/>  <!-- 操作 -->
      </colgroup>
      <thead><tr>
        <th class="col-check">
          <input type="checkbox" class="check-all" id="checkAll"
                 onchange="_onCheckAll(this)" title="全选/取消全选" />
        </th>
        <th style="text-align:right">#</th>
        <th style="text-align:left">来料日期</th>
        <th style="text-align:left">供应商</th>
        <th style="text-align:left">客户</th>
        <th style="text-align:left">货号</th>
        <th style="text-align:left">款式名称</th>
        <th style="text-align:center">类型</th>
        <th style="text-align:right">来料数</th>
        <th style="text-align:right">抽查数</th>
        <th style="text-align:right">FAIL数</th>
        <th style="text-align:right">不良率</th>
        <th style="text-align:left">不良现象</th>
        <th style="text-align:center">判定</th>
        <th style="text-align:center">检验员</th>
        <th style="text-align:center">操作</th>
      </tr></thead>
      <tbody>${filteredRecs.map(r => {
        const bc       = isPass(r) ? 'badge-pass' : isFail(r) ? 'badge-rej' : r.result==='COND' ? 'badge-cond' : 'badge-hold';
        const rt       = parseRate(r.defectRate) ?? 0;
        const checked  = _selectedIds.has(r.id) ? 'checked' : '';
        const selCls   = _selectedIds.has(r.id) ? 'row-selected' : '';
        return `<tr class="${selCls}" data-id="${r.id}">
          <td class="col-check">
            <input type="checkbox" class="row-check" ${checked}
                   onchange="_onRowCheck(this, ${r.id})" />
          </td>
          <td style="text-align:right;color:#3a4858">${r.id}</td>
          <td style="font-family:var(--font-mono);font-size:11px;white-space:nowrap">${r.date}</td>
          <td style="font-weight:500;color:#e8edf5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${r.supplier}">${r.supplier}</td>
          <td style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${r.client||''}">${r.client||'-'}</td>
          <td style="font-family:var(--font-mono);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${r.productNo||''}">${r.productNo||'-'}</td>
          <td style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.productName||''}">${r.productName||'-'}</td>
          <td style="text-align:center"><span class="badge ${r.type==='成品'?'badge-pass':'badge-hold'}">${r.type||'-'}</span></td>
          <td style="text-align:right;font-variant-numeric:tabular-nums">${(r.qty||0).toLocaleString()}</td>
          <td style="text-align:right;font-variant-numeric:tabular-nums">${r.sampleQty != null ? r.sampleQty : '<span style="color:var(--text-muted)">—</span>'}</td>
          <td style="text-align:right;font-variant-numeric:tabular-nums;color:${(r.fail||0)>0?'var(--red)':'var(--text-dim)'}">${r.fail||0}</td>
          <td style="text-align:right;font-weight:600;color:${rt>=20?'var(--red)':rt>=5?'var(--yellow)':'var(--green)'}">${r.sampleQty != null ? (r.defectRate||'0.00%') : '<span style="color:var(--text-muted);font-weight:400">—</span>'}</td>
          <td style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px"
              title="${r.defect||''}">${r.defect||'-'}</td>
          <td style="text-align:center"><span class="badge ${bc}">${r.result}</span></td>
          <td style="text-align:center">${r.qc||'-'}</td>
          <td style="text-align:center">
            <button class="action-btn" onclick="openEditModal(${r.id})">编辑</button>
            <button class="action-btn del" onclick="deleteRecord(${r.id})">删除</button>
            <button class="action-btn iqc" onclick="exportIQCReport(${r.id})" title="导出IQC检验报告">IQC</button>
          </td>
        </tr>`;
      }).join('')}</tbody></table>`;

    _syncCheckAllState();
    _updateBatchBtn();
  } catch(e) { console.error('[filterRecords]', e); }
}

/* ── 全选 checkbox 变化 ── */
function _onCheckAll(el) {
  const checked = el.checked;
  filteredRecs.forEach(r => {
    if (checked) _selectedIds.add(r.id);
    else         _selectedIds.delete(r.id);
  });
  /* 同步所有行的视觉状态 */
  document.querySelectorAll('#recordsTable .row-check').forEach(cb => {
    cb.checked = checked;
  });
  document.querySelectorAll('#recordsTable tbody tr').forEach(tr => {
    tr.classList.toggle('row-selected', checked);
  });
  _updateBatchBtn();
}

/* ── 单行 checkbox 变化 ── */
function _onRowCheck(el, id) {
  if (el.checked) _selectedIds.add(id);
  else            _selectedIds.delete(id);
  /* 更新行背景 */
  const tr = el.closest('tr');
  if (tr) tr.classList.toggle('row-selected', el.checked);
  _syncCheckAllState();
  _updateBatchBtn();
}

/* ── 同步全选 checkbox 的视觉状态（全选/半选/未选） ── */
function _syncCheckAllState() {
  const ca = document.getElementById('checkAll');
  if (!ca) return;
  const total    = filteredRecs.length;
  const selCount = filteredRecs.filter(r => _selectedIds.has(r.id)).length;
  if (selCount === 0) {
    ca.checked = false;
    ca.classList.remove('indeterminate');
  } else if (selCount === total) {
    ca.checked = true;
    ca.classList.remove('indeterminate');
  } else {
    ca.checked = false;
    ca.classList.add('indeterminate');
  }
}

/* ── 更新批量删除按钮和已选计数提示 ── */
function _updateBatchBtn() {
  const btn       = document.getElementById('btnBatchDel');
  const countEl   = document.getElementById('selectedCount');
  const selCount  = _selectedIds.size;

  if (btn) btn.disabled = selCount === 0;

  if (countEl) {
    if (selCount > 0) {
      countEl.style.display = '';
      countEl.textContent   = `已选 ${selCount} 条`;
    } else {
      countEl.style.display = 'none';
    }
  }
}

/* ── 批量删除 ── */
function batchDelete() {
  if (!can('batchDelete')) { showToast('当前账号无权限执行此操作', 'error'); return; }
  const selCount = _selectedIds.size;
  if (selCount === 0) {
    showToast('请先勾选要删除的记录', 'info');
    return;
  }

  /* 二次确认 */
  if (!confirm(`确认删除已选择的 ${selCount} 条记录？此操作不可撤销。`)) return;

  /* 按 id 删除，与筛选/排序状态无关 */
  const idsToDelete = new Set(_selectedIds);
  state.records = state.records.filter(r => !idsToDelete.has(r.id));
  persist();

  /* 清空选中状态 */
  _selectedIds.clear();

  showToast(`✓ 已删除 ${selCount} 条记录`, 'success');

  /* 刷新所有相关视图 */
  filterRecords();
  updateTopKpis();
  if (currentPage === 'dashboard')  renderDashboard();
  if (currentPage === 'analysis')   renderAnalysis();
  if (currentPage === 'suppliers')  renderSuppliers();
}

/* ════════════════════════════════════════
   §12  MODAL (新增 / 编辑)
════════════════════════════════════════ */
/* ════════════════════════════════════════
   §10.5  供应商 datalist + 批量录入
════════════════════════════════════════ */

/* 默认供应商列表 */
const DEFAULT_SUPPLIERS = [
  '天一','顺景','邵阳厂','邵阳兴信','嘉乐','泰业','美福','华升','瑞升',
  '金麒麟','丰业','方升','鑫鸿','新万利','优可','德雅欣','兴荣','浩鑫',
];

/* ── AQL 判定函数 ──────────────────────────────────────
   与 report_export.js 的 IQC_AQL_TABLE 保持完全一致
   参数：
     qty       — 来料总数量（用于确定 LOT SIZE 区间）
     sampleQty — 抽查数量
     failQty   — FAIL 数量
   返回：'PASS' | 'REJ'

   判定依据：FUNC / 功能 MAJ 0.65 列（m065，Ac 值）
   ┌──────────────┬──────┬────────────────┐
   │ LOT SIZE     │Sample│ m065 AC / RE   │
   ├──────────────┼──────┼────────────────┤
   │ 1–50         │  20  │  0 /  1        │
   │ 51–280       │  32  │  1 /  2        │←fail=1→PASS; fail=2→REJ
   │ 281–500      │  50  │  1 /  2        │
   │ 501–1200     │  80  │  2 /  3        │
   │ 1201–3200    │ 125  │  3 /  4        │
   │ 3201–10000   │ 200  │  5 /  6        │
   │ 10001–35000  │ 315  │  7 /  8        │
   │ 35001–150000 │ 500  │ 10 / 11        │
   └──────────────┴──────┴────────────────┘
   fail <= AC(m065) → PASS
   fail >= RE(= AC + 1) → REJ
───────────────────────────────────────────────────── */
const _APP_AQL_TABLE = [
  { rangeMax:50,     m065:0  },
  { rangeMax:280,    m065:1  },
  { rangeMax:500,    m065:1  },
  { rangeMax:1200,   m065:2  },
  { rangeMax:3200,   m065:3  },
  { rangeMax:10000,  m065:5  },
  { rangeMax:35000,  m065:7  },
  { rangeMax:999999, m065:10 },
];

function aqlJudge(qty, sampleQty, failQty) {
  const n = Number(failQty) || 0;
  if (n === 0) return 'PASS';                      /* 0 不良直接 PASS */
  const lotQty = Number(qty) || 0;
  const row = _APP_AQL_TABLE.find(r => lotQty <= r.rangeMax)
           || _APP_AQL_TABLE[_APP_AQL_TABLE.length - 1];
  /* AC = row.m065；RE = AC + 1 */
  return n <= row.m065 ? 'PASS' : 'REJ';
}

/* 生成供应商选项（历史数据 + 默认列表去重排序） */
function getSupplierOptions() {
  const fromData = recs().map(r => r.supplier).filter(Boolean);
  return [...new Set([...DEFAULT_SUPPLIERS, ...fromData])].sort();
}

/* 渲染 datalist */
function renderSupplierDatalist() {
  const list = document.getElementById('supplierList');
  if (!list) return;
  list.innerHTML = getSupplierOptions()
    .map(n => `<option value="${n}"></option>`).join('');
}

/* ── 客户 datalist ── */
const DEFAULT_CUSTOMERS = [
  'ZURU(内)','ZURU(外)','ZURU',
  'Jazwares（内）','Jazwares（外）',
  'MAXX（内）','MAXX（外）',
  'Jakks（内）','Jakks（外）',
  'JP（内）','JP（外）',
  'Goliath','LEKIA','KMART','TigerHead','THT',
];

function getCustomerOptions() {
  const fromData = recs().map(r => r.client).filter(Boolean);
  return [...new Set([...DEFAULT_CUSTOMERS, ...fromData])].sort();
}

function renderCustomerDatalist() {
  const list = document.getElementById('customerList');
  if (!list) return;
  list.innerHTML = getCustomerOptions()
    .map(n => `<option value="${n}"></option>`).join('');
}

/* 模式切换（单条 / 批量） */

/* ════════════════════════════════════════
   §OCR  图片识别录入（Tesseract.js）
════════════════════════════════════════ */

let _ocrImageFile = null;
let _ocrWorkerBusy = false;

/* 初始化上传区域：点击/拖拽绑定 */
function initOcrUpload() {
  const zone  = document.getElementById('ocrDropZone');
  const input = document.getElementById('ocrImageInput');
  if (!zone || !input) return;
  if (zone.dataset.bound) return;
  zone.dataset.bound = '1';

  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    if (input.files && input.files[0]) handleOcrFile(input.files[0]);
  });

  ['dragover','dragleave','drop'].forEach(evt => {
    zone.addEventListener(evt, e => { e.preventDefault(); e.stopPropagation(); });
  });
  zone.addEventListener('dragover', () => zone.classList.add('drag-over'));
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    zone.classList.remove('drag-over');
    const file = e.dataTransfer?.files?.[0];
    if (file) handleOcrFile(file);
  });
}

/* 处理选中/拖入的图片文件 */
function handleOcrFile(file) {
  if (!file) return;
  const validTypes = ['image/jpeg','image/jpg','image/png','image/webp'];
  if (!validTypes.includes(file.type)) {
    showToast('图片格式不支持，请上传 jpg / png / webp', 'error');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showToast('图片过大，请上传小于 10MB 的图片', 'error');
    return;
  }
  _ocrImageFile = file;
  const reader = new FileReader();
  reader.onload = e => {
    const img = document.getElementById('ocrPreview');
    const hint = document.querySelector('#ocrDropZone .ocr-drop-hint');
    if (img) { img.src = e.target.result; img.style.display = ''; }
    if (hint) hint.style.display = 'none';
  };
  reader.readAsDataURL(file);
  setText('ocrStatus', '图片已上传，点击"开始识别"');
}

/* 清空图片和识别结果 */
function clearOcr() {
  _ocrImageFile = null;
  const img   = document.getElementById('ocrPreview');
  const hint  = document.querySelector('#ocrDropZone .ocr-drop-hint');
  const input = document.getElementById('ocrImageInput');
  if (img)   { img.src = ''; img.style.display = 'none'; }
  if (hint)  hint.style.display = '';
  if (input) input.value = '';
  setVal('ocrRawText', '');
  ['ocrDate','ocrInspDate','ocrSupplier','ocrClient','ocrProductNo',
   'ocrProductName','ocrDeliveryNo','ocrQty','ocrType','ocrRemark']
    .forEach(id => setVal(id, ''));
  setText('ocrStatus', '未上传图片');
}


/* ── 图片预处理：放大2倍+灰度+对比度增强，提高OCR准确率 ── */
function preprocessImageForOcr(file) {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        try {
          const scale = 2;
          const canvas = document.createElement('canvas');
          canvas.width  = img.width  * scale;
          canvas.height = img.height * scale;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

          /* 灰度 + 对比度增强（简单线性拉伸）*/
          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const d = imgData.data;
          const contrast = 1.6;     /* 对比度系数 */
          const mid = 128;
          for (let i = 0; i < d.length; i += 4) {
            const gray = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
            let v = (gray - mid) * contrast + mid;
            v = Math.max(0, Math.min(255, v));
            d[i] = d[i+1] = d[i+2] = v;
          }
          ctx.putImageData(imgData, 0, 0);
          URL.revokeObjectURL(url);
          canvasToBlob(canvas).then(blob => resolve(blob || file)).catch(() => resolve(file));
        } catch (e) {
          URL.revokeObjectURL(url);
          resolve(file); /* 预处理失败回退原图 */
        }
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    } catch (e) {
      resolve(file);
    }
  });
}

/* canvas → blob（PNG）*/
function canvasToBlob(canvas) {
  return new Promise((resolve) => {
    if (canvas.toBlob) {
      canvas.toBlob(blob => resolve(blob), 'image/png');
    } else {
      resolve(null);
    }
  });
}

/* 开始 OCR 识别 */
async function startOcr() {
  if (!_ocrImageFile) {
    showToast('请先上传图片', 'error');
    return;
  }
  if (typeof Tesseract === 'undefined') {
    showToast('OCR 引擎未加载成功，请检查网络后重试', 'error');
    return;
  }
  if (_ocrWorkerBusy) return;
  _ocrWorkerBusy = true;
  setText('ocrStatus', '正在识别，请稍候...');
  const btn = document.getElementById('btnStartOcr');
  if (btn) btn.disabled = true;

  try {
    /* 图片预处理：放大2倍+灰度+对比度增强，提高识别准确率（不改变预览，只改变OCR输入）*/
    const ocrInput = await preprocessImageForOcr(_ocrImageFile);
    const result = await Tesseract.recognize(ocrInput, 'chi_sim+eng', {
      logger: () => {} /* 静默，不输出进度日志 */
    });
    const text = (result?.data?.text || '').trim();
    if (!text) {
      setText('ocrStatus', '识别失败，请重新上传清晰图片');
      showToast('未识别到文字，请上传更清晰的图片', 'error');
    } else {
      setVal('ocrRawText', text);
      extractFieldsFromOcrText(text);
      setText('ocrStatus', '识别完成');
      showToast('✓ 识别完成，请核对字段', 'success');
    }
  } catch (err) {
    console.error('[OCR]', err);
    setText('ocrStatus', '识别失败，请重新上传清晰图片');
    showToast('识别失败：' + (err.message || '未知错误'), 'error');
  } finally {
    _ocrWorkerBusy = false;
    if (btn) btn.disabled = false;
  }
}

/* 日期归一化：支持多种格式，含OCR噪声变体（"号"可能被识别为其它符号）*/
function normalizeOcrDate(text) {
  if (!text) return '';
  /* 支持：2026-06-08 / 2026/06/08 / 2026.06.08 / 2026年6月3日 /
     2026 年 6 月 3 / 2026年6月9号 ，年月日之间允许空格、逗号噪声；
     日/号 之后允许任意1个噪声符号（OCR误识别）*/
  const m = text.match(/(\d{4})\s*[-\/.年]\s*(\d{1,2})\s*[-\/.月]\s*(\d{1,2})\s*(?:[日号]|[^\d]){0,1}/);
  if (!m) return '';
  const [, y, mo, d] = m;
  return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

/* 在"日期"关键词所在行查找日期；如果该行本身没有日期数字，
   尝试该行之后最近的1~2行（OCR表格常把"日期："和日期值分行）。
   找不到则返回空，避免把 PO# 或客户单号里的数字误识别为日期 */
function findDateNearKeyword(text) {
  const lines = text.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    if (/日期|Date/.test(lines[i])) {
      let d = normalizeOcrDate(lines[i]);
      if (d) return d;
      /* 同行没有数字，向后找最多2行 */
      for (let j = i + 1; j <= i + 2 && j < lines.length; j++) {
        d = normalizeOcrDate(lines[j]);
        if (d) return d;
      }
    }
  }
  return '';
}

/* 数字归一化：去除逗号、空格 */
function normalizeOcrNumber(text) {
  if (!text) return '';
  const m = text.match(/[\d,，]+/);
  if (!m) return '';
  return m[0].replace(/[,，]/g, '');
}

/* 从 OCR 文本提取字段 */

/* 截断关键词：客户/供应商等字段提取时，遇到这些词即截断 */
const _OCR_CUTOFF_KEYWORDS = [
  '送货电话','联系电话','电话','地址','客户单号','客户订单','我司PO','PO',
  '日期','发货人','收货','备注','数量','备品','货物名称','品名','物料名称','送货单号',
];

/* 清理提取到的值：去除冒号/空格/标点/OCR噪声尾字符 */
function cleanOcrValue(value) {
  if (!value) return '';
  let v = value;
  /* 去除前导冒号、空格、全角空格 */
  v = v.replace(/^[：:\s　,，]+/, '');
  /* 去除尾部常见OCR噪声字符 */
  v = v.replace(/[|。，,、\s　]+$/, '');
  v = v.replace(/[四回曰日]+$/, '');  /* 常见OCR误识别尾字符 */
  return v.trim();
}

/* 在截断关键词处切断字符串，返回关键词之前的部分 */
function cutAtKeywords(value, keywords) {
  if (!value) return '';
  let cutIdx = value.length;
  for (const kw of keywords) {
    const idx = value.indexOf(kw);
    if (idx >= 0 && idx < cutIdx) cutIdx = idx;
  }
  return value.slice(0, cutIdx);
}

/* 清洗公司名：截取到"有限公司"为止，去除首尾OCR噪声字符 */
function cleanCompanyName(value) {
  if (!value) return '';
  let v = value;
  /* 如果包含"有限公司"，截取到该位置（含）为止 */
  const idx = v.indexOf('有限公司');
  if (idx >= 0) v = v.slice(0, idx + 4);
  /* 去除开头非中文/英文/数字字符（如 | ！，。）*/
  v = v.replace(/^[^\u4e00-\u9fa5A-Za-z0-9]+/, '');
  /* 去除结尾单独的 e / Te / SEE 等英文噪声及符号 */
  v = v.replace(/[\s]*(e|Te|SEE|TEE)$/i, '');
  v = v.replace(/[|！，。\s　]+$/, '');
  return v.trim();
}

/* 判断是否像手机号（11位数字，1开头）*/
function isPhoneNumberLike(value) {
  if (!value) return false;
  const digits = value.replace(/\D/g, '');
  return /^1\d{10}$/.test(digits);
}

/* 从前5行中提取公司名候选（含"有限公司/公司/制品"的最长行）*/
function extractCompanyFromTopLines(lines) {
  const top = lines.slice(0, 5);
  let best = '';
  for (const line of top) {
    if (/有限公司|公司|制品/.test(line)) {
      const cleaned = cleanOcrValue(cutAtKeywords(line, _OCR_CUTOFF_KEYWORDS));
      if (cleaned.length > best.length) best = cleaned;
    }
  }
  return best;
}

/* 货号 OCR 纠错：修正常见误识别（o/O/0混淆、缺字母等）
   oo01-EV / 0001-EV / B0001-EV / XBO001-EVA → XB0001-EVA（针对当前样例模式）*/
function fixProductNoOcr(raw) {
  if (!raw) return raw;
  let v = raw;
  /* 统一大小写：x→X */
  v = v.replace(/^x/, 'X');
  v = v.replace(/([A-Za-z0-9]*)-([A-Za-z0-9]+)/, (full, codePart, suffix) => {
    /* codePart 可能是: oo01 / 0001 / B0001 / XBO001 / XB0001 */
    /* 1. 提取末尾连续的数字+字母混合（O/o视为0），分离出字母前缀和数字部分 */
    let s2 = codePart.replace(/[Oo]/g, '0');     /* O/o → 0 */
    /* 2. 去掉数字部分前的 B（OCR把0误识别为B的情况）*/
    s2 = s2.replace(/B(\d)/gi, '0$1');
    /* 3. 拆出字母前缀（开头连续字母）和数字尾部 */
    const m = s2.match(/^([A-Za-z]*)(\d+)$/);
    let prefix = '', digits = s2;
    if (m) { prefix = m[1]; digits = m[2]; }
    /* 4. 数字部分补齐到4位 */
    digits = digits.padStart(4, '0').slice(-4);
    /* 5. 前缀缺失或不是 XB，统一补为 XB */
    if (prefix.toUpperCase() !== 'XB') prefix = 'XB';
    /* 6. 后缀 EV → EVA */
    let s = suffix;
    if (/^EV$/i.test(s)) s = 'EVA';
    return `${prefix}${digits}-${s.toUpperCase()}`;
  });
  return v;
}

/* 从明细行提取第一条物料：货号 + 物料名称 + 数量
   示例: XB0001-EVA 珠蓝色 | 15000PCS | PCS | 20*750pcs
   也兼容OCR误识别: oo01-EV 珠蓝色 15OOOPCS */
function extractFirstItemLine(lines) {
  /* 货号模式：宽松匹配，允许 0/O/B 混淆字符 */
  const codeRe = /([A-Za-z]{0,4}[0-9OoB]{2,6}-[A-Za-z0-9]{2,4})/;
  for (const line of lines) {
    /* 排除明显是手机号、客户单号等纯数字长串的行 */
    if (/^\s*1\d{10}\s*$/.test(line)) continue;
    const m = line.match(codeRe);
    if (m) {
      const productNo = fixProductNoOcr(m[1]);
      /* 货号之后的中文/英文名称（到下一个数字或竖线为止）*/
      const afterCode = line.slice(m.index + m[0].length);
      const nameMatch = afterCode.match(/^[\s|｜]*([\u4e00-\u9fa5A-Za-z]+)/);
      const productName = nameMatch ? cleanOcrValue(nameMatch[1]) : '';
      /* 数量：行内第一个 数字+PCS/Pcs/pcs/件/个/只，数字中 O/o 误识别为 0 */
      const qtyMatch = line.match(/([\d,，OoO]+)\s*(PCS|Pcs|pcs|件|个|只)/);
      let qty = '';
      if (qtyMatch) {
        qty = normalizeOcrNumber(qtyMatch[1].replace(/[Oo]/g, '0'));
      }
      return { productNo, productName, qty };
    }
  }
  return null;
}

function extractFieldsFromOcrText(text) {
  if (!text) return;
  const lines = text.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);

  /* ── 来货日期：只在"日期"关键词行查找；不自动填检验日期 ──
     检验日期由用户手动填写，本函数不写 ocrInspDate */
  const dateStr = findDateNearKeyword(text);
  if (dateStr) {
    setVal('ocrDate', dateStr);
  }

  /* 通用：按关键词查找，找到后用截断关键词切断 + 清理 */
  function findByKeywords(keywords, cutoffKeywords) {
    for (const kw of keywords) {
      for (const line of lines) {
        const idx = line.indexOf(kw);
        if (idx >= 0) {
          let rest = line.slice(idx + kw.length);
          if (cutoffKeywords) rest = cutAtKeywords(rest, cutoffKeywords);
          rest = cleanOcrValue(rest);
          if (rest) return rest;
        }
      }
    }
    return '';
  }

  /* ── 供应商：优先关键词，否则从顶部公司名提取；统一用 cleanCompanyName 清洗 ── */
  let supplier = findByKeywords(['供应商','供货商','送货单位','发货单位','Vendor','Supplier'], _OCR_CUTOFF_KEYWORDS);
  if (!supplier) supplier = extractCompanyFromTopLines(lines);
  supplier = cleanCompanyName(supplier);
  if (supplier) setVal('ocrSupplier', supplier);

  /* ── 客户：本轮不自动识别，保持空白，由人工填写或后续货号资料库带出 ── */
  /* （不调用 findByKeywords 提取客户，ocrClient 留空）*/

  /* ── 货号 / 物料名称 / 数量：先尝试关键词，否则从明细行提取 ── */
  let productNo   = findByKeywords(['货号','产品编号','物料编号','料号','Item No','Part No','Product No'], _OCR_CUTOFF_KEYWORDS);
  let productName = findByKeywords(['物料名称','产品名称','品名','货品名称','Description','Item Name'], _OCR_CUTOFF_KEYWORDS);
  let qty         = normalizeOcrNumber(findByKeywords(['来货数量','送货数量','数量','Qty','Quantity'], _OCR_CUTOFF_KEYWORDS));

  /* 关键词提取到的数量若是手机号，丢弃重新走明细行提取 */
  if (qty && isPhoneNumberLike(qty)) qty = '';

  if (!productNo || !qty || !productName) {
    const item = extractFirstItemLine(lines);
    if (item) {
      if (!productNo   && item.productNo)   productNo   = item.productNo;
      if (!productName && item.productName) productName = item.productName;
      if (!qty         && item.qty)         qty         = item.qty;
    }
  }
  if (productNo)   setVal('ocrProductNo', productNo);
  if (productName) setVal('ocrProductName', productName);
  if (qty)         setVal('ocrQty', qty);

  /* ── 送货单号：优先送货单号，其次客户单号；排除手机号 ── */
  let deliveryNo = findByKeywords(['送货单号','送货编号','送货单','单号','Delivery No','DN No'], _OCR_CUTOFF_KEYWORDS);
  if (!deliveryNo) deliveryNo = findByKeywords(['客户单号','客户订单'], _OCR_CUTOFF_KEYWORDS);
  if (deliveryNo && !isPhoneNumberLike(deliveryNo)) setVal('ocrDeliveryNo', deliveryNo);

  /* 类型：文本包含"来料/原料/物料/配件/包材"，或已识别到货号+数量+PCS的送货单明细，则设为"来料" */
  if (/来料|原料|物料|配件|包材/.test(text) || (productNo && qty)) {
    setVal('ocrType', '来料');
  }
}

/* 应用 OCR 字段到单条录入表单 */
function applyOcrToForm() {
  const ocrDate        = document.getElementById('ocrDate')?.value || '';
  const ocrSupplier    = document.getElementById('ocrSupplier')?.value || '';
  const ocrProductNo   = document.getElementById('ocrProductNo')?.value || '';
  const ocrProductName = document.getElementById('ocrProductName')?.value || '';
  const ocrDeliveryNo  = document.getElementById('ocrDeliveryNo')?.value || '';
  const ocrQty         = document.getElementById('ocrQty')?.value || '';
  const ocrType        = document.getElementById('ocrType')?.value || '';
  const ocrRemark      = document.getElementById('ocrRemark')?.value || '';
  /* f_client、f_inspDate 不写入，由用户手动填写 */

  if (ocrDate)        setVal('f_date', ocrDate);
  if (ocrSupplier)    setVal('f_supplier', ocrSupplier);
  if (ocrProductNo)   setVal('f_productNo', ocrProductNo);
  if (ocrProductName) setVal('f_productName', ocrProductName);
  if (ocrDeliveryNo)  setVal('f_deliveryNo', ocrDeliveryNo);
  if (ocrQty)         setVal('f_qty', ocrQty);
  if (ocrType)        setVal('f_type', ocrType);
  if (ocrRemark)      setVal('f_remark', ocrRemark);

  /* 切换到单条录入 */
  switchModalMode('single');

  /* 联动：数量触发 AQL 抽样计算，货号触发产品名称联动 */
  if (ocrQty)       onQtyChange();
  if (ocrProductNo) onProductNoChange();

  showToast('已将识别结果应用到单条录入，请确认后保存', 'success');
}

function switchModalMode(mode) {
  const isBatch = mode === 'batch';
  const panelS  = document.getElementById('panelSingle');
  const panelB  = document.getElementById('panelBatch');
  const tabS    = document.getElementById('tabSingle');
  const tabB    = document.getElementById('tabBatch');

  /* 明确用 flex/none，不用 '' 避免回退歧义 */
  if (panelS) panelS.style.display = isBatch ? 'none' : 'flex';
  if (panelB) panelB.style.display = isBatch ? 'flex' : 'none';
  if (tabS)   tabS.classList.toggle('active', !isBatch);
  if (tabB)   tabB.classList.toggle('active',  isBatch);

  /* 切到图片识别 tab 时初始化上传区域绑定（首次绑定后不重复）*/
  if (isBatch) initOcrUpload();
}

/* 重置批量面板 */
function _resetBatch() {
  const ta = document.getElementById('batchInput');
  if (ta) ta.value = '';
  setText('batchStatus', '');
  const wrap = document.getElementById('batchPreviewWrap');
  if (wrap) wrap.style.display = 'none';
  const err = document.getElementById('batchErrors');
  if (err) err.style.display = 'none';
  const btn = document.getElementById('btnBatchConfirm');
  if (btn) btn.disabled = true;
  _batchRows = [];
}

/* 当前已解析的批量行（暂存） */
let _batchRows = [];

/* ── 批量解析函数 ── */
function parseBatchInput(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  const rows = [], errors = [];
  const today = todayStr();

  lines.forEach((line, idx) => {
    const delim = line.includes('\t') ? '\t' : ',';
    const cols  = line.split(delim).map(s => s.trim());

    if (cols.length < 10) {
      errors.push(`第 ${idx + 1} 行字段不足（${cols.length}/10），请检查`);
      return;
    }

    const [supplier, client, productNo, productName, type,
           inQty, smpQty, failQty, defect, qc] = cols;

    /* 不良现象解析（复用已有函数） */
    const defItems   = typeof parseDefectItems === 'function' ? parseDefectItems(defect) : [];
    const parsedFail = defItems.reduce((s, d) => s + (d.qty || 0), 0);
    const finalFail  = parsedFail > 0 ? parsedFail : (parseInt(failQty) || 0);
    const smpNum     = parseInt(smpQty) || 0;
    const qtyNum     = parseInt(inQty)  || 0;
    const passNum    = Math.max(0, smpNum - finalFail);

    /* 不良率 */
    const base = passNum + finalFail || smpNum;
    const rate = base > 0 ? (finalFail / base * 100).toFixed(2) + '%' : '0.00%';

    /* 判定：复用 AQL 逻辑（MAJ 0.65，AC/RE 标准），与单条录入一致 */
    const result = aqlJudge(qtyNum, smpNum, finalFail);

    if (!supplier) { errors.push(`第 ${idx + 1} 行"供应商"为空`); return; }
    if (!qtyNum)   { errors.push(`第 ${idx + 1} 行"来料数量"无效`); return; }

    rows.push({
      date: today, inspDate: today,
      supplier, client, productNo, productName,
      deliveryNo: '',
      type: type || '成品',
      qty: qtyNum,
      sampleQty: smpNum || null,
      pass: passNum, fail: finalFail,
      defectRate: rate, result,
      defect, qc, remark: '',
    });
  });

  return { rows, errors };
}

/* ── 解析预览 ── */
function parseBatchPreview() {
  const text = document.getElementById('batchInput')?.value || '';
  const { rows, errors } = parseBatchInput(text);
  _batchRows = rows;

  const statusEl = document.getElementById('batchStatus');
  const errEl    = document.getElementById('batchErrors');
  const wrapEl   = document.getElementById('batchPreviewWrap');
  const btn      = document.getElementById('btnBatchConfirm');

  /* 显示错误 */
  if (errors.length) {
    errEl.innerHTML = '<b>以下数据有问题：</b><br/>' + errors.map(e => `<span>• ${e}</span>`).join('<br/>');
    errEl.style.display = '';
  } else {
    errEl.style.display = 'none';
  }

  if (rows.length === 0) {
    statusEl.textContent = '未解析到有效数据';
    statusEl.style.color = 'var(--red)';
    wrapEl.style.display = 'none';
    btn.disabled = true;
    return;
  }

  statusEl.textContent = `解析成功 ${rows.length} 条`;
  statusEl.style.color = 'var(--green)';
  btn.disabled = false;

  /* 构建预览表 */
  const COLS = ['供应商','客户','货号','款式','类型','来料数','抽查数','FAIL','不良率','判定','不良现象','检验员'];
  const tbody = rows.map(r => `<tr>
    <td>${r.supplier}</td><td>${r.client||'-'}</td><td>${r.productNo||'-'}</td>
    <td>${r.productName||'-'}</td><td>${r.type}</td>
    <td>${r.qty}</td><td>${r.sampleQty??'-'}</td>
    <td style="color:${r.fail>0?'var(--red)':'var(--green)'}">${r.fail}</td>
    <td>${r.defectRate}</td>
    <td><span class="badge badge-${r.result==='PASS'?'pass':'rej'}">${r.result}</span></td>
    <td style="max-width:120px;overflow:hidden;text-overflow:ellipsis" title="${r.defect||''}">${r.defect||'-'}</td>
    <td>${r.qc||'-'}</td>
  </tr>`).join('');

  document.getElementById('batchPreviewTable').innerHTML =
    `<thead><tr>${COLS.map(c=>`<th>${c}</th>`).join('')}</tr></thead><tbody>${tbody}</tbody>`;
  wrapEl.style.display = '';
}

/* ── 确认批量导入 ── */
function confirmBatchImport() {
  if (!_batchRows.length) { showToast('请先解析预览', 'error'); return; }

  _batchRows.forEach(r => {
    r.id = state.nextId++;
    state.records.push(r);
  });
  persist();

  const n = _batchRows.length;
  _batchRows = [];
  closeModalDirect();
  showToast(`✓ 成功导入 ${n} 条验货记录`, 'success');

  /* 刷新所有相关视图 */
  renderRecordsTable();
  updateTopKpis();
  if (currentPage === 'dashboard')  renderDashboard();
  if (currentPage === 'analysis')   renderAnalysis();
  if (currentPage === 'suppliers')  renderSuppliers();
  renderSupplierDatalist();
}

/* ── 运行时确保模式标签存在并位于 modal-header 之后 ── */
function ensureModalTabs() {
  let tabs = document.getElementById('modalModeTabs');

  if (!tabs) {
    /* 动态创建 */
    tabs = document.createElement('div');
    tabs.id = 'modalModeTabs';
    tabs.className = 'modal-mode-tabs';
  }

  /* 重写内容，确保按钮和事件绑定正确 */
  tabs.innerHTML =
    '<button type="button" id="tabSingle" class="mode-tab active">单条录入</button>' +
    '<button type="button" id="tabBatch"  class="mode-tab">批量录入</button>';

  /* 强制插入到 .modal-header 之后 */
  const header = document.querySelector('#modal .modal-header');
  if (header && header.nextElementSibling !== tabs) {
    header.insertAdjacentElement('afterend', tabs);
  }

  /* 强制可见 */
  tabs.style.cssText +=
    ';display:flex!important;visibility:visible!important;opacity:1!important' +
    ';min-height:46px!important;flex-shrink:0!important;z-index:20';

  /* 绑定点击 */
  const ts = document.getElementById('tabSingle');
  const tb = document.getElementById('tabBatch');
  if (ts) ts.onclick = () => switchModalMode('single');
  if (tb) tb.onclick = () => switchModalMode('batch');
}

/* ── 运行时确保批量面板存在并位于 panelSingle 之后 ── */
function ensurePanelBatch() {
  let pb = document.getElementById('panelBatch');

  if (!pb) {
    pb = document.createElement('div');
    pb.id = 'panelBatch';
    pb.innerHTML =
      '<div class="modal-body">' +
        '<div class="batch-hint">' +
          '<span class="batch-hint-icon">ℹ</span>' +
          '<span><b>批量录入格式说明</b><br/>请从 Excel 复制多行数据粘贴，字段顺序：<br/>' +
          '<b>供应商、客户、货号、款式名称、类型、来料数量、抽查数量、FAIL数量、不良现象、检验员</b><br/>' +
          '日期默认今日；FAIL数量可从不良现象中自动解析（如"眼贴歪6个"）。</span>' +
        '</div>' +
        '<textarea id="batchInput" class="batch-textarea"' +
          ' placeholder="天一\tZURU(外)\t15782\t绿色熊\t成品\t200\t32\t16\t眼贴歪6个，牙齿歪10个\t李燕娜"></textarea>' +
        '<div style="display:flex;gap:8px;margin-top:10px;align-items:center">' +
          '<button type="button" id="btnBatchPreview" class="btn-secondary">🔍 解析预览</button>' +
          '<span id="batchStatus" class="batch-status"></span>' +
        '</div>' +
        '<div id="batchErrors" class="batch-errors" style="display:none"></div>' +
        '<div id="batchPreviewWrap" style="display:none;margin-top:10px;max-height:220px;overflow:auto">' +
          '<table id="batchPreviewTable" class="batch-preview-table"></table>' +
        '</div>' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button type="button" class="btn-secondary" onclick="closeModalDirect()">取消</button>' +
        '<button type="button" id="btnBatchConfirm" class="btn-primary" disabled>✓ 确认导入</button>' +
      '</div>';
  }

  /* 插入到 panelSingle 之后 */
  const ps = document.getElementById('panelSingle');
  if (ps && ps.nextElementSibling !== pb) {
    ps.insertAdjacentElement('afterend', pb);
  }

  /* 绑定按钮 */
  const bp = document.getElementById('btnBatchPreview');
  const bc = document.getElementById('btnBatchConfirm');
  if (bp) bp.onclick = parseBatchPreview;
  if (bc) bc.onclick = confirmBatchImport;
}


function openAddModal() {
  if (!can('createRecord')) { showToast('当前账号无权限执行此操作', 'error'); return; }
  editingId = null;
  setText('modalTitle', '新增验货记录');

  /* 先显示弹窗，确保 DOM 可见后再操作布局 */
  const overlay = document.getElementById('modalOverlay');
  if (overlay) overlay.classList.add('show');

  /* 运行时注入/定位标签栏和批量面板 */
  ensureModalTabs();
  ensurePanelBatch();

  /* 确认标签栏可见 */
  const tabs = document.getElementById('modalModeTabs');
  if (tabs) { tabs.style.display = 'flex'; tabs.style.visibility = 'visible'; }

  /* 切换到单条录入 */
  switchModalMode('single');

  /* 初始化表单 */
  clearForm();
  const dateEl     = document.getElementById('f_date');
  const inspDateEl = document.getElementById('f_inspDate');
  if (dateEl)     dateEl.value     = todayStr();
  if (inspDateEl) inspDateEl.value = todayStr();
  renderSupplierDatalist();
  renderCustomerDatalist();
  renderInspectorDatalist();
  initDefectLib();
  refreshDefectDescDatalist();
  initOcrUpload();
}

function openEditModal(id) {
  if (!can('editRecord')) { showToast('当前账号无权限执行此操作', 'error'); return; }
  const r = recs().find(x => x.id === id);
  if (!r) return;
  editingId = id;
  setText('modalTitle', '编辑验货记录');
  /* 编辑时隐藏模式切换，始终显示单条面板 */
  const tabs = document.getElementById('modalModeTabs');
  if (tabs) tabs.style.display = 'none';
  switchModalMode('single');
  setVal('f_date',        r.date || '');
  setVal('f_inspDate',    r.inspDate || '');
  setVal('f_supplier',    r.supplier || '');
  setVal('f_client',      r.client || '');
  setVal('f_productNo',   r.productNo || '');
  setVal('f_productName', r.productName || '');
  setVal('f_deliveryNo',  r.deliveryNo || '');
  setVal('f_type',        r.type || '成品');
  setVal('f_qty',         r.qty || '');
  /* 编辑旧记录：sampleQty 已有值时设 manualEdit 标记，防止被自动覆盖 */
  const _smpEl = document.getElementById('f_sampleQty');
  if (_smpEl && r.sampleQty != null) _smpEl.dataset.manualEdit = '1';
  setVal('f_sampleQty',   r.sampleQty != null ? r.sampleQty : '');
  setVal('f_pass',        r.pass || '');
  setVal('f_fail',        r.fail || '');
  setVal('f_defectRate',  r.defectRate || '');
  setVal('f_result',      r.result || 'PASS');
  setVal('f_defect',      r.defect || '');
  setVal('f_qc',          r.qc || '');
  setVal('f_remark',      r.remark || '');
  _loadDefectRows(r.defects || []);   /* 加载已有不良明细 */
  _loadMeasRows(r.measurements || []); /* 加载已有测量数据 */
  renderSupplierDatalist();
  renderCustomerDatalist();
  renderInspectorDatalist();
  initDefectLib();
  refreshDefectDescDatalist();
  const overlay2 = document.getElementById('modalOverlay');
  if (overlay2) overlay2.classList.add('show');
}

function setVal(id, v) { const el=document.getElementById(id); if(el) el.value=v; }
function getVal(id)     { return (document.getElementById(id)?.value || '').trim(); }

function clearForm() {
  ['f_date','f_inspDate','f_supplier','f_client','f_productNo','f_productName',
   'f_deliveryNo','f_qty','f_sampleQty','f_pass','f_fail','f_defectRate','f_defect','f_qc','f_remark']
    .forEach(id => setVal(id, ''));
  setVal('f_type',   '成品');
  setVal('f_result', 'PASS');
  _loadDefectRows([]);   /* 清空不良明细 */
  _loadMeasRows([]);     /* 清空测量数据 */
  /* 新增时清除手动修改标记 */
  const _smpElClear = document.getElementById('f_sampleQty');
  if (_smpElClear) {
    _smpElClear.dataset.manualEdit = '';
    _smpElClear.dataset.autoFilled = '';
    _smpElClear.value = '';
  }
}




/* ════════════════════════════════════════
   §LOOKUP  历史联想：货号/客户/检验员
════════════════════════════════════════ */

/* 从历史获取检验员列表 */
function getInspectorsFromHistory() {
  const all = recs().map(r => r.qc).filter(Boolean);
  return [...new Set(all)];
}

/* 从历史获取指定货号的物料名称（按类型筛选可选）*/
function getMaterialNamesByProductNo(productNo, type) {
  if (!productNo) return [];
  const all = recs()
    .filter(r => r.productNo === productNo && (!type || r.type === type))
    .map(r => r.productName)
    .filter(Boolean);
  return [...new Set(all)];
}

/* 从历史获取指定货号对应的客户（最近优先）*/
function getClientByProductNo(productNo) {
  if (!productNo) return '';
  const matches = recs()
    .filter(r => r.productNo === productNo && r.client)
    .sort((a, b) => (b.date||'').localeCompare(a.date||''));
  return matches.length > 0 ? matches[0].client : '';
}

/* 渲染检验员 datalist */
function renderInspectorDatalist() {
  const dl = document.getElementById('inspectorList');
  if (!dl) return;
  const names = getInspectorsFromHistory();
  dl.innerHTML = names.map(n => `<option value="${n}"></option>`).join('');
}

/* 货号输入时联想物料名称 + 客户 */
function onProductNoChange() {
  const no      = (document.getElementById('f_productNo')?.value || '').trim();
  const type    = document.getElementById('f_type')?.value || '';
  const nameEl  = document.getElementById('f_productName');
  const clientEl= document.getElementById('f_client');
  const dl      = document.getElementById('materialNameList');

  /* 物料名称联想（来料类型） */
  if (dl) {
    const names = getMaterialNamesByProductNo(no, type === '来料' ? '来料' : null);
    dl.innerHTML = names.map(n => `<option value="${n}"></option>`).join('');
    /* 如果只有一个匹配且当前为空，自动填入 */
    if (names.length === 1 && nameEl && !nameEl.value) {
      nameEl.value = names[0];
    }
  }

  /* 客户联想 */
  if (clientEl && !clientEl.value && no) {
    const client = getClientByProductNo(no);
    if (client) clientEl.value = client;
  }
}

/* 类型改变时也刷新物料联想 */
function onTypeChange() {
  onProductNoChange();
}


/* ════════════════════════════════════════
   §DEFECT_LIB  不良描述内容库
════════════════════════════════════════ */

const _DEFECT_LIB_KEY = STORAGE_KEYS.defectLib;

/* 预置默认不良描述 */
const _DEFAULT_DEFECT_LIB = [
  /* 外观/质量 - MIN 2.5 */
  ...['色差','刮花','擦花','脏污','LOGO模糊','LOGO偏位','印刷不良','色不对版','混色','毛边','气纹','白化']
     .map(n=>({name:n,category:'外观/质量',defaultLevel:'MIN 2.5',keywords:[],enabled:true,createdAt:new Date().toISOString().slice(0,10)})),
  /* 外观/质量 - MAJ 1.0 */
  ...['缩水','飞油','披锋','缺胶','变形','裂纹']
     .map(n=>({name:n,category:'外观/质量',defaultLevel:'MAJ 1.0',keywords:[],enabled:true,createdAt:new Date().toISOString().slice(0,10)})),
  /* 功能 - MAJ 1.0 */
  ...['功能失效','按键失灵','开关不良','灯不亮','声音异常','装配不良','卡死','松动']
     .map(n=>({name:n,category:'功能',defaultLevel:'MAJ 1.0',keywords:[],enabled:true,createdAt:new Date().toISOString().slice(0,10)})),
  /* 包装 - MIN 2.5 */
  ...['漏贴','错贴','贴纸偏位','少配件','错配件','包装破损','条码错误','说明书错误']
     .map(n=>({name:n,category:'包装',defaultLevel:'MIN 2.5',keywords:[],enabled:true,createdAt:new Date().toISOString().slice(0,10)})),
  /* 尺寸/测量 - MAJ 1.0 */
  ...['尺寸超差','重量超差','长度超差','宽度超差','高度超差','厚度超差']
     .map(n=>({name:n,category:'尺寸/测量',defaultLevel:'MAJ 1.0',keywords:[],enabled:true,createdAt:new Date().toISOString().slice(0,10)})),
];

function _getDefectLib() {
  try { return JSON.parse(localStorage.getItem(_DEFECT_LIB_KEY)) || null; }
  catch(e) { return null; }
}
function _saveDefectLib(lib) {
  localStorage.setItem(_DEFECT_LIB_KEY, JSON.stringify(lib));
}

/* 首次启动初始化 */
function initDefectLib() {
  if (!_getDefectLib()) _saveDefectLib(_DEFAULT_DEFECT_LIB);
}

/* 获取启用的条目 */
function getEnabledDefectLib() {
  return (_getDefectLib() || _DEFAULT_DEFECT_LIB).filter(d => d.enabled !== false);
}

/* 根据名称查找库项 */
function findDefectLibItem(name) {
  if (!name) return null;
  const lib = _getDefectLib() || _DEFAULT_DEFECT_LIB;
  return lib.find(d => d.name === name || (d.keywords||[]).includes(name)) || null;
}

/* 加入内容库 */
function addToDefectLib(name, category, level) {
  const lib = _getDefectLib() || [..._DEFAULT_DEFECT_LIB];
  if (!lib.find(d=>d.name===name)) {
    lib.push({ name, category:category||'外观/质量', defaultLevel:level||'MIN 2.5',
               keywords:[], enabled:true, createdAt:new Date().toISOString().slice(0,10) });
    _saveDefectLib(lib);
  }
}

/* 刷新不良描述 datalist（不良明细行用）*/
function refreshDefectDescDatalist() {
  const dl = document.getElementById('defectDescList');
  if (!dl) return;
  dl.innerHTML = getEnabledDefectLib()
    .map(d=>`<option value="${d.name}" data-level="${d.defaultLevel}" data-cat="${d.category}">`)
    .join('');
}

/* 不良明细行：选择库项后自动带出等级和分类 */
function onDefectDescSelect(rowIdx, inputEl) {
  const val  = inputEl.value;
  const item = findDefectLibItem(val);
  if (item) {
    _defectRows[rowIdx].desc     = item.name;
    _defectRows[rowIdx].level    = item.defaultLevel || _defectRows[rowIdx].level;
    _defectRows[rowIdx].category = item.category     || _defectRows[rowIdx].category;
    _renderDefectRows();
  } else {
    _defectRows[rowIdx].desc = val;
  }
}

/* saveRecord 前检查未知描述 */
function _checkUnknownDefects(validDefects) {
  const lib  = _getDefectLib() || _DEFAULT_DEFECT_LIB;
  const known = new Set(lib.map(d=>d.name).concat(lib.flatMap(d=>d.keywords||[])));
  const unknown = validDefects.filter(d=>d.desc && !known.has(d.desc)).map(d=>d.desc);
  if (unknown.length === 0) return true;
  const msg = `以下不良描述不在内容库中：
${unknown.map(u=>`「${u}」`).join('、')}
是否将其加入内容库？`;
  if (confirm(msg)) {
    unknown.forEach(u => {
      const row = validDefects.find(d=>d.desc===u);
      addToDefectLib(u, row?.category, row?.level);
    });
    showToast('✓ 新描述已加入内容库', 'success');
  }
  return true; /* 无论用户选择与否，都允许保存 */
}

/* ════════════════════════════════════════
   §AQL  AQL Level II 抽查数量与自动判定
════════════════════════════════════════ */

/* AQL Level II 完整表 */
const _AQL_TABLE = [
  { lo:1,     hi:50,     sample:20,  cr:0, maj065:0, maj10:1, min25:1  },
  { lo:51,    hi:280,    sample:32,  cr:0, maj065:0, maj10:2, min25:3  },
  { lo:281,   hi:500,    sample:50,  cr:0, maj065:1, maj10:2, min25:5  },
  { lo:501,   hi:1200,   sample:80,  cr:0, maj065:1, maj10:3, min25:7  },
  { lo:1201,  hi:3200,   sample:125, cr:0, maj065:2, maj10:5, min25:10 },
  { lo:3201,  hi:10000,  sample:200, cr:0, maj065:3, maj10:7, min25:14 },
  { lo:10001, hi:35000,  sample:315, cr:0, maj065:5, maj10:10,min25:21 },
  { lo:35001, hi:150000, sample:500, cr:0, maj065:7, maj10:14,min25:21 },
];

/* 按批量取 AQL 行 */
function getAqlRowByLotSize(lotQty) {
  const q = Number(lotQty) || 0;
  return _AQL_TABLE.find(r => q >= r.lo && q <= r.hi) || _AQL_TABLE[_AQL_TABLE.length - 1];
}

/* 按批量取推荐抽查数量 */
function getAqlSampleSize(lotQty) {
  const row = getAqlRowByLotSize(lotQty);
  return row ? row.sample : 0;
}

/* 兼容等级字符串 → 标准 key */
function _normLevel(lv) {
  if (!lv) return '';
  const s = String(lv).toUpperCase().replace(/\s/g, '');
  if (s === 'CR')  return 'CR';
  if (s.includes('0.65') || s.includes('065')) return 'MAJ065';
  if (s.includes('1.0')  || s === 'MAJ10')     return 'MAJ10';
  if (s.includes('2.5')  || s === 'MIN25' || s === 'MIN') return 'MIN25';
  return '';
}

/* 从 defects 计算各等级数量合计 */
function getDefectLevelTotals(defects) {
  const t = { cr:0, maj065:0, maj10:0, min25:0 };
  if (!Array.isArray(defects)) return t;
  defects.forEach(d => {
    const k = _normLevel(d.level);
    const q = Number(d.qty) || 0;
    if (k === 'CR')     t.cr     += q;
    if (k === 'MAJ065') t.maj065 += q;
    if (k === 'MAJ10')  t.maj10  += q;
    if (k === 'MIN25')  t.min25  += q;
  });
  return t;
}

/* 根据批量和 defects 自动判定 PASS / REJ */
function autoJudgeByAql(lotQty, defects) {
  if (!Array.isArray(defects) || defects.length === 0) return null;
  const row    = getAqlRowByLotSize(lotQty);
  const totals = getDefectLevelTotals(defects);
  const reasons = [];
  if (totals.cr     > row.cr)     reasons.push(`CR 不良 ${totals.cr} 超出允收 ${row.cr}`);
  if (totals.maj065 > row.maj065) reasons.push(`MAJ 0.65 不良 ${totals.maj065} 超出允收 ${row.maj065}`);
  if (totals.maj10  > row.maj10)  reasons.push(`MAJ 1.0 不良 ${totals.maj10} 超出允收 ${row.maj10}`);
  if (totals.min25  > row.min25)  reasons.push(`MIN 2.5 不良 ${totals.min25} 超出允收 ${row.min25}`);
  return {
    sampleSize: row.sample,
    limits: { cr: row.cr, maj065: row.maj065, maj10: row.maj10, min25: row.min25 },
    totals,
    result: reasons.length > 0 ? 'REJ' : 'PASS',
    reasons,
  };
}


/* ════════════════════════════════════════
   §MEAS  尺寸/测量数据录入
════════════════════════════════════════ */

let _measRows = [];

/* ── 辅助：从数组计算平均值（纯数字）──  */
function _numAvg(arr) {
  const nums = arr.filter(v=>v!=='').map(Number).filter(n=>!isNaN(n));
  return nums.length > 0 && nums.length === arr.filter(v=>v!=='').length
    ? (nums.reduce((a,b)=>a+b,0)/nums.length).toFixed(2)
    : null;
}

/* ── 旧 standard 拆分（兼容 × * X 分隔符）── */
function _splitStandard(str) {
  if (!str) return [];
  return String(str).split(/[×xX*]/).map(s=>s.trim()).filter(Boolean);
}

/* ── 标准化测量行：确保所有字段存在 ── */
function _normalizeMeasRow(row) {
  row.measureType = row.measureType || 'single';
  if (!Array.isArray(row.values))  row.values  = Array(8).fill('');
  if (!Array.isArray(row.lValues)) row.lValues = Array(8).fill('');
  if (!Array.isArray(row.wValues)) row.wValues = Array(8).fill('');
  if (!Array.isArray(row.hValues)) row.hValues = Array(8).fill('');
  /* 标准值字段 */
  if (row.standardL === undefined) row.standardL = '';
  if (row.standardW === undefined) row.standardW = '';
  if (row.standardH === undefined) row.standardH = '';
  /* 公差字段 */
  if (row.tolerance  === undefined) row.tolerance  = '';
  if (row.toleranceL === undefined) row.toleranceL = '';
  if (row.toleranceW === undefined) row.toleranceW = '';
  if (row.toleranceH === undefined) row.toleranceH = '';
  /* 旧 standard 拆分到 standardL/W/H */
  const mt = row.measureType;
  if ((mt === 'LW' || mt === 'LWH') && !row.standardL && row.standard) {
    const parts = _splitStandard(row.standard);
    if (parts.length >= 2) {
      row.standardL = row.standardL || parts[0] || '';
      row.standardW = row.standardW || parts[1] || '';
      if (mt === 'LWH') row.standardH = row.standardH || parts[2] || '';
    }
  }
  return row;
}

/* ── 组合 standard 字段（保存时调用）── */
function _combineMeasStandard(row) {
  const mt = row.measureType || 'single';
  if (mt === 'LW') {
    const L=(row.standardL||'').trim(), W=(row.standardW||'').trim();
    return [L,W].filter(Boolean).join('×') || row.standard || '';
  }
  if (mt === 'LWH') {
    const L=(row.standardL||'').trim(),W=(row.standardW||'').trim(),H=(row.standardH||'').trim();
    return [L,W,H].filter(Boolean).join('×') || row.standard || '';
  }
  return row.standard || '';
}

/* ── 判断单值是否在 标准±公差 内 ── */
function _inTol(valStr, stdStr, tolStr) {
  const v=parseFloat(valStr), std=parseFloat(stdStr), tol=parseFloat(tolStr);
  if (isNaN(v)||isNaN(std)) return null;
  if (isNaN(tol)||!tolStr) return null;
  return v >= std-tol && v <= std+tol;
}

/* ── 自动判定 PASS / FAIL ── */
function _autoJudgeMeas(row) {
  const mt = row.measureType || 'single';
  if (mt === 'PF') {
    const filled=(row.values||[]).filter(v=>v!=='');
    if (!filled.length) return '';
    return filled.some(v=>v==='FAIL') ? 'FAIL' : 'PASS';
  }
  if (mt === 'single') {
    const filled=(row.values||[]).filter(v=>v!=='');
    if (!filled.length || !row.tolerance) return null;
    const res=filled.map(v=>_inTol(v,row.standard,row.tolerance));
    if (res.some(r=>r===null)) return null;
    return res.every(r=>r===true)?'PASS':'FAIL';
  }
  if (mt === 'LW') {
    if (!row.toleranceL && !row.toleranceW) return null;
    let hasAny=false, allPass=true;
    for (let j=0;j<8;j++) {
      const l=row.lValues?.[j]||'',w=row.wValues?.[j]||'';
      if (!l&&!w) continue; hasAny=true;
      const rl=_inTol(l,row.standardL,row.toleranceL);
      const rw=_inTol(w,row.standardW,row.toleranceW);
      if ((rl!==null&&!rl)||(rw!==null&&!rw)){allPass=false;break;}
    }
    return hasAny?(allPass?'PASS':'FAIL'):null;
  }
  if (mt === 'LWH') {
    if (!row.toleranceL&&!row.toleranceW&&!row.toleranceH) return null;
    let hasAny=false, allPass=true;
    for (let j=0;j<8;j++) {
      const l=row.lValues?.[j]||'',w=row.wValues?.[j]||'',h=row.hValues?.[j]||'';
      if (!l&&!w&&!h) continue; hasAny=true;
      const rl=_inTol(l,row.standardL,row.toleranceL);
      const rw=_inTol(w,row.standardW,row.toleranceW);
      const rh=_inTol(h,row.standardH,row.toleranceH);
      if ((rl!==null&&!rl)||(rw!==null&&!rw)||(rh!==null&&!rh)){allPass=false;break;}
    }
    return hasAny?(allPass?'PASS':'FAIL'):null;
  }
  return null;
}

/* ── 只更新平均值+判定文字（不重建 DOM）── */
function updateMeasAvgAndJudge(rowIdx) {
  const row=_measRows[rowIdx]; if (!row) return;
  const avg=_calcMeasAvg(row);
  const judge=_autoJudgeMeas(row);
  const avgEl=document.getElementById(`meas-avg-${rowIdx}`);
  const judgeEl=document.getElementById(`meas-judge-${rowIdx}`);
  const resSel=document.getElementById(`meas-result-${rowIdx}`);
  if (avgEl) avgEl.textContent=avg;
  if (judgeEl) {
    if (!judge){judgeEl.textContent='';judgeEl.style.color='';}
    else{judgeEl.textContent=`自动判定：${judge}`;judgeEl.style.color=judge==='PASS'?'var(--green)':'var(--red)';}
  }
  if (resSel&&judge) {
    const cur=resSel.value;
    if (!cur||cur==='PASS'||cur==='FAIL'){resSel.value=judge;row.result=judge;}
  }
  /* 如果任何测量行 FAIL，主判定下拉强制为 REJ */
  const mainResEl = document.getElementById('f_result');
  if (mainResEl) {
    const anyMeasFail = _measRows.some(m => String(m.result||'').toUpperCase()==='FAIL');
    if (anyMeasFail) mainResEl.value = 'REJ';
  }
}

/* ── 安全更新单格（不重建 DOM）── */
function updateMeasCell(rowIdx, field, j, val) {
  const row=_measRows[rowIdx]; if (!row) return;
  if (!Array.isArray(row[field])) row[field]=Array(8).fill('');
  row[field][j]=val;
  updateMeasAvgAndJudge(rowIdx);
}

/* ── 安全更新标量字段（不重建 DOM）── */
function updateMeasField(rowIdx, field, val) {
  const row=_measRows[rowIdx]; if (!row) return;
  row[field]=val;
  updateMeasAvgAndJudge(rowIdx);
}

/* ── 测量类型切换（允许整行重绘）── */
function _onMeasTypeChange(idx, val) {
  if (!_measRows[idx]) return;
  _measRows[idx].measureType = val || 'single';
  _normalizeMeasRow(_measRows[idx]);
  _renderMeasRows();
}

/* ── 计算当前行的平均值文字（兼容三种 measureType）── */
function _calcMeasAvg(row) {
  const mt = row.measureType || 'single';
  if (mt === 'LW') {
    const al = _numAvg(row.lValues||[]);
    const aw = _numAvg(row.wValues||[]);
    const avg = `${al||'—'}×${aw||'—'}`;
    row.avg = avg;
    return avg;
  }
  if (mt === 'LWH') {
    const al = _numAvg(row.lValues||[]);
    const aw = _numAvg(row.wValues||[]);
    const ah = _numAvg(row.hValues||[]);
    const avg = `${al||'—'}×${aw||'—'}×${ah||'—'}`;
    row.avg = avg;
    return avg;
  }
  /* single */
  const a = _numAvg(row.values||[]);
  row.avg = a || '';
  return a || '—';
}

/* ── 组合复合尺寸为 IQC 报告显示用的 values 数组 ── */
function _getMeasDisplayValues(row) {
  const mt = row.measureType || 'single';
  if (mt === 'LW') {
    const L = row.lValues || [];
    const W = row.wValues || [];
    return Array.from({length:8}, (_,j) => {
      const l = L[j]||''; const w = W[j]||'';
      return (l || w) ? `${l}×${w}` : '';
    });
  }
  if (mt === 'LWH') {
    const L = row.lValues || [];
    const W = row.wValues || [];
    const H = row.hValues || [];
    return Array.from({length:8}, (_,j) => {
      const l = L[j]||''; const w = W[j]||''; const h = H[j]||'';
      return (l || w || h) ? `${l}×${w}×${h}` : '';
    });
  }
  /* single：旧 values 数组 */
  return [...(row.values||[]),...Array(8).fill('')].slice(0,8);
}

/* ── 渲染单行测量值输入网格（稳定版：oninput 不重建 DOM）── */
function _measValGrid(rowIdx, label, field, values) {
  const inStyle = `padding:2px 4px;border:1px solid var(--border);border-radius:3px;`+
    `background:var(--bg-card);color:var(--text);font-size:10.5px;text-align:right;`+
    `width:100%;box-sizing:border-box;min-width:0`;
  return `<div style="display:grid;grid-template-columns:20px repeat(8,1fr);gap:3px;align-items:center;margin-bottom:3px">
      <span style="font-size:9.5px;color:var(--text-muted);text-align:right">${label}</span>
      ${Array.from({length:8},(_,j)=>`<input type="text" value="${values[j]||''}"
        style="${inStyle}"
        oninput="updateMeasCell(${rowIdx},'${field}',${j},this.value)"/>`
      ).join('')}
    </div>`;
}

/* PF（结果判定）单行网格：每格是 PASS/FAIL 下拉 */
function _measValGridPF(rowIdx, values) {
  const selStyle = `padding:1px 3px;border:1px solid var(--border);border-radius:3px;`+
    `background:var(--bg-card);color:var(--text);font-size:10px;width:100%;box-sizing:border-box;min-width:0`;
  return `<div style="display:grid;grid-template-columns:20px repeat(8,1fr);gap:3px;align-items:center;margin-bottom:3px">
      <span></span>
      ${Array.from({length:8},(_,j)=>`<select style="${selStyle}"
        onchange="updateMeasCell(${rowIdx},'values',${j},this.value)">
        <option value="" ${values[j]===''?'selected':''}>—</option>
        <option value="PASS" ${values[j]==='PASS'?'selected':''}>PASS</option>
        <option value="FAIL" ${values[j]==='FAIL'?'selected':''}>FAIL</option>
      </select>`).join('')}
    </div>`;
}

function _renderMeasRows() {
  const wrap = document.getElementById('measRows');
  const hint = document.getElementById('measEmptyHint');
  if (!wrap) {
    console.error('[MEAS] ERROR: #measRows not found in DOM');
    return;
  }
  if (_measRows.length === 0) {
    wrap.innerHTML = '';
    if (hint) hint.style.display = '';
    return;
  }
  if (hint) hint.style.display = 'none';

  const LABEL_NUM = `<div style="display:grid;grid-template-columns:20px repeat(8,1fr);gap:3px;margin-bottom:2px">
      <span></span>${[1,2,3,4,5,6,7,8].map(n=>`<span style="text-align:center;font-size:9px;color:var(--text-muted)">${n}</span>`).join('')}
    </div>`;

  wrap.innerHTML = _measRows.map((row, i) => {
    const mt       = row.measureType || 'single';
    const resColor = row.result==='FAIL'?'var(--red)':row.result==='PASS'?'var(--green)':'var(--text)';
    const inBase   = `padding:3px 5px;border:1px solid var(--border);border-radius:4px;`+
                     `background:var(--bg-card);color:var(--text);box-sizing:border-box;width:100%;min-width:0`;
    const judge    = _autoJudgeMeas(row);
    const avgText  = _calcMeasAvg(row);

    /* ── 行1：项目 / 类型 / 判定 / 删除 ── */
    const row1 = `<div style="display:grid;grid-template-columns:1fr 110px 82px 28px;gap:5px;margin-bottom:4px;align-items:center">
        <input type="text" value="${row.item||''}" placeholder="测量项目"
               style="${inBase};font-size:11px"
               oninput="updateMeasField(${i},'item',this.value)"/>
        <select style="${inBase};font-size:10.5px" onchange="_onMeasTypeChange(${i},this.value)">
          <option value="single" ${mt==='single'?'selected':''}>单一数值</option>
          <option value="LW"     ${mt==='LW'?'selected':''}>长×宽</option>
          <option value="LWH"    ${mt==='LWH'?'selected':''}>长×宽×高</option>
          <option value="PF"     ${mt==='PF'?'selected':''}>结果判定</option>
        </select>
        <select id="meas-result-${i}" style="${inBase};font-size:10.5px;font-weight:600;color:${resColor}"
                onchange="_measRows[${i}].result=this.value">
          <option value="" ${!row.result?'selected':''}>判定</option>
          <option value="PASS" ${row.result==='PASS'?'selected':''}>✓ PASS</option>
          <option value="FAIL" ${row.result==='FAIL'?'selected':''}>✗ FAIL</option>
        </select>
        <button type="button" style="width:24px;height:24px;border:none;border-radius:4px;background:var(--red);color:#fff;cursor:pointer;font-size:14px;line-height:1;padding:0"
                onclick="removeMeasRow(${i})">×</button>
      </div>`;

    /* ── 行2：标准值+公差 ── */
    const inSm = `${inBase};font-size:10px;max-width:80px`;
    let stdRow = '';
    if (mt === 'single') {
      stdRow = `<div style="display:flex;gap:5px;margin-bottom:4px;align-items:center;flex-wrap:wrap">
        <span style="font-size:10px;color:var(--text-dim)">标准值</span>
        <input type="text" value="${row.standard||''}" placeholder="如：10.0"
          style="${inSm};max-width:100px" oninput="updateMeasField(${i},'standard',this.value)"/>
        <span style="font-size:10px;color:var(--text-dim)">公差±</span>
        <input type="text" value="${row.tolerance||''}" placeholder="如：0.5"
          style="${inSm}" oninput="updateMeasField(${i},'tolerance',this.value)"/>
      </div>`;
    } else if (mt === 'LW') {
      stdRow = `<div style="display:grid;grid-template-columns:repeat(4,auto);gap:4px;margin-bottom:4px;align-items:center">
        <span style="font-size:10px;color:var(--text-dim)">L</span>
        <input type="text" value="${row.standardL||''}" placeholder="L标准"
          style="${inSm}" oninput="updateMeasField(${i},'standardL',this.value)"/>
        <span style="font-size:10px;color:var(--text-dim)">±</span>
        <input type="text" value="${row.toleranceL||''}" placeholder="公差"
          style="${inSm}" oninput="updateMeasField(${i},'toleranceL',this.value)"/>
        <span style="font-size:10px;color:var(--text-dim)">W</span>
        <input type="text" value="${row.standardW||''}" placeholder="W标准"
          style="${inSm}" oninput="updateMeasField(${i},'standardW',this.value)"/>
        <span style="font-size:10px;color:var(--text-dim)">±</span>
        <input type="text" value="${row.toleranceW||''}" placeholder="公差"
          style="${inSm}" oninput="updateMeasField(${i},'toleranceW',this.value)"/>
      </div>`;
    } else if (mt === 'LWH') {
      stdRow = `<div style="display:grid;grid-template-columns:repeat(6,auto);gap:4px;margin-bottom:4px;align-items:center">
        <span style="font-size:10px;color:var(--text-dim)">L</span>
        <input type="text" value="${row.standardL||''}" placeholder="L标准"
          style="${inSm}" oninput="updateMeasField(${i},'standardL',this.value)"/>
        <span style="font-size:10px;color:var(--text-dim)">W</span>
        <input type="text" value="${row.standardW||''}" placeholder="W标准"
          style="${inSm}" oninput="updateMeasField(${i},'standardW',this.value)"/>
        <span style="font-size:10px;color:var(--text-dim)">H</span>
        <input type="text" value="${row.standardH||''}" placeholder="H标准"
          style="${inSm}" oninput="updateMeasField(${i},'standardH',this.value)"/>
        <span style="font-size:10px;color:var(--text-dim)">±L</span>
        <input type="text" value="${row.toleranceL||''}" placeholder="公差"
          style="${inSm}" oninput="updateMeasField(${i},'toleranceL',this.value)"/>
        <span style="font-size:10px;color:var(--text-dim)">±W</span>
        <input type="text" value="${row.toleranceW||''}" placeholder="公差"
          style="${inSm}" oninput="updateMeasField(${i},'toleranceW',this.value)"/>
        <span style="font-size:10px;color:var(--text-dim)">±H</span>
        <input type="text" value="${row.toleranceH||''}" placeholder="公差"
          style="${inSm}" oninput="updateMeasField(${i},'toleranceH',this.value)"/>
      </div>`;
    } else if (mt === 'PF') {
      stdRow = `<div style="display:flex;gap:5px;margin-bottom:4px;align-items:center">
        <span style="font-size:10px;color:var(--text-dim)">判定标准</span>
        <input type="text" value="${row.standard||''}" placeholder="如：粘油测试"
          style="${inSm};max-width:160px" oninput="updateMeasField(${i},'standard',this.value)"/>
      </div>`;
    }

    /* ── 行3+：测量值输入 ── */
    let valueRows = '';
    if (mt === 'single') {
      valueRows = _measValGrid(i, '', 'values', row.values||Array(8).fill(''));
    } else if (mt === 'LW') {
      valueRows = _measValGrid(i, 'L', 'lValues', row.lValues||Array(8).fill(''))
                + _measValGrid(i, 'W', 'wValues', row.wValues||Array(8).fill(''));
    } else if (mt === 'LWH') {
      valueRows = _measValGrid(i, 'L', 'lValues', row.lValues||Array(8).fill(''))
                + _measValGrid(i, 'W', 'wValues', row.wValues||Array(8).fill(''))
                + _measValGrid(i, 'H', 'hValues', row.hValues||Array(8).fill(''));
    } else if (mt === 'PF') {
      valueRows = _measValGridPF(i, row.values||Array(8).fill(''));
    }

    const judgeDisplay = judge
      ? `<span id="meas-judge-${i}" style="font-size:10px;font-weight:600;margin-left:8px;color:${judge==='PASS'?'var(--green)':'var(--red)'}">自动判定：${judge}</span>`
      : `<span id="meas-judge-${i}"></span>`;

    return `<div class="measure-row" style="border:1px solid var(--border);border-radius:5px;padding:8px 10px;margin-bottom:5px;background:var(--bg-input)">
      ${row1}${stdRow}${LABEL_NUM}${valueRows}
      <div style="margin-top:4px;font-size:11px;color:var(--text-dim)">
        平均值：<strong id="meas-avg-${i}" style="color:var(--text)">${avgText}</strong>
        ${judgeDisplay}
      </div>
    </div>`;
  }).join('');
}

function addMeasRow() {
  if (!Array.isArray(_measRows)) { _measRows = []; }
  const row = _normalizeMeasRow({
    item:'', standard:'', measureType:'single',
    values:Array(8).fill(''), lValues:Array(8).fill(''),
    wValues:Array(8).fill(''), hValues:Array(8).fill(''),
    standardL:'', standardW:'', standardH:'',
    tolerance:'', toleranceL:'', toleranceW:'', toleranceH:'',
    avg:'', result:''
  });
  _measRows.push(row);
  _renderMeasRows();
}

function removeMeasRow(i) {
  _measRows.splice(i, 1);
  _renderMeasRows();
}

function _loadMeasRows(measurements) {
  _measRows = Array.isArray(measurements)
    ? measurements.map(m => ({
        item:        m.item        || '',
        standard:    m.standard    || '',
        measureType: m.measureType || 'single',
        /* 兼容旧结构（values 是字符串数组）和新结构 */
        values:   Array.isArray(m.values) && (typeof m.values[0] !== 'object')
                  ? [...m.values,  ...Array(8).fill('')].slice(0,8)
                  : Array(8).fill(''),
        lValues:    m.lValues ? [...m.lValues,...Array(8).fill('')].slice(0,8) : Array(8).fill(''),
        wValues:    m.wValues ? [...m.wValues,...Array(8).fill('')].slice(0,8) : Array(8).fill(''),
        hValues:    m.hValues ? [...m.hValues,...Array(8).fill('')].slice(0,8) : Array(8).fill(''),
        standardL:  m.standardL  || '',
        standardW:  m.standardW  || '',
        standardH:  m.standardH  || '',
        tolerance:  m.tolerance  || '',
        toleranceL: m.toleranceL || '',
        toleranceW: m.toleranceW || '',
        toleranceH: m.toleranceH || '',
        avg:        m.avg        || '',
        result:     m.result     || '',
      }))
    : [];
  _measRows.forEach(_normalizeMeasRow);
  _renderMeasRows();
}


/* ════════════════════════════════════════
   §DEFECT_LIB_PAGE  不良描述库管理页面
════════════════════════════════════════ */

function renderDefectLibPage() {
  const el = document.getElementById('page-defectlib');
  if (!el) return;
  initDefectLib();
  const lib    = _getDefectLib() || [];
  const canDel = can('deleteRecord');  /* admin 可删除 */
  const canAdd = can('createRecord'); /* admin + manager 可新增 */

  const CATS = ['外观/质量','功能','尺寸/测量','包装','其它'];
  const LVLS = ['CR','MAJ 0.65','MAJ 1.0','MIN 2.5'];

  el.innerHTML = `
  <div class="page-header">
    <h2 class="page-title">不良描述库</h2>
    ${canAdd ? '<button class="btn-primary" onclick="_openDefLibModal()">＋ 新增描述</button>' : ''}
  </div>
  <div style="margin:10px 0">
    <input id="defLibSearch" type="text" placeholder="搜索描述或关键词..." class="form-input"
           style="max-width:280px" oninput="renderDefectLibPage()"/>
  </div>
  <div class="table-wrap" style="margin-top:8px">
    <table style="table-layout:fixed;width:100%">
      <colgroup>
        <col style="width:110px"/><col style="width:90px"/><col style="width:100px"/>
        <col style="width:auto"/><col style="width:70px"/><col style="width:170px"/>
      </colgroup>
      <thead><tr>
        <th style="text-align:left">描述名称</th>
        <th style="text-align:left">分类</th>
        <th style="text-align:left">默认等级</th>
        <th style="text-align:left">关键词</th>
        <th style="text-align:center">状态</th>
        <th style="text-align:center">操作</th>
      </tr></thead>
      <tbody>
        ${(() => {
          const q = (document.getElementById('defLibSearch')?.value||'').toLowerCase();
          const filtered = q ? lib.filter(d =>
            d.name.toLowerCase().includes(q) ||
            (d.keywords||[]).some(k=>k.toLowerCase().includes(q))) : lib;
          if (filtered.length===0) return '<tr><td colspan="6" style="text-align:center;color:var(--text-dim);padding:20px">暂无记录</td></tr>';
          return filtered.map((d,i) => {
            const realIdx = lib.indexOf(d);
            const badge = d.enabled
              ? '<span class="badge badge-pass">启用</span>'
              : '<span class="badge badge-rej">停用</span>';
            return `<tr>
              <td style="font-weight:500">${d.name}</td>
              <td style="font-size:11px">${d.category||''}</td>
              <td style="font-size:11px">${d.defaultLevel||''}</td>
              <td style="font-size:11px;color:var(--text-dim)">${(d.keywords||[]).join('、')||'—'}</td>
              <td style="text-align:center">${badge}</td>
              <td style="text-align:center">
                ${canAdd ? `<button class="action-btn" onclick="_openDefLibModal(${realIdx})">编辑</button>` : ''}
                <button class="action-btn" onclick="_toggleDefLibItem(${realIdx})">${d.enabled?'停用':'启用'}</button>
                ${canDel ? `<button class="action-btn del" onclick="_deleteDefLibItem(${realIdx})">删除</button>` : ''}
              </td>
            </tr>`;
          }).join('');
        })()}
      </tbody>
    </table>
  </div>

  <!-- 新增/编辑弹框 -->
  <div id="defLibModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:3000;align-items:center;justify-content:center">
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:26px 30px;width:400px;max-width:96vw">
      <h3 id="defLibModalTitle" style="margin:0 0 18px;color:var(--text-hi);font-size:15px">新增不良描述</h3>
      <div style="margin-bottom:12px">
        <label class="form-label">描述名称 *</label>
        <input id="dlName" class="form-input" placeholder="如：缩水" autocomplete="off"/>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
        <div>
          <label class="form-label">默认分类</label>
          <select id="dlCat" class="form-input">
            ${CATS.map(c=>`<option value="${c}">${c}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="form-label">默认等级</label>
          <select id="dlLvl" class="form-input">
            ${LVLS.map(l=>`<option value="${l}">${l}</option>`).join('')}
          </select>
        </div>
      </div>
      <div style="margin-bottom:18px">
        <label class="form-label">同义词 / 关键词 <span style="font-size:10px;color:var(--text-dim)">（逗号分隔）</span></label>
        <input id="dlKeywords" class="form-input" placeholder="如：收水,缩水痕" autocomplete="off"/>
      </div>
      <div id="defLibModalErr" style="display:none;color:var(--red);font-size:12px;margin-bottom:10px"></div>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button class="btn-secondary" onclick="_closeDefLibModal()">取消</button>
        <button class="btn-primary" onclick="_saveDefLibItem()">保存</button>
      </div>
    </div>
  </div>`;
}

let _editingDefLibIdx = null;

function _openDefLibModal(idx) {
  _editingDefLibIdx = idx ?? null;
  const modal = document.getElementById('defLibModal');
  if (!modal) return;
  modal.style.display = 'flex';
  const lib  = _getDefectLib() || [];
  const errEl = document.getElementById('defLibModalErr');
  if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
  const titleEl = document.getElementById('defLibModalTitle');
  if (idx !== undefined && idx !== null) {
    const d = lib[idx];
    if (!d) return;
    if (titleEl) titleEl.textContent = `编辑：${d.name}`;
    document.getElementById('dlName').value    = d.name;
    document.getElementById('dlCat').value     = d.category || '外观/质量';
    document.getElementById('dlLvl').value     = d.defaultLevel || 'MIN 2.5';
    document.getElementById('dlKeywords').value = (d.keywords||[]).join('，');
  } else {
    if (titleEl) titleEl.textContent = '新增不良描述';
    document.getElementById('dlName').value    = '';
    document.getElementById('dlCat').value     = '外观/质量';
    document.getElementById('dlLvl').value     = 'MIN 2.5';
    document.getElementById('dlKeywords').value = '';
  }
}

function _closeDefLibModal() {
  const modal = document.getElementById('defLibModal');
  if (modal) modal.style.display = 'none';
  _editingDefLibIdx = null;
}

function _saveDefLibItem() {
  const errEl = document.getElementById('defLibModalErr');
  const show  = msg => { if(errEl){errEl.textContent=msg;errEl.style.display='';} };
  const name     = (document.getElementById('dlName')?.value||'').trim();
  const category = document.getElementById('dlCat')?.value || '外观/质量';
  const level    = document.getElementById('dlLvl')?.value || 'MIN 2.5';
  const kw       = (document.getElementById('dlKeywords')?.value||'').split(/[,，]/).map(s=>s.trim()).filter(Boolean);
  if (!name) { show('请输入描述名称'); return; }

  const lib = _getDefectLib() || [];
  if (_editingDefLibIdx !== null) {
    lib[_editingDefLibIdx] = { ...lib[_editingDefLibIdx], name, category, defaultLevel:level, keywords:kw };
  } else {
    if (lib.find(d=>d.name===name)) { show('描述名称已存在'); return; }
    lib.push({ name, category, defaultLevel:level, keywords:kw, enabled:true, createdAt:new Date().toISOString().slice(0,10) });
  }
  _saveDefectLib(lib);
  _closeDefLibModal();
  showToast('✓ 已保存', 'success');
  renderDefectLibPage();
  refreshDefectDescDatalist();
}

function _toggleDefLibItem(idx) {
  const lib = _getDefectLib() || [];
  if (!lib[idx]) return;
  lib[idx].enabled = !lib[idx].enabled;
  _saveDefectLib(lib);
  renderDefectLibPage();
  refreshDefectDescDatalist();
  showToast(lib[idx].enabled ? '✓ 已启用' : '已停用', lib[idx].enabled?'success':'info');
}

function _deleteDefLibItem(idx) {
  if (!can('deleteRecord')) { showToast('当前账号无权限执行此操作','error'); return; }
  const lib = _getDefectLib() || [];
  if (!lib[idx]) return;
  if (!confirm(`确认删除「${lib[idx].name}」？`)) return;
  lib.splice(idx, 1);
  _saveDefectLib(lib);
  renderDefectLibPage();
  refreshDefectDescDatalist();
  showToast('✓ 已删除', 'success');
}

/* ════════════════════════════════════════
   §DEFECTS  不良明细结构化录入
════════════════════════════════════════ */

/* 内存中的当前明细行 */
let _defectRows = [];

/* 等级和分类选项 */
const DEFECT_LEVELS = ['', 'CR', 'MAJ 0.65', 'MAJ 1.0', 'MIN 2.5'];
const DEFECT_CATS   = ['外观/质量', '功能', '尺寸/测量', '包装', '其它'];

/* 重新渲染明细区 */
function _renderDefectRows() {
  const wrap  = document.getElementById('defectsRows');
  const hint  = document.getElementById('defectsEmptyHint');
  if (!wrap) return;

  if (_defectRows.length === 0) {
    wrap.innerHTML = '';
    if (hint) hint.style.display = '';
    _updateDefectSummary();
    return;
  }
  if (hint) hint.style.display = 'none';

  wrap.innerHTML = _defectRows.map((row, i) => `
    <div style="display:grid;grid-template-columns:1fr 64px 100px 90px 1fr 28px;
                gap:4px;align-items:center;padding:4px 0;
                border-bottom:1px solid var(--border)">
      <input type="text" value="${row.desc || ''}" placeholder="不良描述"
             list="defectDescList"
             style="padding:4px 6px;border:1px solid var(--border);border-radius:4px;
                    background:var(--bg-input);color:var(--text);font-size:12px"
             oninput="_defectRows[${i}].desc=this.value;_updateDefectSummary()"
             onchange="onDefectDescSelect(${i},this)"/>
      <input type="number" value="${row.qty || ''}" placeholder="数量" min="0"
             style="padding:4px 6px;border:1px solid var(--border);border-radius:4px;
                    background:var(--bg-input);color:var(--text);font-size:12px;text-align:right"
             oninput="_defectRows[${i}].qty=parseInt(this.value)||0;_updateDefectSummary()"/>
      <select style="padding:4px 6px;border:1px solid var(--border);border-radius:4px;
                     background:var(--bg-input);color:var(--text);font-size:12px"
              onchange="_defectRows[${i}].level=this.value">
        ${DEFECT_LEVELS.map(l => `<option value="${l}" ${row.level===l?'selected':''}>${l||'—等级—'}</option>`).join('')}
      </select>
      <select style="padding:4px 6px;border:1px solid var(--border);border-radius:4px;
                     background:var(--bg-input);color:var(--text);font-size:12px"
              onchange="_defectRows[${i}].category=this.value">
        ${DEFECT_CATS.map(c => `<option value="${c}" ${row.category===c?'selected':''}>${c}</option>`).join('')}
      </select>
      <input type="text" value="${row.remark || ''}" placeholder="备注（选填）"
             style="padding:4px 6px;border:1px solid var(--border);border-radius:4px;
                    background:var(--bg-input);color:var(--text);font-size:12px"
             oninput="_defectRows[${i}].remark=this.value"/>
      <button type="button"
              style="width:24px;height:24px;border:none;border-radius:4px;background:var(--red);
                     color:#fff;cursor:pointer;font-size:14px;line-height:1;padding:0"
              onclick="removeDefectRow(${i})">×</button>
    </div>`).join('');

  _updateDefectSummary();
}

/* 添加一行 */
function addDefectRow() {
  _defectRows.push({ desc:'', qty:0, level:'', category:'外观/质量', remark:'' });
  _renderDefectRows();
}

/* 删除一行 */
function removeDefectRow(i) {
  _defectRows.splice(i, 1);
  _renderDefectRows();
}

/* 更新汇总条 + 同步 f_fail / f_pass / f_defectRate + AQL 自动判定 */
function _updateDefectSummary() {
  const totalFail = _defectRows.reduce((s,d) => s + (Number(d.qty)||0), 0);
  const smpEl     = document.getElementById('f_sampleQty');
  const sample    = parseInt(smpEl?.value) || 0;
  const pass      = Math.max(0, sample - totalFail);
  const rate      = sample > 0 ? (totalFail/sample*100).toFixed(2)+'%' : '0.00%';

  /* 汇总条 */
  const dsSample = document.getElementById('dsSample');
  const dsFail   = document.getElementById('dsFail');
  const dsPass   = document.getElementById('dsPass');
  const dsRate   = document.getElementById('dsRate');
  if (dsSample) dsSample.textContent = sample;
  if (dsFail)   dsFail.textContent   = totalFail;
  if (dsPass)   dsPass.textContent   = pass;
  if (dsRate)   dsRate.textContent   = rate;

  /* 同步 readonly 字段 */
  const failEl = document.getElementById('f_fail');
  const passEl = document.getElementById('f_pass');
  const rateEl = document.getElementById('f_defectRate');
  if (failEl) failEl.value = totalFail;
  if (passEl) passEl.value = pass;
  if (rateEl) rateEl.value = rate;

  /* AQL 推荐抽查数量显示 */
  const qtyEl   = document.getElementById('f_qty');
  const lotQty  = parseInt(qtyEl?.value) || 0;
  const sugEl   = document.getElementById('dsAqlSuggest');
  if (sugEl) sugEl.textContent = lotQty > 0 ? getAqlSampleSize(lotQty) : '—';

  /* AQL 自动判定 */
  const judgment = autoJudgeByAql(lotQty, _defectRows);
  const dsAql    = document.getElementById('dsAqlResult');
  const dsAqlR   = document.getElementById('dsAqlReasons');
  if (dsAql) {
    if (!judgment) {
      dsAql.textContent = '—'; dsAql.style.color = '';
    } else if (judgment.result === 'REJ') {
      dsAql.textContent = 'REJ'; dsAql.style.color = 'var(--red)';
    } else {
      dsAql.textContent = 'PASS'; dsAql.style.color = 'var(--green)';
    }
  }
  if (dsAqlR) {
    dsAqlR.textContent = judgment?.reasons?.join(' | ') || '';
    dsAqlR.style.color = 'var(--red)';
  }

  /* 自动同步判定结果（仅 PASS/REJ，不覆盖 COND/AOD/HOLD）*/
  if (judgment) {
    const resultEl = document.getElementById('f_result');
    if (resultEl) {
      const cur = resultEl.value;
      if (cur !== 'COND' && cur !== 'HOLD') {
        resultEl.value = judgment.result;
      }
    }
  }
}

/* 从 record.defects 数组加载 */
function _loadDefectRows(defects) {
  _defectRows = Array.isArray(defects)
    ? defects.map(d => ({
        desc:     d.desc     || '',
        qty:      Number(d.qty) || 0,
        level:    d.level    || '',
        category: d.category || '外观/质量',
        remark:   d.remark   || '',
      }))
    : [];
  _renderDefectRows();
}

/* 生成 defect 简要文本（flyoil10，缩水10，其它5）*/
function _genDefectText() {
  return _defectRows
    .filter(d => d.desc && d.qty > 0)
    .map(d => `${d.desc}${d.qty}`)
    .join('，');
}

/* 来货数量改变时：自动推算 AQL 抽查数量，再刷新汇总 */
function onQtyChange() {
  const qtyEl    = document.getElementById('f_qty');
  const smpEl    = document.getElementById('f_sampleQty');
  if (!qtyEl || !smpEl) { calcRate(); return; }
  const lotQty   = parseInt(qtyEl.value) || 0;
  const suggest  = lotQty > 0 ? getAqlSampleSize(lotQty) : 0;
  /* 新增时（editingId===null）始终自动填入推荐值；
     编辑旧记录时若已手动修改则保留 */
  const isNew      = (typeof editingId === 'undefined' || editingId === null);
  /* 新增时：始终自动填入；编辑时：若 sampleQty 为空或未被手动修改过，也填入 */
  const manualFlag = !isNew && smpEl.dataset.manualEdit === '1' && (parseInt(smpEl.value)||0) > 0;
  if (!manualFlag && suggest > 0) {
    smpEl.value = suggest;
    smpEl.dataset.autoFilled = '1';
  }
  const hint   = document.getElementById('aqlSampleHint');
  const btnAql = document.getElementById('btnApplyAql');
  if (hint && lotQty > 0 && suggest > 0) {
    const cur = parseInt(smpEl.value) || 0;
    const match = cur === suggest;
    hint.textContent = match ? `AQL Level II 推荐：${suggest}` : `AQL Level II 推荐：${suggest}`;
    hint.style.color = match ? 'var(--text-dim)' : 'var(--yellow)';
    if (btnAql) btnAql.style.display = match ? 'none' : '';
  } else if (hint) {
    hint.textContent = '';
    if (btnAql) btnAql.style.display = 'none';
  }
  _updateDefectSummary();
}

/* 抽查数量手动修改标记 */
function onSampleQtyChange() {
  const smpEl = document.getElementById('f_sampleQty');
  if (smpEl) { smpEl.dataset.manualEdit = '1'; smpEl.dataset.autoFilled = ''; }
  _updateDefectSummary();
}

/* "应用推荐值"按钮：强制写入 AQL 推荐 sampleQty */
function applyAqlSuggest() {
  const qtyEl = document.getElementById('f_qty');
  const smpEl = document.getElementById('f_sampleQty');
  if (!qtyEl || !smpEl) return;
  const lotQty  = parseInt(qtyEl.value) || 0;
  const suggest = getAqlSampleSize(lotQty);
  if (suggest > 0) {
    smpEl.value = suggest;
    smpEl.dataset.manualEdit  = '';
    smpEl.dataset.autoFilled  = '1';
    const hint = document.getElementById('aqlSampleHint');
    if (hint) { hint.textContent = `AQL Level II 推荐：${suggest}`; hint.style.color = 'var(--text-dim)'; }
    _updateDefectSummary();
    showToast(`✓ 抽查数量已设为 AQL Level II 推荐值 ${suggest}`, 'success');
  }
}

function calcRate() {
  /* 不良明细存在时，由 _updateDefectSummary 计算；否则直接从 f_fail 计算 */
  if (_defectRows && _defectRows.length > 0) {
    _updateDefectSummary();
    return;
  }
  try {
    const smpRaw = document.getElementById('f_sampleQty')?.value || '';
    const sample = smpRaw.trim() !== '' ? parseInt(smpRaw) : null;
    const fail   = parseInt(document.getElementById('f_fail')?.value) || 0;
    const pass   = parseInt(document.getElementById('f_pass')?.value) || 0;
    const base   = pass + fail || (sample != null ? sample : 0);
    setVal('f_defectRate', base > 0 ? (fail/base*100).toFixed(2)+'%' : '0.00%');
  } catch(e) {}
}

function closeModal(e) { if (e.target === document.getElementById('modalOverlay')) closeModalDirect(); }
function closeModalDirect() {
  document.getElementById('modalOverlay').classList.remove('show');
  editingId = null;
}


/* ════════════════════════════════════════
   §FINAL_RESULT  最终记录判定统一逻辑
════════════════════════════════════════ */

/* measurements 中是否有 FAIL */
function hasMeasurementFail(measurements) {
  return Array.isArray(measurements) &&
    measurements.some(m => String(m.result || '').toUpperCase() === 'FAIL');
}

/* 最终判定：measurements FAIL 优先，其次 defects 超 AQL，最后用原始 result */
function getFinalRecordResult(baseResult, defects, measurements, lotQty) {
  /* 1. 测量 FAIL → 强制 REJ */
  if (hasMeasurementFail(measurements)) return 'REJ';

  /* 2. defects 超 AQL → REJ（复用已有 autoJudgeByAql）*/
  if (Array.isArray(defects) && defects.length > 0 && lotQty > 0) {
    const judgment = autoJudgeByAql(lotQty, defects);
    if (judgment && judgment.result === 'REJ') return 'REJ';
  }

  /* 3. 使用用户选择的原始结果 */
  return baseResult || 'PASS';
}

function saveRecord() {
  const date     = getVal('f_date');
  const supplier = getVal('f_supplier');
  if (!date)     { showToast('请填写来料日期', 'error'); return; }
  if (!supplier) { showToast('请填写供应商名称', 'error'); return; }

  const qty    = parseInt(getVal('f_qty')) || 0;
  let   smpRaw = getVal('f_sampleQty');
  /* 保存前二次校验：如果 qty 有值，sampleQty 应与 AQL 推荐一致 */
  const recommendSmp = qty > 0 ? getAqlSampleSize(qty) : 0;
  const smpEl2       = document.getElementById('f_sampleQty');
  const isNewRec     = (typeof editingId === 'undefined' || editingId === null);
  const wasManual    = smpEl2?.dataset.manualEdit === '1';
  if (recommendSmp > 0) {
    const curSmp = parseInt(smpRaw) || 0;
    if (isNewRec && curSmp !== recommendSmp && !wasManual) {
      /* 新增且未手动修改：自动同步 */
      smpRaw = String(recommendSmp);
      if (smpEl2) smpEl2.value = recommendSmp;
    } else if (curSmp !== recommendSmp && wasManual) {
      /* 手动修改过且与推荐不一致：提示用户确认 */
      if (!confirm(`当前抽查数量 ${curSmp} 与 AQL Level II 推荐值 ${recommendSmp} 不一致，是否继续保存？`)) return;
    }
  }
  const sample = smpRaw !== '' ? (parseInt(smpRaw) || 0) : null;

  /* ── 从不良明细自动计算 pass / fail ── */
  initDefectLib();  /* 确保库已初始化 */
  const validDefects = _defectRows.filter(d => d.desc || d.qty > 0);
  const failFromDefs = validDefects.reduce((s,d) => s+(Number(d.qty)||0), 0);
  const hasDefects   = validDefects.length > 0;
  if (hasDefects) _checkUnknownDefects(validDefects);

  let fail, pass;
  if (hasDefects) {
    /* 有明细：用明细合计 */
    fail = failFromDefs;
    if (sample != null && fail > sample) {
      showToast('不良数量合计不能大于抽查数量。', 'error'); return;
    }
    pass = sample != null ? Math.max(0, sample - fail) : 0;

    /* PASS 但 defects 超 AQL 时警告（用户可确认继续）*/
    const resultSel = getVal('f_result');
    const judgment  = autoJudgeByAql(qty, validDefects);
    if (judgment && judgment.result === 'REJ' && resultSel === 'PASS') {
      const msg = `当前不良数量已超过 AQL 允收（${judgment.reasons.join('；')}），建议判定为 REJ，是否继续保存为 PASS？`;
      if (!confirm(msg)) return;
    }
  } else {
    /* 无明细：沿用旧字段（兼容旧数据 / 用户未填明细场景）*/
    fail = parseInt(getVal('f_fail')) || 0;
    pass = parseInt(getVal('f_pass')) || (sample != null ? Math.max(0, sample - fail) : 0);
  }

  /* ── defect 简要文本自动生成 ── */
  let defect = getVal('f_defect');
  if (!defect && hasDefects) {
    defect = _genDefectText();
  }

  /* ── 组装 defects 数组（只保留有实质内容的行）── */
  const defectsArr = hasDefects ? validDefects.map(d => ({
    desc:     d.desc,
    qty:      Number(d.qty) || 0,
    level:    d.level,
    category: d.category,
    remark:   d.remark || '',
  })) : undefined;

  /* 测量数据 */
  const validMeas = _measRows.filter(m => m.item ||
    (m.measureType==='single' ? m.values.some(v=>v!=='') :
     (m.lValues||[]).some(v=>v!=='') || (m.wValues||[]).some(v=>v!=='')));
  const measArr = validMeas.length > 0 ? validMeas.map(m => {
    const combinedStd = _combineMeasStandard(m);
    return {
      item:        m.item        || '',
      standard:    combinedStd,         /* 组合后的 standard（供 IQC 报告读取）*/
      measureType: m.measureType || 'single',
      standardL:   m.standardL  || '',
      standardW:   m.standardW  || '',
      standardH:   m.standardH  || '',
      tolerance:   m.tolerance  || '',
      toleranceL:  m.toleranceL || '',
      toleranceW:  m.toleranceW || '',
      toleranceH:  m.toleranceH || '',
      values:      m.values     || [],
      lValues:     m.lValues    || [],
      wValues:     m.wValues    || [],
      hValues:     m.hValues    || [],
      avg:         m.avg        || '',
      result:      m.result     || '',
    };
  }) : undefined;

  const rec = {
    date, inspDate: getVal('f_inspDate') || date,
    supplier, client: getVal('f_client'), productNo: getVal('f_productNo'),
    productName: getVal('f_productName'), deliveryNo: getVal('f_deliveryNo'),
    type: getVal('f_type'), qty, sampleQty: sample, pass, fail,
    defectRate: sample > 0 ? (fail/sample*100).toFixed(2)+'%' : (getVal('f_defectRate') || '0.00%'),
    result: getFinalRecordResult(
      getVal('f_result'), defectsArr, measArr,
      Number(getVal('f_qty')) || 0
    ), defect,
    qc: getVal('f_qc'), remark: getVal('f_remark'),
    ...(defectsArr ? { defects: defectsArr } : {}),
    ...(measArr   ? { measurements: measArr } : {}),
  };

  if (editingId !== null) {
    const idx = state.records.findIndex(r => r.id === editingId);
    if (idx !== -1) state.records[idx] = { ...state.records[idx], ...rec };
  } else {
    rec.id = state.nextId++;
    state.records.push(rec);
  }

  persist();
  closeModalDirect();
  showToast(editingId !== null ? '记录已更新 ✓' : '记录已添加 ✓', 'success');
  renderSupplierDatalist();   /* 新供应商/客户保存后立即进入下拉选项 */
  renderCustomerDatalist();

  /* 刷新当前页 */
  if (currentPage === 'dashboard') renderDashboard();
  if (currentPage === 'records')   renderRecordsTable();
  if (currentPage === 'analysis')  renderAnalysis();
  if (currentPage === 'suppliers') renderSuppliers();
  updateTopKpis();
}

function deleteRecord(id) {
  if (!can('deleteRecord')) { showToast('当前账号无权限执行此操作', 'error'); return; }
  if (!confirm('确认删除该验货记录？此操作不可撤销。')) return;
  state.records = state.records.filter(r => r.id !== id);
  _selectedIds.delete(id);   /* 清掉已选状态 */
  persist();
  showToast('记录已删除', 'info');
  filterRecords();
  updateTopKpis();
  if (currentPage === 'dashboard') renderDashboard();
  if (currentPage === 'analysis')  renderAnalysis();
  if (currentPage === 'suppliers') renderSuppliers();
}

/* ════════════════════════════════════════
   §13  REPORTS
════════════════════════════════════════ */
function renderDailyReport() {
  const dateEl = document.getElementById('dailyDate');
  if (!dateEl) return;
  if (!dateEl.value) dateEl.value = todayStr();
  const date = dateEl.value;
  const data = recs().filter(r => r.date === date || r.inspDate === date);

  const total   = data.length;
  const pass    = data.filter(r=>isPass(r)).length;
  const fail    = data.filter(r=>isFail(r)).length;
  const passR   = total ? (pass/total*100).toFixed(1) : 0;
  const totalQ  = data.reduce((s,r)=>s+(Number(r.qty)||0), 0);

  const defects = (() => {
    const dm = {};
    data.forEach(r => {
      _splitDefect(r.defect).forEach(d => { dm[d] = (dm[d] || 0) + 1; });
    });
    return Object.keys(dm);
  })();

  document.getElementById('dailyReportBody').innerHTML = `
    <div class="report-body">
      <div class="report-company-header">
        <div class="report-company-name">东莞兴信塑胶制品有限公司</div>
        <div class="report-doc-title">品质日报 · 东莞兴信</div>
      </div>
      <div class="report-meta">
        <div class="meta-item"><div class="meta-label">报告日期</div><div class="meta-value">${date}</div></div>
        <div class="meta-item"><div class="meta-label">验货批次</div><div class="meta-value">${total} 批</div></div>
        <div class="meta-item"><div class="meta-label">来料总量</div><div class="meta-value">${totalQ.toLocaleString()} 件</div></div>
        <div class="meta-item"><div class="meta-label">PASS 批次</div><div class="meta-value text-green">${pass} 批</div></div>
        <div class="meta-item"><div class="meta-label">FAIL 批次</div><div class="meta-value text-red">${fail} 批</div></div>
        <div class="meta-item"><div class="meta-label">PASS 率</div>
          <div class="meta-value ${passR>=80?'text-green':passR>=60?'text-yellow':'text-red'}">${passR}%</div></div>
      </div>
      <div class="report-section">
        <div class="report-section-title">验货明细</div>
        ${total===0
          ? '<div style="color:var(--text-dim);padding:20px;text-align:center">该日期暂无验货记录</div>'
          : `<table class="report-table"><thead><tr>
              <th>供应商</th><th>货号</th><th>款式</th><th>类型</th>
              <th>来料数量</th><th>抽查数</th><th>FAIL数</th><th>不良率</th>
              <th>不良现象</th><th>判定</th><th>检验员</th>
             </tr></thead><tbody>
             ${data.map(r=>`<tr>
               <td>${r.supplier}</td><td>${r.productNo||'-'}</td><td>${r.productName||'-'}</td>
               <td>${r.type}</td><td>${(r.qty||0).toLocaleString()}</td>
               <td>${r.sampleQty||'-'}</td><td>${r.fail||0}</td>
               <td>${r.sampleQty != null ? (r.defectRate||'-') : '—'}</td><td>${r.defect||'-'}</td>
               <td><span class="badge ${isPass(r)?'badge-pass':'badge-rej'}">${r.result}</span></td>
               <td>${r.qc||'-'}</td>
             </tr>`).join('')}
             </tbody></table>`}
      </div>
      ${fail>0&&defects.length ? `
      <div class="report-section">
        <div class="report-section-title">不良问题汇总</div>
        <div class="report-conclusion">
          <div class="conclusion-title">重点问题</div>
          <ul class="conclusion-items">${defects.map(d=>`<li>${d}</li>`).join('')}</ul>
        </div>
      </div>` : ''}
      <div style="margin-top:24px;display:flex;justify-content:space-between;font-size:12px;color:var(--text-dim)">
        <span>制表人：______________</span>
        <span>主管审核：______________</span>
        <span>打印时间：${new Date().toLocaleString('zh-CN')}</span>
      </div>
    </div>`;
}

function renderWeeklyReport() {
  const dateEl = document.getElementById('weeklyDate');
  if (!dateEl) return;
  if (!dateEl.value) dateEl.value = weekStart();
  const ws   = dateEl.value;
  const we   = weekEnd(ws);
  const data = recs().filter(r => r.date >= ws && r.date <= we);

  const total = data.length;
  const fail  = data.filter(r=>isFail(r)).length;
  const pass  = total - fail;
  const passR = total ? (pass/total*100).toFixed(1) : 0;
  const totalQ= data.reduce((s,r)=>s+(Number(r.qty)||0),0);
  const byS   = groupBy(data, 'supplier');

  document.getElementById('weeklyReportBody').innerHTML = `
    <div class="report-body">
      <div class="report-company-header">
        <div class="report-company-name">东莞兴信塑胶制品有限公司</div>
        <div class="report-doc-title">品质周报 · 东莞兴信</div>
      </div>
      <div class="report-meta">
        <div class="meta-item"><div class="meta-label">统计周期</div><div class="meta-value">${ws} ~ ${we}</div></div>
        <div class="meta-item"><div class="meta-label">验货批次</div><div class="meta-value">${total} 批</div></div>
        <div class="meta-item"><div class="meta-label">来料总量</div><div class="meta-value">${totalQ.toLocaleString()} 件</div></div>
        <div class="meta-item"><div class="meta-label">PASS 批次</div><div class="meta-value text-green">${pass} 批</div></div>
        <div class="meta-item"><div class="meta-label">FAIL 批次</div><div class="meta-value text-red">${fail} 批</div></div>
        <div class="meta-item"><div class="meta-label">PASS 率</div>
          <div class="meta-value ${passR>=80?'text-green':passR>=60?'text-yellow':'text-red'}">${passR}%</div></div>
      </div>
      <div class="report-section">
        <div class="report-section-title">供应商周度汇总</div>
        <table class="report-table"><thead><tr>
          <th>供应商</th><th>验货批次</th><th>PASS</th><th>FAIL</th><th>退货率</th><th>风险等级</th>
        </tr></thead><tbody>
        ${Object.entries(byS).map(([s,list])=>{
          const f=list.filter(r=>isFail(r)).length;
          const rt=list.length?f/list.length:0;
          const rk=getRisk(rt);
          const rkl={low:'正常',mid:'风险',high:'高风险'}[rk];
          return `<tr>
            <td>${s}</td><td>${list.length}</td><td>${list.length-f}</td><td>${f}</td>
            <td style="color:${rk==='high'?'var(--red)':rk==='mid'?'var(--yellow)':'var(--green)'};font-weight:600">${(rt*100).toFixed(1)}%</td>
            <td><span class="badge ${rk==='high'?'badge-rej':rk==='mid'?'badge-cond':'badge-pass'}">${rkl}</span></td>
          </tr>`;
        }).join('')}
        </tbody></table>
      </div>
      <div class="report-section">
        <div class="report-section-title">本周不良现象分析</div>
        ${buildDefectTable(data)}
      </div>
      <div style="margin-top:24px;display:flex;justify-content:space-between;font-size:12px;color:var(--text-dim)">
        <span>制表人：______________</span><span>品质主管审核：______________</span>
        <span>打印时间：${new Date().toLocaleString('zh-CN')}</span>
      </div>
    </div>`;
}

function buildDefectTable(data) {
  const dm = {};
  data.forEach(r => {
    _splitDefect(r.defect).forEach(d => { dm[d] = (dm[d] || 0) + 1; });
  });
  const items = Object.entries(dm).sort((a,b)=>b[1]-a[1]);
  if (!items.length) return '<div style="color:var(--text-dim);padding:10px">本期无不良现象记录</div>';
  const SUGGEST = {
    '大小眼':'加强眼睛对称性检验，增加作业员培训',
    '眼贴歪':'检查眼睛定位辅助工具是否到位',
    '止口偏大':'检查车缝工序尺寸管控标准',
    '大小脚':'模具/版型全面检查，加强首件确认',
    '斜眼':'严格控制眼睛粘贴工序，使用定位治具',
    '爆口':'检查缝线张力及针距设定',
    '线头':'增加裁线工序巡检频次，加强尾检',
    '色差':'加强来料色卡比对确认，严格进行颜色管控',
    '形状不良':'模具及版型全面检查',
    '咪咪眼':'调整眼睛粘贴治具，重新培训作业员',
    '缝线不匀':'检查设备状态及作业员操作技能',
    '轻微色差':'加强色卡管控，供应商整改',
  };
  return `<table class="report-table"><thead><tr>
    <th>不良现象</th><th>出现次数</th><th>频率</th><th>整改建议</th>
  </tr></thead><tbody>
  ${items.map(([d,cnt])=>`<tr>
    <td>${d}</td><td>${cnt}</td><td>${(cnt/data.length*100).toFixed(1)}%</td>
    <td style="color:var(--text-dim)">${SUGGEST[d]||'持续监控，加强巡检频次'}</td>
  </tr>`).join('')}
  </tbody></table>`;
}

function populateSupplierSelect() {
  const sel = document.getElementById('supplierSelect');
  if (!sel) return;
  const list = [...new Set(recs().map(r=>r.supplier))].sort();
  sel.innerHTML = '<option value="">-- 请选择供应商 --</option>' +
    list.map(s=>`<option value="${s}">${s}</option>`).join('');
}

function renderSupplierReport() {
  const sel = document.getElementById('supplierSelect');
  if (!sel || !sel.value) return;
  const name = sel.value;
  const data = recs().filter(r=>r.supplier===name);
  const total= data.length;
  const fail = data.filter(r=>isFail(r)).length;
  const rate = total ? fail/total : 0;
  const risk = getRisk(rate);
  const RL   = {low:'正常', mid:'风险', high:'高风险'};
  const qty  = data.reduce((s,r)=>s+(Number(r.qty)||0),0);
  const prods= [...new Set(data.map(r=>r.productName).filter(Boolean))];
  const first= data.map(r=>r.date).sort()[0]||'-';
  const last = data.map(r=>r.date).sort().reverse()[0]||'-';

  document.getElementById('supplierReportBody').innerHTML = `
    <div class="report-body">
      <div class="report-company-header">
        <div class="report-company-name">东莞兴信塑胶制品有限公司</div>
        <div class="report-doc-title">供应商质量报告 · ${name}</div>
      </div>
      <div class="report-meta">
        <div class="meta-item"><div class="meta-label">供应商</div><div class="meta-value">${name}</div></div>
        <div class="meta-item"><div class="meta-label">风险等级</div>
          <div class="meta-value"><span class="badge ${risk==='high'?'badge-rej':risk==='mid'?'badge-cond':'badge-pass'}">${RL[risk]}</span></div></div>
        <div class="meta-item"><div class="meta-label">统计期间</div><div class="meta-value">${first} ~ ${last}</div></div>
        <div class="meta-item"><div class="meta-label">验货批次</div><div class="meta-value">${total} 批</div></div>
        <div class="meta-item"><div class="meta-label">来料总量</div><div class="meta-value">${qty.toLocaleString()} 件</div></div>
        <div class="meta-item"><div class="meta-label">综合退货率</div>
          <div class="meta-value" style="color:${risk==='high'?'var(--red)':risk==='mid'?'var(--yellow)':'var(--green)'};font-weight:700">${(rate*100).toFixed(1)}%</div></div>
      </div>
      <div class="report-section">
        <div class="report-section-title">验货历史记录</div>
        <table class="report-table"><thead><tr>
          <th>日期</th><th>货号</th><th>款式</th><th>来料数量</th>
          <th>抽查数</th><th>不良率</th><th>不良现象</th><th>判定</th>
        </tr></thead><tbody>
        ${data.sort((a,b)=>b.date.localeCompare(a.date)).map(r=>`<tr>
          <td>${r.date}</td><td>${r.productNo||'-'}</td><td>${r.productName||'-'}</td>
          <td>${(r.qty||0).toLocaleString()}</td><td>${r.sampleQty != null ? r.sampleQty : '—'}</td>
          <td style="color:${(parseRate(r.defectRate)??0)>=15?'var(--red)':(parseRate(r.defectRate)??0)>=5?'var(--yellow)':'var(--green)'};font-weight:600">${r.sampleQty != null ? (r.defectRate||'-') : '—'}</td>
          <td>${r.defect||'-'}</td>
          <td><span class="badge ${isPass(r)?'badge-pass':'badge-rej'}">${r.result}</span></td>
        </tr>`).join('')}
        </tbody></table>
      </div>
      <div class="report-section">
        <div class="report-section-title">不良分析 &amp; 整改建议</div>
        ${buildDefectTable(data)}
      </div>
      <div class="report-conclusion">
        <div class="conclusion-title">质量评价结论</div>
        <ul class="conclusion-items">
          <li>供应商 <strong>${name}</strong> 累计验货 ${total} 批次，来料合计 ${qty.toLocaleString()} 件</li>
          <li>综合退货率 ${(rate*100).toFixed(1)}%，风险等级：<strong>${RL[risk]}</strong></li>
          ${fail>0?`<li>共 ${fail} 批判定 REJ/FAIL，建议加强来料检验频次</li>`:'<li>历史质量稳定，暂无高风险批次</li>'}
          <li>涉及产品：${prods.slice(0,5).join('、')}${prods.length>5?'等':''}</li>
          ${risk==='high'?'<li style="color:var(--red)">⚠ 建议启动供应商质量专项改进，要求提交8D报告</li>':''}
          ${risk==='mid' ?'<li style="color:var(--yellow)">⚠ 建议持续关注，加强来料首件确认</li>':''}
        </ul>
      </div>
      <div style="margin-top:24px;display:flex;justify-content:space-between;font-size:12px;color:var(--text-dim)">
        <span>品质部：______________</span>
        <span>SQE确认：______________</span>
        <span>报告日期：${todayStr()}</span>
      </div>
    </div>`;
}

/* ════════════════════════════════════════
   §14  EXPORT
════════════════════════════════════════ */
function exportPDF(type) {
  /* 日报 / 周报 / 供应商报告：白底 A4 画布，不走浏览器打印 */
  const page = type || currentPage;
  if (page === 'daily'           || page === 'daily-report')    { exportReportPDF('daily');    return; }
  if (page === 'weekly'          || page === 'weekly-report')   { exportReportPDF('weekly');   return; }
  if (page === 'supplier-report' || page === 'supplier')        { exportReportPDF('supplier'); return; }
  /* 其他页面保持浏览器打印 */
  showToast('正在调用打印对话框，可选择"另存为PDF"…', 'info');
  setTimeout(() => window.print(), 400);
}

function exportCSV() {
  if (!can('exportData')) { showToast('当前账号无权限执行此操作', 'error'); return; }
  try {
    const data = filteredRecs.length ? filteredRecs : recs();
    const HDR  = ['ID','来料日期','检验日期','供应商','客户','货号','款式名称','类型',
                  '来料数量','抽查数量','PASS数','FAIL数','不良率','不良现象','判定结果','检验员','备注'];
    const rows = data.map(r => [
      r.id, r.date, r.inspDate, r.supplier, r.client, r.productNo, r.productName,
      r.type, r.qty, r.sampleQty, r.pass, r.fail, r.defectRate, r.defect, r.result, r.qc, r.remark,
    ].map(v => `"${String(v==null?'':v).replace(/"/g,'""')}"`));
    const csv  = '\uFEFF' + [HDR, ...rows].map(r=>r.join(',')).join('\n');
    const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `东莞兴信验货明细_${todayStr()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('CSV 导出成功 ✓', 'success');
  } catch(e) { showToast('导出失败: ' + e.message, 'error'); }
}

/* ════════════════════════════════════════
   §14.5  数据备份与恢复
   ① backupExportJSON   — 导出 JSON 备份
   ② backupImportJSON   — 导入 JSON 备份
   ③ backupClearAll     — 清空所有数据
   ④ backupRestoreSeed  — 恢复示例数据
   ⑤ _backupRefreshAll  — 操作后刷新各页面
   ⑥ _backupLog         — 记录操作日志
   ⑦ _backupStats       — 更新统计信息
   ⑧ _backupConfirm     — 通用二次确认弹窗
════════════════════════════════════════ */

/* ── 刷新所有相关页面 ── */
function _backupRefreshAll() {
  updateTopKpis();
  if (currentPage === 'dashboard')  renderDashboard();
  if (currentPage === 'records')    renderRecordsTable();
  if (currentPage === 'suppliers')  renderSuppliers();
  if (currentPage === 'analysis')   renderAnalysis();
  _backupStats();
}

/* ── 更新备份区统计数字 ── */
function _backupStats() {
  const el = document.getElementById('backupStats');
  if (!el) return;
  const data  = recs();
  const fail  = data.filter(r => isFail(r)).length;
  const supCt = Object.keys(groupBy(data, 'supplier')).length;
  el.innerHTML = `
    <div class="backup-stat">
      <span class="backup-stat-num accent">${data.length}</span>
      <span>条记录</span>
    </div>
    <div class="backup-stat">
      <span class="backup-stat-num">${supCt}</span>
      <span>家供应商</span>
    </div>
    <div class="backup-stat">
      <span class="backup-stat-num ${fail > 0 ? '' : 'green'}">${fail}</span>
      <span>批 REJ</span>
    </div>`;
}

/* ── 操作日志 ── */
function _backupLog(msg, type) {
  const log  = document.getElementById('backupLog');
  const body = document.getElementById('backupLogBody');
  if (!log || !body) return;
  log.style.display = '';
  const now = new Date();
  const ts  = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
  const entry = document.createElement('div');
  entry.className = `backup-log-entry ${type || 'ok'}`;
  entry.innerHTML = `<span class="backup-log-time">${ts}</span><span class="backup-log-msg">${msg}</span>`;
  body.insertBefore(entry, body.firstChild);   /* 最新在顶 */
}

/* ── 通用二次确认弹窗 ──
   options: { title, body, confirmLabel, confirmClass, onConfirm }
*/
function _backupConfirm(options) {
  /* 移除旧弹窗 */
  const old = document.getElementById('backupConfirmOverlay');
  if (old) old.remove();

  const ov = document.createElement('div');
  ov.id        = 'backupConfirmOverlay';
  ov.className = 'backup-confirm-overlay show';

  ov.innerHTML = `
    <div class="backup-confirm-box">
      <div class="backup-confirm-header">
        ${options.icon || '⚠'} ${options.title || '确认操作'}
      </div>
      <div class="backup-confirm-body">${options.body || ''}</div>
      <div class="backup-confirm-footer">
        <button class="btn-secondary" id="bkCancelBtn">取消</button>
        <button class="${options.confirmClass || 'btn-primary'}" id="bkConfirmBtn">
          ${options.confirmLabel || '确认'}
        </button>
      </div>
    </div>`;

  document.body.appendChild(ov);

  /* 关闭函数 */
  const close = () => { ov.classList.remove('show'); setTimeout(() => ov.remove(), 200); };

  document.getElementById('bkCancelBtn').onclick  = close;
  document.getElementById('bkConfirmBtn').onclick = () => {
    close();
    if (typeof options.onConfirm === 'function') options.onConfirm();
  };
  ov.addEventListener('click', e => { if (e.target === ov) close(); });
}

/* ════════════════
   ① 导出 JSON 备份
════════════════ */
function backupExportJSON() {
  try {
    const data = recs();
    if (!data.length) {
      showToast('当前无数据可备份', 'error');
      return;
    }
    const payload = {
      version:   1,
      exportedAt: new Date().toISOString(),
      source:    '东莞兴信塑胶制品有限公司品质管理系统',
      count:     data.length,
      records:   data,
    };
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob(['\uFEFF' + json], { type: 'application/json;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `兴信QMS数据备份_${todayStr()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`✓ 已导出 ${data.length} 条记录到 JSON 备份文件`, 'success');
    _backupLog(`导出备份 ${data.length} 条记录 → 兴信QMS数据备份_${todayStr()}.json`, 'ok');
  } catch(e) {
    showToast('导出失败：' + e.message, 'error');
    _backupLog('导出失败：' + e.message, 'error');
  }
}

/* ════════════════
   ② 导入 JSON 备份
════════════════ */
function backupImportJSON(event) {
  const file = event.target.files[0];
  event.target.value = '';   /* 允许重复选同一文件 */
  if (!file) return;

  const reader = new FileReader();
  reader.onerror = () => { showToast('文件读取失败，请重试', 'error'); };
  reader.onload  = ev => {
    try {
      /* 解析 JSON */
      const text = ev.target.result.replace(/^\uFEFF/, '');
      const parsed = JSON.parse(text);

      /* 校验格式 */
      const validationError = _backupValidate(parsed);
      if (validationError) {
        showToast('备份文件格式不正确：' + validationError, 'error');
        _backupLog('导入失败：' + validationError, 'error');
        return;
      }

      const incoming = parsed.records || parsed;   /* 兼容旧格式（直接数组） */
      const exportedAt = parsed.exportedAt
        ? new Date(parsed.exportedAt).toLocaleString('zh-CN')
        : '未知时间';

      /* 弹出确认，让用户选择导入模式 */
      _backupConfirm({
        icon:         '⬆',
        title:        '导入 JSON 备份',
        body:         `
          <div>备份文件包含 <strong>${incoming.length}</strong> 条验货记录</div>
          <div style="font-size:11px;color:var(--text-dim);margin-top:4px">导出时间：${exportedAt}</div>
          <div class="backup-mode-radios">
            <label class="backup-mode-label">
              <input type="radio" name="bkMode" value="append" checked />
              <div><b>追加到现有数据</b><div style="font-size:11px;color:var(--text-dim)">当前 ${recs().length} 条 + 备份 ${incoming.length} 条（推荐）</div></div>
            </label>
            <label class="backup-mode-label">
              <input type="radio" name="bkMode" value="replace" />
              <div><b>覆盖当前数据</b><div style="font-size:11px;color:var(--red)">⚠ 当前 ${recs().length} 条记录将被清空</div></div>
            </label>
          </div>`,
        confirmLabel:  '确认导入',
        confirmClass:  'btn-primary',
        onConfirm:    () => {
          const mode = document.querySelector('input[name="bkMode"]:checked')?.value || 'append';
          _backupDoImport(incoming, mode);
        },
      });

    } catch(e) {
      showToast('备份文件格式不正确：' + e.message, 'error');
      _backupLog('导入失败（JSON解析错误）：' + e.message, 'error');
    }
  };
  reader.readAsText(file, 'UTF-8');
}

/* 执行实际写入 */
function _backupDoImport(incoming, mode) {
  try {
    /* 标准化每条记录 */
    const normalized = incoming.map(r => ({
      id:          state.nextId++,
      date:        r.date        || '',
      inspDate:    r.inspDate    || r.date || '',
      supplier:    r.supplier    || r.厂名 || '',
      client:      r.client      || r.客名 || '',
      productNo:   r.productNo   || r.款号 || '',
      productName: r.productName || r.款式 || '',
      deliveryNo:  r.deliveryNo  || r.单号 || '',
      type:        r.type        || '成品',
      qty:         r.qty         || 0,
      sampleQty:   r.sampleQty != null ? r.sampleQty : null,
      pass:        r.pass        || 0,
      fail:        r.fail        || 0,
      defectRate:  r.defectRate  || '',
      result:      r.result      || 'PASS',
      defect:      r.defect      || '',
      qc:          r.qc          || '',
      remark:      r.remark      || '',
    }));

    if (mode === 'replace') {
      state.records = normalized;
      state.nextId  = normalized.length + 1;
    } else {
      state.records.push(...normalized);
    }
    persist();

    const modeLabel = mode === 'replace' ? '覆盖' : '追加';
    showToast(`✓ 已${modeLabel}导入 ${normalized.length} 条备份记录`, 'success');
    _backupLog(`${modeLabel}导入备份 ${normalized.length} 条记录`, 'ok');
    _backupRefreshAll();
  } catch(e) {
    showToast('导入写入失败：' + e.message, 'error');
    _backupLog('导入写入失败：' + e.message, 'error');
  }
}

/* 格式校验：返回错误描述字符串，或 null 表示通过 */
function _backupValidate(parsed) {
  /* 支持两种格式：
     1. { version, records: [...] }  — 本系统导出格式
     2. [...]                        — 直接数组（简单兼容）
  */
  const arr = Array.isArray(parsed)
    ? parsed
    : (parsed && Array.isArray(parsed.records) ? parsed.records : null);

  if (!arr) return '文件不是有效的 JSON 数组或备份包';
  if (arr.length === 0) return '备份文件中没有记录（空数组）';

  /* 检查必要字段：至少80%的记录要有 date 和 supplier */
  const REQUIRED = ['date', 'supplier'];
  const validCount = arr.filter(r =>
    r && typeof r === 'object' &&
    REQUIRED.every(f => r[f] != null && String(r[f]).trim() !== '')
  ).length;

  if (validCount / arr.length < 0.8) {
    return `缺少必填字段（date / supplier），仅 ${validCount}/${arr.length} 条记录有效`;
  }

  return null;   /* 通过 */
}

/* ════════════════
   ③ 清空所有数据
════════════════ */
function backupClearAll() {
  _backupConfirm({
    icon:         '⊗',
    title:        '清空当前数据',
    body:         `
      当前共有 <strong>${recs().length}</strong> 条验货记录。
      <span class="warn-text">⚠ 此操作将删除所有记录且无法撤销！</span>
      <div style="margin-top:8px;font-size:12px;color:var(--text-dim)">
        建议先点击"取消"，使用"导出数据备份"保存数据后再清空。
      </div>`,
    confirmLabel: '确认清空',
    confirmClass: 'btn-secondary',   /* 不用 btn-primary，减少误操作 */
    onConfirm:   () => {
      const count = recs().length;
      state.records = [];
      state.nextId  = 1;
      persist();
      showToast(`已清空全部 ${count} 条记录`, 'info');
      _backupLog(`清空数据 ${count} 条记录`, 'warn');
      _backupRefreshAll();
    },
  });
}

/* ════════════════
   ④ 恢复示例数据
════════════════ */
function backupRestoreSeed() {
  _backupConfirm({
    icon:         '↺',
    title:        '恢复示例数据',
    body:         `
      将用系统内置的 <strong>${SEED_RECORDS.length}</strong> 条模拟验货记录
      <strong>覆盖</strong>当前全部 ${recs().length} 条数据。
      <span class="warn-text">⚠ 当前数据将被清空，建议先备份！</span>`,
    confirmLabel: '确认恢复',
    confirmClass: 'btn-primary',
    onConfirm:   () => {
      state.records = SEED_RECORDS.map(r => Object.assign({}, r));
      state.nextId  = SEED_RECORDS.length + 1;
      persist();
      showToast(`✓ 已恢复 ${SEED_RECORDS.length} 条示例数据`, 'success');
      _backupLog(`恢复示例数据 ${SEED_RECORDS.length} 条`, 'ok');
      _backupRefreshAll();
    },
  });
}

/* ════════════════════════════════════════
   §15  IMPORT v3 — 精确匹配兴信验货表结构
   支持 .xlsx / .xls / .csv
   ① 自动跳过标题行，识别真实表头行
   ② 精确映射兴信字段（来料日/厂名/款号…）
   ③ Excel序列日期自动转换
   ④ 取消/重选不影响localStorage
   ⑤ 只有点击"确认导入"才写入数据
════════════════════════════════════════ */

/* ─── 兴信验货表：字段映射总表 ───
   key  = Excel列名（含所有变体）
   val  = 内部字段名
*/
const FIELD_MAP = {
  /* ── 来料日期 ── */
  '来料日':    'date', '来料日期': 'date', '到货日期': 'date',
  '收货日期':  'date', '到货日':   'date',
  '来货日期':  'date', '来货日':   'date',   /* 格式A */

  /* ── 检验日期 ── */
  '检验日':    'inspDate', '检验日期': 'inspDate', '验货日期': 'inspDate',

  /* ── 供应商 / 厂名 ── */
  '厂名':    'supplier', '供应商': 'supplier', '加工厂': 'supplier',
  '车缝厂':  'supplier', '供方':   'supplier', '厂家':   'supplier',
  '供應商':  'supplier',

  /* ── 客户 / 客名 ── */
  '客名': 'client', '客户': 'client', '品牌': 'client',
  '客戶': 'client', '客户名称': 'client',

  /* ── 送货单号 ── */
  '单号':       'deliveryNo', '送货编号':  'deliveryNo', '送货单号': 'deliveryNo',
  '送货单':     'deliveryNo', '送货号':    'deliveryNo', '送貨單號': 'deliveryNo',
  'DN':         'deliveryNo', 'DN No':     'deliveryNo', 'Delivery No': 'deliveryNo',
  'deliveryNo': 'deliveryNo',

  /* ── 订单号（采购订单，独立字段，不与送货单号混淆）── */
  '订单号':   'orderNo', '订单编号': 'orderNo', 'PO': 'orderNo', 'PO号': 'orderNo',
  'PO Number':'orderNo',

  /* ── 款号 / 货号 ── */
  '款号': 'productNo', '货号': 'productNo', '产品编号': 'productNo',
  '编号': 'productNo', '物料编号': 'productNo', 'Item No': 'productNo', 'ITEM': 'productNo',

  /* ── 款式 / 产品名称 ── */
  '款式':     'productName', '名称':     'productName', '产品名称': 'productName',
  '款式名称': 'productName', '品名':     'productName', '產品名稱': 'productName',

  /* ── 来料数量 ── */
  '数量':     'qty', '来料数量': 'qty', '来货数量': 'qty',
  '收货数量': 'qty', '来货数':  'qty', '来料数':   'qty',   /* 格式A/B */
  '订单数量': 'orderQty',   /* 格式A 订单数量单独字段，不覆盖qty */

  /* ── 抽查数量 ── */
  '抽查':     'sampleQty', '抽查数量': 'sampleQty', '抽验数': 'sampleQty',
  '抽查数':   'sampleQty', '抽检数':   'sampleQty', '检验数量': 'sampleQty',
  '简介':     null,   /* 格式A 简介跳过 */
  '单位':     null,   /* 格式A 单位跳过 */

  /* ── 成品/半成品 ── */
  '成品/半成品': 'type', '类型': 'type',

  /* ── 判定结果 ── */
  '判定结果': 'result', '结果判断': 'result', '判定':   'result',
  '检验结果': 'result', '确认结果': 'result2', '确认结': 'result2',

  /* ── 问题描述 / 不良现象 ── */
  '问题描述': 'defect', '不良现象': 'defect', '不良描述': 'defect',
  '不良内容': 'defect', '问题':     'defect', '问题点':  'defect',

  /* ── 检验员 ── */
  '检验员': 'qc', 'QC': 'qc', '检验人': 'qc', '验货员': 'qc', '检查员': 'qc',

  /* ── 确认人 ── */
  '确认人': 'confirmBy',

  /* ── 备注 ── */
  '备注': 'remark', '说明': 'remark', '备注说明': 'remark',
};

/* 必须命中才允许导入的字段 */
const REQUIRED_FIELDS = ['date', 'supplier'];

/* 内部字段的中文显示名 */
const FIELD_LABEL = {
  date:'来料日期', inspDate:'检验日期', supplier:'供应商', client:'客户',
  deliveryNo:'送货单号', orderNo:'订单号',
  productNo:'货号', productName:'款式名称', type:'类型',
  qty:'来料数量', sampleQty:'抽查数量', result:'判定结果', result2:'确认结果',
  defect:'不良现象', qc:'检验员', confirmBy:'确认人', remark:'备注',
  orderQty:'订单数量',
};

/* 表头行识别关键词（命中≥3个即认定为表头行） */
const HEADER_KEYWORDS = [
  '来料日','来货日','检验日','到货日','厂名','供应商',
  '客名','客户','款号','货号','款式','名称',
  '数量','来货数','抽查','判定','结果','检验结果','问题描述',
  '不良现象','检验员','验货员',
];

/* ─── 运行时状态（不写入localStorage，仅内存） ─── */
let _importParsedRows   = [];   // 清洗后的数据行（对象数组）
let _importMappedFields = {};   // { colName → fieldName | null }
let _importSheetName    = '';
let _importHeaderRowIdx = -1;   // 识别到的表头行索引
let _importErrors       = [];   // { fatal:bool, msg:string }
let _importWarnings     = [];   // { msg:string }

/* ═══════════════════════════════
   拖拽事件
═══════════════════════════════ */
function importDragOver(e) {
  e.preventDefault();
  const z = document.getElementById('importZone');
  if (z) z.classList.add('dragover');
}
function importDragLeave(e) {
  const z = document.getElementById('importZone');
  if (z) z.classList.remove('dragover');
}
function handleDrop(e) {
  e.preventDefault();
  const z = document.getElementById('importZone');
  if (z) z.classList.remove('dragover');
  const file = e.dataTransfer?.files[0];
  if (file) _startImport(file);
}
function handleFileImport(e) {
  const file = e.target.files[0];
  e.target.value = '';   /* 允许重复选同一文件 */
  if (file) _startImport(file);
}

/* ═══════════════════════════════
   重置 / 取消（不碰 localStorage）
═══════════════════════════════ */
function importReset() {
  /* 清空内存状态 */
  _importParsedRows   = [];
  _importMappedFields = {};
  _importSheetName    = '';
  _importHeaderRowIdx = -1;
  _importErrors       = [];
  _importWarnings     = [];
  /* 隐藏所有面板 */
  ['importMapPanel','importErrorPanel','importActionRow','importProgressWrap']
    .forEach(id => _setDisplay(id, 'none'));
  /* 清空预览 */
  const prev = document.getElementById('importPreview');
  if (prev) prev.innerHTML = '';
  /* 恢复拖拽区 */
  const zone = document.getElementById('importZone');
  if (zone) zone.style.display = '';
  /* 重置确认按钮 */
  const btn = document.getElementById('importConfirmBtn');
  if (btn) { btn.disabled = false; btn.textContent = '✓ 确认导入'; }
}

/* _setDisplay 工具 */
function _setDisplay(id, val) {
  const el = document.getElementById(id);
  if (el) el.style.display = val;
}

/* ═══════════════════════════════
   进度条
═══════════════════════════════ */
function _setProgress(pct, label) {
  _setDisplay('importProgressWrap', '');
  const bar = document.getElementById('importProgressBar');
  const lbl = document.getElementById('importProgressLabel');
  if (bar) bar.style.width = Math.min(pct, 100) + '%';
  if (lbl) lbl.textContent = label || '处理中…';
}

/* ═══════════════════════════════
   §A  入口：开始导入流程
═══════════════════════════════ */
function _startImport(file) {
  const name = file.name.toLowerCase();
  if (!name.endsWith('.xlsx') && !name.endsWith('.xls') && !name.endsWith('.csv')) {
    _showFatalError('不支持的文件格式：' + file.name + '，请使用 .xlsx / .xls / .csv');
    return;
  }
  if (typeof XLSX === 'undefined') {
    _showFatalError('SheetJS 库未加载，请检查网络连接后刷新页面重试');
    return;
  }

  importReset();
  /* 隐藏拖拽区，显示进度 */
  const zone = document.getElementById('importZone');
  if (zone) zone.style.display = 'none';
  _setProgress(10, '正在读取文件：' + file.name);

  const reader = new FileReader();
  reader.onerror = () => _showFatalError('文件读取失败，请重试');
  reader.onload  = ev => {
    try {
      _setProgress(30, '正在解析工作表…');
      const wb = XLSX.read(new Uint8Array(ev.target.result), {
        type:      'array',
        cellDates: false,   /* 保持原始值，日期由我们自己解析 */
        cellNF:    false,
        cellText:  false,
        raw:       true,
      });

      _setProgress(50, '正在识别表头…');
      const sheetName = _pickBestSheet(wb);
      _importSheetName = sheetName;

      /* 把 sheet 转成二维数组（保留原始行列） */
      const ws  = wb.Sheets[sheetName];
      const aoa = XLSX.utils.sheet_to_json(ws, {
        header:   1,        /* 返回二维数组，不自动处理表头 */
        defval:   '',
        raw:      true,
      });

      _setProgress(65, '定位表头行…');
      /* ★ 关键：自动识别表头行 */
      const headerRowIdx = _findHeaderRow(aoa);
      if (headerRowIdx === -1) {
        _showFatalError(
          '未找到有效表头，请检查 Excel 格式。\n' +
          '系统需要找到包含「来料日/厂名/款号/款式/数量/判定结果」的行作为表头。'
        );
        return;
      }
      _importHeaderRowIdx = headerRowIdx;

      /* 取表头行 */
      const headerRow = aoa[headerRowIdx].map(v => String(v || '').trim());

      /* 建字段映射 */
      _setProgress(75, '匹配字段…');
      _importMappedFields = _buildFieldMap(headerRow);

      /* 验证必填字段 */
      _importErrors   = [];
      _importWarnings = [];
      _validateMapping(_importMappedFields);

      /* 取数据行：表头后面所有非空行 */
      _setProgress(85, '清洗数据行…');
      const dataRows = aoa.slice(headerRowIdx + 1).filter(row =>
        row.some(v => String(v || '').trim() !== '')
      );

      if (dataRows.length === 0) {
        _importErrors.push({ fatal: true, msg: '表格中没有找到数据行（表头下方全为空行）' });
      }

      /* 把数据行转成对象数组 */
      _importParsedRows = dataRows.map(row => {
        const obj = {};
        headerRow.forEach((h, i) => {
          if (h) obj[h] = row[i] != null ? row[i] : '';
        });
        return obj;
      });

      _setProgress(100, '解析完成');
      setTimeout(() => {
        _setDisplay('importProgressWrap', 'none');
        _renderMapPanel(headerRow);
        if (_importErrors.length || _importWarnings.length) _renderErrorPanel();
        /* 只要没有 fatal 错误就显示预览和操作行 */
        if (!_importErrors.some(e => e.fatal)) {
          _renderPreviewTable(headerRow);
          _renderActionRow();
        }
      }, 300);

    } catch (err) {
      console.error('[import]', err);
      _showFatalError('文件解析失败：' + err.message + '\n请确认文件未损坏，且为标准 Excel/CSV 格式');
    }
  };
  reader.readAsArrayBuffer(file);
}

/* ═══════════════════════════════
   §B  选最佳 Sheet
═══════════════════════════════ */
function _pickBestSheet(wb) {
  const names = wb.SheetNames;
  /* 优先：含「明细」字样 */
  for (const n of names) {
    if (/明细/.test(n) && !/汇总|报告/.test(n)) return n;
  }
  /* 其次：行数最多的 sheet */
  let best = names[0], bestRows = 0;
  for (const n of names) {
    const ws  = wb.Sheets[n];
    const ref = ws['!ref'];
    if (!ref) continue;
    const range = XLSX.utils.decode_range(ref);
    const rows  = range.e.r - range.s.r;
    if (rows > bestRows) { bestRows = rows; best = n; }
  }
  return best;
}

/* ═══════════════════════════════
   §C  自动识别表头行
   扫描前 10 行，找命中关键词最多的行
═══════════════════════════════ */
function _findHeaderRow(aoa) {
  let bestRow = -1, bestScore = 0;
  const limit = Math.min(10, aoa.length);
  for (let r = 0; r < limit; r++) {
    const cells = aoa[r].map(v => String(v || '').trim());
    let score = 0;
    for (const kw of HEADER_KEYWORDS) {
      if (cells.some(c => c.includes(kw))) score++;
    }
    if (score > bestScore) { bestScore = score; bestRow = r; }
  }
  /* 至少命中 3 个关键词才认定 */
  return bestScore >= 3 ? bestRow : -1;
}

/* ═══════════════════════════════
   §D  建立字段映射
═══════════════════════════════ */
function _buildFieldMap(headerCells) {
  const map = {};   /* { colName → fieldName | null } */
  const usedFields = new Set();

  headerCells.forEach(col => {
    if (!col) { map[col] = null; return; }
    /* 1. 精确匹配 */
    if (FIELD_MAP[col]) {
      const f = FIELD_MAP[col];
      if (!usedFields.has(f)) { map[col] = f; usedFields.add(f); return; }
    }
    /* 2. 去空格大小写不敏感匹配 */
    const normalized = col.replace(/\s+/g, '').toLowerCase();
    let matched = false;
    for (const [k, v] of Object.entries(FIELD_MAP)) {
      if (k.replace(/\s+/g, '').toLowerCase() === normalized && !usedFields.has(v)) {
        map[col] = v; usedFields.add(v); matched = true; break;
      }
    }
    if (matched) return;
    /* 3. 部分包含匹配 */
    const partials = [
      ['来料日', 'date'],       ['到货日', 'date'],       ['来货日', 'date'],
      ['检验日', 'inspDate'],
      ['厂名', 'supplier'],     ['供应商', 'supplier'],
      ['客名', 'client'],       ['客户', 'client'],
      ['款号', 'productNo'],    ['货号', 'productNo'],
      ['款式', 'productName'],  ['名称', 'productName'],
      /* 送货相关 — deliveryNo */
      ['送货单', 'deliveryNo'], ['送货号', 'deliveryNo'], ['DN', 'deliveryNo'],
      ['单号', 'deliveryNo'],
      /* 订单相关 — orderNo（不与送货单混淆） */
      ['订单号', 'orderNo'],    ['PO', 'orderNo'],
      ['数量', 'qty'],          ['抽查', 'sampleQty'],
      ['判定', 'result'],       ['不良', 'defect'],
      ['问题', 'defect'],       ['检验员', 'qc'],          ['验货员', 'qc'],
      ['确认结', 'result2'],    ['确认人', 'confirmBy'],
      ['备注', 'remark'],
    ];
    for (const [kw, f] of partials) {
      if (col.includes(kw) && !usedFields.has(f)) {
        map[col] = f; usedFields.add(f); matched = true; break;
      }
    }
    if (!matched) map[col] = null;
  });
  return map;
}

/* ═══════════════════════════════
   §E  验证必填字段
═══════════════════════════════ */
function _validateMapping(map) {
  const mapped = new Set(Object.values(map).filter(Boolean));
  REQUIRED_FIELDS.forEach(f => {
    if (!mapped.has(f)) {
      _importErrors.push({
        fatal: true,
        msg:   '缺少必填列「' + FIELD_LABEL[f] + '」（' +
               (f === 'date' ? '来料日/到货日期' : '厂名/供应商') +
               '）—— 请确认表格包含该列',
      });
    }
  });
  /* 非必填但建议有的字段 */
  const suggested = ['qty', 'result'];
  suggested.forEach(f => {
    if (!mapped.has(f)) {
      _importWarnings.push({ msg: '建议列「' + (FIELD_LABEL[f]||f) + '」未找到，相关字段将留空或自动推断' });
    }
  });
}

/* ═══════════════════════════════
   §F  显示字段映射面板
═══════════════════════════════ */
function _renderMapPanel(headerCells) {
  const panel = document.getElementById('importMapPanel');
  const grid  = document.getElementById('importMapGrid');
  const stag  = document.getElementById('importSheetTag');
  if (!panel || !grid) return;

  if (stag) {
    stag.textContent =
      'Sheet: ' + _importSheetName +
      ' · 表头第 ' + (_importHeaderRowIdx + 1) + ' 行';
  }

  const mappedCount = Object.values(_importMappedFields).filter(Boolean).length;

  grid.innerHTML = headerCells
    .filter(col => col)   /* 过滤空列名 */
    .map(col => {
      const field = _importMappedFields[col];
      const label = field ? (FIELD_LABEL[field] || field) : null;
      const isReq = field && REQUIRED_FIELDS.includes(field);
      const status = field ? (isReq ? '✓ 必填' : '✓ 已映射') : '— 跳过';
      const stCls  = field ? 'ok' : 'skip';
      return `<div class="import-map-row">
        <span class="import-map-source" title="${col}">${col}</span>
        <span class="import-map-arrow">→</span>
        <span class="import-map-target ${field ? '' : 'unmapped'}">${label || '（不导入）'}</span>
        <span class="import-map-status ${stCls}">${status}</span>
      </div>`;
    }).join('');

  panel.style.display = '';

  /* 统计摘要 */
  const summary = document.createElement('div');
  summary.style.cssText = 'padding:10px 16px;font-size:12px;color:var(--text-dim);border-top:1px solid var(--border)';
  summary.innerHTML =
    '共 <strong style="color:var(--accent)">' + headerCells.filter(c=>c).length + '</strong> 列 · ' +
    '映射 <strong style="color:var(--green)">'  + mappedCount + '</strong> 列 · ' +
    '跳过 <strong>' + (headerCells.filter(c=>c).length - mappedCount) + '</strong> 列 · ' +
    '数据 <strong style="color:var(--accent)">' + _importParsedRows.length + '</strong> 行';
  grid.after(summary);
}

/* ═══════════════════════════════
   §G  显示错误/警告面板
═══════════════════════════════ */
function _renderErrorPanel() {
  const panel = document.getElementById('importErrorPanel');
  const list  = document.getElementById('importErrorList');
  if (!panel || !list) return;

  list.innerHTML = [
    ..._importErrors.map(e =>
      '<li>' + e.msg.replace(/\n/g, '<br>') + '</li>'
    ),
    ..._importWarnings.map(w =>
      '<li class="warn">' + w.msg + '</li>'
    ),
  ].join('');

  panel.style.display = '';
}

/* ═══════════════════════════════
   §H  致命错误：显示提示，恢复选文件状态
═══════════════════════════════ */
function _showFatalError(msg) {
  _setDisplay('importProgressWrap', 'none');
  _importErrors = [{ fatal: true, msg }];
  _importWarnings = [];
  /* 渲染错误面板 */
  const panel = document.getElementById('importErrorPanel');
  const list  = document.getElementById('importErrorList');
  if (panel && list) {
    list.innerHTML = '<li>' + msg.replace(/\n/g, '<br>') + '</li>';
    panel.style.display = '';
  }
  /* 恢复文件选择区，让用户可以重新选文件 */
  const zone = document.getElementById('importZone');
  if (zone) zone.style.display = '';
}

/* ═══════════════════════════════
   §I  数据预览表格
═══════════════════════════════ */
function _renderPreviewTable(headerCells) {
  const el = document.getElementById('importPreview');
  if (!el) return;

  /* 只展示已映射的列（过滤跳过的列） */
  const cols = headerCells
    .filter(col => col && _importMappedFields[col])
    .map(col => ({
      src:   col,
      dst:   _importMappedFields[col],
      label: FIELD_LABEL[_importMappedFields[col]] || _importMappedFields[col],
    }));

  const previewRows = _importParsedRows.slice(0, 15);

  el.innerHTML = `
    <div class="section-card">
      <div class="section-header">
        <span class="section-title">
          数据预览（前 ${previewRows.length} 行 / 共 ${_importParsedRows.length} 行）
        </span>
      </div>
      <div class="import-preview-scroll">
        <table>
          <thead><tr>${cols.map(c => '<th>' + c.label + '</th>').join('')}</tr></thead>
          <tbody>
            ${previewRows.map(row => '<tr>' + cols.map(c => {
              const raw = row[c.src];
              const val = _coerceCell(raw, c.dst);
              return '<td style="' + _cellStyle(c.dst, val) + '">' + _displayCell(val, c.dst) + '</td>';
            }).join('') + '</tr>').join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

/* 单元格显示样式 */
function _cellStyle(field, val) {
  if (field === 'result') {
    const v = String(val || '').toUpperCase();
    if (v === 'PASS') return 'color:var(--green);font-weight:600';
    if (v === 'REJ')  return 'color:var(--red);font-weight:600';
    return 'color:var(--yellow);font-weight:600';
  }
  if (field === 'defectRate') {
    const n = parseFloat(String(val||'').replace('%',''));
    if (n >= 15) return 'color:var(--red);font-weight:600';
    if (n >= 5)  return 'color:var(--yellow);font-weight:600';
    return 'color:var(--green)';
  }
  return '';
}

/* 单元格显示内容 */
function _displayCell(val, field) {
  if (field === 'result') {
    const v = String(val || '').toUpperCase();
    const cls = v === 'PASS' ? 'badge-pass' : v === 'REJ' ? 'badge-rej' : v ? 'badge-cond' : '';
    return val ? '<span class="badge ' + cls + '">' + val + '</span>' : '-';
  }
  const s = String(val == null ? '' : val).trim();
  return s || '-';
}

/* 强制类型：数量字段取整数；抽查数量为空时返回 null */
function _coerceCell(raw, field) {
  if (field === 'sampleQty') {
    const s = String(raw == null ? '' : raw).trim();
    return s !== '' ? _toInt(s) : null;   /* 空→null */
  }
  if (['qty','pass','fail'].includes(field)) {
    return _toInt(raw);
  }
  /* 日期：先尝试解析成可读格式 */
  if (field === 'date' || field === 'inspDate') {
    const d = _parseDate(raw);
    return d || String(raw || '').trim();
  }
  return String(raw == null ? '' : raw).trim();
}

/* ═══════════════════════════════
   §J  操作行（统计 + 按钮）
═══════════════════════════════ */
function _renderActionRow() {
  const row   = document.getElementById('importActionRow');
  const stats = document.getElementById('importActionStats');
  if (!row || !stats) return;

  const total = _importParsedRows.length;
  const dateCol = Object.keys(_importMappedFields).find(k => _importMappedFields[k] === 'date');
  const supCol  = Object.keys(_importMappedFields).find(k => _importMappedFields[k] === 'supplier');

  let valid = 0, skip = 0, dateWarn = 0;
  _importParsedRows.forEach(r => {
    const rawDate = dateCol ? String(r[dateCol] ?? '').trim() : '';
    const rawSup  = supCol  ? String(r[supCol]  ?? '').trim() : '';
    if (!rawDate && !rawSup) { skip++; return; }
    if (rawDate && _parseDate(rawDate) === null) dateWarn++;
    valid++;
  });

  stats.innerHTML =
    '<div class="import-stat-chip"><span class="import-stat-num blue">' + total + '</span><span>总行数</span></div>' +
    '<div class="import-stat-chip"><span class="import-stat-num green">' + valid + '</span><span>可导入</span></div>' +
    (dateWarn ? '<div class="import-stat-chip"><span class="import-stat-num yellow">' + dateWarn + '</span><span>日期异常（将修正）</span></div>' : '') +
    (skip     ? '<div class="import-stat-chip"><span class="import-stat-num">' + skip + '</span><span>空行（跳过）</span></div>' : '');

  row.style.display = '';
}

/* ═══════════════════════════════
   §K  确认导入（唯一写入 localStorage 的入口）
═══════════════════════════════ */
function confirmImport() {
  const btn  = document.getElementById('importConfirmBtn');
  const mode = document.getElementById('importModeSelect')?.value || 'append';

  if (btn) { btn.disabled = true; btn.textContent = '导入中…'; }

  try {
    const M      = _importMappedFields;
    const getCol = f => Object.keys(M).find(k => M[k] === f);

    const dateCol  = getCol('date');
    const inspCol  = getCol('inspDate');
    const supCol   = getCol('supplier');
    const cliCol   = getCol('client');
    const dlvCol   = getCol('deliveryNo');
    const ordCol   = getCol('orderNo');
    const noCol    = getCol('productNo');
    const nameCol  = getCol('productName');
    const typeCol  = getCol('type');
    const qtyCol   = getCol('qty');
    const smpCol   = getCol('sampleQty');
    const passCol  = getCol('pass');
    const failCol  = getCol('fail');
    const rateCol  = getCol('defectRate');
    const resCol   = getCol('result');
    const defCol   = getCol('defect');
    const qcCol    = getCol('qc');
    const res2Col  = getCol('result2');
    const confCol  = getCol('confirmBy');
    const remCol   = getCol('remark');

    const newRecs = [];

    _importParsedRows.forEach(row => {
      /* 读原始值 */
      const rawDate = dateCol ? String(row[dateCol] ?? '').trim() : '';
      const rawSup  = supCol  ? String(row[supCol]  ?? '').trim() : '';

      /* 跳过完全空行 */
      if (!rawDate && !rawSup) return;

      /* 日期解析 */
      const date     = _parseDate(rawDate) || '';
      const inspDate = inspCol ? (_parseDate(String(row[inspCol] ?? '').trim()) || date) : date;

      /* 数值字段：抽查数量为空时存 null */
      const qty    = _toInt(qtyCol  ? row[qtyCol]  : '');
      const smpRaw = smpCol  ? String(row[smpCol] ?? '').trim() : '';
      const smpQty = smpRaw !== '' ? _toInt(smpRaw) : null;   /* 空→null */
      const pass   = _toInt(passCol ? row[passCol] : '');
      const fail   = _toInt(failCol ? row[failCol] : '');

      /* 判定结果 */
      const rawRes = resCol ? String(row[resCol] ?? '').trim() : '';
      const result = _normalizeResult(rawRes) || (fail > 0 ? 'REJ' : 'PASS');

      /* 不良率：只在有抽查数量或 pass+fail 时才计算 */
      let defectRate = rateCol ? String(row[rateCol] ?? '').trim() : '';
      if (!defectRate) {
        const base = (pass + fail) || (smpQty != null ? smpQty : 0);
        /* sampleQty 为 null 且 pass+fail 均为 0 时，不良率留空 */
        defectRate = base > 0 ? (fail / base * 100).toFixed(2) + '%' : (smpQty != null ? '0.00%' : '');
      } else if (!defectRate.includes('%')) {
        const n = parseFloat(defectRate);
        defectRate = isNaN(n) ? '' : (n > 1 ? n.toFixed(2) + '%' : (n * 100).toFixed(2) + '%');
      }

      /* PASS 数量自动推断（仅在 sampleQty 有值时） */
      const passFinal = pass > 0 ? pass : (smpQty != null ? Math.max(0, smpQty - fail) : 0);

      /* 货号：Excel 数值型转整数字符串（去掉 .0） */
      let productNo = noCol ? String(row[noCol] ?? '').trim() : '';
      if (/^\d+\.0$/.test(productNo)) productNo = productNo.replace(/\.0$/, '');

      newRecs.push({
        id:          state.nextId++,
        date,
        inspDate,
        supplier:    rawSup,
        client:      cliCol   ? String(row[cliCol]   ?? '').trim() : '',
        deliveryNo:  dlvCol ? String(row[dlvCol] ?? '').trim() : '',
        orderNo:     ordCol ? String(row[ordCol] ?? '').trim() : '',
        productNo,
        productName: nameCol  ? String(row[nameCol]  ?? '').trim() : '',
        type:        typeCol  ? _normalizeType(String(row[typeCol] ?? '').trim()) : '成品',
        qty,
        sampleQty:   smpQty,
        pass:        passFinal,
        fail,
        defectRate,
        result,
        defect:      defCol   ? String(row[defCol]   ?? '').trim() : '',
        qc:          qcCol    ? String(row[qcCol]    ?? '').trim() : '',
        confirmResult: res2Col ? _normalizeResult(String(row[res2Col] ?? '').trim()) : '',
        confirmBy:   confCol  ? String(row[confCol]  ?? '').trim() : '',
        remark:      remCol   ? String(row[remCol]   ?? '').trim() : '',
      });
    });

    if (newRecs.length === 0) {
      showToast('没有可导入的有效数据，请检查文件内容', 'error');
      if (btn) { btn.disabled = false; btn.textContent = '✓ 确认导入'; }
      return;
    }

    /* ★ 唯一写入 localStorage 的地方 */
    if (mode === 'replace') {
      state.records = newRecs;
      state.nextId  = newRecs.length + 1;
    } else {
      state.records.push(...newRecs);
    }
    persist();

    const modeLabel = mode === 'replace' ? '替换' : '追加';
    showToast('✓ 成功' + modeLabel + '导入 ' + newRecs.length + ' 条记录', 'success');

    /* 重置面板，跳转仪表板 */
    setTimeout(() => {
      importReset();
      showPage('dashboard');
      updateTopKpis();
    }, 700);

  } catch (err) {
    console.error('[confirmImport]', err);
    showToast('导入失败：' + err.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '✓ 确认导入'; }
  }
}

/* ═══════════════════════════════
   §L  工具函数
═══════════════════════════════ */

/* 整数 */
function _toInt(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return isNaN(v) ? 0 : Math.round(v);
  /* 去千分位逗号、常见数量单位，再取整 */
  const cleaned = String(v).trim()
    .replace(/,/g, '')
    .replace(/pcs|PCS|件|个|套|只|条|片|组|双|对/ig, '')
    .trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : Math.round(n);
}

/* 日期解析 —— 支持：
   ① yyyy-mm-dd / yyyy/mm/dd
   ② dd/mm/yyyy 或 mm/dd/yyyy
   ③ Excel 数字序列（如 46090）
   ④ Date 对象字符串（含 T 或空格+冒号）
   ⑤ 中文格式 2026年04月02日
   ⑥ SheetJS 已格式化的日期字符串
*/
function _parseDate(raw) {
  if (raw == null || raw === '') return null;

  /* 如果是 JS Date 对象（cellDates:true 时） */
  if (raw instanceof Date) {
    if (isNaN(raw.getTime())) return null;
    return raw.getFullYear() + '-' +
           _pad(raw.getMonth() + 1) + '-' +
           _pad(raw.getDate());
  }

  const s = String(raw).trim();
  if (!s) return null;

  /* ① 标准格式 yyyy-mm-dd */
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  /* ② yyyy/mm/dd */
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(s)) return s.replace(/\//g, '-');

  /* ③ Excel 数字序列（40000–60000 范围） */
  const num = parseFloat(s);
  if (!isNaN(num) && num > 40000 && num < 60000) {
    /* Excel epoch = 1899-12-30（需修正 1900 闰年 bug） */
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(num) * 86400000);
    if (!isNaN(d.getTime())) {
      return d.getUTCFullYear() + '-' + _pad(d.getUTCMonth() + 1) + '-' + _pad(d.getUTCDate());
    }
  }

  /* ④ 带时间的日期字符串 */
  if (s.includes('T') || (s.includes(' ') && s.includes(':'))) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      return d.getFullYear() + '-' + _pad(d.getMonth() + 1) + '-' + _pad(d.getDate());
    }
  }

  /* ⑤ 中文格式 */
  const cn = s.match(/(\d{4})年(\d{1,2})月(\d{1,2})日?/);
  if (cn) return cn[1] + '-' + _pad(+cn[2]) + '-' + _pad(+cn[3]);

  /* ⑥ dd/mm/yyyy 或 mm/dd/yyyy */
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const [, a, b, y] = slash;
    /* 尝试 yyyy-a-b */
    const d1 = y + '-' + _pad(+a) + '-' + _pad(+b);
    if (_validDate(d1)) return d1;
    const d2 = y + '-' + _pad(+b) + '-' + _pad(+a);
    if (_validDate(d2)) return d2;
  }

  /* ⑦ 短日期：5月4日 / 4月20日（无年份，使用当年）*/
  const shortCn = s.match(/^(\d{1,2})月(\d{1,2})日?$/);
  if (shortCn) {
    const y = new Date().getFullYear();
    return y + '-' + _pad(+shortCn[1]) + '-' + _pad(+shortCn[2]);
  }

  /* ⑧ yyyy.mm.dd */
  const dot = s.match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})$/);
  if (dot) return dot[1] + '-' + _pad(+dot[2]) + '-' + _pad(+dot[3]);

  return null;
}

function _pad(n)          { return String(n).padStart(2, '0'); }
function _validDate(s)    { return !isNaN(new Date(s).getTime()); }

/* 数量清洗：去逗号、单位文字，只保留数字 */
function _normalizeNumber(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') return isNaN(raw) ? null : Math.round(raw);
  const s = String(raw).trim()
    .replace(/,/g, '')                    /* 去千分位逗号：56,189,413 → 56189413 */
    .replace(/pcs|PCS|件|个|套|只|条|片|组|双|对/ig, '')  /* 去单位 */
    .trim();
  const n = parseFloat(s);
  return isNaN(n) ? null : Math.round(n);
}

/* 判定结果标准化 */
function _normalizeResult(raw) {
  const v = String(raw || '').trim().toUpperCase()
    .replace(/\s+/g, '');
  if (!v) return '';
  /* PASS 系列 */
  if (['PASS','合格','OK','P','良品','ACCEPT','ACC','A','APPROVED'].includes(v)) return 'PASS';
  /* REJ 系列 */
  if (['REJ','FAIL','NG','不合格','F','退货','REJECT','拒收','R'].includes(v)) return 'REJ';
  /* HOLD 系列 */
  if (['HOLD','待定','暂扣','待处理'].includes(v)) return 'HOLD';
  /* COND 系列 */
  if (['COND','有条件','有条件接收','特采','AOD','让步接收','特许','有条件合格'].includes(v)) return 'COND';
  /* 包含关键词的模糊匹配 */
  const orig = String(raw || '').trim().toUpperCase();
  if (orig.includes('PASS') || orig.includes('合格') || orig.includes('OK')) return 'PASS';
  if (orig.includes('FAIL') || orig.includes('REJ')  || orig.includes('NG') || orig.includes('不合格')) return 'REJ';
  if (orig.includes('HOLD') || orig.includes('待定')) return 'HOLD';
  if (orig.includes('有条件') || orig.includes('特采') || orig.includes('AOD')) return 'COND';
  return '';
}

/* 类型标准化 */
function _normalizeType(raw) {
  if (!raw) return '成品';
  if (raw.includes('半') || raw.includes('Semi')) return '半成品';
  if (raw.includes('成品') || raw.includes('Finish')) return '成品';
  return raw;
}



/* ════════════════════════════════════════
   §16  TOAST
════════════════════════════════════════ */
let _toastTimer;
function showToast(msg, type='info') {
  try {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.className   = `toast show ${type}`;
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
  } catch(e) {}
}

/* ════════════════════════════════════════
   §17  RESIZE
════════════════════════════════════════ */
function resizeAllCharts() {
  Object.values(chartInst).forEach(c => {
    try { c.resize(); } catch(e) {}
  });
}

window.addEventListener('resize', () => {
  clearTimeout(window._resizeTimer);
  window._resizeTimer = setTimeout(resizeAllCharts, 150);
});

/* ════════════════════════════════════════
   §18  BOOT — DOMContentLoaded
════════════════════════════════════════ */

/* ── 主题切换 ── */
function applyTheme(theme) {
  const t = theme === 'light' ? 'light' : 'dark';
  document.body.classList.remove('theme-dark', 'theme-light');
  document.body.classList.add('theme-' + t);
  localStorage.setItem(STORAGE_KEYS.theme, t);
  /* 同步下拉框选中状态 */
  const sel = document.getElementById('themeSelect');
  if (sel) sel.value = t;
  /* 主题切换后重绘所有已初始化的图表 */
  try {
    const data = recs();
    if (data.length) {
      initCharts(data);
      if (currentPage === 'analysis') initAnalysisCharts(data);
    }
  } catch(e) {}
}

/* ── 图表颜色套件（根据当前主题返回） ── */
function _cc() {
  const isLight = document.body.classList.contains('theme-light');
  return {
    text:      isLight ? '#374151' : '#b0bcc8',
    textHi:    isLight ? '#111827' : '#e8edf5',
    textDim:   isLight ? '#6b7280' : '#5a6878',
    axis:      isLight ? '#d1d5db' : '#1e2a38',
    grid:      isLight ? '#e5e7eb' : '#1a2435',
    /* 主题感知的语义色 */
    green:     isLight ? '#059669' : '#00e596',
    pass:      isLight ? '#059669' : '#00e596',
    red:       isLight ? '#e11d48' : '#ff3d5a',
    yellow:    isLight ? '#d97706' : '#f5c842',
    blue:      isLight ? '#0284c7' : '#3b82f6',
    /* 引导线 / 图例分页图标 */
    labelLine: isLight ? '#94a3b8' : '#2a3d52',
    pageInactive: isLight ? '#94a3b8' : '#3a4858',
    tt: {
      backgroundColor: isLight ? '#ffffff' : '#10141c',
      borderColor:     isLight ? '#d1d5db' : '#2a3d52',
      textStyle: { color: isLight ? '#111827' : '#e8edf5', fontSize: 12 },
      extraCssText: isLight ? 'box-shadow:0 4px 12px rgba(0,0,0,.12)' : '',
    },
    heatArea: isLight ? ['#f0f4f8','#e5e7eb'] : ['#13191f','#10141c'],
    heatRange: isLight ? ['#f0f4f8','#f5c842','#ef4444'] : ['#10141c','#f5c842','#ff3d5a'],
    heatLabel: isLight ? '#111827' : '#e8edf5',
  };
}

document.addEventListener('DOMContentLoaded', () => {
  /* 0. 主题初始化（最先执行，避免闪白） */
  const savedTheme = localStorage.getItem(STORAGE_KEYS.theme) || 'dark';
  applyTheme(savedTheme);

  /* 1. 载入数据（有 localStorage 用 localStorage，否则用 SEED） */
  initData();

  /* 2. 启动时钟 */
  tickClock();

  /* 3. 设置报告页日期默认值 */
  const dailyEl  = document.getElementById('dailyDate');
  const weeklyEl = document.getElementById('weeklyDate');
  if (dailyEl)  dailyEl.value  = todayStr();
  if (weeklyEl) weeklyEl.value = weekStart();

  /* 4. 账号鉴权（通过后 _showApp 会自动渲染仪表板；
     未登录则只显示登录页，待用户登录成功后由 login() → _showApp() 渲染）*/
  requireLogin();

  /* 5. 单一绑定：事件委托，用 closest() 防止点到文字节点时 id 匹配失败 */
  document.addEventListener('click', function(e) {
    const btn = e.target.closest && e.target.closest('#btnAddMeasRow');
    if (btn) {
      e.preventDefault();
      addMeasRow();
      return;
    }
    if (e.target.closest && e.target.closest('#btnAddDefectRow')) {
      addDefectRow();
      return;
    }
  });
});

/* ════════════════════════════════════════
   §19  品质月报 / 品质年报
════════════════════════════════════════ */

/* ── 工具：取月份数据 ── */
function getMonthRecords(year, month) {
  const prefix = `${year}-${String(month).padStart(2,'0')}`;
  return recs().filter(r => r.date && r.date.startsWith(prefix));
}

/* ── 工具：取年份数据 ── */
function getYearRecords(year) {
  return recs().filter(r => r.date && r.date.startsWith(String(year)));
}

/* ── 通用汇总 ── */
function summarizeRecords(data) {
  const total    = data.length;
  const passCnt  = data.filter(r => isPass(r)).length;
  const failCnt  = data.filter(r => isFail(r)).length;
  const passRate = total ? (passCnt / total * 100).toFixed(1) : '0.0';
  /* Number() 转换确保字符串 qty/sampleQty/fail 做数值加法，而非字符串拼接 */
  const totalQty = data.reduce((s,r) => s+(Number(r.qty)||0), 0);
  const totalSmp = data.reduce((s,r) => s+(Number(r.sampleQty)||0), 0);
  const totalFail= data.reduce((s,r) => s+(Number(r.fail)||0), 0);
  const avgRate  = totalSmp > 0 ? (totalFail/totalSmp*100).toFixed(2)+'%' : '—';
  const suppliers= new Set(data.map(r=>r.supplier).filter(Boolean));
  /* 高风险供应商：REJ>=2 或 平均不良率>=5% */
  const byS = groupBy(data, 'supplier');
  const highRisk = Object.values(byS).filter(arr => {
    const rejN = arr.filter(r => isFail(r)).length;
    const smp  = arr.reduce((s,r)=>s+(Number(r.sampleQty)||0),0);
    const fl   = arr.reduce((s,r)=>s+(Number(r.fail)||0),0);
    return rejN >= 2 || (smp > 0 && fl/smp >= 0.05);
  }).length;
  return { total, passCnt, failCnt, passRate, totalQty, totalSmp, totalFail, avgRate, suppliers: suppliers.size, highRisk };
}

/* ── TOP 供应商不良率 ── */
/* ── 供应商批次不良率 TOP（统一口径：REJ批次/验货批次）── */
function getSupplierTopRate(data, limit=10) {
  const map = {};
  data.forEach(r => {
    const name = r.supplier || '未知';
    if (!map[name]) map[name] = { name, total:0, rej:0, failQty:0, sampleQty:0 };
    const m = map[name];
    m.total++;
    if (isFail(r)) m.rej++;            /* 与供应商管理口径一致 */
    m.failQty   += Number(r.fail || 0);
    m.sampleQty += Number(r.sampleQty || 0);
  });
  return Object.values(map)
    .map(x => ({
      name:       x.name,
      total:      x.total,
      rej:        x.rej,
      failQty:    x.failQty,
      sampleQty:  x.sampleQty,
      /* 主指标：批次不良率 */
      batchRate:  x.total > 0 ? +(x.rej / x.total * 100).toFixed(1) : 0,
      /* 辅指标：数量不良率（sampleQty=0 时为 null） */
      qtyRate:    x.sampleQty > 0 ? +(x.failQty / x.sampleQty * 100).toFixed(2) : null,
    }))
    .filter(x => x.rej > 0)           /* 只展示有 REJ 批次的供应商 */
    .sort((a,b) => b.batchRate - a.batchRate || b.rej - a.rej)
    .slice(0, limit);
}

/* ── TOP 不良现象（复用 _splitDefect）── */
function getDefectTopCount(data, limit=10) {
  const dm = {};
  data.forEach(r => {
    _splitDefect(r.defect).forEach(d => { dm[d] = (dm[d]||0)+1; });
  });
  return Object.entries(dm).sort((a,b)=>b[1]-a[1]).slice(0,limit);
}

/* ── 客户占比 ── */
function getClientShare(data) {
  const byC = groupBy(data, 'client');
  return Object.entries(byC).map(([name, arr]) => ({ name, value: arr.length }))
    .sort((a,b)=>b.value-a.value);
}

/* ── 成品/半成品占比 ── */
function getTypeShare(data) {
  const byT = groupBy(data, 'type');
  return Object.entries(byT).map(([name, arr]) => ({ name: name||'未知', value: arr.length }));
}

/* ── 月报每日趋势 ── */
function getMonthlyDailyTrend(data, year, month) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const days = Array.from({length: daysInMonth}, (_,i) => {
    const d = String(i+1).padStart(2,'0');
    return `${year}-${String(month).padStart(2,'0')}-${d}`;
  });
  return days.map(date => {
    const dayData = data.filter(r => r.date === date);
    const total = dayData.length;
    const fail  = dayData.filter(r => isFail(r)).length;
    const rate  = total ? +((total-fail)/total*100).toFixed(1) : null;
    const failQty = dayData.reduce((s,r)=>s+(Number(r.fail)||0),0);
    return { date: date.slice(8), total, fail, rate, failQty };
  });
}

/* ── 年报12个月趋势 ── */
function getYearlyMonthlyTrend(data, year) {
  return Array.from({length:12}, (_,i) => {
    const m = String(i+1).padStart(2,'0');
    const prefix = `${year}-${m}`;
    const mData = data.filter(r => r.date && r.date.startsWith(prefix));
    const total = mData.length;
    const failCnt = mData.filter(r => isFail(r)).length;
    const passCnt = total - failCnt;
    const passRate = total ? +((passCnt/total)*100).toFixed(1) : null;
    const smp  = mData.reduce((s,r)=>s+(Number(r.sampleQty)||0),0);
    const fl   = mData.reduce((s,r)=>s+(Number(r.fail)||0),0);
    const avgRate = smp > 0 ? +(fl/smp*100).toFixed(2) : null;
    /* 批次不良率 = REJ批次 / 总批次（与供应商排名、月报口径一致） */
    const batchDefectRate = total > 0 ? +((failCnt/total)*100).toFixed(1) : null;
    return { month: `${i+1}月`, total, passCnt, failCnt, passRate,
             avgRate,          /* 数量口径，供汇总表参考列 */
             batchDefectRate,  /* 批次口径，供趋势图使用    */
             totalQty: mData.reduce((s,r)=>s+(Number(r.qty)||0),0), totalFail: fl };
  });
}

/* ─── 通用迷你图表渲染（ECharts，复用 makeChart 和 _cc()）─── */
function _mrChart(id, option) {
  const el = document.getElementById(id);
  if (!el) return;
  let c = echarts.getInstanceByDom(el);
  if (!c) c = echarts.init(el, null, { renderer: 'canvas' });
  c.setOption(option, true);
  window.addEventListener('resize', () => c.resize());
}

/* ─────────────────────────────────────
   §19.1  品质月报
───────────────────────────────────────*/
function renderMonthlyReport() {
  const el = document.getElementById('monthlyMonth');
  if (!el) return;
  /* 初始化默认月份 */
  if (!el.value) {
    const n = new Date();
    el.value = `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}`;
  }
  const [year, month] = el.value.split('-').map(Number);
  const data = getMonthRecords(year, month);
  const s    = summarizeRecords(data);
  const trend = getMonthlyDailyTrend(data, year, month);
  const supTop = getSupplierTopRate(data);
  const defTop = getDefectTopCount(data);
  const clientShare = getClientShare(data);
  const typeShare   = getTypeShare(data);
  const cc = _cc();

  /* ── KPI 卡片 ── */
  const kpiHtml = `
    <div class="rpt-kpi-row cols-4" style="margin-bottom:10px">
      <div class="rpt-kpi blue">
        <div class="rpt-kpi-label">本月验货批次</div>
        <div class="rpt-kpi-value blue">${s.total}</div>
        <div class="rpt-kpi-sub">来货 ${s.totalQty.toLocaleString()} 件</div>
      </div>
      <div class="rpt-kpi ${s.passCnt===s.total&&s.total>0?'green':'green'}">
        <div class="rpt-kpi-label">本月 PASS率</div>
        <div class="rpt-kpi-value green">${s.passRate}%</div>
        <div class="rpt-kpi-sub">PASS ${s.passCnt} / REJ ${s.failCnt}</div>
      </div>
      <div class="rpt-kpi ${s.totalFail>0?'red':'green'}">
        <div class="rpt-kpi-label">本月不良数量</div>
        <div class="rpt-kpi-value ${s.totalFail>0?'red':'green'}">${s.totalFail.toLocaleString()}</div>
        <div class="rpt-kpi-sub">仅统计已录入不良数量</div>
      </div>
      <div class="rpt-kpi ${s.highRisk>0?'red':'green'}">
        <div class="rpt-kpi-label">本月高风险供应商</div>
        <div class="rpt-kpi-value ${s.highRisk>0?'red':'green'}">${s.highRisk}</div>
        <div class="rpt-kpi-sub">活跃供应商 ${s.suppliers} 家</div>
      </div>
    </div>
    <div class="rpt-kpi-row cols-4" style="margin-bottom:14px">
      <div class="rpt-kpi grey">
        <div class="rpt-kpi-label">本月来货总数</div>
        <div class="rpt-kpi-value">${s.totalQty.toLocaleString()}</div>
        <div class="rpt-kpi-sub">件</div>
      </div>
      <div class="rpt-kpi grey">
        <div class="rpt-kpi-label">本月抽查总数</div>
        <div class="rpt-kpi-value">${s.totalSmp.toLocaleString()}</div>
        <div class="rpt-kpi-sub">件</div>
      </div>
      <div class="rpt-kpi grey">
        <div class="rpt-kpi-label">本月批次不良率</div>
        <div class="rpt-kpi-value">${s.total>0?(s.failCnt/s.total*100).toFixed(1)+'%':'—'}</div>
        <div class="rpt-kpi-sub">REJ批次 / 总批次</div>
      </div>
      <div class="rpt-kpi grey">
        <div class="rpt-kpi-label">本月活跃供应商</div>
        <div class="rpt-kpi-value">${s.suppliers}</div>
        <div class="rpt-kpi-sub">家</div>
      </div>
    </div>`;

  /* ── 图表区域：行1=批次趋势(2/3) + PASS/REJ(1/3)，行2=PASS率+供应商TOP+客户占比，行3=不良TOP+成品占比 ── */
  const chartsHtml = `
    <div style="display:grid;grid-template-columns:2fr 1fr;gap:12px;margin-bottom:12px">
      <div class="section-card" style="padding:10px">
        <div class="rpt-section-title">每日验货批次趋势（按日统计）</div>
        <div id="mrChart1" style="height:160px"></div>
      </div>
      <div class="section-card" style="padding:10px">
        <div class="rpt-section-title">PASS / REJ 分布</div>
        <div id="mrChart4" style="height:160px"></div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px">
      <div class="section-card" style="padding:10px">
        <div class="rpt-section-title">每日 PASS率趋势</div>
        <div id="mrChart2" style="height:180px"></div>
      </div>
      <div class="section-card" style="padding:10px">
        <div class="rpt-section-title">供应商批次不良率 TOP10</div>
        <div id="mrChart3" style="height:180px"></div>
      </div>
      <div class="section-card" style="padding:10px">
        <div class="rpt-section-title">客户占比（按批次）</div>
        <div id="mrChart5" style="height:180px"></div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
      <div class="section-card" style="padding:10px">
        <div class="rpt-section-title">不良类型 TOP10</div>
        <div id="mrChart6" style="height:220px"></div>
      </div>
      <div class="section-card" style="padding:10px">
        <div class="rpt-section-title">成品 / 半成品占比</div>
        <div id="mrChart7" style="height:220px"></div>
      </div>
    </div>`;

  /* ── 重点问题分析 ── */
  const topDef = defTop.slice(0,3).map(([d,n])=>d).join('、') || '暂无';
  const highRiskSups = (() => {
    const byS = groupBy(data,'supplier');
    return Object.entries(byS).filter(([,arr]) => {
      const rejN = arr.filter(r=>isFail(r)).length;
      const smp  = arr.reduce((s,r)=>s+(Number(r.sampleQty)||0),0);
      const fl   = arr.reduce((s,r)=>s+(Number(r.fail)||0),0);
      return rejN>=2||(smp>0&&fl/smp>=0.05);
    }).map(([name])=>name);
  })();
  const analysisHtml = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
      <div class="section-card" style="padding:14px">
        <div class="rpt-section-title">本月重点问题</div>
        <ul style="margin:8px 0 0 16px;font-size:12px;color:var(--text-main);line-height:2">
          ${defTop.slice(0,5).map(([d,n])=>`<li>${d}（${n}次）</li>`).join('') || '<li>本月无明显不良问题</li>'}
        </ul>
      </div>
      <div class="section-card" style="padding:14px">
        <div class="rpt-section-title">本月改善建议</div>
        <ul style="margin:8px 0 0 16px;font-size:12px;color:var(--text-main);line-height:2">
          ${highRiskSups.length ? `<li>以下供应商需重点跟进：${highRiskSups.join('、')}</li>` : '<li>本月无高风险供应商</li>'}
          ${s.failCnt>0 ? `<li>本月 REJ ${s.failCnt} 批，建议供应商提交改善措施</li>` : '<li>本月全部批次通过检验</li>'}
          ${defTop[0] ? `<li>主要不良为「${topDef}」，建议重点管控</li>` : ''}
        </ul>
      </div>
    </div>`;

  /* ── 明细表 ── */
  const detailHtml = data.length ? `
    <div class="section-card" style="padding:0;margin-bottom:14px;overflow:auto;max-height:360px">
      <div class="section-header" style="padding:10px 16px">
        <span class="section-title">本月验货明细（共 ${data.length} 条）</span>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="position:sticky;top:0">
          <th>日期</th><th>供应商</th><th>客户</th><th>货号</th><th>款式</th>
          <th>来货数</th><th>抽查数</th><th>FAIL</th><th>不良率</th><th>判定</th>
        </tr></thead>
        <tbody>${data.sort((a,b)=>a.date.localeCompare(b.date)).map(r=>`<tr>
          <td>${r.date}</td><td><b>${r.supplier}</b></td><td>${r.client||'-'}</td>
          <td>${r.productNo||'-'}</td><td>${r.productName||'-'}</td>
          <td style="text-align:right">${(r.qty||0).toLocaleString()}</td>
          <td style="text-align:right">${r.sampleQty??'—'}</td>
          <td style="text-align:right;color:${(r.fail||0)>0?'var(--red)':'var(--text-dim)'}">${r.fail||0}</td>
          <td>${r.sampleQty?r.defectRate||'0.00%':'—'}</td>
          <td><span class="badge badge-${isPass(r)?'pass':'rej'}">${r.result}</span></td>
        </tr>`).join('')}</tbody>
      </table>
    </div>` : `<div class="empty-state"><div class="empty-icon">📋</div>
      <div class="empty-text">本月暂无验货记录</div></div>`;

  document.getElementById('monthlyReportBody').innerHTML =
    kpiHtml + chartsHtml + analysisHtml + detailHtml;

  /* ── 渲染图表 ── */
  /* 完整月份日期序列（无论有无数据都显示）*/
  const days    = trend.map(t => t.date);          /* 01, 02, … 31 */
  const totals  = trend.map(t => t.total);
  const rates   = trend.map(t => t.rate);
  /* X轴按间隔显示避免拥挤：每3天显示一次 */
  const xInterval = days.length > 20 ? 2 : 1;

  const baseOpt = {
    backgroundColor:'transparent',
    tooltip:{ trigger:'axis', ...cc.tt,
      formatter: (params) => {
        return params.map(p => {
          const val = p.value != null ? p.value : null;
          if (p.seriesType === 'line') {
            return `${p.marker}${p.seriesName}：${val != null ? val + '%' : '—'}`;
          }
          return `${p.marker}${p.seriesName}：${val ?? 0}`;
        }).join('<br>');
      }
    },
    grid:{ top:28, left:44, right:18, bottom:28, containLabel:true },
  };

  /* mrChart1: 每日批次柱图（完整月份） */
  _mrChart('mrChart1', { ...baseOpt,
    xAxis:{ type:'category', data:days,
      axisLabel:{ color:cc.textDim, fontSize:11, interval: xInterval } },
    yAxis:{ type:'value', minInterval:1, axisLabel:{ color:cc.textDim, fontSize:11 },
      splitLine:{ lineStyle:{ color:cc.grid, type:'dashed' } } },
    series:[{ name:'验货批次', type:'bar', data:totals, barMaxWidth:18,
      itemStyle:{ color:cc.blue||'#0090bb', borderRadius:[2,2,0,0] } }],
  });

  /* mrChart2: 每日 PASS率折线（完整月份） */
  _mrChart('mrChart2', { ...baseOpt,
    xAxis:{ type:'category', data:days,
      axisLabel:{ color:cc.textDim, fontSize:9, interval: xInterval } },
    yAxis:{ type:'value', min:0, max:100,
      axisLabel:{ color:cc.textDim, fontSize:9, formatter:'{value}%' },
      splitLine:{ lineStyle:{ color:cc.grid, type:'dashed' } } },
    series:[{ name:'PASS率', type:'line', data:rates, smooth:true, symbol:'none',
      connectNulls:true,
      lineStyle:{ color:cc.pass||'#00e596', width:2 },
      areaStyle:{ color:'rgba(0,229,150,0.06)' } }],
  });

  /* mrChart3: 供应商批次不良率 TOP（与供应商管理口径一致） */
  if (supTop.length) {
    const names = supTop.map(x=>x.name).reverse();
    const bars  = supTop.map(x=>x.batchRate).reverse();
    const ttData = supTop.slice().reverse();
    _mrChart('mrChart3', { backgroundColor:'transparent',
      tooltip:{ trigger:'axis', ...cc.tt,
        formatter: (p) => {
          const d = ttData[p[0].dataIndex];
          return `<b>${d.name}</b><br/>验货：${d.total}批 REJ：${d.rej}批<br/>批次不良率：${d.batchRate}%`
            + (d.qtyRate!=null ? `<br/>数量不良率：${d.qtyRate}%` : '');
        }
      },
      grid:{ top:8, left:8, right:44, bottom:8, containLabel:true },
      xAxis:{ type:'value', axisLabel:{ color:cc.textDim, fontSize:9, formatter:'{value}%' } },
      yAxis:{ type:'category', data:names, axisLabel:{ color:cc.text, fontSize:9 } },
      series:[{ name:'批次不良率', type:'bar', data:bars, barMaxWidth:14,
        itemStyle:{ color:'#ff3d5a', borderRadius:[0,3,3,0] },
        label:{ show:true, position:'right', color:cc.text, fontSize:9, formatter:p=>p.value+'%' } }],
    });
  } else {
    const el = document.getElementById('mrChart3');
    if (el) el.innerHTML = '<div style="text-align:center;padding:50px 0;color:var(--text-muted);font-size:12px">暂无供应商不良率数据</div>';
  }

  /* mrChart4: PASS/REJ 饼图（label 不被截断：radius 缩小留空间） */
  _mrChart('mrChart4', { backgroundColor:'transparent',
    tooltip:{ trigger:'item', ...cc.tt },
    series:[{ type:'pie', radius:['30%','56%'], center:['50%','50%'],
      avoidLabelOverlap: true,
      label:{ show:true, color:'#111827', fontSize:10, fontWeight:700,
        formatter:p=>`${p.name}\n${p.percent.toFixed(0)}%` },
      labelLine:{ length:10, length2:12, lineStyle:{ color:'#374151' } },
      data:[
        { name:'PASS', value:s.passCnt, itemStyle:{ color:cc.pass||'#00e596' } },
        { name:'REJ',  value:s.failCnt, itemStyle:{ color:'#ff3d5a' } },
      ].filter(d=>d.value>0) }],
  });

  /* mrChart5: 客户占比（带图例，高度180px 有足够空间） */
  const COLS=['#00c8ff','#00e596','#f5c842','#ff6b35','#ff3d5a','#3b82f6','#a855f7'];
  _mrChart('mrChart5', { backgroundColor:'transparent',
    tooltip:{ trigger:'item', ...cc.tt,
      formatter:p=>`${p.name}<br/>${p.value}批 (${p.percent.toFixed(1)}%)` },
    legend:{ bottom:0, type:'scroll', textStyle:{ color:cc.text, fontSize:10 },
      itemWidth:8, itemHeight:8, pageIconInactiveColor:cc.pageInactive },
    series:[{ type:'pie', radius:['32%','56%'], center:['50%','44%'],
      label:{ show:false },
      emphasis:{ label:{ show:true, fontSize:11, color:cc.textHi,
        formatter:p=>`${p.name}\n${p.percent.toFixed(0)}%` } },
      data:clientShare.slice(0,7).map((d,i)=>({
        name:d.name, value:d.value, itemStyle:{ color:COLS[i%COLS.length] } })) }],
  });

  /* mrChart6: 不良类型TOP横向条 */
  if (defTop.length) {
    const dnames = defTop.slice(0,10).map(([d])=>d).reverse();
    const dcnts  = defTop.slice(0,10).map(([,n])=>n).reverse();
    _mrChart('mrChart6', { backgroundColor:'transparent',
      tooltip:{ trigger:'axis', ...cc.tt },
      grid:{ top:8, left:8, right:36, bottom:8, containLabel:true },
      xAxis:{ type:'value', axisLabel:{ color:cc.textDim, fontSize:10 } },
      yAxis:{ type:'category', data:dnames, axisLabel:{ color:cc.text, fontSize:10 } },
      series:[{ name:'次数', type:'bar', data:dcnts, barMaxWidth:14,
        itemStyle:{ color:'#f5c842', borderRadius:[0,3,3,0] },
        label:{ show:true, position:'right', color:cc.text, fontSize:10 } }],
    });
  } else {
    const el = document.getElementById('mrChart6');
    if (el) el.innerHTML = '<div style="text-align:center;padding:70px 0;color:var(--text-muted);font-size:12px">暂无不良类型数据</div>';
  }

  /* mrChart7: 成品/半成品饼图 */
  _mrChart('mrChart7', { backgroundColor:'transparent',
    tooltip:{ trigger:'item', ...cc.tt },
    legend:{ bottom:0, textStyle:{ color:cc.text, fontSize:10 }, itemWidth:10, itemHeight:10 },
    series:[{ type:'pie', radius:['35%','60%'], center:['50%','44%'],
      avoidLabelOverlap:true,
      label:{ show:true, color:cc.textHi, fontSize:11, fontWeight:600,
        formatter:p=>`${p.name}\n${p.percent.toFixed(0)}%` },
      data:typeShare.map((d,i)=>({
        name:d.name, value:d.value, itemStyle:{ color:COLS[i%COLS.length] } })) }],
  });
}

/* ─────────────────────────────────────
   §19.2  品质年报
───────────────────────────────────────*/
function renderYearlyReport() {
  const el = document.getElementById('yearlyYear');
  if (!el) return;
  if (!el.value) el.value = String(new Date().getFullYear());
  const year = parseInt(el.value);
  const data = getYearRecords(year);
  const s    = summarizeRecords(data);
  const monthTrend = getYearlyMonthlyTrend(data, year);
  const supTop = getSupplierTopRate(data);
  const defTop = getDefectTopCount(data);
  const clientShare = getClientShare(data);
  const typeShare   = getTypeShare(data);
  const cc = _cc();

  /* ── KPI ── */
  const kpiHtml = `
    <div class="rpt-kpi-row cols-4" style="margin-bottom:10px">
      <div class="rpt-kpi blue">
        <div class="rpt-kpi-label">年度验货批次</div>
        <div class="rpt-kpi-value blue">${s.total}</div>
        <div class="rpt-kpi-sub">来货 ${s.totalQty.toLocaleString()} 件</div>
      </div>
      <div class="rpt-kpi green">
        <div class="rpt-kpi-label">年度 PASS率</div>
        <div class="rpt-kpi-value green">${s.passRate}%</div>
        <div class="rpt-kpi-sub">PASS ${s.passCnt} / REJ ${s.failCnt}</div>
      </div>
      <div class="rpt-kpi ${s.totalFail>0?'red':'green'}">
        <div class="rpt-kpi-label">年度不良数量</div>
        <div class="rpt-kpi-value ${s.totalFail>0?'red':'green'}">${s.totalFail.toLocaleString()}</div>
        <div class="rpt-kpi-sub">仅统计已录入不良数量</div>
      </div>
      <div class="rpt-kpi ${s.highRisk>0?'red':'green'}">
        <div class="rpt-kpi-label">年度高风险供应商</div>
        <div class="rpt-kpi-value ${s.highRisk>0?'red':'green'}">${s.highRisk}</div>
        <div class="rpt-kpi-sub">年度活跃 ${s.suppliers} 家</div>
      </div>
    </div>
    <div class="rpt-kpi-row cols-4" style="margin-bottom:14px">
      <div class="rpt-kpi grey">
        <div class="rpt-kpi-label">年度来货总数</div>
        <div class="rpt-kpi-value">${s.totalQty.toLocaleString()}</div>
        <div class="rpt-kpi-sub">件</div>
      </div>
      <div class="rpt-kpi grey">
        <div class="rpt-kpi-label">年度抽查总数</div>
        <div class="rpt-kpi-value">${s.totalSmp.toLocaleString()}</div>
        <div class="rpt-kpi-sub">件</div>
      </div>
      <div class="rpt-kpi grey">
        <div class="rpt-kpi-label">年度批次不良率</div>
        <div class="rpt-kpi-value">${s.total>0?(s.failCnt/s.total*100).toFixed(1)+'%':'—'}</div>
        <div class="rpt-kpi-sub">REJ批次 / 总批次</div>
      </div>
      <div class="rpt-kpi grey">
        <div class="rpt-kpi-label">年度活跃供应商</div>
        <div class="rpt-kpi-value">${s.suppliers}</div>
        <div class="rpt-kpi-sub">家</div>
      </div>
    </div>`;

  /* ── 图表区域 ── */
  const chartsHtml = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
      <div class="section-card" style="padding:10px">
        <div class="rpt-section-title">12个月验货批次 / PASS率（完整月份）</div>
        <div id="yrChart1" style="height:230px"></div>
      </div>
      <div class="section-card" style="padding:10px">
        <div class="rpt-section-title">12个月批次不良率趋势</div>
        <div id="yrChart2" style="height:230px"></div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
      <div class="section-card" style="padding:10px">
        <div class="rpt-section-title">年度供应商批次不良率 TOP10</div>
        <div id="yrChart3" style="height:240px"></div>
      </div>
      <div class="section-card" style="padding:10px">
        <div class="rpt-section-title">年度不良类型 TOP10</div>
        <div id="yrChart4" style="height:240px"></div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
      <div class="section-card" style="padding:10px">
        <div class="rpt-section-title">年度客户占比（按批次）</div>
        <div id="yrChart5" style="height:200px"></div>
      </div>
      <div class="section-card" style="padding:10px">
        <div class="rpt-section-title">年度成品 / 半成品占比</div>
        <div id="yrChart6" style="height:200px"></div>
      </div>
    </div>`;

  /* ── 分析与建议 ── */
  const topDef = defTop.slice(0,3).map(([d])=>d).join('、') || '暂无';
  const highRiskSups = (() => {
    const byS = groupBy(data,'supplier');
    return Object.entries(byS).filter(([,arr])=>{
      const rejN=arr.filter(r=>isFail(r)).length;
      const smp=arr.reduce((s,r)=>s+(Number(r.sampleQty)||0),0);
      const fl=arr.reduce((s,r)=>s+(Number(r.fail)||0),0);
      return rejN>=2||(smp>0&&fl/smp>=0.05);
    }).map(([name])=>name);
  })();
  const analysisHtml = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
      <div class="section-card" style="padding:14px">
        <div class="rpt-section-title">年度质量问题 TOP</div>
        <ul style="margin:8px 0 0 16px;font-size:12px;color:var(--text-main);line-height:2">
          ${defTop.slice(0,5).map(([d,n])=>`<li>${d}（${n}次）</li>`).join('') || '<li>本年度无明显不良问题</li>'}
        </ul>
      </div>
      <div class="section-card" style="padding:14px">
        <div class="rpt-section-title">年度改善建议</div>
        <ul style="margin:8px 0 0 16px;font-size:12px;color:var(--text-main);line-height:2">
          ${highRiskSups.length ? `<li>高风险供应商：${highRiskSups.join('、')}，建议重点管控</li>` : '<li>年度无高风险供应商</li>'}
          ${s.failCnt>0 ? `<li>全年 REJ ${s.failCnt} 批（${(s.failCnt/s.total*100).toFixed(1)}%），建议持续改善</li>` : '<li>全年所有批次通过检验，质量稳定</li>'}
          ${defTop[0] ? `<li>主要不良「${topDef}」需重点攻关</li>` : ''}
          <li>建议持续推进供应商质量提升计划</li>
        </ul>
      </div>
    </div>`;

  /* ── 12个月汇总表 ── */
  const summaryHtml = `
    <div class="section-card" style="padding:0;margin-bottom:14px;overflow:auto">
      <div class="section-header" style="padding:10px 16px">
        <span class="section-title">${year} 年度 · 12个月汇总</span>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr>
          <th>月份</th><th>验货批次</th><th>PASS</th><th>REJ</th>
          <th>PASS率</th><th>不良数量</th><th>来货数</th><th>数量不良率</th>
        </tr></thead>
        <tbody>${monthTrend.map(m=>`<tr>
          <td><b>${m.month}</b></td>
          <td style="text-align:right">${m.total||'-'}</td>
          <td style="text-align:right;color:var(--green)">${m.passCnt||0}</td>
          <td style="text-align:right;color:${m.failCnt?'var(--red)':'var(--text-dim)'}">${m.failCnt||0}</td>
          <td style="text-align:right">${m.passRate!=null?m.passRate+'%':'—'}</td>
          <td style="text-align:right">${m.totalFail||0}</td>
          <td style="text-align:right">${m.totalQty.toLocaleString()}</td>
          <td style="text-align:right">${m.avgRate!=null?m.avgRate+'%':'—'}</td>
        </tr>`).join('')}
        <tr style="background:var(--bg-hover);font-weight:700">
          <td>合计</td>
          <td style="text-align:right">${s.total}</td>
          <td style="text-align:right;color:var(--green)">${s.passCnt}</td>
          <td style="text-align:right;color:${s.failCnt?'var(--red)':'var(--text-dim)'}">${s.failCnt}</td>
          <td style="text-align:right">${s.passRate}%</td>
          <td style="text-align:right">${s.totalFail}</td>
          <td style="text-align:right">${s.totalQty.toLocaleString()}</td>
          <td style="text-align:right">${s.avgRate}</td>
        </tr>
        </tbody>
      </table>
    </div>`;

  document.getElementById('yearlyReportBody').innerHTML =
    kpiHtml + chartsHtml + analysisHtml + summaryHtml;

  /* ── 渲染年报图表 ── */
  /* 固定1-12月，无论有无数据都显示 */
  const months    = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
  const mTotals   = monthTrend.map(m => m.total || 0);
  const mRates    = monthTrend.map(m => m.passRate);
  const mAvgRates      = monthTrend.map(m => m.avgRate);          /* 数量口径，仅汇总表用 */
  const mBatchDefRates = monthTrend.map(m => m.batchDefectRate);  /* 批次口径，趋势图用   */
  const baseOpt2  = {
    backgroundColor:'transparent',
    tooltip:{ trigger:'axis', ...cc.tt },
    grid:{ top:48, left:46, right:72, bottom:28, containLabel:true },
  };

  /* yrChart1: 月度批次 + PASS率（固定1-12月） */
  _mrChart('yrChart1', { ...baseOpt2,
    legend:{ data:['验货批次','PASS率(%)'], textStyle:{ color:cc.text, fontSize:12 },
      top:8, right:14, itemGap:24, itemWidth:14, itemHeight:9 },
    xAxis:{ type:'category', data:months,
      axisLabel:{ color:cc.textDim, fontSize:11 },
      axisLine:{ lineStyle:{ color:cc.axis } } },
    yAxis:[
      { type:'value', nameTextStyle:{ color:cc.textDim, fontSize:11 }, minInterval:1,
        axisLabel:{ color:cc.textDim, fontSize:11 },
        splitLine:{ lineStyle:{ color:cc.grid, type:'dashed' } } },
      { type:'value', min:0, max:100,   /* name 已删除，legend 中已有 PASS率(%) 避免重叠 */
        axisLabel:{ color:cc.textDim, fontSize:11, formatter:'{value}%' },
        splitLine:{ show:false } },
    ],
    series:[
      { name:'验货批次', type:'bar', data:mTotals, barMaxWidth:28,
        itemStyle:{ color:cc.blue||'#0090bb', borderRadius:[2,2,0,0] } },
      { name:'PASS率(%)', type:'line', yAxisIndex:1, data:mRates, smooth:true,
        symbol:'circle', symbolSize:5, connectNulls:false,
        lineStyle:{ color:cc.pass||'#00e596', width:2 },
        itemStyle:{ color:cc.pass||'#00e596' } },
    ],
  });

  /* yrChart2: 月度批次不良率（REJ批次/总批次，与供应商排名口径一致） */
  _mrChart('yrChart2', { ...baseOpt2,
    tooltip:{ trigger:'axis', ...cc.tt,
      formatter: (params) => {
        const idx = params[0].dataIndex;
        const m   = monthTrend[idx];
        if (!m || !m.total) return `<b>${months[idx]}</b><br/>无验货数据`;
        return `<b>${months[idx]}</b><br/>`
          + `验货批次：${m.total}<br/>`
          + `REJ批次：${m.failCnt}<br/>`
          + `批次不良率：${m.batchDefectRate != null ? m.batchDefectRate + '%' : '—'}`;
      }
    },
    xAxis:{ type:'category', data:months,
      axisLabel:{ color:cc.textDim, fontSize:10 } },
    yAxis:{ type:'value', name:'批次不良率',
      nameTextStyle:{ color:cc.textDim, fontSize:10 },
      axisLabel:{ color:cc.textDim, fontSize:10, formatter:'{value}%' },
      splitLine:{ lineStyle:{ color:cc.grid, type:'dashed' } } },
    series:[{ name:'批次不良率', type:'line', data:mBatchDefRates, smooth:true,
      symbol:'circle', symbolSize:5, connectNulls:true,
      lineStyle:{ color:'#f5c842', width:2.5 },
      itemStyle:{ color:'#f5c842' },
      areaStyle:{ color:'rgba(245,200,66,0.08)' } }],
  });

  const COLS2=['#00c8ff','#00e596','#f5c842','#ff6b35','#ff3d5a','#3b82f6','#a855f7'];

  /* yrChart3: 年度供应商批次不良率 TOP（与供应商管理口径一致） */
  if (supTop.length) {
    const snames  = supTop.map(x=>x.name).reverse();
    const sbars   = supTop.map(x=>x.batchRate).reverse();
    const ttData2 = supTop.slice().reverse();
    _mrChart('yrChart3', { backgroundColor:'transparent',
      tooltip:{ trigger:'axis', ...cc.tt,
        formatter: (p) => {
          const d = ttData2[p[0].dataIndex];
          return `<b>${d.name}</b><br/>验货：${d.total}批 REJ：${d.rej}批<br/>批次不良率：${d.batchRate}%`
            + (d.qtyRate!=null ? `<br/>数量不良率：${d.qtyRate}%` : '');
        }
      },
      grid:{ top:8, left:8, right:44, bottom:8, containLabel:true },
      xAxis:{ type:'value', axisLabel:{ color:cc.textDim, fontSize:9, formatter:'{value}%' } },
      yAxis:{ type:'category', data:snames, axisLabel:{ color:cc.text, fontSize:10 } },
      series:[{ name:'批次不良率', type:'bar', data:sbars, barMaxWidth:16,
        itemStyle:{ color:'#ff3d5a', borderRadius:[0,3,3,0] },
        label:{ show:true, position:'right', color:cc.text, fontSize:10, formatter:p=>p.value+'%' } }],
    });
  } else {
    const el = document.getElementById('yrChart3');
    if (el) el.innerHTML = '<div style="text-align:center;padding:70px 0;color:var(--text-muted);font-size:12px">暂无供应商不良率数据</div>';
  }

  /* yrChart4: 年度不良TOP */
  if (defTop.length) {
    const dnames2 = defTop.slice(0,10).map(([d])=>d).reverse();
    const dcnts2  = defTop.slice(0,10).map(([,n])=>n).reverse();
    _mrChart('yrChart4', { backgroundColor:'transparent',
      tooltip:{ trigger:'axis', ...cc.tt },
      grid:{ top:8, left:8, right:36, bottom:8, containLabel:true },
      xAxis:{ type:'value', axisLabel:{ color:cc.textDim, fontSize:10 } },
      yAxis:{ type:'category', data:dnames2, axisLabel:{ color:cc.text, fontSize:10 } },
      series:[{ name:'次数', type:'bar', data:dcnts2, barMaxWidth:16,
        itemStyle:{ color:'#f5c842', borderRadius:[0,3,3,0] },
        label:{ show:true, position:'right', color:cc.text, fontSize:10 } }],
    });
  } else {
    const el = document.getElementById('yrChart4');
    if (el) el.innerHTML = '<div style="text-align:center;padding:70px 0;color:var(--text-muted);font-size:12px">暂无不良类型数据</div>';
  }

  /* yrChart5: 客户占比（高度200，带图例） */
  _mrChart('yrChart5', { backgroundColor:'transparent',
    tooltip:{ trigger:'item', ...cc.tt,
      formatter:p=>`${p.name}<br/>${p.value}批 (${p.percent.toFixed(1)}%)` },
    legend:{ bottom:2, type:'scroll', textStyle:{ color:cc.text, fontSize:10 },
      itemWidth:8, itemHeight:8, pageIconInactiveColor:cc.pageInactive },
    series:[{ type:'pie', radius:['32%','56%'], center:['50%','44%'],
      label:{ show:false },
      emphasis:{ label:{ show:true, fontSize:11, color:cc.textHi,
        formatter:p=>`${p.name}\n${p.percent.toFixed(0)}%` } },
      data:clientShare.slice(0,7).map((d,i)=>({
        name:d.name, value:d.value, itemStyle:{ color:COLS2[i%COLS2.length] } })) }],
  });

  /* yrChart6: 成品/半成品 */
  _mrChart('yrChart6', { backgroundColor:'transparent',
    tooltip:{ trigger:'item', ...cc.tt },
    legend:{ bottom:2, textStyle:{ color:cc.text, fontSize:10 }, itemWidth:10, itemHeight:10 },
    series:[{ type:'pie', radius:['32%','56%'], center:['50%','44%'],
      avoidLabelOverlap:true,
      label:{ show:true, color:cc.textHi, fontSize:11, fontWeight:600,
        formatter:p=>`${p.name}\n${p.percent.toFixed(0)}%` },
      data:typeShare.map((d,i)=>({
        name:d.name, value:d.value, itemStyle:{ color:COLS2[i%COLS2.length] } })) }],
  });
}

/* ════════════════════════════════════════
   §20  品质月报 / 品质年报 PDF 导出
   依赖：jsPDF 2.x + html2canvas 1.x（与现有日报/周报相同）
════════════════════════════════════════ */

/* ── PDF专用样式（只在导出容器上生效）── */
function _ensurePdfStyle() {
  if (document.getElementById('rpt-pdf-style')) return;
  const s = document.createElement('style');
  s.id = 'rpt-pdf-style';
  s.textContent = `
.rpt-pdf-canvas {
  width:1100px; background:#fff; color:#111827;
  padding:36px 40px; font-family:Arial,"Microsoft YaHei",sans-serif;
  box-sizing:border-box; position:absolute; left:-9999px; top:0;
}
.rpt-pdf-title {
  font-size:26px; font-weight:800; text-align:center;
  color:#0f172a; margin-bottom:4px; letter-spacing:1px;
}
.rpt-pdf-co {
  font-size:13px; text-align:center; color:#374151; margin-bottom:2px;
}
.rpt-pdf-meta {
  font-size:11px; text-align:center; color:#6b7280; margin-bottom:18px;
}
.rpt-pdf-divider {
  border:none; border-top:2px solid #0284c7; margin:12px 0;
}
.rpt-pdf-sec {
  font-size:15px; font-weight:700; color:#0284c7;
  border-left:4px solid #0284c7; padding-left:10px;
  margin:20px 0 10px;
  page-break-before: auto; page-break-after: avoid;
}
.rpt-pdf-kpi-grid {
  display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:16px;
  page-break-inside: avoid;
}
.rpt-pdf-kpi {
  background:#f8fafc; border:1px solid #e5e7eb; border-radius:6px;
  padding:10px 12px; border-left:4px solid #0284c7;
}
.rpt-pdf-kpi.green { border-left-color:#059669; }
.rpt-pdf-kpi.red   { border-left-color:#e11d48; }
.rpt-pdf-kpi-label { font-size:10px; color:#6b7280; margin-bottom:3px; }
.rpt-pdf-kpi-val   { font-size:18px; font-weight:700; color:#111827; }
.rpt-pdf-kpi-val.g { color:#047857; }
.rpt-pdf-kpi-val.r { color:#dc2626; }
.rpt-pdf-kpi-val.b { color:#0284c7; }
.rpt-pdf-kpi-sub   { font-size:10px; color:#9ca3af; margin-top:2px; }
.rpt-pdf-chart-grid {
  display:grid; gap:10px; margin-bottom:14px;
  page-break-inside: avoid;
}
.rpt-pdf-chart-box {
  background:#f8fafc; border:1px solid #e5e7eb; border-radius:6px; padding:8px;
  page-break-inside: avoid;
}
.rpt-pdf-chart-title {
  font-size:11px; font-weight:600; color:#374151; margin-bottom:6px;
}
.rpt-pdf-chart-box img { width:100%; display:block; border-radius:4px; }
.rpt-pdf-analysis {
  display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:14px;
  page-break-inside: avoid;
}
.rpt-pdf-ana-box {
  background:#f8fafc; border:1px solid #e5e7eb; border-radius:6px; padding:12px;
  page-break-inside: avoid;
}
.rpt-pdf-ana-title {
  font-size:12px; font-weight:700; color:#0284c7; margin-bottom:6px;
}
.rpt-pdf-ana-box ul {
  margin:0 0 0 16px; font-size:11px; color:#374151; line-height:2;
}
.rpt-pdf-table { width:100%; border-collapse:collapse; font-size:11px; margin-bottom:4px; }
.rpt-pdf-table th {
  background:#e5e7eb; color:#374151; font-weight:700; padding:6px 8px;
  border:1px solid #d1d5db; text-align:left; white-space:nowrap;
}
.rpt-pdf-table td {
  padding:5px 8px; border:1px solid #e5e7eb; color:#111827; vertical-align:middle;
}
.rpt-pdf-table tbody tr:nth-child(even) td { background:#f9fafb; }
.rpt-pdf-note { font-size:10px; color:#9ca3af; text-align:right; margin-bottom:8px; }
`;
  document.head.appendChild(s);
}

/* ── 从 ECharts DOM 取图片（标准，供屏幕/PDF通用）── */
function _getChartImg(id) {
  try {
    const el = document.getElementById(id);
    if (!el || !window.echarts) return '';
    const inst = echarts.getInstanceByDom(el);
    if (!inst) return '';
    return inst.getDataURL({ type:'png', pixelRatio:3, backgroundColor:'#ffffff' });
  } catch(err) {
    console.warn('[PDF] chart image failed:', id, err);
    return '';
  }
}

/* ── PDF专用图表图片：临时放大 DOM 元素并更新选项，获得更高质量图片 ── */
async function _getPdfChartImg(id, pdfW, pdfH, optionOverride) {
  try {
    const el = document.getElementById(id);
    if (!el || !window.echarts) return '';
    const inst = echarts.getInstanceByDom(el);
    if (!inst) return '';
    /* 临时调整尺寸 */
    const origW = el.style.width, origH = el.style.height;
    el.style.width  = pdfW + 'px';
    el.style.height = pdfH + 'px';
    inst.resize({ width: pdfW, height: pdfH });
    if (optionOverride) inst.setOption(optionOverride, { notMerge: false });
    await new Promise(r => setTimeout(r, 60));
    const url = inst.getDataURL({ type:'png', pixelRatio:2, backgroundColor:'#ffffff' });
    /* 还原尺寸 */
    el.style.width  = origW;
    el.style.height = origH;
    inst.resize();
    return url;
  } catch(err) {
    console.warn('[PDF] _getPdfChartImg failed:', id, err);
    return _getChartImg(id);
  }
}

/* ── 导出核心：canvas → html2canvas → jsPDF 分页（纵向A4）── */
/* ────────────────────────────────────────────────────────
   通用横向 A4 分页导出：接受多个 pageEl 数组，每页单独截图
   ────────────────────────────────────────────────────────*/
async function _exportPdfLandscapePages(pageEls, filename) {
  if (!pageEls || pageEls.length === 0) {
    console.error('[PDF] _exportPdfLandscapePages: pageEls is empty');
    throw new Error('PDF页面容器为空，无法导出');
  }
  const jspdfClass = window.jspdf ? window.jspdf.jsPDF : jsPDF;
  const pdf = new jspdfClass({ orientation:'landscape', unit:'mm', format:'a4' });
  /* A4 横向：297×210mm，留边6mm，内容区 285×198mm */
  const mg = 6;

  for (let i = 0; i < pageEls.length; i++) {
    const el = pageEls[i];
    el.style.background = '#ffffff';
    const img = await html2canvas(el, {
      scale:2, useCORS:true, allowTaint:true,
      backgroundColor:'#ffffff', logging:false,
      windowWidth:  el.scrollWidth,
      windowHeight: el.scrollHeight,
      scrollX:0, scrollY:0,
    });
    if (i > 0) pdf.addPage();
    /* 固定放在 (6,6,285,198)，保持 A4 横向比例，不等比缩放导致变形 */
    pdf.addImage(img.toDataURL('image/jpeg', 0.94), 'JPEG', mg, mg, 285, 198);
  }
  pdf.save(filename);
}

async function _exportPdfPortrait(container, filename) {
  const jspdfClass = window.jspdf ? window.jspdf.jsPDF : jsPDF;

  /* 确保容器白底、脱离文档流 */
  container.style.background = '#ffffff';
  document.body.appendChild(container);
  await new Promise(r => setTimeout(r, 120));   /* 等待渲染稳定 */

  const imgCanvas = await html2canvas(container, {
    scale:          2,
    useCORS:        true,
    allowTaint:     true,
    backgroundColor:'#ffffff',
    logging:        false,
    windowWidth:    container.scrollWidth,
    windowHeight:   container.scrollHeight,
    scrollX: 0, scrollY: 0, x: 0, y: 0,
  });
  document.body.removeChild(container);

  const pdf    = new jspdfClass({ orientation:'portrait', unit:'mm', format:'a4' });
  const pageW  = pdf.internal.pageSize.getWidth();   /* 210 mm */
  const pageH  = pdf.internal.pageSize.getHeight();  /* 297 mm */
  const margin = 6;                                  /* 每页上下各 6mm 留白 */
  const contentH = pageH - margin * 2;               /* 每页可用高度 */

  const imgW   = imgCanvas.width;
  const imgH   = imgCanvas.height;
  const ratio  = pageW / imgW;                       /* mm/px */
  const pageHpx = contentH / ratio;                 /* 每页可放的 px 高度 */

  /* 辅助：安全截取一片（自动白底填充超出区域）*/
  function makeSlice(srcCanvas, yPx, hPx) {
    const sc  = document.createElement('canvas');
    sc.width  = srcCanvas.width;
    sc.height = Math.ceil(hPx);
    const ctx = sc.getContext('2d');
    ctx.fillStyle = '#ffffff';             /* ← 修复黑条：先填白 */
    ctx.fillRect(0, 0, sc.width, sc.height);
    const safeH = Math.min(hPx, srcCanvas.height - yPx);
    if (safeH > 0) {
      ctx.drawImage(srcCanvas, 0, yPx, srcCanvas.width, safeH,
                               0, 0,   sc.width,        safeH);
    }
    return sc;
  }

  if (imgH * ratio <= contentH) {
    /* 单页：加上边距居中放置 */
    const sc = makeSlice(imgCanvas, 0, imgH);
    pdf.addImage(sc.toDataURL('image/jpeg', 0.93), 'JPEG',
      0, margin, pageW, imgH * ratio);
  } else {
    let yOffset = 0;
    let pageNum = 0;
    while (yOffset < imgH) {
      const slicePx = Math.min(pageHpx, imgH - yOffset);
      const sc = makeSlice(imgCanvas, yOffset, slicePx);
      if (pageNum > 0) pdf.addPage('a4', 'portrait');
      /* 每页上方 margin mm 留白，内容高度 = slicePx * ratio */
      pdf.addImage(sc.toDataURL('image/jpeg', 0.93), 'JPEG',
        0, margin, pageW, slicePx * ratio);
      yOffset += slicePx;
      pageNum++;
    }
  }

  pdf.save(filename);
}

/* ═══════════════════════════════════════
   §20.1  品质月报 PDF
═══════════════════════════════════════ */

/* ────────────────────────────────────────────────────────────
   PDF 专用图表生成器
   - 创建隐藏临时容器，固定尺寸，独立 ECharts 实例
   - getDataURL 后立即 dispose，不影响页面图表
   - 失败时返回空字符串（PDF 仍可生成，显示"暂无数据"）
───────────────────────────────────────────────────────────── */
async function _createPdfChartImage(option, width, height) {
  if (!window.echarts) return '';
  const div = document.createElement('div');
  /* 必须 position:fixed 且不能 display:none / visibility:hidden，
     否则 ECharts 无法获取容器尺寸，图表渲染为空 */
  div.style.cssText = [
    'position:fixed',
    'left:-' + (width + 500) + 'px',
    'top:0',
    'width:' + width + 'px',
    'height:' + height + 'px',
    'background:#ffffff',
    'z-index:-9999',
    'overflow:hidden',
  ].join(';');
  document.body.appendChild(div);
  let chart = null;
  try {
    /* 确认容器尺寸已生效 */
    const actualW = div.offsetWidth  || width;
    const actualH = div.offsetHeight || height;

    /* 初始化时显式传入尺寸，避免容器尺寸检测失败 */
    chart = echarts.init(div, null, {
      renderer: 'canvas',
      width:  width,
      height: height,
    });
    chart.setOption(option);

    /* 强制 resize，确保 ECharts 以正确尺寸渲染，不依赖容器自动检测 */
    chart.resize({ width: width, height: height });

    /* 等待渲染帧完成 */
    await new Promise(r => requestAnimationFrame(r));
    await new Promise(r => setTimeout(r, 100));

    const url = chart.getDataURL({
      type:            'png',
      pixelRatio:      2,
      backgroundColor: '#ffffff',
    });
    return url || '';
  } catch(err) {
    console.warn('[PDF chart] error:', err);
    return '';
  } finally {
    if (chart) { try { chart.dispose(); } catch(e){} }
    try { document.body.removeChild(div); } catch(e){}
  }
}

/* PDF 专用颜色主题（白底，与页面深色主题无关） */
function _pdfChartTheme() {
  return {
    bg:      '#ffffff',
    text:    '#374151',
    textDim: '#6b7280',
    axis:    '#d1d5db',
    grid:    '#e5e7eb',
    blue:    '#0284c7',
    pass:    '#059669',
    red:     '#e11d48',
    yellow:  '#d97706',
    tt:      { backgroundColor:'#1e293b', borderColor:'#334155',
                textStyle:{ color:'#f1f5f9', fontSize:11 } },
  };
}

/* ── PDF 专用图表 Option 构建函数 ── */

/* 柱图：每日验货批次趋势 */
function _pdfOptDailyBatch(days, totals) {
  const c = _pdfChartTheme();
  const xInterval = days.length > 20 ? 2 : 1;
  return {
    backgroundColor: c.bg,
    tooltip: { trigger:'axis', ...c.tt },
    grid: { top:20, left:40, right:20, bottom:30, containLabel:true },
    xAxis: { type:'category', data:days,
      axisLabel:{ color:c.textDim, fontSize:10, interval:xInterval },
      axisLine:{ lineStyle:{ color:c.axis } },
      axisTick:{ show:false } },
    yAxis: { type:'value', minInterval:1, min:0,
      axisLabel:{ color:c.textDim, fontSize:10 },
      splitLine:{ lineStyle:{ color:c.grid, type:'dashed' } } },
    series:[{ name:'验货批次', type:'bar', data:totals, barMaxWidth:20,
      itemStyle:{ color:c.blue, borderRadius:[2,2,0,0] } }],
  };
}

/* 折线图：每日 PASS率趋势 */
function _pdfOptPassRate(days, rates) {
  const c = _pdfChartTheme();
  const xInterval = days.length > 20 ? 2 : 1;
  return {
    backgroundColor: c.bg,
    tooltip: { trigger:'axis', ...c.tt },
    grid: { top:20, left:42, right:20, bottom:30, containLabel:true },
    xAxis: { type:'category', data:days,
      axisLabel:{ color:c.textDim, fontSize:10, interval:xInterval },
      axisLine:{ lineStyle:{ color:c.axis } },
      axisTick:{ show:false } },
    yAxis: { type:'value', min:0, max:100,
      axisLabel:{ color:c.textDim, fontSize:10, formatter:'{value}%' },
      splitLine:{ lineStyle:{ color:c.grid, type:'dashed' } } },
    series:[{ name:'PASS率', type:'line', data:rates, smooth:true, symbol:'none',
      connectNulls:true,
      lineStyle:{ color:c.pass, width:2.5 },
      areaStyle:{ color:'rgba(5,150,105,0.06)' } }],
  };
}

/* 横向柱图：供应商 TOP10 批次不良率 */
function _pdfOptSupTop(names, bars) {
  const c = _pdfChartTheme();
  return {
    backgroundColor: c.bg,
    tooltip: { trigger:'axis', ...c.tt },
    grid: { top:8, left:8, right:52, bottom:16, containLabel:true },
    xAxis: { type:'value',
      axisLabel:{ color:c.textDim, fontSize:10, formatter:'{value}%' },
      splitLine:{ lineStyle:{ color:c.grid, type:'dashed' } } },
    yAxis: { type:'category', data:names,
      axisLabel:{ color:c.text, fontSize:10, width:80, overflow:'truncate' } },
    series:[{ name:'批次不良率', type:'bar', data:bars, barMaxWidth:16,
      itemStyle:{ color:c.red, borderRadius:[0,3,3,0] },
      label:{ show:true, position:'right', color:c.text, fontSize:10,
        formatter:p=>p.value+'%' } }],
  };
}

/* 横向柱图：不良类型 TOP10 */
function _pdfOptDefTop(names, cnts) {
  const c = _pdfChartTheme();
  return {
    backgroundColor: c.bg,
    tooltip: { trigger:'axis', ...c.tt },
    grid: { top:8, left:8, right:40, bottom:16, containLabel:true },
    xAxis: { type:'value',
      axisLabel:{ color:c.textDim, fontSize:10 },
      splitLine:{ lineStyle:{ color:c.grid, type:'dashed' } } },
    yAxis: { type:'category', data:names,
      axisLabel:{ color:c.text, fontSize:10, width:80, overflow:'truncate' } },
    series:[{ name:'次数', type:'bar', data:cnts, barMaxWidth:16,
      itemStyle:{ color:c.yellow, borderRadius:[0,3,3,0] },
      label:{ show:true, position:'right', color:c.text, fontSize:10 } }],
  };
}

/* 饼图/环形图通用（月报 PASS/REJ，客户占比，成品占比；年报客户，成品） */
function _pdfOptPie(seriesData, showLabel=true) {
  const c = _pdfChartTheme();
  return {
    backgroundColor: c.bg,
    tooltip: { trigger:'item', ...c.tt },
    legend: { bottom:2, type:'scroll',
      textStyle:{ color:c.text, fontSize:11 },
      itemWidth:11, itemHeight:8 },
    series:[{ type:'pie', radius:['48%','68%'], center:['50%','46%'],
      avoidLabelOverlap:true,
      label: showLabel
        ? { show:true, color:c.text, fontSize:11, fontWeight:600,
            formatter:'{b}\n{d}%' }
        : { show:false },
      labelLine:{ length:8, length2:10, lineStyle:{ color:c.textDim } },
      data: seriesData }],
  };
}

/* 双轴折线+柱：年报月度批次/PASS率 */
function _pdfOptYearTrend(months, mTotals, mRates) {
  const c = _pdfChartTheme();
  return {
    backgroundColor: c.bg,
    tooltip: { trigger:'axis', ...c.tt },
    legend: { data:['验货批次','PASS率(%)'], top:4, right:10,
      textStyle:{ color:c.text, fontSize:11 }, itemWidth:12, itemHeight:8 },
    grid: { top:36, left:42, right:52, bottom:28, containLabel:true },
    xAxis: { type:'category', data:months,
      axisLabel:{ color:c.textDim, fontSize:10 },
      axisLine:{ lineStyle:{ color:c.axis } }, axisTick:{ show:false } },
    yAxis:[
      { type:'value', minInterval:1, min:0,
        axisLabel:{ color:c.textDim, fontSize:10 },
        splitLine:{ lineStyle:{ color:c.grid, type:'dashed' } } },
      { type:'value', min:0, max:100,
        axisLabel:{ color:c.textDim, fontSize:10, formatter:'{value}%' },
        splitLine:{ show:false } },
    ],
    series:[
      { name:'验货批次', type:'bar', data:mTotals, barMaxWidth:24,
        itemStyle:{ color:c.blue, borderRadius:[2,2,0,0] } },
      { name:'PASS率(%)', type:'line', yAxisIndex:1, data:mRates,
        smooth:true, symbol:'circle', symbolSize:4, connectNulls:true,
        lineStyle:{ color:c.pass, width:2.5 }, itemStyle:{ color:c.pass } },
    ],
  };
}

/* 折线：年报月度平均不良率 */
function _pdfOptYearDefRate(months, mAvgRates) {
  const c = _pdfChartTheme();
  return {
    backgroundColor: c.bg,
    tooltip: { trigger:'axis', ...c.tt },
    grid: { top:20, left:42, right:20, bottom:28, containLabel:true },
    xAxis: { type:'category', data:months,
      axisLabel:{ color:c.textDim, fontSize:10 },
      axisLine:{ lineStyle:{ color:c.axis } }, axisTick:{ show:false } },
    yAxis: { type:'value',
      axisLabel:{ color:c.textDim, fontSize:10, formatter:'{value}%' },
      splitLine:{ lineStyle:{ color:c.grid, type:'dashed' } } },
    series:[{ name:'批次不良率', type:'line', data:mAvgRates,
      smooth:true, symbol:'circle', symbolSize:4, connectNulls:true,
      lineStyle:{ color:'#d97706', width:2.5 }, itemStyle:{ color:'#d97706' },
      areaStyle:{ color:'rgba(217,119,6,0.06)' } }],
  };
}

/* ══════════════════════════════════════════════════════════
   §20.1  品质月报 PDF  （全新实现：独立 ECharts 实例）
══════════════════════════════════════════════════════════ */
async function exportMonthlyReportPDF() {
  if (!window.html2canvas) {
    alert('html2canvas 未加载，请通过本地服务器打开页面（如：python3 -m http.server 8000）');
    return;
  }
  if (!window.jsPDF && !window.jspdf) {
    alert('jsPDF 未加载，请通过本地服务器打开页面（如：python3 -m http.server 8000）');
    return;
  }
  const elMonth = document.getElementById('monthlyMonth');
  if (!elMonth || !elMonth.value) { showToast('请先选择月份', 'error'); return; }

  showToast('正在生成月报 PDF，请稍候…', 'info');
  const [year, month] = elMonth.value.split('-').map(Number);
  const data      = getMonthRecords(year, month);
  const s         = summarizeRecords(data);
  const monthStr  = `${year}年${String(month).padStart(2,'0')}月`;
  const supTop    = getSupplierTopRate(data);
  const defTop    = getDefectTopCount(data);
  const clientShare = getClientShare(data);
  const typeShare   = getTypeShare(data);
  const trend       = getMonthlyDailyTrend(data, year, month);
  const highRiskSups = (() => {
    const byS = groupBy(data,'supplier');
    return Object.entries(byS).filter(([,arr])=>{
      const rejN=arr.filter(r=>isFail(r)).length;
      const smp=arr.reduce((a,r)=>a+(Number(r.sampleQty)||0),0);
      const fl=arr.reduce((a,r)=>a+(Number(r.fail)||0),0);
      return rejN>=2||(smp>0&&fl/smp>=0.05);
    }).map(([n])=>n);
  })();

  /* 安全千分位格式化（避免中文locale产生异常逗号分组）*/
  /* 安全千分位：先去除非数字字符（防止字符串如"119,420"被 Number() 解析成 NaN）*/
  const fmtN = n => {
    const raw = typeof n === 'string' ? n.replace(/[^\d.-]/g, '') : n;
    const x = Math.floor(Math.abs(Number(raw) || 0));
    return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  };

  /* ── 颜色常量 ── */
  const PIE_COLS = ['#0284c7','#059669','#d97706','#e11d48','#8b5cf6','#0891b2','#65a30d'];

  /* ── 数据准备（调试日志）── */
  const days   = trend.map(t => t.date);
  /* totals: null→0，确保柱图数据全为数字 */
  const totals = trend.map(t => typeof t.total === 'number' ? t.total : 0);
  /* rates: null 保留（连接空值），非 null 确保是数字 */
  const rates  = trend.map(t => t.rate != null ? Number(t.rate) : null);


  /* ── 生成 PDF 专用图表图片（全部独立 ECharts 实例）── */

  /* PAGE1 图表 */
  const imgC1 = await _createPdfChartImage(_pdfOptDailyBatch(days, totals), 880, 300);
  const imgC2 = await _createPdfChartImage(_pdfOptPassRate(days, rates), 700, 280);

  const supNames = supTop.length ? supTop.map(x=>x.name).reverse() : [];
  /* batchRate 必须是数字 */
  const supBars  = supTop.length ? supTop.map(x=>Number(x.batchRate)).reverse() : [];
  const imgC3 = supTop.length
    ? await _createPdfChartImage(_pdfOptSupTop(supNames, supBars), 700, 280)
    : '';

  /* PASS/REJ 饼图：保留两项（即使其中一个为0，也保留，避免全空） */
  const piePassRejData = [
    { name:'PASS', value: Number(s.passCnt)||0, itemStyle:{ color:'#059669' } },
    { name:'REJ',  value: Number(s.failCnt)||0,  itemStyle:{ color:'#e11d48' } },
  ].filter(d => d.value > 0);
  const imgC4 = (s.total > 0)
    ? await _createPdfChartImage(_pdfOptPie(piePassRejData, true), 420, 300)
    : '';

  /* PAGE2 图表 */
  const clientPieData = clientShare.slice(0,7).map((d,i)=>({
    name: String(d.name||'未知'),
    value: Number(d.value)||0,
    itemStyle:{ color:PIE_COLS[i%PIE_COLS.length] } }))
    .filter(d => d.value > 0);
  const imgC5 = clientPieData.length
    ? await _createPdfChartImage(_pdfOptPie(clientPieData, false), 430, 300)
    : '';

  const defNames = defTop.length ? defTop.slice(0,10).map(([d])=>String(d)).reverse() : [];
  const defCnts  = defTop.length ? defTop.slice(0,10).map(([,n])=>Number(n)||0).reverse() : [];
  const imgC6 = defTop.length
    ? await _createPdfChartImage(_pdfOptDefTop(defNames, defCnts), 430, 300)
    : '';

  const typePieData = typeShare.map((d,i)=>({
    name: String(d.name||'未知'),
    value: Number(d.value)||0,
    itemStyle:{ color:PIE_COLS[i%PIE_COLS.length] } }))
    .filter(d => d.value > 0);
  const imgC7 = typePieData.length
    ? await _createPdfChartImage(_pdfOptPie(typePieData, true), 430, 300)
    : '';

  /* ── 模板辅助函数 ── */
  /* valFs：根据数值字符数自动缩小字号，防止在窄列中被截断 */
  const _valFs = v => String(v).length <= 7 ? '22px' : String(v).length <= 10 ? '19px' : '16px';
  const kpi = (label,val,sub,cls='') =>
    `<div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:5px;padding:10px 12px;border-left:4px solid ${cls==='g'?'#059669':cls==='r'?'#e11d48':'#0284c7'};overflow:visible">
      <div style="font-size:11px;color:#6b7280;margin-bottom:3px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${label}</div>
      <div style="font-size:${_valFs(val)};font-weight:700;color:${cls==='g'?'#047857':cls==='r'?'#dc2626':'#0284c7'};white-space:nowrap;letter-spacing:0;font-variant-numeric:tabular-nums">${val}</div>
      <div style="font-size:10px;color:#9ca3af;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${sub}</div>
    </div>`;

  /* 普通图表卡片（横向柱/折线） */
  const ci = (img, title, h='280px') => img
    ? `<div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:5px;padding:8px 10px">
        <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:6px">${title}</div>
        <img src="${img}" style="width:100%;height:auto;max-height:${h};display:block;object-fit:contain"/>
      </div>`
    : `<div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:5px;padding:8px 10px">
        <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:6px">${title}</div>
        <div style="height:${h};display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:11px">暂无数据</div>
      </div>`;

  /* 饼图卡片（保持圆形，object-fit:contain，居中） */
  const pieci = (img, title, h='280px') => img
    ? `<div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:5px;padding:8px 10px;display:flex;flex-direction:column">
        <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:6px">${title}</div>
        <div style="flex:1;display:flex;align-items:center;justify-content:center">
          <img src="${img}" style="height:${h};width:auto;max-width:100%;object-fit:contain;display:block;margin:0 auto"/>
        </div>
      </div>`
    : `<div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:5px;padding:8px 10px">
        <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:6px">${title}</div>
        <div style="height:${h};display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:11px">暂无数据</div>
      </div>`;

  /* 明细行 */
  const sorted  = data.slice().sort((a,b)=>a.date.localeCompare(b.date));
  const show    = sorted.slice(0,50);
  const hasMore = data.length > 50;
  const drows   = show.map(r =>
    `<tr style="border-bottom:1px solid #f0f4f8">
      <td style="padding:5px 8px;white-space:nowrap">${r.date}</td>
      <td style="padding:5px 8px"><b>${r.supplier}</b></td>
      <td style="padding:5px 8px">${r.client||'-'}</td>
      <td style="padding:5px 8px">${r.productNo||'-'}</td>
      <td style="padding:5px 8px;max-width:120px;overflow:hidden;text-overflow:ellipsis">${r.productName||'-'}</td>
      <td style="padding:5px 8px;text-align:right">${(r.qty||0).toLocaleString()}</td>
      <td style="padding:5px 8px;text-align:right">${r.sampleQty??'—'}</td>
      <td style="padding:5px 8px;text-align:right;color:${(r.fail||0)>0?'#dc2626':'#111827'}">${r.fail||0}</td>
      <td style="padding:5px 8px">${r.sampleQty?r.defectRate||'0.00%':'—'}</td>
      <td style="padding:5px 8px;color:${isPass(r)?'#047857':'#dc2626'};font-weight:600">${r.result}</td>
      <td style="padding:5px 8px">${r.qc||'-'}</td>
    </tr>`).join('');

  _ensurePdfStyle();
  const hdr = (sub) =>
    `<div style="font-family:Arial,'Microsoft YaHei',sans-serif;color:#111827;margin-bottom:10px">
      <div style="font-size:24px;font-weight:800;text-align:center;color:#0f172a;letter-spacing:1px">品&ensp;质&ensp;月&ensp;报</div>
      <div style="font-size:12px;text-align:center;color:#374151;margin-top:2px">东莞兴信塑胶制品有限公司</div>
      <div style="font-size:10px;text-align:center;color:#6b7280;margin:2px 0 8px">${sub}　生成时间：${new Date().toLocaleString('zh-CN')}</div>
      <hr style="border:none;border-top:2px solid #0284c7;margin:0"/>
    </div>`;

  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;left:-12000px;top:0;z-index:-1;font-family:Arial,Microsoft YaHei,sans-serif';
  wrap.innerHTML = `
  <!-- PAGE 1: 概览 -->
  <div class="rpt-pdf-page" style="width:1480px;height:1046px;background:#ffffff;color:#111827;padding:28px 36px;box-sizing:border-box;overflow:hidden;font-family:Arial,'Microsoft YaHei',sans-serif">
    ${hdr('报告期间：'+monthStr)}
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px">
      ${kpi('本月验货批次',s.total,'来货 '+fmtN(s.totalQty)+' 件','b')}
      ${kpi('本月PASS率',s.passRate+'%','PASS '+s.passCnt+' / REJ '+s.failCnt,'g')}
      ${kpi('本月不良数量',fmtN(s.totalFail),'仅统计已录入不良数量',s.totalFail>0?'r':'g')}
      ${kpi('高风险供应商',s.highRisk,'活跃 '+s.suppliers+' 家',s.highRisk>0?'r':'g')}
      ${kpi('来货总数',fmtN(s.totalQty),'件','')}
      ${kpi('抽查总数',fmtN(s.totalSmp),'件','')}
      ${kpi('批次不良率',s.total>0?(s.failCnt/s.total*100).toFixed(1)+'%':'—','REJ批次/总批次','')}
      ${kpi('活跃供应商',s.suppliers,'家','')}
    </div>
    <div style="font-size:14px;font-weight:700;color:#0284c7;border-left:4px solid #0284c7;padding-left:8px;margin:8px 0">图表分析（一）</div>
    <div style="display:grid;grid-template-columns:2fr 1fr;gap:10px;margin-bottom:8px">
      ${ci(imgC1,'每日验货批次趋势','290px')}
      ${pieci(imgC4,'PASS / REJ 分布','260px')}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      ${ci(imgC2,'每日 PASS率趋势','270px')}
      ${ci(imgC3,'供应商批次不良率 TOP10','280px')}
    </div>
  </div>

  <!-- PAGE 2: 分析 -->
  <div class="rpt-pdf-page" style="width:1480px;height:1046px;background:#ffffff;color:#111827;padding:28px 36px;box-sizing:border-box;overflow:hidden;font-family:Arial,'Microsoft YaHei',sans-serif">
    ${hdr('报告期间：'+monthStr+' · 第2页')}
    <div style="font-size:14px;font-weight:700;color:#0284c7;border-left:4px solid #0284c7;padding-left:8px;margin:0 0 10px">图表分析（二）</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:16px">
      ${pieci(imgC5,'客户占比（按批次）','370px')}
      ${ci(imgC6,'不良类型 TOP10','380px')}
      ${pieci(imgC7,'成品/半成品占比','370px')}
    </div>
    <div style="font-size:14px;font-weight:700;color:#0284c7;border-left:4px solid #0284c7;padding-left:8px;margin:0 0 10px">重点分析与改善建议</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
      <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:5px;padding:20px">
        <div style="font-size:13px;font-weight:700;color:#0284c7;margin-bottom:10px">本月重点问题</div>
        <ul style="margin:0 0 0 18px;font-size:13px;color:#374151;line-height:2.4">
          ${defTop.slice(0,5).map(([d,n])=>`<li>${d}（${n}次）</li>`).join('')||'<li>本月无明显不良问题</li>'}
        </ul>
      </div>
      <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:5px;padding:20px">
        <div style="font-size:13px;font-weight:700;color:#0284c7;margin-bottom:10px">本月改善建议</div>
        <ul style="margin:0 0 0 18px;font-size:13px;color:#374151;line-height:2.4">
          ${highRiskSups.length?`<li>高风险供应商：${highRiskSups.join('、')}，需重点跟进</li>`:'<li>本月无高风险供应商</li>'}
          ${s.failCnt>0?`<li>本月REJ ${s.failCnt}批，建议供应商提交改善措施</li>`:'<li>本月全部批次通过检验</li>'}
          ${defTop[0]?`<li>主要不良「${defTop.slice(0,3).map(([d])=>d).join('、')}」需重点管控</li>`:''}
        </ul>
      </div>
    </div>
  </div>

  <!-- PAGE 3: 明细 -->
  <div class="rpt-pdf-page" style="width:1480px;height:1046px;background:#ffffff;color:#111827;padding:28px 36px;box-sizing:border-box;overflow:hidden;font-family:Arial,'Microsoft YaHei',sans-serif">
    ${hdr(monthStr+' · 本月验货明细'+(hasMore?`（前50条 / 共${data.length}条）`:''))}
    ${hasMore?`<div style="font-size:10px;color:#9ca3af;text-align:right;margin-bottom:4px">* 完整数据请查看系统验货明细页面</div>`:''}
    <table style="width:100%;border-collapse:collapse;font-size:11.5px">
      <thead>
        <tr style="background:#f1f5f9">
          <th style="padding:9px 8px;border:1px solid #d1d5db;text-align:left;font-weight:700;font-size:11.5px">日期</th>
          <th style="padding:9px 8px;border:1px solid #d1d5db;font-weight:700">供应商</th>
          <th style="padding:9px 8px;border:1px solid #d1d5db;font-weight:700">客户</th>
          <th style="padding:9px 8px;border:1px solid #d1d5db;font-weight:700">货号</th>
          <th style="padding:9px 8px;border:1px solid #d1d5db;font-weight:700">款式</th>
          <th style="padding:9px 8px;border:1px solid #d1d5db;font-weight:700">来货数</th>
          <th style="padding:9px 8px;border:1px solid #d1d5db;font-weight:700">抽查数</th>
          <th style="padding:9px 8px;border:1px solid #d1d5db;font-weight:700">FAIL</th>
          <th style="padding:9px 8px;border:1px solid #d1d5db;font-weight:700">不良率</th>
          <th style="padding:9px 8px;border:1px solid #d1d5db;font-weight:700">判定</th>
          <th style="padding:9px 8px;border:1px solid #d1d5db;font-weight:700">检验员</th>
        </tr>
      </thead>
      <tbody>
        ${drows||'<tr><td colspan="11" style="text-align:center;padding:20px;color:#9ca3af;font-size:12px">本月暂无验货记录</td></tr>'}
      </tbody>
    </table>
  </div>`;

  document.body.appendChild(wrap);
  await new Promise(r=>setTimeout(r,100));
  const pages = wrap.querySelectorAll('.rpt-pdf-page');
  try {
    await _exportPdfLandscapePages(Array.from(pages), `品质月报_${year}-${String(month).padStart(2,'0')}.pdf`);
    showToast('✓ 月报 PDF 已导出','success');
  } catch(e) {
    console.error('[Monthly PDF]',e);
    alert('月报 PDF 导出失败：' + e.message);
    showToast('月报 PDF 导出失败','error');
  } finally {
    document.body.removeChild(wrap);
  }
}

/* ══════════════════════════════════════════════════════════
   §20.2  品质年报 PDF  （全新实现：独立 ECharts 实例）
══════════════════════════════════════════════════════════ */
async function exportYearlyReportPDF() {
  if (!window.html2canvas) {
    alert('html2canvas 未加载，请通过本地服务器打开页面（如：python3 -m http.server 8000）');
    return;
  }
  if (!window.jsPDF && !window.jspdf) {
    alert('jsPDF 未加载，请通过本地服务器打开页面（如：python3 -m http.server 8000）');
    return;
  }
  const elYear = document.getElementById('yearlyYear');
  if (!elYear || !elYear.value) { showToast('请先选择年份', 'error'); return; }

  showToast('正在生成年报 PDF，请稍候…', 'info');
  const year       = parseInt(elYear.value);
  const data       = getYearRecords(year);
  const s          = summarizeRecords(data);
  const monthTrend = getYearlyMonthlyTrend(data, year);
  const supTop     = getSupplierTopRate(data);
  const defTop     = getDefectTopCount(data);
  const clientShare = getClientShare(data);
  const typeShare   = getTypeShare(data);
  const highRiskSups = (() => {
    const byS = groupBy(data,'supplier');
    return Object.entries(byS).filter(([,arr])=>{
      const rejN=arr.filter(r=>isFail(r)).length;
      const smp=arr.reduce((a,r)=>a+(Number(r.sampleQty)||0),0);
      const fl=arr.reduce((a,r)=>a+(Number(r.fail)||0),0);
      return rejN>=2||(smp>0&&fl/smp>=0.05);
    }).map(([n])=>n);
  })();

  /* 安全千分位格式化 */
  /* 安全千分位：先去除非数字字符（防止字符串如"119,420"被 Number() 解析成 NaN）*/
  const fmtN = n => {
    const raw = typeof n === 'string' ? n.replace(/[^\d.-]/g, '') : n;
    const x = Math.floor(Math.abs(Number(raw) || 0));
    return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  };

  const PIE_COLS = ['#0284c7','#059669','#d97706','#e11d48','#8b5cf6','#0891b2','#65a30d'];
  const months    = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
  /* 确保数据类型正确 */
  const mTotals        = monthTrend.map(m => Number(m.total) || 0);
  const mRates         = monthTrend.map(m => m.passRate != null ? Number(m.passRate) : null);
  /* 批次口径：REJ批次/总批次，与供应商排名和页面图表一致 */
  const mBatchDefRates = monthTrend.map(m => m.batchDefectRate != null ? Number(m.batchDefectRate) : null);
  /* 数量口径：仅供汇总表参考，不用于趋势图 */
  const mAvgRates      = monthTrend.map(m => m.avgRate != null ? Number(m.avgRate) : null);


  /* ── 生成 PDF 专用图表图片 ── */
  /* PAGE1 */
  const imgY1 = await _createPdfChartImage(_pdfOptYearTrend(months, mTotals, mRates), 690, 360);
  const imgY2 = await _createPdfChartImage(_pdfOptYearDefRate(months, mBatchDefRates), 690, 360);

  /* PAGE2 */
  const supNames = supTop.length ? supTop.map(x=>String(x.name)).reverse() : [];
  const supBars  = supTop.length ? supTop.map(x=>Number(x.batchRate)).reverse() : [];
  const imgY3 = supTop.length
    ? await _createPdfChartImage(_pdfOptSupTop(supNames, supBars), 650, 300)
    : '';

  const defNames = defTop.length ? defTop.slice(0,10).map(([d])=>String(d)).reverse() : [];
  const defCnts  = defTop.length ? defTop.slice(0,10).map(([,n])=>Number(n)||0).reverse() : [];
  const imgY4 = defTop.length
    ? await _createPdfChartImage(_pdfOptDefTop(defNames, defCnts), 650, 300)
    : '';

  const clientPieData = clientShare.slice(0,7).map((d,i)=>({
    name: String(d.name||'未知'),
    value: Number(d.value)||0,
    itemStyle:{ color:PIE_COLS[i%PIE_COLS.length] } }))
    .filter(d => d.value > 0);
  const imgY5 = clientPieData.length
    ? await _createPdfChartImage(_pdfOptPie(clientPieData, false), 650, 300)
    : '';

  const typePieData = typeShare.map((d,i)=>({
    name: String(d.name||'未知'),
    value: Number(d.value)||0,
    itemStyle:{ color:PIE_COLS[i%PIE_COLS.length] } }))
    .filter(d => d.value > 0);
  const imgY6 = typePieData.length
    ? await _createPdfChartImage(_pdfOptPie(typePieData, true), 650, 300)
    : '';

  /* ── 模板辅助函数 ── */
  /* valFs：根据数值字符数自动缩小字号，防止在窄列中被截断 */
  const _valFs = v => String(v).length <= 7 ? '22px' : String(v).length <= 10 ? '19px' : '16px';
  const kpi = (label,val,sub,cls='') =>
    `<div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:5px;padding:10px 12px;border-left:4px solid ${cls==='g'?'#059669':cls==='r'?'#e11d48':'#0284c7'};overflow:visible">
      <div style="font-size:11px;color:#6b7280;margin-bottom:3px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${label}</div>
      <div style="font-size:${_valFs(val)};font-weight:700;color:${cls==='g'?'#047857':cls==='r'?'#dc2626':'#0284c7'};white-space:nowrap;letter-spacing:0;font-variant-numeric:tabular-nums">${val}</div>
      <div style="font-size:10px;color:#9ca3af;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${sub}</div>
    </div>`;

  const yci = (img, title, h='300px') => img
    ? `<div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:5px;padding:8px 10px">
        <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:6px">${title}</div>
        <img src="${img}" style="width:100%;height:auto;max-height:${h};display:block;object-fit:contain"/>
      </div>`
    : `<div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:5px;padding:8px 10px">
        <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:6px">${title}</div>
        <div style="height:${h};display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:11px">暂无数据</div>
      </div>`;

  const ypci = (img, title, h='270px') => img
    ? `<div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:5px;padding:8px 10px;display:flex;flex-direction:column">
        <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:6px">${title}</div>
        <div style="flex:1;display:flex;align-items:center;justify-content:center">
          <img src="${img}" style="height:${h};width:auto;max-width:100%;object-fit:contain;display:block;margin:0 auto"/>
        </div>
      </div>`
    : `<div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:5px;padding:8px 10px">
        <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:6px">${title}</div>
        <div style="height:${h};display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:11px">暂无数据</div>
      </div>`;

  /* 年报汇总表行 */
  const mRows = monthTrend.map(m =>
    `<tr style="border-bottom:1px solid #f0f4f8">
      <td style="padding:11px 12px;font-weight:600">${m.month}</td>
      <td style="padding:11px 12px;text-align:right">${m.total||'-'}</td>
      <td style="padding:11px 12px;text-align:right;color:#047857">${m.passCnt||0}</td>
      <td style="padding:11px 12px;text-align:right;color:${m.failCnt?'#dc2626':'#111827'}">${m.failCnt||0}</td>
      <td style="padding:11px 12px;text-align:right">${m.passRate!=null?m.passRate+'%':'—'}</td>
      <td style="padding:11px 12px;text-align:right">${m.totalFail||0}</td>
      <td style="padding:11px 12px;text-align:right">${m.totalQty.toLocaleString()}</td>
      <td style="padding:11px 12px;text-align:right">${m.avgRate!=null?m.avgRate+'%':'—'}</td>
    </tr>`).join('');
  const totalRow =
    `<tr style="font-weight:700;background:#e5e7eb">
      <td style="padding:11px 12px">合计</td>
      <td style="padding:11px 12px;text-align:right">${s.total}</td>
      <td style="padding:11px 12px;text-align:right;color:#047857">${s.passCnt}</td>
      <td style="padding:11px 12px;text-align:right;color:${s.failCnt?'#dc2626':'#111827'}">${s.failCnt}</td>
      <td style="padding:11px 12px;text-align:right">${s.passRate}%</td>
      <td style="padding:11px 12px;text-align:right">${s.totalFail}</td>
      <td style="padding:11px 12px;text-align:right">${s.totalQty.toLocaleString()}</td>
      <td style="padding:11px 12px;text-align:right">${s.avgRate}</td>
    </tr>`;

  _ensurePdfStyle();
  const hdr = (sub) =>
    `<div style="font-family:Arial,'Microsoft YaHei',sans-serif;color:#111827;margin-bottom:10px">
      <div style="font-size:24px;font-weight:800;text-align:center;color:#0f172a;letter-spacing:1px">品&ensp;质&ensp;年&ensp;报</div>
      <div style="font-size:12px;text-align:center;color:#374151;margin-top:2px">东莞兴信塑胶制品有限公司</div>
      <div style="font-size:10px;text-align:center;color:#6b7280;margin:2px 0 8px">${sub}　生成时间：${new Date().toLocaleString('zh-CN')}</div>
      <hr style="border:none;border-top:2px solid #0284c7;margin:0"/>
    </div>`;

  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;left:-12000px;top:0;z-index:-1;font-family:Arial,Microsoft YaHei,sans-serif';
  wrap.innerHTML = `
  <!-- PAGE 1: 年度概览与趋势 -->
  <div class="rpt-pdf-page" style="width:1480px;height:1046px;background:#ffffff;color:#111827;padding:28px 36px;box-sizing:border-box;overflow:hidden;font-family:Arial,'Microsoft YaHei',sans-serif">
    ${hdr('报告期间：'+year+'年度')}
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px">
      ${kpi('年度验货批次',s.total,'来货 '+fmtN(s.totalQty)+' 件','b')}
      ${kpi('年度PASS率',s.passRate+'%','PASS '+s.passCnt+' / REJ '+s.failCnt,'g')}
      ${kpi('年度不良数量',fmtN(s.totalFail),'仅统计已录入不良数量',s.totalFail>0?'r':'g')}
      ${kpi('高风险供应商',s.highRisk,'活跃 '+s.suppliers+' 家',s.highRisk>0?'r':'g')}
      ${kpi('年度来货总数',fmtN(s.totalQty),'件','')}
      ${kpi('年度抽查总数',fmtN(s.totalSmp),'件','')}
      ${kpi('年度批次不良率',s.total>0?(s.failCnt/s.total*100).toFixed(1)+'%':'—','REJ批次/总批次','')}
      ${kpi('年度活跃供应商',s.suppliers,'家','')}
    </div>
    <div style="font-size:14px;font-weight:700;color:#0284c7;border-left:4px solid #0284c7;padding-left:8px;margin:8px 0 10px">年度趋势</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      ${yci(imgY1,'12个月验货批次 / PASS率（完整月份）','460px')}
      ${yci(imgY2,'12个月批次不良率趋势','460px')}
    </div>
  </div>

  <!-- PAGE 2: TOP分析 + 改善建议 -->
  <div class="rpt-pdf-page" style="width:1480px;height:1046px;background:#ffffff;color:#111827;padding:28px 36px;box-sizing:border-box;overflow:hidden;font-family:Arial,'Microsoft YaHei',sans-serif">
    ${hdr('报告期间：'+year+'年度 · 第2页')}
    <div style="font-size:14px;font-weight:700;color:#0284c7;border-left:4px solid #0284c7;padding-left:8px;margin:0 0 8px">年度TOP分析</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
      ${yci(imgY3,'年度供应商批次不良率 TOP10','280px')}
      ${yci(imgY4,'年度不良类型 TOP10','280px')}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
      ${ypci(imgY5,'年度客户占比（按批次）','255px')}
      ${ypci(imgY6,'年度成品/半成品占比','255px')}
    </div>
    <div style="font-size:14px;font-weight:700;color:#0284c7;border-left:4px solid #0284c7;padding-left:8px;margin:0 0 10px">年度重点分析与改善建议</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
      <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:5px;padding:16px">
        <div style="font-size:13px;font-weight:700;color:#0284c7;margin-bottom:10px">年度主要质量问题</div>
        <ul style="margin:0 0 0 18px;font-size:12px;color:#374151;line-height:2.2">
          ${defTop.slice(0,5).map(([d,n])=>`<li>${d}（${n}次）</li>`).join('')||'<li>年度无明显不良问题</li>'}
        </ul>
      </div>
      <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:5px;padding:16px">
        <div style="font-size:13px;font-weight:700;color:#0284c7;margin-bottom:10px">年度改善建议</div>
        <ul style="margin:0 0 0 18px;font-size:12px;color:#374151;line-height:2.2">
          ${highRiskSups.length?`<li>高风险供应商：${highRiskSups.join('、')}，建议重点管控</li>`:'<li>年度无高风险供应商</li>'}
          ${s.failCnt>0?`<li>全年REJ ${s.failCnt}批（${(s.failCnt/s.total*100).toFixed(1)}%），持续改善</li>`:'<li>全年批次全部通过，质量稳定</li>'}
          ${defTop[0]?`<li>主要不良「${defTop.slice(0,3).map(([d])=>d).join('、')}」需重点攻关</li>`:''}
          <li>建议持续推进供应商质量提升计划</li>
        </ul>
      </div>
    </div>
  </div>

  <!-- PAGE 3: 12个月汇总 -->
  <div class="rpt-pdf-page" style="width:1480px;height:1046px;background:#ffffff;color:#111827;padding:28px 36px;box-sizing:border-box;overflow:hidden;font-family:Arial,'Microsoft YaHei',sans-serif">
    ${hdr(year+'年度 · 12个月汇总')}
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead>
        <tr style="background:#f1f5f9">
          <th style="padding:13px 12px;border:1px solid #d1d5db;text-align:left;font-weight:700;font-size:13px">月份</th>
          <th style="padding:13px 12px;border:1px solid #d1d5db;text-align:right;font-weight:700">验货批次</th>
          <th style="padding:13px 12px;border:1px solid #d1d5db;text-align:right;font-weight:700">PASS</th>
          <th style="padding:13px 12px;border:1px solid #d1d5db;text-align:right;font-weight:700">REJ</th>
          <th style="padding:13px 12px;border:1px solid #d1d5db;text-align:right;font-weight:700">PASS率</th>
          <th style="padding:13px 12px;border:1px solid #d1d5db;text-align:right;font-weight:700">不良数量</th>
          <th style="padding:13px 12px;border:1px solid #d1d5db;text-align:right;font-weight:700">来货数</th>
          <th style="padding:13px 12px;border:1px solid #d1d5db;text-align:right;font-weight:700">数量不良率</th>
        </tr>
      </thead>
      <tbody>${mRows}${totalRow}</tbody>
    </table>
    <!-- 年度总结 + 签核栏（减少留白） -->
    <div style="margin-top:28px;display:grid;grid-template-columns:1fr 1fr;gap:20px">
      <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:5px;padding:14px 16px">
        <div style="font-size:13px;font-weight:700;color:#0284c7;margin-bottom:10px">年度质量总结</div>
        <ul style="margin:0 0 0 18px;font-size:13px;color:#374151;line-height:2.4">
          <li>全年验货批次：<strong>${s.total}</strong> 批，总体 PASS率：<strong>${s.passRate}%</strong></li>
          <li>全年来货总量：<strong>${s.totalQty.toLocaleString()}</strong> 件，抽查 <strong>${s.totalSmp.toLocaleString()}</strong> 件</li>
          ${s.totalFail > 0 ? `<li>全年累计 FAIL 数量：<strong style="color:#dc2626">${s.totalFail}</strong> 件，平均不良率 <strong style="color:#dc2626">${s.avgRate}</strong></li>` : '<li>全年未发现不良，质量表现优异</li>'}
          ${defTop[0] ? `<li>年度主要不良：「${defTop.slice(0,3).map(([d])=>d).join('、')}」，需持续改善</li>` : ''}
          <li>建议来年持续推进供应商质量管控体系建设</li>
        </ul>
      </div>
      <div>
        <div style="font-size:13px;font-weight:700;color:#374151;margin-bottom:12px">审批签核</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;font-size:12px;color:#374151">
          <div style="border:1px solid #d1d5db;border-radius:4px;padding:10px 12px">
            <div style="font-weight:600;margin-bottom:22px">制表人</div>
            <div style="border-top:1px solid #9ca3af;padding-top:6px;color:#9ca3af;font-size:11px">签名 / 日期</div>
          </div>
          <div style="border:1px solid #d1d5db;border-radius:4px;padding:10px 12px">
            <div style="font-weight:600;margin-bottom:22px">品质主管审核</div>
            <div style="border-top:1px solid #9ca3af;padding-top:6px;color:#9ca3af;font-size:11px">签名 / 日期</div>
          </div>
          <div style="border:1px solid #d1d5db;border-radius:4px;padding:10px 12px">
            <div style="font-weight:600;margin-bottom:22px">管理层批准</div>
            <div style="border-top:1px solid #9ca3af;padding-top:6px;color:#9ca3af;font-size:11px">签名 / 日期</div>
          </div>
        </div>
        <div style="margin-top:14px;font-size:11px;color:#9ca3af;text-align:right">
          东莞兴信塑胶制品有限公司 · 品质管理部 · ${year}年度
        </div>
      </div>
    </div>
  </div>`;

  document.body.appendChild(wrap);
  await new Promise(r=>setTimeout(r,100));
  const pages = wrap.querySelectorAll('.rpt-pdf-page');
  try {
    await _exportPdfLandscapePages(Array.from(pages), `品质年报_${year}.pdf`);
    showToast('✓ 年报 PDF 已导出','success');
  } catch(e) {
    console.error('[Yearly PDF]',e);
    alert('年报 PDF 导出失败：' + e.message);
    showToast('年报 PDF 导出失败','error');
  } finally {
    document.body.removeChild(wrap);
  }
}

/* ════════════════════════════════════════
   § WINDOW BINDINGS
   HTML inline onclick/oninput 需要从全局 window 访问这些函数。
   let/function 在顶层作用域声明，但在部分浏览器引擎不自动挂到 window，
   统一在此显式挂载，确保内联事件可访问。
════════════════════════════════════════ */

/* ── 测量数据模块 ── */
window.addMeasRow            = addMeasRow;
window.removeMeasRow         = removeMeasRow;
window._renderMeasRows       = _renderMeasRows;
window._onMeasTypeChange     = _onMeasTypeChange;
window.updateMeasCell        = updateMeasCell;
window.updateMeasField       = updateMeasField;
window.updateMeasAvgAndJudge = updateMeasAvgAndJudge;

/* ── 不良明细模块 ── */
window.addDefectRow          = addDefectRow;
window.removeDefectRow       = removeDefectRow;
window._renderDefectRows     = _renderDefectRows;
window.onDefectDescSelect    = onDefectDescSelect;

/* ── 不良描述库管理 ── */
window.renderDefectLibPage   = renderDefectLibPage;
window._openDefLibModal      = _openDefLibModal;
window._closeDefLibModal     = _closeDefLibModal;
window._saveDefLibItem       = _saveDefLibItem;
window._toggleDefLibItem     = _toggleDefLibItem;
window._deleteDefLibItem     = _deleteDefLibItem;

/* ── 表单联动 ── */
window.onQtyChange           = onQtyChange;
window.onSampleQtyChange     = onSampleQtyChange;
window.applyAqlSuggest       = applyAqlSuggest;
window.onProductNoChange     = onProductNoChange;
window.onTypeChange          = onTypeChange;
window.calcRate              = calcRate;
