import XLSX from 'xlsx-js-style'
import type { FactoryStats } from './factoryStats'

export const FACTORY_SUMMARY_HEADERS = [
  '加工厂名称',
  '评级',
  '核价总金额', '外发总金额', '价格占比',
  '订单总单数', '延期单数', '延期占比', '延期平均天数',
  '验货总单数', '合格单数', '合格率',
  'IP管控', '现场得分', '折算总达成率',
] as const

export interface FactorySummaryExportItem {
  name: string
  grade: string
  ipControl: string
  stats: FactoryStats
  siteScore: number | string
  siteRate: string
}

export interface FactorySummaryExportSection {
  title: string
  items: FactorySummaryExportItem[]
  total: FactorySummaryExportItem
}

type SheetCellStyle = NonNullable<XLSX.CellObject['s']>

const COLUMN_WIDTHS = [32, 8, 15, 15, 12, 13, 12, 12, 16, 13, 12, 12, 16, 12, 12]
const WHITE = { rgb: 'FFFFFF' }
const ALTERNATE = { rgb: 'F8FAFC' }
const TOTAL = { rgb: 'EEF2FF' }
const GROUP_FILLS = [
  WHITE, WHITE,
  { theme: 4, tint: 0.8 }, { theme: 4, tint: 0.8 }, { theme: 4, tint: 0.8 },
  { theme: 5, tint: 0.8 }, { theme: 5, tint: 0.8 }, { theme: 5, tint: 0.8 }, { theme: 5, tint: 0.8 },
  { theme: 7, tint: 0.8 }, { theme: 7, tint: 0.8 }, { theme: 7, tint: 0.8 },
  { theme: 9, tint: 0.8 }, { theme: 9, tint: 0.8 }, { theme: 9, tint: 0.8 },
] as const

const thinBorder = {
  top: { style: 'thin', color: { auto: 1 } },
  bottom: { style: 'thin', color: { auto: 1 } },
  left: { style: 'thin', color: { auto: 1 } },
  right: { style: 'thin', color: { auto: 1 } },
} as const

function cellStyle(fill: (typeof GROUP_FILLS)[number], bold = false, wrapText = false): SheetCellStyle {
  return {
    fill: { patternType: 'solid', fgColor: fill },
    font: { name: 'Calibri', sz: 11, bold },
    alignment: { horizontal: 'center', vertical: 'center', wrapText },
    border: thinBorder,
  } as SheetCellStyle
}

function numberFormatForColumn(column: number): string | undefined {
  if ([2, 3, 5, 6, 9, 10].includes(column)) return '#,##0'
  if ([4, 7, 11, 14].includes(column)) return '0.0%'
  if ([8, 13].includes(column)) return '0.00'
  return undefined
}

function metricNumber(value: number | string): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const normalized = value.trim()
  if (!normalized || normalized === '-') return null
  const parsed = Number.parseFloat(normalized.replace(/[^0-9.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function metricPercent(value: string): number | null {
  const parsed = metricNumber(value)
  return parsed == null ? null : parsed / 100
}

export function factorySummaryExportRow(item: FactorySummaryExportItem): Array<string | number | null> {
  return [
    item.name,
    item.grade,
    item.stats.quoteAmount,
    item.stats.outAmount,
    metricPercent(item.stats.amountRatio),
    item.stats.orderCount,
    item.stats.delayedCount,
    metricPercent(item.stats.delayRatio),
    metricNumber(item.stats.delayDaysAvg),
    item.stats.intInspect,
    item.stats.intPass,
    metricPercent(item.stats.intRate),
    item.ipControl,
    metricNumber(item.siteScore),
    metricPercent(item.siteRate),
  ]
}

/**
 * 按用户提供的「厂区·月份加工厂汇总表」样式生成工作簿。
 * 每个部门一个纵向分段，分段间保留一个空行。
 */
export function buildFactorySummaryWorkbook(sections: FactorySummaryExportSection[]): XLSX.WorkBook {
  const rows: Array<Array<string | number | null>> = []
  const sectionRanges: Array<{
    titleRow: number
    headerRow: number
    detailStartRow: number
    detailEndRow: number
    totalRow: number
  }> = []

  sections.forEach((section, index) => {
    if (index > 0) rows.push(Array(FACTORY_SUMMARY_HEADERS.length).fill(''))
    const titleRow = rows.length
    rows.push([section.title, ...Array(FACTORY_SUMMARY_HEADERS.length - 1).fill('')])
    const headerRow = rows.length
    rows.push([...FACTORY_SUMMARY_HEADERS])
    const detailStartRow = rows.length
    rows.push(...section.items.map(factorySummaryExportRow))
    const detailEndRow = rows.length - 1
    const totalRow = rows.length
    rows.push(factorySummaryExportRow(section.total))
    sectionRanges.push({ titleRow, headerRow, detailStartRow, detailEndRow, totalRow })
  })

  const ws = XLSX.utils.aoa_to_sheet(rows)
  const lastColumn = FACTORY_SUMMARY_HEADERS.length - 1
  ws['!cols'] = COLUMN_WIDTHS.map((wch) => ({ wch }))
  ws['!rows'] = rows.map(() => ({ hpt: 16.8 }))
  ws['!merges'] = sectionRanges.map(({ titleRow }) => ({
    s: { r: titleRow, c: 0 },
    e: { r: titleRow, c: lastColumn },
  }))

  sectionRanges.forEach((range, sectionIndex) => {
    ws['!rows']![range.titleRow] = { hpt: sectionIndex === 0 ? 28 : 23.2 }
    ws['!rows']![range.headerRow] = { hpt: sectionIndex === 0 ? 24 : 17 }

    if (sectionIndex > 0) {
      for (let column = 0; column <= lastColumn; column++) {
        const address = XLSX.utils.encode_cell({ r: range.titleRow - 1, c: column })
        const cell = ws[address] ?? (ws[address] = { t: 'z', v: undefined })
        cell.s = { fill: { patternType: 'solid', fgColor: WHITE } } as SheetCellStyle
      }
    }

    for (let column = 0; column <= lastColumn; column++) {
      const titleCell = ws[XLSX.utils.encode_cell({ r: range.titleRow, c: column })]
      if (titleCell) titleCell.s = cellStyle(WHITE)

      const headerCell = ws[XLSX.utils.encode_cell({ r: range.headerRow, c: column })]
      if (headerCell) {
        headerCell.s = {
          ...cellStyle(GROUP_FILLS[column]!, true, true),
          font: { name: 'Calibri', sz: 11, bold: true, color: { rgb: '000000' } },
        } as SheetCellStyle
      }
    }

    const firstTitleCell = ws[XLSX.utils.encode_cell({ r: range.titleRow, c: 0 })]
    if (firstTitleCell) {
      firstTitleCell.s = {
        ...cellStyle(WHITE, true),
        font: { name: 'Calibri', sz: 16, bold: true, color: { rgb: '000000' } },
      } as SheetCellStyle
    }

    for (let row = range.detailStartRow; row <= range.totalRow; row++) {
      const isTotal = row === range.totalRow
      const detailIndex = row - range.detailStartRow
      for (let column = 0; column <= lastColumn; column++) {
        const address = XLSX.utils.encode_cell({ r: row, c: column })
        const cell = ws[address] ?? (ws[address] = { t: 'z', v: undefined })
        const fill = column < 2
          ? (isTotal ? TOTAL : (detailIndex % 2 === 0 ? WHITE : ALTERNATE))
          : GROUP_FILLS[column]!
        cell.s = cellStyle(fill, isTotal)
        const numberFormat = numberFormatForColumn(column)
        if (numberFormat && cell.v != null) cell.z = numberFormat
      }
    }
  })

  if (sectionRanges.length) {
    const first = sectionRanges[0]!
    ws['!autofilter'] = {
      ref: `A${first.headerRow + 1}:${XLSX.utils.encode_col(lastColumn)}${first.totalRow + 1}`,
    }
  }

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, ws, '汇总表')
  return workbook
}
