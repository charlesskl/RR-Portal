// Purchase dates are business calendar dates: strip time without UTC conversion.
export function shipmentDateOnly(value?: string) {
  const match = value?.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/)
  if (!match) return ''
  const [year, month, day] = match.slice(1).map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? match[0].slice(0, 10) : ''
}

export function shipmentPurchaseDates(sources: readonly { po_date?: string }[]) {
  return [...new Set(sources.map(source => shipmentDateOnly(source.po_date)).filter(Boolean))]
}
