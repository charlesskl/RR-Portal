const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
const fs = require('fs');

/**
 * 使用 XY 坐标解析 PDF 表格（精确列定位）
 */
async function parsePdfXY(filePath) {
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjsLib.getDocument({ data }).promise;

  // 收集所有页的行
  const allRows = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = content.items
      .map(it => ({ text: it.str, x: Math.round(it.transform[4] * 10) / 10, y: Math.round(it.transform[5] * 10) / 10 }))
      .filter(it => it.text.trim());

    if (items.length === 0) continue;
    items.sort((a, b) => b.y - a.y || a.x - b.x);

    let currentRow = [items[0]];
    for (let i = 1; i < items.length; i++) {
      if (Math.abs(items[i].y - currentRow[0].y) < 3) {
        currentRow.push(items[i]);
      } else {
        currentRow.sort((a, b) => a.x - b.x);
        allRows.push({ cells: currentRow, page: p });
        currentRow = [items[i]];
      }
    }
    if (currentRow.length) {
      currentRow.sort((a, b) => a.x - b.x);
      allRows.push({ cells: currentRow, page: p });
    }
  }

  // 找表头行
  const headerKeywords = ['款号', '货号', '模具编号', '工模名称', '模具名称', '颜色', '色粉号', '用料', '啤数', '需啤'];
  let headerIdx = -1;
  let headerPage = 1;
  for (let i = 0; i < allRows.length; i++) {
    const texts = allRows[i].cells.map(c => c.text);
    const hits = headerKeywords.filter(k => texts.some(t => t.includes(k))).length;
    if (hits >= 3) { headerIdx = i; headerPage = allRows[i].page; break; }
  }
  if (headerIdx < 0) return [];

  const headerCells = allRows[headerIdx].cells;

  // 建立列定义：表头名 → x位置 → 字段名
  const colMap = {
    '款号': 'product_code', '货号': 'product_code', '产品货号': 'product_code',
    '模具编号': 'mold_no', '模号': 'mold_no',
    '工模名称': 'mold_name', '模具名称': 'mold_name', '模号名称': 'mold_name',
    '总套数': 'total_sets',
    '啤数': 'quantity_needed', '需啤数': 'quantity_needed', '需啤数量': 'quantity_needed',
    '颜色': 'color',
    '色粉号': 'color_powder_no', '色粉编号': 'color_powder_no',
    '用料名称': 'material_type', '用料': 'material_type', '料型': 'material_type',
    '交货日期': 'delivery_date',
    '备注': 'notes',
  };

  const columns = [];
  for (const cell of headerCells) {
    for (const [keyword, field] of Object.entries(colMap)) {
      if (cell.text.includes(keyword)) {
        columns.push({ field, x: cell.x, name: cell.text });
        break;
      }
    }
  }

  // 找子表头行（"整啤 净重G." 和 "总净 重KG."），补充啤重和净重KG的列位置
  for (let i = headerIdx - 2; i <= headerIdx + 2; i++) {
    if (i < 0 || i >= allRows.length || i === headerIdx) continue;
    const texts = allRows[i].cells.map(c => c.text);
    for (const cell of allRows[i].cells) {
      if (cell.text.includes('净重G') || cell.text.includes('啤净重') || cell.text.includes('整啤')) {
        // 啤重列位置
        if (!columns.find(c => c.field === 'shot_weight')) {
          columns.push({ field: 'shot_weight', x: cell.x, name: '啤重' });
        }
      }
      if (cell.text.includes('重KG') || cell.text.includes('总净')) {
        if (!columns.find(c => c.field === 'material_kg')) {
          columns.push({ field: 'material_kg', x: cell.x, name: '净重KG' });
        }
      }
    }
  }

  // 如果没找到啤重/净重KG列，用表头后面的列位置推断
  // 通常在"用料名称"列之后

  console.log('[XY] 表头列:', columns.map(c => `${c.field}(x=${c.x})`).join(', '));

  // 提取单号
  let orderNo = '';
  for (const row of allRows) {
    const rowText = row.cells.map(c => c.text).join(' ');
    const m = rowText.match(/(?:生产单号|编号)[：:]\s*([A-Z0-9/-]+)/);
    if (m) { orderNo = m[1]; break; }
    const m2 = rowText.match(/\b((?:ZCS|CMC|ZWZ|ZWY|FDYA|FDTA)-?\d{5,})\b/);
    if (m2) { orderNo = m2[1]; break; }
  }

  // 跳过的行关键词
  const skipWords = ['〖', '特别注明', '操作员', '收货人', '下单人', '接单人', '接单日期',
    '啤 机 部', '供应商', '生产单号', '出单日期', '交货日期：', '地址', '電話', '傳真',
    '公司名称', '东 莞', '清溪', '整啤', '净重G', '总净', '重KG', '加工单价', '加工金',
    '额(HK', '(HK$)', '页，共', '备注', '备 注'];

  const results = [];
  let seenHeader = false;

  for (let i = 0; i < allRows.length; i++) {
    const row = allRows[i];
    const firstText = row.cells[0]?.text || '';
    const rowText = row.cells.map(c => c.text).join(' ');

    // 跳过表头行本身和重复表头
    if (row.cells.some(c => headerKeywords.filter(k => c.text.includes(k)).length >= 1) &&
        headerKeywords.filter(k => rowText.includes(k)).length >= 3) {
      seenHeader = true;
      continue;
    }
    if (!seenHeader && i <= headerIdx) continue;

    // 跳过汇总/页脚/备注行
    if (skipWords.some(w => firstText.includes(w) || rowText.startsWith(w))) continue;
    if (/^备\s*注/.test(firstText)) continue;
    if (/^第\s*\d*$/.test(firstText.trim())) continue;
    if (row.cells.length < 3) continue;

    // 把每个cell映射到最近的表头列
    const cellMap = {};
    for (const cell of row.cells) {
      let bestCol = null;
      let bestDist = 9999;
      for (const col of columns) {
        const dist = Math.abs(cell.x - col.x);
        if (dist < bestDist) { bestDist = dist; bestCol = col; }
      }
      if (bestCol && bestDist < 80) {
        cellMap[bestCol.field] = (cellMap[bestCol.field] || '') + cell.text;
      }
    }

    // 至少要有模具编号
    if (!cellMap.mold_no && !cellMap.mold_name) continue;
    const moldNoRaw = (cellMap.mold_no || cellMap.mold_name || '').trim();
    // 跳过明显无效行：纯中文备注、页脚、重复表头等
    if (/^备\s*注/.test(moldNoRaw) || /^操作员/.test(moldNoRaw)) continue;
    if (/^\d+$/.test(moldNoRaw) && !cellMap.mold_name) continue;
    // 跳过重复表头行（多页PDF中表头重复出现）
    if (/模具编号/.test(moldNoRaw) || /工模名称/.test(moldNoRaw)) continue;
    const pcRaw = (cellMap.product_code || '').trim();
    if (/^款号/.test(pcRaw) || /^货号/.test(pcRaw)) continue;

    // 清理产品编号
    let pc = (cellMap.product_code || '').replace(/\s+/g, '');
    // 去掉 /重复编号 和中文后缀
    pc = pc.split('/')[0];
    pc = pc.replace(/[（(].*$/, '').replace(/总.*$/, '').replace(/[A-Z]+$/, '');
    const pcDigits = pc.match(/(\d{4,7})/);
    if (pcDigits) pc = pcDigits[1];

    // 啤数
    let qty = parseInt(cellMap.quantity_needed) || 0;
    if (!qty && cellMap.total_sets) {
      qty = parseInt(cellMap.total_sets) || 0;
    }

    // 啤重
    let sw = parseFloat(cellMap.shot_weight) || 0;

    // 净重KG
    let mkg = parseFloat(cellMap.material_kg) || 0;

    // 料型可能跨行（如 "透明ABS" 在一行，"TR558AI" 在下一行同x位置）
    let mat = (cellMap.material_type || '').trim();

    // 模具全名
    const moldNo = (cellMap.mold_no || '').trim();
    const moldName = (cellMap.mold_name || '').trim();
    const fullMoldName = moldNo && moldName ? `${moldNo} ${moldName}` : moldName || moldNo;

    // 颜色
    let color = (cellMap.color || '').trim();

    // 色粉号
    let cpn = (cellMap.color_powder_no || '').trim();

    // 备注
    let notes = (cellMap.notes || '').trim();

    if (!moldNo) continue;

    results.push({
      product_code: pc,
      mold_no: moldNo,
      mold_name: fullMoldName,
      color,
      color_powder_no: cpn,
      material_type: mat,
      shot_weight: sw,
      material_kg: mkg,
      sprue_pct: 0,
      ratio_pct: 0,
      quantity_needed: qty,
      accumulated: 0,
      cavity: 1,
      cycle_time: 0,
      order_no: orderNo,
      is_three_plate: 0,
      packing_qty: 0,
      notes,
    });
  }

  // 料型跨行合并：如果某条记录料型只有部分（如 "透明ABS"），检查下一行是否有补充
  // TODO: 后续优化

  console.log('[XY] 解析结果:', results.length, '条');
  results.forEach(r => console.log(`  ${r.product_code} ${r.mold_no} qty=${r.quantity_needed} color=${r.color} mat=${r.material_type} sw=${r.shot_weight}`));
  return results;
}

module.exports = { parsePdfXY };
