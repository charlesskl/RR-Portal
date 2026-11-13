import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { buildCustomsWorkbook } from './customsExport'

it.each(['rri', 'rrm', 'legacy'].flatMap(template => [true, false].map(loaded => ({ template, loaded }))))(
  'packing dates use loading date and never invoice/sample dates ($template, loaded=$loaded)', async ({ template, loaded }) => {
    const bytes = (name: string) => Uint8Array.from(readFileSync(new URL('../../public/' + name, import.meta.url))).buffer
    const items = [1, 2].map(id => ({ material_id: id, qty: 1, kg: 1, price: 2,
      contract_no: 'SYN-C-' + id, invoice_no: '000' + id,
      contract_date: '2026-09-03', invoice_date: '2026-09-04',
      bl_head: id === 1 ? 'RRI' : 'PT SYNTHETIC',
    }))
    const blob = await buildCustomsWorkbook({
      templateBuffer: bytes(template === 'legacy' ? 'template-customs.xlsx' : `template-customs-${template}.xlsx`),
      indonesiaTemplateBuffer: bytes('template-customs.xlsx'),
      items, materials: new Map(items.map(item => [item.material_id, {
        id: item.material_id, name_zh: '合成物料-' + item.material_id, product_code: 'SYN-' + item.material_id, unit_kg: 'KGM',
      }])), productHs: new Map(), images: new Map(),
      form: { customer: template === 'rrm' ? 'RRM' : 'RRI', containerNo: "SYN-PACKING'DATE",
        loadDate: loaded ? '2026-11-11' : undefined, shipDate: '2026-11-14', blNo: loaded ? 'SEAL-001' : '' },
    })
    const book = XLSX.read(await blob.arrayBuffer(), { type: 'array', cellNF: true }), sheet = book.Sheets['装箱单']
    const dates = Object.entries(sheet).filter(([address, cell]) => /^D\d+$/.test(address)
      && /Packing\s*List\s*Date/i.test(String(cell.v || '')))
      .map(([address]) => ({ value: sheet['D' + (Number(address.slice(1)) + 1)]?.v ?? '',
        active: Boolean(sheet['D' + (Number(address.slice(1)) - 1)]?.v) }))
    const expected = loaded ? (Date.UTC(2026, 10, 11) - Date.UTC(1899, 11, 30)) / 86400000 : ''
    expect(dates.length).toBeGreaterThanOrEqual(2)
    expect(dates.filter(date => date.active).map(date => date.value)).toEqual([expected, expected])
    expect(dates.every(date => date.value === (date.active ? expected : ''))).toBe(true)
    const main = book.Sheets["SYN-PACKING'DATE"]
    expect(main.P1.v).toBe('装柜日期')
    expect(main.Q1.v).toBe(expected)
    expect(XLSX.SSF.is_date(main.Q1.z || '')).toBe(true)
    for (const [address, cell] of Object.entries(sheet)) {
      if (!/^D\d+$/.test(address) || !/^000[12]$/.test(String(cell.v || ''))) continue
      const first = Number(address.slice(1)), sourceRow = Number(String(cell.v).slice(-1)) + 3
      for (const [target, source] of [
        [address, `X${sourceRow}`], [`D${first + 2}`, 'Q1'], [`D${first + 4}`, `V${sourceRow}`],
        [`D${first + 8}`, `AC${sourceRow}`], [`H${first + 8}`, `AE${sourceRow}`],
      ]) {
        const reference = `'SYN-PACKING''DATE'!$${source.replace(/\d+$/, row => '$' + row)}`
        expect(sheet[target]?.f, target).toBe(`IF(${reference}="","",${reference})`)
        expect(sheet[target]?.v, target).toBe(main[source]?.v ?? '')
      }
    }
    expect(Object.values(sheet).filter(cell => /^IF\('SYN-PACKING''DATE'!\$X\$/.test(cell?.f || ''))).toHaveLength(2)
    const serial = (date: string) => (Date.parse(date + 'T00:00:00Z') - Date.UTC(1899, 11, 30)) / 86400000
    for (const row of [4, 5]) {
      expect(main['W' + row].v).toBe(serial('2026-09-03'))
      expect(main['Y' + row].v).toBe(serial('2026-09-04'))
    }
  }, 60000,
)
