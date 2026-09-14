import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import * as XLSX from 'xlsx'

const state = vi.hoisted(() => ({ writeFile: vi.fn() }))
vi.mock('xlsx', async (original) => ({ ...await original<typeof import('xlsx')>(), writeFile: state.writeFile }))
vi.mock('../src/components/AppLayout.vue', () => ({ default: { template: '<main><slot /></main>' } }))
vi.mock('../src/stores/auth', () => ({ useAuthStore: () => ({ role: 'admin' }) }))
vi.mock('../src/utils/permissions', () => ({ allowedCrafts: () => ['injection'], allowedRegions: () => ['hunan'] }))
vi.mock('../src/stores/factories', () => ({ useFactoriesStore: () => ({
  items: [{ id: 'factory-1', name: '测试工厂', craft: 'injection', region: 'hunan' }], fetchAll: vi.fn(),
}) }))
vi.mock('../src/stores/orders', () => ({ useOrdersStore: () => ({
  items: [
    { factory: 'factory-1', order_date: '2026-08-01', delivery_date: '2026-09-01', quote_labor_price: 10, unit_price: 8, is_delayed: true, delay_days: 2 },
    { factory: 'factory-1', order_date: '2026-08-31', quote_labor_price: 20, unit_price: 16 },
    { factory: 'factory-1', order_date: '2026-09-01', quote_labor_price: 30, unit_price: 24 },
    { factory: 'factory-1', quote_labor_price: 40, unit_price: 32 },
  ], fetchAll: vi.fn(),
}) }))
vi.mock('../src/pb', () => ({ pb: { collection: (name: string) => ({ getFullList: vi.fn(async () =>
  name === 'monthly_scores' ? [
    { factory: 'factory-1', year_month: '2026-09', grade: 'A' },
    { factory: 'factory-1', year_month: '2026-08', grade: 'B' },
  ] : [
    { factory: 'factory-1', inspect_date: '2026-08-01', internal_result: 'PASS' },
    { factory: 'factory-1', inspect_date: '2026-08-31', internal_result: 'FAIL' },
    { factory: 'factory-1', inspect_date: '2026-09-01', internal_result: 'PASS' },
  ]),
}) } }))

import SummaryView from '../src/views/SummaryView.vue'

describe('汇总表时间筛选', () => {
  it('月份、含首尾日期的范围和清除筛选同步更新各项统计与 Excel', async () => {
    const wrapper = mount(SummaryView)
    await flushPromises()
    const cells = () => wrapper.findAll('tbody tr')[0].findAll('td').map((cell) => cell.text())
    expect(cells()[13]).toBe('4')
    expect(cells()[21]).toBe('A')

    await wrapper.get('[aria-label="汇总时间筛选方式"]').setValue('month')
    await wrapper.get('[aria-label="汇总月份"]').setValue('2026-08')
    expect(cells()[10]).toBe('30')
    expect(cells()[11]).toBe('24')
    expect(cells()[13]).toBe('2')
    expect(cells()[14]).toBe('1')
    expect(cells()[17]).toBe('2')
    expect(cells()[18]).toBe('1')
    expect(cells()[21]).toBe('B')

    await wrapper.findAll('button').find((button) => button.text() === '导出 Excel')!.trigger('click')
    const [workbook, filename] = state.writeFile.mock.calls.at(-1)!
    const data = XLSX.utils.sheet_to_json(workbook.Sheets['外发加工厂管理统计表'], { header: 1 }) as unknown[][]
    expect(filename).toContain('2026-08')
    expect(data[4][13]).toBe(2)
    expect(data[4][17]).toBe(2)
    expect(data[4][21]).toBe('B')

    await wrapper.get('[aria-label="汇总时间筛选方式"]').setValue('range')
    await wrapper.get('[aria-label="汇总开始日期"]').setValue('2026-08-31')
    await wrapper.get('[aria-label="汇总结束日期"]').setValue('2026-09-01')
    expect(cells()[10]).toBe('50')
    expect(cells()[13]).toBe('2')
    expect(cells()[14]).toBe('0')
    expect(cells()[17]).toBe('2')
    expect(cells()[21]).toBe('A')

    await wrapper.get('[aria-label="汇总开始日期"]').setValue('2026-10-01')
    await wrapper.get('[aria-label="汇总结束日期"]').setValue('2026-10-31')
    expect(cells()[13]).toBe('0')
    expect(cells()[17]).toBe('0')
    expect(cells()[21]).toBe('-')
    await wrapper.findAll('button').find((button) => button.text() === '清除时间筛选')!.trigger('click')
    expect(cells()[13]).toBe('4')
    expect(cells()[21]).toBe('A')
    wrapper.unmount()
  })
})
