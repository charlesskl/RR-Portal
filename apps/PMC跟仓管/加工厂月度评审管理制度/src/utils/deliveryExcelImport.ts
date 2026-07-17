import * as XLSX from 'xlsx'
import { parseDeliveryImport } from './deliveryStats'

export interface DeliveryExcelFile {
  name: string
  arrayBuffer: () => Promise<ArrayBuffer>
}

export interface DeliveryExcelBatchResult {
  fileCount: number
  payloads: Record<string, any>[]
  failedRows: number
  unrecognizedFiles: string[]
  readFailedFiles: string[]
}

export async function parseDeliveryExcelFiles(
  files: DeliveryExcelFile[],
  factoryIdByName: Record<string, string>,
): Promise<DeliveryExcelBatchResult> {
  const result: DeliveryExcelBatchResult = {
    fileCount: files.length,
    payloads: [],
    failedRows: 0,
    unrecognizedFiles: [],
    readFailedFiles: [],
  }

  for (const file of files) {
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true })
      let recognized = false
      for (const sheetName of wb.SheetNames) {
        const sheet = wb.Sheets[sheetName]
        if (!sheet) continue
        const aoa = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: '' })
        const parsed = parseDeliveryImport(aoa, factoryIdByName)
        if (!parsed.payloads.length && !parsed.failed) continue
        result.failedRows += parsed.failed
        result.payloads.push(...parsed.payloads)
        recognized = true
        break
      }
      if (!recognized) result.unrecognizedFiles.push(file.name)
    } catch (error) {
      console.error(`Excel 读取失败: ${file.name}`, error)
      result.readFailedFiles.push(file.name)
    }
  }

  return result
}
