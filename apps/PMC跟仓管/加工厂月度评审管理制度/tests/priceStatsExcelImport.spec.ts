import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { matchPriceImportRows, parsePriceStatsExcel } from '../src/utils/priceStatsExcelImport'

function excelFile(aoa: unknown[][]) {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(aoa), '外发-工价表')
  const data = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  return { name: '核价.xlsx', arrayBuffer: async () => data }
}

describe('price stats Excel import', () => {
  it('识别核价列并跳过空行', async () => {
    const parsed = await parsePriceStatsExcel(excelFile([
      ['车缝-外发产品单价统计表'],
      ['加工厂名称', '加工类别', '货号', '工序名称', '价格管理'],
      ['', '', '', '', '核价生产工价\n（不含税￥）'],
      ['大竹东俊', '车缝', '15752', '咖啡猫', '￥ 2.75'],
      ['', '', '', '', ''],
    ]))
    expect(parsed.rows).toEqual([expect.objectContaining({
      factory: '大竹东俊', itemNo: '15752', product: '咖啡猫', quoteLaborPrice: 2.75,
    })])
    expect(parsed.invalidRows).toBe(0)
  })

  it('用货号后段+工序名称匹配，并更新所有同款订单', () => {
    const orders = [
      { id: '1', factory: 'f1', item_no: 'MA-RR-2238/15752', product: '咖啡猫', expand: { factory: { name: '大竹东俊', craft: 'sewing' } } },
      { id: '2', factory: 'f1', item_no: 'MA-RR-2238/15752', product: '咖啡猫', expand: { factory: { name: '大竹东俊', craft: 'sewing' } } },
    ] as any[]
    const matched = matchPriceImportRows([{
      sheet: 'Sheet1', rowNumber: 3, factory: '大竹东俊加工厂', itemNo: '15752', product: '咖啡猫', quoteLaborPrice: 2.75,
    }], orders)
    expect(matched.matchedRows).toBe(1)
    expect(matched.updates.map((update) => update.order.id)).toEqual(['1', '2'])
  })

  it('不使用加工厂名称匹配，同货号同工序会跨工厂更新', () => {
    const orders = [
      { id: '1', factory: 'f1', item_no: 'MA-RR-2238/15752', product: '咖啡猫', expand: { factory: { name: '大竹东俊', craft: 'sewing' } } },
      { id: '2', factory: 'f2', item_no: 'MA-RR-2239/15752', product: '咖啡猫', expand: { factory: { name: '康乐', craft: 'sewing' } } },
    ] as any[]
    const matched = matchPriceImportRows([{
      sheet: 'Sheet1', rowNumber: 3, factory: '不参与匹配', itemNo: '15752', product: '咖啡猫', quoteLaborPrice: 2.75,
    }], orders)
    expect(matched.updates.map((update) => update.order.id)).toEqual(['1', '2'])
  })

  it('没有加工厂列也能识别 Excel', async () => {
    const parsed = await parsePriceStatsExcel(excelFile([
      ['货号', '工序名称', '核价生产工价（不含税￥）'],
      [15752, '咖啡猫', 2.75],
    ]))
    expect(parsed.rows).toEqual([expect.objectContaining({
      factory: '', itemNo: '15752', product: '咖啡猫', quoteLaborPrice: 2.75,
    })])
  })

  it('不会将同货号的不同工序写错', () => {
    const orders = [
      { id: '1', factory: 'f1', item_no: '15752', product: '咖啡猫', expand: { factory: { name: '大竹东俊', craft: 'sewing' } } },
      { id: '2', factory: 'f1', item_no: '15752', product: '布偶猫', expand: { factory: { name: '大竹东俊', craft: 'sewing' } } },
    ] as any[]
    const matched = matchPriceImportRows([{
      sheet: 'Sheet1', rowNumber: 3, factory: '大竹东俊', itemNo: '15752', product: '布偶猫', quoteLaborPrice: 2.68,
    }], orders)
    expect(matched.updates.map((update) => update.order.id)).toEqual(['2'])
  })

  it('同一记录在 Excel 中出现不同核价时不写入', () => {
    const orders = [{
      id: '1', factory: 'f1', item_no: '15752', product: '咖啡猫',
      expand: { factory: { name: '大竹东俊', craft: 'sewing' } },
    }] as any[]
    const base = { sheet: 'Sheet1', factory: '大竹东俊', itemNo: '15752', product: '咖啡猫' }
    const matched = matchPriceImportRows([
      { ...base, rowNumber: 3, quoteLaborPrice: 2.75 },
      { ...base, rowNumber: 4, quoteLaborPrice: 2.8 },
    ], orders)
    expect(matched.updates).toEqual([])
    expect(matched.conflictingRows).toHaveLength(1)
  })
})
