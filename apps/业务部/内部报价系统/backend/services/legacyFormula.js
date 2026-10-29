'use strict';

const clone = value => JSON.parse(JSON.stringify(value));
const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const text = value => String(value ?? '').trim();

const COMPONENTS = [
  'imp_mat', 'dom_mat', 'blow', 'slush', 'sewing_hair', 'sewing_cloth', 'hardware',
  'electronic', 'motor', 'suction', 'glue_bag', 'color_box', 'battery', 'libao',
  'plating', 'flocking', 'other_buy', 'carton', 'freight', 'cabinet', 'misc', 'injection_labor',
  'painting_labor', 'paint_material', 'assembly_labor', 'abs_cost',
];

function sourceComponents(pricing = {}) {
  const result = Object.fromEntries(COMPONENTS.map(key => [key, 0]));
  for (const table of ['t1', 't2', 't3']) {
    for (const [key, value] of Object.entries(pricing[table] || {})) {
      if (Object.hasOwn(result, key)) result[key] = number(value);
    }
  }
  return result;
}

function legacyCategory(dept, name) {
  const label = text(name);
  if (dept === 'assembly') return 'assembly_labor';
  if (dept === 'painting') return /^油漆$/.test(label) ? 'paint_material' : 'painting_labor';
  if (dept === 'slush') return 'slush';
  if (dept === 'sewing') return /车发|毛发|假发/.test(label) ? 'sewing_hair' : 'sewing_cloth';
  if (dept === 'electronic') return /马达|motor/i.test(label) ? 'motor' : 'electronic';
  if (dept === 'molding') {
    if (/啤工/.test(label)) return 'injection_labor';
    return /PVC|TPR|TPE/i.test(label) ? 'dom_mat' : 'imp_mat';
  }
  if (/吊柜/.test(label)) return 'cabinet';
  if (/运费/.test(label)) return 'freight';
  if (/纸箱|carton/i.test(label)) return 'carton';
  if (/吸塑|blister/i.test(label)) return 'suction';
  if (/胶袋|poly\s?bag|pe\s?bag|opp\s?bag/i.test(label)) return 'glue_bag';
  if (/彩盒|彩卡|内咭|内卡|背卡|说明书|包装盒/i.test(label)) return 'color_box';
  if (/利宝|贴纸|sticker/i.test(label)) return 'libao';
  if (/电池|battery/i.test(label)) return 'battery';
  if (/植绒|flocking/i.test(label)) return 'flocking';
  if (/电镀|plating/i.test(label)) return 'plating';
  if (/马达|motor/i.test(label)) return 'motor';
  if (/电子|PCB|PACB|IC\b|线路板|喇叭/i.test(label)) return 'electronic';
  if (/五金|螺丝|螺母|弹簧|扭簧|金属|铁线|轴|介子|磁铁/.test(label)) return 'hardware';
  return 'other_buy';
}

function assemblyParameters(name, current) {
  const label = text(name).replace(/，/g, ',');
  const people = number(label.match(/(\d+(?:\.\d+)?)\s*人/i)?.[1]);
  const output = number(label.match(/(\d+(?:\.\d+)?)\s*(?:PCS|PＣS|件)/i)?.[1]);
  if (!(people > 0 && output > 0)) return null;
  return {
    people,
    team: 1,
    output,
    source_base_rate_hkd: current * output / people,
  };
}

function upgradeItem(dept, item, hasInjection) {
  const result = clone(item || {});
  const current = number(result.current_hkd);
  result.source_current_hkd = result.source_current_hkd == null ? current : result.source_current_hkd;
  result.cost_category = result.cost_category || legacyCategory(dept, result.name);
  if (hasInjection && (/^(料价|料金额)$/.test(text(result.name)) || /啤工/.test(text(result.name)))) {
    result.formula_kind = 'derived_from_injection';
    result.formula_expression = '由注塑明细自动计算';
    result.include_in_summary = false;
    return result;
  }
  if (dept === 'assembly') {
    const parameters = assemblyParameters(result.name, current);
    if (parameters) {
      Object.assign(result, parameters, {
        formula_kind: 'assembly_base_per_output',
        formula_expression: '核价基数 × 人数 × 小组 ÷ 生产量',
        include_in_summary: true,
      });
      return result;
    }
  }
  // Only link a source cell to the shared exchange rate when the importer has
  // verified both the formula and its referenced cell. Other cached Excel
  // results must not be presented as if their original formula were known.
  const rmbFormula = text(result.source_formula).match(/^=?\s*(\d+(?:\.\d+)?)\s*\/\s*\$?D\$?10\s*$/i);
  if (result.source_formula_basis === 'rmb_hkd' && rmbFormula) {
    result.formula_kind = 'rmb_divided_by_fx';
    result.formula_expression = '人民币金额 ÷ 统一人民币折港币';
    result.formula_rmb_value = number(rmbFormula[1]);
    result.include_in_summary = true;
    return result;
  }
  const sourceQuantity = number(result.quantity, 1);
  const quantity = sourceQuantity > 0 ? sourceQuantity : 1;
  result.formula_kind = 'quantity_x_unit';
  result.formula_expression = '数量 × 单价';
  result.formula_quantity = quantity;
  result.formula_unit_hkd = current / quantity;
  result.include_in_summary = true;
  return result;
}

function sourceDynamicComponents(payloads) {
  const components = Object.fromEntries(COMPONENTS.map(key => [key, 0]));
  const molding = payloads.molding || {};
  const loss = 1 + number(molding.injection_loss_pct, 3) / 100;
  for (const row of molding.injection || []) {
    const material = text(row.material);
    const materialCost = number(row.weight_g) * loss * number(row.material_unit_price);
    const category = /^(PVC|TPR|TPE)\b/i.test(material) ? 'dom_mat' : 'imp_mat';
    components[category] += materialCost;
    components.injection_labor += number(row.shot_price);
    if (/^ABS\b/i.test(material)) components.abs_cost += materialCost;
  }
  for (const [dept, payload] of Object.entries(payloads)) {
    for (const item of payload.legacy_items || []) {
      if (!item.include_in_summary) continue;
      const category = item.cost_category || legacyCategory(dept, item.name);
      if (Object.hasOwn(components, category)) components[category] += number(item.current_hkd);
    }
  }
  return components;
}

function upgradeLegacySectionsForCalculation(sections, rawBasis) {
  const prepared = (sections || []).map(section => ({ ...section, payload: clone(section.payload || {}) }));
  const payloads = Object.fromEntries(prepared.map(section => [section.dept, section.payload]));
  const sales = payloads.sales || {};
  if (sales.legacy_import?.formula_mode === 'excel_native_v1') return prepared;
  if (!sales.legacy_import?.summary_only && !sales.legacy_import?.formula_mode) return prepared;
  if (sales.legacy_import?.formula_mode === 'itemized_v1') return prepared;

  const hasInjection = Array.isArray(payloads.molding?.injection) && payloads.molding.injection.length > 0;
  for (const section of prepared) {
    if (!Array.isArray(section.payload.legacy_items)) continue;
    section.payload.legacy_items = section.payload.legacy_items.map(item => upgradeItem(section.dept, item, hasInjection));
  }

  const originalPricing = clone(sales.pricing_summary || {});
  const targets = sourceComponents(originalPricing);
  const dynamic = sourceDynamicComponents(payloads);
  const offsets = Object.fromEntries(COMPONENTS.map(key => [key, +(targets[key] - dynamic[key]).toFixed(12)]));
  const originalTotal = number(sales.legacy_import.source_cost_including_labor)
    || COMPONENTS.filter(key => key !== 'abs_cost').reduce((total, key) => total + targets[key], 0);
  const sourceComponentTotal = COMPONENTS.filter(key => key !== 'abs_cost')
    .reduce((total, key) => total + targets[key], 0);
  offsets.misc = +(offsets.misc + originalTotal - sourceComponentTotal).toFixed(12);
  const sourcePrice = number(originalPricing.t1?.base_price);
  sales.legacy_import = {
    ...sales.legacy_import,
    summary_only: false,
    formula_mode: 'itemized_v1',
    formula_version: 1,
    formula_components: COMPONENTS,
    formula_offsets: offsets,
    formula_markup_x: originalTotal > 0 ? sourcePrice / originalTotal : 1,
    formula_original_total: originalTotal,
    source_pricing_summary: originalPricing,
    formula_basis_version: rawBasis?.version || '',
  };
  return prepared;
}

// Itemized historical versions are live calculations. Never use current_hkd
// as the authoritative amount once a row carries editable formula parameters.
// The source snapshot and balancing offsets remain unchanged for comparison.
function calculateLegacyFormulaCosts(quote, payloads) {
  const sales = payloads.sales || {};
  const legacy = sales.legacy_import || {};
  if (legacy.formula_mode !== 'itemized_v1' || legacy.excel_model) return null;
  const components = Object.fromEntries(COMPONENTS.map(key => [key, number(legacy.formula_offsets?.[key])]));
  const add = (key, value) => {
    if (Object.hasOwn(components, key)) components[key] += number(value);
  };
  const molding = payloads.molding || {};
  const loss = 1 + number(molding.injection_loss_pct ?? 3) / 100;
  for (const row of molding.injection || []) {
    const material = text(row.material);
    const materialCost = number(row.weight_g) * loss * number(row.material_unit_price);
    add(/^(PVC|TPR|TPE)\b/i.test(material) ? 'dom_mat' : 'imp_mat', materialCost);
    add('injection_labor', number(row.shot_price));
    if (/^ABS\b/i.test(material)) add('abs_cost', materialCost);
  }
  const fx = number(sales.header?.fx_rmb_hkd) || 0.87;
  for (const [dept, payload] of Object.entries(payloads)) {
    for (const item of payload.legacy_items || []) {
      if (!item.include_in_summary) continue;
      let amount;
      if (item.formula_kind === 'rmb_divided_by_fx') amount = number(item.formula_rmb_value) / fx;
      else if (item.formula_kind === 'assembly_base_per_output') {
        const base = number(payload.assembly_base_rate ??
          (quote.factory_code === 'heyuan' ? 260 : 310));
        amount = base * number(item.people) * (number(item.team) || 1) / Math.max(number(item.output), 1);
      } else if (item.formula_kind === 'quantity_x_unit') {
        amount = number(item.formula_quantity) * number(item.formula_unit_hkd);
      } else amount = number(item.current_hkd);
      add(item.cost_category || (dept === 'assembly' ? 'assembly_labor' : 'other_buy'), amount);
    }
  }
  const total = COMPONENTS.filter(key => key !== 'abs_cost').reduce((sum, key) => sum + components[key], 0);
  const quotedPrice = total * (number(legacy.formula_markup_x) || 1);
  components.abs_material = components.abs_cost;
  return { components, quotedPrice, rawQuotedPrice: quotedPrice, hasSourceData: true,
    sewing_taxable: require('../../frontend/sewing-tax').taxableAmounts(payloads.sewing || {}, components, quote.customer) };
}

module.exports = {
  COMPONENTS,
  sourceComponents,
  legacyCategory,
  assemblyParameters,
  upgradeLegacySectionsForCalculation,
  calculateLegacyFormulaCosts,
};
