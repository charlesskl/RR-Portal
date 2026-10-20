import type { Material, SupplierDict } from '../api/client'

export const HUASHENGYI_FULL_NAME = '深圳市华胜益出口贸易有限公司'

// 使用供应商显示名称，允许同一公司下的不同供应商名称分别选择。
// 合并搜索别名但不修改档案；供应商汇总仍逐条显示全部记录。
export function supplierAutocompleteOptions(profiles: SupplierDict[]) {
  const options = new Map<string, { value: string; label: string; searchText: string }>()
  for (const profile of profiles) {
    const value = profile.keyword?.trim() || profile.full?.trim() || ''
    if (!value) continue
    const key = value.toLocaleLowerCase()
    const searchText = [value, profile.full?.trim()].filter(Boolean).join('\n').toLocaleLowerCase()
    const existing = options.get(key)
    if (existing) existing.searchText += '\n' + searchText
    else options.set(key, { value, label: value, searchText })
  }
  return [...options.values()]
}

export function filterSupplierOption(input: string, option?: { searchText: string }): boolean {
  return (option?.searchText || '').includes(input.trim().toLocaleLowerCase())
}

export function supplierDisplayName(name: string, profiles: SupplierDict[]): string {
  const profile = supplierProfileForName(name, profiles)
  return profile?.keyword?.trim() || profile?.full?.trim() || name
}

function isHuashengyi(name: string): boolean {
  const key = name.trim().toLocaleLowerCase()
  return key === '华胜益' || key === HUASHENGYI_FULL_NAME.toLocaleLowerCase()
}

export function supplierProfileForName(name: string, profiles: SupplierDict[]): SupplierDict | undefined {
  const key = name.trim().toLocaleLowerCase()
  if (!key) return undefined
  // 下拉选项使用 keyword 作为值；即使 keyword 与 full 相同，也必须优先
  // 返回用户明确选中的档案，不能串到同公司全称的其他显示名称。
  const exactKeyword = profiles.find(profile =>
    profile.keyword?.trim().toLocaleLowerCase() === key)
  if (exactKeyword) return exactKeyword

  // An exact company name takes precedence over a longer fuzzy match. A shared
  // full name cannot identify which display-name archive the user intends.
  const exactFull = profiles.filter(profile => profile.full?.trim().toLocaleLowerCase() === key
    && profile.keyword?.trim().toLocaleLowerCase() !== key)
  if (exactFull.length) return exactFull.length === 1 ? exactFull[0] : undefined

  // 仅在没有精确匹配时兼容旧简称，不覆盖已存在的显示名称。
  const containingFull = profiles.filter(profile => {
    const full = profile.full?.trim().toLocaleLowerCase() || ''
    return full !== key && full.includes(key)
  })
  if (containingFull.length === 1) return containingFull[0]

  return undefined
}

// 汇总按档案逐条展示，不隐藏简称、同名或历史重复记录。
// 非华胜益报关直接展示本行资料，避免同名匹配将本行字段置空或串到其他档案。
export function supplierSummaryRows(profiles: SupplierDict[]) {
  return profiles.map(profile => ({
    ...profile,
    seller: isHuashengyi(supplierCustomsCompany(profile))
      ? supplierForLine(HUASHENGYI_FULL_NAME, profiles, true)
      : profile,
  }))
}

export function supplierCustomsCompany(profile: SupplierDict): string {
  const customs = profile.customs?.trim()
  if (isHuashengyi(customs || '')) return HUASHENGYI_FULL_NAME
  if (customs) return customs
  return profile.full?.trim() || profile.keyword.trim()
}

export function linkedCustomsCompany(supplierName: string, profiles: SupplierDict[], fallback = ''): string {
  const profile = supplierProfileForName(supplierName, profiles)
  return profile ? supplierCustomsCompany(profile) : fallback.trim()
}

// 显示、导入和保存都以匹配的供应商档案为准，纠正旧资料中的不一致值。
// 无法明确匹配档案时保留原报关公司，不猜测覆盖。
export function materialCustomsCompany(
  material: Pick<Material, 'supplier' | 'customs_company'>,
  profiles: SupplierDict[],
): string {
  return linkedCustomsCompany(material.supplier || '', profiles, material.customs_company || '')
}

export function supplierForLine(name: string, profiles: SupplierDict[], allowIncomplete = false): SupplierDict {
  const key = name.trim().toLocaleLowerCase()
  if (allowIncomplete) {
    const matches = profiles.filter(p => [p.keyword, p.full].some(n => n?.trim().toLocaleLowerCase() === key))
    const profile = key && matches.length === 1 ? matches[0] : undefined
    return { ...profile, keyword: profile?.keyword || name.trim(), full: profile?.full || name.trim(),
      nameEn: profile?.nameEn || '', addressZh: profile?.addressZh || '', addressEn: profile?.addressEn || '',
      phone: profile?.phone || '', email: profile?.email || '', contact: profile?.contact || '' }
  }
  if (!key) throw new Error('走货明细有物料未填写供应商，请先补齐卖方')
  const matches = profiles.filter(p => [p.keyword, p.full].some(n => n?.trim().toLocaleLowerCase() === key))
  if (matches.length !== 1) throw new Error(matches.length
    ? `供应商「${name}」匹配到多份档案，请在供应商汇总中去重`
    : `供应商「${name}」没有档案，请先到供应商汇总补录`)
  const profile = matches[0]
  const missing = ([
    ['公司中文名称', profile.full], ['公司英文名称', profile.nameEn],
    ['中文地址', profile.addressZh], ['英文地址', profile.addressEn],
    ['电话', profile.phone], ['邮箱', profile.email], ['联系人', profile.contact],
  ] as const).filter(([, value]) => !value?.trim()).map(([label]) => label)
  if (missing.length) throw new Error(`供应商「${profile.keyword}」缺少${missing.join('、')}，请到供应商汇总补齐`)
  return profile
}

// 合同/发票卖方规则：仅当报关公司明确为华胜益时改用华胜益档案；
// 其他报关公司（含空值）均不参与卖方判断，仍使用该行供应商档案。
export function documentSellerForLine(supplierName: string, customsCompany: string, profiles: SupplierDict[], allowIncomplete = false): SupplierDict {
  return supplierForLine(isHuashengyi(customsCompany) ? HUASHENGYI_FULL_NAME : supplierName, profiles, allowIncomplete)
}
