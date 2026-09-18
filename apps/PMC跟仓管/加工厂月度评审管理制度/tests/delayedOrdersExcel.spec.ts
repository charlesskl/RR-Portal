import { expect, it } from 'vitest'
import * as XLSX from 'xlsx-js-style'
import { buildDelayedSections } from '../src/utils/delayedOrders'
import { createDelayedOrdersWorkbook } from '../src/utils/delayedOrdersExcel'
import type { Order } from '../src/types/order'
it('Excel保留全部明细、小计、分部门工作表与样式，湖南显示含税工价', () => {
  const orders: Order[] = Array.from({ length: 101 }, (_, i) => ({ id: String(i), factory: 'f', product: '物料', order_no: String(i), quantity: 10, delay_days: 1, region: 'hunan', quote_labor_price: 2, unit_price_cny_tax: 1.13, expand: { factory: { name: '加工厂', craft: 'sewing' } } }))
  const sections = buildDelayedSections(orders, 'hunan', ['sewing', 'painting'], new Map([['f', 1.13]]))
  const wb = createDelayedOrdersWorkbook(sections, '湖南', '2026-09')
  expect(wb.SheetNames).toEqual(['车缝部'])
  const sheet = wb.Sheets['车缝部']!
  expect(sheet['!ref']).toBe('A1:T105')
  expect(sheet['H105'].v).toBe(1010)
  expect(sheet['M105'].v).toBe(101)
  expect(sheet['R4'].v).toBe(1.13)
  expect(sheet['Q3'].v).toContain('人民币含税')
  expect(sheet['D3'].s.fill.fgColor.rgb).toBe('FFFF00')
  expect(sheet['M4'].s.fill.fgColor.rgb).toBe('E2EFD9')
  expect(sheet['!merges']).toContainEqual({ s: { r: 3, c: 0 }, e: { r: 104, c: 0 } })
  const bytes = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  const loaded = XLSX.read(bytes, { type: 'buffer' })
  expect(loaded.Sheets['车缝部']!['H105'].v).toBe(1010)
})
