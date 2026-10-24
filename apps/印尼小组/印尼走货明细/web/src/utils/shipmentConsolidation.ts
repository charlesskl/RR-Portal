import type { Material } from '../api/client'
import type { CustomsItem } from './customsExport'
import { effectiveCustomsCompany } from './shipmentOrder'
import { invoiceCustomsCompany } from './shipmentInvoice'
import { isPaperRope, parseShipmentPacking, shipmentWeightQuantity } from './shipmentWeight'

type BatchItem = CustomsItem & { outbound_id?: number; carton_no?: string; material_snapshot?: unknown }

// Presentation only. Never save these rows: allocation remains per outbound record.
// Call once for a single shipment/container, not across a list of shipments.
export function consolidateShipmentItems<T extends BatchItem>(
  items: readonly T[], materials: ReadonlyMap<number, Material>, fallback?: string,
): Array<T & { sources: T[]; outbound_ids: number[] }> {
  const groups = new Map<string, T & { sources: T[]; outbound_ids: number[] }>()
  const text = (value: unknown) => String(value ?? '').trim()
  const sum = (a: unknown, b: unknown) => Number(((Number(a) || 0) + (Number(b) || 0)).toPrecision(15))
  items.forEach((item, index) => {
    const material = materials.get(item.material_id!)
    const packing = parseShipmentPacking(item.qty_per_carton)
    // Imported/unidentified materials and explicit box ranges cannot safely be
    // collapsed: range labels and per-batch packing must remain intact.
    const eligible = !!material && Number(item.material_id) > 0 && Number(item.outbound_id) > 0
      && !item.material_snapshot && ['uniform', 'empty'].includes(packing.mode)
    const key = eligible ? JSON.stringify([
      item.material_id, text(item.supplier || material?.supplier),
      effectiveCustomsCompany(item, material, fallback), invoiceCustomsCompany(item, material),
      text(material?.unit_kg || 'KGM'), text(item.purchase_unit || (isPaperRope(material?.name_zh) ? '米' : '个')),
      Number(item.price) || 0, text(item.currency || '¥'),
      text(item.bl_head), text(item.contract_no), text(item.contract_date),
      text(item.invoice_no), text(item.invoice_date), text(item.po_date),
      text(item.formula_name || material?.name_zh), text(item.product_use),
      packing.averageQty, item.weighing_qty ?? shipmentWeightQuantity(material?.name_zh, packing.averageQty),
      text(item.pallet), text(item.carton_no), text(item.carton_group),
      item.carton_group ? Number(item.cartons) || 0 : null,
    ]) : JSON.stringify(['single', index])
    const group = groups.get(key)
    if (!group) {
      groups.set(key, { ...item, sources: [item], outbound_ids: item.outbound_id ? [item.outbound_id] : [] })
      return
    }
    group.sources.push(item)
    group.outbound_ids = [...new Set([...group.outbound_ids, item.outbound_id!])]
    group.qty = sum(group.qty, item.qty)
    group.kg = sum(group.kg, item.kg)
    // Shared cartons are counted once; independent batches retain their actual
    // carton counts, never ceil(total quantity / standard packing).
    if (!group.carton_group) group.cartons = sum(group.cartons, item.cartons)
    group.po_no = [...new Set(group.sources.map(source => text(source.po_no)).filter(Boolean))].join(' / ')
    // Keep the last batch's position. Company surcharges belong to the last
    // line, so a non-adjacent merge must not move that fee to another contract.
    groups.delete(key)
    groups.set(key, group)
  })
  return [...groups.values()]
}
