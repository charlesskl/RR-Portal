'use strict';
const PizZip = require('pizzip');
const fs = require('fs');
const cp = require('child_process');

const buf = fs.readFileSync('./templates/TOMY-A-DOC-template.docx');
const zip = new PizZip(buf);
let xml = zip.file('word/document.xml').asText();

function anchorImageXml(rId, cx, cy, id, name, hOff, vOff) {
  return `<w:r><w:rPr><w:noProof/></w:rPr><w:drawing>`
    + `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="251658240" behindDoc="1" locked="1" layoutInCell="1" allowOverlap="1" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">`
    + `<wp:simplePos x="0" y="0"/>`
    + `<wp:positionH relativeFrom="column"><wp:posOffset>${hOff}</wp:posOffset></wp:positionH>`
    + `<wp:positionV relativeFrom="line"><wp:posOffset>${vOff}</wp:posOffset></wp:positionV>`
    + `<wp:extent cx="${cx}" cy="${cy}"/>`
    + `<wp:effectExtent l="0" t="0" r="0" b="0"/>`
    + `<wp:wrapNone/>`
    + `<wp:docPr id="${id}" name="${name}"/>`
    + `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>`
    + `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">`
    + `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">`
    + `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">`
    + `<pic:nvPicPr><pic:cNvPr id="${id}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr>`
    + `<pic:blipFill><a:blip r:embed="${rId}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>`
    + `</pic:pic></a:graphicData></a:graphic>`
    + `</wp:anchor></w:drawing></w:r>`;
}

// Remove old anchor image runs (both inline and anchor)
const oldMark = '<w:r><w:rPr><w:noProof/></w:rPr><w:drawing>';
let oldStart = xml.indexOf(oldMark);
while (oldStart !== -1) {
  const runEnd = xml.indexOf('</w:drawing></w:r>', oldStart) + 18;
  xml = xml.slice(0, oldStart) + xml.slice(runEnd);
  oldStart = xml.indexOf(oldMark);
}
console.log('Removed old image runs');

// Insert anchors before </w:p> of the Signed & Company chop paragraph
const signedIdx = xml.indexOf('Signed &amp; Company chop');
const pEnd = xml.indexOf('</w:p>', signedIdx);

// 1cm = 360000 EMU
// personAnchor: on the underline after "Signed & Company chop：" (~6cm from left)
// companyAnchor: on the underline after "Signed Date：" (~14.5cm from left)
const personAnchor  = anchorImageXml('rId8', 900000, 540000, 10, 'seal_person',  2660000, -180000);
const companyAnchor = anchorImageXml('rId9', 720000, 720000, 11, 'seal_company', 6100000, -250000);

xml = xml.slice(0, pEnd) + personAnchor + companyAnchor + xml.slice(pEnd);
console.log('Inserted anchor images');

zip.file('word/document.xml', xml);
const out = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
fs.writeFileSync('./templates/TOMY-A-DOC-template.docx', out);
cp.execSync('cp ./templates/TOMY-A-DOC-template.docx ../dist/templates/TOMY-A-DOC-template.docx');
console.log('Done');
