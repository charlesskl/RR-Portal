import type { Molding } from '../api/client'

const text = (value: unknown) => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ')

// A physical mold may be reused for multiple styles/colors. Quantity and weight
// are editable data, not identity; part order must not affect repeat imports.
function variantKey(mold: Molding): string | null {
  const id = text(mold.moldId)
  const name = text(mold.moldName)
  if (!id && !name) return null
  const parts = (mold.parts ?? []).map(part => JSON.stringify([
    text(part.partCode), text(part.partName),
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
    const index = key === null ? -1 : merged.findIndex(candidate => variantKey(candidate) === key)
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
