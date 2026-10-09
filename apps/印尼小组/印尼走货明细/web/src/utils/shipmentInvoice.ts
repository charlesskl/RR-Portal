import type { Material } from '../api/client'
import { normalizeToolCurrency } from './toolPrice'

// Invoice calculations must not use the legacy display/sort fallback to 华胜益.
export function invoiceCustomsCompany(item: { customs_company?: string }, material?: Material) {
  return (item.customs_company ?? material?.customs_company ?? '').trim()
}

export function customsInvoicePrice(purchasePrice?: number, customsCompany = '', deliveryKg?: number, isLastCompanyItem = false, currency?: string) {
  const price = Number(purchasePrice) || 0
  if (!customsCompany.includes('华胜益')) return price
  // The existing 1248 fee is in CNY; convert only the fee for USD purchases.
  const surchargePerKg = isLastCompanyItem && Number(deliveryKg) > 0 ? 1248 / Number(deliveryKg) / 7.2 : 0
  const base = normalizeToolCurrency(currency || '') === 'USD' ? price : price * 1.05 / 7.2
  return base + surchargePerKg
}

export function customsInvoiceFormula(excelRow: number, customsCompany: string, isLastCompanyItem: boolean, currency?: string) {
  const price = `AO${excelRow}`
  if (!customsCompany.includes('华胜益')) return price
  const base = normalizeToolCurrency(currency || '') === 'USD' ? price : `${price}*1.05/7.2`
  return isLastCompanyItem ? `${base}+IF(K${excelRow}>0,1248/K${excelRow}/7.2,0)` : base
}

// Input must already be in the shared export order.
export function withShipmentInvoicePrices<T extends { material_id?: number; customs_company?: string; price?: number; kg?: number; currency?: string }>(
  items: readonly T[], materials: ReadonlyMap<number, Material>,
) {
  const company = (it: T) => invoiceCustomsCompany(it, it.material_id == null ? undefined : materials.get(it.material_id))
  return items.map((it, i) => ({
    ...it,
    invoice_price: customsInvoicePrice(it.price, company(it), it.kg,
      !items.slice(i + 1).some(next => company(next) === company(it)), it.currency),
  }))
}
