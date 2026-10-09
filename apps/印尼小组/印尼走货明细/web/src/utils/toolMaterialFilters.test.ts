import { expect, it } from 'vitest'
import { filterToolMaterials, toolFilterOptions } from './toolMaterialFilters'
import type { Material } from '../api/client'

const rows: Material[] = [
  { id: 1, supplier: '甲', tool_kind: '工具', name_zh: '大边模', image: 'data:image/png;base64,x', hs_cn: '001', active: true },
  { id: 2, supplier: '甲', tool_kind: '机器设备', name_zh: '机器', active: false },
  { id: 3, supplier: '乙', tool_kind: '工具', name_zh: '中边模', material_code: 'A' },
]
it('列内多选取并集，列间筛选取交集，结合关键词', () => {
  expect(filterToolMaterials(rows, { supplier: ['甲', '乙'], tool_kind: ['工具'] }, '边模').map(m => m.id)).toEqual([1, 3])
  expect(filterToolMaterials(rows, { supplier: ['甲'], tool_kind: ['工具'] }, '').map(m => m.id)).toEqual([1])
})
it('图片、启用状态、未填写编码可筛选', () => {
  expect(filterToolMaterials(rows, { image: ['无图'], active: ['启用'], material_code: [''] }, '')).toEqual([])
  expect(filterToolMaterials(rows, { hs_cn: [''] }, '').map(m => m.id)).toEqual([2, 3])
  expect(toolFilterOptions(rows, 'material_code')).toEqual([{ value: '', text: '（未填写）' }, { value: 'A', text: 'A' }])
})
it('重置显示全部，HS 编码按字符串保留前导零', () => {
  expect(filterToolMaterials(rows, {}, '')).toHaveLength(3)
  expect(filterToolMaterials(rows, { hs_cn: ['001'] }, '').map(m => m.id)).toEqual([1])
  expect(filterToolMaterials(rows, { hs_cn: [] }, '')).toHaveLength(3)
})
