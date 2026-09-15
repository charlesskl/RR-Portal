import type { QualityInspection } from '../types/qualityInspection'
import { matchesOrderDate, type OrderDateFilter } from './orderDateFilter'

const processTypeOf = (value: unknown) => String(value ?? '').trim()

export function qualityInspectionProcessTypes(records: QualityInspection[]): string[] {
  return [...new Set(records.map((record) => processTypeOf(record.process_type)).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))
}

export function matchesQualityInspectionFilters(
  record: QualityInspection,
  processType: string,
  dateFilter: OrderDateFilter,
): boolean {
  if (processType && processTypeOf(record.process_type) !== processTypeOf(processType)) return false
  return matchesOrderDate(record.inspect_date, dateFilter)
}
