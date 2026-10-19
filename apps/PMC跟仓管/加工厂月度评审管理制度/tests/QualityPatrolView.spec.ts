import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import QualityPatrolView from '../src/views/QualityPatrolView.vue'
import { patrolSummary } from '../src/utils/qualityPatrol'
const mocks = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), auth: { role: 'admin' } }))
vi.mock('../src/pb', () => ({ pb: { collection: () => ({ getFullList: mocks.list, create: mocks.create, update: mocks.update, delete: mocks.remove }), files: { getURL: () => '/photo.jpg' } } }))
vi.mock('../src/stores/auth', () => ({ useAuthStore: () => mocks.auth }))
vi.mock('../src/stores/factories', () => ({ useFactoriesStore: () => ({ fetchAll: vi.fn(), items: [{ id: 'hn', name: '湖南工厂', region: 'hunan', craft: 'sewing' }, { id: 'dg', name: '东莞工厂', region: 'dongguan', craft: 'sewing' }] }) }))
vi.mock('vue-router', () => ({ useRoute: () => ({ query: { region: 'hunan' } }), RouterLink: { template: '<a><slot /></a>' } }))
vi.mock('../src/components/AppLayout.vue', () => ({ default: { template: '<main><slot /></main>' } }))
beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.role = 'admin'
  mocks.list.mockResolvedValue([
    { id: '1', factory: 'hn', check_date: '2026-10-16 00:00:00Z', grade: 'A', staff: 40, photos: ['photo.jpg'] },
    { id: '2', factory: 'hn', check_date: '2026-09-18 00:00:00Z', grade: 'B', staff: 35 },
    { id: '3', factory: 'dg', check_date: '2026-10-16 00:00:00Z', grade: 'D', staff: 80 },
  ])
})
describe('巡查现场', () => {
  it('defaults to latest date and separates region and historical statistics', async () => {
    const w = mount(QualityPatrolView); await flushPromises()
    expect(w.find('.patrol-table tbody').text()).toContain('湖南工厂')
    expect(w.find('.patrol-table tbody').text()).not.toContain('东莞工厂')
    expect(w.find('.patrol-table tbody').text()).not.toContain('2026-09-18')
    expect(w.find('.grade-summary').text()).toContain('100.00%')
    await w.findAll('.filters select')[1]!.setValue('2026-09-18')
    expect(w.find('.patrol-table tbody').text()).toContain('35')
  })
  it('blocks duplicate factory/date and preserves photos when editing', async () => {
    const w = mount(QualityPatrolView); await flushPromises()
    await w.find('.toolbar button').trigger('click')
    await w.find('.form-grid select').setValue('hn')
    await w.find('form').trigger('submit')
    expect(w.find('[role=dialog]').text()).toContain('已有巡查记录')
    expect(mocks.create).not.toHaveBeenCalled()
    await w.findAll('.form-actions button')[0]!.trigger('click')
    await w.find('.actions button').trigger('click')
    await w.find('form').trigger('submit'); await flushPromises()
    expect(mocks.update).toHaveBeenCalled()
    expect(mocks.update.mock.calls[0]![1].getAll('photos')).toContain('photo.jpg')
  })
  it('shows load errors instead of an empty healthy summary', async () => {
    mocks.list.mockRejectedValueOnce(new Error('offline'))
    const w = mount(QualityPatrolView); await flushPromises()
    expect(w.find('[role=alert]').text()).toContain('加载失败')
    expect(w.find('.summary').exists()).toBe(false)
  })
  it('keeps buyer accounts read only', async () => {
    mocks.auth.role = 'buyer_sewing'
    const w = mount(QualityPatrolView); await flushPromises()
    expect(w.find('.toolbar button').exists()).toBe(false)
    expect(w.find('.actions').exists()).toBe(false)
  })
  it('counts unknown grades in denominator and distinct factories separately', () => {
    const s = patrolSummary([{ factory: 'a', grade: 'A', staff: 0 }, { factory: 'a', grade: '', staff: null }, { factory: 'b', grade: 'D', staff: 12 }])
    expect(s.factories).toBe(2); expect(s.staff).toBe(12); expect(s.unrated).toBe(1)
    expect(s.grades[0]?.percent).toBe('33.33%')
    expect(patrolSummary([]).grades[0]?.percent).toBe('—')
  })
})
