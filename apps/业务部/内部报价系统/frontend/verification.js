const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));
const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const nearZero = value => Math.abs(num(value)) < 0.00001;
const parseJson = (value, fallback = {}) => {
  try { return typeof value === 'string' ? JSON.parse(value) : (value || fallback); } catch { return fallback; }
};
let authRedirectStarted = false;

async function api(path, options = {}) {
  const response = await fetch('/api' + path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (response.status === 401) {
    if (!authRedirectStarted) {
      authRedirectStarted = true;
      window.location.replace('./index.html?next=verification');
    }
    throw new Error('登录状态已失效，正在返回登录页…');
  }
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || response.statusText);
  return response.json();
}

function requestText(title, initialValue = '') {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'verification-dialog-overlay';
    overlay.innerHTML = `<div class="verification-dialog" role="dialog" aria-modal="true">
      <h3>${esc(title)}</h3><textarea></textarea>
      <div><button type="button" data-dialog-cancel class="mini">取消</button><button type="button" data-dialog-ok>确定</button></div>
    </div>`;
    const input = overlay.querySelector('textarea');
    input.value = initialValue;
    const finish = value => { overlay.remove(); resolve(value); };
    overlay.querySelector('[data-dialog-cancel]').onclick = () => finish(null);
    overlay.querySelector('[data-dialog-ok]').onclick = () => finish(input.value);
    overlay.onclick = event => { if (event.target === overlay) finish(null); };
    input.onkeydown = event => { if (event.key === 'Escape') finish(null); };
    document.body.appendChild(overlay);
    input.focus();
  });
}

const SECTION_STATUS = {
  empty: '草稿', filled: '待审核', approved: '已审核', rejected: '已驳回',
};

async function openCreateVerification() {
  const button = $('verification-create');
  button.disabled = true;
  try {
    const {customers} = await api('/quotes/customers');
    const overlay = document.createElement('div');
    overlay.className = 'verification-dialog-overlay';
    overlay.innerHTML = `<form class="verification-dialog verification-create-form" role="dialog" aria-modal="true" aria-labelledby="verification-create-title">
      <h3 id="verification-create-title">新建核价</h3><p>直接进入各部门核价，按当前核价基准初始化。</p>
      <label>货号 <input name="quote_no" required maxlength="200" autocomplete="off"></label>
      <label>产品名称 <input name="product_name" required maxlength="200"></label>
      <label>客户 <select name="customer" required><option value="">请选择授权客户</option>${(customers || []).map(customer=>`<option value="${esc(customer)}">${esc(customer)}</option>`).join('')}</select></label>
      <label>核价数量 <input name="qty" type="number" min="0" max="2147483647" step="1" placeholder="可留空"></label>
      <label>资料版本 <input name="version" maxlength="200" placeholder="V1"></label>
      <label>核价类型 <select name="quote_type"><option value="single">单品核价</option><option value="mixed">混装核价</option></select></label>
      <p data-create-error role="status"></p><div><button type="button" class="mini" data-create-cancel>取消</button><button type="submit">创建并进入核价</button></div>
    </form>`;
    const form = overlay.querySelector('form');
    let pending = false;
    const close = () => { if (!pending) { overlay.remove(); button.focus(); } };
    overlay.querySelector('[data-create-cancel]').onclick = close;
    overlay.onclick = event => { if(event.target===overlay)close(); };
    overlay.onkeydown = event => { if(event.key==='Escape')close(); };
    form.onsubmit = async event => {
      event.preventDefault();
      if(pending || !form.reportValidity())return;
      pending = true;
      const submit = form.querySelector('[type="submit"]'); submit.disabled = true;
      const status = form.querySelector('[data-create-error]');status.textContent='正在创建…';
      let created;
      try {
        created = await api('/verifications',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(form)))});
      } catch(error) {
        status.textContent=error.message;pending=false;submit.disabled=false;return;
      }
      // Creation already committed. Do not offer a second create if refreshing
      // the task list fails afterwards.
      overlay.remove();versionCache.clear();selectedQuoteId=created.id;
      try {
        await loadList({refreshSelection:false});await selectTask(created.id);openDetail('workflow');
      } catch(error) {
        window.location.href=`./verification.html?quote_id=${encodeURIComponent(created.id)}`;
      }
    };
    document.body.appendChild(overlay);form.querySelector('[name="quote_no"]').focus();
  } catch(error) { alert(error.message); }
  finally { button.disabled=false; }
}
const VERSION_STATUS = {
  not_started: '待创建', drafting: '填写中', in_review: '审核中',
  ready: '待锁定', completed: '已完成', cancelled: '已取消',
};
const versionTitle = version => [version?.label, String(version?.category || '').trim()].filter(Boolean).join(' · ');
const currencySymbol = currency => currency === 'USD' ? 'US$' : currency === 'RMB' ? '¥' : currency === 'NUMBER' ? '' : 'HK$';
const amount = (value, currency = 'HKD', decimals = 2) => {
  const symbol = currencySymbol(currency);
  const number = num(value).toLocaleString('zh-CN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return `${symbol}${symbol ? ' ' : ''}${number}`;
};

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(String(value).includes('T') ? value : String(value).replace(' ', 'T') + 'Z');
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  const pad = number => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function pathParts(path) {
  return String(path).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
}

function getPath(source, path) {
  return pathParts(path).reduce((value, key) => value == null ? undefined : value[key], source);
}

function addPrice(rows, path, label, value, currency = 'HKD', quantity = '—') {
  if (value === '' || value == null || !Number.isFinite(Number(value))) return;
  rows.push({ key: path, label, value: Number(value), currency, quantity });
}

function quantityOf(item) {
  const value = item?.qty ?? item?.usage_qty ?? item?.usage ?? item?.sets_per_toy ?? item?.count;
  return value === '' || value == null ? '—' : value;
}

function addItemPrices(rows, items, basePath, fields, nameOf) {
  (items || []).forEach((item, index) => {
    const name = nameOf(item, index);
    fields.forEach(field => {
      if (field.when && !field.when(item)) return;
      addPrice(
        rows,
        `${basePath}[${index}].${field.key}`,
        `${name} · ${field.label}`,
        item[field.key],
        field.currencyOf ? field.currencyOf(item) : field.currency,
        field.quantityOf ? field.quantityOf(item) : quantityOf(item),
      );
    });
  });
}

// 版本对比只读取部门录入的原始成本、单价和作业数量；最终成本由汇总公式统一计算。
function collectCostFields(section) {
  const payload = section.payload || {};
  const rows = [];
  if (section.dept === 'sales') {
    addPrice(rows, 'pricing_summary.surtax', '附加费用', payload.pricing_summary?.surtax);
  } else if (section.dept === 'engineering') {
    addItemPrices(rows, payload.molds, 'molds', [
      { key: 'price_rmb', label: '模具价格', currency: 'RMB', quantityOf: () => 1 },
    ], (item, index) => item.name || item.mold_no || `模具 ${index + 1}`);
    const supplierFields = [
      { key: 'unit_price_rmb', label: '单价', currency: 'RMB', when: item => (item.source_currency || 'RMB') === 'RMB' },
      { key: 'unit_price_usd', label: '单价', currency: 'USD', when: item => item.source_currency === 'USD' },
      { key: 'unit_price', label: '单价', currency: 'HKD', when: item => item.source_currency === 'HKD' },
    ];
    ['hardware', 'aux_materials', 'packaging_materials'].forEach(key => {
      addItemPrices(rows, payload[key], key, supplierFields, (item, index) => item.name || item.category || item.spec || `物料 ${index + 1}`);
    });
    addItemPrices(rows, payload.mold_costs?.items, 'mold_costs.items', [
      { key: 'price_rmb', label: '金额', currency: 'RMB', quantityOf: () => 1 },
    ], (item, index) => item.name || `模具费用 ${index + 1}`);
    addPrice(rows, 'mold_costs.prototype_fee_usd', '手板费', payload.mold_costs?.prototype_fee_usd, 'USD', 1);
    addPrice(rows, 'mold_costs.testing_fee_usd', '测试费', payload.mold_costs?.testing_fee_usd, 'USD', 1);
  } else if (section.dept === 'electronic') {
    addItemPrices(rows, payload.electronics, 'electronics', [
      { key: 'unit_price_rmb', label: '单价', currency: 'RMB' },
    ], (item, index) => item.name || item.spec || `电子件 ${index + 1}`);
    const labels = {
      test_repair: '测试维修费', packing_shipping: '包装运费', bonding_cost: '邦定费',
      smt_cost: '贴片费', labor_cost: '人工费',
    };
    Object.entries(labels).forEach(([key, label]) => {
      addPrice(rows, `electronics_extra.${key}`, label, payload.electronics_extra?.[key], 'HKD', 1);
    });
  } else if (section.dept === 'molding') {
    addItemPrices(rows, payload.injection, 'injection', [
      { key: 'material_unit_price', label: '材料单价', currency: 'HKD' },
      { key: 'shot_price', label: '啤工', currency: 'HKD' },
    ], (item, index) => item.name || item.mold_no || `注塑件 ${index + 1}`);
    addItemPrices(rows, payload.blow_items, 'blow_items', [
      { key: 'material_price_lb', label: '料价', currency: 'HKD' },
      { key: 'blow_labor', label: '吹工', currency: 'HKD' },
      { key: 'flash', label: '披锋', currency: 'HKD' },
    ], (item, index) => item.name || `吹气件 ${index + 1}`);
  } else if (section.dept === 'painting') {
    const processes = {
      clamp: '夹模', pad: '移印', roast: '烤漆', spray: '喷油', edge: '边油',
      color: '调色', dip: '浸油', oil: '油漆', pp_water: 'PP水', uv: 'UV',
    };
    (payload.painting_items || []).forEach((item, index) => {
      Object.entries(processes).forEach(([key, label]) => {
        if (!num(item[`${key}_qty`]) && !num(item[`${key}_unit`])) return;
        addPrice(
          rows,
          `painting_items[${index}].${key}_unit`,
          `${item.name || item.position || `喷油件 ${index + 1}`} · ${label}单价`,
          item[`${key}_unit`],
          'HKD',
          item[`${key}_qty`] ?? '—',
        );
      });
    });
  } else if (section.dept === 'slush') {
    const fields = [
      ['material_price_lb', '材料价'], ['slush_labor_24h', '搪胶人工'], ['batch_labor_12h', '批锋人工'],
      ['diesel_24h', '柴油费'], ['electricity_24h', '电费'], ['pigment_price', '色粉价'],
      ['shipping_bag', '包装袋'], ['mold_fee', '模具费'],
    ];
    addItemPrices(rows, payload.slush_items, 'slush_items', fields.map(([key, label]) => ({
      key,
      label,
      currencyOf: item => key === 'mold_fee' ? (item.mold_fee_currency || 'RMB') : 'HKD',
    })), (item, index) => item.name || `搪胶件 ${index + 1}`);
  } else if (section.dept === 'sewing') {
    (payload.sewing_groups || []).forEach((group, groupIndex) => {
      addPrice(rows, `sewing_groups[${groupIndex}].labor_amount`, `${group.name || `产品 ${groupIndex + 1}`} · 车缝人工`, group.labor_amount, 'HKD', group.product_qty ?? 1);
      addItemPrices(rows, group.items, `sewing_groups[${groupIndex}].items`, [
        { key: 'mat_price', label: '材料单价', currency: 'HKD' },
      ], (item, index) => item.part || item.fabric || `布料 ${index + 1}`);
    });
  } else if (section.dept === 'assembly') {
    addPrice(rows, 'assembly_base_rate', '组装人工基数', payload.assembly_base_rate, 'HKD', 1);
    addPrice(rows, 'assembly_std_time', '标准工时', payload.assembly_std_time, 'NUMBER', 1);
    addItemPrices(rows, payload.assembly_labor, 'assembly_labor', [
      { key: 'unit_price', label: '人工单价', currency: 'HKD' },
    ], (item, index) => item.name || item.product || `组装 ${index + 1}`);
    addItemPrices(rows, payload.packaging_labor, 'packaging_labor', [
      { key: 'unit_price', label: '人工单价', currency: 'HKD' },
    ], (item, index) => item.name || item.product || `包装 ${index + 1}`);
    const addSteps = (groups, basePath, kind) => (groups || []).forEach((group, groupIndex) => {
      (group.steps || []).forEach((step, stepIndex) => addPrice(
        rows,
        `${basePath}[${groupIndex}].steps[${stepIndex}].count`,
        `${group.product || `${kind}产品 ${groupIndex + 1}`} · ${step.name || `工序 ${stepIndex + 1}`}人数`,
        step.count,
        'NUMBER',
        group.qty ?? '—',
      ));
    });
    addSteps(payload.assembly_step_groups, 'assembly_step_groups', '组装');
    addSteps(payload.packaging_step_groups, 'packaging_step_groups', '包装');
  }
  return rows;
}

let me = null;
let listState = [];
let selectedQuoteId = null;
let taskState = null;
let detailMode = 'workflow';
let activeDepartment = null;
let sectionDirty = false;
let sectionSavePending = false;
let versionLoadPending = false;
let taskRequestSequence = 0;
let comparisonState = { quoteId: null, baseline: 'quote', targets: null, dept: 'all', changedOnly: true, query: '' };
let comparisonRefreshToken = 0;
const versionCache = new Map();
let costingBasisState = null;
let costingBasisMeta = {};
let costingBasisExpanded = false;

const COSTING_BASIS_COLUMNS = {
  materials: [['name', '料名'], ['model', '型号'], ['price', 'HK$/Lb', 'number']],
  machines: [['model', '机型'], ['normal', '普通机'], ['price', 'HK$/台班', 'number']],
  cartons: [['label', '纸箱类别'], ['rate', '系数', 'number']],
};

function canManageCostingBasis() {
  return me?.role === 'admin' || Boolean(me?.perms?.['账号管理']?.can_admin);
}

function costingBasisTable(key, editable) {
  const columns = COSTING_BASIS_COLUMNS[key];
  const rows = costingBasisState?.[key] || [];
  return `<div data-basis-table="${key}"><table class="wb-table verification-basis-table"><thead><tr>${columns.map(([, label]) => `<th>${label}</th>`).join('')}${editable ? '<th></th>' : ''}</tr></thead>
    <tbody>${rows.map((row, index) => `<tr data-basis-row="${index}">${columns.map(([field, label, type]) => `<td><input data-basis-field="${field}" aria-label="第 ${index + 1} 行 ${esc(label)}" type="${type || 'text'}" step="any" value="${esc(row[field])}" ${editable ? '' : 'disabled'}></td>`).join('')}${editable ? `<td><button type="button" class="mini danger" data-basis-delete aria-label="删除第 ${index + 1} 行">×</button></td>` : ''}</tr>`).join('')}</tbody></table>
    ${editable ? `<button type="button" class="mini" data-basis-add="${key}">＋ 增加</button>` : ''}</div>`;
}

function basisInput(id, label, value, editable, type = 'number') {
  return `<label>${label}<input id="${id}" type="${type}" step="any" value="${esc(value)}" ${editable ? '' : 'disabled'}></label>`;
}

function renderCostingBasis() {
  const host = $('verification-costing-basis');
  if (!costingBasisState) {
    host.innerHTML = '<section class="card verification-basis-card"><span class="muted">统一核价基准暂时无法读取</span></section>';
    return;
  }
  const editable = canManageCostingBasis();
  const basis = costingBasisState;
  const updated = costingBasisMeta.updated_at ? formatDate(costingBasisMeta.updated_at) : '系统预设';
  host.innerHTML = `<details class="card verification-basis-card" ${costingBasisExpanded ? 'open' : ''}>
    <summary>
      <div><h2>核价基准 · ${esc(basis.version)}</h2>
        <p>${esc(basis.title)} · 更新 ${esc(updated)}</p></div>
      <div class="verification-basis-kpis"><span>RMB→HKD <b>${basis.exchange.rmb_hkd}</b></span><span>HKD→USD <b>${basis.exchange.hkd_usd}</b></span><span>ABS 750SW <b>${basis.materials.find(row => row.model === '750SW')?.price ?? '—'}</b></span></div>
    </summary>
    <div class="verification-basis-body">
      <div class="verification-basis-note">${editable ? '管理员可在此调整；保存后同步未完成核价，已完成历史版本不变。' : '当前为只读；统一核价基准仅管理员可以调整。'}</div>
      <div class="wb-grid2 verification-basis-fields">
        ${basisInput('vb-version', '基准日期', basis.version, editable, 'date')}
        ${basisInput('vb-title', '基准名称', basis.title, editable, 'text')}
        ${basisInput('vb-rmb-hkd', '人民币折港币', basis.exchange.rmb_hkd, editable)}
        ${basisInput('vb-hkd-usd', '美元兑换港币', basis.exchange.hkd_usd, editable)}
        ${basisInput('vb-assembly-base', '装工基数 HKD/人', basis.assembly.base_rate_hkd, editable)}
        ${basisInput('vb-hunan-freight', '湖南产品运费 %（参考）', basis.assembly.hunan_freight_pct, false)}
        ${basisInput('vb-wage-factor', '装工系数 1（参考）', basis.assembly.wage_factor, false)}
        ${basisInput('vb-social-factor', '装工系数 2（参考）', basis.assembly.social_factor, false)}
        ${basisInput('vb-overhead-factor', '装工系数 3（参考）', basis.assembly.overhead_factor, false)}
        ${basisInput('vb-sewing-tax', '车缝不含税起点 %（参考）', basis.tax.sewing_exclusion_pct, false)}
        ${basisInput('vb-electronic-tax', '电子不含税起点 %（参考）', basis.tax.electronic_exclusion_pct, false)}
        <label>默认纸箱类别<select id="vb-default-carton" ${editable ? '' : 'disabled'}>${basis.cartons.map(row => `<option value="${esc(row.label)}" ${row.label === basis.default_carton_label ? 'selected' : ''}>${esc(row.label)}</option>`).join('')}</select></label>
      </div>
      <p class="muted">标注“参考”的参数仅供查阅，不参与本次基准同步；工价按装工基数计算，减税按现有分类规则计算。</p>
      <h3>喷油标准（HK$/次）</h3>
      <div class="wb-grid2 verification-basis-fields">
        ${basisInput('vb-paint-pad', '移印', basis.painting.pad, editable)}
        ${basisInput('vb-paint-edge', '边模', basis.painting.edge, editable)}
        ${basisInput('vb-paint-clamp', '夹模', basis.painting.clamp, editable)}
      </div>
      <div class="verification-basis-tables">
        <div><h3>原料价</h3>${costingBasisTable('materials', editable)}</div>
        <div><h3>机型价</h3>${costingBasisTable('machines', editable)}</div>
        <div><h3>纸箱报价</h3>${costingBasisTable('cartons', editable)}</div>
      </div>
      ${editable ? '<div class="verification-basis-actions"><button id="verification-basis-save" type="button">保存并同步</button><span id="verification-basis-msg" class="msg"></span></div>' : ''}
    </div>
  </details>`;
  const details = host.querySelector('details');
  details.ontoggle = () => { costingBasisExpanded = details.open; };
  if (!editable) return;
  host.querySelectorAll('[data-basis-delete]').forEach(button => button.onclick = () => {
    collectCostingBasis();
    const tableHost = button.closest('[data-basis-table]');
    const key = tableHost?.dataset.basisTable;
    if (!key) return;
    costingBasisState[key].splice(Number(button.closest('tr').dataset.basisRow), 1);
    costingBasisExpanded = true;
    renderCostingBasis();
  });
  host.querySelectorAll('[data-basis-add]').forEach(button => button.onclick = () => {
    collectCostingBasis();
    const key = button.dataset.basisAdd;
    const columns = COSTING_BASIS_COLUMNS[key];
    costingBasisState[key].push(Object.fromEntries(columns.map(([field,, type]) => [field, type === 'number' ? 0 : ''])));
    costingBasisExpanded = true;
    renderCostingBasis();
  });
  $('verification-basis-save').onclick = saveCostingBasis;
}

function collectBasisRows(key) {
  const table = document.querySelector(`[data-basis-table="${key}"]`);
  return [...(table?.querySelectorAll('tbody tr') || [])].map(row => {
    const value = {};
    row.querySelectorAll('[data-basis-field]').forEach(input => {
      value[input.dataset.basisField] = input.type === 'number' ? Number(input.value) : input.value.trim();
    });
    return value;
  });
}

function collectCostingBasis() {
  if (!costingBasisState || !canManageCostingBasis()) return costingBasisState;
  const n = id => num($(id)?.value);
  costingBasisState = {
    version: $('vb-version').value,
    title: $('vb-title').value.trim(),
    materials: collectBasisRows('materials'),
    machines: collectBasisRows('machines'),
    cartons: collectBasisRows('cartons'),
    default_carton_label: $('vb-default-carton').value,
    exchange: { rmb_hkd: n('vb-rmb-hkd'), hkd_usd: n('vb-hkd-usd') },
    assembly: { ...costingBasisState.assembly, base_rate_hkd: n('vb-assembly-base') },
    painting: { pad: n('vb-paint-pad'), edge: n('vb-paint-edge'), clamp: n('vb-paint-clamp') },
    tax: { ...costingBasisState.tax },
  };
  return costingBasisState;
}

async function saveCostingBasis() {
  if (!confirm('确认保存统一核价基准？未冻结报价和未完成核价会同步更新并退回重审，已冻结报价、已完成版本和原表公式版本保持不变。')) return;
  const button = $('verification-basis-save');
  const message = $('verification-basis-msg');
  button.disabled = true;
  try {
    const result = await api('/admin/costing-basis', { method: 'PUT', body: JSON.stringify({ data: collectCostingBasis() }) });
    versionCache.clear();
    await loadList();
    costingBasisExpanded = true;
    renderCostingBasis();
    $('verification-basis-msg').style.color = 'green';
    $('verification-basis-msg').textContent = `✓ 已保存；报价同步 ${result.synced} 个部门，核价同步 ${result.verification_synced || 0} 个部门，退回重审 ${(result.reopened || 0) + (result.verification_reopened || 0)} 个`;
  } catch (error) {
    message.textContent = error.message;
    button.disabled = false;
  }
}

let canAssignWorkshop = false;
let workshopSavePending = false;
let listRequestSequence = 0;
const workshopSelected = new Set();
const workshopRevisions = new Map();
function updateWorkshopSelection() {
  const selectable=filteredList().filter(row=>row.current_version_id&&row.workshop_revision);
  const all=$('workshop-select-visible');
  all.checked=selectable.length>0&&selectable.every(row=>workshopSelected.has(row.current_version_id));
  all.indeterminate=!all.checked&&selectable.some(row=>workshopSelected.has(row.current_version_id));
  all.disabled=workshopSavePending||!selectable.length;
  $('workshop-target').disabled=workshopSavePending;
  $('workshop-apply').disabled=workshopSavePending||!workshopSelected.size;
}
function applyListFilter() {
  workshopSelected.clear();workshopRevisions.clear();renderList();
  $('workshop-message').textContent='仅调整车间，不改变核价和完成状态';
}
$('workshop-filter').onchange = applyListFilter;
$('workshop-select-visible').onchange = event => {
  if(workshopSavePending)return;
  for(const row of filteredList())if(row.current_version_id&&row.workshop_revision){if(event.target.checked){workshopSelected.add(row.current_version_id);workshopRevisions.set(row.current_version_id,row.workshop_revision);}else {workshopSelected.delete(row.current_version_id);workshopRevisions.delete(row.current_version_id);}}
  renderList();$('workshop-message').textContent=`已选 ${workshopSelected.size} 款`;
};
$('workshop-apply').onclick = async () => {
  if(workshopSavePending)return;
  const workshop=$('workshop-target').value;
  const selected=filteredList().filter(row=>workshopSelected.has(row.current_version_id)&&row.workshop_revision);
  if(!workshop || !selected.length){$('workshop-message').textContent='请勾选任务并选择车间';return;}
  if(!confirm(`将选中的 ${selected.length} 款核价分配至「${workshop}」？核价和完成状态不变。`))return;
  const ids=selected.map(row=>row.current_version_id);
  const expected_revisions=Object.fromEntries(selected.map(row=>[row.current_version_id,workshopRevisions.get(row.current_version_id)]));
  workshopSavePending=true;renderList();$('workshop-message').textContent='正在保存车间分配…';
  try {
    const result=await api('/verifications/workshops',{method:'PUT',body:JSON.stringify({version_ids:ids,workshop,expected_revisions})});
    for(const row of selected){row.workshop=workshop;row.workshop_revision=result.revisions?.[row.current_version_id]||null;workshopSelected.delete(row.current_version_id);workshopRevisions.delete(row.current_version_id);}
    // Refresh the list without selecting a task: an in-flight assignment must
    // never replace the department form the user has opened or edited meanwhile.
    try{await loadList({refreshSelection:false});}
    catch{renderList();$('workshop-message').textContent=`车间已保存；任务清单刷新失败，请刷新页面后核对`;return;}
    $('workshop-message').textContent=`已将 ${result.count} 款分配至 ${result.workshop}，刷新汇总页即可查看`;
  }catch(error){$('workshop-message').textContent=`${error.message}；已保留选择，请刷新核对后重试`;}
  finally{workshopSavePending=false;renderList();}
};
function filteredList() {
  const query = ($('verification-search').value || '').trim().toLowerCase();
  const status = $('verification-status-filter').value;
  const customer = $('verification-customer-filter').value;
  return listState.filter(row => (!status || row.verification_status === status)
    && (!customer || window.VerificationCustomers.display(row.customer) === customer)
    && (!$('workshop-filter').value || row.workshop === $('workshop-filter').value)
    && [row.quote_no, row.product_name, row.customer, row.version, row.current_version_label, row.current_version_category].join(' ').toLowerCase().includes(query));
}

function renderList() {
  const rows = filteredList();
  const visible=new Set(rows.map(row=>row.current_version_id));
  for(const id of workshopSelected)if(!visible.has(id)){workshopSelected.delete(id);workshopRevisions.delete(id);}
  $('verification-list-body').innerHTML = rows.length ? rows.map(row => `<tr class="verification-list-row ${Number(selectedQuoteId) === Number(row.id) ? 'selected' : ''}" data-id="${row.id}">
    <td>${canAssignWorkshop && row.current_version_id && row.workshop_revision ? `<input type="checkbox" data-workshop-select="${row.current_version_id}" aria-label="选择 ${esc(row.quote_no)}" ${workshopSelected.has(row.current_version_id)?'checked':''} ${workshopSavePending?'disabled':''}> ` : ''}<strong>${esc(row.quote_no)}</strong><small>${esc(row.version || 'V1')}</small></td>
    <td>${esc(row.product_name)}</td><td>${esc(row.customer || '—')}</td>
    <td><strong>${esc(versionTitle({ label: row.current_version_label || '待创建', category: row.current_version_category }))}</strong><small>共 ${num(row.version_count)} 个版本</small></td>
    <td>${num(row.approved_count)} / ${num(row.total_depts)}</td>
    <td><span class="verification-status status-${esc(row.verification_status || 'not_started')}">${VERSION_STATUS[row.verification_status] || '待创建'}</span></td>
    <td title="${esc(row.workshop_source)}">${esc(row.workshop || '待分配车间')}</td>
  </tr>`).join('') : '<tr><td colspan="7" class="summary-empty">暂无符合条件的核价任务</td></tr>';
  document.querySelectorAll('[data-workshop-select]').forEach(input => {
    input.onclick = event => event.stopPropagation();
    input.onchange = () => {if(workshopSavePending)return;const id=Number(input.dataset.workshopSelect);if(input.checked){workshopSelected.add(id);workshopRevisions.set(id,listState.find(row=>row.current_version_id===id)?.workshop_revision);}else{workshopSelected.delete(id);workshopRevisions.delete(id);}updateWorkshopSelection();$('workshop-message').textContent=`已选 ${workshopSelected.size} 款`};
  });
  updateWorkshopSelection();
  document.querySelectorAll('.verification-list-row').forEach(row => {
    row.onclick = () => selectTask(row.dataset.id);
  });
}

async function loadList({refreshSelection=true}={}) {
  const sequence=++listRequestSequence;
  const [user, result, basis] = await Promise.all([api('/auth/me'), api('/verifications'), api('/refs/costing_basis').catch(() => null)]);
  if(sequence!==listRequestSequence)return;
  me = user; listState = result.rows;
  if ($('verification-create')) $('verification-create').hidden = !result.can_create;
  costingBasisState = basis?.data || null;
  costingBasisMeta = basis || {};
  window.__costingBasis = costingBasisState;
  renderCostingBasis();
  canAssignWorkshop = Boolean(result.can_assign_workshop);
  $('workshop-assignment').hidden = !canAssignWorkshop;
  $('who-chip').textContent = `${me.dept_name} · ${me.display_name || me.username}`;
  const names = listState.map(row => window.VerificationCustomers.display(row.customer));
  const customers = me.role === 'admin' || me.perms?.['账号管理']?.can_admin ? window.VerificationCustomers.options(names) : [...new Set(names)].sort();
  const selectedCustomer=$('verification-customer-filter').value;
  $('verification-customer-filter').innerHTML = '<option value="">全部客户</option>'
    + customers.map(customer => `<option value="${esc(customer)}">${esc(customer)}</option>`).join('');
  $('verification-customer-filter').value=customers.includes(selectedCustomer)?selectedCustomer:'';
  if(!canAssignWorkshop){workshopSelected.clear();workshopRevisions.clear();}
  renderList();
  if (refreshSelection&&listState.length) {
    const target=listState.find(row=>Number(row.id)===Number(selectedQuoteId))||listState[0];
    await selectTask(target.id);
  }
}

function cacheVersion(data) {
  if (!data || typeof data !== 'object' || !data.selected_version
    || !Array.isArray(data.versions) || !Array.isArray(data.sections)) {
    throw new Error('核价服务版本未同步，请刷新页面；如仍出现此提示，请重启内部报价服务');
  }
  versionCache.set(String(data.selected_version.id), data);
  return data;
}

async function fetchTask(quoteId, versionId) {
  const suffix = versionId ? `?version_id=${encodeURIComponent(versionId)}` : '';
  const data = await api(`/verifications/${quoteId}${suffix}`);
  if (Number(data?.quote?.id) !== Number(quoteId)
    || (versionId && Number(data?.selected_version?.id) !== Number(versionId))) {
    throw new Error('核价任务或版本不匹配，请重新打开任务');
  }
  return cacheVersion(data);
}

async function selectTask(quoteId) {
  if (sectionSavePending || versionLoadPending) return;
  const requestSequence = ++taskRequestSequence;
  selectedQuoteId = Number(quoteId);
  renderList();
  $('verification-preview').innerHTML = '<div class="verification-preview-empty">正在读取核价任务…</div>';
  try {
    const data = await fetchTask(quoteId);
    if (requestSequence !== taskRequestSequence) return;
    taskState = data;
  } catch (error) {
    if (requestSequence !== taskRequestSequence) return;
    taskState = null;
    $('verification-preview').innerHTML = `<div class="verification-preview-empty"><strong>核价任务暂时无法打开</strong><br>${esc(error.message)}</div>`;
    return;
  }
  const latest = taskState.versions.filter(version=>version.status!=='cancelled').at(-1);
  const row = listState.find(item => Number(item.id) === selectedQuoteId);
  if (row && latest) {
    Object.assign(row, {
      current_version_id: latest.id,
      current_version_label: latest.label,
      current_version_category: latest.category,
      version_count: taskState.versions.length,
      verification_status: latest.status,
      approved_count: latest.approved_count,
      total_depts: latest.total_count,
    });
    renderList();
  }
  renderPreview();
}

function baselineTitle(data = taskState) { return data.quote.verification_origin === 'direct' ? '新建核价资料' : '原报价'; }

function createVersionSelector(data, idPrefix) {
  if (!data.can_create_version) return '';
  const completed = data.versions.filter(version => version.status === 'completed');
  const latestCompleted = completed[completed.length - 1];
  return `<div class="verification-create-version">
    <label>新版本复制来源
      <select id="${idPrefix}-source">
        <option value="quote">${baselineTitle(data)}</option>
        ${completed.map(version => `<option value="${version.id}" ${version.id === latestCompleted?.id ? 'selected' : ''}>${esc(versionTitle(version))}（已完成）</option>`).join('')}
      </select>
    </label>
    <button id="${idPrefix}-create">＋ 创建下一核价版本</button>
  </div>`;
}

function versionCategoryEditor(data, idPrefix) {
  const version = data.selected_version;
  if (!data.can_manage_versions) return version.category
    ? `<div class="verification-version-category-readonly"><span>版本类别</span><strong>${esc(version.category)}</strong></div>`
    : '';
  return `<div class="verification-version-category-editor">
    <label>版本类别
      <input id="${idPrefix}-category" maxlength="40" placeholder="例如：首次核价、试产复核" value="${esc(version.category || '')}">
    </label>
    <button id="${idPrefix}-category-save" class="mini">保存类别</button>
  </div>`;
}

function bindVersionCategory(data, idPrefix) {
  const button = $(`${idPrefix}-category-save`);
  if (!button) return;
  button.onclick = async () => {
    if (sectionSavePending || versionLoadPending) return;
    const category = $(`${idPrefix}-category`).value.trim();
    try {
      button.disabled = true;
      const result = await api(`/verifications/versions/${data.selected_version.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ category }),
      });
      const saved = result.category || null;
      data.selected_version.category = saved;
      const version = data.versions.find(item => Number(item.id) === Number(data.selected_version.id));
      if (version) version.category = saved;
      const row = listState.find(item => Number(item.id) === Number(data.quote.id));
      if (row && Number(row.current_version_id) === Number(data.selected_version.id)) row.current_version_category = saved;
      versionCache.set(String(data.selected_version.id), data);
      if (data !== taskState || sectionSavePending || versionLoadPending) return;
      if ($('verification-list').classList.contains('hidden')) renderDetail();
      else { renderList(); renderPreview(); }
    } catch (error) {
      alert(error.message);
      button.disabled = false;
    }
  };
}

function bindCreateVersion(data, idPrefix) {
  const button = $(`${idPrefix}-create`);
  if (!button) return;
  button.onclick = async () => {
    if (sectionSavePending || versionLoadPending) return;
    const source = $(`${idPrefix}-source`).value;
    if (!confirm('新版本会复制所选来源的部门明细，并重新进入填写和审核流程。确认创建？')) return;
    try {
      const body = source === 'quote'
        ? { source_type: 'quote' }
        : { source_type: 'version', source_version_id: Number(source) };
      const created = await api(`/verifications/${data.quote.id}/versions`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      versionCache.clear();
      taskState = await fetchTask(data.quote.id, created.id);
      detailMode = 'workflow';
      if ($('verification-list').classList.contains('hidden')) renderDetail();
      else openDetail('workflow');
    } catch (error) {
      alert(error.message);
    }
  };
}

function calculateFinancial(source) {
  const workbench = window.VerificationWorkbench;
  if (!workbench?.renderSummaryPane) return null;
  const host = document.createElement('div');
  host.className = 'verification-calc-host';
  document.body.appendChild(host);
  try {
    window.__data = { quote: taskState.quote, sections: source.sections, me: me || {} };
    const result = workbench.renderSummaryPane(host, source.sections, taskState.quote, { dept: 'verification_readonly', role: 'staff' }) || {};
    if (result?.financial) return result.financial;
    const readNumber = selector => {
      const element = host.querySelector(selector);
      const text = element && 'value' in element ? element.value : element?.textContent || '';
      const value = Number(text.replace(/[^0-9.-]/g, ''));
      return Number.isFinite(value) ? value : 0;
    };
    const readout = (table, key) => readNumber(`[data-tbl="${table}"][data-key="${key}"]`);
    const fields = {
      base_price: readout('t1', 'base_price'),
      imp_mat: readout('t1', 'imp_mat'), dom_mat: readout('t1', 'dom_mat'),
      blow: readout('t1', 'blow'), slush: readout('t1', 'slush'),
      sewing_hair: readout('t1', 'sewing_hair'), sewing_cloth: readout('t1', 'sewing_cloth'),
      hardware: readout('t1', 'hardware'), electronic: readout('t1', 'electronic'),
      color_box: readout('t2', 'color_box'), libao: readout('t2', 'libao'),
      other_buy: readout('t2', 'other_buy'), carton: readout('t2', 'carton'),
      freight: readout('t2', 'freight'), cabinet: readout('t2', 'cabinet'), misc: readout('t2', 'misc'),
      injection_labor: readout('t3', 'injection_labor'),
      painting_labor: readout('t3', 'painting_labor'),
      paint_material: readout('t3', 'paint_material'),
      assembly_labor: readout('t3', 'assembly_labor'),
    };
    const taxLabels = {
      tax13: '含税13%类成本', carton: '纸箱类', tax1: '含税1%', slush3: '搪胶类3%',
      sewhair13: '车发类13%', sewcloth13: '车衣类13%', suction6: '吸塑类6%',
      freight9: '运费类9%', tax13b: '含税13%类',
    };
    const taxRows = Object.entries(taxLabels).map(([key, label]) => ({
      key,
      label,
      base: readout('t4a', key),
      rate: readout('t4r', key),
      deduction: readNumber(`#tk-ded-${key}`),
    }));
    return {
      fields,
      totalCost: num(result.totalCost ?? result.total ?? readNumber('#tk-total-cost')),
      totalDeduction: num(result.totalDeduction ?? readNumber('#tk-total-ded')),
      afterDeduction: num(result.afterDeduction ?? readNumber('#tk-after-ded')),
      noLabor: num(result.noLabor ?? readNumber('#tk-no-labor')),
      taxRows,
    };
  } finally {
    host.remove();
  }
}

function normalizedBaseline() {
  return {
    key: 'quote',
    type: 'quote',
    label: `${baselineTitle()} ${taskState.quote.version || ''}`.trim(),
    status: 'frozen',
    sections: (taskState.baseline.sections || []).map(section => ({
      dept: section.dept,
      dept_name: section.dept_name,
      status: section.status,
      payload_json: JSON.stringify(section.payload || {}),
    })),
  };
}

function normalizedVersion(data) {
  return {
    key: String(data.selected_version.id),
    type: 'version',
    label: versionTitle(data.selected_version),
    status: data.selected_version.status,
    sections: data.sections.map(section => ({ ...section, payload_json: section.payload_json || '{}' })),
  };
}

async function loadComparisonSource(key) {
  if (key === 'quote') return normalizedBaseline();
  const cached = versionCache.get(String(key));
  const data = cached || await fetchTask(taskState.quote.id, key);
  return normalizedVersion(data);
}

function renderPreview() {
  const quote = taskState.quote;
  const version = taskState.selected_version;
  const current = normalizedVersion(taskState);
  const financial = calculateFinancial(current);
  $('verification-preview').innerHTML = `<div class="verification-preview-title">
      <div><span class="eyebrow">核价任务</span><h2>${esc(quote.quote_no)}</h2></div>
      <span class="verification-status status-${esc(version.status)}">${VERSION_STATUS[version.status]}</span>
    </div>
    <dl class="verification-preview-meta">
      <div><dt>产品</dt><dd>${esc(quote.product_name)}</dd></div>
      <div><dt>客户 / 报价版本</dt><dd>${esc(quote.customer || '—')} · ${esc(quote.version || 'V1')}</dd></div>
      ${quote.verification_origin==='direct'?'<div><dt>核价来源</dt><dd>直接新建</dd></div>':`<div><dt>客户确认价</dt><dd>US$ ${num(quote.confirmed_price).toFixed(2)}</dd></div>`}
    </dl>
    <div class="verification-version-strip">
      ${taskState.versions.map(item => `<span class="${item.id === version.id ? 'active' : ''}">${esc(versionTitle(item))} · ${VERSION_STATUS[item.status]}</span>`).join('')}
    </div>
    ${versionCategoryEditor(taskState, 'preview-version')}
    <div class="verification-baseline-note"><strong>${quote.verification_origin==='direct'?'直接核价 · 当前基准初始化':'报价基准已冻结'}</strong><span>核价版本按部门填写和审核，不允许直接填写最终价格</span></div>
    <div class="verification-preview-kpis">
      <div><span>当前版本</span><strong>${esc(versionTitle(version))}</strong></div>
      <div><span>部门进度</span><strong>${num(version.approved_count)} / ${num(version.total_count)}</strong></div>
      <div><span>核价总成本</span><strong>${amount(financial?.totalCost)}</strong></div>
    </div>
    <div class="verification-preview-actions">
      <button id="verification-open-detail" class="verification-primary-action">进入部门核价</button>
      <button id="verification-open-compare" class="mini">选择版本对比</button>
    </div>
    ${createVersionSelector(taskState, 'preview-version')}`;
  $('verification-open-detail').onclick = () => openDetail('workflow');
  $('verification-open-compare').onclick = () => openDetail('compare');
  bindCreateVersion(taskState, 'preview-version');
  bindVersionCategory(taskState, 'preview-version');
}

function openDetail(mode) {
  detailMode = mode;
  activeDepartment = activeDepartment || me.dept;
  sectionDirty = false;
  $('verification-list').classList.add('hidden');
  $('verification-detail').classList.remove('hidden');
  renderDetail();
}

async function switchVersion(versionId) {
  if (sectionSavePending || versionLoadPending) return;
  if (sectionDirty && !confirm('当前部门有未保存修改，切换版本会放弃这些修改。确认继续？')) return;
  const quoteId = taskState.quote.id;
  const requestSequence = ++taskRequestSequence;
  versionLoadPending = true;
  const detail = $('verification-detail');
  const wasInert = detail.inert;
  detail.inert = true;
  try {
    const data = await fetchTask(quoteId, versionId);
    if (requestSequence !== taskRequestSequence || Number(taskState.quote.id) !== Number(quoteId) || sectionSavePending) return;
    taskState = data;
    sectionDirty = false;
    renderDetail();
  } catch (error) {
    if (requestSequence === taskRequestSequence) alert(error.message);
  } finally {
    versionLoadPending = false;
    detail.inert = wasInert;
  }
}

function hasOriginalWorkbook() {
  return taskState.sections.some(s => s.dept === 'sales'
    && parseJson(s.payload_json, {}).legacy_import?.excel_model);
}

function renderDetail() {
  const quote = taskState.quote;
  const version = taskState.selected_version;
  window.VerificationWorkbench?.cleanupMoldNumberObservers?.($('verification-detail'));
  $('verification-detail').innerHTML = `<header class="verification-detail-head">
      <button id="verification-back" class="mini">← 返回核价任务</button>
      <div><span class="eyebrow">核价明细</span><h1>${esc(quote.quote_no)} · ${esc(quote.product_name)}</h1>
        <p>${esc(quote.customer || '—')} · ${baselineTitle()}建立于 ${esc(formatDate(taskState.baseline.frozen_at))}</p></div>
      <span class="verification-status status-${esc(version.status)}">${esc(versionTitle(version))} · ${VERSION_STATUS[version.status]}</span>
    </header>
    <div class="verification-version-toolbar">
      <div class="verification-version-tabs">
        ${taskState.versions.map(item => `<button data-version-id="${item.id}" class="${item.id === version.id ? 'active' : ''}">
          ${esc(versionTitle(item))}<small>${VERSION_STATUS[item.status]} · ${num(item.approved_count)}/${num(item.total_count)}</small>
        </button>`).join('')}
      </div>
      <div class="verification-version-tools">
        ${versionCategoryEditor(taskState, 'detail-version')}
        ${createVersionSelector(taskState, 'detail-version')}
      </div>
    </div>
    <div class="verification-sticky-navigation">
      <nav class="verification-mode-tabs" aria-label="核价工作模式">
        <button data-detail-mode="workflow" class="${detailMode === 'workflow' ? 'active' : ''}">部门核价流程</button>
        ${hasOriginalWorkbook() ? `<button data-detail-mode="workbook" class="${detailMode === 'workbook' ? 'active' : ''}">原核价表</button>` : ''}
        <button data-detail-mode="compare" class="${detailMode === 'compare' ? 'active' : ''}">${quote.verification_origin==='direct'?'核价版本对比':'报价 / 核价版本对比'}</button>
      </nav>
      <div id="verification-workflow-navigation"></div>
    </div>
    <section id="verification-detail-content"></section>`;

  $('verification-back').onclick = async () => {
    if (sectionSavePending || versionLoadPending) return;
    if (sectionDirty && !confirm('当前部门有未保存修改，确认返回？')) return;
    $('verification-detail').classList.add('hidden');
    $('verification-list').classList.remove('hidden');
    await loadList();
  };
  document.querySelectorAll('[data-version-id]').forEach(button => {
    button.onclick = () => switchVersion(button.dataset.versionId);
  });
  document.querySelectorAll('[data-detail-mode]').forEach(button => {
    button.onclick = () => {
      if (sectionSavePending || versionLoadPending) return;
      if (sectionDirty && !confirm('当前部门有未保存修改，切换页面会放弃这些修改。确认继续？')) return;
      sectionDirty = false;
      detailMode = button.dataset.detailMode;
      renderDetail();
    };
  });
  bindCreateVersion(taskState, 'detail-version');
  bindVersionCategory(taskState, 'detail-version');
  if (detailMode === 'workflow') renderWorkflow();
  else if (detailMode === 'workbook' && hasOriginalWorkbook()) { $('verification-workflow-navigation').innerHTML=''; renderImportedWorkbook($('verification-detail-content')); }
  else renderComparison();
}

function renderWorkflow() {
  const host = $('verification-detail-content');
  window.VerificationWorkbench?.cleanupMoldNumberObservers?.(host);
  const navigationHost = $('verification-workflow-navigation');
  const version = taskState.selected_version;
  const departments = taskState.sections;
  const approvedCount = departments.filter(section => section.status === 'approved').length;
  const totalCount = departments.length;
  if (activeDepartment !== '__summary__'
    && !departments.some(section => section.dept === activeDepartment)) {
    activeDepartment = departments[0]?.dept;
  }
  navigationHost.innerHTML = `<div class="verification-workflow-intro">
      <div><strong>${esc(versionTitle(version))} 部门核价</strong><span>流程与报价一致：填写明细 → 提交审核 → 主管审核 → 全部通过后锁定版本</span></div>
      <div class="verification-progress" aria-label="部门审核进度">
        <strong>${approvedCount} / ${totalCount}</strong><span>部门已审核</span>
      </div>
    </div>
    <div class="verification-dept-tabs">
      ${departments.map(section => `<button data-verification-dept="${esc(section.dept)}" class="${section.dept === activeDepartment ? 'active' : ''}">
        ${esc(section.dept_name)}<small class="status-${esc(section.status)}">${SECTION_STATUS[section.status]}</small>
      </button>`).join('')}
      <button data-verification-dept="__summary__" class="verification-summary-tab ${activeDepartment === '__summary__' ? 'active' : ''}">汇总与减税<small>点击查看</small></button>
    </div>`;
  host.innerHTML = '<div id="verification-department-workbench"></div>';
  document.querySelectorAll('[data-verification-dept]').forEach(button => {
    button.onclick = () => {
      if (sectionSavePending || versionLoadPending) return;
      if (sectionDirty && !confirm('当前部门有未保存修改，确认切换？')) return;
      sectionDirty = false;
      activeDepartment = button.dataset.verificationDept;
      renderWorkflow();
    };
  });
  renderDepartmentWorkbench();
}

function renderImportedWorkbook(host) {
  const version = taskState.selected_version;
  const fullyReviewed = taskState.sections.length > 0 && taskState.sections.every(s => s.status === 'approved');
  host.innerHTML = `<div id="verification-original-workbook"></div>
    <div class="card excel-review-panel"><div class="excel-review-row"><strong>核价审核</strong>
      <span>${fullyReviewed ? '整表已审核' : taskState.sections.every(s => ['filled','approved'].includes(s.status)) ? '待审核' : '请先提交整表审核'}</span>
      ${taskState.can_review_workbook && !fullyReviewed ? `<button id="workbook-review-all" ${taskState.workbook_review_ready ? '' : 'disabled'}>一键审核</button>` : ''}</div></div>
    <details class="card excel-review-panel"><summary>查看审核明细（${taskState.sections.filter(s => s.status === 'approved').length}/${taskState.sections.length}）</summary>
      ${taskState.sections.map(s => `<div class="excel-review-row"><strong>${esc(s.dept_name)}</strong><span>${SECTION_STATUS[s.status]}</span>
        ${s.can_review && s.status === 'filled' ? `<button class="mini" data-grid-review="${s.id}" data-action="approve">通过</button><button class="mini" data-grid-review="${s.id}" data-action="reject">驳回</button>` : ''}
        ${s.can_review && s.status === 'approved' ? `<button class="mini" data-grid-reopen="${s.id}">解除审核</button>` : ''}</div>`).join('')}
    </details>
    ${taskState.can_complete ? '<button id="workbook-complete-version">完成当前版本</button>' : ''}`;
  window.ExcelGrid.render($('verification-original-workbook'), taskState.sections, {
    onDirty: () => { sectionDirty = true; },
    onSave: async (changes, submit) => {
      if(sectionSavePending)return;sectionSavePending=true;
      const grid = $('verification-original-workbook');
      grid.inert = true;
      try {
        await api(`/verifications/versions/${version.id}/workbook`, { method: 'PUT', body: JSON.stringify({ changes, submit, base_revisions: Object.fromEntries(taskState.sections.map(s => [s.id, s.revision])) }) });
        versionCache.clear();
        taskState = await fetchTask(taskState.quote.id, version.id);
        sectionDirty = false;
        if (submit) renderDetail();
      } finally { grid.inert = false;sectionSavePending=false; }
    },
  });
  if ($('workbook-review-all')) $('workbook-review-all').onclick = async () => {
    if (sectionDirty) { alert('表格有未保存修改，请先保存并提交审核。'); return; }
    if (!confirm(`确认一键通过 ${version.label} 的整张导入核价表？已审核部分保持不变。`)) return;
    const button = $('workbook-review-all'); button.disabled = true;
    try {
      await api(`/verifications/versions/${version.id}/workbook/review`, {method:'POST',body:JSON.stringify({token:taskState.workbook_review_token})});
      versionCache.clear();
      taskState = await fetchTask(taskState.quote.id, version.id);
      renderDetail();
    } catch (error) { alert(error.message); button.disabled = false; }
  };
  const leaveEdits = () => !sectionDirty || confirm('有未保存的表格修改，继续将放弃修改。确认继续？');
  host.querySelectorAll('[data-grid-review]').forEach(button => {
    button.onclick = async () => {
      if (!leaveEdits()) return;
      const section = taskState.sections.find(s => Number(s.id) === Number(button.dataset.gridReview));
      const comment = button.dataset.action === 'reject' ? await requestText('请输入驳回理由') : '';
      if (button.dataset.action === 'reject' && !comment?.trim()) return;
      sectionDirty = false;
      await reviewSection(section, button.dataset.action, comment);
    };
  });
  host.querySelectorAll('[data-grid-reopen]').forEach(button => {
    button.onclick = async () => {
      if (!leaveEdits()) return;
      const reason = await requestText('请输入解除审核理由');
      if (!reason?.trim()) return;
      try {
        await api(`/verifications/versions/${version.id}/sections/${button.dataset.gridReopen}/reopen`, { method: 'POST', body: JSON.stringify({ reason }) });
        sectionDirty = false;
        taskState = await fetchTask(taskState.quote.id, version.id);
        renderDetail();
      } catch (error) { alert(error.message); }
    };
  });
  if ($('workbook-complete-version')) $('workbook-complete-version').onclick = async () => {
    if (!confirm(`完成后 ${version.label} 将停止编辑；后续可创建新的核价版本。确认继续？`)) return;
    try {
      await api(`/verifications/versions/${version.id}/complete`, { method: 'POST', body: JSON.stringify({ note: version.note || '' }) });
      versionCache.clear();
      taskState = await fetchTask(taskState.quote.id, version.id);
      renderDetail();
    } catch (error) { alert(error.message); }
  };
}

function rendererForDepartment(department) {
  const workbench = window.VerificationWorkbench || {};
  return {
    engineering: workbench.renderEngineering,
    electronic: workbench.renderElectronic,
    molding: workbench.renderMolding,
    painting: workbench.renderPainting,
    slush: workbench.renderSlush,
    sewing: workbench.renderSewing,
    assembly: workbench.renderAssembly,
    sales: workbench.renderSales,
  }[department];
}

function currentSectionsForWorkbench() {
  return taskState.sections.map(section => ({
    ...section,
    payload_json: JSON.stringify(section._draft || parseJson(section.payload_json, {})),
  }));
}

function renderDepartmentWorkbench() {
  const host = $('verification-department-workbench');
  window.VerificationWorkbench?.cleanupMoldNumberObservers?.(host);
  if (activeDepartment === '__summary__') {
    renderVersionSummary(host);
    return;
  }
  const section = taskState.sections.find(item => item.dept === activeDepartment);
  if (!section) {
    host.innerHTML = '<div class="card summary-empty">没有该部门核价明细</div>';
    return;
  }
  section._draft = section._draft || parseJson(section.payload_json, {});
  const version = taskState.selected_version;
  const editable = Boolean(section.can_edit) && !['completed', 'cancelled'].includes(version.status);
  const renderer = rendererForDepartment(section.dept);
  host.innerHTML = `<article class="card verification-department-card">
      <header class="verification-department-head">
        <div><span class="eyebrow">${esc(versionTitle(version))} · 部门核价</span><h2>${esc(section.dept_name)}</h2>
          <p>填写材料、用量、人工和加工费等明细；最终核价由系统汇总计算</p></div>
        <span class="badge status-${esc(section.status)}">${SECTION_STATUS[section.status]}</span>
      </header>
      <div class="verification-quote-reference">${taskState.quote.verification_origin==='direct'?'直接新建核价，按当前基准初始化；各部门填写完成后提交审核。':'报价数据已作为该版本初始参考，原报价保持只读；详细差异请到“报价 / 核价版本对比”查看。'}</div>
      <div id="verification-workbench-body"></div>
      <div class="verification-workbench-actions">
        ${editable ? '<button id="verification-save-draft" class="mini">保存草稿</button><button id="verification-submit">提交审核</button>' : ''}
        ${section.can_review && section.status === 'filled' ? '<button id="verification-approve">审核通过</button><button id="verification-reject" class="danger">驳回</button>' : ''}
        ${section.can_review && section.status === 'approved' ? '<button id="verification-reopen" class="mini">解除审核</button>' : ''}
        ${section.review_comment ? `<span class="verification-review-comment">${esc(section.review_comment)}</span>` : ''}
        ${['completed', 'cancelled'].includes(version.status) ? '<span class="verification-lock">该版本已锁定</span>' : ''}
      </div>
    </article>`;

  const body = $('verification-workbench-body');
  const sections = currentSectionsForWorkbench();
  window.__data = { quote: taskState.quote, sections, me };
  const salesPayload = parseJson(sections.find(item => item.dept === 'sales')?.payload_json, {});
  const fxRmbHkd = num(salesPayload.header?.fx_rmb_hkd) || 0.85;
  const fxHkdUsd = num(salesPayload.header?.fx_hkd_usd) || 7.8;
  const onChange = () => { sectionDirty = true; };
  if(salesPayload.legacy_import?.excel_model && section._draft.excel_native){window.ExcelValuation.renderDepartment(body,section._draft,sections,editable,onChange);}
  else if (!renderer) {
    body.innerHTML = '<div class="summary-empty">该部门暂未配置核价表单</div>';
  } else if (section.dept === 'sales') {
    renderer(body, section._draft, taskState.quote, false, editable, sections, onChange, async () => {});
  } else if (section.dept === 'engineering') {
    renderer(body, section._draft, editable, onChange, fxRmbHkd, fxHkdUsd, taskState.quote.qty, taskState.quote.customer);
  } else if (section.dept === 'electronic') {
    renderer(body, section._draft, editable, onChange, fxRmbHkd, fxHkdUsd);
  } else if (section.dept === 'molding') {
    renderer(body, section._draft, editable, onChange, taskState.engineering_molds || [], fxRmbHkd, me.role);
  } else {
    renderer(body, section._draft, editable, onChange, fxRmbHkd);
  }

  const save = async submit => {
    if (sectionSavePending || versionLoadPending) return;
    if (!section.revision) { alert('核价服务版本未同步，请刷新页面后再保存'); return; }
    if (submit && !confirm(`确认提交 ${section.dept_name} 的 ${versionTitle(version)} 核价明细审核？`)) return;
    const sourceTask = taskState;
    const quoteId = sourceTask.quote.id;
    const submitted = JSON.stringify(section._draft);
    const wasInert = body.inert;
    sectionSavePending = true;
    ++taskRequestSequence;
    body.inert = true;
    const lockedControls = [...$('verification-detail').querySelectorAll('button,select,input,textarea')]
      .filter(control => !body.contains(control))
      .map(control => ({ control, disabled: control.disabled }));
    lockedControls.forEach(({ control }) => { control.disabled = true; });
    try {
      const saved = await api(`/verifications/versions/${version.id}/sections/${section.id}`, {
        method: 'PUT',
        body: JSON.stringify({ payload: JSON.parse(submitted), submit, base_revision: section.revision }),
      });
      section.payload_json = submitted;
      section.revision = saved.revision || section.revision;
      section.status = saved.section_status || (submit ? 'filled' : section.status);
      section.filled_at = saved.filled_at;
      const hasLaterEdits = JSON.stringify(section._draft) !== submitted;
      if (taskState === sourceTask) sectionDirty = hasLaterEdits;
      try {
        const refreshed = await fetchTask(quoteId, version.id);
        if (taskState !== sourceTask || !body.isConnected) return;
        if (hasLaterEdits) {
          const currentSection = refreshed.sections.find(item => Number(item.id) === Number(section.id));
          if (currentSection) currentSection._draft = section._draft;
        }
        taskState = refreshed;
        renderDetail();
      } catch (error) {
        if (taskState === sourceTask && body.isConnected) alert(`本部门已保存，核价刷新失败：${error.message}。可稍后重试刷新。`);
      }
    } catch (error) {
      alert(error.message);
    } finally {
      sectionSavePending = false;
      body.inert = wasInert;
      lockedControls.forEach(({ control, disabled }) => { control.disabled = disabled; });
    }
  };
  if ($('verification-save-draft')) $('verification-save-draft').onclick = () => save(false);
  if ($('verification-submit')) $('verification-submit').onclick = () => save(true);
  if ($('verification-approve')) $('verification-approve').onclick = () => reviewSection(section, 'approve');
  if ($('verification-reject')) $('verification-reject').onclick = async () => {
    const comment = await requestText('请输入驳回理由');
    if (!comment?.trim()) return;
    await reviewSection(section, 'reject', comment);
  };
  if ($('verification-reopen')) $('verification-reopen').onclick = async () => {
    const reason = await requestText('请输入解除审核理由');
    if (!reason?.trim()) return;
    try {
      await api(`/verifications/versions/${version.id}/sections/${section.id}/reopen`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      taskState = await fetchTask(taskState.quote.id, version.id);
      renderDetail();
    } catch (error) {
      alert(error.message);
    }
  };
}

async function reviewSection(section, action, comment = '') {
  try {
    await api(`/verifications/versions/${taskState.selected_version.id}/sections/${section.id}/review`, {
      method: 'POST',
      body: JSON.stringify({ action, comment }),
    });
    taskState = await fetchTask(taskState.quote.id, taskState.selected_version.id);
    renderDetail();
  } catch (error) {
    alert(error.message);
  }
}

function renderVersionSummary(host) {
  const version = taskState.selected_version;
  host.innerHTML = `<article class="card verification-version-summary">
      <header class="verification-department-head"><div><span class="eyebrow">${esc(versionTitle(version))}</span><h2>核价汇总与减税</h2>
        <p>汇总由各部门核价明细自动计算，不能直接填写最终价格</p></div>
        <span class="verification-status status-${esc(version.status)}">${VERSION_STATUS[version.status]}</span>
      </header>
      <div id="verification-summary-workbench"></div>
      <div class="verification-complete-panel">
        <label>版本说明 <textarea id="verification-version-note" placeholder="填写本版本主要调整原因">${esc(version.note || '')}</textarea></label>
        ${taskState.can_complete ? '<button id="verification-complete-version">完成并锁定当前版本</button>' : ''}
        ${version.status === 'ready' ? '<span>全部部门已审核，可以完成锁定。</span>' : ''}
        ${version.status === 'completed' ? '<span class="verification-lock">该版本已完成并锁定，可创建下一版本。</span>' : ''}
      </div>
    </article>`;
  const summaryHost = $('verification-summary-workbench');
  const sections = currentSectionsForWorkbench();
  window.__data = { quote: taskState.quote, sections, me };
  window.VerificationWorkbench?.renderSummaryPane(summaryHost, sections, taskState.quote, { dept: 'verification_readonly', role: 'staff' });
  if ($('verification-complete-version')) $('verification-complete-version').onclick = async () => {
    if (!confirm(`完成后 ${versionTitle(version)} 将永久锁定，确认继续？`)) return;
    try {
      await api(`/verifications/versions/${version.id}/complete`, {
        method: 'POST',
        body: JSON.stringify({ note: $('verification-version-note').value }),
      });
      versionCache.clear();
      taskState = await fetchTask(taskState.quote.id, version.id);
      renderDetail();
    } catch (error) {
      alert(error.message);
    }
  };
}

function comparisonOptions(selected) {
  const options = [{ key: 'quote', label: `${baselineTitle()} ${taskState.quote.version || ''}`.trim(), status: '已冻结' }]
    .concat(taskState.versions.map(version => ({ key: String(version.id), label: versionTitle(version), status: VERSION_STATUS[version.status] })));
  return options.map(option => `<option value="${esc(option.key)}" ${String(selected) === String(option.key) ? 'selected' : ''}>${esc(option.label)} · ${esc(option.status)}</option>`).join('');
}

function comparisonTargetOptions(selected, baseline) {
  const selectedKeys = new Set((selected || []).map(String));
  const options = [{ key: 'quote', label: `${baselineTitle()} ${taskState.quote.version || ''}`.trim(), status: '已冻结' }]
    .concat(taskState.versions.map(version => ({ key: String(version.id), label: versionTitle(version), status: VERSION_STATUS[version.status] })));
  return options.filter(option => option.key !== String(baseline)).map(option => `<label class="verification-target-option">
    <input type="checkbox" data-compare-target value="${esc(option.key)}" ${selectedKeys.has(option.key) ? 'checked' : ''}>
    <span><strong>${esc(option.label)}</strong><small>${esc(option.status)}</small></span>
  </label>`).join('');
}

function comparisonRows(source) {
  const sales = parseJson(source.sections.find(s => s.dept === 'sales')?.payload_json, {});
  const native = sales.legacy_import?.excel_model ? window.ExcelValuation.comparisonPayloads(source.sections) : null;
  return source.sections.flatMap(section => {
    const normalized = { ...section, payload: native?.[section.dept] || parseJson(section.payload_json, {}) };
    return collectCostFields(normalized).map(row => ({
      ...row,
      dept: section.dept,
      deptName: section.dept_name,
      storageKey: `${section.dept}:${row.key}`,
    }));
  });
}

function renderComparison() {
  const host = $('verification-detail-content');
  const versionKeys = taskState.versions.map(version => String(version.id));
  const validKeys = new Set(['quote', ...versionKeys]);
  if (Number(comparisonState.quoteId) !== Number(taskState.quote.id)) {
    comparisonState = { quoteId: taskState.quote.id, baseline: 'quote', targets: null, dept: 'all', changedOnly: true, query: '' };
  }
  if (!validKeys.has(String(comparisonState.baseline))) comparisonState.baseline = 'quote';
  if (comparisonState.targets === null) comparisonState.targets = versionKeys.filter(key => key !== comparisonState.baseline);
  comparisonState.targets = comparisonState.targets.map(String)
    .filter((key, index, keys) => validKeys.has(key) && key !== comparisonState.baseline && keys.indexOf(key) === index);
  host.innerHTML = `<article class="card verification-comparison-card">
      <header class="verification-section-head"><div><span class="eyebrow">自定义选择</span><h2>报价 / 核价版本对比</h2>
        <p>选择一个对比基准，可同时勾选多个核价版本横向对比</p></div></header>
      <div class="verification-source-picker verification-source-picker-multi">
        <label>对比基准<select id="verification-source-baseline">${comparisonOptions(comparisonState.baseline)}</select></label>
        <fieldset class="verification-target-picker">
          <legend>参与对比的版本（可多选）</legend>
          <div class="verification-target-options">${comparisonTargetOptions(comparisonState.targets, comparisonState.baseline)}</div>
          <div class="verification-target-actions"><button id="verification-select-all-targets" type="button" class="mini">全选核价版本</button>
            <button id="verification-clear-targets" type="button" class="mini">清空</button></div>
        </fieldset>
      </div>
      <div class="verification-compare-filters">
        <select id="verification-compare-dept"><option value="all">全部部门</option>
          ${taskState.sections.map(section => `<option value="${esc(section.dept)}" ${comparisonState.dept === section.dept ? 'selected' : ''}>${esc(section.dept_name)}</option>`).join('')}
        </select>
        <input id="verification-compare-search" type="search" placeholder="搜索核价项目" value="${esc(comparisonState.query)}">
        <label><input id="verification-compare-changed" type="checkbox" ${comparisonState.changedOnly ? 'checked' : ''}> 只看变化</label>
      </div>
      <div id="verification-comparison-result"><div class="verification-preview-empty">正在计算所选版本…</div></div>
    </article>`;
  $('verification-source-baseline').onchange = event => {
    comparisonState.baseline = event.target.value;
    comparisonState.targets = comparisonState.targets.filter(key => key !== comparisonState.baseline);
    renderComparison();
  };
  const updateTargets = () => {
    comparisonState.targets = [...document.querySelectorAll('[data-compare-target]:checked')].map(input => input.value);
    refreshComparison();
  };
  document.querySelectorAll('[data-compare-target]').forEach(input => { input.onchange = updateTargets; });
  $('verification-select-all-targets').onclick = () => {
    const selectableVersions = new Set(versionKeys.filter(key => key !== comparisonState.baseline));
    document.querySelectorAll('[data-compare-target]').forEach(input => { input.checked = selectableVersions.has(input.value); });
    updateTargets();
  };
  $('verification-clear-targets').onclick = () => {
    document.querySelectorAll('[data-compare-target]').forEach(input => { input.checked = false; });
    updateTargets();
  };
  $('verification-compare-dept').onchange = event => {
    comparisonState.dept = event.target.value;
    refreshComparison();
  };
  $('verification-compare-search').oninput = event => {
    comparisonState.query = event.target.value.trim();
    refreshComparison();
  };
  $('verification-compare-changed').onchange = event => {
    comparisonState.changedOnly = event.target.checked;
    refreshComparison();
  };
  refreshComparison();
}

function comparisonTargetCells(baselineValue, targetValue, currency = 'HKD', decimals = 2) {
  const difference = num(targetValue) - num(baselineValue);
  const rate = nearZero(baselineValue) ? null : difference / num(baselineValue);
  const klass = difference > 0.00001 ? 'delta-up' : difference < -0.00001 ? 'delta-down' : 'delta-flat';
  return `<td>${amount(targetValue, currency, decimals)}</td>
    <td class="${klass}">${nearZero(difference) ? '—' : `${difference > 0 ? '+' : ''}${amount(difference, currency, decimals)}`}</td>
    <td class="${klass}">${rate == null || nearZero(difference) ? '—' : `${rate > 0 ? '+' : ''}${(rate * 100).toFixed(1)}%`}</td>`;
}

async function refreshComparison() {
  const resultHost = $('verification-comparison-result');
  if (!resultHost) return;
  const refreshToken = ++comparisonRefreshToken;
  if (!comparisonState.targets.length) {
    resultHost.innerHTML = '<div class="summary-empty">请至少勾选一个参与对比的版本</div>';
    return;
  }
  resultHost.innerHTML = '<div class="verification-preview-empty">正在计算所选版本…</div>';
  try {
    const sources = await Promise.all([comparisonState.baseline, ...comparisonState.targets].map(loadComparisonSource));
    if (refreshToken !== comparisonRefreshToken) return;
    const [baseline, ...targets] = sources;
    const summaries = sources.map(calculateFinancial);
    const rowMaps = sources.map(source => new Map(comparisonRows(source).map(row => [row.storageKey, row])));
    const keys = [...new Set(rowMaps.flatMap(rows => [...rows.keys()]))];
    const query = comparisonState.query.toLowerCase();
    const rows = keys.map(key => {
      const sourceRows = rowMaps.map(rowsMap => rowsMap.get(key));
      const row = sourceRows.find(Boolean);
      const baselineRow = sourceRows[0];
      const baselineValue = baselineRow?.value ?? 0;
      const targetValues = sourceRows.slice(1).map(targetRow => targetRow?.value ?? 0);
      const changedTargets = sourceRows.slice(1).filter((targetRow, index) => Boolean(baselineRow) !== Boolean(targetRow)
        || !nearZero(targetValues[index] - baselineValue)).length;
      return {
        ...row,
        baselineValue,
        targetValues,
        changedTargets,
        changeType: changedTargets ? `${changedTargets}/${targets.length} 有变化` : '一致',
      };
    }).filter(row => (comparisonState.dept === 'all' || row.dept === comparisonState.dept)
      && (!comparisonState.changedOnly || row.changeType !== '一致')
      && (!query || `${row.label} ${row.deptName}`.toLowerCase().includes(query)));
    const summaryRows = [
      ['货价', 'base_price'], ['成本（含人工）', 'totalCost'], ['成本（不含人工）', 'noLabor'],
      ['啤工', 'injection_labor'], ['装工', 'assembly_labor'], ['喷印工', 'painting_labor'],
      ['油漆', 'paint_material'], ['进口料', 'imp_mat'], ['国内料', 'dom_mat'],
      ['五金', 'hardware'], ['电子', 'electronic'], ['彩盒/内咭', 'color_box'],
      ['纸箱', 'carton'], ['其他外购', 'other_buy'], ['运费', 'freight'], ['杂项', 'misc'],
    ];
    const summaryValue = (summary, key) => key in summary ? summary[key] : summary.fields[key];
    const draftWarning = sources.some(source => source.type === 'version' && source.status !== 'completed')
      ? '<div class="verification-draft-warning">当前对比包含未完成核价版本，结果会随部门填写和审核继续变化。</div>' : '';
    resultHost.innerHTML = `${draftWarning}
      <div class="verification-comparison-labels verification-comparison-labels-multi"><strong>${esc(baseline.label)}（基准）</strong><span>对比</span>
        ${targets.map(target => `<strong>${esc(target.label)}</strong>`).join('')}</div>
      <section class="verification-comparison-section"><h3>成本汇总对比</h3>
        <div class="verification-table-scroll"><table class="verification-financial-table">
          <thead><tr><th rowspan="2">项目</th><th rowspan="2">${esc(baseline.label)}（基准）</th>
            ${targets.map(target => `<th colspan="3">${esc(target.label)}</th>`).join('')}</tr>
            <tr>${targets.map(() => '<th>数值</th><th>差额</th><th>差异率</th>').join('')}</tr></thead>
          <tbody>${summaryRows.map(([label, key]) => {
            const baselineValue = summaryValue(summaries[0], key);
            return `<tr><td>${label}</td><td>${amount(baselineValue)}</td>${summaries.slice(1).map(summary => comparisonTargetCells(baselineValue, summaryValue(summary, key))).join('')}</tr>`;
          }).join('')}</tbody>
        </table></div>
      </section>
      <section class="verification-comparison-section"><h3>部门明细变化</h3>
        <div class="verification-table-scroll"><table class="verification-comparison-table">
          <thead><tr><th rowspan="2">部门 / 核价项目</th><th rowspan="2">用量</th><th rowspan="2">币种</th><th rowspan="2">${esc(baseline.label)}（基准）</th>
            ${targets.map(target => `<th colspan="3">${esc(target.label)}</th>`).join('')}<th rowspan="2">状态</th></tr>
            <tr>${targets.map(() => '<th>数值</th><th>差额</th><th>差异率</th>').join('')}</tr></thead>
          <tbody>${rows.length ? rows.map(row => {
            return `<tr><td><small>${esc(row.deptName)}</small><strong>${esc(row.label)}</strong></td><td>${esc(row.quantity)}</td><td>${esc(row.currency === 'NUMBER' ? '数值' : row.currency)}</td>
              <td>${amount(row.baselineValue, row.currency, 4)}</td>${row.targetValues.map(value => comparisonTargetCells(row.baselineValue, value, row.currency, 4)).join('')}
              <td><span class="verification-row-state ${row.changeType !== '一致' ? 'changed' : ''}">${row.changeType}</span></td></tr>`;
          }).join('') : `<tr><td colspan="${5 + targets.length * 3}" class="summary-empty">没有符合条件的变化项目</td></tr>`}</tbody>
        </table></div>
      </section>
      ${renderTaxComparison(sources, summaries)}`;
  } catch (error) {
    if (refreshToken !== comparisonRefreshToken) return;
    resultHost.innerHTML = `<div class="summary-empty">${esc(error.message)}</div>`;
  }
}

function renderTaxComparison(sources, summaries) {
  const verificationSources = sources.map((source, index) => source.type === 'version' ? { source, summary: summaries[index] } : null).filter(Boolean);
  if (!verificationSources.length) return '';
  if (verificationSources.length === 1) {
    const { source, summary } = verificationSources[0];
    const rows = summary.taxRows.filter(row => row.base || row.deduction);
    return `<section class="verification-tax-card">
      <div class="verification-section-head"><div><span class="eyebrow">仅显示核价</span><h3>${esc(source.label)} 减税</h3>
        <p>${baselineTitle()}不展示减税，只显示所选核价版本的减税结果</p></div></div>
      <div class="verification-tax-kpis"><div><span>核价总成本</span><strong>${amount(summary.totalCost)}</strong></div>
        <div><span>合计减税</span><strong>${amount(summary.totalDeduction)}</strong></div>
        <div><span>减税后成本</span><strong>${amount(summary.afterDeduction)}</strong></div></div>
      <table class="verification-tax-table"><thead><tr><th>核价减税项目</th><th>核价金额</th><th>减税率</th><th>减税额</th></tr></thead>
        <tbody>${rows.map(row => `<tr><td>${esc(row.label)}</td><td>${amount(row.base)}</td><td>${num(row.rate).toFixed(2)}%</td><td>${amount(row.deduction)}</td></tr>`).join('')}</tbody></table>
    </section>`;
  }
  const taxMaps = verificationSources.map(item => new Map(item.summary.taxRows.map(row => [row.key, row])));
  const keys = [...new Set(taxMaps.flatMap(rows => [...rows.keys()]))]
    .filter(key => taxMaps.some(rows => num(rows.get(key)?.base) || num(rows.get(key)?.deduction)));
  return `<section class="verification-tax-card">
    <div class="verification-section-head"><div><span class="eyebrow">多核价版本对比</span><h3>减税汇总</h3>
      <p>${baselineTitle()}不计算减税；所有已选核价版本在同一张表内并列显示</p></div></div>
    <div class="verification-table-scroll"><table class="verification-tax-table"><thead><tr><th>减税项目</th>${verificationSources.map(item => `<th>${esc(item.source.label)}</th>`).join('')}</tr></thead>
      <tbody><tr><td><strong>核价总成本</strong></td>${verificationSources.map(item => `<td>${amount(item.summary.totalCost)}</td>`).join('')}</tr>
      <tr><td><strong>合计减税</strong></td>${verificationSources.map(item => `<td>${amount(item.summary.totalDeduction)}</td>`).join('')}</tr>
      <tr><td><strong>减税后成本</strong></td>${verificationSources.map(item => `<td>${amount(item.summary.afterDeduction)}</td>`).join('')}</tr>
      ${keys.map(key => {
        const label = taxMaps.map(rows => rows.get(key)?.label).find(Boolean) || key;
        return `<tr><td>${esc(label)}</td>${taxMaps.map(rows => `<td>${amount(rows.get(key)?.deduction || 0)}</td>`).join('')}</tr>`;
      }).join('')}</tbody>
    </table></div>
  </section>`;
}

$('verification-search').oninput = applyListFilter;
$('verification-status-filter').onchange = applyListFilter;
$('verification-customer-filter').onchange = applyListFilter;
$('verification-preview').addEventListener('click', event => {
  if (event.target.closest('#verification-open-detail')) openDetail('workflow');
  if (event.target.closest('#verification-open-compare')) openDetail('compare');
});
$('verification-records').onclick = () => {
  $('verification-status-filter').value = $('verification-status-filter').value === 'completed' ? '' : 'completed';
  $('verification-records').classList.toggle('active', $('verification-status-filter').value === 'completed');
  applyListFilter();
};
$('verification-export').onclick = () => {
  const rows = [['货号', '产品', '版本', '客户', '当前核价版本', '部门进度', '核价状态'], ...filteredList().map(row => [
    row.quote_no, row.product_name, row.version || '', row.customer || '',
    versionTitle({ label: row.current_version_label || '待创建', category: row.current_version_category }), `${num(row.approved_count)}/${num(row.total_depts)}`,
    VERSION_STATUS[row.verification_status] || '待创建',
  ])];
  const csv = '\ufeff' + rows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `核价任务_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const linkedQuoteId=Number(new URLSearchParams(window.location.search).get('quote_id'));
if(Number.isSafeInteger(linkedQuoteId)&&linkedQuoteId>0)selectedQuoteId=linkedQuoteId;
loadList().catch(error => {
  $('verification-list-body').innerHTML = `<tr><td colspan="7" class="summary-empty">${esc(error.message)}</td></tr>`;
});

window.addEventListener('beforeunload', event => {
  if (!sectionDirty && !sectionSavePending) return;
  event.preventDefault();
  event.returnValue = '';
});

$('verification-create').onclick = openCreateVerification;
