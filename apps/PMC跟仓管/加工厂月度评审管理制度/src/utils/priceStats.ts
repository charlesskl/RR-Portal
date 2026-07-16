import type { Order } from '../types/order'

export interface PriceStatsRow {
  workshop: string
  factory: string
  category: string
  item_no: string
  product: string
  quote_labor_price: number | null
  supplier_price: number | null
  unit_price: number | null
  after_tax: number | null
  ratio_pct: number | null
  manager_rating: number | null
  notes: string
  // 分组合并跨度：首行=该组连续行数；被合并的后续行=0（渲染/导出时省略该单元格）
  workshopSpan: number
  factorySpan: number
  categorySpan: number
}

// 扣税点1.13后单价 = 外发单价 ÷ 1.13（保留4位小数）
export function afterTax(unitPrice?: number | null): number | null {
  if (unitPrice == null) return null
  return Math.round((unitPrice / 1.13) * 10000) / 10000
}

// 占比 = 扣税点1.13后单价 ÷ 核价生产工价 ×100（百分比，保留1位小数）
export function ratioPct(unitPrice?: number | null, quoteLaborPrice?: number | null): number | null {
  const at = afterTax(unitPrice)
  if (at == null || !quoteLaborPrice) return null
  return Math.round((at / quoteLaborPrice) * 1000) / 10
}

const SEP = ' '
const groupCollator = new Intl.Collator('zh-CN-u-co-stroke')
function computeSpan(
  rows: PriceStatsRow[],
  key: (r: PriceStatsRow) => string,
  field: 'workshopSpan' | 'factorySpan' | 'categorySpan',
) {
  let i = 0
  while (i < rows.length) {
    let j = i + 1
    while (j < rows.length && key(rows[j]) === key(rows[i])) j++
    rows[i][field] = j - i
    for (let k = i + 1; k < j; k++) rows[k][field] = 0
    i = j
  }
}

export function buildPriceStatsRows(
  orders: Order[],
  factoryName: (o: Order) => string,
): PriceStatsRow[] {
  const rows: PriceStatsRow[] = orders.map((o) => ({
    workshop: o.workshop ?? '',
    factory: factoryName(o),
    category: o.process_category ?? '',
    item_no: o.item_no ?? '',
    product: o.product ?? '',
    quote_labor_price: o.quote_labor_price ?? null,
    supplier_price: o.supplier_price ?? null,
    unit_price: o.unit_price ?? null,
    after_tax: afterTax(o.unit_price),
    ratio_pct: ratioPct(o.unit_price, o.quote_labor_price),
    manager_rating: o.manager_rating ?? null,
    notes: o.notes ?? '',
    workshopSpan: 0,
    factorySpan: 0,
    categorySpan: 0,
  }))
  // 排序保证同组相邻：车间 → 加工厂 → 加工类别
  rows.sort((a, b) =>
    groupCollator.compare(a.workshop, b.workshop) ||
    groupCollator.compare(a.factory, b.factory) ||
    groupCollator.compare(a.category, b.category))
  computeSpan(rows, (r) => r.workshop, 'workshopSpan')
  computeSpan(rows, (r) => r.workshop + SEP + r.factory, 'factorySpan')
  computeSpan(rows, (r) => r.workshop + SEP + r.factory + SEP + r.category, 'categorySpan')
  return rows
}
