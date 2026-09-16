import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { reactive } from 'vue'
import { LocalAuthStore } from 'pocketbase'
import type { Order } from '../src/types/order'

const state = vi.hoisted(() => ({ orders: null as any, factories: null as any, route: null as any, auth: null as any, sdkAuth: null as any, parseExcel: vi.fn(), exportExcel: vi.fn(), beforeRouteUpdate: vi.fn(), beforeRouteLeave: vi.fn() }))
vi.mock('../src/stores/orders', () => ({ useOrdersStore: () => state.orders }))
vi.mock('../src/stores/factories', () => ({ useFactoriesStore: () => state.factories }))
vi.mock('../src/stores/auth', () => ({ useAuthStore: () => state.auth }))
vi.mock('../src/pb', () => ({ pb: { get authStore() { return state.sdkAuth } } }))
vi.mock('../src/utils/deliveryExcelImport', () => ({ parseDeliveryExcelFiles: state.parseExcel, UNMATCHED_IMPORT_FACTORY_PREFIX: '__unmatched_factory__:' }))
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
  // Every SDK/storage read stays inside this test's in-memory map. Never use
  // the default PocketBase storage key or any real user's browser storage.
  const storage = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { storage.set(key, value) }),
    removeItem: vi.fn((key: string) => { storage.delete(key) }),
  })
  state.route = reactive({ params: { craft: 'injection' }, query: { region: 'dongguan' } })
  state.auth = reactive({ role: 'admin', userId: 'admin' })
  state.sdkAuth = new LocalAuthStore('dept-orders-component-test-auth')
  state.sdkAuth.save('test-token', { id: 'admin', role: 'admin', permissions: {} })
  const items: Order[] = Array.from({ length: 205 }, (_, index) => ({
    id: `order-${index}`, factory: 'factory-1', region: 'dongguan', product: `物料-${index}`,
    pmc: 'PMC', quantity: 10, unit_price: 1, unit_price_cny_tax: 1.11, exchange_rate: 1,
    order_date: index < 100 ? '2026-07-01' : '2026-08-01', delivery_date: '2026-09-01',
    expand: { factory: { name: '工厂A', craft: 'injection', region: 'dongguan' } },
  }))
  state.orders = reactive({
    create: vi.fn().mockResolvedValue({ id: 'new' }), items, loading: false, error: '', loadedCount: 205,
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


describe('Excel import requires an item number', () => {
  async function preview(itemNo: unknown) {
    const payload = { factory: 'factory-1', item_no: itemNo, product: '物料A', quantity: 10, order_date: '2026-09-01', delivery_date: '2026-09-20' }
    state.parseExcel.mockResolvedValue({ fileCount: 1, payloads: [{ ...payload, item_no: 'VALID-1' }, payload], sources: ['example.xlsx · Sheet1', 'example.xlsx · Sheet1'], failedRows: 0, unrecognizedFiles: [], readFailedFiles: [] })
    wrapper = mount(DeptOrdersView)
    await flushPromises()
    const input = wrapper.find('input[accept=".xlsx,.xls,.csv"]')
    Object.defineProperty(input.element, 'files', { configurable: true, value: [new File([''], 'example.xlsx')] })
    await input.trigger('change')
    await flushPromises()
  }
  it.each([undefined, null, '', '  \t  '])('blocks the whole batch with missing item number %j', async (itemNo) => {
    await preview(itemNo)
    expect(wrapper!.text()).toContain('未识别到货号')
    const confirm = button('确认导入 2 条')
    expect(confirm.attributes('disabled')).toBeDefined()
    await confirm.trigger('click')
    expect(state.orders.create).not.toHaveBeenCalled()
    await wrapper!.findAll('[aria-label="导入货号"]')[1]!.setValue('ITEM-2')
    expect(confirm.attributes('disabled')).toBeUndefined()
    await confirm.trigger('click')
    await flushPromises()
    expect(state.orders.create).toHaveBeenCalledTimes(2)
    expect(state.orders.create).toHaveBeenLastCalledWith(expect.objectContaining({ item_no: 'ITEM-2' }))
  })
  it('blocks a previously recognized number cleared in the preview', async () => {
    await preview('ITEM-2')
    await wrapper!.findAll('[aria-label="导入货号"]')[0]!.setValue('')
    expect(button('确认导入 2 条').attributes('disabled')).toBeDefined()
    expect(state.orders.create).not.toHaveBeenCalled()
  })
  it('allows removing the missing-number row and importing the valid row', async () => {
    await preview('')
    await wrapper!.findAll('button').filter(b => b.text() === '移除')[1]!.trigger('click')
    await button('确认导入 1 条').trigger('click')
    await flushPromises()
    expect(state.orders.create).toHaveBeenCalledTimes(1)
    expect(state.orders.create).toHaveBeenCalledWith(expect.objectContaining({ item_no: 'VALID-1' }))
  })
})
