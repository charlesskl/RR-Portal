import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const state = vi.hoisted(() => ({ scores: vi.fn(), outputs: vi.fn(), save: vi.fn() }))
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { month: '2026-09' } }),
  RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
}))
vi.mock('../src/components/AppLayout.vue', () => ({ default: { template: '<main><slot /></main>' } }))
vi.mock('../src/stores/auth', () => ({ useAuthStore: () => ({ role: 'admin' }) }))
vi.mock('../src/stores/factories', () => ({ useFactoriesStore: () => ({
  items: [{ id: 'f1', craft: 'injection' }], fetchAll: vi.fn(),
}) }))
vi.mock('../src/stores/scores', () => ({ useScoresStore: () => ({ items: [], fetchByRange: state.scores }) }))
vi.mock('../src/stores/output', () => ({ useOutputStore: () => ({ items: [], fetchByRange: state.outputs }) }))
vi.mock('../src/stores/reviews', () => ({ useReviewsStore: () => ({ save: state.save }) }))
import ReviewBoardView from '../src/views/ReviewBoardView.vue'

describe('评审大盘时间段筛选', () => {
  beforeEach(() => vi.resetAllMocks())
  it('默认查询路由月份，查询期间数据并在单月恢复存档', async () => {
    const wrapper = mount(ReviewBoardView)
    await flushPromises()
    expect(state.scores).toHaveBeenLastCalledWith('2026-09', '2026-09')
    await wrapper.get('[aria-label="开始月份"]').setValue('2026-07')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(state.scores).toHaveBeenLastCalledWith('2026-07', '2026-09')
    expect(state.outputs).toHaveBeenLastCalledWith('2026-07', '2026-09')
    const archive = () => wrapper.findAll('button').find(b => b.text() === '存档大盘')!
    expect((archive().element as HTMLButtonElement).disabled).toBe(true)
    await wrapper.get('[aria-label="结束月份"]').setValue('2026-07')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect((archive().element as HTMLButtonElement).disabled).toBe(false)
    expect(wrapper.get('a').attributes('href')).toBe('/review/2026-07/meeting')
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {})
    await archive().trigger('click')
    await flushPromises()
    expect(state.save).toHaveBeenCalledWith('2026-07', expect.any(Object))
    alert.mockRestore()
  })
  it('拒绝空日期和反向范围，查询失败时提示错误', async () => {
    const wrapper = mount(ReviewBoardView)
    await flushPromises()
    await wrapper.get('[aria-label="开始月份"]').setValue('')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.text()).toContain('请选择开始月份和结束月份')
    await wrapper.get('[aria-label="开始月份"]').setValue('2026-10')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.text()).toContain('开始月份不能晚于结束月份')
    expect(state.scores).toHaveBeenCalledTimes(1)
    await wrapper.get('[aria-label="开始月份"]').setValue('2026-08')
    state.scores.mockRejectedValueOnce(new Error('网络错误'))
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe('网络错误')
  })
})
