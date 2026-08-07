import type { FactoryStats } from './factoryStats'

export const FACTORY_SUMMARY_HEADERS = [
  '加工厂名称',
  '核价总金额', '外发总金额', '价格占比',
  '订单总单数', '延期单数', '延期占比', '延期平均天数',
  '验货总单数', '合格单数', '合格率',
  '现场得分', '折算总达成率',
] as const

export interface FactorySummaryExportItem {
  name: string
  stats: FactoryStats
  siteScore: number | string
  siteRate: string
}

function metricNumber(value: number | string): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const normalized = value.trim()
  if (!normalized || normalized === '-') return null
  const parsed = Number.parseFloat(normalized.replace(/[^0-9.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function metricPercent(value: string): number | null {
  const parsed = metricNumber(value)
  return parsed == null ? null : parsed / 100
}

export function factorySummaryExportRow(item: FactorySummaryExportItem): Array<string | number | null> {
  return [
    item.name,
    item.stats.quoteAmount,
    item.stats.outAmount,
    metricPercent(item.stats.amountRatio),
    item.stats.orderCount,
    item.stats.delayedCount,
    metricPercent(item.stats.delayRatio),
    metricNumber(item.stats.delayDaysAvg),
    item.stats.intInspect,
    item.stats.intPass,
    metricPercent(item.stats.intRate),
    metricNumber(item.siteScore),
    metricPercent(item.siteRate),
  ]
}
