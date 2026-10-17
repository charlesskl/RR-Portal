const mergeableNames = new Set(['螺丝', '螺母', '五金配件', '塑胶件', '搪胶件', '毛绒裁片'])

// Called within one customs-company group. Missing HS/unit cannot prove compatibility.
export function invoiceDetailGroups(rows: Array<{ index: number; name: string; hs: string; unit: string }>): number[][] {
  const groups = new Map<string, number[]>()
  for (const row of rows) {
    const name = row.name.trim(), hs = row.hs.trim(), unit = row.unit.trim().toUpperCase()
    const key = mergeableNames.has(name) && hs && unit
      ? JSON.stringify([name, hs, unit]) : `single:${row.index}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(row.index)
  }
  return [...groups.values()]
}
