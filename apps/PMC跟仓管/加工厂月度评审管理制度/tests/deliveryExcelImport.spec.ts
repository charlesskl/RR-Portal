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
  it('imports Xingxin assembly contracts with header and footer metadata', async () => {
    const file = excelFile('东莞兴信塑胶制品有限公司.xlsx', [
      ['东莞兴信塑胶制品有限公司'],
      ['广东省东莞市清溪镇上元管理区兴信塑胶制品有限公司银坑北环路59号B栋2楼'],
      ['TEL:0769-87362376 FAX:0769-87362377'],
      ['', '', '', '委托加工合同'],
      [],
      ['厂  商：', '东莞市清溪鸿亚塑胶加工店', '', '', '', '', '订单编号：', '', 'A20260611'],
      ['联 络 人：', '张海霞', '', '', '', '', '联 络 人：', '', '杨耿生'],
      [],
      [],
      [],
      ['货 号', '货 品 名 称', '数量', '单位', '单 价(¥)', '金 额(¥)', '单重（G)', '重量（KG)', '商品名称', '备 注'],
      ['徽章制作机-JA120910100', 'UV灯盒', 7870, 'pcs', 0.95, 7476.5, '', '', '玩具半成品', ''],
      ['77858-厨房四件套', '吸塑盒配件加工', 45200, 'pcs', 0.06, 2712, '', '', '', ''],
      ['', '', '', '', '合计', 10188.5],
      ['1. 2026 年 7 月 20 日前交货、货送 B栋2楼 处'],
      [], [], [], [], [], [], [], [], [], [], [], [], [], [], [], [],
      ['供应商确认：                采购签核：      刘艳           主管：                 经理：'],
      ['时间：    年    月   日', '', '', '时间：', '2026年6月30日'],
    ])

    const result = await parseDeliveryExcelFiles(
      [file],
      { '东莞市清溪鸿亚塑胶加工厂': 'factory-assembly' },
      { preferCnyTaxPrice: true },
    )

    expect(result).toMatchObject({ fileCount: 1, failedRows: 0, unrecognizedFiles: [], readFailedFiles: [] })
    expect(result.payloads).toHaveLength(2)
    expect(result.payloads[0]).toMatchObject({
      factory: 'factory-assembly',
      pmc: '刘艳',
      item_no: '徽章制作机-JA120910100',
      order_no: 'A20260611',
      product: 'UV灯盒',
      process_category: '玩具半成品',
      quantity: 7870,
      order_date: '2026-06-30',
      delivery_date: '2026-07-20',
      unit_price_cny_tax: 0.95,
      unit_price: 0.9663,
      exchange_rate: 0.87,
      amount: 7476.5,
    })
    expect(result.payloads[1]).toMatchObject({
      pmc: '刘艳',
      item_no: '77858-厨房四件套',
      product: '吸塑盒配件加工',
      process_category: '玩具半成品',
      quantity: 45200,
      unit_price_cny_tax: 0.06,
      unit_price: 0.061,
      amount: 2712,
    })
  })

  it('imports Runzhan assembly contracts with split approval and inherited delivery date', async () => {
    const file = excelFile('润展RZ20260015.xlsx', [
      ['东莞华登塑胶制品有限公司'],
      ['广东省东莞市清溪镇上元管理区华登塑胶制品有限公司银松路1号'],
      ['TEL:0769-87362376 FAX:0769-87362377'],
      ['', '', '', '', '委托加工合同'],
      ['', '', '', '', '', '', '', '', '', '', new Date('2026-06-08T00:00:00Z')],
      ['厂    商：', '润 展', '', '', '', '', '', '', '', '订单编号：', 'RZ20260015'],
      ['联 络 人：', '', '', '', '', '', '', '', '', '联 络 人：', '肖英华'],
      [], [], [],
      ['货 号', '货品名称', '款式', '数量', '单位', '单价(RMB)含税（3%）', '金额(RMB)', '单重（G)', '商品名称', '订单数量', 'PO', '交货期'],
      ['SRMC400', '我的世界手链', 'A2', 1000, 'PCS', 0.2, 200, '', '散装手链', '', '样板', new Date('2026-07-01T00:00:00Z')],
      ['SRMC103', '我的世界手链', 'B1', 1000, 'PCS', 0.2, 200, '', '散装手链', '', '', ''],
      ['订单总数：', '', '', '', '', '合计', 400],
      ['1.2026年7月1日前交货，货送东莞清溪华登厂'],
      [], [],
      ['供应商确认：', '', '采购签核：', '张佩玲', '', '生产经理：', '', '生产经理：', '', '', '经理：'],
    ])

    const result = await parseDeliveryExcelFiles(
      [file],
      { '东莞市润展塑料制品有限公司': 'factory-runzhan' },
      { preferCnyTaxPrice: true },
    )

    expect(result).toMatchObject({ fileCount: 1, failedRows: 0, unrecognizedFiles: [], readFailedFiles: [] })
    expect(result.payloads).toHaveLength(2)
    expect(result.payloads[0]).toMatchObject({
      factory: 'factory-runzhan',
      pmc: '张佩玲',
      item_no: 'SRMC400',
      order_no: 'RZ20260015',
      product: '我的世界手链',
      process_category: '散装手链',
      quantity: 1000,
      order_date: '2026-06-08',
      delivery_date: '2026-07-01',
      unit_price_cny_tax: 0.2,
      amount: 200,
    })
    expect(result.payloads[1]).toMatchObject({
      pmc: '张佩玲',
      item_no: 'SRMC103',
      delivery_date: '2026-07-01',
    })
  })

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

    const result = await parseDeliveryExcelFiles(
      files,
      { '益正': 'factory-1', '俊豪': 'factory-2' },
      { preferCnyTaxPrice: true },
    )

    expect(result).toMatchObject({ fileCount: 2, failedRows: 0, unrecognizedFiles: [], readFailedFiles: [] })
    expect(result.payloads).toHaveLength(2)
    expect(result.payloads[0]).toMatchObject({
      factory: 'factory-1', order_no: 'ORDER-1', item_no: 'ITEM-1',
      unit_price_cny_tax: 0.2, unit_price: 0.2034,
    })
    expect(result.payloads[1]).toMatchObject({
      factory: 'factory-2', order_no: 'ORDER-2', item_no: 'ITEM-2',
      unit_price_cny_tax: 0.3, unit_price: 0.3052,
    })
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
      item_no: '',
      mold_no: 'SR800-M03',
      order_no: 'RRT-HSY26016',
      product: '兔子',
      process_category: '啤机',
      quantity: 2500,
      order_date: '2026-07-02',
      delivery_date: '2026-07-14',
      unit_price_cny_tax: 0.44,
      unit_price: 0.4476,
      amount: 1100,
    })
  })
})
