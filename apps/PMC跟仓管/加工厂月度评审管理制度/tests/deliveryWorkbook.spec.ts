import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { buildDeliveryReport } from '../src/utils/deliveryStats'
import { createDeliveryWorkbook } from '../src/utils/deliveryWorkbook'
import type { DeliveryPricingMode } from '../src/utils/deliveryReportFormat'
import type { Order } from '../src/types/order'

const orders: Order[] = [
  {
    id: 'first', factory: 'factory', product: '材料甲', pmc: 'PMC甲',
    item_no: 'MA/RR/123', mold_no: 'MOLD-1', order_no: 'PO-1', quantity: 100,
    order_date: '2026-07-01', delivery_date: '2026-07-10', actual_delivery_date: '2026-07-12',
    is_delayed: true, delay_days: 2, quote_labor_price: 2, unit_price: 0.5289,
    unit_price_cny_tax: 1.13, exchange_rate: 0.87, notes: '保留备注',
  },
  {
    id: 'second', factory: 'factory', product: '材料乙', pmc: 'PMC甲',
    item_no: '456', order_no: 'PO-2', quantity: 200, quote_labor_price: 3, unit_price: 1.36,
  },
]

describe('delivery workbook', () => {
  it.each([false, true].flatMap((mold) => [false, true].flatMap((contract) =>
    (['hkd', 'rmb-tax', 'hkd-tax'] as DeliveryPricingMode[]).map((mode) => ({ mold, contract, mode })),
  )))('retains column alignment, amounts, and merges ($mold, $contract, $mode)', ({ mold, contract, mode }) => {
    const rows = buildDeliveryReport(orders, '东莞厂区 · 注塑部', () => '工厂甲', mode, () => 1.13)
    const workbook = createDeliveryWorkbook(rows, '交货延期统计', mold, contract, mode)
    // Read the actual XLSX bytes, so number formats and merges are checked after serialization.
    const restored = XLSX.read(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }), { type: 'array', cellNF: true, cellStyles: true })
    const sheet = restored.Sheets['交货延期统计表']!
    const data = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1, defval: '' })
    const headers = data[1]!
    const value = (row: number, header: string) => data[row]![headers.indexOf(header)]

    expect(data).toHaveLength(5)
    expect(data[0]![0]).toBe('交货延期统计')
    expect(value(2, '范围')).toBe('东莞厂区 · 注塑部')
    expect(value(2, '下单PMC')).toBe('PMC甲')
    expect(value(2, '加工厂')).toBe('工厂甲')
    expect(value(2, '货号')).toBe(contract ? '123' : 'MA/RR/123')
    if (contract) expect(value(2, '合同号')).toBe('MA/RR')
    expect(headers.includes('模具编号')).toBe(mold)
    if (mold) expect(value(2, '模具编号')).toBe('MOLD-1')
    expect(value(2, '订单号')).toBe('PO-1')
    expect(value(2, '数量')).toBe(100)
    expect(value(2, '延迟时间')).toBe(2)
    expect(value(2, '备注')).toBe('保留备注')
    expect(value(4, '订单总单数')).toBe(2)
    expect(value(4, '延期单数')).toBe(1)
    expect(value(4, '延期平均天数')).toBe('2')
    expect(value(4, '外发工价(人民币含税)')).toBe(1.13)
    expect(data[4]![3]).toBe('工厂甲-小计')
    expect(sheet['!merges']).toEqual([
      { s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } },
      { s: { r: 2, c: 0 }, e: { r: 4, c: 0 } },
      { s: { r: 2, c: 1 }, e: { r: 4, c: 1 } },
      { s: { r: 2, c: 2 }, e: { r: 3, c: 2 } },
      { s: { r: 4, c: 3 }, e: { r: 4, c: (mold ? 12 : 11) + (contract ? 1 : 0) } },
    ])
    expect(sheet['!cols']?.every((column) => column.wch! <= 32)).toBe(true)

    if (mode === 'rmb-tax') {
      expect(value(2, '外发工价(不含税RMB)')).toBe(1)
      expect(value(2, '税点')).toBe(1.13)
      expect(headers).not.toContain('换算汇率')
    } else {
      const priceColumn = headers.indexOf('外发工价(港币不含税$)')
      const firstCell = sheet[XLSX.utils.encode_cell({ r: 2, c: priceColumn })]!
      expect(firstCell.v).toBe(mode === 'hkd-tax' ? 1.1494 : 0.5289)
      expect(firstCell.z).toBe('0.000')
      expect(sheet[XLSX.utils.encode_cell({ r: 4, c: priceColumn })]!.z).toBe('0.000')
      expect(value(2, '换算汇率')).toBe(0.87)
      if (mode === 'hkd-tax') expect(value(2, '税点')).toBe(1.13)
      else expect(headers).not.toContain('税点')
    }
  })

  it('exports all 4,133 orders including the last row and subtotal', () => {
    const source = Array.from({ length: 4133 }, (_, index): Order => ({
      id: `id-${index}`, factory: 'factory', product: `物料-${index}`, pmc: 'PMC甲',
      item_no: `ITEM-${index}`, order_no: `PO-${index}`, unit_price: 0.529,
    }))
    const rows = buildDeliveryReport(source, '东莞厂区 · 注塑部', () => '工厂甲')
    const workbook = createDeliveryWorkbook(rows, '完整报表')
    const restored = XLSX.read(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }), { type: 'array' })
    const data = XLSX.utils.sheet_to_json<(string | number)[]>(restored.Sheets['交货延期统计表']!, { header: 1 })
    expect(data).toHaveLength(4133 + 3)
    expect(data[2]![3]).toBe('ITEM-0')
    expect(data[4134]![3]).toBe('ITEM-4132')
    expect(data[4135]![13]).toBe(4133)
    expect(data[4135]![18]).toBe(2186.357)
  })
})
