/**
 * 大文件解析统一入口：有 Worker 就丢给 parseSource.worker.js（XLSX.read 在后台线程跑，主线程零阻塞，
 * 页面不会再弹「无响应」）；没有 Worker（jsdom 回归测试、极端老环境）回退主线程同步解析，结果一致。
 */
import ParseWorker from './parseSource.worker.js?worker'
import { parseWorkbook, extractInvoices } from './invoice.js'
import { parseDetailWorkbook } from './otherGuests.js'

let worker = null
let seq = 0
const pending = new Map()

function getWorker() {
  if (typeof Worker === 'undefined') return null
  if (worker) return worker
  try {
    worker = new ParseWorker()
    worker.onmessage = (e) => {
      const { id, ok, result, error } = e.data || {}
      const p = pending.get(id)
      if (!p) return
      pending.delete(id)
      if (ok) p.resolve(result)
      else p.reject(new Error(error || '解析失败'))
    }
    worker.onerror = () => {
      // worker 整体挂掉：拒绝所有在途请求，后续调用走主线程兜底
      for (const p of pending.values()) p.reject(new Error('后台解析线程异常'))
      pending.clear()
      worker = null
    }
  } catch {
    worker = null
  }
  return worker
}

function run(task, buffer, fallback) {
  const w = getWorker()
  if (!w) return Promise.resolve().then(() => fallback(buffer))
  return new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    // transfer 转出 buffer：主线程不再持有，28MB 零拷贝进 worker
    w.postMessage({ id, task, buffer }, [buffer])
  })
}

// 主线程兜底实现（与 worker 内任务一一对应）
const fallbacks = {
  'zuru-source'(buf) {
    const invs = extractInvoices(parseWorkbook(buf))
    return { list: [...invs], unrecognized: invs.unrecognized || [] }
  },
  'other-detail'(buf) {
    const map = parseDetailWorkbook(buf)
    return Object.entries(map).map(([name, rows]) => ({ name, rows: [...rows], merges: rows.merges || [] }))
  },
}

/** 兴信 ZURU 源表解析 → 发票数组（带 .unrecognized），与 extractInvoices(parseWorkbook(buf)) 同形 */
export async function parseZuruSource(buffer) {
  const { list, unrecognized } = await run('zuru-source', buffer, fallbacks['zuru-source'])
  list.unrecognized = unrecognized
  return list
}

/** 其他客明细表解析 → { sheetName: rows[][] }（rows 带 .merges），与 parseDetailWorkbook(buf) 同形 */
export async function parseOtherDetail(buffer) {
  const entries = await run('other-detail', buffer, fallbacks['other-detail'])
  const map = {}
  for (const { name, rows, merges } of entries) {
    rows.merges = merges
    map[name] = rows
  }
  return map
}
