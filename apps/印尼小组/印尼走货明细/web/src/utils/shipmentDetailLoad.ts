interface ShipmentRecord { id: number; items?: unknown[] }
interface PageMetadata { items_total?: number; items_offset?: number; items_next_offset?: number | null; items_version?: string }

/** Read bounded responses, but publish only a complete, single-version record. */
export async function loadShipmentDetail<T extends ShipmentRecord>(
  read: (params: { offset: number; limit: number; version?: string }) => Promise<{ data: T & PageMetadata }>,
  id: number, current: () => boolean,
): Promise<T | null> {
  let offset = 0, version: string | undefined, total: number | undefined, first: T | undefined
  const items: unknown[] = [], ids = new Set<number>()
  for (;;) {
    const { data } = await read({ offset, limit: 10, ...(version ? { version } : {}) })
    if (!current()) return null
    if (data.id !== id || !Array.isArray(data.items)) throw new Error('走货详情响应不完整，请重试')
    if (!first) first = data
    // Older servers ignore page parameters; keep the existing read contract.
    if (offset === 0 && data.items_total == null && data.items_offset == null
      && data.items_next_offset == null && data.items_version == null) return data
    if (!Number.isSafeInteger(data.items_total) || data.items_total! < 0
      || data.items_offset !== offset || !data.items_version || (version && data.items_version !== version)
      || (total != null && total !== data.items_total)) throw new Error('走货单分页资料不一致，请重新加载')
    version = data.items_version; total = data.items_total!
    for (const item of data.items as { id?: number }[]) if (item.id != null) {
      if (ids.has(item.id)) throw new Error('走货单返回重复明细，请重新加载')
      ids.add(item.id)
    }
    items.push(...data.items)
    if (items.length > total) throw new Error('走货单明细数量不一致，请重新加载')
    if (data.items_next_offset === null) {
      if (items.length !== total) throw new Error('走货单明细未完整加载，请重试')
      return { ...first, items } as T
    }
    if (!data.items.length || data.items_next_offset !== offset + data.items.length
      || data.items_next_offset >= total) throw new Error('走货单分页未完整加载，请重试')
    offset = data.items_next_offset
  }
}

export async function loadShipmentMaterials<T extends { id?: number }>(
  ids: number[], read: (ids: number[]) => Promise<{ data: T[] }>, current: () => boolean,
): Promise<T[] | null> {
  const result: T[] = []
  for (let offset = 0; offset < ids.length; offset += 10) {
    const batch = ids.slice(offset, offset + 10), { data } = await read(batch)
    if (!current()) return null
    if (!Array.isArray(data) || batch.some(id => !data.some(material => material.id === id)))
      throw new Error('物料资料未完整加载，请重试后再编辑')
    result.push(...data)
  }
  return result
}
