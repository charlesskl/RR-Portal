import { expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { toolImportDefaults } from './toolImportDefaults'
import { parseIndonesiaMaterials } from './indonesiaMaterialImport'

const dictionaries = {
  suppliers: [{ keyword: '兴信', full: '兴信一般贸易', customs: '报关公司甲' }],
  translations: [{ keyword: '大边模', english: 'Large mold', active: true }],
  hs: [{ keyword: '边模', hsCN: '123', hsID: '456' }],
}
it('供应商唯一对应报关公司，并补充英文名与 HS', () => {
  expect(toolImportDefaults({ name_zh: '大边模', supplier: '兴信一般贸易' }, dictionaries).material)
    .toMatchObject({ customs_company: '报关公司甲', name_en: 'Large mold', hs_cn: '123', hs_id: '456' })
})
it('源文件值优先，不覆盖已有信息', () => {
  const material = { name_zh: '大边模', supplier: '兴信', customs_company: '人工公司', name_en: 'Original', hs_cn: '999', hs_id: '888' }
  expect(toolImportDefaults(material, dictionaries).material).toEqual(material)
})
it('冲突和相似供应商不猜测对应公司', () => {
  expect(toolImportDefaults({ supplier: '兴信二厂' }, dictionaries).material.customs_company).toBeUndefined()
  expect(toolImportDefaults({ supplier: '兴信' }, { ...dictionaries,
    suppliers: [...dictionaries.suppliers, { keyword: '兴信', customs: '另一公司' }] }).material.customs_company).toBeUndefined()
})
it('导入完整档案与每箱重量，区分单件和总量', () => {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['货号', '产品中文名称', '报关公司', '每箱重量', '单件毛重', '毛重总重', '箱长', '物料编号', '类别'],
    ['001', '大边模', '公司甲', 4, 2, 99, 23, '0002', '工具'],
  ]), '资料')
  expect(parseIndonesiaMaterials(wb, true).groups[0].materials[0]).toMatchObject({
    customs_company: '公司甲', weight_per_carton: 4, gross_per_pc: 2, length: 23, material_code: '0002', tool_kind: '工具',
  })
})
