import { shipmentUsesDeclarationPrice, type ShipmentPurchaseItem } from './shipmentPurchase'

// Match the decimal values sent in JSON, including scientific notation. Avoid
// binary floating-point/toFixed rounding when simulating PostgreSQL numeric(22,8).
function decimal(value: number) {
  const [, sign, whole, fraction = '', exponent = '0'] = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(value))!
  return { coefficient: BigInt(`${sign}${whole}${fraction}`), scale: fraction.length - Number(exponent) }
}

function rounded(coefficient: bigint, scale: number, places: number): bigint {
  const shift = scale - places
  if (shift <= 0) return coefficient * 10n ** BigInt(-shift)
  const divisor = 10n ** BigInt(shift)
  const absolute = coefficient < 0n ? -coefficient : coefficient
  const result = absolute / divisor + (absolute % divisor * 2n >= divisor ? 1n : 0n)
  return coefficient < 0n ? -result : result
}

function money(cents: bigint) {
  const absolute = cents < 0n ? -cents : cents
  return `${cents < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`
}

/** Return before any API write; keep the draft and render path free of throws. */
export function shipmentDeclarationSaveError(items: readonly ShipmentPurchaseItem[]): string | null {
  for (const [index, item] of items.entries()) {
    if (!shipmentUsesDeclarationPrice(item)) continue
    const price = Number(item.price ?? 0), quantity = Number(item.kg ?? 0)
    if (!Number.isFinite(price) || !Number.isFinite(quantity)) return `第 ${index + 1} 行的申报数量或采购单价无效，请核对后再保存`
    const p = decimal(price), q = decimal(quantity)
    const current = rounded(p.coefficient * q.coefficient, p.scale + q.scale, 2)
    const stored = rounded(rounded(p.coefficient, p.scale, 8) * q.coefficient, 8 + q.scale, 2)
    if (current !== stored)
      return `第 ${index + 1} 行采购金额为 ${money(current)}，按服务器 8 位单价保存后会变为 ${money(stored)}；请调整申报单位或采购单价后再保存`
  }
  return null
}
