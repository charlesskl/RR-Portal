/**
 * 兴信 ZURU 大陆发票新模板（兴信-zuru sheet）生成器。
 * 与 sheetBuilder.js 同套路的字符串手术：以模板 sheet 为底，重写内容、保留格式。
 *
 * 模板布局（public/zuru-tpl/兴信-zuru.xlsx，打印区域 A1:I44）：
 *   H9:I10 = INVOICE NO. 合并格 = 发票号码（2026-10-20 文员口径：票号只在这里显示；
 *     模板自带的样张值 26403 必须替换掉，不能保留）
 *   H11  = 留空（「发票号码」中文标签行不写值；写值会用 s=3 的 General 数字格式在窄列里显示成 ####）
 *   G13  = 开票日期（序列号，样式已是日期格式，合并 G13:H13）
 *   A14  = 买方 ROYAL REGENT PRODUCTS(ASIA)LIMITED（固定模板）
 *   行 19-43 = 数据区（25 行/页）：行19 首行样式、20-42 中间行、43 末行底边框
 *   行 44 = TOTAL（A44:G44 合并，H44='USD'，I44 合计）
 *   行 45-68 = 尾部空框（随 TOTAL 下移）
 * 数据行：A=PO（仅首行）、C=货号（code；无码扣款行 C 留空不写描述——母版旧票惯例，
 *   见 97887；无码且单价为 0 的扣款行只显示数量，与纯数量行相同，见 97841。
 *   2026-10-20 文员口径，此前误用 desc 导致长描述被截断）、D=数量、E='PCS'、F='USD'、
 *   G==K*0.967、H='USD'、I==G*D、K=原单价（打印区域外）。
 */

import {
  parseRows, rowXml, styleOf, dateToSerial, colToIdx, cellXml,
} from './sheetBuilder.js';

const { cNum, cStr, cEmpty, cFormula } = cellXml;

/** 单元格改行号（行内容不变）：r="X{old}" → r="X{new}" */
const rebaseCell = (xml, newR) =>
  xml.replace(/\br="([A-Z]+)(\d+)"/, (mm, col) => `r="${col}${newR}"`);

const DATA_TOP = 19;       // 数据区首行
const DATA_BOTTOM = 43;    // 数据区末行（带底边框）
const TOTAL_ROW = 44;      // 模板 TOTAL 行
const TAIL_BOTTOM = 68;    // 尾部最后一行

export class ZuruSheetBuilder {
  /** @param parts 模板 sheet 的原始部件（来自 XlsxPackage.getTemplateParts('兴信-zuru')） */
  constructor(parts) {
    const xml = parts.sheetXml;
    const sdStart = xml.indexOf('<sheetData');
    const sdTagEnd = xml.indexOf('>', sdStart) + 1;
    const sdEnd = xml.indexOf('</sheetData>');
    this.prefix = xml.slice(0, sdTagEnd);
    this.suffix = xml.slice(sdEnd);
    this.rows = new Map();
    for (const row of parseRows(xml.slice(sdTagEnd, sdEnd))) this.rows.set(row.r, row);

    // —— 样式样板 ——
    this.rowFirst = this.rows.get(DATA_TOP);        // 行19：首行
    this.rowMid = this.rows.get(22);                // 行22：中间行（超模板时插入行用它）
    this.rowLast = this.rows.get(DATA_BOTTOM);      // 行43：末行底边框
    this.rowTotal = this.rows.get(TOTAL_ROW);       // 行44：TOTAL
    const cell = (row, col) => (row ? row.cells.get(colToIdx(col)) : null);
    this.kStyle = styleOf(cell(this.rowFirst, 'K'));      // 原单价列样式（K19）
    this.invNoStyle = styleOf(cell(this.rows.get(11), 'H'));
    this.h9Style = styleOf(cell(this.rows.get(9), 'H'));  // INVOICE NO 合并格（H9:I10）样式
    this.dateStyle = styleOf(cell(this.rows.get(13), 'G'));
    // C19:C20 是样张描述的跨行合并格（生成时删除），其样式带 wrapText 会给长描述造成叠字；
    // 数据行 C（货号列）样式用 E 列 PCS 格同款：Times 12 非加粗居中、右边框——与文员手工样板一致
    this.cGoodsStyle = styleOf(cell(this.rowMid, 'E')) || styleOf(cell(this.rowMid, 'C'));
  }

  /** 数据行 i（绝对行 r）的样式来源行：首行/中间行/末行底边框，超模板部分用行22 */
  styleSrcRow(i, r, n) {
    if (r < DATA_BOTTOM) return this.rows.get(r) || this.rowMid;      // 19-42 按绝对行
    if (r === DATA_BOTTOM && DATA_TOP + n - 1 <= DATA_BOTTOM) return this.rows.get(r);  // 未超模板，43 原样
    return i === n - 1 ? this.rowLast : this.rowMid;                  // 超模板：末行底边框，其余行22
  }

  /**
   * 生成一张 sheet 的 XML。
   * @param inv 解析后的发票
   * @param totalValue 合计值；null = 留空（多段发票的非最后一段）
   */
  build(inv, totalValue) {
    const n = inv.lines.length;
    const totalRow = Math.max(TOTAL_ROW, DATA_TOP + n);
    const shift = totalRow - TOTAL_ROW;
    const lastRow = TAIL_BOTTOM + shift;

    const out = [];

    // —— 行 1-18：原样保留，替换 H9（INVOICE NO 合并格 = 发票号）、清空 H11、G13（日期）——
    for (let r = 1; r < DATA_TOP; r++) {
      const row = this.rows.get(r);
      if (!row) continue;
      const cells = new Map(row.cells);
      if (r === 9) {
        cells.set(8, inv.invNoIsNumber
          ? cNum('H', 9, this.h9Style, inv.invNo)
          : cStr('H', 9, this.h9Style, String(inv.invNo)));
      }
      if (r === 11) cells.set(8, cEmpty('H', 11, this.invNoStyle));
      if (r === 13 && inv.date) {
        cells.set(7, cNum('G', 13, this.dateStyle, dateToSerial(inv.date)));
      }
      out.push(rowXml(r, row.attrs, cells));
    }

    // —— 数据区：行 19 起 ——
    for (let i = 0; i < n; i++) {
      const r = DATA_TOP + i;
      const ln = inv.lines[i];
      const src = this.styleSrcRow(i, r, n);
      const stRaw = (col) => styleOf(src.cells.get(colToIdx(col)));
      // C 列（货号）数据行统一用 cGoodsStyle（Times 12 非加粗居中，同文员样板）；
      // 模板自带的样张跨行格样式（wrapText）与 bold 13 数据样式都不再用
      const st = (col) => (col === 'C' ? this.cGoodsStyle : stRaw(col));
      const cells = new Map();
      // L 列及以后（备注/边框收尾）按样式来源行克隆
      for (const [ci, x] of src.cells) {
        if (ci >= 12) cells.set(ci, rebaseCell(x, r));
      }
      const first = i === 0;
      // 无码且单价为 0 的扣款行（Instruction sheet MOQ 等）：母版旧票只显示数量（97841）
      const qtyOnly = ln.kind === 'qty'
        || ((ln.code === null || ln.code === undefined) && ln.kind !== 'fee' && ln.unit === 0);
      if (qtyOnly) {
        // 纯数量行：D=qty、E='PCS'，其余空
        cells.set(1, cEmpty('A', r, st('A')));
        cells.set(2, cEmpty('B', r, st('B')));
        cells.set(3, cEmpty('C', r, st('C')));
        cells.set(4, cNum('D', r, st('D'), ln.qty));
        cells.set(5, cStr('E', r, st('E'), 'PCS'));
        cells.set(6, cEmpty('F', r, st('F')));
        cells.set(7, cEmpty('G', r, st('G')));
        cells.set(8, cEmpty('H', r, st('H')));
        cells.set(9, cEmpty('I', r, st('I')));
        cells.set(11, cEmpty('K', r, this.kStyle));
      } else if (ln.kind === 'fee') {
        // 费用行：C=费用说明、H='USD'、I==K*0.967、K=金额
        cells.set(1, first ? cStr('A', r, st('A'), inv.po) : cEmpty('A', r, st('A')));
        cells.set(2, cEmpty('B', r, st('B')));
        cells.set(3, cStr('C', r, st('C'), String(ln.code ?? '')));
        cells.set(4, cEmpty('D', r, st('D')));
        cells.set(5, cEmpty('E', r, st('E')));
        cells.set(6, cEmpty('F', r, st('F')));
        cells.set(7, cEmpty('G', r, st('G')));
        cells.set(8, cStr('H', r, st('H'), 'USD'));
        cells.set(9, cFormula('I', r, st('I'), `K${r}*0.967`, ln.unit * 0.967));
        cells.set(11, cNum('K', r, this.kStyle, ln.unit));
      } else {
        // 明细/MA 行：C=货号（code）；无码扣款行 C 留空，不写描述（母版旧票惯例，97887）
        const g = ln.unit * 0.967;
        cells.set(1, first ? cStr('A', r, st('A'), inv.po) : cEmpty('A', r, st('A')));
        cells.set(2, cEmpty('B', r, st('B')));
        cells.set(3, ln.code === null || ln.code === undefined
          ? cEmpty('C', r, st('C'))
          : typeof ln.code === 'number'
            ? cNum('C', r, st('C'), ln.code)
            : cStr('C', r, st('C'), String(ln.code)));
        cells.set(4, cNum('D', r, st('D'), ln.qty));
        cells.set(5, cStr('E', r, st('E'), 'PCS'));
        cells.set(6, cStr('F', r, st('F'), 'USD'));
        cells.set(7, cFormula('G', r, st('G'), `K${r}*0.967`, g));
        cells.set(8, cStr('H', r, st('H'), 'USD'));
        cells.set(9, cFormula('I', r, st('I'), `G${r}*D${r}`, g * ln.qty));
        cells.set(11, cNum('K', r, this.kStyle, ln.unit));
      }
      out.push(rowXml(r, src.attrs, cells));
    }

    // —— 数据区剩余的空行（模板原样，本来就是空框）——
    for (let r = DATA_TOP + n; r <= DATA_BOTTOM; r++) {
      const row = this.rows.get(r);
      if (!row) continue;
      out.push(rowXml(r, row.attrs, new Map(row.cells)));
    }

    // —— TOTAL 行（模板 44 行）：A:G 合并的 'TOTAL'、H='USD'、I=合计值 ——
    {
      const cells = new Map();
      for (const [ci, x] of this.rowTotal.cells) cells.set(ci, rebaseCell(x, totalRow));
      const iStyle = styleOf(this.rowTotal.cells.get(9));
      if (totalValue !== null && totalValue !== undefined)
        cells.set(9, cNum('I', totalRow, iStyle, Math.trunc((totalValue + 1e-9) * 100) / 100));
      else
        cells.set(9, cEmpty('I', totalRow, iStyle));
      out.push(rowXml(totalRow, this.rowTotal.attrs, cells));
    }

    // —— 尾部空框 45-68：随 TOTAL 整体下移 ——
    for (let r = TOTAL_ROW + 1; r <= TAIL_BOTTOM; r++) {
      const row = this.rows.get(r);
      if (!row) continue;
      const nr = r + shift;
      const cells = new Map();
      for (const [ci, x] of row.cells) cells.set(ci, rebaseCell(x, nr));
      out.push(rowXml(nr, row.attrs, cells));
    }

    // —— 前缀修正：dimension / tabSelected ——
    const prefix = this.prefix
      .replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:R${lastRow}"/>`)
      .replace(/tabSelected="true"/, 'tabSelected="false"');

    // —— 后缀修正：mergeCells（≤18 行保留、删 C19:C20、A44:G44 随 TOTAL 移位、尾部 merge 统一下移）——
    const merges = [];
    for (const m of this.suffix.matchAll(/<mergeCell ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"\/>/g)) {
      const [, c1, r1s, c2, r2s] = m;
      const r1 = +r1s, r2 = +r2s;
      if (r2 < DATA_TOP) merges.push(m[0]);                                   // 头部合并原样
      else if (r1 > TOTAL_ROW) merges.push(`<mergeCell ref="${c1}${r1 + shift}:${c2}${r2 + shift}"/>`);  // 尾部下移
      else if (r1 === TOTAL_ROW && r2 === TOTAL_ROW) merges.push(`<mergeCell ref="${c1}${totalRow}:${c2}${totalRow}"/>`);  // A44:G44 → TOTAL 行
      // 落在数据区 19-43 的合并（C19:C20 样张描述跨行）丢弃
    }
    const suffix = this.suffix.replace(
      /<mergeCells\b[^>]*>[\s\S]*?<\/mergeCells>/,
      `<mergeCells count="${merges.length}">${merges.join('')}</mergeCells>`);

    return prefix + out.join('') + suffix;
  }
}
