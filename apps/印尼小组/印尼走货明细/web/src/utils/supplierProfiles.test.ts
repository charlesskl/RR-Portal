import { describe, expect, it } from 'vitest'
import {
  supplierSummaryRows, documentSellerForLine, HUASHENGYI_FULL_NAME, linkedCustomsCompany,
  supplierCustomsCompany, supplierForLine, supplierProfileForName,
} from './supplierProfiles'

const profile = {
  id: 1, keyword: '华胜益', full: '深圳市华胜益出口贸易有限公司', nameEn: 'Shenzhen Huashengyi Export Trading Limited',
  addressZh: '深圳市龙华区', addressEn: 'Longhua, Shenzhen', phone: '0755-123456', email: 'seller@example.com', contact: '彭先生',
}

const otherProfile = {
  ...profile, id: 2, keyword: '星徽', full: '东莞市星徽纸品有限公司',
  nameEn: 'Dongguan Xinghui Paper Products Co., Ltd.', email: 'xinghui@example.com',
}

describe('supplier customs-company linkage', () => {
  it('finds a supplier by its Chinese company name or historical keyword', () => {
    expect(supplierProfileForName(otherProfile.full, [profile, otherProfile])).toEqual(otherProfile)
    expect(supplierProfileForName(otherProfile.keyword, [profile, otherProfile])).toEqual(otherProfile)
  })

  it('uses the supplier company by default and Huashengyi only when selected', () => {
    expect(supplierCustomsCompany(otherProfile)).toBe(otherProfile.full)
    expect(supplierCustomsCompany({ ...otherProfile, customs: HUASHENGYI_FULL_NAME })).toBe(HUASHENGYI_FULL_NAME)
    expect(linkedCustomsCompany(otherProfile.full, [{ ...otherProfile, customs: HUASHENGYI_FULL_NAME }])).toBe(HUASHENGYI_FULL_NAME)
  })

  it('keeps a manually entered customs-company name', () => {
    const customs = '东莞市雅洛轩进出口贸易有限公司'
    const customProfile = { ...otherProfile, customs }
    expect(supplierCustomsCompany(customProfile)).toBe(customs)
    expect(linkedCustomsCompany(otherProfile.full, [customProfile])).toBe(customs)
  })

  it('resolves legacy abbreviations but keeps every archive visible in the summary', () => {
    const legacyAlias = { keyword: '星徽', full: '星徽' }
    const company = { ...otherProfile, keyword: otherProfile.full }
    expect(supplierProfileForName('星徽', [company, legacyAlias])).toEqual(company)
    expect(supplierSummaryRows([company, legacyAlias]).map(row => row.seller)).toEqual([company, legacyAlias])
  })

  it('preserves distinct IDs and each archive’s fields when names collide', () => {
    const duplicate = { ...otherProfile, id: 3, nameEn: 'Historical company name' }
    const rows = supplierSummaryRows([otherProfile, duplicate])
    expect(rows.map(row => row.id)).toEqual([2, 3])
    expect(rows.map(row => row.seller.nameEn)).toEqual([otherProfile.nameEn, duplicate.nameEn])
    expect(supplierSummaryRows([])).toEqual([])
  })

  it('keeps Huashengyi contract display without hiding supplier archives', () => {
    const supplier = { ...otherProfile, customs: HUASHENGYI_FULL_NAME }
    const rows = supplierSummaryRows([supplier, profile])
    expect(rows).toHaveLength(2)
    expect(rows[0].seller).toEqual(profile)
    expect(rows[0].full).toBe(otherProfile.full)
  })
})

describe('supplierForLine', () => {
  it('allows incomplete export profiles without guessing missing company data', () => {
    expect(supplierForLine('新供应商', [], true)).toMatchObject({ full: '新供应商', addressEn: '', email: '' })
    expect(supplierForLine('', [], true)).toMatchObject({ full: '', nameEn: '', contact: '' })
    expect(supplierForLine('华胜益', [{ ...profile, email: '' }], true)).toMatchObject({ full: profile.full, email: '' })
    expect(supplierForLine('华胜益', [profile, { ...profile, id: 2 }], true).addressEn).toBe('')
    expect(documentSellerForLine('未知供应商', '', [], true).full).toBe('未知供应商')
  })
  it('matches the exact abbreviation or full name', () => {
    expect(supplierForLine(' 华胜益 ', [profile])).toEqual(profile)
    expect(supplierForLine(profile.full, [profile])).toEqual(profile)
  })
  it('does not guess a similar company or use the customs company', () => {
    expect(() => supplierForLine('华胜', [profile])).toThrow('没有档案')
    expect(() => supplierForLine('', [profile])).toThrow('未填写供应商')
  })
  it('requires a unique and complete seller profile', () => {
    expect(() => supplierForLine('华胜益', [profile, { ...profile, id: 2 }])).toThrow('多份档案')
    expect(() => supplierForLine('华胜益', [{ ...profile, email: '' }])).toThrow('邮箱')
  })
})

describe('documentSellerForLine', () => {
  it('uses Huashengyi when the customs company is Huashengyi', () => {
    expect(documentSellerForLine('星徽', '华胜益', [profile, otherProfile])).toEqual(profile)
    expect(documentSellerForLine('星徽', profile.full, [profile, otherProfile])).toEqual(profile)
  })

  it('uses the supplier for any other or empty customs company', () => {
    expect(documentSellerForLine('星徽', '', [profile, otherProfile])).toEqual(otherProfile)
    expect(documentSellerForLine('星徽', '其他报关公司', [profile, otherProfile])).toEqual(otherProfile)
  })
})
