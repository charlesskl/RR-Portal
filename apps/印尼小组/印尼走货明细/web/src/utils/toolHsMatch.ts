import type { HsDict, Material } from '../api/client'

const trim = (value: unknown) => String(value ?? '').trim()
const normalize = (value: unknown) => trim(value).normalize('NFKC').toLowerCase().replace(/\s+/g, '')

// Only use maintained dictionary entries, never product HS or built-in inferred codes.
export function toolHsCandidates(material: Material, dictionary: HsDict[]): HsDict[] {
  const name = normalize(material.name_zh)
  if (!name || (trim(material.hs_cn) && trim(material.hs_id))) return []
  return dictionary.filter(d => {
    const keyword = normalize(d.keyword)
    if (!keyword || !name.includes(keyword)) return false
    if (trim(material.hs_cn) && trim(d.hsCN) && trim(material.hs_cn) !== trim(d.hsCN)) return false
    if (trim(material.hs_id) && trim(d.hsID) && trim(material.hs_id) !== trim(d.hsID)) return false
    return (!trim(material.hs_cn) && !!trim(d.hsCN)) || (!trim(material.hs_id) && !!trim(d.hsID))
  }).sort((a, b) => normalize(b.keyword).length - normalize(a.keyword).length)
}

export function fillMissingToolHs(material: Material, candidate: HsDict): Material {
  return {
    ...material,
    hs_cn: trim(material.hs_cn) ? material.hs_cn : trim(candidate.hsCN),
    hs_id: trim(material.hs_id) ? material.hs_id : trim(candidate.hsID),
  }
}
