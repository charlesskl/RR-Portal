// 5 个部门工作台 + 公用可增删行表格组件 + 汇总计算
// 数据流：从 /api/quotes/:id 拉到 sections（其他部门已审的 payload_json 也会带过来）
// → 渲染当前部门工作台 → 编辑后 PUT /api/sections/:id { payload, submit }
// → 业务页用所有已审 section 计算总价

const $ = (id) => document.getElementById(id);

const STATUS_TXT = { empty: '空', filled: '已填', approved: '已审', rejected: '驳回' };
const STATUS_CLS = { empty: 'b-empty', filled: 'b-filled', approved: 'b-approved', rejected: 'b-rejected' };

// 权限工具（与 main.js 一致）
function hasPerm(me, menu, action) {
  if (!me || !me.perms) return false;
  const p = me.perms[menu];
  return !!(p && p['can_' + action]);
}
const DEPT_MENU = {
  sales: '业务部', engineering: '工程部', electronic: '电子部', molding: '啤机部',
  painting: '喷油部', slush: '搪胶', sewing: '车缝', assembly: '装配部',
};

async function api(p, opts = {}) {
  const r = await fetch('/api' + p, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...opts });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.json();
}

// 保存 section（带轻量并发提醒）：带上加载时的 filled_at；后端若发现被别人改过会回 conflict
// 不挡保存，仅弹一次提示；成功后更新本地 filled_at 作为新基线（避免自己的后续保存误报）
async function putSection(sec, payload, submit) {
  const r = await api('/sections/' + sec.id, {
    method: 'PUT',
    body: JSON.stringify({ payload, submit: !!submit, base_filled_at: sec.filled_at || null }),
  });
  if (r) {
    if (r.filled_at) sec.filled_at = r.filled_at;
    if (r.conflict) alert(`⚠️ 该部分在你打开后已被「${r.last_by || '他人'}」修改过（${r.last_at || ''}），你的保存已覆盖它。\n请刷新核对，必要时让对方重填。`);
  }
  return r;
}

// ==================== 通用可编辑表格 ====================
// columns: [{key, label, type?: 'text'|'number'|'textarea', readonly?: bool|fn, calc?: row => number, width?: string}]
// rows:    数组（直接 mutate 本数组）
// onChange: 数据变更时回调
function renderTable(container, columns, rows, opts = {}) {
  const { readonly = false, onChange = () => {}, footer = null } = opts;
  container.innerHTML = '';

  const table = document.createElement('table');
  table.className = 'wb-table';
  const thead = document.createElement('thead');
  const tr = document.createElement('tr');
  tr.innerHTML = '<th style="width:36px">#</th>' +
    columns.map(c => `<th${c.width ? ` style="width:${c.width}"` : ''}>${c.label}</th>`).join('') +
    (readonly ? '' : '<th style="width:36px"></th>');
  thead.appendChild(tr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  function rebuild() {
    tbody.innerHTML = '';
    rows.forEach((row, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${idx + 1}</td>`;
      const calcCells = []; // [{ td, fn }] — 行内所有计算列，用于实时刷新
      const refreshCalcs = () => calcCells.forEach(({ td, fn }) => { td.textContent = formatNum(fn(row)); });
      columns.forEach(c => {
        const td = document.createElement('td');
        const ro = typeof c.readonly === 'function' ? c.readonly(row) : (c.readonly || readonly);
        let val = row[c.key];
        if (c.calc) val = c.calc(row);
        if (val === undefined || val === null) val = '';
        if (ro) {
          td.className = 'ro';
          td.textContent = formatNum(val);
          if (c.calc) calcCells.push({ td, fn: c.calc });
        } else if (c.type === 'textarea') {
          const ta = document.createElement('textarea');
          ta.rows = 2; ta.value = val;
          ta.style.resize = 'vertical';
          const autoSize = () => { ta.style.height = 'auto'; ta.style.height = (ta.scrollHeight + 2) + 'px'; };
          ta.oninput = () => { row[c.key] = ta.value; autoSize(); refreshCalcs(); onChange(); };
          td.appendChild(ta);
          setTimeout(autoSize, 0);
        } else if (c.type === 'select') {
          const sel = document.createElement('select');
          const opts = typeof c.options === 'function' ? c.options(row) : (c.options || []);
          // 允许空选项
          const blank = document.createElement('option');
          blank.value = ''; blank.textContent = '';
          sel.appendChild(blank);
          opts.forEach(o => {
            const op = document.createElement('option');
            op.value = o; op.textContent = o;
            if (val === o) op.selected = true;
            sel.appendChild(op);
          });
          if (!opts.includes(val) && val) {
            // 当前值不在选项里，仍保留（避免清空）
            const op = document.createElement('option');
            op.value = val; op.textContent = val; op.selected = true;
            sel.appendChild(op);
          }
          sel.onchange = () => { row[c.key] = sel.value; refreshCalcs(); onChange(); if (c.affectsOptions) rebuild(); };
          td.appendChild(sel);
        } else {
          const inp = document.createElement('input');
          inp.type = c.type === 'number' ? 'number' : 'text';
          if (c.type === 'number') inp.step = 'any';
          if (c.width) inp.style.minWidth = c.width;  // 让输入框按列宽撑开（覆盖全局 3.4em，避免长数字被截断）
          inp.value = val;
          inp.oninput = () => {
            row[c.key] = c.type === 'number' ? (inp.value === '' ? null : Number(inp.value)) : inp.value;
            refreshCalcs();
            onChange();
          };
          // 该列影响同行下拉的选项(如 材质→料型)：失焦后重建表格刷新依赖下拉
          if (c.affectsOptions) inp.onchange = () => rebuild();
          td.appendChild(inp);
        }
        tr.appendChild(td);
      });
      if (!readonly) {
        const td = document.createElement('td'); td.className = 'row-actions';
        const mkBtn = (label, title, fn) => {
          const b = document.createElement('button');
          b.textContent = label; b.className = 'mini'; b.title = title;
          b.style.padding = '2px 6px'; b.style.marginRight = '2px';
          b.onclick = fn;
          return b;
        };
        // 上移
        if (idx > 0) td.appendChild(mkBtn('↑', '上移', () => {
          [rows[idx - 1], rows[idx]] = [rows[idx], rows[idx - 1]]; rebuild(); onChange();
        }));
        // 下移
        if (idx < rows.length - 1) td.appendChild(mkBtn('↓', '下移', () => {
          [rows[idx + 1], rows[idx]] = [rows[idx], rows[idx + 1]]; rebuild(); onChange();
        }));
        // 复制此行（拆分用）→ 在下方插入一份副本
        td.appendChild(mkBtn('⎘', '在下方插入副本（用于拆分）', () => {
          rows.splice(idx + 1, 0, JSON.parse(JSON.stringify(rows[idx]))); rebuild(); onChange();
        }));
        // 删除
        const delBtn = mkBtn('×', '删除', () => { rows.splice(idx, 1); rebuild(); onChange(); });
        delBtn.className = 'mini danger';
        td.appendChild(delBtn);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    });
  }
  rebuild();
  table.appendChild(tbody);
  // 列多时不再压缩每列(导致输入框看不到值)，改为表格按列宽撑开 + 横向滚动
  table.style.width = 'auto';
  table.style.minWidth = '100%';
  const scrollWrap = document.createElement('div');
  scrollWrap.style.overflowX = 'auto';
  scrollWrap.appendChild(table);
  container.appendChild(scrollWrap);

  if (footer) {
    const f = document.createElement('div'); f.className = 'wb-footer'; f.innerHTML = footer();
    container.appendChild(f);
  }

  if (!readonly) {
    const addBtn = document.createElement('button');
    addBtn.textContent = '+ 增加行'; addBtn.className = 'mini';
    addBtn.onclick = () => { rows.push({}); rebuild(); onChange(); };
    container.appendChild(addBtn);
  }
  return { rebuild };
}

// 辅助/包装材料 类别 — 减税明细各外购项按此类别统计
const MAT_CATEGORIES = ['吸塑', '胶袋', '彩盒/内咭', '电池', '产品利宝', '彩盒利宝', '电镀', '其他外购'];

// 车缝：人工若已作为明细行(名称含"人工")计入，则不再额外加 labor_amount，避免双算
function sewLaborToAdd(g) {
  const items = (g && g.items) || [];
  const laborInItems = sum(items, r => /人工/.test(r.fabric || r.part || r.name || '')
    ? num(r.usage) * num(r.mat_price) * (num(r.markup) || 1) : 0);
  return laborInItems > 0 ? 0 : num(g && g.labor_amount);
}

function formatNum(v) {
  if (typeof v === 'number' && !Number.isNaN(v)) return v.toFixed(Math.abs(v) < 1 ? 4 : 2);
  return String(v ?? '');
}
function num(v) { return Number(v) || 0; }
function sum(arr, fn) { return arr.reduce((a, r) => a + (fn(r) || 0), 0); }
function hasFreeRmbPrice(row) {
  return row && row.unit_price_rmb !== undefined && row.unit_price_rmb !== null && row.unit_price_rmb !== '';
}
function freeUnitRmb(row, fxRmbHkd) {
  const fx = num(fxRmbHkd) || 0.85;
  return hasFreeRmbPrice(row) ? num(row.unit_price_rmb) : num(row.unit_price) * fx;
}
function freeUnitHkd(row, fxRmbHkd) {
  const fx = num(fxRmbHkd) || 0.85;
  return hasFreeRmbPrice(row) ? num(row.unit_price_rmb) / fx : num(row.unit_price);
}
function freeAmountHkd(row, fxRmbHkd) {
  if (row && row.is_subtotal) return num(row.amount);
  return num(row && row.qty) * freeUnitHkd(row, fxRmbHkd);
}
function ensureFreeRmbPrices(rows, fxRmbHkd) {
  (rows || []).forEach(row => {
    if (!hasFreeRmbPrice(row) && row.unit_price !== undefined && row.unit_price !== null && row.unit_price !== '') {
      row.unit_price_rmb = +freeUnitRmb(row, fxRmbHkd).toFixed(6);
    }
  });
}

// ==================== 子小计计算 ====================
// 自由表（electronics / aux_materials）：行 amount = qty × unit_price；
// 子小计行（is_subtotal=true）不参与父级再加；普通行参与
function computeRow(row, fxRmbHkd) {
  if (row.is_subtotal) return num(row.amount);
  return freeAmountHkd(row, fxRmbHkd);
}
function freeTableSubtotal(rows, fxRmbHkd) {
  // 非 is_subtotal 行才计入
  return sum(rows.filter(r => !r.is_subtotal), r => computeRow(r, fxRmbHkd));
}
function applyLoss(subtotal, pct) {
  return subtotal;  // 已全面取消损耗
}

// ==================== 工程：模具部分（表格布局，对齐 sheet1 / 导出格式） ====================
function renderMolds(container, molds, onChange, canEdit, fxRmbHkd) {
  container.innerHTML = '';
  const table = document.createElement('table'); table.className = 'wb-table mold-table';
  table.innerHTML = `<thead><tr>
    <th style="width:40px">序号</th>
    <th style="width:160px">模具名称</th>
    <th style="width:70px">模号</th>
    <th style="width:120px">模胚类型</th>
    <th style="width:100px">模具结构</th>
    <th style="width:70px">材质</th>
    <th style="width:70px">颜色</th>
    <th style="width:80px">出模数</th>
    <th style="width:60px">套数</th>
    <th style="width:90px">净重(g)</th>
    <th style="width:80px">周期(秒)</th>
    <th style="width:110px">模具尺寸</th>
    <th style="width:240px">图  片</th>
    <th style="width:120px">模具价格 RMB</th>
    <th style="width:120px">模价 HKD</th>
    <th>备  注</th>
    ${canEdit ? '<th style="width:40px"></th>' : ''}
  </tr></thead><tbody></tbody>`;
  const tbody = table.querySelector('tbody');

  const fields = [
    ['name', 'textarea'],
    ['mold_no', 'text'],
    ['mold_type', 'textarea'],
    ['structure', 'text'],
    ['material', 'text'], ['color', 'text'], ['cavity', 'text'], ['sets', 'number'],
    ['weight_g', 'number'],
    ['cycle_sec', 'number'],
    ['mold_size', 'text', 'detail'],
    null, // 图片列
    ['price_rmb', 'number'],
    ['price_hkd', 'calc_hkd'],  // 模价 HKD = 模价RMB ÷ 汇率（只读）
    ['note', 'textarea'],
  ];
  const fxv = num(fxRmbHkd) || 0.85;  // RMB→HKD 汇率

  // 数据迁移：备注内容提取为模胚类型（仅当模胚类型为空时，避免覆盖导入的模胚型号如 CI 3040）
  molds.forEach(m => {
    if (m.note && !String(m.mold_type || '').trim()) { m.mold_type = m.note; m.note = ''; }
  });

  molds.forEach((m, idx) => {
    const tr = document.createElement('tr');
    // 序号
    const tdNo = document.createElement('td'); tdNo.className = 'ro'; tdNo.textContent = idx + 1; tr.appendChild(tdNo);

    fields.forEach((f) => {
      const td = document.createElement('td');
      if (f === null) {
        // 图片单元格
        td.className = 'mold-img-cell';
        renderImageCell(td, m, canEdit, onChange);
      } else {
        const [k, type, group] = f;
        const obj = group ? (m[group] = m[group] || {}) : m;
        const get = () => obj[k];
        const set = (v) => { obj[k] = v; };
        if (type === 'calc_hkd') {
          td.className = 'ro'; td.textContent = formatNum(num(m.price_rmb) / fxv);
        } else if (!canEdit) {
          td.className = 'ro'; td.style.whiteSpace = 'pre-wrap'; td.textContent = formatNum(get() ?? '');
        } else if (type === 'textarea') {
          const ta = document.createElement('textarea');
          ta.rows = 3; ta.value = get() ?? '';
          ta.style.resize = 'vertical';
          const autoSize = () => { ta.style.height = 'auto'; ta.style.height = (ta.scrollHeight + 2) + 'px'; };
          ta.oninput = () => { set(ta.value); autoSize(); onChange(); };
          td.appendChild(ta);
          setTimeout(autoSize, 0);
        } else {
          const inp = document.createElement('input');
          inp.type = type === 'number' ? 'number' : 'text';
          if (type === 'number') inp.step = 'any';
          inp.value = get() ?? '';
          // 净重必填：空时红底提示
          const markRequired = k === 'weight_g'
            ? () => { const empty = !num(inp.value); inp.style.background = empty ? '#fee2e2' : ''; inp.placeholder = empty ? '必填' : ''; }
            : null;
          if (markRequired) markRequired();
          inp.oninput = () => {
            set(type === 'number' ? (inp.value === '' ? null : Number(inp.value)) : inp.value);
            if (markRequired) markRequired();
            onChange();
          };
          td.appendChild(inp);
        }
      }
      tr.appendChild(td);
    });

    if (canEdit) {
      const td = document.createElement('td');
      const b = document.createElement('button'); b.textContent = '×'; b.className = 'mini danger';
      b.onclick = () => { molds.splice(idx, 1); renderMolds(container, molds, onChange, canEdit); onChange(); };
      td.appendChild(b); tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });

  // 小计：RMB / HKD 同行，分别对齐 价格RMB / 价格HKD 列
  const rmbTotal = sum(molds, m => num(m.price_rmb));
  const hkdTotal = rmbTotal / fxv;
  const extra = canEdit ? '<td></td>' : '';
  const trSub = document.createElement('tr'); trSub.className = 'hi';
  trSub.innerHTML = `<td colspan="13" style="text-align:right">小计 <span class="muted" style="font-weight:normal;font-size:12px">(汇率 ${fxv})</span></td>
    <td>${formatNum(rmbTotal)}</td><td>${formatNum(hkdTotal)}</td><td></td>${extra}`;
  tbody.appendChild(trSub);

  container.appendChild(table);
  if (canEdit) {
    const add = document.createElement('button');
    add.textContent = '+ 新增模具行'; add.className = 'mini';
    add.style.marginTop = '8px';
    add.onclick = () => { molds.push({ images: [] }); renderMolds(container, molds, onChange, canEdit); onChange(); };
    container.appendChild(add);
  }
}

function renderImageCell(td, m, canEdit, onChange) {
  td.innerHTML = '';
  const wrap = document.createElement('div'); wrap.className = 'cell-imgs';
  (m.images || []).forEach((u, i) => {
    const box = document.createElement('div'); box.className = 'cell-img';
    box.innerHTML = `<img src="${u}" />${canEdit ? `<button class="mini danger img-del">×</button>` : ''}`;
    if (canEdit) box.querySelector('.img-del').onclick = () => { m.images.splice(i, 1); renderImageCell(td, m, canEdit, onChange); onChange(); };
    box.querySelector('img').onclick = () => window.open(u, '_blank');
    wrap.appendChild(box);
  });
  if (canEdit) {
    const lbl = document.createElement('label'); lbl.className = 'cell-img add';
    lbl.innerHTML = '+<input type="file" accept="image/*" hidden />';
    lbl.querySelector('input').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const fd = new FormData(); fd.append('file', f);
        const r = await fetch('/api/uploads/mold-image', { method: 'POST', credentials: 'include', body: fd });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        m.images = m.images || []; m.images.push(j.url);
        renderImageCell(td, m, canEdit, onChange); onChange();
      } catch (err) { alert('上传失败: ' + err.message); }
    };
    wrap.appendChild(lbl);
  }
  td.appendChild(wrap);
}

// ==================== 电子部分：两级表（顶层 + 可展开子明细） ====================
function elecRowAmount(r, fxRmbHkd) {
  if (Array.isArray(r.children) && r.children.length > 0) {
    return sum(r.children, ch => num(ch.qty) * freeUnitHkd(ch, fxRmbHkd));
  }
  return num(r.qty) * freeUnitHkd(r, fxRmbHkd);
}
function elecDetailRowCount(parts) {
  return (parts || []).reduce((a, p) => a + 1 + ((p.children || []).length), 0);
}
function ensureElecRmbPrices(rows, fxRmbHkd) {
  const fx = num(fxRmbHkd) || 0.85;
  (rows || []).forEach(row => {
    if (!hasFreeRmbPrice(row) && row.unit_price !== undefined && row.unit_price !== null && row.unit_price !== '') {
      row.unit_price_rmb = +(num(row.unit_price) * fx).toFixed(6);
    }
    if (hasFreeRmbPrice(row)) {
      row.unit_price = +(num(row.unit_price_rmb) / fx).toFixed(6);
    }
    ensureElecRmbPrices(row.children || [], fx);
  });
}

// 电子「含税核价 / 含利润价」逐行重算（与成本汇总 renderElecExtra 同一公式）
// 含税核价 = (零件成本 + 邦定 + 贴片 + 人工 + 测试 + 包装) ×(1+利润%) + 抵税差额 + 抵税差额×10%
function elecTaxedCore(parts, ex) {
  ex = ex || {};
  const partsRaw = sum(parts || [], p => num(p.qty) * num(p.unit_price)
    + sum(p.children || [], c => num(c.qty) * num(c.unit_price)));
  const cost = partsRaw + num(ex.bonding_cost) + num(ex.smt_cost) + num(ex.labor_cost)
    + num(ex.test_repair) + num(ex.packing_shipping);
  const profitPrice = cost * (1 + num(ex.profit_pct) / 100);
  const taxed = profitPrice + num(ex.tax_diff) + num(ex.tax_diff) * 0.1;
  return { profitPrice, taxed };
}

// 由细表汇总成 IC + PACB电子 两行：含税核价按各自在细表的占比分摊到两行，
// 合计 = 两行之和 = 含税核价；不含税 = 含税 ×(含利润价÷含税核价)。
function elecSplitRows(parts, ex, fx) {
  fx = num(fx) || 0.85;
  const { profitPrice, taxed } = elecTaxedCore(parts, ex);
  const detailTotal = sum(parts || [], p => num(p.qty) * num(p.unit_price)
    + sum(p.children || [], c => num(c.qty) * num(c.unit_price)));
  const icPart = (parts || []).find(p => /IC/i.test(p.name || ''));
  const icAmt = icPart ? num(icPart.qty) * num(icPart.unit_price) : 0;
  const icRatio = detailTotal > 0 ? icAmt / detailTotal : 0;
  const pretaxRatio = taxed > 0 ? profitPrice / taxed : 1;
  const mk = (taxedRMB) => ({
    unit_price_rmb: +taxedRMB.toFixed(6),
    unit_price: +(taxedRMB / fx).toFixed(6),
    _unit_price_taxed: +taxedRMB.toFixed(6),
    _unit_price_pretax: +(taxedRMB * pretaxRatio).toFixed(6),
  });
  return { icPart, ic: mk(taxed * icRatio), pacb: mk(taxed * (1 - icRatio)) };
}

function renderHierElectronics(container, rows, onChange, canEdit, fxRmbHkd) {
  const fx = num(fxRmbHkd) || 0.85;
  container.innerHTML = '';
  const table = document.createElement('table'); table.className = 'wb-table hier-table';
  table.innerHTML = `<thead><tr>
    <th style="width:30px"></th>
    <th style="width:40px">#</th>
    <th>零件名称</th>
    <th>规格</th>
    <th style="width:70px">用量</th>
    <th style="width:90px">单价 RMB</th>
    <th style="width:90px">单价 HKD</th>
    <th style="width:90px">金额 HKD</th>
    <th style="width:80px">税点 %</th>
    <th>备注</th>
    ${canEdit ? '<th style="width:36px"></th>' : ''}
  </tr></thead><tbody></tbody>`;
  const tbody = table.querySelector('tbody');
  if (!Array.isArray(rows)) rows = [];
  ensureElecRmbPrices(rows, fx);

  rows.forEach((row, idx) => {
    row.children = row.children || [];
    const hasChildren = row.children.length > 0;
    const tr = document.createElement('tr'); tr.className = 'hier-parent';

    // 展开 / 收起按钮
    const tdExp = document.createElement('td'); tdExp.className = 'ro';
    if (canEdit || hasChildren) {
      const btn = document.createElement('button'); btn.className = 'mini'; btn.textContent = row._open ? '▼' : '▶';
      btn.title = '展开/收起子明细'; btn.style.padding = '2px 6px';
      btn.onclick = () => { row._open = !row._open; renderHierElectronics(container, rows, onChange, canEdit, fxRmbHkd); };
      tdExp.appendChild(btn);
    }
    tr.appendChild(tdExp);

    // 序号
    const tdNo = document.createElement('td'); tdNo.className = 'ro'; tdNo.textContent = idx + 1; tr.appendChild(tdNo);

    // 名称 / 规格
    const cellTexts = ['name', 'spec'];
    cellTexts.forEach(k => {
      const td = document.createElement('td');
      if (canEdit) {
        const inp = document.createElement('input'); inp.type = 'text'; inp.value = row[k] ?? '';
        inp.oninput = () => { row[k] = inp.value; onChange(); }; td.appendChild(inp);
      } else { td.className = 'ro'; td.textContent = row[k] ?? ''; }
      tr.appendChild(td);
    });

    // 用量 / RMB 单价 / HKD 单价 / 金额
    const tdQty = document.createElement('td');
    const tdRmb = document.createElement('td');
    const tdHkd = document.createElement('td'); tdHkd.className = 'ro';
    const tdAmt = document.createElement('td'); tdAmt.className = 'ro';
    const refreshAmt = () => {
      const amt = elecRowAmount(row, fxRmbHkd);
      const upHkd = num(row.qty) > 0 ? amt / num(row.qty) : freeUnitHkd(row, fxRmbHkd);
      tdHkd.textContent = formatNum(upHkd);
      tdAmt.textContent = formatNum(amt);
    };
    if (canEdit && !hasChildren) {
      const inpQ = document.createElement('input'); inpQ.type = 'number'; inpQ.step = 'any'; inpQ.value = row.qty ?? '';
      inpQ.oninput = () => { row.qty = inpQ.value === '' ? null : Number(inpQ.value); refreshAmt(); onChange(); };
      tdQty.appendChild(inpQ);
      const inpP = document.createElement('input'); inpP.type = 'number'; inpP.step = 'any'; inpP.value = row.unit_price_rmb ?? '';
      inpP.oninput = () => {
        row.unit_price_rmb = inpP.value === '' ? null : Number(inpP.value);
        row.unit_price = hasFreeRmbPrice(row) ? +(num(row.unit_price_rmb) / fx).toFixed(6) : null;
        refreshAmt();
        onChange();
      };
      tdRmb.appendChild(inpP);
    } else {
      // 有子项时 用量/单价 由子项推导（用量保留，单价 = 金额 / 用量）
      tdQty.className = 'ro'; tdQty.textContent = formatNum(row.qty ?? '');
      const amt = elecRowAmount(row, fxRmbHkd);
      const up = num(row.qty) > 0 ? amt / num(row.qty) : amt;
      tdRmb.className = 'ro'; tdRmb.textContent = formatNum(up * fx);
      tdHkd.textContent = formatNum(up);
    }
    refreshAmt();
    tr.appendChild(tdQty); tr.appendChild(tdRmb); tr.appendChild(tdHkd); tr.appendChild(tdAmt);

    // 电子部总表：RMB 手填，HKD 按汇率自动换算。
    // 税点：含税 / 不含税 下拉（切换时 单价 HKD = 对应 RMB ÷ 汇率）
    const tdTax = document.createElement('td');
    const TAX_OPTS = ['含税', '不含税'];
    const taxVal = TAX_OPTS.includes(row.tax_label) ? row.tax_label : '含税';
    row.tax_label = taxVal;
    if (canEdit) {
      const sel = document.createElement('select');
      TAX_OPTS.forEach(o => {
        const op = document.createElement('option'); op.value = o; op.textContent = o;
        if (o === taxVal) op.selected = true;
        sel.appendChild(op);
      });
      sel.onchange = () => {
        row.tax_label = sel.value;
        const rmb = sel.value === '含税' ? row._unit_price_taxed : row._unit_price_pretax;
        if (rmb != null) {
          row.unit_price_rmb = +rmb.toFixed(6);
          row.unit_price = +(rmb / fx).toFixed(6);
        }
        onChange();
        renderHierElectronics(container, rows, onChange, canEdit, fxRmbHkd);
      };
      tdTax.appendChild(sel);
    } else { tdTax.className = 'ro'; tdTax.textContent = taxVal; }
    tr.appendChild(tdTax);

    // 备注（自由文本）
    const tdNote = document.createElement('td');
    if (canEdit) {
      const inp = document.createElement('input'); inp.type = 'text'; inp.value = row.note ?? '';
      inp.oninput = () => { row.note = inp.value; onChange(); };
      tdNote.appendChild(inp);
    } else { tdNote.className = 'ro'; tdNote.textContent = row.note ?? ''; }
    tr.appendChild(tdNote);

    // 删除
    if (canEdit) {
      const td = document.createElement('td');
      const b = document.createElement('button'); b.textContent = '×'; b.className = 'mini danger';
      b.onclick = () => { rows.splice(idx, 1); renderHierElectronics(container, rows, onChange, canEdit, fxRmbHkd); onChange(); };
      td.appendChild(b); tr.appendChild(td);
    }
    tbody.appendChild(tr);

    // 展开后渲染子项
    if (row._open) {
      const trChild = document.createElement('tr'); trChild.className = 'hier-child-row';
      const td = document.createElement('td'); td.colSpan = canEdit ? 11 : 10;
      td.appendChild(renderHierChildren(row.children, () => { refreshAmt(); onChange(); }, canEdit, fxRmbHkd));
      trChild.appendChild(td);
      tbody.appendChild(trChild);
    }
  });
  container.appendChild(table);

  if (canEdit) {
    const btn = document.createElement('button'); btn.className = 'mini'; btn.textContent = '+ 新增电子件';
    btn.style.marginTop = '8px';
    btn.onclick = () => { rows.push({ name: '', qty: 1, unit_price_rmb: 0, unit_price: 0, children: [] }); renderHierElectronics(container, rows, onChange, canEdit, fxRmbHkd); onChange(); };
    container.appendChild(btn);
  }
}

function renderHierChildren(children, onParentChange, canEdit, fxRmbHkd) {
  const fx = num(fxRmbHkd) || 0.85;
  ensureElecRmbPrices(children || [], fx);
  const wrap = document.createElement('div'); wrap.className = 'hier-children';
  function rebuild() {
    wrap.innerHTML = '';
    buildContent();
  }
  function buildContent() {
  const t = document.createElement('table'); t.className = 'wb-table';
  t.innerHTML = `<thead><tr>
    <th style="width:40px">#</th>
    <th>子项名称</th>
    <th>规格</th>
    <th style="width:70px">用量</th>
    <th style="width:90px">单价 RMB</th>
    <th style="width:90px">单价 HKD</th>
    <th style="width:90px">金额 HKD</th>
    <th>备注</th>
    ${canEdit ? '<th style="width:36px"></th>' : ''}
  </tr></thead><tbody></tbody>`;
  const tb = t.querySelector('tbody');
  children.forEach((c, ci) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="ro">${ci + 1}</td>`;
    const tdHkd = document.createElement('td'); tdHkd.className = 'ro';
    const tdAmt = document.createElement('td'); tdAmt.className = 'ro';
    const refresh = () => {
      tdHkd.textContent = formatNum(freeUnitHkd(c, fx));
      tdAmt.textContent = formatNum(num(c.qty) * freeUnitHkd(c, fx));
    };
    ['name', 'spec'].forEach(k => {
      const td = document.createElement('td');
      if (canEdit) { const i = document.createElement('input'); i.value = c[k] ?? ''; i.oninput = () => { c[k] = i.value; onParentChange(); }; td.appendChild(i); }
      else { td.className = 'ro'; td.textContent = c[k] ?? ''; }
      tr.appendChild(td);
    });
    const tdQ = document.createElement('td');
    if (canEdit) { const i = document.createElement('input'); i.type='number'; i.step='any'; i.value = c.qty ?? ''; i.oninput = () => { c.qty = i.value===''?null:Number(i.value); refresh(); onParentChange(); }; tdQ.appendChild(i); }
    else { tdQ.className='ro'; tdQ.textContent = formatNum(c.qty ?? ''); }
    const tdP = document.createElement('td');
    if (canEdit) {
      const i = document.createElement('input'); i.type='number'; i.step='any'; i.value = c.unit_price_rmb ?? '';
      i.oninput = () => {
        c.unit_price_rmb = i.value===''?null:Number(i.value);
        c.unit_price = hasFreeRmbPrice(c) ? +(num(c.unit_price_rmb) / fx).toFixed(6) : null;
        refresh();
        onParentChange();
      };
      tdP.appendChild(i);
    }
    else { tdP.className='ro'; tdP.textContent = formatNum(freeUnitRmb(c, fx)); }
    refresh();
    const tdN = document.createElement('td');
    if (canEdit) { const i = document.createElement('input'); i.value = c.note ?? ''; i.oninput = () => { c.note = i.value; onParentChange(); }; tdN.appendChild(i); }
    else { tdN.className='ro'; tdN.textContent = c.note ?? ''; }
    tr.appendChild(tdQ); tr.appendChild(tdP); tr.appendChild(tdHkd); tr.appendChild(tdAmt); tr.appendChild(tdN);
    if (canEdit) {
      const td = document.createElement('td');
      const b = document.createElement('button'); b.textContent='×'; b.className='mini danger';
      b.onclick = () => { children.splice(ci, 1); onParentChange(); rebuild(); };
      td.appendChild(b); tr.appendChild(td);
    }
    tb.appendChild(tr);
  });
  // 合计行
  const trTot = document.createElement('tr'); trTot.className = 'hi';
  trTot.innerHTML = `<td colspan="6" style="text-align:right">合计</td>
    <td>${formatNum(sum(children, c => num(c.qty) * freeUnitHkd(c, fx)))}</td><td></td>${canEdit?'<td></td>':''}`;
  tb.appendChild(trTot);
  wrap.appendChild(t);
  if (canEdit) {
    const btn = document.createElement('button'); btn.className='mini'; btn.textContent='+ 新增子项'; btn.style.marginTop='6px';
    btn.onclick = () => { children.push({ name:'', qty:1, unit_price_rmb:0, unit_price:0 }); rebuild(); onParentChange(); };
    wrap.appendChild(btn);
  }
  }
  buildContent();
  return wrap;
}

function renderElecExtra(host, payload, onChange, canEdit, fxRmbHkd) {
  const fx = num(fxRmbHkd) || 0.85;
  const x = payload.electronics_extra;
  // 默认初始化新字段
  ['bonding_cost', 'smt_cost', 'labor_cost'].forEach(k => { if (x[k] == null) x[k] = 0; });
  // 零件成本 优先用 细表（导入明细）；没有细表才回退用 总表
  const computePartsFromDoc = () => {
    const doc = payload.electronics_doc;
    if (!doc || !doc.parts || !doc.parts.length) return null;
    return sum(doc.parts, p => num(p.qty) * num(p.unit_price)
      + sum(p.children || [], c => num(c.qty) * num(c.unit_price)));
  };
  const partsRaw = computePartsFromDoc() ?? sum(payload.electronics || [], r => elecRowAmount(r, fxRmbHkd));
  const partsAfterLoss = partsRaw;  // 不计损耗
  const costBeforeTax = partsAfterLoss + num(x.bonding_cost) + num(x.smt_cost) + num(x.labor_cost)
    + num(x.test_repair) + num(x.packing_shipping); // 成本合计(不含税)
  const profitPrice = costBeforeTax * (1 + num(x.profit_pct)/100); // 含利润价
  const taxPayableAuto = num(x.tax_diff) * 0.1; // 应交税负 = 抵税差额 × 10%
  x.tax_payable = taxPayableAuto;
  const taxed = profitPrice + num(x.tax_diff) + taxPayableAuto; // 含税核价
  host.innerHTML = `
    <div class="card" style="background:#f9fafb;margin-top:12px">
      <h3 style="margin-top:0">电子 成本汇总（RMB）</h3>
      <div class="wb-grid2">
        <label><span>零件成本</span><input value="${formatNum(partsAfterLoss)}" disabled></label>
        <label><span>邦定成本</span><input id="elx-bond" type="number" step="any" value="${x.bonding_cost}" ${canEdit?'':'disabled'}></label>
        <label><span>贴片成本</span><input id="elx-smt" type="number" step="any" value="${x.smt_cost}" ${canEdit?'':'disabled'}></label>
        <label><span>人工成本</span><input id="elx-labor" type="number" step="any" value="${x.labor_cost}" ${canEdit?'':'disabled'}></label>
        <label><span>测试费用</span><input id="elx-test" type="number" step="any" value="${x.test_repair}" ${canEdit?'':'disabled'}></label>
        <label><span>包装运输</span><input id="elx-pack" type="number" step="any" value="${x.packing_shipping}" ${canEdit?'':'disabled'}></label>
        <label><span><b>成本合计（不含税）</b></span><input value="${formatNum(costBeforeTax)}" disabled style="font-weight:600;background:#fef3c7"></label>
        <label><span>利润 %</span><input id="elx-profit" type="number" step="any" value="${x.profit_pct}" ${canEdit?'':'disabled'}></label>
        <label><span><b>含利润价</b></span><input value="${formatNum(profitPrice)}" disabled style="font-weight:600;background:#fef3c7"></label>
        <label><span></span></label>
        <label><span>抵税差额</span><input id="elx-taxdiff" type="number" step="any" value="${x.tax_diff}" ${canEdit?'':'disabled'}></label>
        <label><span>应交税负 <small class="muted">= 抵税差额 × 10%</small></span><input id="elx-taxpay" value="${formatNum(x.tax_payable)}" disabled></label>
        <label><span><b>含税核价 RMB</b></span><input value="${formatNum(taxed)}" disabled style="font-weight:700;background:#dcfce7;color:#166534"></label>
        <label><span><b>含税核价 HKD</b></span><input value="${formatNum(taxed / fx)} (汇率 ${fx})" disabled style="font-weight:700;background:#dcfce7;color:#166534"></label>
      </div>
    </div>`;
  // 引用所有只读结果字段，输入时局部刷新（不重建整块，避免输入框失焦）
  const inputs = host.querySelectorAll('.wb-grid2 input[disabled]');
  // 顺序对应 grid 中的 6 个 disabled input：成本合计(零件+人工)、成本合计(不含税)、含利润价、含税核价 RMB、含税核价 HKD
  // 直接按 DOM 顺序索引：0=零件+人工 1=不含税 2=含利润 3=含税RMB 4=含税HKD
  function refreshComputed() {
    const partsRaw2 = computePartsFromDoc() ?? sum(payload.electronics || [], r => elecRowAmount(r, fxRmbHkd));
    const partsLoss2 = partsRaw2;  // 不计损耗
    const cost2 = partsLoss2 + num(x.bonding_cost) + num(x.smt_cost) + num(x.labor_cost)
      + num(x.test_repair) + num(x.packing_shipping);
    const profit2 = cost2 * (1 + num(x.profit_pct)/100);
    x.tax_payable = num(x.tax_diff) * 0.1;
    const taxed2 = profit2 + num(x.tax_diff) + x.tax_payable;
    inputs[0].value = formatNum(partsLoss2);  // 零件成本
    inputs[1].value = formatNum(cost2);       // 不含税
    inputs[2].value = formatNum(profit2);     // 含利润价
    inputs[3].value = formatNum(x.tax_payable); // 应交税负 (auto)
    inputs[4].value = formatNum(taxed2);      // 含税核价 RMB
    inputs[5].value = `${formatNum(taxed2 / fx)} (汇率 ${fx})`;
  }
  if (canEdit) {
    const bind = (id, key) => { host.querySelector(id).oninput = (e) => { x[key] = e.target.value === '' ? null : Number(e.target.value); refreshComputed(); onChange(); }; };
    bind('#elx-bond', 'bonding_cost');
    bind('#elx-smt', 'smt_cost');
    bind('#elx-labor', 'labor_cost');
    bind('#elx-test', 'test_repair');
    bind('#elx-pack', 'packing_shipping');
    bind('#elx-profit', 'profit_pct');
    bind('#elx-taxdiff', 'tax_diff');
  }
}

// 通用：小计/损耗/合计 紧凑竖排（返回 refresh fn）
function renderLossSummary(host, title, getRawSum, getLossPct, fxRmbHkd, currency) {
  const fx = num(fxRmbHkd) || 0.85;
  const isHkd = currency === 'HKD';
  const card = document.createElement('div'); card.className = 'loss-summary';
  host.appendChild(card);
  function paint() {
    const raw = typeof getRawSum === 'function' ? getRawSum() : num(getRawSum);
    const loss = typeof getLossPct === 'function' ? getLossPct() : num(getLossPct);
    const total = raw * (1 + loss/100);
    const primary = isHkd
      ? `<div class="ls-row hi"><span class="ls-label">合计 HKD</span><span class="ls-val">${formatNum(total)}</span></div>`
      : `<div class="ls-row hi"><span class="ls-label">合计 RMB</span><span class="ls-val">${formatNum(total)}</span></div>
         <div class="ls-row hi"><span class="ls-label">合计 HKD</span><span class="ls-val">${formatNum(total / fx)} <small class="muted">(汇率 ${fx})</small></span></div>`;
    card.innerHTML = `
      ${title ? `<div class="ls-title">${title}</div>` : ''}
      <div class="ls-row"><span class="ls-label">小计</span><span class="ls-val">${formatNum(raw)}</span></div>
      ${loss ? `<div class="ls-row"><span class="ls-label">损耗</span><span class="ls-val">${loss.toFixed(2)}%</span></div>` : ''}
      ${primary}`;
  }
  paint();
  return paint;
}

function renderHwExtra(host, payload, onChange, canEdit, fxRmbHkd) {
  host.innerHTML = '';
  return renderLossSummary(host, '五金 成本汇总',
    () => sum(payload.hardware || [], r => freeAmountHkd(r, fxRmbHkd)),
    () => 0, fxRmbHkd, 'HKD');  // 五金不计损耗；五金表为港币
}

// ==================== 部门工作台 ====================
function renderMoldCosts(host, mc, onChange, canEdit) {
  function paint() {
    const sumRmb = sum(mc.items, r => num(r.price_rmb));
    const fx = num(mc.fx_rmb_usd) || 7.75;
    const sumUsd = sumRmb / fx;
    const customerUsd = num(mc.customer_subsidy_usd);
    const netUsd = sumUsd - customerUsd;
    const qty = Math.max(num(mc.amortization_qty), 1);
    const prototypeFeeUsd = num(mc.prototype_fee_usd ?? mc.prototype_fee_rmb);
    const testingFeeUsd = num(mc.testing_fee_usd ?? mc.testing_fee_rmb);
    const prototypeQty = Math.max(num(mc.prototype_amortization_qty) || 50000, 1);
    const testingQty = Math.max(num(mc.testing_amortization_qty) || 2000, 1);
    const perPcsRmb = sumRmb / qty;
    const perPcsUsd = netUsd / qty;
    const prototypePerPcsUsd = prototypeFeeUsd / prototypeQty;
    const testingPerPcsUsd = testingFeeUsd / testingQty;
    const prototypePerPcsRmb = prototypePerPcsUsd * fx;
    const testingPerPcsRmb = testingPerPcsUsd * fx;

    host.innerHTML = `
      <table class="wb-table" style="max-width:680px">
        <thead><tr>
          <th style="width:200px">模具名称</th>
          <th style="width:140px">模价 (RMB)</th>
          <th style="width:140px">模价 (USD)</th>
          ${canEdit ? '<th style="width:36px"></th>' : ''}
        </tr></thead>
        <tbody>
          ${mc.items.map((r, i) => `
            <tr>
              <td>${canEdit ? `<input class="mc-name" data-i="${i}" value="${r.name || ''}">` : (r.name || '')}</td>
              <td>${canEdit ? `<input class="mc-rmb" data-i="${i}" type="number" step="any" value="${r.price_rmb ?? 0}">` : formatNum(num(r.price_rmb))}</td>
              <td class="ro">${formatNum(num(r.price_rmb) / fx)}</td>
              ${canEdit ? `<td><button class="mini danger mc-del" data-i="${i}">×</button></td>` : ''}
            </tr>`).join('')}
          <tr class="hi"><td>模具总计</td><td>${formatNum(sumRmb)}</td><td>${formatNum(sumUsd)}</td>${canEdit ? '<td></td>' : ''}</tr>
          <tr><td>客补贴模费美金</td><td></td><td>${canEdit ? `<input id="mc-sub" type="number" step="any" value="${mc.customer_subsidy_usd ?? 0}">` : formatNum(customerUsd)}</td>${canEdit ? '<td></td>' : ''}</tr>
          <tr class="hi"><td>模费按 <input id="mc-qty" type="number" step="any" value="${mc.amortization_qty}" style="width:90px" ${canEdit?'':'disabled'}> 套产品分摊</td><td>${formatNum(perPcsRmb)}</td><td>${formatNum((sumUsd - customerUsd) / qty)}</td>${canEdit ? '<td></td>' : ''}</tr>
          <tr><td>手板费按 ${canEdit ? `<input id="mc-prototype-qty" type="number" step="any" min="1" value="${prototypeQty}" style="width:90px">` : formatNum(prototypeQty)} 套分摊（总额 USD ${canEdit ? `<input id="mc-prototype" type="number" step="any" value="${prototypeFeeUsd}" style="width:90px">` : formatNum(prototypeFeeUsd)}）</td><td>${formatNum(prototypePerPcsRmb)}</td><td>${formatNum(prototypePerPcsUsd)}</td>${canEdit ? '<td></td>' : ''}</tr>
          <tr><td>测试费按 ${canEdit ? `<input id="mc-testing-qty" type="number" step="any" min="1" value="${testingQty}" style="width:90px">` : formatNum(testingQty)} 套分摊（总额 USD ${canEdit ? `<input id="mc-testing" type="number" step="any" value="${testingFeeUsd}" style="width:90px">` : formatNum(testingFeeUsd)}）</td><td>${formatNum(testingPerPcsRmb)}</td><td>${formatNum(testingPerPcsUsd)}</td>${canEdit ? '<td></td>' : ''}</tr>
        </tbody>
      </table>
      ${canEdit ? `<div style="margin-top:8px;display:flex;gap:10px;align-items:center">
        <button class="mini" id="mc-add">+ 增加费用行</button>
        <label style="font-size:13px;color:#6b7280">RMB→USD 汇率 <input id="mc-fx" type="number" step="any" value="${mc.fx_rmb_usd}" style="width:80px"></label>
      </div>` : ''}
    `;

    if (!canEdit) return;
    host.querySelectorAll('.mc-name').forEach(el => el.oninput = () => { mc.items[+el.dataset.i].name = el.value; onChange(); });
    host.querySelectorAll('.mc-rmb').forEach(el => {
      el.oninput = () => { mc.items[+el.dataset.i].price_rmb = el.value === '' ? null : Number(el.value); onChange(); };
      el.onblur = () => paint();
    });
    host.querySelectorAll('.mc-del').forEach(el => el.onclick = () => { mc.items.splice(+el.dataset.i, 1); onChange(); paint(); });
    host.querySelector('#mc-sub').oninput = (e) => { mc.customer_subsidy_usd = num(e.target.value); onChange(); };
    host.querySelector('#mc-sub').onblur = () => paint();
    host.querySelector('#mc-qty').oninput = (e) => { mc.amortization_qty = num(e.target.value); onChange(); };
    host.querySelector('#mc-qty').onblur = () => paint();
    host.querySelector('#mc-prototype').oninput = (e) => { mc.prototype_fee_usd = num(e.target.value); onChange(); };
    host.querySelector('#mc-prototype').onblur = () => paint();
    host.querySelector('#mc-prototype-qty').oninput = (e) => { mc.prototype_amortization_qty = Math.max(num(e.target.value), 1); onChange(); };
    host.querySelector('#mc-prototype-qty').onblur = () => paint();
    host.querySelector('#mc-testing').oninput = (e) => { mc.testing_fee_usd = num(e.target.value); onChange(); };
    host.querySelector('#mc-testing').onblur = () => paint();
    host.querySelector('#mc-testing-qty').oninput = (e) => { mc.testing_amortization_qty = Math.max(num(e.target.value), 1); onChange(); };
    host.querySelector('#mc-testing-qty').onblur = () => paint();
    host.querySelector('#mc-fx').oninput = (e) => { mc.fx_rmb_usd = num(e.target.value); onChange(); };
    host.querySelector('#mc-fx').onblur = () => paint();
    host.querySelector('#mc-add').onclick = () => { mc.items.push({ name: '', price_rmb: 0 }); onChange(); paint(); };
  }
  paint();
}

// ============== 汇总面板 ==============
function renderSummaryPane(host, sections, quote, me) {
  const get = (dept) => {
    const s = sections.find(x => x.dept === dept);
    return s && s.payload_json ? JSON.parse(s.payload_json) : {};
  };
  const eng = get('engineering');
  const mold = get('molding');
  const pnt = get('painting');
  const asm = get('assembly');
  const sales = get('sales');
  const slush = get('slush');
  const sewing = get('sewing');
  const electronic = get('electronic');
  const fxRH = num(sales.header?.fx_rmb_hkd) || 0.85;
  const fxHU = num(sales.header?.fx_hkd_usd) || 7.8;

  // 电子明细：优先用「电子部」section，回退工程部（与导出一致）
  const elecSrc = (electronic.electronics && electronic.electronics.length) ? electronic.electronics : (eng.electronics || []);

  // 各部门关键合计
  const moldTotal = sum(eng.molds || [], m => num(m.price_rmb));
  const elecRaw = sum(elecSrc, r => elecRowAmount(r, fxRH));  // 不算损耗（与导出同源：电子部优先）
  const hwRaw = sum(eng.hardware || [], r => freeAmountHkd(r, fxRH));  // 五金不计损耗（与导出一致）
  const auxRaw = sum(eng.aux_materials || [], r => freeAmountHkd(r, fxRH));  // 不计损耗
  const pkmatRaw = sum(eng.packaging_materials || [], r => freeAmountHkd(r, fxRH));  // 不计损耗
  const _injLossM = 1 + num(mold.injection_loss_pct ?? 3) / 100;  // 注塑料损耗（默认3%）
  const injTotal = sum(mold.injection || [], r => num(r.weight_g) * _injLossM * num(r.material_unit_price) + num(r.shot_price));
  const injRaw = injTotal / _injLossM; // 留作兼容（部分老逻辑可能引用）
  const blowTotal = sum(mold.blow_items || [], r => {
    const mat = num(r.weight_g)*num(r.material_price_lb)/454;
    return (mat + num(r.blow_labor) + num(r.flash)) * (num(r.profit_x) || 1);
  });
  const ppTotal = sum(pnt.painting_items || [], paintingRowAmount);  // 不计损耗（含八工序）
  const slushTotal = sum(slush.slush_items || [], r => num(r.unit_price_hkd)*num(r.qty));
  const asmLaborTotal = sum(asm.assembly_labor || [], r => num(r.unit_price)*num(r.qty));
  const pkLaborTotal = sum(asm.packaging_labor || [], r => num(r.unit_price)*num(r.qty));
  // 新版 排拉工序 组装 + 包装 — 每组合计 = 基数 × 人数 ÷ 该组生产量
  const _asmBase = num(asm.assembly_base_rate ?? 310);
  const stepGroupTotal = (groups) => sum(groups || [], g =>
    sum(g.steps || [], s => _asmBase * num(s.count) * (num(g.team ?? 1) || 1) / Math.max(num(g.qty), 1)));
  const asmStepTotal = stepGroupTotal(asm.assembly_step_groups);
  const pkgStepTotal = stepGroupTotal(asm.packaging_step_groups);
  const combinedAsmHkd = asmLaborTotal + pkLaborTotal + asmStepTotal + pkgStepTotal;  // 装配人工为港币(基数310 HKD)

  const rows = [
    { label: '工程 — 模具总价', rmb: moldTotal, unit: '套数总和' },
    { label: '工程 — 电子', rmb: elecRaw, unit: '不计损耗' },
    { label: '工程 — 五金', rmb: hwRaw, unit: '不计损耗' },
    { label: '工程 — 辅助材料', rmb: auxRaw, unit: '不计损耗' },
    { label: '工程 — 包装材料', rmb: pkmatRaw, unit: '不计损耗' },
    { label: '啤机 — 注塑合计', hkd: injTotal, unit: 'HK$/PCS' },
    { label: '啤机 — 吹气合计', hkd: blowTotal, unit: 'HK$/PCS' },
    { label: '喷油 — 二次加工', rmb: ppTotal, unit: '不计损耗' },
    { label: '搪胶合计', hkd: slushTotal, unit: 'HK$' },
    { label: '装配 — 组装人工', rmb: asmLaborTotal, unit: '元/PCS' },
    { label: '装配 — 包装人工', rmb: pkLaborTotal, unit: '元/PCS' },
  ];

  // 九、合计 数据
  const pricing = sales.pricing || {};
  // 运输费 = 减税明细 顶部手填的 印尼运费 (HKD) — 注意 toHkd 会再除一次汇率，所以这里存成 RMB 等价
  const shipping = num(sales.pricing_summary?.indo_freight) * fxRH;
  const hwTotal = hwRaw;
  const electronicTotal = elecRaw;
  // 注塑是 HKD，先换算 RMB（其他都是 RMB）
  const injTotalRmb = injTotal * fxRH;
  // 模具分摊：从工程"模具费用"表取 套产品分摊 (sum(items.price_rmb) / amortization_qty)
  const mc = eng.mold_costs || {};
  const moldCostSumRmb = sum(mc.items || [], r => num(r.price_rmb));
  const moldAmortQty = Math.max(num(mc.amortization_qty) || num(pricing.mold_amortization_qty) || num(quote.qty), 1);
  const moldFx = num(mc.fx_rmb_usd) || 7.75;
  const prototypeShareUsd = num(mc.prototype_fee_usd ?? mc.prototype_fee_rmb) / Math.max(num(mc.prototype_amortization_qty) || 50000, 1);
  const testingShareUsd = num(mc.testing_fee_usd ?? mc.testing_fee_rmb) / Math.max(num(mc.testing_amortization_qty) || 2000, 1);
  const moldShare = moldCostSumRmb / moldAmortQty + (prototypeShareUsd + testingShareUsd) * moldFx;
  // 模费按 RMB 计算；手板费和测试费直接按 USD 总额分摊。
  const moldFeeShareUsd = (moldCostSumRmb / moldFx - num(mc.customer_subsidy_usd)) / moldAmortQty;
  const slushTotalRmb = slushTotal * fxRH;
  const sewingGroupAmount = (g) => sum(g.items || [], r => num(r.usage) * num(r.mat_price) * (num(r.markup) || 1)) + sewLaborToAdd(g);
  const sewingTotalRmb = sum(sewing.sewing_groups || [], sewingGroupAmount);  // 不再乘损耗，与 UI 配套合计 一致
  // 按 category 分车衣/车发
  const sewingHairRmb = sum((sewing.sewing_groups || []).filter(g => g.category === '车发'), sewingGroupAmount);
  const sewingClothRmb = sewingTotalRmb - sewingHairRmb;
  // 多纸箱 + 多平卡：Σ((箱价i + Σ平卡价i_j) / qty_i) × 汇率
  const ccc = eng.carton_calc || {};
  const cartonList = (ccc.cartons && ccc.cartons.length) ? ccc.cartons : (ccc.cl ? [{
    cl: ccc.cl, cw: ccc.cw, ch: ccc.ch, qty: ccc.qty,
    flat_cards: ccc.flat_card ? [{ l: ccc.cl, w: ccc.cw }] : [],
  }] : []);
  const cartonRate = num(ccc.paper_rate) || 2.75;
  const cartonRmb = cartonList.reduce((s, b) => {
    const boxPrice = (num(b.cl) + num(b.cw) + 2) * (num(b.cw) + num(b.ch) + 1) * 2 * cartonRate / 1000;
    const flatSum = (b.flat_cards || []).reduce((a, f) => a + ((num(f.l) || num(b.cl)) + 1) * ((num(f.w) || num(b.cw)) + 1) * 2 / 1000, 0);
    const q = Math.max(num(b.qty), 1);
    return s + (boxPrice + flatSum) / q;
  }, 0) * fxRH;

  // 附加税：用户手填，存到 sales.pricing_summary.surtax
  sales.pricing_summary = sales.pricing_summary || {};
  const surtaxManual = num(sales.pricing_summary.surtax);

  // cost 包含搪胶/车缝/纸箱；附加税 + 模具分摊 在 markup 外面单独加
  const blowRmb = blowTotal * fxRH;
  // 电子/五金/辅助/包装 四表均为港币(HKD)，换算回 RMB 加入成本：×汇率
  // 电子/五金/辅助/包装/二次加工(喷油) 均为港币(HKD)，换算回 RMB：×汇率
  const cost = injTotalRmb + blowRmb + (electronicTotal + hwTotal + auxRaw + pkmatRaw + ppTotal + combinedAsmHkd) * fxRH + shipping + slushTotalRmb + sewingTotalRmb + cartonRmb;  // 装配人工(排拉合计)也是港币，×汇率还原 RMB
  // 出厂价底价：cost × markups（不含附加税 + 模具分摊）
  const factoryRmb = cost;
  // 注：出厂价(HKD) 改为「成本各列求和」factoryHkdSum（见下方 costCols），不再用 factoryRmb/fxRH 以免舍入差
  // 出货底价：含附加税 + 模具分摊（盐田40柜/5吨车的底价）
  const priceRmb = factoryRmb + moldShare + surtaxManual;
  const priceHkd = priceRmb / fxRH;
  // 九、合计 整行换成 HKD（RMB ÷ 汇率）
  const fxH = fxRH || 0.85;
  const toHkd = (rmb) => num(rmb) / fxH;
  const markupX = (sales.shipping?.markup_x == null) ? 1.2 : num(sales.shipping.markup_x);  // 允许 0；仅空/未设时默认 1.2
  // 成本明细列（HKD）— 出厂价 = 这些列之和（严格等于展示值，避免与 RMB 总额换算的舍入差）
  const costCols = [
    ['注塑+吹气', toHkd(injTotalRmb + blowTotal * fxRH)], ['二次加工', ppTotal], ['电子五金', electronicTotal + hwTotal],
    ['辅助材料', auxRaw], ['包装材料', pkmatRaw], ['组装人工', asmLaborTotal + asmStepTotal], ['包装/混装人工', pkLaborTotal + pkgStepTotal],
    ['印尼运费', toHkd(shipping)],
    ['搪胶', toHkd(slushTotalRmb)], ['车缝', toHkd(sewingTotalRmb)], ['纸箱', toHkd(cartonRmb)],
  ];
  const factoryHkdSum = costCols.reduce((s, c) => s + num(c[1]), 0);  // 出厂价 = 前面所有成本列求和
  const afterMarkupHkd = factoryHkdSum * markupX;
  // 出货底价 = 出厂价（HKD）+ 附加税；码点(×markup)不在此处，移到下方「出货价算价」乘一次；模具分摊也在算价处理
  const priceHkdMarked = factoryHkdSum + toHkd(surtaxManual);
  const totalsCols = [
    ...costCols,
    ['附加税0.4%', surtaxManual, 'input'],
    ['出货底价 HKD', priceHkdMarked, 'hkd'],
  ];

  host.innerHTML = `
    <h2>📊 九、合计（自动汇总）</h2>
    <div style="overflow-x:auto;margin-bottom:20px">
      <table class="wb-table" style="font-size:12px">
        <thead><tr>${totalsCols.map(([h]) => `<th style="background:#F0DBA1;color:#1F2937;font-weight:600;padding:6px 8px;white-space:nowrap">${h}</th>`).join('')}</tr></thead>
        <tbody><tr>${totalsCols.map(([_, v, level]) => {
          if (level === 'input') {
            return `<td style="background:#FDF8E7;padding:4px;text-align:right;white-space:nowrap"><input id="tot-surtax" type="number" step="any" value="${v ?? ''}" style="width:80px;text-align:right;border:1px solid #d1c89f;background:#fff;padding:2px 4px;font-weight:600"/></td>`;
          }
          const palette = {
            sub:      '#FEF9C3',   // 出厂价 RMB
            'sub-hkd':'#FEF3C7',   // 出厂价 HKD
            total:    '#F0DBA1',   // 出货底价 RMB
            hkd:      '#F0DBA1',   // 出货底价 HKD
          };
          const bg = palette[level] || '#FDF8E7';
          // 码点 = 倍数（无货币符号）；其他 HKD
          if (level === 'mult') {
            return `<td style="background:#FEF9C3;padding:4px;text-align:right;white-space:nowrap">× <input id="tot-markup" type="number" step="any" value="${v ?? 1.2}" style="width:60px;text-align:right;border:1px solid #d1c89f;background:#fff;padding:2px 4px;font-weight:700"/></td>`;
          }
          return `<td style="background:${bg};font-weight:${level?'700':'600'};padding:6px 8px;text-align:right;white-space:nowrap">HK$${formatNum(v)}</td>`;
        }).join('')}</tr></tbody>
      </table>
    </div>
    <h2 style="margin-top:24px">🚚 出货价算价</h2>
    <div id="wb-shipping-sum"></div>
    <div id="tax-deduction-block" style="margin-top:24px"></div>`;
  // 出货价算价（来自业务 section）
  const salesSec = sections.find(x => x.dept === 'sales');
  const salesHeader = sales.header || {};
  sales.shipping = sales.shipping || {
    // 新单默认场景：盐田40柜 / 盐田5吨车（渲染时会在最前自动补"出厂价"）
    scenarios: [
      { name: '盐田40柜', base_rmb: 0, mold_share_rmb: 0 },
      { name: '盐田5吨车', base_rmb: 0, mold_share_rmb: 0 },
    ],
    freight_pct: 48, lifting_pct: 52, markup_x: 1.2, divisor: 0.98, target_usd: 0,
  };
  const engPayloadSum = sections.find(s => s.dept === 'engineering');
  const engPayloadObj = engPayloadSum && engPayloadSum.payload_json ? JSON.parse(engPayloadSum.payload_json) : {};
  const eCartonSum = engPayloadObj.carton_calc || {};
  sales.freight_calc = sales.freight_calc || {
    cap_10t: 1166, cap_5t: 750, cap_40: 1980, cap_20: 883,
    hk40: 8000, hk20: 7100, yt40: 7200, yt20: 6000,
    hk10t: 14900, yt10t: 11500, hk5t: 12500, yt5t: 11000,
  };
  const freightCalcSum = sales.freight_calc;
  const freightMapSum = computeFreightMap(freightCalcSum, eCartonSum);
  const canEditShip = me?.dept === 'sales' || me?.dept === 'engineering';
  // 九、合计 中的 附加税 + 模具分摊 (都已是 RMB，转 HKD)
  const surtaxHkd = num(surtaxManual) / fxRH;
  // 模具分摊传美金（与「生产模具费用」表同口径），出货价算价直接在 USD 层加
  // 统一保存业务 section（同步本地缓存，避免重渲染按旧 payload 还原）
  const saveSales = () => {
    if (canEditShip && salesSec) {
      salesSec.payload_json = JSON.stringify(sales);
      putSection(salesSec, sales, false).catch(() => {});
    }
  };
  renderShipping(host.querySelector('#wb-shipping-sum'), sales, salesHeader, canEditShip, saveSales,
    freightMapSum, factoryHkdSum, surtaxHkd, {
      mold: moldFeeShareUsd,
      prototype: prototypeShareUsd,
      testing: testingShareUsd,
    });
  const surtaxInp = host.querySelector('#tot-surtax');
  if (surtaxInp && canEditShip) {
    surtaxInp.oninput = () => { sales.pricing_summary.surtax = surtaxInp.value === '' ? null : Number(surtaxInp.value); };
    surtaxInp.onchange = () => { saveSales(); renderSummaryPane(host, sections, quote, me); };  // 失焦持久化 + 刷新显示
  } else if (surtaxInp) {
    surtaxInp.disabled = true;
  }
  // 码点 可编辑（业务/工程）
  const markupInp = host.querySelector('#tot-markup');
  if (markupInp && canEditShip) {
    markupInp.oninput = () => { sales.shipping = sales.shipping || {}; sales.shipping.markup_x = markupInp.value === '' ? null : Number(markupInp.value); };  // 允许 0；空才回退默认
    markupInp.onchange = () => { saveSales(); renderSummaryPane(host, sections, quote, me); };  // 失焦持久化+刷新(避免每键重渲染丢焦/录错)
  } else if (markupInp) {
    markupInp.disabled = true;
  }
  const taxHost = host.querySelector('#tax-deduction-block');
  // 注塑料按材质分进/国内料：POM / PVC = 国内料；其他 = 进口料 — 全部 HKD
  const injLossM = 1 + num(mold.injection_loss_pct ?? 3) / 100;  // 注塑料损耗（默认3%）
  let domesticMatHkd = 0, importMatHkd = 0;
  (mold.injection || []).forEach(r => {
    const rawUnitHkd = num(r.weight_g) * injLossM * num(r.material_unit_price);  // 原料单价 HK$
    const mat = String(r.material || '').toUpperCase().trim();
    if (/^(POM|PVC|C[- ]?PVC)/i.test(mat)) domesticMatHkd += rawUnitHkd;
    else if (mat) importMatHkd += rawUnitHkd;
  });

  // 分类关键字（用于无显式类别时兜底）
  const _isBat = (s) => /电池|battery/i.test(String(s || ''));
  const _isLib = (s) => /利宝|贴纸|libao|sticker/i.test(String(s || ''));
  const _isColorBoxLib = (r) => /彩盒|彩卡|内咭|内卡|背卡|包装|package|box/i.test(String((r.name || '') + ' ' + (r.spec || '')));
  const _isPlate = (s) => /电镀|plating/i.test(String(s || ''));
  const _isCarton = (s) => /纸箱|carton/i.test(String(s || ''));
  // 马达：电子/五金里含 "马达" / "motor" 的行（电子/五金表不设类别下拉，仍按关键字）
  const isMotor = (s) => /马达|motor/i.test(String(s || ''));
  const isBlister = (s) => /吸塑|blister/i.test(String(s || ''));
  const isGlueBag = (s) => /胶袋|胶代|poly\s?bag|pe\s?bag|opp\s?bag/i.test(String(s || ''));
  const _sumByMatch = (rows, matchFn) => sum(rows || [], r =>
    (matchFn(r.name) || matchFn(r.spec)) ? freeAmountHkd(r, fxRH) : 0);
  // 马达：电子部分用 elecSrc（电子部优先），与导出同源
  const motorRmb = _sumByMatch(elecSrc, isMotor) + _sumByMatch(eng.hardware, isMotor);

  // 二、包装/外购：按行的显式「类别」统计，无类别时按关键字兜底
  const pkmatRows = eng.packaging_materials || [];
  const auxRows = eng.aux_materials || [];
  // tbl='aux'|'pk'：返回行所属类别（合法 MAT_CATEGORIES 之一），纸箱返回 null（单独计），否则按表默认兜底
  const _catOf = (r, tbl) => {
    if (r.category && MAT_CATEGORIES.includes(r.category)) return r.category;
    if (r.category === '利宝') return '产品利宝';
    const a = r.name, b = r.spec;
    if (isBlister(a) || isBlister(b)) return '吸塑';
    if (isGlueBag(a) || isGlueBag(b)) return '胶袋';
    if (_isBat(a) || _isBat(b)) return '电池';
    if (_isLib(a) || _isLib(b)) return _isColorBoxLib(r) ? '彩盒利宝' : '产品利宝';
    if (_isPlate(a) || _isPlate(b)) return '电镀';
    if (_isCarton(a) || _isCarton(b)) return null;  // 纸箱另算
    return tbl === 'aux' ? '其他外购' : '彩盒/内咭';
  };
  const _amt = (r) => freeAmountHkd(r, fxRH);
  const _catSum = (cat) => sum(pkmatRows.filter(r => _catOf(r, 'pk') === cat), _amt)
    + sum(auxRows.filter(r => _catOf(r, 'aux') === cat), _amt);
  // 吸塑：辅助/包装按类别 + 电子/五金里关键字命中的吸塑行
  const blisterRmb = _catSum('吸塑') + _sumByMatch(elecSrc, isBlister) + _sumByMatch(eng.hardware, isBlister);
  const glueBagRmb = _catSum('胶袋');
  const batteryRmb = _catSum('电池');
  const libaoRmb = _catSum('产品利宝') + _catSum('彩盒利宝');
  const platingRmb = _catSum('电镀');
  const colorBoxRmb = _catSum('彩盒/内咭');
  const otherBuyRmb = _catSum('其他外购');

  // 自动从各部门拉取的金额 — 全部 HKD（一、出厂货价核）
  const autoFill = {
    imp_mat: importMatHkd,                   // 进口料 HKD
    dom_mat: domesticMatHkd,                 // 国内料 HKD
    blow: blowTotal,                         // 吹气 HKD
    slush: slushTotal,                       // 搪胶 HKD
    sewing_hair: sewingHairRmb / fxRH,       // 车发 HKD
    sewing_cloth: sewingClothRmb / fxRH,     // 车衣 HKD
    motor: motorRmb,                         // 马达 HKD（电子/五金已 HKD，不除汇率）
    suction: blisterRmb,                     // 吸塑 HKD（包装已 HKD）
    glue_bag: glueBagRmb,                    // 胶袋 HKD（辅助/包装已 HKD）
    code_before: markupX,                    // 未减税前码数 = 九、合计 码点
    color_box: colorBoxRmb,                  // 彩盒/内咭/内卡 HKD（包装已 HKD）
    other_buy: otherBuyRmb,                  // 其他外购 = 辅助材料剩余 HKD（辅助已 HKD）
    battery: batteryRmb,                     // 电池 HKD（包装已 HKD）
    libao: libaoRmb,                         // 利宝 HKD（辅助已 HKD）
    plating: platingRmb,                     // 电镀 HKD（包装已 HKD）
    carton: toHkd(cartonRmb),                // 纸箱 HKD（来自工程纸箱计算）
    // 运费 / 吊柜费 → 盐田40柜 场景对应值（HKD）
    freight: (() => {
      const yt40 = (sales.shipping?.scenarios || []).find(x => /盐田.*40/i.test(x.name || ''));
      if (!yt40) return 0;
      const rate = num(yt40._freight_rate);
      return rate * num(sales.shipping?.freight_pct ?? 48) / 100;
    })(),
    cabinet: (() => {
      const yt40 = (sales.shipping?.scenarios || []).find(x => /盐田.*40/i.test(x.name || ''));
      if (!yt40) return 0;
      const rate = num(yt40._freight_rate);
      return rate * num(sales.shipping?.lifting_pct ?? 52) / 100;
    })(),
    // 杂项 = 印尼运费(手填 HKD) + 附加税 HKD
    misc: num(sales.pricing_summary?.indo_freight) + surtaxHkd,
    surtax_hkd: surtaxHkd,  // 供减税明细里印尼运费输入框重算 misc 用（避免丢附加税）
    hardware: (hwRaw - _sumByMatch(eng.hardware, isMotor)),  // 五金 HKD（剔除马达项；五金表已 HKD）
    electronic: (elecRaw - _sumByMatch(elecSrc, isMotor)),  // 电子 HKD（剔除马达项；电子表已 HKD）
    injection_labor: sum(mold.injection || [], r => num(r.shot_price)),  // 啤工 = Σ啤价 HKD（只算机时人工，不含原料）
    painting_labor: ppTotal * 0.7,    // 喷油工 = 喷油总额 70%（喷油已 HKD，不除汇率）
    paint_material: ppTotal * 0.3,    // 油漆 = 喷油总额 30%（喷油已 HKD）
    assembly_labor: combinedAsmHkd,   // 装配工 = 旧组装+旧包装+新排拉(装配)+新排拉(包装)（已 HKD，不除汇率）
    base_price: afterMarkupHkd,              // 货价 = 码点后价 HKD
  };
  renderTaxDeductionBlock(taxHost, sales, salesSec, me, autoFill);
}

// ============== 汇总 · 减税明细 4 表 ==============
function renderTaxDeductionBlock(host, salesPayload, salesSec, me, autoFill) {
  const canEdit = me && (me.dept === 'sales' || me.dept === 'engineering');
  salesPayload.pricing_summary = salesPayload.pricing_summary || {};
  const ps = salesPayload.pricing_summary;
  autoFill = autoFill || {};
  // 自动同步前面部门的金额（每次进汇总都覆盖；用户后续可手填覆盖项放 ps.overrides）
  ps.overrides = ps.overrides || {};
  const applyAuto = (tbl, key, val) => {
    if (val == null) return;                    // 仅未计算(undefined/null)时跳过；0 要写回以清掉旧残留值
    if (ps.overrides[tbl + '.' + key]) return;  // 用户已手动改过
    ps[tbl] = ps[tbl] || {};
    ps[tbl][key] = +val.toFixed(4);
  };
  applyAuto('t1', 'base_price', autoFill.base_price);
  applyAuto('t1', 'imp_mat', autoFill.imp_mat);
  applyAuto('t1', 'dom_mat', autoFill.dom_mat);
  applyAuto('t1', 'blow', autoFill.blow);
  applyAuto('t1', 'slush', autoFill.slush);
  applyAuto('t1', 'sewing_hair', autoFill.sewing_hair);
  applyAuto('t1', 'sewing_cloth', autoFill.sewing_cloth);
  applyAuto('t1', 'hardware', autoFill.hardware);
  applyAuto('t1', 'electronic', autoFill.electronic);
  applyAuto('t1', 'motor', autoFill.motor);
  applyAuto('t1', 'suction', autoFill.suction);
  applyAuto('t1', 'glue_bag', autoFill.glue_bag);
  applyAuto('t2', 'code_before', autoFill.code_before);
  applyAuto('t2', 'color_box', autoFill.color_box);
  applyAuto('t2', 'battery', autoFill.battery);
  applyAuto('t2', 'libao', autoFill.libao);
  applyAuto('t2', 'plating', autoFill.plating);
  applyAuto('t2', 'other_buy', autoFill.other_buy);
  applyAuto('t2', 'carton', autoFill.carton);
  applyAuto('t2', 'freight', autoFill.freight);
  applyAuto('t2', 'cabinet', autoFill.cabinet);
  applyAuto('t2', 'misc', autoFill.misc);
  applyAuto('t3', 'injection_labor', autoFill.injection_labor);
  applyAuto('t3', 'painting_labor', autoFill.painting_labor);
  applyAuto('t3', 'paint_material', autoFill.paint_material);
  applyAuto('t3', 'assembly_labor', autoFill.assembly_labor);
  // 表1 出厂货价核
  ps.t1 = ps.t1 || { base_price: 0, imp_mat: 0, dom_mat: 0, blow: 0, slush: 0, sewing_hair: 0, sewing_cloth: 0, hardware: 0, electronic: 0, motor: 0, suction: 0, glue_bag: 0 };
  // 表2 包装/外购
  ps.t2 = ps.t2 || { color_box: 0, inner_card: 0, code_before: 0, code_after: 0, battery: 0, libao: 0, plating: 0, other_buy: 0, carton: 0, freight: 0, cabinet: 0, misc: 0 };
  // 旧数据迁移：彩盒 + 内咭 合并到 color_box，inner_card 清零
  if (ps.t2.inner_card) {
    ps.t2.color_box = num(ps.t2.color_box) + num(ps.t2.inner_card);
    ps.t2.inner_card = 0;
  }
  // 表3 人工 & 成本汇总（仅 abs/人工 是手填，其他由 t1+t2 + 自动算）
  ps.t3 = ps.t3 || { abs_cost: 0, injection_labor: 0, painting_labor: 0, paint_material: 0, assembly_labor: 0 };
  // 表4 减税明细：每类 amount + rate%
  // 减税率默认值（按实际减税口径）
  const RATE_DEFAULTS = {
    rmb_buy: 0,       // 人民币外购件成本（总额参考，不参与减税）
    tax13: 0,         // 含税13%类成本（成本基数参考，不参与减税；减税在"含税13%类"列）
    labor13: 11.5,    // 人工类13%
    carton: 10,       // 纸箱类
    tax1: 0.99,       // 含税1%
    slush3: 3,        // 搪胶类3%
    sewhair13: 11.5,  // 车发类13%
    sewcloth13: 11.5, // 车衣类13%
    suction6: 6,      // 吸塑类6%
    freight9: 8.26,   // 运费含税9%
    tax13b: 11.5,     // 含税13%类
  };
  ps.t4 = ps.t4 || {};
  Object.keys(RATE_DEFAULTS).forEach(k => {
    ps.t4[k] = ps.t4[k] || { amt: 0, rate: RATE_DEFAULTS[k] };
    // 若 rate 还是旧默认值（13/1/9 等），且用户没手动覆盖过，更新为新默认
    if (!ps.overrides || !ps.overrides['t4r.' + k]) {
      ps.t4[k].rate = RATE_DEFAULTS[k];
    }
  });

  const t1Cols = [
    ['base_price', '货价'], ['imp_mat', '进口料'], ['dom_mat', '国内料'], ['blow', '吹气'], ['slush', '搪胶'],
    ['sewing_hair', '车发'], ['sewing_cloth', '车衣'], ['hardware', '五金'], ['electronic', '电子'], ['motor', '马达'], ['suction', '吸塑'], ['glue_bag', '胶袋'],
  ];
  const t2Cols = [
    ['color_box', '彩盒/内咭'], ['code_before', '未减税前码数'], ['code_after', '减税后码数'],
    ['battery', '电池'], ['libao', '利宝'], ['plating', '电镀'], ['other_buy', '其他外购'],
    ['carton', '纸箱'], ['freight', '运费'], ['cabinet', '吊柜费'], ['misc', '杂项'],
  ];
  const t4Cols = [
    ['tax13', '含税13%类成本'], ['labor13', '人工类13%'], ['carton', '纸箱类'],
    ['tax1', '含税1%'], ['slush3', '搪胶类3%'], ['sewhair13', '车发类13%'], ['sewcloth13', '车衣类13%'],
    ['suction6', '吸塑类6%'], ['freight9', '运费类9%'], ['tax13b', '含税13%类'],
  ];
  // 参考列：只显示成本金额，无税率、不参与减税（避免与明细列重复）
  const T4_NO_RATE = new Set(['rmb_buy', 'tax13', 'labor13']);

  const ro = canEdit ? '' : 'readonly';
  const cls = canEdit ? 'tk-edit' : 'tk-edit tk-ro';

  function buildTable(title, cols, dataKey) {
    const headRow = cols.map(([k, lbl]) => `<th>${lbl}</th>`).join('');
    const valRow = cols.map(([k, lbl]) => `<td><input class="${cls}" type="number" step="0.0001" data-tbl="${dataKey}" data-key="${k}" value="${num(ps[dataKey][k]) || ''}" ${ro}/></td>`).join('');
    return `<div class="tk-block"><div class="tk-title">${title}</div>
      <div class="tk-scroll"><table class="tk-table"><thead><tr>${headRow}</tr></thead><tbody><tr>${valRow}</tr></tbody></table></div></div>`;
  }

  function buildT4() {
    const headRow = t4Cols.map(([k, lbl]) => `<th>${lbl}</th>`).join('')
      + '<th class="tk-sum">合计减税</th>'
      + '<th class="tk-sum" style="background:#dcfce7">减税后成本</th>';
    const amtRow = t4Cols.map(([k]) => `<td><input class="${cls}" type="number" step="0.0001" data-tbl="t4a" data-key="${k}" value="${num(ps.t4[k].amt) || ''}" ${ro} title="金额"/></td>`).join('')
      + '<td></td><td></td>';
    const rateRow = t4Cols.map(([k]) => T4_NO_RATE.has(k) ? '<td></td>'
      : `<td><input class="${cls}" type="number" step="0.01" data-tbl="t4r" data-key="${k}" value="${num(ps.t4[k].rate) || ''}" ${ro} title="税率%"/>%</td>`).join('')
      + '<td></td><td></td>';
    const dedRow = t4Cols.map(([k]) => T4_NO_RATE.has(k) ? '<td class="tk-calc">—</td>'
      : `<td class="tk-calc" id="tk-ded-${k}" title="减税额=金额×税率">0.0000</td>`).join('')
      + '<td class="tk-sum" id="tk-total-ded">0.00</td>'
      + '<td class="tk-sum" id="tk-after-ded" style="background:#dcfce7;color:#166534;font-weight:700">0.00</td>';
    return `<div class="tk-block"><div class="tk-title">四、减税明细 <small class="muted">（1=金额，2=税率%，3=减税额=金额×税率；合计减税=Σ减税额；减税后成本 = 总成本 − 合计减税）</small></div>
      <div class="tk-scroll"><table class="tk-table"><thead><tr>${headRow}</tr></thead><tbody>
        <tr>${amtRow}</tr>
        <tr>${rateRow}</tr>
        <tr>${dedRow}</tr>
      </tbody></table></div></div>`;
  }

  function buildT3() {
    return `<div class="tk-block"><div class="tk-title">三、人工 & 成本汇总</div>
      <div class="tk-scroll"><table class="tk-table">
        <thead><tr>
          <th>啤工</th><th>喷油工</th><th>油漆</th><th>装配工</th>
          <th style="background:#fef3c7">不含人工成本</th>
          <th>人工比例</th><th>毛利</th><th>毛利率</th><th>利润</th><th>利润率</th><th>总成本</th>
        </tr></thead>
        <tbody><tr>
          <td><input class="${cls}" type="number" step="0.0001" data-tbl="t3" data-key="injection_labor" value="${num(ps.t3.injection_labor) || ''}" ${ro}/></td>
          <td><input class="${cls}" type="number" step="0.0001" data-tbl="t3" data-key="painting_labor" value="${num(ps.t3.painting_labor) || ''}" ${ro}/></td>
          <td><input class="${cls}" type="number" step="0.0001" data-tbl="t3" data-key="paint_material" value="${num(ps.t3.paint_material) || ''}" ${ro}/></td>
          <td><input class="${cls}" type="number" step="0.0001" data-tbl="t3" data-key="assembly_labor" value="${num(ps.t3.assembly_labor) || ''}" ${ro}/></td>
          <td class="tk-calc" id="tk-no-labor" style="background:#fef3c7;font-weight:600">0.0000</td>
          <td class="tk-calc" id="tk-labor-pct">0.0%</td>
          <td class="tk-calc" id="tk-gross">0.0000</td>
          <td class="tk-calc" id="tk-gross-pct">0.0%</td>
          <td class="tk-calc" id="tk-profit">0.0000</td>
          <td class="tk-calc" id="tk-profit-pct">0.0%</td>
          <td class="tk-calc" id="tk-total-cost">0.0000</td>
        </tr></tbody>
      </table></div></div>`;
  }

  // 印尼运费手填（HKD）— 用于 杂项自动算
  ps.indo_freight = ps.indo_freight ?? 0;
  host.innerHTML = `<h2>🧾 减税明细 / 成本汇总</h2>
    <div style="display:flex;gap:14px;align-items:center;margin:6px 0 10px;padding:8px 12px;background:#fef9c3;border-radius:6px;font-size:13px">
      <label>📦 印尼运费 (HKD) <input id="tk-indo-freight" type="number" step="0.0001" value="${num(ps.indo_freight) || ''}" style="width:100px" ${ro}/></label>
      <small class="muted">杂项 = 印尼运费 + 附加税</small>
    </div>
    <style>
      .tk-block{margin-top:16px}
      .tk-title{font-weight:600;margin-bottom:6px;color:#44403c}
      .tk-scroll{overflow-x:auto;border:1px solid #e7e5e4;border-radius:6px}
      .tk-table{border-collapse:collapse;width:100%;font-size:12px}
      .tk-table th,.tk-table td{border:1px solid #e7e5e4;padding:4px 6px;text-align:center;white-space:nowrap}
      .tk-table th{background:#f5f5f4;color:#44403c;font-weight:600}
      .tk-table td input.tk-edit{width:90px;text-align:right;border:1px solid transparent;background:transparent;padding:2px 4px}
      .tk-table td input.tk-edit:hover,.tk-table td input.tk-edit:focus{border-color:#a8a29e;background:#fff}
      .tk-table td input.tk-ro{background:#fafaf9}
      .tk-calc{background:#fef3c7;font-weight:600;color:#92400e}
      .tk-sum{background:#dcfce7;font-weight:700;color:#166534}
      .tk-save{margin-top:14px}
    </style>
    ${buildTable('一、出厂货价核', t1Cols, 't1')}
    ${buildTable('二、包装 / 外购', t2Cols, 't2')}
    ${buildT3()}
    ${buildT4()}
    ${canEdit ? `<div class="tk-save"><button id="tk-btn-save">💾 保存减税明细</button> <span id="tk-msg" class="muted"></span></div>` : ''}`;

  function recalc() {
    const sum = (obj) => Object.values(obj).reduce((s, v) => s + num(v), 0);
    // 不含人工成本 = 表1（除货价）+ 表2（除码数）+ 啤工（包含 进口料/吹气/搪胶/吸塑/运费/吊柜费 等）
    const t1NoBase = { ...ps.t1 }; delete t1NoBase.base_price;
    const t2Cost = { ...ps.t2 }; delete t2Cost.code_before; delete t2Cost.code_after;
    const noLaborCost = sum(t1NoBase) + sum(t2Cost) + num(ps.t3.injection_labor);
    // 人民币外购件成本 = 国内料+车发+车衣+五金+电子+马达 + 彩盒/内咭+电池+利宝+电镀+其他外购+纸箱+杂项 + 油漆
    const rmbBuyCost =
      num(ps.t1.dom_mat) + num(ps.t1.sewing_hair) + num(ps.t1.sewing_cloth)
      + num(ps.t1.hardware) + num(ps.t1.electronic) + num(ps.t1.motor)
      + num(ps.t2.color_box) + num(ps.t2.battery) + num(ps.t2.libao)
      + num(ps.t2.plating) + num(ps.t2.other_buy) + num(ps.t2.carton) + num(ps.t2.misc)
      + num(ps.t1.glue_bag)
      + num(ps.t3.paint_material);
    const laborCost = num(ps.t3.painting_labor) + num(ps.t3.paint_material) + num(ps.t3.assembly_labor);
    const totalCost = noLaborCost + laborCost;
    const basePrice = num(ps.t1.base_price);
    const gross = basePrice - noLaborCost;
    const profit = basePrice - totalCost;
    const grossPct = basePrice ? gross / basePrice : 0;
    const profitPct = basePrice ? profit / basePrice : 0;
    const laborPct = basePrice ? laborCost / basePrice : 0;
    // 四、减税明细 各列自动填
    const setT4Amt = (key, val) => {
      if (ps.overrides['t4a.' + key]) return;
      ps.t4[key].amt = +num(val).toFixed(4);
      const inp = host.querySelector(`input[data-tbl="t4a"][data-key="${key}"]`);
      if (inp && document.activeElement !== inp) inp.value = ps.t4[key].amt || '';
    };
    setT4Amt('rmb_buy', rmbBuyCost);                                           // 人民币外购件成本
    // 含税13%类成本 = 国内料 + 五金 + 马达 + 彩盒/内咭 + 电池 + 利宝 + 其他外购 + 油漆 + 胶袋
    const tax13Cost = num(ps.t1.dom_mat) + num(ps.t1.hardware) + num(ps.t1.motor)
      + num(ps.t2.color_box) + num(ps.t2.battery) + num(ps.t2.libao) + num(ps.t2.other_buy)
      + num(ps.t3.paint_material) + num(ps.t1.glue_bag);
    setT4Amt('tax13', tax13Cost);
    setT4Amt('carton', num(ps.t2.carton));                                     // 纸箱类 = 纸箱
    setT4Amt('slush3', num(ps.t1.slush));                                      // 搪胶类3% = 搪胶
    setT4Amt('sewhair13', num(ps.t1.sewing_hair));                             // 车发类13% = 车发
    setT4Amt('sewcloth13', num(ps.t1.sewing_cloth));                           // 车衣类13% = 车衣
    setT4Amt('suction6', num(ps.t1.suction));                                  // 吸塑类6% = 吸塑
    setT4Amt('freight9', num(ps.t2.freight));                                  // 运费含税9% = 运费
    setT4Amt('labor13', num(ps.t3.injection_labor) + num(ps.t3.painting_labor) + num(ps.t3.assembly_labor));// 人工类13% = 啤工 + 喷油工 + 装配工
    setT4Amt('tax1', num(ps.t2.plating));                                      // 含税1% = 电镀
    setT4Amt('tax13b', tax13Cost);                                             // 含税13%类 = 同含税13%类成本
    // 表4：每行 减税额 = 金额 × 税率%；参考列(无税率)不计；填入减税额行 + 合计
    const totalDed = t4Cols.reduce((s, [k]) => {
      if (T4_NO_RATE.has(k)) return s;  // 人民币外购件成本/含税13%类成本：参考列，不参与减税
      const ded = num(ps.t4[k].amt) * num(ps.t4[k].rate) / 100;
      const cell = host.querySelector('#tk-ded-' + k);
      if (cell) cell.textContent = formatNum(ded);
      return s + ded;
    }, 0);

    const setTxt = (id, v) => { const e = host.querySelector('#' + id); if (e) e.textContent = v; };
    setTxt('tk-labor-pct', (laborPct * 100).toFixed(1) + '%');
    setTxt('tk-gross', formatNum(gross));
    setTxt('tk-gross-pct', (grossPct * 100).toFixed(1) + '%');
    setTxt('tk-profit', formatNum(profit));
    setTxt('tk-profit-pct', (profitPct * 100).toFixed(1) + '%');
    setTxt('tk-no-labor', formatNum(noLaborCost));
    setTxt('tk-total-cost', formatNum(totalCost));
    setTxt('tk-total-ded', formatNum(totalDed));
    const afterDed = totalCost - totalDed;
    setTxt('tk-after-ded', formatNum(afterDed));
    // 减税后码数 = 货价 / 减税后成本 → 写回 t2.code_after 输入框
    const codeAfter = afterDed > 0 ? basePrice / afterDed : 0;
    ps.t2.code_after = +codeAfter.toFixed(4);
    const codeAfterInp = host.querySelector('input[data-tbl="t2"][data-key="code_after"]');
    if (codeAfterInp && document.activeElement !== codeAfterInp) codeAfterInp.value = ps.t2.code_after || '';
  }
  recalc();

  if (canEdit) {
    const indoInp = host.querySelector('#tk-indo-freight');
    if (indoInp) indoInp.oninput = () => {
      ps.indo_freight = Number(indoInp.value) || 0;
      // 杂项 = 印尼运费 + 附加税(HKD)，单一公式重算，避免之前增量法丢掉附加税
      // 不设 override：重渲染时 autoFill 会用 indo_freight+surtax 同公式重算，保持一致
      ps.t2.misc = +((Number(indoInp.value) || 0) + num(autoFill.surtax_hkd)).toFixed(4);
      recalc();
    };
    host.querySelectorAll('input.tk-edit').forEach(inp => {
      inp.oninput = () => {
        const tbl = inp.dataset.tbl, key = inp.dataset.key;
        const v = parseFloat(inp.value) || 0;
        if (tbl === 't1' || tbl === 't2' || tbl === 't3') {
          ps[tbl][key] = v;
          ps.overrides[tbl + '.' + key] = true;
        }
        else if (tbl === 't4a') { ps.t4[key].amt = v; ps.overrides['t4a.' + key] = true; }
        else if (tbl === 't4r') { ps.t4[key].rate = v; ps.overrides['t4r.' + key] = true; }
        recalc();
      };
    });
    host.querySelector('#tk-btn-save').onclick = async () => {
      const msg = host.querySelector('#tk-msg');
      msg.textContent = '保存中...';
      try {
        await putSection(salesSec, salesPayload, false);
        if (salesSec) salesSec.payload_json = JSON.stringify(salesPayload);  // 同步本地缓存
        msg.textContent = '✓ 已保存 ' + new Date().toLocaleTimeString();
      } catch (e) { msg.textContent = '✗ ' + e.message; }
    };
  }
}

// ============== 搪胶部门（占位） ==============
function renderSlush(host, payload, canEdit, onChange, fxRmbHkd) {
  payload.slush_items = payload.slush_items || [];
  host.innerHTML = `<h3>二·C、搪胶产品报价</h3><div class="muted">字段待定，先占位。下方为草拟表格：</div>
    <div id="wb-slush-table" style="margin-top:8px"></div>`;
  const cols = [
    { key: 'item_code', label: '产品编号', width: '110px' },
    { key: 'name', label: '胶件名称', width: '120px' },
    { key: 'material', label: '材料', width: '100px' },
    { key: 'weight_g', label: '料重(g)', type: 'number', width: '80px' },
    { key: 'daily_output', label: '日产量24H', type: 'number', width: '100px' },
    { key: 'qty', label: '用量(PC)', type: 'number', width: '70px' },
    { key: 'unit_price_hkd', label: '单价 HKD', type: 'number', width: '100px' },
    { key: 'total_hkd', label: '总价 HKD', readonly: true, calc: r => num(r.unit_price_hkd) * num(r.qty), width: '90px' },
    { key: 'note', label: '备注' },
  ];
  const wrappedOnChange = (() => { const fns = []; const w = () => { fns.forEach(f => f()); onChange(); }; w._fns = fns; return w; })();
  renderTable(host.querySelector('#wb-slush-table'), cols, payload.slush_items, { readonly: !canEdit, onChange: wrappedOnChange });

  // 搪胶单价本来就是 HKD，不再做 RMB→HKD 转换；只展示 HKD + 反向算 RMB 供参考
  const fx = num(fxRmbHkd) || 0.85;
  const card = document.createElement('div'); card.className = 'loss-summary';
  host.appendChild(card);
  const refresh = () => {
    const totalHkd = sum(payload.slush_items || [], r => num(r.unit_price_hkd) * num(r.qty));
    card.innerHTML = `
      <div class="ls-row hi"><span class="ls-label">合计 HKD</span><span class="ls-val">${formatNum(totalHkd)}</span></div>
      <div class="ls-row"><span class="ls-label">合计 RMB <small class="muted">(汇率 ${fx})</small></span><span class="ls-val">${formatNum(totalHkd * fx)}</span></div>`;
  };
  refresh();
  wrappedOnChange._fns.push(refresh);
}

// ============== 车缝部门 ==============
function renderSewing(host, payload, canEdit, onChange, fxRmbHkd) {
  payload.sewing_groups = payload.sewing_groups || [];
  payload.sewing_loss_pct = payload.sewing_loss_pct ?? 1;
  const fx = num(fxRmbHkd) || 0.85;

  const itemCols = [
    { key: 'fabric', label: '布料名称', type: 'textarea', width: '240px' },
    { key: 'part', label: '部位', width: '90px' },
    { key: 'craft', label: '工艺', type: 'select', options: ['电绣'], width: '80px' },
    { key: 'pieces', label: '裁片数', type: 'number', width: '70px' },
    { key: 'usage', label: '用量/码', type: 'number', width: '90px' },
    { key: 'mat_price', label: '物料价 (RMB)', type: 'number', width: '100px' },
    { key: 'price', label: '价钱 (RMB)', readonly: true,
      calc: r => num(r.usage) * num(r.mat_price), width: '90px' },
    { key: 'markup', label: '码点', type: 'number', width: '70px' },
    { key: 'total', label: '总价钱 (RMB)', readonly: true,
      calc: r => num(r.usage) * num(r.mat_price) * (num(r.markup) || 1), width: '100px' },
    { key: 'note', label: '备注' },
  ];

  const totalsBox = document.createElement('div'); totalsBox.className = 'loss-summary';
  const wrappedOnChange = (() => { const fns = []; const w = () => { fns.forEach(f => f()); onChange(); refreshTotals(); }; w._fns = fns; return w; })();

  function refreshTotals() {
    const groupTotal = (g) =>
      sum(g.items || [], r => num(r.usage) * num(r.mat_price) * (num(r.markup) || 1))
      + sewLaborToAdd(g);
    const allRMB = sum(payload.sewing_groups, groupTotal);
    totalsBox.innerHTML = `
      <div class="ls-row"><span class="ls-label">配套合计</span><span class="ls-val">${formatNum(allRMB)} RMB</span></div>
      <div class="ls-row hi"><span class="ls-label">合计 RMB</span><span class="ls-val">${formatNum(allRMB)}</span></div>
      <div class="ls-row hi"><span class="ls-label">合计 HKD</span><span class="ls-val">${formatNum(allRMB / fx)} <small class="muted">(汇率 ${fx})</small></span></div>`;
  }

  function render() {
    host.innerHTML = `<h3>车缝产品报价（按产品分组）
      ${canEdit ? '<button class="mini" id="sw-add-group" style="margin-left:10px">+ 新增产品组</button>' : ''}
      ${canEdit ? '<button class="mini" id="sw-import" type="button" style="margin-left:6px">📄 导入车缝报价单</button><input id="sw-file" type="file" accept=".xls,.xlsx" style="display:none"/>' : ''}
    </h3>
    <div id="sw-import-preview"></div>
    <div id="sw-groups"></div>`;
    const groupsHost = host.querySelector('#sw-groups');

    payload.sewing_groups.forEach((g, gi) => {
      g.items = g.items || [];
      const card = document.createElement('div');
      card.className = 'labor-group';
      card.style.cssText = 'border:1px solid #e7e5e4;border-radius:8px;padding:12px;margin-top:10px;background:#fafaf9';
      const cat = g.category || '车衣';
      g.category = cat;
      card.innerHTML = `
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:8px">
          <strong style="color:#16a34a">📦 产品：</strong>
          <input class="sw-gname" data-gi="${gi}" value="${escapeHtml(g.name || '')}" placeholder="如：6寸小蜥蜴 / 盾牌" style="flex:1;max-width:300px" ${canEdit ? '' : 'disabled'}/>
          <label style="font-size:13px">类型
            <select class="sw-gcat" data-gi="${gi}" ${canEdit ? '' : 'disabled'}>
              <option value="车衣" ${cat==='车衣'?'selected':''}>车衣</option>
              <option value="车发" ${cat==='车发'?'selected':''}>车发</option>
            </select>
          </label>
          ${canEdit ? `<button class="mini danger sw-gdel" data-gi="${gi}">删除</button>` : ''}
        </div>
        <div class="sw-items"></div>
        <div style="margin-top:8px;display:flex;gap:14px;align-items:center;flex-wrap:wrap">
          <span class="muted">本组小计：<b class="sw-gsum">0</b> RMB</span>
          <span class="sw-emb-badge" style="display:none;font-size:12px;font-weight:600;color:#16a34a;background:#dcfce7;border-radius:10px;padding:2px 8px"></span>
        </div>`;
      groupsHost.appendChild(card);

      renderTable(card.querySelector('.sw-items'), itemCols, g.items, { readonly: !canEdit, onChange: wrappedOnChange });

      const refreshGroup = () => {
        const t = sum(g.items, r => num(r.usage) * num(r.mat_price) * (num(r.markup) || 1)) + sewLaborToAdd(g);
        card.querySelector('.sw-gsum').textContent = formatNum(t);
        const embN = (g.items || []).filter(r => r.craft === '电绣').length;
        const badge = card.querySelector('.sw-emb-badge');
        if (badge) { badge.style.display = embN ? '' : 'none'; badge.textContent = embN ? `🧵 含电绣 ${embN} 行` : ''; }
      };
      refreshGroup();
      wrappedOnChange._fns.push(refreshGroup);
    });

    host.appendChild(totalsBox);
    refreshTotals();

    if (!canEdit) return;
    host.querySelectorAll('.sw-gname').forEach(inp => inp.oninput = () => {
      payload.sewing_groups[+inp.dataset.gi].name = inp.value; onChange();
    });
    host.querySelectorAll('.sw-gcat').forEach(sel => sel.onchange = () => {
      payload.sewing_groups[+sel.dataset.gi].category = sel.value; onChange();
    });
    host.querySelectorAll('.sw-gdel').forEach(btn => btn.onclick = () => {
      const gi = +btn.dataset.gi;
      if (!confirm(`删除产品组"${payload.sewing_groups[gi].name || '未命名'}"？`)) return;
      payload.sewing_groups.splice(gi, 1); onChange(); render();
    });
    const addBtn = host.querySelector('#sw-add-group');
    if (addBtn) addBtn.onclick = () => {
      payload.sewing_groups.push({ name: '', items: [], labor_amount: 0 });
      onChange(); render();
    };

    // 导入车缝报价单 xlsx
    const impBtn = host.querySelector('#sw-import');
    const impFile = host.querySelector('#sw-file');
    const impPreview = host.querySelector('#sw-import-preview');
    if (impBtn && impFile) {
      impBtn.onclick = () => impFile.click();
      impFile.onchange = async (e) => {
        const f = e.target.files[0]; if (!f) return;
        impPreview.innerHTML = '<i class="muted" style="padding:8px;display:block">正在解析…</i>';
        try {
          const fd = new FormData(); fd.append('file', f);
          const r = await fetch('/api/uploads/sewing-sheet', { method: 'POST', credentials: 'include', body: fd });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error || '解析失败');
          impPreview.innerHTML = `
            <div class="card" style="background:#f0fdf4;border:1px solid #86efac;margin-top:10px">
              <p>从 <b>${escapeHtml(j.sheet_used || '')}</b> 解析到 <b>${j.count}</b> 个产品分组：</p>
              <ul style="margin:6px 0;padding-left:22px">
                ${j.groups.map(g => `<li><b>${escapeHtml(g.name)}</b> — ${g.items.length} 行 / 人工 ¥${(g.labor_amount||0).toFixed(2)}</li>`).join('')}
              </ul>
              <div style="margin-top:10px;display:flex;gap:8px">
                <button id="sw-imp-replace">应用（替换所有产品组）</button>
                <button id="sw-imp-append" class="mini">追加到现有列表</button>
                <button id="sw-imp-cancel" class="mini danger">取消</button>
              </div>
            </div>`;
          const toGroup = (g) => ({
            name: g.name,
            items: (g.items || []).map(it => ({
              fabric: it.material || '',
              part: it.part || '',
              craft: /电绣|绣花|embroider/i.test(String(it.material || '') + ' ' + String(it.note || '')) ? '电绣' : '',
              pieces: 1,
              usage: it.qty || 0,
              mat_price: it.unit_price || 0,
              markup: it.markup || 1,
              note: it.note || '',
            })),
            labor_amount: g.labor_amount || 0,
          });
          impPreview.querySelector('#sw-imp-replace').onclick = () => {
            payload.sewing_groups = j.groups.map(toGroup);
            impPreview.innerHTML = ''; impFile.value = ''; onChange(); render();
          };
          impPreview.querySelector('#sw-imp-append').onclick = () => {
            payload.sewing_groups = (payload.sewing_groups || []).concat(j.groups.map(toGroup));
            impPreview.innerHTML = ''; impFile.value = ''; onChange(); render();
          };
          impPreview.querySelector('#sw-imp-cancel').onclick = () => { impPreview.innerHTML = ''; impFile.value = ''; };
        } catch (err) {
          impPreview.innerHTML = `<div class="card" style="background:#fef2f2;border:1px solid #fecaca;margin-top:10px">解析失败：${err.message}</div>`;
        }
      };
    }
  }
  render();
}

function renderCartonCalc(host, c, canEdit, onChange) {
  // 迁移：旧单纸箱 -> cartons[0]，每个纸箱内嵌 flat_cards[]
  if (!c.cartons) {
    c.cartons = [{
      name: '主纸箱', cl: c.cl || 0, cw: c.cw || 0, ch: c.ch || 0,
      ka_label: c.ka_label || 'K=A', qty: c.qty || 1,
      flat_cards: [{ name: '主平卡', l: c.cl || 0, w: c.cw || 0 }],
    }];
  }
  // 确保每个 carton 都有 flat_cards 数组
  c.cartons.forEach(b => { if (!b.flat_cards) b.flat_cards = []; });
  // 删除老的顶层 flat_cards
  delete c.flat_cards;
  c.paper_rate = c.paper_rate ?? 2.75;  // 纸价系数（可调）

  const rate = () => num(c.paper_rate) || 2.75;
  const cuftOf = (b) => num(b.cl) * num(b.cw) * num(b.ch) / 1728;
  const boxPriceOf = (b) => (num(b.cl) + num(b.cw) + 2) * (num(b.cw) + num(b.ch) + 1) * 2 * rate() / 1000;
  // 平卡 L/W 留空时对应所在纸箱的长/宽
  const flatPriceOf = (f, b) => ((num(f.l) || num((b||{}).cl)) + 1) * ((num(f.w) || num((b||{}).cw)) + 1) * 2 / 1000;

  function render() {
    // 同步首个纸箱回旧字段（运费计算/出口表使用）
    const b0 = c.cartons[0];
    if (b0) {
      c.cl = b0.cl; c.cw = b0.cw; c.ch = b0.ch; c.qty = b0.qty;
      c.cuft = cuftOf(b0);
      c.box_price = +boxPriceOf(b0).toFixed(4);
      c.flat_card = b0.flat_cards[0] ? +flatPriceOf(b0.flat_cards[0], b0).toFixed(4) : 0;
    }

    const cartonsHtml = c.cartons.map((b, i) => {
      const fcRows = b.flat_cards.map((f, j) => `
        <tr>
          <td><input data-bi="${i}" data-fj="${j}" data-k="name" type="text" value="${f.name || ''}" ${canEdit?'':'disabled'} style="width:90px"/></td>
          <td><input data-bi="${i}" data-fj="${j}" data-k="l" type="number" step="any" value="${f.l || ''}" placeholder="${b.cl || ''}" title="留空=纸箱长 ${b.cl || ''}" ${canEdit?'':'disabled'} style="width:80px"/></td>
          <td><input data-bi="${i}" data-fj="${j}" data-k="w" type="number" step="any" value="${f.w || ''}" placeholder="${b.cw || ''}" title="留空=纸箱宽 ${b.cw || ''}" ${canEdit?'':'disabled'} style="width:80px"/></td>
          <td style="text-align:right;color:#0f766e;font-weight:600">${flatPriceOf(f, b).toFixed(2)}</td>
          ${canEdit ? `<td><button class="mini danger" data-del-f="${i}-${j}">×</button></td>` : ''}
        </tr>`).join('');

      return `
        <div style="border:1px solid #e7e5e4;border-radius:8px;padding:10px;margin-bottom:12px;background:#fff">
          <div style="display:flex;gap:10px;align-items:center;margin-bottom:8px">
            <strong style="color:#7c2d12">📦</strong>
            <input data-bi="${i}" data-k="name" type="text" value="${b.name || ''}" placeholder="纸箱名称" ${canEdit?'':'disabled'} style="width:130px;font-weight:600"/>
            <span class="muted">L</span><input data-bi="${i}" data-k="cl" type="number" step="any" value="${b.cl || ''}" ${canEdit?'':'disabled'} style="width:80px"/>
            <span class="muted">W</span><input data-bi="${i}" data-k="cw" type="number" step="any" value="${b.cw || ''}" ${canEdit?'':'disabled'} style="width:80px"/>
            <span class="muted">H</span><input data-bi="${i}" data-k="ch" type="number" step="any" value="${b.ch || ''}" ${canEdit?'':'disabled'} style="width:80px"/>
            <span class="muted">inch</span>
            ${canEdit ? `<button class="mini danger" data-del-b="${i}" style="margin-left:auto">删除纸箱</button>` : ''}
          </div>
          <div style="display:flex;gap:18px;align-items:center;padding:8px 10px;background:#fef3c7;border-radius:6px;margin-bottom:10px">
            <span><b>CU.FT</b> <span style="color:#7c2d12;font-weight:700">${cuftOf(b).toFixed(2)}</span></span>
            <span><b>箱价</b> <span style="color:#7c2d12;font-weight:700">HK$ ${boxPriceOf(b).toFixed(2)}</span></span>
            <span><b>数量</b> <input data-bi="${i}" data-k="qty" type="number" step="1" value="${b.qty || ''}" ${canEdit?'':'disabled'} style="width:60px"/></span>
          </div>
          <div style="margin-bottom:4px;color:#78716c;font-size:12px">📄 配的平卡 (inch)</div>
          <table class="wb-table" style="font-size:13px;margin-bottom:6px">
            <thead><tr><th>名称</th><th>L</th><th>W</th><th>平卡价(HK$)</th>${canEdit?'<th></th>':''}</tr></thead>
            <tbody>${fcRows || `<tr><td colspan="${canEdit?5:4}" class="muted" style="text-align:center">暂无平卡</td></tr>`}</tbody>
          </table>
          ${canEdit ? `<button class="mini" data-add-f="${i}">+ 增加平卡</button>` : ''}
        </div>`;
    }).join('');

    host.innerHTML = `
      <div style="border:1px solid #e7e5e4;border-radius:8px;padding:12px;background:#fafaf9;max-width:980px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
          <span style="font-weight:600;color:#44403c">📦 纸箱计算</span>
          <span class="muted" style="font-size:12px">纸价系数
            <input id="cc-rate" type="number" step="any" value="${c.paper_rate}" ${canEdit?'':'disabled'} style="width:64px"/>
            <span title="箱价 = (L+W+2)×(W+H+1)×2×系数÷1000">ⓘ</span>
          </span>
        </div>

        <div style="margin-bottom:6px;color:#78716c;font-size:13px">产品尺寸 CM</div>
        <table class="wb-table" style="font-size:13px;margin-bottom:14px;max-width:340px">
          <thead><tr><th style="width:80px">L</th><th style="width:80px">W</th><th style="width:80px">H</th></tr></thead>
          <tbody><tr>
            <td><input id="cc-pl" type="number" step="any" value="${c.pl || ''}" ${canEdit?'':'disabled'} style="width:80px"/></td>
            <td><input id="cc-pw" type="number" step="any" value="${c.pw || ''}" ${canEdit?'':'disabled'} style="width:80px"/></td>
            <td><input id="cc-ph" type="number" step="any" value="${c.ph || ''}" ${canEdit?'':'disabled'} style="width:80px"/></td>
          </tr></tbody>
        </table>

        ${cartonsHtml}
        ${canEdit ? '<button class="mini" id="cc-add-b">+ 增加纸箱</button>' : ''}
      </div>`;

    if (!canEdit) return;
    // 纸价系数：输入时更新数据，失焦时重算箱价
    const rateEl = host.querySelector('#cc-rate');
    if (rateEl) {
      rateEl.oninput = () => { c.paper_rate = rateEl.value === '' ? 2.75 : Number(rateEl.value); onChange(); };
      rateEl.onchange = () => render();
    }
    // 产品尺寸
    ['pl','pw','ph'].forEach(k => {
      const el = host.querySelector('#cc-' + k);
      el.oninput = () => { c[k] = Number(el.value) || 0; onChange(); };
    });
    // 纸箱字段：输入时只更新数据(不 render，否则每敲一下就重建输入框→丢焦点只能输一位)，
    // 失焦(onchange)时再 render 刷新 CU.FT/箱价
    host.querySelectorAll('input[data-bi]:not([data-fj])').forEach(el => {
      el.oninput = () => {
        const i = +el.dataset.bi, k = el.dataset.k;
        c.cartons[i][k] = el.type === 'number' ? (el.value === '' ? 0 : Number(el.value)) : el.value;
        onChange();
      };
      el.onchange = () => render();
    });
    // 平卡字段：同上
    host.querySelectorAll('input[data-fj]').forEach(el => {
      el.oninput = () => {
        const i = +el.dataset.bi, j = +el.dataset.fj, k = el.dataset.k;
        c.cartons[i].flat_cards[j][k] = el.type === 'number' ? (el.value === '' ? 0 : Number(el.value)) : el.value;
        onChange();
      };
      el.onchange = () => render();
    });
    // 删纸箱
    host.querySelectorAll('[data-del-b]').forEach(btn => btn.onclick = () => {
      if (!confirm('删除该纸箱（含所有平卡）？')) return;
      c.cartons.splice(+btn.dataset.delB, 1); onChange(); render();
    });
    // 加纸箱
    const addB = host.querySelector('#cc-add-b');
    if (addB) addB.onclick = () => {
      c.cartons.push({ name: '纸箱'+(c.cartons.length+1), cl:0, cw:0, ch:0, qty:1, ka_label:'K=A', flat_cards: [] });
      onChange(); render();
    };
    // 删平卡
    host.querySelectorAll('[data-del-f]').forEach(btn => btn.onclick = () => {
      const [i, j] = btn.dataset.delF.split('-').map(Number);
      c.cartons[i].flat_cards.splice(j, 1); onChange(); render();
    });
    // 加平卡
    host.querySelectorAll('[data-add-f]').forEach(btn => btn.onclick = () => {
      const i = +btn.dataset.addF;
      c.cartons[i].flat_cards.push({ name: '平卡'+(c.cartons[i].flat_cards.length+1), l: c.cartons[i].cl || 0, w: c.cartons[i].cw || 0 });
      onChange(); render();
    });
  }
  render();
}

function renderEngineering(host, payload, canEdit, onChange, fxRmbHkd, fxRmbUsd) {
  payload.molds = payload.molds || [];
  payload.electronics = payload.electronics || [];
  payload.hardware = payload.hardware || [];
  payload.aux_materials = payload.aux_materials || [];
  payload.packaging_materials = payload.packaging_materials || [];
  const migrateLibaoCategory = rows => (rows || []).forEach(r => {
    if (r && r.category === '利宝') r.category = '产品利宝';
  });
  migrateLibaoCategory(payload.aux_materials);
  migrateLibaoCategory(payload.packaging_materials);
  payload.packaging_loss_pct = payload.packaging_loss_pct ?? 1;
  payload.electronics_loss_pct = payload.electronics_loss_pct ?? 1;
  payload.hardware_loss_pct = payload.hardware_loss_pct ?? 1;
  payload.aux_loss_pct = payload.aux_loss_pct ?? 1;
  payload.mold_costs = payload.mold_costs || {
    items: [
      { name: '模具费用', price_rmb: 0 },
      { name: '超声模费用', price_rmb: 0 },
      { name: '喷油模具', price_rmb: 0 },
    ],
    customer_subsidy_usd: 0,
    amortization_qty: 20000,
    prototype_fee_usd: 0,
    testing_fee_usd: 0,
    prototype_amortization_qty: 50000,
    testing_amortization_qty: 2000,
    fx_rmb_usd: 7.75,
  };
  if (payload.mold_costs.prototype_fee_usd == null) payload.mold_costs.prototype_fee_usd = num(payload.mold_costs.prototype_fee_rmb);
  if (payload.mold_costs.testing_fee_usd == null) payload.mold_costs.testing_fee_usd = num(payload.mold_costs.testing_fee_rmb);
  if (payload.mold_costs.prototype_amortization_qty == null) payload.mold_costs.prototype_amortization_qty = 50000;
  if (payload.mold_costs.testing_amortization_qty == null) payload.mold_costs.testing_amortization_qty = 2000;
  payload.electronics_extra = payload.electronics_extra || { test_repair: 0, packing_shipping: 0, profit_pct: 10, tax_diff: 0, tax_payable: 0 };
  ['profit_pct', 'tax_diff', 'tax_payable'].forEach(k => { if (payload.electronics_extra[k] == null) payload.electronics_extra[k] = k === 'profit_pct' ? 10 : 0; });

  host.innerHTML = `
    <h3>一、模具部分
      ${canEdit ? `<small><label class="upload-mold-sheet" style="display:inline-block;margin-left:12px">
        <button class="mini" type="button" onclick="this.parentElement.querySelector('input').click()">📄 上传模具报价单 (xlsx)</button>
        <input type="file" accept=".xls,.xlsx" hidden id="mold-sheet-input" />
      </label></small>` : ''}
    </h3>
    <div id="mold-sheet-preview"></div>
    <div id="wb-molds"></div>

    <h3>生产模具费用</h3>
    <div id="wb-mold-costs"></div>

    <h3>四、五金
      ${canEdit ? `<small><label class="upload-mold-sheet" style="display:inline-block;margin-left:12px">
        <button class="mini" type="button" onclick="this.parentElement.querySelector('input').click()">📄 上传五金报价单 (xlsx)</button>
        <input type="file" accept=".xls,.xlsx" hidden id="hardware-sheet-input" />
      </label></small>` : ''}
    </h3>
    <div id="hardware-sheet-preview"></div>
    <div id="wb-hw"></div>
    <div id="wb-hw-extra"></div>

    <h3>五、辅助材料</h3>
    <div id="wb-aux"></div>

    <h3>六、包装材料</h3>
    <div id="wb-pkmat"></div>
    <div id="wb-carton-calc" style="margin-top:14px"></div>
  `;

  renderMolds(host.querySelector('#wb-molds'), payload.molds, onChange, canEdit);
  renderMoldCosts(host.querySelector('#wb-mold-costs'), payload.mold_costs, onChange, canEdit, fxRmbUsd);

  // 上传模具报价单 → 解析 → 预览 → 应用
  const fileInp = host.querySelector('#mold-sheet-input');
  if (fileInp) fileInp.onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const preview = host.querySelector('#mold-sheet-preview');
    preview.innerHTML = '<i class="muted">正在解析…</i>';
    try {
      const fd = new FormData(); fd.append('file', f);
      const r = await fetch('/api/uploads/mold-sheet', { method: 'POST', credentials: 'include', body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || '解析失败');
      preview.innerHTML = `
        <div class="card" style="background:#f0fdf4;border:1px solid #86efac;">
          <p>从 <b>${escapeHtml(j.sheet_used || '')}</b> 解析到 <b>${j.molds.length}</b> 行明细：</p>
          <table class="wb-table"><thead><tr>
            <th>模号</th><th>名称</th><th>类型</th><th>材质</th>
            <th>出模数</th><th>套数</th><th>净重(g)</th><th>周期(秒)</th><th>机型</th><th>目标数</th><th>图片</th><th>模具尺寸</th><th>价格RMB</th><th>备注</th>
          </tr></thead><tbody>
          ${j.molds.map(m => `<tr>
            <td>${escapeHtml(m.mold_no || '')}</td><td>${escapeHtml(m.name || '')}</td><td>${escapeHtml(m.mold_type || '')}</td>
            <td>${escapeHtml(m.material || '')}</td><td>${escapeHtml(m.cavity || '')}</td>
            <td>${escapeHtml(m.sets ?? '')}</td><td>${escapeHtml(m.weight_g ?? '')}</td><td>${escapeHtml(m.cycle_sec ?? '')}</td><td>${escapeHtml(m.machine_model || '')}</td><td>${escapeHtml(m.target ?? '')}</td><td>${escapeHtml((m.images || []).length)}</td><td>${escapeHtml((m.detail && m.detail.mold_size) || '')}</td><td>${escapeHtml(m.price_rmb ?? '')}</td><td>${escapeHtml(m.note || '')}</td>
          </tr>`).join('')}
          </tbody></table>
          <div style="margin-top:10px">
            <button id="btn-apply-replace">应用（替换全部模具）</button>
            <button id="btn-apply-append" class="mini">追加到现有列表</button>
            <button id="btn-apply-cancel" class="mini danger">取消</button>
          </div>
          ${j.images_extracted ? `<p style="color:#16a34a;margin-top:8px">✓ 自动抽取了 ${j.images_extracted} 张图片并归到对应模具行。</p>` : ''}
          ${j.images_hint ? `<p class="muted" style="margin-top:8px">ℹ️ ${j.images_hint}</p>` : ''}
          ${j.images_extract_error ? `<p style="color:#dc2626;margin-top:8px">图片抽取失败: ${j.images_extract_error}</p>` : ''}
        </div>`;
      preview.querySelector('#btn-apply-replace').onclick = () => {
        payload.molds = j.molds.map(m => ({ ...m, images: m.images || [] }));
        preview.innerHTML = ''; fileInp.value = '';
        renderEngineering(host, payload, canEdit, onChange, fxRmbHkd, fxRmbUsd);
        onChange();
      };
      preview.querySelector('#btn-apply-append').onclick = () => {
        payload.molds = (payload.molds || []).concat(j.molds.map(m => ({ ...m, images: m.images || [] })));
        preview.innerHTML = ''; fileInp.value = '';
        renderEngineering(host, payload, canEdit, onChange, fxRmbHkd, fxRmbUsd);
        onChange();
      };
      preview.querySelector('#btn-apply-cancel').onclick = () => { preview.innerHTML = ''; fileInp.value = ''; };
    } catch (err) {
      preview.innerHTML = `<div class="card" style="background:#fef2f2;border:1px solid #fecaca">解析失败：${err.message}</div>`;
    }
  };

  // 上传五金报价单 → 解析 → 预览 → 替换或追加
  const hardwareFileInp = host.querySelector('#hardware-sheet-input');
  if (hardwareFileInp) hardwareFileInp.onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const preview = host.querySelector('#hardware-sheet-preview');
    preview.innerHTML = '<i class="muted">正在解析…</i>';
    try {
      const fd = new FormData(); fd.append('file', f);
      const r = await fetch('/api/uploads/hardware-sheet', { method: 'POST', credentials: 'include', body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || '解析失败');
      preview.innerHTML = `
        <div class="card" style="background:#f0fdf4;border:1px solid #86efac;">
          <p>从 <b>${escapeHtml(j.sheet_used || '')}</b> 解析到 <b>${j.items.length}</b> 条五金明细：</p>
          <table class="wb-table"><thead><tr>
            <th>零件名称</th><th>规格</th><th>用量</th><th>单价 RMB</th><th>备注</th>
          </tr></thead><tbody>
          ${j.items.map(item => `<tr>
            <td>${escapeHtml(item.name || '')}</td><td>${escapeHtml(item.spec || '')}</td>
            <td>${escapeHtml(item.qty ?? '')}</td><td>${escapeHtml(item.unit_price_rmb ?? '')}</td>
            <td>${escapeHtml(item.note || '')}</td>
          </tr>`).join('')}
          </tbody></table>
          <div style="margin-top:10px">
            <button id="btn-hardware-replace">应用（替换全部五金）</button>
            <button id="btn-hardware-append" class="mini">追加到现有列表</button>
            <button id="btn-hardware-cancel" class="mini danger">取消</button>
          </div>
        </div>`;
      preview.querySelector('#btn-hardware-replace').onclick = () => {
        payload.hardware = j.items.map(item => ({ ...item }));
        preview.innerHTML = ''; hardwareFileInp.value = '';
        renderEngineering(host, payload, canEdit, onChange, fxRmbHkd, fxRmbUsd);
        onChange();
      };
      preview.querySelector('#btn-hardware-append').onclick = () => {
        payload.hardware = (payload.hardware || []).concat(j.items.map(item => ({ ...item })));
        preview.innerHTML = ''; hardwareFileInp.value = '';
        renderEngineering(host, payload, canEdit, onChange, fxRmbHkd, fxRmbUsd);
        onChange();
      };
      preview.querySelector('#btn-hardware-cancel').onclick = () => {
        preview.innerHTML = ''; hardwareFileInp.value = '';
      };
    } catch (err) {
      preview.innerHTML = `<div class="card" style="background:#fef2f2;border:1px solid #fecaca">解析失败：${escapeHtml(err.message)}</div>`;
    }
  };

  const freeCols = [
    { key: 'name', label: '零件名称' },
    { key: 'spec', label: '规格' },
    { key: 'qty', label: '用量', type: 'number', width: '80px' },
    { key: 'unit_price_rmb', label: '单价 RMB', type: 'number', width: '100px' },
    { key: 'unit_price_hkd', label: '单价 HKD', readonly: true, calc: r => freeUnitHkd(r, fxRmbHkd), width: '100px' },
    { key: 'amount', label: '金额 HKD', readonly: true, calc: r => freeAmountHkd(r, fxRmbHkd), width: '90px' },
    { key: 'tax_pct', label: '税点 %', type: 'number', width: '90px' },
    { key: 'note', label: '备注' },
  ];
  // 辅助材料：在五金列基础上插入「类别」列（减税明细按类别统计）
  const auxCols = [
    { key: 'name', label: '零件名称' },
    { key: 'spec', label: '规格' },
    { key: 'category', label: '类别', type: 'select', options: MAT_CATEGORIES, width: '120px' },
    { key: 'qty', label: '用量', type: 'number', width: '80px' },
    { key: 'unit_price_rmb', label: '单价 RMB', type: 'number', width: '100px' },
    { key: 'unit_price_hkd', label: '单价 HKD', readonly: true, calc: r => freeUnitHkd(r, fxRmbHkd), width: '100px' },
    { key: 'amount', label: '金额 HKD', readonly: true, calc: r => freeAmountHkd(r, fxRmbHkd), width: '90px' },
    { key: 'tax_pct', label: '税点 %', type: 'number', width: '90px' },
    { key: 'note', label: '备注' },
  ];
  const refreshes = [];
  const wrappedOnChange = () => { refreshes.forEach(f => f()); onChange(); };

  // 电子部分已移到 电子部 tab（renderElectronic）
  ensureFreeRmbPrices(payload.hardware, fxRmbHkd);
  ensureFreeRmbPrices(payload.aux_materials, fxRmbHkd);
  ensureFreeRmbPrices(payload.packaging_materials, fxRmbHkd);
  renderTable(host.querySelector('#wb-hw'), freeCols, payload.hardware, { readonly: !canEdit, onChange: wrappedOnChange });
  refreshes.push(renderHwExtra(host.querySelector('#wb-hw-extra'), payload, wrappedOnChange, canEdit, fxRmbHkd));
  renderTable(host.querySelector('#wb-aux'), auxCols, payload.aux_materials, { readonly: !canEdit, onChange: wrappedOnChange });
  refreshes.push(renderLossSummary(host.querySelector('#wb-aux'), '辅助材料 成本汇总',
    () => sum(payload.aux_materials || [], r => freeAmountHkd(r, fxRmbHkd)),
    () => 0, fxRmbHkd, 'HKD'));  // 不计损耗；辅助材料为港币

  // 六、包装材料
  const pkCols = [
    { key: 'name', label: '零件名称' },
    { key: 'spec', label: '规格', type: 'textarea' },
    { key: 'category', label: '类别', type: 'select', options: MAT_CATEGORIES, width: '120px' },
    { key: 'qty', label: '用量', type: 'number', width: '80px' },
    { key: 'unit_price_rmb', label: '单价 RMB', type: 'number', width: '100px' },
    { key: 'unit_price_hkd', label: '单价 HKD', readonly: true, calc: r => freeUnitHkd(r, fxRmbHkd), width: '100px' },
    { key: 'amount', label: '成品金额 HKD', readonly: true, calc: r => freeAmountHkd(r, fxRmbHkd), width: '90px' },
    { key: 'tax_pct', label: '税点 %', type: 'number', width: '90px' },
    { key: 'note', label: '备注' },
  ];
  renderTable(host.querySelector('#wb-pkmat'), pkCols, payload.packaging_materials, { readonly: !canEdit, onChange: wrappedOnChange });
  refreshes.push(renderLossSummary(host.querySelector('#wb-pkmat'), '六、包装材料 成本汇总',
    () => sum(payload.packaging_materials || [], r => freeAmountHkd(r, fxRmbHkd)),
    () => 0, fxRmbHkd, 'HKD'));  // 不计损耗；包装材料为港币
  payload.carton_calc = payload.carton_calc || { pl: 0, pw: 0, ph: 0, cl: 0, cw: 0, ch: 0, box_price: 0, qty: 1, ka_label: 'K=A', flat_card: 0 };
  renderCartonCalc(host.querySelector('#wb-carton-calc'), payload.carton_calc, canEdit, wrappedOnChange);

}

// ============ 电子部 ============
function renderElectronic(host, payload, canEdit, onChange, fxRmbHkd) {
  payload.electronics = payload.electronics || [];
  payload.electronics_loss_pct = payload.electronics_loss_pct ?? 1;
  payload.electronics_extra = payload.electronics_extra || { test_repair: 0, packing_shipping: 0, profit_pct: 10, tax_diff: 0, tax_payable: 0 };
  ['profit_pct', 'tax_diff', 'tax_payable'].forEach(k => { if (payload.electronics_extra[k] == null) payload.electronics_extra[k] = k === 'profit_pct' ? 10 : 0; });
  if (payload.electronics_doc && payload.electronics_doc.parts) {
    payload.electronics_doc.parts_count = elecDetailRowCount(payload.electronics_doc.parts);
  }

  host.innerHTML = `
    <h3>电子部分
    ${canEdit ? '<button class="mini" id="el-import" type="button" style="margin-left:10px">📄 导入电子报价单</button><input id="el-file" type="file" accept=".xls,.xlsx" style="display:none"/>' : ''}
    ${canEdit && payload.electronics_doc ? '<button class="mini" id="el-summarize" type="button" style="margin-left:6px">🔄 由明细汇总成 IC + PACB</button>' : ''}
    ${payload.electronics_doc ? `<small style="margin-left:8px;color:#16a34a">✓ 已导入 ${payload.electronics_doc.parts_count} 行 (${payload.electronics_doc.imported_at || ''})</small>` : ''}
    </h3>
    <div id="el-import-preview"></div>
    <h4 style="margin-top:14px;color:#475569">总表（报价明细 用）</h4>
    <div id="wb-elec"></div>
    <div id="wb-elec-detail"></div>
    <div id="wb-elec-extra"></div>
  `;
  const refreshes = [];
  const wrappedOnChange = () => { refreshes.forEach(f => f()); onChange(); };
  renderHierElectronics(host.querySelector('#wb-elec'), payload.electronics, wrappedOnChange, canEdit, fxRmbHkd);
  // 总表 小计 卡片（仅 IC + PACB电子 等当前 electronics 数组的合计）
  const sumHost = document.createElement('div');
  host.querySelector('#wb-elec').appendChild(sumHost);
  const paintSummarySubtotal = () => {
    const total = sum(payload.electronics || [], r => elecRowAmount(r, fxRmbHkd));
    sumHost.className = 'loss-summary';
    sumHost.innerHTML = `
      <div class="ls-title">总表 小计</div>
      <div class="ls-row hi"><span class="ls-label">合计 HKD</span><span class="ls-val">${formatNum(total)}</span></div>
    `;
  };
  paintSummarySubtotal();
  refreshes.push(paintSummarySubtotal);
  // 细表（导入的 16 行明细）展开/折叠区
  const detailHost = host.querySelector('#wb-elec-detail');
  if (payload.electronics_doc && payload.electronics_doc.parts && payload.electronics_doc.parts.length) {
    const doc = payload.electronics_doc;
    detailHost.innerHTML = `
      <details style="margin-top:14px" ${doc._open ? 'open' : ''}>
        <summary style="cursor:pointer;color:#475569;font-weight:600;padding:6px 0">
          📋 细表（导入的 ${doc.parts_count} 行明细 — 会写进 电子明细 sheet）
        </summary>
        <table class="wb-table" style="margin-top:8px;font-size:13px">
          <thead><tr>
            <th style="width:50px">#</th>
            <th style="width:120px">零件名称</th>
            <th>规格</th>
            <th style="width:80px">用量</th>
            <th style="width:90px">单价 RMB</th>
            <th style="width:90px">合计 RMB</th>
            <th style="width:120px">备注</th>
            ${canEdit ? '<th style="width:48px"></th>' : ''}
          </tr></thead>
          <tbody id="elec-detail-tbody"></tbody>
        </table>
      </details>`;
    const tbody = detailHost.querySelector('#elec-detail-tbody');
    let n = 0;
    const renderDetailRow = (i, p, isChild) => {
      n++;
      const tr = document.createElement('tr');
      const ro = canEdit ? '' : 'disabled';
      tr.innerHTML = `
        <td class="ro">${n}</td>
        <td><input value="${(p.name || '').replace(/"/g, '&quot;')}" data-pi="${i}" data-k="name" ${ro} /></td>
        <td><input value="${(p.spec || '').replace(/"/g, '&quot;')}" data-pi="${i}" data-k="spec" ${ro} /></td>
        <td><input type="number" step="any" value="${num(p.qty)}" data-pi="${i}" data-k="qty" ${ro} style="width:75px"/></td>
        <td><input type="number" step="any" value="${num(p.unit_price)}" data-pi="${i}" data-k="unit_price" ${ro} style="width:85px"/></td>
        <td class="ro">${formatNum(num(p.qty) * num(p.unit_price))}</td>
        <td><input value="${(p.note || '').replace(/"/g, '&quot;')}" data-pi="${i}" data-k="note" ${ro} /></td>
        ${canEdit ? `<td class="row-actions"><button class="mini danger el-detail-del" type="button" data-pi="${i}" title="删除">×</button></td>` : ''}`;
      if (isChild) tr.style.background = '#f8fafc';
      tbody.appendChild(tr);
    };
    doc.parts.forEach((p, i) => {
      renderDetailRow(i, p, false);
      (p.children || []).forEach((c, ci) => {
        // 子项以特殊索引标记 i.子index
        const tr = document.createElement('tr');
        n++;
        tr.style.background = '#f8fafc';
        const ro = canEdit ? '' : 'disabled';
        tr.innerHTML = `
          <td class="ro">${n}</td>
          <td></td>
          <td><input value="${(c.spec || '').replace(/"/g, '&quot;')}" data-pi="${i}" data-ci="${ci}" data-k="spec" ${ro} /></td>
          <td><input type="number" step="any" value="${num(c.qty)}" data-pi="${i}" data-ci="${ci}" data-k="qty" ${ro} style="width:75px"/></td>
          <td><input type="number" step="any" value="${num(c.unit_price)}" data-pi="${i}" data-ci="${ci}" data-k="unit_price" ${ro} style="width:85px"/></td>
          <td class="ro">${formatNum(num(c.qty) * num(c.unit_price))}</td>
          <td><input value="${(c.note || '').replace(/"/g, '&quot;')}" data-pi="${i}" data-ci="${ci}" data-k="note" ${ro} /></td>
          ${canEdit ? `<td class="row-actions"><button class="mini danger el-detail-del" type="button" data-pi="${i}" data-ci="${ci}" title="删除">×</button></td>` : ''}`;
        tbody.appendChild(tr);
      });
    });
    if (canEdit) {
      // 总表仍是「IC + PACB电子」两行（由明细汇总出来的）时，细表改动自动联动
      const isDerivedSummary = () => Array.isArray(payload.electronics) && payload.electronics.length === 2
        && /^IC$/i.test(payload.electronics[0].name || '') && /PACB/i.test(payload.electronics[1].name || '');
      const autoResummarize = () => {
        if (!isDerivedSummary()) return;
        const fxH = num((payload._fx_rmb_hkd) || fxRmbHkd) || 0.85;
        const sp = elecSplitRows(doc.parts, payload.electronics_extra || doc.extras || {}, fxH);
        Object.assign(payload.electronics[0], sp.ic);
        Object.assign(payload.electronics[1], sp.pacb);
        paintSummarySubtotal();
      };
      tbody.querySelectorAll('input').forEach(inp => {
        inp.oninput = (e) => {
          const pi = +inp.dataset.pi, ci = inp.dataset.ci, k = inp.dataset.k;
          const target = ci != null ? doc.parts[pi].children[+ci] : doc.parts[pi];
          target[k] = (k === 'qty' || k === 'unit_price') ? num(e.target.value) : e.target.value;
          // 用量/单价改动 → 刷新本行「合计 RMB」格（第 6 列，index 5）+ 总表小计联动
          if (k === 'qty' || k === 'unit_price') {
            const tr = inp.closest('tr');
            if (tr && tr.children[5]) tr.children[5].textContent = formatNum(num(target.qty) * num(target.unit_price));
            autoResummarize();
          }
          onChange();
        };
        // 失焦时整表重渲染，同步总表行单价/金额 + 成本汇总
        if (inp.dataset.k === 'qty' || inp.dataset.k === 'unit_price') {
          inp.onchange = () => { if (isDerivedSummary()) renderElectronic(host, payload, canEdit, onChange, fxRmbHkd); };
        }
      });
      tbody.querySelectorAll('.el-detail-del').forEach(btn => {
        btn.onclick = () => {
          const pi = +btn.dataset.pi;
          const ci = btn.dataset.ci;
          const part = doc.parts[pi];
          if (!part) return;
          if (ci != null) {
            part.children.splice(+ci, 1);
          } else {
            if ((part.children || []).length && !confirm(`删除「${part.name || '该零件'}」及其子项？`)) return;
            doc.parts.splice(pi, 1);
          }
          doc.parts_count = elecDetailRowCount(doc.parts);
          autoResummarize();
          onChange();
          renderElectronic(host, payload, canEdit, onChange, fxRmbHkd);
        };
      });
      // 展开折叠状态记忆
      detailHost.querySelector('details').ontoggle = (e) => { doc._open = e.target.open; };
    }
  } else {
    detailHost.innerHTML = '<p class="muted" style="margin-top:10px;font-size:13px">尚未导入电子细表 — 点上方"📄 导入电子报价单"</p>';
  }
  renderElecExtra(host.querySelector('#wb-elec-extra'), payload, wrappedOnChange, canEdit, fxRmbHkd);
  if (canEdit) {
    // 由明细一键汇总成 IC + PACB电子 两行
    const sumBtn = host.querySelector('#el-summarize');
    if (sumBtn) sumBtn.onclick = () => {
      const doc = payload.electronics_doc;
      if (!doc || !doc.parts) { alert('没有导入的明细数据'); return; }
      if (payload.electronics && payload.electronics.length > 2 && !confirm('当前总表有 ' + payload.electronics.length + ' 行，确认重置为 IC + PACB电子 两行（手填数据会丢失）？')) return;
      // 总表行按细表占比分摊含税核价：合计=两行之和=含税核价，每行带各自那份加工/利润/税
      const fxHere = num((payload._fx_rmb_hkd) || fxRmbHkd) || 0.85;
      const sp = elecSplitRows(doc.parts, payload.electronics_extra || doc.extras || {}, fxHere);
      payload.electronics = [
        { name: 'IC', spec: sp.icPart ? sp.icPart.spec : '', qty: 1, ...sp.ic, tax_label: '含税', note: '' },
        { name: 'PACB电子', spec: '含 PCB+电阻+电容+人工 等其余明细汇总', qty: 1, ...sp.pacb, tax_label: '含税', note: '' },
      ];
      onChange();
      renderElectronic(host, payload, canEdit, onChange, fxRmbHkd);
    };

    // 导入
    const impBtn = host.querySelector('#el-import');
    const impFile = host.querySelector('#el-file');
    const impPreview = host.querySelector('#el-import-preview');
    if (impBtn && impFile) {
      impBtn.onclick = () => impFile.click();
      impFile.onchange = async (e) => {
        const f = e.target.files[0]; if (!f) return;
        impPreview.innerHTML = '<i class="muted" style="padding:8px;display:block">正在解析…</i>';
        try {
          const fd = new FormData(); fd.append('file', f);
          const r = await fetch('/api/uploads/electronic-sheet', { method: 'POST', credentials: 'include', body: fd });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error || '解析失败');
          impPreview.innerHTML = `
            <div class="card" style="background:#f0fdf4;border:1px solid #86efac;margin-top:10px">
              <p>从 <b>${escapeHtml(j.sheet_used || '')}</b> 解析到 <b>${j.count}</b> 个零件（${(j.parts || []).reduce((a, p) => a + 1 + (p.children || []).length, 0)} 行明细）</p>
              ${j.meta && j.meta.product ? `<p class="muted">产品: ${escapeHtml(j.meta.product)}${j.meta.customer ? ' · 客户: ' + escapeHtml(j.meta.customer) : ''}${j.meta.date ? ' · 日期: ' + escapeHtml(j.meta.date) : ''}</p>` : ''}
              <p class="muted">导入后：会替换电子表 + 自动填充 测试费用 / 包装运输 / 利润% / 抵税差额；导出 Excel 时会附加"电子明细"分表。</p>
              <div style="margin-top:10px;display:flex;gap:8px">
                <button id="el-imp-apply">应用</button>
                <button id="el-imp-cancel" class="mini danger">取消</button>
              </div>
            </div>`;
          impPreview.querySelector('#el-imp-apply').onclick = () => {
            // 导入应用后总表重置为 IC + PACB电子 两行（值从明细汇总，导入后可手改）
            // 明细是 RMB，总表单价是 HKD：单价 HKD = RMB ÷ 汇率（与税点下拉/由明细汇总按钮口径一致）
            const fx = num(fxRmbHkd) || 0.85;
            // 总表行按细表占比分摊含税核价：合计=两行之和=含税核价，每行带各自那份加工/利润/税
            const sp = elecSplitRows(j.parts, j.extras || {}, fx);
            payload.electronics = [
              { name: 'IC', spec: sp.icPart ? sp.icPart.spec : '', qty: 1, ...sp.ic, note: '' },
              { name: 'PACB电子', spec: '含 PCB+电阻+电容+人工 等其余明细汇总', qty: 1, ...sp.pacb, note: '' },
            ];
            if (j.extras) {
              payload.electronics_extra = payload.electronics_extra || {};
              ['test_repair', 'packing_shipping', 'profit_pct', 'tax_diff', 'tax_payable', 'bonding_cost', 'smt_cost', 'labor_cost'].forEach(k => {
                if (j.extras[k] != null) payload.electronics_extra[k] = j.extras[k];
              });
            }
            // 保存原始 parts/extras 供导出
            payload.electronics_doc = {
              parts: j.parts, extras: j.extras, meta: j.meta || {},
              parts_count: elecDetailRowCount(j.parts || []),
              imported_at: new Date().toISOString().slice(0, 10),
            };
            impPreview.innerHTML = ''; impFile.value = '';
            onChange();
            renderElectronic(host, payload, canEdit, onChange, fxRmbHkd);
          };
          impPreview.querySelector('#el-imp-cancel').onclick = () => { impPreview.innerHTML = ''; impFile.value = ''; };
        } catch (err) {
          impPreview.innerHTML = `<div class="card" style="background:#fef2f2;border:1px solid #fecaca;margin-top:10px">解析失败：${err.message}</div>`;
        }
      };
    }
  }
}

// 啤机部 机型价表默认值（HK$/台 班 — 来自客户报价单）
const DEFAULT_MACHINE_PRICES = [
  { model: '4A-6A',     normal: '80T',    price: 940 },
  { model: '7A-9A',     normal: '60-80T', price: 1050 },
  { model: '10A-12A',   normal: '120T',   price: 1160 },
  { model: '14A-16A',   normal: '150T',   price: 1490 },
  { model: '20A',       normal: '200T',   price: 1920 },
  { model: '24A',       normal: '260T',   price: 1920 },
  { model: '30A-32A',   normal: '320T',   price: 2220 },
  { model: '44A',       normal: '490T',   price: 2500 },
  { model: '46A-49.9A', normal: '',       price: 2800 },
  { model: '60A-65A',   normal: '500T',   price: 3090 },
  { model: '80A',       normal: '',       price: 3590 },
  { model: '81.3A',     normal: '',       price: 3600 },
  { model: '105A',      normal: '800T',   price: 4500 },
];

// 按 机型 在机型价表里找最匹配
function lookupMachinePrice(model, prices) {
  if (!model || !prices || !prices.length) return null;
  const t = String(model).replace(/\s+/g, '').toUpperCase();
  // 精确匹配（区间，如 4A-6A → 把 t==4A or 5A or 6A 都识别）
  const tNum = parseFloat(t);
  for (const p of prices) {
    const m = String(p.model).toUpperCase().replace(/\s+/g, '');
    const rangeMatch = m.match(/^([\d.]+)A?-([\d.]+)A?$/);  // 兼容 "4A-6A" 与 "30-32A"
    if (rangeMatch) {
      const lo = +rangeMatch[1], hi = +rangeMatch[2];
      if (!isNaN(tNum) && tNum >= lo && tNum <= hi) return p;
    }
    if (m === t) return p;
  }
  // 退而求其次：包含
  return prices.find(p => t.includes(String(p.model).toUpperCase().replace(/\s+/g,''))) || null;
}

// 啤机部料价表默认值（HK$/Lb，2026 年）
const DEFAULT_MATERIAL_PRICES = [
  { name: 'ABS', model: '750SW', price: 8.50 },
  { name: 'ABS', model: '抽粒料', price: 4.60 },
  { name: '透明ABS', model: 'TR558/920', price: 12.50 },
  { name: 'HIPS', model: 'HI425', price: 7.80 },
  { name: 'GP', model: 'MW-1', price: 7.80 },
  { name: '1#PP', model: 'JM350/K8009', price: 6.80 },
  { name: '1#PP', model: '7032 E3', price: 6.80 },
  { name: '透明PP', model: '5090T', price: 7.80 },
  { name: 'POM', model: 'F3003/M9044', price: 16.50 },
  { name: 'POM', model: 'PM820/DM220', price: 21.50 },
  { name: 'PVC', model: '普通透明', price: 9.00 },
  { name: 'PVC', model: '普通本白', price: 8.00 },
  { name: 'LDPE', model: 'G812', price: 7.80 },
  { name: 'HDPE', model: 'HMA016', price: 8.00 },
  { name: 'TPR', model: '本白橡胶料', price: 15.00 },
  { name: 'TPR', model: '透明橡胶料', price: 17.00 },
  { name: 'K料', model: 'KR-03NW', price: 15.00 },
  { name: 'PC料', model: '2605', price: 12.50 },
];

// 按 材质/颜色 在料价表里找最匹配的单价（优先匹配 name+model 都命中，否则只匹配 name）
// 仅在 材质 + 料型 同时匹配时返回价格；缺一个都返回 null
function lookupMaterialPrice(material, grade, prices) {
  if (!prices || !prices.length) return null;
  if (!material || !grade) return null;  // 必须两者都有
  const m = String(material).replace(/\s+/g, '').toUpperCase();
  const g = String(grade).replace(/\s+/g, '').toUpperCase();
  return prices.find(p => {
    const pn = String(p.name || '').replace(/\s+/g, '').toUpperCase();
    const pm = String(p.model || '').replace(/\s+/g, '').toUpperCase();
    return pn === m && pm === g;
  }) || null;
}

function renderMolding(host, payload, canEdit, onChange, refMolds, fxRmbHkd, userRole) {
  payload.injection = payload.injection || [];
  payload.injection_loss_pct = payload.injection_loss_pct ?? 3;
  payload.blow_items = payload.blow_items || [];
  // 参考表：先用本报价单已存的；没有则用全局缓存；都没有用 hardcoded 默认
  // 全局缓存：window.__refs.material_prices / .machine_prices
  window.__refs = window.__refs || {};
  // 该报价单是否已存了自己的价格表副本（旧单冻结；新单为空时才用全局/默认兜底）
  const ownMaterial = !!(payload.material_prices && payload.material_prices.length);
  const ownMachine = !!(payload.machine_prices && payload.machine_prices.length);
  payload.material_prices = ownMaterial
    ? payload.material_prices
    : (window.__refs.material_prices && window.__refs.material_prices.length
       ? JSON.parse(JSON.stringify(window.__refs.material_prices))
       : JSON.parse(JSON.stringify(DEFAULT_MATERIAL_PRICES)));
  payload.machine_prices = ownMachine
    ? payload.machine_prices
    : (window.__refs.machine_prices && window.__refs.machine_prices.length
       ? JSON.parse(JSON.stringify(window.__refs.machine_prices))
       : JSON.parse(JSON.stringify(DEFAULT_MACHINE_PRICES)));
  // 后台异步拉全局参考表：本单没有自己的副本时（新单），用最新全局表替换兜底值并刷新
  if (!window.__refs._loaded) {
    window.__refs._loaded = true;
    Promise.all([
      api('/refs/material_prices').then(r => r.data || []).catch(() => []),
      api('/refs/machine_prices').then(r => r.data || []).catch(() => []),
    ]).then(([mat, mac]) => {
      if (mat.length) window.__refs.material_prices = mat;
      if (mac.length) window.__refs.machine_prices = mac;
      // 新单（无自有副本）：把刚加载的全局表填进去并重渲染，避免停留在写死的默认值
      let changed = false;
      if (!ownMaterial && mat.length) { payload.material_prices = JSON.parse(JSON.stringify(mat)); changed = true; }
      if (!ownMachine && mac.length) { payload.machine_prices = JSON.parse(JSON.stringify(mac)); changed = true; }
      if (changed) renderMolding(host, payload, canEdit, onChange, refMolds, fxRmbHkd, userRole);
    });
  } else {
    // 缓存已加载过：新单直接用最新全局表（上面兜底可能用了默认值，这里纠正）
    if (!ownMaterial && window.__refs.material_prices && window.__refs.material_prices.length) {
      payload.material_prices = JSON.parse(JSON.stringify(window.__refs.material_prices));
    }
    if (!ownMachine && window.__refs.machine_prices && window.__refs.machine_prices.length) {
      payload.machine_prices = JSON.parse(JSON.stringify(window.__refs.machine_prices));
    }
  }
  // 回填"普通机"列：若已有数据但 normal 字段缺失，按 DEFAULT_MACHINE_PRICES 同机型填上
  payload.machine_prices.forEach(row => {
    if (row.normal == null || row.normal === '') {
      const d = DEFAULT_MACHINE_PRICES.find(x => x.model === row.model);
      if (d && d.normal) row.normal = d.normal;
    }
  });

  // 首次进入时若注塑表为空且工程已有模具，自动拉一次
  if (canEdit && payload.injection.length === 0 && refMolds && refMolds.length) {
    payload.injection = refMolds.map(m => ({
      mold_no: m.mold_no || '', name: m.name,
      material: m.material || '',
      material_grade: m.material_grade || '',
      color: m.color || '',
      cavity: m.cavity || '',
      weight_g: m.weight_g ?? null,
      cycle_sec: m.cycle_sec ?? null,
      sets: m.sets || 1,
      machine: m.machine || '',
      machine_model: m.machine_model || '',
      target: m.target ?? null,
      material_unit_price: m.material_unit_price ?? null,
      shot_price: m.shot_price ?? null,
      note: m.note || '',
    }));
  }

  const canEditPrices = canEdit;
  host.innerHTML = `
    <h3>二、注塑部分 <small>料损耗 %
      <input id="inj-loss" type="number" step="any" style="width:60px" value="${payload.injection_loss_pct ?? 3}" ${canEdit ? '' : 'disabled'} />
    </small>
    ${canEdit && refMolds && refMolds.length ? `<small style="margin-left:12px"><button id="btn-sync-mold" class="mini" type="button">📥 从工程拉取/同步模具 (${refMolds.length})</button></small>` : ''}
    ${canEdit ? `<small style="margin-left:8px"><button id="btn-auto-price" class="mini" type="button">🔄 自动按材质套料价</button></small>` : ''}
    ${canEdit ? `<small style="margin-left:6px"><button id="btn-auto-shot" class="mini" type="button">🔄 自动按机型套啤价</button></small>` : ''}
    </h3>
    <div id="wb-inj"></div>
    <div id="wb-inj-summary"></div>

    <h3>二·B、吹气部分 <small class="muted">(单价含港币)</small></h3>
    <div id="wb-blow"></div>

    <details class="ref-tables" style="margin-top:18px">
      <summary class="ref-summary">📋 参考表（料价 / 机型价）${canEditPrices ? ' · 本单可改' : ''}</summary>
      ${canEditPrices ? '<div style="margin-top:8px"><button id="btn-pull-refs" class="mini" type="button">🔄 同步全局参考表到本单</button> <small class="muted">用最新的全局参考表覆盖本单</small></div>' : ''}
      <div style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div>
          <h4 style="margin:0 0 6px;font-size:13px;color:#475569">料价表 <small class="muted">(HK$/Lb, 1 Lb≈454 g)</small></h4>
          <div id="wb-material-prices"></div>
        </div>
        <div>
          <h4 style="margin:0 0 6px;font-size:13px;color:#475569">机型价表 <small class="muted">(HK$/台班)</small></h4>
          <div id="wb-machine-prices"></div>
        </div>
      </div>
    </details>
  `;

  // 料价表
  const mpCols = [
    { key: 'name', label: '料名', width: '90px' },
    { key: 'model', label: '型号', width: '170px' },
    { key: 'price', label: 'HK$/Lb', type: 'number', width: '100px' },
    { key: 'price_per_g', label: 'HK$/g', readonly: true, calc: r => num(r.price) / 454, width: '100px' },
  ];
  // 参考表改动仅保存到当前报价单，不反向覆盖全局参考表。
  const onMatChange = () => { onChange(); };
  const onMachChange = () => { onChange(); };
  renderTable(host.querySelector('#wb-material-prices'), mpCols, payload.material_prices, { readonly: !canEditPrices, onChange: onMatChange });

  // 机型价表
  const machCols = [
    { key: 'model', label: '机型', width: '140px' },
    { key: 'normal', label: '普通机', width: '110px' },
    { key: 'price', label: 'HK$/台班', type: 'number', width: '120px' },
  ];
  renderTable(host.querySelector('#wb-machine-prices'), machCols, payload.machine_prices, { readonly: !canEditPrices, onChange: onMachChange });

  // 同步全局参考表 → 本单
  const pullBtn = host.querySelector('#btn-pull-refs');
  if (pullBtn) pullBtn.onclick = async () => {
    if (!confirm('用全局参考表覆盖本单的料价表 + 机型价表？\n（仅影响本报价单，不会动其他报价单）')) return;
    try {
      const [mat, mac] = await Promise.all([
        api('/refs/material_prices').then(r => r.data || []),
        api('/refs/machine_prices').then(r => r.data || []),
      ]);
      if (mat.length) payload.material_prices = JSON.parse(JSON.stringify(mat));
      if (mac.length) payload.machine_prices = JSON.parse(JSON.stringify(mac));
      onChange();
      renderMolding(host, payload, canEdit, onChange, refMolds, fxRmbHkd, userRole);
      alert('✓ 已同步：' + mat.length + ' 料价 + ' + mac.length + ' 机型');
    } catch (e) { alert('拉取失败：' + e.message); }
  };

  if (canEdit) {
    const syncBtn = host.querySelector('#btn-sync-mold');
    if (syncBtn) syncBtn.onclick = () => {
      if (!confirm(`将根据工程已填的 ${refMolds.length} 副模具同步注塑表。已填行（按"模具名称"匹配）会保留其他字段，新增的会追加，工程已删除的会移除。继续？`)) return;
      const byName = new Map(payload.injection.map(r => [r.name, r]));
      payload.injection = refMolds.map(m => {
        const existing = byName.get(m.name) || {};
        return {
          ...existing,
          mold_no: m.mold_no || existing.mold_no || '',
          name: m.name,
          material: m.material || existing.material || '',
          material_grade: m.material_grade || existing.material_grade || '',
          color: m.color || existing.color || '',
          cavity: m.cavity || existing.cavity || '',
          weight_g: m.weight_g ?? existing.weight_g ?? null,
          cycle_sec: m.cycle_sec ?? existing.cycle_sec ?? null,
          sets: existing.sets ?? (m.sets || 1),
          machine: m.machine || existing.machine || '',
          machine_model: m.machine_model || existing.machine_model || '',
          target: m.target ?? existing.target ?? null,
          material_unit_price: m.material_unit_price ?? existing.material_unit_price ?? null,
          shot_price: m.shot_price ?? existing.shot_price ?? null,
          note: m.note || existing.note || '',
        };
      });
      onChange(); renderMolding(host, payload, canEdit, onChange, refMolds, fxRmbHkd, userRole);
    };
    const autoBtn = host.querySelector('#btn-auto-price');
    if (autoBtn) autoBtn.onclick = () => {
      let hit = 0, miss = [];
      for (const row of payload.injection) {
        // 材质 + 料型 都匹配才提取
        const m = lookupMaterialPrice(row.material, row.material_grade, payload.material_prices);
        if (m) { row.material_unit_price = +(m.price / 454).toFixed(5); hit++; }
        else {
          const key = [row.material, row.material_grade].filter(Boolean).join(' ').trim();
          if (key) miss.push(key);
        }
      }
      onChange(); renderMolding(host, payload, canEdit, onChange, refMolds, fxRmbHkd, userRole);
      alert(`已套料价：成功 ${hit} 行${miss.length ? ' / 未匹配 ' + miss.length + ' 行: ' + [...new Set(miss)].join(', ') : ''}`);
    };
    const autoShot = host.querySelector('#btn-auto-shot');
    if (autoShot) autoShot.onclick = () => {
      let hit = 0, miss = [];
      for (const row of payload.injection) {
        const m = lookupMachinePrice(row.machine_model, payload.machine_prices);
        const sets = num(row.sets) || 1;
        const target = num(row.target) || 0;
        if (m && target > 0) {
          row.shot_price = +(num(m.price) / sets / target).toFixed(4);
          if (m.normal) row.machine = m.normal;  // 同步"机台"（=普通机）
          hit++;
        } else if (row.machine_model) {
          miss.push(`${row.machine_model}${target<=0?'(无目标数)':''}`);
        }
      }
      // 即使没目标数也尽量填机台
      for (const row of payload.injection) {
        if (!row.machine && row.machine_model) {
          const m = lookupMachinePrice(row.machine_model, payload.machine_prices);
          if (m && m.normal) row.machine = m.normal;
        }
      }
      onChange(); renderMolding(host, payload, canEdit, onChange, refMolds, fxRmbHkd, userRole);
      alert(`已套啤价：成功 ${hit} 行${miss.length ? ' / 未处理 ' + miss.length + ' 行: ' + [...new Set(miss)].join(', ') : ''}\n公式：机型价 ÷ 套数 ÷ 目标数`);
    };
  }

  // 颜色判断：Pantone (如 675C / 231C / 7547C) 或含 色/白/黑/灰 等。
  // 注意不要把 ABS 750SW、PP 7032 E3 这类料型号误判成颜色。
  const isColorToken = (s) => {
    const t = String(s || '').replace(/\s+/g, '').toUpperCase();
    return /^(?:PANTONE)?\d{2,4}(?:C|U|TCX|TPX)$/.test(t) || /色|白|黑|灰|红|蓝|绿|黄|紫|棕|金|银/.test(String(s || ''));
  };
  const isMaterialGrade = (material, model) => {
    const mat = String(material || '').replace(/\s+/g, '').toUpperCase();
    const mod = String(model || '').replace(/\s+/g, '').toUpperCase();
    if (!mat || !mod) return false;
    return (payload.material_prices || []).some(p =>
      String(p.name || '').replace(/\s+/g, '').toUpperCase() === mat &&
      String(p.model || '').replace(/\s+/g, '').toUpperCase() === mod
    );
  };

  // 旧数据迁移：material_color → material / material_grade / color
  (payload.injection || []).forEach(r => {
    if (r.material_color && !r.material && !r.material_grade && !r.color) {
      const parts = String(r.material_color).trim().split(/\s+/);
      if (parts.length >= 3) {
        r.material = parts[0];
        const tail = parts[parts.length - 1];
        const mid = parts.slice(1, -1).join(' ');
        // 末段是颜色（Pantone 或 含色字）→ 中段是料型；否则中+末合并为料型
        if (isColorToken(tail)) { r.material_grade = mid; r.color = tail; }
        else { r.material_grade = parts.slice(1).join(' '); r.color = ''; }
      } else if (parts.length === 2) {
        r.material = parts[0];
        if (isMaterialGrade(r.material, parts[1])) r.material_grade = parts[1];
        else if (isColorToken(parts[1])) r.color = parts[1];
        else r.material_grade = parts[1];
      } else if (parts.length === 1) {
        r.material = parts[0];
      }
    }
    // 二次修正：若 grade 看起来是颜色而 color 为空 → 把 grade 挪到 color
    if (r.material_grade && !r.color && isColorToken(r.material_grade)) {
      r.color = r.material_grade;
      r.material_grade = '';
    }
    // 修正旧数据：曾经会把 ABS 750SW 这类料型号误塞到 color。
    if (!r.material_grade && r.color && isMaterialGrade(r.material, r.color)) {
      r.material_grade = r.color;
      r.color = '';
    }
  });

  const cols = [
    { key: 'name', label: '模具名称', type: 'textarea', width: '220px' },
    { key: 'mold_no', label: '模号', width: '70px' },
    { key: 'material', label: '材质', width: '110px', type: 'select', affectsOptions: true,
      options: () => {
        const names = (payload.material_prices || [])
          .map(p => String(p.name || '').trim()).filter(Boolean);
        return [...new Set(names)];
      }
    },
    { key: 'material_grade', label: '料型', width: '150px', type: 'select',
      options: (row) => {
        const mat = String(row.material || '').trim().toUpperCase();
        if (!mat) return [];
        return (payload.material_prices || [])
          .filter(p => String(p.name || '').trim().toUpperCase() === mat)
          .map(p => p.model).filter(Boolean);
      }
    },
    { key: 'color', label: '颜色', width: '90px' },
    { key: 'weight_g', label: '啤净重(g)', type: 'number', width: '100px' },
    { key: 'weight_loss_g', label: `料损耗 ${num(payload.injection_loss_pct ?? 3)}%`, readonly: true, width: '90px',
      calc: r => num(r.weight_g) * (1 + num(payload.injection_loss_pct ?? 3)/100) },
    { key: 'material_unit_price', label: '料价 HK$/g', type: 'number', width: '110px' },
    { key: 'raw_unit', label: '原料单价 HK$', readonly: true, width: '100px',
      calc: r => num(r.weight_g) * (1 + num(payload.injection_loss_pct ?? 3)/100) * num(r.material_unit_price) },
    { key: 'machine', label: '机台', width: '90px' },
    { key: 'shot_price', label: '啤价(HK$/啤)', type: 'number', width: '100px' },
    { key: 'cavity', label: '出模数', width: '80px' },
    { key: 'sets', label: '套数', type: 'number', width: '70px' },
    { key: 'machine_model', label: '机型', width: '90px' },
    { key: 'target', label: '目标数', type: 'number', width: '100px' },
    { key: 'cycle_sec', label: '周期(秒)', type: 'number', width: '80px' },
    { key: 'finished_amt', label: '成品金额 HK$', readonly: true, width: '100px',
      calc: r => num(r.weight_g) * (1 + num(payload.injection_loss_pct ?? 3)/100) * num(r.material_unit_price) + num(r.shot_price) },
    { key: 'note', label: '备注' },
  ];
  const wrappedOnChange = (() => { const fns = []; const w = () => { fns.forEach(f => f()); onChange(); }; w._fns = fns; return w; })();
  renderTable(host.querySelector('#wb-inj'), cols, payload.injection, { readonly: !canEdit, onChange: wrappedOnChange });

  // 二、注塑 成本汇总 — 分项求和：原料单价 / 啤价 / 成品金额
  const injCard = host.querySelector('#wb-inj-summary');
  const paintInj = () => {
    const fxv = num(fxRmbHkd) || 0.85;
    const rows = payload.injection || [];
    const lossM = 1 + num(payload.injection_loss_pct ?? 3) / 100;  // 料损耗（默认3%）
    const rawSum = sum(rows, r => num(r.weight_g) * lossM * num(r.material_unit_price));
    const shotSum = sum(rows, r => num(r.shot_price));
    const finishedSum = rawSum + shotSum;
    injCard.className = 'loss-summary';
    injCard.innerHTML = `
      <div class="ls-title">二、注塑 成本汇总</div>
      <div class="ls-row"><span class="ls-label">原料单价 总</span><span class="ls-val">${formatNum(rawSum)}</span></div>
      <div class="ls-row"><span class="ls-label">啤价 总</span><span class="ls-val">${formatNum(shotSum)}</span></div>
      <div class="ls-row hi"><span class="ls-label">成品金额 总 HK$</span><span class="ls-val">${formatNum(finishedSum)}</span></div>
      <div class="ls-row hi"><span class="ls-label">合计 RMB</span><span class="ls-val">${formatNum(finishedSum / fxv)} <small class="muted">(汇率 ${fxv})</small></span></div>
    `;
  };
  paintInj();
  wrappedOnChange._fns.push(paintInj);
  const lossInp = host.querySelector('#inj-loss');
  if (canEdit && lossInp) lossInp.oninput = (e) => { payload.injection_loss_pct = num(e.target.value); wrappedOnChange(); renderMolding(host, payload, canEdit, onChange, refMolds, fxRmbHkd, userRole); };

  // 吹气部分
  renderBlowItems(host.querySelector('#wb-blow'), payload.blow_items, wrappedOnChange, canEdit);
}

// 吹气产品报价表（每行 = 一个 货名）
function renderBlowItems(container, rows, onChange, canEdit) {
  container.innerHTML = '';
  const table = document.createElement('table'); table.className = 'wb-table';
  table.innerHTML = `<thead><tr>
    <th style="width:40px">#</th>
    <th style="width:120px">货名</th>
    <th style="width:120px">日产量/22H</th>
    <th style="width:110px">用料</th>
    <th style="width:90px">预估料重 g</th>
    <th style="width:90px">料价 HK$/lb</th>
    <th style="width:100px">产品料价</th>
    <th style="width:80px">吹工</th>
    <th style="width:80px">披锋</th>
    <th style="width:90px">小计</th>
    <th style="width:80px">利润 ×</th>
    <th style="width:100px">合计 HK$</th>
    <th style="width:90px">出数</th>
    <th>模价 (¥)</th>
    ${canEdit ? '<th style="width:36px"></th>' : ''}
  </tr></thead><tbody></tbody>`;
  const tbody = table.querySelector('tbody');

  const calc = (r) => {
    const matCost = num(r.weight_g) * num(r.material_price_lb) / 454;
    const sub = matCost + num(r.blow_labor) + num(r.flash);
    const total = sub * (num(r.profit_x) || 1);
    return { matCost, sub, total };
  };

  rows.forEach((r, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="ro">${idx + 1}</td>`;
    const refs = {};
    const updateCalc = () => {
      const c = calc(r);
      refs.matCost.textContent = formatNum(c.matCost);
      refs.sub.textContent = formatNum(c.sub);
      refs.total.textContent = formatNum(c.total);
    };
    const mk = (k, type) => {
      const td = document.createElement('td');
      if (!canEdit) { td.className = 'ro'; td.textContent = formatNum(r[k] ?? ''); }
      else {
        const inp = document.createElement('input');
        inp.type = type === 'number' ? 'number' : 'text';
        if (type === 'number') inp.step = 'any';
        inp.value = r[k] ?? '';
        inp.oninput = () => { r[k] = type === 'number' ? (inp.value === '' ? null : Number(inp.value)) : inp.value; updateCalc(); onChange(); };
        td.appendChild(inp);
      }
      return td;
    };
    tr.appendChild(mk('name', 'text'));
    tr.appendChild(mk('capacity', 'text'));
    tr.appendChild(mk('material', 'text'));
    tr.appendChild(mk('weight_g', 'number'));
    tr.appendChild(mk('material_price_lb', 'number'));
    refs.matCost = document.createElement('td'); refs.matCost.className = 'ro';
    tr.appendChild(refs.matCost);
    tr.appendChild(mk('blow_labor', 'number'));
    tr.appendChild(mk('flash', 'number'));
    refs.sub = document.createElement('td'); refs.sub.className = 'ro';
    tr.appendChild(refs.sub);
    tr.appendChild(mk('profit_x', 'number'));
    refs.total = document.createElement('td'); refs.total.className = 'ro hi';
    tr.appendChild(refs.total);
    tr.appendChild(mk('cavity_note', 'text'));
    tr.appendChild(mk('mold_price_note', 'text'));
    if (canEdit) {
      const td = document.createElement('td');
      const b = document.createElement('button'); b.textContent = '×'; b.className = 'mini danger';
      b.onclick = () => { rows.splice(idx, 1); renderBlowItems(container, rows, onChange, canEdit); onChange(); };
      td.appendChild(b); tr.appendChild(td);
    }
    updateCalc();
    tbody.appendChild(tr);
  });

  container.appendChild(table);
  // 合计 HK$
  const totalDiv = document.createElement('div');
  totalDiv.className = 'loss-summary';
  totalDiv.style.marginTop = '8px';
  const blowTotal = sum(rows, r => {
    const mat = num(r.weight_g) * num(r.material_price_lb) / 454;
    return (mat + num(r.blow_labor) + num(r.flash)) * (num(r.profit_x) || 1);
  });
  totalDiv.innerHTML = `<div class="ls-title">二·B、吹气 成本汇总</div><div class="ls-row hi"><span class="ls-label">合计 HK$</span><span class="ls-val">${formatNum(blowTotal)}</span></div>`;
  container.appendChild(totalDiv);
  if (canEdit) {
    const btn = document.createElement('button');
    btn.textContent = '+ 增加吹气货号'; btn.className = 'mini'; btn.style.marginTop = '8px';
    btn.onclick = () => {
      rows.push({ profit_x: 1.05, weight_g: 0, material_price_lb: 0, blow_labor: 0, flash: 0 });
      renderBlowItems(container, rows, onChange, canEdit); onChange();
    };
    container.appendChild(btn);
  }
}

function renderPainting(host, payload, canEdit, onChange, fxRmbHkd) {
  payload.painting_items = payload.painting_items || [];
  payload.second_proc_loss_pct = payload.second_proc_loss_pct ?? 1;
  // 旧数据 second_proc 已废弃，不再迁移；首次进入空表

  host.innerHTML = `
    <h3 style="display:flex;align-items:center;gap:10px">三、二次加工（印喷报价）
      ${canEdit ? `<button class="mini" id="pp-import" type="button">📄 导入喷油核价表</button>
      <input id="pp-file" type="file" accept=".xls,.xlsx" style="display:none"/>` : ''}
    </h3>
    <div id="pp-import-preview"></div>
    <div id="wb-pp"></div>
  `;

  const wrappedOnChange = (() => { const fns = []; const w = () => { fns.forEach(f => f()); onChange(); }; w._fns = fns; return w; })();
  renderPaintingTable(host.querySelector('#wb-pp'), payload.painting_items, wrappedOnChange, canEdit);
  wrappedOnChange._fns.push(renderLossSummary(host, '三、二次加工 成本汇总',
    () => sum(payload.painting_items || [], paintingRowAmount),
    () => 0, fxRmbHkd, 'HKD'));  // 不计损耗；喷油报价为港币

  if (canEdit) {
    const impBtn = host.querySelector('#pp-import');
    const impFile = host.querySelector('#pp-file');
    const impPreview = host.querySelector('#pp-import-preview');
    impBtn.onclick = () => impFile.click();
    impFile.onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      impPreview.innerHTML = '<i class="muted" style="padding:8px;display:block">正在解析…</i>';
      try {
        const fd = new FormData(); fd.append('file', f);
        const r = await fetch('/api/uploads/painting-sheet', { method: 'POST', credentials: 'include', body: fd });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || '解析失败');
        const imgInfo = j.images_extracted ? ` · 含 <b>${j.images_extracted}</b> 张图片` : '';
        impPreview.innerHTML = `
          <div class="card" style="background:#f0fdf4;border:1px solid #86efac;margin-top:10px">
            <p>从 <b>${escapeHtml(j.sheet_used || '')}</b> 解析到 <b>${j.count}</b> 行喷油工序${imgInfo}${j.meta && j.meta.title ? ' · ' + escapeHtml(j.meta.title) : ''}</p>
            ${j.images_hint ? `<p class="muted">⚠️ ${escapeHtml(j.images_hint)}</p>` : ''}
            <p class="muted">应用后会替换当前喷油明细（夹模/移印/散枪/边模/油色/浸油/抹油/擦PP水 八道工序）。</p>
            <div style="margin-top:10px;display:flex;gap:8px">
              <button id="pp-imp-apply">应用</button>
              <button id="pp-imp-cancel" class="mini danger">取消</button>
            </div>
          </div>`;
        impPreview.querySelector('#pp-imp-apply').onclick = () => {
          const has = (payload.painting_items || []).some(it => it && (it.position || paintingRowAmount(it)));
          if (has && !confirm('将替换现有 ' + payload.painting_items.length + ' 行喷油明细，确认？')) return;
          payload.painting_items = (j.items || []).map(it => ({ ...it, images: it.images || [] }));
          impPreview.innerHTML = ''; impFile.value = '';
          onChange();
          renderPainting(host, payload, canEdit, onChange, fxRmbHkd);
        };
        impPreview.querySelector('#pp-imp-cancel').onclick = () => { impPreview.innerHTML = ''; impFile.value = ''; };
      } catch (err) {
        impPreview.innerHTML = `<div class="card" style="background:#fef2f2;border:1px solid #fecaca;margin-top:10px">解析失败：${escapeHtml(err.message)}</div>`;
      }
    };
  }
}

const PAINTING_PROCS = [
  { key: 'clamp',  label: '夹模' },
  { key: 'pad',    label: '移印' },
  { key: 'spray',  label: '散枪' },
  { key: 'edge',   label: '边模' },
  { key: 'color',  label: '油色' },
  { key: 'dip',    label: '浸油' },
  { key: 'oil',    label: '抹油' },
  { key: 'pp_water', label: '擦PP水' },
];

function paintingRowAmount(r) {
  return PAINTING_PROCS.reduce((s, p) => s + num(r[p.key + '_qty']) * num(r[p.key + '_unit']), 0);
}

function renderPaintingTable(container, rows, onChange, canEdit) {
  container.innerHTML = '';
  const table = document.createElement('table'); table.className = 'wb-table';
  // 表头
  const procHeader = PAINTING_PROCS.map(p => `<th colspan="2" style="text-align:center">${p.label}</th>`).join('');
  const procSubhead = PAINTING_PROCS.map(_ => `<th style="width:55px">数量</th><th style="width:75px">单价 HKD</th>`).join('');
  table.innerHTML = `<thead>
    <tr>
      <th rowspan="2" style="width:40px">#</th>
      <th rowspan="2" style="width:120px">图片</th>
      <th rowspan="2" style="width:160px">名称</th>
      <th rowspan="2" style="width:180px">位置</th>
      ${procHeader}
      <th rowspan="2" style="width:90px">报价 HKD</th>
      <th rowspan="2" style="width:200px">备注</th>
      ${canEdit ? '<th rowspan="2" style="width:120px"></th>' : ''}
    </tr>
    <tr>${procSubhead}</tr>
  </thead><tbody></tbody>`;
  const tbody = table.querySelector('tbody');

  rows.forEach((row, idx) => {
    row.images = row.images || [];
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="ro">${idx + 1}</td>`;
    // 图片
    const tdImg = document.createElement('td'); tdImg.className = 'mold-img-cell';
    renderImageCell(tdImg, row, canEdit, onChange);
    tr.appendChild(tdImg);
    // 名称
    tr.appendChild(makePCell('name', 'text', row, canEdit, onChange));
    // 位置
    tr.appendChild(makePCell('position', 'text', row, canEdit, onChange));
    // 五工序
    const calcCells = [];
    PAINTING_PROCS.forEach(p => {
      tr.appendChild(makePCell(p.key + '_qty', 'number', row, canEdit, () => { onChange(); refreshAmt(); }));
      tr.appendChild(makePCell(p.key + '_unit', 'number', row, canEdit, () => { onChange(); refreshAmt(); }));
    });
    // 报价（计算列）
    const tdAmt = document.createElement('td'); tdAmt.className = 'ro';
    const refreshAmt = () => { tdAmt.textContent = formatNum(paintingRowAmount(row)); };
    refreshAmt();
    tr.appendChild(tdAmt);
    // 备注
    tr.appendChild(makePCell('note', 'text', row, canEdit, onChange));
    // 行操作
    if (canEdit) {
      const td = document.createElement('td'); td.className = 'row-actions';
      const mkBtn = (label, title, fn, cls) => { const b = document.createElement('button'); b.textContent = label; b.title = title; b.className = 'mini ' + (cls||''); b.style.padding='2px 6px'; b.style.marginRight='2px'; b.onclick = fn; return b; };
      if (idx > 0) td.appendChild(mkBtn('↑', '上移', () => { [rows[idx-1], rows[idx]] = [rows[idx], rows[idx-1]]; renderPaintingTable(container, rows, onChange, canEdit); onChange(); }));
      if (idx < rows.length - 1) td.appendChild(mkBtn('↓', '下移', () => { [rows[idx+1], rows[idx]] = [rows[idx], rows[idx+1]]; renderPaintingTable(container, rows, onChange, canEdit); onChange(); }));
      td.appendChild(mkBtn('⎘', '复制此行', () => { rows.splice(idx+1, 0, JSON.parse(JSON.stringify(rows[idx]))); renderPaintingTable(container, rows, onChange, canEdit); onChange(); }));
      td.appendChild(mkBtn('×', '删除', () => { rows.splice(idx, 1); renderPaintingTable(container, rows, onChange, canEdit); onChange(); }, 'danger'));
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });

  // 合计行
  const totals = PAINTING_PROCS.map(p => sum(rows, r => num(r[p.key + '_qty'])));
  const totalAmt = sum(rows, paintingRowAmount);
  const tr = document.createElement('tr'); tr.className = 'hi';
  let html = `<td colspan="4" style="text-align:right">合计</td>`;
  PAINTING_PROCS.forEach((p, i) => { html += `<td>${formatNum(totals[i])}</td><td></td>`; });
  html += `<td>${formatNum(totalAmt)}</td><td></td>${canEdit ? '<td></td>' : ''}`;
  tr.innerHTML = html;
  tbody.appendChild(tr);

  container.appendChild(table);
  if (canEdit) {
    const btn = document.createElement('button'); btn.textContent = '+ 增加行'; btn.className = 'mini'; btn.style.marginTop = '8px';
    btn.onclick = () => { rows.push({ images: [] }); renderPaintingTable(container, rows, onChange, canEdit); onChange(); };
    container.appendChild(btn);
  }
}

function makePCell(key, type, row, canEdit, onChange) {
  const td = document.createElement('td');
  // 数量/单价为 0 或空 → 显示空白（不显示 0.0000）
  const blankIfZero = type === 'number' && !num(row[key]);
  if (!canEdit) {
    td.className = 'ro'; td.textContent = blankIfZero ? '-' : formatNum(row[key] ?? '');
  } else {
    const inp = document.createElement('input');
    inp.type = type === 'number' ? 'number' : 'text';
    if (type === 'number') inp.step = 'any';
    inp.value = blankIfZero ? '' : (row[key] ?? '');
    inp.oninput = () => { row[key] = type === 'number' ? (inp.value === '' ? null : Number(inp.value)) : inp.value; onChange(); };
    td.appendChild(inp);
  }
  return td;
}

function renderAssembly(host, payload, canEdit, onChange, fxRmbHkd) {
  payload.assembly_labor = payload.assembly_labor || [];
  payload.packaging_labor = payload.packaging_labor || [];
  payload.assembly_step_groups = payload.assembly_step_groups || [];
  payload.assembly_base_rate = payload.assembly_base_rate ?? 310;
  payload.assembly_std_time = payload.assembly_std_time ?? 11;

  const ro = canEdit ? '' : 'disabled';
  host.innerHTML = `
    <h3>📊 总表（各产品 人工/PCS 汇总）</h3>
    <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin-bottom:8px;padding:10px;background:#fef9c3;border-radius:6px">
      <label>基数 (HKD/人) <input id="asm-rate" type="number" step="any" value="${payload.assembly_base_rate}" style="width:80px" ${ro}/></label>
      <label>标准工时 (H) <input id="asm-time" type="number" step="any" value="${payload.assembly_std_time}" style="width:60px" ${ro}/></label>
      <small class="muted">人工/PCS = 基数 × 人数 × 小组 ÷ 该组生产量</small>
    </div>
    <div id="wb-asm-summary"></div>

    <h3 style="margin-top:24px">七、组装人工 — 排拉工序（按产品分组）</h3>
    ${canEdit ? `<div style="display:flex;gap:10px;align-items:center;margin-bottom:10px">
      <button class="mini" id="asm-add-group">+ 新增产品组</button>
      <button class="mini" id="asm-import" type="button">📄 导入排拉/装工表</button><input id="asm-file" type="file" accept=".xls,.xlsx" style="display:none"/>
    </div>` : ''}
    <div id="asm-import-preview"></div>
    <div id="wb-asm-groups"></div>
    <div id="wb-asm-grand"></div>

    <h3 style="margin-top:24px">八、包装/混装人工 — 排拉工序（按产品分组）</h3>
    <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin-bottom:10px;padding:10px;background:#fef9c3;border-radius:6px">
      <small class="muted">人工/PCS = 基数 × 人数 × 小组 ÷ 该组生产量（共享上方 基数 / 标准工时）</small>
      ${canEdit ? '<button class="mini" id="pkg-add-group" style="margin-left:auto">+ 新增产品组</button>' : ''}
      ${canEdit ? '<button class="mini" id="pkg-import" type="button">📄 导入排拉/装工表</button><input id="pkg-file" type="file" accept=".xls,.xlsx" style="display:none"/>' : ''}
    </div>
    <div id="pkg-import-preview"></div>
    <div id="wb-pkg-groups"></div>
    <div id="wb-pkg-grand"></div>
  `;
  payload.packaging_step_groups = payload.packaging_step_groups || [];

  // 总表：组装+包装 各产品的 总人数 / 合计人工PCS 汇总（明细在下方各段工序细表）
  const paintSummary = () => {
    const sumHost = host.querySelector('#wb-asm-summary');
    if (!sumHost) return;
    const base = num(payload.assembly_base_rate);
    const stdTime = num(payload.assembly_std_time);
    const rowFor = (g, type) => {
      const team = num(g.team ?? 1) || 1;
      const people = (g.steps || []).reduce((s, x) => s + num(x.count), 0);
      const total = (g.steps || []).reduce((s, x) => s + base * num(x.count) * team / Math.max(num(g.qty), 1), 0);
      return { type, product: g.product || '未命名', qty: num(g.qty), team, people, total };
    };
    const asm = (payload.assembly_step_groups || []).map(g => rowFor(g, '组装'));
    const pkg = (payload.packaging_step_groups || []).map(g => rowFor(g, '包装/混装'));
    const all = asm.concat(pkg);
    const asmTotal = asm.reduce((s, r) => s + r.total, 0);
    const pkgTotal = pkg.reduce((s, r) => s + r.total, 0);
    const grand = asmTotal + pkgTotal;
    sumHost.innerHTML = `
      <table class="wb-table" style="max-width:940px">
        <thead><tr><th style="width:80px">类型</th><th>产品</th><th style="width:80px">标准工时</th><th style="width:90px">基数 HKD</th><th style="width:90px">生产量</th><th style="width:60px">小组</th><th style="width:80px">总人数</th><th style="width:140px">合计 人工/PCS HKD</th></tr></thead>
        <tbody>
          ${all.length ? all.map(r => `<tr><td>${r.type}</td><td>${escapeHtml(r.product)}</td><td>${formatNum(stdTime)}</td><td>${formatNum(base)}</td><td>${formatNum(r.qty)}</td><td>${r.team}</td><td>${r.people}</td><td style="font-weight:600;color:#0369a1">${formatNum(r.total)}</td></tr>`).join('')
            : `<tr><td colspan="8" class="ro" style="text-align:center;color:#9ca3af;padding:14px">暂无数据，下方导入排拉工序表或新增产品组</td></tr>`}
          ${asm.length ? `<tr class="hi"><td colspan="7" style="text-align:right">组装人工 合计</td><td style="font-weight:700">${formatNum(asmTotal)}</td></tr>` : ''}
          ${pkg.length ? `<tr class="hi"><td colspan="7" style="text-align:right">包装/混装人工 合计</td><td style="font-weight:700">${formatNum(pkgTotal)}</td></tr>` : ''}
          <tr class="hi"><td colspan="7" style="text-align:right;color:#16a34a">所有产品 总合计 人工/PCS</td><td style="font-weight:800;color:#16a34a">${formatNum(grand)} HKD</td></tr>
        </tbody>
      </table>`;
  };

  const renderGroups = () => {
    const groupsHost = host.querySelector('#wb-asm-groups');
    const baseRate = num(payload.assembly_base_rate);
    const stdT = num(payload.assembly_std_time);
    let grand = 0;
    groupsHost.innerHTML = '';
    payload.assembly_step_groups.forEach((g, gi) => {
      g.steps = g.steps || [];
      g.qty = g.qty || 1;
      g.team = g.team == null ? 1 : g.team;  // 小组数（默认1，可改）
      const card = document.createElement('div');
      card.className = 'labor-group';
      card.style.cssText = 'border:1px solid #e7e5e4;border-radius:8px;padding:12px;margin-top:10px;background:#fafaf9';
      const stepsHtml = g.steps.map((s, i) => `
        <tr>
          <td class="ro" style="width:40px">${i+1}</td>
          <td><input class="asg-step-name" data-gi="${gi}" data-i="${i}" type="text" value="${(s.name||'').replace(/"/g,'&quot;')}" ${ro}/></td>
          <td><input class="asg-step-count" data-gi="${gi}" data-i="${i}" type="number" step="1" value="${num(s.count)}" style="width:70px" ${ro}/></td>
          <td><input class="asg-step-note" data-gi="${gi}" data-i="${i}" type="text" value="${(s.note||'').replace(/"/g,'&quot;')}" ${ro}/></td>
          ${canEdit ? `<td style="width:50px"><button class="mini danger asg-step-del" data-gi="${gi}" data-i="${i}">×</button></td>` : ''}
        </tr>
      `).join('');
      const team = num(g.team ?? 1) || 1;
      const groupTotal = g.steps.reduce((s, x) => s + baseRate * num(x.count) * team / Math.max(num(g.qty), 1), 0);
      const totalPeople = g.steps.reduce((s, x) => s + num(x.count), 0);
      grand += groupTotal;
      card.innerHTML = `
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:8px;flex-wrap:wrap">
          <strong style="color:#16a34a">📦 产品：</strong>
          <input class="asg-name" data-gi="${gi}" value="${(g.product||'').replace(/"/g,'&quot;')}" placeholder="如：6寸小蜥蜴" style="width:200px" ${ro}/>
          <label>生产量 <input class="asg-qty" data-gi="${gi}" type="number" step="any" value="${g.qty}" style="width:90px" ${ro}/></label>
          <label>小组 <input class="asg-team" data-gi="${gi}" type="number" step="1" min="1" value="${g.team ?? 1}" style="width:60px" ${ro}/></label>
          <span class="muted">总人数：${totalPeople} · 合计 人工/PCS：<b style="color:#0369a1">${formatNum(groupTotal)} HKD</b></span>
          ${canEdit ? `<button class="mini asg-add-step" data-gi="${gi}">+ 增加工序</button>` : ''}
          ${canEdit ? `<button class="mini danger asg-del" data-gi="${gi}" style="margin-left:auto">删除整组</button>` : ''}
        </div>
        <details ${g._open ? 'open' : ''} data-gi="${gi}">
        <summary style="cursor:pointer;color:#475569;font-weight:600;padding:4px 0">📋 工序明细（${(g.steps||[]).length} 步，点击展开）</summary>
        <table class="wb-table"><thead><tr>
          <th style="width:40px">#</th>
          <th>工序名称</th>
          <th style="width:80px">人数</th>
          <th>备注</th>
          ${canEdit ? '<th style="width:50px"></th>' : ''}
        </tr></thead><tbody>${stepsHtml || `<tr><td colspan="${canEdit?5:4}" class="ro" style="text-align:center;padding:20px;color:#9ca3af">+ 增加工序</td></tr>`}</tbody></table>
        </details>
      `;
      groupsHost.appendChild(card);
    });
    host.querySelector('#wb-asm-grand').innerHTML = `
      <div class="labor-total" style="margin-top:10px"><span>所有产品 合计 人工/PCS</span><span style="font-weight:700;color:#16a34a">${formatNum(grand)} HKD</span></div>
    `;
    paintSummary();

    if (!canEdit) return;
    // 绑定
    host.querySelectorAll('.asg-name').forEach(i => i.oninput = (e) => { payload.assembly_step_groups[+i.dataset.gi].product = e.target.value; onChange(); });
    host.querySelectorAll('.asg-qty').forEach(i => { i.oninput = (e) => { payload.assembly_step_groups[+i.dataset.gi].qty = Number(e.target.value) || 1; onChange(); paintSummary(); }; i.onchange = () => renderGroups(); });
    host.querySelectorAll('.asg-team').forEach(i => { i.oninput = (e) => { payload.assembly_step_groups[+i.dataset.gi].team = Number(e.target.value) || 1; onChange(); paintSummary(); }; i.onchange = () => renderGroups(); });
    host.querySelectorAll('.asg-step-name').forEach(i => i.oninput = (e) => { payload.assembly_step_groups[+i.dataset.gi].steps[+i.dataset.i].name = e.target.value; onChange(); });
    host.querySelectorAll('.asg-step-count').forEach(i => { i.oninput = (e) => { payload.assembly_step_groups[+i.dataset.gi].steps[+i.dataset.i].count = e.target.value === '' ? null : Number(e.target.value); onChange(); paintSummary(); }; i.onchange = () => renderGroups(); });
    host.querySelectorAll('.asg-step-note').forEach(i => i.oninput = (e) => { payload.assembly_step_groups[+i.dataset.gi].steps[+i.dataset.i].note = e.target.value; onChange(); });
    host.querySelector('#wb-asm-groups').querySelectorAll('details[data-gi]').forEach(d => d.ontoggle = () => { payload.assembly_step_groups[+d.dataset.gi]._open = d.open; });
    host.querySelectorAll('.asg-step-del').forEach(b => b.onclick = () => { payload.assembly_step_groups[+b.dataset.gi].steps.splice(+b.dataset.i, 1); onChange(); renderGroups(); });
    host.querySelectorAll('.asg-add-step').forEach(b => b.onclick = () => { payload.assembly_step_groups[+b.dataset.gi].steps.push({ name: '', count: 1, note: '' }); onChange(); renderGroups(); });
    host.querySelectorAll('.asg-del').forEach(b => b.onclick = () => {
      const gi = +b.dataset.gi;
      if (!confirm(`删除产品组"${payload.assembly_step_groups[gi].product || '未命名'}"？`)) return;
      payload.assembly_step_groups.splice(gi, 1); onChange(); renderGroups();
    });
  };
  renderGroups();

  const showLaborQuoteImport = (j, impPreview, impFile) => {
    const m = j.meta || {};
    const assemblyGroups = j.assembly_groups || [];
    const packagingGroups = j.packaging_groups || [];
    const groupSummary = (groups) => groups.map(g => {
      const people = (g.steps || []).reduce((sum, step) => sum + num(step.count), 0);
      return `${escapeHtml(g.product || '未命名')}（${formatNum(g.qty)} PCS / ${formatNum(people)} 人）`;
    }).join('、') || '无';
    const copyGroups = groups => groups.map(g => ({
      product: g.product || '',
      qty: num(g.qty) || 1,
      team: num(g.team) || 1,
      steps: (g.steps || []).map(step => ({
        name: step.name || '',
        count: num(step.count),
        note: step.note || '',
      })),
    }));
    const finish = (replace) => {
      const asm = copyGroups(assemblyGroups);
      const pkg = copyGroups(packagingGroups);
      payload.assembly_step_groups = replace ? asm : payload.assembly_step_groups.concat(asm);
      payload.packaging_step_groups = replace ? pkg : payload.packaging_step_groups.concat(pkg);
      impPreview.innerHTML = '';
      impFile.value = '';
      onChange();
      renderGroups();
      renderPkgGroups();
    };

    impPreview.innerHTML = `
      <div class="card" style="background:#f0fdf4;border:1px solid #86efac;margin-top:10px">
        <p><b>已识别装工报价表</b> · ${escapeHtml(j.sheet_used || '')} · 共 ${j.count} 道工序</p>
        <p>组装：<b>${assemblyGroups.length}</b> 组 / <b>${formatNum(m.assembly_people)}</b> 人<br>
        <span class="muted">${groupSummary(assemblyGroups)}</span></p>
        <p>包装：<b>${packagingGroups.length}</b> 组 / <b>${formatNum(m.packaging_people)}</b> 人<br>
        <span class="muted">${groupSummary(packagingGroups)}</span></p>
        <p><b>总人数：${formatNum(m.total_people)}</b></p>
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="labor-quote-replace">替换当前组装和包装</button>
          <button class="mini labor-quote-append">追加到现有分组</button>
          <button class="mini danger labor-quote-cancel">取消</button>
        </div>
      </div>`;
    impPreview.querySelector('.labor-quote-replace').onclick = () => finish(true);
    impPreview.querySelector('.labor-quote-append').onclick = () => finish(false);
    impPreview.querySelector('.labor-quote-cancel').onclick = () => { impPreview.innerHTML = ''; impFile.value = ''; };
  };

  const buildImportedStepGroups = (j, fallbackKind = 'assembly') => {
    const m = j.meta || {};
    const rawGroups = Array.isArray(j.groups) && j.groups.length
      ? j.groups
      : [{
          product: m.quote_no ? `货号 ${m.quote_no}` : '排拉工序',
          name: m.quote_no ? `货号 ${m.quote_no}` : '排拉工序',
          kind: fallbackKind,
          qty: Number(m.target_qty) || 1,
          steps: j.steps || [],
        }];
    return rawGroups.map(g => ({
      product: g.product || g.name || '排拉工序',
      kind: g.kind === 'packaging' ? 'packaging' : 'assembly',
      qty: Number(g.qty || m.target_qty) || 1,
      team: Number(g.team) || 1,
      steps: (g.steps || []).map(s => ({ name: s.name, count: s.count, note: s.note || '' })),
    })).filter(g => g.steps.length);
  };

  const addImportedStepGroups = (j, fallbackKind = 'assembly') => {
    const groups = buildImportedStepGroups(j, fallbackKind);
    const asmGroups = groups.filter(g => g.kind !== 'packaging');
    const pkgGroups = groups.filter(g => g.kind === 'packaging');
    payload.assembly_step_groups.push(...asmGroups.map(({ kind, ...g }) => g));
    payload.packaging_step_groups.push(...pkgGroups.map(({ kind, ...g }) => g));
  };

  const importGroupSummary = (j, fallbackKind = 'assembly') => {
    const groups = buildImportedStepGroups(j, fallbackKind);
    const asmGroups = groups.filter(g => g.kind !== 'packaging');
    const pkgGroups = groups.filter(g => g.kind === 'packaging');
    const rows = groups.map(g => `<li>${g.kind === 'packaging' ? '包装/混装' : '组装'}：${escapeHtml(g.product)}（${g.steps.length} 个工序，生产量 ${formatNum(g.qty)}）</li>`).join('');
    return { asmGroups, pkgGroups, rows };
  };

  if (canEdit) {
    host.querySelector('#asm-rate').oninput = (e) => { payload.assembly_base_rate = Number(e.target.value) || 0; onChange(); renderGroups(); };
    host.querySelector('#asm-time').oninput = (e) => { payload.assembly_std_time = Number(e.target.value) || 0; onChange(); renderGroups(); };
    const addG = host.querySelector('#asm-add-group');
    if (addG) addG.onclick = () => { payload.assembly_step_groups.push({ product: '', qty: 1, steps: [] }); onChange(); renderGroups(); };
    // 导入排拉工序表
    const impBtn = host.querySelector('#asm-import');
    const impFile = host.querySelector('#asm-file');
    const impPreview = host.querySelector('#asm-import-preview');
    if (impBtn) impBtn.onclick = () => impFile.click();
    if (impFile) impFile.onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      impPreview.innerHTML = '<i class="muted" style="padding:8px;display:block">正在解析…</i>';
      try {
        const fd = new FormData(); fd.append('file', f);
        const r = await fetch('/api/uploads/assembly-sheet', { method: 'POST', credentials: 'include', body: fd });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || '解析失败');
        const m = j.meta || {};
        if (j.format === 'labor_quote') {
          showLaborQuoteImport(j, impPreview, impFile);
          return;
        }
        const info = importGroupSummary(j);
        impPreview.innerHTML = `
          <div class="card" style="background:#f0fdf4;border:1px solid #86efac;margin-top:10px">
            <p>解析到 <b>${j.group_count || (info.asmGroups.length + info.pkgGroups.length) || 1}</b> 个分组、<b>${j.count}</b> 个工序<br>
            ${m.customer ? `客名: ${escapeHtml(m.customer)} · ` : ''}${m.quote_no ? `货号: ${escapeHtml(m.quote_no)} · ` : ''}${m.target_qty ? `目标数: ${escapeHtml(m.target_qty)}` : ''}</p>
            <ul style="margin:8px 0 0 18px">${info.rows}</ul>
            <div style="margin-top:10px;display:flex;gap:8px;align-items:center">
              <button id="asm-imp-add">按识别分组导入</button>
              <button id="asm-imp-cancel" class="mini danger">取消</button>
            </div>
          </div>`;
        impPreview.querySelector('#asm-imp-add').onclick = () => {
          addImportedStepGroups(j);
          impPreview.innerHTML = ''; impFile.value = '';
          onChange(); renderGroups(); renderPkgGroups();
        };
        impPreview.querySelector('#asm-imp-cancel').onclick = () => { impPreview.innerHTML = ''; impFile.value = ''; };
      } catch (err) {
        impPreview.innerHTML = `<div class="card" style="background:#fef2f2;border:1px solid #fecaca;margin-top:10px">解析失败：${err.message}</div>`;
      }
    };
  }

  // 包装/混装人工 — 排拉工序（按产品分组）
  const renderPkgGroups = () => {
    const groupsHost = host.querySelector('#wb-pkg-groups');
    const baseRate = num(payload.assembly_base_rate);
    const stdT = num(payload.assembly_std_time);
    let grand = 0;
    groupsHost.innerHTML = '';
    payload.packaging_step_groups.forEach((g, gi) => {
      g.steps = g.steps || [];
      g.qty = g.qty || 1;
      g.team = g.team == null ? 1 : g.team;  // 小组数（默认1，可改）
      const card = document.createElement('div');
      card.className = 'labor-group';
      card.style.cssText = 'border:1px solid #e7e5e4;border-radius:8px;padding:12px;margin-top:10px;background:#fafaf9';
      const stepsHtml = g.steps.map((s, i) => `
        <tr>
          <td class="ro" style="width:40px">${i+1}</td>
          <td><input class="pkg-step-name" data-gi="${gi}" data-i="${i}" type="text" value="${(s.name||'').replace(/"/g,'&quot;')}" ${ro}/></td>
          <td><input class="pkg-step-count" data-gi="${gi}" data-i="${i}" type="number" step="1" value="${num(s.count)}" style="width:70px" ${ro}/></td>
          <td><input class="pkg-step-note" data-gi="${gi}" data-i="${i}" type="text" value="${(s.note||'').replace(/"/g,'&quot;')}" ${ro}/></td>
          ${canEdit ? `<td style="width:50px"><button class="mini danger pkg-step-del" data-gi="${gi}" data-i="${i}">×</button></td>` : ''}
        </tr>
      `).join('');
      const team = num(g.team ?? 1) || 1;
      const groupTotal = g.steps.reduce((s, x) => s + baseRate * num(x.count) * team / Math.max(num(g.qty), 1), 0);
      const totalPeople = g.steps.reduce((s, x) => s + num(x.count), 0);
      grand += groupTotal;
      card.innerHTML = `
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:8px;flex-wrap:wrap">
          <strong style="color:#16a34a">📦 产品：</strong>
          <input class="pkg-name" data-gi="${gi}" value="${(g.product||'').replace(/"/g,'&quot;')}" placeholder="如：6寸小蜥蜴" style="width:200px" ${ro}/>
          <label>生产量 <input class="pkg-qty" data-gi="${gi}" type="number" step="any" value="${g.qty}" style="width:90px" ${ro}/></label>
          <label>小组 <input class="pkg-team" data-gi="${gi}" type="number" step="1" min="1" value="${g.team ?? 1}" style="width:60px" ${ro}/></label>
          <span class="muted">总人数：${totalPeople} · 合计 人工/PCS：<b style="color:#0369a1">${formatNum(groupTotal)} HKD</b></span>
          ${canEdit ? `<button class="mini pkg-add-step" data-gi="${gi}">+ 增加工序</button>` : ''}
          ${canEdit ? `<button class="mini danger pkg-del" data-gi="${gi}" style="margin-left:auto">删除整组</button>` : ''}
        </div>
        <details ${g._open ? 'open' : ''} data-gi="${gi}">
        <summary style="cursor:pointer;color:#475569;font-weight:600;padding:4px 0">📋 工序明细（${(g.steps||[]).length} 步，点击展开）</summary>
        <table class="wb-table"><thead><tr>
          <th style="width:40px">#</th>
          <th>工序名称</th>
          <th style="width:80px">人数</th>
          <th>备注</th>
          ${canEdit ? '<th style="width:50px"></th>' : ''}
        </tr></thead><tbody>${stepsHtml || `<tr><td colspan="${canEdit?5:4}" class="ro" style="text-align:center;padding:20px;color:#9ca3af">+ 增加工序</td></tr>`}</tbody></table>
        </details>
      `;
      groupsHost.appendChild(card);
    });
    host.querySelector('#wb-pkg-grand').innerHTML = `
      <div class="labor-total" style="margin-top:10px"><span>所有产品 合计 人工/PCS</span><span style="font-weight:700;color:#16a34a">${formatNum(grand)} HKD</span></div>
    `;
    paintSummary();
    if (!canEdit) return;
    host.querySelectorAll('.pkg-name').forEach(i => i.oninput = (e) => { payload.packaging_step_groups[+i.dataset.gi].product = e.target.value; onChange(); });
    host.querySelectorAll('.pkg-qty').forEach(i => { i.oninput = (e) => { payload.packaging_step_groups[+i.dataset.gi].qty = Number(e.target.value) || 1; onChange(); paintSummary(); }; i.onchange = () => renderPkgGroups(); });
    host.querySelectorAll('.pkg-team').forEach(i => { i.oninput = (e) => { payload.packaging_step_groups[+i.dataset.gi].team = Number(e.target.value) || 1; onChange(); paintSummary(); }; i.onchange = () => renderPkgGroups(); });
    host.querySelectorAll('.pkg-step-name').forEach(i => i.oninput = (e) => { payload.packaging_step_groups[+i.dataset.gi].steps[+i.dataset.i].name = e.target.value; onChange(); });
    host.querySelectorAll('.pkg-step-count').forEach(i => { i.oninput = (e) => { payload.packaging_step_groups[+i.dataset.gi].steps[+i.dataset.i].count = e.target.value === '' ? null : Number(e.target.value); onChange(); paintSummary(); }; i.onchange = () => renderPkgGroups(); });
    host.querySelectorAll('.pkg-step-note').forEach(i => i.oninput = (e) => { payload.packaging_step_groups[+i.dataset.gi].steps[+i.dataset.i].note = e.target.value; onChange(); });
    host.querySelector('#wb-pkg-groups').querySelectorAll('details[data-gi]').forEach(d => d.ontoggle = () => { payload.packaging_step_groups[+d.dataset.gi]._open = d.open; });
    host.querySelectorAll('.pkg-step-del').forEach(b => b.onclick = () => { payload.packaging_step_groups[+b.dataset.gi].steps.splice(+b.dataset.i, 1); onChange(); renderPkgGroups(); });
    host.querySelectorAll('.pkg-add-step').forEach(b => b.onclick = () => { payload.packaging_step_groups[+b.dataset.gi].steps.push({ name: '', count: 1, note: '' }); onChange(); renderPkgGroups(); });
    host.querySelectorAll('.pkg-del').forEach(b => b.onclick = () => {
      const gi = +b.dataset.gi;
      if (!confirm(`删除产品组"${payload.packaging_step_groups[gi].product || '未命名'}"？`)) return;
      payload.packaging_step_groups.splice(gi, 1); onChange(); renderPkgGroups();
    });
  };
  renderPkgGroups();

  if (canEdit) {
    const addPG = host.querySelector('#pkg-add-group');
    if (addPG) addPG.onclick = () => { payload.packaging_step_groups.push({ product: '', qty: 1, steps: [] }); onChange(); renderPkgGroups(); };
    // 当 base_rate/std_time 改时 包装组也重画
    const oldRate = host.querySelector('#asm-rate'), oldTime = host.querySelector('#asm-time');
    if (oldRate) { const prev = oldRate.oninput; oldRate.oninput = (e) => { if (prev) prev(e); renderPkgGroups(); }; }
    if (oldTime) { const prev = oldTime.oninput; oldTime.oninput = (e) => { if (prev) prev(e); renderPkgGroups(); }; }
    // 导入排拉工序表 → 加到 包装组
    const impBtn = host.querySelector('#pkg-import');
    const impFile = host.querySelector('#pkg-file');
    const impPreview = host.querySelector('#pkg-import-preview');
    if (impBtn) impBtn.onclick = () => impFile.click();
    if (impFile) impFile.onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      impPreview.innerHTML = '<i class="muted" style="padding:8px;display:block">正在解析…</i>';
      try {
        const fd = new FormData(); fd.append('file', f);
        const r = await fetch('/api/uploads/assembly-sheet', { method: 'POST', credentials: 'include', body: fd });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || '解析失败');
        const m = j.meta || {};
        if (j.format === 'labor_quote') {
          showLaborQuoteImport(j, impPreview, impFile);
          return;
        }
        const info = importGroupSummary(j, 'packaging');
        impPreview.innerHTML = `
          <div class="card" style="background:#f0fdf4;border:1px solid #86efac;margin-top:10px">
            <p>解析到 <b>${j.group_count || (info.asmGroups.length + info.pkgGroups.length) || 1}</b> 个分组、<b>${j.count}</b> 个工序<br>
            ${m.customer ? `客名: ${escapeHtml(m.customer)} · ` : ''}${m.quote_no ? `货号: ${escapeHtml(m.quote_no)} · ` : ''}${m.target_qty ? `目标数: ${escapeHtml(m.target_qty)}` : ''}</p>
            <ul style="margin:8px 0 0 18px">${info.rows}</ul>
            <div style="margin-top:10px;display:flex;gap:8px;align-items:center">
              <button id="pkg-imp-add">按识别分组导入</button>
              <button id="pkg-imp-cancel" class="mini danger">取消</button>
            </div>
          </div>`;
        impPreview.querySelector('#pkg-imp-add').onclick = () => {
          addImportedStepGroups(j, 'packaging');
          impPreview.innerHTML = ''; impFile.value = '';
          onChange(); renderGroups(); renderPkgGroups();
        };
        impPreview.querySelector('#pkg-imp-cancel').onclick = () => { impPreview.innerHTML = ''; impFile.value = ''; };
      } catch (err) {
        impPreview.innerHTML = `<div class="card" style="background:#fef2f2;border:1px solid #fecaca;margin-top:10px">解析失败：${err.message}</div>`;
      }
    };
  }
}

// 按产品分组的人工表（每产品独立子表 + 子小计 + 增加工序）
function renderGroupedLabor(container, rows, onChange, canEdit) {
  container.innerHTML = '';
  // 按 product 顺序聚类（首次出现顺序）
  const order = [];
  const groupMap = new Map();
  rows.forEach(r => {
    const key = String(r.product || '未分组');
    if (!groupMap.has(key)) { order.push(key); groupMap.set(key, []); }
    groupMap.get(key).push(r);
  });

  order.forEach(product => {
    const groupRows = groupMap.get(product);
    const card = document.createElement('div');
    card.className = 'labor-group';
    card.innerHTML = `
      <div class="labor-group-head">
        <input class="lg-name" value="${product === '未分组' ? '' : product}" placeholder="产品名称" ${canEdit ? '' : 'disabled'} />
        ${canEdit ? `<button class="mini danger lg-del">删除整组</button>` : ''}
      </div>
      <table class="wb-table"><thead><tr>
        <th style="width:40px">#</th>
        <th>工序名称</th>
        <th style="width:90px">标准工时</th>
        <th style="width:120px">工序单价(元/PCS)</th>
        <th style="width:80px">用量</th>
        <th style="width:90px">成品金额</th>
        <th>备注</th>
        ${canEdit ? '<th style="width:120px"></th>' : ''}
      </tr></thead><tbody></tbody></table>
      ${canEdit ? '<button class="mini lg-add">+ 增加工序</button>' : ''}
    `;
    const tbody = card.querySelector('tbody');

    groupRows.forEach((row, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td class="ro">${idx + 1}</td>`;
      const tdAmt = document.createElement('td'); tdAmt.className = 'ro';
      const refresh = () => { tdAmt.textContent = formatNum(num(row.unit_price) * num(row.qty)); };
      ['step'].forEach(k => tr.appendChild(makePCell(k, 'text', row, canEdit, onChange)));
      tr.appendChild(makePCell('std_time', 'number', row, canEdit, onChange));
      const tdUp = makePCell('unit_price', 'number', row, canEdit, () => { onChange(); refresh(); subtotalRefresh(); }); tr.appendChild(tdUp);
      const tdQ = makePCell('qty', 'number', row, canEdit, () => { onChange(); refresh(); subtotalRefresh(); }); tr.appendChild(tdQ);
      refresh();
      tr.appendChild(tdAmt);
      tr.appendChild(makePCell('note', 'text', row, canEdit, onChange));
      if (canEdit) {
        const td = document.createElement('td'); td.className = 'row-actions';
        const mk = (lbl, t, fn, cls) => { const b = document.createElement('button'); b.textContent = lbl; b.title = t; b.className = 'mini ' + (cls||''); b.style.padding='2px 6px'; b.style.marginRight='2px'; b.onclick = fn; return b; };
        const realIdx = rows.indexOf(row);
        const sameProductIdxs = rows.map((r,i) => r.product === row.product ? i : -1).filter(i => i >= 0);
        const pos = sameProductIdxs.indexOf(realIdx);
        if (pos > 0) td.appendChild(mk('↑', '上移', () => { const a = sameProductIdxs[pos-1]; [rows[a], rows[realIdx]] = [rows[realIdx], rows[a]]; renderGroupedLabor(container, rows, onChange, canEdit); onChange(); }));
        if (pos < sameProductIdxs.length-1) td.appendChild(mk('↓', '下移', () => { const a = sameProductIdxs[pos+1]; [rows[a], rows[realIdx]] = [rows[realIdx], rows[a]]; renderGroupedLabor(container, rows, onChange, canEdit); onChange(); }));
        td.appendChild(mk('×', '删除', () => { rows.splice(realIdx, 1); renderGroupedLabor(container, rows, onChange, canEdit); onChange(); }, 'danger'));
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    });

    // 子小计
    const trSub = document.createElement('tr'); trSub.className = 'hi';
    let subAmt = 0;
    const subtotalRefresh = () => {
      subAmt = sum(groupRows, r => num(r.unit_price) * num(r.qty));
      const td = trSub.querySelector('.lg-subval');
      if (td) td.textContent = formatNum(subAmt);
    };
    trSub.innerHTML = `<td colspan="5" style="text-align:right">${product === '未分组' ? '未分组' : product} 小计</td>
      <td class="lg-subval">${formatNum(sum(groupRows, r => num(r.unit_price) * num(r.qty)))}</td>
      <td></td>${canEdit ? '<td></td>' : ''}`;
    tbody.appendChild(trSub);

    // 重命名 / 删整组 / 增加工序
    if (canEdit) {
      const nameInp = card.querySelector('.lg-name');
      nameInp.oninput = () => {
        const newName = nameInp.value || '未分组';
        groupRows.forEach(r => { r.product = newName === '未分组' ? '' : newName; });
        onChange();
      };
      card.querySelector('.lg-del').onclick = () => {
        if (!confirm(`删除整个"${product}"产品组的所有工序？`)) return;
        for (let i = rows.length - 1; i >= 0; i--) if (groupRows.includes(rows[i])) rows.splice(i, 1);
        renderGroupedLabor(container, rows, onChange, canEdit); onChange();
      };
      card.querySelector('.lg-add').onclick = () => {
        rows.push({ product: product === '未分组' ? '' : product, step: '', qty: 1 });
        renderGroupedLabor(container, rows, onChange, canEdit); onChange();
      };
    }

    container.appendChild(card);
  });

  // 总合计
  const totalAmt = sum(rows, r => num(r.unit_price) * num(r.qty));
  const tot = document.createElement('div'); tot.className = 'labor-total';
  tot.innerHTML = `<span>总合计</span><span>${formatNum(totalAmt)}</span>`;
  container.appendChild(tot);

  // 新增产品组
  if (canEdit) {
    const addProd = document.createElement('button');
    addProd.textContent = '+ 新增产品组'; addProd.className = 'mini';
    addProd.style.marginTop = '8px';
    addProd.onclick = () => {
      const name = prompt('新产品名称：'); if (!name) return;
      rows.push({ product: name, step: '', qty: 1 });
      renderGroupedLabor(container, rows, onChange, canEdit); onChange();
    };
    container.appendChild(addProd);
  }
}

// 运费类型 ↔ 容量字段 配置
const FREIGHT_TYPES = [
  { key: 'hk40',  label: 'HK 40柜',  capKey: 'cap_40',  feeLabel: 'HK 40" 运费+吊柜费' },
  { key: 'hk20',  label: 'HK 20柜',  capKey: 'cap_20',  feeLabel: 'HK 20" 运费+吊柜费' },
  { key: 'yt40',  label: 'YT 40柜',  capKey: 'cap_40',  feeLabel: 'YT 40" 运费+吊柜费' },
  { key: 'yt20',  label: 'YT 20柜',  capKey: 'cap_20',  feeLabel: 'YT 20" 运费+吊柜费' },
  { key: 'hk10t', label: 'HK 10吨', capKey: 'cap_10t', feeLabel: 'HK 10吨运费' },
  { key: 'yt10t', label: 'YT 10吨', capKey: 'cap_10t', feeLabel: 'YT 10吨运费' },
  { key: 'hk5t',  label: 'HK 5吨',  capKey: 'cap_5t',  feeLabel: 'HK 5吨运费' },
  { key: 'yt5t',  label: 'YT 5吨',  capKey: 'cap_5t',  feeLabel: 'YT 5吨运费' },
];
const CAPACITY_FIELDS = [
  { key: 'cap_10t', label: '10吨车容量' },
  { key: 'cap_5t',  label: '5吨车容量' },
  { key: 'cap_40',  label: '40柜容量' },
  { key: 'cap_20',  label: '20柜容量' },
];

function computeFreightMap(f, eCarton) {
  const cuft = num(eCarton.cuft) || ((num(eCarton.cl) * num(eCarton.cw) * num(eCarton.ch)) / 1728);
  const pcs = num(eCarton.qty) || 1;
  const safeCuft = cuft > 0 ? cuft : 1;
  const boxes = (cap) => Math.max(Math.round(cap / safeCuft), 1);
  const map = { _cuft: cuft, _pcs: pcs };
  for (const t of FREIGHT_TYPES) {
    const b = boxes(num(f[t.capKey]));
    map[t.key + '_box'] = b;
    map[t.key] = num(f[t.key]) / b / Math.max(pcs, 1);
  }
  return map;
}

function renderFreightCalc(host, f, eCarton, canEdit, onChange) {
  const ro = canEdit ? '' : 'readonly';
  const inputCell = (id, key, unit) =>
    `<td><input id="${id}" type="number" step="any" value="${num(f[key]) || ''}" ${ro} style="width:90px"/>${unit ? ` <small class="muted">${unit}</small>` : ''}</td>`;

  function paint() {
    const m = computeFreightMap(f, eCarton);
    const set = (id, v) => { const e = host.querySelector('#' + id); if (e) e.textContent = v; };
    set('fc-cuft', m._cuft.toFixed(2));
    set('fc-pcs', m._pcs);
    for (const t of FREIGHT_TYPES) {
      set('fc-' + t.key + '-box', m[t.key + '_box']);
      set('fc-' + t.key + '-pp', m[t.key].toFixed(2));
    }
  }

  const capRows = CAPACITY_FIELDS.map(c =>
    `<tr><td>${c.label}</td>${inputCell('fc-' + c.key, c.key, 'CUFT')}<td></td></tr>`).join('');
  const feeRows = FREIGHT_TYPES.map(t =>
    `<tr><td>${t.feeLabel}</td>${inputCell('fc-' + t.key, t.key, 'HK$')}<td></td></tr>`).join('');

  const resultTable = (title, types) => `
    <table class="wb-table" style="margin-top:10px;font-size:13px;text-align:center">
      <thead><tr>${types.map(t => `<th>${t.label}</th>`).join('')}<th></th></tr></thead>
      <tbody>
        <tr>${types.map(t => `<td id="fc-${t.key}-box">0</td>`).join('')}<td class="muted">总箱数</td></tr>
        <tr style="background:#ecfdf5;font-weight:600;color:#065f46">
          ${types.map(t => `<td id="fc-${t.key}-pp">0</td>`).join('')}<td class="muted">运+吊柜 (HK$/PCS)</td>
        </tr>
      </tbody>
    </table>`;

  host.innerHTML = `
    <div style="border:1px solid #e7e5e4;border-radius:8px;padding:10px;background:#fafaf9;max-width:900px">
      <table class="wb-table" style="font-size:13px">
        <tbody>
          <tr><td>1箱的 CUFT</td><td id="fc-cuft" style="font-weight:600">0</td><td class="muted">CUFT (来自工程纸箱计算)</td></tr>
          <tr><td>1箱装的个数</td><td id="fc-pcs" style="font-weight:600">0</td><td class="muted">PCS (来自工程纸箱计算)</td></tr>
          ${capRows}
          ${feeRows}
        </tbody>
      </table>
      ${resultTable('集装柜', FREIGHT_TYPES.slice(0, 4))}
      ${resultTable('卡车', FREIGHT_TYPES.slice(4))}
    </div>`;
  paint();
  if (!canEdit) return;

  const allFields = [
    ...CAPACITY_FIELDS.map(c => c.key),
    ...FREIGHT_TYPES.map(t => t.key),
  ];
  for (const key of allFields) {
    const el = host.querySelector('#fc-' + key); if (!el) continue;
    el.oninput = () => { f[key] = el.value === '' ? 0 : Number(el.value); onChange(); paint(); };
  }
}

function matchFreightByName(name) {
  const n = (name || '').toString();
  const isIndo = /印尼|indo|indonesia/i.test(n);
  const isYT = /盐田|YT|yt/.test(n);
  const isHK = /香港|HK|hk/.test(n);
  const prefix = isIndo ? 'indo' : (isYT ? 'yt' : (isHK ? 'hk' : null));
  if (!prefix) return null;
  if (/40\s*柜|40['"\s]*[尺呎]?|40hq/i.test(n)) return prefix + '40';
  if (/20\s*柜|20['"\s]*[尺呎]?|20hq/i.test(n)) return prefix + '20';
  if (/10\s*吨/.test(n)) return prefix + '10t';
  if (/5\s*吨/.test(n)) return prefix + '5t';
  return null;
}

function renderShipping(host, payload, header, canEdit, onChange, freightMap, priceHkdPerPcs, surtaxHkdPerPcs, amortSharesUsd) {
  freightMap = freightMap || {};
  // 自动确保第一个场景是"出厂价"（freight/lifting = 0）
  if (!payload.shipping.scenarios.length || !payload.shipping.scenarios[0].is_factory) {
    payload.shipping.scenarios.unshift({ name: '出厂价', base_rmb: 0, mold_share_rmb: 0, is_factory: true });
  }
  // 顶部小汇总：来自 九、合计 的值（每次刷新都同步）
  payload.shipping.top = payload.shipping.top || {};
  if (priceHkdPerPcs != null) payload.shipping.top.total_hkd = +num(priceHkdPerPcs).toFixed(4);
  if (surtaxHkdPerPcs != null) payload.shipping.top.surtax = +num(surtaxHkdPerPcs).toFixed(4);
  amortSharesUsd = amortSharesUsd || {};
  payload.shipping.top.mold_share = +num(amortSharesUsd.mold).toFixed(4);
  payload.shipping.top.prototype_share = +num(amortSharesUsd.prototype).toFixed(4);
  payload.shipping.top.testing_share = +num(amortSharesUsd.testing).toFixed(4);
  const topData = payload.shipping.top;
  const s = payload.shipping;
  const fxHU = num(header.fx_hkd_usd) || 7.8;
  const fxRH = num(header.fx_rmb_hkd) || 0.85;
  const fmt = (n) => Number.isFinite(n) ? n.toFixed(2) : '-';

  const compute = () => {
    const totalHkd = num(topData.total_hkd);
    const surtax = num(topData.surtax);
    const combined = totalHkd + surtax;  // = 九、合计 出货底价（出厂价 + 附加税）；所有场景统一用它
    topData.combined = +combined.toFixed(4);

    s.scenarios.forEach(x => {
      if (x.is_factory) {
        x._freight_matched = null;
        x.base_rmb = +combined.toFixed(4); // 出厂价列也统一用 九、合计 出货底价
        x._freight_rate = 0;
        return;
      }
      const key = matchFreightByName(x.name);
      if (key && freightMap[key] != null) {
        x._freight_rate = freightMap[key];
        x._freight_matched = key;
      } else {
        x._freight_rate = num(x.base_rmb); // 手填的 base_rmb 当 freight rate
        x._freight_matched = null;
      }
      x.base_rmb = +combined.toFixed(4); // 其他场景底价 = TOTAL + 附加税 + 模费分摊
    });

    const rows = s.scenarios.map(x => {
      const base = num(x.base_rmb);
      const freightRate = num(x._freight_rate);
      const freight = x.is_factory ? 0 : freightRate * num(s.freight_pct) / 100;
      const lifting = x.is_factory ? 0 : freightRate * num(s.lifting_pct) / 100;
      const afterShip = base + freight + lifting;
      const afterMarkup = afterShip * num(s.markup_x);
      const afterDivisor = afterMarkup / num(s.divisor);
      const totalHKD = afterDivisor;  // 码点/找数后的港币总额（模具分摊在 USD 层加）
      const totalRMB = totalHKD * fxRH;
      const totalUSD = totalHKD / fxHU;
      const moldShareUSD = num(topData.mold_share);
      const prototypeShareUSD = num(topData.prototype_share);
      const testingShareUSD = num(topData.testing_share);
      const finalUSD = totalUSD + moldShareUSD + prototypeShareUSD + testingShareUSD;
      return { freight, lifting, afterShip, afterMarkup, afterDivisor, totalHKD, totalRMB, totalUSD, moldShareUSD, prototypeShareUSD, testingShareUSD, finalUSD };
    });
    const target = num(s.target_usd);
    // 报客货价 = 第一个非"出厂价"场景（默认 盐田40柜）；若全是出厂价则取最小
    const customerIdx = s.scenarios.findIndex(x => !x.is_factory);
    const customerUSD = (customerIdx >= 0 && rows[customerIdx]) ? rows[customerIdx].finalUSD : (rows.length ? Math.min(...rows.map(r => r.finalUSD)) : 0);
    const diffPct = target > 0 ? (customerUSD - target) / target * 100 : 0;
    return { rows, target, customerUSD, diffPct };
  };

  // 重算并仅刷新计算单元格 / 同步出货底价（不重建 DOM，输入不丢焦）
  function refresh() {
    const { rows, target, customerUSD, diffPct } = compute();
    // 顶部小汇总刷新
    const setTop = (id, v) => { const e = host.querySelector('#' + id); if (e) e.textContent = v; };
    setTop('sh-top-total', fmt(num(topData.total_hkd)));
    setTop('sh-top-surtax', fmt(num(topData.surtax)));
    setTop('sh-top-combined', fmt(num(topData.combined)));
    rows.forEach((r, i) => {
      const setC = (k, v) => { const td = host.querySelector(`td[data-i="${i}"][data-k="${k}"]`); if (td) td.textContent = v; };
      setC('freight', fmt(r.freight));
      setC('lifting', fmt(r.lifting));
      setC('afterShip', fmt(r.afterShip));
      setC('afterMarkup', fmt(r.afterMarkup));
      setC('afterDivisor', fmt(r.afterDivisor));
      setC('moldShareUSD', fmt(r.moldShareUSD));
      setC('prototypeShareUSD', fmt(r.prototypeShareUSD));
      setC('testingShareUSD', fmt(r.testingShareUSD));
      setC('totalHKD', fmt(r.totalHKD));
      setC('totalRMB', fmt(r.totalRMB));
      setC('totalUSD', fmt(r.totalUSD));
      setC('finalUSD', fmt(r.finalUSD));
      // 出货底价 input：matched 则同步 + 禁用 + 上色
      const baseInp = host.querySelector(`.sc-base[data-i="${i}"]`);
      if (baseInp) {
        const x = s.scenarios[i];
        if (x._freight_matched) {
          if (document.activeElement !== baseInp) baseInp.value = x.base_rmb;
          baseInp.disabled = true;
          baseInp.style.background = '#ecfdf5';
          baseInp.title = '已按场景名自动套用运费（' + x._freight_matched + '）';
        } else {
          baseInp.disabled = !canEdit;
          baseInp.style.background = '';
          baseInp.title = '';
        }
      }
    });
    const set = (sel, v, bg) => { const el = host.querySelector(sel); if (el) { el.value = v; if (bg) el.style.background = bg; } };
    set('.sh-customer', fmt(customerUSD));
    set('.sh-diff', target > 0 ? diffPct.toFixed(2) + '%' : '-', diffPct >= 0 ? '#fef3c7' : '#dcfce7');
  }

  // 重建整个块（场景增删 / 初次渲染时调用）
  function build() {
    const sc = s.scenarios;
    const { rows, target, customerUSD, diffPct } = compute();
    const cellTd = (i, k, r) => `<td class="ro" data-i="${i}" data-k="${k}">${fmt(r[k])}</td>`;
    host.innerHTML = `
      <p class="muted" style="font-size:12px;margin:0 0 10px 0">
        出货底价 = 出厂价 <b id="sh-top-total">${fmt(num(topData.total_hkd))}</b>
        + 附加税 <b id="sh-top-surtax">${fmt(num(topData.surtax))}</b>
        = <b style="color:#7c2d12" id="sh-top-combined">${fmt(num(topData.combined))}</b> HK$（= 九、合计 出货底价；各场景统一用它，再 ×码点 ÷找数）
        <span id="sh-top-mold" style="display:none">${fmt(num(topData.mold_share))}</span>
      </p>
      <table class="wb-table ship-table">
        <thead><tr>
          <th style="width:200px">项</th>
          ${sc.map((x, i) => `<th>${canEdit ? `<div style="display:flex;gap:4px;align-items:center"><input class="sc-name" data-i="${i}" value="${escapeHtml(x.name || '')}" style="flex:1" ${x.is_factory?'disabled':''}>${x.is_factory ? '' : `<button class="mini danger sc-del" data-i="${i}" title="删除该场景" style="padding:2px 7px">×</button>`}</div>` : escapeHtml(x.name || ('场景' + (i+1)))}</th>`).join('')}
          ${canEdit ? '<th style="width:30px"></th>' : ''}
        </tr></thead>
        <tbody>
          <tr><td>出货底价 HK$</td>${sc.map((x, i) => `<td><input class="sc-base" data-i="${i}" type="number" step="any" value="${x.base_rmb ?? 0}" ${canEdit && !x._freight_matched ? '' : 'disabled'} style="${x._freight_matched ? 'background:#ecfdf5' : ''}"></td>`).join('')}${canEdit ? '<td></td>' : ''}</tr>
          <tr><td>运费 (${canEdit ? `<input id="sh-freight" type="number" step="any" value="${s.freight_pct}" style="width:60px">` : s.freight_pct}%)</td>${rows.map((r, i) => cellTd(i, 'freight', r)).join('')}${canEdit ? '<td></td>' : ''}</tr>
          <tr><td>吊柜费 (${canEdit ? `<input id="sh-lifting" type="number" step="any" value="${s.lifting_pct}" style="width:60px">` : s.lifting_pct}%)</td>${rows.map((r, i) => cellTd(i, 'lifting', r)).join('')}${canEdit ? '<td></td>' : ''}</tr>
          <tr class="hi"><td>含运 HK$</td>${rows.map((r, i) => cellTd(i, 'afterShip', r)).join('')}${canEdit ? '<td></td>' : ''}</tr>
          <tr><td>码点 × (${canEdit ? `<input id="sh-markup" type="number" step="any" value="${s.markup_x}" style="width:60px">` : s.markup_x})</td>${rows.map((r, i) => cellTd(i, 'afterMarkup', r)).join('')}${canEdit ? '<td></td>' : ''}</tr>
          <tr><td>找数 ÷ (${canEdit ? `<input id="sh-divisor" type="number" step="any" value="${s.divisor}" style="width:60px">` : s.divisor})</td>${rows.map((r, i) => cellTd(i, 'afterDivisor', r)).join('')}${canEdit ? '<td></td>' : ''}</tr>
          <tr class="hi"><td>TOTAL (HK$)</td>${rows.map((r, i) => cellTd(i, 'totalHKD', r)).join('')}${canEdit ? '<td></td>' : ''}</tr>
          <tr><td>(USD) = HK$/${fxHU}</td>${rows.map((r, i) => cellTd(i, 'totalUSD', r)).join('')}${canEdit ? '<td></td>' : ''}</tr>
          <tr><td>模具分摊 (USD)</td>${rows.map((r, i) => cellTd(i, 'moldShareUSD', r)).join('')}${canEdit ? '<td></td>' : ''}</tr>
          <tr><td>手板费分摊 (USD)</td>${rows.map((r, i) => cellTd(i, 'prototypeShareUSD', r)).join('')}${canEdit ? '<td></td>' : ''}</tr>
          <tr><td>测试费分摊 (USD)</td>${rows.map((r, i) => cellTd(i, 'testingShareUSD', r)).join('')}${canEdit ? '<td></td>' : ''}</tr>
          <tr class="hi"><td>TOTAL (USD)</td>${rows.map((r, i) => cellTd(i, 'finalUSD', r)).join('')}${canEdit ? '<td></td>' : ''}</tr>
        </tbody>
      </table>
      <div class="ship-foot">
        <label>报客货价 (USD) <input class="sh-customer" value="${fmt(customerUSD)}" disabled style="width:100px;background:#f0f9ff;font-weight:600"></label>
        <label>目标价 (USD) ${canEdit ? `<input id="sh-target" type="number" step="any" value="${s.target_usd}" style="width:100px">` : `<span>${s.target_usd}</span>`}</label>
        <label>相差 % <input class="sh-diff" value="${target > 0 ? diffPct.toFixed(2) + '%' : '-'}" disabled style="width:90px;background:${diffPct >= 0 ? '#fef3c7' : '#dcfce7'};font-weight:600"></label>
        ${canEdit ? `<button class="mini" id="sh-add">+ 增加场景</button>` : ''}
      </div>
    `;
    if (!canEdit) return;
    // 绑定：纯数据更新 + 局部刷新（不重建 DOM）
    const bindNum = (sel, key) => host.querySelectorAll(sel).forEach(inp => inp.oninput = () => {
      const i = +inp.dataset.i;
      s.scenarios[i][key] = inp.value === '' ? null : Number(inp.value);
      onChange(); refresh();
    });
    host.querySelectorAll('.sc-name').forEach(inp => inp.oninput = () => {
      const i = +inp.dataset.i;
      s.scenarios[i].name = inp.value;
      onChange(); refresh(); // 名字变了重新匹配运费
    });
    bindNum('.sc-base', 'base_rmb');
    bindNum('.sc-mold', 'mold_share_rmb');
    const globalMap = { freight: 'freight_pct', lifting: 'lifting_pct', markup: 'markup_x', divisor: 'divisor', target: 'target_usd' };
    Object.entries(globalMap).forEach(([id, key]) => {
      const el = host.querySelector('#sh-' + id);
      if (el) el.oninput = () => { s[key] = num(el.value); onChange(); refresh(); };
    });
    // 结构性变更（增删场景）才重建
    host.querySelectorAll('.sc-del').forEach(btn => btn.onclick = () => {
      const i = +btn.dataset.i;
      if (!confirm(`删除场景"${s.scenarios[i].name || '场景' + (i+1)}"？`)) return;
      s.scenarios.splice(i, 1);
      onChange(); build();
    });
    const addBtn = host.querySelector('#sh-add');
    if (addBtn) addBtn.onclick = () => {
      s.scenarios.push({ name: '场景' + (s.scenarios.length + 1), base_rmb: 0, mold_share_rmb: 0 });
      onChange(); build();
    };
  }
  build();
}

function renderSales(host, payload, quote, canEditHeader, canEditPricing, allSections, onChange, onHeaderChange) {
  payload.header = payload.header || { currency: 'HKD', fx_hkd_usd: 7.8, fx_rmb_hkd: 0.85 };
  payload.pricing = payload.pricing || { mgmt_fee_pct: 0, profit_pct: 10, tax_pct: 13, shipping_per_pcs: 0, mold_amortization_qty: quote.qty || 10000 };
  payload.shipping = payload.shipping || {
    freight_pct: 48, lifting_pct: 52, markup_x: 1.20, divisor: 0.98,
    target_usd: 0,
    scenarios: [
      { name: '盐田40柜', base_rmb: 0, mold_share_rmb: 0 },
      { name: '盐田5吨车', base_rmb: 0, mold_share_rmb: 0 },
    ],
  };

  const h = payload.header;
  const p = payload.pricing;

  // 汇总各部门已审 section payload
  const totals = computeTotals(allSections, p);

  host.innerHTML = `
    <h3>报价单表头</h3>
    <div class="wb-grid2">
      <label>货号 <input id="h-no" value="${escapeHtml(quote.quote_no)}" disabled /></label>
      <label>产品名称 <input id="h-pn" value="${escapeHtml(quote.product_name || '')}" ${canEditHeader ? '' : 'disabled'} /></label>
      <label>版本 <input id="h-ver" value="${escapeHtml(quote.version || '')}" placeholder="如 V1/改色版" ${canEditHeader ? '' : 'disabled'} /></label>
      <label>客户 <input id="h-cu" value="${escapeHtml(quote.customer || '')}" ${canEditHeader ? '' : 'disabled'} /></label>
      <label>出货数量 <input id="h-qty" type="number" value="${quote.qty || ''}" ${canEditHeader ? '' : 'disabled'} /></label>
      <label>币种
        <select id="h-cy" ${canEditPricing ? '' : 'disabled'}>
          <option value="HKD" ${h.currency==='HKD'?'selected':''}>HKD</option>
          <option value="USD" ${h.currency==='USD'?'selected':''}>USD</option>
        </select>
      </label>
      <label>RMB→HKD 汇率 <input id="h-fxrh" type="number" step="any" value="${h.fx_rmb_hkd}" ${canEditPricing ? '' : 'disabled'} /></label>
      <label>HKD→USD 汇率 <input id="h-fxhu" type="number" step="any" value="${h.fx_hkd_usd}" ${canEditPricing ? '' : 'disabled'} /></label>
    </div>

    <div class="hidden">
      <input id="p-ship" type="number" value="${p.shipping_per_pcs}" />
      <input id="p-mgmt" type="number" value="${p.mgmt_fee_pct}" />
      <input id="p-prof" type="number" value="${p.profit_pct}" />
      <input id="p-tax" type="number" value="${p.tax_pct}" />
      <input id="p-amt" type="number" value="${p.mold_amortization_qty}" />
    </div>

    <h3>九、运费计算 (HK$)</h3>
    <div id="wb-freight"></div>
    <p class="muted" style="font-size:13px;margin-top:8px">📌 出货价算价 已移到 <b>📊 汇总</b> tab，可在那里查看与编辑。</p>
  `;

  // 从工程取 1 箱 CUFT / 1 箱装个数
  const engSec = (allSections || []).find(s => s.dept === 'engineering');
  const engPayload = engSec && engSec.payload_json ? JSON.parse(engSec.payload_json) : {};
  const eCarton = engPayload.carton_calc || {};
  payload.freight_calc = payload.freight_calc || {
    cap_10t: 1166, cap_5t: 750, cap_40: 1980, cap_20: 883,
    hk40: 8000, hk20: 7100, yt40: 7200, yt20: 6000,
    hk10t: 14900, yt10t: 11500, hk5t: 12500, yt5t: 11000,
  };
  renderFreightCalc(host.querySelector('#wb-freight'), payload.freight_calc, eCarton, true, onChange);

  if (canEditHeader) {
    ['h-pn', 'h-ver', 'h-cu', 'h-qty'].forEach(id => $(id).oninput = () => onHeaderChange({
      product_name: $('h-pn').value, version: $('h-ver').value, customer: $('h-cu').value, qty: Number($('h-qty').value) || null,
    }));
  }
  if (canEditPricing) {
    $('h-cy').onchange = () => { h.currency = $('h-cy').value; onChange(); };
    $('h-fxrh').oninput = () => { h.fx_rmb_hkd = num($('h-fxrh').value); onChange(); };
    $('h-fxhu').oninput = () => { h.fx_hkd_usd = num($('h-fxhu').value); onChange(); };
    [['p-ship', 'shipping_per_pcs'], ['p-mgmt', 'mgmt_fee_pct'], ['p-prof', 'profit_pct'], ['p-tax', 'tax_pct'], ['p-amt', 'mold_amortization_qty']]
      .forEach(([id, k]) => $(id).oninput = () => { p[k] = num($(id).value); onChange(); });
  }
}

// ==================== 跨部门汇总 ====================
function computeTotals(sections, p) {
  const get = (dept) => {
    const s = sections.find(x => x.dept === dept);
    if (!s || !s.payload_json) return null;
    try { return JSON.parse(s.payload_json); } catch { return null; }
  };
  const eng = get('engineering') || {};
  const mold = get('molding') || {};
  const pnt = get('painting') || {};
  const asm = get('assembly') || {};
  const elec = get('electronic') || {};
  const elecSrc = (elec.electronics && elec.electronics.length) ? elec.electronics : (eng.electronics || []);

  // 电子/五金/辅助/包装/二次加工(喷油) 均为 HKD，换算回 RMB（×汇率）以与其余 RMB 项相加
  const _salesFx = num((get('sales') || {}).header?.fx_rmb_hkd) || 0.85;
  const injection = applyLoss(sum(mold.injection || [], r => num(r.shot_price) / Math.max(num(r.sets), 1)), mold.injection_loss_pct ?? 3);
  // 注：模板里"成品金额"列其实是 啤价/套数 之类，这里先按 shot_price/sets 估算，导出时严格按模板填回。
  const second_proc = applyLoss(sum(pnt.second_proc || [], r => num(r.price) * num(r.qty)), pnt.second_proc_loss_pct ?? 1) * _salesFx;
  const electronics = (freeTableSubtotal(elecSrc, _salesFx)  // 电子部优先，与导出一致
                    + freeTableSubtotal(eng.hardware || [], _salesFx)) * _salesFx;  // 五金不计损耗
  const aux = applyLoss(freeTableSubtotal(eng.aux_materials || [], _salesFx), eng.aux_loss_pct ?? 1) * _salesFx;
  const packaging_mat = applyLoss(freeTableSubtotal(eng.packaging_materials || [], _salesFx), eng.packaging_loss_pct ?? 1) * _salesFx;
  const asm_labor = sum(asm.assembly_labor || [], r => num(r.unit_price) * num(r.qty)) * _salesFx;  // 装配人工港币 → RMB
  const pkg_labor = sum(asm.packaging_labor || [], r => num(r.unit_price) * num(r.qty)) * _salesFx;
  const shipping = num(p.shipping_per_pcs);

  const cost = injection + second_proc + electronics + aux + packaging_mat + asm_labor + pkg_labor + shipping;
  const moldSum = sum(eng.molds || [], r => num(r.price_rmb));
  const mold_share = moldSum / Math.max(num(p.mold_amortization_qty), 1);
  const with_mgmt = cost * (1 + num(p.mgmt_fee_pct) / 100);
  const with_profit = with_mgmt * (1 + num(p.profit_pct) / 100);
  const price_rmb = with_profit * (1 + num(p.tax_pct) / 100) + mold_share;
  // 汇率从业务表头读
  const sales = get('sales') || {};
  const fx_rmb_hkd = num(sales.header?.fx_rmb_hkd) || 0.85;
  const fx_hkd_usd = num(sales.header?.fx_hkd_usd) || 7.8;
  const price_hkd = price_rmb / fx_rmb_hkd;
  const price_usd = price_hkd / fx_hkd_usd;

  return { injection, second_proc, electronics, aux, packaging_mat, asm_labor, pkg_labor, shipping, cost, mold_share, with_mgmt, with_profit, price_rmb, price_hkd, price_usd };
}

// ==================== 入口：渲染整个详情页 ====================
async function renderQuotePage() {
  const id = new URLSearchParams(location.search).get('id');
  $('qid').textContent = id;
  const me = await api('/auth/me');
  if ($('who-chip')) {
    const roleZh = { admin: '管理员', supervisor: '主管', staff: '员工' }[me.role] || me.role;
    const nm = me.display_name || me.name || me.username || '';
    $('who-chip').textContent = `${me.dept_name} · ${roleZh}${nm ? ' · ' + nm : ''}`;
  }
  if ($('btn-switch')) $('btn-switch').onclick = async (e) => {
    e.preventDefault();
    try { await api('/auth/logout', { method: 'POST' }); } catch {}
    location.href = './index.html';
  };
  const data = await api('/quotes/' + id);
  const { quote, sections } = data;
  window.__data = { quote, sections, me };
  // 从业务 section 读税率，给所有 loss-summary 用
  const salesSecForTax = sections.find(s => s.dept === 'sales');
  if (salesSecForTax && salesSecForTax.payload_json) {
    try { window.__salesTaxPct = num(JSON.parse(salesSecForTax.payload_json).pricing?.tax_pct ?? 13); }
    catch { window.__salesTaxPct = 13; }
  } else window.__salesTaxPct = 13;

  // 状态徽标
  $('status-bar').innerHTML = sections.map(s =>
    `<span class="badge ${STATUS_CLS[s.status]}">${s.dept_name}: ${STATUS_TXT[s.status]}</span>`
  ).join(' ');

  // 工作台容器
  const mySec = sections.find(s => s.dept === me.dept);
  if (!mySec) { $('sections').innerHTML = '<i>未找到本部门 section</i>'; return; }
  const payload = mySec.payload_json ? JSON.parse(mySec.payload_json) : {};
  const canEdit = mySec.status !== 'approved' && me.dept !== 'sales' ? true : false;
  // 业务部门 section 永远可编辑（除非已审）
  const canEditMine = mySec.status !== 'approved';

  const host = document.getElementById('sections'); host.innerHTML = '';

  // 基于权限决定能看哪些部门 tab
  const visibleDepts = sections.filter(s => hasPerm(me, DEPT_MENU[s.dept], 'view') || s.dept === me.dept);
  const canSeeSummary = hasPerm(me, '汇总分析', 'view');
  const showTabs = visibleDepts.length > 1 || canSeeSummary;
  const canSeeAll = visibleDepts.length === sections.length;  // 保留旧变量给后续判断用
  if (showTabs) {
    const tabBar = document.createElement('div'); tabBar.className = 'dept-tabs';
    const tabKey = 'activeTab:' + quote.id;
    const savedTab = sessionStorage.getItem(tabKey) || me.dept;
    visibleDepts.forEach(s => {
      const tab = document.createElement('div'); tab.className = 'dept-tab';
      if (s.dept === savedTab) tab.classList.add('active');
      tab.dataset.dept = s.dept;
      tab.innerHTML = `${s.dept_name} <small class="badge ${STATUS_CLS[s.status]}">${STATUS_TXT[s.status]}</small>`;
      tab.onclick = () => {
        sessionStorage.setItem(tabKey, s.dept);
        host.querySelectorAll('.dept-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        host.querySelectorAll('.section-pane').forEach(p => p.style.display = p.dataset.dept === s.dept ? '' : 'none');
      };
      tabBar.appendChild(tab);
    });
    if (canSeeSummary) {
      // 汇总 tab
      const sumTab = document.createElement('div'); sumTab.className = 'dept-tab';
      if (savedTab === '__summary__') sumTab.classList.add('active');
      sumTab.dataset.dept = '__summary__';
      sumTab.innerHTML = '📊 汇总';
      sumTab.onclick = () => {
        sessionStorage.setItem(tabKey, '__summary__');
        host.querySelectorAll('.dept-tab').forEach(t => t.classList.remove('active'));
        sumTab.classList.add('active');
        host.querySelectorAll('.section-pane').forEach(p => p.style.display = p.dataset.dept === '__summary__' ? '' : 'none');
      };
      tabBar.appendChild(sumTab);
    }
    host.appendChild(tabBar);

    if (canSeeSummary) {
      const sumPane = document.createElement('div'); sumPane.className = 'card section-pane';
      sumPane.dataset.dept = '__summary__';
      sumPane.style.display = 'none';
      renderSummaryPane(sumPane, sections, quote, me);
      host.appendChild(sumPane);
    }
  }

  const wb = document.createElement('div'); wb.className = 'card section-pane'; wb.dataset.dept = mySec.dept; host.appendChild(wb);
  wb.innerHTML = `<h2>我的工作台 — ${mySec.dept_name} <small class="badge ${STATUS_CLS[mySec.status]}">${STATUS_TXT[mySec.status]}</small></h2>
    <div id="wb-body"></div>
    <div class="wb-bar">
      ${canEditMine ? `<button id="btn-save">保存草稿</button>
                       <button id="btn-submit">提交审核</button>` : ''}
      ${(me.role === 'supervisor' || me.role === 'admin') && mySec.status === 'filled'
        ? `<button id="btn-approve">审核通过</button>
           <button id="btn-reject" class="danger">驳回</button>` : ''}
      ${mySec.status === 'approved'
        ? `<button id="btn-reopen" class="mini">🔓 解除审核 / 重新编辑</button>` : ''}
      ${mySec.review_comment ? `<span class="muted">${mySec.review_comment}</span>` : ''}
    </div>`;

  const onChange = () => {}; // 实时刷新留给各 render 内部
  const body = wb.querySelector('#wb-body');

  // 取工程已审模具，供啤机参考行使用
  // 工程模具摘要：后端不论审核状态都会返回，供啤机/喷油/装配作参考
  const refMolds = data.engineering_molds || [];

  if (me.dept === 'sales') {
    renderSales(body, payload, quote, canEditMine, canEditMine, sections, onChange, async (patch) => {
      // 表头改动直接更新 quotes 表
      await api('/quotes/' + id + '/header', { method: 'PUT', body: JSON.stringify(patch) }).catch(e => alert(e.message));
    });
  } else {
    const salesSec = sections.find(x => x.dept === 'sales');
    const salesHdr = salesSec && salesSec.payload_json ? (JSON.parse(salesSec.payload_json).header || {}) : {};
    const fx = num(salesHdr.fx_rmb_hkd) || 0.85;
    const fxHU = num(salesHdr.fx_hkd_usd) || 7.8;
    const fxRmbUsd = fx * fxHU || 6.63;
    if (me.dept === 'engineering') renderEngineering(body, payload, canEditMine, onChange, fx, fxRmbUsd);
    else if (me.dept === 'electronic') renderElectronic(body, payload, canEditMine, onChange, fx);
    else if (me.dept === 'molding') renderMolding(body, payload, canEditMine, onChange, refMolds, fx, me.role);
    else if (me.dept === 'painting') renderPainting(body, payload, canEditMine, onChange, fx);
    else if (me.dept === 'slush') renderSlush(body, payload, canEditMine, onChange, fx);
    else if (me.dept === 'sewing') renderSewing(body, payload, canEditMine, onChange, fx);
    else if (me.dept === 'assembly') renderAssembly(body, payload, canEditMine, onChange, fx);
  }

  // 其他部门 section 渲染（用户对哪些部门有 view 权限就渲染哪些）
  if (visibleDepts.length > 1) {
    const others = visibleDepts.filter(s => s.dept !== me.dept);
    const salesSecForFx = sections.find(x => x.dept === 'sales');
    const salesHdrOther = salesSecForFx && salesSecForFx.payload_json ? (JSON.parse(salesSecForFx.payload_json).header || {}) : {};
    const fxRate = num(salesHdrOther.fx_rmb_hkd) || 0.85;
    const fxRateUsd = fxRate * (num(salesHdrOther.fx_hkd_usd) || 7.8) || 6.63;

    others.forEach(s => {
      const sectionPayload = s.payload_json ? JSON.parse(s.payload_json) : {};
      // 默认只读，避免业务/工程不小心点保存覆盖其他部门数据；点"✏️ 进入编辑"切换为可写。
      // 例外：工程/业务部门由业务查看时直接可编辑（两者同属，免点按钮）；其他部门仍只读。
      // 工程/业务直接可编辑：仅在「未提交审核」(status=empty) 时自动进入编辑；
      // 已提交(filled) 则退出编辑、露出 审核通过/驳回 按钮（否则跳不出审核界面）
      let inEdit = (s.dept === 'engineering' && (me.dept === 'sales' || me.dept === 'engineering') && s.status === 'empty');
      const c = document.createElement('div'); c.className = 'card section-pane';
      c.dataset.dept = s.dept;
      c.style.display = 'none';
      const renderHeader = () => `<h2>${s.dept_name} <small class="badge ${STATUS_CLS[s.status]}">${STATUS_TXT[s.status]}</small>
        ${s.reviewed_at ? `<small class="muted" style="font-weight:normal;font-size:13px">审于 ${s.reviewed_at}</small>` : ''}
        ${inEdit ? `<small style="color:#dc2626;font-weight:600;margin-left:8px">⚠️ 编辑模式</small>` : ''}</h2>`;
      const renderBar = () => `<div class="wb-bar">
        ${s.status !== 'approved' && !inEdit ? `<button data-act="enter-edit" class="mini">✏️ 进入编辑</button>` : ''}
        ${inEdit ? `<button data-act="save">保存草稿</button>
                    <button data-act="submit">提交审核</button>
                    <button data-act="exit-edit" class="mini">退出编辑（不保存）</button>` : ''}
        ${s.status === 'filled' && !inEdit ? `<button data-act="approve">审核通过</button>
                                              <button data-act="reject" class="danger">驳回</button>` : ''}
        ${s.status === 'approved' && !inEdit ? `<button data-act="reopen" class="mini">🔓 解除审核</button>` : ''}
        ${s.review_comment ? `<span class="muted">${s.review_comment}</span>` : ''}
      </div>`;
      c.innerHTML = renderHeader() + '<div class="ro-body"></div>' + renderBar();
      const body = c.querySelector('.ro-body');
      const renderBody = () => {
        body.innerHTML = '';
        const onChangeOther = () => {};
        if (s.dept === 'engineering') renderEngineering(body, sectionPayload, inEdit, onChangeOther, fxRate, fxRateUsd);
        else if (s.dept === 'electronic') renderElectronic(body, sectionPayload, inEdit, onChangeOther, fxRate);
        else if (s.dept === 'sales') renderSales(body, sectionPayload, quote, inEdit, inEdit, sections, onChangeOther, async (patch) => {
          await api('/quotes/' + id + '/header', { method: 'PUT', body: JSON.stringify(patch) }).catch(e => alert(e.message));
        });
        else if (s.dept === 'molding') renderMolding(body, sectionPayload, inEdit, onChangeOther, data.engineering_molds || [], fxRate, me.role);
        else if (s.dept === 'painting') renderPainting(body, sectionPayload, inEdit, onChangeOther, fxRate);
        else if (s.dept === 'slush') renderSlush(body, sectionPayload, inEdit, onChangeOther, fxRate);
        else if (s.dept === 'sewing') renderSewing(body, sectionPayload, inEdit, onChangeOther, fxRate);
        else if (s.dept === 'assembly') renderAssembly(body, sectionPayload, inEdit, onChangeOther, fxRate);
      };
      renderBody();

      // 绑定本卡操作（每次重渲染都重新绑定）
      const bindActs = () => {
        c.querySelectorAll('button[data-act]').forEach(btn => {
          btn.onclick = async () => {
            const act = btn.dataset.act;
            if (act === 'enter-edit') {
              inEdit = true;
              c.querySelector('h2').outerHTML = renderHeader();
              c.querySelector('.wb-bar').outerHTML = renderBar();
              renderBody();
              bindActs();
              return;
            }
            if (act === 'exit-edit') {
              inEdit = false;
              // 重新解析原始 payload，丢弃未保存改动
              Object.keys(sectionPayload).forEach(k => delete sectionPayload[k]);
              Object.assign(sectionPayload, s.payload_json ? JSON.parse(s.payload_json) : {});
              c.querySelector('h2').outerHTML = renderHeader();
              c.querySelector('.wb-bar').outerHTML = renderBar();
              renderBody();
              bindActs();
              return;
            }
            try {
              if (act === 'save' || act === 'submit') {
                if (!confirm(`确认保存到 ${s.dept_name} section？该部门已有数据会被覆盖。`)) return;
                await putSection(s, sectionPayload, act === 'submit');
              } else if (act === 'approve') {
                await api('/reviews/' + s.id, { method: 'POST', body: JSON.stringify({ action: 'approve' }) });
              } else if (act === 'reject') {
                const comment = prompt('驳回理由：'); if (comment == null) return;
                await api('/reviews/' + s.id, { method: 'POST', body: JSON.stringify({ action: 'reject', comment }) });
              } else if (act === 'reopen') {
                const reason = prompt('解除理由（写入修改记录）：'); if (reason == null) return;
                await api('/reviews/' + s.id + '/reopen', { method: 'POST', body: JSON.stringify({ reason }) });
              }
              renderQuotePage();
            } catch (e) { alert(e.message); }
          };
        });
      };
      bindActs();

      host.appendChild(c);
    });
  }

  // 恢复上次激活的 tab 对应的 pane
  if (showTabs) {
    const savedTab = sessionStorage.getItem('activeTab:' + quote.id) || me.dept;
    host.querySelectorAll('.section-pane').forEach(p => {
      p.style.display = p.dataset.dept === savedTab ? '' : 'none';
    });
  }

  // 导出按钮
  const exp = document.createElement('div'); exp.className = 'card';
  const approved = sections.filter(s => s.status === 'approved').length;
  const totalDepts = sections.length;
  exp.innerHTML = `<button id="btn-export" ${approved < totalDepts ? 'disabled' : ''}>导出内部明细表 (${approved}/${totalDepts})</button>
    <pre id="export-result" style="margin-top:10px;max-height:300px;overflow:auto"></pre>`;
  host.appendChild(exp);

  // 行为绑定
  const saveSection = async (submit) => {
    try {
      await putSection(mySec, payload, submit);
      renderQuotePage();
    } catch (e) { alert(e.message); }
  };
  $('btn-save') && ($('btn-save').onclick = () => saveSection(false));
  $('btn-submit') && ($('btn-submit').onclick = () => saveSection(true));
  $('btn-approve') && ($('btn-approve').onclick = async () => {
    try { await api('/reviews/' + mySec.id, { method: 'POST', body: JSON.stringify({ action: 'approve' }) }); renderQuotePage(); }
    catch (e) { alert(e.message); }
  });
  $('btn-reject') && ($('btn-reject').onclick = async () => {
    const comment = prompt('驳回理由：'); if (comment == null) return;
    try { await api('/reviews/' + mySec.id, { method: 'POST', body: JSON.stringify({ action: 'reject', comment }) }); renderQuotePage(); }
    catch (e) { alert(e.message); }
  });
  $('btn-export').onclick = async () => {
    try {
      const r = await fetch('/api/quotes/' + id + '/export', { credentials: 'include' });
      if (!r.ok) {
        const j = await r.json().catch(() => ({})); throw new Error(j.error || r.statusText);
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${data.quote.quote_no || id}_内部报价明细.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) { alert(e.message); }
  };
  if ($('btn-reopen')) $('btn-reopen').onclick = async () => {
    const reason = prompt('解除审核理由（会写入修改记录）：');
    if (reason == null) return;
    try {
      await api('/reviews/' + mySec.id + '/reopen', { method: 'POST', body: JSON.stringify({ reason }) });
      renderQuotePage();
    } catch (e) { alert(e.message); }
  };

  // ============ 修改记录时间线 ============
  await renderAuditLog(host, id);
}

const ACTION_LABEL = {
  create: '创建报价单', login: '登录', fill: '保存草稿', submit: '提交审核',
  approve: '✅ 审核通过', reject: '❌ 驳回', reopen: '🔓 解除审核',
  export: '📤 导出', edit_header: '✏️ 修改表头', change_pin: '修改 PIN',
  reset_staff_pin: '重置员工 PIN',
  view: '👁️ 浏览', clone: '📋 复制',
};

async function renderAuditLog(host, quoteId) {
  let rows;
  try { rows = await api('/quotes/' + quoteId + '/audit-log'); }
  catch (e) { return; }
  const c = document.createElement('div'); c.className = 'card';
  c.innerHTML = `<h3>修改记录
      <small class="muted" id="audit-count">共 ${rows.length} 条</small>
      <input id="audit-search" class="audit-search" placeholder="🔍 搜索 部门 / 人 / 动作 / 备注…" />
    </h3>
    <div class="audit-list"></div>`;
  const list = c.querySelector('.audit-list');
  const search = c.querySelector('#audit-search');
  const countEl = c.querySelector('#audit-count');

  function rowText(r) {
    return [r.at, r.dept_name, r.dept, r.actor, r.action, ACTION_LABEL[r.action], r.detail]
      .filter(Boolean).join(' ').toLowerCase();
  }
  const PAGE_SIZE = 15;
  let page = 1;
  function render() {
    const q = (search.value || '').trim().toLowerCase();
    const filtered = q ? rows.filter(r => rowText(r).includes(q)) : rows;
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (page > totalPages) page = totalPages;
    const start = (page - 1) * PAGE_SIZE;
    const slice = filtered.slice(start, start + PAGE_SIZE);
    countEl.textContent = q ? `匹配 ${filtered.length} / ${rows.length}` : `共 ${rows.length} 条`;
    if (!filtered.length) {
      list.innerHTML = '<i class="muted">无匹配记录</i>';
    } else {
      list.innerHTML = slice.map(r => `
        <div class="audit-row">
          <span class="audit-at">${fmtAuditAt(r.at)}</span>
          <span class="audit-dept">${r.dept_name || r.dept || '系统'}</span>
          <span class="audit-actor">${r.actor || '匿名'}</span>
          <span class="audit-action">${ACTION_LABEL[r.action] || r.action}</span>
          <span class="audit-detail muted">${r.detail ? escapeHtml(r.detail) : ''}</span>
        </div>`).join('');
      // 分页器
      const pager = document.createElement('div'); pager.className = 'audit-pager';
      pager.innerHTML = `
        <button class="mini" ${page <= 1 ? 'disabled' : ''} data-pg="prev">‹ 上一页</button>
        <span>${page} / ${totalPages}</span>
        <button class="mini" ${page >= totalPages ? 'disabled' : ''} data-pg="next">下一页 ›</button>`;
      pager.querySelector('[data-pg="prev"]').onclick = () => { if (page > 1) { page--; render(); } };
      pager.querySelector('[data-pg="next"]').onclick = () => { if (page < totalPages) { page++; render(); } };
      list.appendChild(pager);
    }
  }
  search.oninput = () => { page = 1; render(); };
  render();
  host.appendChild(c);
}

function fmtAuditAt(s) {
  if (!s) return '';
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return s;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

renderQuotePage();
