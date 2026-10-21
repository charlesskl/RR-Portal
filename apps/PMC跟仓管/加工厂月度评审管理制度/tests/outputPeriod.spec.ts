import { describe, it, expect } from 'vitest'
import { outputPeriod, outputAmounts } from '../src/utils/outputPeriod'
describe('output periods', () => {
  it('resolves every quarter and a full year', () => {
    for (let q=1;q<=4;q++) expect(outputPeriod('quarter','2026-10','2025',q,'','')).toEqual({start:`2025-${String(q*3-2).padStart(2,'0')}`,end:`2025-${String(q*3).padStart(2,'0')}`})
    expect(outputPeriod('year','2026-10','2024',1,'','')).toEqual({start:'2024-01',end:'2024-12'})
  })
  it('accepts cross-year ranges and rejects missing/reversed dates', () => {
    expect(outputPeriod('custom','','',1,'2025-11','2026-02')).toEqual({start:'2025-11',end:'2026-02'})
    expect(()=>outputPeriod('custom','','',1,'2026-02','2025-11')).toThrow('不能晚于')
    expect(()=>outputPeriod('custom','','',1,'','2025-11')).toThrow('开始月份')
    expect(()=>outputPeriod('month','2026-13','',1,'','')).toThrow('有效月份')
    expect(()=>outputPeriod('year','','26',1,'','')).toThrow('四位年份')
  })
  it('includes both boundary months and excludes orders outside the period or with no month', () => {
    const orders = [
      {factory:'a',order_date:'2025-12-31',amount:100},
      {factory:'a',order_date:'2026-01-01',amount:.1},
      {factory:'a',order_date:'2026-03-31 23:59:59Z',amount:.2},
      {factory:'a',order_date:'2026-04-01',amount:100},
      {factory:'a',amount:100}, {factory:'b',order_date:'2026-02-12',amount:23.45},
    ]
    expect(outputAmounts(orders,{start:'2026-01',end:'2026-03'})).toEqual({a:.3,b:23.45})
  })
})
