// 深复制 ExcelJS Worksheet：cell value/style + 合并单元格 + 行高列宽 + 图片（含椭圆标注）
// 支持把多个 source sheet 按 rowOffset 拼接到同一个 dest sheet（保留原布局）

function deepClone(o) {
  if (o == null || typeof o !== 'object') return o;
  return JSON.parse(JSON.stringify(o));
}

// 把 ExcelJS 合并范围字符串 "A1:N3" 整体下移 rowOffset 行
function shiftRangeRows(rangeStr, rowOffset) {
  if (rowOffset === 0) return rangeStr;
  return String(rangeStr).replace(/([A-Z]+)(\d+)/g, (_, col, row) => col + (parseInt(row, 10) + rowOffset));
}

// 把 srcSheet 整段追加到 destSheet 的 rowOffset 之后
// annotatedByAnchor: Map<`${srcSheetName.trim()}|${floor(tl.row)}|${floor(tl.col)}`, { buffer, extension }>
// 返回该 section 占用的行数（srcSheet 的最大行号）
export function appendSheetSection(srcWb, srcSheet, destWb, destSheet, rowOffset, annotatedByAnchor) {
  // 1. 列宽：取最大值
  if (Array.isArray(srcSheet.columns)) {
    srcSheet.columns.forEach((col, i) => {
      if (!col || !col.width) return;
      const destCol = destSheet.getColumn(i + 1);
      if (!destCol.width || destCol.width < col.width) destCol.width = col.width;
    });
  }

  // 2. 每个 cell 的 value + style + 行高
  let maxRowSeen = 0;
  srcSheet.eachRow({ includeEmpty: true }, (row, rowNum) => {
    maxRowSeen = Math.max(maxRowSeen, rowNum);
    const destRow = destSheet.getRow(rowNum + rowOffset);
    if (row.height) destRow.height = row.height;

    row.eachCell({ includeEmpty: true }, (cell, colNum) => {
      const destCell = destRow.getCell(colNum);
      const isSlave = cell.master && cell.master !== cell;
      if (!isSlave) {
        try {
          let v = cell.value;
          if (v && typeof v === 'object') {
            // 共享公式/普通公式：只取结果值，丢弃 formula/sharedFormula 引用
            // 否则 row shift 后 master 位置错乱会报错 "Shared Formula master must exist..."
            if (v.formula != null || v.sharedFormula != null) {
              v = v.result != null ? v.result : '';
            } else {
              v = deepClone(v);
            }
          }
          destCell.value = v;
        } catch { /* MergeValue 边界 */ }
      }
      if (cell.style) {
        try { destCell.style = deepClone(cell.style); } catch {}
      }
    });
    destRow.commit();
  });

  // 3. 合并单元格：整体下移
  const merges = srcSheet.model && srcSheet.model.merges;
  if (Array.isArray(merges)) {
    for (const m of merges) {
      try { destSheet.mergeCells(shiftRangeRows(m, rowOffset)); } catch { /* 跳过冲突 */ }
    }
  }

  // 4. 图片：anchor 的 row 加 rowOffset；优先用 annotated buffer（带椭圆）
  let imgs = [];
  try { imgs = srcSheet.getImages() || []; } catch {}
  for (const img of imgs) {
    try {
      const range = img.range;
      if (!range || !range.tl) continue;
      const key = `${(srcSheet.name || '').trim()}|${Math.floor(range.tl.row)}|${Math.floor(range.tl.col)}`;
      const annotated = annotatedByAnchor && annotatedByAnchor.get(key);

      let buffer, extension;
      if (annotated) {
        buffer = annotated.buffer;
        extension = annotated.extension;
      } else {
        const data = srcWb.getImage(img.imageId);
        if (!data || !data.buffer) continue;
        buffer = data.buffer;
        extension = (data.extension || 'png').toLowerCase();
        if (extension === 'jpg') extension = 'jpeg';
      }
      const newImgId = destWb.addImage({ buffer, extension });
      destSheet.addImage(newImgId, {
        tl: { col: range.tl.col, row: range.tl.row + rowOffset },
        br: { col: range.br.col, row: range.br.row + rowOffset },
        ...(range.editAs ? { editAs: range.editAs } : {})
      });
    } catch (e) {
      console.warn('[appendSheetSection] skip image:', e.message);
    }
  }

  return maxRowSeen;
}
