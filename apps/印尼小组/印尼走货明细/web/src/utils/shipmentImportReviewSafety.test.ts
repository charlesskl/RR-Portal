import { readFileSync } from 'node:fs'
import * as XLSX from 'xlsx'
import { expect, it } from 'vitest'
import { applyShipmentImport } from './shipmentImportApply'
import { consolidateShipmentItems } from './shipmentConsolidation'
import { buildCustomsWorkbook } from './customsExport'
import { applyShipmentSheetEdits } from './shipmentSheet'
import type { Material } from '../api/client'

const material: Material = { id: 137, product_code: 'REVIEW1048', name_zh: '测试物料',
  supplier: '测试供应商', spec: 'R1048', unit_kg: 'PCE', hs_cn: '', hs_id: '', net_per_pc: 1 }
const old = { _rowKey: 1, material_id: 137, outbound_id: 70, qty: 10, kg: 10, cartons: 1,
  price: 1, currency: 'US$', supplier: material.supplier, po_no: 'REVIEW1048-PO', customs_company: '测试公司' }
const materials = new Map([[137, material]])

it('packing import preserves the existing product-level HS fallback of a linked ordinary row', async () => {
  const incoming = { material_snapshot: { ...material, length: 25 }, po_no: old.po_no,
    supplier: old.supplier, customs_company: old.customs_company, cartons: 2 }
  const [updated] = applyShipmentImport([old], materials, [incoming], [0])
  const next = { ...updated, material_id: -1 }
  const templateBuffer = Uint8Array.from(readFileSync(new URL('../../public/template-customs-rrm.xlsx', import.meta.url))).buffer
  const exportCodes = async (items: any[], map: Map<number, Material>) => {
    const blob = await buildCustomsWorkbook({ templateBuffer, items, materials: map,
      productHs: new Map([['REVIEW1048', { hsCN: '0012345678', hsID: '00123456' }]]),
      images: new Map(), form: { customer: 'RRM', containerNo: 'REVIEW1048', rate: 1 } })
    const wb = XLSX.read(await blob.arrayBuffer(), { type: 'array' })
    return [wb.Sheets.REVIEW1048.B4?.v || '', wb.Sheets.REVIEW1048.C4?.v || '']
  }
  expect(await exportCodes([old], materials)).toEqual(['0012345678', '00123456'])
  expect(await exportCodes([next], new Map([[-1, updated.material_snapshot!]]))).toEqual(['0012345678', '00123456'])
}, 60000)

it('snapshot and ordinary rows with different HS fallback semantics do not consolidate', () => {
  const snapshot = { ...old, _rowKey: 2, material_id: -2, outbound_id: 71, material_snapshot: { ...material } }
  const map = new Map([...materials, [-2, snapshot.material_snapshot]] as const)
  expect(consolidateShipmentItems([old, snapshot], map)).toHaveLength(2)
})

it('fallback metadata survives JSON storage; explicit HS clear remains blank across edits and another import', async () => {
  const incoming = { material_snapshot: { ...material, length: 25 }, po_no: old.po_no, supplier: old.supplier }
  const [updated] = applyShipmentImport([old], materials, [incoming], [0])
  const next = JSON.parse(JSON.stringify({ ...updated, material_id: -1 }))
  expect(next.material_snapshot.shipment_hs_product_fallback).toBe(true)
  expect(next.material_snapshot.hs_id).toBeUndefined()
  const edited = applyShipmentSheetEdits([next], new Map([[-1, next.material_snapshot]]), [
    { row: 0, field: 'snapshot:hs_id', value: '' },
  ])
  const [reimported] = applyShipmentImport(edited.items, edited.materials, [{ ...incoming, cartons: 3 }], [0])
  expect(reimported.material_snapshot!.hs_id).toBe('')
  expect(reimported.material_snapshot!.hs_cn).toBeUndefined()
  const templateBuffer = Uint8Array.from(readFileSync(new URL('../../public/template-customs-rrm.xlsx', import.meta.url))).buffer
  const blob = await buildCustomsWorkbook({ templateBuffer, items: [reimported],
    materials: new Map([[-1, reimported.material_snapshot!]]),
    productHs: new Map([['REVIEW1048', { hsCN: '0012345678', hsID: '00123456' }]]),
    images: new Map(), form: { customer: 'RRM', containerNo: 'REVIEW1048-CLEAR', rate: 1 } })
  const sheet = XLSX.read(await blob.arrayBuffer(), { type: 'array' }).Sheets['REVIEW1048-CLEAR']
  expect(sheet.B4?.v).toBe('0012345678')
  expect(sheet.C4?.v || '').toBe('')
}, 60000)

it('inherited and ordinary rows can consolidate only when their actual code and fallback modes agree', () => {
  const [updated] = applyShipmentImport([old], materials, [{ material_snapshot: { ...material, length: 25 }, po_no: old.po_no,
    supplier: old.supplier }], [0])
  const linked = { ...updated, material_id: -1 }
  const ordinary = { ...old, _rowKey: 2, outbound_id: 71 }
  const map = new Map([[137, { ...material, length: 25 }], [-1, updated.material_snapshot!]])
  expect(consolidateShipmentItems([linked, ordinary], map)).toHaveLength(1)
  const explicit = { ...linked, material_snapshot: { ...linked.material_snapshot, hs_cn: '' } }
  map.set(-1, explicit.material_snapshot)
  expect(consolidateShipmentItems([explicit, ordinary], map)).toHaveLength(2)
})
