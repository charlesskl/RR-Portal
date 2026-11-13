import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { buildCustomsWorkbook } from './customsExport'
import { HUASHENGYI_FULL_NAME } from './supplierProfiles'

it.each(['RRI', 'RRM'])('same-company alias cannot erase the selected seller archive in exported contracts/invoices (%s)', async customer => {
  const selected = {
    id: 901, keyword: HUASHENGYI_FULL_NAME, full: HUASHENGYI_FULL_NAME,
    nameEn: 'SYNTHETIC SELLER ENGLISH NAME', addressZh: '合成公司测试地址',
    addressEn: 'Synthetic address, Shenzhen, China', phone: '000-SYNTHETIC',
    email: 'synthetic@example.com', contact: 'Synthetic Contact',
  }
  const alias = { ...selected, id: 902, keyword: '华胜益', nameEn: 'OLD ALIAS NAME',
    addressZh: '', addressEn: '', phone: '', email: '', contact: '' }
  const profiles = [alias, selected]
  const before = structuredClone(profiles)
  const bytes = (name: string) => Uint8Array.from(readFileSync(new URL('../../public/' + name, import.meta.url))).buffer
  const items = [1, 2].map(id => ({ material_id: id, qty: 10, kg: 10, price: 2, currency: 'USD',
    supplier: id === 1 ? '原始采购供应商' : selected.keyword,
    customs_company: HUASHENGYI_FULL_NAME, contract_no: 'SYN-C-' + id, invoice_no: 'SYN-I-' + id,
    bl_head: id === 1 ? 'RRI' : 'PT SYNTHETIC',
  }))
  const blob = await buildCustomsWorkbook({
    templateBuffer: bytes('template-customs-' + customer.toLowerCase() + '.xlsx'),
    indonesiaTemplateBuffer: bytes('template-customs.xlsx'),
    supplierProfiles: profiles, items, materials: new Map([1, 2].map(id => [id, {
      id, name_zh: '合成物料-' + id, product_code: 'SYNTHETIC-' + id, unit_kg: 'KGM',
    }])), productHs: new Map(), images: new Map(), form: { customer, containerNo: 'SELLER-MATCH', rate: .93 },
  })
  const book = XLSX.read(await blob.arrayBuffer(), { type: 'array' })
  for (const name of [customer === 'RRI' ? '实业合同' : '全球合同', '印尼合同']) {
    const values = Object.entries(book.Sheets[name]).filter(([address]) => !address.startsWith('!')).map(([, cell]) => String(cell.v ?? ''))
    for (const value of [selected.full, selected.nameEn, selected.addressZh, selected.addressEn, selected.phone, selected.email, selected.contact])
      expect(values.some(text => text.includes(value)), `${name}: ${value}`).toBe(true)
    expect(values.some(text => text.includes(alias.nameEn))).toBe(false)
  }
  for (const name of [customer === 'RRI' ? '实业发票' : '全球发票', '印尼发票']) {
    const values = Object.values(book.Sheets[name]).map(cell => String(cell?.v ?? ''))
    expect(values.some(text => text.includes(selected.nameEn)), name).toBe(true)
    expect(values.some(text => text.includes(selected.email)), name).toBe(true)
  }
  expect(profiles).toEqual(before)
}, 60000)
