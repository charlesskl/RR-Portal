'use strict';
const PDFParser = require('pdf2json');
const fs = require('fs');

const filePath = process.argv[2] || 'C:/Users/Administrator/Desktop/E73635A_202602271412 (1)(1).pdf';
const buf = fs.readFileSync(filePath);

const parser = new PDFParser();
parser.on('pdfParser_dataError', console.error);
parser.on('pdfParser_dataReady', pdfData => {
  // Collect all text items from page 1 only
  const items = [];
  pdfData.Pages.slice(0, 2).forEach((page, pi) => {
    page.Texts.forEach(t => {
      const txt = t.R.map(r => { try { return decodeURIComponent(r.T); } catch { return r.T; } }).join('');
      if (txt.trim()) items.push({ x: +t.x.toFixed(2), y: +(t.y + pi * 200).toFixed(2), txt: txt.trim() });
    });
  });
  items.sort((a, b) => a.y - b.y || a.x - b.x);

  // Group into rows
  const rows = [];
  for (const item of items) {
    const row = rows.find(r => Math.abs(r.y - item.y) < 0.35);
    if (row) row.items.push(item);
    else rows.push({ y: item.y, items: [item] });
  }

  // Print first 40 rows with x positions
  console.log('=== First 40 rows (y | x:text ...) ===');
  rows.slice(0, 40).forEach(row => {
    const line = row.items.map(i => `[${i.x}]${i.txt}`).join('  ');
    console.log(`y=${row.y.toFixed(2)} | ${line}`);
  });
});
parser.parseBuffer(buf);
