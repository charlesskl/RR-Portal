import type { Material } from '../api/client'

export interface PurchaseMaterialGroup {
  key: string
  code: string
  label: string
  quantity: number
}

export interface PurchaseMaterialChoice {
  key: string
  groupKey?: string
  productCode: string
  label: string
  material: Material
  quantity: number
}

export function purchaseMaterialChoices(materials: Material[], code: string, group?: PurchaseMaterialGroup): PurchaseMaterialChoice[] {
  return materials.filter(m => m.id != null && m.active !== false).map(material => ({
    key: group ? `${group.key}:${material.id}` : String(material.id),
    groupKey: group?.key,
    productCode: group?.code || code,
    label: group?.label || '',
    material,
    quantity: group?.quantity ?? 0,
  }))
}

export function selectedPurchaseMaterials(choices: PurchaseMaterialChoice[], keys: string[], quantities: Record<string, number>) {
  const selected = new Set(keys)
  return choices.filter(choice => selected.has(choice.key)).map(choice => ({
    ...choice, quantity: quantities[choice.key] ?? choice.quantity,
  }))
}

export function purchaseMaterialLine(choice: PurchaseMaterialChoice, currency: string) {
  const m = choice.material
  const usage = m.usage_qty == null ? 1 : Math.max(0, Number(m.usage_qty) || 0)
  return {
    product_code: choice.productCode, material_id: m.id,
    material_name: m.name_zh || '', category: m.category || '', spec: m.spec || '',
    usage_qty: usage, ordered_qty: choice.quantity, material_qty: choice.quantity * usage,
    price: 0, currency, purchase_unit: '个', ship_unit: m.unit_kg || 'PCE',
    net_per_pc: Number(m.net_per_pc) || 0, notes: '',
  }
}

export function purchaseMaterialBucket(source: string | undefined, supplier: string, groupKey?: string) {
  return [(source || '').trim().toUpperCase() === 'RRM' ? 'RRM' : 'RRI', supplier, groupKey ?? ''].join('\u0000')
}

export function purchaseSelectionSource(choices: PurchaseMaterialChoice[], sources: Record<string, string | undefined>, currentPoNo = '') {
  const selected = new Set(choices.filter(c => c.groupKey != null).map(c =>
    (sources[c.groupKey!] || '').trim().toUpperCase() === 'RRM' ? 'RRM' : 'RRI'))
  if (selected.size > 1) throw new Error('RRI 与 RRM 排期请分开下单，或使用按供应商生成采购单。')
  const source = [...selected][0]
  const number = currentPoNo.trim().toUpperCase()
  const current = number.startsWith('IRRM') ? 'RRM'
    : number.startsWith('IRRI') || /^\d{5,}$/.test(number) ? 'RRI' : undefined
  if (source && current && source !== current) {
    throw new Error(`所选 ${source} 排期与当前 ${current} 采购单不一致，请使用批量下单另建采购单。`)
  }
  return source
}

export function purchaseSelectionSupplier(choices: PurchaseMaterialChoice[], currentSupplier = '') {
  const suppliers = [...new Set(choices.map(c => (c.material.supplier || '').trim()))]
  if (suppliers.includes('')) throw new Error('所选物料有未填写供应商的记录，请先在货号库补齐。')
  if (suppliers.length !== 1) throw new Error(`已选物料属于 ${suppliers.length} 家供应商。加入当前采购单需选择同一供应商；多家供应商请点击「批量下单」。`)
  if (currentSupplier.trim() && currentSupplier.trim().toLowerCase() !== suppliers[0].toLowerCase()) {
    throw new Error('所选物料供应商与当前采购单不一致，请分开下单。')
  }
  return currentSupplier.trim() || suppliers[0]
}
