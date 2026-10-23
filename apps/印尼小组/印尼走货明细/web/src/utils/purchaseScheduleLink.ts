import { purchaseSelectionSource } from './purchaseMaterialSelection'
import { purchaseItemCodes } from './purchaseCustoms'
import { assertPurchaseCustomer, purchaseLineCustomers, purchaseScheduleCustomer, type PurchaseCustomerProduct } from './purchaseCustomer'

export interface LinkableSchedule {
  code?: string; orderNo?: string; eta?: string; source?: string
  qty?: number; customer?: string; productName?: string
}
interface LinkableLine { product_code?: string; tomy_po?: string; eta?: string }
const norm = (value?: string) => (value || '').trim().toUpperCase()
const codes = (value?: string) => (value || '').split(/\s*\/\s*/).map(norm).filter(Boolean)

export function matchingLineSchedules(line: LinkableLine, schedules: LinkableSchedule[]) {
  const lineCodes = codes(line.product_code)
  // A merged row cannot safely replace several products' associations with one order.
  const exact = schedules.filter(row => !!row.orderNo?.trim() && norm(row.code) === norm(line.product_code))
  if (exact.length) return exact // A slash-containing full SKU is still one product.
  return lineCodes.length === 1 ? schedules.filter(row => !!row.orderNo?.trim() && norm(row.code) === lineCodes[0]) : []
}

export function linkPurchaseLine<T extends LinkableLine>(line: T, schedule: LinkableSchedule,
  schedules: LinkableSchedule[], allLines: LinkableLine[], poNo: string, products?: PurchaseCustomerProduct[],
  resolveCode: (code: string) => string = code => code): T {
  if (!matchingLineSchedules(line, schedules).includes(schedule))
    throw new Error('请选择与该行货号完全一致的排期订单；多货号合并行请先拆分。')
  const knownCodes = [...schedules.map(row => row.code), ...(products || []).map(product => product.code)]
  const existingSources = allLines.flatMap(item => (item.tomy_po || '').split(/[;；]/).filter(v => v.trim()).flatMap(order => {
    const itemCodes = purchaseItemCodes(item.product_code, knownCodes)
    const matches = schedules.filter(row => row.orderNo?.trim() === order.trim()
      && itemCodes.some(code => norm(code) === norm(row.code)))
    return matches.length ? matches.map(row => row.source?.trim() || 'RRI') : [undefined]
  }))
  purchaseSelectionSource([{ key: 'link', groupKey: 'link', productCode: line.product_code || '', label: '', material: {}, quantity: 0 }],
    { link: schedule.source }, poNo, existingSources)
  // The row being linked can establish its customer if it had no association;
  // other rows and previous associations must already belong to that customer.
  assertPurchaseCustomer([purchaseScheduleCustomer(schedule)],
    purchaseLineCustomers(allLines.filter(item => item !== line || !!item.tomy_po?.trim()), schedules, products, resolveCode))
  // Only association and shipment date change. Quantities, prices, units and material identity remain untouched.
  return { ...line, tomy_po: schedule.orderNo!.trim(), eta: schedule.eta?.trim() || line.eta || '' }
}
