import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import * as XLSX from 'xlsx'
import { parseScheduleWorkbook, scheduleDate } from './scheduleImport'
import { importEngineeringFile } from './engineeringImport'
import { matchingLineSchedules } from './purchaseScheduleLink'
import { purchaseItemCodes } from './purchaseCustoms'

const header = ['来单日期\nOrder Received Date', '客名\nCustomer name', 'PO客人', '客PO', '订单PO.NO（合同）',
  '货号\n(Item number)', '产品名称\nProduct nume', '数量\nQuantity total', '总箱数', '计划PO出货期', '计划验货期', '单价USD$']
const row = ['2026/6/24周三', 'Spin Master', 'DOM USMS', '4500707639-230', '4500708516-10',
  '94704/1099803/6077834', '汪汪队组合', 1470, 245, '2026-11-24', '2026-11-17', 2.6867]
function workbook() {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, row,
    [null, null, null, null, null, 'DOM US/FOB Walmart US 单需要RFID'],
  ]), '接单总排期')
  for (const name of ['ITEM', '已出货', '取消单']) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, row]), name)
  return wb
}

describe('Spin Master full product code', () => {
  it('maps master schedule fields without duplicate copies or footer notes', () => {
    const result = parseScheduleWorkbook(workbook(), XLSX.utils)
    expect(result.customer).toBe('Spin Master')
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({
      customer: 'Spin Master', source: 'Spin Master', code: '94704/1099803/6077834',
      orderNo: '4500708516-10', customerPO: '4500707639-230', endCustomer: 'DOM USMS',
      qty: 1470, cartons: 245, orderDate: '2026-06-24', eta: '2026-11-24', unitPrice: 2.6867,
    })
    expect(() => parseScheduleWorkbook(workbook(), XLSX.utils, 'TOMY')).toThrow('客户不一致')
  })
  it('preserves existing TOMY KIK and RRM mapping', () => {
    const wb = XLSX.utils.book_new()
    for (const name of ['KIK总排期', 'RRM总排期']) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['货号', '数量', 'TOMY PO', 'CUSTOMER PO', '接单期', 'PO走货期', '第三客户'],
      ['47712A', 100, 'MA', 'CUSTOMER-1', 46200, 46201, 'TOMY AU'],
    ]), name)
    const result = parseScheduleWorkbook(wb, XLSX.utils)
    expect(result.customer).toBe('TOMY')
    expect(result.rows.map(r => r.source)).toEqual(['KIK', 'RRM'])
    expect(result.rows[0]).toMatchObject({ code: '47712A', orderNo: 'MA', customerPO: 'CUSTOMER-1', endCustomer: 'TOMY AU' })
    expect(result.rows[0].orderDate).toBe(scheduleDate(46200))
  })
  it('keeps zero cancellations and rejects invalid numeric quantities', () => {
    const wb = workbook()
    wb.Sheets['接单总排期'].H2.v = 0
    expect(parseScheduleWorkbook(wb, XLSX.utils).rows[0].qty).toBe(0)
    wb.Sheets['接单总排期'].H2.v = 'unknown'
    expect(() => parseScheduleWorkbook(wb, XLSX.utils)).toThrow('不是有效数字')
  })
  it('matches the complete product identifier, never its family prefix', () => {
    const code = '94704/1099803/6077834'
    const full = { code, orderNo: 'PO1' }
    expect(matchingLineSchedules({ product_code: code }, [full, { code: '94704', orderNo: 'PO2' }])).toEqual([full])
    expect(purchaseItemCodes(code, ['94704', code])).toEqual([code])
    expect(purchaseItemCodes(code + ' / 47712A', [code, '47712A'])).toEqual([code, '47712A'])
  })
  it('prefers full external header over the short molding header', async () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['客户名称', ': SPIN MASTER'], ['产品编号', ': 97282'], ['产品名称', ': 10寸阿奇'],
      ['工模编号', '工模名称', '物料名称', '用料名称'], ['M1', '纽扣', null, 'ABS'], [null, null, '纽扣'],
    ]), '排模表')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['客户名称', ': Spin Master'], ['产品编号', ': 97282/1099235/6077462'], ['产品名称', ': 10寸阿奇（24PK/箱）'],
      ['类别', '物料名称', '用量'], ['彩盒', '阿奇盒', 1],
    ]), '外购清单')
    const bytes = XLSX.write(wb, { type: 'array', bookType: 'xls' })
    const result = await importEngineeringFile({ arrayBuffer: async () => bytes } as File)
    expect(result).toMatchObject({ code: '97282/1099235/6077462', customer: 'Spin Master', name: '10寸阿奇（24PK/箱）' })
    expect(result.materials).toHaveLength(1)
  })
  it.runIf(process.env.SPIN_SCHEDULE_FILE)('reads the supplied Spin Master schedule', () => {
    const wb = XLSX.read(readFileSync(process.env.SPIN_SCHEDULE_FILE!), { type: 'buffer', cellDates: false })
    const result = parseScheduleWorkbook(wb, XLSX.utils)
    expect(result.rows).toHaveLength(161)
    expect(result.rows.every(r => r.customer === 'Spin Master' && r.code.includes('/'))).toBe(true)
    expect(result.rows.some(r => r.code === '97282/1099235/6077462')).toBe(true)
    expect(result.rows[0]).toMatchObject({ code: '31771/1098959/6077240', qty: 1488, eta: '2026-09-10' })
  })
  it.runIf(process.env.SPIN_ENGINEERING_FILE)('reads the supplied 24PK engineering data using the full SKU', async () => {
    const bytes = readFileSync(process.env.SPIN_ENGINEERING_FILE!)
    const result = await importEngineeringFile({ arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } as File)
    expect(result.code).toBe('97282/1099235/6077462')
    expect(result.customer).toBe('Spin Master')
    expect(result.materials.length).toBeGreaterThan(0)
    expect(result.moldings).toHaveLength(1)
  })
})
