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
