export interface QualityInspectionImportColumns {
  date: number
  factory: number
  ptype: number
  customer: number
  delivery_no: number
  item_no: number
  product: number
  qty: number
  single: number
  ir: number
  idf: number
  iins: number
  cdate: number
  cres: number
  cdef: number
  notes: number
}

export function normalizeExcelHeader(value: unknown): string {
  return String(value).replace(/\s+/g, '')
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

export function formatImportedDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`
  }
  const text = String(value ?? '').trim()
  if (!text) return ''

  const ymd = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (ymd) return `${ymd[1]}-${pad2(Number(ymd[2]))}-${pad2(Number(ymd[3]))}`

  const mdy = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/)
  if (mdy) {
    const yy = Number(mdy[3])
    const year = yy < 100 ? 2000 + yy : yy
    return `${year}-${pad2(Number(mdy[1]))}-${pad2(Number(mdy[2]))}`
  }

  return text
}

export function buildQualityInspectionImportColumns(rawHeader: unknown[]): QualityInspectionImportColumns {
  const header = rawHeader.map(normalizeExcelHeader)
  const colOf = (...aliases: string[]) => {
    for (const alias of aliases) {
      const index = header.indexOf(normalizeExcelHeader(alias))
      if (index >= 0) return index
    }
    return -1
  }
  const qty = colOf('数量')
  const single = colOf('单数')
  const inspectionStart = single > qty ? single + 1 : qty + 1
  const notes = colOf('备注')
  const customerStart = inspectionStart + 3
  const hasCustomerInspection = notes < 0 || notes > customerStart

  return {
    date: colOf('送货日期'), factory: colOf('加工厂名称', '加工厂'), ptype: colOf('加工类型'), customer: colOf('客户'),
    delivery_no: colOf('送货单号'), item_no: colOf('货号'), product: colOf('产品名称'), qty, single,
    ir: inspectionStart, idf: inspectionStart + 1, iins: inspectionStart + 2,
    cdate: hasCustomerInspection ? customerStart : -1,
    cres: hasCustomerInspection ? customerStart + 1 : -1,
    cdef: hasCustomerInspection ? customerStart + 2 : -1,
    notes,
  }
}
