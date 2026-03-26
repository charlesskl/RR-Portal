const XLSX = require('xlsx');

/**
 * 解析历史排单Excel（Sheet1的1325条记录）
 * 列: 机台, 产品货号, 模号名称, 颜色, 色粉编号, 料型, 啤重G, 用料KG,
 *     水口百分比%, 比率%, 累计数, 需啤数, 欠数, 下单单号, 24H目标数, 11H目标数, 装箱数PCS, 备注
 */
function parseHistoryExcel(filePath, sheetName) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[sheetName || wb.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  // 找表头行
  const historyKeywords = ['机台', '产品货号', '模号名称', '啤重', '料型', '需啤数'];
  let headerIdx = 0;
  for (let i = 0; i < Math.min(rawRows.length, 10); i++) {
    const row = rawRows[i].map(c => String(c ?? ''));
    const hits = row.filter(c => historyKeywords.some(k => c.includes(k))).length;
    if (hits >= 3) { headerIdx = i; break; }
  }

  const headers = rawRows[headerIdx].map(c => String(c ?? '').trim().replace(/\s+/g, ''));
  const dataRows = rawRows.slice(headerIdx + 1);

  const findCol = (...kws) => headers.findIndex(h => kws.some(k => h.includes(k)));
  const cols = {
    machine_no:      findCol('机台'),
    product_code:    findCol('产品货号', '款号'),
    mold_name:       findCol('模号名称', '模具名称'),
    color:           findCol('颜色'),
    color_powder_no: findCol('色粉编号', '色粉'),
    material_type:   findCol('料型', '材料'),
    shot_weight:     findCol('啤重'),
    material_kg:     findCol('用料KG', '用料'),
    sprue_pct:       findCol('水口百分比', '水口%'),
    ratio_pct:       findCol('比率'),
    accumulated:     findCol('累计数', '累计'),
    quantity_needed: findCol('需啤数', '啤数'),
    shortage:        findCol('欠数'),
    order_no:        findCol('下单单号', '单号'),
    target_24h:      findCol('24H目标', '24H'),
    target_11h:      findCol('11H目标', '11H'),
    packing_qty:     findCol('装箱数', '装箱'),
    notes:           findCol('备注'),
  };

  const get = (row, key) => {
    const idx = cols[key];
    if (idx < 0) return '';
    return String(row[idx] ?? '').trim();
  };
  const getNum = (row, key) => {
    const v = get(row, key).replace(/,/g, '');
    return parseFloat(v) || 0;
  };

  const records = [];
  let lastMachineNo = '';
  for (const row of dataRows) {
    let machine_no = get(row, 'machine_no');
    // 合并单元格填充：如果当前行没有机台号，使用上一行的
    if (!machine_no || !/\d+#|#\d+/.test(machine_no)) {
      if (lastMachineNo && get(row, 'mold_name')) {
        machine_no = lastMachineNo;  // 继承上一行的机台号
      } else {
        continue;
      }
    } else {
      lastMachineNo = machine_no;
    }
    // 过滤汇总行
    if (machine_no.includes('合计') || machine_no.includes('总计')) continue;

    records.push({
      machine_no,
      product_code:    get(row, 'product_code'),
      mold_name:       get(row, 'mold_name'),
      color:           get(row, 'color'),
      color_powder_no: get(row, 'color_powder_no'),
      material_type:   get(row, 'material_type'),
      shot_weight:     getNum(row, 'shot_weight'),
      material_kg:     getNum(row, 'material_kg'),
      sprue_pct:       getNum(row, 'sprue_pct'),
      ratio_pct:       getNum(row, 'ratio_pct'),
      accumulated:     getNum(row, 'accumulated'),
      quantity_needed: getNum(row, 'quantity_needed'),
      shortage:        getNum(row, 'shortage'),
      order_no:        get(row, 'order_no'),
      target_24h:      getNum(row, 'target_24h'),
      target_11h:      getNum(row, 'target_11h'),
      packing_qty:     getNum(row, 'packing_qty'),
      notes:           get(row, 'notes'),
    });
  }

  return records;
}

/**
 * 解析订单Excel（PMC下单格式）
 */
function parseOrderExcel(filePath) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  const orderKeywords = ['款号', '货号', '模具编号', '啤数', '颜色', '材料', '模号名称', '需啤数', '产品货号'];
  let headerIdx = 0;
  for (let i = 0; i < Math.min(rawRows.length, 10); i++) {
    const row = rawRows[i].map(c => String(c ?? ''));
    const hits = row.filter(c => orderKeywords.some(k => c.includes(k))).length;
    if (hits >= 2) { headerIdx = i; break; }
  }

  const headers = rawRows[headerIdx].map(c => String(c ?? '').trim().replace(/\s+/g, ''));
  const dataRows = rawRows.slice(headerIdx + 1);

  const findCol = (...kws) => headers.findIndex(h => kws.some(k => h.includes(k)));
  const cols = {
    product_code:    findCol('产品货号', '款号', '货号'),
    mold_no:         findCol('模具编号', '模具号'),
    mold_name:       findCol('模号名称', '工模名称', '模具名称'),
    color:           findCol('颜色'),
    color_powder_no: findCol('色粉编号', '色粉'),
    material_type:   findCol('料型', '材料'),
    shot_weight:     findCol('啤重'),
    quantity_needed: findCol('需啤数', '啤数', '数量'),
    cavity:          findCol('模穴', '穴数'),
    cycle_time:      findCol('周期'),
    order_no:        findCol('下单单号', '单号'),
    is_three_plate:  findCol('三板', '细水口'),
    packing_qty:     findCol('装箱数', '装箱'),
  };

  const get = (row, key) => {
    const idx = cols[key];
    if (idx < 0) return '';
    return String(row[idx] ?? '').trim();
  };
  const getNum = (row, key) => {
    const v = get(row, key).replace(/,/g, '');
    return parseFloat(v) || 0;
  };

  const orders = [];
  for (const row of dataRows) {
    const product_code = get(row, 'product_code');
    const mold_name = get(row, 'mold_name');
    if (!product_code && !mold_name) continue;

    const threePlateStr = get(row, 'is_three_plate');
    const is_three_plate = threePlateStr === '是' || threePlateStr === '1' ? 1 : 0;

    orders.push({
      product_code,
      mold_no:         get(row, 'mold_no'),
      mold_name,
      color:           get(row, 'color'),
      color_powder_no: get(row, 'color_powder_no'),
      material_type:   get(row, 'material_type'),
      shot_weight:     getNum(row, 'shot_weight'),
      quantity_needed: getNum(row, 'quantity_needed'),
      cavity:          getNum(row, 'cavity') || 1,
      cycle_time:      getNum(row, 'cycle_time'),
      order_no:        get(row, 'order_no'),
      is_three_plate,
      packing_qty:     getNum(row, 'packing_qty'),
    });
  }

  return orders;
}

/**
 * 解析兴信生产单Excel格式（东莞兴信啤机生产单）
 * 列: 货号, 模具编号, 模具名称, 颜色/编号, 用料, 啤净重(g), 订单数量, 出模数/套, 需啤数量, 用料量KG, 水口比例%, 机型/A, 目标数, 备注
 */
function parseXingxinOrderExcel(filePath) {
  const XLSX = require('xlsx');
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  // 从前几行提取单号（编号:LWW...）
  let orderNo = '';
  for (let i = 0; i < Math.min(rawRows.length, 5); i++) {
    const rowStr = rawRows[i].join(' ');
    const m = rowStr.match(/编号[：:]\s*([A-Z0-9/]+)/);
    if (m) { orderNo = m[1]; break; }
  }

  // 找表头行（含"货号"或"模具编号"和"用料"）
  const keywords = ['货号', '模具编号', '用料', '啤净重', '需啤数'];
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rawRows.length, 10); i++) {
    const row = rawRows[i].map(c => String(c ?? ''));
    const hits = row.filter(c => keywords.some(k => c.includes(k))).length;
    if (hits >= 3) { headerIdx = i; break; }
  }
  if (headerIdx < 0) return [];

  const headers = rawRows[headerIdx].map(c => String(c ?? '').trim());
  const dataRows = rawRows.slice(headerIdx + 1);

  const findCol = (...kws) => headers.findIndex(h => kws.some(k => h.includes(k)));
  const cols = {
    product_code:    findCol('货号', '产品货号'),
    mold_no:         findCol('模具编号', '模具号'),
    mold_name:       findCol('模具名称', '模号名称', '模名'),
    color_combined:  findCol('颜色/编号', '颜色'),
    material_type:   findCol('用料', '料型', '材料'),
    shot_weight:     findCol('啤净重', '啤重'),
    cavity:          findCol('出模数', '模穴', '穴数'),
    quantity_needed: findCol('需啤数量', '需啤数', '啤数'),
    material_kg:     findCol('用料量', '用料KG'),
    sprue_pct:       findCol('水口比例', '水口%', '水口'),
    notes:           findCol('备注'),
  };

  const get = (row, key) => {
    const idx = cols[key];
    if (idx < 0) return '';
    return String(row[idx] ?? '').trim();
  };
  const getNum = (row, key) => parseFloat(get(row, key).replace(/,/g, '')) || 0;

  const orders = [];
  for (const row of dataRows) {
    const product_code = get(row, 'product_code');
    const mold_name = get(row, 'mold_name');
    if (!product_code && !mold_name) continue;
    // 跳过汇总行
    if (String(row[0]).includes('合计') || String(row[0]).includes('本页')) continue;

    // 颜色/编号 拆分：如 "黑色88066" → color=黑色, powder=88066
    const colorCombined = get(row, 'color_combined');
    let color = colorCombined, color_powder_no = '';
    const colorMatch = colorCombined.match(/^([\u4e00-\u9fa5]+[a-zA-Z]*)\s*(\d{5,})$/);
    if (colorMatch) {
      color = colorMatch[1];
      color_powder_no = colorMatch[2];
    }

    orders.push({
      product_code,
      mold_no:         get(row, 'mold_no'),
      mold_name,
      color,
      color_powder_no,
      material_type:   get(row, 'material_type'),
      shot_weight:     getNum(row, 'shot_weight'),
      quantity_needed: getNum(row, 'quantity_needed'),
      material_kg:     getNum(row, 'material_kg'),
      sprue_pct:       getNum(row, 'sprue_pct'),
      cavity:          getNum(row, 'cavity') || 1,
      order_no:        orderNo,
      notes:           get(row, 'notes'),
    });
  }
  return orders;
}

module.exports = { parseHistoryExcel, parseOrderExcel, parseXingxinOrderExcel };
