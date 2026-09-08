import { parseDeliveryImport } from './deliveryStats'
import { applyCnyTaxPrice } from './orderPricing'
import { resolveFactoryName } from './factoryName'

export interface DeliveryExcelFile {
  name: string
  arrayBuffer: () => Promise<ArrayBuffer>
}

export interface DeliveryExcelBatchResult {
  fileCount: number
  payloads: Record<string, any>[]
  sources: string[]
  failedRows: number
  unrecognizedFiles: string[]
  readFailedFiles: string[]
}

export interface DeliveryExcelImportOptions {
  preferCnyTaxPrice?: boolean
}

export const UNMATCHED_IMPORT_FACTORY_PREFIX = '__unmatched_factory__:'

function factoryMapWithDraftPlaceholders(aoa: any[][], factoryIdByName: Record<string, string>) {
  const next = { ...factoryIdByName }
  const registeredFactories = Object.entries(factoryIdByName).map(([name, id]) => ({ name, id }))
  for (const row of aoa) {
    for (let index = 0; index < row.length; index++) {
      const text = String(row[index] ?? '').trim()
      const compact = text.replace(/\s+/g, '')
      const match = compact.match(/^(加工厂|供应商|厂商)[:：]?(.*)$/)
      if (!match) continue
      let name = match[2].trim()
      if (!name) {
        for (let nextIndex = index + 1; nextIndex < row.length; nextIndex++) {
          name = String(row[nextIndex] ?? '').trim()
          if (name) break
        }
      }
      if (name && !next[name] && resolveFactoryName(registeredFactories, name).status !== 'matched') {
        next[name] = `${UNMATCHED_IMPORT_FACTORY_PREFIX}${name}`
      }
    }
  }
  return next
}

export async function parseDeliveryExcelFiles(
  files: DeliveryExcelFile[],
  factoryIdByName: Record<string, string>,
  options: DeliveryExcelImportOptions = {},
): Promise<DeliveryExcelBatchResult> {
  const result: DeliveryExcelBatchResult = {
    fileCount: files.length,
    payloads: [],
    sources: [],
    failedRows: 0,
    unrecognizedFiles: [],
    readFailedFiles: [],
  }

  const XLSX = await import('xlsx')
  for (const file of files) {
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true })
      let recognized = false
      const visibleSheetNames = wb.SheetNames.filter((sheetName) => {
        const metadata = wb.Workbook?.Sheets?.find((entry) => entry.name === sheetName)
        return !metadata?.Hidden
      })
      // 采购单常会保留隐藏的旧版工作表；导入应以用户当前可见的表为准。
      // 如果异常文件没有任何可见表，仍回退尝试全部表，保持兼容。
      const sheetNames = visibleSheetNames.length ? visibleSheetNames : wb.SheetNames
      for (const sheetName of sheetNames) {
        const sheet = wb.Sheets[sheetName]
        if (!sheet) continue
        const aoa = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: '' })
        // 草稿阶段保留“工厂名未匹配”的明细，让用户在预览表中手动选择，
        // 而不是像旧流程一样直接丢弃这些行。
        const parsed = parseDeliveryImport(aoa, factoryMapWithDraftPlaceholders(aoa, factoryIdByName))
        if (!parsed.payloads.length && !parsed.failed) continue
        result.failedRows += parsed.failed
        result.payloads.push(...parsed.payloads.map((payload) =>
          applyCnyTaxPrice(payload, options.preferCnyTaxPrice)))
        result.sources.push(...parsed.payloads.map(() => `${file.name} · ${sheetName}`))
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
