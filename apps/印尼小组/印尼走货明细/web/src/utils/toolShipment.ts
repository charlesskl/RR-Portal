import type { Material } from '../api/client'

// Tool prices are purchase prices, not USD invoice prices.
export function toolShipmentFields(material: Material) {
  const currencies: Record<string, string> = { CNY: '¥', USD: 'US$', HKD: 'HK$', IDR: 'IDR' }
  return {
    material_id: material.id,
    supplier: material.supplier || '',
    price: material.purchase_price ?? 0,
    currency: currencies[material.purchase_currency || ''] || '',
    purchase_unit: material.unit_kg || 'PCE',
    invoice_price: 0,
    po_no: '',
    po_date: '',
    outbound_id: undefined,
  }
}
