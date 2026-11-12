// Reading a multi-container workbook is separate from applying one safe batch.
export const SHIPMENT_IMPORT_BATCH_LIMIT = 500
export const SHIPMENT_IMPORT_PREVIEW_LIMIT = 5000

interface BatchRow { key: string; item: { carton_group?: string } }
/** Keep all members of a shared-carton group in the same preview batch. */
export function shipmentImportBatches(rows: readonly BatchRow[]) {
  const groups = new Map<string, string[]>()
  for (const row of rows) {
    const key = row.item.carton_group ? `group:${row.item.carton_group}` : `row:${row.key}`
    const group = groups.get(key) || []
    group.push(row.key); groups.set(key, group)
  }
  const batches: string[][] = []
  let current: string[] = []
  for (const group of groups.values()) {
    if (current.length && current.length + group.length > SHIPMENT_IMPORT_BATCH_LIMIT) {
      batches.push(current); current = []
    }
    if (group.length > SHIPMENT_IMPORT_BATCH_LIMIT) { batches.push(group); continue }
    current.push(...group)
  }
  if (current.length) batches.push(current)
  return batches
}
