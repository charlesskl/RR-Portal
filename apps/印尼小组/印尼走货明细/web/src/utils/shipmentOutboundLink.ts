import type { Material } from '../api/client'
import { shipmentScope } from './shipmentOrder'

export interface LinkableShipmentRow {
  _rowKey?: number; material_id?: number; material_snapshot?: Material; outbound_id?: number
  qty?: number; purchase_unit?: string; carton_group?: string; supplier?: string; customs_company?: string
  po_no?: string; po_date?: string; price?: number; currency?: string
}
export interface ShipmentOutboundSource {
  outbound_id: number; material_id?: number; allocatable_qty?: number; purchase_unit?: string
  po_no?: string; po_date?: string; supplier?: string; customs_company?: string; price?: number; currency?: string
}
export function shipmentQuantityUnit(value?: string) {
  const text = (value || '个').trim().toUpperCase()
  const aliases: Record<string, string> = { '个': 'PCE', '件': 'PCE', PCS: 'PCE', PC: 'PCE', PCE: 'PCE',
    '套': 'SET', SETS: 'SET', SET: 'SET', '千克': 'KGM', '公斤': 'KGM', KG: 'KGM', KGM: 'KGM', '吨': 'TNE', TNE: 'TNE', '米': 'MTR', M: 'MTR', MTR: 'MTR' }
  return aliases[text] || text
}
export function remainingOutboundQuantity(rows: readonly LinkableShipmentRow[], rowKey: number, source: ShipmentOutboundSource) {
  const used = rows.filter(r => r._rowKey !== rowKey && r.outbound_id === source.outbound_id)
    .reduce((sum, r) => sum + Number(r.qty || 0), 0)
  return Math.max(0, Number(source.allocatable_qty || 0) - used)
}

// Explicitly confirmed mapping; never append rows or change inventory/master data.
export function linkShipmentOutbound<T extends LinkableShipmentRow>(rows: readonly T[], rowKey: number,
  source: ShipmentOutboundSource, material: Material, materials: ReadonlyMap<number, Material>): T[] {
  const row = rows.find(r => r._rowKey === rowKey)
  if (!row) throw new Error('明细已变化，请重新打开关联出库')
  if (row.outbound_id) throw new Error('该行已有出库关联，请勿重复关联')
  if (!Number.isInteger(source.outbound_id) || source.outbound_id <= 0 || !material.id || material.id !== source.material_id)
    throw new Error('出库对应物料无效，请刷新重试')
  const knownId = row.material_snapshot?.id || (!row.material_snapshot ? row.material_id : undefined)
  if (knownId && knownId > 0 && knownId !== material.id) throw new Error('出库物料与当前明细不一致')
  if (!Number.isFinite(row.qty) || !(row.qty! > 0)) throw new Error('请先填写大于 0 的本柜送货数量')
  if (shipmentQuantityUnit(row.purchase_unit) !== shipmentQuantityUnit(source.purchase_unit))
    throw new Error('送货数量单位与出库单位不一致，请先核对数量及单位，不能直接换算关联')
  if (row.qty! > remainingOutboundQuantity(rows, rowKey, source) + 1e-8)
    throw new Error('本行数量超过出库剩余可分配数量（已扣除本柜其他明细），请核对或拆行')
  const next: T = { ...row, outbound_id: source.outbound_id,
    material_id: row.material_snapshot ? row.material_id : material.id,
    po_no: source.po_no || '', po_date: source.po_date?.slice(0, 10) || '',
    supplier: source.supplier || material.supplier || '', customs_company: source.customs_company || material.customs_company || row.customs_company,
    price: source.price ?? row.price, currency: source.currency || row.currency, purchase_unit: source.purchase_unit || '个',
  }
  if (row.material_snapshot) {
    // Keep the local packing/weight snapshot; use the explicitly confirmed identity.
    next.material_snapshot = { ...(materials.get(row.material_id!) || row.material_snapshot), id: material.id,
      product_code: material.product_code || material.related_product_code, name_zh: material.name_zh, spec: material.spec,
      supplier: next.supplier, customs_company: next.customs_company }
  }
  if (row.carton_group && shipmentScope(row, materials) !== shipmentScope(next, materials))
    throw new Error('关联后供应商或报关公司变化，请先取消该行的合并箱数再关联')
  const partitions = new Set(rows.map(r => (r._rowKey === rowKey ? next : r).po_no?.trim().toUpperCase().match(/^IRR[IM]/)?.[0]).filter(Boolean))
  if (partitions.size > 1) throw new Error('关联后会混合 RRI 与 RRM 的 PO，请拆柜处理')
  return rows.map(r => r._rowKey === rowKey ? next : r)
}
