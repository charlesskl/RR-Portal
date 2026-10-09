import { describe, expect, it } from 'vitest'
import { mergeToolMaterial, planToolImport } from './toolMaterialImport'
import { importIndonesiaMaterialFile, parseIndonesiaMaterials } from './indonesiaMaterialImport'
import * as XLSX from 'xlsx'
import { readFile } from 'node:fs/promises'
import { DOMParser } from '@xmldom/xmldom'

const old = { id: 42, revision: 3, name_zh: '大边模', spec: '23CM*12CM*4CM', tool_kind: '工具' as const, related_product_code: '46745', supplier: '兴信', active: false, image: 'old', net_per_pc: 0.23 }
describe('工具档案导入', () => {
  it('唯一匹配更新，停用记录也不重复创建', () => {
    expect(planToolImport([old], [{ ...old, id: undefined, spec: '23cm × 12cm × 4cm' }])[0].choice).toBe(42)
  })
  it('不同规格、关联货号或多个候选需要人工确认', () => {
    expect(planToolImport([old], [{ ...old, spec: 'different' }])[0].choice).toBe('skip')
    expect(planToolImport([old], [{ ...old, related_product_code: '999' }])[0].choice).toBe('skip')
    expect(planToolImport([old, { ...old, id: 43 }], [old])[0].choice).toBe('skip')
  })
  it('新增物料追加，同一旧物料重复匹配不自动覆盖', () => {
    expect(planToolImport([old], [{ name_zh: '中边模' }])[0].choice).toBe('new')
    expect(planToolImport([old], [old, old]).map(p => p.choice)).toEqual(['skip', 'skip'])
  })
  it('更新保留 ID/状态/旧图/空白字段，但允许数值零', () => {
    const m = mergeToolMaterial(old, { id: 100, active: true, revision: 9, spec: '', net_per_pc: 0 })
    expect(m).toMatchObject({ id: 42, revision: 3, active: false, image: 'old', spec: old.spec, net_per_pc: 0 })
  })
  it('读取双语表头、厘米尺寸及单个重量，忽略采购交易字段；工具可无货号', () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['货号', '产品中文名称\nChinese name', '规格\nspecification', '单位\nUnit', '单个毛重(KGM)', '单个净重(KGM)', '长\nLength', '宽\nBroad', '高\nHeight', '产品用途', '采购单价', '需求数量'],
      ['', '中边模', '14CM*13CM*6CM', '个', 0.136, 0.14, '140mm', '13CM', '0.06m', '模具', 9.09, 2],
    ])
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
    const p = parseIndonesiaMaterials(wb, true)
    expect(p.groups[0].materials[0]).toMatchObject({ name_zh: '中边模', related_product_code: '', tool_kind: '工具', unit_kg: 'PCE', gross_per_pc: 0.136, net_per_pc: 0.14, length: 14, width: 13, height: 6 })
    expect(p.groups[0].materials[0]).not.toHaveProperty('product_code')
    expect(p.groups[0].materials[0]).not.toHaveProperty('price')
    expect(p.groups[0].materials[0]).not.toHaveProperty('qty')
    expect(p.groups[0].materials[0]).not.toHaveProperty('usage_qty')
  })
  it('不重复读取汇总及重复行，未知类别要求确认', () => {
    const ws = XLSX.utils.aoa_to_sheet([['货号', '产品中文名称'], ['1', '螺丝刀'], ['1', '螺丝刀'], ['', '合计']])
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
    const p = parseIndonesiaMaterials(wb, true)
    expect(p.groups[0].materials).toHaveLength(1)
    expect(p.groups[0].materials[0].tool_kind).toBeUndefined()
    expect(p.warnings.length).toBeGreaterThan(0)
  })
})

// Optional local fixture: no user workbook or business data is committed to the repository.
it.skipIf(!process.env.TOOL_IMPORT_SAMPLE)('实际样本：两条模具及对应图片，只读验证', async () => {
  globalThis.DOMParser = DOMParser as unknown as typeof globalThis.DOMParser
  const bytes = await readFile(process.env.TOOL_IMPORT_SAMPLE!)
  const p = await importIndonesiaMaterialFile({ arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } as File, true)
  const ms = p.groups.flatMap(g => g.materials)
  expect(ms).toHaveLength(2)
  expect(ms.map(m => m.name_zh)).toEqual(['大边模', '中边模'])
  expect(ms.every(m => m.tool_kind === '工具' && m.related_product_code === '46745' && m.image?.startsWith('data:image/'))).toBe(true)
  expect(ms.map(m => m.length)).toEqual([23, 14])
  expect(ms.map(m => m.purchase_price)).toEqual([35.34, 9.09])
  expect(ms.map(m => m.purchase_currency)).toEqual(['USD', 'USD'])
})
