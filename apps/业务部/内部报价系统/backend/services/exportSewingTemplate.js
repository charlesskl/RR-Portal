'use strict';

const ExcelJS = require('exceljs');

const FONT = 'Microsoft YaHei';
const YELLOW = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF99' } };
const DATE_YELLOW = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
const PRODUCT_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4D6' } };
const WHITE = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
const BORDER = {
  top: { style: 'thin', color: { argb: 'FF000000' } },
  left: { style: 'thin', color: { argb: 'FF000000' } },
  bottom: { style: 'thin', color: { argb: 'FF000000' } },
  right: { style: 'thin', color: { argb: 'FF000000' } },
};

const num = value => Number(value) || 0;
const sum = (rows, getter) => (rows || []).reduce((total, item) => total + num(getter(item)), 0);
const isLabor = item => /人工/.test(`${item && item.fabric || ''}${item && item.part || ''}${item && item.name || ''}`);
const groupQty = group => {
  const value = Number(group && group.product_qty);
  return Number.isFinite(value) && value >= 0 ? value : 1;
};

function laborToAdd(group) {
  const laborInItems = sum(group && group.items, item => isLabor(item)
    ? num(item.usage) * num(item.mat_price) * (num(item.markup) || 1)
    : 0);
  return laborInItems > 0 ? 0 : num(group && group.labor_amount);
}

function exportDateParts(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const get = type => parts.find(part => part.type === type)?.value || '';
  return { year: get('year'), month: get('month'), day: get('day') };
}

function styleCell(cell, options = {}) {
  cell.font = {
    name: FONT,
    size: options.size || 12,
    bold: options.bold !== false,
    color: { argb: options.color || 'FF000000' },
  };
  cell.fill = options.fill || WHITE;
  cell.border = BORDER;
  cell.alignment = {
    horizontal: options.align || 'center',
    vertical: 'middle',
    wrapText: options.wrap !== false,
  };
  if (options.numFmt) cell.numFmt = options.numFmt;
}

function styleRange(sheet, row, start, end, options = {}) {
  for (let column = start; column <= end; column += 1) {
    styleCell(sheet.getCell(row, column), options);
  }
}

function addImage(workbook, sheet, image, startRow, endRow) {
  const match = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(String(image || ''));
  if (!match) return;
  const extension = match[1].toLowerCase().startsWith('jp') ? 'jpeg' : 'png';
  const imageId = workbook.addImage({ base64: image, extension });
  sheet.addImage(imageId, {
    tl: { col: 0.08, row: startRow - 0.92 },
    br: { col: 0.92, row: Math.max(startRow, endRow) - 0.08 },
    editAs: 'oneCell',
  });
}

function buildDetailSheet(workbook, quote, sewing, suffix, exportDateText) {
  const sheetName = suffix ? `明细表${suffix}` : '明细表';
  const sheet = workbook.addWorksheet(sheetName);
  sheet.columns = [
    { width: 14 }, { width: 29 }, { width: 40 }, { width: 19 },
    { width: 14 }, { width: 13 }, { width: 13 }, { width: 10 },
    { width: 14 }, { width: 12 }, { width: 28 },
  ];

  styleRange(sheet, 1, 1, 11, { fill: YELLOW, size: 14 });
  sheet.mergeCells('A1:K1');
  sheet.getCell('A1').value = `${quote.product_name || quote.quote_no || ''}-明细表`;
  sheet.getRow(1).height = 38;

  styleRange(sheet, 2, 1, 11, { size: 12 });
  sheet.getCell('K2').value = `DATE:${exportDateText}`;
  sheet.getCell('K2').fill = DATE_YELLOW;
  sheet.getRow(2).height = 30;

  const mergedHeaders = [
    [1, '图片'], [2, '名称'], [3, '布料名称'], [4, '部位'], [5, '用量'],
    [6, '物料价（RMB）'], [7, '价钱（RMB）'], [8, '码点'], [9, '总价钱（RMB）'], [11, '备注'],
  ];
  styleRange(sheet, 3, 1, 11, { size: 13 });
  styleRange(sheet, 4, 1, 11, { size: 13 });
  mergedHeaders.forEach(([column, value]) => {
    sheet.mergeCells(3, column, 4, column);
    sheet.getCell(3, column).value = value;
  });
  sheet.getCell('J3').value = '布料';
  sheet.getCell('J4').value = 'MOQ';
  sheet.getRow(3).height = 31;
  sheet.getRow(4).height = 31;

  let row = 5;
  const totals = [];
  for (const group of sewing.sewing_groups || []) {
    const items = group.items || [];
    const productRow = row;
    styleRange(sheet, productRow, 1, 11, { size: 12 });
    sheet.getCell(productRow, 2).value = group.name || '';
    sheet.getCell(productRow, 2).fill = PRODUCT_FILL;
    sheet.getCell(productRow, 10).value = group.fabric_moq || sewing.fabric_moq || '';
    sheet.getRow(productRow).height = 37;
    row += 1;
    const start = row;
    let previousFabric = '';
    const groupResult = sum(items, item => num(item.usage) * num(item.mat_price) * (num(item.markup) || 1))
      + laborToAdd(group);

    if (!items.length) {
      previousFabric = '';
    } else {
      items.forEach((item) => {
        styleRange(sheet, row, 1, 11, { size: 12 });
        const fabric = item.fabric || item.name || '';
        sheet.getCell(row, 3).value = fabric === previousFabric ? '' : fabric;
        sheet.getCell(row, 4).value = item.part || '';
        sheet.getCell(row, 5).value = num(item.usage);
        sheet.getCell(row, 6).value = num(item.mat_price);
        sheet.getCell(row, 7).value = {
          formula: `E${row}*F${row}`,
          result: num(item.usage) * num(item.mat_price),
        };
        sheet.getCell(row, 8).value = num(item.markup) || 1;
        sheet.getCell(row, 9).value = {
          formula: `G${row}*H${row}`,
          result: num(item.usage) * num(item.mat_price) * (num(item.markup) || 1),
        };
        sheet.getCell(row, 11).value = [item.craft, item.note].filter(Boolean).join('；');
        [5, 6, 7].forEach(column => { sheet.getCell(row, column).numFmt = '0.0000'; });
        sheet.getCell(row, 8).numFmt = '0.00';
        sheet.getCell(row, 9).numFmt = '0.00';
        sheet.getCell(row, 3).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
        sheet.getCell(row, 11).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
        sheet.getRow(row).height = 37;
        if (fabric) previousFabric = fabric;
        row += 1;
      });
    }

    const end = row - 1;
    styleRange(sheet, row, 1, 11, { size: 12 });
    sheet.getCell(row, 8).value = '合计';
    sheet.getCell(row, 8).fill = DATE_YELLOW;
    const labor = laborToAdd(group);
    sheet.getCell(row, 9).value = {
      formula: items.length
        ? `SUM(I${start}:I${end})${labor ? `+${labor}` : ''}`
        : String(labor),
      result: groupResult,
    };
    sheet.getCell(row, 9).fill = DATE_YELLOW;
    sheet.getCell(row, 9).numFmt = '0.00';
    sheet.getRow(row).height = 30;
    totals.push({ row, result: groupResult, qty: groupQty(group), name: group.name || '' });
    addImage(workbook, sheet, group.product_image || group.image, productRow, Math.max(productRow, Math.min(end, productRow + 4)));
    row += 2;
  }

  if (totals.length > 1) {
    const weighted = totals.reduce((total, item) => total + item.result * item.qty, 0);
    const totalQty = totals.reduce((total, item) => total + item.qty, 0) || 1;
    styleRange(sheet, row, 1, 11, { fill: YELLOW, size: 12 });
    sheet.getCell(row, 8).value = `配套合计（总配比 ${totalQty}）`;
    sheet.getCell(row, 9).value = {
      formula: `(${totals.map(item => `I${item.row}*${item.qty}`).join('+')})/${totalQty}`,
      result: weighted / totalQty,
    };
    sheet.getCell(row, 9).numFmt = '0.00';
  }

  sheet.views = [{ state: 'frozen', ySplit: 4, showGridLines: false }];
  sheet.pageSetup = {
    paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    horizontalCentered: true,
    margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    printArea: `A1:K${sheet.rowCount}`,
    printTitlesRow: '3:4',
  };
  return { totals, sheetName };
}

function buildQuoteSheet(workbook, sheet, quote, section, sewing, detailSheetName, totals, exportDateText) {
  sheet.columns = [
    { width: 15 }, { width: 15 }, { width: 18 }, { width: 16 },
    { width: 16 }, { width: 46 }, { width: 45 },
  ];
  const mergeLine = (row, value, options = {}) => {
    styleRange(sheet, row, 1, 7, options);
    sheet.mergeCells(row, 1, row, 7);
    sheet.getCell(row, 1).value = value;
  };
  mergeLine(1, '东莞市华信兴服装有限公司', { size: 16 });
  mergeLine(2, '香港地址：九龙尖沙咀科学馆道1号康宏广场南座12字楼', { size: 12 });
  mergeLine(3, '电话：00852-24250720        传真：00852-24243407', { size: 12 });
  mergeLine(4, '国内地址：东莞市清溪上元银坑路10号', { size: 12 });
  mergeLine(5, '电话：0769-82018318   传真：0769-82189923', { size: 12 });
  mergeLine(6, '报价单', { fill: YELLOW, size: 16 });
  [1, 2, 3, 4, 5, 6].forEach(row => { sheet.getRow(row).height = 30; });

  styleRange(sheet, 7, 1, 7, { size: 12 });
  sheet.mergeCells('A7:C7');
  sheet.getCell('A7').value = `TO: ${quote.created_by_name || ''}`;
  sheet.getCell('G7').value = `FM:${section.reviewed_by || ''}`;
  styleRange(sheet, 8, 1, 7, { size: 12 });
  sheet.mergeCells('A8:C8');
  sheet.getCell('A8').value = `客人：${quote.customer || ''}`;
  sheet.getCell('F8').value = '机芯系列';
  sheet.getCell('G8').value = `DATE:${exportDateText}`;

  const headers = ['图片', '货号', '货品', '人民币报价', '10%含税', '内容', '备注'];
  styleRange(sheet, 9, 1, 7, { size: 12 });
  headers.forEach((header, index) => { sheet.getCell(9, index + 1).value = header; });

  const remarks = [
    '1.如原料升幅超过3%或人民币升幅超过2%，本司保留加价权。',
    '2.客户负责来板的法律责任，包括知识产权。',
    '3.除非产品价格全数清还，本公司仍拥有产品所有权。',
    '4.本司只负责车缝部分，不含任何包装。',
    '5.布料MOQ数量30K/款起，不够MOQ则重新报价。',
    '6.货物散装运送清溪兴信厂。',
    '7.此报价为看图报价，最终报价以客人确定签板为准。',
  ];
  const quoteStart = 10;
  const bodyRows = Math.max(totals.length, remarks.length, 1);
  for (let index = 0; index < bodyRows; index += 1) {
    const row = quoteStart + index;
    styleRange(sheet, row, 1, 7, { size: 12 });
    const total = totals[index];
    if (total) {
      sheet.getCell(row, 2).value = quote.quote_no || '';
      sheet.getCell(row, 3).value = total.name || quote.product_name || '';
      sheet.getCell(row, 4).value = { formula: `'${detailSheetName}'!I${total.row}`, result: total.result };
      sheet.getCell(row, 5).value = { formula: `D${row}*1.1`, result: total.result * 1.1 };
      sheet.getCell(row, 4).numFmt = '"￥"#,##0.00';
      sheet.getCell(row, 5).numFmt = '"￥"#,##0.00';
      const group = (sewing.sewing_groups || [])[index] || {};
      sheet.getCell(row, 6).value = group.quote_content || group.content || '';
      addImage(workbook, sheet, group.product_image || group.image, row, row);
    }
    sheet.getCell(row, 7).value = remarks[index] || '';
    sheet.getCell(row, 7).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    sheet.getRow(row).height = index === 0 ? 72 : 56;
  }
  const blankRow = quoteStart + totals.length;
  if (blankRow < quoteStart + bodyRows) sheet.getCell(blankRow, 4).value = '以下空白！';
  const footerRow = quoteStart + bodyRows + 1;
  styleRange(sheet, footerRow, 1, 7, { size: 12 });
  sheet.getCell(footerRow, 1).value = `报价：${section.reviewed_by || ''}`;
  sheet.getCell(footerRow, 7).value = '审核：';
  sheet.getRow(footerRow).height = 30;

  sheet.views = [{ showGridLines: false }];
  sheet.pageSetup = {
    paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 1,
    horizontalCentered: true,
    margins: { left: 0.25, right: 0.25, top: 0.35, bottom: 0.35, header: 0.2, footer: 0.2 },
    printArea: `A1:G${footerRow}`,
  };
}

async function buildSewingTemplateWorkbook({ quote, sections, exportDate = new Date() }) {
  const section = (sections || []).find(item => item.dept === 'sewing') || {};
  let sewing = {};
  try { sewing = JSON.parse(section.payload_json || '{}'); } catch {}
  if (!Array.isArray(sewing.sewing_groups) || !sewing.sewing_groups.length) {
    throw new Error('没有可导出的车缝资料');
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = '内部报价系统';
  workbook.calcProperties.fullCalcOnLoad = true;
  const { year, month, day } = exportDateParts(exportDate);
  const exportDateText = `${year}/${month}/${day}`;
  const suffix = `${Number(month)}-${Number(day)}`;
  const quoteSheet = workbook.addWorksheet(suffix ? `报价单${suffix}` : '报价单');
  const detail = buildDetailSheet(workbook, quote, sewing, suffix, exportDateText);
  buildQuoteSheet(workbook, quoteSheet, quote, section, sewing, detail.sheetName, detail.totals, exportDateText);
  return workbook;
}

module.exports = { buildSewingTemplateWorkbook };
