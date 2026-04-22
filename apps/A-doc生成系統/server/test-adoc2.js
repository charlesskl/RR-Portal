const { parseTomyPDF } = require('./utils/pdfParser');
const { generateAdoc } = require('./utils/adocGenerator');
const fs = require('fs');
const buf = fs.readFileSync('C:/Users/Administrator/Desktop/TOMY A-DOC Ver 03-black ink PAF-10617-GLOBALITE.pdf');
parseTomyPDF(buf).then(records => {
  const filtered = records.filter(r => r.materialCode === 'PAF10617');
  console.log('records:', filtered.length);
  return generateAdoc(filtered, 'Royal Regent Products(H.K.)Limited RR02', 'black ink PAF-10617');
}).then(docBuf => {
  fs.writeFileSync('C:/Users/Administrator/Desktop/test-adoc2.docx', docBuf);
  console.log('done, size:', docBuf.length);
}).catch(e => console.error(e));
