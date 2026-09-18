import type { Order } from '../types/order'
import { type Craft, type Region, CRAFT_LABELS } from '../constants/roles'
import { orderRegion } from './orderRegion'
import { buildDeliveryReport } from './deliveryStats'
import type { DeliveryPricingMode } from './deliveryReportFormat'

export function delayedOrder(order: Order): Order | null {
  const days = Number(order.delay_days)
  if (order.status === 'cancelled' || !Number.isFinite(days) || days < 1) return null
  return { ...order, is_delayed: true, delay_days: days, notes: [order.delay_reason, order.notes].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join('；') }
}

export function buildDelayedSections(source: Order[], region: Region, crafts: Craft[], taxPoints: Map<string, number | null>) {
  return crafts.map((craft) => {
    const pricingMode: DeliveryPricingMode = region === 'hunan' ? 'hunan-rmb-tax' : craft === 'sewing' || (region === 'dongguan' && craft === 'electronics')
      ? 'rmb-tax' : region === 'dongguan' ? 'hkd-tax' : 'hkd'
    const orders = source.filter((o) => orderRegion(o) === region && o.expand?.factory?.craft === craft)
      .map((o) => delayedOrder(o)).filter((o): o is Order => o !== null)
    const rows = buildDeliveryReport(orders, CRAFT_LABELS[craft], (o) => o.expand?.factory?.name ?? '', pricingMode, (o) => taxPoints.get(o.factory) ?? null)
    // Quantity subtotals follow the same PMC/factory grouping as the report.
    let quantity = 0
    const quantities = rows.map((r) => {
      if (r.kind === 'detail') { quantity += r.quantity ?? 0; return r.quantity }
      const total = quantity; quantity = 0; return total
    })
    return { craft, name: CRAFT_LABELS[craft], pricingMode, rows, quantities, count: orders.length }
  })
}
