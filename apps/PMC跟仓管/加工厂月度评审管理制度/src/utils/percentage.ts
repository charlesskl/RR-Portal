export function isPercentOver100(value: number | string | null | undefined): boolean {
  if (value == null || value === '') return false
  const numeric = typeof value === 'number'
    ? value
    : Number(value.trim().replace(/%$/, ''))
  return Number.isFinite(numeric) && numeric > 100
}
