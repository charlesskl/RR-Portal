'use strict';
const molds = require('../../frontend/mixed-molds');
const { calculateSingleQuoteCosts } = require('./quoteCostSummary');
const clone = x => JSON.parse(JSON.stringify(x));
function payloads(sections) {
  return Object.fromEntries(sections.map(s => [s.dept, JSON.parse(s.payload_json || '{}')]));
}
function getConfig(sections) { return payloads(sections).sales?.mixed_quote || null; }
function projectSections(sections, productId, quoteQty) {
  const cfg = getConfig(sections);
  const engineering = payloads(sections).engineering;
  return sections.map(section => {
    let root = JSON.parse(section.payload_json || '{}');
    if (section.dept === 'molding') root = molds.engineeringCatalog(root, engineering);
    if (section.dept === 'molding' && root.parts_catalog) {
      root = molds.applyCatalog(root, cfg, quoteQty);
    }
    let value = productId === '__shared__' ? root.mixed_shared || {} : root.mixed_products?.[productId] || {};
    if (section.dept === 'sales') {
      value = clone(root);
      delete value.mixed_quote;
      // 运费、模摊及附加费按销售包装计一次，小产品报价只含自身的部门费用。
      value.shipping = { ...value.shipping, scenarios: [] };
      value.pricing_summary = {};
    }
    if (section.dept === 'engineering') {
      value = clone(value);
      // 工程编辑器会生成一个空纸箱占位；未填尺寸不能产生 +2/+1 公式的虚假费用。
      if (value.carton_calc?.cartons) value.carton_calc.cartons = value.carton_calc.cartons.filter(box =>
        Number(box.cl) > 0 || Number(box.cw) > 0 || Number(box.ch) > 0);
    }
    return { ...section, payload_json: JSON.stringify(value) };
  });
}
function amortizedUsd(engineering, quoteQty) {
  const mc = engineering?.mold_costs || {};
  const total = (mc.items || []).reduce((n, item) => n + molds.number(item.price_rmb || 0, '模具费用'), 0);
  const moldFx = molds.number(mc.fx_rmb_usd ?? 7.75, '模费汇率', true);
  return (total / .85 / moldFx - molds.number(mc.customer_subsidy_usd || 0, '客户补贴模费'))
      / molds.number(mc.amortization_qty ?? (quoteQty || 1), '模费分摊数量', true)
    + molds.number(mc.prototype_fee_usd ?? mc.prototype_fee_rmb ?? 0, '手办费') / molds.number(mc.prototype_amortization_qty ?? 50000, '手办费分摊数量', true)
    + molds.number(mc.testing_fee_usd ?? mc.testing_fee_rmb ?? 0, '测试费') / molds.number(mc.testing_amortization_qty ?? 2000, '测试费分摊数量', true);
}
function calculateMixedQuote(quote, sections, { strict = false } = {}) {
  const data = payloads(sections), config = data.sales?.mixed_quote;
  if (!config?.enabled) return null;
  data.molding = molds.engineeringCatalog(data.molding || {}, data.engineering);
  const errors = [];
  try { molds.validateConfig(config); } catch (e) { errors.push(e.message); }
  const invalid = () => {
    if (strict) throw new Error(errors.join('；'));
    return { enabled: true, valid: false, errors, products: [], components: {}, hasSourceData: true, quotedPrice: 0 };
  };
  if (errors.length) return invalid();
  let molding;
  try { molding = molds.calculate(config, data.molding?.mixed_molds || [], quote.qty);
    if (data.molding?.parts_catalog) molds.catalogRows(data.molding, config, quote.qty); }
  catch (e) { errors.push(e.message); return invalid(); }
  const sales = data.sales, shipping = sales.shipping || {}, extra = sales.mixed_pricing || {};
  let fx, divisor, markup, surtaxMarkup, freight, amortization, surtax, fixedCharge, freightScenarios, selectedFreight;
  try {
    molds.number(sales.header?.fx_rmb_hkd ?? .85, 'RMB→HKD 汇率', true);
    fx = molds.number(sales.header?.fx_hkd_usd ?? 7.8, 'HKD→USD 汇率', true);
    divisor = molds.number(shipping.divisor ?? .98, '除数', true);
    markup = molds.number(shipping.markup_x ?? 1.2, '码点', true);
    surtaxMarkup = molds.number(shipping.surtax_markup_x ?? markup, '附加税码点');
    molds.number(shipping.sew_markup_x ?? markup, '车缝码点', true);
    molds.number(shipping.elec_markup_x ?? markup, '电子码点', true);
    fixedCharge = 0; // 附加税统一按可编辑税率计算，旧固定金额不再叠加。
    freightScenarios = require('./mixedFreight')(sales, data.engineering || {});
    selectedFreight = freightScenarios.find(s => s.key === (shipping.container_key || 'factory'));
    if (!selectedFreight || !selectedFreight.valid) throw new Error('请补齐所选货柜的箱规、容量和费用');
    freight = selectedFreight.total;
    amortization = molds.number(extra.amortization_usd ?? 0, '每包装模具、手办及测试摊费');
    surtax = molds.number(extra.surtax_pct ?? 0.4, '附加费百分比') / 100;
  } catch (e) { errors.push(e.message); return invalid(); }
  const taxMode = 'percent';
  const weights = molds.pricingWeights(config), units = Number(config.units_per_pack);
  const costUnits = config.na_direct ? 1 : units;
  const products = config.products.map(product => {
    const result = calculateSingleQuoteCosts(quote, projectSections(sections, product.id, quote.qty));
    const sharedLabor = data.molding?.parts_catalog ? 0 : molding.productCosts[product.id];
    result.components.injection_labor += sharedLabor;
    // 共模啤价也参与该款设置的印尼运费基数。
    const indo = sharedLabor * Number(data.molding?.mixed_products?.[product.id]?.indo_pct || 0) / 100;
    result.components.misc += indo;
    const base = result.rawQuotedPrice + (sharedLabor + indo) * markup;
    let productAmortization = 0;
    try { productAmortization = amortizedUsd(data.engineering?.mixed_products?.[product.id], quote.qty); }
    catch (e) { errors.push(`${product.code} ${e.message}`); }
    const hkd = base / divisor + productAmortization * fx;
    if (!result.hasSourceData && !sharedLabor && !productAmortization) errors.push(`${product.code} ${product.name} 尚未填写报价明细`);
    return { ...product, weight: weights[product.id], components: result.components,
      shared_labor: sharedLabor, amortization_usd: productAmortization, base_hkd: base, price_hkd: hkd, price_usd: hkd / fx };
  });
  const common = calculateSingleQuoteCosts(quote, projectSections(sections, '__shared__', quote.qty));
  const average = products.reduce((n, p) => n + p.price_usd * p.weight, 0);
  let commonAmortization = amortization;
  try { commonAmortization += amortizedUsd(data.engineering?.mixed_shared, quote.qty); }
  catch (e) { errors.push(`共有费用 ${e.message}`); }
  common.components.misc += fixedCharge;
  const commonUsd = (common.rawQuotedPrice + (freight + fixedCharge) * markup) / divisor / fx + commonAmortization;
  const beforeSurtax = average * costUnits + commonUsd;
  const surcharge = beforeSurtax * surtax * surtaxMarkup / divisor;
  const components = Object.fromEntries(Object.keys(common.components).map(key => [key,
    common.components[key] + products.reduce((n, p) => n + p.components[key] * p.weight * costUnits, 0)]));
  components.freight += selectedFreight.freight;
  components.cabinet += selectedFreight.cabinet;
  const result = { enabled: true, valid: errors.length === 0, errors, config, products, molds: molding.molds,
    average_usd: average, average_hkd: average * fx, units_per_pack: units, cost_units: costUnits,
    common_usd: commonUsd, common_components: common.components, freight_hkd: freight, amortization_usd: commonAmortization,
    before_surtax_usd: beforeSurtax, surcharge_usd: surcharge,
    final_usd: beforeSurtax + surcharge, final_hkd: (beforeSurtax + surcharge) * fx,
    // 汇总表沿用现有「HKD 码点后、除数前」口径；最终报客价在 final_usd。
    quotedPrice: +(products.reduce((n, p) => n + p.base_hkd * p.weight * costUnits, 0)
      + common.rawQuotedPrice + (freight + fixedCharge) * markup).toFixed(4),
    freight_scenarios: freightScenarios.map(s => ({ ...s, final_usd: (beforeSurtax + (s.total - freight) * markup / divisor / fx) * (1 + surtax * surtaxMarkup / divisor) })),
    selected_container: selectedFreight.key,
    components, hasSourceData: true, pricing: { fx, divisor, markup, surtax_markup: surtaxMarkup, tax_mode: taxMode, fixed_charge_hkd: fixedCharge, surtax_pct: surtax * 100 } };
  if (strict && errors.length) throw new Error(errors.join('；'));
  return result;
}
module.exports = { getConfig, projectSections, calculateMixedQuote, payloads };
