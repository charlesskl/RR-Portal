import { afterEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { DOMParser } from '@xmldom/xmldom'
import * as XLSX from 'xlsx'
import { compressShipmentImage, replaceShipmentRowImages, shipmentImages, withShipmentImages } from './shipmentImages'
import { importShipmentFile, loadShipmentImages, parseShipmentWorkbook } from './shipmentImport'
import { applyShipmentImport } from './shipmentImportApply'
import { buildCustomsWorkbook } from './customsExport'
import { extractSheetImages } from './engineeringImport'

afterEach(() => vi.unstubAllGlobals())
const photo = (n: number) => `data:image/png;base64,${btoa(String(n))}`

async function smallWorkbookWithPhotos(imageBytes: number, count: number) {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['货号', '产品中文名称', '图片', '送货数量'],
    ...Array.from({ length: count }, (_, i) => [`SYN-${i}`, `合成物料${i}`, '', i + 1]),
  ]), '明细')
  const zip = await JSZip.loadAsync(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }))
  zip.file('xl/worksheets/_rels/sheet1.xml.rels', '<Relationships><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>')
  zip.file('xl/drawings/_rels/drawing1.xml.rels', '<Relationships><Relationship Id="image1" Target="../media/image1.png"/></Relationships>')
  zip.file('xl/media/image1.png', new Uint8Array(imageBytes).fill(65))
  zip.file('xl/drawings/drawing1.xml', '<xdr:wsDr xmlns:xdr="urn:drawing" xmlns:a="urn:art" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' + Array.from({ length: count }, (_, i) => `<xdr:oneCellAnchor><xdr:from><xdr:row>${i + 1}</xdr:row><xdr:col>2</xdr:col></xdr:from><xdr:pic><a:blip r:embed="image1"/></xdr:pic></xdr:oneCellAnchor>`).join('') + '</xdr:wsDr>')
  return new File([await zip.generateAsync({ type: 'arraybuffer' })], 'small-photo-budget.xlsx')
}

it.each([[300_000, 2], [100_000, 60]])('小工作簿图片超行或整批预算时完整预览，再仅压缩所选行（%i字节/%i行）', async (bytes, count) => {
  vi.stubGlobal('DOMParser', DOMParser)
  const file = await smallWorkbookWithPhotos(bytes, count)
  expect(file.size).toBeLessThan(20 * 1024 * 1024)
  const result = await importShipmentFile(file)
  expect(result.rows).toHaveLength(count)
  expect(result.loadImages).toBeTypeOf('function')
  expect(result.rows.every(row => !row.item.material_snapshot.image && !row.item.material_snapshot.shipment_images)).toBe(true)
  expect(result.rows.every(row => !row.warnings.some(warning => warning.includes('未替换已有图片')))).toBe(true)
  expect(result.rows.at(-1)!.item.qty).toBe(count)
  expect(result.rows.at(-1)!.item.material_snapshot.import_source?.file).toBe(file.name)
  const close = vi.fn(), decode = vi.fn(async () => ({ width: 1000, height: 500, close }))
  vi.stubGlobal('createImageBitmap', decode)
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ fillRect: vi.fn(), drawImage: vi.fn() }), toDataURL: () => 'data:image/jpeg;base64,AA==' }) })
  const chosen = result.rows.at(-1)!
  await result.loadImages!([chosen])
  expect(shipmentImages(chosen.item.material_snapshot)).toEqual(['data:image/jpeg;base64,AA=='])
  expect(chosen.item._fileMaterialFields).toContain('shipment_images')
  expect(result.rows[0].item.material_snapshot).not.toHaveProperty('image')
  expect(decode).toHaveBeenCalledOnce()
  expect(close).toHaveBeenCalledOnce()
})

it('预算内小图仍可直接预览，不必等到确认才显示', async () => {
  vi.stubGlobal('DOMParser', DOMParser)
  const result = await importShipmentFile(await smallWorkbookWithPhotos(200, 2))
  expect(result.loadImages).toBeUndefined()
  expect(result.rows).toHaveLength(2)
  expect(result.rows.every(row => shipmentImages(row.item.material_snapshot).length === 1)).toBe(true)
})

it('兼容旧单图，显式空数组表示清空，重复图片只保留一次', () => {
  expect(shipmentImages({ image: 'old' })).toEqual(['old'])
  expect(shipmentImages({ image: 'old', shipment_images: [] })).toEqual([])
  const material = { image: 'old', shipment_images: ['old'] }
  expect(withShipmentImages(material, ['new', 'new', 'second'])).toMatchObject({ image: 'new', shipment_images: ['new', 'second'] })
  expect(material.shipment_images).toEqual(['old'])
})

it('合并行加图仅更新各来源的本单快照，数量、金额、出库和货号库保持原值，JSON保存后仍有全部照片', () => {
  const material = { id: 7, name_zh: '测试物料', image: photo(1), hs_cn: '', hs_id: '7318' }
  const items = [1, 2].map(key => ({ _rowKey: key, outbound_id: key + 10, material_id: 7, qty: key * 10, kg: key, price: 2, po_no: 'PO' + key }))
  const before = structuredClone(items)
  const updated = replaceShipmentRowImages(items, new Map([[7, material]]), new Set([1, 2]), [photo(1), photo(2)])
  expect(items).toEqual(before)
  expect(material).not.toHaveProperty('shipment_images')
  for (const [index, item] of JSON.parse(JSON.stringify(updated)).entries()) {
    const { material_snapshot: snapshot, ...source } = item
    expect(source).toEqual(before[index])
    expect(snapshot).toMatchObject({ id: 7, shipment_images: [photo(1), photo(2)], shipment_hs_product_fallback: true })
    expect(snapshot).not.toHaveProperty('hs_cn')
  }
  expect(() => replaceShipmentRowImages(items, new Map([[7, material]]), new Set([3]), [])).toThrow('明细已变化')
})

it('新单图导入可替换旧图库，缺图或失败时完整保留已有图库，已关联批次也不改变数量价格', () => {
  const material = { id: 7, name_zh: '测试物料', image: photo(1), shipment_images: [photo(1), photo(2)] }
  for (const outbound_id of [undefined, 88]) for (const provided of [false, true]) {
    const old = { material_id: -1, material_snapshot: material, outbound_id, qty: 20, kg: 5, price: 2 }
    const item = { material_snapshot: { ...material, image: photo(3) }, _fileMaterialFields: provided ? ['image'] as const : ['name_zh'] as const }
    const [next] = applyShipmentImport([old], new Map([[-1, material]]), [item], [0])
    expect(shipmentImages(next.material_snapshot)).toEqual(provided ? [photo(3)] : [photo(1), photo(2)])
    expect(next).toMatchObject({ outbound_id, qty: 20, kg: 5, price: 2 })
  }
})

it('同一单元格不同图片全部带入，重复锚点去重，一张读取失败时整行图库保留原图', async () => {
  vi.stubGlobal('DOMParser', DOMParser)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['货号', '产品中文名称', '图片', '送货数量'], ['A', '测试物料', '', 1]]), '明细')
  const zip = await JSZip.loadAsync(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }))
  zip.file('xl/worksheets/_rels/sheet1.xml.rels', '<Relationships><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>')
  zip.file('xl/drawings/_rels/drawing1.xml.rels', '<Relationships>' + [1, 2].map(n => `<Relationship Id="image${n}" Target="../media/image${n}.png"/>`).join('') + '</Relationships>')
  for (const n of [1, 2]) zip.file(`xl/media/image${n}.png`, String(n))
  zip.file('xl/drawings/drawing1.xml', '<xdr:wsDr xmlns:xdr="urn:drawing" xmlns:a="urn:art" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' + [1, 2, 2].map(n => `<xdr:oneCellAnchor><xdr:from><xdr:row>1</xdr:row><xdr:col>2</xdr:col></xdr:from><xdr:pic><a:blip r:embed="image${n}"/></xdr:pic></xdr:oneCellAnchor>`).join('') + '</xdr:wsDr>')
  const rows = parseShipmentWorkbook(workbook).rows
  const read = vi.fn(async (file: JSZip.JSZipObject) => photo(file.name.includes('image1') ? 1 : 2))
  await loadShipmentImages(zip, rows, read)
  expect(read).toHaveBeenCalledTimes(2)
  expect(shipmentImages(rows[0].item.material_snapshot)).toEqual([photo(1), photo(2)])
  expect(rows[0].warnings).toEqual([])
  const failed = parseShipmentWorkbook(workbook).rows
  await loadShipmentImages(zip, failed, async file => { if (file.name.includes('image2')) throw new Error('bad'); return photo(1) })
  expect(failed[0].item.material_snapshot).not.toHaveProperty('shipment_images')
  expect(failed[0].item._fileMaterialFields).not.toContain('image')
  expect(failed[0].warnings.join('')).toContain('失败')
})

it('合并后导出保留各批全部图片，在同一行分列排列并增高行高，再导入不丢图', async () => {
  vi.stubGlobal('DOMParser', DOMParser)
  const material = { id: 7, name_zh: '测试物料', product_code: 'A', unit_kg: 'KGM', net_per_pc: 1 }
  const one = withShipmentImages(material, [photo(1), photo(2), photo(3)])
  const two = withShipmentImages(material, [photo(1), photo(4), photo(5)])
  const items = [one, two].map((material_snapshot, i) => ({ material_id: -i - 1, material_snapshot, outbound_id: i + 1, qty: 10, kg: 10, cartons: 1, price: 2, currency: 'US$' }))
  const templateBuffer = Uint8Array.from(readFileSync(new URL('../../public/template-customs-rri.xlsx', import.meta.url))).buffer
  const output = await buildCustomsWorkbook({ templateBuffer, items, materials: new Map([[-1, one], [-2, two]]),
    images: new Map(), productHs: new Map(), form: { customer: 'RRI', containerNo: 'MULTI-PHOTOS' }, mainOnly: true })
  const bytes = await output.arrayBuffer(), zip = await JSZip.loadAsync(bytes)
  const drawing = new DOMParser().parseFromString(await zip.file('xl/drawings/drawing999.xml')!.async('string'), 'application/xml')
  const anchors = Array.from(drawing.getElementsByTagName('xdr:oneCellAnchor'))
  expect(anchors).toHaveLength(5)
  expect(new Set(anchors.map(a => a.getElementsByTagName('xdr:colOff')[0].textContent + ':' + a.getElementsByTagName('xdr:rowOff')[0].textContent)).size).toBe(5)
  expect(anchors.every(a => a.getElementsByTagName('xdr:row')[0].textContent === '3')).toBe(true)
  const workbook = XLSX.read(bytes, { type: 'array', cellStyles: true })
  expect(workbook.Sheets['MULTI-PHOTOS']['!rows']![3].hpt).toBeGreaterThanOrEqual(156)
  const reread = await extractSheetImages(zip, 'MULTI-PHOTOS', true)
  expect(reread).toHaveLength(5)
  expect(new Set(reread.map(r => r.row))).toEqual(new Set([3]))
  expect(items[0].material_snapshot.shipment_images).toHaveLength(3)
}, 60000)

it('压缩图片后释放位图，过大文件在解码前拒绝', async () => {
  const close = vi.fn(), decode = vi.fn(async () => ({ width: 2000, height: 1000, close }))
  vi.stubGlobal('createImageBitmap', decode)
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ fillRect: vi.fn(), drawImage: vi.fn() }), toDataURL: () => 'data:image/jpeg;base64,AA==' }) })
  expect(await compressShipmentImage(new Blob(['small']))).toBe('data:image/jpeg;base64,AA==')
  expect(close).toHaveBeenCalledOnce()
  await expect(compressShipmentImage({ size: 32 * 1024 * 1024 + 1 } as Blob)).rejects.toThrow('32 MB')
  expect(decode).toHaveBeenCalledOnce()
})

it.each([false, true])('多图和重复定位全部导入后替换旧图库，保存重读保留全部新图（已关联=%s）', async linked => {
  vi.stubGlobal('DOMParser', DOMParser)
  const positions = new Map([[8, [1, 1]], [17, [2, 3, 4]], [36, [5, 6]], [102, [7, 8, 7, 8]]])
  const workbook = XLSX.utils.book_new()
  const values = Array.from({ length: 102 }, () => [] as (string | number)[])
  values[0] = ['货号', '产品中文名称', '图片', '送货数量']
  for (const row of positions.keys()) values[row - 1] = ['SYN-' + row, '合成物料' + row, '', row]
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(values), '明细')
  const zip = await JSZip.loadAsync(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }))
  zip.file('xl/worksheets/_rels/sheet1.xml.rels', '<Relationships><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>')
  zip.file('xl/drawings/_rels/drawing1.xml.rels', '<Relationships>' + Array.from({ length: 8 }, (_, i) => `<Relationship Id="image${i + 1}" Target="../media/image${i + 1}.png"/>`).join('') + '</Relationships>')
  for (let n = 1; n <= 8; n++) zip.file(`xl/media/image${n}.png`, String(n))
  zip.file('xl/drawings/drawing1.xml', '<xdr:wsDr xmlns:xdr="urn:drawing" xmlns:a="urn:art" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' + [...positions].flatMap(([row, photos]) => photos.map(n => `<xdr:oneCellAnchor><xdr:from><xdr:row>${row - 1}</xdr:row><xdr:col>2</xdr:col></xdr:from><xdr:pic><a:blip r:embed="image${n}"/></xdr:pic></xdr:oneCellAnchor>`)).join('') + '</xdr:wsDr>')
  const rows = parseShipmentWorkbook(workbook).rows
  await loadShipmentImages(zip, rows, async file => photo(Number(file.name.match(/image(\d+)/)![1])))
  expect(rows.map(row => row.row)).toEqual([8, 17, 36, 102])
  expect(rows.map(row => shipmentImages(row.item.material_snapshot).length)).toEqual([1, 3, 2, 2])
  expect(rows.every(row => row.warnings.length === 0)).toBe(true)
  const existing = rows.map((row, index) => ({ material_id: index + 1, outbound_id: linked ? index + 10 : undefined,
    qty: 123, kg: 45, price: 6, po_no: 'SYN-PO',
    material_snapshot: { ...row.item.material_snapshot, id: index + 1, image: photo(99), shipment_images: [photo(99), photo(100)] } }))
  const before = structuredClone(existing)
  const materials = new Map(existing.map(row => [row.material_id, row.material_snapshot]))
  const targets = rows.map((_, i) => i)
  const next = JSON.parse(JSON.stringify(applyShipmentImport(existing, materials, rows.map(row => row.item), targets)))
  for (const [index, row] of rows.entries()) {
    expect(shipmentImages(next[index].material_snapshot)).toEqual(shipmentImages(row.item.material_snapshot))
    expect(shipmentImages(next[index].material_snapshot)).not.toContain(photo(99))
    expect(shipmentImages(next[index].material_snapshot)).not.toContain(photo(100))
    if (linked) expect(next[index]).toMatchObject({ outbound_id: existing[index].outbound_id, qty: 123, kg: 45, price: 6, po_no: 'SYN-PO' })
  }
  expect(existing).toEqual(before)
  expect([...materials.values()].every(material => shipmentImages(material).includes(photo(99)))).toBe(true)
})
