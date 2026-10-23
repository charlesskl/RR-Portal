import type { Material, SupplierDict } from '../api/client'

interface PurchaseCustomsItem {
  material_id?: number
  product_code?: string
  material_name?: string
  spec?: string
}

const key = (value?: string) => (value || '').trim().toLocaleLowerCase()
export function purchaseItemCodes(code?: string, knownCodes: (string | undefined)[] = []) {
  const parts = (code || '').split('/').map(c => c.trim()).filter(Boolean)
  const known = new Set(knownCodes.map(key).filter(Boolean))
  const result: string[] = []
  // Longest exact library code wins, including compound codes inside merged rows.
  for (let start = 0; start < parts.length;) {
    let end = parts.length
    while (end > start + 1 && !known.has(key(parts.slice(start, end).join('/')))) end--
    result.push(parts.slice(start, end).join('/'))
    start = end
  }
  return [...new Set(result)]
}

// 编号涉及合同主体，不能使用包含式简称匹配或从重复档案中随意取第一条。
function exactProfile(name: string, profiles: SupplierDict[]) {
  if (!key(name)) return undefined
  const keywords = profiles.filter(p => key(p.keyword) === key(name))
  const matches = keywords.length ? keywords : profiles.filter(p => key(p.full) === key(name))
  return matches.length === 1 ? matches[0] : undefined
}

export function sameSupplier(a: string, b: string, profiles: SupplierDict[]) {
  if (!key(a) || !key(b)) return false
  if (key(a) === key(b)) return true
  const first = exactProfile(a, profiles)
  return first != null && first === exactProfile(b, profiles)
}

export function resolvePurchaseCustoms(items: PurchaseCustomsItem[], supplier: string, materials: Material[], profiles: SupplierDict[]) {
  const evidence: { company: string; source: string }[] = []
  items.forEach((item, index) => {
    const line = `第 ${index + 1} 行「${item.material_name || '未命名物料'}」`
    const linked = item.material_id == null ? undefined : materials.find(m => Number(m.id) === Number(item.material_id))
    const codes = purchaseItemCodes(item.product_code, materials.map(m => m.product_code))
    // 合并多货号的行必须逐个核对，不能仅取合并后保留的第一个 ID。
    const matches = linked && codes.length <= 1 ? [linked] : codes.map(code => {
      const candidates = materials.filter(m => key(m.product_code) === key(code)
        && !!key(item.material_name) && key(m.name_zh) === key(item.material_name)
        && key(m.spec) === key(item.spec)
        && sameSupplier(m.supplier || '', supplier, profiles))
      if (candidates.length !== 1) {
        throw new Error(`${line}：货号 ${code} ${candidates.length ? '匹配到多条物料' : '未找到唯一物料'}，请核对货号、名称、规格及供应商`)
      }
      return candidates[0]
    })
    if (!matches.length) throw new Error(`${line}：物料关联失效且缺少货号，请先补齐关联`)
    for (const material of matches) {
      const stored = material.customs_company?.trim()
      if (stored) {
        evidence.push({ company: stored, source: `${line}：货号库报关公司` })
        continue
      }
      const profile = exactProfile(material.supplier || '', profiles)
      const company = profile?.customs?.trim()
      if (!company) throw new Error(`${line}：物料报关公司为空，供应商档案未唯一匹配或未设置报关公司，请在供应商汇总核对`)
      evidence.push({ company, source: `${line}：供应商档案「${profile!.keyword}」的报关公司` })
    }
  })
  return evidence
}
