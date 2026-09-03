'use strict';

const { parseSheets } = require('./parseHardwareSheet');

const normalize = value => String(value || '').replace(/\s+/g, '').toUpperCase();

function groupByY(items, tolerance = 2.5) {
  const lines = [];
  [...items].sort((a, b) => b.y - a.y || a.x - b.x).forEach(item => {
    let line = lines.find(candidate => Math.abs(candidate.y - item.y) <= tolerance);
    if (!line) {
      line = { y: item.y, items: [] };
      lines.push(line);
    }
    line.items.push(item);
  });
  return lines.sort((a, b) => b.y - a.y).map(line => ({
    ...line,
    items: line.items.sort((a, b) => a.x - b.x),
  }));
}

function clusterHeader(items) {
  const clusters = [];
  [...items].sort((a, b) => a.x - b.x).forEach(item => {
    let cluster = clusters.find(value => Math.abs(value.x - item.x) < 28);
    if (!cluster) {
      cluster = { x: item.x, items: [] };
      clusters.push(cluster);
    }
    cluster.items.push(item);
  });
  return clusters.sort((a, b) => a.x - b.x).map(cluster => ({
    x: cluster.x,
    text: cluster.items.sort((a, b) => b.y - a.y || a.x - b.x).map(item => item.text).join(''),
  }));
}

function rowsFromPage(pageItems) {
  const lines = groupByY(pageItems);
  const moqLine = lines.find(line => line.items.some(item => /MOQ/.test(normalize(item.text))));
  if (!moqLine) return [];

  // PDF 从 Excel 导出时表头常被拆成 2–3 行，按横坐标合并回各列。
  const headerItems = pageItems.filter(item => Math.abs(item.y - moqLine.y) <= 8);
  const headers = clusterHeader(headerItems).filter(header => header.text);
  if (headers.length < 4) return [];
  const moqIndex = headers.findIndex(header => /MOQ/.test(normalize(header.text)));
  if (moqIndex < 0) return [];

  const boundaries = headers.map((header, index) => index === 0
    ? -Infinity
    : (headers[index - 1].x + header.x) / 2);
  boundaries.push(Infinity);
  const columnForX = x => Math.max(0, Math.min(headers.length - 1,
    boundaries.findIndex((boundary, index) => index < boundaries.length - 1 && x >= boundary && x < boundaries[index + 1])));

  const headerBottom = Math.min(...headerItems.map(item => item.y));
  const dataItems = pageItems.filter(item => item.y < headerBottom - 3);
  const dataLines = groupByY(dataItems);
  const moqLeft = boundaries[moqIndex];
  const moqRight = boundaries[moqIndex + 1];
  const tierYs = dataLines
    .filter(line => line.items.some(item => item.x >= moqLeft && item.x < moqRight && /\d/.test(item.text)))
    .map(line => line.y);
  if (!tierYs.length) return [];
  const rowGaps = tierYs.slice(1).map((y, index) => tierYs[index] - y).filter(gap => gap > 0);
  const typicalGap = rowGaps.length ? rowGaps.sort((a, b) => a - b)[Math.floor(rowGaps.length / 2)] : 16;

  const rows = [];
  const headerRow = [];
  headers.forEach((header, index) => { headerRow[index + 1] = header.text; });
  rows.push(headerRow);

  tierYs.forEach((y, index) => {
    const upper = index === 0 ? moqLine.y - 15 : (tierYs[index - 1] + y) / 2;
    const lower = index === tierYs.length - 1 ? y - typicalGap / 2 : (y + tierYs[index + 1]) / 2;
    const cells = Array.from({ length: headers.length }, () => []);
    dataItems.filter(item => item.y < upper && item.y >= lower).forEach(item => {
      cells[columnForX(item.x)].push(item);
    });
    const row = [];
    cells.forEach((cell, cellIndex) => {
      row[cellIndex + 1] = cell.sort((a, b) => b.y - a.y || a.x - b.x).map(item => item.text).join(' ').trim();
    });
    rows.push(row);
  });
  return rows;
}

async function extractPages(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await pdfjs.getDocument({ data: new Uint8Array(buffer), useWorkerFetch: false }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.filter(item => item.str && item.str.trim()).map(item => ({
      text: item.str.trim(),
      x: item.transform[4],
      y: item.transform[5],
    })));
  }
  return pages;
}

async function parsePdf(buffer, options = {}) {
  try {
    const pages = await extractPages(buffer);
    const sheets = pages.map((items, index) => ({ name: `PDF 第 ${index + 1} 页`, rows: rowsFromPage(items) }))
      .filter(sheet => sheet.rows.length);
    if (!sheets.length) {
      return { error: '未识别到可读取的供应商报价表格。请上传由 Excel 导出的文字型 PDF；扫描图片型 PDF 请先转为可搜索 PDF 或 Excel。' };
    }
    const result = await parseSheets(sheets, options);
    if (result.error) return result;
    return { ...result, source_format: 'pdf' };
  } catch (error) {
    return { error: `PDF 解析失败：${error.message}` };
  }
}

module.exports = { parsePdf, rowsFromPage };
