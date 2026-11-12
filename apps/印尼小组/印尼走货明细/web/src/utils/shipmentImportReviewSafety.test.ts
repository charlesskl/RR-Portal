import { readFileSync } from 'node:fs'
import * as XLSX from 'xlsx'
import { expect, it, vi } from 'vitest'
import JSZip from 'jszip'
import { DOMParser } from '@xmldom/xmldom'
import { applyShipmentImport } from './shipmentImportApply'
import { consolidateShipmentItems } from './shipmentConsolidation'
import { buildCustomsWorkbook } from './customsExport'
import { shipmentPurchaseAmount } from './shipmentPurchase'
import { applyMergedShipmentEdits } from './shipmentMergedEditor'
import { applyShipmentSheetEdits } from './shipmentSheet'
import type { Material } from '../api/client'
import { importShipmentFile, matchShipmentMaterial, parseShipmentWorkbook, planShipmentImport } from './shipmentImport'
import { toolImportDefaults } from './toolImportDefaults'

const material: Material = { id: 137, product_code: 'REVIEW1048', name_zh: '测试物料',
  supplier: '测试供应商', spec: 'R1048', unit_kg: 'PCE', hs_cn: '', hs_id: '', net_per_pc: 1 }
const old = { _rowKey: 1, material_id: 137, outbound_id: 70, qty: 10, kg: 10, cartons: 1,
  price: 1, currency: 'US$', supplier: material.supplier, po_no: 'REVIEW1048-PO', customs_company: '测试公司' }
const materials = new Map([[137, material]])

it('packing import preserves the existing product-level HS fallback of a linked ordinary row', async () => {
  const incoming = { material_snapshot: { ...material, length: 25 }, po_no: old.po_no,
    supplier: old.supplier, customs_company: old.customs_company, cartons: 2 }
  const [updated] = applyShipmentImport([old], materials, [incoming], [0])
  const next = { ...updated, material_id: -1 }
  const templateBuffer = Uint8Array.from(readFileSync(new URL('../../public/template-customs-rrm.xlsx', import.meta.url))).buffer
  const exportCodes = async (items: any[], map: Map<number, Material>) => {
    const blob = await buildCustomsWorkbook({ templateBuffer, items, materials: map,
      productHs: new Map([['REVIEW1048', { hsCN: '0012345678', hsID: '00123456' }]]),
      images: new Map(), form: { customer: 'RRM', containerNo: 'REVIEW1048', rate: 1 } })
    const wb = XLSX.read(await blob.arrayBuffer(), { type: 'array' })
    return [wb.Sheets.REVIEW1048.B4?.v || '', wb.Sheets.REVIEW1048.C4?.v || '']
  }
  expect(await exportCodes([old], materials)).toEqual(['0012345678', '00123456'])
  expect(await exportCodes([next], new Map([[-1, updated.material_snapshot!]]))).toEqual(['0012345678', '00123456'])
}, 60000)

it('snapshot and ordinary rows with different HS fallback semantics do not consolidate', () => {
  const snapshot = { ...old, _rowKey: 2, material_id: -2, outbound_id: 71, material_snapshot: { ...material } }
  const map = new Map([...materials, [-2, snapshot.material_snapshot]] as const)
  expect(consolidateShipmentItems([old, snapshot], map)).toHaveLength(2)
})

it('fallback metadata survives JSON storage; explicit HS clear remains blank across edits and another import', async () => {
  const incoming = { material_snapshot: { ...material, length: 25 }, po_no: old.po_no, supplier: old.supplier }
  const [updated] = applyShipmentImport([old], materials, [incoming], [0])
  const next = JSON.parse(JSON.stringify({ ...updated, material_id: -1 }))
  expect(next.material_snapshot.shipment_hs_product_fallback).toBe(true)
  expect(next.material_snapshot.hs_id).toBeUndefined()
  const edited = applyShipmentSheetEdits([next], new Map([[-1, next.material_snapshot]]), [
    { row: 0, field: 'snapshot:hs_id', value: '' },
  ])
  const [reimported] = applyShipmentImport(edited.items, edited.materials, [{ ...incoming, cartons: 3 }], [0])
  expect(reimported.material_snapshot!.hs_id).toBe('')
  expect(reimported.material_snapshot!.hs_cn).toBeUndefined()
  const templateBuffer = Uint8Array.from(readFileSync(new URL('../../public/template-customs-rrm.xlsx', import.meta.url))).buffer
  const blob = await buildCustomsWorkbook({ templateBuffer, items: [reimported],
    materials: new Map([[-1, reimported.material_snapshot!]]),
    productHs: new Map([['REVIEW1048', { hsCN: '0012345678', hsID: '00123456' }]]),
    images: new Map(), form: { customer: 'RRM', containerNo: 'REVIEW1048-CLEAR', rate: 1 } })
  const sheet = XLSX.read(await blob.arrayBuffer(), { type: 'array' }).Sheets['REVIEW1048-CLEAR']
  expect(sheet.B4?.v).toBe('0012345678')
  expect(sheet.C4?.v || '').toBe('')
}, 60000)

it('inherited and ordinary rows can consolidate only when their actual code and fallback modes agree', () => {
  const [updated] = applyShipmentImport([old], materials, [{ material_snapshot: { ...material, length: 25 }, po_no: old.po_no,
    supplier: old.supplier }], [0])
  const linked = { ...updated, material_id: -1 }
  const ordinary = { ...old, _rowKey: 2, outbound_id: 71 }
  const map = new Map([[137, { ...material, length: 25 }], [-1, updated.material_snapshot!]])
  expect(consolidateShipmentItems([linked, ordinary], map)).toHaveLength(1)
  const explicit = { ...linked, material_snapshot: { ...linked.material_snapshot, hs_cn: '' } }
  map.set(-1, explicit.material_snapshot)
  expect(consolidateShipmentItems([explicit, ordinary], map)).toHaveLength(2)
})

it('matching explicit HS codes do not prevent a confirmed snapshot and ordinary batch from consolidating', () => {
  const coded = { ...material, hs_cn: '0012345678', hs_id: '00123456' }
  const snapshot = { ...old, _rowKey: 2, material_id: -2, outbound_id: 71, material_snapshot: coded }
  expect(consolidateShipmentItems([old, snapshot], new Map([[137, coded], [-2, coded]]))).toHaveLength(1)
})

it('actual file read/defaults pipeline does not overwrite linked local packing and customs values for blank file cells', () => {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['货号', '产品中文名称', '规格', '供应商', '采购单号', '箱长', '箱宽', '报关公司', '产品英文名称', '套公式名称栏'],
    ['REVIEW1048', '测试物料', 'R1048', '测试供应商', old.po_no, '', '', '', '', ''],
  ]), 'REVIEW1048')
  const file = parseShipmentWorkbook(wb).rows[0].item
  const master = { ...material, length: 10, width: 10, name_en: 'Master English', customs_company: '主档报关公司',
    gross_per_pc: 1, weight_per_carton: 10, image: 'master-image' }
  const enriched = toolImportDefaults(matchShipmentMaterial(file.material_snapshot, [master]).material,
    { hs: [], suppliers: [], translations: [] }).material
  const incoming = { ...file, material_snapshot: enriched, customs_company: file.customs_company || enriched.customs_company }
  const snapshot = { ...master, length: 25, width: 35, name_en: '本单英文', hs_cn: '0012345678',
    gross_per_pc: 2, weight_per_carton: 20, image: 'local-image' }
  const current = { ...old, material_id: -1, material_snapshot: snapshot, customs_company: '本单报关公司', formula_name: '本单公式', weighing_qty: 8 }
  const [next] = applyShipmentImport([current], new Map([[-1, snapshot]]), [incoming], [0])
  expect(next.customs_company).toBe('本单报关公司')
  expect(next.formula_name).toBe('本单公式')
  expect(next.weighing_qty).toBe(8)
  expect(next.material_snapshot).toMatchObject({ length: 25, width: 35, name_en: '本单英文', hs_cn: '0012345678',
    gross_per_pc: 2, weight_per_carton: 20, image: 'local-image' })
  expect(next._fileFields).toBeUndefined(); expect(next._fileMaterialFields).toBeUndefined()
})

it('actual numeric normalization preserves linked explicit zeros, ignores errored cells, and keeps legacy unlinked weighing', () => {
  const wb = XLSX.utils.book_new(), sheet = XLSX.utils.aoa_to_sheet([
    ['货号', '产品中文名称', '规格', '供应商', '采购单号', '箱长', '箱宽', '称重数量', '单个毛重', '每箱重量', '箱数', '报关公司', '套公式名称栏'],
    ['REVIEW1048', '测试物料', 'R1048', '测试供应商', old.po_no, 0, '', 0, 2, 0, 0, '新报关公司', '新公式'],
  ])
  sheet.G2 = { t: 'e', v: 15, w: '#VALUE!', f: '1/0' }
  XLSX.utils.book_append_sheet(wb, sheet, 'REVIEW1048')
  const file = parseShipmentWorkbook(wb).rows[0].item
  expect(file.weighing_qty).toBe(1) // The existing new/unlinked-row suggestion remains unchanged.
  const master = { ...material, length: 10, width: 10 }
  const enriched = matchShipmentMaterial(file.material_snapshot, [master]).material
  const incoming = { ...file, material_snapshot: enriched }
  const snapshot = { ...master, length: 25, width: 35 }
  const current = { ...old, material_id: -1, material_snapshot: snapshot, weighing_qty: 8 }
  const [next] = applyShipmentImport([current], new Map([[-1, snapshot]]), [incoming], [0])
  expect(next).toMatchObject({ cartons: 0, weighing_qty: 0, customs_company: '新报关公司', formula_name: '新公式', qty: 10, kg: 10, price: 1 })
  expect(next.material_snapshot).toMatchObject({ length: 0, width: 35, gross_per_pc: 2, weight_per_carton: 0 })
  expect(next._fileWeighingQty).toBeUndefined()
  const [appended] = applyShipmentImport([], materials, [incoming], [-1])
  expect(appended.weighing_qty).toBe(1)
  expect(appended._fileFields).toBeUndefined(); expect(appended._fileMaterialFields).toBeUndefined(); expect(appended._fileWeighingQty).toBeUndefined()
})

it.each(['supplier', 'spec', 'product_code'] as const)('blank file %s does not let a master default choose a historical linked variant', field => {
  const headers = ['货号', '产品中文名称', '规格', '供应商', '采购单号']
  const values = ['REVIEW1048', '测试物料', 'R1048', '测试供应商', old.po_no]
  values[{ product_code: 0, spec: 2, supplier: 3 }[field]] = ''
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, values]), 'REVIEW1048')
  const file = parseShipmentWorkbook(wb).rows[0].item
  const enriched = matchShipmentMaterial(file.material_snapshot, [material]).material
  const incoming = { ...file, material_snapshot: enriched, supplier: file.supplier || enriched.supplier }
  const rows = [material, { ...material, [field]: '历史另一值' }].map((snapshot, index) => ({ ...old,
    material_id: -(index + 1), outbound_id: 70 + index, material_snapshot: snapshot, supplier: snapshot.supplier }))
  expect(planShipmentImport([incoming], rows)).toEqual([-2])
  expect(() => applyShipmentImport(rows, new Map(rows.map(row => [row.material_id, row.material_snapshot])), [incoming], [0])).toThrow('匹配结果已变化')
})

it('actual OOXML image extraction retains file photos and deduplicates repeated anchors', async () => {
  vi.stubGlobal('DOMParser', DOMParser)
  try {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['货号', '产品中文名称', '规格', '供应商', '采购单号', '图片'],
      ['REVIEW1048', '测试物料', 'R1048', '测试供应商', old.po_no, ''],
    ]), 'REVIEW1048')
    const zip = await JSZip.loadAsync(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }))
    zip.file('xl/worksheets/_rels/sheet1.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="drawing1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>')
    zip.file('xl/drawings/_rels/drawing1.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="image1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>')
    zip.file('xl/media/image1.png', 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', { base64: true })
    const anchor = '<xdr:oneCellAnchor><xdr:from><xdr:col>5</xdr:col><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="1000" cy="1000"/><xdr:pic><a:blip r:embed="image1"/></xdr:pic></xdr:oneCellAnchor>'
    for (const count of [1, 2]) {
      zip.file('xl/drawings/drawing1.xml', `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${anchor.repeat(count)}</xdr:wsDr>`)
      const parsed = await importShipmentFile(new File([await zip.generateAsync({ type: 'arraybuffer' })], 'images.xlsx'))
      const item = parsed.rows[0].item
      expect(item._fileMaterialFields).toEqual(expect.arrayContaining(['image', 'shipment_images']))
      expect(item.material_snapshot.shipment_images).toEqual([item.material_snapshot.image])
      const enriched = matchShipmentMaterial(item.material_snapshot, [{ ...material, image: 'master-image' }]).material
      const snapshot = { ...material, image: 'local-image' }
      const [next] = applyShipmentImport([{ ...old, material_id: -1, material_snapshot: snapshot }],
        new Map([[-1, snapshot]]), [{ ...item, material_snapshot: enriched }], [0])
      expect(next.material_snapshot!.image).toMatch(/^data:image\/png;base64,/)
      expect(next.material_snapshot!.shipment_images).toHaveLength(1)
    }
  } finally { vi.unstubAllGlobals() }
})

it.each([
  { name: 'packing reference only', weighing: '', gross: '', cartonWeight: '', grossTotal: '', netTotal: '', expectedWeighing: 50, expectedWeight: 5 },
  { name: 'explicit weighing zero without weight fields', weighing: 0, gross: '', cartonWeight: '', grossTotal: '', netTotal: '', expectedWeighing: 0, expectedWeight: 5 },
  { name: 'measured carton weight with derived packing count', weighing: '', gross: '', cartonWeight: 2, grossTotal: '', netTotal: '', expectedWeighing: 10, expectedWeight: 2 },
  { name: 'measured piece weight with coherent derived pair', weighing: '', gross: .2, cartonWeight: '', grossTotal: '', netTotal: '', expectedWeighing: 10, expectedWeight: 2 },
  { name: 'measured total gross with coherent derived pair', weighing: '', gross: '', cartonWeight: '', grossTotal: 20, netTotal: '', expectedWeighing: 10, expectedWeight: 2 },
  { name: 'protected net-only input is not a new gross measurement', weighing: '', gross: '', cartonWeight: '', grossTotal: '', netTotal: 20, expectedWeighing: 50, expectedWeight: 5 },
  { name: 'errored weighing cell preserves old measurement', weighing: { t: 'e', v: 15, f: '1/0' }, gross: '', cartonWeight: '', grossTotal: '', netTotal: '', expectedWeighing: 50, expectedWeight: 5 },
  { name: 'errored weighing cell cannot create a replacement gross pair', weighing: { t: 'e', v: 15, f: '1/0' }, gross: '', cartonWeight: '', grossTotal: 20, netTotal: '', expectedWeighing: 50, expectedWeight: 5 },
])('linked weighing intent: $name', ({ weighing, gross, cartonWeight, grossTotal, netTotal, expectedWeighing, expectedWeight }) => {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['货号', '产品中文名称', '规格', '供应商', '采购单号', '每箱数量', '称重数量', '单个毛重', '每箱重量', '送货数量', '毛重总重', '净重总重'],
    ['REVIEW1048', '测试物料', 'R1048', '测试供应商', old.po_no, '10', weighing, gross, cartonWeight, 100, grossTotal, netTotal],
  ]), 'REVIEW1048')
  const file = parseShipmentWorkbook(wb).rows[0].item
  const master = { ...material, gross_per_pc: .1, weight_per_carton: 5 }
  const enriched = matchShipmentMaterial(file.material_snapshot, [master]).material
  const current = { ...old, material_id: -1, weighing_qty: 50, material_snapshot: master }
  const [next] = applyShipmentImport([current], new Map([[-1, master]]), [{ ...file, material_snapshot: enriched }], [0])
  expect(next.qty_per_carton).toBe('10')
  expect(next.weighing_qty).toBe(expectedWeighing)
  expect(next.material_snapshot!.weight_per_carton).toBe(expectedWeight)
})


it('confirmed imported and ordinary allocations of OUT-132 merge despite different English translations', async () => {
  const master = { ...material, id: 989, product_code: '97282/1099227/6077460',
    name_zh: '10寸阿奇CDU', name_en: '10-inch Archie tray', unit_kg: 'KGM',
    hs_cn: '4819100000', hs_id: '48192000', net_per_pc: .1493 }
  const snapshot = { ...master, name_en: '10-inch Archie CDU', image: 'imported-picture' }
  const rows = [
    { ...old, _rowKey: 11, material_id: -11, outbound_id: 132, qty: 1000, kg: 149.3,
      material_snapshot: snapshot, cartons: 10, pallet: '' },
    { ...old, _rowKey: 19, material_id: 989, outbound_id: 132, qty: 10, kg: 1.51, cartons: 1, pallet: '' },
  ]
  const before = structuredClone(rows)
  const map = new Map([[989, master], [-11, snapshot]])
  const merged = consolidateShipmentItems(rows, map)
  expect(merged).toHaveLength(1)
  expect(merged[0]).toMatchObject({ qty: 1010, kg: 150.81, cartons: 11, outbound_ids: [132] })
  expect(shipmentPurchaseAmount(merged[0])).toBe(rows.reduce((sum, row) => sum + shipmentPurchaseAmount(row), 0))
  expect(merged[0].sources).toEqual(before)
  const edited = applyMergedShipmentEdits(rows, map, merged, [{ row: 0, field: 'pallet', value: '1-2/1卡' }])
  expect(edited.items.map(row => [row.outbound_id, row.qty, row.kg, row.pallet]))
    .toEqual([[132, 1000, 149.3, '1-2/1卡'], [132, 10, 1.51, '1-2/1卡']])
  expect(rows).toEqual(before)
  const reloaded = JSON.parse(JSON.stringify(edited.items))
  expect(consolidateShipmentItems(reloaded, edited.materials)).toHaveLength(1)
  const differentHs = new Map(map).set(-11, { ...snapshot, hs_id: '00123456' })
  expect(consolidateShipmentItems(rows, differentHs)).toHaveLength(2)
  const templateBuffer = Uint8Array.from(readFileSync(new URL('../../public/template-customs-rrm.xlsx', import.meta.url))).buffer
  const blob = await buildCustomsWorkbook({ templateBuffer, items: edited.items, materials: edited.materials,
    productHs: new Map(), images: new Map(), form: { customer: 'RRM', containerNo: 'OUT132-MERGE', rate: 1 } })
  const sheet = XLSX.read(await blob.arrayBuffer(), { type: 'array' }).Sheets['OUT132-MERGE']
  expect(sheet.F4.v).toBe('10寸阿奇CDU')
  expect(sheet.K4.v).toBe(150.81)
  expect(sheet.L4.v).toBe(1010)
  expect(sheet.F5?.v).not.toBe('10寸阿奇CDU')
}, 60000)

it.each([false, true])('OUT-132 的补量合并保留分段装箱和逐批毛净重，来源顺序倒置=%s', async reverse => {
  const master: Material = { id: 989, name_zh: '10寸阿奇CDU', name_en: '10-inch Archie tray',
    product_code: '97282/1099227/6077460', spec: '50.149x 63.931CM', category: '彩盒/彩咭',
    unit_kg: 'KGM', hs_cn: '4819100000', hs_id: '48192000', net_per_pc: .10053 }
  const snapshot: Material = { ...master, name_en: '10-inch Archie CDU',
    length: 100, width: 50, height: 20, weight_per_carton: 10.370000000000001, net_per_pc: .09953 }
  const base = { outbound_id: 132, price: .3411, purchase_charge_ratio: 1500 / 1515,
    currency: 'US$', purchase_unit: '个', supplier: '彩乐智能包装（香港）有限公司',
    customs_company: '彩乐智能包装（香港）有限公司', po_no: 'IRRIHS0459', po_date: '2026-10-28',
    formula_name: '10寸阿奇CDU', contract_no: '' }
  const packed = { ...base, _rowKey: 11, material_id: -11, material_snapshot: snapshot,
    qty: 1500, kg: 149.3, cartons: 15, qty_per_carton: '1-15/100', weighing_qty: 100,
    pallet: '1-15/5卡', product_use: '产品配件', bl_head: '華登製品實業有限公司' }
  const supplement = { ...base, _rowKey: 19, material_id: 989, qty: 15, kg: 1.51, cartons: 0 }
  const rows = reverse ? [supplement, packed] : [packed, supplement]
  const before = structuredClone(rows)
  const map = new Map([[989, master], [-11, snapshot]])
  const merged = consolidateShipmentItems(rows, map)
  expect(merged).toHaveLength(1)
  expect(merged[0]).toMatchObject({ material_id: -11, qty: 1515, kg: 150.81, cartons: 15,
    qty_per_carton: '1-15/100', pallet: '1-15/5卡', product_use: '产品配件', bl_head: '華登製品實業有限公司' })
  expect(merged[0].sources).toEqual(before)
  expect(rows).toEqual(before)
  expect(shipmentPurchaseAmount(merged[0])).toBeCloseTo(511.65, 8)
  const edited = applyMergedShipmentEdits(rows, map, merged, [{ row: 0, field: 'contract_no', value: 'MERGED-132' }])
  expect(edited.items.map(row => [row.qty, row.kg])).toEqual(rows.map(row => [row.qty, row.kg]))
  expect(edited.items.every(row => row.contract_no === 'MERGED-132')).toBe(true)
  const templateBuffer = Uint8Array.from(readFileSync(new URL('../../public/template-customs-rri.xlsx', import.meta.url))).buffer
  const blob = await buildCustomsWorkbook({ templateBuffer, items: edited.items, materials: edited.materials,
    productHs: new Map(), images: new Map(), form: { customer: 'RRI', containerNo: 'ACTUAL-OUT132', rate: .93 } })
  const sheet = XLSX.read(await blob.arrayBuffer(), { type: 'array' }).Sheets['ACTUAL-OUT132']
  expect(sheet.F5?.v).not.toBe('10寸阿奇CDU')
  expect([sheet.K4.v, sheet.L4.v, sheet.AT4.v]).toEqual([150.81, 1515, 15])
  expect(sheet.AP4.v).toBeCloseTo(511.65, 8)
  expect([sheet.P4.v, sheet.Q4.v]).toEqual([155.55, 150.80])
  expect(Number(sheet.BA4.v) * Number(sheet.L4.v)).toBeCloseTo(155.55, 8)
  expect(Number(sheet.BB4.v) * Number(sheet.L4.v)).toBeCloseTo(150.80295, 8)
  expect(sheet.BC4.v).toBe('1-15/5卡')

  for (const change of [{ outbound_id: 133 }, { contract_no: 'OTHER' }, { invoice_no: 'OTHER' },
    { bl_head: '另一抬头' }, { product_use: 'OTHER' }, { cartons: 1 }])
    expect(consolidateShipmentItems([packed, { ...supplement, ...change }], map)).toHaveLength(2)
  // Two potential physical packs require an explicit decision.
  expect(consolidateShipmentItems([packed, { ...packed, _rowKey: 20 }, supplement], map)).toHaveLength(3)
}, 60000)
