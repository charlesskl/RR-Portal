import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const state = vi.hoisted(() => ({
  checks: [] as { ip_control?: string }[],
  getChecks: vi.fn(),
}))
vi.mock('../src/components/AppLayout.vue', () => ({ default: { template: '<main><slot /></main>' } }))
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: 'factory-1' } }),
  RouterLink: { template: '<a><slot /></a>' },
}))
vi.mock('../src/stores/factories', () => ({ useFactoriesStore: () => ({
  get: vi.fn(async () => ({ id: 'factory-1', name: '测试工厂', ip_control: '旧档案内容' })),
}) }))
vi.mock('../src/pb', () => ({ pb: { collection: (name: string) => ({
  getFullList: async (options: unknown) => {
    if (name !== 'quality_5s_checks') return []
    state.getChecks(options)
    return state.checks
  },
}) } }))

import FactoryViewDetail from '../src/views/FactoryViewDetail.vue'

describe('加工厂管理 IP 管控数据来源', () => {
  it.each([
    { checks: [{ ip_control: '8.5' }, { ip_control: '10' }], expected: '8.5' },
    { checks: [{ ip_control: '0' }], expected: '0' },
    { checks: [{ ip_control: 'NA' }], expected: 'NA' },
    { checks: [{ ip_control: '' }], expected: 'NA' },
    { checks: [], expected: '-' },
  ])('显示最新品质检查得分 $expected，不读取工厂档案字段', async ({ checks, expected }) => {
    state.checks = checks
    const wrapper = mount(FactoryViewDetail)
    await flushPromises()
    const ipRow = wrapper.findAll('.b-site .m-line').find((row) => row.find('span').text() === 'IP管控')!
    expect(ipRow.get('b').text()).toBe(expected)
    expect(state.getChecks).toHaveBeenLastCalledWith({ filter: 'factory = "factory-1"', sort: '-check_date' })
    wrapper.unmount()
  })
})
