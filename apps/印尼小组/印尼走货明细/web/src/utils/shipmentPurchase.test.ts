import { expect, it } from 'vitest'
import { shipmentDeclarationPrice, shipmentPurchaseAmount } from './shipmentPurchase'

it('Excel 导入单价按申报单位计算；关联出库后恢复采购计价', () => {
  const item = { price: 12.0453, kg: 3.97, qty: 4000, material_snapshot: { id: 8 } }
  expect(shipmentPurchaseAmount(item)).toBeCloseTo(47.819841)
  expect(shipmentDeclarationPrice(item)).toBe(12.0453)
  const linked = { ...item, outbound_id: 3, price: .01 }
  expect(shipmentPurchaseAmount(linked)).toBe(40)
  expect(shipmentDeclarationPrice(linked)).toBeCloseTo(40 / 3.97, 10)
})
it('缺少采购数量不猜测为千克；零申报量保留真实金额且单价不产生无穷大', () => {
  expect(shipmentPurchaseAmount({ price: 12 })).toBe(0)
  expect(shipmentPurchaseAmount({ kg: 2 })).toBe(0)
  expect(shipmentPurchaseAmount({ price: 12, kg: 0 })).toBe(0)
  const rows = [{ price: 35.34, kg: 2, qty: 2 }, { price: 9.09, kg: 2, qty: 2 }]
  expect(rows.reduce((sum, row) => sum + shipmentPurchaseAmount(row), 0)).toBeCloseTo(88.86)
  const row = { price: 12, qty: 2, kg: 0 }
  expect(shipmentPurchaseAmount(row)).toBe(24)
  expect(shipmentDeclarationPrice(row)).toBe(0)
})

it('螺丝按采购数量计价，申报单价换算不提前舍入', () => {
  const row = { price: .00056, qty: 300000, kg: 87, outbound_id: 74 }
  expect(shipmentPurchaseAmount(row)).toBeCloseTo(168, 10)
  expect(shipmentDeclarationPrice(row)).toBeCloseTo(168 / 87, 12)
  expect(shipmentDeclarationPrice(row) * row.kg).toBeCloseTo(168, 10)
  expect(row.price).toBe(.00056)
})
it.each(['个', '米', '千克', '套', '吨'])('采购数量本身使用采购单位（%s），不再乘申报重量', purchase_unit => {
  const row = { purchase_unit, price: 2.5, qty: 10, kg: 3 }
  expect(shipmentPurchaseAmount(row)).toBe(25)
  expect(shipmentDeclarationPrice(row) * row.kg).toBe(25)
})
it('分批和部分出库按本次数量计价，合并前后总额相同', () => {
  const rows = [{ price: .00056, qty: 200000, kg: 58 }, { price: .00056, qty: 100000, kg: 29 }]
  expect(shipmentPurchaseAmount(rows[1])).toBeCloseTo(56, 10)
  expect(rows.reduce((total, row) => total + shipmentPurchaseAmount(row), 0)).toBeCloseTo(168, 10)
})
