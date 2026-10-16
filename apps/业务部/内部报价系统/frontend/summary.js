const $ = id => document.getElementById(id);
const state = { rows: [], workshops: [], components: [], summaryColumns: [], canEdit: false, drafts: new Map(), saved: new Map(), saving: new Set(), loadSequence: 0, saveEpoch: 0 };

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function num(value) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
function money(value) { return num(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
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

function totalColumns() { return 8 + state.summaryColumns.length + 2; }

function formatted(value, format) {
  if (format === 'percent') return `${(num(value) * 100).toFixed(2)}%`;
  if (format === 'qty') return num(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return money(value);
}

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
  const workflow = ['客价确认', '备注'];
  const widths = [58, 150, 205, 110, 170, 100, 112, 126];
  state.summaryColumns.forEach(item => widths.push(item.format === 'percent' ? 92 : item.format === 'amount' ? 110 : 96));
  widths.push(110, 135);
  $('summary-cols').innerHTML = widths.map(width => `<col style="width:${width}px">`).join('');
  $('summary-head').closest('table').style.width = `${widths.reduce((sum, width) => sum + width, 0)}px`;
  const headerStyle = item => item.header_style || {fill:'FFFFFF',color:'000000',owner:'',owner_fill:'FFFFFF'};
  $('summary-head').innerHTML = `<tr class="summary-owner-row">
    ${fixed.map(() => '<th></th>').join('')}
    ${state.summaryColumns.map(item => `<th style="background:#${headerStyle(item).owner_fill}!important;color:#000">${esc(headerStyle(item).owner)}</th>`).join('')}
    ${workflow.map(() => '<th></th>').join('')}
  </tr><tr>
    ${fixed.map(label => `<th>${label}</th>`).join('')}
    ${state.summaryColumns.map((item, index) => `<th style="background:#${headerStyle(item).fill}!important;color:#${headerStyle(item).color}!important" class="${summaryColorClass(item.code)} ${item.code.endsWith('_share') || item.format === 'percent' ? 'component-sub' : 'component-unit'} group-${Math.floor(index / 4) % 2}">${esc(item.name)}</th>`).join('')}
    ${workflow.map(label => `<th class="workflow-head">${label}</th>`).join('')}
  </tr>`;
}

function rowHtml(row, serial) {
  const confirmation = row.confirmation || { status: 'pending', workshops: [] };
  const draft = state.drafts.get(String(row.id)) || state.saved.get(String(row.id));
  const selectedWorkshop = draft ? draft.workshop : (confirmation.workshops || [])[0] || '';
  const disabled = state.canEdit ? '' : 'disabled';
  const workshopHtml = `<select class="summary-workshop" ${disabled}>
    <option value="">请选择车间</option>
    ${state.workshops.map(item => `<option value="${esc(item.code)}" ${selectedWorkshop === item.code ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}
  </select>`;
  const price = draft ? draft.confirmed_price : confirmation.confirmed_price ?? row.quoted_price;
  const qty = draft ? draft.confirmed_qty : confirmation.confirmed_qty ?? row.qty;
  const componentHtml = state.summaryColumns.map(item => `<td class="${summaryColorClass(item.code)} ${item.format === 'percent' ? 'component-share' : item.format === 'amount' ? 'component-amount' : 'component-value'}">${formatted(row.summary_values?.[item.code], item.format)}</td>`).join('');
  return `<tr data-id="${row.id}">
    <td class="summary-customer-no">${serial}</td>
    <td><b>${esc(row.customer || '未填写')}</b></td>
    <td><div class="summary-workshop-actions">${workshopHtml}${state.canEdit ? `<button type="button" class="save-summary" ${state.saving.has(String(row.id)) ? 'disabled' : ''}>${state.saving.has(String(row.id)) ? '保存中…' : state.drafts.has(String(row.id)) ? '保存*' : '保存'}</button>` : ''}</div></td>
    <td><a href="./quote.html?id=${row.id}"><b>${esc(row.quote_no)}</b></a></td>
    <td><b>${esc(row.product_name)}</b>${row.version ? `<small>${esc(row.version)}</small>` : ''}</td>
    <td>${dateOnly(row.created_at)}</td>
    <td><input class="summary-qty" type="number" min="0" step="1" value="${esc(qty ?? '')}" ${disabled}></td>
    <td><input class="summary-price" type="number" min="0" step="any" value="${esc(price ?? '')}" ${disabled}></td>
    ${componentHtml}
    <td><span class="badge ${confirmation.status === 'confirmed' ? 'b-approved' : 'b-filled'}">${confirmation.status === 'confirmed' ? '已确认' : '待确认'}</span></td>
    <td><input class="summary-note" value="${esc(draft ? draft.note : confirmation.note || '')}" placeholder="选填" ${disabled}></td>
  </tr>`;
}

function summaryColorClass(code) {
  if (['markup_before_tax', 'markup_after_tax'].includes(code)) return 'summary-red-text';
  return ['surtax_04', 'rmb_purchase_cost'].includes(code) ? 'summary-blue-text' : '';
}

function subtotalHtml(customer, rows) {
  const qtyTotal = rows.reduce((sum, row) => sum + num(row.confirmation?.confirmed_qty ?? row.qty), 0);
  const priceTotal = rows.reduce((sum, row) => sum + num(row.confirmation?.confirmed_price ?? row.quoted_price), 0);
  const componentHtml = state.summaryColumns.map(item => {
    let value = rows.reduce((sum, row) => sum + num(row.summary_values?.[item.code]), 0);
    if (item.share_amounts || item.share_unit) {
      const production = item.share_unit ? priceTotal : rows.reduce((s,r)=>s+num(r.summary_values?.production_amount),0);
      const amount = rows.reduce((sum,r) => sum + (item.share_unit
        ? num(r.summary_values?.[item.share_unit])
        : item.share_amounts.reduce((s,key) => s + num(r.summary_values?.[key]),0)),0);
      value = production ? amount / production : 0;
    }
    return `<td class="${summaryColorClass(item.code)} ${item.format === 'percent' ? 'component-share' : item.format === 'amount' ? 'component-amount' : 'component-value'}">${formatted(value, item.format)}</td>`;
  }).join('');
  return `<tr class="summary-customer-total">
    <td></td><td>${esc(customer)}</td><td></td><td colspan="2">客户总计</td><td></td>
    <td>${money(qtyTotal)}</td><td>${money(priceTotal)}</td>${componentHtml}<td colspan="2"></td>
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

function rowInput(tr) {
  return {
    workshop: tr.querySelector('.summary-workshop').value,
    confirmed_price: tr.querySelector('.summary-price').value,
    confirmed_qty: tr.querySelector('.summary-qty').value,
    note: tr.querySelector('.summary-note').value,
  };
}

function trackSummaryDraft(event) {
  const tr = event.target.closest('tr[data-id]');
  if (!tr || !event.target.matches('.summary-workshop,.summary-price,.summary-qty,.summary-note')) return;
  const id = tr.dataset.id;
  state.drafts.set(id, rowInput(tr));
  const button = tr.querySelector('.save-summary');
  if (button && !state.saving.has(id)) button.textContent = '保存*';
}
$('summary-body').addEventListener('input', trackSummaryDraft);
$('summary-body').addEventListener('change', trackSummaryDraft);
window.addEventListener('beforeunload', event => {
  if (!state.drafts.size && !state.saving.size) return;
  event.preventDefault(); event.returnValue = '';
});

async function saveRow(tr) {
  const id = tr.dataset.id;
  if (state.saving.has(id)) return;
  const invalid = tr.querySelector('input:invalid');
  if (invalid) { invalid.reportValidity(); return; }
  const submitted = rowInput(tr);
  state.drafts.set(id, submitted);
  state.saving.add(id);
  const button = tr.querySelector('.save-summary');
  button.disabled = true;
  button.textContent = '保存中…';
  try {
    await api(`/quote-summary/${id}/confirmation`, {
      method: 'PUT', body: JSON.stringify(submitted),
    });
    state.saveEpoch += 1;
    // Keep the acknowledged values visible if refreshing fails or another save supersedes this refresh.
    state.saved.set(id, submitted);
    // Edits made while this request was pending belong to the next save.
    if (JSON.stringify(state.drafts.get(id)) === JSON.stringify(submitted)) state.drafts.delete(id);
    try { await load(false); }
    catch (error) { alert(`本行已保存，汇总刷新失败：${error.message}`); }
  } catch (error) { alert(error.message); }
  finally {
    state.saving.delete(id);
    const currentButton = Array.from($('summary-body').querySelectorAll('tr[data-id]'))
      .find(row => row.dataset.id === id)?.querySelector('.save-summary');
    if (currentButton) {
      currentButton.disabled = false;
      currentButton.textContent = state.drafts.has(id) ? '保存*' : '保存';
    }
  }
}

async function load(showLoading = true) {
  const sequence = ++state.loadSequence;
  const epoch = state.saveEpoch;
  if (showLoading) $('summary-body').innerHTML = `<tr><td colspan="${totalColumns()}" class="summary-empty">正在读取…</td></tr>`;
  let data;
  try { data = await api('/quote-summary'); }
  catch (error) {
    if (sequence !== state.loadSequence || epoch !== state.saveEpoch) return false;
    throw error;
  }
  // A snapshot requested before a newer save must never replace that save's values.
  if (sequence !== state.loadSequence || epoch !== state.saveEpoch) return false;
  state.saved.clear();
  $('completion-open').hidden = !data.can_view_completion;
  if (!data.can_view_completion) { $('completion-panel').hidden = true; $('completion-body').textContent = ''; }
  state.rows = data.rows || []; state.workshops = data.workshops || []; state.components = data.components || []; state.summaryColumns = data.summary_columns || []; state.canEdit = Boolean(data.can_edit);
  $('summary-add-workshop').hidden = !state.canEdit;
  $('summary-edit-workshop').hidden = !state.canEdit;
  renderHead();
  const selected = $('summary-customer').value;
  const customers = [...new Set(state.rows.map(row => row.customer).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  $('summary-customer').innerHTML = '<option value="">全部客户</option>' + customers.map(customer => `<option value="${esc(customer)}">${esc(customer)}</option>`).join('');
  $('summary-customer').value = customers.includes(selected) ? selected : '';
  render();
  return true;
}

$('summary-customer').onchange = render;
$('summary-status').onchange = render;
$('summary-year').textContent = `${new Date().getFullYear()}年`;
$('summary-export').onclick = async () => {
  const button = $('summary-export');
  const params = new URLSearchParams();
  if ($('summary-customer').value) params.set('customer', $('summary-customer').value);
  if ($('summary-status').value) params.set('status', $('summary-status').value);
  const base = location.pathname.replace(/\/[^/]*$/, '');
  button.disabled = true;
  button.textContent = '正在导出…';
  try {
    const response = await fetch(`${base}/api/quote-summary/export/xlsx?${params}`, { credentials: 'include' });
    if (response.status === 401) {
      location.href = './index.html';
      throw new Error('请先登录');
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `导出失败（${response.status}）`);
    }
    const blob = await response.blob();
    const disposition = response.headers.get('Content-Disposition') || '';
    const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/)?.[1];
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = encodedName ? decodeURIComponent(encodedName) : '各客报价汇总.xlsx';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
  } catch (error) {
    alert(error.message || '导出失败，请稍后重试');
  } finally {
    button.disabled = false;
    button.textContent = '⬇️ 导出报价汇总';
  }
};
load().catch(error => { $('summary-body').innerHTML = `<tr><td colspan="${totalColumns()}" class="summary-empty summary-negative">${esc(error.message)}</td></tr>`; });

$('summary-add-workshop').onclick = async () => {
  const name = prompt('输入要添加的车间名称（最多40个字符）');
  if (name == null) return;
  const button = $('summary-add-workshop'); button.disabled = true;
  try {
    const added = await api('/quote-summary/workshops', {method:'POST',body:JSON.stringify({name})});
    if (!state.workshops.some(item => item.code === added.code)) state.workshops.push(added);
    document.querySelectorAll('.summary-workshop').forEach(select => {
      if (![...select.options].some(o => o.value === added.code)) select.add(new Option(added.name, added.code));
    });
  } catch (error) { alert(error.message); }
  finally { button.disabled = false; }
};


$('summary-edit-workshop').onclick = () => {
  const dialog = document.createElement('dialog');
  dialog.innerHTML = '<form><h3>编辑车间</h3><p><label>车间 <select name="code"></select></label></p><p><label>名称 <input name="name" maxlength="40" required></label></p><p data-error role="alert"></p><button type="submit">保存名称</button> <button type="button" data-cancel>取消</button></form>';
  const select = dialog.querySelector('select'), input = dialog.querySelector('input');
  state.workshops.forEach(w => select.add(new Option(w.name, w.code)));
  const selected = () => { input.value = state.workshops.find(w => w.code === select.value)?.name || ''; };
  select.onchange = selected; selected();
  dialog.querySelector('[data-cancel]').onclick = () => dialog.close();
  dialog.onclose = () => dialog.remove();
  dialog.querySelector('form').onsubmit = async event => {
    event.preventDefault();
    const button = dialog.querySelector('[type=submit]'); button.disabled = true;
    try {
      const updated = await api('/quote-summary/workshops', {method:'PUT',body:JSON.stringify({code:select.value,name:input.value})});
      Object.assign(state.workshops.find(w => w.code === updated.code), updated);
      document.querySelectorAll('.summary-workshop option').forEach(option => {
        if (option.value === updated.code) option.textContent = updated.name;
      });
      dialog.close();
    } catch (error) { dialog.querySelector('[data-error]').textContent = error.message; }
    finally { button.disabled = false; }
  };
  document.body.append(dialog); dialog.showModal();
};

$('completion-open').onclick = async () => {
  try {
    const report = await api('/quote-summary/completion');
    $('completion-title').textContent = report.title;
    $('completion-body').innerHTML = [...report.rows,{customer:'共计',...report.totals,note:''}].map(r=>`<tr><td>${esc(r.customer)}</td><td>${r.total}</td><td>${r.incomplete}</td><td>${r.completed}</td><td>${esc(r.note)}</td></tr>`).join('');
    $('completion-panel').hidden = false;
    $('completion-panel').scrollIntoView({behavior:'smooth',block:'start'});
  } catch(e) { $('completion-panel').hidden=true; $('completion-body').textContent=''; alert(e.message); }
};
$('completion-export').onclick = async () => {
  const button=$('completion-export'); button.disabled=true;
  try {
    const response=await fetch('/api/quote-summary/completion/xlsx',{credentials:'include'});
    if(!response.ok) { const error=await response.json(); throw new Error(error.error||'导出失败'); }
    const url=URL.createObjectURL(await response.blob());
    const link=document.createElement('a'); link.href=url; link.download='AI系统内部报价汇总.xlsx'; link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  } catch(e) { alert(e.message); } finally { button.disabled=false; }
};
