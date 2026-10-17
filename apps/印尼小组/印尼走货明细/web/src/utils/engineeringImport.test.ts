import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import * as XLSX from 'xlsx'
import { importEngineeringFile, isZipWorkbookBuffer, parseEngineeringUsage } from './engineeringImport'

describe('engineering fraction usage', () => {
  it.each([
    ['1/2', 0.5], ['1 / 3', 1 / 3], ['１／４', 0.25], ['1⁄8', 0.125],
    ['1 1/2', 1.5], ['2又1/4', 2.25], ['½', 0.5], ['1½', 1.5],
    ['=1/2', 0.5], ['0/2', 0], [0, 0], ['0', 0], ['.25', 0.25],
    ['1,000.5', 1000.5], ['1e-3', 0.001], [1 / 3, 1 / 3],
    ['-1/2', -0.5], ['-1 1/2', -1.5], ['-1½', -1.5], ['+１／４', 0.25],
    ['2⅔', 2 + 2 / 3], ['0.5/2', 0.25], [-1.25, -1.25],
  ])('parses %s without rounding', (value, expected) => {
    expect(parseEngineeringUsage(value, 1)).toBe(expected)
  })
  it.each([null, undefined, '', '   '])('keeps the blank-cell default for %s', value => {
    expect(parseEngineeringUsage(value, 1)).toBe(1)
    expect(parseEngineeringUsage(value, 0)).toBe(0)
  })
  it.each(['1/0', '0/0', '1/2/3', '1+2', '=SUM(A1:A2)', 'abc', Infinity, NaN])('rejects invalid usage %s', value => {
    expect(() => parseEngineeringUsage(value, 1)).toThrow()
  })

  it.each(['xls', 'xlsx'] as const)('imports fractions in both purchase and molding usage (%s)', async bookType => {
    const workbook = XLSX.utils.book_new()
    const external = XLSX.utils.aoa_to_sheet([
      ['产品编号', 'A001'], ['类别', '物料名称', '物料编号', '用量'],
      ['五金', '材料甲', 1020096, '1/2'], ['五金', '材料乙', '01020097', '1 1/2'],
      ['五金', '材料丙', '01020098', 1 / 3], ['五金', '材料丁', '01020099', 0],
      ['五金', '材料戊', '01020100', null],
    ])
    external.C3.z = '00000000'
    external.D5.z = '# ?/?'
    XLSX.utils.book_append_sheet(workbook, external, '外购清单')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['产品编号', 'A001'], ['工模编号', '工模名称', '物料名称', '用量', '用料名称'],
      ['M1', '测试模具', null, null, 'ABS'],
      [null, null, '零件甲', '1/4'], [null, null, '零件乙', '2 1/2'],
    ]), '排模表')
    const bytes = XLSX.write(workbook, { type: 'array', bookType }) as ArrayBuffer
    const result = await importEngineeringFile({ arrayBuffer: async () => bytes } as File)
    expect(result.materials.map(m => m.usage_qty)).toEqual([0.5, 1.5, 1 / 3, 0, 1])
    expect(result.materials[0].material_code).toBe('01020096')
    expect(result.moldings[0].parts?.map(p => p.usage)).toEqual([0.25, 2.5])
  })

  it('reports the sheet and row instead of silently replacing an invalid fraction with 1', async () => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['产品编号', 'A001'], ['类别', '物料名称', '用量'], ['五金', '材料甲', '1/0'],
    ]), '外购清单')
    const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    await expect(importEngineeringFile({ arrayBuffer: async () => bytes } as File))
      .rejects.toThrow('外购清单 第 3 行：用量分数的分母不能为 0')
  })

  const usageSheet = (sheet: '外购清单' | '排模表', value: unknown, origin = 'A1') => {
    const rows = sheet === '外购清单'
      ? [['产品编号', 'A001'], ['类别', '物料名称', '用量'], ['五金', '材料甲', value]]
      : [['产品编号', 'A001'], ['工模编号', '工模名称', '物料名称', '用量', '用料名称'],
        ['M1', '测试模具', null, null, 'ABS'], [null, null, '零件甲', value]]
    const worksheet: XLSX.WorkSheet = {}
    XLSX.utils.sheet_add_aoa(worksheet, rows, { origin })
    const start = XLSX.utils.decode_cell(origin)
    const end = { r: start.r + rows.length - 1, c: start.c + (sheet === '外购清单' ? 2 : 4) }
    worksheet['!ref'] = XLSX.utils.encode_range(start, end)
    const usageCell = XLSX.utils.encode_cell({ r: end.r, c: start.c + (sheet === '外购清单' ? 2 : 3) })
    return { worksheet, usageCell, row: end.r + 1 }
  }

  it.each(['xls', 'xlsx'] as const)('rejects Excel error cells in both usage sheets (%s)', async bookType => {
    for (const sheet of ['外购清单', '排模表'] as const) {
      const { worksheet, usageCell, row } = usageSheet(sheet, null)
      worksheet[usageCell] = { t: 'e', v: 7 }
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, worksheet, sheet)
      const bytes = XLSX.write(workbook, { type: 'array', bookType }) as ArrayBuffer
      await expect(importEngineeringFile({ arrayBuffer: async () => bytes } as File))
        .rejects.toThrow(`${sheet} 第 ${row} 行：用量单元格为 Excel 错误`)
    }
  })

  it.each(['xls', 'xlsx'] as const)('reports actual worksheet rows when the used range starts at B3 (%s)', async bookType => {
    for (const sheet of ['外购清单', '排模表'] as const) {
      const { worksheet, row } = usageSheet(sheet, '1/0', 'B3')
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, worksheet, sheet)
      const bytes = XLSX.write(workbook, { type: 'array', bookType }) as ArrayBuffer
      await expect(importEngineeringFile({ arrayBuffer: async () => bytes } as File))
        .rejects.toThrow(`${sheet} 第 ${row} 行：用量分数的分母不能为 0`)
    }
  })

  it.each(['xls', 'xlsx'] as const)('keeps raw formula results and numeric precision independently of display format (%s)', async bookType => {
    for (const sheet of ['外购清单', '排模表'] as const) {
      for (const value of [0, -1.25, 1 / 3, 0.123456789012345]) {
        const { worksheet, usageCell } = usageSheet(sheet, value, 'B3')
        worksheet[usageCell].z = '# ?/?'
        worksheet[usageCell].f = value === 1 / 3 ? '1/3' : undefined
        const workbook = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(workbook, worksheet, sheet)
        const bytes = XLSX.write(workbook, { type: 'array', bookType }) as ArrayBuffer
        const result = await importEngineeringFile({ arrayBuffer: async () => bytes } as File)
        expect(sheet === '外购清单' ? result.materials[0].usage_qty : result.moldings[0].parts?.[0].usage).toBe(value)
      }
    }
  })
})

describe('engineering material import', () => {
  it.runIf(process.env.ENGINEERING_L21106_FILE)('classifies all supplied L21106 furnace molds as vinyl', async () => {
    const bytes = readFileSync(process.env.ENGINEERING_L21106_FILE!)
    const result = await importEngineeringFile({ arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } as File)
    expect(result.moldings).toHaveLength(21)
    const vinyl = result.moldings.filter(m => /-S\d+$/.test(m.moldId ?? ''))
    expect(vinyl).toHaveLength(14)
    for (const mold of vinyl) {
      expect(mold.parts?.length).toBeGreaterThan(0)
      expect(mold.parts?.map(p => p.category), mold.moldId).toEqual(mold.parts?.map(() => '搪胶'))
    }
    const plastic = result.moldings.filter(m => /-P\d+$/.test(m.moldId ?? ''))
    expect(plastic).toHaveLength(7)
    expect(plastic.every(m =>
      m.parts?.every(p => p.category === '塑胶'))).toBe(true)
  })
  it.each(['xls', 'xlsx'] as const)('classifies PVC parts by molding machine without leaking to the next mold (%s)', async bookType => {
    for (const machineHeader of ['啤机机型', 'Mesin\nModel\n啤机机型', 'Mesin Model', 'Machine Model']) {
      const workbook = XLSX.utils.book_new()
      const sheet = XLSX.utils.aoa_to_sheet([
        ['产品编号', 'L21106'],
        ['工模编号', '工模名称', 'Nama Part\n零件名称', 'Material Part\n材料', machineHeader, '生产地', '英文物料'],
        ['S01', '公仔脸', null, 'PVC85°（本白）', '24 搪胶\n炉', '中国'],
        [null, null, '狐狸公仔脸A1', null, null, null, 'Fox face'],
        ['P01', '左右手', null, 'PVC85°（本白）', '12A', '中国'],
        [null, null, '狐狸左右手A1'],
        ['P02', '脚', null, 'PVC85°（本白）', null, '中国'],
        [null, null, '狐狸脚A1'],
        ['S02', '旧格式搪胶', null, '搪胶PVC', null, '中国'],
        [null, null, '旧款脸'],
      ])
      XLSX.utils.book_append_sheet(workbook, sheet, '排模表')
      const bytes = XLSX.write(workbook, { type: 'array', bookType }) as ArrayBuffer
      const result = await importEngineeringFile({ arrayBuffer: async () => bytes } as File)
      expect(result.moldings.map(m => m.parts?.[0].category)).toEqual(['搪胶', '塑胶', '塑胶', '搪胶'])
      expect(result.moldings[0].parts?.[0]).toMatchObject({ partName: '搪胶件-狐狸公仔脸A1', partNameEn: expect.stringContaining('Vinyl parts') })
      expect(result.moldings[0].workshop).toBe('华登')
      expect(result.moldings[1].parts?.[0].partName).toBe('塑胶件-狐狸左右手A1')
      expect(result.moldings[1].workshop).toBe('兴信A车间')
    }
  })
  it('reads only explicit machine merged cells with an offset worksheet range', async () => {
    const workbook = XLSX.utils.book_new()
    const sheet: XLSX.WorkSheet = {}
    XLSX.utils.sheet_add_aoa(sheet, [
      ['产品编号', 'L21106'],
      ['工模编号', '工模名称', '零件名称', '材料', '啤机机型'],
      ['S01', '脸', null, 'PVC85', '24搪胶炉'], [null, null, '狐狸脸'],
      ['S02', '脚', null, 'PVC85'], [null, null, '狐狸脚'],
      ['P01', '手', null, 'PVC85'], [null, null, '狐狸手'],
    ], { origin: 'B3' })
    sheet['!ref'] = 'B3:F10'
    sheet['!merges'] = [XLSX.utils.decode_range('F5:F8')]
    XLSX.utils.book_append_sheet(workbook, sheet, '排模表')
    const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const result = await importEngineeringFile({ arrayBuffer: async () => bytes } as File)
    expect(result.moldings.map(m => m.parts?.[0].category)).toEqual(['搪胶', '搪胶', '塑胶'])
  })
  it.each(['xls', 'xlsx'] as const)('maps 物料编号 to material_code preserving displayed zeros (%s)', async (bookType) => {
    const workbook = XLSX.utils.book_new()
    const sheet = XLSX.utils.aoa_to_sheet([
      ['产品编号', 'A001'],
      ['类别', '物料名称', '物料\n编号', '用量'],
      ['五金', '物料甲', '01020096', 2],
      ['五金', '物料乙', 1020097, 3],
    ])
    sheet.C4.z = '00000000'
    XLSX.utils.book_append_sheet(workbook, sheet, '外购件清单')
    const bytes = XLSX.write(workbook, { type: 'array', bookType }) as ArrayBuffer
    const result = await importEngineeringFile({ arrayBuffer: async () => bytes } as File)
    expect(result.materials.map(m => m.material_code)).toEqual(['01020096', '01020097'])
  })

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


describe('bilingual mold layout', () => {
  const layouts = (['xls', 'xlsx'] as const).flatMap(bookType => [
    { bookType, partHeader: '零件名称', materialHeader: '材料', weightHeader: '零件重量(G)' },
    { bookType, partHeader: 'Nama Part', materialHeader: 'Material Part', weightHeader: 'Berat Perpart (G)' },
    { bookType, partHeader: 'Nama Part\n零件名称', materialHeader: 'Material Part\n材料', weightHeader: 'Berat Perpart\n零件重量(G)' },
  ])
  it.each(layouts)('recognizes $partHeader, material and gram weights and excludes the footer ($bookType)', async ({ bookType, partHeader, materialHeader, weightHeader }) => {
    const wb = XLSX.utils.book_new()
    const sheet = XLSX.utils.aoa_to_sheet([
      ['产品编号: L21106'], [], [], [], [], [],
      ['工模编号', '工模名称', partHeader, materialHeader, weightHeader, '用量', '生产地'],
      ['P01', '公仔左右手', null, 'PVC85', null, null, '中国'],
      [null, null, '兔子左右手A7', null, 4, 1],
      ['S01', '公仔脸', null, 'PVC85', null, null, 'Indonesia\n印尼'],
      [null, null, '兔子公仔脸A7', null, 12, 1],
      ['Material Tipe 料型', 'Penggunaan 用量(G)'],
      ['ABS', '100'],
    ])
    XLSX.utils.book_append_sheet(wb, sheet, '排模表 Mold Layout')
    const bytes = XLSX.write(wb, { type: 'array', bookType }) as ArrayBuffer
    const result = await importEngineeringFile({ arrayBuffer: async () => bytes } as File)
    expect(result.moldings).toHaveLength(1)
    expect(result.moldings[0].materialName).toBe('PVC85')
    expect(result.moldings[0].parts).toHaveLength(1)
    expect(result.moldings[0].parts![0].netPerPc).toBe(0.004)
  })

  it.each(['xls', 'xlsx'] as const)('does not truncate valid names or notes containing footer words (%s)', async bookType => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['产品编号: T001'],
      ['工模编号', '工模名称', '零件名称', '材料', '零件重量(G)', '用量', '生产地', '备注'],
      ['M1', '测试工模', null, 'ABS', null, null, '中国'],
      [null, null, '塑料型腔底座', null, 4, '1/2'],
      [null, null, '右手', null, 2, 1, null, 'Material Tipe changed'],
      ['M2', '第二工模', null, 'PP', null, null, '中国'],
      [null, null, '左脚', null, 3, 1],
      ['料型', '用量（G）'],
      ['ABS', '100'],
    ]), '排模表')
    const bytes = XLSX.write(wb, { type: 'array', bookType }) as ArrayBuffer
    const result = await importEngineeringFile({ arrayBuffer: async () => bytes } as File)
    expect(result.moldings.map(m => m.moldId)).toEqual(['M1', 'M2'])
    expect(result.moldings.map(m => m.parts?.map(p => p.partName))).toEqual([
      ['塑胶件-塑料型腔底座', '塑胶件-右手'], ['塑胶件-左脚'],
    ])
    expect(result.moldings[0].parts?.[0].usage).toBe(0.5)
  })

  it.each(['xls', 'xlsx'] as const)('matches the material column rather than a preceding 材料编号 (%s)', async bookType => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['产品编号: T001'],
      ['工模编号', '工模名称', 'Nama Part\n零件名称', '材料编号', 'Material Part\n材料', 'Berat Perpart (G)', '用量', '生产地'],
      ['M1', '测试工模', null, '01020096', 'ABS', null, null, '中国'],
      [null, null, '右手', null, null, 4, 1],
    ]), '排模表')
    const bytes = XLSX.write(wb, { type: 'array', bookType }) as ArrayBuffer
    const result = await importEngineeringFile({ arrayBuffer: async () => bytes } as File)
    expect(result.moldings[0].materialName).toBe('ABS')
    expect(result.moldings[0].parts?.[0].netPerPc).toBe(0.004)
  })
})
