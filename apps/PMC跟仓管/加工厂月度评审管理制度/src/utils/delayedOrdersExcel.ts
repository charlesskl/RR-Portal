import * as XLSX from 'xlsx-js-style'
import type { buildDelayedSections } from './delayedOrders'
import { delayedHeaders } from './delayedReportFormat'
type Section = ReturnType<typeof buildDelayedSections>[number]
export function createDelayedOrdersWorkbook(sections: Section[], regionName: string, period: string) {
  const workbook = XLSX.utils.book_new()
  for (const section of sections.filter((s) => s.count)) {
    const headers = delayedHeaders(section.pricingMode)
    const title = `${regionName}厂区—${section.name}—外发加工厂交货及价格统计表（延期订单）`
    const data: (string | number | null)[][] = [[title], [`下单时间：${period}；仅统计延迟时间 ≥ 1 的订单`], headers]
    const merges: XLSX.Range[] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 19 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 19 } }]
    section.rows.forEach((row, index) => {
      const rr = index + 3
      const price = section.pricingMode === 'hunan-rmb-tax' ? row.outPriceCnyTax : row.outPrice
      const metrics = [row.orderCount, row.delayedCount, row.delayRatio, row.delayAvg, row.quote || '', price || '', row.priceRatio]
      if (row.kind === 'detail') {
        data.push([row.rangeSpan ? row.range : '', row.pmcSpan ? row.pmc : '', row.factorySpan ? row.factory : '', row.item_no, row.order_no, row.category, row.product, row.quantity, row.order_date, row.delivery_date, row.actual_delivery_date, row.delay_days, ...metrics, row.notes])
        for (const [c, span] of [[0, row.rangeSpan], [1, row.pmcSpan], [2, row.factorySpan]] as const) {
          if (span > 1) merges.push({ s: { r: rr, c }, e: { r: rr + span - 1, c } })
        }
      } else {
        data.push(['', '', row.factory, '小计：', '', '', '', section.quantities[index] ?? '', '', '', '', '', ...metrics, ''])
        for (const [start, end] of [[4, 6], [8, 11]]) merges.push({ s: { r: rr, c: start! }, e: { r: rr, c: end! } })
      }
    })
    const sheet = XLSX.utils.aoa_to_sheet(data)
    const border = { style: 'thin', color: { rgb: '999999' } }
    for (let r = 0; r < data.length; r++) for (let c = 0; c < 20; c++) {
      const key = XLSX.utils.encode_cell({ r, c })
      const cell = sheet[key] ?? (sheet[key] = { t: 's', v: '' })
      const subtotal = r >= 3 && section.rows[r - 3]?.kind === 'subtotal'
      const color = r === 2 ? (![0, 1, 4, 8, 19].includes(c) ? 'FFFF00' : 'FFFFFF') : r >= 3 && c >= 12 && c <= 15 ? 'E2EFD9' : r >= 3 && c >= 16 && c <= 18 ? 'FFF2CC' : 'FFFFFF'
      cell.s = { font: { name: '微软雅黑', sz: r === 0 ? 16 : 11, bold: r === 0 || r === 2 || subtotal, color: { rgb: subtotal || (r >= 2 && [14, 18].includes(c)) ? 'FF2020' : '111111' } }, fill: { fgColor: { rgb: color } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: { top: border, bottom: border, left: border, right: border } }
      if (r >= 3 && [16, 17].includes(c) && cell.t === 'n') cell.z = ['hkd', 'hkd-tax'].includes(section.pricingMode) ? '0.000' : '0.00'
    }
    sheet['!merges'] = merges
    sheet['!cols'] = headers.map((_, i) => ({ wch: i === 19 ? 50 : [2, 3, 4, 6].includes(i) ? 24 : 16 }))
    sheet['!rows'] = data.map((_, i) => ({ hpt: i === 0 ? 32 : i === 2 ? 36 : 28 }))
    XLSX.utils.book_append_sheet(workbook, sheet, section.name)
  }
  return workbook
}
export function downloadDelayedOrdersExcel(sections: Section[], regionName: string, period: string) {
  const workbook = createDelayedOrdersWorkbook(sections, regionName, period)
  if (!workbook.SheetNames.length) throw new Error('当前筛选没有可导出的延期订单')
  XLSX.writeFile(workbook, `${regionName}厂区-延期订单-${period}.xlsx`)
}
