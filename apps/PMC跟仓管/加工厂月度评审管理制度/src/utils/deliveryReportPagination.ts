import type { ReportRow } from './deliveryStats'

export type DeliveryPageRow = ReportRow & { pageKey: string }

/** Page by detail count. Keep each subtotal with the preceding detail and retain
 * its full-group metrics; only presentation rowspans are clipped to the page. */
export function paginateDeliveryReport(rows: ReportRow[], requestedPage: number, requestedSize: number) {
  const pageSize = Math.max(1, Math.floor(requestedSize) || 100)
  const detailIndices: number[] = []
  for (let index = 0; index < rows.length; index++) {
    if (rows[index]!.kind === 'detail') detailIndices.push(index)
  }
  const total = detailIndices.length
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(pageCount, Math.max(1, Math.floor(requestedPage) || 1))
  const firstDetail = (page - 1) * pageSize
  const start = detailIndices[firstDetail] ?? rows.length
  const end = detailIndices[firstDetail + pageSize] ?? rows.length
  const pageRows: DeliveryPageRow[] = []
  let rangeEnd = 0
  let pmcEnd = 0
  let factoryEnd = 0
  let lastDetailId = ''
  for (let index = 0; index < end; index++) {
    const row = rows[index]!
    if (row.kind === 'detail') {
      lastDetailId = row.id
      if (row.rangeSpan) rangeEnd = index + row.rangeSpan
      if (row.pmcSpan) pmcEnd = index + row.pmcSpan
      if (row.factorySpan) factoryEnd = index + row.factorySpan
      if (index < start) continue
      pageRows.push({
        ...row,
        pageKey: row.id,
        rangeSpan: row.rangeSpan || index === start ? Math.min(rangeEnd, end) - index : 0,
        pmcSpan: row.pmcSpan || index === start ? Math.min(pmcEnd, end) - index : 0,
        factorySpan: row.factorySpan || index === start ? Math.min(factoryEnd, end) - index : 0,
      })
    } else if (index >= start) {
      pageRows.push({ ...row, pageKey: `subtotal:${lastDetailId}` })
    }
  }
  return {
    rows: pageRows,
    page,
    pageCount,
    total,
    first: total ? firstDetail + 1 : 0,
    last: Math.min(firstDetail + pageSize, total),
  }
}
