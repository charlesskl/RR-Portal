import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import QualityPatrolView from '../src/views/QualityPatrolView.vue'
import { patrolSummary } from '../src/utils/qualityPatrol'
const mocks = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), token: vi.fn(), url: vi.fn(), auth: { role: 'admin', userId: 'admin941' } }))
vi.mock('../src/pb', () => ({ pb: { collection: () => ({ getFullList: mocks.list, create: mocks.create, update: mocks.update, delete: mocks.remove }), files: { getURL: mocks.url, getToken: mocks.token } } }))
vi.mock('../src/stores/auth', async () => { const { reactive } = await import('vue'); return { useAuthStore: () => reactive(mocks.auth) } })
vi.mock('../src/stores/factories', () => ({ useFactoriesStore: () => ({ fetchAll: vi.fn(), items: [{ id: 'hn', name: '湖南工厂', region: 'hunan', craft: 'sewing', staff_count: 40, workshop_area: 123.5 }, { id: 'dg', name: '东莞工厂', region: 'dongguan', craft: 'sewing' }] }) }))
vi.mock('vue-router', () => ({ useRoute: () => ({ query: { region: 'hunan' } }), RouterLink: { template: '<a><slot /></a>' } }))
vi.mock('../src/components/AppLayout.vue', () => ({ default: { template: '<main><slot /></main>' } }))
const wrappers: ReturnType<typeof mount>[] = []
const fileToken = () => `fixture.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 120 }))}.signature`
function mountView() { const w = mount(QualityPatrolView, { attachTo: document.body }); wrappers.push(w); return w }
function image(name: string, size: number, type = 'image/png') { const file = new File(['fixture'], name, { type }); Object.defineProperty(file, 'size', { value: size }); return file }
afterEach(() => { for (const w of wrappers.splice(0)) if (w.exists()) w.unmount(); document.body.innerHTML = ''; vi.useRealTimers() })
beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.role = 'admin'
  mocks.auth.userId = 'admin941'
  mocks.token.mockImplementation(async () => fileToken())
  mocks.url.mockImplementation((_r, _name, options) => `/photo.jpg?token=${options.token}`)
  mocks.list.mockResolvedValue([
    { id: '1', factory: 'hn', check_date: '2026-10-16 00:00:00Z', grade: 'A', staff: 40, photos: ['photo.jpg'] },
    { id: '2', factory: 'hn', check_date: '2026-09-18 00:00:00Z', grade: 'B', staff: 35 },
    { id: '3', factory: 'dg', check_date: '2026-10-16 00:00:00Z', grade: 'D', staff: 80 },
  ])
})
describe('巡查现场', () => {
  it('uses template 02 column order, period labels and completion prose while preserving legacy fields on edit', async () => {
    mocks.list.mockResolvedValue([{ id:'1', factory:'hn', check_date:'2026-10-16', responsibility_scope:'责任人甲', responsible_supervisor:'主管乙', processing_fee_period:'1月-9月份', processing_fee:12.75, completion_details:'1:10/21完成\n2:10/26完成', planned_date:'2026-10-25' }])
    const w = mountView(); await flushPromises()
    const headers = w.findAll('.patrol-table thead th').map(h => h.text())
    expect(headers.slice(2, 9)).toEqual(['员工人数','拉线','场地面积（平方）','责任范围','责任主管','1月-9月份\n加工费（万）','本次评级'])
    expect(headers).not.toContain('计划完成时间')
    expect(w.find('.sheet-heading').text()).toContain('2026-10-16')
    expect(w.find('td.field-completed_date').text()).toBe('1:10/21完成\n2:10/26完成')
    await w.find('.patrol-table .actions button').trigger('click')
    await w.find('form').trigger('submit'); await flushPromises()
    const body = mocks.update.mock.calls[0]![1] as FormData
    expect(body.get('processing_fee')).toBe('12.75')
    expect(body.get('planned_date')).toBe('2026-10-25')
    expect(body.get('completion_details')).toBe('1:10/21完成\n2:10/26完成')
  })
  it('defaults to latest date and separates region and historical statistics', async () => {
    const w = mountView(); await flushPromises()
    expect(w.find('.patrol-table tbody').text()).toContain('湖南工厂')
    expect(w.find('.patrol-table tbody').text()).not.toContain('东莞工厂')
    expect(w.find('.patrol-table tbody').text()).not.toContain('2026-09-18')
    expect(w.find('.grade-summary').text()).toContain('100.00%')
    expect(w.find('.patrol-table thead').text()).not.toContain('上次')
    await w.findAll('.filters select')[1]!.setValue('2026-09-18')
    expect(w.find('.patrol-table tbody').text()).toContain('35')
  })
  it('keeps different processing fee periods attached to their own records', async () => {
    mocks.list.mockResolvedValue([
      {id:'1', factory:'hn', check_date:'2026-10-16', processing_fee:0, processing_fee_period:'1月-9月份'},
      {id:'2', factory:'hn', check_date:'2026-09-18', processing_fee:20.5, processing_fee_period:'1月-8月份'},
    ])
    const w = mountView(); await flushPromises()
    await w.findAll('.filters select')[1]!.setValue('')
    expect(w.find('th.field-processing_fee').text()).toBe('加工费（万）')
    expect(w.findAll('td.field-processing_fee').map(c => c.text())).toEqual(['01月-9月份','20.51月-8月份'])
  })
  it('blocks duplicate factory/date and preserves photos when editing', async () => {
    const w = mountView(); await flushPromises()
    await w.findAll('.toolbar button').find(b => b.text() === '新增巡查')!.trigger('click')
    await w.find('.form-grid select').setValue('hn')
    await w.find('form').trigger('submit')
    expect(w.find('[role=dialog]').text()).toContain('已有巡查记录')
    expect(mocks.create).not.toHaveBeenCalled()
    await w.findAll('.form-actions button')[0]!.trigger('click')
    await w.find('.patrol-table .actions button').trigger('click')
    await w.find('form').trigger('submit'); await flushPromises()
    expect(mocks.update).toHaveBeenCalled()
    expect(mocks.update.mock.calls[0]![1].getAll('photos')).toContain('photo.jpg')
  })
  it('shows load errors instead of an empty healthy summary', async () => {
    mocks.list.mockRejectedValueOnce(new Error('offline'))
    const w = mountView(); await flushPromises()
    expect(w.find('[role=alert]').text()).toContain('加载失败')
    expect(w.find('.summary').exists()).toBe(false)
  })
  it('keeps buyer accounts read only', async () => {
    mocks.auth.role = 'buyer_sewing'
    const w = mountView(); await flushPromises()
    expect(w.findAll('.toolbar button').map(b => b.text())).toEqual(['多次巡查对比'])
    expect(w.find('.patrol-table .actions').exists()).toBe(false)
  })
  it('counts unknown grades in denominator and distinct factories separately', () => {
    const s = patrolSummary([{ factory: 'a', grade: 'A', staff: 0 }, { factory: 'a', grade: '', staff: null }, { factory: 'b', grade: 'D', staff: 12 }])
    expect(s.factories).toBe(2); expect(s.staff).toBe(12); expect(s.unrated).toBe(1)
    expect(s.grades[0]?.percent).toBe('33.33%')
    expect(patrolSummary([]).grades[0]?.percent).toBe('—')
  })
  it('preserves an explicitly selected all-dates scope on refresh', async () => {
    const w = mountView(); await flushPromises()
    await w.findAll('.filters select')[1]!.setValue('')
    expect(w.findAll('.patrol-table tbody tr')).toHaveLength(2)
    await w.find('.filters button').trigger('click'); await flushPromises()
    expect((w.findAll('.filters select')[1]!.element as HTMLSelectElement).value).toBe('')
    expect(w.findAll('.patrol-table tbody tr')).toHaveLength(2)
  })
  it('defaults a changed region to its own latest date and recovers removed dates', async () => {
    mocks.list.mockResolvedValue([
      { id: '1', factory: 'hn', check_date: '2026-10-16 00:00:00Z' },
      { id: '2', factory: 'dg', check_date: '2026-10-18 00:00:00Z' },
      { id: '3', factory: 'dg', check_date: '2026-09-01 00:00:00Z' },
    ])
    const w = mountView(); await flushPromises()
    await w.findAll('.filters select')[0]!.setValue('dongguan')
    expect((w.findAll('.filters select')[1]!.element as HTMLSelectElement).value).toBe('2026-10-18')
    expect(w.findAll('.patrol-table tbody tr')).toHaveLength(1)
    mocks.list.mockResolvedValue([{ id: '3', factory: 'dg', check_date: '2026-09-01 00:00:00Z' }])
    await w.find('.filters button').trigger('click'); await flushPromises()
    expect((w.findAll('.filters select')[1]!.element as HTMLSelectElement).value).toBe('2026-09-01')
  })
  it('focuses the modal, wraps Tab in both directions and restores focus on Escape', async () => {
    const w = mountView(); await flushPromises()
    const opener = w.findAll('.toolbar button').find(b => b.text() === '新增巡查')!; (opener.element as HTMLElement).focus(); await opener.trigger('click'); await flushPromises()
    const first = w.find('.form-grid select'), last = w.find('.form-actions button[type=submit]')
    expect(document.activeElement).toBe(first.element)
    ;(last.element as HTMLElement).focus(); await last.trigger('keydown', { key: 'Tab' })
    expect(document.activeElement).toBe(first.element)
    await first.trigger('keydown', { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last.element)
    await last.trigger('keydown', { key: 'Escape' }); await flushPromises()
    expect(w.find('[role=dialog]').exists()).toBe(false)
    expect(document.activeElement).toBe(opener.element)
  })
  it('retains edits and kept photos after a failed save', async () => {
    mocks.update.mockRejectedValueOnce(new Error('offline'))
    const w = mountView(); await flushPromises(); await w.find('.patrol-table .actions button').trigger('click')
    await w.findAll('textarea').at(-1)!.setValue('unsaved notes')
    await w.find('form').trigger('submit'); await flushPromises()
    expect(w.find('[role=dialog]').exists()).toBe(true)
    expect(w.find('[role=dialog] [role=alert]').text()).toContain('保存失败')
    expect((w.findAll('textarea').at(-1)!.element as HTMLTextAreaElement).value).toBe('unsaved notes')
    expect(w.find('.kept-photos').text()).toContain('photo.jpg')
  })
  it('preserves real zero and sends optional blank numbers as null', async () => {
    const w = mountView(); await flushPromises(); await w.find('.patrol-table .actions button').trigger('click')
    const numbers = w.findAll('input[type=number]')
    await numbers[0]!.setValue('0'); await numbers[1]!.setValue(''); await numbers[2]!.setValue('12.5')
    await w.find('form').trigger('submit'); await flushPromises()
    const body = mocks.update.mock.calls[0]![1] as FormData
    expect(body.get('staff')).toBe('0'); expect(body.get('lines')).toBe('null'); expect(body.get('area')).toBe('12.5')
  })
  it('returns focus to the form error after a save fails', async () => {
    mocks.update.mockRejectedValueOnce(new Error('offline'))
    const w = mountView(); await flushPromises(); await w.find('.patrol-table .actions button').trigger('click')
    ;(w.find('.form-actions button[type=submit]').element as HTMLElement).focus()
    await w.find('form').trigger('submit'); await flushPromises()
    const alert = w.find('[role=dialog] [role=alert]')
    expect(alert.attributes('tabindex')).toBe('-1')
    expect(document.activeElement).toBe(alert.element)
    expect(document.activeElement?.closest('[role=dialog]')).toBe(w.find('[role=dialog]').element)
  })
  it('keeps manually entered staff and area when a new patrol date changes', async () => {
    const w = mountView(); await flushPromises(); await w.findAll('.toolbar button').find(b => b.text() === '新增巡查')!.trigger('click')
    await w.find('.form-grid select').setValue('hn')
    const numbers = w.findAll('input[type=number]')
    expect((numbers[0]!.element as HTMLInputElement).value).toBe('40')
    await numbers[0]!.setValue('50'); await numbers[2]!.setValue('150.5')
    await w.find('input[type=date]').setValue('2026-10-20')
    expect((numbers[0]!.element as HTMLInputElement).value).toBe('50')
    expect((numbers[2]!.element as HTMLInputElement).value).toBe('150.5')
    expect((w.findAll('input[type=date]')[1]!.element as HTMLInputElement).value).toBe('')
    expect(w.find('[role=dialog]').text()).not.toContain('上次')
  })
  it('uploads replacement files while retaining only the explicitly kept old photos', async () => {
    mocks.list.mockResolvedValue([{ id: '1', factory: 'hn', check_date: '2026-10-16 00:00:00Z', photos: ['keep.jpg', 'remove.jpg'] }])
    const w = mountView(); await flushPromises(); await w.find('.patrol-table .actions button').trigger('click')
    await w.findAll('.kept-photos button')[1]!.trigger('click')
    const input = w.find('input[type=file]'), replacement = image('new.png', 8)
    Object.defineProperty(input.element, 'files', { value: [replacement], configurable: true }); await input.trigger('change')
    await w.find('form').trigger('submit'); await flushPromises()
    const submitted = (mocks.update.mock.calls[0]![1] as FormData).getAll('photos')
    expect(submitted).toContain('keep.jpg'); expect(submitted).not.toContain('remove.jpg')
    expect(submitted.some(value => typeof value !== 'string' && value.name === 'new.png')).toBe(true)
  })
  it('blocks total new photo bodies above 30MiB without counting existing files', async () => {
    const w = mountView(); await flushPromises(); await w.find('.patrol-table .actions button').trigger('click')
    const input = w.find('input[type=file]')
    Object.defineProperty(input.element, 'files', { value: [0, 1, 2, 3].map(n => image(`${n}.png`, 10 * 1024 * 1024)), configurable: true }); await input.trigger('change')
    expect(w.find('[role=dialog] [role=alert]').text()).toContain('新增照片合计不超过30MB')
    expect(w.find('input[type=file]').element.value).toBe('')
    Object.defineProperty(input.element, 'files', { value: [0, 1, 2].map(n => image(`${n}.png`, 10 * 1024 * 1024)), configurable: true }); await input.trigger('change')
    expect(w.find('[role=dialog] [role=alert]').exists()).toBe(false)
    expect(w.find('[role=dialog]').text()).toContain('3 张待上传')
  })
  it.each([[11, 1, 'image/png'], [1, 10485761, 'image/png'], [1, 1, 'application/pdf']])('blocks invalid photo count/size/type (%s/%s/%s)', async (count, size, type) => {
    const w = mountView(); await flushPromises(); await w.find('.patrol-table .actions button').trigger('click')
    const input = w.find('input[type=file]')
    Object.defineProperty(input.element, 'files', { value: Array.from({ length: count }, (_, n) => image(`${n}.png`, size, type)) }); await input.trigger('change')
    expect(w.find('[role=dialog] [role=alert]').text()).toContain('最多保存10张照片')
  })
  it('uses protected file tokens, renews before expiry and cleans up on unmount', async () => {
    vi.useFakeTimers()
    const w = mountView(); await flushPromises()
    expect(w.find('.photo-cell img').attributes('src')).toContain('token=fixture.')
    expect(mocks.url.mock.calls[0]![2].token).toBeTruthy()
    expect(mocks.token).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(91000)
    expect(mocks.token).toHaveBeenCalledTimes(2)
    w.unmount(); expect(vi.getTimerCount()).toBe(0)
  })
  it('stops token retries on failure and lets the user retry without hiding records', async () => {
    vi.useFakeTimers(); mocks.token.mockRejectedValueOnce(new Error('403'))
    const w = mountView(); await flushPromises()
    expect(w.find('[role=alert]').text()).toContain('照片授权获取失败')
    expect(w.find('.patrol-table tbody').text()).toContain('湖南工厂')
    expect(w.find('.photo-cell img').exists()).toBe(false)
    await vi.advanceTimersByTimeAsync(300000); expect(mocks.token).toHaveBeenCalledTimes(1)
    await w.find('[role=alert] button').trigger('click'); await flushPromises()
    expect(w.find('.photo-cell img').exists()).toBe(true)
    mocks.token.mockRejectedValueOnce(new Error('401'))
    await vi.advanceTimersByTimeAsync(91000)
    expect(w.find('[role=alert]').text()).toContain('照片授权获取失败')
    await vi.advanceTimersByTimeAsync(300000); expect(mocks.token).toHaveBeenCalledTimes(3)
  })
  it('does not loop on inaccessible photos or retain late tokens after unmount', async () => {
    vi.useFakeTimers()
    const w = mountView(); await flushPromises()
    await w.find('.photo-cell img').trigger('error')
    expect(w.find('[role=alert]').text()).toContain('照片加载失败')
    await vi.advanceTimersByTimeAsync(300000); expect(mocks.token).toHaveBeenCalledTimes(1)
    let resolve!: (token: string) => void
    mocks.token.mockImplementationOnce(() => new Promise<string>(r => { resolve = r }))
    await w.find('[role=alert] button').trigger('click'); await flushPromises()
    const signal = mocks.token.mock.calls.at(-1)![0].signal as AbortSignal
    w.unmount(); expect(signal.aborted).toBe(true)
    resolve(fileToken()); await flushPromises(); expect(vi.getTimerCount()).toBe(0)
  })
  it('bounds token service stalls and clears photo access on account changes', async () => {
    vi.useFakeTimers()
    mocks.token.mockImplementationOnce(({ signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))))
    const w = mountView(); await flushPromises()
    expect(w.find('.patrol-table tbody').text()).toContain('湖南工厂')
    await vi.advanceTimersByTimeAsync(10000)
    expect(w.find('[role=alert]').text()).toContain('照片授权获取失败')
    expect(vi.getTimerCount()).toBe(0)
    await w.find('[role=alert] button').trigger('click'); await flushPromises()
    expect(w.find('.photo-cell img').exists()).toBe(true)
    const { useAuthStore } = await import('../src/stores/auth')
    useAuthStore().userId = 'other941'; await flushPromises()
    expect(w.find('.photo-cell img').exists()).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })
})
