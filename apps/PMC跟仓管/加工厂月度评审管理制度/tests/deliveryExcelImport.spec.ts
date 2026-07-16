import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { parseDeliveryExcelFiles, type DeliveryExcelFile } from '../src/utils/deliveryExcelImport'

function excelFile(name: string, aoa: any[][]): DeliveryExcelFile {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Sheet1')
  const data = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  return { name, arrayBuffer: async () => data }
}

describe('parseDeliveryExcelFiles', () => {
  it('parses multiple workbooks in one batch without mixing their metadata', async () => {
    const header = ['序号', '款号', '模具编号', '物料编号', '物料名称', '用料名称', '颜色', '加工内容', '数量', '单价', '金额', '备注']
    const files = [
      excelFile('one.xlsx', [
        ['塑胶发外加工采购单'],
        ['加工厂：益正', '', '', '日期：2026-07-02 交货日期：2026-07-23', '', '', '', '', '', '', '单号：ORDER-1'],
        header,
        ['1', 'ITEM-1', '', '', '产品1', '', '', '印喷', '100', '0.2', '20', ''],
      ]),
      excelFile('two.xlsx', [
        ['塑胶发外加工采购单'],
        ['加工厂：俊豪', '', '', '日期：2026-07-03 交货日期：2026-07-24', '', '', '', '', '', '', '单号：ORDER-2'],
        header,
        ['1', 'ITEM-2', '', '', '产品2', '', '', '啤机', '200', '0.3', '60', ''],
      ]),
    ]

    const result = await parseDeliveryExcelFiles(files, { '益正': 'factory-1', '俊豪': 'factory-2' })

    expect(result).toMatchObject({ fileCount: 2, failedRows: 0, unrecognizedFiles: [], readFailedFiles: [] })
    expect(result.payloads).toHaveLength(2)
    expect(result.payloads[0]).toMatchObject({ factory: 'factory-1', order_no: 'ORDER-1', item_no: 'ITEM-1' })
    expect(result.payloads[1]).toMatchObject({ factory: 'factory-2', order_no: 'ORDER-2', item_no: 'ITEM-2' })
  })
})
