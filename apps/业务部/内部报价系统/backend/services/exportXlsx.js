// 把报价单 + 各部门 section 导出成 xlsx，布局对齐 47765A_产品报价清单 sheet1
// 9 章节 + 模具行图片嵌入
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

const RMB = '￥#,##0.00';
const HKD = '"HK$"#,##0.00';
const HKD4 = '"HK$"#,##0.0000';
const PCT = '0.00%';
const FONT = 'Microsoft YaHei';  // 全表统一字体
// 辅助/包装材料 类别 — 减税明细各外购项按此类别统计（须与前端 workbench.js MAT_CATEGORIES 一致）
const MAT_CATEGORIES = ['吸塑', '胶袋', '彩盒/内咭', '电池', '产品利宝', '彩盒利宝', '电镀', '其他外购'];
const MOLD_USD_HKD = 7.8;
const SUBTOTAL_FILL = 'FFFEF3C7';
const SUBTOTAL_FONT = 'FF92400E';

// 工具
const num = (v) => Number(v) || 0;
const sum = (arr, fn) => arr.reduce((a, r) => a + (fn(r) || 0), 0);
function hasFreeRmbPrice(row) {
  return row && row.unit_price_rmb !== undefined && row.unit_price_rmb !== null && row.unit_price_rmb !== '';
}
function freeUnitRmb(row, fxRH) {
  const fx = num(fxRH) || 0.85;
  return hasFreeRmbPrice(row) ? num(row.unit_price_rmb) : num(row.unit_price) * fx;
}
function freeUnitHkd(row, fxRH) {
  const fx = num(fxRH) || 0.85;
  return hasFreeRmbPrice(row) ? num(row.unit_price_rmb) / fx : num(row.unit_price);
}
function freeAmountHkd(row, fxRH) {
  if (row && row.is_subtotal) return num(row.amount);
  return num(row && row.qty) * freeUnitHkd(row, fxRH);
}
// 车缝：人工若已作为明细行(名称含"人工")计入，则不再额外加 labor_amount，避免双算
function sewLaborToAdd(g) {
  const items = (g && g.items) || [];
  const laborInItems = sum(items, r => /人工/.test(r.fabric || r.part || r.name || '')
    ? num(r.usage) * num(r.mat_price) * (num(r.markup) || 1) : 0);
  return laborInItems > 0 ? 0 : num(g && g.labor_amount);
}

function sewGroupQty(group) {
  const value = group && group.product_qty;
  if (value == null || value === '') return 1;
  const parsed = Number(value);
  return Number.isNaN(parsed) || parsed < 0 ? 1 : parsed;
}
function sewTotalQty(sewing) {
  const groups = (sewing && sewing.sewing_groups) || [];
  const override = sewing && sewing.sewing_total_qty;
  if (override != null && override !== '' && Number(override) > 0) return Number(override);
  return groups.reduce((total, group) => total + sewGroupQty(group), 0) || 1;
}

// 暖灰系单色调
function styleHeader(cell) {
  cell.font = { bold: true, color: { argb: 'FF1F2937' }, size: 11, name: 'Microsoft YaHei' };
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0DBA1' } };  // 合计同色 暖米
  cell.border = thinBorder();
  if (cell.worksheet && cell.worksheet.getRow(cell.row).height < 30) {
    cell.worksheet.getRow(cell.row).height = 30;
  }
}
function styleData(cell) {
  cell.font = cell.font || { size: 11, color: { argb: 'FF44403C' }, name: 'Microsoft YaHei' };
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  cell.border = thinBorder();
  if (cell.worksheet) {
    const r = cell.worksheet.getRow(cell.row);
    if (!r.height || r.height < 26) r.height = 26;
  }
}
function styleSection(cell) {
  // 章节标题：白底 + 加粗深色文字，不填充
  cell.font = { bold: true, size: 14, color: { argb: 'FF704917' }, name: 'Microsoft YaHei' };
  cell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
  cell.border = { bottom: { style: 'medium', color: { argb: 'FFF0DBA1' } } };
  if (cell.worksheet) cell.worksheet.getRow(cell.row).height = 30;
}
function styleSubtotal(cell, level) {
  // 奶油拿铁 配色
  const palette = {
    sub:   'FFFDF8E7',  // 极浅奶
    total: 'FFF0DBA1',  // 暖米（合计）
    hkd:   'FFF0DBA1',  // 同合计
    loss:  'FFFBF5E0',  // 米色
  };
  const color = palette[level] || palette.sub;
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
  cell.border = thinBorder();
  if (cell.worksheet) {
    const r = cell.worksheet.getRow(cell.row);
    if (!r.height || r.height < 24) r.height = 24;
  }
}
function thinBorder() {
  const s = { style: 'thin', color: { argb: 'FFEFE7D2' } };  // 米色边框
  return { top: s, bottom: s, left: s, right: s };
}
function mediumBorder() {
  const s = { style: 'medium', color: { argb: 'FF1E40AF' } };
  return { top: s, bottom: s, left: s, right: s };
}

async function buildWorkbook({ quote, sections }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = '内部报价系统';
  wb.created = new Date();
  const ws = wb.addWorksheet('报价明细');

  // 列宽（13 列）— 整体加宽
  ws.columns = [
    { width: 18 },  // A 序号 / 注塑 / 出货底价 HK$ 标签等
    { width: 28 },  // B 主名称
    { width: 18 },  // C 模号 / 规格
    { width: 16 },  // D 模胚类型
    { width: 14 },  // E 模具结构
    { width: 12 },  // F 材质
    { width: 12 },  // G 出模数
    { width: 15 },  // H 套数 / 印尼运费
    { width: 16 },  // I 模具尺寸
    { width: 14 },  // J 图片(左) / 总计 RMB
    { width: 14 },  // K 图片(右) / 报客 HKD
    { width: 18 },  // L 价格 / 总计 RMB
    { width: 16 },  // M 价格/报价 / 报客 HKD
    { width: 14 },  // N
    { width: 14 },  // O
    { width: 18 },  // P 模价 HKD
    { width: 16 },  // Q 出货底价 RMB
    { width: 16 },  // R 出货底价 HKD
  ];

  let row = 1;

  // 报价单标题
  ws.mergeCells(row, 1, row, 13);
  const titleCell = ws.getCell(row, 1);
  titleCell.value = `${quote.quote_no || ''} ${quote.product_name || ''} 内部报价明细`;
  titleCell.font = { bold: true, size: 18, color: { argb: 'FF1F2937' }, name: 'Microsoft YaHei' };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
  ws.getRow(row).height = 40;
  row += 1;

  // 报价单元信息
  ws.mergeCells(row, 1, row, 13);
  const subCell = ws.getCell(row, 1);
  subCell.value = `客户: ${quote.customer || '—'}    数量: ${quote.qty || '—'}    创建: ${quote.created_at || ''}`;
  subCell.alignment = { horizontal: 'center', vertical: 'middle' };
  subCell.font = { color: { argb: 'FF64748B' }, size: 11, italic: true, name: 'Microsoft YaHei' };
  subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
  ws.getRow(row).height = 22;
  row += 2;

  const get = (dept) => {
    const s = sections.find(x => x.dept === dept);
    if (!s || !s.payload_json) return {};
    // 单个 section 的 payload 若损坏，当空处理，避免整单导出 500
    try { return JSON.parse(s.payload_json); }
    catch (e) { console.error(`[export] ${dept} payload_json 解析失败，按空处理:`, e.message); return {}; }
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

  // ---------- 一、模具部分 ----------
  // 列序与 UI（renderMolds）一致：A序号 B名称 C模号 D模胚类型 E模具结构 F材质 G颜色
  //   H出模数 I套数 J净重(g) K周期(秒) L模具尺寸 M-N图片(合并) O价格RMB P价格USD Q模价HKD R备注
  ws.mergeCells(row, 1, row, 18); styleSection(ws.getCell(row, 1));
  ws.getCell(row, 1).value = '一、模具部分';
  row += 1;
  const moldHeader = ['序号', '模具名称', '模号', '模胚类型', '模具结构', '材质', '颜色', '出模数', '套数', '净重(g)', '周期(秒)', '模具尺寸', '图   片', '', '模具价格（RMB）', '模具价格（USD）', '模价 HKD', '备   注'];
  moldHeader.forEach((h, i) => { ws.getCell(row, i + 1).value = h; styleHeader(ws.getCell(row, i + 1)); });
  ws.mergeCells(row, 13, row, 14); // 图片列合并(M:N)
  row += 1;

  const molds = eng.molds || [];
  const moldDataStart = row;
  for (let mi = 0; mi < molds.length; mi++) {
    const m = molds[mi];
    const r = row;
    ws.getRow(r).height = 60;
    ws.getCell(r, 1).value = mi + 1;
    ws.getCell(r, 2).value = m.name || '';
    ws.getCell(r, 3).value = m.mold_no || '';
    ws.getCell(r, 4).value = m.mold_type || '';
    ws.getCell(r, 4).alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
    ws.getCell(r, 5).value = m.structure || '';
    ws.getCell(r, 6).value = m.material || '';
    ws.getCell(r, 7).value = m.color || '';
    ws.getCell(r, 8).value = m.cavity || '';
    ws.getCell(r, 9).value = m.sets ?? 1;
    ws.getCell(r, 10).value = m.weight_g == null || m.weight_g === '' ? '' : num(m.weight_g);
    ws.getCell(r, 11).value = m.cycle_sec == null || m.cycle_sec === '' ? '' : num(m.cycle_sec);
    ws.getCell(r, 12).value = (m.detail && m.detail.mold_size) || '';
    ws.mergeCells(r, 13, r, 14);
    ws.getCell(r, 15).value = num(m.price_rmb);
    ws.getCell(r, 15).numFmt = RMB;
    ws.getCell(r, 16).value = num(m.price_usd);
    ws.getCell(r, 16).numFmt = '"$"#,##0.00';
    ws.getCell(r, 17).value = { formula: `O${r}/${fxRH}+P${r}*${MOLD_USD_HKD}`,
      result: num(m.price_rmb) / fxRH + num(m.price_usd) * MOLD_USD_HKD };
    ws.getCell(r, 17).numFmt = '"HK$"#,##0.00';
    ws.getCell(r, 18).value = m.note || '';
    for (let c = 1; c <= 18; c++) styleData(ws.getCell(r, c));

    // 嵌入所有图片：2 列 × N 行 网格布局
    const imgs = (m.images || []).filter(Boolean);
    if (imgs.length) {
      const perRow = 2;
      const imgW = 55, imgH = 55;
      const gridRows = Math.ceil(imgs.length / perRow);
      const rowHeightPt = gridRows * 50 + 10; // 留 10pt 缓冲
      ws.getRow(r).height = rowHeightPt;

      // 每张图占的"行比例" = imgH(px) / rowHeight(pt) × (4/3 px/pt)
      // 简化为均分行：每张图垂直占 (1/gridRows) 行
      imgs.forEach((imgPath, i) => {
        const abs = path.join(__dirname, '..', imgPath.replace(/^uploads\//, 'uploads/'));
        if (!fs.existsSync(abs)) return;
        try {
          const ext = path.extname(abs).slice(1).toLowerCase().replace('jpeg', 'jpg');
          const id = wb.addImage({ filename: abs, extension: ext === 'jpg' ? 'jpeg' : ext });
          const xi = i % perRow;
          const yi = Math.floor(i / perRow);
          // tl.col: 第一张 → col 13 起始 (idx 12)，第二张 → col 14 起始 (idx 13)
          // tl.row 用 yi/gridRows 把图均分行高
          ws.addImage(id, {
            tl: { col: 12 + xi, row: r - 1 + (yi / gridRows) },
            ext: { width: imgW, height: imgH },
          });
        } catch (e) { /* skip bad image */ }
      });
    }
    row += 1;
  }
  // 小计 RMB - SUM 公式（只在数值格上色）
  const moldDataEnd = row - 1;
  const whiteFill = (r) => {
    for (let c = 1; c <= 18; c++) {
      const cell = ws.getCell(r, c);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
      cell.border = thinBorder();
      cell.alignment = cell.alignment || { horizontal: 'center', vertical: 'middle' };
    }
  };
  // 小计：与 UI 一致，同一行 价格RMB(O) + 价格USD(P) + 模价HKD(Q)
  ws.mergeCells(row, 1, row, 14);
  ws.getCell(row, 1).value = `小计 (汇率 RMB ${fxRH} · USD ${MOLD_USD_HKD})`;
  ws.getCell(row, 1).alignment = { horizontal: 'right', vertical: 'middle' };
  const moldSubtotal = sum(molds, m => num(m.price_rmb));
  const moldSubtotalUsd = sum(molds, m => num(m.price_usd));
  const moldSubtotalRow = row;
  ws.getCell(row, 15).value = molds.length
    ? { formula: `SUM(O${moldDataStart}:O${moldDataEnd})`, result: moldSubtotal }
    : 0;
  ws.getCell(row, 15).numFmt = RMB;
  ws.getCell(row, 16).value = molds.length
    ? { formula: `SUM(P${moldDataStart}:P${moldDataEnd})`, result: moldSubtotalUsd }
    : 0;
  ws.getCell(row, 16).numFmt = '"$"#,##0.00';
  ws.getCell(row, 17).value = molds.length
    ? { formula: `SUM(Q${moldDataStart}:Q${moldDataEnd})`, result: moldSubtotal / fxRH + moldSubtotalUsd * MOLD_USD_HKD }
    : 0;
  ws.getCell(row, 17).numFmt = '"HK$"#,##0.00';
  whiteFill(row);
  styleSubtotal(ws.getCell(row, 15), 'sub');
  styleSubtotal(ws.getCell(row, 16), 'total');
  styleSubtotal(ws.getCell(row, 17), 'total');
  ws.getCell(row, 1).font = { bold: true, color: { argb: 'FF1F2937' }, name: 'Microsoft YaHei' };
  ws.getCell(row, 15).font = { bold: true, color: { argb: 'FF1F2937' }, name: 'Microsoft YaHei' };
  ws.getCell(row, 16).font = { bold: true, color: { argb: 'FF1F2937' }, name: 'Microsoft YaHei' };
  ws.getCell(row, 17).font = { bold: true, color: { argb: 'FF1F2937' }, name: 'Microsoft YaHei' };
  row += 2;

  // 收集各 section 的"合计"单元格地址，供九、合计行用公式引用
  const subRefs = {};

  // 模具分摊 套数（与下方 九、合计 同源，确保 模具费用表 分摊 与 模具分摊 公式一致）
  const moldAmortQty = Math.max(num((eng.mold_costs || {}).amortization_qty) || num((sales.pricing || {}).mold_amortization_qty) || num(quote.qty), 1);

  // ---------- 模具费用（mold_costs 子表）----------
  row = renderMoldCosts(ws, row, eng.mold_costs, quote, subRefs, moldAmortQty);

  // ---------- 二、注塑部分 ----------
  row = renderInjection(ws, row, mold, fxRH, subRefs);
  const injSubtotal = injectionSubtotal(mold);

  // ---------- 二·B、吹气 / 二·C、搪胶 ----------
  row = renderBlowBlock(ws, row, mold, subRefs);
  row = renderSlushBlock(ws, row, slush, fxRH, subRefs);

  // ---------- 三、二次加工 ----------
  row = renderSecondProc(ws, row, pnt, fxRH, subRefs);
  const ppSubtotal = secondProcSubtotal(pnt);

  // ---------- 四、电子 / 五、五金（两张子表，五金不计损耗） ----------
  // 电子 总表：优先用 电子部 section 的 payload；回退用 工程的（兼容旧数据）
  const elecRows = (electronic.electronics && electronic.electronics.length) ? electronic.electronics : (eng.electronics || []);
  const elecLoss = 0;  // 电子 不计算损耗
  row = renderFreeTable(ws, row, '四、电子', elecRows, elecLoss, fxRH, subRefs, 'electronic', { isHkd: true, skipLoss: true, rmbPrice: true });
  row = renderFreeTable(ws, row, '五、五金', eng.hardware   || [], 0, fxRH, subRefs, 'hardware', { skipLoss: true, isHkd: true, rmbPrice: true });  // 五金不计损耗、按港币
  const elecOnlySubtotal = freeSubtotal(elecRows, fxRH);
  const hwSubtotal = freeSubtotal(eng.hardware || [], fxRH);
  const elecSubtotal = elecOnlySubtotal + hwSubtotal;

  // ---------- 五、辅助材料 ----------
  row = renderFreeTable(ws, row, '六、辅助材料', eng.aux_materials || [], 0, fxRH, subRefs, 'aux', { skipLoss: true, isHkd: true, rmbPrice: true });  // 不计损耗、按港币
  const auxSubtotal = freeSubtotal(eng.aux_materials || [], fxRH);

  // ---------- 六、包装材料 ----------
  row = renderFreeTable(ws, row, '七、包装材料', eng.packaging_materials || [], 0, fxRH, subRefs, 'packaging', { skipLoss: true, isHkd: true, rmbPrice: true });  // 不计损耗、按港币
  const pkSubtotal = freeSubtotal(eng.packaging_materials || [], fxRH);

  // ---------- 八/九、组装+包装人工 — 排拉工序：明细拆到「装配明细」分表，主表只留汇总 ----------
  const defaultAssemblyBase = quote.factory_code === 'heyuan' ? 260 : 310;
  const _asmBase = num(asm.assembly_base_rate ?? defaultAssemblyBase);
  const _asmStd = num(asm.assembly_std_time ?? 11);
  const asmDetail = addAssemblyDetailSheet(wb, asm, _asmBase, _asmStd);
  row = renderAssemblyMainSummary(ws, row, '八、组装人工 — 排拉工序', asm.assembly_step_groups || [], _asmBase, _asmStd, asmDetail.asmPeopleCells, subRefs, 'asmLabor');
  const asmStepRmb = asmDetail.asmTotalVal;  // = Σ(基数×人数×小组/生产量)，与明细段合计一致
  const asmSubtotal = sum(asm.assembly_labor || [], r => num(r.unit_price) * num(r.qty)) + asmStepRmb;

  row = renderAssemblyMainSummary(ws, row, '九、包装/混装人工 — 排拉工序', asm.packaging_step_groups || [], _asmBase, _asmStd, asmDetail.pkgPeopleCells, subRefs, 'pkgLabor');
  const pkgStepRmb = asmDetail.pkgTotalVal;
  const pklSubtotal = sum(asm.packaging_labor || [], r => num(r.unit_price) * num(r.qty)) + pkgStepRmb;

  // ---------- 车缝 ----------
  row = renderSewingBlock(ws, row, sewing, fxRH, subRefs);

  // ---------- 纸箱 / 运费（在九、合计前） ----------
  row = renderCartonAndFreight(ws, row, eng, sales, subRefs);

  // ---------- 九、合计（含搪胶/车缝/纸箱/附加税） ----------
  ws.mergeCells(row, 1, row, 14); styleSection(ws.getCell(row, 1));
  ws.getCell(row, 1).value = '十、合计';
  row += 1;

  // 整行 HKD（与 UI 一致）；出厂价(=前面成本列之和)/码点/模具分摊 不单列，码点+模具在下方「出货价算价」
  const totalsHeader = ['注塑+吹气', '二次加工（印喷）', '电子', '五金', '辅助材料', '包装材料', '组装人工', '包装/混装人工', '印尼运费', '搪胶', '车缝', '纸箱', '附加税0.4%', '出货底价 HKD'];
  totalsHeader.forEach((h, i) => { ws.getCell(row, i + 1).value = h; styleHeader(ws.getCell(row, i + 1)); });
  row += 1;

  const pricing = sales.pricing || {};
  const header = sales.header || {};
  // 运输费 = 减税明细 印尼运费 (HKD)；× fxRH 当 RMB（后面 /fxRH 还原 HKD）
  const shipping = num(sales.pricing_summary?.indo_freight) * fxRH;
  // 注塑是 HKD，换算成 RMB
  const injSubtotalRmb = injSubtotal * fxRH;
  // 模具分摊：从工程"模具费用"表取 套产品分摊
  const mc = eng.mold_costs || {};
  const moldCostSumRmb = sum(mc.items || [], r => num(r.price_rmb));
  const moldFx = num(mc.fx_rmb_usd) || 7.75;
  const prototypeAmortQty = Math.max(num(mc.prototype_amortization_qty) || 50000, 1);
  const testingAmortQty = Math.max(num(mc.testing_amortization_qty) || 2000, 1);
  const prototypeShareUsd = num(mc.prototype_fee_usd ?? mc.prototype_fee_rmb) / prototypeAmortQty;
  const testingShareUsd = num(mc.testing_fee_usd ?? mc.testing_fee_rmb) / testingAmortQty;
  const moldShare = moldCostSumRmb / moldAmortQty + (prototypeShareUsd + testingShareUsd) * moldFx * 0.85;
  const surtax = sales.pricing_summary?.surtax != null ? num(sales.pricing_summary.surtax) : 0;
  const slushTotalRmb = sum(slush.slush_items || [], r => num(r.qty) * num(r.unit_price_hkd)) * fxRH;
  const sewingWeightedSum = sum(sewing.sewing_groups || [], group =>
    (sum(group.items || [], item => num(item.usage) * num(item.mat_price) * (num(item.markup) || 1)) + sewLaborToAdd(group)) * sewGroupQty(group));
  const sewingTotalRmb = sewingWeightedSum / sewTotalQty(sewing);
  // 多纸箱 + 多平卡：Σ((箱价i + Σ平卡i_j) / qty_i) × 汇率
  const ccx = eng.carton_calc || {};
  const cartonListX = (ccx.cartons && ccx.cartons.length) ? ccx.cartons : (ccx.cl ? [{
    cl: ccx.cl, cw: ccx.cw, ch: ccx.ch, qty: ccx.qty,
    flat_cards: ccx.flat_card ? [{ l: ccx.cl, w: ccx.cw }] : [],
  }] : []);
  const cartonRateX = num(ccx.paper_rate) || 2.75;
  const cartonRmb = cartonListX.reduce((s, b) => {
    const boxPrice = (num(b.cl) + num(b.cw) + 2) * (num(b.cw) + num(b.ch) + 1) * 2 * cartonRateX / 1000;
    const flatSum = (b.flat_cards || []).reduce((a, f) => a + ((num(f.l) || num(b.cl)) + 1) * ((num(f.w) || num(b.cw)) + 1) * 2 / 1000, 0);
    const q = Math.max(num(b.qty), 1);
    return s + (boxPrice + flatSum) / q;
  }, 0) * fxRH;
  // cost 包含 吹气/搪胶/车缝/纸箱
  const blowRmb = sum(mold.blow_items || [], r => {
    const mat = num(r.weight_g) * num(r.material_price_lb) / 454;
    return (mat + num(r.blow_labor) + num(r.flash)) * (num(r.profit_x) || 1);
  }) * fxRH;
  // 电子/五金/辅助/包装/二次加工(喷油)/组装+包装人工 现按港币(HKD)，加入 RMB 成本时 ×fxRH 还原成 RMB
  const cost = injSubtotalRmb + blowRmb + (ppSubtotal + elecSubtotal + auxSubtotal + pkSubtotal + asmSubtotal + pklSubtotal) * fxRH + shipping + slushTotalRmb + sewingTotalRmb + cartonRmb;
  // 出厂价（直接 = 各项成本和，不含管理系数、模具分摊、附加税）
  const factoryRmb = cost;
  const factoryHkd = factoryRmb / fxRH;
  // 出货底价（含模具分摊 + 附加税）
  const priceRmb = factoryRmb + moldShare + surtax;
  const priceHkd = priceRmb / fxRH;

  // 12 个成本项 A-L + M附加税 + N出货底价；电子(C)、车缝(K)在出货价算价中单独处理。
  const summaryRow = row;
  const HKD_FMT = '"HK$"#,##0.0000';
  const inputs = [
    // A 注塑+吹气 (HKD) — 注塑、吹气都是 HKD
    (subRefs.injection || subRefs.blow)
      ? { formula: `(${[subRefs.injection, subRefs.blow].filter(Boolean).join('+')})`,
          result: injSubtotal + sum(mold.blow_items || [], r => {
            const mat = num(r.weight_g) * num(r.material_price_lb) / 454;
            return (mat + num(r.blow_labor) + num(r.flash)) * (num(r.profit_x) || 1);
          }) }
      : injSubtotalRmb / fxRH,
    // B 二次加工 (本身 HKD，不换算)
    subRefs.secondProc ? { formula: `${subRefs.secondProc}`, result: ppSubtotal } : ppSubtotal,
    // C 电子 / D 五金
    subRefs.electronic ? { formula: `${subRefs.electronic}`, result: elecOnlySubtotal } : elecOnlySubtotal,
    subRefs.hardware ? { formula: `${subRefs.hardware}`, result: hwSubtotal } : hwSubtotal,
    // E 辅助材料 (HKD)
    subRefs.aux ? { formula: `${subRefs.aux}`, result: auxSubtotal } : auxSubtotal,
    // E 包装材料 (HKD)
    subRefs.packaging ? { formula: `${subRefs.packaging}`, result: pkSubtotal } : pkSubtotal,
    // F 组装人工 (本身 HKD，不换算)
    subRefs.asmLabor ? { formula: `${subRefs.asmLabor}`, result: asmSubtotal } : asmSubtotal,
    // G 包装人工 (本身 HKD，不换算)
    subRefs.pkgLabor ? { formula: `${subRefs.pkgLabor}`, result: pklSubtotal } : pklSubtotal,
    // H 运输费 (RMB → HKD)
    shipping / fxRH,
    // I 搪胶 (本身就是 HKD)
    subRefs.slush ? { formula: subRefs.slush, result: slushTotalRmb / fxRH } : slushTotalRmb / fxRH,
    // J 车缝 (RMB → HKD)
    subRefs.sewing ? { formula: `${subRefs.sewing}/${fxRH}`, result: sewingTotalRmb / fxRH } : sewingTotalRmb / fxRH,
    // K 纸箱 (HKD)
    subRefs.cartonHkdPerPcs ? { formula: `(${subRefs.cartonHkdPerPcs})`, result: cartonRmb / fxRH } : cartonRmb / fxRH,
  ];
  inputs.forEach((v, i) => {
    const c = ws.getCell(row, i + 1);
    c.value = v; c.numFmt = HKD_FMT; styleData(c);
  });
  // M 附加税；N 出货底价 = SUM(A:L)-C(电子)-K(车缝)+M。
  ws.getCell(row, 13).value = surtax / fxRH; ws.getCell(row, 13).numFmt = HKD_FMT; styleData(ws.getCell(row, 13));
  const baseHkdMarked = factoryHkd - elecOnlySubtotal - sewingTotalRmb / fxRH + surtax / fxRH;
  ws.getCell(row, 14).value = { formula: `SUM(A${row}:L${row})-C${row}-K${row}+M${row}`, result: baseHkdMarked };
  ws.getCell(row, 14).numFmt = HKD_FMT; styleData(ws.getCell(row, 14)); styleSubtotal(ws.getCell(row, 14), 'hkd');
  ws.getRow(row).font = { bold: true, color: { argb: 'FF1F2937' }, name: 'Microsoft YaHei' };
  row += 2;

  // 出货价算价：所有场景底价统一 = 九、合计 出货底价（出厂价 + 附加税），再在那边 ×码点 ÷找数
  // 模费按 RMB 计算；手板费和测试费直接按 USD 总额分摊。
  const moldFeeShareUsd = (moldCostSumRmb / 0.85 / moldFx - num(mc.customer_subsidy_usd)) / moldAmortQty;

  // ---------- 十、出货价算价（多场景） ----------
  const shipOpts = {
    summaryRow, markedHkd: baseHkdMarked, combinedHkd: baseHkdMarked,
    sewingHkd: sewingTotalRmb / fxRH,
    elecHkd: elecOnlySubtotal,
    moldShareUsd: moldFeeShareUsd,
    prototypeShareUsd,
    testingShareUsd,
    moldShareUsdCell: subRefs.moldShareUsdCell,
    prototypeShareUsdCell: subRefs.prototypeShareUsdCell,
    testingShareUsdCell: subRefs.testingShareUsdCell,
    freightCells: subRefs.freightCells,
    sharedRefs: subRefs,
  };
  row = renderShippingBlock(ws, row, sales.shipping, header, fxRH, shipOpts);
  // 把"盐田40柜"运费/吊柜费单元格带回 subRefs，供减税明细 表2 直接引用
  subRefs.shipFreightCell = shipOpts.shipFreightCell;
  subRefs.shipCabinetCell = shipOpts.shipCabinetCell;

  // ---------- 减税明细 / 成本汇总 ----------
  row = renderTaxSummary(ws, row, sales, { subRefs, fxRH, summaryRow });

  // 业务算价参数说明
  ws.mergeCells(row, 1, row, 13);
  ws.getCell(row, 1).value = `算价：管理费 ${pricing.mgmt_fee_pct || 0}% · 利润 ${pricing.profit_pct || 0}% · 税率 ${pricing.tax_pct || 0}% · RMB→HKD ${fxRH} · HKD→USD ${header.fx_hkd_usd || ''}`;
  ws.getCell(row, 1).alignment = { horizontal: 'center' };
  ws.getCell(row, 1).font = { color: { argb: 'FF6B7280' }, italic: true };

  // 车缝明细：单独分表
  addSewingDetailSheet(wb, sewing, fxRH);
  // 电子明细：单独分表（用 electronic 部门 payload）
  addElectronicDetailSheet(wb, electronic, quote);

  beautifyFonts(wb);  // 统一美化字体
  return wb;
}

// 统一字体（美化）：全表用同一字体族，保留各单元格的 size/bold/color/italic
function beautifyFonts(wb, name = FONT) {
  wb.eachSheet((ws) => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const f = cell.font || {};
        cell.font = { name, size: f.size || 11, ...f, name };  // name 始终覆盖为统一字体
      });
    });
  });
}

// 电子明细 — 独立 sheet（按导入的"电子报价单"格式还原）
function addElectronicDetailSheet(wb, electronic, quote) {
  const doc = electronic && electronic.electronics_doc;
  if (!doc || !doc.parts || !doc.parts.length) return;
  const ws = wb.addWorksheet('电子明细');
  ws.columns = [
    { width: 12 },  // A 零件名称
    { width: 30 },  // B 规格
    { width: 8 },   // C 用量
    { width: 12 },  // D 单价RMB
    { width: 12 },  // E 合计RMB
    { width: 14 },  // F 备注
    { width: 14 },  // G 汇总标签
    { width: 12 },  // H 汇总值
    { width: 12 },  // I 注
  ];
  let row = 1;
  // 标题
  ws.mergeCells(row, 1, row, 9);
  ws.getCell(row, 1).value = '电子报价单';
  ws.getCell(row, 1).font = { bold: true, size: 16, name: 'Microsoft YaHei' };
  ws.getCell(row, 1).alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(row).height = 28;
  row += 2;
  // 元数据
  const meta = doc.meta || {};
  ws.getCell(row, 1).value = '产品名称：' + (meta.product || (quote && quote.product_name) || '');
  ws.getCell(row, 3).value = '产品编号：' + (meta.product_no || (quote && quote.quote_no) || '');
  ws.getCell(row, 5).value = '客户：' + (meta.customer || (quote && quote.customer) || '');
  ws.getCell(row, 7).value = '报价日期：' + (meta.date || doc.imported_at || '');
  for (let c = 1; c <= 9; c++) ws.getCell(row, c).font = { name: 'Microsoft YaHei' };
  row += 2;
  // 表头
  const h = ['零件名称', '规格', '用量', '单价RMB', '合计RMB', '备注'];
  h.forEach((v, i) => { ws.getCell(row, i + 1).value = v; styleHeader(ws.getCell(row, i + 1)); });
  row += 1;
  const dataStart = row;
  doc.parts.forEach(p => {
    // 父行
    ws.getCell(row, 1).value = p.name || '';
    ws.getCell(row, 2).value = p.spec || '';
    ws.getCell(row, 3).value = num(p.qty);
    ws.getCell(row, 4).value = num(p.unit_price);
    ws.getCell(row, 5).value = { formula: `C${row}*D${row}`, result: num(p.qty) * num(p.unit_price) };
    ws.getCell(row, 5).numFmt = '0.000';
    ws.getCell(row, 6).value = p.note || '';
    for (let c = 1; c <= 6; c++) styleData(ws.getCell(row, c));
    if (p.name) ws.getCell(row, 1).font = { bold: true, name: 'Microsoft YaHei' };
    row += 1;
    // 子项行
    (p.children || []).forEach(c => {
      ws.getCell(row, 1).value = '';
      ws.getCell(row, 2).value = c.spec || '';
      ws.getCell(row, 3).value = num(c.qty);
      ws.getCell(row, 4).value = num(c.unit_price);
      ws.getCell(row, 5).value = { formula: `C${row}*D${row}`, result: num(c.qty) * num(c.unit_price) };
      ws.getCell(row, 5).numFmt = '0.000';
      ws.getCell(row, 6).value = c.note || '';
      for (let k = 1; k <= 6; k++) styleData(ws.getCell(row, k));
      row += 1;
    });
  });
  const dataEnd = row - 1;
  row += 1;
  // 成本汇总
  const ex = doc.extras || {};
  const partsCost = sum(doc.parts, p => num(p.qty) * num(p.unit_price)
    + sum(p.children || [], c => num(c.qty) * num(c.unit_price)));
  const labels = [
    ['零件成本', partsCost, `SUM(E${dataStart}:E${dataEnd})`],
    ['邦定成本', num(ex.bonding_cost), null],
    ['贴片成本', num(ex.smt_cost), null],
    ['人工成本', num(ex.labor_cost), null],
    ['测试费用', num(ex.test_repair), null],
    ['包装运输', num(ex.packing_shipping), null],
  ];
  const summaryStart = row;
  labels.forEach(([lab, val, fml]) => {
    ws.getCell(row, 7).value = lab + '：';
    ws.getCell(row, 7).alignment = { horizontal: 'right' };
    ws.getCell(row, 8).value = fml ? { formula: fml, result: val } : val;
    ws.getCell(row, 8).numFmt = '0.000';
    styleData(ws.getCell(row, 7));
    styleData(ws.getCell(row, 8));
    row += 1;
  });
  // 合计成本
  ws.getCell(row, 7).value = '合计成本：';
  ws.getCell(row, 7).alignment = { horizontal: 'right' };
  ws.getCell(row, 7).font = { bold: true, name: 'Microsoft YaHei' };
  ws.getCell(row, 8).value = { formula: `SUM(H${summaryStart}:H${row - 1})`, result: partsCost + num(ex.test_repair) + num(ex.packing_shipping) };
  ws.getCell(row, 8).numFmt = '0.000';
  styleSubtotal(ws.getCell(row, 8), 'sub');
  const totalCostRow = row;
  row += 1;
  // 含利润价
  const profitPct = num(ex.profit_pct);
  ws.getCell(row, 7).value = `含 ${profitPct}% 利润价：`;
  ws.getCell(row, 7).alignment = { horizontal: 'right' };
  ws.getCell(row, 7).font = { bold: true, name: 'Microsoft YaHei' };
  const profitVal = ex.profit_price != null ? num(ex.profit_price) : (partsCost + num(ex.test_repair) + num(ex.packing_shipping)) * (1 + profitPct / 100);
  ws.getCell(row, 8).value = { formula: `H${totalCostRow}*(1+${profitPct}/100)`, result: profitVal };
  ws.getCell(row, 8).numFmt = '0.000';
  ws.getCell(row, 9).value = 'RMB 不含税价';
  styleSubtotal(ws.getCell(row, 8), 'sub');
  row += 1;
  // 抵税差额
  ws.getCell(row, 7).value = '抵税差额：';
  ws.getCell(row, 7).alignment = { horizontal: 'right' };
  ws.getCell(row, 8).value = num(ex.tax_diff);
  ws.getCell(row, 8).numFmt = '0.000';
  styleData(ws.getCell(row, 8));
  row += 1;
  // 应交税负
  ws.getCell(row, 7).value = '应交税负：';
  ws.getCell(row, 7).alignment = { horizontal: 'right' };
  ws.getCell(row, 8).value = num(ex.tax_payable);
  ws.getCell(row, 8).numFmt = '0.000';
  styleData(ws.getCell(row, 8));
  row += 1;
  // 含税报价
  ws.getCell(row, 7).value = '含税报价：';
  ws.getCell(row, 7).alignment = { horizontal: 'right' };
  ws.getCell(row, 7).font = { bold: true, name: 'Microsoft YaHei' };
  const taxedVal = ex.taxed_price != null ? num(ex.taxed_price) : profitVal + num(ex.tax_diff) + num(ex.tax_payable);
  ws.getCell(row, 8).value = taxedVal;
  ws.getCell(row, 8).numFmt = '0.000';
  ws.getCell(row, 9).value = 'RMB 含税价';
  styleSubtotal(ws.getCell(row, 8), 'hkd');

  const sourceFees = ex.other_fees || [];
  if (sourceFees.length) {
    row += 2;
    ws.getCell(row, 1).value = '其它费用（总额，不计入单套电子成本）';
    ws.mergeCells(row, 1, row, 6);
    styleSection(ws.getCell(row, 1));
    row += 1;
    ['费用名称', '数量', '单价 RMB', '合计 RMB', '备注'].forEach((value, index) => {
      ws.getCell(row, index + 1).value = value;
      styleHeader(ws.getCell(row, index + 1));
    });
    row += 1;
    const feeStart = row;
    sourceFees.forEach(fee => {
      const amount = num(fee.amount) || num(fee.qty) * num(fee.unit_price);
      ws.getCell(row, 1).value = fee.name || '';
      ws.getCell(row, 2).value = num(fee.qty);
      ws.getCell(row, 3).value = num(fee.unit_price);
      ws.getCell(row, 4).value = amount;
      ws.getCell(row, 5).value = fee.note || '';
      for (let column = 1; column <= 5; column++) styleData(ws.getCell(row, column));
      [3, 4].forEach(column => { ws.getCell(row, column).numFmt = '0.00'; });
      row += 1;
    });
    ws.getCell(row, 1).value = '其它费用合计';
    ws.getCell(row, 4).value = { formula: `SUM(D${feeStart}:D${row - 1})`, result: sum(sourceFees, fee => num(fee.amount) || num(fee.qty) * num(fee.unit_price)) };
    styleSubtotal(ws.getCell(row, 1), 'sub');
    styleSubtotal(ws.getCell(row, 4), 'sub');
    ws.getCell(row, 4).numFmt = '0.00';
  }
}

// 车缝明细 — 独立 sheet
function addSewingDetailSheet(wb, sewing, fxRH) {
  const groups = (sewing && sewing.sewing_groups) || [];
  if (!groups.length) return;
  const ws = wb.addWorksheet('车缝明细');
  ws.columns = [
    { width: 6 },   // A 序号
    { width: 36 },  // B 布料名称
    { width: 12 },  // C 部位
    { width: 10 },  // D 工艺
    { width: 10 },  // E 裁片数
    { width: 14 },  // F 用量/码
    { width: 14 },  // G 物料价(RMB)
    { width: 14 },  // H 价钱(RMB)
    { width: 10 },  // I 码点
    { width: 14 },  // J 总价钱(RMB)
    { width: 18 },  // K 备注
  ];
  let row = 1;
  ws.mergeCells(row, 1, row, 11); styleSection(ws.getCell(row, 1));
  ws.getCell(row, 1).value = '车缝明细';
  row += 1;
  let weightedNumerator = 0;
  const totalQty = sewTotalQty(sewing);
  const weightedTerms = [];
  groups.forEach((g, gi) => {
    ws.mergeCells(row, 1, row, 11);
    ws.getCell(row, 1).value = `产品：${g.name || '未命名 ' + (gi + 1)}`;
    ws.getCell(row, 1).font = { bold: true, color: { argb: 'FF16A34A' }, name: 'Microsoft YaHei' };
    ws.getCell(row, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECFDF5' } };
    row += 1;
    const h = ['序号', '布料名称', '部位', '工艺', '裁片数', '用量/码', '物料价(RMB)', '价钱(RMB)', '码点', '总价钱(RMB)', '备注'];
    h.forEach((v, i) => { ws.getCell(row, i + 1).value = v; styleHeader(ws.getCell(row, i + 1)); });
    row += 1;
    const start = row;
    (g.items || []).forEach((r, i) => {
      ws.getCell(row, 1).value = i + 1;
      ws.getCell(row, 2).value = r.fabric || '';
      ws.getCell(row, 3).value = r.part || '';
      ws.getCell(row, 4).value = r.craft || '';
      ws.getCell(row, 5).value = num(r.pieces);
      ws.getCell(row, 6).value = num(r.usage);
      ws.getCell(row, 6).numFmt = '0.000';
      ws.getCell(row, 7).value = num(r.mat_price);
      ws.getCell(row, 7).numFmt = '0.00';
      ws.getCell(row, 8).value = { formula: `F${row}*G${row}`, result: num(r.usage) * num(r.mat_price) };
      ws.getCell(row, 8).numFmt = '0.0000';
      ws.getCell(row, 9).value = num(r.markup) || 1;
      ws.getCell(row, 9).numFmt = '0.00';
      ws.getCell(row, 10).value = { formula: `H${row}*I${row}`, result: num(r.usage) * num(r.mat_price) * (num(r.markup) || 1) };
      ws.getCell(row, 10).numFmt = '0.0000';
      ws.getCell(row, 11).value = r.note || '';
      for (let c = 1; c <= 11; c++) styleData(ws.getCell(row, c));
      row += 1;
    });
    const end = row - 1;
    const itemsSum = sum(g.items || [], r => num(r.usage) * num(r.mat_price) * (num(r.markup) || 1));
    const laborAmt = sewLaborToAdd(g);  // 人工已在明细行则为 0，避免双算
    const groupTotal = itemsSum + laborAmt;  // 与 UI 本组小计 一致 = 物料 + 额外人工
    // 本组合计
    ws.mergeCells(row, 1, row, 9);
    ws.getCell(row, 1).value = laborAmt > 0 ? ('本组合计 RMB（含人工 ' + laborAmt.toFixed(2) + '）') : '本组合计 RMB（人工已含明细）';
    ws.getCell(row, 1).alignment = { horizontal: 'right' };
    ws.getCell(row, 10).value = (g.items || []).length
      ? { formula: laborAmt > 0 ? `SUM(J${start}:J${end})+${laborAmt}` : `SUM(J${start}:J${end})`, result: groupTotal } : groupTotal;
    ws.getCell(row, 10).numFmt = RMB;
    for (let c = 1; c <= 11; c++) { const cell = ws.getCell(row, c); cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } }; cell.border = thinBorder(); }
    styleSubtotal(ws.getCell(row, 10), 'sub');
    ws.getCell(row, 1).font = { bold: true, name: 'Microsoft YaHei' };
    ws.getCell(row, 10).font = { bold: true, name: 'Microsoft YaHei' };
    const qty = sewGroupQty(g);
    weightedNumerator += groupTotal * qty;
    weightedTerms.push(`J${row}*${qty}`);
    row += 1;
    row += 1;  // 空行
  });
  // 配套合计 = Σ(组价×用量) ÷ 总用量（活公式）
  ws.mergeCells(row, 1, row, 9);
  ws.getCell(row, 1).value = `配套合计 RMB（÷总用量 ${totalQty}）`;
  ws.getCell(row, 1).alignment = { horizontal: 'right' };
  ws.getCell(row, 1).font = { bold: true, name: 'Microsoft YaHei' };
  ws.getCell(row, 10).value = weightedTerms.length
    ? { formula: `(${weightedTerms.join('+')})/${totalQty}`, result: weightedNumerator / totalQty }
    : 0;
  ws.getCell(row, 10).numFmt = RMB;
  styleSubtotal(ws.getCell(row, 10), 'hkd');
  ws.getCell(row, 10).font = { bold: true, name: 'Microsoft YaHei' };
}

// 装配明细 — 独立 sheet（排拉工序，两段：组装/包装）。明细只列导入的工序(序号/工序名称/人数/备注)，
// 标准工时/基数 放产品标题(每组一次)，人工/PCS 只在合计行。返回两段合计单元格 + 值供主表跨表引用。
function addAssemblyDetailSheet(wb, asm, baseRate, stdTime) {
  const asmGroups = (asm && asm.assembly_step_groups) || [];
  const pkgGroups = (asm && asm.packaging_step_groups) || [];
  if (!asmGroups.length && !pkgGroups.length) {
    return { asmPeopleCells: [], pkgPeopleCells: [], asmTotalVal: 0, pkgTotalVal: 0 };
  }
  const ws = wb.addWorksheet('装配明细');
  ws.columns = [
    { width: 6 },   // A 序号
    { width: 36 },  // B 工序名称
    { width: 10 },  // C 人数
    { width: 24 },  // D 备注
  ];
  let row = 1;
  ws.mergeCells(row, 1, row, 4); styleSection(ws.getCell(row, 1));
  ws.getCell(row, 1).value = '装配明细（排拉工序）';
  row += 2;

  const renderSection = (title, groups) => {
    ws.mergeCells(row, 1, row, 4); styleSection(ws.getCell(row, 1));
    ws.getCell(row, 1).value = title;
    row += 1;
    if (!groups.length) {
      ws.mergeCells(row, 1, row, 4);
      ws.getCell(row, 1).value = '（无）';
      ws.getCell(row, 1).font = { italic: true, color: { argb: 'FF9CA3AF' } };
      row += 2;
      return { peopleCells: [], laborVal: 0 };
    }
    const peopleCells = [];   // 每组「本组合计 人数」单元格(C列)，供主表总人数引用
    let laborVal = 0;
    groups.forEach(g => {
      // 产品标题（基数/标准工时 常量在此，每组一次）
      ws.mergeCells(row, 1, row, 4);
      const team = num(g.team ?? 1) || 1;
      ws.getCell(row, 1).value = `产品：${g.product || '未命名'}    生产量：${num(g.qty)}    小组：${team}    基数：${baseRate} HKD    标准工时：${stdTime} H`;
      ws.getCell(row, 1).font = { bold: true, color: { argb: 'FF16A34A' }, name: 'Microsoft YaHei' };
      ws.getCell(row, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECFDF5' } };
      row += 1;
      // 表头（只导入数据）
      ['序号', '工序名称', '人数', '备注'].forEach((v, i) => { ws.getCell(row, i + 1).value = v; styleHeader(ws.getCell(row, i + 1)); });
      row += 1;
      const stepStart = row;
      (g.steps || []).forEach((s, i) => {
        ws.getCell(row, 1).value = i + 1;
        ws.getCell(row, 2).value = s.name || '';
        ws.getCell(row, 3).value = num(s.count);
        ws.getCell(row, 4).value = s.note || '';
        for (let c = 1; c <= 4; c++) styleData(ws.getCell(row, c));
        row += 1;
      });
      const stepEnd = row - 1;
      const peopleVal = sum(g.steps || [], s => num(s.count));
      laborVal += baseRate * peopleVal * team / Math.max(num(g.qty), 1);
      // 本组合计 人数 = SUM(C)
      ws.mergeCells(row, 1, row, 2);
      ws.getCell(row, 1).value = '本组合计 人数';
      ws.getCell(row, 1).alignment = { horizontal: 'right' };
      ws.getCell(row, 1).font = { bold: true, name: 'Microsoft YaHei' };
      ws.getCell(row, 3).value = (g.steps || []).length ? { formula: `SUM(C${stepStart}:C${stepEnd})`, result: peopleVal } : 0;
      for (let c = 1; c <= 4; c++) { const cell = ws.getCell(row, c); cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } }; cell.border = thinBorder(); }
      styleSubtotal(ws.getCell(row, 3), 'sub');
      peopleCells.push(`C${row}`);
      row += 2; // 合计 + 空行
    });
    // 段合计 总人数
    ws.mergeCells(row, 1, row, 2);
    ws.getCell(row, 1).value = '所有产品 合计 人数';
    ws.getCell(row, 1).alignment = { horizontal: 'right' };
    ws.getCell(row, 1).font = { bold: true, name: 'Microsoft YaHei' };
    ws.getCell(row, 3).value = peopleCells.length ? { formula: peopleCells.join('+'), result: sum(groups, g => sum(g.steps || [], s => num(s.count))) } : 0;
    styleSubtotal(ws.getCell(row, 3), 'total');
    row += 2;
    return { peopleCells, laborVal };
  };

  const a = renderSection('组装人工 — 排拉工序', asmGroups);
  const p = renderSection('包装/混装人工 — 排拉工序', pkgGroups);
  return { asmPeopleCells: a.peopleCells, pkgPeopleCells: p.peopleCells, asmTotalVal: a.laborVal, pkgTotalVal: p.laborVal };
}

// 主表：排拉工序只留一行汇总，跨表引用「装配明细」段合计
// 主表：按总表样式列出各产品（产品/标准工时/基数/生产量/小组/总人数/合计），合计套活公式
// 每产品 合计 = 基数 × 总人数 × 小组 ÷ 生产量（= Σ 基数×人数×小组/生产量）；段合计 = SUM
function renderAssemblyMainSummary(ws, row, title, groups, baseRate, stdTime, peopleCells, refs, refKey) {
  ws.mergeCells(row, 1, row, 7); styleSection(ws.getCell(row, 1));
  ws.getCell(row, 1).value = title + '（明细见"装配明细" sheet）';
  row += 1;
  const h = ['产品', '标准工时', '基数 HKD', '生产量', '小组', '总人数', '合计 人工/PCS HKD'];
  h.forEach((v, i) => { ws.getCell(row, i + 1).value = v; styleHeader(ws.getCell(row, i + 1)); });
  row += 1;
  const dataStart = row;
  let sectionVal = 0;
  (groups || []).forEach((g, gi) => {
    const team = num(g.team ?? 1) || 1;
    const people = sum(g.steps || [], s => num(s.count));
    const total = baseRate * people * team / Math.max(num(g.qty), 1);
    sectionVal += total;
    ws.getCell(row, 1).value = g.product || '未命名';
    ws.getCell(row, 2).value = stdTime;
    ws.getCell(row, 3).value = baseRate; ws.getCell(row, 3).numFmt = '0.##';  // 基数只显示数字(如 310)，不带 HK$
    ws.getCell(row, 4).value = num(g.qty);
    ws.getCell(row, 5).value = team;
    // 总人数：套公式引用「装配明细」本组合计人数
    const pc = peopleCells && peopleCells[gi];
    ws.getCell(row, 6).value = pc ? { formula: `'装配明细'!${pc}`, result: people } : people;
    // 合计 = 基数(C) × 总人数(F) × 小组(E) ÷ 生产量(D) — 活公式
    ws.getCell(row, 7).value = { formula: `C${row}*F${row}*E${row}/MAX(D${row},1)`, result: total };
    ws.getCell(row, 7).numFmt = HKD4;
    for (let c = 1; c <= 7; c++) styleData(ws.getCell(row, c));
    row += 1;
  });
  const dataEnd = row - 1;
  // 所有产品 合计 = SUM(合计列)
  ws.mergeCells(row, 1, row, 6);
  ws.getCell(row, 1).value = '所有产品 合计 人工/PCS HKD';
  ws.getCell(row, 1).alignment = { horizontal: 'right' };
  ws.getCell(row, 1).font = { bold: true, name: 'Microsoft YaHei' };
  ws.getCell(row, 7).value = (groups || []).length ? { formula: `SUM(G${dataStart}:G${dataEnd})`, result: sectionVal } : 0;
  ws.getCell(row, 7).numFmt = HKD4;
  for (let c = 1; c <= 7; c++) styleData(ws.getCell(row, c));
  styleSubtotal(ws.getCell(row, 7), 'total');
  if (refs) refs[refKey] = `G${row}`;
  row += 1;
  return row;
}

function renderShippingBlock(ws, row, shipping, header, fxRH, refs = {}) {
  if (!shipping || !shipping.scenarios || !shipping.scenarios.length) return row;
  // 兜底：确保第一列是 出厂价（前端没打开过 汇总 tab 时缺失）
  if (!shipping.scenarios[0].is_factory) {
    shipping.scenarios = [{ name: '出厂价', base_rmb: 0, is_factory: true }, ...shipping.scenarios];
  }
  const fxHU = num(header.fx_hkd_usd) || 7.8;
  const sc = shipping.scenarios;
  const cols = sc.length;
  const markupX = shipping.markup_x == null || shipping.markup_x === '' ? 1 : num(shipping.markup_x);
  const sewMarkupX = shipping.sew_markup_x == null || shipping.sew_markup_x === '' ? markupX : num(shipping.sew_markup_x);
  const elecMarkupX = shipping.elec_markup_x == null || shipping.elec_markup_x === '' ? markupX : num(shipping.elec_markup_x);

  // 章节标题
  ws.mergeCells(row, 1, row, Math.max(13, cols + 1)); styleSection(ws.getCell(row, 1));
  ws.getCell(row, 1).value = '十一、出货价算价（多场景）';
  row += 1;

  const headerCells = ['项', ...sc.map(x => x.name || '场景')];
  headerCells.forEach((v, i) => { ws.getCell(row, i + 1).value = v; styleHeader(ws.getCell(row, i + 1)); });
  row += 1;

  const colLetter = (n) => { let s=''; while(n>0){const m=(n-1)%26; s=String.fromCharCode(65+m)+s; n=Math.floor((n-1)/26);} return s; };

  // 标签列 = A，场景列从 B 开始（fxRH 由参数传入）

  // 运费场景 freightMap key → 运费场景表行名（供引用 每PCS运费率 E 列）
  const KEY_TO_NAME = { hk40: 'HK 40柜', yt40: 'YT 40柜', hk20: 'HK 20柜', yt20: 'YT 20柜', hk10t: 'HK 10吨车', yt10t: 'YT 10吨车', hk5t: 'HK 5吨车', yt5t: 'YT 5吨车' };
  const fcells = refs.freightCells || {};
  const rateCellOf = (x) => fcells[KEY_TO_NAME[x._freight_matched]] || null;
  // 每行的预计算值（用作公式 fallback result）
  const rows = sc.map(x => {
    // 出货底价：出厂价列 = 码点后价 N(实时)；其他场景 = 出货底价 Q(实时)
    const base = x.is_factory ? (refs.markedHkd != null ? refs.markedHkd : num(x.base_rmb))
                              : (refs.combinedHkd != null ? refs.combinedHkd : num(x.base_rmb));
    // 运费/吊柜费 = 该场景 每PCS运费率(_freight_rate) × 运费%/吊柜%（与前端一致，非出货底价×%）
    const rate = num(x._freight_rate);
    const freight = x.is_factory ? 0 : rate * num(shipping.freight_pct) / 100;
    const lifting = x.is_factory ? 0 : rate * num(shipping.lifting_pct) / 100;
    const afterShip = base + freight + lifting;
    const afterMarkup = afterShip * markupX;
    const afterDivisor = afterMarkup / Math.max(num(shipping.divisor), 1e-9);
    const divisor = Math.max(num(shipping.divisor), 1e-9);
    const sewBase = num(refs.sewingHkd);
    const elecBase = num(refs.elecHkd);
    const sewMarkup = sewBase * sewMarkupX;
    const sewDivisor = sewMarkup / divisor;
    const elecMarkup = elecBase * elecMarkupX;
    const elecDivisor = elecMarkup / divisor;
    const totalHKD = afterDivisor + sewDivisor + elecDivisor;
    const totalUSD = totalHKD / fxHU;
    const moldShareUSD = num(refs.moldShareUsd);
    const prototypeShareUSD = num(refs.prototypeShareUsd);
    const testingShareUSD = num(refs.testingShareUsd);
    const finalUSD = totalUSD + moldShareUSD + prototypeShareUSD + testingShareUSD;
    return { base, freight, lifting, afterShip, afterMarkup, afterDivisor, totalHKD, totalUSD, moldShareUSD, prototypeShareUSD, testingShareUSD, finalUSD,
      sewBase, sewMarkup, sewDivisor, elecBase, elecMarkup, elecDivisor };
  });

  // 记录每行所在的 Excel 行号，构造公式
  const writeRow = (label, valueFn, opts = {}) => {
    ws.getCell(row, 1).value = label;
    styleData(ws.getCell(row, 1));
    ws.getCell(row, 1).alignment = { horizontal: 'right' };
    const paint = cell => {
      if (opts.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.fill } };
      if (opts.bold || opts.fontColor) cell.font = { ...(cell.font || {}), bold: !!opts.bold,
        ...(opts.fontColor ? { color: { argb: opts.fontColor } } : {}) };
    };
    paint(ws.getCell(row, 1));
    sc.forEach((_, i) => {
      const c = ws.getCell(row, i + 2);
      c.value = valueFn(i);
      if (opts.fmt) c.numFmt = opts.fmt;
      styleData(c);
      paint(c);
    });
    row += 1;
  };

  // 1. 出货底价：所有场景统一引用合计 N 列。
  const rBase = row;
  const sumR = refs.summaryRow;
  writeRow('出货底价 HK$', i => {
    if (sumR) {
      return { formula: `N${sumR}`, result: rows[i].base };
    }
    return rows[i].base;
  }, { fmt: '0.00' });
  // 2. 运费：出厂价列 = 0；其他场景 = 该场景每PCS运费率 × 运费%（引用上方"运费场景"表对应行 E 列）
  const rFre = row;
  const freightRefFn = (pct) => (i) => {
    if (sc[i].is_factory) return 0;
    const rc = rateCellOf(sc[i]);
    const ref = rc ? `${rc}*${pct}/100` : `${num(sc[i]._freight_rate)}*${pct}/100`;
    return { formula: ref, result: sc[i].is_factory ? 0 : num(sc[i]._freight_rate) * pct / 100 };
  };
  writeRow(`运费 ${shipping.freight_pct || 0}%`, freightRefFn(num(shipping.freight_pct)), { fmt: '0.00' });
  // 3. 吊柜费：出厂价列 = 0
  const rLift = row;
  writeRow(`吊柜费 ${shipping.lifting_pct || 0}%`, freightRefFn(num(shipping.lifting_pct)), { fmt: '0.00' });
  // 记录"盐田40柜"(或首个非出厂价)场景的 运费/吊柜费 单元格，供减税明细 表2 直接引用
  const freightColIdx = (() => { const i = sc.findIndex(x => !x.is_factory && /盐田.*40/i.test(x.name || '')); return i >= 0 ? i : sc.findIndex(x => !x.is_factory); })();
  if (freightColIdx >= 0) {
    refs.shipFreightCell = `${colLetter(freightColIdx + 2)}${rFre}`;
    refs.shipCabinetCell = `${colLetter(freightColIdx + 2)}${rLift}`;
  }
  // 4. 含运 = 底价 + 运费 + 吊柜
  const rAS = row;
  writeRow('含运 HK$',
    i => ({ formula: `${colLetter(i+2)}${rBase}+${colLetter(i+2)}${rFre}+${colLetter(i+2)}${rLift}`, result: rows[i].afterShip }),
    { fmt: '0.00', bold: true });
  // 5. 码点 ×
  const rMk = row;
  writeRow(`码点 × ${markupX}`,
    i => ({ formula: `${colLetter(i+2)}${rAS}*${markupX}`, result: rows[i].afterMarkup }),
    { fmt: '0.00' });
  // 6. 找数 ÷
  const rDiv = row;
  writeRow(`找数 ÷ ${shipping.divisor || 1}`,
    i => ({ formula: `${colLetter(i+2)}${rMk}/${num(shipping.divisor)}`, result: rows[i].afterDivisor }),
    { fmt: '0.00' });
  // 主体、车缝、电子分别算 TOTAL，最后再相加。
  const rMainTotal = row;
  writeRow('TOTAL (HK$)',
    i => ({ formula: `${colLetter(i+2)}${rDiv}`, result: rows[i].afterDivisor }),
    { fmt: '0.00', bold: true, fill: SUBTOTAL_FILL, fontColor: SUBTOTAL_FONT });
  const rSew = row;
  writeRow('车缝', i => sumR ? { formula: `K${sumR}`, result: rows[i].sewBase } : rows[i].sewBase, { fmt: '0.00' });
  const rSewMarkup = row;
  writeRow(`码点 × ${sewMarkupX}`, i => ({ formula: `${colLetter(i+2)}${rSew}*${sewMarkupX}`, result: rows[i].sewMarkup }), { fmt: '0.00' });
  const rSewDiv = row;
  writeRow(`找数 ÷ ${shipping.divisor || 1}`, i => ({ formula: `${colLetter(i+2)}${rSewMarkup}/${num(shipping.divisor)}`, result: rows[i].sewDivisor }), { fmt: '0.00' });
  const rSewTotal = row;
  writeRow('TOTAL (HK$)', i => ({ formula: `${colLetter(i+2)}${rSewDiv}`, result: rows[i].sewDivisor }),
    { fmt: '0.00', bold: true, fill: SUBTOTAL_FILL, fontColor: SUBTOTAL_FONT });
  const rElec = row;
  writeRow('电子', i => sumR ? { formula: `C${sumR}`, result: rows[i].elecBase } : rows[i].elecBase, { fmt: '0.00' });
  const rElecMarkup = row;
  writeRow(`码点 × ${elecMarkupX}`, i => ({ formula: `${colLetter(i+2)}${rElec}*${elecMarkupX}`, result: rows[i].elecMarkup }), { fmt: '0.00' });
  const rElecDiv = row;
  writeRow(`找数 ÷ ${shipping.divisor || 1}`, i => ({ formula: `${colLetter(i+2)}${rElecMarkup}/${num(shipping.divisor)}`, result: rows[i].elecDivisor }), { fmt: '0.00' });
  const rElecTotal = row;
  writeRow('TOTAL (HK$)', i => ({ formula: `${colLetter(i+2)}${rElecDiv}`, result: rows[i].elecDivisor }),
    { fmt: '0.00', bold: true, fill: SUBTOTAL_FILL, fontColor: SUBTOTAL_FONT });
  const rHKD = row;
  writeRow('TOTAL (HK$)', i => ({ formula: `${colLetter(i+2)}${rMainTotal}+${colLetter(i+2)}${rSewTotal}+${colLetter(i+2)}${rElecTotal}`, result: rows[i].totalHKD }),
    { fmt: '0.00', bold: true, fill: 'FFDBEAFE', fontColor: 'FF1E40AF' });
  // 8. USD
  const rUSD = row;
  writeRow(`(USD) = HK$/${fxHU}`,
    i => ({ formula: `${colLetter(i+2)}${rHKD}/${fxHU}`, result: rows[i].totalUSD }),
    { fmt: '0.0000' });
  // 9-11. 三项分摊分别显示并引用「生产模具费用」表。
  const rMold = row;
  writeRow('模具分摊 (USD)',
    i => refs.moldShareUsdCell ? { formula: refs.moldShareUsdCell, result: rows[i].moldShareUSD } : rows[i].moldShareUSD,
    { fmt: '0.0000' });
  const rPrototype = row;
  writeRow('手板费分摊 (USD)',
    i => refs.prototypeShareUsdCell ? { formula: refs.prototypeShareUsdCell, result: rows[i].prototypeShareUSD } : rows[i].prototypeShareUSD,
    { fmt: '0.0000' });
  const rTesting = row;
  writeRow('测试费分摊 (USD)',
    i => refs.testingShareUsdCell ? { formula: refs.testingShareUsdCell, result: rows[i].testingShareUSD } : rows[i].testingShareUSD,
    { fmt: '0.0000' });
  // TOTAL USD = USD + 模具 + 手板 + 测试分摊
  const rFinal = row;
  writeRow('TOTAL (USD)',
    i => ({ formula: `${colLetter(i+2)}${rUSD}+${colLetter(i+2)}${rMold}+${colLetter(i+2)}${rPrototype}+${colLetter(i+2)}${rTesting}`, result: rows[i].finalUSD }),
    { fmt: '0.0000', bold: true });

  // 报客货价 = 第一个非"出厂价"场景的 finalUSD（默认 盐田40柜）
  const customerIdx = sc.findIndex(x => !x.is_factory);
  const customerUSD = (customerIdx >= 0 && rows[customerIdx]) ? rows[customerIdx].finalUSD
    : (rows.length ? Math.min(...rows.map(r => r.finalUSD)) : 0);
  const target = num(shipping.target_usd);
  const diffPct = target > 0 ? (customerUSD - target) / target : 0;
  // 引用单元格地址：B 是 第1列(出厂价)，customerIdx >= 0 时 = B + customerIdx
  const custCol = (customerIdx >= 0) ? colLetter(customerIdx + 2) : 'B';
  // 减税明细“货价”取默认报客场景 TOTAL HKD × 找数，还原到找数前。
  refs.customerTotalHkdCell = `${custCol}${rHKD}`;
  if (refs.sharedRefs) refs.sharedRefs.customerTotalHkdCell = refs.customerTotalHkdCell;

  ws.mergeCells(row, 1, row, cols + 1);
  ws.getCell(row, 1).value = {
    formula: `"报客货价: "&TEXT(${custCol}${rFinal},"0.0000")&" | 目标: ${target.toFixed(4)} | 相差: "&TEXT((${custCol}${rFinal}-${target})/${target || 1}*100,"0.00")&"%"`,
    result: `报客货价: ${customerUSD.toFixed(4)} | 目标: ${target.toFixed(4)} | 相差: ${(diffPct * 100).toFixed(2)}%`,
  };
  ws.getCell(row, 1).alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getCell(row, 1).font = { bold: true, color: { argb: 'FF1F2937' } };
  ws.getCell(row, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7E5E4' } };
  styleData(ws.getCell(row, 1));
  row += 2;
  return row;
}

// ----- 子渲染函数 -----
function renderInjection(ws, row, payload, fxRH, refs) {
  const lossPct = num(payload.injection_loss_pct ?? 3);  // 注塑料损耗（默认3%）
  const h = ['序号', '模具名称', '材质', '料型', '颜色', '啤净重(g)', `料损耗 ${lossPct}%`, '料价 HK$/g', '原料单价 HK$', '机台', '啤价 HK$/啤', '套数', '机型', '目标数', '周期(秒)', '成品金额 HK$'];
  ws.mergeCells(row, 1, row, h.length); styleSection(ws.getCell(row, 1));
  ws.getCell(row, 1).value = '二、注塑部分';
  row += 1;
  h.forEach((v, i) => { ws.getCell(row, i + 1).value = v; styleHeader(ws.getCell(row, i + 1)); });
  row += 1;
  const dataStart = row;
  const lossM = 1 + lossPct / 100;
  const impMatCells = [], domMatCells = [];  // 原料单价(I列)单元格，按材质分进口料/国内料（与前端 autoFill 同逻辑）
  (payload.injection || []).forEach((r, i) => {
    const wg = num(r.weight_g);
    const up = num(r.material_unit_price);
    const sp = num(r.shot_price);
    const rawUnit = wg * lossM * up;
    const finished = rawUnit + sp;

    ws.getCell(row, 1).value = i + 1;
    ws.getCell(row, 2).value = r.name || '';
    ws.getCell(row, 3).value = r.material || '';
    ws.getCell(row, 4).value = r.material_grade || '';
    ws.getCell(row, 5).value = r.color || '';
    ws.getCell(row, 6).value = wg;
    // 料损耗 = 啤净重 × (1+损耗%)
    ws.getCell(row, 7).value = { formula: `F${row}*${lossM}`, result: wg * lossM };
    ws.getCell(row, 7).numFmt = '0.00';
    // 料价 HK$/g = Lb单价 ÷ 454（Lb单价用反推常量 = 料价HK$/g × 454）
    ws.getCell(row, 8).value = up ? { formula: `${+(up * 454).toFixed(4)}/454`, result: up } : up;
    ws.getCell(row, 8).numFmt = '0.00000';
    // 原料单价 = 料损耗 × 料价
    ws.getCell(row, 9).value = { formula: `G${row}*H${row}`, result: rawUnit };
    ws.getCell(row, 9).numFmt = '0.0000';
    ws.getCell(row, 10).value = r.machine || '';
    // 啤价 = 机型价 ÷ 套数(L) ÷ 目标数(N)；机型价用反推常量(=啤价×套数×目标数)，套数/目标数引用本行可改重算
    const machinePrice = sp * num(r.sets) * num(r.target);
    ws.getCell(row, 11).value = (sp && num(r.sets) > 0 && num(r.target) > 0)
      ? { formula: `${+machinePrice.toFixed(2)}/L${row}/N${row}`, result: sp }
      : sp;
    ws.getCell(row, 12).value = r.sets ?? 1;
    ws.getCell(row, 13).value = r.machine_model || '';
    ws.getCell(row, 14).value = num(r.target);
    ws.getCell(row, 15).value = r.cycle_sec == null || r.cycle_sec === '' ? '' : num(r.cycle_sec);
    // 成品金额 = 原料单价 + 啤价
    ws.getCell(row, 16).value = { formula: `I${row}+K${row}`, result: finished };
    ws.getCell(row, 16).numFmt = '0.0000';
    for (let c = 1; c <= h.length; c++) styleData(ws.getCell(row, c));
    // 按材质分进口料/国内料（与前端 workbench.js 同逻辑）：POM/PVC/C-PVC = 国内料；其余非空 = 进口料
    const _mat = String(r.material || '').toUpperCase().trim();
    if (/^(POM|PVC|C[- ]?PVC)/.test(_mat)) domMatCells.push(`I${row}`);
    else if (_mat) impMatCells.push(`I${row}`);
    row += 1;
  });
  const dataEnd = row - 1;
  const cnt = (payload.injection || []).length;
  if (cnt) {
    const rawSumVal = sum(payload.injection, r => num(r.weight_g) * lossM * num(r.material_unit_price));
    const shotSumVal = sum(payload.injection, r => num(r.shot_price));
    const finSumVal = rawSumVal + shotSumVal;
    // 合计行：分别 sum 原料单价(I) / 啤价(K) / 成品金额(O)
    const totalRow = row;
    ws.getCell(row, 1).value = '合计';
    ws.getCell(row, 1).alignment = { horizontal: 'right', vertical: 'middle' };
    ws.mergeCells(row, 1, row, 8);
    ws.getCell(row, 9).value = { formula: `SUM(I${dataStart}:I${dataEnd})`, result: rawSumVal };
    ws.getCell(row, 9).numFmt = '0.0000';
    ws.getCell(row, 11).value = { formula: `SUM(K${dataStart}:K${dataEnd})`, result: shotSumVal };
    ws.getCell(row, 11).numFmt = '0.0000';
    ws.getCell(row, 16).value = { formula: `SUM(P${dataStart}:P${dataEnd})`, result: finSumVal };
    ws.getCell(row, 16).numFmt = '0.0000';
    for (let c = 1; c <= 16; c++) styleSubtotal(ws.getCell(row, c), 'hkd');
    // 加粗 合计 标签 + 3 个数值
    [1, 9, 11, 16].forEach(c => {
      ws.getCell(row, c).font = { bold: true, color: { argb: 'FF1F2937' }, name: 'Microsoft YaHei' };
    });
    ws.getRow(row).height = 22;
    row += 1;
    if (refs) { refs.injection = `P${totalRow}`; refs.injShotSum = `K${totalRow}`; }  // K = Σ啤价 → 表3 啤工
  }
  if (refs) { refs.impMatCells = impMatCells; refs.domMatCells = domMatCells; }
  return row;
}
function materialCost(r) {
  if (r.material_cost_manual != null && r.material_cost_manual !== '') return num(r.material_cost_manual);
  return num(r.weight_g) / 1000 * num(r.material_unit_price);
}
function injectionSubtotal(p) {
  // 与注塑表"成品金额"一致 = 原料单价(啤净重×(1+料损耗%)×料价) + 啤价；用于出厂价成本
  const lossM = 1 + num(p.injection_loss_pct ?? 3) / 100;
  return sum(p.injection || [], r => num(r.weight_g) * lossM * num(r.material_unit_price) + num(r.shot_price));
}

function renderSecondProc(ws, row, payload, fxRH, refs) {
  // 二次加工 = 喷油部 painting_items（夹模/移印/散枪/边模/油色/浸油/抹油/擦PP水/UV 九工序）
  const items = payload.painting_items || payload.second_proc || [];
  const colLetter = (n) => { let s=''; while(n>0){const m=(n-1)%26; s=String.fromCharCode(65+m)+s; n=Math.floor((n-1)/26);} return s; };
  // 工序列布局：A 序号 | B 名称 | C 位置 | 各工序(数量+单价 两列) | 报价
  const procs = ['夹模', '移印', '散枪', '边模', '油色', '浸油', '抹油', '擦PP水', 'UV'];
  const procKeys = ['clamp', 'pad', 'spray', 'edge', 'color', 'dip', 'oil', 'pp_water', 'uv'];
  const priceCol = 4 + procs.length * 2;      // 报价列号（九工序 = 22）
  const PRICE = colLetter(priceCol);
  ws.getColumn(priceCol).width = 16;
  ws.mergeCells(row, 1, row, priceCol); styleSection(ws.getCell(row, 1));
  ws.getCell(row, 1).value = '三、二次加工（印喷报价）';
  row += 1;

  // 表头双层：合并工序大标题 + 数量/单价子标题
  // 第 1 行
  ws.getCell(row, 1).value = '序号'; styleHeader(ws.getCell(row, 1));
  ws.mergeCells(row, 1, row + 1, 1);
  ws.getCell(row, 2).value = '名称'; styleHeader(ws.getCell(row, 2));
  ws.mergeCells(row, 2, row + 1, 2);
  ws.getCell(row, 3).value = '位置'; styleHeader(ws.getCell(row, 3));
  ws.mergeCells(row, 3, row + 1, 3);
  procs.forEach((p, pi) => {
    const c = 4 + pi * 2;
    ws.mergeCells(row, c, row, c + 1);
    ws.getCell(row, c).value = p;
    styleHeader(ws.getCell(row, c));
    styleHeader(ws.getCell(row, c + 1));
  });
  ws.getCell(row, priceCol).value = '报价'; styleHeader(ws.getCell(row, priceCol));
  ws.mergeCells(row, priceCol, row + 1, priceCol);
  row += 1;
  // 第 2 行：数量/单价
  procs.forEach((_, pi) => {
    const c = 4 + pi * 2;
    ws.getCell(row, c).value = '数量'; styleHeader(ws.getCell(row, c));
    ws.getCell(row, c + 1).value = '单价'; styleHeader(ws.getCell(row, c + 1));
  });
  row += 1;

  const dataStart = row;
  items.forEach((r, i) => {
    ws.getCell(row, 1).value = i + 1;
    ws.getCell(row, 2).value = r.name || '';
    ws.getCell(row, 3).value = r.position || '';
    procKeys.forEach((k, pi) => {
      const c = 4 + pi * 2;
      const qty = num(r[k + '_qty']);
      const unit = num(r[k + '_unit']);
      ws.getCell(row, c).value = qty || null;
      ws.getCell(row, c + 1).value = unit || null;
      ws.getCell(row, c + 1).numFmt = '0.0000';
    });
    // 报价 = Σ(数量*单价)
    const parts = procKeys.map((_, pi) => {
      const c = 4 + pi * 2;
      return `${colLetter(c)}${row}*${colLetter(c+1)}${row}`;
    });
    const computed = procKeys.reduce((s, k) => s + num(r[k+'_qty']) * num(r[k+'_unit']), 0);
    ws.getCell(row, priceCol).value = computed ? { formula: parts.join('+'), result: computed } : null;
    ws.getCell(row, priceCol).numFmt = '0.0000';
    for (let c = 1; c <= priceCol; c++) styleData(ws.getCell(row, c));
    row += 1;
  });
  const dataEnd = row - 1;

  const ppRaw = sum(items, r => procKeys.reduce((s, k) => s + num(r[k+'_qty']) * num(r[k+'_unit']), 0));
  row = appendThreeRowSubtotal(ws, row, {
    rawSum: ppRaw,
    lossPct: 0, skipLoss: true,  // 不计损耗
    fxRH, valueCol: priceCol,
    sumFormula: items.length ? `SUM(${PRICE}${dataStart}:${PRICE}${dataEnd})` : null,
    currency: 'HKD',  // 喷油报价为港币
    refs, refKey: 'secondProc',
  });
  return row;
}
function secondProcSubtotal(p) {
  const procKeys = ['clamp', 'pad', 'spray', 'edge', 'color', 'dip', 'oil', 'pp_water', 'uv'];
  const items = p.painting_items || p.second_proc || [];
  const s = sum(items, r => {
    if (r.price !== undefined) return num(r.price) * num(r.qty); // 旧结构兼容
    return procKeys.reduce((acc, k) => acc + num(r[k+'_qty']) * num(r[k+'_unit']), 0);
  });
  return s;  // 不计损耗
}

function renderFreeTable(ws, row, title, rows, lossPct, fxRH, refs, refKey, opts) {
  const isHkd = !!(opts && opts.isHkd);
  const skipLoss = !!(opts && opts.skipLoss);
  const rmbPrice = !!(opts && opts.rmbPrice);
  const fx = num(fxRH) || 0.85;
  ws.mergeCells(row, 1, row, 13); styleSection(ws.getCell(row, 1));
  ws.getCell(row, 1).value = title;
  row += 1;
  const priceLabel = isHkd ? '单价 HKD' : '单价';
  const amtLabel   = isHkd ? '金额 HKD' : '成品金额';
  const h = rmbPrice
    ? ['序号', '零件名称', '规格要求', '', '', '', '用量', '单价 RMB', '单价 HKD', amtLabel, '税点 %', '备注']
    : ['序号', '零件名称', '规格要求', '', '', '', '', '用量', priceLabel, amtLabel, '税点 %', '备注'];
  h.forEach((v, i) => { ws.getCell(row, i + 1).value = v; styleHeader(ws.getCell(row, i + 1)); });
  ws.mergeCells(row, 3, row, rmbPrice ? 6 : 7);
  row += 1;
  const dataStart = row;
  const fmt = isHkd ? HKD4 : RMB;
  const partRows = [];  // 记录每行 {name, spec, cell:金额(J列)} 供减税明细公式按关键字分类
  rows.forEach((r, i) => {
    if (!r.is_subtotal) partRows.push({ name: r.name || '', spec: r.spec || '', category: r.category || '', cell: `J${row}` });
    ws.getCell(row, 1).value = i + 1;
    ws.getCell(row, 2).value = r.name || '';
    ws.mergeCells(row, 3, row, rmbPrice ? 6 : 7);
    ws.getCell(row, 3).value = r.spec || '';
    if (rmbPrice) {
      ws.getCell(row, 7).value = num(r.qty);
      ws.getCell(row, 8).value = freeUnitRmb(r, fx);
      ws.getCell(row, 8).numFmt = RMB;
      ws.getCell(row, 9).value = { formula: `H${row}/${fx}`, result: freeUnitHkd(r, fx) };
      ws.getCell(row, 9).numFmt = HKD4;
      if (r.is_subtotal) {
        ws.getCell(row, 10).value = num(r.amount);
      } else {
        ws.getCell(row, 10).value = { formula: `G${row}*I${row}`, result: freeAmountHkd(r, fx) };
      }
    } else {
      ws.getCell(row, 8).value = num(r.qty);
      ws.getCell(row, 9).value = num(r.unit_price);
      ws.getCell(row, 9).numFmt = fmt;
      if (r.is_subtotal) {
        ws.getCell(row, 10).value = num(r.amount);
      } else {
        ws.getCell(row, 10).value = { formula: `H${row}*I${row}`, result: num(r.qty) * num(r.unit_price) };
      }
    }
    ws.getCell(row, 10).numFmt = fmt;
    ws.getCell(row, 11).value = r.tax_pct == null || r.tax_pct === '' ? '' : num(r.tax_pct);
    ws.getCell(row, 12).value = r.note || '';
    for (let c = 1; c <= 12; c++) styleData(ws.getCell(row, c));
    if (r.is_subtotal) ws.getRow(row).font = { bold: true };
    row += 1;
  });
  const dataEnd = row - 1;
  // 小计 / 损耗 / 合计
  row = appendThreeRowSubtotal(ws, row, {
    rawSum: freeRaw(rows, fxRH),
    lossPct: num(lossPct),
    fxRH,
    valueCol: 10,
    sumFormula: dataEnd >= dataStart ? `SUM(J${dataStart}:J${dataEnd})` : null,
    currency: isHkd ? 'HKD' : 'RMB',
    skipLoss,
    refs, refKey,
  });
  if (refs && refKey) { refs.partRows = refs.partRows || {}; refs.partRows[refKey] = partRows; }
  return row;
}
function freeRaw(rows, fxRH) {
  return sum(rows.filter(r => !r.is_subtotal), r => freeAmountHkd(r, fxRH));
}
function freeSubtotal(rows, fxRH) {
  return freeRaw(rows, fxRH);  // 不计损耗
}

// 通用四行小计区块（带公式）：小计 / 损耗 / 合计 RMB / 合计 HKD
// opts: { rawSum, lossPct, fxRH, valueCol (1-based 写入列), sumFormula (字符串 如 'SUM(L4:L9)') }
function appendThreeRowSubtotal(ws, row, opts) {
  const { rawSum = 0, lossPct = 0, fxRH, valueCol = 12, sumFormula = null, currency = 'RMB', refs = null, refKey = null, skipLoss = false } = opts;
  const fx = num(fxRH) || 0.85;
  const isHkd = currency === 'HKD';
  const totalComputed = rawSum * (1 + lossPct / 100);
  const labelCols = valueCol - 1;
  const lossPctDecimal = lossPct / 100;

  const colLetter = (n) => {
    let s = '';
    while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
    return s;
  };
  const VAL_COL = colLetter(valueCol);

  const mk = (label, value, fmt, level) => {
    ws.mergeCells(row, 1, row, labelCols);
    ws.getCell(row, 1).value = label;
    ws.getCell(row, valueCol).value = value;
    if (fmt) ws.getCell(row, valueCol).numFmt = fmt;
    // 标签行：白底 + 右对齐；只在数值单元格高亮
    for (let c = 1; c <= valueCol + 1; c++) {
      const cell = ws.getCell(row, c);
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = thinBorder();
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
    }
    ws.getCell(row, 1).alignment = { horizontal: 'right', vertical: 'middle' };
    // 只给数值单元格上色
    styleSubtotal(ws.getCell(row, valueCol), level);
    if (level === 'total' || level === 'hkd') {
      ws.getCell(row, 1).font = { bold: true, color: { argb: 'FF1F2937' }, name: 'Microsoft YaHei' };
      ws.getCell(row, valueCol).font = { bold: true, color: { argb: 'FF1F2937' }, name: 'Microsoft YaHei' };
    } else {
      ws.getCell(row, 1).font = { color: { argb: 'FF6B7280' }, name: 'Microsoft YaHei' };
      ws.getCell(row, valueCol).font = { color: { argb: 'FF6B7280' }, name: 'Microsoft YaHei' };
    }
    ws.getRow(row).height = 20;
    row += 1;
  };

  const subRow = row;
  const subLabel = isHkd ? '小计 HKD' : '小计 RMB';
  const subFmt = isHkd ? HKD4 : RMB;
  // skipLoss 且 lossPct=0 时，小计=合计 RMB，无需重复
  const showSub = !(skipLoss && !lossPct);
  if (showSub) {
    mk(subLabel,
      sumFormula ? { formula: sumFormula, result: rawSum } : rawSum,
      subFmt, 'sub');
  }
  let lossRow = null;
  if (!skipLoss) {
    lossRow = row;
    mk('损耗', lossPctDecimal, '0.00%', 'loss');
  }
  const totalRow = row;
  // 记录"合计"单元格地址
  if (refs && refKey) refs[refKey] = `${VAL_COL}${totalRow}`;
  // totalFormula：若 小计行 被略过，直接用 sumFormula 作为底
  const baseRef = showSub ? `${VAL_COL}${subRow}` : (sumFormula ? `(${sumFormula})` : rawSum);
  const totalFormula = skipLoss
    ? (lossPct ? `${baseRef}*${1 + lossPct/100}` : `${baseRef}`)
    : `${baseRef}*(1+${VAL_COL}${lossRow})`;
  if (isHkd) {
    mk('合计 HKD',
      { formula: totalFormula, result: totalComputed },
      HKD4, 'hkd');
  } else {
    mk('合计 RMB',
      { formula: totalFormula, result: totalComputed },
      RMB, 'total');
    mk(`合计 HKD (汇率 ${fx})`,
      { formula: `${VAL_COL}${totalRow}/${fx}`, result: totalComputed / fx },
      HKD4, 'hkd');
  }
  row += 1;
  return row;
}

// 排拉工序：按产品分组（人数 / 基数 / 标准工时 / 人工/PCS）
function renderAssemblyStepGroups(ws, row, title, groups, baseRate, stdTime, fxRH, refs, refKey) {
  ws.mergeCells(row, 1, row, 8); styleSection(ws.getCell(row, 1));
  ws.getCell(row, 1).value = title;
  row += 1;
  if (!groups.length) {
    ws.mergeCells(row, 1, row, 8);
    ws.getCell(row, 1).value = '（无）';
    ws.getCell(row, 1).font = { italic: true, color: { argb: 'FF9CA3AF' } };
    row += 1;
    if (refs) refs[refKey] = null;
    return row;
  }
  const groupTotalCells = [];
  groups.forEach(g => {
    // 产品标题
    ws.mergeCells(row, 1, row, 8);
    ws.getCell(row, 1).value = `产品：${g.product || '未命名'}    生产量：${num(g.qty)}    基数：${baseRate} HKD    标准工时：${stdTime} H`;
    ws.getCell(row, 1).font = { bold: true, color: { argb: 'FF16A34A' }, name: 'Microsoft YaHei' };
    ws.getCell(row, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECFDF5' } };
    row += 1;
    // 表头
    const h = ['序号', '工序名称', '人数', '标准工时', '基数 HKD', '生产量', '人工/PCS', '备注'];
    h.forEach((v, i) => { ws.getCell(row, i + 1).value = v; styleHeader(ws.getCell(row, i + 1)); });
    row += 1;
    const start = row;
    (g.steps || []).forEach((s, i) => {
      ws.getCell(row, 1).value = i + 1;
      ws.getCell(row, 2).value = s.name || '';
      ws.getCell(row, 3).value = num(s.count);
      ws.getCell(row, 4).value = stdTime;
      ws.getCell(row, 5).value = baseRate;
      ws.getCell(row, 6).value = num(g.qty);
      // 人工/PCS = 基数 × 人数 ÷ 生产量
      const amt = baseRate * num(s.count) / Math.max(num(g.qty), 1);
      ws.getCell(row, 7).value = { formula: `E${row}*C${row}/MAX(F${row},1)`, result: amt };
      ws.getCell(row, 7).numFmt = '0.0000';
      ws.getCell(row, 8).value = s.note || '';
      for (let c = 1; c <= 8; c++) styleData(ws.getCell(row, c));
      row += 1;
    });
    const end = row - 1;
    // 本组合计
    ws.mergeCells(row, 1, row, 6);
    ws.getCell(row, 1).value = '本组合计 HKD';
    ws.getCell(row, 1).alignment = { horizontal: 'right' };
    ws.getCell(row, 1).font = { bold: true, name: 'Microsoft YaHei' };
    const gTotal = sum(g.steps || [], s => baseRate * num(s.count) / Math.max(num(g.qty), 1));
    ws.getCell(row, 7).value = (g.steps || []).length
      ? { formula: `SUM(G${start}:G${end})`, result: gTotal }
      : gTotal;
    ws.getCell(row, 7).numFmt = HKD4;
    for (let c = 1; c <= 8; c++) { const cell = ws.getCell(row, c); cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } }; cell.border = thinBorder(); }
    styleSubtotal(ws.getCell(row, 7), 'sub');
    groupTotalCells.push(`G${row}`);
    row += 1;
    row += 1; // 空行
  });
  // 所有产品 合计 — HKD（基数本身港币，直接求和，不再除汇率）
  ws.mergeCells(row, 1, row, 6);
  ws.getCell(row, 1).value = '所有产品 合计 人工/PCS HKD';
  ws.getCell(row, 1).alignment = { horizontal: 'right' };
  ws.getCell(row, 1).font = { bold: true, name: 'Microsoft YaHei' };
  const totalAddr = `G${row}`;
  const totalVal = sum(groups, g => sum(g.steps || [], s => baseRate * num(s.count) / Math.max(num(g.qty), 1)));
  ws.getCell(row, 7).value = groupTotalCells.length
    ? { formula: groupTotalCells.join('+'), result: totalVal }
    : 0;
  ws.getCell(row, 7).numFmt = HKD4;
  styleSubtotal(ws.getCell(row, 7), 'total');
  if (refs) refs[refKey] = totalAddr;
  row += 1;
  return row;
}

function renderLaborTable(ws, row, title, rows, fxRH, lossPct, refs, refKey) {
  ws.mergeCells(row, 1, row, 13); styleSection(ws.getCell(row, 1));
  ws.getCell(row, 1).value = title;
  row += 1;
  const h = ['序号', '工序名称', '', '', '', '', '标准工时', '工序单价(元/PCS)', '用量', '成品金额', '备注'];
  h.forEach((v, i) => { ws.getCell(row, i + 1).value = v; styleHeader(ws.getCell(row, i + 1)); });
  ws.mergeCells(row, 2, row, 6);
  row += 1;
  const dataStart = row;
  rows.forEach((r, i) => {
    ws.getCell(row, 1).value = i + 1;
    ws.mergeCells(row, 2, row, 6);
    ws.getCell(row, 2).value = r.step || '';
    ws.getCell(row, 7).value = num(r.std_time);
    ws.getCell(row, 8).value = num(r.unit_price);
    ws.getCell(row, 9).value = num(r.qty);
    // 公式: 成品金额 = 单价 × 用量
    ws.getCell(row, 10).value = { formula: `H${row}*I${row}`, result: num(r.unit_price) * num(r.qty) };
    ws.getCell(row, 10).numFmt = RMB;
    ws.getCell(row, 11).value = r.note || '';
    for (let c = 1; c <= 11; c++) styleData(ws.getCell(row, c));
    row += 1;
  });
  const dataEnd = row - 1;
  const rawSum = sum(rows, r => num(r.unit_price) * num(r.qty));
  row = appendThreeRowSubtotal(ws, row, {
    rawSum,
    lossPct: num(lossPct ?? 0),
    fxRH: num(fxRH) || 0.85,
    valueCol: 10,
    sumFormula: rows.length ? `SUM(J${dataStart}:J${dataEnd})` : null,
    refs, refKey,
  });
  return row;
}

// ============ 新增：搪胶 / 车缝 / 吹气 / 纸箱 / 运费 / 减税明细 ============

function renderSlushBlock(ws, row, slush, fxRH, refs) {
  const items = slush.slush_items || [];
  if (!items.length) return row;
  ws.mergeCells(row, 1, row, 13); styleSection(ws.getCell(row, 1));
  ws.getCell(row, 1).value = '二·C、搪胶部分';
  row += 1;
  const h = ['序号', '产品编号', '胶件名称', '材料', '料重(g)', '日产量24H', '用量(PC)', '单价 HKD', '总价 HKD', '', '', '', '备注'];
  h.forEach((v, i) => { ws.getCell(row, i + 1).value = v; styleHeader(ws.getCell(row, i + 1)); });
  ws.mergeCells(row, 9, row, 10);
  row += 1;
  const start = row;
  items.forEach((r, i) => {
    ws.getCell(row, 1).value = i + 1;
    ws.getCell(row, 2).value = r.item_code || '';
    ws.getCell(row, 3).value = r.name || '';
    ws.getCell(row, 4).value = r.material || '';
    ws.getCell(row, 5).value = num(r.weight_g);
    ws.getCell(row, 6).value = num(r.daily_output);
    ws.getCell(row, 7).value = num(r.qty);
    ws.getCell(row, 8).value = num(r.unit_price_hkd);
    ws.getCell(row, 9).value = { formula: `G${row}*H${row}`, result: num(r.qty) * num(r.unit_price_hkd) };
    ws.mergeCells(row, 9, row, 10);
    ws.getCell(row, 9).numFmt = '0.0000';
    ws.getCell(row, 13).value = r.note || '';
    for (let c = 1; c <= 13; c++) styleData(ws.getCell(row, c));
    row += 1;
  });
  const end = row - 1;
  ws.mergeCells(row, 1, row, 8);
  ws.getCell(row, 1).value = '合计 HKD';
  ws.getCell(row, 1).alignment = { horizontal: 'right', vertical: 'middle' };
  ws.getCell(row, 9).value = items.length ? { formula: `SUM(I${start}:I${end})`, result: sum(items, r => num(r.qty) * num(r.unit_price_hkd)) } : 0;
  ws.mergeCells(row, 9, row, 10);
  ws.getCell(row, 9).numFmt = HKD4;
  for (let c = 1; c <= 13; c++) {
    const cell = ws.getCell(row, c);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
    cell.border = thinBorder();
  }
  styleSubtotal(ws.getCell(row, 9), 'total');
  ws.getCell(row, 1).font = { bold: true, color: { argb: 'FF1F2937' }, name: 'Microsoft YaHei' };
  ws.getCell(row, 9).font = { bold: true, color: { argb: 'FF1F2937' }, name: 'Microsoft YaHei' };
  if (refs) refs.slush = `I${row}`;
  row += 2;
  return row;
}

function renderBlowBlock(ws, row, mold, refs) {
  const items = mold.blow_items || [];
  if (!items.length) return row;
  ws.mergeCells(row, 1, row, 13); styleSection(ws.getCell(row, 1));
  ws.getCell(row, 1).value = '二·B、吹气部分 (HKD)';
  row += 1;
  const h = ['货名', '日产量/22H', '用料', '预估料重(g)', '料价 HK$/lb', '产品料价', '吹工', '披锋', '小计', '利润 ×', '合计 HK$', '出数', '模价(¥)'];
  h.forEach((v, i) => { ws.getCell(row, i + 1).value = v; styleHeader(ws.getCell(row, i + 1)); });
  row += 1;
  items.forEach(r => {
    const mat = num(r.weight_g) * num(r.material_price_lb) / 454;
    const sub = mat + num(r.blow_labor) + num(r.flash);
    const tot = sub * (num(r.profit_x) || 1);
    // 列：A货名 B产能 C用料 D重 E料价 F产品料价 G吹工 H披锋 I小计 J利润× K合计 L一出 M模价
    ws.getCell(row, 1).value = r.name || '';
    ws.getCell(row, 2).value = r.capacity || '';
    ws.getCell(row, 3).value = r.material || '';
    ws.getCell(row, 4).value = num(r.weight_g);
    ws.getCell(row, 5).value = num(r.material_price_lb);
    ws.getCell(row, 6).value = { formula: `D${row}*E${row}/454`, result: mat };  // 产品料价 = 重×料价/454
    ws.getCell(row, 7).value = num(r.blow_labor);
    ws.getCell(row, 8).value = num(r.flash);
    ws.getCell(row, 9).value = { formula: `F${row}+G${row}+H${row}`, result: sub };  // 小计 = 产品料价+吹工+披锋
    ws.getCell(row, 10).value = num(r.profit_x);
    ws.getCell(row, 11).value = { formula: `I${row}*J${row}`, result: tot };  // 合计 = 小计×利润
    ws.getCell(row, 12).value = r.cavity_note || '';
    ws.getCell(row, 13).value = r.mold_price_note || '';
    for (let c = 1; c <= 13; c++) styleData(ws.getCell(row, c));
    [4, 5, 6, 7, 8, 9, 11].forEach(c => ws.getCell(row, c).numFmt = '0.0000');
    row += 1;
  });
  const dataEnd = row - 1;
  // 合计 HK$ - SUM 公式（只数值上色）
  ws.mergeCells(row, 1, row, 10);
  ws.getCell(row, 1).value = '合计 HK$';
  ws.getCell(row, 1).alignment = { horizontal: 'right', vertical: 'middle' };
  const blowTot = sum(items, r => {
    const mat = num(r.weight_g) * num(r.material_price_lb) / 454;
    return (mat + num(r.blow_labor) + num(r.flash)) * (num(r.profit_x) || 1);
  });
  ws.getCell(row, 11).value = { formula: `SUM(K${dataEnd - items.length + 1}:K${dataEnd})`, result: blowTot };
  ws.getCell(row, 11).numFmt = HKD4;
  for (let c = 1; c <= 13; c++) {
    const cell = ws.getCell(row, c);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
    cell.border = thinBorder();
  }
  styleSubtotal(ws.getCell(row, 11), 'total');
  ws.getCell(row, 1).font = { bold: true, color: { argb: 'FF1F2937' }, name: 'Microsoft YaHei' };
  ws.getCell(row, 11).font = { bold: true, color: { argb: 'FF1F2937' }, name: 'Microsoft YaHei' };
  if (refs) refs.blow = `K${row}`;
  row += 2;
  return row;
}

function renderSewingBlock(ws, row, sewing, fxRH, refs) {
  const groups = sewing.sewing_groups || [];
  if (!groups.length) return row;
  // 主表只显示 车缝部分 标题 + 配套合计；明细已在 车缝明细 sheet 单独展示
  ws.mergeCells(row, 1, row, 13); styleSection(ws.getCell(row, 1));
  ws.getCell(row, 1).value = '车缝部分（明细见"车缝明细" sheet）';
  row += 1;
  let weightedNumerator = 0;
  const totalQty = sewTotalQty(sewing);
  const groupTerms = [];
  const hairTerms = [], clothTerms = [];
  // 预计算每组在"车缝明细" sheet 的 items 行区间（用于公式引用）
  let detailRow = 4; // 车缝明细 sheet 中第 1 个 group 的首行 items
  const ranges = groups.map(g => {
    const n = (g.items || []).length;
    const r = { start: detailRow, end: detailRow + n - 1 };
    detailRow += n + 4; // items + 本组合计 + blank + 产品label + header = n + 4
    return r;
  });
  groups.forEach((g, gi) => {
    const itemsSum = sum(g.items || [], r => num(r.usage) * num(r.mat_price) * (num(r.markup) || 1));
    const _labor = sewLaborToAdd(g);  // 人工已在明细行则为 0
    const groupTotal = itemsSum + _labor;
    const qty = sewGroupQty(g);
    // 仅显示每组一行小计 — 用 车缝明细 sheet 的范围引用公式
    ws.mergeCells(row, 1, row, 8);
    const _embN = (g.items || []).filter(r => r.craft === '电绣').length;
    ws.getCell(row, 1).value = `${g.name || '未命名'} 小计 RMB（用量 ${qty}）${_embN ? `（含电绣 ${_embN} 行）` : ''}`;
    ws.getCell(row, 1).alignment = { horizontal: 'right', vertical: 'middle' };
    ws.getCell(row, 1).font = { name: 'Microsoft YaHei' };
    ws.mergeCells(row, 9, row, 10);
    const rng = ranges[gi];
    const hasItems = (g.items || []).length > 0;
    if (hasItems) {
      // 总价钱在"车缝明细"sheet 的 J 列（加了「工艺」列后右移）
      ws.getCell(row, 9).value = { formula: _labor > 0 ? `SUM('车缝明细'!J${rng.start}:J${rng.end})+${_labor}` : `SUM('车缝明细'!J${rng.start}:J${rng.end})`, result: groupTotal };
    } else {
      ws.getCell(row, 9).value = groupTotal;
    }
    ws.getCell(row, 9).numFmt = RMB;
    for (let c = 1; c <= 13; c++) { const cell = ws.getCell(row, c); cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } }; cell.border = thinBorder(); }
    styleSubtotal(ws.getCell(row, 9), 'sub');
    const term = `I${row}*${qty}`;
    groupTerms.push(term);
    // 前端：车发 = category==='车发'；车衣 = 其余（默认）
    if ((g.category || '车衣') === '车发') hairTerms.push(term); else clothTerms.push(term);
    weightedNumerator += groupTotal * qty;
    row += 1;
  });
  // 配套合计 → 小计/合计 RMB/合计 HKD（不计算损耗）
  row = appendThreeRowSubtotal(ws, row, {
    rawSum: weightedNumerator / totalQty,
    lossPct: 0,
    fxRH: num(fxRH) || 0.85,
    valueCol: 9,
    sumFormula: groupTerms.length ? `(${groupTerms.join('+')})/${totalQty}` : null,
    skipLoss: true,
    refs, refKey: 'sewing',
  });
  if (refs) {
    refs.sewHairRmb = hairTerms.length ? `(${hairTerms.join('+')})/${totalQty}` : null;
    refs.sewClothRmb = clothTerms.length ? `(${clothTerms.join('+')})/${totalQty}` : null;
  }
  return row;
}

// ============ 旧的车缝详细块（保留备用，已废弃，主表用上面的简版） ============
function _renderSewingBlockDetailed(ws, row, sewing, fxRH, refs) {
  const groups = sewing.sewing_groups || [];
  if (!groups.length) return row;
  ws.mergeCells(row, 1, row, 13); styleSection(ws.getCell(row, 1));
  ws.getCell(row, 1).value = '车缝部分';
  row += 1;
  let configRowTotal = 0;
  const groupTotalCells = [];
  groups.forEach((g, gi) => {
    ws.mergeCells(row, 1, row, 13);
    ws.getCell(row, 1).value = `产品：${g.name || '未命名 ' + (gi + 1)}`;
    ws.getCell(row, 1).font = { bold: true, color: { argb: 'FF16A34A' }, name: 'Microsoft YaHei' };
    ws.getCell(row, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECFDF5' } };
    row += 1;
    const h = ['序号', '布料名称', '部位', '裁片数', '用量/码', '物料价(RMB)', '价钱(RMB)', '码点', '总价钱(RMB)', '', '', '', '备注'];
    h.forEach((v, i) => { ws.getCell(row, i + 1).value = v; styleHeader(ws.getCell(row, i + 1)); });
    ws.mergeCells(row, 9, row, 10);
    row += 1;
    const start = row;
    (g.items || []).forEach((r, i) => {
      ws.getCell(row, 1).value = i + 1;
      ws.getCell(row, 2).value = r.fabric || '';
      ws.getCell(row, 3).value = r.part || '';
      ws.getCell(row, 4).value = num(r.pieces);
      ws.getCell(row, 5).value = num(r.usage);
      ws.getCell(row, 6).value = num(r.mat_price);
      ws.getCell(row, 7).value = { formula: `E${row}*F${row}`, result: num(r.usage) * num(r.mat_price) };
      ws.getCell(row, 8).value = num(r.markup) || 1;
      ws.getCell(row, 9).value = { formula: `G${row}*H${row}`, result: num(r.usage) * num(r.mat_price) * (num(r.markup) || 1) };
      ws.mergeCells(row, 9, row, 10);
      ws.getCell(row, 9).numFmt = '0.0000';
      ws.getCell(row, 13).value = r.note || '';
      for (let c = 1; c <= 13; c++) styleData(ws.getCell(row, c));
      row += 1;
    });
    const end = row - 1;
    const itemsSum = sum(g.items || [], r => num(r.usage) * num(r.mat_price) * (num(r.markup) || 1));
    // 人工行
    ws.mergeCells(row, 1, row, 8);
    ws.getCell(row, 1).value = '人工 (RMB)';
    ws.getCell(row, 1).alignment = { horizontal: 'right' };
    ws.getCell(row, 9).value = sewLaborToAdd(g);  // 人工已在明细行则为 0，避免双算
    ws.mergeCells(row, 9, row, 10);
    ws.getCell(row, 9).numFmt = '0.0000';
    for (let c = 1; c <= 13; c++) styleData(ws.getCell(row, c));
    row += 1;
    // 本组合计 - 只在数值上色
    ws.mergeCells(row, 1, row, 8);
    ws.getCell(row, 1).value = '本组合计 RMB';
    ws.getCell(row, 1).alignment = { horizontal: 'right', vertical: 'middle' };
    const groupTotal = itemsSum + sewLaborToAdd(g);
    ws.getCell(row, 9).value = (g.items || []).length
      ? { formula: `SUM(I${start}:I${end})+I${row - 1}`, result: groupTotal }
      : groupTotal;
    ws.mergeCells(row, 9, row, 10);
    ws.getCell(row, 9).numFmt = RMB;
    for (let c = 1; c <= 13; c++) {
      const cell = ws.getCell(row, c);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
      cell.border = thinBorder();
    }
    styleSubtotal(ws.getCell(row, 9), 'sub');
    ws.getCell(row, 1).font = { bold: true, color: { argb: 'FF1F2937' }, name: 'Microsoft YaHei' };
    ws.getCell(row, 9).font = { bold: true, color: { argb: 'FF1F2937' }, name: 'Microsoft YaHei' };
    groupTotalCells.push(`I${row}`);
    row += 1;
    configRowTotal += groupTotal;
  });
  // 配套合计 → 小计 / 损耗 / 合计 RMB / 合计 HKD（4 行）
  row = appendThreeRowSubtotal(ws, row, {
    rawSum: configRowTotal,
    lossPct: num(sewing.sewing_loss_pct),
    fxRH: num(fxRH) || 0.85,
    valueCol: 9,
    sumFormula: groupTotalCells.length ? groupTotalCells.join('+') : null,
    refs, refKey: 'sewing',
  });
  return row;
}

function renderCartonAndFreight(ws, row, eng, sales, refs) {
  const c = eng.carton_calc || {};
  // 每个纸箱跟踪: { boxCell, flatCells: [...], qtyCell } 用于构造 九、合计 K 列公式
  const cartonRefs = [];
  const f = sales.freight_calc || {
    cap_10t: 1166, cap_5t: 750, cap_40: 1980, cap_20: 883,
    hk40: 8000, hk20: 7100, yt40: 7200, yt20: 6000,
    hk10t: 14900, yt10t: 11500, hk5t: 12500, yt5t: 11000,
  };
  ws.mergeCells(row, 1, row, 13); styleSection(ws.getCell(row, 1));
  ws.getCell(row, 1).value = '📦 纸箱 / 运费 计算（参考）';
  row += 1;

  // ---- 纸箱计算（多纸箱 + 多平卡）----
  let cuftRow = 0, qtyRow = 0;
  const cartonRate = num(c.paper_rate) || 2.75;  // 纸价系数（可调）
  const cartons = (c.cartons && c.cartons.length) ? c.cartons : (c.cl ? [{
    name: '主纸箱', cl: c.cl, cw: c.cw, ch: c.ch, qty: c.qty,
    flat_cards: c.flat_card ? [{ name: '主平卡', l: c.cl, w: c.cw }] : [],
  }] : []);

  if (cartons.length) {
    // 产品尺寸
    ws.getCell(row, 1).value = '产品尺寸 CM'; ws.mergeCells(row, 1, row, 4);
    ws.getCell(row, 5).value = 'L'; ws.getCell(row, 6).value = num(c.pl);
    ws.getCell(row, 7).value = 'W'; ws.getCell(row, 8).value = num(c.pw);
    ws.getCell(row, 9).value = 'H'; ws.getCell(row, 10).value = num(c.ph);
    for (let cc = 1; cc <= 13; cc++) styleData(ws.getCell(row, cc));
    ws.getCell(row, 1).alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
    row += 1;

    // 纸箱表头
    const cartonHeader = ['名称', '纸箱 L (inch)', 'W', 'H', 'CU.FT', '箱价 (HK$)', '数量', '', '', '', '', '', ''];
    cartonHeader.forEach((v, i) => { ws.getCell(row, i + 1).value = v; styleHeader(ws.getCell(row, i + 1)); });
    row += 1;

    cartons.forEach((b, bi) => {
      // 纸箱主行
      ws.getCell(row, 1).value = b.name || `纸箱${bi + 1}`;
      ws.getCell(row, 2).value = num(b.cl);
      ws.getCell(row, 3).value = num(b.cw);
      ws.getCell(row, 4).value = num(b.ch);
      ws.getCell(row, 5).value = { formula: `B${row}*C${row}*D${row}/1728`, result: num(b.cl) * num(b.cw) * num(b.ch) / 1728 };
      ws.getCell(row, 5).numFmt = '0.0000';
      ws.getCell(row, 6).value = { formula: `(B${row}+C${row}+2)*(C${row}+D${row}+1)*2*${cartonRate}/1000`,
                                   result: (num(b.cl) + num(b.cw) + 2) * (num(b.cw) + num(b.ch) + 1) * 2 * cartonRate / 1000 };
      ws.getCell(row, 6).numFmt = HKD;
      ws.getCell(row, 7).value = num(b.qty);
      for (let cc = 1; cc <= 7; cc++) styleData(ws.getCell(row, cc));
      if (bi === 0) { cuftRow = row; qtyRow = row; } // 第一个纸箱供运费引用
      const cartonRef = { boxCell: `F${row}`, qtyCell: `G${row}`, flatCells: [] };
      row += 1;

      // 平卡子表
      const fcs = b.flat_cards || [];
      if (fcs.length) {
        ws.getCell(row, 2).value = '↳ 平卡';
        ws.getCell(row, 2).font = { italic: true, color: { argb: 'FF78716C' } };
        const fcHead = ['', '名称', 'L (inch)', 'W', '平卡价 (HK$)'];
        fcHead.forEach((v, i) => { if (v) { ws.getCell(row, i + 2).value = v; styleHeader(ws.getCell(row, i + 2)); } });
        row += 1;
        fcs.forEach((f) => {
          // 平卡 L/W 留空时对应纸箱长/宽
          const fl = num(f.l) || num(b.cl), fw = num(f.w) || num(b.cw);
          ws.getCell(row, 3).value = f.name || '';
          ws.getCell(row, 4).value = fl;
          ws.getCell(row, 5).value = fw;
          ws.getCell(row, 6).value = { formula: `(D${row}+1)*(E${row}+1)*2/1000`, result: (fl + 1) * (fw + 1) * 2 / 1000 };
          ws.getCell(row, 6).numFmt = HKD;
          for (let cc = 3; cc <= 6; cc++) styleData(ws.getCell(row, cc));
          cartonRef.flatCells.push(`F${row}`);
          row += 1;
        });
      }
      cartonRefs.push(cartonRef);
      row += 1; // 纸箱之间空一行
    });
  }

  // 构造 九、合计 K 列纸箱成本公式：Σ((box_i + Σflat_i_j) / qty_i)
  if (refs && cartonRefs.length) {
    const parts = cartonRefs.map(cr => {
      const flatSum = cr.flatCells.length ? `+${cr.flatCells.join('+')}` : '';
      return `(${cr.boxCell}${flatSum})/MAX(${cr.qtyCell},1)`;
    });
    refs.cartonHkdPerPcs = parts.join('+');  // HK$/PCS （还没 × 汇率）
  }

  // ---- 运费场景（含公式）----
  if (f) {
    const h = ['运费场景', '柜/车 CUFT', '运+吊柜费 HK$', '总箱数', '运+吊柜 HK$/PCS'];
    h.forEach((v, i) => { ws.getCell(row, i + 1).value = v; styleHeader(ws.getCell(row, i + 1)); });
    row += 1;
    const types = [
      ['HK 40柜', num(f.cap_40), num(f.hk40)], ['HK 20柜', num(f.cap_20), num(f.hk20)],
      ['YT 40柜', num(f.cap_40), num(f.yt40)], ['YT 20柜', num(f.cap_20), num(f.yt20)],
      ['HK 10吨车', num(f.cap_10t), num(f.hk10t)], ['YT 10吨车', num(f.cap_10t), num(f.yt10t)],
      ['HK 5吨车', num(f.cap_5t), num(f.hk5t)], ['YT 5吨车', num(f.cap_5t), num(f.yt5t)],
    ];
    const cuftRef = cuftRow ? `E${cuftRow}` : null;  // 纸箱主行 E 列 = CU.FT
    const qtyRef = qtyRow ? `G${qtyRow}` : null;     // 纸箱主行 G 列 = 每箱数量（不是 E=CU.FT）
    types.forEach(([name, cap, fee]) => {
      ws.getCell(row, 1).value = name;
      ws.getCell(row, 2).value = cap;
      ws.getCell(row, 3).value = fee;
      ws.getCell(row, 3).numFmt = HKD;
      const cuftSafe = cuftRef ? `MAX(${cuftRef},0.01)` : '1';
      const boxesFm = `MAX(ROUND(B${row}/${cuftSafe},0),1)`;
      const qtySafe = qtyRef ? `MAX(${qtyRef},1)` : '1';
      const boxesCalc = cap > 0 && cuftRef ? Math.max(Math.round(cap / Math.max(num(eng.carton_calc?.cuft) || ((num(eng.carton_calc?.cl) * num(eng.carton_calc?.cw) * num(eng.carton_calc?.ch)) / 1728), 0.01)), 1) : 1;
      const ppCalc = fee / Math.max(boxesCalc, 1) / Math.max(num(eng.carton_calc?.qty) || 1, 1);
      ws.getCell(row, 4).value = cuftRef ? { formula: boxesFm, result: boxesCalc } : boxesCalc;
      ws.getCell(row, 5).value = { formula: `C${row}/D${row}/${qtySafe}`, result: ppCalc };
      ws.getCell(row, 5).numFmt = HKD;
      for (let cc = 1; cc <= 5; cc++) styleData(ws.getCell(row, cc));
      // 记录每个运费场景的「运+吊柜 HK$/PCS」单元格(E列)，供减税明细 运费/吊柜费 公式引用
      if (refs) { refs.freightCells = refs.freightCells || {}; refs.freightCells[name] = `E${row}`; }
      row += 1;
    });
    row += 1;
  }
  return row;
}

function renderTaxSummary(ws, row, sales, extra = {}) {
  const ps = sales.pricing_summary;
  if (!ps) return row;
  const { subRefs = {}, fxRH: fxR = 0.85 } = extra;
  // 表1 部分单元格可关联到上方各部门 / 九、合计 HKD 小计
  const sumR = extra.summaryRow;
  const ov = ps.overrides || {};  // 用户手填覆盖的项 → 不写公式，保持静态值

  // ---- 关键字分类，把减税明细做成引用上方明细的公式 ----
  // ⚠️ 必须与前端 workbench.js 的 autoFill 分类逻辑（_catOf：显式类别优先 + 关键字兜底 及各项来源表）保持一致，
  //    否则导出值会与 UI 提取计算静默不符。改动其一务必同步另一处。
  const _isMotor   = s => /马达|motor/i.test(String(s || ''));
  const _isBlister = s => /吸塑|blister/i.test(String(s || ''));
  const _isGlueBag = s => /胶袋|胶代|poly\s?bag|pe\s?bag|opp\s?bag/i.test(String(s || ''));
  const _isBat     = s => /电池|battery/i.test(String(s || ''));
  const _isLib     = s => /利宝|贴纸|libao|sticker/i.test(String(s || ''));
  const _isColorBoxLib = r => /彩盒|彩卡|内咭|内卡|背卡|包装|package|box/i.test(String((r.name || '') + ' ' + (r.spec || '')));
  const _isPlate   = s => /电镀|plating/i.test(String(s || ''));
  const _isCarton  = s => /纸箱|carton/i.test(String(s || ''));
  const _row = (fn, r) => fn(r.name) || fn(r.spec);
  const pr = subRefs.partRows || {};
  const _pick    = (key, fn) => (pr[key] || []).filter(r => _row(fn, r)).map(r => r.cell);
  const _pickNot = (key, pred) => (pr[key] || []).filter(r => !pred(r)).map(r => r.cell);
  // 辅助/包装 行的类别：显式 category 优先，否则关键字兜底（纸箱 → null 单独计），与前端 _catOf 一致
  const _catOf = (r, tbl) => {
    if (r.category && MAT_CATEGORIES.includes(r.category)) return r.category;
    if (r.category === '利宝') return '产品利宝';
    if (_row(_isBlister, r)) return '吸塑';
    if (_row(_isGlueBag, r)) return '胶袋';
    if (_row(_isBat, r))     return '电池';
    if (_row(_isLib, r))     return _isColorBoxLib(r) ? '彩盒利宝' : '产品利宝';
    if (_row(_isPlate, r))   return '电镀';
    if (_row(_isCarton, r))  return null;  // 纸箱另算
    return tbl === 'aux' ? '其他外购' : '彩盒/内咭';
  };
  // 跨 包装 + 辅助 两表，取归属该类别的行的金额单元格
  const byCat = (cat) => [
    ...(pr.packaging || []).filter(r => _catOf(r, 'packaging') === cat).map(r => r.cell),
    ...(pr.aux       || []).filter(r => _catOf(r, 'aux')       === cat).map(r => r.cell),
  ];
  // 马达 = 电子 + 五金 行（按关键字，电子/五金表无类别下拉）
  const motorCells   = [..._pick('electronic', _isMotor), ..._pick('hardware', _isMotor)];
  // 吸塑 = 辅助/包装按类别 + 电子/五金里关键字命中的吸塑行
  const blisterCells = [...byCat('吸塑'), ..._pick('electronic', _isBlister), ..._pick('hardware', _isBlister)];
  const glueBagCells  = byCat('胶袋');
  const batteryCells  = byCat('电池');
  const libaoCells    = [...byCat('产品利宝'), ...byCat('彩盒利宝')];
  const platingCells  = byCat('电镀');
  const colorBoxCells = byCat('彩盒/内咭');
  const otherBuyCells = byCat('其他外购');
  // 五金/电子 均剔除马达（与前端一致，避免与「马达」列双算）
  const hwNonMotorCells   = _pickNot('hardware',   r => _row(_isMotor, r));
  const elecNonMotorCells = _pickNot('electronic', r => _row(_isMotor, r));

  // cells → 公式 ref（fx=true 表示 RMB→HKD 除以汇率）；被手填覆盖或无来源则返回 null（回退静态值）
  const auto = (tbl, key, cells, fx) => {
    if (ov[`${tbl}.${key}`] || !cells || !cells.length) return null;
    const body = cells.join('+');
    return { ref: fx ? `(${body})/${fxR}` : body };
  };

  // 运费/吊柜费：盐田40柜 = 运费场景表「YT 40柜」行的每PCS运费率(E列)
  const fPct = num(sales.shipping?.freight_pct ?? 48);
  const lPct = num(sales.shipping?.lifting_pct ?? 52);
  const ytRateCell = (subRefs.freightCells || {})['YT 40柜'];

  // 直接引用单元格的项（非关键字累加）：被手填覆盖或无来源则回退静态值
  const refLink = (tbl, key, ref) => (ref && !ov[`${tbl}.${key}`]) ? { ref } : null;

  const markupValue = sales.shipping?.markup_x;
  const _mk = markupValue == null || markupValue === '' ? 1.2 : num(markupValue);
  // 用逐格相加代替 SUM()：liveResult 只计算纯四则运算，确保 xlsx 缓存值与页面实时值一致。
  // A-L 中排除 C(电子)、K(车缝)，二者在出货价算价中独立处理。
  const divisorValue = sales.shipping?.divisor;
  const _divisor = divisorValue == null || divisorValue === '' ? 0.98 : num(divisorValue);
  const basePriceFormulaRef = subRefs.customerTotalHkdCell
    ? `${subRefs.customerTotalHkdCell}*${_divisor}`
    : (sumR
      ? `(${['A', 'B', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'L'].map(col => `${col}${sumR}`).join('+')})*${_mk}`
      : null);
  const linkMap = {
    // 货价基数排除电子(C)和车缝(K)，二者在出货价算价中独立处理。
    base_price: refLink('t1', 'base_price', basePriceFormulaRef),
    blow:     subRefs.blow      ? { ref: subRefs.blow }   : null,  // 吹气 本身就是 HKD
    slush:    subRefs.slush     ? { ref: subRefs.slush }  : null,  // 搪胶 本身就是 HKD
    electronic: auto('t1', 'electronic', elecNonMotorCells, false),  // 电子已是 HKD（剔除马达）
    // 注塑料按材质分（I列原料单价已是 HKD，不除汇率）
    imp_mat: auto('t1', 'imp_mat', subRefs.impMatCells, false),
    dom_mat: auto('t1', 'dom_mat', subRefs.domMatCells, false),
    sewing_hair:  (subRefs.sewHairRmb && !ov['t1.sewing_hair']) ? { ref: `(${subRefs.sewHairRmb})/${fxR}` } : null,
    sewing_cloth: (subRefs.sewClothRmb && !ov['t1.sewing_cloth']) ? { ref: `(${subRefs.sewClothRmb})/${fxR}` } : null,
    motor:    auto('t1', 'motor',    motorCells,      false),  // 电子+五金 已 HKD
    suction:  auto('t1', 'suction',  blisterCells,    false),  // 包装+电子+五金 已 HKD
    glue_bag: auto('t1', 'glue_bag', glueBagCells,    false),  // 胶袋：辅助+包装 已 HKD
    hardware: auto('t1', 'hardware', hwNonMotorCells, false),  // 五金已 HKD（剔除马达）
    // 表2 包装/外购：包装/辅助 已是 HKD，不除汇率
    color_box: auto('t2', 'color_box', colorBoxCells, false),
    other_buy: auto('t2', 'other_buy', otherBuyCells, false),
    battery:   auto('t2', 'battery',   batteryCells,  false),
    libao:     auto('t2', 'libao',     libaoCells,    false),
    plating:   auto('t2', 'plating',   platingCells,  false),
    // 新列布局：纸箱=L，印尼运费=I，附加税=M。
    carton:      refLink('t2', 'carton',      sumR ? `L${sumR}` : null),
    misc:        refLink('t2', 'misc',        sumR ? `I${sumR}+M${sumR}` : null),
    // 未减税前码数会在总成本生成后回填为“货价 ÷ 总成本”。
    code_before: null,
    // 运费/吊柜费 = 直接引用 出货价算价 盐田40柜 的 运费/吊柜费 单元格（单一来源）；回退到运费场景率×%
    freight: refLink('t2', 'freight', subRefs.shipFreightCell || (ytRateCell ? `${ytRateCell}*${fPct}/100` : null)),
    cabinet: refLink('t2', 'cabinet', subRefs.shipCabinetCell || (ytRateCell ? `${ytRateCell}*${lPct}/100` : null)),
  };
  const colL = (n) => { let s=''; while(n>0){const m=(n-1)%26; s=String.fromCharCode(65+m)+s; n=Math.floor((n-1)/26);} return s; };

  // 实时重算公式 result（不依赖可能过期的 ps 存储快照）：读取被引用单元格的当前值代入求值。
  // 所有被引用单元格都在本表之前已写入实时值，故结果 = UI 当前提取计算值。
  const cellVal = (addr) => { const c = ws.getCell(addr); let v = c && c.value; if (v && typeof v === 'object') v = ('result' in v) ? v.result : (('formula' in v) ? 0 : v); return Number(v) || 0; };
  const liveResult = (ref, fallback) => {
    if (!ref) return fallback;
    const expr = ref.replace(/[A-Z]+\d+/g, m => cellVal(m));
    if (!/^[-+*/().\d\s]+$/.test(expr)) return fallback;  // 只允许纯算术，安全兜底
    try { const r = Function(`return (${expr})`)(); return Number.isFinite(r) ? r : fallback; } catch { return fallback; }
  };
  // 写一行减税明细：有 link 写公式(result 实时重算)，否则写静态值
  const writeDataRow = (cols, data, dataRow) => cols.forEach((c, i) => {
    const cell = ws.getCell(dataRow, i + 1);
    const link = linkMap[c[1]];
    cell.value = link ? { formula: link.ref, result: liveResult(link.ref, num(data[c[1]])) } : num(data[c[1]]);
    styleData(cell);
    cell.numFmt = '0.0000';
  });

  ws.mergeCells(row, 1, row, 13); styleSection(ws.getCell(row, 1));
  ws.getCell(row, 1).value = '十二、减税明细 / 成本汇总';
  row += 1;

  // 表 1 出厂货价核
  const t1 = ps.t1 || {};
  const t1Cols = [['货价', 'base_price'], ['进口料', 'imp_mat'], ['国内料', 'dom_mat'], ['吹气', 'blow'], ['搪胶', 'slush'],
    ['车发', 'sewing_hair'], ['车衣', 'sewing_cloth'], ['五金', 'hardware'], ['电子', 'electronic'], ['马达', 'motor'], ['吸塑', 'suction'], ['胶袋', 'glue_bag']];
  ws.getCell(row, 1).value = '一、出厂货价核';
  ws.mergeCells(row, 1, row, 13);
  ws.getCell(row, 1).font = { bold: true, name: 'Microsoft YaHei' };
  row += 1;
  t1Cols.forEach((c, i) => { ws.getCell(row, i + 1).value = c[0]; styleHeader(ws.getCell(row, i + 1)); });
  row += 1;
  const t1DataRow = row;
  writeDataRow(t1Cols, t1, t1DataRow);
  row += 2;
  // 单元格地址
  const t1Addr = {};
  t1Cols.forEach((c, i) => { t1Addr[c[1]] = `${colL(i+1)}${t1DataRow}`; });

  // 表 2 包装/外购
  const t2 = ps.t2 || {};
  // 与前端 UI 一致：彩盒/内咭 合并为一列（inner_card 为已废弃字段，前端已并入 color_box）
  const t2Cols = [['彩盒/内咭', 'color_box'], ['未减税前码数', 'code_before'], ['减税后码数', 'code_after'],
    ['电池', 'battery'], ['利宝', 'libao'], ['电镀', 'plating'], ['其他外购', 'other_buy'],
    ['纸箱', 'carton'], ['运费', 'freight'], ['吊柜费', 'cabinet'], ['杂项', 'misc']];
  ws.getCell(row, 1).value = '二、包装 / 外购';
  ws.mergeCells(row, 1, row, 13);
  ws.getCell(row, 1).font = { bold: true, name: 'Microsoft YaHei' };
  row += 1;
  t2Cols.forEach((c, i) => { ws.getCell(row, i + 1).value = c[0]; styleHeader(ws.getCell(row, i + 1)); });
  row += 1;
  const t2DataRow = row;
  writeDataRow(t2Cols, t2, t2DataRow);
  row += 2;
  const t2Addr = {};
  t2Cols.forEach((c, i) => { t2Addr[c[1]] = `${colL(i+1)}${t2DataRow}`; });

  // 不含人工成本各项地址组（表1 除货价 + 表2 除码数）
  const noLaborRefs = [];
  t1Cols.slice(1).forEach(([, k]) => noLaborRefs.push(t1Addr[k]));
  t2Cols.filter(([, k]) => k !== 'code_before' && k !== 'code_after').forEach(([, k]) => noLaborRefs.push(t2Addr[k]));

  // 表 3 人工 & 成本汇总
  const t3 = ps.t3 || {};
  const asmRef = (subRefs.asmLabor && subRefs.pkgLabor) ? `${subRefs.asmLabor}+${subRefs.pkgLabor}`
                : (subRefs.asmLabor || subRefs.pkgLabor || null);
  const injectionLabor = ov['t3.injection_labor'] ? num(t3.injection_labor)
    : liveResult(subRefs.injShotSum, num(t3.injection_labor));
  const paintingLabor = ov['t3.painting_labor'] ? num(t3.painting_labor)
    : liveResult(subRefs.secondProc ? `${subRefs.secondProc}*0.7` : null, num(t3.painting_labor));
  const paintMaterial = ov['t3.paint_material'] ? num(t3.paint_material)
    : liveResult(subRefs.secondProc ? `${subRefs.secondProc}*0.3` : null, num(t3.paint_material));
  const assemblyLabor = ov['t3.assembly_labor'] ? num(t3.assembly_labor)
    : liveResult(asmRef, num(t3.assembly_labor));
  // result 用实时单元格值（不用过期 ps 快照），与 表1/表2 口径一致
  const basePrice = cellVal(t1Addr.base_price);
  const noLaborCost = noLaborRefs.reduce((s, ref) => s + cellVal(ref), 0)
                    + injectionLabor + paintingLabor + paintMaterial;
  const totalCost = noLaborCost + assemblyLabor;
  const gross = basePrice - noLaborCost;
  const profit = basePrice - totalCost;

  ws.getCell(row, 1).value = '三、人工 & 成本汇总';
  ws.mergeCells(row, 1, row, 13);
  ws.getCell(row, 1).font = { bold: true, name: 'Microsoft YaHei' };
  row += 1;
  // 与前端 UI 一致：啤工 喷油工 油漆 装配工 不含人工成本 人工比例 毛利 毛利率 利润 利润率 总成本（无 ABS 列）
  const t3Header = ['啤工', '喷油工', '油漆', '装配工', '不含人工成本', '人工比例', '毛利', '毛利率', '利润', '利润率', '总成本'];
  t3Header.forEach((v, i) => { ws.getCell(row, i + 1).value = v; styleHeader(ws.getCell(row, i + 1)); });
  row += 1;
  const t3Row = row;
  const basePriceRef = t1Addr.base_price;  // 货价
  // A 啤工 B 喷油工 C 油漆 D 装配工 — 套公式引用来源；被手填覆盖(ov)则保持静态值
  //   啤工=注塑Σ啤价(K)；喷油工=二次加工合计×0.7；油漆=×0.3；装配工=组装人工+包装人工
  const t3cell = (key, formula, result) => (ov[`t3.${key}`] || !formula) ? result : { formula, result };
  ws.getCell(row, 1).value = t3cell('injection_labor', subRefs.injShotSum || null, injectionLabor); ws.getCell(row, 1).numFmt = '0.0000';
  ws.getCell(row, 2).value = t3cell('painting_labor', subRefs.secondProc ? `${subRefs.secondProc}*0.7` : null, paintingLabor); ws.getCell(row, 2).numFmt = '0.0000';
  ws.getCell(row, 3).value = t3cell('paint_material', subRefs.secondProc ? `${subRefs.secondProc}*0.3` : null, paintMaterial); ws.getCell(row, 3).numFmt = '0.0000';
  ws.getCell(row, 4).value = t3cell('assembly_labor', asmRef, assemblyLabor); ws.getCell(row, 4).numFmt = '0.0000';
  // E 不含人工成本 = 表1(无货价)+表2(成本) + 啤工+喷油工+油漆
  const noLaborFormula = `${noLaborRefs.join('+')}+A${row}+B${row}+C${row}`;
  ws.getCell(row, 5).value = { formula: noLaborFormula, result: noLaborCost }; ws.getCell(row, 5).numFmt = '0.0000';
  // F 人工比例 = 装配工/货价
  ws.getCell(row, 6).value = { formula: `IFERROR(D${row}/${basePriceRef},0)`, result: basePrice ? assemblyLabor/basePrice : 0 }; ws.getCell(row, 6).numFmt = '0.00%';
  // G 毛利 = 货价 - 不含人工成本
  ws.getCell(row, 7).value = { formula: `${basePriceRef}-E${row}`, result: gross }; ws.getCell(row, 7).numFmt = '0.0000';
  // H 毛利率
  ws.getCell(row, 8).value = { formula: `IFERROR(G${row}/${basePriceRef},0)`, result: basePrice ? gross/basePrice : 0 }; ws.getCell(row, 8).numFmt = '0.00%';
  // I 利润 = 货价 - 总成本
  ws.getCell(row, 9).value = { formula: `${basePriceRef}-K${row}`, result: profit }; ws.getCell(row, 9).numFmt = '0.0000';
  // J 利润率
  ws.getCell(row, 10).value = { formula: `IFERROR(I${row}/${basePriceRef},0)`, result: basePrice ? profit/basePrice : 0 }; ws.getCell(row, 10).numFmt = '0.00%';
  // K 总成本 = 不含人工成本 + 装配工
  const totalCostFormula = `E${row}+D${row}`;
  ws.getCell(row, 11).value = { formula: totalCostFormula, result: totalCost }; ws.getCell(row, 11).numFmt = '0.0000';
  // 未减税前码数(表2) = 货价 / 总成本（总成本到这里才生成，回填前向引用公式）。
  const codeBeforeIdx = t2Cols.findIndex(c => c[1] === 'code_before') + 1;
  if (codeBeforeIdx) {
    const cell = ws.getCell(t2DataRow, codeBeforeIdx);
    cell.value = {
      formula: `IFERROR(${basePriceRef}/K${t3Row},0)`,
      result: totalCost > 0 ? basePrice / totalCost : 0,
    };
    cell.numFmt = '0.0000';
  }
  for (let c = 1; c <= 11; c++) styleData(ws.getCell(row, c));
  row += 2;

  // 表 4 减税明细（金额行 + 税率行）
  const t4 = ps.t4 || {};
  const t4Cols = [['含税13%类成本', 'tax13'], ['人工类13%', 'labor13'], ['纸箱类', 'carton'],
    ['含税1%', 'tax1'], ['搪胶类3%', 'slush3'], ['车发类13%', 'sewhair13'], ['车衣类13%', 'sewcloth13'],
    ['吸塑类6%', 'suction6'], ['运费类9%', 'freight9'], ['含税13%类', 'tax13b']];
  const T4_NO_RATE = new Set(['rmb_buy', 'tax13', 'labor13']);  // 参考列：无税率、不参与减税
  const sumCol = t4Cols.length + 1;      // 合计减税列 = 紧跟最后一个减税列（随列数自适应）
  const sumColL = colL(sumCol);
  ws.getCell(row, 1).value = '四、减税明细';
  ws.mergeCells(row, 1, row, 13);
  ws.getCell(row, 1).font = { bold: true, name: 'Microsoft YaHei' };
  row += 1;
  t4Cols.forEach((c, i) => { ws.getCell(row, i + 1).value = c[0]; styleHeader(ws.getCell(row, i + 1)); });
  ws.getCell(row, sumCol).value = '合计减税'; styleHeader(ws.getCell(row, sumCol));
  row += 1;
  const t4AmtRow = row;
  let totalDed = 0;
  const t4AmtVals = [];  // 各列实时金额，供"减税额"行 result
  // 各列金额公式（引用 t1/t2/t3 对应单元格）
  const tA = t1Addr, tB = t2Addr;
  const T3_INJ = `A${t3Row}`, T3_PNT = `B${t3Row}`, T3_PMAT = `C${t3Row}`, T3_ASM = `D${t3Row}`;
  const rmbBuyFormula =
    `${tA.dom_mat}+${tA.sewing_hair}+${tA.sewing_cloth}+${tA.hardware}+${tA.electronic}+${tA.motor}`
    + `+${tB.color_box}+${tB.battery}+${tB.libao}+${tB.plating}+${tB.other_buy}+${tB.carton}+${tB.misc}+${tA.glue_bag}+${T3_PMAT}`;
  const T4_FORMULA = {
    rmb_buy: rmbBuyFormula,
    tax13: `${tA.dom_mat}+${tA.hardware}+${tA.motor}+${tB.color_box}+${tB.battery}+${tB.libao}+${tB.other_buy}+${T3_PMAT}+${tA.glue_bag}`,
    labor13: `${T3_INJ}+${T3_PNT}+${T3_ASM}`,
    carton: tB.carton,
    tax1: tB.plating,
    slush3: tA.slush,
    sewhair13: tA.sewing_hair,
    sewcloth13: tA.sewing_cloth,
    suction6: tA.suction,
    freight9: tB.freight,
    tax13b: `${tA.dom_mat}+${tA.hardware}+${tA.motor}+${tB.color_box}+${tB.battery}+${tB.libao}+${tB.other_buy}+${T3_PMAT}+${tA.glue_bag}`,
  };
  t4Cols.forEach((c, i) => {
    const e = t4[c[1]] || { amt: 0, rate: 0 };
    const fml = T4_FORMULA[c[1]];
    // result 实时重算（引用 表1/表2 实时单元格），不用过期 ps
    const amtLive = fml ? liveResult(fml, num(e.amt)) : num(e.amt);
    t4AmtVals.push(amtLive);
    ws.getCell(row, i + 1).value = fml ? { formula: fml, result: amtLive } : amtLive;
    styleData(ws.getCell(row, i + 1));
    ws.getCell(row, i + 1).numFmt = '0.0000';
    if (!T4_NO_RATE.has(c[1])) totalDed += amtLive * num(e.rate) / 100;  // 参考列不计减税
  });
  row += 1;
  const t4RateRow = row;
  t4Cols.forEach((c, i) => {
    const e = t4[c[1]] || { amt: 0, rate: 0 };
    if (T4_NO_RATE.has(c[1])) { styleData(ws.getCell(row, i + 1)); return; }  // 参考列无税率
    ws.getCell(row, i + 1).value = num(e.rate) / 100;
    ws.getCell(row, i + 1).numFmt = '0.00%';
    styleData(ws.getCell(row, i + 1));
  });
  ws.getCell(row, sumCol).value = '税率 %';
  styleData(ws.getCell(row, sumCol));
  row += 1;
  // 减税额 = 金额 × 税率（逐项，引用上方金额行×税率行）
  const t4DedRow = row;
  const t4LastCol = colL(t4Cols.length);
  t4Cols.forEach((c, i) => {
    const e = t4[c[1]] || { amt: 0, rate: 0 };
    if (T4_NO_RATE.has(c[1])) { ws.getCell(row, i + 1).value = '—'; styleData(ws.getCell(row, i + 1)); return; }  // 参考列无减税额
    const col = colL(i + 1);
    ws.getCell(row, i + 1).value = { formula: `${col}${t4AmtRow}*${col}${t4RateRow}`, result: num(t4AmtVals[i]) * num(e.rate) / 100 };
    ws.getCell(row, i + 1).numFmt = '0.0000';
    styleData(ws.getCell(row, i + 1));
  });
  ws.getCell(row, sumCol).value = '减税额'; styleData(ws.getCell(row, sumCol));
  // 合计减税 = SUM(减税额 行)，放在 减税额行(最后一行) 合计减税列
  ws.getCell(t4DedRow, sumCol).value = { formula: `SUM(A${t4DedRow}:${t4LastCol}${t4DedRow})`, result: totalDed };
  ws.getCell(t4DedRow, sumCol).numFmt = '0.0000';
  styleSubtotal(ws.getCell(t4DedRow, sumCol), 'total');
  row += 2;

  // 减税后结果
  const totalDedRef = `${sumColL}${t4DedRow}`;  // 合计减税在减税额行(最后一行)
  const noLaborRefExpanded = `E${t3Row}`;    // 表3 不含人工成本 单元格
  const totalCostRefExpanded = `K${t3Row}`;  // 表3 总成本 单元格
  const afterCost = totalCost - totalDed;
  const afterGross = basePrice - (noLaborCost - totalDed);
  const afterProfit = afterGross - assemblyLabor;

  const summaryRows = [
    ['合计减税', { formula: totalDedRef, result: totalDed }, '0.0000'],
    ['减税后成本', { formula: `(${totalCostRefExpanded})-${totalDedRef}`, result: afterCost }, '0.0000'],
    ['减税后毛利', { formula: `${basePriceRef}-((${noLaborRefExpanded})-${totalDedRef})`, result: afterGross }, '0.0000'],
    ['减税后毛利率', { formula: `IFERROR((${basePriceRef}-((${noLaborRefExpanded})-${totalDedRef}))/${basePriceRef},0)`, result: basePrice ? afterGross/basePrice : 0 }, '0.00%'],
    ['减税后利润', { formula: `(${basePriceRef}-((${noLaborRefExpanded})-${totalDedRef}))-D${t3Row}`, result: afterProfit }, '0.0000'],
    ['减税后利润率', { formula: `IFERROR(((${basePriceRef}-((${noLaborRefExpanded})-${totalDedRef}))-D${t3Row})/${basePriceRef},0)`, result: basePrice ? afterProfit/basePrice : 0 }, '0.00%'],
  ];
  let afterCostRow = null;
  summaryRows.forEach(([k, v, fmt]) => {
    if (k === '减税后成本') afterCostRow = row;  // 减税后成本 值在 I 列
    ws.getCell(row, 1).value = k; ws.mergeCells(row, 1, row, 8);
    ws.getCell(row, 9).value = v; ws.mergeCells(row, 9, row, 13);
    ws.getCell(row, 9).numFmt = fmt;
    for (let cc = 1; cc <= 13; cc++) styleSubtotal(ws.getCell(row, cc), 'sub');
    row += 1;
  });
  row += 1;

  // 减税后码数(表2) = 货价 / 减税后成本（前向引用：减税后成本 此处才渲染完，回填公式）
  const codeAfterIdx = t2Cols.findIndex(c => c[1] === 'code_after') + 1;
  if (afterCostRow && codeAfterIdx && !ov['t2.code_after']) {
    const baseLive = cellVal(basePriceRef), afterLive = cellVal(`I${afterCostRow}`);
    const cell = ws.getCell(t2DataRow, codeAfterIdx);
    cell.value = { formula: `IFERROR(${basePriceRef}/I${afterCostRow},0)`, result: afterLive > 0 ? baseLive / afterLive : 0 };
    cell.numFmt = '0.0000';
  }
  return row;
}

// ============ 模具费用 (eng.mold_costs) ============
function renderMoldCosts(ws, row, mc, quote, refs, amortQty) {
  if (!mc) return row;
  const items = Array.isArray(mc.items) ? mc.items : [];
  const fx = num(mc.fx_rmb_usd) || 7.75;
  const prototypeFeeUsd = num(mc.prototype_fee_usd ?? mc.prototype_fee_rmb);
  const testingFeeUsd = num(mc.testing_fee_usd ?? mc.testing_fee_rmb);
  if (!items.length && prototypeFeeUsd <= 0 && testingFeeUsd <= 0) return row;
  const prototypeAmortQty = Math.max(num(mc.prototype_amortization_qty) || 50000, 1);
  const testingAmortQty = Math.max(num(mc.testing_amortization_qty) || 2000, 1);
  ws.mergeCells(row, 1, row, 13); styleSection(ws.getCell(row, 1));
  ws.getCell(row, 1).value = '生产模具费用';
  row += 1;
  // 表头
  const h = ['模具名称', '', '', '', '', '', '', '', '', '', '模价 (RMB)', '', '模价 (USD)'];
  h.forEach((v, i) => { ws.getCell(row, i + 1).value = v; styleHeader(ws.getCell(row, i + 1)); });
  ws.mergeCells(row, 1, row, 10);
  ws.mergeCells(row, 11, row, 12);
  row += 1;
  const dataStart = row;
  items.forEach(r => {
    ws.mergeCells(row, 1, row, 10);
    ws.getCell(row, 1).value = r.name || '';
    ws.mergeCells(row, 11, row, 12);
    ws.getCell(row, 11).value = num(r.price_rmb);
    ws.getCell(row, 11).numFmt = RMB;
    ws.getCell(row, 13).value = { formula: `K${row}/0.85/${fx}`, result: num(r.price_rmb) / 0.85 / fx };
    ws.getCell(row, 13).numFmt = '"$"#,##0.0000';
    for (let c = 1; c <= 13; c++) styleData(ws.getCell(row, c));
    ws.getCell(row, 1).alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
    row += 1;
  });
  const dataEnd = row - 1;
  const sumRmb = sum(items, r => num(r.price_rmb));
  // 模具总计
  ws.mergeCells(row, 1, row, 10);
  ws.getCell(row, 1).value = '模具总计';
  ws.getCell(row, 1).alignment = { horizontal: 'right', vertical: 'middle' };
  ws.mergeCells(row, 11, row, 12);
  ws.getCell(row, 11).value = items.length
    ? { formula: `SUM(K${dataStart}:K${dataEnd})`, result: sumRmb }
    : 0;
  ws.getCell(row, 11).numFmt = RMB;
  ws.getCell(row, 13).value = { formula: `K${row}/0.85/${fx}`, result: sumRmb / 0.85 / fx };
  ws.getCell(row, 13).numFmt = '"$"#,##0.0000';
  for (let c = 1; c <= 13; c++) styleSubtotal(ws.getCell(row, c), 'sub');
  ws.getRow(row).font = { bold: true, color: { argb: 'FF1F2937' }, name: 'Microsoft YaHei' };
  const totalRow = row;
  row += 1;
  // 客补贴模费美金
  ws.mergeCells(row, 1, row, 10);
  ws.getCell(row, 1).value = '客补贴模费美金';
  ws.getCell(row, 1).alignment = { horizontal: 'right', vertical: 'middle' };
  ws.mergeCells(row, 11, row, 12);
  ws.getCell(row, 11).value = '';
  ws.getCell(row, 13).value = num(mc.customer_subsidy_usd);
  ws.getCell(row, 13).numFmt = '"$"#,##0.0000';
  for (let c = 1; c <= 13; c++) styleData(ws.getCell(row, c));
  const subsidyRow = row;
  row += 1;
  // 模费按 N 套产品分摊（qty 与 九、合计 模具分摊 同源）
  const qty = Math.max(num(amortQty) || num(mc.amortization_qty), 1);
  ws.mergeCells(row, 1, row, 10);
  ws.getCell(row, 1).value = `模费按 ${qty} 套产品分摊`;
  ws.getCell(row, 1).alignment = { horizontal: 'right', vertical: 'middle' };
  ws.mergeCells(row, 11, row, 12);
  ws.getCell(row, 11).value = { formula: `K${totalRow}/${qty}`, result: sumRmb / qty };
  ws.getCell(row, 11).numFmt = RMB;
  ws.getCell(row, 13).value = { formula: `(M${totalRow}-M${subsidyRow})/${qty}`, result: (sumRmb / 0.85 / fx - num(mc.customer_subsidy_usd)) / qty };
  ws.getCell(row, 13).numFmt = '"$"#,##0.0000';
  for (let c = 1; c <= 13; c++) styleSubtotal(ws.getCell(row, c), 'total');
  ws.getRow(row).font = { bold: true, color: { argb: 'FF1F2937' }, name: 'Microsoft YaHei' };
  const moldShareRow = row;
  if (refs) refs.moldShareRmbCell = `K${moldShareRow}`;
  if (refs) refs.moldShareUsdCell = `M${moldShareRow}`;
  row += 1;

  const appendExtraShare = (label, totalUsd, shareQty) => {
    ws.mergeCells(row, 1, row, 10);
    ws.getCell(row, 1).value = `${label}（总额 USD ${totalUsd}，按 ${shareQty} 套分摊）`;
    ws.getCell(row, 1).alignment = { horizontal: 'right', vertical: 'middle' };
    ws.mergeCells(row, 11, row, 12);
    ws.getCell(row, 11).value = { formula: `${totalUsd}*${fx}*0.85/${shareQty}`, result: totalUsd * fx * 0.85 / shareQty };
    ws.getCell(row, 11).numFmt = RMB;
    ws.getCell(row, 13).value = { formula: `${totalUsd}/${shareQty}`, result: totalUsd / shareQty };
    ws.getCell(row, 13).numFmt = '"$"#,##0.0000';
    for (let c = 1; c <= 13; c++) styleData(ws.getCell(row, c));
    return row++;
  };
  const prototypeShareRow = appendExtraShare('手板费分摊', prototypeFeeUsd, prototypeAmortQty);
  const testingShareRow = appendExtraShare('测试费分摊', testingFeeUsd, testingAmortQty);
  if (refs) refs.prototypeShareRmbCell = `K${prototypeShareRow}`;
  if (refs) refs.prototypeShareUsdCell = `M${prototypeShareRow}`;
  if (refs) refs.testingShareRmbCell = `K${testingShareRow}`;
  if (refs) refs.testingShareUsdCell = `M${testingShareRow}`;
  row += 1;
  return row;
}

module.exports = { buildWorkbook };
