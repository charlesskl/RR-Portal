// static/main.js

// ── 文件输入：显示文件名 ──
document.querySelectorAll('.file-input-wrapper').forEach(wrapper => {
  const input = wrapper.querySelector('input[type=file]');
  wrapper.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const span = wrapper.querySelector('span');
    if (input.files.length > 0) {
      span.textContent = Array.from(input.files).map(f => f.name).join(', ');
      wrapper.classList.add('has-file');
    } else {
      span.textContent = wrapper.dataset.placeholder || 'Click to select file';
      wrapper.classList.remove('has-file');
    }
  });
});

// ── 核对表单提交 ──
const form      = document.getElementById('upload-form');
const btnRun    = document.getElementById('btn-run');
const btnDl     = document.getElementById('btn-dl');
const loading   = document.getElementById('loading');
const errorMsg  = document.getElementById('error-msg');
const statsGrid = document.getElementById('stats-grid');
const tabsSect  = document.getElementById('tabs-section');
const searchSect= document.getElementById('search-section');

let globalRecords = [];

form.addEventListener('submit', async e => {
  e.preventDefault();
  errorMsg.style.display = 'none';
  loading.style.display  = 'block';
  btnRun.disabled = true;
  statsGrid.classList.add('hidden');
  tabsSect.classList.add('hidden');
  searchSect.classList.add('hidden');
  btnDl.classList.add('hidden');

  const fd = new FormData(form);
  try {
    const res  = await fetch(window.LIWENJUAN_RUN_URL || '/run', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Server error');

    globalRecords = data.records;
    renderStats(data);
    renderTabs(data.records);
    statsGrid.classList.remove('hidden');
    tabsSect.classList.remove('hidden');
    searchSect.classList.remove('hidden');
    btnDl.classList.remove('hidden');
  } catch (err) {
    errorMsg.textContent = 'Error: ' + err.message;
    errorMsg.style.display = 'block';
  } finally {
    loading.style.display = 'none';
    btnRun.disabled = false;
  }
});

// ── 统计卡片 ──
function renderStats(data) {
  document.getElementById('stat-total').textContent   = data.total;
  document.getElementById('stat-matched').textContent = data.matched_count;
  document.getElementById('stat-anomaly').textContent = data.anomaly_count;
  document.getElementById('badge-matched').textContent  = data.matched_count;
  document.getElementById('badge-unmatched').textContent = data.total - data.matched_count;
  document.getElementById('badge-anomaly').textContent  = data.anomaly_count;
}

// ── Tab 表格渲染 ──
function renderTabs(records) {
  renderTable('table-matched',  records.filter(r => r.has_match));
  renderTable('table-unmatched',records.filter(r => !r.has_match));
  renderTable('table-anomaly',  records.filter(r => r.is_anomaly));
}

function renderTable(tableId, records) {
  const tbody = document.querySelector(`#${tableId} tbody`);
  tbody.innerHTML = '';
  records.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.brand}</td>
      <td>${r.contract}</td>
      <td>${r.hno}</td>
      ${checkCell(r.in_261)}
      ${checkCell(r.in_262ck)}
      ${checkCell(r.in_zu)}
      ${checkCell(r.in_qty)}
      <td class="${r.is_anomaly ? 'cell-anomaly' : ''}">${r.is_anomaly ? 'Anomaly' : ''}</td>
    `;
    tbody.appendChild(tr);
  });
}

function checkCell(found) {
  return `<td class="${found ? 'cell-yes' : 'cell-no'}">${found ? 'Yes' : 'No'}</td>`;
}

// ── Tab 切换 ──
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.target).classList.add('active');
  });
});

// ── Tab 内搜索过滤 ──
document.querySelectorAll('.tab-filter').forEach(input => {
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    const panel = input.closest('.tab-panel');
    panel.querySelectorAll('tbody tr').forEach(tr => {
      const text = tr.textContent.toLowerCase();
      tr.style.display = text.includes(q) ? '' : 'none';
    });
  });
});

// ── 搜索详情 ──
document.getElementById('btn-search').addEventListener('click', doSearch);
document.getElementById('search-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') doSearch();
});

function doSearch() {
  const q = document.getElementById('search-input').value.trim().toLowerCase();
  const container = document.getElementById('detail-results');
  const empty     = document.getElementById('search-empty');
  container.innerHTML = '';
  empty.style.display = 'none';

  if (!q) return;

  const hits = globalRecords.filter(r =>
    r.contract.toLowerCase().includes(q) || r.hno.toLowerCase().includes(q)
  );

  if (hits.length === 0) {
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  hits.forEach((r, idx) => {
    const card = document.createElement('div');
    card.className = 'detail-card';
    card.innerHTML = `
      <div class="detail-header" onclick="toggleDetail(${idx})">
        <span>${r.brand} &nbsp;|&nbsp; ${r.contract} &nbsp;|&nbsp; <b>${r.hno}</b>
          ${r.is_anomaly ? ' &nbsp;<span style="color:#e53935;">Anomaly</span>' : ''}
        </span>
        <span id="arrow-${idx}">Expand</span>
      </div>
      <div class="detail-body" id="detail-body-${idx}">
        <div class="info-grid">
          ${infoItem('Brand/Customer', r.brand)}
          ${infoItem('Contract', r.contract)}
          ${infoItem('Item No.', r.hno)}
          ${infoItem('Customer Name', r.customer || '\u2014')}
          ${infoItem('Contract Qty', r.contract_qty || '\u2014')}
          ${infoItem('Actual Qty', r.actual_qty || '\u2014')}
          ${infoItem('Amount', r.amount || '\u2014')}
          ${infoItem('Ship Date', r.ship_date || '\u2014')}
        </div>
        <div class="check-grid">
          ${checkItem('Inventory (26-1 Finished Goods)', r.in_261)}
          ${checkItem('Shipment (Shipment Detail)',   r.in_262ck)}
          ${checkItem('Shipment (ZU Shipment)',   r.in_zu)}
          ${checkItem('Shipment (Quantity)',        r.in_qty)}
        </div>
      </div>
    `;
    container.appendChild(card);
  });
  // 第一条默认展开
  document.getElementById('detail-body-0').classList.add('open');
  document.getElementById('arrow-0').textContent = 'Collapse';
}

function toggleDetail(idx) {
  const body  = document.getElementById(`detail-body-${idx}`);
  const arrow = document.getElementById(`arrow-${idx}`);
  const open  = body.classList.toggle('open');
  arrow.textContent = open ? 'Collapse' : 'Expand';
}

function infoItem(key, val) {
  return `<div class="info-item"><div class="key">${key}</div><div class="val">${val}</div></div>`;
}
function checkItem(key, found) {
  return `<div class="check-item ${found ? 'yes' : 'no'}">
    <div class="key">${key}</div>
    <div class="val">${found ? 'Yes' : 'No'}</div>
  </div>`;
}
