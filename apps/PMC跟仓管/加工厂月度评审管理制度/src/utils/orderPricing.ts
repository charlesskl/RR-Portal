const CNY_TO_HKD_RATE = 0.87
const TAX_RATE_FACTOR = 1.13

export function cnyTaxToHkdUntaxed(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round((value / CNY_TO_HKD_RATE / TAX_RATE_FACTOR) * 10000) / 10000
}

export function applyCnyTaxPrice(payload: Record<string, any>, preferCnyTaxPrice = false) {
  const source = payload.unit_price_cny_tax ?? (preferCnyTaxPrice ? payload.unit_price : undefined)
  if (source == null || source === '') return payload
  const cnyTaxPrice = Number(source)
  if (!Number.isFinite(cnyTaxPrice)) return payload
  payload.unit_price_cny_tax = cnyTaxPrice
  payload.unit_price = cnyTaxToHkdUntaxed(cnyTaxPrice)
  return payload
}
