import { describe, it, expect } from 'vitest'
import { afterTax, ratioPct, buildPriceStatsRows } from '../src/utils/priceStats'

describe('afterTax', () => {
  it('外发单价 ÷ 1.13，保留4位小数', () => {
    expect(afterTax(0.58)).toBe(0.5133)
  })
  it('空值返回 null', () => {
    expect(afterTax(null)).toBeNull()
    expect(afterTax(undefined)).toBeNull()
  })
})

describe('ratioPct', () => {
  it('扣税点后单价 ÷ 核价 ×100，保留1位小数', () => {
    expect(ratioPct(0.58, 0.525)).toBe(97.8)
  })
  it('核价为 0/空 或外发为空 → null', () => {
    expect(ratioPct(0.58, 0)).toBeNull()
    expect(ratioPct(0.58, null)).toBeNull()
    expect(ratioPct(null, 0.5)).toBeNull()
  })
})

describe('buildPriceStatsRows', () => {
  const factoryName = (o: any) => o.expand?.factory?.name ?? ''
  const orders = [
    { workshop: '兴信A', process_category: '塑胶半成品', item_no: '9565', product: '松鼠',
      quote_labor_price: 0.595, supplier_price: 0.6, unit_price: 0.682, manager_rating: 0, notes: '',
      expand: { factory: { name: '俊豪塑胶' } } },
    { workshop: '兴信A', process_category: '塑胶半成品', item_no: '9548', product: '鸭妈妈',
      quote_labor_price: 0.525, supplier_price: 0.51, unit_price: 0.58, manager_rating: 0, notes: '',
      expand: { factory: { name: '俊豪塑胶' } } },
    { workshop: '兴信A', process_category: '塑胶半成品', item_no: '71172', product: '大脑',
      quote_labor_price: 0.703, supplier_price: 0.7, unit_price: 0.795, manager_rating: 0, notes: '',
      expand: { factory: { name: '鸿徽塑胶' } } },
  ] as any[]

  it('按 车间→加工厂→加工类别 排序', () => {
    const rows = buildPriceStatsRows(orders, factoryName)
    expect(rows.map((r) => r.factory)).toEqual(['俊豪塑胶', '俊豪塑胶', '鸿徽塑胶'])
  })

  it('车间合并跨 3 行（首行 span=3，其余=0）', () => {
    const rows = buildPriceStatsRows(orders, factoryName)
    expect(rows[0].workshopSpan).toBe(3)
    expect(rows[1].workshopSpan).toBe(0)
    expect(rows[2].workshopSpan).toBe(0)
  })

  it('加工厂在车间内分别合并（俊豪 2 行、鸿徽 1 行）', () => {
    const rows = buildPriceStatsRows(orders, factoryName)
    expect(rows[0].factorySpan).toBe(2)
    expect(rows[1].factorySpan).toBe(0)
    expect(rows[2].factorySpan).toBe(1)
  })

  it('带出计算列 after_tax / ratio_pct', () => {
    const rows = buildPriceStatsRows(orders, factoryName)
    const duck = rows.find((r) => r.product === '鸭妈妈')!
    expect(duck.after_tax).toBe(0.5133)
    expect(duck.ratio_pct).toBe(97.8)
  })
})
