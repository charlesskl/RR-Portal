import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { reactive } from 'vue'
import type { Order } from '../src/types/order'

const state = vi.hoisted(() => ({ orders: null as any, factories: null as any, exportExcel: vi.fn() }))
vi.mock('../src/stores/orders', () => ({ useOrdersStore: () => state.orders }))
vi.mock('../src/stores/factories', () => ({ useFactoriesStore: () => state.factories }))
vi.mock('../src/stores/auth', () => ({ useAuthStore: () => ({ role: 'admin', userId: 'admin' }) }))
vi.mock('../src/components/AppLayout.vue', () => ({ default: { template: '<main><slot /></main>' } }))
vi.mock('vue-router', () => ({ RouterLink: { template: '<a><slot /></a>' } }))
vi.mock('../src/utils/deliveryStats', async (original) => ({
  ...await original<typeof import('../src/utils/deliveryStats')>(), exportDeliveryExcel: state.exportExcel,
}))
import OrdersView from '../src/views/OrdersView.vue'

function order(id: string): Order {
  return { id, factory: 'test-factory', product: `material-${id}`, region: 'dongguan',
    expand: { factory: { name: 'test factory', craft: 'injection', region: 'dongguan' } } }
}
let wrapper: VueWrapper | undefined
beforeEach(() => {
  vi.clearAllMocks()
  state.orders = reactive({
    summaryItems: [order('summary')], items: [], summaryLoading: false, summaryError: '',
    fetchSummary: vi.fn().mockResolvedValue(undefined), fetchAll: vi.fn(), fetchForScope: vi.fn(),
  })
  state.factories = { items: [], fetchAll: vi.fn() }
  state.exportExcel.mockResolvedValue(undefined)
})
afterEach(() => wrapper?.unmount())

describe('order hub loading and export', () => {
  it('loads card counts without fetching full order or factory details', async () => {
    wrapper = mount(OrdersView)
    await flushPromises()
    expect(state.orders.fetchSummary).toHaveBeenCalledWith({ force: false })
    expect(state.orders.fetchAll).not.toHaveBeenCalled()
    expect(state.factories.fetchAll).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('共 1 单')
    state.orders.summaryLoading = true
    await flushPromises()
    expect(wrapper.text()).toContain('正在加载订单数量')
    expect(wrapper.text()).not.toContain('共 0 单')
  })
  it('exports the complete requested snapshot and blocks duplicate clicks', async () => {
    let finish!: (rows: Order[]) => void
    state.orders.fetchAll.mockReturnValue(new Promise<Order[]>((resolve) => { finish = resolve }))
    wrapper = mount(OrdersView)
    await flushPromises()
    const button = wrapper.findAll('button').find((item) => item.text() === '导出全部')!
    await button.trigger('click')
    await button.trigger('click')
    expect(state.orders.fetchAll).toHaveBeenCalledTimes(1)
    expect(button.attributes('disabled')).toBeDefined()
    state.orders.items = [order('another-page')]
    finish([order('first'), order('last')])
    await flushPromises()
    const exported = state.exportExcel.mock.calls[0]?.[0]
    expect(exported.filter((row: any) => row.kind === 'detail').map((row: any) => row.id)).toEqual(['first', 'last'])
    expect(button.attributes('disabled')).toBeUndefined()
  })
  it('shows a retryable error instead of exporting partial data after a failed load', async () => {
    state.orders.fetchAll.mockRejectedValue(new Error('network unavailable'))
    wrapper = mount(OrdersView)
    await flushPromises()
    await wrapper.findAll('button').find((item) => item.text() === '导出全部')!.trigger('click')
    await flushPromises()
    expect(state.exportExcel).not.toHaveBeenCalled()
    expect(wrapper.find('[role="alert"]').text()).toContain('network unavailable')
    expect(wrapper.findAll('button').find((item) => item.text() === '导出全部')!.attributes('disabled')).toBeUndefined()
  })
})
