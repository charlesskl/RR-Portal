import * as XLSX from 'xlsx'
import { createDeliveryWorkbook } from './deliveryWorkbook'
import type { DeliveryExcelRequest, DeliveryExcelResponse } from './deliveryExcelTypes'

self.addEventListener('message', (event: MessageEvent<DeliveryExcelRequest>) => {
  try {
    const { rows, title, includeMoldNumber, includeContractNumber, pricingMode } = event.data
    const workbook = createDeliveryWorkbook(rows, title, includeMoldNumber, includeContractNumber, pricingMode)
    const buffer: ArrayBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
    const response: DeliveryExcelResponse = { ok: true, buffer }
    self.postMessage(response, { transfer: [buffer] })
  } catch (error) {
    const response: DeliveryExcelResponse = {
      ok: false,
      message: error instanceof Error ? error.message : '无法生成 Excel 文件',
    }
    self.postMessage(response)
  }
})
