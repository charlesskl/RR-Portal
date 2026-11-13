/** Split vertical merged cells at the boundary between pinned and virtual rows. */
export function shipmentFrozenRowSpan(row: number, frozenRows: number, spanAt: (row: number) => number | undefined) {
  const span = spanAt(row) ?? 1
  if (row < frozenRows) return Math.min(span, frozenRows - row)
  if (row !== frozenRows || span !== 0) return span
  for (let previous = row - 1; previous >= 0; previous--) {
    const parent = spanAt(previous) ?? 1
    if (parent > 0) return Math.max(0, previous + parent - row)
  }
  return span
}

export function shipmentFrozenColumns<T extends { fixed?: unknown; width?: unknown }>(columns: readonly T[], end: number | null) {
  return columns.map((column, index) => ({ ...column,
    fixed: end == null ? column.fixed : index <= end ? 'left' as const : column.fixed === 'right' && end >= 0 ? 'right' as const : undefined,
  }))
}
