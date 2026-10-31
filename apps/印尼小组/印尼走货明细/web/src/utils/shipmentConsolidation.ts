import type { Material } from '../api/client'
import type { CustomsItem } from './customsExport'
import { effectiveCustomsCompany, sortShipmentItems } from './shipmentOrder'
import { invoiceCustomsCompany } from './shipmentInvoice'
import { shipmentChargeQuantity, shipmentPurchaseAmount } from './shipmentPurchase'
import { isPaperRope, parseShipmentPacking, shipmentWeightQuantity } from './shipmentWeight'

type BatchItem = CustomsItem & { outbound_id?: number; carton_no?: string; material_snapshot?: unknown }

// Presentation only. Never save these rows: allocation remains per outbound record.
// Call once for a single shipment/container, not across a list of shipments.
export function consolidateShipmentItems<T extends BatchItem>(
  items: readonly T[], materials: ReadonlyMap<number, Material>, fallback?: string,
): Array<T & { sources: T[]; outbound_ids: number[]; purchase_charge_ratio?: number }> {
  const groups = new Map<string, T & { sources: T[]; outbound_ids: number[]; purchase_charge_ratio?: number }>()
  const text = (value: unknown) => String(value ?? '').trim()
  const sum = (a: unknown, b: unknown) => Number(((Number(a) || 0) + (Number(b) || 0)).toPrecision(15))
  // Sort before choosing the surviving position: shared-carton ordering also
  // determines which contract owns a company's final-line surcharge.
  sortShipmentItems(items, materials, fallback).forEach((item, index) => {
    const material = materials.get(item.material_id!)
    const snapshot = item.material_snapshot as Material | undefined
    const identity = snapshot ? snapshot.id : item.material_id
    const confirmedSnapshot = !!snapshot && Number(snapshot.id) > 0 && snapshot.id === material?.id
      && !!text(snapshot.name_zh) && text(snapshot.name_zh) === text(material?.name_zh)
    const packing = parseShipmentPacking(item.qty_per_carton)
    // Unlinked/unconfirmed imports and per-box packing schedules cannot
    // safely be collapsed. Carton number labels, however, identify batches,
    // not different goods: retain all labels on the consolidated display row.
    const eligible = !!material && Number(identity) > 0 && Number(item.outbound_id) > 0
      && Number.isFinite(Number(item.kg)) && Number(item.kg) > 0
      && Number.isFinite(Number(item.qty)) && Number(item.qty) > 0
      && (!snapshot || confirmedSnapshot) && ['uniform', 'empty'].includes(packing.mode)
    const key = eligible ? JSON.stringify([
      identity, text(item.supplier || material?.supplier),
      // Confirmed local snapshots may use different negative editor keys. Merge
      // only when their actual declaration/packing attributes are identical.
      ...['name_zh', 'name_en', 'product_code', 'related_product_code', 'spec', 'category', 'hs_cn', 'hs_id',
        'tool_kind', 'length', 'width', 'height', 'weight_per_carton', 'gross_per_pc', 'net_per_pc'].map(field => material?.[field as keyof Material] ?? ''),
      // Blank imported HS is an explicit declaration, while ordinary rows can
      // inherit product HS. Those different semantics must never collapse.
      ...(['hs_cn', 'hs_id'] as const).map(field => snapshot
        ? material?.shipment_hs_product_fallback === true && material[field] == null : !material?.[field]),
      effectiveCustomsCompany(item, material, fallback), invoiceCustomsCompany(item, material),
      text(material?.unit_kg || 'KGM'), text(item.purchase_unit || (isPaperRope(material?.name_zh) ? '米' : '个')),
      text(item.currency || '¥'),
      text(item.bl_head), text(item.contract_no), text(item.contract_date),
      text(item.invoice_no), text(item.invoice_date),
      text(item.formula_name || material?.name_zh), text(item.product_use),
      packing.averageQty, item.weighing_qty ?? shipmentWeightQuantity(material?.name_zh, packing.averageQty),
      text(item.pallet), text(item.carton_group),
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
    // PO prices may differ. Preserve each batch's amount instead of applying
    // the first purchase order's price to the combined quantity.
    const chargeQty = group.sources.reduce((qty, source) => qty + shipmentChargeQuantity(source), 0)
    // Summed decimal purchase quantities can exceed their normalized total by
    // float dust (0.1 + 0.2). The fraction is never physically greater than one.
    group.purchase_charge_ratio = Math.min(1, chargeQty / group.qty)
    group.price = chargeQty > 0 ? group.sources.reduce((amount, source) => amount + shipmentPurchaseAmount(source), 0) / chargeQty : 0
    const dates = [...new Set(group.sources.map(source => text(source.po_date)).filter(Boolean))]
    group.po_date = dates.length === 1 ? dates[0] : undefined
    // Shared cartons are counted once; independent batches retain their actual
    // carton counts, never ceil(total quantity / standard packing).
    if (!group.carton_group) group.cartons = sum(group.cartons, item.cartons)
    // Preserve complete labels (including ranges and alphanumeric numbers).
    // Do not infer counts from these labels or overwrite the source batches.
    group.carton_no = [...new Set(group.sources.map(source => text(source.carton_no)).filter(Boolean))].join(' / ')
    group.po_no = [...new Set(group.sources.map(source => text(source.po_no)).filter(Boolean))].join(' / ')
    // Keep the last batch's position. Company surcharges belong to the last
    // line, so a non-adjacent merge must not move that fee to another contract.
    groups.delete(key)
    groups.set(key, group)
  })
  return [...groups.values()]
}
