/** Pallet groups are entered with spaces and displayed/exported one per line. */
export function formatShipmentPallet(value: unknown): string {
  return String(value ?? '').trim().split(/\s+/u).filter(Boolean).join('\n')
}

/** Optional measurements show no placeholder zero; the underlying data stays intact. */
export function shipmentOptionalNumber(value: unknown): number | undefined {
  if (value == null || value === '') return undefined
  const number = Number(value)
  return Number.isFinite(number) && number !== 0 ? number : undefined
}
