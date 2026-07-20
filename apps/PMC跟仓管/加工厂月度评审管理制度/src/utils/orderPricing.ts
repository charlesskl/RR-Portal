export const DEFAULT_CNY_TO_HKD_RATE = 0.87
const TAX_RATE_FACTOR = 1.13

export function cnyTaxToHkdUntaxed(value: number, exchangeRate = DEFAULT_CNY_TO_HKD_RATE): number {
  if (!Number.isFinite(value) || !Number.isFinite(exchangeRate) || exchangeRate <= 0) return 0
  return Math.round((value / exchangeRate / TAX_RATE_FACTOR) * 10000) / 10000
}

export function applyCnyTaxPrice(payload: Record<string, any>, preferCnyTaxPrice = false) {
  const source = payload.unit_price_cny_tax ?? (preferCnyTaxPrice ? payload.unit_price : undefined)
  if (source == null || source === '') return payload
  const cnyTaxPrice = Number(source)
  if (!Number.isFinite(cnyTaxPrice)) return payload
  const storedRate = Number(payload.exchange_rate)
  const exchangeRate = Number.isFinite(storedRate) && storedRate > 0 ? storedRate : DEFAULT_CNY_TO_HKD_RATE
  payload.unit_price_cny_tax = cnyTaxPrice
  payload.exchange_rate = exchangeRate
  payload.unit_price = cnyTaxToHkdUntaxed(cnyTaxPrice, exchangeRate)
  return payload
}
