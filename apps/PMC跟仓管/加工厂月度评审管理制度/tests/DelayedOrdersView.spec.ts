import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { reactive } from 'vue'
const state = vi.hoisted(() => ({ orders: null as any, factories: null as any, route: null as any, download: vi.fn() }))
vi.mock('../src/stores/orders', () => ({ useOrdersStore: () => state.orders }))
vi.mock('../src/stores/factories', () => ({ useFactoriesStore: () => state.factories }))
vi.mock('../src/stores/auth', () => ({ useAuthStore: () => ({ role: 'admin', userId: 'admin' }) }))
vi.mock('../src/components/AppLayout.vue', () => ({ default: { template: '<main><slot /></main>' } }))
vi.mock('vue-router', () => ({ useRoute: () => state.route, RouterLink: { template: '<a><slot /></a>' } }))
vi.mock('../src/utils/delayedOrdersExcel', () => ({ downloadDelayedOrdersExcel: state.download }))
import DelayedOrdersView from '../src/views/DelayedOrdersView.vue'
beforeEach(() => {
  state.download.mockReset()
  state.route = reactive({ params: { region: 'dongguan' } })
  state.orders = { fetchForScope: vi.fn().mockResolvedValue([]) }
  state.factories = { items: [], fetchAll: vi.fn().mockResolvedValue(undefined) }
})
describe('厂区延期汇总页面', () => {
  it('按厂区读取所有部门，并显示空状态', async () => {
    const wrapper = mount(DelayedOrdersView)
    await flushPromises()
    expect(state.orders.fetchForScope).toHaveBeenCalledTimes(5)
    for (const call of state.orders.fetchForScope.mock.calls) expect(call[1]).toBe('dongguan')
    expect(wrapper.text()).toContain('东莞厂区 · 汇总延期订单')
    expect(wrapper.findAll('.empty')).toHaveLength(5)
    wrapper.unmount()
  })
  it('读取失败时不显示部分汇总，支持重试', async () => {
    state.orders.fetchForScope.mockRejectedValueOnce(new Error('网络错误'))
    const wrapper = mount(DelayedOrdersView)
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain('网络错误')
    expect(wrapper.findAll('.department-report')).toHaveLength(0)
    await wrapper.find('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    wrapper.unmount()
  })
  it('按下单月份及部门筛选并导出全部页，错误日期范围禁止导出', async () => {
    const records = Array.from({ length: 101 }, (_, i) => ({ id: `p${i}`, factory: 'f', product: '九月物料', order_no: `P${i}`, region: 'dongguan', order_date: '2026-09-18', delay_days: 1, expand: { factory: { name: '工厂甲', craft: 'painting' } } }))
    state.orders.fetchForScope.mockImplementation((craft: string) => Promise.resolve(craft === 'painting' ? [...records, { ...records[0], id: 'aug', order_date: '2026-08-31', product: '八月物料' }, { ...records[0], id: 'zero', delay_days: 0, product: '零天物料' }] : []))
    const wrapper = mount(DelayedOrdersView)
    await flushPromises()
    await wrapper.find('select[aria-label="下单日期筛选方式"]').setValue('month')
    await wrapper.find('input[type="month"]').setValue('2026-09')
    expect(wrapper.text()).not.toContain('八月物料')
    expect(wrapper.text()).not.toContain('零天物料')
    await wrapper.findAll('select').find((s) => s.text().includes('全部部门'))!.setValue('painting')
    const button = wrapper.findAll('button').find((b) => b.text() === '导出 Excel')!
    await button.trigger('click')
    await flushPromises()
    expect(state.download).toHaveBeenCalledTimes(1)
    const [sections, region, period] = state.download.mock.calls[0]!
    expect(sections).toHaveLength(1)
    expect(sections[0].count).toBe(101)
    expect(region).toBe('东莞')
    expect(period).toBe('2026-09')
    await wrapper.find('select[aria-label="下单日期筛选方式"]').setValue('range')
    await wrapper.find('input[aria-label="开始日期"]').setValue('2026-09-18')
    await wrapper.find('input[aria-label="结束日期"]').setValue('2026-09-18')
    expect(wrapper.text()).toContain('共 101 条延期明细')
    await wrapper.find('input[aria-label="开始日期"]').setValue('2026-09-19')
    expect(wrapper.text()).toContain('开始日期不能晚于结束日期')
    expect(button.attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

})
