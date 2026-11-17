import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { buildCustomsWorkbook } from './customsExport'

it('RRI contracts six and eight contain no stale sample serials, empty multiplication rows or duplicate totals', async () => {
  const amounts = [216.29, 75.69, 162.15, 27.58, 13.79, 6.20, 47.57]
  const quantities = [.0086, .0018, 57.5, .0001, .0001, .0002, .0142]
  const items = Array.from({ length: 14 }, (_, index) => ({ material_id: index + 1,
    qty: 1, kg: index < 7 ? 10 : quantities[index - 7], price: index < 7 ? 20 : amounts[index - 7], currency: 'USD', customs_company: 'SYNTHETIC',
    contract_no: `SYN-C-${Math.min(index, 7)}`, invoice_no: `SYN-I-${Math.min(index, 7)}`,
  }))
  const blob = await buildCustomsWorkbook({
    templateBuffer: Uint8Array.from(readFileSync(new URL('../../public/template-customs-rri.xlsx', import.meta.url))).buffer,
    items, materials: new Map(items.map(item => [item.material_id, { id: item.material_id,
      product_code: 'SYN-' + item.material_id, name_zh: '合成物料-' + item.material_id,
      unit_kg: item.material_id <= 7 || item.material_id === 10 ? 'KGM' : 'TNE' }])),
    productHs: new Map(), images: new Map(), form: { customer: 'RRI', containerNo: 'CONTRACT-ROWS' },
  })
  const book = XLSX.read(await blob.arrayBuffer(), { type: 'array' }), sheet = book.Sheets['实业合同']
  const serials = Object.entries(sheet).filter(([address, cell]) => /^A\d+$/.test(address)
    && cell.t === 'n' && Number.isInteger(cell.v) && cell.v > 0)
  // Count every serial, including rows whose LOOKUPs were cleared. Previously
  // those stale numeric A cells escaped tests that only counted active lookups.
  expect(serials.map(([, cell]) => cell.v)).toEqual(items.map((_, index) => index + 1))
  const products = Object.entries(sheet).filter(([address, cell]) => /^G\d+$/.test(address) && /^F\d+\*D\d+$/.test(cell.f || ''))
  expect(products).toHaveLength(items.length)
  for (const [address] of products) {
    const row = address.slice(1)
    expect(sheet['A' + row]?.t).toBe('n')
    expect(sheet['D' + row]?.f).toBeTruthy()
    expect(sheet['F' + row]?.f).toBeTruthy()
  }
  const totals = Object.entries(sheet).filter(([address, cell]) => /^G\d+$/.test(address) && /^SUM\(G\d+:G\d+\)$/.test(cell.f || ''))
  expect(totals).toHaveLength(8)
  const memberships = totals.map(([, cell]) => {
    const [, first, last] = cell.f!.match(/^SUM\(G(\d+):G(\d+)\)$/)!
    return serials.filter(([address]) => Number(address.slice(1)) >= Number(first) && Number(address.slice(1)) <= Number(last))
      .map(([, value]) => value.v)
  })
  expect(memberships.map(rows => rows.length)).toEqual([1, 1, 1, 1, 1, 1, 1, 7])
  expect(memberships.flat()).toEqual(items.map((_, index) => index + 1))
  const main = book.Sheets['CONTRACT-ROWS']
  const lastAmount = memberships.at(-1)!.reduce((sum, serial) => sum + Number(main['AA' + (serial + 3)].v), 0)
  expect(lastAmount).toBeCloseTo(549.27, 8)
  for (const serial of memberships.at(-1)!) {
    const row = serial + 3
    expect(Number(main['K' + row].v) * Number(main['Z' + row].v)).toBeCloseTo(amounts[serial - 8], 8)
  }
}, 60000)

it('a missing price formula in the seventh RRI contract row inherits the same template lookup as preceding rows', async () => {
  const items = Array.from({ length: 7 }, (_, index) => ({ material_id: index + 1, qty: 1,
    kg: index === 6 ? .024 : 10, price: index === 6 ? 284.74 : 20, currency: 'US$',
    contract_no: 'SYN-C', invoice_no: 'SYN-I' }))
  const blob = await buildCustomsWorkbook({
    templateBuffer: Uint8Array.from(readFileSync(new URL('../../public/template-customs-rri.xlsx', import.meta.url))).buffer,
    items, materials: new Map(items.map(item => [item.material_id, { id: item.material_id,
      name_zh: item.material_id === 7 ? '纸绳1.5MM' : `合成物料${item.material_id}`, product_code: `SYN-${item.material_id}`,
      unit_kg: item.material_id === 7 ? 'TNE' : 'KGM' }])),
    productHs: new Map(), images: new Map(), form: { customer: 'RRI', containerNo: 'SYN-FORMULA' },
  })
  const book = XLSX.read(await blob.arrayBuffer(), { type: 'array' }), sheet = book.Sheets['实业合同']
  for (let row = 24; row <= 30; row++) {
    expect(sheet[`F${row}`]?.f).toMatch(/^LOOKUP\(/)
    expect(sheet[`F${row}`]?.f).toContain(`'SYN-FORMULA'!A:A=A${row}`)
    expect(sheet[`F${row}`]?.f).toContain("'SYN-FORMULA'!Z:Z")
    expect(sheet[`F${row}`]?.F).toBe(`F${row}`)
  }
  expect(book.Sheets['SYN-FORMULA'].K10.v).toBe(.024)
  expect(Number(book.Sheets['SYN-FORMULA'].Z10.v) * .024).toBeCloseTo(284.74, 8)
}, 60000)

it('all contract detail columns keep lookup formulas in later groups, including description cells C118 and C119', async () => {
  const items = Array.from({ length: 15 }, (_, index) => ({ material_id: index + 1, qty: 1, kg: 1, price: 2,
    currency: 'US$', contract_no: `SYN-C-${index < 7 ? 1 : index < 13 ? 2 : 3}`,
    invoice_no: `SYN-I-${index < 7 ? 1 : index < 13 ? 2 : 3}` }))
  const blob = await buildCustomsWorkbook({
    templateBuffer: Uint8Array.from(readFileSync(new URL('../../public/template-customs-rri.xlsx', import.meta.url))).buffer,
    items, materials: new Map(items.map(item => [item.material_id, { id: item.material_id,
      product_code: 'SYN-' + item.material_id, name_zh: '合成物料' + item.material_id, name_en: 'Synthetic ' + item.material_id, unit_kg: 'KGM' }])),
    productHs: new Map(), images: new Map(), form: { customer: 'RRI', containerNo: 'SYN-DESCRIPTION' },
  })
  const book = XLSX.read(await blob.arrayBuffer(), { type: 'array' }), sheet = book.Sheets['实业合同']
  const rows = Object.entries(sheet).filter(([address, cell]) => /^A\d+$/.test(address)
    && cell.t === 'n' && Number.isInteger(cell.v) && cell.v > 0).map(([address]) => address.slice(1))
  expect(rows).toHaveLength(items.length)
  for (const row of rows) {
    for (const column of ['B', 'C', 'D', 'E', 'F']) {
      expect(sheet[`${column}${row}`]?.f, `${column}${row}`).toMatch(/^LOOKUP\(/)
      expect(sheet[`${column}${row}`]?.f).toContain(`'SYN-DESCRIPTION'!A:A=A${row}`)
    }
    expect(sheet[`G${row}`]?.f).toBe(`F${row}*D${row}`)
  }
  for (const row of [118, 119]) {
    expect(sheet[`C${row}`]?.f).toContain("'SYN-DESCRIPTION'!G:G&'SYN-DESCRIPTION'!F:F")
    expect(sheet[`C${row}`]?.F).toBe(`C${row}`)
  }
}, 60000)
