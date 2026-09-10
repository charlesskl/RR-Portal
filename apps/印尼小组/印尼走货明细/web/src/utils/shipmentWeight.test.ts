import { describe, expect, it } from 'vitest'
import {
  isPaperRope, parseShipmentPacking, shipmentCartonCount, shipmentGrossPerPc, shipmentWeightQuantity,
} from './shipmentWeight'

describe('每箱数量分段写法', () => {
  it('解析 1-2/3000 3/4000 为 3 箱、10000 件', () => {
    expect(parseShipmentPacking('1-2/3000 3/4000')).toEqual({
      mode: 'ranges', cartons: 3, totalQty: 10000, averageQty: 10000 / 3,
    })
    expect(shipmentCartonCount(10000, '1-2/3000 3/4000')).toBe(3)
  })

  it('统一数量仍按送货数量计算箱数', () => {
    expect(shipmentCartonCount(10000, '3000')).toBe(4)
  })

  it('拒绝重叠箱号和非法格式', () => {
    expect(parseShipmentPacking('1-2/3000 2-3/4000').mode).toBe('invalid')
    expect(parseShipmentPacking('1-2:3000').mode).toBe('invalid')
  })
})

describe('走货单个毛重', () => {
  it('按行包装数量计算，修改数量或箱重后重新计算', () => {
    expect(shipmentGrossPerPc(12, '200')).toBe(0.06)
    expect(shipmentGrossPerPc(12, '400')).toBe(0.03)
    expect(shipmentGrossPerPc(20, '400')).toBe(0.05)
  })

  it('混合装箱时按平均每箱数量计算单个毛重', () => {
    expect(shipmentGrossPerPc(9, '1-2/3000 3/4000')).toBeCloseTo(9 / (10000 / 3))
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

  it('纸绳按每 1000 米一卷计算单个毛重', () => {
    expect(shipmentGrossPerPc(7.9, '20000', '纸绳')).toBeCloseTo(0.395)
    expect(shipmentGrossPerPc(7.9, '20000', '纸绳') * shipmentWeightQuantity('纸绳', 20000)).toBeCloseTo(7.9)
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
