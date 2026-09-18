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
