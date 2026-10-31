import type { Material } from '../api/client'
import { cartonGroupKey } from './shipmentOrder'
import { mergeShipmentImportMaterial, planShipmentImport, type ExistingShipmentImportRow, type ShipmentImportItem } from './shipmentImport'

const linkedFields = ['cartons', 'carton_no', 'carton_group', 'qty_per_carton', 'weighing_qty', 'pallet',
  'customs_company', 'bl_head', 'contract_no', 'contract_date', 'invoice_no', 'invoice_date', 'product_use', 'formula_name'] as const
const linkedMaterialFields = ['length', 'width', 'height', 'weight_per_carton', 'gross_per_pc', 'hs_cn', 'hs_id',
  'name_en', 'image', 'import_source'] as const
const present = (value: unknown) => value != null && value !== ''

/** A file may update declaration/packing data, never the linked stock or PO basis. */
export function applyShipmentImport(existing: readonly ExistingShipmentImportRow[], materials: ReadonlyMap<number, Material>,
  imported: readonly ShipmentImportItem[], targets: readonly number[]): ExistingShipmentImportRow[] {
  const current = existing.map(row => ({ ...row, material_snapshot: materials.get(row.material_id!) || row.material_snapshot }))
  const planned = planShipmentImport([...imported], current)
  if (targets.length !== imported.length || planned.some((target, index) => target < -1 || target !== targets[index]))
    throw new Error('匹配结果已变化或存在重复匹配，请重新核对后导入')
  const next = [...existing]
  const affectedGroups = new Set<string>()
  imported.forEach((row, index) => {
    const target = targets[index]
    if (target === -1) { next.push({ ...row, material_snapshot: { ...row.material_snapshot } }); return }
    const old = existing[target], material = current[target].material_snapshot
    const oldGroup = cartonGroupKey(old, materials)
    if (oldGroup) affectedGroups.add(oldGroup)
    if (!old.outbound_id) {
      const provided = Object.fromEntries(Object.entries(row).filter(([, value]) => present(value)))
      next[target] = { ...old, ...provided, material_snapshot: mergeShipmentImportMaterial(material, row.material_snapshot) }
    } else {
      for (const field of ['cartons', 'weighing_qty'] as const) if (present(row[field])
        && (!Number.isFinite(Number(row[field])) || Number(row[field]) < 0 || (field === 'cartons' && !Number.isInteger(Number(row[field])))))
        throw new Error(`第 ${target + 1} 行${field === 'cartons' ? '箱数必须为非负整数' : '称重数量必须为非负数'}`)
      for (const field of ['length', 'width', 'height', 'weight_per_carton', 'gross_per_pc'] as const)
        if (present(row.material_snapshot[field]) && (!Number.isFinite(Number(row.material_snapshot[field])) || Number(row.material_snapshot[field]) < 0))
          throw new Error(`第 ${target + 1} 行尺寸或重量无效，请核对文件后导入`)
      const patch = Object.fromEntries(linkedFields.filter(field => present(row[field])).map(field => [field, row[field]]))
      // Preserve an existing physical carton group even when the uploaded file
      // uses a fresh editor-local group ID. Partial conflicting updates fail below.
      if (old.carton_group) patch.carton_group = old.carton_group
      const merged = mergeShipmentImportMaterial(material, row.material_snapshot)
      const snapshot = { ...material }
      for (const field of linkedMaterialFields) if (present(merged[field])) Object.assign(snapshot, { [field]: merged[field] })
      // The backend checks snapshot.id against the outbound's actual material.
      const materialId = old.material_snapshot?.id || (Number(old.material_id) > 0 ? old.material_id : material?.id)
      if (!(Number(materialId) > 0)) throw new Error(`第 ${target + 1} 行缺少已确认的出库物料 ID，请重新关联后导入`)
      snapshot.id = materialId
      const changedMaterial = !material || Object.keys(snapshot).some(key => JSON.stringify(snapshot[key as keyof Material]) !== JSON.stringify(material[key as keyof Material]))
      next[target] = { ...old, ...patch,
        // A local snapshot retains the confirmed material identity. Identical
        // linked snapshots can still consolidate across source batches.
        ...(old.material_snapshot || changedMaterial ? { material_snapshot: snapshot } : {}),
      }
    }
    const newGroup = cartonGroupKey(next[target], materials)
    if (newGroup) affectedGroups.add(newGroup)
  })
  for (const key of affectedGroups) {
    const before = existing.filter(row => cartonGroupKey(row, materials) === key)
    const after = next.filter(row => cartonGroupKey(row, materials) === key)
    if (before.some(row => row.outbound_id) && before.length > 1
      && existing.some((row, index) => cartonGroupKey(row, materials) === key && cartonGroupKey(next[index], materials) !== key))
      throw new Error('更新报关公司会拆开已有共箱，请先取消合并箱数再导入')
    if (after.length > 1 && (new Set(after.map(row => Number(row.cartons) || 0)).size !== 1
      || after.some(row => !(Number(row.cartons) > 0))))
      throw new Error('共箱箱数不一致，请同时更新全部共箱明细或先取消合并箱数')
  }
  return next
}
