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
})
