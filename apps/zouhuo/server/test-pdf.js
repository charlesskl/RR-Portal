const { parseTomyPDF } = require('./utils/pdfParser');
const fs = require('fs');

const buf = fs.readFileSync('C:/Users/Administrator/Desktop/E73622A_202603041535.pdf');
parseTomyPDF(buf).then(records => {
  console.log(`Total records: ${records.length}`);
  // Show YNGP087 (black ink PAF-10617) records
  const p087 = records.filter(r => r.materialCode.includes('087'));
  console.log('\n=== YNGP087 (black ink PAF-10617) records ===');
  p087.forEach((r, i) => {
    console.log(`${i+1}. "${r.substanceName.substring(0,40)}" CAS=${r.casNumber} concProd=${r.concProduct} concHM=${r.concHM} desc="${r.materialDescription}"`);
  });

  // Show first 3 records
  console.log('\n=== First 3 records ===');
  records.slice(0, 3).forEach((r, i) => {
    console.log(`${i+1}. "${r.substanceName.substring(0,40)}" CAS=${r.casNumber}`);
    console.log(`   concProd=${r.concProduct} concHM=${r.concHM}`);
    console.log(`   mat=${r.materialCode} desc="${r.materialDescription}"`);
  });

  // List unique materials
  const mats = [...new Set(records.map(r => `${r.materialCode}|${r.materialDescription}`))];
  console.log(`\n=== Unique materials (${mats.length}) ===`);
  mats.slice(0, 20).forEach(m => console.log(m));
}).catch(console.error);
