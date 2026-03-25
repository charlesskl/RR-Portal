/* stats.js — 新产品开发进度表汇总统计页面逻辑 */

// 阶段字段 → 显示名映射
const STAGE_KEYS = ['dev_start', 'fs', 'ep', 'fep', 'pp', 'bom_plastic', 'bom_purchase', 'po1_date'];

// ─── 主入口 ──────────────────────────────────────────────
async function loadStats() {
  const loading = document.getElementById('loadingTip');
  const content = document.getElementById('statsContent');
  const errorTip = document.getElementById('errorTip');

  loading.style.display = '';
  content.style.display = 'none';
  errorTip.classList.add('d-none');

  try {
    const res = await fetch('api/stats');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    renderOverview(data.overview || {});
    renderWorkshop(data.byWorkshop || {});
    renderCustomer(data.byCustomer || {});
    renderSupervisor(data.bySupervisor || {});

    loading.style.display = 'none';
    content.style.display = '';
  } catch (err) {
    loading.style.display = 'none';
    document.getElementById('errorMsg').textContent = '加载失败：' + err.message;
    errorTip.classList.remove('d-none');
  }
}

// ─── 1. 整体看板 ─────────────────────────────────────────
function renderOverview(ov) {
  document.getElementById('ov-total').textContent     = ov.total      ?? 0;
  document.getElementById('ov-completed').textContent = ov.completed  ?? 0;
  document.getElementById('ov-inprogress').textContent= ov.inProgress ?? 0;
  document.getElementById('ov-delayed').textContent   = ov.delayed    ?? 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const sevenDaysLater = new Date(today);
  sevenDaysLater.setDate(today.getDate() + 7);

  const upcoming = Array.isArray(ov.upcoming) ? ov.upcoming : [];

  // 延期项目（date 已过今天）
  const delayed = upcoming.filter(item => {
    if (!item.date) return false;
    return new Date(item.date) < today;
  });

  // 即将到期（date 在今天 ~ 7天内）
  const soonList = upcoming.filter(item => {
    if (!item.date) return false;
    const d = new Date(item.date);
    return d >= today && d <= sevenDaysLater;
  });

  renderUpcomingTable('delayedList', delayed, 'row-delayed', '暂无延期项目');
  renderUpcomingTable('upcomingList', soonList, 'row-upcoming', '暂无即将到期项目');
}

function renderUpcomingTable(tbodyId, list, rowClass, emptyMsg) {
  const tbody = document.getElementById(tbodyId);
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="3" class="text-center text-muted">${emptyMsg}</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(item => `
    <tr class="${rowClass}">
      <td>${escHtml(item.product_name || '—')}</td>
      <td class="text-center">${escHtml(item.stage || '—')}</td>
      <td class="text-center">${escHtml(item.date || '—')}</td>
    </tr>
  `).join('');
}

// ─── 2. 按车间汇总 ───────────────────────────────────────
function renderWorkshop(byWorkshop) {
  const tbody = document.getElementById('workshopList');
  const entries = Object.entries(byWorkshop);

  if (!entries.length) {
    tbody.innerHTML = `<tr><td colspan="10" class="text-center text-muted">暂无数据</td></tr>`;
    return;
  }

  tbody.innerHTML = entries.map(([name, info]) => {
    const stages = info.stages || {};
    const stageCells = STAGE_KEYS.map(key =>
      `<td class="text-center">${stages[key] ?? 0}</td>`
    ).join('');
    return `
      <tr>
        <td>${escHtml(name)}</td>
        <td class="text-center fw-semibold">${info.total ?? 0}</td>
        ${stageCells}
      </tr>
    `;
  }).join('');
}

// ─── 3. 按客户汇总 ───────────────────────────────────────
function renderCustomer(byCustomer) {
  const tbody = document.getElementById('customerList');
  const entries = Object.entries(byCustomer);

  if (!entries.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">暂无数据</td></tr>`;
    return;
  }

  tbody.innerHTML = entries.map(([name, info]) => `
    <tr>
      <td>${escHtml(name)}</td>
      <td class="text-center fw-semibold">${info.total      ?? 0}</td>
      <td class="text-center text-success">${info.completed  ?? 0}</td>
      <td class="text-center text-warning">${info.inProgress ?? 0}</td>
      <td class="text-center text-danger">${info.delayed    ?? 0}</td>
    </tr>
  `).join('');
}

// ─── 4. 按主管汇总 ───────────────────────────────────────
function renderSupervisor(bySupervisor) {
  const tbody = document.getElementById('supervisorList');
  const entries = Object.entries(bySupervisor);

  if (!entries.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">暂无数据</td></tr>`;
    return;
  }

  tbody.innerHTML = entries.map(([name, info]) => {
    const total     = info.total     ?? 0;
    const completed = info.completed ?? 0;
    const rate      = total > 0 ? Math.round(completed / total * 100) : 0;
    const barColor  = rate >= 80 ? 'bg-success' : rate >= 40 ? 'bg-warning' : 'bg-danger';

    return `
      <tr>
        <td>${escHtml(name)}</td>
        <td class="text-center fw-semibold">${total}</td>
        <td class="text-center text-success">${completed}</td>
        <td>
          <div class="d-flex align-items-center gap-2">
            <div class="progress flex-grow-1" style="height:14px;">
              <div class="progress-bar ${barColor}" role="progressbar"
                   style="width:${rate}%"
                   aria-valuenow="${rate}" aria-valuemin="0" aria-valuemax="100">
              </div>
            </div>
            <span class="text-muted" style="font-size:12px;min-width:32px;">${rate}%</span>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// ─── 工具函数 ─────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── 页面加载时自动执行 ───────────────────────────────────
document.addEventListener('DOMContentLoaded', loadStats);
