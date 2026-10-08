import * as XLSX from 'xlsx-js-style'
import type { PoEntity } from './poNumber'

const companySheets: [PoEntity, string][] = [
  ['HD_INDUSTRY', '华登实业'], ['HD_GLOBAL', '华登全球'], ['HSY', '华胜益'],
]

/** 拼接系统生成的独立合同（公式仅引用合同内 D/F/G 列），保留样式和合并区域。 */
export function combinePurchaseContracts(contracts: { entity: PoEntity; ws: XLSX.WorkSheet }[]) {
  const wb = XLSX.utils.book_new()
  for (const [entity, name] of companySheets) {
    const group = contracts.filter(contract => contract.entity === entity)
    if (!group.length) continue
    const sheet: XLSX.WorkSheet = { '!merges': [], '!rows': [] }
    let offset = 0
    let lastCol = 0
    for (const { ws } of group) {
      const range = XLSX.utils.decode_range(ws['!ref'] || 'A1')
      lastCol = Math.max(lastCol, range.e.c)
      sheet['!cols'] ||= ws['!cols']?.map(col => ({ ...col }))
      for (const address of Object.keys(ws)) {
        if (address.startsWith('!')) continue
        const pos = XLSX.utils.decode_cell(address)
        const cell = { ...ws[address] }
        if (cell.f && offset) {
          cell.f = cell.f.replace(/(\$?[A-Z]{1,3})(\$?)(\d+)/g,
            (_: string, col: string, absolute: string, row: string) => `${col}${absolute}${Number(row) + offset}`)
        }
        sheet[XLSX.utils.encode_cell({ r: pos.r + offset, c: pos.c })] = cell
      }
      for (const merge of ws['!merges'] || []) {
        sheet['!merges']!.push({ s: { ...merge.s, r: merge.s.r + offset }, e: { ...merge.e, r: merge.e.r + offset } })
      }
      ws['!rows']?.forEach((row, index) => { sheet['!rows']![index + offset] = { ...row } })
      offset += range.e.r + 3 // 两张合同之间空两行，不合并各自金额。
    }
    sheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: offset - 3, c: lastCol } })
    XLSX.utils.book_append_sheet(wb, sheet, name)
  }
  return wb
}
