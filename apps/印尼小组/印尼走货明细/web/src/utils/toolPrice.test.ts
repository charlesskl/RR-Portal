import { expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { parseIndonesiaMaterials } from './indonesiaMaterialImport'
import { normalizeToolCurrency, readToolPrice } from './toolPrice'
import { mergeToolMaterial } from './toolMaterialImport'

it('币种使用明确标识，不推断不明确的美元符号', () => {
  expect(normalizeToolCurrency('人民币')).toBe('CNY')
  expect(normalizeToolCurrency('US$')).toBe('USD')
  expect(normalizeToolCurrency('HKD')).toBe('HKD')
  expect(normalizeToolCurrency('Rp')).toBe('IDR')
  expect(normalizeToolCurrency('$')).toBeUndefined()
  expect(normalizeToolCurrency('')).toBeUndefined()
})
it('采购单价读取原始精度、保留零值，文件无币种需确认，不读取采购金额', () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['货号', '产品中文名称', '采购单价', '币种', '采购金额'],
    ['1', '工具甲', 35.345678, '人民币', 70.68],
    ['1', '工具乙', 0, '', 0],
  ])
  sheet.C2.z = '0.00'
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, sheet, '数据')
  const result = parseIndonesiaMaterials(wb, true)
  expect(result.groups[0].materials[0]).toMatchObject({ purchase_price: 35.345678, purchase_currency: 'CNY' })
  expect(result.groups[0].materials[1]).toMatchObject({ purchase_price: 0 })
  expect(result.groups[0].materials[1].purchase_currency).toBeUndefined()
  expect(result.warnings.some(w => w.includes('币种未填写'))).toBe(true)
})
it('重导入空值保留价格与币种，明确的零值可更新', () => {
  const old = { purchase_price: 2, purchase_currency: 'USD' }
  expect(mergeToolMaterial(old, { purchase_price: undefined })).toMatchObject(old)
  expect(mergeToolMaterial(old, { purchase_price: 0 })).toMatchObject({ purchase_price: 0, purchase_currency: 'USD' })
})

it('识别单价货币显示格式，保持底层数值精度', () => {
  expect(readToolPrice({ v: 35.345678, w: 'US$35.35', z: '"US$"0.00' })).toMatchObject({ price: 35.345678, currency: 'USD' })
  expect(readToolPrice({ v: 9.09, z: '"US$"#,##0.00' })).toMatchObject({ price: 9.09, currency: 'USD' })
  expect(readToolPrice({ v: 'HK$1,234.50' })).toMatchObject({ price: 1234.5, currency: 'HKD' })
  expect(readToolPrice({ v: 'US$9.09' })).toMatchObject({ price: 9.09, currency: 'USD' })
})
it('标记冲突和不明确的美元符号仍需确认', () => {
  expect(readToolPrice({ v: 35.34, w: 'US$35.34' }, 'CNY')).toMatchObject({ currency: undefined, conflict: true })
  expect(readToolPrice({ v: 35.34, w: '$35.34' }).currency).toBeUndefined()
})
