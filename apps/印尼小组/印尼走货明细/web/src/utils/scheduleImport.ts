function normalizedFillRgb(cell: any): string {
  const style = cell?.s
  const rgb = String(style?.fill?.fgColor?.rgb ?? style?.fgColor?.rgb ?? '').trim().toUpperCase()
  return rgb.length === 8 ? rgb.slice(-6) : rgb
}

export function isYellowScheduleCell(cell: any): boolean {
  return normalizedFillRgb(cell) === 'FFFF00'
}

// 源排期中只有整行 A–AP 填充黄色才表示“尚未下单”。
// 日期等单个黄色单元格只是业务提示，不能把整行判为未下单。
export function isFullyYellowScheduleRow(cells: any[]): boolean {
  return cells.length > 0 && cells.every(isYellowScheduleCell)
}

// 排期模板有些文字表头沿用了日期格式。sheet_to_json 会把这些文字误转为
// Invalid Date，因此直接读取单元格原始值，保留“货号 / TOMY PO”等表头。
export function scheduleSheetToRawGrid(ws: any, utils: any): any[][] {
  if (!ws?.['!ref']) return []
  const range = utils.decode_range(ws['!ref'])
  const rows: any[][] = []
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: any[] = []
    for (let c = range.s.c; c <= range.e.c; c++) {
      row[c] = ws[utils.encode_cell({ r, c })]?.v ?? null
    }
    rows[r] = row
  }
  return rows
}
