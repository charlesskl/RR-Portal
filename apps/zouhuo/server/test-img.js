'use strict';
const { ImageRun, Paragraph, Packer, Document } = require('docx');
const fs = require('fs');
const buf = fs.readFileSync('C:/Users/Administrator/zouhuo-system/server/templates/tomy-logo.jpeg');
console.log('logo size:', buf.length);
const doc = new Document({
  sections: [{
    children: [new Paragraph({
      children: [new ImageRun({ data: buf, transformation: { width: 100, height: 70 }, type: 'jpg' })],
    })],
  }],
});
Packer.toBuffer(doc)
  .then(b => { fs.writeFileSync('C:/Users/Administrator/Desktop/img-test.docx', b); console.log('img doc OK:', b.length); })
  .catch(e => console.error('img error:', e.message));
