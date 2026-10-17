import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import * as XLSX from 'xlsx'
import type { Molding } from '../api/client'
import { mergeImportedMoldings } from './moldingImportMerge'
import { importEngineeringFile } from './engineeringImport'

const names = ['狐狸', '猫头鹰', '麋鹿', '蝴蝶', '松鼠', '青蛙', '兔子']
const variant = (index: number): Molding => ({
  moldId: '2511-L21106-P01', moldName: '公仔左右手', materialName: 'PVC85',
  colorName: [3, 5, 6].includes(index) ? '7515C' : '米白色',
  pigmentCode: [3, 5, 6].includes(index) ? '70753' : '70752',
  setsPerShot: 2, workshop: '兴信A车间', notes: '',
  parts: [
    { partName: `塑胶件-${names[index]}左右手A${index + 1}`, usage: 1, netPerPc: 0.004 },
    { partName: `塑胶件-${names[index]}脚（此件不用取消）`, usage: 1 },
  ],
})

describe('engineering molding variant merge', () => {
  it('corrects a uniquely matched plastic-to-vinyl import without duplicating or losing manual settings', () => {
    const old = { ...variant(0), workshop: '人工车间', setsPerShot: 4, notes: '人工备注' }
    const incoming = { ...variant(0), workshop: '华登', parts: variant(0).parts!.map(part => ({
      ...part, partName: part.partName!.replace('塑胶件-', '搪胶件-'), category: '搪胶',
    })) }
    const snapshot = structuredClone(old)
    const merged = mergeImportedMoldings([old], [incoming])
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ workshop: '人工车间', setsPerShot: 4, notes: '人工备注' })
    expect(merged[0].parts?.every(part => part.category === '搪胶' && part.partName?.startsWith('搪胶件-'))).toBe(true)
    expect(old).toEqual(snapshot)
    expect(mergeImportedMoldings(merged, [incoming])).toEqual(merged)
    expect(mergeImportedMoldings([{ ...old, colorName: '其他颜色' }], [incoming])).toHaveLength(2)
    expect(mergeImportedMoldings([old, structuredClone(old)], [incoming])).toHaveLength(3)
    expect(mergeImportedMoldings([incoming], [old])).toHaveLength(2)
  })
  it('recovers all seven styles when the existing product only retained the last style', () => {
    const incoming = names.map((_, i) => variant(i))
    const existing = [{ ...variant(6), workshop: '兴信B车间', notes: '保留人工备注', setsPerShot: 4 }]
    const snapshot = structuredClone(existing)
    const merged = mergeImportedMoldings(existing, incoming)
    expect(merged).toHaveLength(7)
    expect(new Set(merged.map(m => m.parts?.[0].partName)).size).toBe(7)
    expect(merged[0]).toMatchObject({ workshop: '兴信B车间', notes: '保留人工备注', setsPerShot: 4 })
    expect(existing).toEqual(snapshot)
    expect(mergeImportedMoldings(merged, incoming)).toEqual(merged)
    expect(mergeImportedMoldings([], incoming)).toHaveLength(7)
  })

  it.each(['colorName', 'colorCode', 'pigmentCode', 'materialName'] as const)('keeps different %s even when parts and mold number are identical', field => {
    const first = variant(0)
    const second = { ...first, [field]: '不同值' }
    expect(mergeImportedMoldings([first], [second])).toHaveLength(2)
  })

  it('updates quantities and weights in the same variant regardless of part order', () => {
    const previous = variant(0)
    const updated = { ...variant(0), moldId: ' 2511-L21106-P01 ', netGramsPerShot: 12,
      parts: variant(0).parts!.map(part => ({ ...part, usage: 0.5, netPerPc: 0.006 })).reverse() }
    const result = mergeImportedMoldings([previous], [updated])
    expect(result).toHaveLength(1)
    expect(result[0].netGramsPerShot).toBe(12)
    expect(result[0].parts?.every(part => part.usage === 0.5 && part.netPerPc === 0.006)).toBe(true)
    expect(previous.parts?.[0].usage).toBe(1)
  })

  it('uses the name fallback without collapsing variants or different mold numbers', () => {
    const first = { ...variant(0), moldId: '' }
    expect(mergeImportedMoldings([first], [{ ...variant(1), moldId: '' }])).toHaveLength(2)
    expect(mergeImportedMoldings([first], [first])).toHaveLength(1)
    expect(mergeImportedMoldings([variant(0)], [{ ...variant(0), moldId: 'P02' }])).toHaveLength(2)
    expect(mergeImportedMoldings([{ parts: [] }], [{ parts: [] }])).toHaveLength(2)
  })

  it.each(['xls', 'xlsx'] as const)('imports and merges seven variants without changing the production-country filter (%s)', async bookType => {
    const rows: unknown[][] = [
      ['产品编号: L21106'],
      ['工模编号', '工模名称', 'Nama Part\n零件名称', 'Material Part\n材料', '色粉号', '颜色', '用量', '生产地'],
    ]
    for (let i = 0; i < names.length; i++) {
      const mold = variant(i)
      rows.push(['S01', '公仔脸', null, 'PVC85', null, null, null, 'Indonesia\n印尼'])
      rows.push([null, null, `${names[i]}公仔脸A${i + 1}`, null, null, null, 1])
      rows.push([mold.moldId, mold.moldName, null, mold.materialName, mold.pigmentCode, mold.colorName, null, '中国'])
      for (const part of mold.parts!) rows.push([null, null, part.partName!.replace('塑胶件-', ''), null, null, null, 1])
    }
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), '排模表 Mold Layout')
    const bytes = XLSX.write(wb, { type: 'array', bookType }) as ArrayBuffer
    const imported = await importEngineeringFile({ arrayBuffer: async () => bytes } as File)
    expect(imported.moldings).toHaveLength(7)
    const result = mergeImportedMoldings([imported.moldings[6]], imported.moldings)
    expect(result).toHaveLength(7)
    expect(result.every(m => m.parts?.length === 2)).toBe(true)
    expect(mergeImportedMoldings(result, imported.moldings)).toEqual(result)
  })

  it.runIf(process.env.MOLD_VARIANT_IMPORT_FILE)('regresses the supplied L21106 file without saving product data', async () => {
    const bytes = readFileSync(process.env.MOLD_VARIANT_IMPORT_FILE!)
    const imported = await importEngineeringFile({ arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } as File)
    expect(imported.code).toBe('L21106')
    expect(imported.moldings).toHaveLength(7)
    expect(imported.moldings.map(m => m.parts?.[0].partName)).toEqual(
      names.map((name, i) => `塑胶件-${name}左右手A${i + 1}`))
    expect(imported.moldings.map(m => m.pigmentCode)).toEqual(['70752', '70752', '70752', '70753', '70752', '70753', '70753'])
    const merged = mergeImportedMoldings([imported.moldings[6]], imported.moldings)
    expect(merged).toHaveLength(7)
    expect(merged.flatMap(m => m.parts ?? [])).toHaveLength(14)
    expect(mergeImportedMoldings(merged, imported.moldings)).toEqual(merged)
  })
})
