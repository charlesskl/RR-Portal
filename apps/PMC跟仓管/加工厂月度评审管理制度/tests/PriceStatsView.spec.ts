import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import * as XLSX from 'xlsx'

const state = vi.hoisted(() => ({ craft: 'painting', region: 'hunan', writeFile: vi.fn() }))
vi.mock('xlsx', async (importOriginal) => ({
  ...await importOriginal<typeof import('xlsx')>(), writeFile: state.writeFile,
}))
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { craft: state.craft }, query: { region: state.region } }),
  RouterLink: { template: '<a><slot /></a>' },
}))
vi.mock('../src/components/AppLayout.vue', () => ({ default: { template: '<main><slot /></main>' } }))
vi.mock('../src/stores/auth', () => ({ useAuthStore: () => ({ role: 'admin' }) }))
vi.mock('../src/utils/permissions', () => ({
  allowedRegions: () => ['hunan', 'dongguan', 'heyuan'], canEditOrders: () => true,
}))
vi.mock('../src/stores/factories', () => ({ useFactoriesStore: () => ({
  items: [{ id: 'factory-1', name: '测试工厂', craft: state.craft, tax_point: 0.03 }],
  fetchAll: vi.fn(),
}) }))
vi.mock('../src/stores/orders', () => ({ useOrdersStore: () => ({
  items: [
    { id: 'order-1', factory: 'factory-1', region: state.region, product: '配件甲',
      unit_price: 0.1, unit_price_cny_tax: 0.113, quote_labor_price: 0.2, exchange_rate: 1.13,
      expand: { factory: { name: '测试工厂', craft: state.craft, region: state.region } } },
    { id: 'order-2', factory: 'missing-factory', region: state.region, product: '配件乙',
      unit_price: 0.1, exchange_rate: 1.06,
      expand: { factory: { name: '订单税点工厂', craft: state.craft, region: state.region } } },
  ],
  fetchAll: vi.fn(),
}) }))

import PriceStatsView from '../src/views/PriceStatsView.vue'

describe('湖南单价统计税点', () => {
  beforeEach(() => { vi.clearAllMocks(); state.region = 'hunan' })

  it.each(['injection', 'painting', 'assembly', 'sewing', 'electronics'])('%s 页面及导出使用货期税点', async (craft) => {
    state.craft = craft
    const wrapper = mount(PriceStatsView)
    await flushPromises()
    const headers = wrapper.findAll('thead th').map((cell) => cell.text())
    expect(headers.filter((text) => text === '税点')).toHaveLength(1)
    expect(headers.some((text) => text.includes('扣税点'))).toBe(false)
    // 按配件匹配对应订单，避免分组排序和纵向合并影响断言。
    const factoryRow = wrapper.findAll('tbody tr').find((row) => row.text().includes('配件甲'))!
    const orderRow = wrapper.findAll('tbody tr').find((row) => row.text().includes('配件乙'))!
    expect(factoryRow.findAll('td').at(-3)!.text()).toBe('1.03')
    expect(orderRow.findAll('td').at(-3)!.text()).toBe('1.06')
    await wrapper.findAll('button').find((button) => button.text() === '导出 Excel')!.trigger('click')
    const workbook = state.writeFile.mock.calls[0][0]
    const data = XLSX.utils.sheet_to_json(workbook.Sheets['外发-工价表'], { header: 1 }) as unknown[][]
    const exportTaxIndex = data[2].indexOf('税点')
    expect(exportTaxIndex).toBeGreaterThan(-1)
    expect(data.find((row) => row.includes('配件甲'))![exportTaxIndex]).toBe(1.03)
    expect(data.find((row) => row.includes('配件乙'))![exportTaxIndex]).toBe(1.06)
    expect(data[2].some((text) => String(text).includes('扣税点'))).toBe(false)
    wrapper.unmount()
  })

  it.each(['dongguan', 'heyuan'])('%s 保留原扣税后单价列', async (region) => {
    state.region = region
    state.craft = 'painting'
    const wrapper = mount(PriceStatsView)
    await flushPromises()
    expect(wrapper.find('thead').text()).toContain('扣税点1.13后单价')
    expect(wrapper.findAll('thead th').filter((cell) => cell.text() === '税点')).toHaveLength(0)
    wrapper.unmount()
  })
})
