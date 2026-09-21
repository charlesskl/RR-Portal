import { expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { buildDeliveryReport, parseDeliveryImport } from '../src/utils/deliveryStats'
import { createDeliveryWorkbook } from '../src/utils/deliveryWorkbook'
import { ORDER_DETAIL_FIELDS } from '../src/utils/orderLoading'

it.each(['hkd', 'hkd-tax', 'rmb-tax', 'hunan-rmb-tax'] as const)('颜色完整导出并可重新导入，不挤占其他列 (%s)', (mode) => {
  const color = '紫色\n2086C+1/64"LB702'
  const rows = buildDeliveryReport([{ id: '1', factory: 'f', product: '手提包大身工模', color, quantity: 1384, unit_price_cny_tax: 1.13, quote_labor_price: 2, expand: { factory: { name: '甲厂', craft: 'injection' } } }], '注塑部', () => '甲厂', mode)
  const wb = createDeliveryWorkbook(rows, '测试', true, false, mode, true)
  const restored = XLSX.read(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), { type: 'array' })
  const table = XLSX.utils.sheet_to_json<any[]>(restored.Sheets['交货延期统计表']!, { header: 1, defval: '' })
  const headers = table[1]!
  expect(headers.indexOf('颜色')).toBe(headers.indexOf('物料名称') + 1)
  expect(table[2]![headers.indexOf('颜色')]).toBe(color)
  expect(table[2]![headers.indexOf('数量')]).toBe(1384)
  expect(table[2]![headers.indexOf('订单总单数')]).toBe(1)
  expect(table[3]![headers.indexOf('订单总单数')]).toBe(1)
  expect(parseDeliveryImport(table, { '甲厂': 'f' }).payloads[0]).toMatchObject({ color, quantity: 1384 })
  expect(ORDER_DETAIL_FIELDS.split(',')).toContain('color')
})
it('旧模板无颜色列仍能导入', () => {
  expect(parseDeliveryImport([['加工厂', '物料名称', '数量'], ['甲厂', '物料', 2]], { '甲厂': 'f' }).payloads[0]).toMatchObject({ color: '', quantity: 2 })
})
