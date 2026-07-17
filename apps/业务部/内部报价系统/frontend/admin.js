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
  const factoryChip = $('factory-chip');
  factoryChip.textContent = me.active_factory_name || me.active_factory_code;
  const factorySwitch = $('factory-switch');
  if (me.can_switch_factory) {
    factorySwitch.innerHTML = (me.factories || []).map(f =>
      `<button type="button" class="top-factory-btn ${f.code === me.active_factory_code ? 'active' : ''}" data-code="${esc(f.code)}" aria-pressed="${f.code === me.active_factory_code}"><span class="factory-dot dot-${esc(f.code)}"></span>${esc(f.name_cn)}</button>`
    ).join('');
    factoryChip.classList.add('hidden');
    factorySwitch.classList.remove('hidden');
    factorySwitch.querySelectorAll('.top-factory-btn').forEach(btn => {
      btn.onclick = async () => {
        if (btn.classList.contains('active')) return;
        factorySwitch.querySelectorAll('button').forEach(b => { b.disabled = true; });
        await api('/auth/factory', { method: 'POST', body: JSON.stringify({ factory_code: btn.dataset.code }) });
        location.reload();
      };
    });
  } else {
    factorySwitch.classList.add('hidden');
    factoryChip.classList.remove('hidden');
  }
  window.__me = me;
  await loadUsers();
}

let __allUsers = [];
async function loadUsers() {
  __allUsers = await api('/admin/users');
  const box = $('user-search');
  if (box && !box.__wired) { box.oninput = renderUsers; box.__wired = true; }
  renderUsers();
}

function renderUsers() {
  const q = ($('user-search')?.value || '').trim().toLowerCase();
  const rows = q
    ? __allUsers.filter(u => [u.username, u.display_name, u.dept_name, u.dept, u.factory_name, u.factory_code, u.factory_codes]
        .some(v => String(v || '').toLowerCase().includes(q)))
    : __allUsers;
  const cnt = $('user-count');
  if (cnt) cnt.textContent = q ? `匹配 ${rows.length} / ${__allUsers.length}` : `共 ${__allUsers.length} 个账号`;
  const tbody = $('users-tbody');
  tbody.innerHTML = '';
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="muted" style="text-align:center;padding:18px">无匹配账号</td></tr>`;
    return;
  }
  for (const u of rows) {
    const tr = document.createElement('tr');
    const isLocked = !!u.is_locked;
    const last = u.last_login ? new Date(u.last_login.includes('T') ? u.last_login : u.last_login.replace(' ', 'T') + 'Z').toLocaleString() : '—';
    const factoryCodes = new Set(String(u.factory_codes || u.factory_code || '').split(',').filter(Boolean));
    const factoryScope = factoryCodes.has('qingxi') && factoryCodes.has('heyuan') ? 'all' : (factoryCodes.has('heyuan') ? 'heyuan' : 'qingxi');
    const factoryControl = u.role === 'admin'
      ? `<div class="factory-control" role="group" aria-label="${esc(u.username)} 固定管理两个厂区" title="管理员固定管理两个厂区">
          <button type="button" class="factory-option scope-qingxi" disabled aria-pressed="false">清溪</button>
          <button type="button" class="factory-option scope-heyuan" disabled aria-pressed="false">河源</button>
          <button type="button" class="factory-option scope-all active" disabled aria-pressed="true">双厂区</button>
        </div>`
      : `<div class="factory-control" role="group" aria-label="${esc(u.username)} 的可见厂区">
          <button type="button" class="factory-option scope-qingxi ${factoryScope==='qingxi'?'active':''}" data-id="${u.id}" data-username="${esc(u.username)}" data-scope="qingxi" data-cur="${factoryScope}" aria-pressed="${factoryScope==='qingxi'}">清溪</button>
          <button type="button" class="factory-option scope-heyuan ${factoryScope==='heyuan'?'active':''}" data-id="${u.id}" data-username="${esc(u.username)}" data-scope="heyuan" data-cur="${factoryScope}" aria-pressed="${factoryScope==='heyuan'}">河源</button>
          <button type="button" class="factory-option scope-all ${factoryScope==='all'?'active':''}" data-id="${u.id}" data-username="${esc(u.username)}" data-scope="all" data-cur="${factoryScope}" aria-pressed="${factoryScope==='all'}">双厂区</button>
        </div>`;
    tr.innerHTML = `
      <td>${u.id}</td>
      <td><b>${esc(u.username)}</b></td>
      <td>${esc(u.display_name)}</td>
      <td>${esc(u.dept_name || u.dept)}</td>
      <td>${factoryControl}</td>
      <td><select class="role-sel" data-id="${u.id}" data-username="${esc(u.username)}" data-cur="${u.role}" style="padding:3px 6px">
        <option value="staff" ${u.role==='staff'?'selected':''}>员工</option>
        <option value="supervisor" ${u.role==='supervisor'?'selected':''}>主管</option>
        <option value="admin" ${u.role==='admin'?'selected':''}>管理员</option>
      </select></td>
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
  document.querySelectorAll('.role-sel').forEach(s => s.onchange = () => changeRole(s.dataset.id, s.dataset.username, s.value, s.dataset.cur));
  document.querySelectorAll('.factory-option:not(:disabled)').forEach(b => b.onclick = () => changeFactory(b.dataset.id, b.dataset.username, b.dataset.scope, b.dataset.cur));
}

async function changeFactory(id, username, factoryCode, cur) {
  if (factoryCode === cur) return;
  const name = factoryCode === 'all' ? '清溪 + 河源' : (factoryCode === 'heyuan' ? '河源' : '清溪');
  const hint = factoryCode === 'all' ? '该账号登录后可以切换两个厂区。' : '该账号下次登录后只会进入此厂区。';
  if (!confirm(`把「${username}」的可见厂区改为「${name}」？${hint}`)) {
    loadUsers();
    return;
  }
  try {
    await api('/admin/users/' + id + '/factory', { method: 'PUT', body: JSON.stringify({ factory_code: factoryCode }) });
    await loadUsers();
  } catch (e) { alert(e.message); loadUsers(); }
}

async function changeRole(id, username, role, cur) {
  if (role === cur) return;
  if (!confirm(`把「${username}」的角色改为「${ROLE_ZH[role] || role}」？\n会按新角色模板重置该用户权限（之前手动改的权限会被覆盖）。`)) {
    loadUsers();  // 取消则还原下拉
    return;
  }
  try {
    await api('/admin/users/' + id + '/role', { method: 'PUT', body: JSON.stringify({ role }) });
    await loadUsers();
  } catch (e) { alert(e.message); loadUsers(); }
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
  syncNewUserFactoryScope();
  $('nu-username').focus();
};
$('btn-cancel-user').onclick = () => $('new-user-form').classList.add('hidden');
$('nu-role').onchange = syncNewUserFactoryScope;

function syncNewUserFactoryScope() {
  const isAdmin = $('nu-role').value === 'admin';
  if (isAdmin) $('nu-factory').value = 'all';
  $('nu-factory').disabled = isAdmin;
}

$('btn-create-user').onclick = async () => {
  $('nu-msg').textContent = '';
  const body = {
    username: $('nu-username').value.trim(),
    password: $('nu-password').value,
    display_name: $('nu-display').value.trim(),
    dept: $('nu-dept').value,
    role: $('nu-role').value,
    factory_code: $('nu-factory').value,
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
      api('/admin/customers?user_id=' + id),
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
