import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import QualityQmsView from '../src/views/QualityQmsView.vue'
const { send } = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('../src/pb', () => ({ pb: { send } }))
vi.mock('vue-router', () => ({ useRoute: () => ({ query: { region: 'heyuan' } }), RouterLink: { template: '<a><slot /></a>' } }))
vi.mock('../src/components/AppLayout.vue', () => ({ default: { template: '<main><slot /></main>' } }))
const data = { factories: [{ id: '1', name: '伟创' }, { id: '2', name: '新万利' }], records: [
  { id: 1, supplier: '伟创', productName: '小熊', inspDate: '2026-09-16', result: 'PASS', fail: 0 },
  { id: 2, supplier: '新万利', productName: '小猫', inspDate: '2026-09-15', result: 'REJ', fail: 2 },
] }
beforeEach(() => { send.mockReset(); send.mockResolvedValue(data) })
describe('QMS inspection page', () => {
  it('requests the selected region and filters by factory, dates and result', async () => {
    const wrapper = mount(QualityQmsView)
    await flushPromises()
    expect(send).toHaveBeenCalledWith('/api/factory-review/qms-inspections', expect.objectContaining({ query: { region: 'heyuan' } }))
    expect(wrapper.text()).toContain('河源厂区')
    expect(wrapper.findAll('tbody tr')).toHaveLength(2)
    await wrapper.find('select').setValue('伟创')
    expect(wrapper.find('tbody').text()).toContain('小熊')
    expect(wrapper.find('tbody').text()).not.toContain('小猫')
    await wrapper.find('select').setValue('')
    await wrapper.findAll('select')[1]!.setValue('REJ')
    expect(wrapper.find('tbody').text()).toContain('小猫')
    await wrapper.findAll('input[type=date]')[0]!.setValue('2026-09-16')
    expect(wrapper.find('tbody').text()).toContain('暂无匹配')
    await wrapper.findAll('input[type=date]')[1]!.setValue('2026-09-14')
    expect(wrapper.find('[role=alert]').text()).toContain('开始日期不能晚于结束日期')
  })
  it('shows connection failures and allows refresh to recover', async () => {
    send.mockRejectedValueOnce({ response: { message: '品质管理系统暂时无法连接' } })
    const wrapper = mount(QualityQmsView)
    await flushPromises()
    expect(wrapper.find('[role=alert]').text()).toContain('暂时无法连接')
    await wrapper.find('[role=alert] button').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role=alert]').exists()).toBe(false)
    expect(wrapper.findAll('tbody tr')).toHaveLength(2)
  })
})
