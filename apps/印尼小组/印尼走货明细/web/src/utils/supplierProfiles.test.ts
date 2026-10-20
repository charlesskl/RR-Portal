import { describe, expect, it } from 'vitest'
import {
  supplierSummaryRows, documentSellerForLine, HUASHENGYI_FULL_NAME, linkedCustomsCompany,
  supplierCustomsCompany, supplierForLine, supplierProfileForName, materialCustomsCompany,
  supplierAutocompleteOptions, filterSupplierOption, supplierDisplayName,
} from './supplierProfiles'

const profile = {
  id: 1, keyword: '华胜益', full: '深圳市华胜益出口贸易有限公司', nameEn: 'Shenzhen Huashengyi Export Trading Limited',
  addressZh: '深圳市龙华区', addressEn: 'Longhua, Shenzhen', phone: '0755-123456', email: 'seller@example.com', contact: '彭先生',
}

const otherProfile = {
  ...profile, id: 2, keyword: '星徽', full: '东莞市星徽纸品有限公司',
  nameEn: 'Dongguan Xinghui Paper Products Co., Ltd.', email: 'xinghui@example.com',
}

describe('material customs-company automatic fill', () => {
  const profiles = [{ ...otherProfile, customs: '华胜益' }, profile]

  it('fills missing, empty and whitespace customs from supplier without reselecting it', () => {
    for (const customs_company of [undefined, '', '  ']) {
      for (const supplier of [otherProfile.keyword, otherProfile.full]) {
        expect(materialCustomsCompany({ supplier, customs_company }, profiles)).toBe(HUASHENGYI_FULL_NAME)
      }
    }
  })

  it('defaults to the supplier company when its archive has no separate customs company', () => {
    expect(materialCustomsCompany({ supplier: otherProfile.full, customs_company: '' }, [otherProfile]))
      .toBe(otherProfile.full)
  })

  it('corrects stale customs from the matching archive without mutating material data', () => {
    const row = { supplier: otherProfile.keyword, customs_company: '指定报关公司', unit_kg: 'TNE', net_per_pc: 0.12 }
    const before = { ...row }
    expect(materialCustomsCompany(row, profiles)).toBe(HUASHENGYI_FULL_NAME)
    expect(row).toEqual(before)
  })

  it('follows changes to the supplier archive rather than a previously saved customs value', () => {
    const row = { supplier: otherProfile.keyword, customs_company: HUASHENGYI_FULL_NAME }
    expect(materialCustomsCompany(row, [otherProfile])).toBe(otherProfile.full)
    expect(materialCustomsCompany(row, [{ ...otherProfile, customs: '指定报关公司' }])).toBe('指定报关公司')
  })

  it('resolves when dictionaries arrive after materials and can be saved without clicking supplier', () => {
    const row = { supplier: otherProfile.full, customs_company: '' }
    expect(materialCustomsCompany(row, [])).toBe('')
    const displayed = materialCustomsCompany(row, profiles)
    const saved = { ...row, customs_company: materialCustomsCompany(row, profiles) }
    expect(saved.customs_company).toBe(displayed)
    expect(materialCustomsCompany(saved, profiles)).toBe(HUASHENGYI_FULL_NAME)
  })

  it('does not guess for unknown, empty or ambiguous suppliers', () => {
    const ambiguous = [
      { keyword: '胶袋', full: '兴信公司', customs: '报关一' },
      { keyword: '吸塑', full: '兴信公司', customs: '报关二' },
    ]
    for (const supplier of ['', '未建档', '兴信公司']) {
      expect(materialCustomsCompany({ supplier, customs_company: '' }, ambiguous)).toBe('')
      expect(materialCustomsCompany({ supplier, customs_company: '原报关公司' }, ambiguous)).toBe('原报关公司')
    }
    expect(materialCustomsCompany({ supplier: '吸塑', customs_company: '' }, ambiguous)).toBe('报关二')
  })
})

describe('supplier autocomplete options', () => {
  it('prefers an exact company name over a longer similar company', () => {
    const profiles = [{ keyword: '总公司', full: '兴信公司', customs: '报关一' },
      { keyword: '分公司', full: '兴信公司分公司', customs: '报关二' }]
    expect(supplierDisplayName('兴信公司', profiles)).toBe('总公司')
    expect(linkedCustomsCompany('兴信公司', profiles)).toBe('报关一')
  })
  it('keeps an ambiguous company name without guessing a display-name archive', () => {
    const profiles = [{ keyword: '胶袋', full: '兴信公司' }, { keyword: '吸塑', full: '兴信公司' }]
    expect(supplierProfileForName('兴信公司', profiles)).toBeUndefined()
    expect(supplierDisplayName('兴信公司', profiles)).toBe('兴信公司')
    expect(supplierDisplayName('吸塑', profiles)).toBe('吸塑')
  })

  it('keeps the selected display name and its customs company when another archive shares its full name', () => {
    const plastics = { id: 1, keyword: '保士特(东莞)塑胶制品有限公司', full: '保士特(东莞)科技有限公司', customs: '塑胶报关公司' }
    const technology = { id: 2, keyword: '保士特(东莞)科技有限公司', full: '保士特(东莞)科技有限公司', customs: HUASHENGYI_FULL_NAME }
    for (const profiles of [[plastics, technology], [technology, plastics]]) {
      const before = JSON.stringify(profiles)
      for (const selected of profiles) {
        expect(supplierProfileForName(selected.keyword, profiles)).toBe(selected)
        expect(supplierDisplayName(selected.keyword, profiles)).toBe(selected.keyword)
        expect(linkedCustomsCompany(selected.keyword, profiles)).toBe(selected.customs)
      }
      expect(supplierSummaryRows(profiles)).toHaveLength(2)
      expect(JSON.stringify(profiles)).toBe(before)
    }
  })

  it('matches exact display names before full names with trimming and case normalization', () => {
    const alias = { keyword: 'Other', full: 'ACME', customs: '其他报关' }
    const selected = { keyword: ' ACME ', full: 'ACME', customs: '指定报关' }
    expect(supplierProfileForName(' acme ', [alias, selected])).toBe(selected)
    expect(supplierDisplayName('acme', [alias, selected])).toBe('ACME')
    expect(linkedCustomsCompany('acme', [alias, selected])).toBe('指定报关')
  })
  it('displays existing company names as display names while retaining customs linkage', () => {
    expect(supplierDisplayName(otherProfile.full, [otherProfile])).toBe('星徽')
    expect(supplierDisplayName('未建档', [otherProfile])).toBe('未建档')
    expect(supplierDisplayName('完整公司', [{ keyword: ' ', full: '完整公司' }])).toBe('完整公司')
    const profiles = [
      { keyword: '胶袋', full: '兴信公司', customs: '报关一' },
      { keyword: '吸塑', full: '兴信公司', customs: '报关二' },
    ]
    for (const option of supplierAutocompleteOptions(profiles)) {
      expect(supplierDisplayName(option.value, profiles)).toBe(option.value)
    }
    expect(linkedCustomsCompany('胶袋', profiles)).toBe('报关一')
    expect(linkedCustomsCompany('吸塑', profiles)).toBe('报关二')
  })
  it('keeps distinct display names for a shared company without changing archives', () => {
    const profiles = [
      { id: 1, keyword: '胶袋', full: '东莞兴信塑胶制品有限公司' },
      { id: 2, keyword: '吸塑', full: ' 东莞兴信塑胶制品有限公司 ' },
      { id: 3, keyword: '登信', full: '东莞市登信电子有限公司' },
    ]
    const before = JSON.stringify(profiles)
    const options = supplierAutocompleteOptions(profiles)
    expect(options.map(o => o.value)).toEqual(['胶袋', '吸塑', '登信'])
    expect(options.map(o => o.label)).toEqual(['胶袋', '吸塑', '登信'])
    expect(new Set(options.map(o => o.value)).size).toBe(options.length)
    expect(supplierSummaryRows(profiles)).toHaveLength(3)
    expect(JSON.stringify(profiles)).toBe(before)
  })

  it('searches display and company names and excludes unrelated suppliers', () => {
    const options = supplierAutocompleteOptions([
      { keyword: '胶袋', full: '兴信公司' }, { keyword: '吸塑', full: '兴信公司' },
      { keyword: '登信', full: '登信公司' },
    ])
    for (const text of ['胶袋', ' 胶袋 ']) {
      expect(options.filter(o => filterSupplierOption(text, o)).map(o => o.value)).toEqual(['胶袋'])
    }
    expect(options.filter(o => filterSupplierOption('吸塑', o)).map(o => o.value)).toEqual(['吸塑'])
    expect(options.filter(o => filterSupplierOption('兴信', o)).map(o => o.value)).toEqual(['胶袋', '吸塑'])
    expect(options.filter(o => filterSupplierOption('不存在', o))).toEqual([])
    expect(options.filter(o => filterSupplierOption('', o))).toHaveLength(3)
  })

  it('uses nonempty fallback names and compares Latin names without case sensitivity', () => {
    const options = supplierAutocompleteOptions([
      { keyword: ' 新供应商 ', full: '  ' }, { keyword: ' ', full: '' },
      { keyword: 'ACME', full: '英文公司一' }, { keyword: ' acme ', full: '英文公司二' },
      { keyword: ' ', full: ' 公司全称 ' },
    ])
    expect(options.map(o => o.value)).toEqual(['新供应商', 'ACME', '公司全称'])
    expect(filterSupplierOption('acme', options[1])).toBe(true)
    expect(filterSupplierOption('英文公司二', options[1])).toBe(true)
    expect(supplierAutocompleteOptions([])).toEqual([])
  })
})

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

  it('preserves exact legacy display names and only resolves abbreviations without an exact archive', () => {
    const legacyAlias = { keyword: '星徽', full: '星徽' }
    const company = { ...otherProfile, keyword: otherProfile.full }
    expect(supplierProfileForName('星徽', [company, legacyAlias])).toEqual(legacyAlias)
    expect(supplierProfileForName('星徽', [company])).toEqual(company)
    expect(supplierSummaryRows([company, legacyAlias]).map(row => row.seller)).toEqual([company, legacyAlias])
  })

  it('prefers an exact full name over a longer company containing that name', () => {
    const exact = { keyword: '甲供应商', full: '星徽公司' }
    const longer = { keyword: '乙供应商', full: '星徽公司分公司' }
    expect(supplierProfileForName('星徽公司', [longer, exact])).toBe(exact)
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
