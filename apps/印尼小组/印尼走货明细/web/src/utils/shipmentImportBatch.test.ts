import { expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { importShipmentFile, parseShipmentWorkbook } from './shipmentImport'
import { shipmentImportBatches, SHIPMENT_IMPORT_BATCH_LIMIT, SHIPMENT_IMPORT_PREVIEW_LIMIT } from './shipmentImportBatch'

it('忽略与主表同格式的隐藏历史表，不把历史数据计入本柜或触发500行限制', async () => {
  const workbook = XLSX.utils.book_new()
  for (const [name, count] of [['已到ARRIVED', 480], ['SYNTHETIC-CONTAINER', 72], ['内部归档', 20]] as const)
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['货号', '产品中文名称', '送货数量'], ...Array.from({ length: count }, (_, i) => [`${name}-${i}`, '合成物料', 1]),
    ]), name)
  workbook.Workbook = { Sheets: [
    { name: '已到ARRIVED', Hidden: 1 }, { name: 'SYNTHETIC-CONTAINER', Hidden: 0 }, { name: '内部归档', Hidden: 2 },
  ] }
  const file = new File([XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })], 'hidden-history.xlsx')
  const result = await importShipmentFile(file)
  expect(result.rows).toHaveLength(72)
  expect(result.rows.every(row => row.sheet === 'SYNTHETIC-CONTAINER' && row.selected)).toBe(true)
  expect(result.warnings).toEqual(['已到ARRIVED：隐藏工作表未导入', '内部归档：隐藏工作表未导入'])
  // Visibility, not a hard-coded historical sheet name, determines inclusion.
  workbook.Workbook.Sheets![0].Hidden = 0
  expect(parseShipmentWorkbook(workbook).rows).toHaveLength(552)
})

it('多个工作表总数超过500行可完整预览，默认不自动选择部分行', async () => {
  const workbook = XLSX.utils.book_new()
  for (const name of ['柜A', '柜B']) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['货号', '产品中文名称', '送货数量'], ...Array.from({ length: 260 }, (_, i) => [`${name}-${i}`, '测试物料', 1]),
  ]), name)
  const result = await importShipmentFile(new File([XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })], 'multi.xlsx'))
  expect(result.rows).toHaveLength(520)
  expect(result.rows.some(row => row.selected)).toBe(false)
  expect(result.loadImages).toBeTypeOf('function')
  expect(result.warnings.join('')).toContain('520')
  expect(result.rows.at(-1)!.item.material_snapshot.product_code).toBe('柜B-259')
})

it('批次保留所有行与原顺序，共箱组跨边界时整体移入下一批', () => {
  const rows = Array.from({ length: 520 }, (_, i) => ({ key: String(i), item: { carton_group: i >= 499 && i <= 502 ? 'same-box' : undefined } }))
  const batches = shipmentImportBatches(rows)
  expect(batches.map(keys => keys.length)).toEqual([499, 21])
  expect(batches.flat()).toEqual(rows.map(row => row.key))
  expect(['499', '500', '501', '502'].every(key => batches[1].includes(key))).toBe(true)
})

it('无法容纳的超大共箱组显式保留而非截断', () => {
  const rows = Array.from({ length: 600 }, (_, i) => ({ key: String(i), item: { carton_group: i < 501 ? 'oversize' : undefined } }))
  const batches = shipmentImportBatches(rows)
  expect(batches.map(keys => keys.length)).toEqual([501, 99])
  expect(new Set(batches.flat()).size).toBe(600)
  expect(SHIPMENT_IMPORT_BATCH_LIMIT).toBe(500)
  expect(SHIPMENT_IMPORT_PREVIEW_LIMIT).toBeGreaterThan(SHIPMENT_IMPORT_BATCH_LIMIT)
})

it('不相邻的共箱成员不会被分到不同批次', () => {
  const rows = Array.from({ length: 520 }, (_, i) => ({ key: String(i), item: { carton_group: i === 0 || i === 519 ? 'shared' : undefined } }))
  const batches = shipmentImportBatches(rows)
  const groupBatch = batches.find(keys => keys.includes('0'))!
  expect(groupBatch).toContain('519')
  expect(batches.every(keys => keys.length <= SHIPMENT_IMPORT_BATCH_LIMIT)).toBe(true)
  expect(new Set(batches.flat()).size).toBe(520)
})

it('超过预览资源上限时明确拒绝，不静默保留前5000行', async () => {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['货号', '产品中文名称', '送货数量'], ...Array.from({ length: 5001 }, (_, i) => [`A${i}`, '物料', 1]),
  ]), '明细')
  const file = new File([XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })], 'too-many.xlsx')
  await expect(importShipmentFile(file)).rejects.toThrow('5000')
})
