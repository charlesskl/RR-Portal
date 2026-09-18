import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { reactive } from 'vue'
const state = vi.hoisted(() => ({ orders: null as any, factories: null as any, route: null as any }))
vi.mock('../src/stores/orders', () => ({ useOrdersStore: () => state.orders }))
vi.mock('../src/stores/factories', () => ({ useFactoriesStore: () => state.factories }))
vi.mock('../src/stores/auth', () => ({ useAuthStore: () => ({ role: 'admin', userId: 'admin' }) }))
vi.mock('../src/components/AppLayout.vue', () => ({ default: { template: '<main><slot /></main>' } }))
vi.mock('vue-router', () => ({ useRoute: () => state.route, RouterLink: { template: '<a><slot /></a>' } }))
import DelayedOrdersView from '../src/views/DelayedOrdersView.vue'
beforeEach(() => {
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
})
