// 深复制 ExcelJS Worksheet：cell value/style + 合并单元格 + 行高列宽 + 图片（可替换为带椭圆的标注版）
// 用于周报导出 —— 把每份原始 QA 报告的 sheet 完整搬到汇总 xlsx，保留原布局

function deepClone(o) {
  if (o == null || typeof o !== 'object') return o;
  return JSON.parse(JSON.stringify(o));
}

export function copySheet(srcSheet, destSheet) {
  // 1. 列宽 + 列默认样式
  if (Array.isArray(srcSheet.columns)) {
    srcSheet.columns.forEach((col, i) => {
      const destCol = destSheet.getColumn(i + 1);
      if (col.width) destCol.width = col.width;
      if (col.hidden) destCol.hidden = col.hidden;
      if (col.style) destCol.style = deepClone(col.style);
    });
  }

  // 2. 遍历所有行：行高 + 每个 cell 的 value 和 style
  srcSheet.eachRow({ includeEmpty: true }, (row, rowNum) => {
    const destRow = destSheet.getRow(rowNum);
    if (row.height) destRow.height = row.height;
    if (row.hidden) destRow.hidden = row.hidden;

    row.eachCell({ includeEmpty: true }, (cell, colNum) => {
      const destCell = destRow.getCell(colNum);
      // 合并单元格的 slave 不写 value（master 会处理）；slave 拷贝 style 即可
      const isSlave = cell.master && cell.master !== cell;
      if (!isSlave) {
        try {
          let value = cell.value;
          // richText 等复杂结构需要克隆
          if (value && typeof value === 'object') value = deepClone(value);
          destCell.value = value;
        } catch { /* MergeValue 边界异常 */ }
      }
      if (cell.style) {
        try { destCell.style = deepClone(cell.style); } catch {}
      }
    });
    destRow.commit();
  });

  // 3. 合并单元格
  const merges = srcSheet.model && srcSheet.model.merges;
  if (Array.isArray(merges)) {
    for (const m of merges) {
      try { destSheet.mergeCells(m); } catch { /* 已合并或冲突，跳过 */ }
    }
  }

  // 4. 视图/冻结/缩放
  if (Array.isArray(srcSheet.views) && srcSheet.views.length > 0) {
    destSheet.views = srcSheet.views.map(v => deepClone(v));
  }

  // 5. 打印设置（pageSetup）
  if (srcSheet.pageSetup) {
    destSheet.pageSetup = deepClone(srcSheet.pageSetup);
  }
}

// 把原 sheet 的图片搬到 dest sheet，可选用"标注覆盖映射"替换为带椭圆的版本
//   annotatedByAnchor: Map<key, { buffer, extension }>
//   key = `${sheetName}|${Math.floor(tl.row)}|${Math.floor(tl.col)}`
export function copySheetImages(srcWb, srcSheet, destWb, destSheet, annotatedByAnchor) {
  let imgs = [];
  try { imgs = srcSheet.getImages() || []; } catch { imgs = []; }
  for (const img of imgs) {
    try {
      const range = img.range;
      if (!range || !range.tl) continue;
      const key = `${srcSheet.name}|${Math.floor(range.tl.row)}|${Math.floor(range.tl.col)}`;
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
      // ExcelJS 接受 { tl, br, editAs } 直接传
      const addRange = {
        tl: { col: range.tl.col, row: range.tl.row },
        br: { col: range.br.col, row: range.br.row }
      };
      if (range.editAs) addRange.editAs = range.editAs;
      destSheet.addImage(newImgId, addRange);
    } catch (e) {
      console.warn('[copySheetImages] skip image:', e.message);
    }
  }
}
