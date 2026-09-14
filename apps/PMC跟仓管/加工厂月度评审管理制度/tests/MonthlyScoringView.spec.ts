import { describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'

const state = vi.hoisted(() => ({ update: vi.fn() }))
const factoryItems = [
  { id: 'factory-1', name: '工厂甲', craft: 'injection', region: 'dongguan' },
  { id: 'factory-2', name: '工厂乙', craft: 'injection', region: 'dongguan' },
]
const templates = [{
  id: 'delivery', name: '交期', module: 'delivery', max_score: 20,
  scoring_role: 'buyer', is_active: true,
}]
const records = factoryItems.map((factory, index) => ({
  id: 'score-' + index, factory: factory.id, year_month: '2026-08', status: 'draft', flag: 'none',
  score_items: [{ template_id: 'delivery', score: index === 0 ? 20 : 10 }],
}))
const orders = factoryItems.map((factory, index) => ({
  id: 'order-' + index, factory: factory.id, delivery_date: '2026-08-10', is_delayed: index === 0,
}))

vi.mock('../src/components/AppLayout.vue', () => ({ default: { template: '<main><slot /></main>' } }))
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: { month: '2026-08' } }),
  useRouter: () => ({ replace: vi.fn() }),
  RouterLink: { template: '<a><slot /></a>' },
}))
vi.mock('../src/stores/auth', () => ({ useAuthStore: () => ({ role: 'admin' }) }))
vi.mock('../src/utils/permissions', () => ({
  allowedCrafts: () => ['injection'], allowedRegions: () => ['dongguan'], canViewCraft: () => true,
}))
vi.mock('../src/stores/factories', () => ({
  useFactoriesStore: () => ({ items: factoryItems, fetchAll: vi.fn() }),
  filterByCraft: (items: unknown[]) => items,
}))
vi.mock('../src/stores/scoreTemplates', () => ({
  useScoreTemplatesStore: () => ({ items: templates, fetchAll: vi.fn(), applicable: () => templates }),
}))
vi.mock('../src/pb', () => ({ pb: { collection: (name: string) => ({
  getFullList: async (options?: { filter?: string }) => {
    if (name === 'orders') return orders
    if (name !== 'monthly_scores') return []
    return options?.filter?.startsWith('factory =')
      ? records.filter((record) => options.filter!.includes(record.factory))
      : records
  },
  update: state.update,
}) } }))

import MonthlyScoringView from '../src/views/MonthlyScoringView.vue'

describe('批量自动评分', () => {
  it('保存后列表重新排序仍对每家工厂仅计算一次', async () => {
    setActivePinia(createPinia())
    state.update.mockImplementation(async (id, data) => ({ ...records.find((record) => record.id === id), ...data }))
    const wrapper = mount(MonthlyScoringView)
    await flushPromises()
    await wrapper.findAll('button').find((button) => button.text() === '自动计算本月评分')!.trigger('click')
    await flushPromises()
    expect(state.update.mock.calls.map(([id]) => id)).toEqual(['score-0', 'score-1'])
    expect(state.update.mock.calls[0][1].score_items[0].score).toBe(0)
    expect(state.update.mock.calls[1][1].score_items[0].score).toBe(20)
    expect(wrapper.text()).toContain('更新 2 家')
    wrapper.unmount()
  })
})
