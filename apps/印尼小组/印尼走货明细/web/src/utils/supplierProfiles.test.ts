import { describe, expect, it } from 'vitest'
import {
  canonicalSupplierProfiles, documentSellerForLine, HUASHENGYI_FULL_NAME, linkedCustomsCompany,
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

  it('resolves and hides legacy abbreviation-only duplicate rows', () => {
    const legacyAlias = { keyword: '星徽', full: '星徽' }
    const company = { ...otherProfile, keyword: otherProfile.full }
    expect(supplierProfileForName('星徽', [company, legacyAlias])).toEqual(company)
    expect(canonicalSupplierProfiles([company, legacyAlias])).toEqual([company])
  })
})

describe('supplierForLine', () => {
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
