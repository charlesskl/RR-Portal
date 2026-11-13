import type { Material } from '../api/client'
import type { CustomsItem } from './customsExport'
import { effectiveCustomsCompany, sortShipmentItems, shipmentKeepsImportOrder } from './shipmentOrder'
import { invoiceCustomsCompany } from './shipmentInvoice'
import { shipmentChargeQuantity, shipmentPurchaseAmount } from './shipmentPurchase'
import { isPaperRope, parseShipmentPacking, shipmentWeightQuantity } from './shipmentWeight'
import { shipmentDecimalTicks } from './shipmentDecimal'

type BatchItem = CustomsItem & { outbound_id?: number; carton_no?: string; material_snapshot?: unknown }

// Presentation only. Never save these rows: allocation remains per outbound record.
// Call once for a single shipment/container, not across a list of shipments.
export function consolidateShipmentItems<T extends BatchItem>(
  items: readonly T[], materials: ReadonlyMap<number, Material>, fallback?: string,
): Array<T & { sources: T[]; outbound_ids: number[]; purchase_charge_ratio?: number; packing_source?: T; invoice_company_last?: boolean }> {
  const groups = new Map<string, T & { sources: T[]; outbound_ids: number[]; purchase_charge_ratio?: number; packing_source?: T; invoice_company_last?: boolean }>()
  const text = (value: unknown) => String(value ?? '').trim()
  const sum = (...values: unknown[]) => {
    const numbers = values.map(value => Number(value) || 0)
    const ticks = numbers.map(shipmentDecimalTicks)
    // Stored qty/kg have four decimal places. Preserve them rather than cutting
    // a valid large batch total down to fifteen significant digits.
    if (ticks.every((value): value is number => value != null)) {
      const total = ticks.reduce((result, value) => result + BigInt(value), 0n)
      if (total >= -BigInt(Number.MAX_SAFE_INTEGER) && total <= BigInt(Number.MAX_SAFE_INTEGER))
        return Number(total) / 10000
    }
    return Number(numbers.reduce((a, b) => a + b, 0).toPrecision(15))
  }
  // Supplementary allocations from the same outbound can have no packing
  // data. Attach them only to one unambiguous packed row of that material.
  const ordered = sortShipmentItems(items, materials, fallback)
  const keepImportOrder = shipmentKeepsImportOrder(items)
  const lastCompanySource = new Map<string, T>()
  for (const item of ordered) lastCompanySource.set(invoiceCustomsCompany(item, materials.get(item.material_id!)), item)
  const supplementKey = (item: T) => {
    const material = materials.get(item.material_id!)
    const snapshot = item.material_snapshot as Material | undefined
    const identity = snapshot?.id ?? item.material_id
    if (!material || !(Number(identity) > 0) || !(Number(item.outbound_id) > 0)
      || !(Number(item.qty) > 0) || !(Number(item.kg) > 0)
      || !Number.isFinite(Number(item.qty)) || !Number.isFinite(Number(item.kg))
      || snapshot && (snapshot.id !== material.id || !text(snapshot.name_zh) || text(snapshot.name_zh) !== text(material.name_zh)))
      return null
    return JSON.stringify([identity, item.outbound_id,
      text(item.supplier || material.supplier), effectiveCustomsCompany(item, material, fallback), invoiceCustomsCompany(item, material),
      ...['name_zh', 'product_code', 'related_product_code', 'spec', 'category', 'hs_cn', 'hs_id', 'tool_kind'].map(field => material[field as keyof Material] ?? ''),
      ...(['hs_cn', 'hs_id'] as const).map(field => snapshot
        ? material.shipment_hs_product_fallback === true && material[field] == null : !material[field]),
      text(material.unit_kg || 'KGM'), text(item.purchase_unit || (isPaperRope(material.name_zh) ? '米' : '个')),
      text(item.currency || '¥'), text(item.contract_no), text(item.contract_date),
      text(item.invoice_no), text(item.invoice_date), text(item.formula_name || material.name_zh),
    ])
  }
  const packedByKey = new Map<string, T[]>()
  for (const item of ordered) {
    const key = supplementKey(item)
    const packing = parseShipmentPacking(item.qty_per_carton)
    if (!key || !(Number(item.cartons) > 0) || item.carton_group
      || (item.material_snapshot as Material | undefined)?.shipment_outbound_link_group
      || !['uniform', 'ranges'].includes(packing.mode)) continue
    packedByKey.set(key, [...(packedByKey.get(key) || []), item])
  }
  const supplementOwners = new Map<T, T>()
  for (const item of ordered) {
    const material = materials.get(item.material_id!)
    if (Number(item.cartons) || item.carton_group || text(item.pallet) || text(item.carton_no)
      || (item.material_snapshot as Material | undefined)?.shipment_outbound_link_group
      || parseShipmentPacking(item.qty_per_carton).mode !== 'empty'
      || ['length', 'width', 'height', 'weight_per_carton'].some(field => Number(material?.[field as keyof Material])))
      continue
    const key = supplementKey(item)
    const candidates = key ? (packedByKey.get(key) || []).filter(packed =>
      ['bl_head', 'product_use'].every(field => !text(item[field as keyof T])
        || text(item[field as keyof T]) === text(packed[field as keyof T]))) : []
    if (candidates.length !== 1) continue
    supplementOwners.set(item, candidates[0])
    supplementOwners.set(candidates[0], candidates[0])
  }
  // Sort before choosing the surviving position: shared-carton ordering also
  // determines which contract owns a company's final-line surcharge.
  ordered.forEach((item, index) => {
    const material = materials.get(item.material_id!)
    const snapshot = item.material_snapshot as Material | undefined
    const identity = snapshot ? snapshot.id : item.material_id
    const confirmedSnapshot = !!snapshot && Number(snapshot.id) > 0 && snapshot.id === material?.id
      && !!text(snapshot.name_zh) && text(snapshot.name_zh) === text(material?.name_zh)
    const packing = parseShipmentPacking(item.qty_per_carton)
    const linkedPacking = confirmedSnapshot && !!snapshot?.shipment_outbound_link_group
    // Unlinked/unconfirmed imports and per-box packing schedules cannot
    // safely be collapsed. Carton number labels, however, identify batches,
    // not different goods: retain all labels on the consolidated display row.
    const eligible = !!material && Number(identity) > 0 && Number(item.outbound_id) > 0
      && Number.isFinite(Number(item.kg)) && (Number(item.kg) > 0 || (linkedPacking && Number(item.kg) === 0))
      && Number.isFinite(Number(item.qty)) && Number(item.qty) > 0
      && (!snapshot || confirmedSnapshot) && (['uniform', 'empty'].includes(packing.mode) || (linkedPacking && packing.mode === 'ranges'))
    const owner = supplementOwners.get(item)
    const key = owner ? JSON.stringify(['supplement', ordered.indexOf(owner)]) : eligible ? JSON.stringify([
      identity, text(item.supplier || material?.supplier),
      linkedPacking ? [snapshot.shipment_outbound_link_group, text(item.qty_per_carton)] : null,
      // Confirmed local snapshots may use different translations for the same
      // material ID. Declaration and packing attributes still define boundaries.
      ...['name_zh', 'product_code', 'related_product_code', 'spec', 'category', 'hs_cn', 'hs_id',
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
      groups.set(key, { ...(owner || item), qty: item.qty, kg: item.kg, cartons: item.cartons,
        price: item.price, purchase_charge_ratio: item.purchase_charge_ratio,
        sources: [item], outbound_ids: item.outbound_id ? [item.outbound_id] : [],
        // Display-only owner: editing packing must not give an unboxed
        // supplementary allocation new cartons or modify its material master.
        ...(owner ? { packing_source: owner } : {}) })
      return
    }
    group.sources.push(item)
    group.outbound_ids = [...new Set([...group.outbound_ids, item.outbound_id!])]
    group.qty = sum(...group.sources.map(source => source.qty))
    group.kg = sum(...group.sources.map(source => source.kg))
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
    // Catalog-only lists retain their last-batch position. Imported lists keep
    // the first file position; surcharge ownership is carried separately below.
    if (!keepImportOrder) { groups.delete(key); groups.set(key, group) }
  })
  return [...groups.values()].map(group => ({ ...group,
    // A merged import keeps its first file position. Preserve surcharge
    // ownership from its source batches rather than charging another contract.
    invoice_company_last: group.sources.includes(lastCompanySource.get(invoiceCustomsCompany(group, materials.get(group.material_id!)))!),
  }))
}
