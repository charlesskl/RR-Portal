import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'
import { DOMParser } from '@xmldom/xmldom'
import { importShipmentFile, matchShipmentMaterial, parseShipmentWorkbook } from './shipmentImport'
import { shipmentGrossPerPc, shipmentWeightQuantity } from './shipmentWeight'
import { shipmentPurchaseAmount } from './shipmentPurchase'
import { toolImportDefaults } from './toolImportDefaults'
import { buildCustomsWorkbook } from './customsExport'

const headers = ['序号', '中国HSCODE', '印尼HS CODE', '货号', '套公式名称栏', '产品中文名称', '产品英文名称', '规格',
  '类别', '单位', '送货KG重量\nQuantity', '送货数量\nProduct quantity', '单位', '毛重', '净重', '毛重总重', '净重总重',
  '立方数/每箱\nCBM/Per carton', '总立方数', '图片', '产品用途', '合同号码', '合同日期', '发票号', '发票日期', '发票单价',
  '金额\nInvoice amount', '发票合计金额', '柜号', '走柜日期', '提单号', '预计到港日期', '实际到厂日期', 'VesselName/VoyageNo.',
  '中国运费', '印尼运费', 'Actual freight for product', '供应商', '采购单日期', '采购单号', '采购单价\nPurchase price',
  '采购金额', '采购总额', '报关出口公司', '提单抬头', '箱数', '每箱数量', '长', '宽', '高', '每箱重量', '单个毛重', '单个净重',
  '物料编码', '使用部门', '卡板']

function sample() {
  const values: Record<string, string | number> = { A: 1, B: '0012345678', C: '00123456', D: '94704/1099803/6077834', E: '扫描仪',
    F: '条码扫描仪', G: 'Barcode Scanner', H: 'CT1000', I: '工具', J: 'PCE', K: 3, L: 3, M: '台',
    N: 2, O: 1.8, P: 2, Q: 1.8, R: 0.0225586481499466, S: .02, U: '工业用', V: 'CON-001', W: '2026/10/29',
    X: '000001', Y: '2026/10/29', Z: 120, AA: 360, AB: 360, AC: 'WHSU2342610', AD: '2026/10/29', AE: 'BL001',
    AF: '2026/11/01', AG: '2026/11/02', AH: 'VESSEL/001', AI: 0, AJ: 25, AK: 25, AL: '工具供应商', AM: '2026/10/28',
    AN: 'PO001', AO: 121.21, AP: 363.63, AQ: 363.63, AR: '报关出口公司', AS: '提单公司', AT: 1, AU: '3',
    AV: 38, AW: 22, AX: 27, AY: 0, AZ: 0, BA: 0, BB: '0000017', BC: '仓库', BD: '雅洛轩' }
  const wb = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([['说明：新版列顺序不同'], [], headers,
    headers.map((_, index) => values[XLSX.utils.encode_col(index)] ?? '')])
  sheet.N1 = { t: 'n', v: .93 }
  sheet.AP4 = { t: 'n', v: 363.63, f: 'AO4*K4', z: '"US$"0.00' }
  sheet.AO4.z = '"US$"0.0000'
  XLSX.utils.book_append_sheet(wb, sheet, '清溪明细')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['发票'], ['条码扫描仪', 360]]), '发票')
  return { wb, sheet, values }
}

it('新版清溪全部56列留存，移动的每箱数量/尺寸/物料编码/使用部门/卡板按名称映射', () => {
  const { wb, values } = sample()
  const result = parseShipmentWorkbook(wb)
  expect(result.rows).toHaveLength(1)
  const { item } = result.rows[0]
  expect(item).toMatchObject({ qty: 3, kg: 3, cartons: 1, qty_per_carton: '3', pallet: '雅洛轩',
    price: 121.21, currency: 'US$', po_no: 'PO001', po_date: '2026-10-28', purchase_unit: '台',
    contract_no: 'CON-001', contract_date: '2026-10-29', invoice_no: '000001', invoice_date: '2026-10-29',
    material_snapshot: { product_code: '94704/1099803/6077834', hs_cn: '0012345678', hs_id: '00123456',
      material_code: '0000017', length: 38, width: 22, height: 27, department: '仓库', tool_kind: '工具', net_per_pc: .6 } })
  expect(shipmentGrossPerPc(item.material_snapshot.weight_per_carton, item.weighing_qty) * item.qty!).toBeCloseTo(2)
  expect(shipmentPurchaseAmount(item)).toBeCloseTo(363.63)
  const original = item.material_snapshot.import_source!
  expect(original.cells).toHaveLength(56)
  for (const [column, value] of Object.entries(values)) expect(original.cells.find(cell => cell.address === column + '4')?.value).toBe(value)
  expect(original.cells.find(cell => cell.address === 'AP4')).toMatchObject({ formula: 'AO4*K4', value: 363.63 })
  expect(original.cells.find(cell => cell.address === 'T4')?.value).toBe('')
  expect(original.context.find(cell => cell.address === 'N1')?.value).toBe(.93)
  const matched = matchShipmentMaterial(item.material_snapshot, [{ id: 137, name_zh: '条码扫描仪',
    product_code: values.D as string, spec: 'CT1000', supplier: '工具供应商', gross_per_pc: 99, net_per_pc: 99 }])
  const enriched = toolImportDefaults(matched.material, { hs: [], suppliers: [], translations: [] }).material
  expect(JSON.parse(JSON.stringify(enriched)).import_source).toEqual(original)
  expect(enriched.net_per_pc).toBe(.6)
})

it('短毛净重标题、明确零值、错误公式和无标题内容均可区分，公式不执行', () => {
  const { wb, sheet } = sample()
  delete sheet.P4; delete sheet.Q4
  sheet.AO4 = { t: 'e', f: 'INVALID()', v: 23 }
  sheet.Z4 = { t: 'e', f: 'INVALID()', v: 23 }
  sheet.BE4 = { t: 's', v: '未命名的备注' }
  sheet['!ref'] = 'A1:BE4'
  const { item, warnings } = parseShipmentWorkbook(wb).rows[0]
  expect(item.material_snapshot.net_per_pc).toBe(.6)
  expect(shipmentGrossPerPc(item.material_snapshot.weight_per_carton, item.weighing_qty) * item.qty!).toBeCloseTo(2)
  expect(item.price).toBeUndefined()
  const cells = item.material_snapshot.import_source!.cells
  expect(cells.find(cell => cell.address === 'AI4')).toMatchObject({ value: 0 })
  expect(cells.find(cell => cell.address === 'AO4')).toMatchObject({ value: null, formula: 'INVALID()', error: true })
  expect(cells.find(cell => cell.address === 'BE4')).toMatchObject({ label: '未命名列 BE', value: '未命名的备注' })
  expect(warnings.some(w => w.includes('AO4'))).toBe(true)
})

it('合计优先于四舍五入展示列；零合计不被旧的每箱和单件默认值覆盖', () => {
  const { wb, sheet } = sample()
  sheet.P4.v = 2.004
  sheet.Q4.v = 0
  sheet.AY4.v = 99; sheet.AZ4.v = 99; sheet.BA4.v = 99
  const item = parseShipmentWorkbook(wb).rows[0].item
  expect(shipmentGrossPerPc(item.material_snapshot.weight_per_carton, item.weighing_qty) * item.qty!).toBeCloseTo(2.004)
  expect(item.material_snapshot.net_per_pc).toBe(0)
})

it('新版导入再导出保留毛净重、体积和金额缓存，未打开Excel重算也能正确重读', async () => {
  vi.stubGlobal('DOMParser', DOMParser)
  try {
    const item = { ...parseShipmentWorkbook(sample().wb).rows[0].item, material_id: -1 }
    const templateBuffer = Uint8Array.from(readFileSync(new URL('../../public/template-customs-rri.xlsx', import.meta.url))).buffer
    const output = await buildCustomsWorkbook({ templateBuffer, items: [item], materials: new Map([[-1, item.material_snapshot]]),
      productHs: new Map(), images: new Map(), form: { customer: 'RRI', containerNo: 'VERSION-CACHE', rate: .93 }, mainOnly: true })
    const workbook = XLSX.read(await output.arrayBuffer(), { type: 'array' })
    const sheet = workbook.Sheets['VERSION-CACHE']
    expect(sheet.P4.v).toBe(2)
    expect(sheet.Q4.v).toBe(1.8)
    expect(sheet.P4.f).toBe('ROUND(BA4*L4,2)')
    expect(sheet.R4.v).toBeGreaterThan(.0225)
    expect(sheet.S4.v).toBeCloseTo(sheet.R4.v)
    expect(sheet.AP4.v).toBeCloseTo(363.63)
    const reimported = parseShipmentWorkbook(workbook).rows[0].item
    expect(reimported.qty).toBe(3)
    expect(reimported.material_snapshot.net_per_pc).toBe(.6)
    expect(shipmentGrossPerPc(reimported.material_snapshot.weight_per_carton, reimported.weighing_qty) * reimported.qty!).toBeCloseTo(2)
  } finally { vi.unstubAllGlobals() }
}, 60000)

it.skipIf(!process.env.SHIPMENT_IMPORT_VERSION_SAMPLE)('真实清溪源文件只读识别：两项、全部56列、图片、重量、箱数及金额', async () => {
  vi.stubGlobal('DOMParser', DOMParser)
  try {
    const path = process.env.SHIPMENT_IMPORT_VERSION_SAMPLE!
    const buffer = readFileSync(path)
    const hash = createHash('sha256').update(buffer).digest('hex')
    const originalSheet = XLSX.read(buffer, { type: 'buffer', cellNF: true }).Sheets.WHSU2342610
    const result = await importShipmentFile({ name: '10月29日RRI清溪.xlsx', size: buffer.length,
      arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length) } as File)
    expect(result.rows).toHaveLength(2)
    expect(result.warnings).toEqual([])
    result.rows.forEach(({ sheet, row, item, warnings }, index) => {
      const m = item.material_snapshot
      expect(sheet).toBe('WHSU2342610')
      expect(row).toBe(index + 4)
      expect(item).toMatchObject({ qty: [9, 3][index], kg: [9, 3][index], cartons: [2, 1][index],
        price: [17.31, 121.21][index], currency: 'US$', pallet: '雅洛轩', purchase_unit: ['个', '台'][index] })
      expect(m).toMatchObject({ name_zh: ['抽油器', '条码扫描仪'][index], hs_cn: ['8205590000', '8471605000'][index],
        hs_id: ['84132010', '84716090'][index], length: [119, 38][index], width: [26, 22][index], height: [31, 27][index], tool_kind: '工具' })
      expect(m.image).toMatch(/^data:image\/(png|jpeg);base64,/)
      expect(m.import_source?.cells).toHaveLength(56)
      expect(m.import_source?.file).toBe('10月29日RRI清溪.xlsx')
      for (const cell of m.import_source!.cells) {
        expect(cell.value).toEqual(originalSheet[cell.address]?.v ?? null)
        expect(cell.formula).toEqual(originalSheet[cell.address]?.f)
      }
      expect(shipmentGrossPerPc(m.weight_per_carton, item.weighing_qty) * shipmentWeightQuantity(m.name_zh, item.qty)).toBeCloseTo([14, 2][index])
      expect(m.net_per_pc! * shipmentWeightQuantity(m.name_zh, item.qty)).toBeCloseTo([12, 1.8][index])
      expect(shipmentPurchaseAmount(item)).toBeCloseTo([155.79, 363.63][index])
      expect(warnings).toEqual([])
    })
    const items = result.rows.map(({ item }, index) => ({ ...item, material_id: -index - 1 }))
    const templateBuffer = Uint8Array.from(readFileSync(new URL('../../public/template-customs-rri.xlsx', import.meta.url))).buffer
    const blob = await buildCustomsWorkbook({ templateBuffer, items,
      materials: new Map(items.map(item => [item.material_id, item.material_snapshot])), productHs: new Map(), images: new Map(),
      form: { customer: 'RRI', containerNo: 'VERSION-ROUNDTRIP', rate: .93 } })
    const exported = XLSX.read(await blob.arrayBuffer(), { type: 'array' }).Sheets['VERSION-ROUNDTRIP']
    for (const row of [4, 5]) {
      const index = row - 4
      expect(exported['K' + row].v).toBe([9, 3][index])
      expect(exported['L' + row].v).toBe([9, 3][index])
      expect(exported['P' + row].v).toBeCloseTo([14, 2][index])
      expect(exported['Q' + row].v).toBeCloseTo([12, 1.8][index])
      expect(exported['AP' + row].v).toBeCloseTo([155.79, 363.63][index])
    }
    expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(hash)
  } finally { vi.unstubAllGlobals() }
}, 60000)
