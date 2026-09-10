'use strict';

const { ensureExplicitProductGroups, weightedRowsSum, weightedInjectionSum } = require('./productMix');

const MAT_CATEGORIES = ['吸塑', '胶袋', '彩盒/内咭', '电池', '产品利宝', '彩盒利宝', '电镀', '其他外购'];
const PAINT_KEYS = ['clamp', 'pad', 'roast', 'spray', 'edge', 'color', 'dip', 'oil', 'pp_water', 'uv'];

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sum(rows, getter) {
  return (rows || []).reduce((total, row) => total + num(getter(row)), 0);
}

function parseSections(sections) {
  const result = {};
  for (const section of sections || []) {
    try { result[section.dept] = JSON.parse(section.payload_json || '{}') || {}; }
    catch { result[section.dept] = {}; }
  }
  return result;
}

function hasValue(row, key) {
  return row && row[key] !== undefined && row[key] !== null && row[key] !== '';
}

function freeUnitHkd(row, fxRH, fxHU) {
  if (!row) return 0;
  if (row.source_currency === 'USD' || (hasValue(row, 'unit_price_usd') && !hasValue(row, 'unit_price_rmb'))) {
    return num(hasValue(row, 'unit_price_usd') ? row.unit_price_usd : row.unit_price_usd_raw) * fxHU;
  }
  if (hasValue(row, 'unit_price_rmb')) return num(row.unit_price_rmb) / fxRH;
  return num(row.unit_price);
}

function freeAmountHkd(row, fxRH, fxHU) {
  if (row && row.is_subtotal) return num(row.amount);
  if (Array.isArray(row && row.children) && row.children.length) {
    return sum(row.children, child => num(child.qty) * freeUnitHkd(child, fxRH, fxHU));
  }
  return num(row && row.qty) * freeUnitHkd(row, fxRH, fxHU);
}

function blowTotal(row) {
  const usage = hasValue(row, 'usage_qty') ? num(row.usage_qty) : 1;
  const material = hasValue(row, 'material_cost_hkd')
    ? num(row.material_cost_hkd)
    : num(row && row.weight_g) * num(row && row.material_price_lb) / 454;
  return (material + num(row && row.blow_labor) + num(row && row.flash))
    * (num(row && row.profit_x) || 1) * usage;
}

function sewingLaborToAdd(group) {
  const laborInItems = sum(group && group.items, item => /人工/.test(String(item.fabric || item.part || item.name || ''))
    ? num(item.usage) * num(item.mat_price) * (num(item.markup) || 1) : 0);
  return laborInItems > 0 ? 0 : num(group && group.labor_amount);
}

function calculateQuoteCosts(quote, sections) {
  const payloads = parseSections(sections);
  const eng = payloads.engineering || {};
  const mold = payloads.molding || {};
  const painting = payloads.painting || {};
  const assembly = payloads.assembly || {};
  const sales = payloads.sales || {};
  const slush = payloads.slush || {};
  const sewing = payloads.sewing || {};
  const electronic = payloads.electronic || {};
  const fxRH = num(sales.header && sales.header.fx_rmb_hkd) || 0.85;
  const fxHU = num(sales.header && sales.header.fx_hkd_usd) || 7.8;
  const electronicRows = electronic.electronics && electronic.electronics.length
    ? electronic.electronics : (eng.electronics || []);
  const hardwareRows = eng.hardware || [];
  const packagingRows = eng.packaging_materials || [];
  const auxiliaryRows = eng.aux_materials || [];
  const amount = row => freeAmountHkd(row, fxRH, fxHU);
  const electronicTotal = sum(electronicRows, amount);
  const hardwareTotal = sum(hardwareRows, amount);
  const packagingTotal = sum(packagingRows, amount);
  const auxiliaryTotal = sum(auxiliaryRows, amount);

  const loss = 1 + num(mold.injection_loss_pct == null ? 3 : mold.injection_loss_pct) / 100;
  const materialCost = row => num(row.weight_g) * loss * num(row.material_unit_price);
  const domesticMaterial = weightedInjectionSum(mold, row => /^(PVC|TPR|TPE)\b/i.test(String(row.material || '').trim()) ? materialCost(row) : 0);
  const importedMaterial = weightedInjectionSum(mold, row => {
    const material = String(row.material || '').trim();
    return material && !/^(PVC|TPR|TPE)\b/i.test(material) ? materialCost(row) : 0;
  });
  const absMaterial = weightedInjectionSum(mold, row => /^ABS\b/i.test(String(row.material || '').trim()) ? materialCost(row) : 0);
  const injectionLabor = weightedInjectionSum(mold, row => num(row.shot_price));
  const blow = sum(mold.blow_items, blowTotal);

  const paintingRows = painting.painting_items || painting.second_proc || [];
  ensureExplicitProductGroups(paintingRows);
  const paintingTotal = weightedRowsSum(painting, paintingRows, row => {
    if (row.price !== undefined) return num(row.price) * num(row.qty);
    return PAINT_KEYS.reduce((total, key) => total + num(row[`${key}_qty`]) * num(row[`${key}_unit`]), 0);
  });

  const slushTotal = sum(slush.slush_items, row => num(row.qty) * num(row.unit_price_hkd));
  const groupQty = group => hasValue(group, 'product_qty') ? Math.max(num(group.product_qty), 0) : 1;
  const sewingQty = hasValue(sewing, 'sewing_total_qty') && num(sewing.sewing_total_qty) > 0
    ? num(sewing.sewing_total_qty) : (sum(sewing.sewing_groups, groupQty) || 1);
  const sewingGroupAmount = group => sum(group.items, item => num(item.usage) * num(item.mat_price) * (num(item.markup) || 1)) + sewingLaborToAdd(group);
  const sewingTotalRmb = sum(sewing.sewing_groups, group => sewingGroupAmount(group) * groupQty(group)) / sewingQty;
  const sewingHairRmb = sum((sewing.sewing_groups || []).filter(group => group.category === '车发'), group => sewingGroupAmount(group) * groupQty(group)) / sewingQty;
  const sewingHair = sewingHairRmb / fxRH;
  const sewingCloth = (sewingTotalRmb - sewingHairRmb) / fxRH;

  const baseRate = num(assembly.assembly_base_rate == null ? (quote.factory_code === 'heyuan' ? 260 : 310) : assembly.assembly_base_rate);
  const stepTotal = groups => sum(groups, group => sum(group.steps, step => baseRate * num(step.count) * (num(group.team == null ? 1 : group.team) || 1) / Math.max(num(group.qty), 1)));
  const assemblyLabor = sum(assembly.assembly_labor, row => num(row.unit_price) * num(row.qty))
    + sum(assembly.packaging_labor, row => num(row.unit_price) * num(row.qty))
    + stepTotal(assembly.assembly_step_groups) + stepTotal(assembly.packaging_step_groups);

  const isMotor = text => /马达|motor/i.test(String(text || ''));
  const isBlister = text => /吸塑|blister/i.test(String(text || ''));
  const isGlueBag = text => /胶袋|胶代|poly\s?bag|pe\s?bag|opp\s?bag/i.test(String(text || ''));
  const rowMatches = (row, matcher) => matcher(row.name) || matcher(row.spec);
  const matchedTotal = (rows, matcher) => sum(rows, row => rowMatches(row, matcher) ? amount(row) : 0);
  const categoryOf = (row, table) => {
    if (MAT_CATEGORIES.includes(row.category)) return row.category;
    if (row.category === '利宝') return '产品利宝';
    if (rowMatches(row, isBlister)) return '吸塑';
    if (rowMatches(row, isGlueBag)) return '胶袋';
    if (rowMatches(row, text => /电池|battery/i.test(String(text || '')))) return '电池';
    if (rowMatches(row, text => /利宝|贴纸|libao|sticker/i.test(String(text || '')))) {
      return /彩盒|彩卡|内咭|内卡|背卡|包装|package|box/i.test(`${row.name || ''} ${row.spec || ''}`) ? '彩盒利宝' : '产品利宝';
    }
    if (rowMatches(row, text => /电镀|plating/i.test(String(text || '')))) return '电镀';
    if (rowMatches(row, text => /纸箱|carton/i.test(String(text || '')))) return null;
    return table === 'aux' ? '其他外购' : '彩盒/内咭';
  };
  const categoryTotal = category => sum(packagingRows, row => categoryOf(row, 'packaging') === category ? amount(row) : 0)
    + sum(auxiliaryRows, row => categoryOf(row, 'aux') === category ? amount(row) : 0);
  const motor = matchedTotal(hardwareRows, isMotor);
  const suction = categoryTotal('吸塑') + matchedTotal(electronicRows, isBlister) + matchedTotal(hardwareRows, isBlister);

  const carton = eng.carton_calc || {};
  const cartons = carton.cartons && carton.cartons.length ? carton.cartons : (carton.cl ? [{
    cl: carton.cl, cw: carton.cw, ch: carton.ch, qty: carton.qty,
    flat_cards: carton.flat_card ? [{ l: carton.cl, w: carton.cw, qty: 1 }] : [],
  }] : []);
  const paperRate = hasValue(carton, 'paper_rate') ? num(carton.paper_rate) : 2.75;
  const cartonHkd = cartons.reduce((total, box) => {
    const boxPrice = (num(box.cl) + num(box.cw) + 2) * (num(box.cw) + num(box.ch) + 1) * 2 * paperRate / 1000;
    const flatCards = sum(box.flat_cards, card => ((num(card.l) || num(box.cl)) + 1) * ((num(card.w) || num(box.cw)) + 1) * 2 / 1000 * (hasValue(card, 'qty') ? num(card.qty) : 1));
    return total + boxPrice / Math.max(num(box.qty), 1) + flatCards;
  }, 0);

  const indoFreight = (hardwareTotal + auxiliaryTotal + packagingTotal) * num(eng.indo_pct) / 100
    + sum(electronicRows, row => /^IC$/i.test(String(row.name || '').trim()) ? 0 : amount(row)) * num(electronic.indo_pct) / 100
    + (domesticMaterial + importedMaterial + injectionLabor + blow) * num(mold.indo_pct) / 100
    + slushTotal * num(slush.indo_pct) / 100
    + sewingTotalRmb / fxRH * num(sewing.indo_pct) / 100
    + paintingTotal * 0.3 * num(painting.indo_pct) / 100;
  const surtax = num(sales.pricing_summary && sales.pricing_summary.surtax);
  const scenario = (sales.shipping && sales.shipping.scenarios || []).find(item => !item.is_factory && /盐田.*40/i.test(item.name || ''))
    || (sales.shipping && sales.shipping.scenarios || []).find(item => !item.is_factory);
  const freightRate = num(scenario && scenario._freight_rate);
  const freightPct = sales.shipping?.freight_pct == null ? 48 : sales.shipping.freight_pct;
  const liftingPct = sales.shipping?.lifting_pct == null ? 52 : sales.shipping.lifting_pct;
  const freight = freightRate * num(freightPct) / 100;
  const cabinet = freightRate * num(liftingPct) / 100;

  const components = {
    injection_labor: injectionLabor, assembly_labor: assemblyLabor,
    painting_labor: paintingTotal * 0.7, paint_material: paintingTotal * 0.3,
    imp_mat: importedMaterial, dom_mat: domesticMaterial, blow, slush: slushTotal,
    sewing_hair: sewingHair, sewing_cloth: sewingCloth,
    hardware: hardwareTotal - motor, electronic: electronicTotal, motor, suction,
    glue_bag: categoryTotal('胶袋'), color_box: categoryTotal('彩盒/内咭'),
    battery: categoryTotal('电池'), libao: categoryTotal('产品利宝') + categoryTotal('彩盒利宝'),
    plating: categoryTotal('电镀'), other_buy: categoryTotal('其他外购'),
    carton: cartonHkd, freight, cabinet, misc: indoFreight, abs_material: absMaterial,
  };
  // 用明细行是否存在判断，而不是用金额是否非零；这样一张明确填写为 0 的新报价
  // 也会清掉旧快照，不会错误回退到历史 pricing_summary。
  const hasSourceData = [
    mold.injection, mold.blow_items, paintingRows, slush.slush_items,
    sewing.sewing_groups, electronicRows, hardwareRows, packagingRows, auxiliaryRows,
    assembly.assembly_labor, assembly.packaging_labor,
    assembly.assembly_step_groups, assembly.packaging_step_groups, cartons,
  ].some(rows => Array.isArray(rows) && rows.length > 0);
  const mainBase = domesticMaterial + importedMaterial + injectionLabor + blow + paintingTotal
    + hardwareTotal + packagingTotal + auxiliaryTotal + assemblyLabor + indoFreight + slushTotal + cartonHkd + surtax;
  const markup = hasValue(sales.shipping, 'markup_x') ? num(sales.shipping.markup_x) : 1.2;
  const sewingMarkup = hasValue(sales.shipping, 'sew_markup_x') ? num(sales.shipping.sew_markup_x) : markup;
  const electronicMarkup = hasValue(sales.shipping, 'elec_markup_x') ? num(sales.shipping.elec_markup_x) : markup;
  const quotedPrice = (mainBase + freight + cabinet) * markup + (sewingHair + sewingCloth) * sewingMarkup + electronicTotal * electronicMarkup;
  return { components, quotedPrice: hasSourceData ? +quotedPrice.toFixed(4) : 0, hasSourceData };
}

module.exports = { calculateQuoteCosts };
