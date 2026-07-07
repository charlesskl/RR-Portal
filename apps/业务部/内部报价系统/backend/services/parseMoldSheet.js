// 解析任意"模具相关报价 xlsx" → 自适应输出 molds[]
// 支持两种已知格式：
//   A. "模具报价单&合同"型：列 = 模号/产品名称/材质/出模数/套数/含税模价/...，多行子产品按主模号合并
//   B. "改模/配件报价"型：列 = 序号/模具编号/客人模具编号/加工内容/数量/单价/总价/备注，每行一副模具
// 通用思路：
//   1. 找 header 行：含 ≥3 个常见关键字的行
//   2. 用关键字字典把表头列名 → 抽象字段 (mold_no / name / ... )
//   3. 数据行映射到 molds[]；若存在"主模号"列且子行无模号，则视为前一行的子产品 → 合并

const XLSX = require('xlsx');

// 字段 → 关键词候选（越靠前优先级越高）
// 关键词全部以「去空格 + 大写」比较，故英文关键词写成大写即可同时兼容中英表头
const FIELD_KEYWORDS = {
  mold_no:        ['模号', '模具编号', '客人模具编号', '编号', 'MOLDNO'],
  part_name:      ['配件名称', 'PARTNAME', 'PART NAME'],
  name:           ['产品名称', '零件名称', '中文名', 'CHINESENAME', '加工内容', '修改内容', '模具名称', '名称', 'PARTNAME', 'DESCRIPTION'],
  // 模具材料(内呵钢材) / 模具尺寸(模胚型号) 优先映射（避免被 "材质/材料" 短词抢占）
  mold_material:  ['模具材料', '钢材材质', '内呵材质', '内呵', '钢号', '钢材', 'STEELMATERIAL', 'TOOLINSERT', 'INSERT'],
  mold_size:      ['模具尺寸', '模胚尺寸', 'DIM', 'HXWXD', 'TOOLINFORMATION'],
  material:       ['胶料类型', '塑胶原料', '塑胶', '产品材质', '产品材料', '材质', '材料', '原料', 'PLASTIC', "MAT'L", 'MATERIAL'],
  color:          ['颜色', 'COLOR'],
  cavity:         ['出模数', '型腔', '模数', 'CAV'],
  sets:           ['套数', 'UP', '数量/件', '数量'],
  product_size:   ['产品尺寸'],
  machine:        ['机型(TON)', 'INJECTIONMACHINETYPE', '机型'],
  weight:         ['净重', '克重', '零件重量', '零件重', 'PARTWEIGHT'],
  cycle:          ['周期', 'CYCLETIME', 'CYCLE'],   // 注塑生产周期(秒)
  target:         ['模具预计日啤数', '目标数', 'CYCLES/DAY', 'CYCLESDAY'],
  structure:      ['滑块', '斜顶', '模具结构', '加工内容', 'SLIDE', '行位'],
  price_rmb:      ['含税模价', '总价', '模价', '价格', '单价', 'TOTALAMOUNT', 'AMOUNT'],
  price_usd:      ['USD', '美元'],
  mold_type:      ['进胶方式', '模胚类型', '模胚大约', '模胚型号', '模胚', '水口', 'GATE'],
  note:           ['备注', '说明', 'REMARK'],
};

const HEADER_HINT_WORDS = ['序号', '编号', '名称', '材质', '出模数', '套数', '数量', '单价', '总价', '模价', '价格', '备注', '图片', '加工', '产品', '客户',
  'MOLD', 'PART', 'CAV', 'COLOR', 'CYCLE', 'AMOUNT', 'REMARK', 'GATE', 'WEIGHT', 'MATERIAL', 'PICTURE', 'SLIDE'];

function norm(s) { return String(s || '').replace(/\s+/g, '').replace(/[（）]/g, ''); }
function nu(s) { return norm(s).toUpperCase(); }  // 去空格+大写，中英不敏感

function findHeaderRow(rows) {
  let best = -1, bestHits = 0;
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const r = rows[i] || [];
    const text = r.map(nu).join('|');
    let hits = 0;
    for (const w of HEADER_HINT_WORDS) if (text.includes(nu(w))) hits++;
    if (hits > bestHits) { bestHits = hits; best = i; }
  }
  return bestHits >= 3 ? best : -1;
}

function mapColumns(headerRow) {
  const cols = {};
  const used = new Set();
  for (const [field, kws] of Object.entries(FIELD_KEYWORDS)) {
    cols[field] = -1;
    for (const kw of kws) {
      for (let i = 0; i < headerRow.length; i++) {
        if (used.has(i)) continue;
        if (nu(headerRow[i]).includes(nu(kw))) { cols[field] = i; used.add(i); break; }
      }
      if (cols[field] >= 0) break;
    }
  }
  return cols;
}

function parseNumber(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[￥$,，\s元RMB]/gi, ''));
  return Number.isFinite(n) ? n : null;
}

function machineTonToModel(v) {
  const m = String(v || '').match(/[\d.]+/);
  const n = m ? Number(m[0]) : null;
  if (n == null) return String(v || '').trim();
  if (n <= 90) return '7A';
  if (n <= 130) return '10A';
  if (n <= 170) return '14A';
  if (n <= 220) return '20A';
  if (n <= 280) return '24A';
  if (n <= 360) return '32A';
  if (n <= 520) return '44A';
  if (n <= 680) return '60A';
  if (n <= 900) return '105A';
  return `${n}T`;
}

function formatStructure(v) {
  const s = String(v || '').trim();
  if (!s || s === '无') return '';
  const n = parseNumber(s);
  if (n != null) return n > 0 ? `${n}个行位` : '';
  return s;
}

function parseWorkbook(buf) {
  const wb = XLSX.read(buf, { cellStyles: false, cellFormula: false });
  // 遍历所有候选 sheet，挑解析出最多模具的那个（跳过明显无关 sheet）
  const EXCLUDE = /电子|五金|印喷|彩盒|包装|辅料|工艺/;
  const candidates = wb.SheetNames.filter(n => wb.Sheets[n] && wb.Sheets[n]['!ref'] && !EXCLUDE.test(n));
  if (candidates.length === 0) return { error: '所有工作表都是空的或被排除', sheets: wb.SheetNames };

  let best = null;
  for (const sheetName of candidates) {
    const r = tryParseSheet(wb, sheetName);
    if (!best) best = r;
    if (r.molds && (!best.molds || r.molds.length > best.molds.length)) best = r;
  }
  if (!best.molds || best.molds.length === 0) {
    return {
      error: best.error || '未在任何工作表中解析到模具行',
      sheets: wb.SheetNames,
      sheet_used: best.sheet_used,
      preview: best.preview,
    };
  }
  return best;
}

function tryParseSheet(wb, sheetName) {
  const ws = wb.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  const hIdx = findHeaderRow(aoa);
  if (hIdx < 0) {
    return {
      error: '未识别到表头',
      sheets: wb.SheetNames, sheet_used: sheetName,
      preview: aoa.slice(0, 15),
    };
  }
  // 表头可能是双行（英文主表头 + 中文/单位副表头）；若下一行也像表头则按列合并
  let header = (aoa[hIdx] || []).slice();
  let dataStart = hIdx + 1;
  const nextRow = aoa[hIdx + 1];
  if (nextRow) {
    const ntext = nextRow.map(nu).join('|');
    let nextHits = 0;
    for (const w of HEADER_HINT_WORDS) if (ntext.includes(nu(w))) nextHits++;
    const numeric = nextRow.filter(c => String(c).trim() && /^[\d,.]+$/.test(String(c).trim())).length;
    if (nextHits >= 2 && numeric <= 1) {  // 副表头：含表头词且几乎无数值 → 合并
      const len = Math.max(header.length, nextRow.length);
      const merged = [];
      for (let c = 0; c < len; c++) merged[c] = `${header[c] || ''} ${nextRow[c] || ''}`.trim();
      header = merged;
      dataStart = hIdx + 2;
    }
  }
  const cols = mapColumns(header);

  const cell = (r, k) => cols[k] >= 0 ? String(r[cols[k]] ?? '').trim() : '';

  // 数据行：从 dataStart 起；遇到新的 section 标题（如"二、注塑部分"）或新表头则停止
  const dataRows = [];
  // bodyRows keeps continuation/detail rows that may not repeat mold_no/name.
  // It is mainly used for assigning embedded pictures whose anchors sit on
  // child rows under the same mold number.
  const bodyRows = [];
  for (let i = dataStart; i < aoa.length; i++) {
    const r = aoa[i] || [];
    const txt = r.map(c => String(c ?? '')).join('').trim();
    if (!txt) continue;
    const rowText = r.map(c => nu(c)).join('|');
    // 边界：再遇到 "X、XXX部分" 章节标题 → 停止
    if (/[一二三四五六七八九十]、.+部分/.test(rowText)) break;
    // 边界：再遇到 header-like 行（高密度关键字）→ 停止
    let hits = 0;
    for (const w of HEADER_HINT_WORDS) if (rowText.includes(nu(w))) hits++;
    if (hits >= 3) break;
    // 跳过条款 / 说明 / 签名 / 合计 等非数据行
    if (/^(小计|合计|总计|大写|说明|备注|以下空白|客户确认|签名|损耗)/.test(norm(r[0]))) continue;
    if (/以下空白|客户确认|确认签名|付款方式|完成时间|交货地点|交货时间|交货期|不含税|不含报价|不包含报价|请回电|协商|此单有问题|交付后|工作日完成|甲方|乙方|签字|盖章|改图|抄数费用|模具寿命|消耗品|本报价单|影印件|特别说明|蚀纹|温控箱|订金|首款|尾款|中款|另计/.test(rowText)) continue;
    // 条款编号行：col-1 以"数字+点/、"开头（如 "1.模具符合..." "2、付款"）
    const c1 = String(r[1] || '').trim();
    if (/^\d+\s*[.、、，,]/.test(c1) && c1.length > 12) continue;
    if (/[一二三四五六七八九十]、/.test(String(r[0] || ''))) continue;
    // 页脚/签名/条款（如 "Authorized signature"）；英文条款
    if (/AUTHORIZED|SIGNATURE|I\/WE ACCEPT|COMPANY CHOP|TERMS/i.test(txt)) continue;
    bodyRows.push({ r, ri: i });
    // 有模号列时：既无模号又无名称的行不参与字段提取，但仍保留在 bodyRows，
    // 让同一模号下面的明细行图片可以按行范围归属到上一副模具。
    if (cols.mold_no >= 0 && !cell(r, 'mold_no') && !cell(r, 'name') && !cell(r, 'part_name')) continue;
    dataRows.push({ r, ri: i });  // ri = 0-based 原始行号，供图片按行归属
  }

  const hasPartDetailCols = cols.part_name >= 0 && cols.name >= 0 && cols.part_name !== cols.name;
  if (hasPartDetailCols) {
    const detailMolds = buildPartDetailMolds(dataRows, cell);
    if (detailMolds.length) {
      return { sheets: wb.SheetNames, sheet_used: sheetName, header_row: hIdx + 1, cols_found: cols, molds: detailMolds };
    }
  }

  // 决定是否做"主模号合并"——仅当 mold_no 列存在且存在多个含值/空值交替的子行
  const hasMoldNoCol = cols.mold_no >= 0;
  const groups = [];
  let current = null;
  for (const { r, ri } of dataRows) {
    const moldNo = hasMoldNoCol ? cell(r, 'mold_no') : '';
    const isNew = !hasMoldNoCol || /^P?\w/.test(moldNo);

    if (isNew || !current) {
      if (current) groups.push(current);
      current = {
        mold_no: moldNo,
        names: [],
        part_names: [],
        materials: [],
        colors: [],
        cavities: [],
        sets: null,
        weights: [],
        weight: null,
        cycle: null,
        mold_material: '',
        mold_size: '',
        structures: [],
        price_rmb: null,
        mold_type: '',
        notes: [],
        rowStart: ri,
        rowEnd: ri,
      };
    }
    current.rowEnd = ri;  // 该组覆盖到当前行
    const name = cell(r, 'name');
    if (name) current.names.push(name);
    const partName = cell(r, 'part_name');
    if (partName) current.part_names.push(partName);
    const mat = cell(r, 'material'); if (mat) current.materials.push(mat);
    const colorVal = cell(r, 'color'); if (colorVal) current.colors.push(colorVal);
    const cav = cell(r, 'cavity');   if (cav) current.cavities.push(cav);
    const sets = parseNumber(cell(r, 'sets')); if (sets != null && current.sets == null) current.sets = sets;
    const wt = parseNumber(cell(r, 'weight'));
    if (wt != null) {
      current.weights.push(wt);
      if (current.weight == null) current.weight = wt;
    }
    const cyc = parseNumber(cell(r, 'cycle')); if (cyc != null && current.cycle == null) current.cycle = cyc;
    const mm = cell(r, 'mold_material'); if (mm && !current.mold_material) current.mold_material = mm;
    const ms = cell(r, 'mold_size'); if (ms && !current.mold_size) current.mold_size = ms;
    const st = cell(r, 'structure'); if (st && st !== '无') current.structures.push(st);
    const pr = parseNumber(cell(r, 'price_rmb')); if (pr != null && current.price_rmb == null) current.price_rmb = pr;
    const mt = cell(r, 'mold_type'); if (mt && !current.mold_type) current.mold_type = mt;
    const nt = cell(r, 'note'); if (nt) current.notes.push(nt);
  }
  if (current) groups.push(current);

  // For sheets with merged/continued rows, a mold row often spans until the
  // next mold number. Extend _rows so pictures anchored on child rows are not
  // left unassigned.
  if (hasMoldNoCol && groups.length && bodyRows.length) {
    const bodyIndexes = bodyRows.map(x => x.ri).sort((a, b) => a - b);
    groups.forEach((g, gi) => {
      const nextStart = groups[gi + 1] ? groups[gi + 1].rowStart : null;
      let end = g.rowEnd;
      for (const ri of bodyIndexes) {
        if (ri < g.rowStart) continue;
        if (nextStart != null && ri >= nextStart) break;
        end = ri;
      }
      g.rowEnd = Math.max(g.rowEnd, end);
    });
  }

  const molds = groups.filter(g => g.names.length > 0 || g.mold_no).map(g => {
    // 出模数 = 组内各件 CAV 相加（总穴数）。CAV 形如 "2" 或 "2*1" 时取乘积，空则 0
    const cavSum = g.cavities.reduce((a, c) => {
      const nums = String(c).match(/[\d.]+/g);
      if (!nums) return a;
      return a + nums.map(Number).reduce((x, y) => x * y, 1);
    }, 0);
    const cavity = cavSum > 0 ? String(cavSum) : (g.cavities[0] || '');
    const uniquePartNames = [...new Set(g.part_names || [])];
    const uniqueNames = [...new Set(g.names || [])];
    const displayNames = uniquePartNames.length ? uniquePartNames : uniqueNames;
    const weightTotal = uniquePartNames.length && g.weights.length
      ? +g.weights.reduce((a, n) => a + n, 0).toFixed(4)
      : g.weight;
    return {
      mold_no: g.mold_no,
      name: displayNames.join('/') || g.mold_no,
      mold_type: g.mold_type || (/细水口/.test(g.notes.join('')) ? '细水口'
                              : /大水口|潜水/.test(g.notes.join('')) ? '大水口'
                              : /三板/.test(g.notes.join('')) ? '三板模' : ''),
      structure: g.structures.length ? (g.structures.length === g.names.length ? g.structures[0] : [...new Set(g.structures)].join(' / ')) : '',
      material: [...new Set(g.materials)].join('/'),
      color: [...new Set(g.colors)].join('/'),
      cavity,
      sets: g.sets ?? 1,
      weight_g: weightTotal,
      cycle_sec: g.cycle,
      price_rmb: g.price_rmb,
      images: [],
      detail: { mold_material: g.mold_material, mold_size: g.mold_size },
      note: [...new Set(g.notes)].join('；'),
      _rows: [g.rowStart, g.rowEnd],  // 0-based 原始行范围，供图片归属
    };
  });

  return { sheets: wb.SheetNames, sheet_used: sheetName, header_row: hIdx + 1, cols_found: cols, molds };
}

function buildPartDetailMolds(dataRows, cell) {
  const molds = [];
  const state = {};
  const keep = (k, v) => {
    const s = String(v ?? '').trim();
    if (s) state[k] = s;
    return state[k] || '';
  };

  for (const { r, ri } of dataRows) {
    const moldNo = keep('mold_no', cell(r, 'mold_no'));
    const groupName = keep('group_name', cell(r, 'name'));
    const partName = cell(r, 'part_name') || groupName || moldNo;
    if (!partName) continue;

    const material = keep('material', cell(r, 'material'));
    const color = keep('color', cell(r, 'color'));
    const cavity = cell(r, 'cavity') || state.cavity || '';
    if (cavity) state.cavity = cavity;
    const setsCell = parseNumber(cell(r, 'sets'));
    if (setsCell != null) state.sets = setsCell;
    const cycleCell = parseNumber(cell(r, 'cycle'));
    if (cycleCell != null) state.cycle = cycleCell;
    const targetCell = parseNumber(cell(r, 'target'));
    if (targetCell != null) state.target = targetCell;

    const machine = keep('machine', cell(r, 'machine'));
    const moldMaterial = keep('mold_material', cell(r, 'mold_material'));
    const moldType = keep('mold_type', cell(r, 'mold_type'));
    const structure = formatStructure(cell(r, 'structure'));
    const note = cell(r, 'note');
    const weight = parseNumber(cell(r, 'weight'));
    const price = parseNumber(cell(r, 'price_rmb'));

    molds.push({
      mold_no: moldNo,
      name: partName,
      mold_type: moldType,
      structure,
      material,
      color,
      cavity,
      sets: state.sets ?? 1,
      weight_g: weight,
      cycle_sec: state.cycle ?? null,
      price_rmb: price,
      images: [],
      detail: {
        parent_name: groupName,
        mold_material: moldMaterial,
        machine,
        machine_model: machineTonToModel(machine),
        target: state.target ?? null,
      },
      machine,
      machine_model: machineTonToModel(machine),
      target: state.target ?? null,
      note,
      _rows: [ri, ri],
    });
  }
  return molds;
}

module.exports = { parseWorkbook };
