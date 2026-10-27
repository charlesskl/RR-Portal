/**
 * 大文件解析 Worker：把 XLSX.read 搬离主线程，避免 28MB 源表解析时浏览器弹「页面无响应」。
 * 由 offThreadParse.js 以 ?worker 方式加载为同源静态文件，
 * 兼容门户 CSP 的 script-src self，避免 Blob Worker 被阻止。
 *
 * 注意：structured clone 只复制数组的索引元素，挂在数组上的额外属性会丢，
 * 所以 unrecognized / rows.merges 这类附加属性都要拆开回传，由调用方重新挂上。
 */
import { parseWorkbook, extractInvoices } from './invoice.js'
import { parseDetailWorkbook } from './otherGuests.js'

const tasks = {
  // 兴信 ZURU 源表 → 发票列表
  'zuru-source'(buffer) {
    const invs = extractInvoices(parseWorkbook(buffer))
    return { list: [...invs], unrecognized: invs.unrecognized || [] }
  },
  // 其他客明细表 → { name, rows, merges } 列表
  'other-detail'(buffer) {
    const map = parseDetailWorkbook(buffer)
    return Object.entries(map).map(([name, rows]) => ({ name, rows: [...rows], merges: rows.merges || [] }))
  },
}

self.onmessage = (e) => {
  const { id, task, buffer } = e.data || {}
  try {
    if (!tasks[task]) throw new Error(`未知解析任务：${task}`)
    self.postMessage({ id, ok: true, result: tasks[task](buffer) })
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) })
  }
}
