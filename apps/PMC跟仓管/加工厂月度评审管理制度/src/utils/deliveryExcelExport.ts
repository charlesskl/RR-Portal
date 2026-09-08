import type { ReportRow } from './deliveryStats'
import type { DeliveryExcelRequest, DeliveryExcelResponse } from './deliveryExcelTypes'

// ReportRow 的字段均为基础值。逐项提取，避免把 Vue Proxy 或额外的响应式对象传给 Worker。
function snapshotRows(rows: ReportRow[]): ReportRow[] {
  return rows.map((row) => {
    const metrics = {
      orderCount: row.orderCount,
      delayedCount: row.delayedCount,
      delayRatio: row.delayRatio,
      delayAvg: row.delayAvg,
      inspect: row.inspect,
      qualified: row.qualified,
      passRate: row.passRate,
      returnCount: row.returnCount,
      custPassRate: row.custPassRate,
      quote: row.quote,
      outPrice: row.outPrice,
      outPriceCnyTax: row.outPriceCnyTax,
      priceRatio: row.priceRatio,
    }
    if (row.kind === 'subtotal') return { kind: 'subtotal', factory: row.factory, ...metrics }
    return {
      kind: 'detail',
      id: row.id,
      range: row.range,
      pmc: row.pmc,
      factory: row.factory,
      item_no: row.item_no,
      mold_no: row.mold_no,
      order_no: row.order_no,
      category: row.category,
      product: row.product,
      quantity: row.quantity,
      order_date: row.order_date,
      delivery_date: row.delivery_date,
      actual_delivery_date: row.actual_delivery_date,
      delay_days: row.delay_days,
      exchangeRate: row.exchangeRate,
      taxPoint: row.taxPoint,
      notes: row.notes,
      rangeSpan: row.rangeSpan,
      pmcSpan: row.pmcSpan,
      factorySpan: row.factorySpan,
      ...metrics,
    }
  })
}

function generateInWorker(request: DeliveryExcelRequest): Promise<ArrayBuffer> {
  if (typeof Worker === 'undefined') {
    return Promise.reject(new Error('当前浏览器不支持后台导出，请使用新版 Chrome 或 Edge 重试。'))
  }
  return new Promise((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('./deliveryExcel.worker.ts', import.meta.url), { type: 'module' })
    } catch {
      reject(new Error('无法启动 Excel 后台导出，请刷新页面或使用新版浏览器重试。'))
      return
    }
    const cleanup = () => {
      clearTimeout(timeout)
      worker.terminate()
    }
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('Excel 导出超时，请缩小日期范围后重试。'))
    }, 120_000)

    worker.onmessage = (event: MessageEvent<DeliveryExcelResponse>) => {
      cleanup()
      if (event.data.ok) resolve(event.data.buffer)
      else reject(new Error(`Excel 导出失败：${event.data.message}`))
    }
    worker.onerror = () => {
      cleanup()
      reject(new Error('Excel 导出失败，请刷新页面后重试。'))
    }
    worker.onmessageerror = () => {
      cleanup()
      reject(new Error('Excel 导出数据传输失败，请重试。'))
    }
    try {
      worker.postMessage({ ...request, rows: snapshotRows(request.rows) })
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}

export async function downloadDeliveryExcel(request: DeliveryExcelRequest): Promise<void> {
  const buffer = await generateInWorker(request)
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${request.title}.xlsx`
  document.body.appendChild(link)
  try {
    link.click()
  } finally {
    link.remove()
    // 保留短暂下载窗口，兼容尚未开始读取 Blob 的浏览器。
    setTimeout(() => URL.revokeObjectURL(url), 30_000)
  }
}
