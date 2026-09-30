import { describe, expect, it } from 'vitest'
import { mergeImportedMaterials, recommendMaterialChoices, resolveMaterialImport } from './materialImportMerge'

describe('material Excel import merge', () => {
  it('recommends renamed electrode sheets without confusing reversed polarity', () => {
    const rows = [{ name_zh: '五金配件-正负极电池片（无脚）', spec: '0.4T*22.3W*8.3H' },
      { name_zh: '五金配件-负正极电池片（无脚）', spec: '0.4T*22.3W*8.3H' }]
    expect(recommendMaterialChoices(rows, [
      { name_zh: '五金配件-标准3A-3正负极片', spec: rows[0].spec },
      { name_zh: '五金配件-标准3A-4负正极片', spec: rows[0].spec },
    ])).toEqual([0, 1])
  })
  it('keeps tied or shared recommendations skipped', () => {
    const rows = [{ name_zh: 'A', spec: 'same' }, { name_zh: 'B', spec: 'same' }]
    expect(recommendMaterialChoices(rows, [{ name_zh: 'C', spec: 'same' }])).toEqual(['skip'])
    expect(recommendMaterialChoices(rows.slice(0, 1), [{ spec: 'same' }, { spec: 'same' }])).toEqual(['skip', 'skip'])
  })
  it('applies explicit overwrite/add/skip without changing original rows or linked identity', () => {
    const rows = [{ id: 12, name_zh: '旧名', image_id: 'old-image', active: false, qty_per_carton: 20 }]
    const result = resolveMaterialImport(rows, [
      { name_zh: '新名', qty_per_carton: 0 }, { id: 0, name_zh: '新增' }, { name_zh: '跳过' },
    ], [0, 'add', 'skip'], 1)
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ id: 12, name_zh: '新名', image_id: 'old-image', active: false, qty_per_carton: 20 })
    expect(result[1]).toMatchObject({ name_zh: '新增', id: undefined })
    expect(rows[0].name_zh).toBe('旧名')
  })
  it('rejects duplicate overwrite targets and stale choices atomically', () => {
    const rows = [{ id: 12, name_zh: '旧名' }]
    expect(() => resolveMaterialImport(rows, [{ name_zh: 'A' }, { name_zh: 'B' }], [0, 0], 1)).toThrow('同一条')
    expect(() => resolveMaterialImport(rows, [{ name_zh: 'A' }], [1], 1)).toThrow('失效')
    expect(rows[0].name_zh).toBe('旧名')
    expect(resolveMaterialImport(rows, [{ name_zh: 'A' }], [], 1)).toEqual(rows)
  })
  it('recognizes engineering renames by specification and retains manual packing data', () => {
    const result = mergeImportedMaterials([
      { id: 1, name_zh: 'PB螺丝', spec: '2.6*6PB', image_id: 'old', qty_per_carton: 100 },
      { id: 2, name_zh: 'PB螺丝', spec: '2.6*8PB' },
    ], [{ name_zh: 'PB螺丝2.6*6', spec: '2.6*6PB', material_code: '11000001', qty_per_carton: 0 }], true)
    expect(result).toMatchObject({ updated: 1, added: 0, conflicts: [] })
    expect(result.rows[0]).toMatchObject({ id: 1, name_zh: 'PB螺丝2.6*6', image_id: 'old', qty_per_carton: 100 })
  })
  it('does not merge different materials with shared engineering codes', () => {
    const input = [
      { material_code: '04050010', name_zh: 'OPP胶膜带 1', spec: '30*750MM' },
      { material_code: '04050010', name_zh: '吸塑片 1', spec: '125*60MM' },
    ]
    const first = mergeImportedMaterials([], input, true)
    expect(first.rows).toHaveLength(2)
    const next = mergeImportedMaterials(first.rows, input, true)
    expect(next).toMatchObject({ updated: 2, added: 0, conflicts: [] })
  })
  it('holds uncertain engineering renames instead of silently appending', () => {
    const result = mergeImportedMaterials([
      { id: 1, name_zh: '正负极片', spec: '同规格', supplier: '五金厂' },
      { id: 2, name_zh: '负正极片', spec: '同规格', supplier: '五金厂' },
    ], [{ name_zh: '标准电池片', spec: '同规格', supplier: '五金厂' }], true)
    expect(result).toMatchObject({ updated: 0, added: 0, conflicts: ['标准电池片'] })
    expect(result.rows).toHaveLength(2)
  })
  it('updates by material code and retains identity, image, state and absent fields', () => {
    const old = { id: 1, material_code: 'M1', name_zh: '旧名', image_id: 'img', active: false, gross_per_pc: 2, supplier: '供应商' }
    const result = mergeImportedMaterials([old], [{ material_code: ' m1 ', name_zh: '新名', active: true, supplier: '', gross_per_pc: undefined, net_per_pc: 0 }])
    expect(result).toMatchObject({ updated: 1, added: 0, conflicts: [] })
    expect(result.rows[0]).toMatchObject({ id: 1, name_zh: '新名', image_id: 'img', active: false, supplier: '供应商', gross_per_pc: 2, net_per_pc: 0 })
    expect(old.name_zh).toBe('旧名')
  })
  it('does not match different materials merely by shared product item number', () => {
    const result = mergeImportedMaterials([{ id: 1, item_no: '46720J', name_zh: '固定内卡' }], [
      { item_no: '46720J', name_zh: '绑片卡', spec: 'A' },
      { item_no: '46720J', name_zh: '绑片卡', spec: 'B' },
    ])
    expect(result.added).toBe(2)
    expect(result.rows).toHaveLength(3)
  })
  it('is repeatable and updates normalized name/spec matches', () => {
    const input = [{ name_zh: ' 固定内卡 ', spec: ' 10 MM ', qty_per_carton: 12 }]
    const first = mergeImportedMaterials([], input)
    const second = mergeImportedMaterials(first.rows, [{ name_zh: '固定内卡', spec: '10 mm', qty_per_carton: 15 }])
    expect(second).toMatchObject({ updated: 1, added: 0 })
    expect(second.rows).toHaveLength(1)
    expect(second.rows[0].qty_per_carton).toBe(15)
  })
  it('skips ambiguous matches without changing or duplicating existing materials', () => {
    const rows = [{ id: 1, name_zh: '螺丝', spec: 'A' }, { id: 2, name_zh: '螺丝', spec: 'B' }]
    const result = mergeImportedMaterials(rows, [{ name_zh: '螺丝', supplier: '新供应商' }])
    expect(result.conflicts).toEqual(['螺丝'])
    expect(result.rows).toEqual(rows)
    expect(result.updated + result.added).toBe(0)
  })
  it('does not overwrite a different nonempty material code', () => {
    const result = mergeImportedMaterials([{ name_zh: '螺丝', material_code: 'A' }], [{ name_zh: '螺丝', material_code: 'B' }])
    expect(result.added).toBe(1)
  })
})
