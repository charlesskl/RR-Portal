import { describe, expect, it } from 'vitest'
import { purchaseMaterialBucket, purchaseMaterialChoices, purchaseMaterialLine, purchaseSelectionSource, purchaseSelectionSupplier, selectedPurchaseMaterials } from './purchaseMaterialSelection'

const materials = [
  { id: 1, name_zh: '纸绳', material_code: 'M1', usage_qty: 2, supplier: '供应商A', spec: '2MM', unit_kg: 'MTR', net_per_pc: 0.03 },
  { id: 2, name_zh: '平卡', supplier: '供应商A' },
  { id: 3, name_zh: '停用', active: false },
]

describe('purchase material selection', () => {
  it('rejects schedule materials from a different source than the existing purchase contract', () => {
    const choices = purchaseMaterialChoices(materials, '46510', { key: '0', code: '46510', label: 'PO', quantity: 100 })
    expect(() => purchaseSelectionSource(choices, { '0': 'RRM' }, 'IRRIHS0405')).toThrow('当前 RRI')
    expect(() => purchaseSelectionSource(choices, { '0': 'RRI' }, 'IRRMHS0060')).toThrow('当前 RRM')
    expect(() => purchaseSelectionSource(choices, { '0': 'RRM' }, '2026900171')).toThrow('当前 RRI')
    expect(purchaseSelectionSource(choices, { '0': ' rrm ' }, ' irrmhs0060 ')).toBe('RRM')
    expect(purchaseSelectionSource(choices, { '0': 'RRM' })).toBe('RRM')
  })
  it('rejects mixed selected schedule sources before any line is appended', () => {
    const a = purchaseMaterialChoices(materials, '46510', { key: '0', code: '46510', label: 'RRI', quantity: 100 })
    const b = purchaseMaterialChoices(materials, '46510', { key: '1', code: '46510', label: 'RRM', quantity: 100 })
    expect(() => purchaseSelectionSource([...a, ...b], { '0': 'RRI', '1': 'RRM' })).toThrow('分开下单')
  })
  it('keeps direct material-library selection available for either existing source', () => {
    const choices = purchaseMaterialChoices(materials, '46510')
    expect(purchaseSelectionSource(choices, {}, 'IRRMHS0060')).toBeUndefined()
    expect(purchaseSelectionSource(choices, {}, 'IRRIHS0405')).toBeUndefined()
  })
  it('offers active materials with stable IDs without selecting all by default', () => {
    const choices = purchaseMaterialChoices(materials, '46510')
    expect(choices.map(c => c.material.id)).toEqual([1, 2])
    expect(selectedPurchaseMaterials(choices, [], {})).toEqual([])
    expect(purchaseMaterialChoices([{ name_zh: '无ID' }], '46510')).toEqual([])
  })
  it('only returns checked materials, including choices outside the current search/page', () => {
    const choices = purchaseMaterialChoices(materials, '46510')
    expect(selectedPurchaseMaterials(choices, ['1', 'unknown'], { '1': 80 }))
      .toEqual([{ ...choices[0], quantity: 80 }])
  })
  it('keeps the same material in two schedules independently selectable', () => {
    const a = purchaseMaterialChoices(materials, '46510', { key: '0', code: '46510A', label: 'PO1', quantity: 100 })
    const b = purchaseMaterialChoices(materials, '46510', { key: '1', code: '46510B', label: 'PO2', quantity: 200 })
    const picks = selectedPurchaseMaterials([...a, ...b], ['0:1', '1:2'], {})
    expect(picks.map(c => [c.groupKey, c.material.id, c.quantity, c.productCode]))
      .toEqual([['0', 1, 100, '46510A'], ['1', 2, 200, '46510B']])
  })
  it('copies actual material data and calculates demand without using product selling prices', () => {
    const choice = { ...purchaseMaterialChoices(materials, '46510')[0], quantity: 100 }
    expect(purchaseMaterialLine(choice, 'US$')).toMatchObject({
      material_id: 1, product_code: '46510', material_name: '纸绳', spec: '2MM',
      usage_qty: 2, ordered_qty: 100, material_qty: 200, price: 0, currency: 'US$',
      ship_unit: 'MTR', net_per_pc: 0.03,
    })
  })
  it('preserves explicit zero usage and defaults only absent usage to one', () => {
    const choice = { ...purchaseMaterialChoices(materials, '46510')[1], quantity: 50 }
    expect(purchaseMaterialLine(choice, '¥').material_qty).toBe(50)
    expect(purchaseMaterialLine({ ...choice, material: { ...choice.material, usage_qty: 0 } }, '¥').material_qty).toBe(0)
  })
  it('keeps supplier and source buckets separate, optionally splitting schedule rows', () => {
    expect(purchaseMaterialBucket('RRI', '供应商A')).not.toBe(purchaseMaterialBucket('RRM', '供应商A'))
    expect(purchaseMaterialBucket('RRI', '供应商A')).not.toBe(purchaseMaterialBucket('RRI', '供应商B'))
    expect(purchaseMaterialBucket('RRI', '供应商A', '0')).not.toBe(purchaseMaterialBucket('RRI', '供应商A', '1'))
    expect(purchaseMaterialBucket(' rrm ', 'A')).toBe(purchaseMaterialBucket('RRM', 'A'))
  })
  it('does not overwrite the current supplier or mix suppliers in one PO', () => {
    const choices = purchaseMaterialChoices(materials, '46510')
    expect(purchaseSelectionSupplier(choices)).toBe('供应商A')
    expect(purchaseSelectionSupplier(choices, ' 供应商A ')).toBe('供应商A')
    expect(() => purchaseSelectionSupplier(choices, '供应商B')).toThrow('不一致')
    expect(() => purchaseSelectionSupplier([...choices, { ...choices[0], material: { id: 4, supplier: '供应商B' } }])).toThrow('同一供应商')
    expect(() => purchaseSelectionSupplier([{ ...choices[0], material: { id: 4 } }])).toThrow('补齐')
  })
  it('directs a multi-supplier selection to batch ordering without claiming supplier data is missing', () => {
    const choices = purchaseMaterialChoices([
      { id: 1, supplier: '港正' }, { id: 2, supplier: '恒新昌' },
    ], '46720J')
    expect(() => purchaseSelectionSupplier(choices)).toThrow('2 家供应商')
    expect(() => purchaseSelectionSupplier(choices)).toThrow('批量下单')
    expect(() => purchaseSelectionSupplier(choices)).not.toThrow('补齐')
  })
  it('keeps all checked suppliers for batch ordering and excludes unchecked rows', () => {
    const choices = purchaseMaterialChoices([
      { id: 1, supplier: '港正' }, { id: 2, supplier: '恒新昌' },
      { id: 3, supplier: '港正' }, { id: 4, supplier: '未选供应商' },
    ], '46720J')
    const picks = selectedPurchaseMaterials(choices, ['1', '2', '3'], { '1': 100, '2': 200, '3': 300 })
    const buckets = new Map<string, typeof picks>()
    for (const choice of picks) {
      const key = purchaseMaterialBucket(undefined, choice.material.supplier!)
      buckets.set(key, [...(buckets.get(key) || []), choice])
    }
    expect(buckets.size).toBe(2)
    expect([...buckets.values()].map(rows => rows.map(row => row.material.id))).toEqual([[1, 3], [2]])
    expect(picks.map(row => row.quantity)).toEqual([100, 200, 300])
  })
})
