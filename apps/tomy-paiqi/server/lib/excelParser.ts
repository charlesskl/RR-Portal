import ExcelJS from 'exceljs'
import type { ScheduleRow } from '../types/index.js'

// Column name aliases for cross-file compatibility
// Dongguan uses "Tomy PO" / "Cust. PO NO.", Indonesia uses "TOMY PO" / "CUSTOMER PO"
const COLUMN_ALIASES: Record<string, string[]> = {
  tomyPO: ['Tomy PO', 'TOMY PO'],
  customerPO: ['Cust. PO NO.', 'CUSTOMER PO'],
  diSanKeHu: ['第三客户名称', '客名'],
  poZouHuoQi: ['PO走货期', '走货期'],
}

/**
 * Build a map from header cell string value to column number.
 * Reads row 1 of the worksheet.
 */
function buildColumnMap(headerRow: ExcelJS.Row): Map<string, number> {
  const map = new Map<string, number>()
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const key = String(cell.value ?? '').trim()
    if (key) map.set(key, colNumber)
  })
  return map
}

/**
 * Resolve a column number from the map using a list of alias names.
 * Returns the first matching column index, or undefined if none found.
 */
function resolveColumn(colMap: Map<string, number>, names: string[]): number | undefined {
  for (const name of names) {
    const idx = colMap.get(name)
    if (idx !== undefined) return idx
  }
  return undefined
}

/**
 * Unwrap an ExcelJS cell value, handling formula cells that return
 * { formula, result } objects. Returns null for null/undefined.
 */
function unwrapCellValue(raw: ExcelJS.CellValue): unknown {
  if (raw === null || raw === undefined) return null
  // Formula cell: { formula: '...', result: value }
  if (typeof raw === 'object' && 'result' in (raw as object)) {
    return (raw as { formula: string; result: unknown }).result
  }
  return raw
}

/**
 * Get and unwrap the value of a cell at a given column index.
 * Returns null if colIndex is undefined.
 */
function getCellValue(row: ExcelJS.Row, colIndex: number | undefined): unknown {
  if (colIndex === undefined) return null
  const cell = row.getCell(colIndex)
  return unwrapCellValue(cell.value)
}

/**
 * Parse an Excel schedule file and return ScheduleRow[] for the 总排期 sheet.
 *
 * Handles:
 * - Header-based column mapping (different positions in Dongguan vs Indonesia)
 * - Column aliases ("Tomy PO" / "TOMY PO", "Cust. PO NO." / "CUSTOMER PO")
 * - Formula cells (外箱, 总箱数, 数量) returning { formula, result } — unwrapped to number
 * - Date cells (PO走货期, 接单期) returning JS Date objects — kept as Date
 * - Empty rows (no tomyPO value) are skipped
 */
export async function parseScheduleExcel(buffer: Buffer): Promise<ScheduleRow[]> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)

  // Try known sheet name aliases in order
  const SHEET_CANDIDATES = ['总排期', '排期', 'Schedule', 'Sheet1']
  let ws = workbook.getWorksheet('总排期')
  if (!ws) {
    for (const name of SHEET_CANDIDATES) {
      ws = workbook.getWorksheet(name)
      if (ws) break
    }
  }
  // Fallback: scan all sheets for one containing a TOMY PO column
  if (!ws) {
    const tomyPONames = new Set(['Tomy PO', 'TOMY PO'])
    for (const sheet of workbook.worksheets) {
      const headerRow = sheet.getRow(1)
      let found = false
      headerRow.eachCell({ includeEmpty: false }, (cell) => {
        if (tomyPONames.has(String(cell.value ?? '').trim())) found = true
      })
      if (found) { ws = sheet; break }
    }
  }
  if (!ws) {
    const sheetNames = workbook.worksheets.map(s => s.name).join(', ')
    throw new Error(`Sheet 总排期 not found in workbook (available: ${sheetNames})`)
  }

  // Build column map from row 1 headers
  const headerRow = ws.getRow(1)
  const colMap = buildColumnMap(headerRow)

  // Resolve aliased columns
  const tomyPOCol = resolveColumn(colMap, COLUMN_ALIASES.tomyPO)
  const customerPOCol = resolveColumn(colMap, COLUMN_ALIASES.customerPO)

  // Direct lookup columns (identical names in both files)
  const jieDanQiCol = colMap.get('接单期')
  const guoJiaCol = colMap.get('国家')
  const diSanKeHuCol = resolveColumn(colMap, COLUMN_ALIASES.diSanKeHu)
  const keGenDanCol = colMap.get('客跟单')
  const huoHaoCol = colMap.get('货号')
  const shuLiangCol = colMap.get('数量')
  const waiXiangCol = colMap.get('外箱')
  const zongXiangShuCol = colMap.get('总箱数')
  const poZouHuoQiCol = resolveColumn(colMap, COLUMN_ALIASES.poZouHuoQi)
  const riQiMaCol = colMap.get('日期码')
  const xiangMaiZiLiaoCol = colMap.get('箱唛资料')
  const keTieZhiCol = colMap.get('客贴纸')

  const rows: ScheduleRow[] = []

  ws.eachRow({ includeEmpty: false }, (row, rowIdx) => {
    if (rowIdx === 1) return // skip header row

    // Get raw tomyPO value to decide if row is empty
    const rawTomyPO = getCellValue(row, tomyPOCol)
    const tomyPOStr = rawTomyPO !== null && rawTomyPO !== undefined
      ? String(rawTomyPO).trim()
      : ''
    // Skip rows with no TOMY PO value (empty/filler rows)
    if (!tomyPOStr) return

    // Extract 接单期
    const rawJieDanQi = getCellValue(row, jieDanQiCol)
    const jieDanQi = rawJieDanQi instanceof Date ? rawJieDanQi : null

    // Extract 国家
    const rawGuoJia = getCellValue(row, guoJiaCol)
    const guoJia = rawGuoJia !== null && rawGuoJia !== undefined
      ? String(rawGuoJia).trim() || null
      : null

    // Extract 第三客户名称
    const rawDiSanKeHu = getCellValue(row, diSanKeHuCol)
    const diSanKeHu = rawDiSanKeHu !== null && rawDiSanKeHu !== undefined
      ? String(rawDiSanKeHu).trim() || null
      : null

    // Extract 客跟单
    const rawKeGenDan = getCellValue(row, keGenDanCol)
    const keGenDan = rawKeGenDan !== null && rawKeGenDan !== undefined
      ? String(rawKeGenDan).trim() || null
      : null

    // Extract customerPO
    const rawCustomerPO = getCellValue(row, customerPOCol)
    const customerPOStr = rawCustomerPO !== null && rawCustomerPO !== undefined
      ? String(rawCustomerPO).trim() || null
      : null

    // Extract 货号
    const rawHuoHao = getCellValue(row, huoHaoCol)
    const huoHao = rawHuoHao !== null && rawHuoHao !== undefined
      ? String(rawHuoHao).trim() || null
      : null

    // Extract numeric fields (may be formula cells)
    const rawShuLiang = getCellValue(row, shuLiangCol)
    const shuLiang = rawShuLiang !== null && rawShuLiang !== undefined
      ? (Number(rawShuLiang) || null)
      : null

    const rawWaiXiang = getCellValue(row, waiXiangCol)
    const waiXiang = rawWaiXiang !== null && rawWaiXiang !== undefined
      ? (Number(rawWaiXiang) || null)
      : null

    const rawZongXiangShu = getCellValue(row, zongXiangShuCol)
    const zongXiangShu = rawZongXiangShu !== null && rawZongXiangShu !== undefined
      ? (Number(rawZongXiangShu) || null)
      : null

    // Extract PO走货期 (Date)
    const rawPoZouHuoQi = getCellValue(row, poZouHuoQiCol)
    const poZouHuoQi = rawPoZouHuoQi instanceof Date ? rawPoZouHuoQi : null

    // Extract 日期码
    const rawRiQiMa = getCellValue(row, riQiMaCol)
    const riQiMa = rawRiQiMa !== null && rawRiQiMa !== undefined
      ? String(rawRiQiMa).trim() || null
      : null

    // Extract 箱唛资料
    const rawXiangMaiZiLiao = getCellValue(row, xiangMaiZiLiaoCol)
    const xiangMaiZiLiao = rawXiangMaiZiLiao !== null && rawXiangMaiZiLiao !== undefined
      ? String(rawXiangMaiZiLiao).trim() || null
      : null

    // Extract 客贴纸
    const rawKeTieZhi = getCellValue(row, keTieZhiCol)
    const keTieZhi = rawKeTieZhi !== null && rawKeTieZhi !== undefined
      ? String(rawKeTieZhi).trim() || null
      : null

    rows.push({
      rowIndex: rowIdx,
      接单期: jieDanQi,
      国家: guoJia,
      第三客户名称: diSanKeHu,
      客跟单: keGenDan,
      tomyPO: tomyPOStr,
      customerPO: customerPOStr,
      货号: huoHao,
      数量: shuLiang,
      外箱: waiXiang,
      总箱数: zongXiangShu,
      PO走货期: poZouHuoQi,
      日期码: riQiMa,
      箱唛资料: xiangMaiZiLiao,
      客贴纸: keTieZhi,
    })
  })

  return rows
}
