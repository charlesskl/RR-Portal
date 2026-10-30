import { cartonGroupKey } from './shipmentOrder'
import { formatShipmentPackingLines, shipmentCartonCount, shipmentKgWeight, shipmentWeightQuantity } from './shipmentWeight'
import { isShipmentCountUnit, normalizeShipmentDeclarations, rebaseShipmentDeclaration } from './shipmentDeclaration'
import { shipmentUsesDeclarationPrice } from './shipmentPurchase'

// Same physical column order as the detail table; protected columns still occupy
// a position during paste, so data can never slide into a neighbouring field.
export const shipmentSheetFields = [
  '', '', '', '', '', '', 'snapshot:hs_cn', 'snapshot:hs_id', 'formula_name', '', '', '',
  'material:unit_kg', 'kg', 'qty', '', '', '', '', '', 'product_use',
  'contract_no', 'contract_date', 'invoice_no', 'invoice_date', '', '',
  'supplier', 'po_date', 'po_no', 'price', 'currency', '', 'customs_company',
  'bl_head', 'cartons', 'qty_per_carton', 'pallet', 'carton_no',
  'material:length', 'material:width', 'material:height', 'material:weight_per_carton',
  'weighing_qty', '', 'material:net_per_pc', '',
] as const

export interface SheetEdit { row: number; field: string; value: string }
export interface SheetPoint { row: number; col: number }

/** Excel fill-down: a single row copies from the row above; a range uses its top row. */
export function sheetFillDownEdits(anchor: SheetPoint | null, end: SheetPoint | null, rowCount: number,
  fields: readonly string[], valueAt: (row: number, field: string) => string | number | undefined): SheetEdit[] {
  if (!anchor || !end) throw new Error('请先点击要填充的单元格，或按住 Shift 点击选择多行')
  if ([anchor, end].some(p => !Number.isInteger(p.row) || !Number.isInteger(p.col)
    || p.row < 0 || p.row >= rowCount || p.col < 0 || p.col >= fields.length))
    throw new Error('明细已变化，请重新选择范围')
  const first = Math.min(anchor.row, end.row), bottom = Math.max(anchor.row, end.row)
  const source = first === bottom ? first - 1 : first
  if (source < 0) throw new Error('第一行没有上一行；请选中第一行及下方目标行后向下填充')
  const edits: SheetEdit[] = []
  for (let col = Math.min(anchor.col, end.col); col <= Math.max(anchor.col, end.col); col++) {
    const field = fields[col]
    if (!field) continue
    const value = String(valueAt(source, field) ?? '')
    for (let row = source + 1; row <= bottom; row++) edits.push({ row, field, value })
  }
  if (!edits.length) throw new Error('所选范围没有可填充的列')
  return edits
}

/** Excel clipboard TSV, including quoted multiline cells and escaped quotes. */
export function parseSheetClipboard(text: string): string[][] {
  if (text.length > 1_000_000) throw new Error('粘贴内容过大，请分批操作')
  const rows: string[][] = []; let row: string[] = []; let value = ''; let quoted = false
  const input = text.replace(/\r\n?/g, '\n')
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (ch === '"') {
      if (quoted && input[i + 1] === '"') { value += '"'; i++ }
      else if (quoted || !value) quoted = !quoted
      else value += ch
    } else if (!quoted && (ch === '\t' || ch === '\n')) {
      row.push(value); value = ''
      if (ch === '\n') { rows.push(row); row = [] }
    } else value += ch
  }
  if (quoted) throw new Error('粘贴内容中的引号未闭合')
  row.push(value); rows.push(row)
  if (input.endsWith('\n') && rows.at(-1)?.length === 1 && rows.at(-1)?.[0] === '') rows.pop()
  if (rows.reduce((n, r) => n + r.length, 0) > 10000) throw new Error('一次最多粘贴 10000 个单元格')
  return rows
}

export function sheetPasteEdits(matrix: string[][], start: SheetPoint, rowCount: number,
  fields: readonly string[] = shipmentSheetFields): SheetEdit[] {
  if (start.row < 0 || start.col < 0 || start.row + matrix.length > rowCount
    || matrix.some(row => start.col + row.length > fields.length))
    throw new Error('粘贴超出已有明细范围，请先添加对应物料行或缩小粘贴范围')
  const edits: SheetEdit[] = []
  matrix.forEach((row, dr) => row.forEach((value, dc) => {
    const field = fields[start.col + dc]
    if (!field) {
      if (value.trim()) throw new Error(`第 ${start.row + dr + 1} 行、第 ${start.col + dc + 1} 列是受保护列，不能覆盖`)
    } else edits.push({ row: start.row + dr, field, value })
  }))
  return edits
}

/** Paste at a single cell, or repeat the entire copied block over a selection. */
export function sheetPasteSelectionEdits(matrix: string[][], anchor: SheetPoint, end: SheetPoint | null,
  rowCount: number, fields: readonly string[] = shipmentSheetFields): SheetEdit[] {
  if (!end || (anchor.row === end.row && anchor.col === end.col))
    return sheetPasteEdits(matrix, anchor, rowCount, fields)
  const start = { row: Math.min(anchor.row, end.row), col: Math.min(anchor.col, end.col) }
  const rows = Math.abs(anchor.row - end.row) + 1, columns = Math.abs(anchor.col - end.col) + 1
  if (!Number.isSafeInteger(rows) || !Number.isSafeInteger(columns) || rows * columns > 10000)
    throw new Error('一次最多粘贴 10000 个单元格')
  // Reject an invalid range before allocating its matrix or changing any data.
  if (start.row < 0 || start.col < 0 || start.row + rows > rowCount || start.col + columns > fields.length)
    throw new Error('粘贴超出已有明细范围，请先添加对应物料行或缩小粘贴范围')
  const height = matrix.length, width = matrix[0]?.length || 0
  if (!height || !width || matrix.some(row => row.length !== width))
    throw new Error('复制区域的列数不一致，请复制完整的矩形区域')
  if (rows % height !== 0 || columns % width !== 0)
    throw new Error(`目标选区为 ${rows} 行 × ${columns} 列，需为复制区域 ${height} 行 × ${width} 列的整倍数；也可只点目标左上角再粘贴`)
  return sheetPasteEdits(Array.from({ length: rows }, (_, row) =>
    Array.from({ length: columns }, (_, col) => matrix[row % height][col % width])), start, rowCount, fields)
}

const numbers = new Set(['kg', 'qty', 'price', 'cartons', 'weighing_qty',
  'material:length', 'material:width', 'material:height', 'material:weight_per_carton', 'material:net_per_pc'])
const dates = new Set(['contract_date', 'invoice_date', 'po_date'])
const enums: Record<string, string[]> = {
  'material:unit_kg': ['KGM', 'PCE', 'SET', 'TNE'],
  currency: ['IDR', '¥', 'HK$', 'US$', '€', '£', '¥(JPY)'],
  bl_head: ['華登製品實業有限公司', '華登(全球)有限公司', '东莞市雅洛轩进出口贸易有限公司'],
}
export function parseShipmentSheetValue(field: string, raw: string): string | number {
  if (!field || !shipmentSheetFields.includes(field as typeof shipmentSheetFields[number]))
    throw new Error('此列不允许批量修改')
  const value = raw.trim()
  if (field === 'snapshot:hs_cn' || field === 'snapshot:hs_id') {
    const limit = field === 'snapshot:hs_cn' ? 10 : 8
    if (!new RegExp(`^\\d{0,${limit}}$`).test(value))
      throw new Error(`海关编码只可填写最多 ${limit} 位数字（可留空，保留前导零）`)
    return value
  }
  if (numbers.has(field)) {
    // Accept standard thousands separators, not arbitrary commas or expressions.
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(value) && value !== '' && !/^\.\d+$/.test(value))
      throw new Error('请输入非负数字（不支持公式）')
    const number = Number(value.replaceAll(',', ''))
    if (!Number.isFinite(number) || number > Number.MAX_SAFE_INTEGER) throw new Error('数字超出有效范围')
    if (field === 'cartons' && !Number.isInteger(number)) throw new Error('箱数必须为整数')
    return number
  }
  if (dates.has(field) && value) {
    const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(value)
    if (!m) throw new Error('日期格式应为 YYYY-MM-DD')
    const date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
    const parsed = new Date(date + 'T00:00:00Z')
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error('日期不存在')
    return date
  }
  if (enums[field] && !enums[field].includes(value) && !(field === 'bl_head' && !value))
    throw new Error(`可用值：${enums[field].join('、')}`)
  if (value.startsWith('=')) throw new Error('这里填写资料数值，不执行 Excel 公式')
  return field === 'qty_per_carton' ? formatShipmentPackingLines(value) : value
}

interface EditableShipment {
  material_id?: number; qty?: number; kg?: number; cartons?: number; qty_per_carton?: string
  carton_group?: string; supplier?: string; customs_company?: string
  material_snapshot?: unknown; outbound_id?: number; price?: number
}

/** Validate first; operate on copies, recalculate once, never remap IDs/sources. */
export function applyShipmentSheetEdits<T extends EditableShipment>(items: T[], materials: Map<number, any>, edits: SheetEdit[]) {
  const parsed = edits.map(edit => {
    try {
      if (!items[edit.row]) throw new Error('明细行已不存在')
      if (edit.field.startsWith('snapshot:') && (!items[edit.row].material_snapshot
        || typeof items[edit.row].material_snapshot !== 'object' || !(items[edit.row].material_id! < 0)))
        throw new Error('只有 Excel 导入行可在本单编辑海关编码，货号库物料仍为只读')
      if (edit.field.startsWith('material:') && !materials.has(items[edit.row].material_id!))
        throw new Error('请先选择物料，再填写单位或尺寸')
      return { ...edit, value: parseShipmentSheetValue(edit.field, edit.value) }
    } catch (error) { throw new Error(`第 ${edit.row + 1} 行：${(error as Error).message}`, { cause: error }) }
  })
  const original = normalizeShipmentDeclarations(items, materials)
  const next = original.map(item => ({ ...item })); const nextMaterials = new Map(materials)
  const dirtyMaterials = new Set<number>(); const reweight = new Set<number>(); const repack = new Set<number>()
  const explicitKg = new Map<number, number>(); const explicitCartons = new Map<number, number>()
  const materialValues = new Map<string, string | number>()
  for (const { row, field, value } of parsed) {
    const item = next[row]
    if (field.startsWith('snapshot:')) {
      const id = item.material_id!
      // Imported rows have unique negative editor IDs, even when their snapshot
      // references a real material. Never mark the real material as dirty.
      const snapshot = { ...(nextMaterials.get(id) || item.material_snapshot), [field.slice(9)]: value }
      item.material_snapshot = snapshot
      nextMaterials.set(id, snapshot)
    } else if (field.startsWith('material:')) {
      const id = item.material_id!; const key = `${id}:${field}`
      if (materialValues.has(key) && materialValues.get(key) !== value)
        throw new Error('相同物料的单位或尺寸填写了不同值，请统一后再粘贴')
      materialValues.set(key, value)
      nextMaterials.set(id, { ...nextMaterials.get(id), [field.slice(9)]: value })
      dirtyMaterials.add(id)
      if (field === 'material:unit_kg' || field === 'material:net_per_pc')
        next.forEach((it, i) => { if (it.material_id === id) reweight.add(i) })
    } else {
      Object.assign(item, { [field]: value })
      if (field === 'supplier' || field === 'customs_company') item.carton_group = undefined
      if (field === 'qty' || field === 'qty_per_carton') { reweight.add(row); repack.add(row) }
      if (field === 'kg') explicitKg.set(row, Number(value))
      if (field === 'cartons') explicitCartons.set(row, Number(value))
    }
  }
  for (const i of repack) if (!next[i].carton_group)
    next[i].cartons = shipmentCartonCount(next[i].qty, next[i].qty_per_carton)
  for (const i of reweight) {
    const m = nextMaterials.get(next[i].material_id!)
    next[i].kg = shipmentKgWeight(m?.unit_kg, next[i].qty, m?.net_per_pc, m?.name_zh)
  }
  // Explicit pasted weights win over derived weights within the same paste.
  explicitKg.forEach((value, i) => {
    const m = nextMaterials.get(next[i].material_id!)
    if (isShipmentCountUnit(m?.unit_kg) && value !== Number(next[i].qty || 0))
      throw new Error(`第 ${i + 1} 行：${m.unit_kg} 申报数量自动取送货数量，请修改“送货数量”，不能填公斤重量`)
    next[i].kg = value
  })
  // Rebase only after the entire paste has determined the final quantity and
  // measured weight. Edited kg/qty values cannot replace the source price basis.
  for (const i of reweight) {
    const before = original[i], m = nextMaterials.get(next[i].material_id!)
    const unit = (value: unknown) => String(value || 'KGM').trim().toUpperCase()
    if (unit(materials.get(before.material_id!)?.unit_kg) === unit(m?.unit_kg)
      || parsed.some(edit => edit.row === i && edit.field === 'price')
      || !shipmentUsesDeclarationPrice(before)) continue
    if (!(Number(before.qty) > 0) || !(Number(before.kg) > 0)) {
      if (before.price == null || Number(before.price) === 0) continue
      if (items[i].qty !== 0 || items[i].kg !== 0)
        throw new Error(`第 ${i + 1} 行：原申报数量或送货数量缺少有效计价基准，请核对原数量或明确填写新单位采购单价`)
      // An empty draft has no measured quantity to divide by. Infer only from
      // known unit/technical factors, without rounding a reference weight to 4dp.
      const factor = (material: any) => {
        const code = unit(material?.unit_kg)
        if (isShipmentCountUnit(code)) return 1
        const net = Number(material?.net_per_pc)
        if (!Number.isFinite(net) || net <= 0) return 0
        const kg = net * shipmentWeightQuantity(material?.name_zh, 1)
        return ['KGM', 'KG'].includes(code) ? kg : ['TNE', 'TON'].includes(code) ? kg / 1000 : 0
      }
      const oldFactor = factor(materials.get(before.material_id!)), newFactor = factor(m)
      const price = Number(before.price) * oldFactor / newFactor
      if (!(oldFactor > 0) || !(newFactor > 0) || !Number.isFinite(price))
        throw new Error(`第 ${i + 1} 行：缺少可确定的单位换算基准，请补齐净重资料或明确填写新单位采购单价`)
      next[i].price = price
      continue
    }
    // Keep the per-purchase-quantity amount when quantity changes with the unit.
    // For zero quantity, convert at the old quantity so restoring it later still
    // uses the new unit's price rather than the former kg price.
    const quantity = Number(next[i].qty) > 0 ? Number(next[i].qty) : Number(before.qty)
    const scale = parsed.some(edit => edit.row === i && edit.field === 'qty') && Number(before.qty) > 0
      ? quantity / Number(before.qty) : 1
    const basis = { ...before, kg: Number(before.kg) * scale }
    const denominator = Number(next[i].kg) > 0 ? Number(next[i].kg)
      : shipmentKgWeight(m?.unit_kg, quantity, m?.net_per_pc, m?.name_zh)
    next[i].price = rebaseShipmentDeclaration(basis, denominator).price
  }
  const groupValues = new Map<string, number>()
  explicitCartons.forEach((value, i) => {
    const key = cartonGroupKey(next[i], nextMaterials)
    if (key && groupValues.has(key) && groupValues.get(key) !== value)
      throw new Error('同箱合并行的箱数不一致，请填写相同箱数')
    if (key) groupValues.set(key, value)
    next[i].cartons = value
  })
  next.forEach(it => { const key = cartonGroupKey(it, nextMaterials); if (key && groupValues.has(key)) it.cartons = groupValues.get(key)! })
  return { items: next, materials: nextMaterials, dirtyMaterials }
}
