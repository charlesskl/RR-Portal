export interface BulkOrderDeleteOptions {
  /** 已完成的请求数（成功或失败）与去重后的总数；未启动的取消项不计入 completed。 */
  onProgress?: (completed: number, total: number) => void
  shouldContinue?: () => boolean
}

export interface BulkOrderDeleteResult {
  deletedIds: string[]
  failedIds: string[]
  skippedIds: string[]
  errors: string[]
}

function errorMessage(error: unknown): string {
  const detail = error as { response?: { message?: unknown }; message?: unknown } | null | undefined
  const messages = [detail?.response?.message, detail?.message, error]
  for (const message of messages) {
    if (typeof message === 'string' && message.trim()) return message.trim()
  }
  return '删除失败，请重试。'
}

export async function deleteOrdersInBatches(
  ids: readonly string[],
  remove: (id: string) => Promise<unknown>,
  options: BulkOrderDeleteOptions = {},
): Promise<BulkOrderDeleteResult> {
  const uniqueIds = [...new Set(ids)]
  const outcomes: ('deleted' | 'failed' | undefined)[] = new Array(uniqueIds.length)
  const errorsByIndex: (string | undefined)[] = new Array(uniqueIds.length)
  let cursor = 0
  let completed = 0
  let cancelled = false
  options.onProgress?.(completed, uniqueIds.length)

  async function consume() {
    while (!cancelled && cursor < uniqueIds.length) {
      // 取消后锁定本批次，已启动的请求仍等待结果；不再启动其余请求。
      if (options.shouldContinue?.() === false) {
        cancelled = true
        return
      }
      const index = cursor++
      try {
        await remove(uniqueIds[index]!)
        outcomes[index] = 'deleted'
      } catch (error) {
        outcomes[index] = 'failed'
        errorsByIndex[index] = errorMessage(error)
      }
      completed++
      options.onProgress?.(completed, uniqueIds.length)
    }
  }

  await Promise.all(Array.from({ length: Math.min(3, uniqueIds.length) }, () => consume()))
  return {
    deletedIds: uniqueIds.filter((_, index) => outcomes[index] === 'deleted'),
    failedIds: uniqueIds.filter((_, index) => outcomes[index] === 'failed'),
    skippedIds: uniqueIds.filter((_, index) => outcomes[index] === undefined),
    errors: [...new Set(errorsByIndex.filter((message): message is string => message !== undefined))],
  }
}
