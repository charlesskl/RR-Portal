'use strict';

const SPIN_HKD_USD = 7.75;
const FREIGHT_DEFAULTS = {
  cap_40: 1980,
  cap_20: 883,
  hk40: 8000,
  hk20: 7100,
  yt40: 7200,
  yt20: 6000,
};
const LCL_DEFAULTS = [
  { code: 'CHINA LCL1', label: 'Yantian LCL - 3 Ton Truck', capacity_cuft: 450, unit_hkd: 16.8 },
  { code: 'CHINA LCL2', label: 'Yantian LCL - 5 Ton Truck', capacity_cuft: 850, unit_hkd: 11.24 },
  { code: 'CHINA LCL3', label: 'Yantian LCL - 8 Ton Truck', capacity_cuft: 1000, unit_hkd: 9.67 },
];

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildSpinTransportRows({ cartonCuft, pcsPerCarton, freightCalc, spinConfig }) {
  const cuft = num(cartonCuft);
  const pcs = num(pcsPerCarton);
  const freight = { ...FREIGHT_DEFAULTS, ...(freightCalc || {}) };
  const config = spinConfig || {};
  const fx = num(config.fx_hkd_usd) || SPIN_HKD_USD;
  const lclDivisor = num(config.lcl_divisor) || 0.98;
  const savedLcl = Array.isArray(config.china_lcl) ? config.china_lcl : [];
  const actualQty = capacity => (cuft > 0 && pcs > 0)
    ? Math.floor(num(capacity) / cuft) * pcs
    : 0;
  const fclRate = (fee, qty) => (fx > 0 && qty > 0) ? num(fee) / fx / qty : 0;
  const qty20 = actualQty(freight.cap_20);
  const qty40 = actualQty(freight.cap_40);
  const rows = [
    {
      code: 'CHINA FCL',
      description: 'Yantian FCL',
      capacity_20: num(freight.cap_20),
      capacity_40: num(freight.cap_40),
      fee_20_hkd: num(freight.yt20),
      fee_40_hkd: num(freight.yt40),
      qty_20: qty20,
      qty_40: qty40,
      usd_per_toy: fclRate(freight.yt40, qty40),
      fx_hkd_usd: fx,
    },
    {
      code: 'HK FCL',
      description: 'Hong Kong FCL',
      capacity_20: num(freight.cap_20),
      capacity_40: num(freight.cap_40),
      fee_20_hkd: num(freight.hk20),
      fee_40_hkd: num(freight.hk40),
      qty_20: qty20,
      qty_40: qty40,
      usd_per_toy: fclRate(freight.hk40, qty40),
      fx_hkd_usd: fx,
    },
  ];

  LCL_DEFAULTS.forEach((defaults, index) => {
    const saved = savedLcl[index] || {};
    const capacity = num(saved.capacity_cuft) || defaults.capacity_cuft;
    const unitHkd = num(saved.unit_hkd) || defaults.unit_hkd;
    rows.push({
      code: defaults.code,
      description: defaults.label,
      capacity_cuft: capacity,
      unit_hkd: unitHkd,
      qty_40: actualQty(capacity),
      usd_per_toy: (cuft > 0 && pcs > 0 && fx > 0 && lclDivisor > 0)
        ? unitHkd * cuft / pcs / lclDivisor / fx
        : 0,
      fx_hkd_usd: fx,
      lcl_divisor: lclDivisor,
    });
  });
  return rows;
}

module.exports = { buildSpinTransportRows };
