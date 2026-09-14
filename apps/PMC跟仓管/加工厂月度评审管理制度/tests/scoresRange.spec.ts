import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const state = vi.hoisted(() => ({
  getFullList: vi.fn(),
}))

vi.mock('../src/pb', () => ({
  pb: {
    collection: vi.fn(() => ({ getFullList: state.getFullList })),
  },
}))

import { useScoresStore } from '../src/stores/scores'

describe('月度评分范围查询', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    state.getFullList.mockReset()
  })

  it('按起止月份读取评分记录', async () => {
    state.getFullList.mockResolvedValue([
      { id: '1', factory: 'factory-1', year_month: '2026-01', score_items: [], total_score: 80, flag: 'none', status: 'approved' },
      { id: '2', factory: 'factory-1', year_month: '2026-03', score_items: [], total_score: 90, flag: 'none', status: 'approved' },
    ])
    const store = useScoresStore()

    await store.fetchByRange('2026-01', '2026-03')

    expect(state.getFullList).toHaveBeenCalledWith({
      filter: 'year_month >= "2026-01" && year_month <= "2026-03"',
      expand: 'factory',
      sort: 'year_month',
    })
    expect(store.items).toHaveLength(2)
  })

  it('在页面返回时恢复已加载的评分和订单缓存', async () => {
    const augustScore = {
      id: 'score-august', factory: 'factory-1', year_month: '2026-08',
      score_items: [], total_score: 88, flag: 'none', status: 'draft',
    }
    state.getFullList.mockResolvedValue([augustScore])
    const store = useScoresStore()
    await store.fetchByMonth('2026-08')
    store.rememberScoringList('2026-08', '2026-08', [
      { id: 'order-1', factory: 'factory-1', product: '甲', delivery_date: '2026-08-10' },
    ])

    store.items = []
    const cachedOrders = store.restoreScoringList('2026-08', '2026-08')

    expect(cachedOrders).toHaveLength(1)
    expect(store.items).toEqual([augustScore])
    expect(store.findCached('factory-1', '2026-08')).toEqual(augustScore)
    expect(store.restoreScoringList('2026-09', '2026-09')).toBeNull()
  })
})
