import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import QualityPatrolCompare from '../src/components/QualityPatrolCompare.vue'
const factories = [{ id: 'a', name: '甲厂' }, { id: 'b', name: '乙厂' }] as any
const records = [
  { id: '3', factory: 'a', check_date: '2026-10-16', grade: 'A', staff: 50, evaluation: '第三次' },
  { id: '1', factory: 'a', check_date: '2026-08-18', grade: 'C', staff: 30, evaluation: '第一次' },
  { id: '2', factory: 'a', check_date: '2026-09-18', grade: 'B', staff: 40, evaluation: '第二次', photos: ['x.jpg'] },
  { id: '4', factory: 'b', check_date: '2026-10-16', grade: 'D', staff: 20, evaluation: '其他工厂' },
] as any
const props = { records, factories, photoUrl: () => '/photo?token=protected', photoReady: true, photoError: '' }
describe('multi-visit comparison', () => {
  it('compares responsibilities, fee periods and completion prose without losing older visits', () => {
    const w = mount(QualityPatrolCompare, {props:{...props,records:[
      {id:'1',factory:'a',check_date:'2026-09-18',planned_date:'2026-10-01'},
      {id:'2',factory:'a',check_date:'2026-10-16',responsibility_scope:'责任人甲',responsible_supervisor:'主管乙',processing_fee_period:'1月-9月份',processing_fee:338,completion_details:'1:10/21完成\n2:10/26完成'},
    ] as any}})
    const row = (label:string) => w.findAll('tbody tr').find(r=>r.find('th').text()===label)!
    expect(row('责任范围').findAll('td').map(c=>c.text())).toEqual(['—','责任人甲'])
    expect(row('加工费统计期间').findAll('td').map(c=>c.text())).toEqual(['—','1月-9月份'])
    expect(row('整改完成说明（原文）').findAll('td')[1]!.text()).toBe('1:10/21完成\n2:10/26完成')
    expect(row('计划完成时间').findAll('td')[0]!.text()).toBe('2026-10-01')
    w.unmount()
  })
  it('compares three actual visits chronologically, highlights changes and isolates factories', async () => {
    const w = mount(QualityPatrolCompare, { props })
    expect(w.findAll('thead th').map(el => el.text())).toEqual(['巡查项目', '2026-08-18', '2026-09-18', '2026-10-16'])
    expect(w.find('tbody').text()).not.toContain('其他工厂')
    expect(w.findAll('tbody tr')[0]!.findAll('td').map(td => td.text())).toEqual(['30','40','50'])
    expect(w.findAll('tbody tr')[0]!.findAll('.changed')).toHaveLength(2)
    expect(w.find('img').attributes('src')).toContain('token=protected')
    await w.findAll('input[type=checkbox]')[1]!.setValue(false)
    expect(w.findAll('thead th')).toHaveLength(3)
    await w.find('select').setValue('b')
    expect(w.text()).toContain('不足两次')
    expect(w.find('table').exists()).toBe(false)
    w.unmount()
  })
  it('only lists factories with records and updates when records disappear', async () => {
    const w = mount(QualityPatrolCompare, { props: { ...props, factories: [...factories, { id: 'c', name: '无记录厂' }] as any } })
    expect(w.findAll('option').map(o => o.text())).toEqual(['甲厂', '乙厂'])
    await w.setProps({ records: records.filter((r: any) => r.factory === 'b') })
    expect(w.findAll('option').map(o => o.text())).toEqual(['乙厂'])
    expect((w.find('select').element as HTMLSelectElement).value).toBe('b')
    await w.setProps({ records: [] })
    expect(w.text()).toContain('暂无可对比')
    expect(w.find('table').exists()).toBe(false)
    w.unmount()
  })
  it('compares multiple factories and visits, preserving dates and isolating change highlighting', async () => {
    const w = mount(QualityPatrolCompare, { props })
    await w.findAll('.modes button')[1]!.trigger('click')
    await w.findAll('.factory-group > label input')[0]!.setValue(true)
    expect(w.find('table').exists()).toBe(false)
    await w.findAll('.factory-group > label input')[1]!.setValue(true)
    expect(w.findAll('thead th').map(t => t.text())).toEqual(['巡查项目', '甲厂2026-08-18', '甲厂2026-09-18', '甲厂2026-10-16', '乙厂2026-10-16'])
    const cells = w.findAll('tbody tr')[0]!.findAll('td')
    expect(cells.map(c => c.text())).toEqual(['30', '40', '50', '20'])
    expect(cells.map(c => c.classes().includes('changed'))).toEqual([false, true, true, false])
    await w.find('input[aria-label="甲厂 2026-09-18"]').setValue(false)
    expect(w.findAll('thead th')).toHaveLength(4)
    await w.findAll('.modes button')[0]!.trigger('click')
    expect(w.find('tbody').text()).not.toContain('其他工厂')
    await w.findAll('.modes button')[1]!.trigger('click')
    expect(w.findAll('thead th')).toHaveLength(4)
    await w.setProps({ factories: [factories[0]] })
    expect(w.find('table').exists()).toBe(false)
    expect(w.text()).not.toContain('乙厂')
    w.unmount()
  })
  it('requires a selected visit in each of two factories and protects photos in cross-factory mode', async () => {
    const w = mount(QualityPatrolCompare, { props: { ...props, photoReady: false } })
    await w.findAll('.modes button')[1]!.trigger('click')
    for (const input of w.findAll('.factory-group > label input')) await input.setValue(true)
    expect(w.find('table').exists()).toBe(true)
    expect(w.find('img').exists()).toBe(false)
    await w.find('input[aria-label="乙厂 2026-10-16"]').setValue(false)
    expect(w.find('table').exists()).toBe(false)
    await w.findAll('.factory-group .dates button')[1]!.trigger('click')
    expect(w.find('table').exists()).toBe(true)
    await w.findAll('.factory-group > label input')[1]!.setValue(false)
    expect(w.find('table').exists()).toBe(false)
    w.unmount()
  })
  it('does not load protected photos without a token', () => {
    const w = mount(QualityPatrolCompare, { props: { ...props, photoReady: false } })
    expect(w.find('img').exists()).toBe(false)
    expect(w.text()).toContain('照片暂不可用')
    w.unmount()
  })
})
