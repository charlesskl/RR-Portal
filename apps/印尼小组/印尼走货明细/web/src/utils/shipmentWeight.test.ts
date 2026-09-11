import { describe, expect, it } from 'vitest'
import {
  formatShipmentPackingLines, isPaperRope, parseShipmentPacking, shipmentCartonCount,
  shipmentGrossPerPc, shipmentKgWeight, shipmentWeightQuantity,
} from './shipmentWeight'

describe('每箱数量分段写法', () => {
  it('解析 1-2/3000 3/4000 为 3 箱、10000 件', () => {
    expect(parseShipmentPacking('1-2/3000 3/4000')).toEqual({
      mode: 'ranges', cartons: 3, totalQty: 10000, averageQty: 10000 / 3,
    })
    expect(shipmentCartonCount(10000, '1-2/3000 3/4000')).toBe(3)
    expect(formatShipmentPackingLines('1-2/3000 3/4000')).toBe('1-2/3000\n3/4000')
    expect(parseShipmentPacking('1-2/3000\n3/4000').totalQty).toBe(10000)
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
  it('按称重数量计算，修改称重数量或箱重后重新计算', () => {
    expect(shipmentGrossPerPc(12, '200')).toBe(0.06)
    expect(shipmentGrossPerPc(12, '400')).toBe(0.03)
    expect(shipmentGrossPerPc(20, '400')).toBe(0.05)
  })

  it('称重数量与每箱数量相互独立', () => {
    expect(shipmentGrossPerPc(9, 2500)).toBeCloseTo(9 / 2500)
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

  it('纸绳也直接使用录入的称重数量', () => {
    expect(shipmentGrossPerPc(7.9, 20)).toBeCloseTo(0.395)
    expect(shipmentGrossPerPc(7.9, 20) * shipmentWeightQuantity('纸绳', 20000)).toBeCloseTo(7.9)
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

describe('送货 KG 重量', () => {
  it('TNE/TON 按 1 吨 = 1000 千克换算', () => {
    expect(shipmentKgWeight('TNE', 2.31, 0)).toBe(2310)
    expect(shipmentKgWeight('ton', 0.5, 0)).toBe(500)
  })

  it('KGM 仍按单个净重和计重数量计算', () => {
    expect(shipmentKgWeight('KGM', 11000, 0.00021, '螺丝')).toBe(2.31)
    expect(shipmentKgWeight('KGM', 20000, 0.7, '纸绳')).toBe(14)
  })

  it('数量单位保持送货数量', () => {
    expect(shipmentKgWeight('PCE', 25, 0.2)).toBe(25)
  })
})
