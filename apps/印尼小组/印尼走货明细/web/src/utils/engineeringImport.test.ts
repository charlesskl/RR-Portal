import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import * as XLSX from 'xlsx'
import { importEngineeringFile, isZipWorkbookBuffer } from './engineeringImport'

describe('engineering material import', () => {
  it.runIf(process.env.ENGINEERING_IMPORT_FILE)('imports the supplied real workbook', async () => {
    const bytes = readFileSync(process.env.ENGINEERING_IMPORT_FILE!)
    const file = { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } as File
    const savedBuffer = globalThis.Buffer
    // Reproduce the browser environment, where Node's native Buffer is absent.
    // importEngineeringFile must install and use the browser-compatible implementation itself.
    globalThis.Buffer = undefined as unknown as typeof Buffer
    try {
      const result = await importEngineeringFile(file)
      expect(result.code).toBeTruthy()
      expect(result.materials.length).toBeGreaterThan(0)
    } finally {
      globalThis.Buffer = savedBuffer
    }
  })

  it('does not treat a legacy OLE workbook as an OOXML zip', () => {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]).buffer
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer

    expect(isZipWorkbookBuffer(ole)).toBe(false)
    expect(isZipWorkbookBuffer(zip)).toBe(true)
  })

  it('imports the displayed material code and preserves its leading zero from a legacy workbook', async () => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([['产品编号: E74062C', '产品名称: 寻宝者-Treasure Finder']]),
      '排模表',
    )

    const purchaseSheet = XLSX.utils.aoa_to_sheet([
      ['类别', '物料名称', '英文名', '规格', '物料编码', '供应商', '单重', '生产地', '用量'],
      ['五金', 'E74062C-T钉', 'E74062C-T nail', '1.8*8MM', 1020100, '港正', 0.2, '中国', 2],
    ])
    purchaseSheet.E2.z = '00000000'
    XLSX.utils.book_append_sheet(workbook, purchaseSheet, '外购件清单')

    const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xls' }) as ArrayBuffer
    const file = { arrayBuffer: async () => bytes } as File
    const result = await importEngineeringFile(file)

    expect(result.materials).toHaveLength(1)
    expect(result.materials[0].material_code).toBe('01020100')
  })

  it('imports an external-purchase-only workbook without a molding sheet', async () => {
    const workbook = XLSX.utils.book_new()
    const purchaseSheet = XLSX.utils.aoa_to_sheet([
      ['客户名称', null, 'TOMY', null, '产品编号', '：35874A1J', '产品名称', '：JD装载车+JD自卸车'],
      [],
      ['类别', '物料名称', '物料英文名称', '规格', '物料编码', '用量', '单重(g)', '供应商', '生产地'],
      ['五金', '前/后轮双波花轴1', 'Front/Rear Wheel Double-Groove', '直径3.0*92MM', '01020054', 2, 5.1, '河源市港正五金制造有限公司', '中国'],
    ])
    XLSX.utils.book_append_sheet(workbook, purchaseSheet, '外购件清单 Daftar Part Pembelian')

    const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xls' }) as ArrayBuffer
    const file = { arrayBuffer: async () => bytes } as File
    const result = await importEngineeringFile(file)

    expect(result.code).toBe('35874A1J')
    expect(result.name).toBe('JD装载车+JD自卸车')
    expect(result.customer).toBe('TOMY')
    expect(result.moldings).toEqual([])
    expect(result.materials).toHaveLength(1)
    expect(result.materials[0]).toMatchObject({
      product_code: '35874A1J',
      material_code: '01020054',
      supplier: '河源市港正五金制造有限公司',
    })
  })
})
