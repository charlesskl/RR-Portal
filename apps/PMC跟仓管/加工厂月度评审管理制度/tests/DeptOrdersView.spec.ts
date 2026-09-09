import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { reactive } from 'vue'
import type { Order } from '../src/types/order'

const state = vi.hoisted(() => ({ orders: null as any, factories: null as any, route: null as any, auth: null as any, sdkAuth: null as any, exportExcel: vi.fn(), beforeRouteUpdate: vi.fn(), beforeRouteLeave: vi.fn() }))
vi.mock('../src/stores/orders', () => ({ useOrdersStore: () => state.orders }))
vi.mock('../src/stores/factories', () => ({ useFactoriesStore: () => state.factories }))
vi.mock('../src/stores/auth', () => ({ useAuthStore: () => state.auth }))
vi.mock('../src/pb', () => ({ pb: { get authStore() { return state.sdkAuth } } }))
vi.mock('../src/utils/pdfDeliveryImport', () => ({ readDeliveryPdfAsAoa: vi.fn() }))
vi.mock('../src/utils/deliveryStats', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/utils/deliveryStats')>(),
  exportDeliveryExcel: state.exportExcel,
}))
vi.mock('vue-router', () => ({
  useRoute: () => state.route,
  RouterLink: { template: '<a><slot /></a>' },
  onBeforeRouteLeave: state.beforeRouteLeave,
  onBeforeRouteUpdate: state.beforeRouteUpdate,
}))
vi.mock('../src/components/AppLayout.vue', () => ({ default: { template: '<main><slot /></main>' } }))
import DeptOrdersView from '../src/views/DeptOrdersView.vue'

let wrapper: VueWrapper | undefined
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('localStorage', { getItem: vi.fn().mockReturnValue(null), setItem: vi.fn() })
  state.route = reactive({ params: { craft: 'injection' }, query: { region: 'dongguan' } })
  state.auth = reactive({ role: 'admin', userId: 'admin' })
  state.sdkAuth = reactive({ record: { id: 'admin' }, token: 'test-token' })
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
    remove: vi.fn(async (id: string) => {
      state.orders.items = state.orders.items.filter((order: Order) => order.id !== id)
      return true
    }),
  })
  state.factories = reactive({ items: [{ id: 'factory-1', name: '工厂A', craft: 'injection', region: 'dongguan', tax_point: 1.11 }], fetchAll: vi.fn() })
  state.exportExcel.mockResolvedValue(undefined)
})
afterEach(() => { wrapper?.unmount(); vi.unstubAllGlobals() })

function button(text: string) {
  return wrapper!.findAll('button').find((item) => item.text() === text)!
}

function selectOrder(product: string) {
  return wrapper!.find(`[aria-label="选择订单 ${product}"]`)
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

describe('factory filters and bulk order deletion', () => {
  it('uses the order management region for factory choices and exports the complete factory/date/search intersection', async () => {
    // Factory B is based in Hunan, but these orders are managed in Dongguan.
    state.factories.items.push(
      { id: 'factory-2', name: '工厂B', craft: 'injection', region: 'hunan', tax_point: 1.11 },
      { id: 'factory-3', name: '喷油工厂', craft: 'painting', region: 'dongguan', tax_point: 1.11 },
      { id: 'factory-4', name: '湖南订单工厂', craft: 'injection', region: 'dongguan', tax_point: 1.11 },
      { id: 'factory-unused', name: '没有订单工厂', craft: 'injection', region: 'dongguan', tax_point: 1.11 },
    )
    const template = state.orders.items[0]
    const extraOrders = Array.from({ length: 125 }, (_, index) => ({
      ...template, id: `factory2-${index}`, factory: 'factory-2', product: `筛选物料-${index}`, order_date: '2026-08-01',
      expand: { factory: { name: '工厂B', craft: 'injection', region: 'hunan' } },
    }))
    state.orders.items.push(
      ...extraOrders,
      { ...extraOrders[0], id: 'factory2-july', order_date: '2026-07-01' },
      { ...extraOrders[0], id: 'factory2-other-product', product: '另一种物料' },
      { ...template, id: 'factory1-matching-product', product: '筛选物料-其他工厂', order_date: '2026-08-01' },
      { ...template, id: 'wrong-craft', factory: 'factory-3', expand: { factory: { name: '喷油工厂', craft: 'painting', region: 'dongguan' } } },
      { ...template, id: 'wrong-order-region', factory: 'factory-4', region: 'hunan', expand: { factory: { name: '湖南订单工厂', craft: 'injection', region: 'dongguan' } } },
    )
    wrapper = mount(DeptOrdersView)
    await flushPromises()
    const filter = wrapper.find('[aria-label="筛选加工厂"]')
    expect(filter.findAll('option').map((option) => option.attributes('value'))).toEqual(['', 'factory-1', 'factory-2'])
    await button('下一页').trigger('click')
    await filter.setValue('factory-2')
    expect(wrapper.find('.pagination').text()).toContain('第 1–100 条 / 共 127 条')
    await wrapper.find('[aria-label="下单日期筛选方式"]').setValue('month')
    await wrapper.find('[aria-label="选择月份"]').setValue('2026-08')
    await wrapper.find('.search-box').setValue('筛选物料')
    expect(wrapper.find('.pagination').text()).toContain('共 125 条')
    expect(wrapper.findAll('.report .order-select')).toHaveLength(100)
    await button('导出 Excel').trigger('click')
    await flushPromises()
    const details = state.exportExcel.mock.calls[0]![0].filter((row: any) => row.kind === 'detail')
    expect(details).toHaveLength(125)
    expect(details.map((row: any) => row.id)).toEqual(extraOrders.map((order) => order.id))
  })

  it('selects only page details, retains cross-page selection and supports all filtered records or clearing', async () => {
    wrapper = mount(DeptOrdersView)
    await flushPromises()
    expect(wrapper.find('.bulk-delete').attributes('disabled')).toBeDefined()
    await wrapper.find('[aria-label="选择本页订单"]').setValue(true)
    expect(wrapper.findAll('.report .order-select')).toHaveLength(100)
    expect(wrapper.findAll('.report .order-select').every((checkbox) => (checkbox.element as HTMLInputElement).checked)).toBe(true)
    expect(wrapper.find('.bulk-delete').text()).toBe('批量删除（100）')
    await button('下一页').trigger('click')
    expect(wrapper.findAll('.report .order-select').every((checkbox) => !(checkbox.element as HTMLInputElement).checked)).toBe(true)
    await selectOrder('物料-100').setValue(true)
    expect(wrapper.find('.bulk-delete').text()).toBe('批量删除（101）')
    await button('上一页').trigger('click')
    expect((wrapper.find('[aria-label="选择本页订单"]').element as HTMLInputElement).checked).toBe(true)
    await button('选择全部筛选结果（205 条）').trigger('click')
    expect(wrapper.find('.bulk-delete').text()).toBe('批量删除（205）')
    await button('下一页').trigger('click')
    await button('下一页').trigger('click')
    expect(wrapper.findAll('.report .order-select')).toHaveLength(5)
    expect(wrapper.findAll('.report tr.subtotal .order-select')).toHaveLength(0)
    expect((wrapper.find('[aria-label="选择本页订单"]').element as HTMLInputElement).checked).toBe(true)
    await button('清空选择').trigger('click')
    expect(wrapper.find('.bulk-delete').text()).toBe('批量删除')
    expect(wrapper.findAll('.report .order-select').some((checkbox) => (checkbox.element as HTMLInputElement).checked)).toBe(false)
    await wrapper.find('[aria-label="选择本页订单"]').setValue(true)
    expect(wrapper.find('.bulk-delete').text()).toBe('批量删除（5）')
  })

  it.each(['factory', 'search', 'date'] as const)('clears selection when the %s filter changes', async (filter) => {
    wrapper = mount(DeptOrdersView)
    await flushPromises()
    await selectOrder('物料-0').setValue(true)
    if (filter === 'factory') await wrapper.find('[aria-label="筛选加工厂"]').setValue('factory-1')
    if (filter === 'search') await wrapper.find('.search-box').setValue('物料-0')
    if (filter === 'date') await wrapper.find('[aria-label="下单日期筛选方式"]').setValue('month')
    expect(wrapper.find('.bulk-delete').text()).toBe('批量删除')
    expect(wrapper.find('.bulk-delete').attributes('disabled')).toBeDefined()
    expect(wrapper.findAll('.report .order-select').some((checkbox) => (checkbox.element as HTMLInputElement).checked)).toBe(false)
  })

  it('does not delete or refresh when the user cancels the irreversible-deletion confirmation', async () => {
    const confirm = vi.fn().mockReturnValue(false)
    vi.stubGlobal('confirm', confirm)
    wrapper = mount(DeptOrdersView)
    await flushPromises()
    await selectOrder('物料-0').setValue(true)
    await selectOrder('物料-1').setValue(true)
    await wrapper.find('.bulk-delete').trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('2'))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('不可恢复'))
    expect(state.orders.remove).not.toHaveBeenCalled()
    expect(state.orders.fetchForScope).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.bulk-delete').text()).toBe('批量删除（2）')
  })

  it('deletes only selected IDs, retains failed selections and drafts, and retries only the failed records', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))
    const remove = state.orders.remove.getMockImplementation()!
    state.orders.remove.mockImplementationOnce(remove).mockRejectedValueOnce(new Error('临时网络失败'))
    wrapper = mount(DeptOrdersView)
    await flushPromises()
    const inputs = wrapper.findAll('.report .text-inp')
    await inputs[0]!.setValue('已删除订单的草稿')
    await inputs[1]!.setValue('失败订单的草稿')
    await selectOrder('物料-0').setValue(true)
    await selectOrder('物料-1').setValue(true)
    // A real forced reload clears the previous store snapshot before its
    // asynchronous response arrives. Failed selections must survive this gap.
    let finishRefresh!: () => void
    state.orders.fetchForScope.mockImplementationOnce(async () => {
      const remaining = [...state.orders.items]
      state.orders.loading = true
      state.orders.items = []
      await new Promise<void>((resolve) => { finishRefresh = resolve })
      state.orders.items = remaining
      state.orders.loading = false
    })
    await wrapper.find('.bulk-delete').trigger('click')
    await flushPromises()
    expect(state.orders.items).toHaveLength(0)
    finishRefresh()
    await flushPromises()
    expect(state.orders.remove.mock.calls.map((call: any[]) => call[0])).toEqual(['order-0', 'order-1'])
    expect(state.orders.items.some((order: Order) => order.id === 'order-0')).toBe(false)
    expect(state.orders.items.some((order: Order) => order.id === 'order-2')).toBe(true)
    expect(wrapper.find('.bulk-delete').text()).toBe('批量删除（1）')
    expect(wrapper.find('.save-all').text()).toBe('全部保存（1）')
    expect((selectOrder('物料-1').element as HTMLInputElement).checked).toBe(true)
    expect((wrapper.find('.report .text-inp').element as HTMLInputElement).value).toBe('失败订单的草稿')
    expect(wrapper.text()).toMatch(/失败.*1/)
    await wrapper.find('.bulk-delete').trigger('click')
    await flushPromises()
    expect(state.orders.remove.mock.calls.map((call: any[]) => call[0])).toEqual(['order-0', 'order-1', 'order-1'])
    expect(wrapper.find('.bulk-delete').text()).toBe('批量删除')
    expect(wrapper.find('.save-all').text()).toBe('全部保存')
    expect(state.orders.items).toHaveLength(203)
  })

  it('shows the completed delete count when refreshing afterward fails and does not reselect deleted records', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))
    wrapper = mount(DeptOrdersView)
    await flushPromises()
    await selectOrder('物料-0').setValue(true)
    state.orders.fetchForScope.mockRejectedValueOnce(new Error('刷新失败'))
    await wrapper.find('.bulk-delete').trigger('click')
    await flushPromises()
    expect(state.orders.remove).toHaveBeenCalledExactlyOnceWith('order-0')
    expect(wrapper.text()).toMatch(/已删除\s*1\s*条/)
    expect(wrapper.text()).toContain('刷新失败')
    expect(wrapper.find('.bulk-delete').text()).toBe('批量删除')
  })

  it('hides selection and deletion controls for a read-only account while leaving filter and export available', async () => {
    state.auth.role = 'quality_qc'
    wrapper = mount(DeptOrdersView)
    await flushPromises()
    expect(wrapper.find('[aria-label="筛选加工厂"]').exists()).toBe(true)
    expect(wrapper.findAll('.order-select')).toHaveLength(0)
    expect(wrapper.find('[aria-label="选择本页订单"]').exists()).toBe(false)
    expect(wrapper.find('.bulk-delete').exists()).toBe(false)
    expect(button('导出 Excel').attributes('disabled')).toBeUndefined()
    expect(state.orders.remove).not.toHaveBeenCalled()
  })

  it('prevents repeat deletion, saves, single deletes and navigation until an in-flight bulk delete completes', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))
    let finishDelete!: () => void
    state.orders.remove.mockImplementationOnce((id: string) => new Promise<boolean>((resolve) => {
      finishDelete = () => {
        state.orders.items = state.orders.items.filter((order: Order) => order.id !== id)
        resolve(true)
      }
    }))
    wrapper = mount(DeptOrdersView)
    await flushPromises()
    await selectOrder('物料-0').setValue(true)
    await wrapper.find('.bulk-delete').trigger('click')
    expect(wrapper.find('.bulk-delete').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.save-all').attributes('disabled')).toBeDefined()
    expect(button('保存').attributes('disabled')).toBeDefined()
    expect(button('删除').attributes('disabled')).toBeDefined()
    await wrapper.find('.bulk-delete').trigger('click')
    await wrapper.find('.save-all').trigger('click')
    await button('保存').trigger('click')
    await button('删除').trigger('click')
    expect(state.orders.remove).toHaveBeenCalledTimes(1)
    expect(state.orders.update).not.toHaveBeenCalled()
    expect(state.beforeRouteLeave.mock.calls[0]![0]()).toBe(false)
    expect(state.beforeRouteUpdate.mock.calls[0]![0]({ params: { craft: 'painting' }, query: { region: 'dongguan' } }, state.route)).toBe(false)
    finishDelete()
    await flushPromises()
    expect(state.beforeRouteLeave.mock.calls[0]![0]()).toBe(true)
    expect(wrapper.find('.save-all').attributes('disabled')).toBeUndefined()
    expect(button('删除').attributes('disabled')).toBeUndefined()
  })

  it('stops starting further deletions when the signed-in account changes during a batch', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))
    const finishRequests: Array<() => void> = []
    state.orders.remove.mockImplementation(() => new Promise<boolean>((resolve) => {
      finishRequests.push(() => resolve(true))
    }))
    wrapper = mount(DeptOrdersView)
    await flushPromises()
    for (let index = 0; index < 6; index++) await selectOrder(`物料-${index}`).setValue(true)
    await wrapper.find('.bulk-delete').trigger('click')
    expect(state.orders.remove.mock.calls.map((call: any[]) => call[0])).toEqual(['order-0', 'order-1', 'order-2'])
    state.auth.userId = 'another-admin'
    await flushPromises()
    const loadsAfterAccountChange = state.orders.fetchForScope.mock.calls.length
    for (const finish of finishRequests) finish()
    await flushPromises()
    expect(state.orders.remove).toHaveBeenCalledTimes(3)
    expect(state.orders.remove.mock.calls.some((call: any[]) => ['order-3', 'order-4', 'order-5'].includes(call[0]))).toBe(false)
    expect(state.orders.fetchForScope).toHaveBeenCalledTimes(loadsAfterAccountChange)
    expect(wrapper.find('.bulk-delete').text()).toBe('批量删除')
    expect(wrapper.find('.delete-result').exists()).toBe(false)
  })

  it.each(['record', 'token'] as const)('stops queued deletions when only the SDK %s changes before Pinia updates', async (changedField) => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))
    const finishRequests: Array<() => void> = []
    state.orders.remove.mockImplementation(() => new Promise<boolean>((resolve) => {
      finishRequests.push(() => resolve(true))
    }))
    wrapper = mount(DeptOrdersView)
    await flushPromises()
    for (let index = 0; index < 6; index++) await selectOrder(`物料-${index}`).setValue(true)
    await wrapper.find('.bulk-delete').trigger('click')
    expect(state.orders.remove.mock.calls.map((call: any[]) => call[0])).toEqual(['order-0', 'order-1', 'order-2'])
    if (changedField === 'record') state.sdkAuth.record = { id: 'another-admin' }
    else state.sdkAuth.token = 'another-token'
    await flushPromises()
    expect(state.auth.userId).toBe('admin')
    const loadsAfterSdkChange = state.orders.fetchForScope.mock.calls.length
    for (const finish of finishRequests) finish()
    await flushPromises()
    expect(state.orders.remove).toHaveBeenCalledTimes(3)
    expect(state.orders.remove.mock.calls.some((call: any[]) => ['order-3', 'order-4', 'order-5'].includes(call[0]))).toBe(false)
    expect(state.orders.fetchForScope).toHaveBeenCalledTimes(loadsAfterSdkChange)
    expect(wrapper.find('.delete-result').exists()).toBe(false)
  })
})
