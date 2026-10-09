import { afterEach, expect, it, vi } from 'vitest'
import JSZip from 'jszip'
import { DOMParser } from '@xmldom/xmldom'
import { extractSheetImages } from './engineeringImport'
import { importShipmentFile } from './shipmentImport'
import { readFileSync } from 'node:fs'

afterEach(() => vi.unstubAllGlobals())
it.skipIf(!process.env.WPS_IMAGE_SAMPLE)('real WPS file imports the detail picture', async () => {
  vi.stubGlobal('DOMParser', DOMParser)
  const buffer = readFileSync(process.env.WPS_IMAGE_SAMPLE!)
  const result = await importShipmentFile({ size: buffer.length, arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) } as File)
  console.log(result.rows.map(row => ({ sheet: row.sheet, row: row.row, name: row.item.material_snapshot.name_zh, image: !!row.item.material_snapshot.image, warnings: row.warnings })))
  const row = result.rows.find(row => row.item.material_snapshot.name_zh?.includes('右内耳边'))
  expect(row).toBeDefined()
  expect(row!.item.material_snapshot.image).toMatch(/^data:image\//)
})
it('WPS DISPIMG images stay on their exact cells, with escaped quotes and alternate prefixes', async () => {
  vi.stubGlobal('DOMParser', DOMParser)
  const zip = new JSZip()
  zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="明细"/></sheets></workbook>')
  zip.file('xl/cellimages.xml', '<root xmlns:ci="urn:wps" xmlns:d="urn:drawing" xmlns:a="urn:art" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><ci:cellImage><d:cNvPr name="ID_TEST"/><a:blip r:embed="rId1"/></ci:cellImage></root>')
  zip.file('xl/_rels/cellimages.xml.rels', '<Relationships><Relationship Id="rId1" Target="media/test.png"/></Relationships>')
  zip.file('xl/media/test.png', new Uint8Array([137, 80, 78, 71]))
  zip.file('xl/worksheets/sheet1.xml', '<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c><c r="AC1"><v>图片</v></c></row><row r="2"><c r="A2"><v>2</v></c><c s="3" r="AC2"><f>_xlfn.DISPIMG(&quot;ID_TEST&quot;,1)</f><v>0</v></c></row><row r="3"><c r="AC3"><f>DISPIMG("ID_TEST",1)</f></c></row></sheetData></worksheet>')
  const images = await extractSheetImages(zip, '明细', true)
  expect(images.map(({ row, col }) => ({ row, col }))).toEqual([{ row: 1, col: 28 }, { row: 2, col: 28 }])
  expect(images[0].dataUrl).toBe('data:image/png;base64,iVBORw==')
})
