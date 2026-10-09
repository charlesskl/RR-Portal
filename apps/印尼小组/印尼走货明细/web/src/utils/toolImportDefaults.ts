import type { Dictionaries, Material } from '../api/client'
import { fillMissingToolHs, toolHsCandidates } from './toolHsMatch'

const norm = (v?: string) => (v || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase()
export function toolImportDefaults(material: Material, dictionaries: Dictionaries) {
  let result = { ...material }
  const warnings: string[] = []
  if (!result.customs_company?.trim() && norm(result.supplier)) {
    const suppliers = dictionaries.suppliers.filter(d => [d.keyword, d.full].some(v => norm(v) === norm(result.supplier)))
    const values = [...new Set(suppliers.map(d => d.customs?.trim()).filter((v): v is string => !!v))]
    if (values.length === 1) result.customs_company = values[0]
    else warnings.push(`${result.name_zh}：供应商对应报关公司${values.length ? '有多个结果' : '未匹配'}，请核对`)
  }
  if (!result.name_en?.trim()) {
    const values = [...new Set(dictionaries.translations.filter(d => d.active !== false && norm(d.keyword) === norm(result.name_zh)).map(d => d.english.trim()).filter(Boolean))]
    if (values.length === 1) result.name_en = values[0]
    else if (values.length > 1) warnings.push(`${result.name_zh}：英文名存在多个匹配，未自动填入`)
  }
  const candidates = toolHsCandidates(result, dictionaries.hs)
  const unique = [...new Map(candidates.map(c => [JSON.stringify([c.hsCN || '', c.hsID || '']), c])).values()]
  if (unique.length === 1) result = fillMissingToolHs(result, unique[0])
  else if (unique.length > 1) warnings.push(`${result.name_zh}：HS 编码存在多个候选，未自动填入`)
  return { material: result, warnings }
}
