import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { writeAnnotatedSchedule } from './excelWriter.js'
import type { ReconciliationResult, RowMatchResult, ScheduleRow } from '../types/index.js'

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a minimal schedule Excel buffer in memory.
 * Sheet name: 总排期
 * Row 1: headers
 * Row 2+: data rows
 */
async function buildScheduleBuffer(
  headers: string[],
  rows: (string | number | null)[][]
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('总排期')

  // Row 1: headers
  ws.addRow(headers)

  // Data rows
  for (const r of rows) {
    ws.addRow(r)
  }

  return (await wb.xlsx.writeBuffer()) as Buffer
}

/**
 * Load a buffer back into a workbook and return the 总排期 worksheet.
 */
async function loadSheet(buf: Buffer): Promise<ExcelJS.Worksheet> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  const ws = wb.getWorksheet('总排期')
  if (!ws) throw new Error('Sheet 总排期 missing in output')
  return ws
}

/**
 * Get the ARGB fill color of a cell (returns '' if no fill).
 */
function getFill(cell: ExcelJS.Cell): string {
  const fill = cell.fill as ExcelJS.FillPattern | undefined
  if (!fill || fill.type !== 'pattern') return ''
  return (fill.fgColor?.argb ?? '') as string
}

// ─── Test Data ───────────────────────────────────────────────────────────────

const HEADERS = ['Tomy PO', '货号', '国家', '数量', 'PO走货期', '日期码', '箱唛资料']

// Two data rows. rowIndex in ExcelJS is 1-based; row 1 = headers, row 2 = first data row.
const DATA_ROWS: (string | number | null)[][] = [
  ['PO-001', '47280A', '美国', 100, '2026-03-31', null,    '标准唛'],   // row 2 → rowIndex 2
  ['PO-001', '47281B', '美国', 200, '2026-04-15', 'B2826RR01', '标准唛'], // row 3 → rowIndex 3
  ['PO-002', '99001C', '英国', 50,  '2026-05-01', null,    '待定'],     // row 4 → rowIndex 4
]

// ─── Test Fixtures ────────────────────────────────────────────────────────────

/** A RowMatchResult for row 2 with one mismatch (国家) */
const matchResultWithMismatch: RowMatchResult = {
  scheduleRowIndex: 2,
  tomyPO: 'PO-001',
  货号: '47280A',
  status: 'matched',
  mismatches: [
    { field: '国家', scheduleValue: '美国', poValue: '英国' },
  ],
  dateCode: 'B2826RR01',
  sourceFile: 'PO-001.pdf',
  hasJDLabel: true,
}

/** A RowMatchResult for row 3 — no mismatches, has dateCode, cell already has a value */
const matchResultNoMismatch: RowMatchResult = {
  scheduleRowIndex: 3,
  tomyPO: 'PO-001',
  货号: '47281B',
  status: 'matched',
  mismatches: [],
  dateCode: 'B2826RR02', // should NOT be written — cell already has 'B2826RR01'
  sourceFile: 'PO-001.pdf',
  hasJDLabel: false,
}

/** A RowMatchResult for row 4 — no mismatches, dateCode, empty cell */
const matchResultEmptyDateCode: RowMatchResult = {
  scheduleRowIndex: 4,
  tomyPO: 'PO-002',
  货号: '99001C',
  status: 'matched',
  mismatches: [],
  dateCode: 'C2826RR01',
  sourceFile: 'PO-002.pdf',
  hasJDLabel: false,
}

const scheduleRows: ScheduleRow[] = [
  { rowIndex: 2, 接单期: null, 国家: '美国', 第三客户名称: null, 客跟单: null, tomyPO: 'PO-001', customerPO: null, 货号: '47280A', 数量: 100, 外箱: null, 总箱数: null, PO走货期: null, 日期码: null,        箱唛资料: '标准唛' },
  { rowIndex: 3, 接单期: null, 国家: '美国', 第三客户名称: null, 客跟单: null, tomyPO: 'PO-001', customerPO: null, 货号: '47281B', 数量: 200, 外箱: null, 总箱数: null, PO走货期: null, 日期码: 'B2826RR01', 箱唛资料: '标准唛' },
  { rowIndex: 4, 接单期: null, 国家: '英国', 第三客户名称: null, 客跟单: null, tomyPO: 'PO-002', customerPO: null, 货号: '99001C', 数量: 50,  外箱: null, 总箱数: null, PO走货期: null, 日期码: null,        箱唛资料: '待定' },
]

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('writeAnnotatedSchedule', () => {
  it('returns a valid ExcelJS buffer (round-trip load succeeds)', async () => {
    const buf = await buildScheduleBuffer(HEADERS, DATA_ROWS)
    const result: ReconciliationResult = {
      matched: [matchResultWithMismatch],
      unmatchedPOItems: [],
      ambiguousPOItems: [],
      errors: [],
    }
    const out = await writeAnnotatedSchedule(buf, result, scheduleRows)
    expect(out).toBeInstanceOf(Buffer)
    expect(out.length).toBeGreaterThan(0)

    // round-trip: loading must not throw
    const ws = await loadSheet(out)
    expect(ws).toBeTruthy()
  })

  it('adds a 状态 status column header after the last existing column', async () => {
    const buf = await buildScheduleBuffer(HEADERS, DATA_ROWS)
    const result: ReconciliationResult = {
      matched: [matchResultWithMismatch],
      unmatchedPOItems: [],
      ambiguousPOItems: [],
      errors: [],
    }
    const out = await writeAnnotatedSchedule(buf, result, scheduleRows)
    const ws = await loadSheet(out)

    // The last column should be 状态
    const headerRow = ws.getRow(1)
    let foundStatus = false
    headerRow.eachCell({ includeEmpty: false }, (cell) => {
      if (String(cell.value) === '状态') foundStatus = true
    })
    expect(foundStatus).toBe(true)
  })

  it('applies light red fill (FFFFCCCC) to a mismatched cell', async () => {
    const buf = await buildScheduleBuffer(HEADERS, DATA_ROWS)
    const result: ReconciliationResult = {
      matched: [matchResultWithMismatch],
      unmatchedPOItems: [],
      ambiguousPOItems: [],
      errors: [],
    }
    const out = await writeAnnotatedSchedule(buf, result, scheduleRows)
    const ws = await loadSheet(out)

    // Row 2 (header is row 1, first data row is row 2)
    // 国家 is column index 3 in our HEADERS (1-based: Tomy PO=1, 货号=2, 国家=3)
    const row = ws.getRow(2)
    const guojiaCell = row.getCell(3) // 国家 column
    expect(getFill(guojiaCell)).toBe('FFFFCCCC')
  })

  it('sets a note (comment) on a mismatched cell with the PO value', async () => {
    const buf = await buildScheduleBuffer(HEADERS, DATA_ROWS)
    const result: ReconciliationResult = {
      matched: [matchResultWithMismatch],
      unmatchedPOItems: [],
      ambiguousPOItems: [],
      errors: [],
    }
    const out = await writeAnnotatedSchedule(buf, result, scheduleRows)
    const ws = await loadSheet(out)

    const row = ws.getRow(2)
    const guojiaCell = row.getCell(3) // 国家 column
    // ExcelJS note can be string or object
    const note = guojiaCell.note
    const noteText = typeof note === 'string' ? note : (note as { texts?: Array<{ text: string }> })?.texts?.[0]?.text ?? ''
    expect(noteText).toContain('英国') // poValue
  })

  it('applies green fill (FF90EE90) to non-mismatched cells on a matched row', async () => {
    const buf = await buildScheduleBuffer(HEADERS, DATA_ROWS)
    const result: ReconciliationResult = {
      matched: [matchResultNoMismatch],
      unmatchedPOItems: [],
      ambiguousPOItems: [],
      errors: [],
    }
    const out = await writeAnnotatedSchedule(buf, result, scheduleRows)
    const ws = await loadSheet(out)

    // Row 3 (matchResultNoMismatch → scheduleRowIndex 3)
    const row = ws.getRow(3)
    // Check a few cells are green
    const cell1 = row.getCell(1) // Tomy PO
    const cell2 = row.getCell(2) // 货号
    expect(getFill(cell1)).toBe('FF90EE90')
    expect(getFill(cell2)).toBe('FF90EE90')
  })

  it('sets 已核对 status on matched rows with no mismatches', async () => {
    const buf = await buildScheduleBuffer(HEADERS, DATA_ROWS)
    const result: ReconciliationResult = {
      matched: [matchResultNoMismatch],
      unmatchedPOItems: [],
      ambiguousPOItems: [],
      errors: [],
    }
    const out = await writeAnnotatedSchedule(buf, result, scheduleRows)
    const ws = await loadSheet(out)

    // Status column is after last column (7 headers + 1 = col 8)
    const row = ws.getRow(3)
    const statusColIdx = ws.columnCount // last column is status
    const statusCell = row.getCell(statusColIdx)
    expect(String(statusCell.value)).toBe('已核对')
  })

  it('writes dateCode to 日期码 cell only if currently empty', async () => {
    const buf = await buildScheduleBuffer(HEADERS, DATA_ROWS)
    // Row 2 (47280A): 日期码 is null → should be written
    // Row 3 (47281B): 日期码 is 'B2826RR01' → should NOT be overwritten
    const result: ReconciliationResult = {
      matched: [matchResultWithMismatch, matchResultNoMismatch],
      unmatchedPOItems: [],
      ambiguousPOItems: [],
      errors: [],
    }
    const out = await writeAnnotatedSchedule(buf, result, scheduleRows)
    const ws = await loadSheet(out)

    // 日期码 is column 6 in HEADERS (1-based)
    const row2 = ws.getRow(2)
    const dateCodeCell2 = row2.getCell(6)
    expect(String(dateCodeCell2.value)).toBe('B2826RR01') // written (was null)

    const row3 = ws.getRow(3)
    const dateCodeCell3 = row3.getCell(6)
    expect(String(dateCodeCell3.value)).toBe('B2826RR01') // unchanged (was already set)
  })

  it('appends unmatched PO items at bottom with yellow fill (FFFFFF99)', async () => {
    const buf = await buildScheduleBuffer(HEADERS, DATA_ROWS)

    const result: ReconciliationResult = {
      matched: [],
      unmatchedPOItems: [
        {
          tomyPO: 'PO-999',
          货号: '55555X',
          sourceFile: 'PO-999.pdf',
          poItem: { 货号: '55555X', PO走货期: '1 Jan 2027', 数量: 10, factoryCode: 'RR01', 外箱: 5 },
          poData: {
            tomyPO: 'PO-999', customerPO: 'CP-999', handleBy: 'Alice', customerName: 'TOMY',
            destCountry: 'USA', items: [], sourceFile: 'PO-999.pdf', qcInstructions: '',
          },
        },
      ],
      ambiguousPOItems: [],
      errors: [],
    }
    const out = await writeAnnotatedSchedule(buf, result, scheduleRows)
    const ws = await loadSheet(out)

    // The new row should be appended after the 3 data rows (row 5)
    const appendedRow = ws.getRow(5)
    // Check yellow fill on at least the first cell
    expect(getFill(appendedRow.getCell(1))).toBe('FFFFFF99')
    // Status cell should be 未匹配
    const statusColIdx = ws.columnCount
    expect(String(appendedRow.getCell(statusColIdx).value)).toBe('未匹配')
  })

  it('sets 未核对 status for schedule rows under same PO as matched rows but not directly matched', async () => {
    // Row 2 (PO-001/47280A) is matched
    // Row 3 (PO-001/47281B) shares PO-001 but is NOT in matched[] — should get 未核对
    const buf = await buildScheduleBuffer(HEADERS, DATA_ROWS)
    const result: ReconciliationResult = {
      matched: [matchResultWithMismatch], // only row 2 matched
      unmatchedPOItems: [],
      ambiguousPOItems: [],
      errors: [],
    }
    const out = await writeAnnotatedSchedule(buf, result, scheduleRows)
    const ws = await loadSheet(out)

    const statusColIdx = ws.columnCount
    const row3 = ws.getRow(3)
    expect(String(row3.getCell(statusColIdx).value)).toBe('未核对')
  })

  it('mixed row: mismatched cell is red, non-mismatched cells on same row remain green', async () => {
    const buf = await buildScheduleBuffer(HEADERS, DATA_ROWS)
    const result: ReconciliationResult = {
      matched: [matchResultWithMismatch], // row 2, 国家 mismatches
      unmatchedPOItems: [],
      ambiguousPOItems: [],
      errors: [],
    }
    const out = await writeAnnotatedSchedule(buf, result, scheduleRows)
    const ws = await loadSheet(out)

    const row = ws.getRow(2)
    // 国家 (col 3) should be red
    expect(getFill(row.getCell(3))).toBe('FFFFCCCC')
    // 货号 (col 2) should be green (no mismatch)
    expect(getFill(row.getCell(2))).toBe('FF90EE90')
  })
})
