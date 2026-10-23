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

export function scheduleCustomer(value?: string): string {
  const name = String(value || '').trim()
  if (/^(spin\s*master|spin)$/i.test(name)) return 'Spin Master'
  return /^tomy$/i.test(name) ? 'TOMY' : name
}

export interface ImportedScheduleRow {
  customer: string; source: string; code: string; orderNo: string; customerPO: string
  productName: string; country: string; endCustomer: string
  orderDate: string; qty: number; cartons: number; unitPrice: number; eta: string; inspDate: string
  version?: string; description?: string; notes?: string; siNo?: string
}

export function scheduleDate(value: unknown, date1904 = false): string {
  if (value == null || value === '') return ''
  const date = value instanceof Date ? value : typeof value === 'number'
    ? new Date(Date.UTC(1899, 11, 30) + (value + (date1904 ? 1462 : 0)) * 86400000) : null
  if (date) return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : ''
  const text = String(value).trim()
  const match = text.match(/^(\d{4})[年/.-](\d{1,2})[月/.-](\d{1,2})/)
  return match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : text
}

/** Only master schedule sheets; ITEM/shipped/cancelled copies are not additional orders. */
export function parseScheduleWorkbook(wb: any, utils: any, selectedCustomer = '') {
  const sheetNames: string[] = wb.SheetNames.filter((name: string) => /总排期$/.test(name.trim()))
  if (!sheetNames.length) throw new Error('未找到总排期工作表（支持 KIK总排期、RRM总排期、接单总排期）')
  const rows: ImportedScheduleRow[] = []
  const normalize = (value: unknown) => String(value ?? '').replace(/\s+/g, '').toLowerCase()
  for (const name of sheetNames) {
    const grid = scheduleSheetToRawGrid(wb.Sheets[name], utils)
    const headerIndex = grid.slice(0, 10).findIndex(row => {
      const text = row.map(normalize).join('|')
      return /货号|itemnumber|itemno/.test(text) && /数量|quantity|qty/.test(text)
    })
    if (headerIndex < 0) throw new Error(`${name}：未找到货号/数量表头`)
    const headers = grid[headerIndex].map(normalize)
    const column = (...keys: string[]) => {
      for (const key of keys) {
        const index = headers.findIndex(h => h.includes(normalize(key)))
        if (index >= 0) return index
      }
      return -1
    }
    const cols = {
      customer: column('客名', 'Customer name'),
      code: column('货号', 'Item number', 'ItemNo'),
      qty: column('数量', 'Quantity total', 'Qty'),
      orderNo: column('订单PO.NO', 'TOMYPO'),
      customerPO: column('客PO', 'CUSTOMERPO'),
      productName: column('产品名称', '品名', 'ProductName'),
      country: column('国家', 'Country'),
      endCustomer: column('第三客户', 'PO客人', '第三方客户', 'EndCustomer'),
      orderDate: column('接单期', '来单日期', 'Order Received Date'),
      cartons: column('总箱数', 'TotalCartons'),
      unitPrice: column('单价USD', '单价', 'UnitPrice'),
      eta: column('PO走货期', '计划PO出货期', '船期', 'ETA'),
      inspDate: column('计划验货期', '验货期', 'InspectionDate'),
      version: column('版本'), description: column('货物描述'), notes: column('备注'), siNo: column('SMTSI#'),
    }
    for (let index = headerIndex + 1; index < grid.length; index++) {
      const row = grid[index] || []
      const text = (field: keyof typeof cols) => String(row[cols[field]] ?? '').trim()
      // Slashes are part of the item identifier, not separators between products.
      const code = text('code').replace(/\s*\/\s*/g, '/')
      if (!code || /^(总计|合计|小计|total)$/i.test(code)) continue
      // Footnotes in the item-number column are not orders; keep genuine zero-quantity cancellations.
      if (!text('qty') && !text('orderNo') && !text('productName')) continue
      const customer = scheduleCustomer(text('customer') || selectedCustomer || 'TOMY')
      if (selectedCustomer && customer !== scheduleCustomer(selectedCustomer))
        throw new Error(`${name} 第 ${index + 1} 行客户为 ${customer}，与选择的客户不一致`)
      const numeric = (field: 'qty' | 'cartons' | 'unitPrice') => {
        const raw = text(field).replace(/,/g, '')
        const number = raw ? Number(raw) : 0
        if (!Number.isFinite(number)) throw new Error(`${name} 第 ${index + 1} 行 ${field} 不是有效数字`)
        return number
      }
      const date = (field: 'orderDate' | 'eta' | 'inspDate') => scheduleDate(row[cols[field]], !!wb.Workbook?.WBProps?.date1904)
      rows.push({
        customer, source: name.trim() === '接单总排期' ? customer : name.replace(/总排期\s*$/, '').trim(),
        code, orderNo: text('orderNo'), customerPO: text('customerPO'),
        productName: text('productName'), country: text('country'), endCustomer: text('endCustomer'),
        qty: numeric('qty'), cartons: numeric('cartons'), unitPrice: numeric('unitPrice'),
        orderDate: date('orderDate'), eta: date('eta'), inspDate: date('inspDate'),
        version: text('version'), description: text('description'), notes: text('notes'), siNo: text('siNo'),
      })
    }
  }
  if (!rows.length) throw new Error('未识别到排期明细')
  const customers = [...new Set(rows.map(row => row.customer))]
  if (customers.length !== 1) throw new Error('文件含多个客户，请按客户分别上传')
  return { rows, customer: customers[0], sheetNames }
}
