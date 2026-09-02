// 解析“五金/辅助材料/包装材料供应商报价单”型 xls/xlsx。
// 同时兼容旧表头（零件名称 / 用量 / 单价RMB）和统一供应商模板
//（产品编号&产品名称 / 规格描述 / MOQ / 人民币或 USD 阶梯价）。
const ExcelJS = require('exceljs');
const XLSX = require('xlsx');

function toStr(v) {
  if (v == null) return '';
  if (typeof v === 'object' && Array.isArray(v.richText)) return v.richText.map(x => x.text).join('').trim();
  if (typeof v === 'object' && v.text != null) return String(v.text).trim();
  if (typeof v === 'object' && v.result != null) return String(v.result).trim();
  return String(v).trim();
}

function toNum(v) {
  if (v == null || v === '') return null;
  const raw = typeof v === 'object' && v.result != null ? v.result : v;
  const n = Number(String(raw).replace(/[￥¥$,，\s元RMB]/gi, ''));
  return Number.isFinite(n) ? n : null;
}

function norm(v) {
  return toStr(v).replace(/\s+/g, '').toUpperCase();
}

function isHeader(row) {
  const text = (row || []).map(norm).join('|');
  const legacy = /(零件名称|零件名稱|PARTNAME)/.test(text)
    && /(用量|数量|數量|QTY|QUANTITY)/.test(text);
  const supplier = /(产品编号.*产品名称|產品編號.*產品名稱|PRODUCT.*NAME|ITEM.*NAME)/.test(text)
    && /MOQ/.test(text);
  return (legacy || supplier) && /(单价|單價|UNITPRICE)/.test(text);
}

function indexHeader(row) {
  const cols = {};
  (row || []).forEach((value, index) => {
    const s = norm(value);
    if (!s) return;
    if (cols.name == null && /(零件名称|零件名稱|PARTNAME|产品编号.*产品名称|產品編號.*產品名稱|PRODUCT.*NAME|ITEM.*NAME)/.test(s)) cols.name = index;
    else if (cols.spec == null && /(规格描述|規格描述|规格|規格|SPEC)/.test(s)) cols.spec = index;
    else if (cols.material == null && /(材料.*表面处理|材料.*表面處理|MATERIAL.*SURFACE)/.test(s)) cols.material = index;
    else if (cols.unit == null && /^(单位|單位|UNIT)$/.test(s)) cols.unit = index;
    else if (cols.moq == null && /MOQ/.test(s)) cols.moq = index;
    else if (cols.qty == null && /(用量|数量|數量|QTY|QUANTITY)/.test(s)) cols.qty = index;
    else if (cols.unitPriceUntaxed == null && /(单价.*元.*不含税|單價.*元.*不含稅|RMB.*EXCL)/.test(s)) cols.unitPriceUntaxed = index;
    else if (cols.unitPriceTaxed == null && /(单价.*元.*含税|單價.*元.*含稅|RMB.*INCL)/.test(s)) cols.unitPriceTaxed = index;
    else if (cols.unitPriceUsd == null && /(单价.*USD.*不含税|單價.*USD.*不含稅|USD.*EXCL)/.test(s)) cols.unitPriceUsd = index;
    else if (cols.unitPrice == null && /(单价RMB|單價RMB|RMB单价|RMB單價|UNITPRICE)/.test(s)) cols.unitPrice = index;
    else if (cols.note == null && /(备注|備註|REMARK)/.test(s)) cols.note = index;
    else if (cols.delivery == null && /(交期|LEADTIME|DELIVERY)/.test(s)) cols.delivery = index;
  });
  cols.supplierTemplate = cols.moq != null
    && (cols.unitPriceUntaxed != null || cols.unitPriceTaxed != null || cols.unitPriceUsd != null);
  return cols;
}

function parseMoq(value) {
  const text = toStr(value).replace(/,/g, '').toUpperCase();
  if (!text) return null;
  const match = text.match(/([\d.]+)\s*([K万]?)/);
  if (!match) return null;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;
  if (match[2] === 'K') return Math.round(base * 1000);
  if (match[2] === '万') return Math.round(base * 10000);
  return Math.round(base);
}

function chooseTier(tiers, targetQty, targetCurrency) {
  const currency = String(targetCurrency || '').toUpperCase();
  const priced = (tiers || []).filter(t => currency === 'USD'
    ? t.unit_price_usd != null
    : (currency === 'RMB' ? t.unit_price_rmb != null : (t.unit_price_rmb != null || t.unit_price_usd != null)));
  if (!priced.length) return null;
  const sorted = priced.slice().sort((a, b) => (a.moq_qty ?? 0) - (b.moq_qty ?? 0));
  const qty = Number(targetQty);
  const picked = !Number.isFinite(qty) || qty <= 0
    ? sorted[0]
    : (() => {
      const eligible = sorted.filter(t => t.moq_qty != null && t.moq_qty <= qty);
      return eligible.length ? eligible[eligible.length - 1] : sorted[0];
    })();
  const useUsd = currency === 'USD' || (currency !== 'RMB' && picked.unit_price_rmb == null && picked.unit_price_usd != null);
  const useTaxedRmb = !useUsd && picked.unit_price_rmb_untaxed == null && picked.unit_price_rmb_taxed != null;
  return {
    ...picked,
    unit_price_rmb: useUsd ? null : (useTaxedRmb ? picked.unit_price_rmb_taxed : picked.unit_price_rmb_untaxed),
    unit_price_usd: useUsd ? picked.unit_price_usd : null,
    source_currency: useUsd ? 'USD' : 'RMB',
    tax_pct: useUsd ? 0 : (useTaxedRmb ? 13 : 0),
    price_source: useUsd ? 'USD不含税' : (useTaxedRmb ? '人民币含税' : '人民币不含税'),
    price_type: useUsd ? 'USD_UNTAXED' : (useTaxedRmb ? 'RMB_TAXED' : 'RMB_UNTAXED'),
  };
}

function joinNote(parts) {
  return parts.filter(Boolean).join('；');
}

function sheetjsRows(sheet) {
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true }).map(row => {
    const values = [];
    (row || []).forEach((value, index) => { values[index + 1] = value; });
    return values;
  });
}

async function readSheets(buffer) {
  const sheets = [];
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    for (const sheet of workbook.worksheets || []) {
      const rows = [];
      sheet.eachRow({ includeEmpty: true }, row => {
        const values = [];
        row.eachCell({ includeEmpty: true }, (cell, column) => { values[column] = cell.value; });
        rows.push(values);
      });
      sheets.push({ name: sheet.name, rows });
    }
  } catch {}

  if (sheets.length) return sheets;
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  return workbook.SheetNames.map(name => ({ name, rows: sheetjsRows(workbook.Sheets[name]) }));
}

async function parseWorkbook(buffer, options = {}) {
  let sheets;
  try {
    sheets = await readSheets(buffer);
  } catch (error) {
    return { error: '解析失败：' + error.message };
  }
  if (!sheets.length) return { error: '工作簿为空' };

  let picked = null;
  let headerRow = -1;
  for (const sheet of sheets) {
    const index = sheet.rows.findIndex(isHeader);
    if (index >= 0) {
      picked = sheet;
      headerRow = index;
      break;
    }
  }
  if (!picked) return { error: '未找到五金表头（零件名称 / 用量 / 单价RMB）' };

  const cols = indexHeader(picked.rows[headerRow]);
  if (cols.name == null || (!cols.supplierTemplate && (cols.qty == null || cols.unitPrice == null))) {
    return { error: '表头字段不完整（需要 产品名称、MOQ 与单价，或旧版 零件名称 / 用量 / 单价RMB）' };
  }

  if (cols.supplierTemplate) {
    const groups = [];
    let current = null;
    let carried = { serial: '', name: '', spec: '', material: '', unit: '' };
    for (let index = headerRow + 1; index < picked.rows.length; index += 1) {
      const row = picked.rows[index] || [];
      const rowText = row.map(toStr).join('|');
      if (/备注说明|供应商签章|供應商簽章/.test(rowText)) break;

      const rawSerial = toStr(row[1]);
      const rawName = toStr(row[cols.name]);
      const rawSpec = cols.spec == null ? '' : toStr(row[cols.spec]);
      const rawMaterial = cols.material == null ? '' : toStr(row[cols.material]);
      const rawUnit = cols.unit == null ? '' : toStr(row[cols.unit]);
      const moqText = toStr(row[cols.moq]);
      const untaxed = cols.unitPriceUntaxed == null ? null : toNum(row[cols.unitPriceUntaxed]);
      const taxed = cols.unitPriceTaxed == null ? null : toNum(row[cols.unitPriceTaxed]);
      const usd = cols.unitPriceUsd == null ? null : toNum(row[cols.unitPriceUsd]);
      const hasContent = rawSerial || rawName || rawSpec || rawMaterial || rawUnit || moqText
        || untaxed != null || taxed != null || usd != null;
      if (!hasContent) continue;

      // 部分供应商会给同一物料的每个 MOQ 档都填独立序号；名称和规格相同的连续行
      // 仍应合并成一个物料的阶梯价，不能因序号不同拆成多个单选档。
      const repeatsCurrentProduct = !!(current && rawName && rawName === current.name
        && (!rawSpec || !current.spec || rawSpec === current.spec)
        && (!rawMaterial || !current.material || rawMaterial === current.material));
      const startsProduct = !repeatsCurrentProduct && !!(rawSerial || (rawName && rawName !== carried.name));
      if (startsProduct) {
        carried = {
          serial: rawSerial || carried.serial,
          name: rawName || carried.name,
          spec: rawSpec || '',
          material: rawMaterial || '',
          unit: rawUnit || '',
        };
        current = {
          ...carried,
          note: cols.note == null ? '' : toStr(row[cols.note]),
          delivery_days: cols.delivery == null ? '' : toStr(row[cols.delivery]),
          tiers: [],
        };
        groups.push(current);
      } else {
        carried = {
          serial: carried.serial,
          name: rawName || carried.name,
          spec: rawSpec || carried.spec,
          material: rawMaterial || carried.material,
          unit: rawUnit || carried.unit,
        };
        if (!current && carried.name) {
          current = { ...carried, note: '', delivery_days: '', tiers: [] };
          groups.push(current);
        }
      }
      if (!current) continue;
      if (!current.spec && carried.spec) current.spec = carried.spec;
      if (!current.material && carried.material) current.material = carried.material;
      if (!current.unit && carried.unit) current.unit = carried.unit;
      const rowNote = cols.note == null ? '' : toStr(row[cols.note]);
      const rowDelivery = cols.delivery == null ? '' : toStr(row[cols.delivery]);
      if (rowNote) current.note = rowNote;
      if (rowDelivery) current.delivery_days = rowDelivery;

      if (untaxed != null || taxed != null || usd != null) {
        current.tiers.push({
          moq: moqText,
          moq_qty: parseMoq(moqText),
          unit_price_rmb: untaxed ?? taxed,
          unit_price_rmb_untaxed: untaxed,
          unit_price_rmb_taxed: taxed,
          unit_price_usd: usd,
          rmb_tax_pct: taxed != null && untaxed == null ? 13 : 0,
          rmb_price_source: untaxed != null ? '人民币不含税' : (taxed != null ? '人民币含税' : null),
          source_row: index + 1,
        });
      }
    }

    const items = groups.map(group => {
      const tier = chooseTier(group.tiers, options.targetQty, options.targetCurrency);
      if (!group.name || !tier) return null;
      const spec = [group.spec, group.material ? `材料/表面处理：${group.material}` : ''].filter(Boolean).join('；');
      return {
        name: group.name,
        spec,
        qty: 1,
        unit_price_rmb: tier.unit_price_rmb,
        unit_price_usd: tier.unit_price_usd,
        source_currency: tier.source_currency,
        price_type: tier.price_type,
        tax_pct: tier.tax_pct,
        note: joinNote([
          group.note,
          group.unit ? `单位：${group.unit}` : '',
          tier.moq ? `适用MOQ：${tier.moq}` : '',
          group.delivery_days ? `交期：${group.delivery_days}天` : '',
          `价格来源：${tier.price_source}`,
        ]),
        unit: group.unit,
        moq: tier.moq,
        moq_qty: tier.moq_qty,
        delivery_days: group.delivery_days,
        material_surface: group.material,
        price_source: tier.price_source,
        price_tiers: group.tiers,
      };
    }).filter(Boolean);

    if (!items.length) return { error: '未解析到带价格的供应商报价明细' };
    return {
      items,
      count: items.length,
      sheet_used: picked.name,
      header_row: headerRow + 1,
      template_type: 'supplier_quote',
      target_qty: Number(options.targetQty) || null,
      target_currency: options.targetCurrency || null,
    };
  }

  const items = [];
  for (let index = headerRow + 1; index < picked.rows.length; index += 1) {
    const row = picked.rows[index] || [];
    const name = toStr(row[cols.name]);
    const rowText = row.map(toStr).join('|');
    if (/^(合计|合計|小计|小計|总计|總計)/.test(name) || /^附[:：]/.test(name)) break;
    if (!name) continue;

    const qty = toNum(row[cols.qty]);
    const unitPrice = toNum(row[cols.unitPrice]);
    if (qty == null && unitPrice == null && /合计|合計|总计|總計/.test(rowText)) continue;

    items.push({
      name,
      spec: cols.spec == null ? '' : toStr(row[cols.spec]),
      qty: qty ?? 1,
      unit_price_rmb: unitPrice ?? 0,
      tax_pct: null,
      note: cols.note == null ? '' : toStr(row[cols.note]),
    });
  }

  if (!items.length) return { error: '未解析到五金明细行' };
  return { items, count: items.length, sheet_used: picked.name, header_row: headerRow + 1 };
}

module.exports = { parseWorkbook };
