'use strict';
const { generateAdoc } = require('./utils/adocGenerator');
const fs = require('fs');

const records = [
  { substanceName: 'Acetic acid ethenyl ester, polymer with chloroethene', casNumber: '9003-22-9', category: '[IRS-TOMY]:Canada Domestic Substances', concProduct: '0.0000935620', concHM: '0.2209', materialDescription: 'black ink PAF-10617' },
  { substanceName: 'Siloxanes and Silicones, di-Me', casNumber: '63148-62-9', category: '[IRS-TOMY]:Canada Domestic Substances', concProduct: '0.0001907243', concHM: '0.4503', materialDescription: 'black ink PAF-10617' },
  { substanceName: 'Cellulose, acetate butanoate', casNumber: '9004-36-8', category: '[IRS-TOMY]:Canada Domestic Substances', concProduct: '0.0007917408', concHM: '1.8693', materialDescription: 'black ink PAF-10617' },
  { substanceName: 'Carbon Black', casNumber: '1333-86-4', category: '[IRS-TOMY]:California Pro65', concProduct: '0.0019289708', concHM: '4.5543', materialDescription: 'black ink PAF-10617' },
  { substanceName: '2-Propenoic acid, 2-methyl-, butyl ester, polymer with methyl 2-methyl-2-propenoate', casNumber: '25608-33-7', category: '[IRS-TOMY]:Canada Domestic Substances', concProduct: '0.0004534519', concHM: '1.0706', materialDescription: 'black ink PAF-10617' },
  { substanceName: '2-butoxyethanol', casNumber: '111-76-2', category: '[IRS-TOMY]:USA Minnesota Toxic Free Kids Act', concProduct: '0.0043977975', concHM: '10.3832', materialDescription: 'black ink PAF-10617' },
];

generateAdoc(records, 'Royal Regent Products(H.K.)Limited RR02', 'black ink PAF-10617')
  .then(buf => {
    fs.writeFileSync('C:/Users/Administrator/Desktop/test-adoc3.docx', buf);
    console.log('OK size:', buf.length);
  })
  .catch(e => console.error('ERROR:', e.message, e.stack));
