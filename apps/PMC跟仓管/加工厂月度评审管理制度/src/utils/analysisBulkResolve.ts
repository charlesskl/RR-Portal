import type { AnalysisIssue } from './dynamicAnalysis'
export function overdueMoreThan50(issue: AnalysisIssue, today: string) {
  if (!['delivery', 'correction'].includes(issue.kind)) return false
  const due = issue.date
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || !Number.isFinite(Date.parse(due)) || new Date(due).toISOString().slice(0, 10) !== due) return false
  return (Date.parse(today) - Date.parse(due)) / 86400000 > 50
}
// Small batches limit in-flight writes. Stop on failure or changed session; retry
// reloads saved followups and skips records already resolved.
export async function resolveRiskBatch<T>(items: T[], active: () => boolean, write: (item: T) => Promise<void>, progress: (done: number) => void) {
  let done = 0
  for (let offset = 0; offset < items.length && active(); offset += 4) {
    const results = await Promise.allSettled(items.slice(offset, offset + 4).map(async item => {
      if (!active()) return false
      await write(item)
      return true
    }))
    done += results.filter(r => r.status === 'fulfilled' && r.value).length
    progress(done)
    if (results.some(r => r.status === 'rejected')) return { done, failed: true, stopped: false }
  }
  return { done, failed: false, stopped: !active() }
}
