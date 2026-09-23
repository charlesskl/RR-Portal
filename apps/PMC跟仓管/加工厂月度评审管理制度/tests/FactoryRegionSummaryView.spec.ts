import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const state = vi.hoisted(() => ({ writeFile: vi.fn(), scores: [] as any[] }))

vi.mock('../src/stores/auth', () => ({ useAuthStore: () => ({ role: 'admin' }) }))
vi.mock('../src/stores/factories', () => ({
  useFactoriesStore: () => ({
    items: [
      { id: 'factory-injection', name: '注塑厂', craft: 'injection', region: 'dongguan', status: 'active' },
      { id: 'factory-painting', name: '喷油厂', craft: 'painting', region: 'dongguan', status: 'active' },
      { id: 'factory-hunan', name: '湖南厂', craft: 'injection', region: 'hunan', status: 'active' },
    ],
    fetchAll: vi.fn().mockResolvedValue(undefined),
  }),
}))
vi.mock('../src/pb', () => ({
  pb: {
    collection: (name: string) => ({
      getFullList: vi.fn().mockResolvedValue(name === 'orders' ? [
        { id: 'order-1', factory: 'factory-injection', order_date: '2026-08-03', quantity: 100, quote_labor_price: 2, unit_price: 1.8 },
        { id: 'order-2', factory: 'factory-painting', order_date: '2026-08-04', quantity: 50, quote_labor_price: 3, unit_price: 2.7 },
      ] : name === 'monthly_scores' ? state.scores : []),
    }),
  },
}))
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { region: 'dongguan', craft: 'injection' }, query: { region: 'dongguan' } }),
  RouterLink: { template: '<a><slot /></a>' },
}))
vi.mock('../src/components/AppLayout.vue', () => ({ default: { template: '<main><slot /></main>' } }))
vi.mock('xlsx-js-style', async (importOriginal) => {
  const original = await importOriginal<typeof import('xlsx-js-style')>()
  return { default: { ...original.default, writeFile: state.writeFile } }
})

import FactoryDeptSummaryView from '../src/views/FactoryDeptSummaryView.vue'
import FactoryRegionSummaryView from '../src/views/FactoryRegionSummaryView.vue'

describe('厂区加工厂汇总', () => {
  beforeEach(() => { vi.clearAllMocks(); state.scores = [] })

  it('按部门展示指定厂区数据，并导出同一工作表的分段汇总', async () => {
    const wrapper = mount(FactoryRegionSummaryView)
    await flushPromises()

    expect(wrapper.text()).toContain('东莞厂区 · 汇总')
    expect(wrapper.text()).toContain('注塑部')
    expect(wrapper.text()).toContain('喷油部')
    expect(wrapper.text()).toContain('车缝部')
    expect(wrapper.text()).toContain('注塑厂')
    expect(wrapper.text()).not.toContain('湖南厂')

    const exportButton = wrapper.findAll('button').find((button) => button.text() === '导出 Excel')!
    await exportButton.trigger('click')
    expect(state.writeFile).toHaveBeenCalledOnce()
    const [workbook, filename] = state.writeFile.mock.calls[0]!
    const sheet = workbook.Sheets['汇总表']
    expect(filename).toBe('东莞厂区加工厂汇总表.xlsx')
    expect(sheet.A1.v).toBe('东莞厂区 · 注塑部加工厂汇总表')
    expect(Object.values(sheet).some((cell: any) => cell?.v === '东莞厂区 · 喷油部加工厂汇总表')).toBe(true)
    expect(sheet['!merges']).toHaveLength(5)
  })
  it.each([FactoryRegionSummaryView, FactoryDeptSummaryView])('八月显示八月明细评级且导出一致，不误取九月D', async (component) => {
    state.scores = [
      { factory: 'factory-injection', year_month: '2026-09', total_score: 25, grade: 'D' },
      { factory: 'factory-injection', year_month: '2026-08', total_score: 25, grade: 'D', score_items: [{ template_id: 'a', score: 72 }] },
    ]
    const wrapper = mount(component)
    await flushPromises()
    const grade = () => component === FactoryDeptSummaryView ? wrapper.find('.factory-grade b').text() : wrapper.findAll('tbody tr').find((row) => row.text().includes('注塑厂'))!.findAll('td')[1]!.text()
    expect(grade()).toBe('D')
    await wrapper.find('select').setValue('month')
    await wrapper.find('input[type="month"]').setValue('2026-08')
    expect(grade()).toBe('B')
    await wrapper.findAll('button').find((button) => button.text() === '导出 Excel')!.trigger('click')
    const sheet = state.writeFile.mock.calls[0]![0].Sheets['汇总表']
    expect(Object.values(sheet).some((cell: any) => cell?.v === 'B')).toBe(true)
    await wrapper.find('input[type="month"]').setValue('2026-07')
    expect(grade()).toBe('-')
    wrapper.unmount()
  })

})
