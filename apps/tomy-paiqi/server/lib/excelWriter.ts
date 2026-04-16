import ExcelJS from 'exceljs'
import type {
  ReconciliationResult,
  RowMatchResult,
  ScheduleRow,
} from '../types/index.js'

// ─── Column name aliases (same as excelParser.ts) ────────────────────────────
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
 * Resolve a column number using a list of alias names.
 */
function resolveColumn(colMap: Map<string, number>, names: string[]): number | undefined {
  for (const name of names) {
    const idx = colMap.get(name)
    if (idx !== undefined) return idx
  }
  return undefined
}

// Fill color helpers
const RED_FILL: ExcelJS.FillPattern = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFFCCCC' },
}

const GREEN_FILL: ExcelJS.FillPattern = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF90EE90' },
}

const YELLOW_FILL: ExcelJS.FillPattern = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFFFF99' },
}

/**
 * Write an annotated schedule Excel buffer based on reconciliation results.
 *
 * Rules applied:
 * - Matched rows: green fill on all cells; red fill + note on mismatched cells
 * - Schedule rows under same PO as a matched row but not themselves matched: 未核对 status
 * - Unmatched PO items: appended at bottom with yellow fill and 未匹配 status
 * - Date code written to 日期码 column only if cell is currently empty
 * - Status column (状态) added after the last existing column
 */
export async function writeAnnotatedSchedule(
  scheduleBuffer: Buffer,
  result: ReconciliationResult,
  scheduleRows: ScheduleRow[]
): Promise<Buffer> {
  // Load the original workbook
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(scheduleBuffer)

  const ws = workbook.getWorksheet('总排期')
  if (!ws) throw new Error('Sheet 总排期 not found in workbook')

  // Build column map from header row
  const headerRow = ws.getRow(1)
  const colMap = buildColumnMap(headerRow)

  // Resolve column indices
  const tomyPOCol = resolveColumn(colMap, COLUMN_ALIASES.tomyPO)
  const customerPOCol = resolveColumn(colMap, COLUMN_ALIASES.customerPO)
  const dateCodeCol = colMap.get('日期码')

  // Resolve 客贴纸 column for JD label auto-fill
  const stickerNoteCol = colMap.get('客贴纸')

  // All comparison field names → column indices
  // These must match FieldMismatch.field values produced by reconciler
  const fieldColMap: Record<string, number | undefined> = {
    '国家': colMap.get('国家'),
    '第三客户名称': resolveColumn(colMap, COLUMN_ALIASES.diSanKeHu),
    '客跟单': colMap.get('客跟单'),
    'TOMY PO': tomyPOCol,
    'CUSTOMER PO': customerPOCol,
    '货号': colMap.get('货号'),
    '数量': colMap.get('数量'),
    '外箱': colMap.get('外箱'),
    'PO走货期': resolveColumn(colMap, COLUMN_ALIASES.poZouHuoQi),
    '箱唛资料': colMap.get('箱唛资料'),
    '客贴纸': stickerNoteCol,
  }

  // Add status column header
  const statusColIdx = ws.columnCount + 1
  ws.getRow(1).getCell(statusColIdx).value = '状态'

  // Build a set of matched schedule row indices + map for quick lookup
  const matchedRowIndexMap = new Map<number, RowMatchResult>()
  for (const m of result.matched) {
    matchedRowIndexMap.set(m.scheduleRowIndex, m)
  }

  // Collect the set of PO numbers that appear in matched items
  const matchedPONumbers = new Set<string>()
  for (const m of result.matched) {
    matchedPONumbers.add(m.tomyPO.trim().toLowerCase())
  }

  // Debug: log matched row indices
  console.log(`[excelWriter] Total matched rows: ${result.matched.length}`)
  console.log(`[excelWriter] Matched row indices: ${result.matched.map(m => m.scheduleRowIndex).join(', ')}`)
  console.log(`[excelWriter] Total sheet rows: ${ws.rowCount}`)

  // Apply styling to each matched row
  for (const matchResult of result.matched) {
    const row = ws.getRow(matchResult.scheduleRowIndex)

    // Build a set of mismatched field names for this row
    const mismatchFields = new Set(matchResult.mismatches.map((m) => m.field))

    // Apply green to all data cells first, then red to mismatched cells
    // Use spread to create new style objects, avoiding shared style mutation
    const colCount = ws.columnCount // includes status column already added
    for (let c = 1; c <= colCount - 1; c++) {
      // skip status column
      const cell = row.getCell(c)
      cell.style = { ...cell.style, fill: { ...GREEN_FILL } }
    }

    // Apply red fill + note to mismatched cells
    for (const mismatch of matchResult.mismatches) {
      const colIdx = fieldColMap[mismatch.field]
      if (colIdx === undefined) continue
      const cell = row.getCell(colIdx)
      cell.style = { ...cell.style, fill: { ...RED_FILL } }
      cell.note = `PO value: ${mismatch.poValue}`
    }

    // Write date code to 日期码 cell only if currently empty
    if (matchResult.dateCode !== null && dateCodeCol !== undefined) {
      const dateCell = row.getCell(dateCodeCol)
      const currentVal = dateCell.value
      if (currentVal === null || currentVal === undefined || String(currentVal).trim() === '') {
        dateCell.value = matchResult.dateCode
      }
    }

    // Auto-fill 客贴纸: if PO has JD label and schedule cell is empty → fill + red highlight
    if (matchResult.hasJDLabel && stickerNoteCol !== undefined) {
      const stickerCell = row.getCell(stickerNoteCol)
      const currentVal = String(stickerCell.value ?? '').trim()
      if (currentVal === '') {
        stickerCell.value = '有JD贴纸'
        stickerCell.style = { ...stickerCell.style, fill: { ...RED_FILL } }
        stickerCell.note = 'PO含有JD标记，排期漏填，已自动补填'
      }
    }

    // Set status to 已核对
    row.getCell(statusColIdx).value = '已核对'
  }

  // For unmatched schedule rows that share a PO with a matched row → 未核对
  for (const schedRow of scheduleRows) {
    if (matchedRowIndexMap.has(schedRow.rowIndex)) continue // already handled
    if (schedRow.tomyPO && matchedPONumbers.has(schedRow.tomyPO.trim().toLowerCase())) {
      const row = ws.getRow(schedRow.rowIndex)
      row.getCell(statusColIdx).value = '未核对'
    }
  }

  // Append unmatched PO items at the bottom with yellow fill
  for (const unmatched of result.unmatchedPOItems) {
    // Build a row with values in the right columns
    const newRowValues: (string | number | null)[] = new Array(statusColIdx).fill(null)

    if (tomyPOCol !== undefined) newRowValues[tomyPOCol - 1] = unmatched.tomyPO
    if (customerPOCol !== undefined) newRowValues[customerPOCol - 1] = unmatched.poData.customerPO
    const goodsNoCol = colMap.get('货号')
    if (goodsNoCol !== undefined) newRowValues[goodsNoCol - 1] = unmatched.货号
    const qtyCol = colMap.get('数量')
    if (qtyCol !== undefined) newRowValues[qtyCol - 1] = unmatched.poItem.数量
    const cartonCol = colMap.get('外箱')
    if (cartonCol !== undefined && unmatched.poItem.外箱 !== null) {
      newRowValues[cartonCol - 1] = unmatched.poItem.外箱
    }
    const dueDateCol = colMap.get('PO走货期')
    if (dueDateCol !== undefined) newRowValues[dueDateCol - 1] = unmatched.poItem.PO走货期
    newRowValues[statusColIdx - 1] = '未匹配'

    const appendedRow = ws.addRow(newRowValues)

    // Apply yellow fill to all cells
    for (let c = 1; c <= statusColIdx; c++) {
      appendedRow.getCell(c).style = { ...appendedRow.getCell(c).style, fill: { ...YELLOW_FILL } }
    }
  }

  return (await workbook.xlsx.writeBuffer()) as Buffer
}
