import type { Material } from '../api/client'
import { effectiveCustomsCompany } from './shipmentOrder'

export function customsInvoicePrice(purchasePrice?: number, customsCompany = '', deliveryKg?: number, isLastCompanyItem = false) {
  const price = Number(purchasePrice) || 0
  if (!customsCompany.includes('华胜益')) return price
  const surchargePerKg = isLastCompanyItem && Number(deliveryKg) > 0 ? 1248 / Number(deliveryKg) : 0
  return (price * 1.05 + surchargePerKg) / 7.2
}

// Input must already be in the shared export order.
export function withShipmentInvoicePrices<T extends { material_id?: number; customs_company?: string; price?: number; kg?: number }>(
  items: readonly T[], materials: ReadonlyMap<number, Material>,
) {
  const company = (it: T) => effectiveCustomsCompany(it, it.material_id == null ? undefined : materials.get(it.material_id))
  return items.map((it, i) => ({
    ...it,
    invoice_price: customsInvoicePrice(it.price, company(it), it.kg,
      i === items.length - 1 || company(items[i + 1]) !== company(it)),
  }))
}
