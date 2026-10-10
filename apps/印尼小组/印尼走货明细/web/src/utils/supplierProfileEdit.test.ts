import { expect, it } from 'vitest'
import { mergeSupplierProfileEdit } from './supplierProfileEdit'

it('updates all changed non-empty fields on the same id without erasing blanks', () => {
  const old = { id: 7, keyword: '旧简称', full: '公司', phone: '123', email: 'old@test.cn' }
  expect(mergeSupplierProfileEdit(old, old, { keyword: '新简称', full: ' ', phone: '', email: 'new@test.cn', customs: '报关公司', nameEn: 'Company', addressZh: '中文地址', addressEn: 'Address', contact: '联系人' }))
    .toEqual({ ...old, keyword: '新简称', email: 'new@test.cn', customs: '报关公司', nameEn: 'Company', addressZh: '中文地址', addressEn: 'Address', contact: '联系人' })
})
it('preserves concurrent changes to fields not edited', () => {
  expect(mergeSupplierProfileEdit({ keyword: '简称', phone: '新电话' }, { phone: '旧电话' }, { phone: '旧电话' }).phone).toBe('新电话')
})
it('creates a new profile without reusing a previous supplier id', () => {
  expect(mergeSupplierProfileEdit(undefined, {}, { full: '新公司' })).toEqual({ keyword: '新公司', full: '新公司' })
})
