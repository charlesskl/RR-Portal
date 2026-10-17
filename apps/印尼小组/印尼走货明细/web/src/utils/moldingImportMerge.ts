import type { Molding } from '../api/client'

const text = (value: unknown) => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ')

// A physical mold may be reused for multiple styles/colors. Quantity and weight
// are editable data, not identity; part order must not affect repeat imports.
function variantKey(mold: Molding, ignorePartCategory = false): string | null {
  const id = text(mold.moldId)
  const name = text(mold.moldName)
  if (!id && !name) return null
  const parts = (mold.parts ?? []).map(part => JSON.stringify([
    text(part.partCode), ignorePartCategory ? text(part.partName).replace(/^(?:塑胶件|搪胶件)-/, '') : text(part.partName),
  ])).sort()
  return JSON.stringify([
    id ? ['id', id] : ['name', name],
    text(mold.materialName), text(mold.colorName), text(mold.colorCode), text(mold.pigmentCode), parts,
  ])
}

export function mergeImportedMoldings(existing: Molding[], incoming: Molding[]): Molding[] {
  const merged = [...existing]
  for (const mold of incoming) {
    const key = variantKey(mold)
    let index = key === null ? -1 : merged.findIndex(candidate => variantKey(candidate) === key)
    // Correct the previous default-plastic classification only for a unique otherwise
    // identical variant. Keep distinct styles/colors and ambiguous old records separate.
    if (index < 0 && key !== null && mold.parts?.length && mold.parts.every(part => text(part.partName).startsWith('搪胶件-'))) {
      const correctedKey = variantKey(mold, true)
      const candidates = merged.map((candidate, i) => ({ candidate, i })).filter(({ candidate }) =>
        candidate.parts?.length && candidate.parts.every(part => text(part.partName).startsWith('塑胶件-'))
        && variantKey(candidate, true) === correctedKey)
      if (candidates.length === 1) index = candidates[0].i
    }
    if (index < 0) {
      merged.push(mold)
      continue
    }
    const previous = merged[index]
    // Keep locally maintained production settings, without mutating API data.
    merged[index] = {
      ...previous, ...mold,
      setsPerShot: previous.setsPerShot ?? mold.setsPerShot,
      workshop: previous.workshop ?? mold.workshop,
      notes: previous.notes ?? mold.notes,
    }
  }
  return merged
}
