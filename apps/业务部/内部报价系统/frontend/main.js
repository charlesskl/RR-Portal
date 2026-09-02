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

// HTML 转义：用户可控字段(货号/产品名/客户/版本)插入 innerHTML 前必须过它，防存储型 XSS
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
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
    const factoryChip = $('factory-chip');
    factoryChip.textContent = me.active_factory_name || me.active_factory_code;
    $('factory-list-name').textContent = me.active_factory_name || me.active_factory_code;
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
          await refreshMe();
        };
      });
    } else {
      factorySwitch.classList.add('hidden');
      factoryChip.classList.remove('hidden');
    }
    // 新建报价：业务 / 工程可建
    if (hasPerm(me, '报价单列表', 'edit') && (me.dept === 'sales' || me.dept === 'engineering')) {
      $('new-quote-form').classList.remove('hidden');
      loadCustomers();
    } else $('new-quote-form').classList.add('hidden');
    // 管理后台入口
    if (hasPerm(me, '账号管理', 'admin')) $('btn-admin').classList.remove('hidden');
    else $('btn-admin').classList.add('hidden');
    window.__me = me;
    await loadQuotes();
  } catch {
    $('login-card').classList.remove('hidden');
    $('main-card').classList.add('hidden');
    $('user-chip').classList.add('hidden');
    if ($('factory-switch')) $('factory-switch').classList.add('hidden');
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
  refreshQuoteFilterOptions();
  renderQuotes();
}

function refreshQuoteFilterOptions() {
  const select = $('filter-customer');
  if (!select) return;
  const selected = select.value;
  const customers = [...new Set(window.__allQuotes
    .map(row => String(row.customer || '').trim())
    .filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  select.innerHTML = '<option value="">全部客户</option>'
    + customers.map(customer => `<option value="${esc(customer)}">${esc(customer)}</option>`).join('');
  select.value = customers.includes(selected) ? selected : '';
}

function renderQuotes() {
  const tbody = $('quotes-table').querySelector('tbody');
  tbody.innerHTML = '';
  const searchText = ($('search-input')?.value || '').trim().toLowerCase();
  const quoteNo = ($('filter-quote-no')?.value || '').trim().toLowerCase();
  const product = ($('filter-product')?.value || '').trim().toLowerCase();
  const version = ($('filter-version')?.value || '').trim().toLowerCase();
  const customer = $('filter-customer')?.value || '';
  const progress = $('filter-progress')?.value || '';
  const status = $('filter-status')?.value || '';
  const hasFilters = !!(searchText || quoteNo || product || version || customer || progress || status);
  const rows = window.__allQuotes.filter(row => {
    const total = row.total_depts || 7;
    const approved = Number(row.approved_count) || 0;
    const progressValue = approved <= 0 ? 'not_started' : (approved >= total ? 'complete' : 'in_progress');
    if (searchText && ![
      row.quote_no, row.product_name, row.customer,
    ].some(value => String(value || '').toLowerCase().includes(searchText))) return false;
    if (quoteNo && !String(row.quote_no || '').toLowerCase().includes(quoteNo)) return false;
    if (product && !String(row.product_name || '').toLowerCase().includes(product)) return false;
    if (version && !String(row.version || '').toLowerCase().includes(version)) return false;
    if (customer && String(row.customer || '') !== customer) return false;
    if (progress && progressValue !== progress) return false;
    if (status && row.status !== status) return false;
    return true;
  });
  if ($('search-count')) $('search-count').textContent = hasFilters
    ? `匹配 ${rows.length} / ${window.__allQuotes.length}`
    : `共 ${window.__allQuotes.length} 条`;
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
    const verCell = `${q.version ? `<span class="badge b-filled">${esc(q.version)}</span>` : '<span class="muted">—</span>'}`
      + (nVer > 1 ? ` <small class="muted" title="该产品共有 ${nVer} 个报价版本">·同产品${nVer}版</small>` : '');
    tr.innerHTML = `
      <td class="ro">${q.id}</td>
      <td><b>${esc(q.quote_no)}</b></td>
      <td>${esc(q.product_name)}</td>
      <td>${verCell}</td>
      <td>${q.customer ? esc(q.customer) : '<span class="muted">—</span>'}</td>
      <td>
        <div class="progress"><div class="progress-bar" style="width:${pct}%"></div></div>
        <small class="muted">${q.approved_count} / ${total}</small>
      </td>
      <td><span class="badge ${STATUS_CLS[q.status] || 'b-empty'}">${STATUS_LABEL[q.status] || q.status}</span></td>
      <td class="ro" style="font-family:ui-monospace,monospace;font-size:12px">${fmtTime(q.created_at)}</td>
      <td style="display:flex;gap:6px">
        <a href="./quote.html?id=${q.id}" class="open-btn">打开 →</a>
        ${window.__me && (window.__me.dept === 'sales' || window.__me.role === 'admin') ? `<button class="mini btn-clone" data-id="${q.id}" data-no="${esc(q.quote_no)}" data-name="${esc(q.product_name)}">📋 复制</button>
        <button class="mini danger btn-del" data-id="${q.id}" data-no="${esc(q.quote_no)}">🗑 删除</button>` : ''}
      </td>
    `;
    tbody.appendChild(tr);
  }
  document.querySelectorAll('.btn-clone').forEach(b => b.onclick = () => cloneQuote(b.dataset.id, b.dataset.no, b.dataset.name));
  document.querySelectorAll('.btn-del').forEach(b => b.onclick = () => deleteQuote(b.dataset.id, b.dataset.no));
}

async function deleteQuote(id, no) {
  if (!confirm(`确认删除报价单 #${id}（货号 ${no || '—'}）？\n\n该操作不可恢复，将连同各部门明细一并删除。`)) return;
  try {
    await api('/quotes/' + id, { method: 'DELETE' });
    await loadQuotes();
  } catch (e) { alert(e.message); }
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
  const quoteNo = $('q-no').value.trim();
  const productName = $('q-product').value.trim();
  const customer = $('q-customer').value.trim();
  if (!quoteNo) { alert('请填写货号'); $('q-no').focus(); return; }
  if (!productName) { alert('请填写产品名称'); $('q-product').focus(); return; }
  if (!customer) { alert('请选择或填写客户'); $('q-customer').focus(); return; }
  try {
    await api('/quotes', {
      method: 'POST',
      body: JSON.stringify({
        quote_no: quoteNo,
        product_name: productName,
        version: $('q-version').value.trim() || null,
        customer,
        qty: Number($('q-qty').value) || null,
      }),
    });
    $('q-no').value = $('q-product').value = $('q-version').value = $('q-customer').value = $('q-qty').value = '';
    $('q-customer-clear')?.classList.add('hidden');
    await loadQuotes();
    loadCustomers();
  } catch (e) { alert(e.message); }
};

// 客户组合框：仅可从当前账号已授权客户中选择。
window.__customers = [];
async function loadCustomers() {
  try {
    const r = await api('/quotes/customers');
    window.__customers = Array.isArray(r.customers) ? r.customers : [];
  } catch {
    window.__customers = [];
  }
}

(function initCustomerCombo() {
  const input = $('q-customer');
  const list = $('q-customer-list');
  const toggle = $('q-customer-toggle');
  const clear = $('q-customer-clear');
  const combo = $('q-customer-combo');
  if (!input || !list || !toggle || !clear || !combo) return;
  let activeIdx = -1;

  const isOpen = () => !list.classList.contains('hidden');
  const items = () => Array.from(list.querySelectorAll('.combo-item'));
  function close() {
    list.classList.add('hidden');
    input.setAttribute('aria-expanded', 'false');
    activeIdx = -1;
  }
  function syncClearButton() {
    clear.classList.toggle('hidden', !input.value.trim());
  }
  function clearSelection() {
    input.value = '';
    syncClearButton();
    input.focus();
    open();
  }
  function render() {
    const query = input.value.trim();
    const lowered = query.toLowerCase();
    const matches = window.__customers.filter(c => c.toLowerCase().includes(lowered));
    let html = '';
    if (matches.length) {
      html += matches.map(c => `<div class="combo-item" data-val="${esc(c)}" role="option">${esc(c)}</div>`).join('');
    } else if (!query) {
      html += '<div class="combo-empty">当前账号暂无授权客户，请联系管理员配置</div>';
    }
    list.innerHTML = html;
    activeIdx = -1;
    items().forEach(el => {
      el.onmousedown = (event) => {
        event.preventDefault();
        input.value = el.dataset.val;
        syncClearButton();
        close();
        input.focus();
      };
    });
  }
  function open() {
    render();
    list.classList.remove('hidden');
    input.setAttribute('aria-expanded', 'true');
  }
  function highlight(index) {
    const choices = items();
    choices.forEach(el => el.classList.remove('active'));
    if (index >= 0 && index < choices.length) {
      choices[index].classList.add('active');
      choices[index].scrollIntoView({ block: 'nearest' });
    }
    activeIdx = index;
  }

  input.addEventListener('focus', open);
  input.addEventListener('input', () => { if (isOpen()) render(); else open(); });
  toggle.addEventListener('mousedown', (event) => {
    event.preventDefault();
    if (isOpen()) close();
    else { input.focus(); open(); }
  });
  clear.addEventListener('mousedown', (event) => {
    event.preventDefault();
    clearSelection();
  });
  input.addEventListener('keydown', (event) => {
    if ((event.key === 'Backspace' || event.key === 'Delete') && input.value) {
      event.preventDefault();
      clearSelection();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!isOpen()) return open();
      highlight(Math.min(activeIdx + 1, items().length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      highlight(Math.max(activeIdx - 1, 0));
    } else if (event.key === 'Enter') {
      const choices = items();
      if (isOpen() && activeIdx >= 0 && choices[activeIdx]) {
        event.preventDefault();
        input.value = choices[activeIdx].dataset.val;
        syncClearButton();
        close();
      }
    } else if (event.key === 'Escape' && isOpen()) {
      event.preventDefault();
      close();
    }
  });
  syncClearButton();
  document.addEventListener('click', event => { if (!combo.contains(event.target)) close(); });
})();

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
['filter-quote-no', 'filter-product', 'filter-version'].forEach(id => {
  if ($(id)) $(id).oninput = () => renderQuotes();
});
['filter-customer', 'filter-progress', 'filter-status'].forEach(id => {
  if ($(id)) $(id).onchange = () => renderQuotes();
});
if ($('btn-clear-filters')) $('btn-clear-filters').onclick = () => {
  ['filter-quote-no', 'filter-product', 'filter-version', 'filter-customer', 'filter-progress', 'filter-status']
    .forEach(id => { if ($(id)) $(id).value = ''; });
  renderQuotes();
};

refreshMe();
