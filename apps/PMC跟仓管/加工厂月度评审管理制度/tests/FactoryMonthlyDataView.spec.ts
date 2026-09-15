import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const state = vi.hoisted(() => ({
  getFactory: vi.fn(),
  replace: vi.fn(),
  getFullList: vi.fn(),
}))

vi.mock('../src/stores/factories', () => ({ useFactoriesStore: () => ({ get: state.getFactory }) }))
vi.mock('../src/pb', () => ({ pb: { collection: (name: string) => ({ getFullList: (options: unknown) => state.getFullList(name, options) }) } }))
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: 'factory-1', month: '2026-07' } }),
  useRouter: () => ({ replace: state.replace }),
  RouterLink: { template: '<a><slot /></a>' },
}))
vi.mock('../src/components/AppLayout.vue', () => ({ default: { template: '<main><slot /></main>' } }))

import FactoryMonthlyDataView from '../src/views/FactoryMonthlyDataView.vue'

beforeEach(() => {
  vi.clearAllMocks()
  state.getFactory.mockResolvedValue({ id: 'factory-1', name: '测试注塑厂', craft: 'injection', region: 'dongguan', status: 'active' })
  state.getFullList.mockImplementation((name: string) => {
    if (name === 'orders') return Promise.resolve([
      { id: 'order-july', factory: 'factory-1', order_no: 'PO-JULY', product: '七月物料', delivery_date: '2026-07-20', is_delayed: true, delay_days: 2 },
      { id: 'order-august', factory: 'factory-1', order_no: 'PO-AUG', product: '八月物料', delivery_date: '2026-08-20' },
    ])
    if (name === 'quality_inspections') return Promise.resolve([
      { id: 'quality-july', factory: 'factory-1', inspect_date: '2026-07-18', product: '七月验货', internal_result: 'PASS' },
      { id: 'quality-august', factory: 'factory-1', inspect_date: '2026-08-18', product: '八月验货', internal_result: 'FAIL' },
    ])
    return Promise.resolve([
      { id: '5s-july', factory: 'factory-1', check_date: '2026-07-15', check_type: '定期巡查', s_area: 10 },
      { id: '5s-august', factory: 'factory-1', check_date: '2026-08-15', check_type: '复审', s_area: 8 },
    ])
  })
})

describe('工厂月度评分数据明细', () => {
  it('按评分月份同时展示该工厂货期、验货和 5S 数据', async () => {
    const wrapper = mount(FactoryMonthlyDataView)
    await flushPromises()

    expect(wrapper.text()).toContain('测试注塑厂')
    expect(wrapper.text()).toContain('七月物料')
    expect(wrapper.text()).toContain('七月验货')
    expect(wrapper.text()).toContain('定期巡查')
    expect(wrapper.text()).not.toContain('八月物料')
    expect(state.getFullList).toHaveBeenCalledTimes(3)
    expect(state.getFullList.mock.calls.every((call) => call[1].filter === 'factory = "factory-1"')).toBe(true)

    await wrapper.find('input[type="month"]').setValue('2026-08')
    expect(wrapper.text()).toContain('八月物料')
    expect(wrapper.text()).toContain('八月验货')
    expect(wrapper.text()).toContain('复审')
    expect(wrapper.text()).not.toContain('七月物料')
    expect(state.replace).toHaveBeenCalledWith('/factories/factory-1/monthly-data/2026-08')
  })
})
