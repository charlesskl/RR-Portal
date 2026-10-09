import { expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import JSZip from 'jszip'
import { cartonLayout, sortShipmentItems, CUSTOMS_FIXED } from './shipmentOrder'
import { mergeMainCartonCells } from './customsExport'

it('组内同箱排列相邻，箱数只计算一次；相同分组标记不能跨供应商或报关公司', () => {
  const rows = [
    { material_id: 1, supplier: 'A', carton_group: 'g', cartons: 1 },
    { material_id: 2, supplier: 'A', cartons: 2 },
    { material_id: 3, supplier: 'A', carton_group: 'g', cartons: 1 },
    { material_id: 4, supplier: 'B', carton_group: 'g', cartons: 1 },
    { material_id: 5, supplier: 'A', customs_company: '其他', carton_group: 'g', cartons: 1 },
  ]
  const sorted = sortShipmentItems(rows, new Map())
  expect(sorted.map(r => r.material_id)).toEqual([1, 3, 2, 4, 5])
  const layout = cartonLayout(sorted, new Map())
  expect(layout.map(r => r.span)).toEqual([2, 0, 1, 1, 1])
  expect(layout.reduce((sum, r) => sum + r.count, 0)).toBe(5)
  expect(rows.map(r => r.material_id)).toEqual([1, 2, 3, 4, 5])
})
it('取消分组后恢复逐行箱数；不改变报关公司优先级', () => {
  const rows = [{ cartons: 1, carton_group: 'g', customs_company: 'Z' }, { cartons: 1, customs_company: CUSTOMS_FIXED }]
  expect(sortShipmentItems(rows, new Map())[0].customs_company).toBe(CUSTOMS_FIXED)
  expect(cartonLayout(rows.map(r => ({ ...r, carton_group: undefined })), new Map()).reduce((s, r) => s + r.count, 0)).toBe(2)
})
it('导出只合并 AT 箱数单元格，明细值保留，次行箱数清空以免公式重复累计', async () => {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([['标题'], [], [], ['物料甲'], ['物料乙']])
  ws.AT4 = { t: 'n', v: 1 }; ws.AT5 = { t: 'n', v: 0 }; ws['!ref'] = 'A1:AT5'
  XLSX.utils.book_append_sheet(wb, ws, '明细')
  const zip = await JSZip.loadAsync(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }))
  await mergeMainCartonCells(zip, '明细', [{ span: 2, count: 1 }, { span: 0, count: 0 }])
  const result = XLSX.read(await zip.generateAsync({ type: 'uint8array' }), { type: 'array' }).Sheets['明细']
  expect(result['!merges']).toContainEqual({ s: { r: 3, c: 45 }, e: { r: 4, c: 45 } })
  expect(result.AT4.v).toBe(1)
  expect(result.AT5?.v).toBeUndefined()
  expect(result.A5.v).toBe('物料乙')
})
