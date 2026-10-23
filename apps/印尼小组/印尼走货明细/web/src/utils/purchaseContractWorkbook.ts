import * as XLSX from 'xlsx-js-style'
import type { PoEntity } from './poNumber'

const companySheets: [PoEntity, string][] = [
  ['HD_INDUSTRY', '华登实业'], ['HD_GLOBAL', '华登全球'], ['HSY', '华胜益'],
]

/** Match Excel's 15 significant digits, then round cents halfway away from zero. */
export function roundPurchaseContractAmount(amount: number): number {
  if (!Number.isFinite(amount)) return amount
  const sign = amount < 0 ? -1 : 1
  const magnitude = Number(Math.abs(amount).toPrecision(15))
  // At this scale the 15-digit value has no fractional cents; avoid exponent overflow.
  if (magnitude >= 1e15) return sign * magnitude
  const [coefficient, exponent = '0'] = String(magnitude).split('e')
  const cents = Math.round(Number(`${coefficient}e${Number(exponent) + 2}`))
  return sign * cents / 100
}

/** 数量沿用单位精度，按原金额反算单价，避免数量舍入改变金额。 */
export function setPurchaseContractLineAmounts(ws: XLSX.WorkSheet, row: number, quantity: number, amount: number, quantityDigits: number, unit?: string) {
  const exportQuantity = Number(quantity.toFixed(quantityDigits))
  const exportAmount = roundPurchaseContractAmount(amount)
  const price = exportQuantity !== 0 ? exportAmount / exportQuantity : 0
  const isKilogram = ['KGM', 'KG', '千克', '公斤'].includes(String(unit || '').trim().toUpperCase())
  ws[`D${row}`] = { ...ws[`D${row}`], t: 'n', v: exportQuantity, z: isKilogram ? '0.00' : `0.${'#'.repeat(quantityDigits)}` }
  // 数量舍入为零时无法反算单价；留空单价并保留原金额，不产生除零或错误的零金额。
  ws[`F${row}`] = exportQuantity === 0 && exportAmount !== 0
    ? { ...ws[`F${row}`], t: 's', v: '', f: undefined }
    : { ...ws[`F${row}`], t: 'n', v: price, z: '0.0000' } // 仅显示四位，计算保留完整单价。
  ws[`G${row}`] = {
    ...ws[`G${row}`], t: 'n', v: exportAmount,
    f: exportQuantity === 0 && exportAmount !== 0 ? undefined : `ROUND(D${row}*F${row},2)`, z: '0.00',
  }
}

/** 公司抬头 22 号、购销合同标题 18 号，其余 12 号；全部加粗。合并前逐单应用。 */
export function formatPurchaseContractFonts(ws: XLSX.WorkSheet) {
  for (const [address, cell] of Object.entries(ws)) {
    if (address.startsWith('!')) continue
    const size = address === 'A1' ? 22 : address === 'A4' ? 18 : 12
    cell.s = { ...cell.s, font: { ...cell.s?.font, sz: size, bold: true } }
  }
}

/** 合计/大写按采购合同样表定位；sumRow 为从 0 开始的行号，不改金额或公式。 */
export function formatPurchaseContractTotals(ws: XLSX.WorkSheet, sumRow: number) {
  const upperRow = sumRow + 1
  ws['!merges'] ||= []
  ws['!merges'].push(
    { s: { r: sumRow, c: 4 }, e: { r: sumRow, c: 5 } },
    { s: { r: sumRow, c: 6 }, e: { r: sumRow, c: 7 } },
    { s: { r: upperRow, c: 6 }, e: { r: upperRow, c: 7 } },
  )
  for (const [row, column] of [[sumRow, 4], [sumRow, 6], [upperRow, 4], [upperRow, 5], [upperRow, 6]]) {
    const cell = ws[XLSX.utils.encode_cell({ r: row, c: column })]
    if (!cell) continue
    cell.s = { ...cell.s, alignment: {
      ...cell.s?.alignment, horizontal: row === upperRow && column === 6 ? 'left' : 'center',
      vertical: 'center', wrapText: true,
    } }
  }
  // Merged cells do not reliably auto-fit in Excel/WPS; reserve enough height for
  // long Chinese amounts without widening the item table or auxiliary columns.
  const text = String(ws[XLSX.utils.encode_cell({ r: upperRow, c: 6 })]?.v || '')
  const textWidth = Array.from(text).reduce((width, char) => width + (char.charCodeAt(0) > 255 ? 2 : 1), 0)
  const width = (ws['!cols']?.[6]?.wch || 13) + (ws['!cols']?.[7]?.wch || 18) - 2
  ws['!rows'] ||= []
  ws['!rows'][sumRow] = { ...ws['!rows'][sumRow], hpt: Math.max(ws['!rows'][sumRow]?.hpt || 0, 24) }
  ws['!rows'][upperRow] = { ...ws['!rows'][upperRow], hpt: Math.max(24, Math.ceil(textWidth / width) * 18 + 6) }
}

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
