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
  if (drawingFiles.length === 0 || mediaFiles.length === 0) return [];

  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const results = [];
  // 去重：同一 (媒体源, 行号) 只输出一次（避免多 sheet 重复引用同张图）
  const seen = new Set();

  for (const dpath of drawingFiles) {
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
      const key = `${mediaPath}@${fromRow}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const data = await mediaFile.async('nodebuffer');
      const ext = path.extname(mediaPath).toLowerCase() || '.png';
      const outName = `xls-${Date.now()}-${Math.random().toString(36).slice(2, 7)}${ext}`;
      const outPath = path.join(outDir, outName);
      fs.writeFileSync(outPath, data);
      results.push({ row: fromRow, col: fromCol, file: outName });
    }
  }
  return results;
}

module.exports = { extractImagesByRow };
