import type { Material } from '../api/client'

const key = (value?: string) => (value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
const specKey = (value?: string) => key(value).replace(/\s+/g, '').replace(/[×x]/g, '*')
const nameKey = (value?: string) => key(value).replace(/五金配件|hardware accessories|fsc/gi, '').replace(/[\s\-/#（）()]/g, '')

export function updateImportedMaterial(target: Material, material: Material, engineering = false): Material {
  const patch = Object.fromEntries(Object.entries(material).filter(([field, value]) =>
    !['id', 'active', 'image_id', 'image', 'sort_order'].includes(field)
    && !(engineering && ['gross_per_pc', 'length', 'width', 'height', 'qty_per_carton', 'weight_per_carton'].includes(field))
    && value != null && (typeof value !== 'string' || value.trim() !== '')))
  return { ...target, ...patch, ...(engineering && material.image_id ? { image_id: material.image_id } : {}) }
}

export type ImportChoice = 'skip' | 'add' | number
// Recommendations require explicit confirmation; ties and shared targets stay skipped.
export function recommendMaterialChoices(rows: Material[], pending: Material[]): ImportChoice[] {
  const canonicalName = (value?: string) => nameKey(value)
    .replace(/标准3a\d+/g, '').replace(/电池/g, '').replace(/无脚/g, '')
  const choices: ImportChoice[] = pending.map(material => {
    const ranked = rows.map((row, index) => {
      const sameSpec = Boolean(specKey(material.spec) && specKey(material.spec) === specKey(row.spec))
      const sameName = Boolean(canonicalName(material.name_zh) && canonicalName(material.name_zh) === canonicalName(row.name_zh))
      const sameEn = Boolean(nameKey(material.name_en) && nameKey(material.name_en) === nameKey(row.name_en))
      const codeConflict = key(material.material_code) && key(row.material_code) && key(material.material_code) !== key(row.material_code)
      return { index, score: codeConflict ? 0 : (sameSpec ? 60 : 0) + (sameName ? 50 : 0) + (sameEn ? 40 : 0) }
    }).sort((a, b) => b.score - a.score)
    return ranked[0]?.score >= 60 && ranked[0].score > (ranked[1]?.score ?? 0) ? ranked[0].index : 'skip'
  })
  return choices.map(choice => typeof choice === 'number' && choices.filter(c => c === choice).length > 1 ? 'skip' : choice)
}
export function resolveMaterialImport(rows: Material[], pending: Material[], choices: ImportChoice[], existingCount: number) {
  const result = rows.map(row => ({ ...row }))
  const used = new Set<number>()
  pending.forEach((material, index) => {
    const choice = choices[index] ?? 'skip'
    if (choice === 'skip') return
    if (choice === 'add') { result.push({ ...material, id: undefined }); return }
    if (!Number.isInteger(choice) || choice < 0 || choice >= existingCount || !result[choice]) throw new Error('所选旧物料已失效，请重新选择')
    if (used.has(choice)) throw new Error('不能将多条导入物料覆盖到同一条旧记录，请重新选择')
    used.add(choice)
    result[choice] = updateImportedMaterial(result[choice], material, true)
  })
  return result
}

/** Merge within the current product only; item_no is not a unique material key. */
export function mergeImportedMaterials(existing: Material[], incoming: Material[], engineering = false) {
  const rows = existing.map(row => ({ ...row }))
  let updated = 0, added = 0
  const conflicts: string[] = []
  const pending: Material[] = []
  for (const material of incoming) {
    const code = key(material.material_code)
    // 工程表中编码也可能被不同物料共用，不能仅凭重复编码覆盖。
    const uniqueCode = code && incoming.filter(row => key(row.material_code) === code).length === 1
    let candidates = uniqueCode ? rows.filter(row => key(row.material_code) === code) : []
    if (!candidates.length && key(material.name_zh)) {
      candidates = rows.filter(row => key(row.name_zh) === key(material.name_zh)
        && (!code || !key(row.material_code) || key(row.material_code) === code)
        && (!key(material.spec) || !key(row.spec) || key(row.spec) === key(material.spec)))
    }
    if (engineering && !candidates.length) {
      const compatible = rows.filter(row => !code || !key(row.material_code) || key(row.material_code) === code)
      const sameSpec = specKey(material.spec)
        ? compatible.filter(row => specKey(row.spec) === specKey(material.spec)) : []
      const relatedName = (row: Material) => {
        const a = nameKey(row.name_zh), b = nameKey(material.name_zh)
        const enA = nameKey(row.name_en), enB = nameKey(material.name_en)
        return Boolean((a && b && (a.includes(b) || b.includes(a))) || (enA && enA === enB))
      }
      const strong = sameSpec.filter(row => relatedName(row)
        || (key(row.supplier) && key(row.supplier) === key(material.supplier)))
      if (strong.length === 1) candidates = strong
      else if (sameSpec.length || compatible.some(relatedName)) {
        conflicts.push(material.name_zh || code || '未命名物料')
        pending.push(material)
        continue
      }
    }
    if (candidates.length > 1) {
      conflicts.push(material.name_zh || material.material_code || material.item_no || '未命名物料')
      pending.push(material)
      continue
    }
    if (candidates.length === 1) {
      const target = candidates[0]
      Object.assign(target, updateImportedMaterial(target, material, engineering))
      updated++
    } else {
      rows.push({ ...material })
      added++
    }
  }
  return { rows, updated, added, conflicts, pending }
}
