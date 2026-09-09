import { describe, expect, it } from 'vitest'
import { isPaperRope, shipmentGrossPerPc, shipmentWeightQuantity } from './shipmentWeight'

describe('走货单个毛重', () => {
  it('按行包装数量计算，修改数量或箱重后重新计算', () => {
    expect(shipmentGrossPerPc(12, '200')).toBe(0.06)
    expect(shipmentGrossPerPc(12, '400')).toBe(0.03)
    expect(shipmentGrossPerPc(20, '400')).toBe(0.05)
  })

  it.each([0, '', undefined, -1, '无', Infinity])('无效包装数量 %s 返回 0', quantity => {
    expect(shipmentGrossPerPc(12, quantity)).toBe(0)
  })

  it.each([0, '', undefined, -1, '无', Infinity])('无效箱重 %s 返回 0', weight => {
    expect(shipmentGrossPerPc(weight, '200')).toBe(0)
  })

  it('小件保留计算精度，避免总毛重累计舍入误差', () => {
    expect(shipmentGrossPerPc(8, '30000') * 30000).toBeCloseTo(8)
  })
})

describe('纸绳计重数量', () => {
  it('将 20000 米换算为 20 卷计算毛重和净重', () => {
    expect(isPaperRope('纸绳')).toBe(true)
    expect(shipmentWeightQuantity('白色纸绳', 20000)).toBe(20)
  })

  it('其它物料仍按原送货数量计重', () => {
    expect(shipmentWeightQuantity('螺丝', 20000)).toBe(20000)
  })
})
