// 报价单列表 + 登录入口
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

// 权限检查工具
function hasPerm(me, menu, action) {
  if (!me || !me.perms) return false;
  const p = me.perms[menu];
  return !!(p && p['can_' + action]);
}

async function refreshMe() {
  try {
    const me = await api('/auth/me');
    $('login-card').classList.add('hidden');
    $('main-card').classList.remove('hidden');
    $('user-chip').classList.remove('hidden');
    const roleZh = { admin: '管理员', supervisor: '主管', staff: '员工' }[me.role] || me.role;
    $('who-chip').textContent = `${me.dept_name} · ${roleZh} · ${me.display_name || me.username}`;
    // 新建报价：业务 dept 才显示
    if (hasPerm(me, '报价单列表', 'edit') && me.dept === 'sales') $('new-quote-form').classList.remove('hidden');
    else $('new-quote-form').classList.add('hidden');
    // 管理后台入口
    if (hasPerm(me, '账号管理', 'admin')) $('btn-admin').classList.remove('hidden');
    else $('btn-admin').classList.add('hidden');
    window.__me = me;
    await loadQuotes();
  } catch {
    $('login-card').classList.remove('hidden');
    $('main-card').classList.add('hidden');
    $('user-chip').classList.add('hidden');
  }
}

function fmtTime(s) {
  if (!s) return '';
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return s;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

window.__allQuotes = [];
async function loadQuotes() {
  try {
    window.__allQuotes = await api('/quotes');
  } catch (e) {
    window.__allQuotes = [];
    const tbody = $('quotes-table').querySelector('tbody');
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:40px;color:#b91c1c">${e.message}</td></tr>`;
    if ($('search-count')) $('search-count').textContent = '';
    return;
  }
  renderQuotes();
}

function renderQuotes() {
  const tbody = $('quotes-table').querySelector('tbody');
  tbody.innerHTML = '';
  const q = ($('search-input')?.value || '').trim().toLowerCase();
  const rows = q
    ? window.__allQuotes.filter(r =>
        String(r.quote_no || '').toLowerCase().includes(q) ||
        String(r.product_name || '').toLowerCase().includes(q) ||
        String(r.customer || '').toLowerCase().includes(q))
    : window.__allQuotes;
  if ($('search-count')) $('search-count').textContent = q ? `匹配 ${rows.length} / ${window.__allQuotes.length}` : `共 ${window.__allQuotes.length} 条`;
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="ro" style="text-align:center;padding:30px;color:#9ca3af">暂无报价单</td></tr>`;
    return;
  }
  const STATUS_LABEL = { drafting: '草拟中', fully_approved: '全部已审', exported: '已导出' };
  const STATUS_CLS = { drafting: 'b-filled', fully_approved: 'b-approved', exported: 'b-empty' };
  // 同产品(按产品名)版本数：>1 时在版本列加提示徽标
  const prodCount = {};
  for (const r of window.__allQuotes) { const k = String(r.product_name || '').trim(); if (k) prodCount[k] = (prodCount[k] || 0) + 1; }
  for (const q of rows) {
    const tr = document.createElement('tr');
    const total = q.total_depts || 7;
    const pct = Math.round((q.approved_count / total) * 100);
    const nVer = prodCount[String(q.product_name || '').trim()] || 1;
    const verCell = `${q.version ? `<span class="badge b-filled">${q.version}</span>` : '<span class="muted">—</span>'}`
      + (nVer > 1 ? ` <small class="muted" title="该产品共有 ${nVer} 个报价版本">·同产品${nVer}版</small>` : '');
    tr.innerHTML = `
      <td class="ro">${q.id}</td>
      <td><b>${q.quote_no}</b></td>
      <td>${q.product_name}</td>
      <td>${verCell}</td>
      <td>${q.customer || '<span class="muted">—</span>'}</td>
      <td>
        <div class="progress"><div class="progress-bar" style="width:${pct}%"></div></div>
        <small class="muted">${q.approved_count} / ${total}</small>
      </td>
      <td><span class="badge ${STATUS_CLS[q.status] || 'b-empty'}">${STATUS_LABEL[q.status] || q.status}</span></td>
      <td class="ro" style="font-family:ui-monospace,monospace;font-size:12px">${fmtTime(q.created_at)}</td>
      <td style="display:flex;gap:6px">
        <a href="./quote.html?id=${q.id}" class="open-btn">打开 →</a>
        ${window.__me && window.__me.dept === 'sales' ? `<button class="mini btn-clone" data-id="${q.id}" data-no="${q.quote_no}" data-name="${q.product_name}">📋 复制</button>` : ''}
      </td>
    `;
    tbody.appendChild(tr);
  }
  document.querySelectorAll('.btn-clone').forEach(b => b.onclick = () => cloneQuote(b.dataset.id, b.dataset.no, b.dataset.name));
}

async function cloneQuote(srcId, srcNo, srcName) {
  const newNo = prompt(`复制 #${srcNo} (${srcName})\n\n请输入新报价单号：`, srcNo + '-copy');
  if (!newNo) return;
  const ver = prompt(`版本标签（标注这是同一产品的哪个版本，可留空）：`, '');
  try {
    const r = await api('/quotes/' + srcId + '/clone', {
      method: 'POST',
      body: JSON.stringify({ quote_no: newNo.trim(), version: ver != null ? ver.trim() : undefined }),
    });
    if (confirm(`✓ 复制成功，新报价单 #${r.id} 已建好。\n\n是否立即打开？`)) {
      location.href = './quote.html?id=' + r.id;
    } else {
      await loadQuotes();
    }
  } catch (e) { alert(e.message); }
}

$('btn-login').onclick = async () => {
  $('login-msg').textContent = '';
  const username = $('username').value.trim();
  const password = $('password').value;
  if (!username) { $('login-msg').textContent = '请输入用户名'; $('username').focus(); return; }
  if (!password) { $('login-msg').textContent = '请输入密码'; $('password').focus(); return; }
  try {
    await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    $('password').value = '';
    await refreshMe();
  } catch (e) { $('login-msg').textContent = e.message; }
};

['username', 'password'].forEach(id => {
  $(id).onkeydown = (e) => { if (e.key === 'Enter') $('btn-login').click(); };
});

$('btn-logout').onclick = async (e) => {
  e.preventDefault();
  await api('/auth/logout', { method: 'POST' });
  await refreshMe();
};

if ($('btn-create')) $('btn-create').onclick = async () => {
  try {
    await api('/quotes', {
      method: 'POST',
      body: JSON.stringify({
        quote_no: $('q-no').value.trim(),
        product_name: $('q-product').value.trim(),
        version: $('q-version').value.trim() || null,
        customer: $('q-customer').value.trim(),
        qty: Number($('q-qty').value) || null,
      }),
    });
    $('q-no').value = $('q-product').value = $('q-version').value = $('q-customer').value = $('q-qty').value = '';
    await loadQuotes();
  } catch (e) { alert(e.message); }
};

// --- 修改密码 ---
$('btn-change-pwd').onclick = (e) => {
  e.preventDefault();
  $('pwd-msg').textContent = '';
  $('pwd-current').value = $('pwd-new').value = $('pwd-new2').value = '';
  $('pwd-card').classList.remove('hidden');
};
$('btn-pwd-cancel').onclick = () => $('pwd-card').classList.add('hidden');
$('btn-pwd-submit').onclick = async () => {
  const cur = $('pwd-current').value, n1 = $('pwd-new').value, n2 = $('pwd-new2').value;
  if (n1 !== n2) { $('pwd-msg').textContent = '两次输入的新密码不一致'; return; }
  if (n1.length < 6) { $('pwd-msg').textContent = '新密码至少 6 位'; return; }
  try {
    await api('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ current: cur, new: n1 }),
    });
    $('pwd-msg').style.color = 'green';
    $('pwd-msg').textContent = '✓ 修改成功';
    setTimeout(() => { $('pwd-card').classList.add('hidden'); $('pwd-msg').style.color = ''; }, 1200);
  } catch (e) { $('pwd-msg').style.color = ''; $('pwd-msg').textContent = e.message; }
};

if ($('search-input')) $('search-input').oninput = () => renderQuotes();

refreshMe();
