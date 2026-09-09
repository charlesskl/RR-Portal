const $ = id => document.getElementById(id);
const state = { rows: [], workshops: [], components: [], canEdit: false };

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function num(value) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
function money(value) { return num(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 4 }); }
function dateOnly(value) {
  if (!value) return '—';
  const date = new Date(String(value).includes('T') ? value : `${String(value).replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? esc(value) : date.toLocaleDateString('zh-CN');
}

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...options });
  if (response.status === 401) { location.href = './index.html'; throw new Error('请先登录'); }
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || response.statusText);
  return response.json();
}

function filteredRows() {
  const customer = $('summary-customer').value;
  const status = $('summary-status').value;
  return state.rows.filter(row => (!customer || row.customer === customer) && (!status || row.confirmation.status === status));
}

function renderStats(rows) {
  const confirmed = rows.filter(row => row.confirmation.status === 'confirmed');
  const customers = new Set(rows.map(row => row.customer).filter(Boolean));
  const pending = rows.length - confirmed.length;
  const confirmationRate = rows.length ? confirmed.length / rows.length * 100 : 0;
  $('summary-stats').innerHTML = `
    <div><span>客户数</span><strong>${customers.size}</strong></div>
    <div><span>报价总数</span><strong>${rows.length} 份</strong></div>
    <div class="stat-confirmed"><span>客户已确认</span><strong>${confirmed.length} 份</strong></div>
    <div class="stat-pending"><span>待确认</span><strong>${pending} 份</strong></div>
    <div class="stat-rate"><span>客户确认率</span><strong>${confirmationRate.toFixed(1)}%</strong><span class="summary-rate-track" role="progressbar" aria-valuenow="${confirmationRate.toFixed(1)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${confirmationRate}%"></i></span></div>`;
}

function totalColumns() { return 8 + state.components.length * 4 + 1 + 3; }

function groupedRows(rows) {
  const groups = new Map();
  [...rows].sort((a, b) => {
    const byCustomer = String(a.customer || '').localeCompare(String(b.customer || ''), 'zh-CN');
    if (byCustomer) return byCustomer;
    return String(b.created_at || '').localeCompare(String(a.created_at || ''));
  }).forEach(row => {
    const customer = row.customer || '未填写';
    if (!groups.has(customer)) groups.set(customer, []);
    groups.get(customer).push(row);
  });
  return [...groups.entries()].map(([customer, customerRows]) => ({ customer, rows: customerRows }));
}

function renderHead() {
  const fixed = ['序号', '客名', '实际生产车间', '货号', '货品名称', '报价日期', '实际接单数量', '货价 (HK$)'];
  const workflow = ['客价确认', '备注', ''];
  const widths = [58, 150, 125, 110, 170, 100, 112, 126];
  state.components.forEach(() => widths.push(92, 92, 96, 78));
  widths.push(96);
  widths.push(110, 135, 60);
  $('summary-cols').innerHTML = widths.map(width => `<col style="width:${width}px">`).join('');
  $('summary-head').closest('table').style.width = `${widths.reduce((sum, width) => sum + width, 0)}px`;
  $('summary-head').innerHTML = `<tr>
    ${fixed.map(label => `<th>${label}</th>`).join('')}
    ${state.components.map((item, index) => `<th class="component-unit group-${index % 2}">${esc(item.name)}</th><th class="component-sub group-${index % 2}">退税后${esc(item.name)}</th><th class="component-sub group-${index % 2}">${esc(item.name)}金额</th><th class="component-sub group-${index % 2}">${esc(item.name)}占比</th>`).join('')}
    <th class="component-sub component-share-total">各金额<br>占比求和</th>
    ${workflow.map(label => `<th class="workflow-head">${label}</th>`).join('')}
  </tr>`;
}

function rowHtml(row, serial) {
  const confirmation = row.confirmation || { status: 'pending', workshops: [] };
  const selectedWorkshop = (confirmation.workshops || [])[0] || '';
  const disabled = state.canEdit ? '' : 'disabled';
  const workshopHtml = `<select class="summary-workshop" ${disabled}>
    <option value="">请选择车间</option>
    ${state.workshops.map(item => `<option value="${esc(item.code)}" ${selectedWorkshop === item.code ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}
  </select>`;
  const price = confirmation.confirmed_price ?? row.quoted_price;
  const qty = confirmation.confirmed_qty ?? row.qty;
  const componentHtml = state.components.map(item => {
    const beforeTax = num(row.components_before_tax?.[item.code]);
    const afterTax = num(row.components?.[item.code]);
    const amount = afterTax * num(qty);
    const share = num(price) ? afterTax / num(price) : 0;
    return `<td class="component-value">${money(beforeTax)}</td><td class="component-value">${money(afterTax)}</td><td class="component-amount">${money(amount)}</td><td class="component-share">${(share * 100).toFixed(2)}%</td>`;
  }).join('');
  const shareTotal = state.components.reduce((sum, item) => (
    sum + (num(price) ? num(row.components?.[item.code]) / num(price) : 0)
  ), 0);
  return `<tr data-id="${row.id}">
    <td class="summary-customer-no">${serial}</td>
    <td><b>${esc(row.customer || '未填写')}</b></td>
    <td>${workshopHtml}</td>
    <td><a href="./quote.html?id=${row.id}"><b>${esc(row.quote_no)}</b></a></td>
    <td><b>${esc(row.product_name)}</b>${row.version ? `<small>${esc(row.version)}</small>` : ''}</td>
    <td>${dateOnly(row.created_at)}</td>
    <td><input class="summary-qty" type="number" min="0" step="1" value="${esc(qty ?? '')}" ${disabled}></td>
    <td><input class="summary-price" type="number" min="0" step="any" value="${esc(price ?? '')}" ${disabled}></td>
    ${componentHtml}
    <td class="component-share component-share-total">${(shareTotal * 100).toFixed(2)}%</td>
    <td><select class="summary-confirm" ${disabled}><option value="pending" ${confirmation.status !== 'confirmed' ? 'selected' : ''}>待确认</option><option value="confirmed" ${confirmation.status === 'confirmed' ? 'selected' : ''}>已确认</option></select></td>
    <td><input class="summary-note" value="${esc(confirmation.note || '')}" placeholder="选填" ${disabled}></td>
    <td>${state.canEdit ? '<button class="save-summary">保存</button>' : ''}</td>
  </tr>`;
}

function subtotalHtml(customer, rows) {
  const qtyTotal = rows.reduce((sum, row) => sum + num(row.confirmation?.confirmed_qty ?? row.qty), 0);
  const priceTotal = rows.reduce((sum, row) => sum + num(row.confirmation?.confirmed_price ?? row.quoted_price), 0);
  const componentHtml = state.components.map(item => {
    const beforeTax = rows.reduce((sum, row) => sum + num(row.components_before_tax?.[item.code]), 0);
    const afterTax = rows.reduce((sum, row) => sum + num(row.components?.[item.code]), 0);
    const amount = rows.reduce((sum, row) => {
      const qty = num(row.confirmation?.confirmed_qty ?? row.qty);
      return sum + num(row.components?.[item.code]) * qty;
    }, 0);
    const share = rows.reduce((sum, row) => {
      const price = num(row.confirmation?.confirmed_price ?? row.quoted_price);
      return sum + (price ? num(row.components?.[item.code]) / price : 0);
    }, 0);
    return `<td class="component-value">${money(beforeTax)}</td><td class="component-value">${money(afterTax)}</td><td class="component-amount">${money(amount)}</td><td class="component-share">${(share * 100).toFixed(2)}%</td>`;
  }).join('');
  const shareTotal = state.components.reduce((sum, item) => {
    const share = rows.reduce((shareSum, row) => {
      const price = num(row.confirmation?.confirmed_price ?? row.quoted_price);
      return shareSum + (price ? num(row.components?.[item.code]) / price : 0);
    }, 0);
    return sum + share;
  }, 0);
  return `<tr class="summary-customer-total">
    <td></td><td>${esc(customer)}</td><td></td><td colspan="2">客户总计</td><td></td>
    <td>${money(qtyTotal)}</td><td>${money(priceTotal)}</td>${componentHtml}<td class="component-share component-share-total">${(shareTotal * 100).toFixed(2)}%</td><td colspan="3"></td>
  </tr>`;
}

function render() {
  const rows = filteredRows();
  renderStats(rows);
  const groups = groupedRows(rows);
  $('summary-body').innerHTML = groups.length
    ? groups.map(group => group.rows.map((row, index) => rowHtml(row, index + 1)).join('') + subtotalHtml(group.customer, group.rows)).join('')
    : `<tr><td colspan="${totalColumns()}" class="summary-empty">暂无匹配报价</td></tr>`;
  document.querySelectorAll('.save-summary').forEach(button => { button.onclick = () => saveRow(button.closest('tr')); });
}

async function saveRow(tr) {
  const button = tr.querySelector('.save-summary');
  button.disabled = true;
  const status = tr.querySelector('.summary-confirm').value;
  const workshop = tr.querySelector('.summary-workshop').value;
  if (status === 'confirmed' && !workshop) {
    alert('客价确认后请选择实际生产车间'); button.disabled = false; return;
  }
  try {
    await api(`/quote-summary/${tr.dataset.id}/confirmation`, {
      method: 'PUT', body: JSON.stringify({
        status, workshop,
        confirmed_price: tr.querySelector('.summary-price').value,
        confirmed_qty: tr.querySelector('.summary-qty').value,
        note: tr.querySelector('.summary-note').value,
      }),
    });
    button.textContent = '已保存';
    setTimeout(() => { button.textContent = '保存'; button.disabled = false; }, 900);
    await load(false);
  } catch (error) { alert(error.message); button.disabled = false; }
}

async function load(showLoading = true) {
  if (showLoading) $('summary-body').innerHTML = `<tr><td colspan="${totalColumns()}" class="summary-empty">正在读取…</td></tr>`;
  const data = await api('/quote-summary');
  state.rows = data.rows || []; state.workshops = data.workshops || []; state.components = data.components || []; state.canEdit = Boolean(data.can_edit);
  renderHead();
  const selected = $('summary-customer').value;
  const customers = [...new Set(state.rows.map(row => row.customer).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  $('summary-customer').innerHTML = '<option value="">全部客户</option>' + customers.map(customer => `<option value="${esc(customer)}">${esc(customer)}</option>`).join('');
  $('summary-customer').value = customers.includes(selected) ? selected : '';
  render();
}

$('summary-customer').onchange = render;
$('summary-status').onchange = render;
$('summary-year').textContent = `${new Date().getFullYear()}年`;
$('summary-export').onclick = () => {
  const params = new URLSearchParams();
  if ($('summary-customer').value) params.set('customer', $('summary-customer').value);
  if ($('summary-status').value) params.set('status', $('summary-status').value);
  const base = location.pathname.replace(/\/[^/]*$/, '');
  location.href = `${base}/api/quote-summary/export/xlsx?${params}`;
};
load().catch(error => { $('summary-body').innerHTML = `<tr><td colspan="${totalColumns()}" class="summary-empty summary-negative">${esc(error.message)}</td></tr>`; });
