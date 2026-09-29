// Read original borders separately: SheetJS CE discards BIFF cell border styles.
// This extractor never evaluates or changes worksheet values/formulas.
const fs = require('node:fs');
const XLSX = require('xlsx');
const { XMLParser } = require('fast-xml-parser');
const names = ['', 'thin', 'medium', 'dashed', 'dotted', 'thick', 'double', 'hair',
  'mediumDashed', 'dashDot', 'mediumDashDot', 'dashDotDot', 'mediumDashDotDot', 'slantDashDot'];
const defaults = ['000000','FFFFFF','FF0000','00FF00','0000FF','FFFF00','FF00FF','00FFFF',
  '000000','FFFFFF','FF0000','00FF00','0000FF','FFFF00','FF00FF','00FFFF','800000','008000','000080','808000','800080','008080','C0C0C0','808080',
  '9999FF','993366','FFFFCC','CCFFFF','660066','FF8080','0066CC','CCCCFF','000080','FF00FF','FFFF00','00FFFF','800080','800000','008080','0000FF',
  '00CCFF','CCFFFF','CCFFCC','FFFF99','99CCFF','FF99CC','CC99FF','FFCC99','3366FF','33CCCC','99CC00','FFCC00','FF9900','FF6600','666699','969696',
  '003366','339966','003300','333300','993300','993366','333399','333333'];

function biffBorders(bytes) {
  const styles = [], directory = [], palette = [...defaults];
  function records(start, consume) {
    let depth = 0;
    for (let p = start; p + 4 <= bytes.length;) {
      const id = bytes.readUInt16LE(p), length = bytes.readUInt16LE(p + 2), end = p + 4 + length;
      if (end > bytes.length) throw new Error('原表边框记录不完整');
      const b = bytes.subarray(p + 4, end);
      if (id === 0x0809) depth++;
      consume(id, b, depth); p = end;
      if (id === 0x000a && --depth <= 0) break;
    }
  }
  records(0, (id, b) => {
    if (id === 0x0809 && b.readUInt16LE(0) !== 0x0600) throw new Error('暂不支持此旧版 XLS 边框格式');
    if (id === 0x0085 && b[5] === 0) directory.push({ offset: b.readUInt32LE(0), name: b.subarray(8, 8 + b[6] * ((b[7] & 1) ? 2 : 1)).toString((b[7] & 1) ? 'utf16le' : 'latin1') });
    if (id === 0x00e0) {
      if (b.length !== 20) throw new Error('不支持的 XLS XF 格式');
      const a = b.readUInt32LE(10), c = b.readUInt32LE(14);
      styles.push({ left: [a & 15, (a >>> 16) & 127], right: [(a >>> 4) & 15, (a >>> 23) & 127],
        top: [(a >>> 8) & 15, c & 127], bottom: [(a >>> 12) & 15, (c >>> 7) & 127] });
    }
    if (id === 0x0092) for (let i = 0; i < b.readUInt16LE(0); i++) palette[i + 8] = b.subarray(2 + i * 4, 5 + i * 4).toString('hex').toUpperCase();
  });
  const borders = {};
  const single = new Set([0x0203, 0x0205, 0x027e, 0x0006, 0x0206, 0x0406, 0x00fd, 0x0201, 0x00d6, 0x0204]);
  for (const sheet of directory) {
    const cells = borders[sheet.name] = {};
    const put = (r, c, xf) => {
      const border = {};
      for (const [side, [style, color]] of Object.entries(styles[xf] || {})) {
        if (style && names[style]) border[side] = { style: names[style], color: '#' + (palette[color] || '000000') };
      }
      if (Object.keys(border).length) cells[XLSX.utils.encode_cell({r,c})] = border;
    };
    records(sheet.offset, (id, b, depth) => {
      if (depth > 1) return; // Ignore embedded chart cell records.
      if (single.has(id) && b.length >= 6) put(b.readUInt16LE(0), b.readUInt16LE(2), b.readUInt16LE(4));
      if (id === 0x00bd || id === 0x00be) {
        const r = b.readUInt16LE(0), first = b.readUInt16LE(2), last = b.readUInt16LE(b.length - 2), stride = id === 0x00bd ? 6 : 2;
        for (let c = first; c <= last; c++) put(r, c, b.readUInt16LE(4 + (c - first) * stride));
      }
    });
  }
  return borders;
}

function readWorkbookBorders(file) {
  const bytes = fs.readFileSync(file), container = XLSX.CFB.read(bytes, {type:'buffer'});
  const stream = XLSX.CFB.find(container, '/Workbook') || XLSX.CFB.find(container, '/Book');
  if (stream) return biffBorders(Buffer.from(stream.content));
  // A worksheet name may legally end in a space; trimming it detaches its
  // borders from the corresponding SheetJS worksheet.
  const parser = new XMLParser({ignoreAttributes:false,attributeNamePrefix:'',trimValues:false});
  const xml = name => { const entry = XLSX.CFB.find(container, '/' + name); return entry ? parser.parse(Buffer.from(entry.content).toString('utf8')) : {}; };
  const list = v => v == null ? [] : Array.isArray(v) ? v : [v];
  const styles = xml('xl/styles.xml').styleSheet || {}, borderDefs = list(styles.borders?.border), xfs = list(styles.cellXfs?.xf);
  const relations = list(xml('xl/_rels/workbook.xml.rels').Relationships?.Relationship);
  const result = {};
  for (const sheet of list(xml('xl/workbook.xml').workbook?.sheets?.sheet)) {
    const target = relations.find(r => r.Id === sheet['r:id'])?.Target;
    if (!target) continue;
    const normalized = require('node:path').posix.normalize(target.startsWith('/') ? target.slice(1) : 'xl/' + target);
    const cells = result[sheet.name] = {};
    for (const row of list(xml(normalized).worksheet?.sheetData?.row)) for (const cell of list(row.c)) {
      const source = borderDefs[xfs[Number(cell.s || 0)]?.borderId || 0] || {}, border = {};
      for (const side of ['left','right','top','bottom']) {
        const edge = source[side];
        if (!names.includes(edge?.style) || !edge.style) continue;
        const color = edge.color?.rgb?.slice(-6) || defaults[edge.color?.indexed] || '000000';
        border[side] = {style:edge.style,color:'#'+color};
      }
      if (Object.keys(border).length) cells[cell.r] = border;
    }
  }
  return result;
}
module.exports = { readWorkbookBorders, biffBorders };
