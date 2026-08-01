// 从 .xlsx 抽取嵌入图片 + 它们的 cell anchor 行号
// .xls 二进制不支持（让前端提示用户另存为 xlsx）
const JSZip = require('jszip');
const { XMLParser } = require('fast-xml-parser');
const path = require('path');
const fs = require('fs');

async function extractImagesByRow(buf, outDir) {
  const zip = await JSZip.loadAsync(buf);

  const drawingFiles = Object.keys(zip.files).filter(p => /^xl\/drawings\/drawing\d+\.xml$/.test(p));
  const mediaFiles = Object.keys(zip.files).filter(p => /^xl\/media\//.test(p));
  if (mediaFiles.length === 0) return [];

  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const results = [];
  // 同一行号可以出现在不同产品 Sheet，去重必须包含 Sheet 索引。
  const seen = new Set();
  const worksheetFiles = Object.keys(zip.files)
    .filter(p => /^xl\/worksheets\/sheet\d+\.xml$/.test(p));
  const sheetIndexOf = sheetPath => {
    const match = String(sheetPath).match(/sheet(\d+)\.xml$/);
    return match ? Number(match[1]) - 1 : null;
  };
  const resolveTarget = (basePath, target) => {
    const value = String(target || '').replace(/\\/g, '/');
    if (!value) return '';
    if (value.startsWith('/')) return value.replace(/^\//, '');
    return path.posix.normalize(path.posix.join(path.posix.dirname(basePath), value));
  };
  const drawingToSheetIndex = {};
  for (const sheetPath of worksheetFiles) {
    const relsPath = `xl/worksheets/_rels/${path.basename(sheetPath)}.rels`;
    if (!zip.files[relsPath]) continue;
    const relsObj = parser.parse(await zip.files[relsPath].async('string'));
    for (const rel of [].concat(relsObj?.Relationships?.Relationship || [])) {
      const target = resolveTarget(sheetPath, rel['@_Target']);
      if (/^xl\/drawings\/drawing\d+\.xml$/.test(target)) {
        drawingToSheetIndex[target] = sheetIndexOf(sheetPath);
      }
    }
  }

  for (const dpath of drawingFiles) {
    const sheetIndex = drawingToSheetIndex[dpath] ?? null;
    const name = path.basename(dpath); // drawing1.xml
    const relsPath = `xl/drawings/_rels/${name}.rels`;
    if (!zip.files[relsPath]) continue;
    const relsXml = await zip.files[relsPath].async('string');
    const relsObj = parser.parse(relsXml);
    const relList = [].concat(relsObj?.Relationships?.Relationship || []);
    const ridToTarget = {};
    for (const r of relList) {
      ridToTarget[r['@_Id']] = r['@_Target']; // ../media/imageN.png
    }

    const drawXml = await zip.files[dpath].async('string');
    const drawObj = parser.parse(drawXml);
    const anchors = [].concat(
      drawObj?.['xdr:wsDr']?.['xdr:twoCellAnchor'] || [],
      drawObj?.['xdr:wsDr']?.['xdr:oneCellAnchor'] || []
    );
    for (const a of anchors) {
      const from = a['xdr:from'];
      const fromRow = Number(from?.['xdr:row']); // 0-based
      const fromCol = Number(from?.['xdr:col']);
      const blip = a?.['xdr:pic']?.['xdr:blipFill']?.['a:blip'];
      const rid = blip?.['@_r:embed'] || blip?.['@_xmlns:r']; // 取 r:embed
      const targetRel = blip?.['@_r:embed'];
      const target = ridToTarget[targetRel];
      if (!target) continue;
      const mediaPath = ('xl/' + target.replace(/^\.\.\//, '')).replace(/\\/g, '/');
      const mediaFile = zip.files[mediaPath];
      if (!mediaFile) continue;
      // 去重：同一媒体源 + 同一行号 已收 → 跳过
      const key = `${mediaPath}@${sheetIndex ?? dpath}@${fromRow}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const data = await mediaFile.async('nodebuffer');
      const ext = path.extname(mediaPath).toLowerCase() || '.png';
      const outName = `xls-${Date.now()}-${Math.random().toString(36).slice(2, 7)}${ext}`;
      const outPath = path.join(outDir, outName);
      fs.writeFileSync(outPath, data);
      results.push({ row: fromRow, col: fromCol, sheetIndex, file: outName });
    }
  }

  // WPS 的“单元格图片”不是普通 drawing，而是
  // DISPIMG("ID_xxx") + xl/cellimages.xml。把图片 ID 映射回公式单元格，
  // 才能识别以合并图片列划分的多产品模具表。
  const cellImagesPath = 'xl/cellimages.xml';
  const cellImageRelsPath = 'xl/_rels/cellimages.xml.rels';
  if (zip.files[cellImagesPath] && zip.files[cellImageRelsPath]) {
    const relsObj = parser.parse(await zip.files[cellImageRelsPath].async('string'));
    const relList = [].concat(relsObj?.Relationships?.Relationship || []);
    const ridToTarget = {};
    for (const rel of relList) ridToTarget[rel['@_Id']] = rel['@_Target'];

    const cellImagesObj = parser.parse(await zip.files[cellImagesPath].async('string'));
    const cellImages = [].concat(cellImagesObj?.['etc:cellImages']?.['etc:cellImage'] || []);
    const idToMedia = {};
    for (const entry of cellImages) {
      const pic = entry?.['xdr:pic'];
      const imageId = pic?.['xdr:nvPicPr']?.['xdr:cNvPr']?.['@_name'];
      const rid = pic?.['xdr:blipFill']?.['a:blip']?.['@_r:embed'];
      const target = ridToTarget[rid];
      if (!imageId || !target) continue;
      idToMedia[imageId] = (`xl/${target}`).replace(/\\/g, '/');
    }

    for (const sheetPath of worksheetFiles) {
      const sheetIndex = sheetIndexOf(sheetPath);
      const xml = await zip.files[sheetPath].async('string');
      const cellPattern = /<c\b[^>]*\br="([A-Z]+)(\d+)"[^>]*>(?:(?!<\/c>)[\s\S])*?<f(?![^>]*\/>)[^>]*>((?:(?!<\/f>)[\s\S])*?DISPIMG(?:(?!<\/f>)[\s\S])*?)<\/f>(?:(?!<\/c>)[\s\S])*?<\/c>/g;
      let match;
      while ((match = cellPattern.exec(xml))) {
        const formula = match[3].replace(/&quot;/g, '"');
        const imageId = (formula.match(/ID_[A-Za-z0-9]+/) || [])[0];
        const mediaPath = idToMedia[imageId];
        const mediaFile = mediaPath && zip.files[mediaPath];
        if (!mediaFile) continue;
        const row = Number(match[2]) - 1;
        const colText = match[1];
        let col = 0;
        for (const ch of colText) col = col * 26 + ch.charCodeAt(0) - 64;
        col -= 1;
        const key = `${mediaPath}@${sheetIndex}@${row}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const data = await mediaFile.async('nodebuffer');
        const ext = path.extname(mediaPath).toLowerCase() || '.png';
        const outName = `xls-${Date.now()}-${Math.random().toString(36).slice(2, 7)}${ext}`;
        fs.writeFileSync(path.join(outDir, outName), data);
        results.push({ row, col, sheetIndex, file: outName });
      }
    }
  }
  return results;
}

module.exports = { extractImagesByRow };
