/**
 * sheet 生成器：以母版里的一张已做好 sheet（默认 98631）为模版，
 * 把解析出的发票数据填进去，保留全部格式 / 页眉合并 / 批注 / 打印设置。
 * 字符串手术（不用 DOMParser），浏览器 / Node 通用。
 */

export const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const colToIdx = (col) => {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
};
export const idxToCol = (n) => {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - 1 - m) / 26; }
  return s;
};

/** Excel 日期序列号（1899-12-30 起）；直接从 UTC 毫秒换算，避免时区漂移 */
export function dateToSerial(d) {
  return Math.round(d.getTime() / 86400000 + 25569);
}

const cNum = (col, r, s, v) => `<c r="${col}${r}" s="${s}" t="n"><v>${v}</v></c>`;
const cStr = (col, r, s, text) => `<c r="${col}${r}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(text)}</t></is></c>`;
const cEmpty = (col, r, s) => `<c r="${col}${r}" s="${s}"/>`;
const cFormula = (col, r, s, f, v) =>
  `<c r="${col}${r}" s="${s}" t="n"><f aca="false">${esc(f)}</f><v>${v}</v></c>`;

export const cellXml = { cNum, cStr, cEmpty, cFormula };

/** 把 sheetData 里的行解析成 { r, attrs, cells: Map<colIdx, xml> } */
export function parseRows(sheetDataXml) {
  const rows = [];
  const re = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
  let m;
  while ((m = re.exec(sheetDataXml))) {
    const attrsRaw = m[1] || '';
    const body = m[2] || '';
    const rm = attrsRaw.match(/\br="(\d+)"/);
    if (!rm) continue;
    const attrs = attrsRaw.replace(/\br="\d+"/, '');  // r 由 rowXml 单独生成，避免重复属性
    const cells = new Map();
    const cre = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm;
    while ((cm = cre.exec(body))) {
      const full = cm[0];
      const refm = cm[1].match(/\br="([A-Z]+)(\d+)"/);
      if (!refm) continue;
      cells.set(colToIdx(refm[1]), full);
    }
    rows.push({ r: +rm[1], attrs, cells });
  }
  return rows;
}

export function rowXml(r, attrs, cells) {
  const sorted = [...cells.entries()].sort((a, b) => a[0] - b[0]);
  return `<row r="${r}"${attrs}>${sorted.map(([, x]) => x).join('')}</row>`;
}

/** 单元格改行号（行内容不变）：r="X{old}" → r="X{new}" */
function rebaseCell(cellXml, newR) {
  return cellXml.replace(/\br="([A-Z]+)(\d+)"/, (mm, col) => `r="${col}${newR}"`);
}

/** 提取单元格样式 id */
export const styleOf = (cellXml) => {
  const m = cellXml ? String(cellXml).match(/\bs="(\d+)"/) : null;
  return m ? +m[1] : 0;
};

export class SheetBuilder {
  /** @param parts 模版 sheet 的原始部件（来自 XlsxPackage.getTemplateParts） */
  constructor(parts) {
    const xml = parts.sheetXml;
    const sdStart = xml.indexOf('<sheetData');
    const sdTagEnd = xml.indexOf('>', sdStart) + 1;
    const sdEnd = xml.indexOf('</sheetData>');
    this.prefix = xml.slice(0, sdTagEnd);
    this.suffix = xml.slice(sdEnd);
    this.rows = new Map();
    for (const row of parseRows(xml.slice(sdTagEnd, sdEnd))) this.rows.set(row.r, row);
    this.commentsXml = parts.commentsXml;
    this.vmlXml = parts.vmlXml;

    // —— 从模版提取样式样板 ——
    const r24 = this.rows.get(24);            // 首行（带 PO 单元格）
    const r26 = this.rows.get(26);            // 普通明细行
    const r27 = this.rows.get(27);            // 纯数量行
    const r28 = this.rows.get(28);            // 空白备用行
    const cell = (row, col) => (row ? row.cells.get(colToIdx(col)) : null);
    this.st = {
      firstA: styleOf(cell(r24, 'A')),
      lineA: styleOf(cell(r26, 'A')),
      firstB: styleOf(cell(r24, 'B')),
      lineB: styleOf(cell(r26, 'B')),
      cNum: styleOf(cell(r24, 'C')),
      cText: styleOf(cell(r26, 'C')),
      d: styleOf(cell(r24, 'D')),
      e: styleOf(cell(r24, 'E')),
      f: styleOf(cell(r24, 'F')),
      g: styleOf(cell(r24, 'G')),
      h: styleOf(cell(r24, 'H')),
      i: styleOf(cell(r24, 'I')),
      j: styleOf(cell(r24, 'J')),
      k: styleOf(cell(r24, 'K')),
      l: styleOf(cell(r24, 'L')),
      m: styleOf(cell(r24, 'M')),
    };
    this.qtySt = {};
    for (const col of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'])
      this.qtySt[col] = styleOf(cell(r27, col));
    this.spareSt = {};
    for (const col of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'])
      this.spareSt[col] = styleOf(cell(r28, col));
    this.totalRow48 = this.rows.get(48);
    this.hiddenRow49 = this.rows.get(49);
    this.lineAttrs = r26 ? r26.attrs : '';
  }

  /**
   * 生成一张 sheet 的 XML。
   * @param inv 解析后的发票
   * @param totalValue I48 合计值；null = 留空（多段发票的非最后一段）
   */
  build(inv, totalValue) {
    const n = inv.lines.length;                       // 数据行数（含纯数量行）
    const totalRow = Math.max(48, 24 + n);
    const shift = totalRow - 48;
    const lastRow = 59 + shift;

    const out = [];

    // —— 行 1-23：原样保留，替换 H10（发票号）、H15（日期）——
    for (let r = 1; r <= 23; r++) {
      const row = this.rows.get(r);
      if (!row) continue;
      const cells = new Map(row.cells);
      if (r === 10) {
        const old = cells.get(8);
        const s = old ? styleOf(old) : 0;
        cells.set(8, inv.invNoIsNumber
          ? cNum('H', 10, s, inv.invNo)
          : cStr('H', 10, s, String(inv.invNo)));
      }
      if (r === 15 && inv.date) {
        const old = cells.get(8);
        const s = old ? styleOf(old) : 0;
        cells.set(8, cNum('H', 15, s, dateToSerial(inv.date)));
      }
      out.push(rowXml(r, row.attrs, cells));
    }

    // —— 行 24 起：数据区 ——
    for (let i = 0; i < n; i++) {
      const r = 24 + i;
      const ln = inv.lines[i];
      const tpl = this.rows.get(r);                  // 该绝对行上的模版行（可能有 Q/N 等备注）
      const tplIsDataZone = tpl && tpl.r <= 47;      // 48 行起是合计/隐藏/尾行，属性（隐藏行等）不能继承
      const cells = new Map();
      // 先保留模版行 L 列以后（备注类）单元格；行数超模版时改写 =I48 公式指向新合计行
      if (tpl) for (const [ci, x] of tpl.cells) {
        if (ci < 12) continue;
        let nx = x;
        if (shift > 0 && nx.includes('<f') && nx.includes('I48')) nx = nx.replace(/I48/g, `I${totalRow}`);
        cells.set(ci, nx);
      }
      if (ln.kind === 'qty') {
        const q = this.qtySt;
        cells.set(1, cEmpty('A', r, q.A)); cells.set(2, cEmpty('B', r, q.B));
        cells.set(3, cEmpty('C', r, q.C)); cells.set(4, cNum('D', r, q.D, ln.qty));
        cells.set(5, cStr('E', r, q.E, 'PCS'));
        cells.set(6, cEmpty('F', r, q.F)); cells.set(7, cEmpty('G', r, q.G));
        cells.set(8, cEmpty('H', r, q.H)); cells.set(9, cEmpty('I', r, q.I));
        cells.set(10, cEmpty('J', r, q.J)); cells.set(11, cEmpty('K', r, q.K));
        if (!cells.has(12)) cells.set(12, cEmpty('L', r, q.L));
        if (!cells.has(13)) cells.set(13, cEmpty('M', r, q.M));
      } else if (ln.kind === 'fee') {
        // 费用行（收取此单…费）：C=说明文字、H=USD、I==K*0.967、K=金额，沿用母版惯例
        const first = i === 0;
        const st = this.st;
        cells.set(1, first ? cStr('A', r, st.firstA, inv.po) : cEmpty('A', r, st.lineA));
        cells.set(2, cEmpty('B', r, first ? st.firstB : st.lineB));
        cells.set(3, cStr('C', r, st.cText, String(ln.code ?? '')));
        cells.set(4, cEmpty('D', r, st.d));
        cells.set(5, cEmpty('E', r, st.e));
        cells.set(6, cEmpty('F', r, st.f));
        cells.set(7, cEmpty('G', r, st.g));
        cells.set(8, cStr('H', r, st.h, 'USD'));
        cells.set(9, cFormula('I', r, st.i, `K${r}*0.967`, ln.unit * 0.967));
        cells.set(10, cNum('J', r, st.j, 1));
        cells.set(11, cNum('K', r, st.k, ln.unit));
        if (!cells.has(12)) cells.set(12, cEmpty('L', r, st.l));
        if (!cells.has(13)) cells.set(13, cEmpty('M', r, st.m));
      } else {
        const first = i === 0;
        const st = this.st;
        cells.set(1, first ? cStr('A', r, st.firstA, inv.po) : cEmpty('A', r, st.lineA));
        cells.set(2, cEmpty('B', r, first ? st.firstB : st.lineB));
        cells.set(3, ln.code === null || ln.code === undefined
          ? cEmpty('C', r, st.cText)
          : typeof ln.code === 'number'
            ? cNum('C', r, st.cNum, ln.code)
            : cStr('C', r, st.cText, String(ln.code)));
        cells.set(4, cNum('D', r, st.d, ln.qty));
        cells.set(5, cStr('E', r, st.e, 'PCS'));
        cells.set(6, cStr('F', r, st.f, 'USD'));
        const g = ln.unit * 0.967;
        cells.set(7, cFormula('G', r, st.g, `K${r}*0.967`, g));
        cells.set(8, cStr('H', r, st.h, 'USD'));
        cells.set(9, cFormula('I', r, st.i, `G${r}*D${r}`, g * ln.qty));
        cells.set(10, cNum('J', r, st.j, 1));
        cells.set(11, cNum('K', r, st.k, ln.unit));
        if (!cells.has(12)) cells.set(12, cEmpty('L', r, st.l));
        if (!cells.has(13)) cells.set(13, cEmpty('M', r, st.m));
      }
      const attrs = tplIsDataZone ? tpl.attrs : this.lineAttrs;
      out.push(rowXml(r, attrs, cells));
    }

    // —— 数据区剩余的空行（模版原样，A-K 清空防残留）——
    for (let r = 24 + n; r <= Math.min(47, lastRow) && r <= 47; r++) {
      const tpl = this.rows.get(r);
      if (!tpl) continue;
      const cells = new Map();
      for (const [ci, x] of tpl.cells) {
        if (ci >= 12) { cells.set(ci, x); continue; }  // L 列及以后原样（含 L39/L42/L43 公式、N/Q/W 备注）
        const col = idxToCol(ci);
        cells.set(ci, cEmpty(col, r, this.spareSt[col] ?? styleOf(x)));
      }
      // L43 的 =I48 公式在行数超模版时改指新合计行
      if (shift > 0 && cells.has(12)) {
        const l = cells.get(12);
        if (l.includes('<f') && l.includes('I48'))
          cells.set(12, l.replace(/I48/g, `I${totalRow}`));
      }
      out.push(rowXml(r, tpl.attrs, cells));
    }

    // —— 合计行（模版 48 行）——
    {
      const tpl = this.totalRow48;
      const cells = new Map();
      for (const [ci, x] of tpl.cells) cells.set(ci, rebaseCell(x, totalRow));
      // I 列：合计值或留空
      const iCell = cells.get(9);
      const iStyle = iCell ? styleOf(iCell) : 82;
      if (totalValue !== null && totalValue !== undefined)
        cells.set(9, cNum('I', totalRow, iStyle, Math.trunc((totalValue + 1e-9) * 100) / 100));
      else
        cells.set(9, cEmpty('I', totalRow, iStyle));
      out.push(rowXml(totalRow, tpl.attrs, cells));
    }

    // —— 隐藏行 49（SUM 校验行）+ 尾部 50-59 ——
    for (let r = 49; r <= 59; r++) {
      const tpl = this.rows.get(r);
      if (!tpl) continue;
      const nr = r + shift;
      const cells = new Map();
      for (const [ci, x] of tpl.cells) {
        let nx = rebaseCell(x, nr);
        if (shift > 0 && nx.includes('<f')) nx = nx.replace(/I48/g, `I${totalRow}`);
        cells.set(ci, nx);
      }
      out.push(rowXml(nr, tpl.attrs, cells));
    }

    // —— 前缀修正：dimension / tabSelected ——
    let prefix = this.prefix
      .replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A3:IW${lastRow}"/>`)
      .replace(/tabSelected="true"/, 'tabSelected="false"');

    return prefix + out.join('') + this.suffix;
  }
}
