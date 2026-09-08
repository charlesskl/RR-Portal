import * as XLSX from 'xlsx'
import type { ReportRow } from './deliveryStats'
import { DELIVERY_HEADERS, deliveryHeaders, splitSewingContractItemNo, type DeliveryPricingMode } from './deliveryReportFormat'

// 导出交货延期统计表 Excel(标题行 + 合并单元格)
export function createDeliveryWorkbook(
  rows: ReportRow[],
  title: string,
  includeMoldNumber = true,
  includeContractNumber = false,
  pricingMode: DeliveryPricingMode = includeContractNumber ? 'rmb-tax' : 'hkd',
) {
  const H = deliveryHeaders(includeMoldNumber, includeContractNumber, pricingMode)
  const moldColumn = DELIVERY_HEADERS.indexOf('模具编号')
  const visibleValues = (values: any[], splitItemNumber = true) => {
    const visible = includeMoldNumber
      ? [...values]
      : values.filter((_, index) => index !== moldColumn)
    let taxPointIndex = 21
    if (!includeMoldNumber) taxPointIndex--
    if (includeContractNumber) {
      const itemColumn = H.indexOf('货号') - 1
      if (splitItemNumber) {
        const parts = splitSewingContractItemNo(visible[itemColumn])
        visible.splice(itemColumn, 1, parts.contractNo, parts.itemNo)
      } else {
        visible.splice(itemColumn + 1, 0, '')
      }
      taxPointIndex++
    }
    if (pricingMode !== 'hkd-tax') visible.splice(taxPointIndex, 1)
    return visible
  }
  const titleRow = new Array(H.length).fill('')
  titleRow[0] = title
  const body: any[][] = []
  const merges: any[] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: H.length - 1 } }]
  rows.forEach((r, i) => {
    const rr = 2 + i
    if (r.kind === 'detail') {
      body.push(visibleValues([
        r.rangeSpan ? r.range : '', r.pmcSpan ? r.pmc : '', r.factorySpan ? r.factory : '',
        r.item_no, r.mold_no, r.order_no, r.category, r.product, r.quantity ?? '',
        r.order_date, r.delivery_date, r.actual_delivery_date, r.delay_days ?? '',
        r.orderCount, r.delayedCount, r.delayRatio, r.delayAvg, r.quote, r.outPrice, r.outPriceCnyTax, r.exchangeRate, r.taxPoint ?? '', r.priceRatio, r.notes,
      ]))
      if (r.rangeSpan > 1) merges.push({ s: { r: rr, c: 0 }, e: { r: rr + r.rangeSpan - 1, c: 0 } })
      if (r.pmcSpan > 1) merges.push({ s: { r: rr, c: 1 }, e: { r: rr + r.pmcSpan - 1, c: 1 } })
      if (r.factorySpan > 1) merges.push({ s: { r: rr, c: 2 }, e: { r: rr + r.factorySpan - 1, c: 2 } })
    } else {
      body.push(visibleValues([
        '', '', '', `${r.factory}-小计`, '', '', '', '', '', '', '', '', '',
        r.orderCount, r.delayedCount, r.delayRatio, r.delayAvg, r.quote, r.outPrice, r.outPriceCnyTax, '', '', r.priceRatio, '',
      ], false))
      merges.push({
        s: { r: rr, c: 3 },
        e: { r: rr, c: (includeMoldNumber ? 12 : 11) + (includeContractNumber ? 1 : 0) },
      })
    }
  })
  const ws = XLSX.utils.aoa_to_sheet([titleRow, H, ...body])
  ws['!merges'] = merges
  const hkdOutPriceColumn = pricingMode === 'rmb-tax' ? -1 : H.indexOf('外发工价(港币不含税$)')
  if (hkdOutPriceColumn >= 0) {
    for (let row = 2; row < body.length + 2; row++) {
      const cell = ws[XLSX.utils.encode_cell({ r: row, c: hkdOutPriceColumn })]
      if (cell?.t === 'n') cell.z = '0.000'
    }
  }
  const cw = (v: any) => { let w = 0; for (const ch of String(v ?? '')) w += /[⺀-￿]/.test(ch) ? 2 : 1; return w }
  ws['!cols'] = H.map((h, c) => {
    let max = cw(h)
    for (const row of body) max = Math.max(max, cw(row[c]))
    return { wch: Math.min(Math.max(max + 2, 6), 32) }
  })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '交货延期统计表')
  return wb
}
