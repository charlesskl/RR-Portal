const $ = (id) => document.getElementById(id);

async function api(path, opts = {}) {
  const r = await fetch('/api' + path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.json();
}

const ROLE_ZH = { admin: '管理员', supervisor: '主管', staff: '员工' };

// HTML 转义：用户可控字段(用户名/姓名/客户名)插入 innerHTML 前必须过它，防 XSS
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

async function init() {
  let me;
  try {
    me = await api('/auth/me');
  } catch {
    location.href = './index.html';
    return;
  }
  if (!me.perms || !me.perms['账号管理'] || !me.perms['账号管理'].can_admin) {
    document.body.innerHTML = '<div style="padding:40px;text-align:center"><h2>无权访问</h2><a href="./index.html">← 返回</a></div>';
    return;
  }
  $('who-chip').textContent = `${me.display_name || me.username} · 管理员`;
  window.__me = me;
  await loadUsers();
}

async function loadUsers() {
  const rows = await api('/admin/users');
  const tbody = $('users-tbody');
  tbody.innerHTML = '';
  for (const u of rows) {
    const tr = document.createElement('tr');
    const isLocked = !!u.is_locked;
    const last = u.last_login ? new Date(u.last_login.includes('T') ? u.last_login : u.last_login.replace(' ', 'T') + 'Z').toLocaleString() : '—';
    tr.innerHTML = `
      <td>${u.id}</td>
      <td><b>${esc(u.username)}</b></td>
      <td>${esc(u.display_name)}</td>
      <td>${esc(u.dept_name || u.dept)}</td>
      <td>${ROLE_ZH[u.role] || u.role}</td>
      <td>${isLocked ? '<span class="badge b-empty">已锁定</span>' : '<span class="badge b-approved">正常</span>'}</td>
      <td class="ro" style="font-size:12px">${last}</td>
      <td>
        <button class="mini btn-perms" data-id="${u.id}" data-username="${esc(u.username)}">✏️ 权限</button>
        <button class="mini btn-cust" data-id="${u.id}" data-username="${esc(u.username)}">🎯 客户范围</button>
        <button class="mini btn-reset" data-id="${u.id}" data-username="${esc(u.username)}">重置密码</button>
        ${isLocked
          ? `<button class="mini btn-unlock" data-id="${u.id}">解锁</button>`
          : `<button class="mini btn-lock" data-id="${u.id}" data-username="${esc(u.username)}">锁定</button>`}
        <button class="mini danger btn-del" data-id="${u.id}" data-username="${esc(u.username)}">删除</button>
      </td>`;
    tbody.appendChild(tr);
  }
  // 绑定按钮
  document.querySelectorAll('.btn-perms').forEach(b => b.onclick = () => openPerms(b.dataset.id, b.dataset.username));
  document.querySelectorAll('.btn-cust').forEach(b => b.onclick = () => openCust(b.dataset.id, b.dataset.username));
  document.querySelectorAll('.btn-reset').forEach(b => b.onclick = () => resetPwd(b.dataset.id, b.dataset.username));
  document.querySelectorAll('.btn-lock').forEach(b => b.onclick = () => lockUser(b.dataset.id, b.dataset.username));
  document.querySelectorAll('.btn-unlock').forEach(b => b.onclick = () => unlockUser(b.dataset.id));
  document.querySelectorAll('.btn-del').forEach(b => b.onclick = () => delUser(b.dataset.id, b.dataset.username));
}

// ============== 权限矩阵抽屉 ==============
let __permState = { userId: null, username: null, perms: [] };

async function openPerms(id, username) {
  __permState.userId = +id;
  __permState.username = username;
  $('pd-user').textContent = username;
  $('pd-msg').textContent = '';
  try {
    const r = await api('/admin/users/' + id + '/perms');
    __permState.perms = r.perms;
    renderPermMatrix();
    $('perm-overlay').classList.remove('hidden');
    $('perm-drawer').classList.remove('hidden');
  } catch (e) { alert(e.message); }
}

function closePerms() {
  $('perm-overlay').classList.add('hidden');
  $('perm-drawer').classList.add('hidden');
}

function renderPermMatrix() {
  const tbody = $('perm-tbody');
  tbody.innerHTML = '';
  let lastGroup = null;
  __permState.perms.forEach((p, i) => {
    const tr = document.createElement('tr');
    const groupCell = (p.group !== lastGroup) ? `<td rowspan="1" style="background:#fef9c3;font-weight:600;vertical-align:top">${p.group}</td>` : `<td></td>`;
    lastGroup = p.group;
    tr.innerHTML = `
      ${groupCell}
      <td>${p.menu}</td>
      <td style="text-align:center"><input type="checkbox" data-i="${i}" data-k="can_view"   ${p.can_view?'checked':''}/></td>
      <td style="text-align:center"><input type="checkbox" data-i="${i}" data-k="can_edit"   ${p.can_edit?'checked':''}/></td>
      <td style="text-align:center"><input type="checkbox" data-i="${i}" data-k="can_review" ${p.can_review?'checked':''}/></td>
      <td style="text-align:center"><input type="checkbox" data-i="${i}" data-k="can_admin"  ${p.can_admin?'checked':''}/></td>`;
    tbody.appendChild(tr);
  });
  // 绑定 checkbox 改动
  tbody.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.onchange = () => {
      const i = +cb.dataset.i, k = cb.dataset.k;
      __permState.perms[i][k] = cb.checked ? 1 : 0;
    };
  });
}

$('pd-close').onclick = closePerms;
$('pd-cancel').onclick = closePerms;
$('perm-overlay').onclick = closePerms;

document.querySelectorAll('[data-toggle-col]').forEach(a => {
  a.onclick = (e) => {
    e.preventDefault();
    const col = a.dataset.toggleCol;
    const key = 'can_' + col;
    // 看当前是否全选 → 切换
    const allOn = __permState.perms.every(p => p[key]);
    __permState.perms.forEach(p => p[key] = allOn ? 0 : 1);
    renderPermMatrix();
  };
});

$('pd-reset-template').onclick = async () => {
  if (!confirm('按当前角色模板重置该用户权限（手动改动会被覆盖）？')) return;
  try {
    await api('/admin/users/' + __permState.userId + '/apply-template', { method: 'POST' });
    const r = await api('/admin/users/' + __permState.userId + '/perms');
    __permState.perms = r.perms;
    renderPermMatrix();
    $('pd-msg').style.color = 'green';
    $('pd-msg').textContent = '✓ 已重置';
    setTimeout(() => { $('pd-msg').textContent = ''; $('pd-msg').style.color = ''; }, 1500);
  } catch (e) { $('pd-msg').style.color = ''; $('pd-msg').textContent = e.message; }
};

$('pd-save').onclick = async () => {
  $('pd-msg').textContent = '';
  try {
    await api('/admin/users/' + __permState.userId + '/perms', {
      method: 'PUT',
      body: JSON.stringify({ perms: __permState.perms }),
    });
    $('pd-msg').style.color = 'green';
    $('pd-msg').textContent = '✓ 已保存';
    setTimeout(closePerms, 800);
  } catch (e) { $('pd-msg').style.color = ''; $('pd-msg').textContent = e.message; }
};

async function resetPwd(id, username) {
  const pwd = prompt(`重置 ${username} 的密码（≥6 位）:`);
  if (!pwd) return;
  if (pwd.length < 6) return alert('密码至少 6 位');
  try {
    await api('/admin/users/' + id + '/reset-password', { method: 'POST', body: JSON.stringify({ password: pwd }) });
    alert('✓ 重置成功');
  } catch (e) { alert(e.message); }
}

async function lockUser(id, username) {
  if (!confirm(`锁定 ${username}？锁定后无法登录。`)) return;
  try { await api('/admin/users/' + id + '/lock', { method: 'POST' }); await loadUsers(); }
  catch (e) { alert(e.message); }
}
async function unlockUser(id) {
  try { await api('/admin/users/' + id + '/unlock', { method: 'POST' }); await loadUsers(); }
  catch (e) { alert(e.message); }
}
async function delUser(id, username) {
  if (!confirm(`删除 ${username}？此操作不可恢复，相关审计日志保留。`)) return;
  try { await api('/admin/users/' + id, { method: 'DELETE' }); await loadUsers(); }
  catch (e) { alert(e.message); }
}

$('btn-new-user').onclick = () => {
  $('new-user-form').classList.remove('hidden');
  $('nu-username').focus();
};
$('btn-cancel-user').onclick = () => $('new-user-form').classList.add('hidden');
$('btn-create-user').onclick = async () => {
  $('nu-msg').textContent = '';
  const body = {
    username: $('nu-username').value.trim(),
    password: $('nu-password').value,
    display_name: $('nu-display').value.trim(),
    dept: $('nu-dept').value,
    role: $('nu-role').value,
  };
  if (!body.username || !body.password || !body.display_name) {
    $('nu-msg').textContent = '用户名/密码/姓名 必填';
    return;
  }
  try {
    await api('/admin/users', { method: 'POST', body: JSON.stringify(body) });
    $('nu-msg').style.color = 'green';
    $('nu-msg').textContent = '✓ 创建成功';
    ['nu-username', 'nu-password', 'nu-display'].forEach(id => $(id).value = '');
    await loadUsers();
    setTimeout(() => { $('new-user-form').classList.add('hidden'); $('nu-msg').style.color = ''; $('nu-msg').textContent = ''; }, 1200);
  } catch (e) { $('nu-msg').style.color = ''; $('nu-msg').textContent = e.message; }
};

$('btn-logout').onclick = async (e) => {
  e.preventDefault();
  await api('/auth/logout', { method: 'POST' });
  location.href = './index.html';
};

// ============== 客户范围抽屉 ==============
let __custState = { userId: null, username: null, all: [], selected: new Set() };

async function openCust(id, username) {
  __custState.userId = +id;
  __custState.username = username;
  $('cd-user').textContent = username;
  $('cd-msg').textContent = '';
  $('cd-new-cust').value = '';
  try {
    const [allRes, myRes] = await Promise.all([
      api('/admin/customers'),
      api('/admin/users/' + id + '/customers'),
    ]);
    const all = allRes.customers || [];
    const mine = new Set(myRes.customers || []);
    // 把已勾选但未在 all 里的（手动加的）也合进列表
    for (const c of mine) if (!all.includes(c)) all.push(c);
    all.sort();
    __custState.all = all;
    __custState.selected = mine;
    renderCustList();
    $('cust-overlay').classList.remove('hidden');
    $('cust-drawer').classList.remove('hidden');
  } catch (e) { alert(e.message); }
}

function closeCust() {
  $('cust-overlay').classList.add('hidden');
  $('cust-drawer').classList.add('hidden');
}

function renderCustList() {
  const list = $('cd-list');
  list.innerHTML = '';
  if (!__custState.all.length) {
    list.innerHTML = '<p class="muted">暂无客户，请下方手动添加</p>';
    return;
  }
  for (const c of __custState.all) {
    const checked = __custState.selected.has(c) ? 'checked' : '';
    const div = document.createElement('div');
    div.innerHTML = `<label><input type="checkbox" data-cust="${esc(c)}" ${checked}/> ${esc(c)}</label>`;
    div.querySelector('input').onchange = (e) => {
      if (e.target.checked) __custState.selected.add(c);
      else __custState.selected.delete(c);
    };
    list.appendChild(div);
  }
}

$('cd-close').onclick = closeCust;
$('cd-cancel').onclick = closeCust;
$('cust-overlay').onclick = closeCust;

$('cd-add').onclick = () => {
  const c = $('cd-new-cust').value.trim();
  if (!c) return;
  if (!__custState.all.includes(c)) __custState.all.push(c);
  __custState.selected.add(c);
  __custState.all.sort();
  $('cd-new-cust').value = '';
  renderCustList();
};

$('cd-save').onclick = async () => {
  $('cd-msg').textContent = '';
  try {
    await api('/admin/users/' + __custState.userId + '/customers', {
      method: 'PUT',
      body: JSON.stringify({ customers: [...__custState.selected] }),
    });
    $('cd-msg').style.color = 'green';
    $('cd-msg').textContent = '✓ 已保存';
    setTimeout(closeCust, 800);
  } catch (e) { $('cd-msg').style.color = ''; $('cd-msg').textContent = e.message; }
};

init();
