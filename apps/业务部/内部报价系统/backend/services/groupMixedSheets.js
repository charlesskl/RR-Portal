'use strict';
const quoteName = name => "'" + name.replace(/'/g, "''") + "'";

// Relocate complete template blocks. Absolute references move with their source block too.
// String literals and function names (e.g. LOG10) are deliberately left intact.
function relocateFormula(formula, local, mapping) {
  return formula.replace(/"(?:[^"]|"")*"|(?:(?:'((?:[^']|'')+)'|([\p{L}_][\p{L}\p{N}_.]*))!)?(\$?[A-Z]{1,3}\$?\d+)(?::(\$?[A-Z]{1,3}\$?\d+))?/gu,
    (token, quoted, plain, first, last, offset, source) => {
      if (token.startsWith('"') || !first) return token;
      if (!quoted && !plain && (/[\w.]/.test(source[offset - 1] || '') || source[offset + token.length] === '(')) return token;
      const original = quoted ? quoted.replace(/''/g, "'") : plain;
      const move = original ? mapping.get(original) : local;
      if (!move) return token;
      const expanded = move.cellFormulas?.get(first.replace(/\$/g, ''));
      if (expanded && !last) return '(' + relocateFormula(expanded, {...move, qualifyLocal:true}, mapping) + ')';
      const shift = address => address.replace(/^(\$?)([A-Z]+)(\$?)(\d+)$/, (_,ca,letters,ra,n) => {
        let col=[...letters].reduce((v,c)=>v*26+c.charCodeAt(0)-64,0)+(move.colOffset||0), name='';
        while(col){name=String.fromCharCode(65+(col-1)%26)+name;col=Math.floor((col-1)/26);}
        const row=move.rows ? move.rows.get(Number(n)) : Number(n)+move.offset;
        if (!row) throw new Error('合并明细缺少引用行：'+address);
        return ca+name+ra+row;
      });
      const qualifier = original || move.qualifyLocal ? quoteName(move.name) + '!' : '';
      return qualifier + shift(first) + (last ? ':' + shift(last) : '');
    });
}

function groupMixedSheets(wb, blocks, summaries = {}, headings = {}) {
  const mapping = new Map(), groups = new Map();
  for (const block of blocks) {
    let dest = groups.get(block.group);
    if (!dest) {
      dest = wb.addWorksheet(block.group);
      dest.views = [{ state: 'frozen', ySplit: 1 }];
      dest.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
      if (summaries[block.group]) {
        dest.addRows(summaries[block.group]);
        dest.eachRow(r=>{r.height=25;r.eachCell(c=>{c.numFmt='0.0000';c.font={name:'Microsoft YaHei',size:10};});});
        dest.getRow(1).font={name:'Microsoft YaHei',size:11,bold:true,color:{argb:'FFFFFFFF'}};
        dest.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF234E70'}};
      }
      if(headings[block.group]){const h=headings[block.group];require('./mixedHeading').addMixedHeading(dest,h.quote,h.label,h.width);}
      groups.set(block.group, dest);
    }
    const titleRow = dest.rowCount + (dest.rowCount ? 3 : 1);
    const width = Math.max(block.sheet.columnCount, 4);
    dest.mergeCells(titleRow, 1, titleRow, width);
    const title = dest.getCell(titleRow, 1);
    title.value = block.title;
    title.font = { name: 'Microsoft YaHei', bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
    title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF234E70' } };
    dest.getRow(titleRow).height = 28;
    mapping.set(block.sheet.name, { name: dest.name, offset: titleRow, dest });
    block.sheet.columns.forEach((col, i) => { dest.getColumn(i + 1).width = Math.max(dest.getColumn(i + 1).width || 0, col.width || 12); });
    block.sheet.eachRow({ includeEmpty: true }, row => {
      const target = dest.getRow(row.number + titleRow);
      target.height = row.height;
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        if (cell.isMerged && cell.master.address !== cell.address) return;
        const copied = target.getCell(col);
        copied.value = cell.value?.sharedFormula ? { formula: cell.formula, result: cell.result } : structuredClone(cell.value);
        copied.style = structuredClone(cell.style);
        if (cell.note) copied.note = structuredClone(cell.note);
      });
    });
    for (const range of block.sheet.model.merges || []) {
      const shifted = range.replace(/\d+/g, n => Number(n) + titleRow);
      dest.mergeCells(shifted);
    }
    for (const image of block.sheet.getImages()) {
      const range = image.range;
      const anchor = a => ({ nativeCol: a.nativeCol, nativeColOff: a.nativeColOff, nativeRow: a.nativeRow + titleRow, nativeRowOff: a.nativeRowOff });
      dest.addImage(image.imageId, { ...range, tl: anchor(range.tl), ...(range.br ? { br: anchor(range.br) } : {}) });
    }
  }
  for (const [name,rows] of Object.entries(summaries)) {
    if (groups.has(name)) continue;
    const dest=wb.addWorksheet(name);dest.addRows(rows);dest.columns=[{width:22},{width:32},{width:30},{width:16},{width:24}];
    dest.views=[{state:'frozen',ySplit:1}];
    dest.eachRow(r=>{r.height=26;r.eachCell(c=>{c.numFmt='0.0000';c.font={name:'Microsoft YaHei',size:10};});});
    dest.getRow(1).font={name:'Microsoft YaHei',bold:true,color:{argb:'FFFFFFFF'}};
    dest.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF234E70'}};
    groups.set(name,dest);
  }
  for (const dest of groups.values()) {
    if (summaries[dest.name]) {
      [22,32,30,16,24].forEach((width,i)=>{dest.getColumn(i+1).width=Math.max(dest.getColumn(i+1).width||0,width);});
      dest.getRow(1).height=36;
      dest.getRow(1).eachCell(c=>{c.alignment={vertical:'middle',wrapText:true};});
    }
  }
  // Rewrite cells in original blocks before they are removed, and all external consumers.
  for (const block of blocks) {
    const move = mapping.get(block.sheet.name);
    block.sheet.eachRow(row => row.eachCell(cell => {
      if (cell.formula && (!cell.isMerged || cell.master.address === cell.address)) {
        move.dest.getCell(row.number + move.offset, cell.col).value = {
          formula: relocateFormula(cell.formula, move, mapping), result: cell.result,
        };
      }
    }));
  }
  const originals = new Set(blocks.map(b => b.sheet.name)), destinations = new Set([...groups.keys()]);
  wb.eachSheet(ws => {
    if (originals.has(ws.name) || destinations.has(ws.name)) return;
    ws.eachRow(row => row.eachCell(cell => {
      if (cell.formula) cell.value = { formula: relocateFormula(cell.formula, null, mapping), result: cell.result };
    }));
  });
  for (const block of blocks) wb.removeWorksheet(block.sheet.id);
  return mapping;
}
module.exports = { groupMixedSheets, relocateFormula };
