import type { KpiLog } from '../types/kpi'

export function onTimeRate(logs: KpiLog[]): number {
  if (!logs.length) return 0
  const onTime = logs.filter((l) => l.is_on_time).length
  return Math.round((onTime / logs.length) * 100)
}

export function groupByUser(logs: KpiLog[]): Record<string, KpiLog[]> {
  const map: Record<string, KpiLog[]> = {}
  for (const l of logs) (map[l.user] ??= []).push(l)
  return map
}
