import { expect, it } from 'vitest'
import { shipmentPurchaseAmount } from './shipmentPurchase'

it('采购金额按送货重量计算，不按件数计算', () => {
  const item = { price: 12.0453, kg: 3.97, qty: 4000 }
  expect(shipmentPurchaseAmount(item)).toBeCloseTo(47.819841)
  expect(shipmentPurchaseAmount({ price: 35.34, kg: 2 })).toBeCloseTo(70.68)
})
it('缺少重量或价格时金额为零，合计使用同一规则', () => {
  expect(shipmentPurchaseAmount({ price: 12 })).toBe(0)
  expect(shipmentPurchaseAmount({ kg: 2 })).toBe(0)
  expect(shipmentPurchaseAmount({ price: 12, kg: 0 })).toBe(0)
  const rows = [{ price: 35.34, kg: 2 }, { price: 9.09, kg: 2 }]
  expect(rows.reduce((sum, row) => sum + shipmentPurchaseAmount(row), 0)).toBeCloseTo(88.86)
})
