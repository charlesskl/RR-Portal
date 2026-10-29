import { expect, it } from 'vitest'
import { normalizeShipmentDeclarations } from './shipmentDeclaration'
import { shipmentDeclarationSaveError } from './shipmentDeclarationSaveValidation'
import { shipmentPurchaseAmount } from './shipmentPurchase'

it('拒绝大件数换算价落库 8 位后把原金额 39.96 改为 40，保留原行及草稿', () => {
  const item = { material_id: -1, material_snapshot: { unit_kg: 'PCE' }, qty: 10000000, kg: 333, price: .12 }
  const before = structuredClone(item)
  const normalized = normalizeShipmentDeclarations([item], new Map())
  const draft = structuredClone(normalized)
  expect(shipmentPurchaseAmount(normalized[0])).toBeCloseTo(39.96)
  expect(shipmentDeclarationSaveError(normalized)).toContain('39.96')
  expect(shipmentDeclarationSaveError(normalized)).toContain('40.00')
  expect(item).toEqual(before)
  expect(normalized).toEqual(draft)
})

it.each([
  [.000000004, 10000000, '0.04', '0.00'],
  [.000000005, 2000000, '0.01', '0.02'],
  [.999999995, 10000000, '9999999.95', '10000000.00'],
])('拒绝小单价及半入边界的金额改变：%s × %s', (price, kg, before, after) => {
  const error = shipmentDeclarationSaveError([{ material_snapshot: {}, price, kg }])
  expect(error).toContain(before)
  expect(error).toContain(after)
})

it.each([
  [0, 10000000], [undefined, 100], [.000003996, 0], [.000004, 10000000],
  [.123456789, 10], [1 / 30, 3], [.000000005, 1000000], [1e-12, .1],
])('允许零价、显式合规新价或超 8 位但两位金额未变：%s × %s', (price, kg) => {
  expect(shipmentDeclarationSaveError([{ material_snapshot: {}, price, kg }])).toBeNull()
})

it('不把关联采购来源当作按申报量计价的导入行，也不阻止普通采购行', () => {
  expect(shipmentDeclarationSaveError([
    { material_snapshot: {}, outbound_id: 1, price: .000003996, kg: 10000000, qty: 100 },
    { price: .000003996, kg: 10000000, qty: 100 },
  ])).toBeNull()
  expect(shipmentDeclarationSaveError([
    { price: 1, kg: 1 }, { material_snapshot: {}, price: .000003996, kg: 10000000 },
  ])).toContain('第 2 行')
})

it('无效数值返回错误而非在渲染时抛异常', () => {
  expect(shipmentDeclarationSaveError([{ material_snapshot: {}, price: Infinity, kg: 1 }])).toContain('无效')
  expect(shipmentDeclarationSaveError([{ material_snapshot: {}, price: 1, kg: NaN }])).toContain('无效')
})
