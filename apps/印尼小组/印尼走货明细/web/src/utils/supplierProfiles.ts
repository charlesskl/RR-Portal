import type { SupplierDict } from '../api/client'

export const HUASHENGYI_FULL_NAME = '深圳市华胜益出口贸易有限公司'

function isHuashengyi(name: string): boolean {
  const key = name.trim().toLocaleLowerCase()
  return key === '华胜益' || key === HUASHENGYI_FULL_NAME.toLocaleLowerCase()
}

export function supplierProfileForName(name: string, profiles: SupplierDict[]): SupplierDict | undefined {
  const key = name.trim().toLocaleLowerCase()
  if (!key) return undefined
  const exactKeyword = profiles.find(profile =>
    profile.keyword?.trim().toLocaleLowerCase() === key
    && profile.full?.trim().toLocaleLowerCase() !== key)
  if (exactKeyword) return exactKeyword

  // 兼容旧资料：历史同步曾把简称另建成 full=keyword 的重复行。
  // 当“港正”这类简称只对应一个包含它的公司全称时，优先使用公司全称资料。
  const containingFull = profiles.filter(profile => {
    const full = profile.full?.trim().toLocaleLowerCase() || ''
    return full !== key && full.includes(key)
  })
  if (containingFull.length === 1) return containingFull[0]

  return profiles.find(profile => [profile.full, profile.keyword]
    .some(candidate => candidate?.trim().toLocaleLowerCase() === key))
}

export function canonicalSupplierProfiles(profiles: SupplierDict[]): SupplierDict[] {
  return profiles.filter(profile => {
    const full = profile.full?.trim() || ''
    const keyword = profile.keyword?.trim() || ''
    if (!full || full !== keyword) return true
    return supplierProfileForName(full, profiles) === profile
  })
}

export function supplierCustomsCompany(profile: SupplierDict): string {
  const customs = profile.customs?.trim()
  if (isHuashengyi(customs || '')) return HUASHENGYI_FULL_NAME
  return profile.full?.trim() || profile.keyword.trim()
}

export function linkedCustomsCompany(supplierName: string, profiles: SupplierDict[], fallback = ''): string {
  const profile = supplierProfileForName(supplierName, profiles)
  return profile ? supplierCustomsCompany(profile) : fallback.trim()
}

export function supplierForLine(name: string, profiles: SupplierDict[]): SupplierDict {
  const key = name.trim().toLocaleLowerCase()
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
export function documentSellerForLine(supplierName: string, customsCompany: string, profiles: SupplierDict[]): SupplierDict {
  return supplierForLine(isHuashengyi(customsCompany) ? HUASHENGYI_FULL_NAME : supplierName, profiles)
}
