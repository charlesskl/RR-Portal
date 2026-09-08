import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { buildDeliveryReport, exportDeliveryExcel } from '../src/utils/deliveryStats'
import { downloadDeliveryExcel } from '../src/utils/deliveryExcelExport'
import type { DeliveryExcelRequest, DeliveryExcelResponse } from '../src/utils/deliveryExcelTypes'

class ExportWorker {
  static latest: ExportWorker
  onmessage: ((event: MessageEvent<DeliveryExcelResponse>) => void) | null = null
  onerror: (() => void) | null = null
  onmessageerror: (() => void) | null = null
  request?: DeliveryExcelRequest
  terminate = vi.fn()
  postMessage = vi.fn((request: DeliveryExcelRequest) => {
    this.request = structuredClone(request)
  })
  constructor() { ExportWorker.latest = this }
  complete() { this.onmessage?.({ data: { ok: true, buffer: new ArrayBuffer(8) } } as MessageEvent<DeliveryExcelResponse>) }
}

const NativeURL = URL
const createObjectURL = vi.fn((_blob: Blob) => 'blob:delivery-export')
const revokeObjectURL = vi.fn()

function request(): DeliveryExcelRequest {
  return {
    rows: buildDeliveryReport([{ id: 'id', factory: 'factory', product: '材料', unit_price: 0.5289 }], '范围', () => '工厂'),
    title: '报表', includeMoldNumber: true, includeContractNumber: false, pricingMode: 'hkd',
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  vi.stubGlobal('Worker', ExportWorker)
  vi.stubGlobal('URL', class extends NativeURL {
    static createObjectURL = createObjectURL
    static revokeObjectURL = revokeObjectURL
  })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('background Excel export', () => {
  it('copies reactive rows, downloads only after worker completion, and releases resources', async () => {
    const input = request()
    input.rows = reactive(input.rows)
    const pending = downloadDeliveryExcel(input)
    const worker = ExportWorker.latest
    expect(worker.request).toEqual(input)
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(worker.terminate).not.toHaveBeenCalled()
    input.rows[0]!.outPrice = 99
    expect(worker.request!.rows[0]!.outPrice).toBe(0.5289)

    worker.complete()
    await pending
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(createObjectURL.mock.calls[0]?.[0]).toBeInstanceOf(Blob)
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce()
    expect(document.querySelector('a[download]')).toBeNull()
    expect(revokeObjectURL).not.toHaveBeenCalled()
    vi.advanceTimersByTime(30_000)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:delivery-export')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps the public arguments and waits for a completed workbook', async () => {
    const input = request()
    const pending = exportDeliveryExcel(input.rows, '车缝报表', false, true)
    await vi.waitFor(() => expect(ExportWorker.latest.request?.title).toBe('车缝报表'))
    expect(ExportWorker.latest.request).toMatchObject({ includeMoldNumber: false, includeContractNumber: true, pricingMode: 'rmb-tax' })
    ExportWorker.latest.complete()
    await pending
  })

  it.each(['generation', 'script', 'message'] as const)('reports %s errors and terminates the worker', async (failure) => {
    const pending = downloadDeliveryExcel(request())
    const rejected = expect(pending).rejects.toThrow('Excel 导出')
    const worker = ExportWorker.latest
    if (failure === 'generation') worker.onmessage?.({ data: { ok: false, message: '生成失败' } } as MessageEvent<DeliveryExcelResponse>)
    else if (failure === 'script') worker.onerror?.()
    else worker.onmessageerror?.()
    await rejected
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports timeout and terminates the worker', async () => {
    const pending = downloadDeliveryExcel(request())
    const rejected = expect(pending).rejects.toThrow('导出超时')
    vi.advanceTimersByTime(120_000)
    await rejected
    expect(ExportWorker.latest.terminate).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports browsers without worker support without blocking the main thread', async () => {
    vi.stubGlobal('Worker', undefined)
    await expect(downloadDeliveryExcel(request())).rejects.toThrow('当前浏览器不支持后台导出')
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it('reports worker startup failures without starting a timeout', async () => {
    vi.stubGlobal('Worker', class {
      constructor() { throw new Error('Worker blocked') }
    })
    await expect(downloadDeliveryExcel(request())).rejects.toThrow('无法启动 Excel 后台导出')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cleans up when sending the snapshot fails', async () => {
    vi.stubGlobal('Worker', class extends ExportWorker {
      postMessage = vi.fn(() => { throw new Error('Cannot send') })
    })
    await expect(downloadDeliveryExcel(request())).rejects.toThrow('Cannot send')
    expect(ExportWorker.latest.terminate).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
})
