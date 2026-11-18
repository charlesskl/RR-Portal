/** Match Excel's 15 significant digits, then round cents halfway away from zero. */
export function roundPurchaseContractAmount(amount: number): number {
  if (!Number.isFinite(amount)) return amount
  const sign = amount < 0 ? -1 : 1
  const magnitude = Number(Math.abs(amount).toPrecision(15))
  // At this scale the 15-digit value has no fractional cents; avoid exponent overflow.
  if (magnitude >= 1e15) return sign * magnitude
  const [coefficient, exponent = '0'] = String(magnitude).split('e')
  const cents = Math.round(Number(`${coefficient}e${Number(exponent) + 2}`))
  return sign * cents / 100
}
