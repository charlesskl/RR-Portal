import { readFileSync } from 'node:fs'
import { DOMParser } from '@xmldom/xmldom'
import * as XLSX from 'xlsx'
import JSZip from 'jszip'
import { expect, it, vi } from 'vitest'
import { buildCustomsWorkbook } from './customsExport'
import { parseShipmentWorkbook } from './shipmentImport'
import { applyMergedShipmentEdits } from './shipmentMergedEditor'
import { parseSheetClipboard, sheetPasteSelectionEdits } from './shipmentSheet'
import { consolidateShipmentItems } from './shipmentConsolidation'
import { formatShipmentPallet } from './shipmentDisplay'

const pallet = '1-3/4卡\n8-9/9卡'
it.each(['1-3/4卡 8-9/9卡', ' 1-3/4卡   8-9/9卡 ', '1-3/4卡　8-9/9卡', '1-3/4卡\r\n8-9/9卡', '1-3/4卡\t8-9/9卡'])(
  '卡板空格、全角空格及旧换行分组显示为多行：%s', input => expect(formatShipmentPallet(input)).toBe(pallet))
it('卡板多行内容离格提交、复制粘贴及合并行展开均保留换行', () => {
  const materials = new Map([[1, { unit_kg: 'KGM' }]])
  const items = [1, 2].map(id => ({ _rowKey: id, material_id: 1, outbound_id: id, qty: 10, kg: 2, pallet: '旧卡板' }))
  const edits = sheetPasteSelectionEdits(parseSheetClipboard(`"${pallet}"`), { row: 0, col: 0 }, { row: 0, col: 0 }, 1, ['pallet'])
  const result = applyMergedShipmentEdits(items, materials, consolidateShipmentItems(items, materials), edits)
  expect(result.items.map(row => row.pallet)).toEqual([pallet, pallet])
  expect(items.map(row => row.pallet)).toEqual(['旧卡板', '旧卡板'])
})

it.each(['rri', 'rrm'])('真实%s完整单据导出及重新导入将卡板空格分组显示为换行，原输入不变', async customer => {
  vi.stubGlobal('DOMParser', DOMParser)
  try {
    const materials = new Map([[1, { name_zh: '卡板测试物料', product_code: 'PALLET-TEST', unit_kg: 'KGM' }]])
    const items = [{ material_id: 1, outbound_id: 1, qty: 100, kg: 10, price: 1, pallet: '1-3/4卡 8-9/9卡', currency: 'US$' }]
    const templateBuffer = Uint8Array.from(readFileSync(new URL(`../../public/template-customs-${customer}.xlsx`, import.meta.url))).buffer
    const blob = await buildCustomsWorkbook({ templateBuffer, items, materials, productHs: new Map(), images: new Map(), form: { customer: customer.toUpperCase(), containerNo: 'PALLET-TEST', rate: .93 } })
    const bytes = await blob.arrayBuffer()
    const wb = XLSX.read(bytes, { type: 'array' })
    expect(wb.Sheets['PALLET-TEST'].BC4.v).toBe(pallet)
    const zip = await JSZip.loadAsync(bytes)
    const parser = new DOMParser(), ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
    const sheetXml = parser.parseFromString(await zip.file(`xl/worksheets/sheet${wb.SheetNames.indexOf('PALLET-TEST') + 1}.xml`)!.async('string'), 'application/xml')
    const cell = Array.from(sheetXml.getElementsByTagNameNS(ns, 'c')).find(node => node.getAttribute('r') === 'BC4')!
    const styles = parser.parseFromString(await zip.file('xl/styles.xml')!.async('string'), 'application/xml')
    const xf = styles.getElementsByTagNameNS(ns, 'cellXfs')[0].getElementsByTagNameNS(ns, 'xf')[Number(cell.getAttribute('s'))]
    expect(xf.getElementsByTagNameNS(ns, 'alignment')[0]?.getAttribute('wrapText')).toBe('1')
    expect(parseShipmentWorkbook(wb).rows.find(row => row.sheet === 'PALLET-TEST')?.item.pallet).toBe(pallet)
    expect(items[0].pallet).toBe('1-3/4卡 8-9/9卡')
  } finally { vi.unstubAllGlobals() }
}, 60000)
