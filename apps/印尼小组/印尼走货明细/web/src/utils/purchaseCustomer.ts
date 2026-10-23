import { purchaseItemCodes } from './purchaseCustoms'
import { scheduleCustomer } from './scheduleImport'

export interface PurchaseCustomerSchedule {
  code?: string; orderNo?: string; customer?: string; source?: string
}
export interface PurchaseCustomerProduct { code?: string; customer?: string }
interface CustomerLine { product_code?: string; tomy_po?: string }
const norm = (value?: string) => (value || '').trim().toUpperCase()

export function purchaseScheduleCustomer(row: PurchaseCustomerSchedule): string {
  const source = scheduleCustomer(row.source)
  return scheduleCustomer(row.customer) || (source === 'Spin Master' ? source : 'TOMY')
}

/** Infer legacy orders from their linked schedules, then the product catalogue.
 * Unknown/ambiguous customers must not silently become TOMY when appending. */
export function purchaseLineCustomers(
  lines: CustomerLine[], schedules: PurchaseCustomerSchedule[], products: PurchaseCustomerProduct[] = [],
  resolveCode: (code: string) => string = code => code,
): (string | undefined)[] {
  const knownCodes = [...products.map(p => p.code), ...schedules.map(s => s.code)]
  return lines.flatMap(line => {
    if (!line.product_code?.trim()) return [undefined]
    const orders = (line.tomy_po || '').split(/[;；]/).map(norm).filter(Boolean)
    return purchaseItemCodes(line.product_code, knownCodes).flatMap(code => {
      const matches = schedules.filter(row => norm(row.code) === norm(code)
        && orders.includes(norm(row.orderNo)))
      if (matches.length) return matches.map(purchaseScheduleCustomer)
      const product = products.find(p => norm(p.code) === norm(resolveCode(code)))
      // Existing catalogue records without a customer are legacy TOMY records.
      return [product ? scheduleCustomer(product.customer) || 'TOMY' : undefined]
    })
  })
}

export function assertPurchaseCustomer(
  selected: (string | undefined)[], existing: (string | undefined)[] = [],
): string {
  if (!selected.length || selected.some(c => !c?.trim()))
    throw new Error('所选物料的客户未能确认，请补齐货号客户资料后重试。')
  const customers = new Set(selected.map(c => scheduleCustomer(c)))
  if (customers.size !== 1) throw new Error('不同客户请分开下单，或使用批量下单按客户分别生成采购单。')
  const customer = [...customers][0]
  if (existing.some(c => !c?.trim()))
    throw new Error('当前采购单的客户未能确认，请核对货号及关联排期，或另建采购单。')
  const current = new Set(existing.map(c => scheduleCustomer(c)))
  if (current.size > 1) throw new Error('当前采购单包含不同客户，请先核对并分单。')
  if (current.size && !current.has(customer))
    throw new Error(`所选 ${customer} 与当前 ${[...current][0]} 客户不一致，请另建采购单。`)
  return customer
}
