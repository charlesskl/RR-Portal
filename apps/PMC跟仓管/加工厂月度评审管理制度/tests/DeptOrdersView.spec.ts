import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { reactive } from 'vue'
import type { Order } from '../src/types/order'

const state = vi.hoisted(() => ({ orders: null as any, factories: null as any, route: null as any, exportExcel: vi.fn(), beforeRouteUpdate: vi.fn() }))
vi.mock('../src/stores/orders', () => ({ useOrdersStore: () => state.orders }))
vi.mock('../src/stores/factories', () => ({ useFactoriesStore: () => state.factories }))
vi.mock('../src/stores/auth', () => ({ useAuthStore: () => ({ role: 'admin', userId: 'admin' }) }))
vi.mock('../src/utils/pdfDeliveryImport', () => ({ readDeliveryPdfAsAoa: vi.fn() }))
vi.mock('../src/utils/deliveryStats', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/utils/deliveryStats')>(),
  exportDeliveryExcel: state.exportExcel,
}))
vi.mock('vue-router', () => ({
  useRoute: () => state.route,
  RouterLink: { template: '<a><slot /></a>' },
  onBeforeRouteLeave: vi.fn(),
  onBeforeRouteUpdate: state.beforeRouteUpdate,
}))
vi.mock('../src/components/AppLayout.vue', () => ({ default: { template: '<main><slot /></main>' } }))
import DeptOrdersView from '../src/views/DeptOrdersView.vue'

let wrapper: VueWrapper | undefined
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('localStorage', { getItem: vi.fn().mockReturnValue(null), setItem: vi.fn() })
  state.route = reactive({ params: { craft: 'injection' }, query: { region: 'dongguan' } })
  const items: Order[] = Array.from({ length: 205 }, (_, index) => ({
    id: `order-${index}`, factory: 'factory-1', region: 'dongguan', product: `物料-${index}`,
    pmc: 'PMC', quantity: 10, unit_price: 1, unit_price_cny_tax: 1.11, exchange_rate: 1,
    order_date: index < 100 ? '2026-07-01' : '2026-08-01', delivery_date: '2026-09-01',
    expand: { factory: { name: '工厂A', craft: 'injection', region: 'dongguan' } },
  }))
  state.orders = reactive({
    items, loading: false, error: '', loadedCount: 205,
    fetchForScope: vi.fn().mockResolvedValue(undefined),
    update: vi.fn(async (id: string, data: Partial<Order>) => {
      const index = state.orders.items.findIndex((order: Order) => order.id === id)
      state.orders.items[index] = { ...state.orders.items[index], ...data }
    }),
  })
  state.factories = reactive({ items: [{ id: 'factory-1', name: '工厂A', craft: 'injection', region: 'dongguan', tax_point: 1.11 }], fetchAll: vi.fn() })
  state.exportExcel.mockResolvedValue(undefined)
})
afterEach(() => { wrapper?.unmount(); vi.unstubAllGlobals() })

function button(text: string) {
  return wrapper!.findAll('button').find((item) => item.text() === text)!
}

describe('department delivery table', () => {
  it('renders only one page, preserves edits across pages and filters, and saves hidden drafts', async () => {
    wrapper = mount(DeptOrdersView)
    await flushPromises()
    expect(state.orders.fetchForScope).toHaveBeenCalledTimes(1)
    expect(state.factories.fetchAll).toHaveBeenCalledTimes(1)
    expect(state.orders.fetchForScope).toHaveBeenCalledWith('injection', 'dongguan', { force: false })
    expect(wrapper.findAll('.report .text-inp')).toHaveLength(100)
    await wrapper.find('.report .text-inp').setValue('第一页修改')
    await button('下一页').trigger('click')
    await wrapper.find('.report .text-inp').setValue('第二页修改')
    await button('上一页').trigger('click')
    expect((wrapper.find('.report .text-inp').element as HTMLInputElement).value).toBe('第一页修改')
    await wrapper.find('.search-box').setValue('物料-204')
    expect(wrapper.findAll('.report .text-inp')).toHaveLength(1)
    await wrapper.find('.save-all').trigger('click')
    await flushPromises()
    expect(state.orders.update).toHaveBeenCalledTimes(2)
    expect(state.orders.update).toHaveBeenCalledWith('order-0', expect.objectContaining({ product: '第一页修改' }))
    expect(state.orders.update).toHaveBeenCalledWith('order-100', expect.objectContaining({ product: '第二页修改' }))
    expect(wrapper.find('.save-all').text()).toBe('全部保存')
    expect(state.orders.fetchForScope).toHaveBeenLastCalledWith('injection', 'dongguan', { force: true })
    expect(state.factories.fetchAll).toHaveBeenCalledTimes(2)
    await wrapper.find('.search-box').setValue('')
    expect((wrapper.find('.report .text-inp').element as HTMLInputElement).value).toBe('第一页修改')
  })

  it('resets pagination for page size and date filters and exports every matching record once', async () => {
    wrapper = mount(DeptOrdersView)
    await flushPromises()
    await button('下一页').trigger('click')
    await wrapper.find('[aria-label="每页订单数"]').setValue('50')
    expect(wrapper.findAll('.report .text-inp')).toHaveLength(50)
    expect(wrapper.find('.pagination').text()).toContain('第 1–50 条')
    await wrapper.find('[aria-label="下单日期筛选方式"]').setValue('month')
    await wrapper.find('[aria-label="选择月份"]').setValue('2026-08')
    expect(wrapper.find('.pagination').text()).toContain('共 105 条')
    let resolveExport!: () => void
    state.exportExcel.mockReturnValue(new Promise<void>((resolve) => { resolveExport = resolve }))
    await button('导出 Excel').trigger('click')
    expect(button('导出中…').attributes('disabled')).toBeDefined()
    await button('导出中…').trigger('click')
    expect(state.exportExcel).toHaveBeenCalledTimes(1)
    expect(state.exportExcel.mock.calls[0]![0].filter((row: any) => row.kind === 'detail')).toHaveLength(105)
    resolveExport()
    await flushPromises()
    expect(button('导出 Excel').attributes('disabled')).toBeUndefined()
  })

  it('keeps a newer edit made while an earlier save is in flight', async () => {
    wrapper = mount(DeptOrdersView)
    await flushPromises()
    await wrapper.find('.report .text-inp').setValue('提交版本')
    let resolveSave!: () => void
    state.orders.update.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveSave = resolve }))
    await wrapper.find('.save-all').trigger('click')
    await wrapper.find('.report .text-inp').setValue('后续版本')
    resolveSave()
    await flushPromises()
    expect(wrapper.find('.save-all').text()).toBe('全部保存（1）')
    expect((wrapper.find('.report .text-inp').element as HTMLInputElement).value).toBe('后续版本')
  })

  it('waits for fresh factory data before enabling export and retains factory failures until retry succeeds', async () => {
    let rejectFactories!: (error: Error) => void
    state.factories.fetchAll.mockReturnValueOnce(new Promise<void>((_resolve, reject) => { rejectFactories = reject }))
    wrapper = mount(DeptOrdersView)
    await flushPromises()
    expect(button('导出 Excel').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('正在加载…已读取 205 条')
    await button('导出 Excel').trigger('click')
    expect(state.exportExcel).not.toHaveBeenCalled()
    rejectFactories(new Error('工厂税点资料读取失败'))
    await flushPromises()
    expect(wrapper.find('.load-error').text()).toContain('工厂税点资料读取失败')
    expect(button('导出 Excel').attributes('disabled')).toBeDefined()
    await button('重试').trigger('click')
    await flushPromises()
    expect(state.factories.fetchAll).toHaveBeenCalledTimes(2)
    expect(wrapper.find('.load-error').exists()).toBe(false)
    expect(button('导出 Excel').attributes('disabled')).toBeUndefined()
  })

  it('blocks a department change when unsaved edits are not discarded', async () => {
    wrapper = mount(DeptOrdersView)
    await flushPromises()
    await wrapper.find('.report .text-inp').setValue('未保存')
    const guard = state.beforeRouteUpdate.mock.calls[0]![0]
    const nextRoute = { params: { craft: 'painting' }, query: { region: 'dongguan' } }
    const confirm = vi.fn().mockReturnValue(false)
    vi.stubGlobal('confirm', confirm)
    expect(guard(nextRoute, state.route)).toBe(false)
    expect(wrapper.find('.save-all').text()).toBe('全部保存（1）')
    expect(guard({ ...state.route }, state.route)).toBe(true)
    expect(confirm).toHaveBeenCalledTimes(1)
    confirm.mockReturnValue(true)
    expect(guard(nextRoute, state.route)).toBe(true)
    await flushPromises()
    expect(wrapper.find('.save-all').text()).toBe('全部保存')
  })
})
