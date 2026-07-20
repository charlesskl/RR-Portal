import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import JSZip from 'jszip'
import * as XLSX from 'xlsx-js-style'
import { describe, expect, it } from 'vitest'
import { apiBase, publicAsset, publicBase } from './deployment'
import { buildCustomsWorkbook } from './utils/customsExport'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))

describe('deployment base paths', () => {
  it('uses the Vite public base for browser routes', () => {
    expect(publicBase('/indo-shipping/')).toBe('/indo-shipping')
  })

  it('uses the Vite public base for API requests', () => {
    expect(apiBase('/indo-shipping/')).toBe('/indo-shipping/api')
  })

  it('uses the Vite public base for downloadable assets', () => {
    expect(publicAsset('/indo-shipping/', '/template-customs.xlsx')).toBe('/indo-shipping/template-customs.xlsx')
  })

  it('ships only the sanitized customs template', async () => {
    execFileSync(process.execPath, [resolve(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--base=/indo-shipping/'], {
      cwd: projectRoot,
      stdio: 'inherit',
    })

    const templatePath = resolve(projectRoot, 'dist', 'template-customs.xlsx')
    expect(existsSync(templatePath)).toBe(true)

    const archive = await JSZip.loadAsync(readFileSync(templatePath))
    const entries = Object.keys(archive.files)
    expect(entries.filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))).toHaveLength(1)
    expect(entries.some((name) => name.startsWith('xl/externalLinks/'))).toBe(false)
    expect(entries.some((name) => name.startsWith('customXml/'))).toBe(false)
    expect(entries.some((name) => name.includes('/comments'))).toBe(false)

    const searchableXml = (await Promise.all(
      entries
        .filter((name) => name.endsWith('.xml') || name.endsWith('.rels'))
        .map((name) => archive.file(name)?.async('string') ?? ''),
    )).join('\n')
    expect(searchableXml).not.toMatch(/xwechat_files|wxid_|Users[\\/]DELL|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|(?:\+?86[- ]?)?1[3-9]\d{9}/i)
  }, 20_000)

  it('builds a customs export from the sanitized template', async () => {
    const templateBuffer = Uint8Array.from(
      readFileSync(resolve(projectRoot, 'public', 'template-customs.xlsx')),
    ).buffer
    const output = await buildCustomsWorkbook({
      templateBuffer,
      items: [{ material_id: 7, qty: 12, price: 3.5, cartons: 2, po_no: 'PO-TEST' }],
      materials: new Map([[7, {
        id: 7,
        product_code: 'ITEM-TEST',
        name_zh: '测试物料',
        hs_cn: '0000.00',
        hs_id: '1111.11',
      }]]),
      productHs: new Map(),
      images: new Map(),
      form: { containerNo: 'TEST-CNTR', rate: 7.8 },
    })

    const workbook = XLSX.read(await output.arrayBuffer(), { type: 'array', cellFormula: true })
    expect(workbook.SheetNames).toEqual(['TEST-CNTR'])
    const sheet = workbook.Sheets['TEST-CNTR']
    expect(sheet.A4?.v).toBe(1)
    expect(sheet.D4?.v).toBe('ITEM-TEST')
    expect(sheet.N1?.v).toBe(7.8)
    expect(sheet.N4).toMatchObject({ f: 'AO4/$N$1' })
  }, 20_000)
})
