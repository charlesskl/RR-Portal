const JSZip = require('jszip');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const { SSF } = require('xlsx');
const path = require('node:path').posix;
const fs = require('node:fs/promises');

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const children = (node, name) => Array.from(node.childNodes).filter(n => n.nodeType === 1 && n.localName === name);
const elements = (node, name) => Array.from(node.getElementsByTagNameNS(NS, name));
const column = address => address.replace(/[0-9]/g, '');
const colNum = letters => [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
const xml = new XMLSerializer();
async function readXml(zip, name) {
  const file = zip.file(name);
  if (!file) throw new Error('原表缺少工作簿组件 ' + name);
  return new DOMParser().parseFromString(await file.async('string'), 'application/xml');
}
function keyColumns(type, order) {
  if (type === 'skycastle') return order ? [4, 5] : [7, 8];
  if (type === 'tomy') return order ? [3, 5] : [6, 8];
  if (type === 'jaz_plastic') return order ? [5, 6] : [7, 8];
  return order ? [6, 7] : [8, 9];
}
function key(po, sku) {
  if (!String(po ?? '').trim() || !String(sku ?? '').trim()) throw new Error('订单缺少 PO 号或货号');
  return JSON.stringify([String(po).trim(), String(sku).trim()]);
}
function originalValue(cell, strings) {
  if (!cell) return '';
  if (cell.getAttribute('t') === 'inlineStr') return elements(cell,'t').map(n=>n.textContent).join('');
  const value = children(cell,'v')[0]?.textContent || '';
  return cell.getAttribute('t') === 's' ? strings[Number(value)] : value;
}
async function createDateWriter(zip, book, strings) {
  const styles = await readXml(zip, 'xl/styles.xml');
  const root = styles.documentElement;
  const xfs = children(root, 'cellXfs')[0];
  const styleRows = children(xfs, 'xf');
  let formats = children(root, 'numFmts')[0];
  const builtin = SSF.get_table();
  const byId = new Map((formats ? children(formats, 'numFmt') : []).map(format => [
    Number(format.getAttribute('numFmtId')), format.getAttribute('formatCode'),
  ]));
  const workbookPr = children(book.documentElement, 'workbookPr')[0];
  const offset = ['1', 'true'].includes(workbookPr?.getAttribute('date1904')) ? 1462 : 0;
  const addedStyles = new Map();
  const yellowStyles = new Map();
  let yellowId;
  function highlight(cell) {
    const index = Number(cell.getAttribute('s') || 0);
    if (yellowId === undefined) {
      const fills = children(root,'fills')[0];
      const entries = children(fills,'fill');
      yellowId = entries.findIndex(f => {
        const pattern = children(f,'patternFill')[0];
        return pattern?.getAttribute('patternType') === 'solid' &&
          children(pattern,'fgColor')[0]?.getAttribute('rgb') === 'FFFFFF00';
      });
      if (yellowId < 0) {
        const fill = styles.createElementNS(NS,'fill');
        const pattern = styles.createElementNS(NS,'patternFill');
        pattern.setAttribute('patternType','solid');
        const color = styles.createElementNS(NS,'fgColor');
        color.setAttribute('rgb','FFFFFF00');
        pattern.appendChild(color); fill.appendChild(pattern); fills.appendChild(fill);
        yellowId = entries.length; fills.setAttribute('count',String(yellowId+1));
      }
    }
    if (Number(styleRows[index].getAttribute('fillId'))===yellowId) return;
    if (!yellowStyles.has(index)) {
      const clone=styleRows[index].cloneNode(true);
      clone.setAttribute('fillId',String(yellowId)); clone.setAttribute('applyFill','1');
      yellowStyles.set(index,styleRows.length);
      xfs.appendChild(clone);styleRows.push(clone);xfs.setAttribute('count',String(styleRows.length));
    }
    cell.setAttribute('s',String(yellowStyles.get(index)));
  }
  return {
    highlight, offset, strings,
    write(cell, value, code) {
      const index = Number(cell.getAttribute('s') || 0);
      const existing = styleRows[index];
      const existingFormat = Number(existing.getAttribute('numFmtId') || 0);
      if (!SSF.is_date(byId.get(existingFormat) || builtin[existingFormat] || 'General')) {
        const key = JSON.stringify([index, code]);
        if (!addedStyles.has(key)) {
          let id = [...byId].find(([, format]) => format === code)?.[0];
          if (id === undefined) {
            if (!formats) {
              formats = styles.createElementNS(NS, 'numFmts');
              root.insertBefore(formats, root.firstChild);
            }
            id = Math.max(163, ...byId.keys()) + 1;
            const format = styles.createElementNS(NS, 'numFmt');
            format.setAttribute('numFmtId', String(id));
            format.setAttribute('formatCode', code);
            formats.appendChild(format);
            formats.setAttribute('count', String(byId.size + 1));
            byId.set(id, code);
          }
          const clone = existing.cloneNode(true);
          clone.setAttribute('numFmtId', String(id));
          clone.setAttribute('applyNumberFormat', '1');
          const nextIndex = styleRows.length;
          xfs.appendChild(clone);
          styleRows.push(clone);
          xfs.setAttribute('count', String(styleRows.length));
          addedStyles.set(key, nextIndex);
        }
        cell.setAttribute('s', String(addedStyles.get(key)));
      }
      return value - offset;
    },
    save() {
      if (addedStyles.size || yellowStyles.size) zip.file('xl/styles.xml', xml.serializeToString(styles));
    },
  };
}
function writeCell(doc, row, source, dates) {
  const letters = column(source.address);
  const cells = children(row, 'c');
  let cell = cells.find(c=>column(c.getAttribute('r')) === letters);
  if (source.value == null || source.value === '') return;
  if (cell && children(cell,'f').length) return;
  if (cell && dates) {
    const numeric = typeof source.value === 'number';
    const old = originalValue(cell, dates.strings);
    const next = numeric && source.numFmt?.startsWith('yyyy/') ? source.value - dates.offset : source.value;
    if (numeric ? old !== '' && Number(old) === next : old === String(next)) return;
  }
  if (!cell) {
    cell = doc.createElementNS(NS,'c');
    cell.setAttribute('r',letters + row.getAttribute('r'));
    row.insertBefore(cell, cells.find(c=>colNum(column(c.getAttribute('r'))) > colNum(letters)) || null);
  }
  for (const child of [...children(cell,'v'), ...children(cell,'is')]) cell.removeChild(child);
  const number = typeof source.value === 'number';
  const date = number && source.numFmt?.startsWith('yyyy/');
  cell.setAttribute('t', number ? 'n' : 'inlineStr');
  const child = doc.createElementNS(NS, number ? 'v' : 'is');
  if (number) child.appendChild(doc.createTextNode(String(date ? dates.write(cell, source.value, source.numFmt) : source.value)));
  else {
    const t = doc.createElementNS(NS,'t');
    t.setAttribute('xml:space','preserve');
    t.appendChild(doc.createTextNode(String(source.value)));
    child.appendChild(t);
  }
  cell.insertBefore(child,children(cell,'extLst')[0] || null);
  dates?.highlight(cell);
}
function updateQuantityTotals(doc, row, delta, type, strings, dates) {
  const quantityCol = delta.skyTotals?.quantity ?? (type === 'jaz_costume' ? 11 : 10);
  const raw = new Map(children(row, 'c').map(c => [colNum(column(c.getAttribute('r'))), c]));
  const quantity = delta.getCell(quantityCol).value;
  const old = originalValue(raw.get(quantityCol), strings);
  if (Number(old) === quantity) return;
  if (raw.get(quantityCol) && children(raw.get(quantityCol), 'f').length) {
    throw new Error('原表数量由公式计算，请核对后更新');
  }
  function update(factorCol, totalCol, calculate) {
    if (!factorCol || !totalCol) return;
    const factor = raw.get(factorCol), total = raw.get(totalCol);
    if (total && children(total, 'f').length) return;
    const value = originalValue(factor, strings);
    if (value === '' && originalValue(total, strings) === '') return;
    if (!Number.isFinite(Number(value)) || Number(value) <= 0 || (factor && children(factor, 'f').length)) {
      throw new Error('原表缺少可核对的用量或装箱数，请核对后更新');
    }
    writeCell(doc, row, {address:delta.getCell(totalCol).address, value:calculate(quantity,Number(value))}, dates);
  }
  if (type === 'skycastle') {
    update(...(delta.skyTotals?.sticker ?? [11, 12]), (qty, rate) => qty * rate);
    update(...(delta.skyTotals?.carton ?? [13, 14]), (qty, pack) => Math.ceil(qty / pack));
  } else {
    update(quantityCol + 1, quantityCol + 2, (qty, pack) => Math.ceil(qty / pack));
  }
}

async function addSupplementSheet(zip, book, rels, generatedSheet, names, dates) {
  const sheets = elements(book, 'sheets')[0];
  const sheetIds = elements(book,'sheet').map(sheet=>Number(sheet.getAttribute('sheetId')));
  let id = Math.max(0,...sheetIds) + 1;
  while (zip.file(`xl/worksheets/sheet${id}.xml`) ||
    Array.from(rels.documentElement.childNodes).some(r=>r.getAttribute?.('Id') === `skyHint${id}`)) id++;
  let name = generatedSheet.name;
  for (let n = 2; names.has(name); n++) name = generatedSheet.name + n;
  const sheet = book.createElementNS(NS,'sheet');
  const relationshipNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  sheet.setAttribute('name',name);
  sheet.setAttribute('sheetId',String(id));
  sheet.setAttributeNS(relationshipNS,'r:id',`skyHint${id}`);
  sheets.appendChild(sheet);
  const rel = rels.createElementNS(rels.documentElement.namespaceURI,'Relationship');
  rel.setAttribute('Id',`skyHint${id}`);
  rel.setAttribute('Type',relationshipNS + '/worksheet');
  rel.setAttribute('Target',`worksheets/sheet${id}.xml`);
  rels.documentElement.appendChild(rel);
  const types = await readXml(zip,'[Content_Types].xml');
  const override = types.createElementNS(types.documentElement.namespaceURI,'Override');
  override.setAttribute('PartName',`/xl/worksheets/sheet${id}.xml`);
  override.setAttribute('ContentType','application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml');
  types.documentElement.appendChild(override);
  const doc = new DOMParser().parseFromString(`<worksheet xmlns="${NS}"><sheetData/></worksheet>`,'application/xml');
  const data = elements(doc,'sheetData')[0];
  generatedSheet.eachRow(source=>{
    const row = doc.createElementNS(NS,'row');
    row.setAttribute('r',String(source.number));
    source.eachCell(cell=>writeCell(doc,row,cell,dates));
    data.appendChild(row);
  });
  zip.file(`xl/worksheets/sheet${id}.xml`,xml.serializeToString(doc));
  zip.file('[Content_Types].xml',xml.serializeToString(types));
  zip.file('xl/_rels/workbook.xml.rels',xml.serializeToString(rels));
  names.set(name,sheet);
}
async function updateFees(zip, file, generated, styles) {
  const doc = await readXml(zip, file);
  const data = elements(doc, 'sheetData')[0];
  const existingRows = children(data, 'row');
  const index = new Map();
  let last = 0;
  for (const row of existingRows) {
    const number = Number(row.getAttribute('r'));
    last = Math.max(last, number);
    const values = new Map(children(row, 'c').map(cell => [
      colNum(column(cell.getAttribute('r'))), originalValue(cell, styles.strings),
    ]));
    if (number === 1) {
      generated.getRow(1).eachCell((cell, col) => {
        if (values.get(col) !== cell.value) throw Error('原费用明细表头与 PO 费用格式不符');
      });
      continue;
    }
    if (!values.get(1) && !values.get(2)) continue;
    const id = key(values.get(1), values.get(2));
    if (index.has(id)) throw Error('原费用明细含同 PO 同名费用，请核对');
    index.set(id, row);
  }
  if (!existingRows.some(row => row.getAttribute('r') === '1')) throw Error('原费用明细缺少表头');
  generated.eachRow((source, number) => {
    if (number === 1) return;
    const id = key(source.getCell(1).value, source.getCell(2).value);
    let row = index.get(id);
    if (!row) {
      row = doc.createElementNS(NS, 'row');
      row.setAttribute('r', String(++last));
      data.appendChild(row);
      index.set(id, row);
    }
    source.eachCell(cell => writeCell(doc, row, cell, styles));
  });
  const dimension = elements(doc, 'dimension')[0];
  if (dimension) dimension.parentNode.removeChild(dimension);
  zip.file(file, xml.serializeToString(doc));
}
async function writeFullWorkbook(original, output, generated, type, orders, confirmation) {
  const zip = await JSZip.loadAsync(await fs.readFile(original));
  const book = await readXml(zip,'xl/workbook.xml');

  const rels = await readXml(zip,'xl/_rels/workbook.xml.rels');
  const strings = zip.file('xl/sharedStrings.xml') ? elements(await readXml(zip,'xl/sharedStrings.xml'),'si').map(s=>elements(s,'t').map(t=>t.textContent).join('')) : [];
  const dates = await createDateWriter(zip,book,strings);
  if (type !== 'skycastle') dates.highlight = () => {};
  const changes = [];
  const src = new Map(elements(book,'sheet').map(s=>[s.getAttribute('name'),s]));
  const ids = new Map(Array.from(rels.documentElement.childNodes).filter(n=>n.nodeType===1).map(r=>[r.getAttribute('Id'),r.getAttribute('Target')]));
  const expected = new Set();
  const client = {skycastle:'Sky Castle',tomy:'TOMY',jaz_plastic:'JAZ',jaz_costume:'JAZ'}[type];
  for (const po of orders) {
    if (po.error || po.client !== client || !po.items?.length) throw new Error('PO 解析结果与排期模板不匹配，请核对');
    for (const item of po.items) {
      const id = key(po.poNumber,item.partNo);
      if (expected.has(id)) throw new Error('本批 PO 号与货号重复，请核对分批明细');
      expected.add(id);
    }
  }
  const written = [new Set(), new Set()];
  if (!expected.size) throw new Error('没有可写入的订单');
  for (const sheet of generated.worksheets) {
    if (sheet.name === '费用明细' && src.has(sheet.name)) {
      const sheetId = src.get(sheet.name).getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id');
      const target = ids.get(sheetId);
      await updateFees(zip, target.startsWith('/') ? target.slice(1) : path.join('xl', target), sheet, dates);
      continue;
    }
    if (sheet.name === '扣数提示' || sheet.name === '费用明细') {
      await addSupplementSheet(zip,book,rels,sheet,src,dates);
      continue;
    }
    const name = sheet.name.replace(/-粘贴用$/,'');
    const order = name.endsWith('接单');
    const [pc, sc] = sheet.skyKeyColumns ?? keyColumns(type,order);
    const updates = [];
    sheet.eachRow(row=>{
      const po = row.getCell(pc).value, sku = row.getCell(sc).value;
      if (po && sku && expected.has(key(po,sku))) updates.push(row);
    });
    const target = src.get(name);
    if (!target && !updates.length) continue;
    if (!target) throw new Error('原表缺少工作表 ' + name);
    const rel = ids.get(target.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id'));
    const file = rel.startsWith('/') ? rel.slice(1) : path.join('xl',rel);
    const doc = await readXml(zip,file);
    const data = elements(doc,'sheetData')[0];
    const indexed = new Map();
    let last = 0;
    for (const row of children(data,'row')) {
      last = Math.max(last,Number(row.getAttribute('r')));
      const cells = new Map(children(row,'c').map(c=>[colNum(column(c.getAttribute('r'))),originalValue(c,strings)]));
      if (!cells.get(pc) || !cells.get(sc)) continue;
      const id = key(cells.get(pc),cells.get(sc));
      if (indexed.has(id) && expected.has(id)) throw new Error(name+' 有多条同 PO、同货号记录，无法确定修改行');
      indexed.set(id,row);
    }
    const routed = new Set(updates.map(r=>key(r.getCell(pc).value,r.getCell(sc).value)));
    if (!order && [...indexed.keys()].some(id=>expected.has(id) && !routed.has(id))) {
      throw new Error('原排期与本次选择的目标工作表不同，请先核对历史行');
    }
    if (!updates.length) continue;
    for (const delta of updates) {
      const id = key(delta.getCell(pc).value,delta.getCell(sc).value);
      const processed = written[order ? 0 : 1];
      if (processed.has(id)) throw new Error('同一订单重复写入，请核对');
      processed.add(id);
      let row = indexed.get(id);
      const existing = Boolean(row);
      if (!row) {
        if (++last > 1048576) throw new Error('原表已达到行数上限');
        row = doc.createElementNS(NS,'row');
        row.setAttribute('r',String(last));
        data.appendChild(row);
      }
      if (existing && delta.skyDateColumns) {
        for (const n of delta.skyDateColumns) {
          const c = delta.getCell(n);
          const oldCell = children(row,'c').find(v=>colNum(column(v.getAttribute('r'))) === n);
          const old = originalValue(oldCell,strings);
          const iso = serial => new Date((serial-25569)*86400000).toISOString().slice(0,10);
          const before = old === '' ? '空' : Number.isFinite(Number(old)) ? iso(Number(old)+dates.offset) : old.slice(0,10);
          const after = iso(c.value);
          if (before !== after) {
            if (oldCell && children(oldCell,'f').length) throw Error(name+' 的计划日期由公式计算，请核对原表');
            changes.push([name,delta.getCell(pc).text,delta.getCell(sc).text,order?'出货期':n===delta.skyDateColumns[0]?'计划出货期':'计划验货期',before,after]);
          }
        }
      }
      if (existing && !order) updateQuantityTotals(doc,row,delta,type,strings,dates);
      const revisionColumns = type === 'skycastle' ? (order ? [2,6,78,79,80] : [10,15,16,40,41,42])
        : type === 'tomy' ? (order ? [6,7,55,56,57] : [10,13,...(src.has('KIK总排期') || src.has('RRM总排期') ? [25,26,27] : [23,24,25])])
        : type === 'jaz_plastic' ? (order ? [2,3,7,42,43,44] : [5,10,13,14,26,27,28])
        : (order ? [2,3,8,212,213,214] : [5,11,14,15,28,29,30]);
      // Product quantity columns are populated by the template header lookup.
      const firstProduct = type === 'tomy' ? 8 : type === 'skycastle' ? 9 : 10;
      const lastProduct = {tomy:51,skycastle:74,jaz_plastic:39,jaz_costume:205}[type];
      if (existing && !order && type === 'tomy') {
        sheet.getRow(1).eachCell((header, n) => {
          if (!/^(备注|備註|remarks?)$/i.test(header.text.trim())) return;
          const note = delta.getCell(n);
          if (!note.value) return;
          const targetCell = children(row, 'c').find(c => colNum(column(c.getAttribute('r'))) === n);
          const previous = originalValue(targetCell, strings);
          const additions = String(note.value).split('；').filter(part => !previous.split('；').includes(part));
          if (additions.length) writeCell(doc,row,{address:note.address,value:[previous,...additions].filter(Boolean).join('；')},dates);
        });
      }
      delta.eachCell((c,n)=>{
        const productQty = order && n >= firstProduct && n <= lastProduct;
        if (!existing || (delta.skyRevisionColumns ? delta.skyRevisionColumns.includes(n) : productQty || revisionColumns.includes(n) || delta.skyPackagingColumns?.includes(n))) writeCell(doc,row,c,dates);
      });
    }
    const dim = elements(doc,'dimension')[0];
    if (dim) dim.parentNode.removeChild(dim);
    zip.file(file,xml.serializeToString(doc));
  }
  if (written.some(s=>s.size !== expected.size)) throw new Error('部分 PO 明细没有对应的接单或排期工作表，请核对模板');
  if (changes.length) {
    const token = require('node:crypto').createHash('sha256').update(JSON.stringify(changes)).digest('hex');
    if (confirmation !== token) throw Object.assign(new Error('请确认修改单的日期变化'),{changes,token});
  }
  const calc = elements(book,'calcPr')[0];
  if (calc) calc.setAttribute('fullCalcOnLoad','1');
  dates.save();
  zip.file('xl/workbook.xml',xml.serializeToString(book));
  await fs.writeFile(output,await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}));
}
// Read only style references for the few source rows included in a paste copy.
async function sheetFiles(zip) {
  const book = await readXml(zip, 'xl/workbook.xml');
  const rels = await readXml(zip, 'xl/_rels/workbook.xml.rels');
  const files = new Map(Array.from(rels.documentElement.childNodes).filter(n => n.nodeType === 1).map(rel => {
    const target = rel.getAttribute('Target');
    return [rel.getAttribute('Id'), target.startsWith('/') ? target.slice(1) : path.join('xl', target)];
  }));
  const relNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  return new Map(elements(book, 'sheet').map(sheet => [
    sheet.getAttribute('name'), files.get(sheet.getAttributeNS(relNS, 'id')),
  ]));
}

async function writePasteStyles(template, destination, copy, layouts) {
  const source = await JSZip.loadAsync(await fs.readFile(template));
  const output = await JSZip.loadAsync(await copy.xlsx.writeBuffer());
  const sourceFiles = await sheetFiles(source), outputFiles = await sheetFiles(output);
  output.file('xl/styles.xml', await source.file('xl/styles.xml').async('nodebuffer'));
  const book = await readXml(output, 'xl/workbook.xml');
  const styles = await createDateWriter(output, book, []);
  for (const [name, layout] of layouts) {
    const rows = new Map([...layout.sourceRows.values()].map(n => [n, new Map()]));
    const columns = new Map(), rowStyles = new Map();
    const parser = new (require('saxes').SaxesParser)({xmlns:true});
    let selected;
    parser.on('opentag', tag => {
      if (tag.uri !== NS) return;
      const attr = k => tag.attributes[k]?.value;
      if (tag.local === 'col' && attr('style')) {
        for (let i = +attr('min'); i <= Math.min(+attr('max'), 16384); i++) columns.set(i, attr('style'));
      } else if (tag.local === 'row') {
        const n = +attr('r');
        selected = rows.get(n);
        if (selected && attr('s')) rowStyles.set(n, attr('s'));
      } else if (tag.local === 'c' && selected && attr('s')) {
        selected.set(column(attr('r')), attr('s'));
      }
    });
    parser.on('closetag', tag => { if (tag.local === 'row') selected = undefined; });
    parser.write(await source.file(sourceFiles.get(name)).async('string')).close();
    const file = outputFiles.get(name);
    const sheet = await readXml(output, file);
    for (const row of elements(sheet, 'row')) {
      const sourceRow = layout.sourceRows.get(+row.getAttribute('r'));
      for (const cell of children(row, 'c')) {
        const ref = cell.getAttribute('r'), col = column(ref);
        const originalStyle = rows.get(sourceRow)?.get(col) ?? rowStyles.get(sourceRow) ?? columns.get(colNum(col)) ?? '0';
        cell.setAttribute('s', originalStyle);
        if (layout.dates.has(ref)) styles.write(cell, 0, 'yyyy/mm/dd');
        if (layout.changed.has(ref)) styles.highlight(cell);
      }
    }
    output.file(file, xml.serializeToString(sheet));
  }
  styles.save();
  await fs.writeFile(destination, await output.generateAsync({type:'nodebuffer', compression:'DEFLATE'}));
}
module.exports = { writeFullWorkbook, writePasteStyles };
