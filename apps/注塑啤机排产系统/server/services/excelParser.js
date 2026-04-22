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

  // 从前几行提取单号（编号:LWW... 或 生产单号:CMC...）
  let orderNo = '';
  for (let i = 0; i < Math.min(rawRows.length, 10); i++) {
    const rowStr = rawRows[i].join(' ');
    const m = rowStr.match(/(?:编号|生产单号)[：:]\s*([A-Z0-9/]+)/);
    if (m) { orderNo = m[1]; break; }
  }

  // 找表头行（含"款号/货号"或"模具编号"和"用料/颜色"等）
  const keywords = ['货号', '款号', '模具编号', '用料', '啤净重', '需啤数', '啤数', '颜色', '净重'];
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rawRows.length, 15); i++) {
    const row = rawRows[i].map(c => String(c ?? ''));
    const hits = row.filter(c => keywords.some(k => c.includes(k))).length;
    if (hits >= 3) { headerIdx = i; break; }
  }
  if (headerIdx < 0) return [];

  let headers = rawRows[headerIdx].map(c => String(c ?? '').trim());
  let dataRows = rawRows.slice(headerIdx + 1);

  // 特殊处理：表头和第一条数据合并在同一单元格（用换行分隔）
  // 例如："       款号\n\n15727   总MA" → 表头是"款号"，数据是"15727   总MA"
  const hasEmbeddedData = headers.some(h => h.includes('\n') && keywords.some(k => h.includes(k)));
  let embeddedFirstRow = null;
  if (hasEmbeddedData) {
    embeddedFirstRow = [];
    headers = headers.map((h, idx) => {
      if (h.includes('\n')) {
        const parts = h.split('\n').map(p => p.trim()).filter(p => p);
        // 第一个含关键词的部分是表头，其余是数据
        const headerPart = parts.find(p => keywords.some(k => p.includes(k))) || parts[0];
        const dataParts = parts.filter(p => p !== headerPart);
        embeddedFirstRow[idx] = dataParts.join(' ').trim();
        return headerPart;
      }
      embeddedFirstRow[idx] = '';
      return h;
    });
    // 保存嵌入数据供后续合并使用（不直接放入dataRows，避免干扰列推断）
  }

  const findCol = (...kws) => headers.findIndex(h => kws.some(k => h.includes(k)));
  let cols = {
    product_code:    findCol('货号', '产品货号', '款号'),
    mold_no:         findCol('模具编号', '模具号'),
    mold_name:       findCol('模具名称', '模号名称', '模名', '工模名称'),
    color_combined:  findCol('颜色/编号', '颜色'),
    color_powder:    findCol('色粉号', '色粉编号'),
    material_type:   findCol('用料名称', '用料', '料型', '材料'),
    shot_weight:     findCol('啤净重', '净重G', '啤重'),
    cavity:          findCol('出模数', '模穴', '穴数'),
    quantity_needed: findCol('需啤数量', '需啤数', '啤数'),
    total_sets:      findCol('总套数'),
    material_kg:     findCol('用料量', '用料KG', '总净'),
    sprue_pct:       findCol('水口比例', '水口%', '水口'),
    notes:           findCol('备注'),
    delivery_date:   findCol('交货日期'),
  };

  // 智能修正：用数据行实际内容推断列位置（找非空列最多的行作为样本）
  const sortedSample = [...dataRows.slice(0, 15)]
    .map((r, i) => ({ r, i, cnt: (Array.isArray(r) ? r : []).filter(v => v !== '' && v !== null && v !== undefined).length }))
    .sort((a, b) => b.cnt - a.cnt)
    .map(x => x.r);
  for (const row of sortedSample) {
    const rowArr = Array.isArray(row) ? row : [];
    // 找含模具编号的行（字母+数字+连字符模式），且需要至少6个非空列（排除不完整行）
    const nonEmptyCols = rowArr.filter(v => v !== '' && v !== null && v !== undefined).length;
    if (nonEmptyCols < 6) continue;
    let moldCol = -1;
    for (let ci = 0; ci < rowArr.length; ci++) {
      const v = String(rowArr[ci] ?? '').trim();
      if (v && /^[A-Z]{2,}.*-\d+/.test(v)) { moldCol = ci; break; }
    }
    if (moldCol < 0) continue;

    // 从这行推断所有列位置（重置所有为-1，重新扫描）
    for (const k of Object.keys(cols)) cols[k] = -1;
    cols.mold_no = moldCol;

    // 款号：模具编号之前的列中找含数字的
    for (let j = 0; j < moldCol; j++) {
      const v = String(rowArr[j] ?? '').trim();
      if (v && /\d{4,}/.test(v)) { cols.product_code = j; break; }
    }

    // 模具编号之后逐列识别
    for (let j = moldCol + 1; j < rowArr.length; j++) {
      const v = String(rowArr[j] ?? '');
      const vt = v.trim();
      if (!vt) continue;

      // 工模名称：中文字符
      if (/^[\u4e00-\u9fa5()（）]+/.test(vt) && cols.mold_name < 0 && !/(ABS|PP|PVC|LDPE|POM|TPR|HIPS)/i.test(vt)) {
        cols.mold_name = j; continue;
      }
      // 大整数(>100)：先是总套数，再是啤数
      if (/^\d+$/.test(vt) && parseInt(vt) >= 100) {
        if (cols.total_sets < 0 && cols.quantity_needed < 0) { cols.total_sets = j; continue; }
        if (cols.total_sets >= 0 && cols.quantity_needed < 0) { cols.quantity_needed = j; continue; }
      }
      // 颜色：中文颜色词
      if (/[\u4e00-\u9fa5]/.test(vt) && /(色|白|黑|红|蓝|绿|黄|灰|棕|橙|紫|粉|银|金|咖|啡|梅|原|透明|浅|深)/.test(vt) && cols.color_combined < 0) {
        cols.color_combined = j; continue;
      }
      // 色粉号：4-5位数字
      if (/^\d{4,5}[A-Z]?$/.test(vt) && cols.color_powder < 0) { cols.color_powder = j; continue; }
      // 料型：含ABS/PP等
      if (/(ABS|PP|PVC|LDPE|POM|TPR|TPE|HIPS|POE|PC|透明|尼龙|MABS)/i.test(vt) && cols.material_type < 0) {
        cols.material_type = j; continue;
      }
      // 小数(1-999)：啤重
      if (/^\d+\.?\d*$/.test(vt) && cols.shot_weight < 0) {
        const sv = parseFloat(vt);
        if (sv >= 1 && sv < 1000) { cols.shot_weight = j; continue; }
      }
    }
    break; // 找到一行就够了
  }

  const get = (row, key) => {
    const idx = cols[key];
    if (idx < 0) return '';
    return String(row[idx] ?? '').trim();
  };
  const getNum = (row, key) => parseFloat(get(row, key).replace(/,/g, '')) || 0;

  const orders = [];
  let lastProductCode = ''; // 合并单元格货号继承
  for (const row of dataRows) {
    let product_code = get(row, 'product_code');
    const mold_name = get(row, 'mold_name');
    if (!product_code && !mold_name) continue;
    // 合并单元格：货号为空时继承上一行
    if (!product_code && mold_name && lastProductCode) {
      product_code = lastProductCode;
    } else if (product_code) {
      lastProductCode = product_code;
    }
    // 跳过汇总行、备注行、页脚行
    const firstCell = String(row[0] ?? '');
    if (firstCell.includes('合计') || firstCell.includes('本页') || firstCell.includes('〖') ||
        firstCell.includes('特别注明') || firstCell.includes('操作员') || firstCell.includes('收货人') ||
        firstCell.includes('下单人') || firstCell.includes('接单人') || firstCell.includes('接单日期') ||
        firstCell.includes('备') || /^第\d*$/.test(firstCell.trim())) continue;
    // 跳过无模具编号的行
    const moldCheck = get(row, 'mold_no');
    if (!moldCheck && !mold_name) continue;

    // 颜色/编号 拆分
    const colorCombined = get(row, 'color_combined');
    let color = colorCombined, color_powder_no = get(row, 'color_powder');
    // 如果没有单独的色粉号列，从颜色中拆分（如 "黑色88066"）
    if (!color_powder_no) {
      const colorMatch = colorCombined.match(/^([\u4e00-\u9fa5]+[a-zA-Z]*)\s*(\d{5,})$/);
      if (colorMatch) {
        color = colorMatch[1];
        color_powder_no = colorMatch[2];
      }
    }

    // 啤数：优先用"需啤数"列，没有则用"啤数"列
    let qty = getNum(row, 'quantity_needed');
    if (!qty && cols.total_sets >= 0) {
      // 没有单独的需啤数列，可能啤数就是需啤数
      qty = getNum(row, 'quantity_needed');
    }

    // 款号清理：去掉中文后缀（如 "15726  总毛绒MA" → "15726"）
    let pc = product_code.replace(/\s+.*$/, '').replace(/[（(].*$/, '').trim();
    const pcDigits = pc.match(/^(\d{4,7})/);
    if (pcDigits) pc = pcDigits[1];

    const moldNo = get(row, 'mold_no');
    const fullMoldName = moldNo && mold_name ? `${moldNo} ${mold_name}` : mold_name || moldNo;

    // 嵌入数据补齐：如果是第一条订单，且颜色/色粉/料型/啤重缺失，从嵌入数据补
    let shot_weight = getNum(row, 'shot_weight');
    let material_type = get(row, 'material_type');
    if (orders.length === 0 && embeddedFirstRow) {
      // 从嵌入数据里找颜色/料型/啤重
      if (!color) {
        for (const v of embeddedFirstRow) {
          const s = String(v ?? '').trim();
          if (s && /^[\u4e00-\u9fa5]*(色|透明|原色)/.test(s) && !/ABS|PP|PVC/.test(s)) {
            color = s; break;
          }
        }
      }
      if (!material_type) {
        for (const v of embeddedFirstRow) {
          const s = String(v ?? '').trim();
          if (s && /(ABS|PP|PVC|LDPE|POM|TPR|HIPS|POE|MABS|透明ABS)/i.test(s)) {
            // 拆分"88397   ABS 750NSW"成色粉号和料型
            const parts = s.split(/\s+/).filter(p => p);
            if (parts.length >= 2 && /^\d{4,5}$/.test(parts[0])) {
              if (!color_powder_no) color_powder_no = parts[0];
              material_type = parts.slice(1).join(' ');
            } else {
              material_type = s;
            }
            break;
          }
        }
      }
      if (!shot_weight) {
        for (const v of embeddedFirstRow) {
          const s = String(v ?? '').trim();
          // 提取数字部分（可能被前缀中文包围，如"整啤 42.0"）
          const m = s.match(/(\d+\.?\d*)/);
          if (m) {
            const sw = parseFloat(m[1]);
            if (sw > 0 && sw < 500 && (s.includes('.') || s.length < 10)) {
              shot_weight = sw; break;
            }
          }
        }
      }
      // 款号补齐
      if (!pc) {
        for (const v of embeddedFirstRow) {
          const s = String(v ?? '').trim();
          const m = s.match(/^(\d{4,7})/);
          if (m) { pc = m[1]; break; }
        }
      }
    }

    orders.push({
      product_code: pc,
      mold_no:         moldNo,
      mold_name:       fullMoldName,
      color,
      color_powder_no,
      material_type,
      shot_weight,
      quantity_needed: qty,
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
