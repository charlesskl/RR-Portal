const { getDb } = require('./db');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sum(arr, key) {
  return (arr || []).reduce((s, x) => s + (parseFloat(x[key]) || 0), 0);
}

/**
 * Parse machine tonnage string → { min, max }
 * e.g. "18A-20A" → { min: 18, max: 20 }
 *      "24A"     → { min: 24, max: 24 }
 *      "81.3A"   → { min: 81.3, max: 81.3 }
 */
function parseMachineTonnage(str) {
  if (!str) return null;
  const s = str.replace(/A/gi, '').trim();
  const parts = s.split('-');
  const min = parseFloat(parts[0]);
  const max = parts.length > 1 ? parseFloat(parts[1]) : min;
  if (isNaN(min)) return null;
  return { min, max };
}

/**
 * Look up machine price for a given machine type string.
 * Matches by checking if the requested tonnage falls within any price range.
 * Falls back to the closest range above if no exact range contains it.
 */
function lookupMachinePrice(machineType, machinePrices) {
  if (!machineType || !machinePrices || machinePrices.length === 0) return 0;

  const req = parseMachineTonnage(machineType);
  if (!req) return 0;
  const tonnage = req.min; // Use min of the requested type as the target

  // First: exact string match
  const exact = machinePrices.find(m => m.machine_type === machineType);
  if (exact) return exact.price_hkd || 0;

  // Second: find a range that contains the tonnage
  const containing = machinePrices.find(m => {
    const r = parseMachineTonnage(m.machine_type);
    return r && tonnage >= r.min && tonnage <= r.max;
  });
  if (containing) return containing.price_hkd || 0;

  // Third: find the smallest range whose min is >= requested tonnage (next tier up)
  const sorted = machinePrices
    .map(m => ({ ...m, _range: parseMachineTonnage(m.machine_type) }))
    .filter(m => m._range && m._range.min >= tonnage)
    .sort((a, b) => a._range.min - b._range.min);
  if (sorted.length > 0) return sorted[0].price_hkd || 0;

  // Fourth: largest range below (fallback)
  const below = machinePrices
    .map(m => ({ ...m, _range: parseMachineTonnage(m.machine_type) }))
    .filter(m => m._range)
    .sort((a, b) => b._range.max - a._range.max);
  return below.length > 0 ? (below[0].price_hkd || 0) : 0;
}

// ─── Per-Part Calculation ─────────────────────────────────────────────────────

function calcMoldPart(part, materialPrices, machinePrices) {
  // Material price lookup (normalized match)
  const partMat = (part.material || '').trim().toLowerCase();
  const mp = materialPrices.find(m => (m.material_type || '').trim().toLowerCase() === partMat);
  const unit_price_hkd_g = mp ? (mp.price_hkd_per_g || 0) : (part.unit_price_hkd_g || 0);

  // Material cost
  const weight = parseFloat(part.weight_g) || 0;
  const material_cost_hkd = weight * unit_price_hkd_g;

  return { unit_price_hkd_g, material_cost_hkd };
}

// ─── Body Cost Breakdown ──────────────────────────────────────────────────────

function calcBodyBreakdown(versionData) {
  const {
    mold_parts = [],
    hardware_items = [],
    painting_detail,
    electronic_summary,
    params = {},
  } = versionData;

  const markupBody = parseFloat(params.markup_body) || 0;

  // A. Raw Material — sum of material_cost_hkd from all mold parts
  const rawMaterialSub = sum(mold_parts, 'material_cost_hkd');
  const rawMaterialAmt = rawMaterialSub * (1 + markupBody);

  // B. Molding Labour — sum of molding_labor × 1.08
  const moldingLabourSub = mold_parts.reduce((s, p) => s + (parseFloat(p.molding_labor) || 0) * 1.08, 0);
  const moldingLabourAmt = moldingLabourSub * (1 + markupBody);

  // C. Purchase Parts — sum of new_price from hardware items (new = current price)
  const purchaseSub = sum(hardware_items, 'new_price');
  const purchaseAmt = purchaseSub * (1 + markupBody);

  // D. Decoration — labor + paint from painting detail
  const pd = painting_detail || {};
  const decorationSub = (parseFloat(pd.labor_cost_hkd) || 0) + (parseFloat(pd.paint_cost_hkd) || 0);
  const decorationAmt = decorationSub * (1 + markupBody);

  // E. Others — assembly labor + packaging labor (from labor items)
  // Labor items are embedded in hardware_items with names containing 人工
  // For now: use quoted_price_hkd from painting (covers misc labor) or 0
  const othersSub = 0; // TODO: pull from labor_items when separated
  const othersAmt = othersSub * (1 + markupBody);

  const totalBodyCost = rawMaterialAmt + moldingLabourAmt + purchaseAmt + decorationAmt + othersAmt;

  function pct(amt) {
    return totalBodyCost > 0 ? amt / totalBodyCost : 0;
  }

  return {
    rawMaterial:    { subTotal: rawMaterialSub,    markup: markupBody, amount: rawMaterialAmt,    pctToBody: pct(rawMaterialAmt) },
    moldingLabour:  { subTotal: moldingLabourSub,  markup: markupBody, amount: moldingLabourAmt,  pctToBody: pct(moldingLabourAmt) },
    purchaseParts:  { subTotal: purchaseSub,       markup: markupBody, amount: purchaseAmt,       pctToBody: pct(purchaseAmt) },
    decoration:     { subTotal: decorationSub,     markup: markupBody, amount: decorationAmt,     pctToBody: pct(decorationAmt) },
    others:         { subTotal: othersSub,         markup: markupBody, amount: othersAmt,         pctToBody: pct(othersAmt) },
    totalBodyCost,
  };
}

// ─── Transport Calculation ────────────────────────────────────────────────────

function calcTransport(transportConfig, pcsPerOrder) {
  if (!transportConfig) return {};
  const tc = transportConfig;
  const cuft = parseFloat(tc.cuft_per_box) || 0;
  const pcsPerBox = parseFloat(tc.pcs_per_box) || 1;

  function costPerPc(totalCuft, shippingCost, pcs) {
    if (!pcs || !cuft) return 0;
    const boxes = Math.ceil(pcs / pcsPerBox);
    const totalCuftNeeded = boxes * cuft;
    if (totalCuft <= 0) return 0;
    return (shippingCost / totalCuft) * cuftNeeded / pcs;
  }

  // Simplified: cost per piece for each route at given order qty
  const qty = pcsPerOrder || 2500;
  const boxes = Math.ceil(qty / pcsPerBox);
  const cuftNeeded = boxes * cuft;

  function perPc(containerCuft, shippingCost) {
    if (!containerCuft || !cuft) return null;
    return (shippingCost / containerCuft) * cuftNeeded / qty;
  }

  return {
    cuft_per_box: cuft,
    pcs_per_box: pcsPerBox,
    routes: {
      hk_40:  { cuft: tc.container_40_cuft, cost: tc.hk_40_cost,  per_pc: perPc(tc.container_40_cuft, tc.hk_40_cost) },
      hk_20:  { cuft: tc.container_20_cuft, cost: tc.hk_20_cost,  per_pc: perPc(tc.container_20_cuft, tc.hk_20_cost) },
      yt_40:  { cuft: tc.container_40_cuft, cost: tc.yt_40_cost,  per_pc: perPc(tc.container_40_cuft, tc.yt_40_cost) },
      yt_20:  { cuft: tc.container_20_cuft, cost: tc.yt_20_cost,  per_pc: perPc(tc.container_20_cuft, tc.yt_20_cost) },
      hk_10t: { cuft: tc.truck_10t_cuft,   cost: tc.hk_10t_cost, per_pc: perPc(tc.truck_10t_cuft, tc.hk_10t_cost) },
      yt_10t: { cuft: tc.truck_10t_cuft,   cost: tc.yt_10t_cost, per_pc: perPc(tc.truck_10t_cuft, tc.yt_10t_cost) },
      hk_5t:  { cuft: tc.truck_5t_cuft,    cost: tc.hk_5t_cost,  per_pc: perPc(tc.truck_5t_cuft, tc.hk_5t_cost) },
      yt_5t:  { cuft: tc.truck_5t_cuft,    cost: tc.yt_5t_cost,  per_pc: perPc(tc.truck_5t_cuft, tc.yt_5t_cost) },
    },
  };
}

// ─── VQ Summary ───────────────────────────────────────────────────────────────

function calcVqSummary(versionData, bodyBreakdown) {
  const {
    packaging_items = [],
    params = {},
    transport_config,
    mold_cost,
    product_dimension,
  } = versionData;

  const hkdUsd = parseFloat(params.hkd_usd) || 0.1291;
  const markupPkg = parseFloat(params.markup_packaging) || 0;
  const markupPoint = parseFloat(params.markup_point) || 1;
  const paymentDiv = parseFloat(params.payment_divisor) || 0.98;
  const surcharge = parseFloat(params.surcharge_pct) || 0.004;
  const boxPrice = parseFloat(params.box_price_hkd) || 0;

  // A. Body Cost
  const bodyCost = bodyBreakdown.totalBodyCost;

  // B. Packaging total (sum of new_price, add box price)
  const pkgItemsTotal = sum(packaging_items, 'new_price');
  const packagingTotal = (pkgItemsTotal + boxPrice) * (1 + markupPkg);

  // C. Purchase parts (from VQ perspective — same as BD purchase for now)
  const purchaseTotal = bodyBreakdown.purchaseParts.amount;

  // D. Master Carton (from product_dimension.carton_price)
  const cartonPrice = product_dimension ? (parseFloat(product_dimension.carton_price) || 0) : 0;
  const pcsPerCarton = product_dimension ? (parseInt(product_dimension.pcs_per_carton) || 1) : 1;
  const cartonTotal = pcsPerCarton > 0 ? cartonPrice / pcsPerCarton : 0;

  // Subtotal before transport
  const subBeforeTransport = bodyCost + packagingTotal + purchaseTotal + cartonTotal;

  // E. Transport — calculate for standard MOQs
  const moqs = [2500, 5000, 10000, 15000];
  const transport = calcTransport(transport_config, 2500);

  // F. Mold amortization
  const moldAmortRmb = mold_cost ? (parseFloat(mold_cost.amortization_rmb) || 0) : 0;
  const rmb_hkd = parseFloat(params.rmb_hkd) || 0.85;
  const moldAmortHkd = moldAmortRmb / rmb_hkd;

  // Cost Summary per MOQ (using YT40 container transport as default)
  const yt40PerPc = transport.routes?.yt_40?.per_pc || 0;

  const summaryMatrix = moqs.map(moq => {
    // Transport per pc
    const transportPerPc = yt40PerPc;
    const withTransport = subBeforeTransport + transportPerPc;

    // 附加税
    const surchargeAmt = withTransport * surcharge;

    // 码点
    const afterSurcharge = (withTransport + surchargeAmt) * markupPoint;

    // 找数
    const totalHkd = afterSurcharge / paymentDiv;

    // Mold amortization (shared across MOQ tiers)
    const moldPerPc = moldAmortHkd;

    return {
      moq,
      body_cost: bodyCost,
      packaging_total: packagingTotal,
      purchase_total: purchaseTotal,
      carton_total: cartonTotal,
      transport_per_pc: transportPerPc,
      subtotal: subBeforeTransport + transportPerPc,
      surcharge_amt: surchargeAmt,
      markup_point_amt: (withTransport + surchargeAmt) * (markupPoint - 1),
      total_hkd: totalHkd,
      total_usd: totalHkd * hkdUsd,
      mold_per_pc_hkd: moldPerPc,
      total_with_mold_hkd: totalHkd + moldPerPc,
      total_with_mold_usd: (totalHkd + moldPerPc) * hkdUsd,
    };
  });

  return {
    bodyCost,
    packagingTotal,
    purchaseTotal,
    cartonTotal,
    transport,
    summaryMatrix,
    // Convenience: first MOQ (2.5K)
    totalHkd: summaryMatrix[0].total_hkd,
    totalUsd: summaryMatrix[0].total_usd,
  };
}

// ─── Full Recalculation ───────────────────────────────────────────────────────

function recalculate(versionId) {
  const db = getDb();

  // Load all version data
  const version = db.prepare('SELECT * FROM QuoteVersion WHERE id = ?').get(versionId);
  if (!version) throw new Error(`Version ${versionId} not found`);

  const params = db.prepare('SELECT * FROM QuoteParams WHERE version_id = ?').get(versionId) || {};
  const materialPrices = db.prepare('SELECT * FROM MaterialPrice WHERE version_id = ?').all(versionId);
  const machinePrices = db.prepare('SELECT * FROM MachinePrice WHERE version_id = ?').all(versionId);
  const moldParts = db.prepare('SELECT * FROM MoldPart WHERE version_id = ? ORDER BY sort_order').all(versionId);
  const hardwareItems = db.prepare('SELECT * FROM HardwareItem WHERE version_id = ? ORDER BY sort_order').all(versionId);
  const packagingItems = db.prepare('SELECT * FROM PackagingItem WHERE version_id = ? ORDER BY sort_order').all(versionId);
  const paintingDetail = db.prepare('SELECT * FROM PaintingDetail WHERE version_id = ?').get(versionId);
  const electronicSummary = db.prepare('SELECT * FROM ElectronicSummary WHERE version_id = ?').get(versionId);
  const transportConfig = db.prepare('SELECT * FROM TransportConfig WHERE version_id = ?').get(versionId);
  const moldCost = db.prepare('SELECT * FROM MoldCost WHERE version_id = ?').get(versionId);
  const productDimension = db.prepare('SELECT * FROM ProductDimension WHERE version_id = ?').get(versionId);

  // Recalculate each mold part and update DB (molding_labor kept as raw imported value)
  const updatePart = db.prepare(`
    UPDATE MoldPart SET unit_price_hkd_g = ?, material_cost_hkd = ?
    WHERE id = ?
  `);

  const updatedParts = moldParts.map(part => {
    const calc = calcMoldPart(part, materialPrices, machinePrices);
    updatePart.run(calc.unit_price_hkd_g, calc.material_cost_hkd, part.id);
    return { ...part, ...calc };
  });

  // Build versionData for breakdown calculations
  const versionData = {
    params,
    mold_parts: updatedParts,
    hardware_items: hardwareItems,
    packaging_items: packagingItems,
    painting_detail: paintingDetail,
    electronic_summary: electronicSummary,
    transport_config: transportConfig,
    mold_cost: moldCost,
    product_dimension: productDimension,
  };

  const bodyBreakdown = calcBodyBreakdown(versionData);
  const vqSummary = calcVqSummary(versionData, bodyBreakdown);

  return {
    versionId,
    bodyBreakdown,
    vqSummary,
    moldParts: updatedParts,
    materialPrices,
    machinePrices,
  };
}

module.exports = {
  recalculate,
  calcMoldPart,
  calcBodyBreakdown,
  calcVqSummary,
  lookupMachinePrice,
};
