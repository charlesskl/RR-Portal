import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { parseDeliveryExcelFiles, type DeliveryExcelFile } from '../src/utils/deliveryExcelImport'

function excelFile(name: string, aoa: any[][]): DeliveryExcelFile {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Sheet1')
  const data = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  return { name, arrayBuffer: async () => data }
}

function multiSheetExcelFile(name: string, sheets: { name: string; aoa: any[][] }[]): DeliveryExcelFile {
  const wb = XLSX.utils.book_new()
  for (const sheet of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet.aoa), sheet.name)
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

  it('uses molding shots as quantity and skips empty worksheets', async () => {
    const file = multiSheetExcelFile('华盛源啤机部啤货表1.xlsx', [
      { name: '杨继琴', aoa: [] },
      { name: '谭风娟2', aoa: [
        ['东莞华登塑胶制品有限公司', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
        ['委 托 加 工 合 同', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
        ['', '供应商: ', '东莞市华盛源塑料制品有限公司', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
        ['', '编号: ', '', '公司名称: sky CastIe', '', '', '', '交货地点: 华登C仓库', '', '', '', '交货日期: 2026-07-14', '', '', '单号:', 'RRT-HSY26016', '', '', '', ''],
        ['', '款号', '模具编号', '工模名称', '数量', '总套数', '啤数', '加工单价', '加工金额', '颜色', '色粉号', '用料名称', '整啤毛重', '整啤净重', '啤机复期', '总毛重', '总净重', '水口比例', '交货日期', '备注'],
        ['', '', 'SR800-M03', '兔子', 5000, 5000, 2500, 0.44, 1100, '9285C/白色', 63509, 'ABS 750NSW', 0, 32.2, '', '', 80.5, 0.19, '2026/7/14', '喷油，合装'],
        ['', '下单日期:2026-07-02', '', '', '操作员:谭凤娟', '', '', '下单人:谭凤娟', '', '', '接单人:王炯', '', '', '', '接单日期:2026-07-02', '', '', '', '', ''],
      ] },
    ])

    const result = await parseDeliveryExcelFiles([file], { '东莞市华盛源塑料制品有限公司': 'factory-1' })

    expect(result).toMatchObject({ fileCount: 1, failedRows: 0, unrecognizedFiles: [], readFailedFiles: [] })
    expect(result.payloads).toHaveLength(1)
    expect(result.payloads[0]).toMatchObject({
      factory: 'factory-1',
      pmc: '谭凤娟',
      item_no: 'SR800-M03',
      order_no: 'RRT-HSY26016',
      product: '兔子',
      process_category: '啤机',
      quantity: 2500,
      order_date: '2026-07-02',
      delivery_date: '2026-07-14',
      unit_price: 0.44,
      amount: 1100,
    })
  })
})
