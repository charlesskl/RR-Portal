export type OrderDateFilter =
  | { mode: 'all' }
  | { mode: 'month'; month: string }
  | { mode: 'range'; start: string; end: string }

function calendarDate(value: unknown): string {
  const text = String(value ?? '').trim()
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/)
  return match?.[1] ?? ''
}

export function matchesOrderDate(orderDate: unknown, filter: OrderDateFilter): boolean {
  if (filter.mode === 'all') return true
  const date = calendarDate(orderDate)
  if (!date) return false
  if (filter.mode === 'month') return !filter.month || date.startsWith(`${filter.month}-`)
  if (filter.start && date < filter.start) return false
  if (filter.end && date > filter.end) return false
  return true
}
