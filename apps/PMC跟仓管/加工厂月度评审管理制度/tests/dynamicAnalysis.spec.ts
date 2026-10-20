import { describe, expect, it } from 'vitest'
import { analyze, chinaToday } from '../src/utils/dynamicAnalysis'
const patrol = { id: 'p', factory: 'f', check_date: '2026-10-01', grade: 'B', correction: '整改隔离墙', planned_date: '2026-10-10' }
const order = { id: 'o', factory: 'f', product: '产品', status: 'producing' as const, delivery_date: '2026-10-10' }
describe('dynamic rules', () => {
  it('reports overdue evidence, severity and stable keys as time advances', () => {
    const a = analyze([patrol], [order], '2026-10-20').issues
    expect(a).toHaveLength(2); expect(a.every(i => i.level === 'high')).toBe(true)
    expect(a[0]?.evidence).toContain('10天')
    expect(analyze([patrol], [order], '2026-10-21').issues.map(i => i.key)).toEqual(a.map(i => i.key))
  })
  it('excludes due today, completed, cancelled, returned and delivered records', () => {
    expect(analyze([patrol], [order], '2026-10-10').issues).toEqual([])
    expect(analyze([{ ...patrol, completed_date: '2026-10-19' }], ['delivered','cancelled','returned'].map(status => ({ ...order, status } as any)), '2026-10-20').issues).toEqual([])
    expect(analyze([], [{ ...order, actual_delivery_date: '2026-10-19' }], '2026-10-20').issues).toEqual([])
  })
  it('compares only the latest two real visits, separately by factory; missing grade is not inferred', () => {
    const list = [{ ...patrol, id:'3', grade:'C', check_date:'2026-10-19', correction:'' }, { ...patrol, id:'1', grade:'D', check_date:'2026-10-01', correction:'' }, { ...patrol, id:'2', grade:'B', check_date:'2026-10-10', correction:'' }]
    expect(analyze(list, [], '2026-10-20').issues[0]?.evidence).toContain('评级B → 2026-10-19评级C')
    expect(analyze([...list, { ...list[0]!, id:'4', grade:'', check_date:'2026-10-20' }], [], '2026-10-20').issues).toEqual([])
    expect(analyze([{ ...list[0]!, factory:'other' },list[1]!], [], '2026-10-20').issues).toEqual([])
  })
  it('reports missing or invalid dates without false overdue alerts and ignores future patrols', () => {
    const r = analyze([{ ...patrol, planned_date:'2026-02-30' }, { ...patrol, check_date:'2026-12-01' }], [{ ...order, delivery_date:'' }], '2026-10-20')
    expect(r.issues).toEqual([]); expect(r.missingPatrolDates).toBe(1); expect(r.missingOrderDates).toBe(1)
    expect(chinaToday(new Date('2026-10-19T16:00:00Z'))).toBe('2026-10-20')
  })
})
