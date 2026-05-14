const CALC_RATIO = 2.1;
const PAINT_RATIO = 0.35;

function calcPrices({ unit_wage }) {
  const calc_price = Number(unit_wage) * CALC_RATIO;
  const paint_price = calc_price * PAINT_RATIO;
  const total_price = calc_price + paint_price;
  return { calc_price, paint_price, total_price };
}

module.exports = { calcPrices, CALC_RATIO, PAINT_RATIO };
