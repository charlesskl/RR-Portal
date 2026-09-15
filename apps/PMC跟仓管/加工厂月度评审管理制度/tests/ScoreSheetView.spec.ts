import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const state = vi.hoisted(() => ({
  fetchTemplates: vi.fn(),
  getFactory: vi.fn(),
  getScore: vi.fn(),
  getFullList: vi.fn(),
  saveScore: vi.fn(),
}))

const factory = {
  id: 'factory-1', name: '测试工厂', craft: 'injection', region: 'dongguan', status: 'active',
}
const templates = [{
  id: 'delivery', name: '货期评分', module: 'delivery', max_score: 20,
  scoring_role: 'buyer', craft_filter: '', is_active: true, sort_order: 1,
}]
const cachedScore = {
  id: 'score-1', factory: 'factory-1', year_month: '2026-08',
  score_items: [{ template_id: 'delivery', score: 18, notes: '已自动计算' }],
  total_score: 18, grade: 'D', flag: 'none', status: 'draft',
}

vi.mock('../src/stores/factories', () => ({
  useFactoriesStore: () => ({ items: [factory], get: state.getFactory }),
}))
vi.mock('../src/stores/scoreTemplates', () => ({
  useScoreTemplatesStore: () => ({
    items: templates,
    fetchAll: state.fetchTemplates,
    applicable: () => templates,
  }),
}))
vi.mock('../src/stores/scores', () => ({
  useScoresStore: () => ({
    findCached: () => cachedScore,
    getOne: state.getScore,
    save: state.saveScore,
  }),
}))
vi.mock('../src/stores/auth', () => ({
  useAuthStore: () => ({ role: 'admin', userId: 'admin-1' }),
}))
vi.mock('../src/pb', () => ({
  pb: { collection: (name: string) => ({ getFullList: (options: unknown) => state.getFullList(name, options) }) },
}))
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: 'factory-1', month: '2026-08' } }),
  RouterLink: { props: ['to'], template: '<a><slot /></a>' },
}))
vi.mock('../src/components/AppLayout.vue', () => ({
  default: { template: '<main><slot /></main>' },
}))

import ScoreSheetView from '../src/views/ScoreSheetView.vue'

describe('评分详情缓存', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.saveScore.mockImplementation(async (_factory, _month, data) => ({ ...cachedScore, ...data }))
  })

  it('有已保存评分时直接展示，不再自动重算', async () => {
    const wrapper = mount(ScoreSheetView)
    await flushPromises()

    expect(wrapper.text()).toContain('已加载保存的评分结果')
    expect(wrapper.text()).toContain('已自动计算')
    expect(wrapper.text()).toContain('返回月度评分')
    expect(state.fetchTemplates).not.toHaveBeenCalled()
    expect(state.getFactory).not.toHaveBeenCalled()
    expect(state.getScore).not.toHaveBeenCalled()
    expect(state.getFullList).not.toHaveBeenCalled()
  })

  it('手动重新计算后立即保存评分项，供外层列表同步总分', async () => {
    state.getFullList.mockImplementation((name: string) => {
      if (name === 'orders') return Promise.resolve([
        { id: 'order-1', factory: 'factory-1', product: '甲', delivery_date: '2026-08-10', is_delayed: false },
      ])
      return Promise.resolve([])
    })
    const wrapper = mount(ScoreSheetView)
    await flushPromises()

    await wrapper.get('button.ghost').trigger('click')
    await flushPromises()

    expect(state.saveScore).toHaveBeenCalledWith('factory-1', '2026-08', {
      score_items: [expect.objectContaining({ template_id: 'delivery', score: 20 })],
    })
    expect(wrapper.text()).toContain('已重新计算并保存，总分已同步')
    expect(wrapper.text()).toContain('预估总分 20')
  })

  it('编辑未提交的得分不会修改列表缓存中的评分项', async () => {
    templates[0].module = 'cooperation'
    const wrapper = mount(ScoreSheetView)
    try {
      await flushPromises()
      await wrapper.get('input[type="number"]').setValue('7')
      expect(wrapper.text()).toContain('预估总分 7')
      expect(cachedScore.score_items[0].score).toBe(18)
      expect(state.saveScore).not.toHaveBeenCalled()
    } finally {
      templates[0].module = 'delivery'
      wrapper.unmount()
    }
  })
})
