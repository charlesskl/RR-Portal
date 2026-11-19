import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { withShipmentPurchaseBasis, shipmentPurchaseAmount, shipmentChargeQuantity, shipmentPurchaseTotal, refreshShipmentPurchaseBasis } from './shipmentPurchase'
import { consolidateShipmentItems } from './shipmentConsolidation'
import { buildCustomsWorkbook } from './customsExport'

const base = { material_id: 1, outbound_id: 1, price: 1.362, qty: 2520, kg: 957.6, currency: 'US$',
  supplier: 'Synthetic supplier', customs_company: 'Synthetic customs', purchase_unit: '个',
  purchase_basis_id: 17, purchase_charge_limit: 2500, purchase_charge_ratio: 2500 / 2525 }
const materials = new Map([[1, { id: 1, name_zh: '合成彩盒', product_code: 'SYN-PAID', unit_kg: 'KGM', net_per_pc: .38 }]])

it('送2520个含免费备品，按收费2500个得3405，不再按2525个摊薄金额', () => {
  const before = structuredClone(base)
  const [row] = withShipmentPurchaseBasis([base])
  expect(shipmentChargeQuantity(row)).toBeCloseTo(2500, 10)
  expect(shipmentPurchaseAmount(row)).toBeCloseTo(3405, 9)
  expect(row).toMatchObject({ price: 1.362, qty: 2520, kg: 957.6 })
  expect(base).toEqual(before)
})

it('同一PO多批出库只共用一次收费数量，余下20个为备品，反复计算不会再次折扣', () => {
  const rows = [1000, 1520].map((qty, index) => ({ ...base, outbound_id: index + 1, qty, kg: qty * .38 }))
  const paid = withShipmentPurchaseBasis(rows)
  expect(paid.map(shipmentChargeQuantity)).toEqual([1000, 1500])
  expect(shipmentPurchaseTotal(paid)).toBe(3405)
  expect(withShipmentPurchaseBasis(paid)).toEqual(paid)
  const merged = consolidateShipmentItems(paid, materials)
  expect(merged).toHaveLength(1)
  expect(shipmentPurchaseAmount(merged[0])).toBeCloseTo(3405, 9)
})

it('跨柜额度由服务端扣除此前货柜数量；后柜不重复收费', () => {
  const first = withShipmentPurchaseBasis([{ ...base, qty: 1000 }])
  const second = withShipmentPurchaseBasis([{ ...base, qty: 1520, purchase_charge_limit: 1500 }])
  const third = withShipmentPurchaseBasis([{ ...base, qty: 5, purchase_charge_limit: 0 }])
  expect([first, second, third].map(rows => rows.reduce((sum, row) => sum + shipmentChargeQuantity(row), 0))).toEqual([1000, 1500, 0])
  expect([...first, ...second, ...third].reduce((sum, row) => sum + shipmentPurchaseAmount(row), 0)).toBe(3405)
})

it('数量编辑重新计算收费和备品，不改单位采购价；不同PO各用自己的额度', () => {
  const rows = [{ ...base, qty: 1000 }, { ...base, qty: 1600 }, { ...base, purchase_basis_id: 18, qty: 2520 }]
  const result = withShipmentPurchaseBasis(rows)
  expect(result.map(shipmentChargeQuantity)).toEqual([1000, 1500, 2500])
  expect(result.every(row => row.price === 1.362)).toBe(true)
  const edited = withShipmentPurchaseBasis(result.map((row, i) => i === 0 ? { ...row, qty: 900 } : row))
  expect(edited.map(shipmentChargeQuantity)).toEqual([900, 1600, 2500])
})

it('未关联的导入申报单价不再扣费；旧资料没有数量依据时保留既有处理', () => {
  const imported = { ...base, outbound_id: undefined, material_snapshot: { id: 1 } }
  expect(withShipmentPurchaseBasis([imported])[0]).toBe(imported)
  const legacy = { ...base, purchase_charge_limit: null }
  expect(withShipmentPurchaseBasis([legacy])[0]).toBe(legacy)
})

it.each([-1, Infinity, NaN])('非法收费数量%s明确拒绝计算', purchase_charge_limit => {
  expect(() => withShipmentPurchaseBasis([{ ...base, purchase_charge_limit }])).toThrow('采购计费数量无效')
})
it('新拉入与旧明细额度不同先使用较低值，保存和导出再整体刷新', () => {
  expect(withShipmentPurchaseBasis([base, { ...base, purchase_charge_limit: 1 }]).map(shipmentChargeQuantity)).toEqual([1, 0])
})

it.each(['rri', 'rrm', 'legacy'].flatMap(variant => [true, false].map(mainOnly => ({ variant, mainOnly }))))('真实模板金额3405与20pcs备品批注保持正确（$variant，mainOnly=$mainOnly）', async ({ variant, mainOnly }) => {
  const template = variant === 'legacy' ? 'template-customs.xlsx' : `template-customs-${variant}.xlsx`
  const blob = await buildCustomsWorkbook({
    templateBuffer: Uint8Array.from(readFileSync(new URL('../../public/' + template, import.meta.url))).buffer,
    items: [base], materials, productHs: new Map(), images: new Map(), mainOnly,
    form: { customer: variant === 'rri' ? 'RRI' : 'RRM', containerNo: 'PAID-FIRST', rate: 1 },
  })
  const sheet = XLSX.read(await blob.arrayBuffer(), { type: 'array' }).Sheets['PAID-FIRST']
  expect(sheet.L4.v).toBe(2520)
  expect(sheet.K4.v).toBe(957.6)
  expect(sheet.AP4.v).toBe(3405)
  expect(sheet.AQ4.v).toBe(3405)
  expect(sheet.AA4.v).toBeCloseTo(3405, 8)
  expect(sheet.AP4.f).toBe('ROUND(AO4*K4,2)')
  expect(sheet.L4.c?.map((comment: { t?: string }) => comment.t).join('\n')).toContain('20pcs备品')
  expect(base.price).toBe(1.362)
}, 60000)

it('保存和导出前刷新额度，较早货柜已收费后不沿用编辑器里的旧上限', () => {
  const before=structuredClone(base)
  const rows=refreshShipmentPurchaseBasis([base], [{ purchase_basis_id: 17, purchase_charge_limit: 1500 }])
  expect(shipmentChargeQuantity(rows[0])).toBe(1500)
  expect(shipmentPurchaseTotal(rows)).toBe(2043)
  expect(rows[0]).toMatchObject({ qty: 2520, kg: 957.6, price: 1.362 })
  expect(base).toEqual(before)
  expect(() => refreshShipmentPurchaseBasis([base], [])).toThrow('明细已变化')
})
