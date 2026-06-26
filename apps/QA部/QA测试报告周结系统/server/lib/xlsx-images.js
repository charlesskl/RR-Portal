// 从 .xlsx (zip) 直接提取图片，并把 drawing.xml 里的椭圆 shape 叠加到对应图片上
// 这弥补了 ExcelJS 仅提取 image buffer、丢失上层标注 (椭圆/箭头) 的不足
import JSZip from 'jszip';
import sharp from 'sharp';
import { XMLParser } from 'fast-xml-parser';
import path from 'path';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: false
});

function asArray(x) {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}

function intAttr(v, dflt = 0) {
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? dflt : n;
}

function bboxFromShape(spPr) {
  const xfrm = spPr && spPr['a:xfrm'];
  const off = xfrm && xfrm['a:off'];
  const ext = xfrm && xfrm['a:ext'];
  if (!off || !ext) return null;
  return { x: intAttr(off['@_x']), y: intAttr(off['@_y']), w: intAttr(ext['@_cx']), h: intAttr(ext['@_cy']) };
}

function anchorRowCol(anchor) {
  const from = anchor['xdr:from'] || {};
  const to = anchor['xdr:to'] || from;
  return {
    fromCol: intAttr(from['xdr:col']) + 1,
    fromRow: intAttr(from['xdr:row']) + 1,
    toCol: intAttr(to['xdr:col']) + 1,
    toRow: intAttr(to['xdr:row']) + 1
  };
}

function pickEllipse(anchor) {
  const sp = anchor['xdr:sp'];
  if (!sp) return null;
  const spPr = sp['xdr:spPr'];
  const geom = spPr && spPr['a:prstGeom'];
  if (!geom || geom['@_prst'] !== 'ellipse') return null;
  const bbox = bboxFromShape(spPr);
  if (!bbox) return null;
  // 默认黄色 / 1.5px 线宽（很多模板里 ln 元素缺失颜色，按 Excel 默认 highlight 走）
  let color = 'FFFF00';
  let lineWidth = 19050;
  const ln = spPr['a:ln'];
  if (ln) {
    if (ln['@_w']) lineWidth = intAttr(ln['@_w'], lineWidth);
    const sf = ln['a:solidFill'];
    if (sf && sf['a:srgbClr'] && sf['a:srgbClr']['@_val']) {
      color = sf['a:srgbClr']['@_val'];
    }
  }
  return { ...bbox, color, lineWidth };
}

function pickPic(anchor) {
  const pic = anchor['xdr:pic'];
  if (!pic) return null;
  const blipFill = pic['xdr:blipFill'];
  const blip = blipFill && blipFill['a:blip'];
  const rEmbed = blip && (blip['@_r:embed'] || blip['@_xmlns:r'] && blip['@_r:embed']);
  if (!rEmbed) return null;
  const spPr = pic['xdr:spPr'];
  const bbox = bboxFromShape(spPr);
  if (!bbox) return null;
  const rc = anchorRowCol(anchor);
  return { ...bbox, rEmbed, ...rc };
}

async function parseDrawing(zip, drawingPath) {
  const file = zip.file(drawingPath);
  if (!file) return { pics: [], ellipses: [] };
  const xml = await file.async('string');
  const data = parser.parse(xml);
  const wsDr = data['xdr:wsDr'] || data.wsDr || {};
  const anchors = [
    ...asArray(wsDr['xdr:twoCellAnchor']),
    ...asArray(wsDr['xdr:oneCellAnchor']),
    ...asArray(wsDr['xdr:absoluteAnchor'])
  ];
  const pics = [], ellipses = [];
  for (const a of anchors) {
    const e = pickEllipse(a); if (e) ellipses.push(e);
    const p = pickPic(a); if (p) pics.push(p);
  }
  return { pics, ellipses };
}

async function parseRels(zip, relsPath) {
  const f = zip.file(relsPath);
  if (!f) return {};
  const xml = await f.async('string');
  const data = parser.parse(xml);
  const out = {};
  asArray(data.Relationships && data.Relationships.Relationship).forEach(r => {
    out[r['@_Id']] = r['@_Target'];
  });
  return out;
}

async function listSheetDrawings(zip) {
  const wbFile = zip.file('xl/workbook.xml');
  if (!wbFile) return [];
  const wb = parser.parse(await wbFile.async('string'));
  const sheetList = asArray(wb.workbook && wb.workbook.sheets && wb.workbook.sheets.sheet)
    .map(s => ({
      name: s['@_name'],
      sheetId: s['@_sheetId'],
      state: s['@_state'],
      rIdInWb: s['@_r:id']
    }));
  const wbRels = await parseRels(zip, 'xl/_rels/workbook.xml.rels');
  const out = [];
  for (const s of sheetList) {
    const target = wbRels[s.rIdInWb];
    if (!target) continue;
    const sheetPath = path.posix.normalize('xl/' + target);
    const sheetFile = zip.file(sheetPath);
    if (!sheetFile) continue;
    const sheetData = parser.parse(await sheetFile.async('string'));
    const drawingEl = sheetData.worksheet && sheetData.worksheet.drawing;
    if (!drawingEl) continue;
    const drawingRId = drawingEl['@_r:id'];
    const sheetDir = path.posix.dirname(sheetPath);
    const baseName = path.posix.basename(sheetPath);
    const sheetRelsPath = `${sheetDir}/_rels/${baseName}.rels`;
    const sheetRels = await parseRels(zip, sheetRelsPath);
    const drawingTarget = sheetRels[drawingRId];
    if (!drawingTarget) continue;
    const drawingPath = path.posix.normalize(sheetDir + '/' + drawingTarget);
    out.push({ sheetName: s.name, sheetId: s.sheetId, state: s.state, drawingPath });
  }
  return out;
}

function ellipseInPic(pic, ell) {
  const cx = ell.x + ell.w / 2;
  const cy = ell.y + ell.h / 2;
  return cx >= pic.x && cx <= pic.x + pic.w && cy >= pic.y && cy <= pic.y + pic.h;
}

async function annotateBuffer(imageBuffer, pic, ellipses) {
  try {
    const meta = await sharp(imageBuffer).metadata();
    const pxW = meta.width, pxH = meta.height;
    if (!pxW || !pxH) return imageBuffer;
    const items = ellipses.map(e => {
      const px = ((e.x - pic.x) / pic.w) * pxW;
      const py = ((e.y - pic.y) / pic.h) * pxH;
      const pw = (e.w / pic.w) * pxW;
      const ph = (e.h / pic.h) * pxH;
      const cx = px + pw / 2;
      const cy = py + ph / 2;
      const rx = Math.max(1, Math.abs(pw / 2));
      const ry = Math.max(1, Math.abs(ph / 2));
      const stroke = Math.max(3, Math.round(Math.min(pxW, pxH) / 150));
      return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" stroke="#${e.color}" stroke-width="${stroke}" fill="none"/>`;
    });
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pxW}" height="${pxH}">${items.join('')}</svg>`;
    return await sharp(imageBuffer)
      .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
      .png()
      .toBuffer();
  } catch (e) {
    console.warn('[xlsx-images annotate] failed:', e.message);
    return imageBuffer;
  }
}

export async function extractAnnotatedImages(xlsxBuffer) {
  const zip = await JSZip.loadAsync(xlsxBuffer);
  const sheetDrawings = await listSheetDrawings(zip);
  const out = [];
  for (const sd of sheetDrawings) {
    if (sd.state === 'hidden' || sd.state === 'veryHidden') continue;
    const { pics, ellipses } = await parseDrawing(zip, sd.drawingPath);
    if (pics.length === 0) continue;
    const drawingDir = path.posix.dirname(sd.drawingPath);
    const drawingBase = path.posix.basename(sd.drawingPath);
    const drawingRels = await parseRels(zip, `${drawingDir}/_rels/${drawingBase}.rels`);
    for (const pic of pics) {
      const target = drawingRels[pic.rEmbed];
      if (!target) continue;
      const imgPath = path.posix.normalize(drawingDir + '/' + target);
      const imgFile = zip.file(imgPath);
      if (!imgFile) continue;
      let buf = await imgFile.async('nodebuffer');
      let extension = (path.extname(imgPath).slice(1) || 'png').toLowerCase();
      if (extension === 'jpg') extension = 'jpeg';
      const overlapping = ellipses.filter(e => ellipseInPic(pic, e));
      if (overlapping.length > 0) {
        buf = await annotateBuffer(buf, pic, overlapping);
        extension = 'png'; // annotateBuffer 输出 PNG（保留 alpha & 颜色精度）
      }
      out.push({
        sheetName: sd.sheetName,
        extension,
        buffer: buf,
        fromRow: pic.fromRow,
        toRow: pic.toRow,
        fromCol: pic.fromCol,
        toCol: pic.toCol,
        annotationCount: overlapping.length
      });
    }
  }
  return out;
}
