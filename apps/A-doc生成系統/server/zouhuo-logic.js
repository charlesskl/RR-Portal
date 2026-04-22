/**
 * 走货明细处理逻辑 - 从 ZouhuoMacro.bas 移植
 * 读取 排模表(Sheet1) + 外购清单(Sheet2)，合并生成走货明细行
 */
const XLSX = require('xlsx');
const translate = require('google-translate-api-x');

// 关键词常量
const KW = {
  kMold:   '工模编号',
  kWuLiao: '物料名称',
  kPart:   '部件名称',
  kXu:     '序号',
  kLei:    '类别',
  kMat:    '用料名称',
  kColour: '颜色',
  kUwt:    '单件重',
  kQty:    '用量',
  kProd:   '生产地',
  kSpc:    '规格',
  kSup:    '供应商',
  kWt2:    '单重',
};

function cellText(ws, r, c) {
  const addr = XLSX.utils.encode_cell({ r, c });
  const cell = ws[addr];
  if (!cell) return '';
  return String(cell.v ?? '').trim();
}

/**
 * 从表头区域（前10行×前20列）提取产品编号和产品名称
 */
function extractHeaderInfo(ws) {
  const clean = v => String(v ?? '').replace(/^[\s:：]+/, '').trim();
  const prodNoKw   = ['产品编号', 'Produk No', 'Produk Nomer', 'Item No'];
  const prodNameKw = ['产品名称', 'Nama Produk'];

  let prodNo = '', productName = '';

  for (let r = 0; r <= 9; r++) {
    for (let c = 0; c <= 18; c++) {
      const t = cellText(ws, r, c);
      if (!t) continue;
      if (!prodNo && prodNoKw.some(kw => t.includes(kw))) {
        const v = cellText(ws, r, c + 1) || cellText(ws, r + 1, c);
        if (v) prodNo = clean(v);
      }
      if (!productName && prodNameKw.some(kw => t.includes(kw))) {
        const v = cellText(ws, r, c + 1) || cellText(ws, r + 1, c);
        if (v) productName = clean(v);
      }
    }
    if (prodNo && productName) break;
  }
  return { prodNo, productName };
}

/**
 * 拆分双语物料名称（中英文混写在同一单元格）
 * 例: "transparent tape 1 Inch 透明胶纸-1寸" → { zh:'透明胶纸-1寸', en:'transparent tape 1 Inch' }
 */
function splitBilingual(text) {
  const m = text.search(/[\u4e00-\u9fff\u3400-\u4dbf\uff00-\uffef]/);
  if (m === -1) return { zh: '', en: text.trim() };
  return {
    zh: text.substring(m).trim(),
    en: text.substring(0, m).trim(),
  };
}

/**
 * 批量翻译排模表行的中文名称为英文
 * 只翻译 type==='mold' 且没有 partNameEn 的行
 */
async function translateMoldNames(rows) {
  const needTranslate = rows.filter(r => r.type === 'mold' && !r.partNameEn && r.partName);
  if (needTranslate.length === 0) return;

  // 去重，避免重复翻译相同名称
  const uniqueNames = [...new Set(needTranslate.map(r => r.partName))];
  const cache = {};

  try {
    // 批量翻译（google-translate-api-x 支持数组）
    const results = await translate(uniqueNames, { from: 'zh-CN', to: 'en' });
    if (Array.isArray(results)) {
      results.forEach((res, i) => { cache[uniqueNames[i]] = res.text; });
    } else {
      cache[uniqueNames[0]] = results.text;
    }
  } catch (e) {
    console.error('翻译失败，跳过英文名称:', e.message);
    return;
  }

  // 回填翻译结果
  needTranslate.forEach(row => {
    if (cache[row.partName]) row.partNameEn = cache[row.partName];
  });
}

function cellNum(ws, r, c) {
  const addr = XLSX.utils.encode_cell({ r, c });
  const cell = ws[addr];
  if (!cell) return 0;
  const v = parseFloat(cell.v);
  return isNaN(v) ? 0 : v;
}

/**
 * 找标题行：扫描前30行×前35列，找同时含 kw1+kw2 或含 kw3 的行
 * 返回行号(0-based)，找不到返回 -1
 */
function findHdr(ws, kw1, kw2, kw3) {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  const maxR = Math.min(range.e.r, 29);
  const maxC = Math.min(range.e.c, 34);
  for (let r = 0; r <= maxR; r++) {
    let rowText = '';
    for (let c = 0; c <= maxC; c++) rowText += cellText(ws, r, c);
    if ((kw1 && kw2 && rowText.includes(kw1) && rowText.includes(kw2)) ||
        (kw3 && rowText.includes(kw3))) {
      return r;
    }
  }
  return -1;
}

/**
 * 找列：扫描标题行前50列，找包含任意关键词（|分隔）的列
 * 返回列号(0-based)，找不到返回 -1
 */
function findCol(ws, hRow, kwStr) {
  const kws = kwStr.split('|').map(s => s.trim()).filter(Boolean);
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  const maxC = Math.min(range.e.c, 49);
  for (let c = 0; c <= maxC; c++) {
    const t = cellText(ws, hRow, c);
    if (kws.some(kw => t.includes(kw))) return c;
  }
  return -1;
}

/**
 * 处理 Sheet1（排模表）
 * 返回走货明细行数组（type: 'mold', 蓝色 #DBE5F1）
 */
function processSheet1(ws, prodNo) {
  let hdr = findHdr(ws, KW.kMold, KW.kWuLiao, 'Nomor Molding');
  if (hdr < 0) hdr = findHdr(ws, 'No Part', 'Nama Part', 'Nama Molding');
  if (hdr < 0) hdr = findHdr(ws, '零件编号', '零件名称', '工模名称');
  if (hdr < 0) return [];

  const cMold  = findCol(ws, hdr, `${KW.kMold}|Nomor Molding|Nama Molding|工模名称`);
  // 优先找"零件名称/Nama Part"，避免误选"Nama Molding"（工模名称列）
  const cPname = findCol(ws, hdr, `Nama Part|${KW.kPart}|零件名称|${KW.kWuLiao}`);
  const cMat   = findCol(ws, hdr, `${KW.kMat}|材料|Material`);
  const cCol   = findCol(ws, hdr, `${KW.kColour}|Warna|Pigment`);
  const cUwt   = findCol(ws, hdr, `${KW.kUwt}|部件重量|Berat Perpart|BeratPerpart`);
  const cQty   = findCol(ws, hdr, `${KW.kQty}|Penggunaan|Pengunaan`);
  const cProd  = findCol(ws, hdr, `${KW.kProd}|Tempat Produksi|Tempat`);

  const nameCol = cPname >= 0 ? cPname : 4;

  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  let lastRow = range.e.r;
  // 向上找最后有内容的行
  for (let r = range.e.r; r > hdr; r--) {
    if (cellText(ws, r, nameCol) !== '') { lastRow = r; break; }
  }

  const rows = [];
  let curMat = '', curCol = '';
  let seq = 1;

  for (let r = hdr + 1; r <= lastRow; r++) {
    const pn = cellText(ws, r, nameCol);
    if (!pn) continue;

    const mc = cMold >= 0 ? cellText(ws, r, cMold) : '';
    if (mc) {
      // 这是材料/颜色标题行
      curMat = cMat >= 0 ? cellText(ws, r, cMat) : '';
      curCol = cCol >= 0 ? cellText(ws, r, cCol) : '';
      continue;
    }

    // 普通部件行
    const uwt  = cUwt  >= 0 ? cellNum(ws, r, cUwt)  : 0;
    const qty  = cQty  >= 0 ? cellNum(ws, r, cQty)  : 0;
    const prod = cProd >= 0 ? cellText(ws, r, cProd) : '';

    rows.push({
      seq,
      prodNo,
      partName:  pn,
      material:  [curMat, curCol].filter(Boolean).join(' '),
      unit:      'KG',
      qty:       qty || 0,
      supplier:  '',
      unitWt:    uwt > 0 ? +(uwt / 1000).toFixed(6) : 0,
      source:    '排模',
      category:  '',
      prodPlace: prod,
      type:      'mold',
      color:     '#DBE5F1',
    });
    seq++;
  }
  return rows;
}

/**
 * 处理 Sheet2（外购清单）
 * 返回走货明细行数组（type: 'purchase', 黄色 #FFF2CC）
 */
function processSheet2(ws, prodNo, startSeq) {
  // 优先用"Nama Material"精确定位，避免匹配到含"No"的公司信息行
  let hdr = findHdr(ws, KW.kXu, KW.kLei, 'Nama Material');
  if (hdr < 0) hdr = findHdr(ws, KW.kXu, KW.kLei, 'No');
  if (hdr < 0) return [];

  const cPn2  = findCol(ws, hdr, `${KW.kWuLiao}|Nama Material`);
  const cSpc  = findCol(ws, hdr, `${KW.kSpc}|Spesifikasi`);
  const cQ2   = findCol(ws, hdr, `${KW.kQty}|Penggunaan|Pengunaan`);
  const cW2   = findCol(ws, hdr, `${KW.kWt2}|BeratBersih|Berat Bersih|Berat`);
  const cSup  = findCol(ws, hdr, `${KW.kSup}|Pemasok`);
  const cCat  = findCol(ws, hdr, `${KW.kLei}|Jenis`);
  const cPd2  = findCol(ws, hdr, `${KW.kProd}|Tempat Produksi|Tempat`);

  const nameCol = cPn2 >= 0 ? cPn2 : 2;

  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  let lastRow = range.e.r;
  for (let r = range.e.r; r > hdr; r--) {
    if (cellText(ws, r, nameCol) !== '') { lastRow = r; break; }
  }

  const rows = [];
  let seq = startSeq;

  for (let r = hdr + 1; r <= lastRow; r++) {
    const pn = cellText(ws, r, nameCol);
    if (!pn) continue;

    const spc  = cSpc  >= 0 ? cellText(ws, r, cSpc)  : '';
    const q2   = cQ2   >= 0 ? cellNum(ws, r, cQ2)   : 0;
    const w2   = cW2   >= 0 ? cellNum(ws, r, cW2)   : 0;
    const sup  = cSup  >= 0 ? cellText(ws, r, cSup)  : '';
    const cat  = cCat  >= 0 ? cellText(ws, r, cCat)  : '';
    const pd2  = cPd2  >= 0 ? cellText(ws, r, cPd2)  : '';

    const { zh, en } = splitBilingual(pn);
    rows.push({
      seq,
      prodNo,
      partName:   zh || pn,   // 产品中文名称
      partNameEn: en,          // 产品英文名称
      material:  spc,
      unit:      'PCS',
      qty:       q2 || 0,
      supplier:  sup,
      unitWt:    w2 > 0 ? +(w2 / 1000).toFixed(6) : 0,
      source:    '外购',
      category:  cat,
      prodPlace: pd2,
      type:      'purchase',
      color:     '#FFF2CC',
    });
    seq++;
  }
  return rows;
}

/**
 * 判断一个工作表是排模表还是外购清单
 * 返回 'mold' | 'purchase' | 'unknown'
 */
function detectSheetType(ws) {
  const moldHdr = findHdr(ws, KW.kMold, KW.kWuLiao, 'Nomor Molding');
  if (moldHdr >= 0) return 'mold';
  const purchaseHdr = findHdr(ws, KW.kXu, KW.kLei, 'No');
  if (purchaseHdr >= 0) return 'purchase';
  return 'unknown';
}

/**
 * 单文件处理：传入 xlsm/xlsx buffer，返回 { prodNo, rows, stats }
 */
async function processZouhuoFile(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellStyles: true });
  const sheetNames = wb.SheetNames;

  // 单sheet文件：判断类型后只处理对应部分
  if (sheetNames.length === 1) {
    const ws = wb.Sheets[sheetNames[0]];
    const type = detectSheetType(ws);
    const { prodNo, productName } = extractHeaderInfo(ws);
    if (type === 'mold') {
      const moldRows = processSheet1(ws, prodNo);
      moldRows.forEach((r, i) => { r.seq = i + 1; });
      await translateMoldNames(moldRows);
      return { prodNo, productName, sheetNames, rows: moldRows, stats: { total: moldRows.length, mold: moldRows.length, purchase: 0 } };
    } else if (type === 'purchase') {
      const purchaseRows = processSheet2(ws, prodNo, 1);
      purchaseRows.forEach((r, i) => { r.seq = i + 1; });
      return { prodNo, productName, sheetNames, rows: purchaseRows, stats: { total: purchaseRows.length, mold: 0, purchase: purchaseRows.length } };
    }
    throw new Error('无法识别工作表类型，请确认文件包含排模表或外购清单');
  }

  // 扫描所有Sheet，优先按Sheet名称识别，再按内容检测
  let ws1 = null, ws2 = null;

  function isMoldName(n)     { return /排模|mold/i.test(n); }
  function isPurchaseName(n) { return /外购|purchase|pembelian/i.test(n); }

  // 第一轮：按Sheet名称匹配
  for (const sName of sheetNames) {
    if (isMoldName(sName) && !ws1)         ws1 = wb.Sheets[sName];
    else if (isPurchaseName(sName) && !ws2) ws2 = wb.Sheets[sName];
    if (ws1 && ws2) break;
  }

  // 第二轮：名称未匹配到的，用内容检测补充
  if (!ws1 || !ws2) {
    for (const sName of sheetNames) {
      const ws = wb.Sheets[sName];
      const type = detectSheetType(ws);
      if (type === 'mold' && !ws1)          ws1 = ws;
      else if (type === 'purchase' && !ws2) ws2 = ws;
      if (ws1 && ws2) break;
    }
  }

  // 第三轮：两轮都失败，直接取前两个Sheet
  if (!ws1 && !ws2 && sheetNames.length >= 2) {
    ws1 = wb.Sheets[sheetNames[0]];
    ws2 = wb.Sheets[sheetNames[1]];
  }

  if (!ws1 && !ws2) {
    throw new Error('无法识别工作表类型，请确认文件包含「排模表」或「外购清单」');
  }

  // 优先从排模表取产品编号和名称，外购清单补充
  const info1 = ws1 ? extractHeaderInfo(ws1) : { prodNo: '', productName: '' };
  const info2 = ws2 ? extractHeaderInfo(ws2) : { prodNo: '', productName: '' };
  const prodNo      = info1.prodNo      || info2.prodNo      || '';
  const productName = info1.productName || info2.productName || '';

  // DEBUG: 打印排模表前5行内容
  if (ws1) {
    console.log('[DEBUG] 排模表前5行:');
    for (let r = 0; r <= 4; r++) {
      let row = '';
      for (let c = 0; c <= 10; c++) row += `[${cellText(ws1, r, c)}]`;
      console.log(`  行${r}: ${row}`);
    }
  }
  // DEBUG: 打印外购清单前5行内容
  if (ws2) {
    console.log('[DEBUG] 外购清单前5行:');
    for (let r = 0; r <= 4; r++) {
      let row = '';
      for (let c = 0; c <= 10; c++) row += `[${cellText(ws2, r, c)}]`;
      console.log(`  行${r}: ${row}`);
    }
  }

  const moldRows = ws1 ? processSheet1(ws1, prodNo) : [];
  console.log(`[DEBUG] 排模表解析结果: ${moldRows.length} 行`);
  await translateMoldNames(moldRows);
  const purchaseRows = ws2 ? processSheet2(ws2, prodNo, moldRows.length + 1) : [];
  console.log(`[DEBUG] 外购清单解析结果: ${purchaseRows.length} 行`);
  const allRows = [...moldRows, ...purchaseRows];
  allRows.forEach((row, i) => { row.seq = i + 1; });

  return {
    prodNo,
    productName,
    sheetNames,
    rows: allRows,
    stats: { total: allRows.length, mold: moldRows.length, purchase: purchaseRows.length },
  };
}

/**
 * 双文件合并处理：自动判断哪个是排模表、哪个是外购清单
 * buffers: [{ buffer, fileName }]
 */
async function processZouhuoFilePair(buffers) {
  let ws1 = null, ws2 = null;
  const sheetNames = [];

  for (const { buffer, fileName } of buffers) {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    for (const sName of wb.SheetNames) {
      const ws = wb.Sheets[sName];
      const type = detectSheetType(ws);
      if (type === 'mold' && !ws1)      { ws1 = ws; sheetNames.push(sName); }
      else if (type === 'purchase' && !ws2) { ws2 = ws; sheetNames.push(sName); }
    }
  }

  if (!ws1 && !ws2) throw new Error('无法识别文件类型，请确认文件包含「排模表」或「外购清单」');

  const info1 = ws1 ? extractHeaderInfo(ws1) : { prodNo: '', productName: '' };
  const info2 = ws2 ? extractHeaderInfo(ws2) : { prodNo: '', productName: '' };
  const prodNo      = info1.prodNo      || info2.prodNo      || '';
  const productName = info1.productName || info2.productName || '';

  const moldRows     = ws1 ? processSheet1(ws1, prodNo) : [];
  await translateMoldNames(moldRows);
  const purchaseRows = ws2 ? processSheet2(ws2, prodNo, moldRows.length + 1) : [];
  const allRows = [...moldRows, ...purchaseRows];
  allRows.forEach((row, i) => { row.seq = i + 1; });

  return {
    prodNo,
    productName,
    sheetNames,
    rows: allRows,
    stats: { total: allRows.length, mold: moldRows.length, purchase: purchaseRows.length },
  };
}

module.exports = { processZouhuoFile, processZouhuoFilePair, detectSheetType };
