import { expect, it } from 'vitest'
import { receiptChargeRatio, shipmentChargeQuantity, shipmentDeclarationPrice, shipmentPurchaseAmount } from './shipmentPurchase'

it.each([
  { qty: 3667, kg: 502.379, paid: 3630, price: .227, amount: 824.01 },
  { qty: 15251, kg: 1250.582, paid: 15100, price: .3032, amount: 4578.32 },
])('免费备品不计费，实际走货数量重量及采购单价不变：$qty', ({ qty, kg, paid, price, amount }) => {
  const row = Object.freeze({ qty, kg, price, outbound_id: 99, purchase_charge_ratio: paid / qty })
  expect(shipmentChargeQuantity(row)).toBeCloseTo(paid, 10)
  expect(shipmentPurchaseAmount(row)).toBeCloseTo(amount, 10)
  expect(shipmentDeclarationPrice(row) * kg).toBeCloseTo(amount, 10)
  expect(row).toMatchObject({ qty, kg, price })
})
it('入库收费比例覆盖部分入库、纯备品、无入库及错误元数据', () => {
  expect(receiptChargeRatio({ received_qty: 100, spare_qty: 10 })).toBeCloseTo(100 / 110)
  expect(receiptChargeRatio({ received_qty: 0, spare_qty: 10 })).toBe(0)
  expect(receiptChargeRatio()).toBe(1)
  expect(receiptChargeRatio({ received_qty: 0, spare_qty: 0 })).toBe(1)
  expect(shipmentPurchaseAmount({ qty: 100, price: 3, purchase_charge_ratio: 0 })).toBe(0)
  expect(shipmentPurchaseAmount({ qty: 100, price: 3 })).toBe(300)
  for (const purchase_charge_ratio of [-1, 1.1, NaN, Infinity])
    expect(() => shipmentPurchaseAmount({ qty: 100, price: 3, purchase_charge_ratio })).toThrow('计费比例无效')
})
it('分批出库及跨柜部分分配只分摊一次费用，合计不超过收费数量', () => {
  const basis = { price: .3032, purchase_charge_ratio: 15100 / 15251 }
  const rows = [9000, 6000, 251].map(qty => ({ ...basis, qty }))
  expect(rows.reduce((s, r) => s + shipmentPurchaseAmount(r), 0)).toBeCloseTo(4578.32, 10)
  expect(rows.reduce((s, r) => s + r.qty, 0)).toBe(15251)
  const imported = { qty: 4000, kg: 3.97, price: 12, purchase_charge_ratio: .5, material_snapshot: { id: 8 } }
  expect(shipmentPurchaseAmount(imported)).toBeCloseTo(47.64)
})

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
