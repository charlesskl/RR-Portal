import type { Order } from '../types/order'

const r2 = (n: number) => Math.round(n * 100) / 100
const r1 = (n: number) => Math.round(n * 10) / 10
const pct2 = (a: number, b: number) => (b ? r2((a / b) * 100).toFixed(2) + '%' : '-')
const isPass = (v?: string) => String(v ?? '').trim().toUpperCase() === 'PASS'

export interface FactoryStats {
  quoteSum: number
  unitSum: number
  priceRatio: string
  quoteAmount: number
  outAmount: number
  amountRatio: string
  orderCount: number
  delayedCount: number
  delayRatio: string
  delayDaysAvg: string
  intInspect: number
  intPass: number
  intRate: string
  custInspect: number
  custPass: number
  custRate: string
  combinedRate: string
}

// —— 现场管理(5S检查记录)——
const S5_KEYS = ['s_area', 's_material', 's_hygiene', 's_sharp', 's_nonconform', 's_standard', 's_qc_staff', 's_correction']
function parseIP(v?: string): number | null {
  const s = String(v ?? '').trim()
  return (!s || !/^[0-9]+(\.[0-9]+)?$/.test(s)) ? null : Number(s)
}
export interface SiteStats { siteScore: number; finalRate: string }
// checks 需按 -check_date 排序,取最新一条;折算总达成率:NA→现场得分/100;适用→(现场得分+IP)/110
export function computeSiteStats(checks: any[]): SiteStats {
  const c = checks[0]
  if (!c) return { siteScore: 0, finalRate: '-' }
  const s = S5_KEYS.reduce((a, k) => a + (Number(c[k]) || 0), 0)
  const ip = parseIP(c.ip_control)
  return { siteScore: s, finalRate: ip == null ? s + '%' : Math.round(((s + ip) / 110) * 100) + '%' }
}

// 单个工厂的价格/交期/品质指标(口径与汇总表一致)
export function computeFactoryStats(orders: Order[], qis: any[]): FactoryStats {
  const quoteSum = r2(orders.reduce((a, o) => a + (Number(o.quote_labor_price) || 0), 0))
  const unitSum = r2(orders.reduce((a, o) => a + (Number(o.unit_price) || 0), 0))
  const quoteAmount = r2(orders.reduce((a, o) => a + (Number(o.quote_labor_price) || 0) * (Number(o.quantity) || 0), 0))
  const outAmount = r2(orders.reduce((a, o) => a + (Number(o.unit_price) || 0) * (Number(o.quantity) || 0), 0))
  const orderCount = orders.length
  const delayed = orders.filter((o) => o.is_delayed)
  const delayedCount = delayed.length
  const intInspect = qis.length
  const intPass = qis.filter((q) => isPass(q.internal_result)).length
  const custList = qis.filter((q) => String(q.cust_result ?? '').trim() !== '')
  const custInspect = custList.length
  const custPass = custList.filter((q) => isPass(q.cust_result)).length
  return {
    quoteSum,
    unitSum,
    priceRatio: pct2(unitSum, quoteSum),
    quoteAmount,
    outAmount,
    amountRatio: pct2(outAmount, quoteAmount),
    orderCount,
    delayedCount,
    delayRatio: pct2(delayedCount, orderCount),
    delayDaysAvg: delayedCount ? r1(delayed.reduce((a, o) => a + (Number(o.delay_days) || 0), 0) / delayedCount) + '天' : '-',
    intInspect,
    intPass,
    intRate: pct2(intPass, intInspect),
    custInspect,
    custPass,
    custRate: pct2(custPass, custInspect),
    combinedRate: pct2(intPass + custPass, intInspect + custInspect),
  }
}
