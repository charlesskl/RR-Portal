export type OutputPeriodMode = 'month' | 'quarter' | 'year' | 'custom'
export interface OutputPeriod { start: string; end: string }
export function outputPeriod(mode: OutputPeriodMode, month: string, year: string, quarter: number, start: string, end: string): OutputPeriod {
  const validMonth = (v: string) => /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(v)
  if (mode === 'month') {
    if (!validMonth(month)) throw new Error('请选择有效月份。')
    return { start: month, end: month }
  }
  if (mode === 'custom') {
    if (!validMonth(start) || !validMonth(end)) throw new Error('请选择开始月份和结束月份。')
    if (start > end) throw new Error('开始月份不能晚于结束月份。')
    return { start, end }
  }
  if (!/^[1-9]\d{3}$/.test(year)) throw new Error('请输入有效的四位年份。')
  if (mode === 'year') return { start: `${year}-01`, end: `${year}-12` }
  if (![1, 2, 3, 4].includes(quarter)) throw new Error('请选择有效季度。')
  return { start: `${year}-${String(quarter * 3 - 2).padStart(2, '0')}`, end: `${year}-${String(quarter * 3).padStart(2, '0')}` }
}
export function outputAmounts(orders: { factory: string; order_date?: string; amount?: number }[], range: OutputPeriod) {
  // Order amounts can include fractional cents; preserve the stored amount until display.
  const amounts: Record<string, number> = {}
  for (const order of orders) {
    const month = order.order_date?.slice(0, 7) || ''
    if (!/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(month) || month < range.start || month > range.end) continue
    const amount = Number(order.amount)
    if (Number.isFinite(amount)) amounts[order.factory] = (amounts[order.factory] || 0) + amount
  }
  return amounts
}
