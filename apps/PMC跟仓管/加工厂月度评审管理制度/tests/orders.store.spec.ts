import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { useOrdersStore } from '../src/stores/orders'
import { setAuthorizedCrafts, setPermissionOverrides } from '../src/utils/permissions'
import type { Order } from '../src/types/order'

const fake = vi.hoisted(() => ({
  record: { id: 'admin-test', role: 'admin', permissions: {} } as Record<string, unknown> | null,
  getList: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(),
  onChange: vi.fn(() => () => {}),
}))
vi.mock('../src/pb', () => ({ pb: {
  authStore: { get record() { return fake.record }, onChange: fake.onChange },
  collection: () => fake,
} }))

function order(id: string, craft = 'injection', region = 'dongguan'): Order {
  return { id, factory: `${craft}-factory`, product: 'test material', region: region as Order['region'],
    expand: { factory: { name: 'test factory', craft, region: 'hunan' } } }
}
function page(items: Order[]) { return { items, totalPages: 1, totalItems: items.length, perPage: 1000, page: 1 } }
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { resolve, reject, promise }
}
let pinia: ReturnType<typeof createPinia>
beforeEach(() => {
  vi.clearAllMocks()
  pinia = createPinia()
  setActivePinia(pinia)
  fake.record = { id: 'admin-test', role: 'admin', permissions: {} }
  setPermissionOverrides(null)
  setAuthorizedCrafts(null)
  fake.getList.mockResolvedValue(page([order('one')]))
  fake.update.mockResolvedValue(order('one'))
})
afterEach(() => { disposePinia(pinia); setPermissionOverrides(null); setAuthorizedCrafts(null) })

describe('orders store loading', () => {
  it('loads lightweight card summaries without treating them as full detail records', async () => {
    const store = useOrdersStore()
    await store.fetchSummary()
    expect(store.summaryItems).toHaveLength(1)
    expect(store.items).toEqual([])
    const summaryQuery = fake.getList.mock.calls[0]?.[2]
    expect(summaryQuery.fields).not.toContain('product')
    expect(summaryQuery.fields).toContain('expand.factory.region')
    await store.fetchForScope('injection', 'dongguan')
    expect(fake.getList).toHaveBeenCalledTimes(2)
    expect(fake.getList.mock.calls[1]?.[2].fields).toContain('product')
    expect(store.items).toHaveLength(1)
  })
  it('coalesces duplicate loads and reuses a fresh scope until an order is changed', async () => {
    const pending = deferred<ReturnType<typeof page>>()
    fake.getList.mockReturnValueOnce(pending.promise)
    const store = useOrdersStore()
    const first = store.fetchForScope('injection', 'dongguan')
    const second = store.fetchForScope('injection', 'dongguan')
    expect(fake.getList).toHaveBeenCalledTimes(1)
    pending.resolve(page([order('one')]))
    await Promise.all([first, second])
    await store.fetchForScope('injection', 'dongguan')
    expect(fake.getList).toHaveBeenCalledTimes(1)
    await store.update('one', { notes: 'saved' })
    await store.fetchForScope('injection', 'dongguan')
    expect(fake.getList).toHaveBeenCalledTimes(2)
    await store.fetchForScope('injection', 'dongguan', { force: true })
    expect(fake.getList).toHaveBeenCalledTimes(3)
  })
  it('does not let an older department response overwrite a newer page', async () => {
    const pending = deferred<ReturnType<typeof page>>()
    fake.getList.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(page([order('new', 'painting')]))
    const store = useOrdersStore()
    const old = store.fetchForScope('injection', 'dongguan')
    await store.fetchForScope('painting', 'dongguan')
    pending.resolve(page([order('old')]))
    await old
    expect(store.items.map((item) => item.id)).toEqual(['new'])
    expect(store.loading).toBe(false)
  })
  it('clears cached data and ignores old responses after the signed-in account changes', async () => {
    const pending = deferred<ReturnType<typeof page>>()
    const store = useOrdersStore()
    await store.fetchForScope('injection')
    fake.getList.mockReturnValueOnce(pending.promise)
    const old = store.fetchForScope('injection', null, { force: true })
    fake.record = { id: 'another-user', role: 'admin' }
    const onChange = fake.onChange.mock.calls[0]?.[0] as unknown as () => void
    onChange()
    expect(store.items).toEqual([])
    pending.resolve(page([order('old-account')]))
    await expect(old).rejects.toThrow('账号或订单数据已变更')
    expect(store.items).toEqual([])
    await store.fetchForScope('injection')
    expect(store.items.map((item) => item.id)).toEqual(['one'])
  })

  it('reloads a previous scope when another pending request has cleared its records', async () => {
    const pending = deferred<ReturnType<typeof page>>()
    const store = useOrdersStore()
    await store.fetchForScope('injection')
    fake.getList.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(page([order('fresh')]))
    const other = store.fetchForScope('painting')
    expect(store.items).toEqual([])
    await store.fetchForScope('injection')
    expect(store.items.map((item) => item.id)).toEqual(['fresh'])
    pending.resolve(page([order('other', 'painting')]))
    await other
    expect(store.items.map((item) => item.id)).toEqual(['fresh'])
  })
  it('returns the full export snapshot even when a department finishes loading first', async () => {
    const pending = deferred<ReturnType<typeof page>>()
    fake.getList.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(page([order('department', 'painting')]))
    const store = useOrdersStore()
    const exporting = store.fetchAll()
    await store.fetchForScope('painting')
    pending.resolve(page([order('one'), order('two', 'painting')]))
    const exported = await exporting
    expect(exported.map((item) => item.id)).toEqual(['one', 'two'])
    expect(store.items.map((item) => item.id)).toEqual(['department'])
  })
  it('honors management regions, restricts departments, and shows retryable loading failures', async () => {
    const store = useOrdersStore()
    setAuthorizedCrafts(['injection'])
    setPermissionOverrides({ 'region.hunan': false })
    fake.getList.mockResolvedValueOnce(page([order('visible'), order('wrong-craft', 'painting'), order('wrong-region', 'injection', 'hunan')]))
    await store.fetchForScope('injection', 'dongguan')
    expect(store.items.map((item) => item.id)).toEqual(['visible'])
    fake.getList.mockRejectedValueOnce(new Error('temporary network error'))
    await expect(store.fetchForScope('injection', 'dongguan', { force: true })).rejects.toThrow('temporary network error')
    expect(store.error).toBe('temporary network error')
    expect(store.loading).toBe(false)
    await store.fetchForScope('injection', 'dongguan', { force: true })
    expect(store.error).toBe('')
  })
})
