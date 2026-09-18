import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { buildDelayedSections, delayedOrder } from '../src/utils/delayedOrders'
import DelayedOrderTable from '../src/components/DelayedOrderTable.vue'
import type { Order } from '../src/types/order'
const order = (id: string, changes: Partial<Order> = {}): Order => ({
  id, factory: 'f1', product: '玩具', region: 'dongguan', quantity: 10, order_no: id, delay_days: 8,
  delivery_date: '2026-09-10', status: 'placed', pmc: '张三',
  expand: { factory: { name: '工厂甲', craft: 'sewing', region: 'hunan' } }, ...changes,
})
describe('延期汇总', () => {
  it('仅以已保存的延迟时间至少1天统计，不按日期或标记推算', () => {
    for (const delay_days of [undefined, 0, -1, 0.5, NaN, Infinity]) {
      expect(delayedOrder(order('1', { delay_days, is_delayed: true, actual_delivery_date: '2026-09-18' }))).toBeNull()
    }
    expect(delayedOrder(order('1', { delay_days: 1, is_delayed: false }))?.delay_days).toBe(1)
    expect(delayedOrder(order('1', { delay_days: 3, actual_delivery_date: '2026-09-10' }))?.delay_days).toBe(3)
    expect(delayedOrder(order('1', { status: 'cancelled', delay_days: 5 }))).toBeNull()
  })
  it('按订单厂区和授权部门筛选，并对同组订单号去重汇总数量', () => {
    const source = [order('1', { order_no: 'A' }), order('2', { order_no: 'A' }), order('3', { region: 'hunan' }),
      order('4', { expand: { factory: { name: '注塑厂', craft: 'injection' } } })]
    const [section] = buildDelayedSections(source, 'dongguan', ['sewing'], new Map())
    expect(section!.count).toBe(2)
    expect(section!.rows.at(-1)).toMatchObject({ kind: 'subtotal', orderCount: 1, delayedCount: 1, delayAvg: '8' })
    expect(section!.quantities.at(-1)).toBe(20)
    expect(section!.pricingMode).toBe('rmb-tax')
  })
  it('湖南沿用正式环境人民币含税工价口径', () => {
    const [section] = buildDelayedSections([order('1', { region: 'hunan', unit_price_cny_tax: 1.13, quote_labor_price: 2 })], 'hunan', ['sewing'], new Map([['f1', 1.13]]))
    expect(section!.pricingMode).toBe('hunan-rmb-tax')
    const wrapper = mount(DelayedOrderTable, { props: { section: section!, regionName: '湖南' } })
    expect(wrapper.text()).toContain('核价工价(人民币含税)')
    expect(wrapper.text()).toContain('外发工价(人民币含税)')
    expect(wrapper.findAll('tbody tr')[0]!.text()).toContain('1.13')
    expect(wrapper.findAll('tbody tr')[0]!.text()).toContain('56.50%')
    wrapper.unmount()
  })
  it('分页保留完整小计并且表格各行占据20列', async () => {
    const source = Array.from({ length: 101 }, (_, i) => order(String(i)))
    const [section] = buildDelayedSections(source, 'dongguan', ['sewing'], new Map())
    const wrapper = mount(DelayedOrderTable, { props: { section: section!, regionName: '东莞' } })
    expect(wrapper.findAll('thead th')).toHaveLength(20)
    expect(wrapper.find('tbody td').attributes('rowspan')).toBe('100')
    await wrapper.findAll('button')[1]!.trigger('click')
    expect(wrapper.find('tbody td').attributes('rowspan')).toBe('2')
    const subtotal = wrapper.find('.subtotal')
    // 范围与 PMC 两列由前一行跨行占用。
    expect(subtotal.findAll('td').reduce((sum, cell) => sum + Number(cell.attributes('colspan') || 1), 2)).toBe(20)
    expect(subtotal.text()).toContain('1010')
    expect(subtotal.text()).toContain('101')
    wrapper.unmount()
  })
})
