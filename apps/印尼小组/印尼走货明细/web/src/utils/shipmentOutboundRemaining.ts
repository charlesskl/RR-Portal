interface OutboundAllocation { outbound_id?: number; qty?: number }
interface AllocatableOutbound { outbound_id: number; allocatable_qty?: number }
export type OutboundCandidate<T extends AllocatableOutbound> = T & { remaining_qty: number; allocated_in_editor: number }

// allocatable_qty already excludes OTHER containers. Deduct only the current
// editor's original rows (saved and unsaved), not the API's allocated_current
// again, and never deduct the consolidated display totals a second time.
export function outboundCandidates<T extends AllocatableOutbound>(
  sources: readonly T[], items: readonly OutboundAllocation[],
): OutboundCandidate<T>[] {
  const used = new Map<number, number>()
  for (const item of items) if (item.outbound_id) {
    const qty = Math.max(0, Number(item.qty) || 0)
    used.set(item.outbound_id, (used.get(item.outbound_id) || 0) + qty)
  }
  return sources.flatMap(source => {
    const allocated = used.get(source.outbound_id) || 0
    const cap = Number(source.allocatable_qty)
    const remaining = Number((cap - allocated).toPrecision(15))
    if (!Number.isFinite(cap) || !Number.isFinite(remaining) || remaining <= 1e-8) return []
    return [{ ...source, allocated_in_editor: allocated, remaining_qty: remaining }]
  })
}

/** Validate the complete selection against fresh balances before appending. */
export function planOutboundPull<T extends AllocatableOutbound>(
  sources: readonly T[], items: readonly OutboundAllocation[], selectedIds: readonly number[],
): OutboundCandidate<T>[] {
  const ids = [...new Set(selectedIds)]
  if (!ids.length) throw new Error('请先勾选出库物料')
  const candidates = new Map(outboundCandidates(sources, items).map(row => [row.outbound_id, row]))
  return ids.map(id => {
    const row = candidates.get(id)
    if (!row) throw new Error(`OUT-${id} 已无剩余可拉数量，请重新选择`)
    return row
  })
}
