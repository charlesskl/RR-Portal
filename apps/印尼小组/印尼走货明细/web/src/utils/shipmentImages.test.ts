import { afterEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { DOMParser } from '@xmldom/xmldom'
import * as XLSX from 'xlsx'
import { compressShipmentImage, replaceShipmentRowImages, shipmentImages, withShipmentImages } from './shipmentImages'
import { loadShipmentImages, parseShipmentWorkbook } from './shipmentImport'
import { applyShipmentImport } from './shipmentImportApply'
import { buildCustomsWorkbook } from './customsExport'
import { extractSheetImages } from './engineeringImport'

afterEach(() => vi.unstubAllGlobals())
const photo = (n: number) => `data:image/png;base64,${btoa(String(n))}`

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
