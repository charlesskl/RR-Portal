import { describe, expect, it, vi } from 'vitest'
import { deleteOrdersInBatches } from '../src/utils/bulkOrderDelete'

function deferred() {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('deleteOrdersInBatches', () => {
  it('deduplicates IDs while preserving order and reports completed attempts', async () => {
    const remove = vi.fn().mockResolvedValue(undefined)
    const onProgress = vi.fn()
    const result = await deleteOrdersInBatches(['b', 'a', 'b', 'c', 'a'], remove, { onProgress })

    expect(remove.mock.calls.map(([id]) => id)).toEqual(['b', 'a', 'c'])
    expect(result).toEqual({ deletedIds: ['b', 'a', 'c'], failedIds: [], skippedIds: [], errors: [] })
    expect(onProgress.mock.calls).toEqual([[0, 3], [1, 3], [2, 3], [3, 3]])
  })

  it('keeps at most three requests in flight and preserves result order despite out-of-order completion', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    const gates = Object.fromEntries(ids.map((id) => [id, deferred()]))
    let active = 0
    let maximum = 0
    const remove = vi.fn(async (id: string) => {
      active++
      maximum = Math.max(maximum, active)
      try { await gates[id]!.promise } finally { active-- }
    })
    const pending = deleteOrdersInBatches(ids, remove)
    expect(remove.mock.calls.map(([id]) => id)).toEqual(['a', 'b', 'c'])

    for (const [id, count] of [['c', 4], ['b', 5], ['d', 6], ['a', 7]] as const) {
      gates[id]!.resolve()
      await vi.waitFor(() => expect(remove).toHaveBeenCalledTimes(count))
      expect(active).toBeLessThanOrEqual(3)
    }
    gates.g!.resolve()
    gates.f!.resolve()
    gates.e!.resolve()
    expect(await pending).toEqual({ deletedIds: ids, failedIds: [], skippedIds: [], errors: [] })
    expect(maximum).toBe(3)
    expect(active).toBe(0)
  })

  it('continues after individual failures, deduplicates messages, and keeps 404 as a failure', async () => {
    const remove = vi.fn(async (id: string) => {
      if (id === 'missing') throw { status: 404, response: { message: '记录不存在' }, message: 'Request failed' }
      if (id === 'denied-1') throw { response: { message: '没有删除权限' }, message: 'Request failed' }
      if (id === 'denied-2') throw new Error('没有删除权限')
      if (id === 'network') throw { response: { message: '' }, message: '网络中断' }
    })
    const onProgress = vi.fn()
    const result = await deleteOrdersInBatches(['missing', 'ok-1', 'denied-1', 'denied-2', 'network', 'ok-2'], remove, { onProgress })

    expect(result).toEqual({
      deletedIds: ['ok-1', 'ok-2'],
      failedIds: ['missing', 'denied-1', 'denied-2', 'network'],
      skippedIds: [],
      errors: ['记录不存在', '没有删除权限', '网络中断'],
    })
    expect(remove).toHaveBeenCalledTimes(6)
    expect(onProgress).toHaveBeenLastCalledWith(6, 6)
  })

  it('stops starting requests after cancellation while waiting for every started request', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e']
    const gates = Object.fromEntries(ids.map((id) => [id, deferred()]))
    let shouldContinue = true
    const remove = vi.fn((id: string) => gates[id]!.promise)
    const onProgress = vi.fn()
    let finished = false
    const pending = deleteOrdersInBatches(ids, remove, { shouldContinue: () => shouldContinue, onProgress })
      .then((result) => { finished = true; return result })
    expect(remove).toHaveBeenCalledTimes(3)
    shouldContinue = false
    gates.b!.resolve()
    await vi.waitFor(() => expect(onProgress).toHaveBeenLastCalledWith(1, 5))
    expect(finished).toBe(false)
    expect(remove).toHaveBeenCalledTimes(3)

    // A later change cannot restart a cancelled batch.
    shouldContinue = true
    gates.a!.reject(new Error('删除失败'))
    gates.c!.resolve()
    expect(await pending).toEqual({
      deletedIds: ['b', 'c'], failedIds: ['a'], skippedIds: ['d', 'e'], errors: ['删除失败'],
    })
    expect(remove.mock.calls.map(([id]) => id)).toEqual(['a', 'b', 'c'])
    expect(onProgress).toHaveBeenLastCalledWith(3, 5)
  })

  it('checks continuation separately before each of the initial concurrent requests', async () => {
    const first = deferred()
    const remove = vi.fn(() => first.promise)
    const shouldContinue = vi.fn().mockReturnValueOnce(true).mockReturnValue(false)
    const pending = deleteOrdersInBatches(['a', 'b', 'c'], remove, { shouldContinue })
    expect(remove.mock.calls).toEqual([['a']])
    expect(shouldContinue).toHaveBeenCalledTimes(2)
    first.resolve()
    expect(await pending).toEqual({ deletedIds: ['a'], failedIds: [], skippedIds: ['b', 'c'], errors: [] })
  })

  it('skips all IDs when cancelled immediately', async () => {
    const remove = vi.fn().mockResolvedValue(undefined)
    const shouldContinue = vi.fn().mockReturnValue(false)
    expect(await deleteOrdersInBatches(['b', 'a', 'b'], remove, { shouldContinue })).toEqual({
      deletedIds: [], failedIds: [], skippedIds: ['b', 'a'], errors: [],
    })
    expect(remove).not.toHaveBeenCalled()
    expect(shouldContinue).toHaveBeenCalledOnce()
  })

  it('handles an empty batch without issuing requests', async () => {
    const remove = vi.fn()
    const onProgress = vi.fn()
    expect(await deleteOrdersInBatches([], remove, { onProgress })).toEqual({
      deletedIds: [], failedIds: [], skippedIds: [], errors: [],
    })
    expect(remove).not.toHaveBeenCalled()
    expect(onProgress).toHaveBeenCalledExactlyOnceWith(0, 0)
  })
})
