import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setPermissionOverrides, setAuthorizedCrafts } from '../src/utils/permissions'
const mocks = vi.hoisted(() => ({ get: vi.fn(), auth: { record: { id: 'u', role: 'admin' } as any }, callback: null as any }))
vi.mock('../src/pb', () => ({ pb: { collection: (name: string) => ({ getFullList: (opts: any) => mocks.get(name, opts) }), authStore: { get record() { return mocks.auth.record }, onChange: (cb: any) => { mocks.callback = cb; return () => {} } } } }))
import { useDynamicAnalysis } from '../src/composables/useDynamicAnalysis'
function setup() { let result!: ReturnType<typeof useDynamicAnalysis>; const wrapper = mount(defineComponent({ setup() { result = useDynamicAnalysis(); return () => null } })); return { wrapper, get data() { return result } } }
beforeEach(() => { vi.clearAllMocks(); mocks.auth.record = { id:'u',role:'admin' }; setPermissionOverrides({}); setAuthorizedCrafts(null); mocks.get.mockImplementation(async (name: string) => name === 'factories' ? [{ id:'f',name:'工厂',craft:'assembly',region:'hunan' }] : []) })
describe('analysis data loading', () => {
  it('does not request disabled sources and rejects out-of-scope records', async () => {
    mocks.auth.record.permissions = { 'quality.view': false, 'region.hunan': false }
    mocks.get.mockImplementation(async (name: string) => name === 'factories' ? [{ id:'f',name:'工厂',craft:'assembly',region:'hunan' }] : [{ id:'o',factory:'f',product:'x',delivery_date:'2020-01-01',region:'hunan' }])
    const s = setup(); await flushPromises()
    expect(mocks.get.mock.calls.map(c => c[0])).not.toContain('quality_patrols')
    expect(s.data.result.value.issues).toEqual([])
    expect(s.data.errors.value.join('')).toContain('无品质查看权限'); s.wrapper.unmount()
  })
  it('shows source failures rather than declaring all sources safe', async () => {
    mocks.get.mockRejectedValue(new Error('offline'))
    const s = setup(); await flushPromises()
    expect(s.data.errors.value).toHaveLength(3); expect(s.data.loading.value).toBe(false); s.wrapper.unmount()
  })
  it('discards stale data after logout during an in-flight request', async () => {
    let resolve!: (v: any) => void
    mocks.get.mockImplementation(() => new Promise(r => { resolve = r }))
    const s = setup(); mocks.auth.record = null; mocks.callback();
    resolve([{ id:'o',factory:'f',delivery_date:'2020-01-01' }]); await flushPromises()
    expect(s.data.factories.value).toEqual([]); expect(s.data.result.value.issues).toEqual([]); s.wrapper.unmount()
  })
  it('refreshes visible pages every minute and stops on disposal', async () => {
    vi.useFakeTimers()
    const s = setup(); await flushPromises(); const count = mocks.get.mock.calls.length
    Object.defineProperty(document, 'hidden', { value:false, configurable:true })
    await vi.advanceTimersByTimeAsync(60000); expect(mocks.get.mock.calls.length).toBe(count * 2)
    s.wrapper.unmount(); await vi.advanceTimersByTimeAsync(60000); expect(mocks.get.mock.calls.length).toBe(count * 2); vi.useRealTimers()
  })
})
