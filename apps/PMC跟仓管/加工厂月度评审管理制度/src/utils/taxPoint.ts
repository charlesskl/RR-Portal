function round4(value: number) {
  return Math.round(value * 10000) / 10000
}

/** Stored factory tax rate (0.03) -> displayed/calculation factor (1.03). */
export function taxPointFactor(value: unknown): number | null {
  const rate = Number(value)
  if (!Number.isFinite(rate) || rate < 0) return null
  return round4(rate < 1 ? 1 + rate : rate)
}

/** Accept either a rate (0.03) or factor (1.03), and store it as a rate. */
export function taxPointRate(value: unknown): number | null {
  const entered = Number(value)
  if (!Number.isFinite(entered) || entered < 0) return null
  return round4(entered >= 1 ? entered - 1 : entered)
}
