import { describe, expect, it } from 'vitest'
import { bulkReceiptLines, receiptQuantityError } from './purchaseReceipt'

describe('purchase spare receipts', () => {
  it('allows spare-only receipts after full receipt without changing normal quantity', () => {
    expect(receiptQuantityError(0, 12, 0)).toBeUndefined()
    expect(bulkReceiptLines([{ id: 1, shortage_qty: 0 }], {}, { 1: 12 }))
      .toEqual([{ po_item_id: 1, qty: 0, spare_qty: 12 }])
  })
  it('includes completed and incomplete lines and ignores untouched rows and unrelated ids', () => {
    expect(bulkReceiptLines([
      { id: 1, shortage_qty: 0 }, { id: 2, shortage_qty: 20 }, { id: 3, shortage_qty: 10 },
    ], { 2: 10, 999: 50 }, { 1: 5, 2: 2, 999: 50 })).toEqual([
      { po_item_id: 1, qty: 0, spare_qty: 5 }, { po_item_id: 2, qty: 10, spare_qty: 2 },
    ])
  })
  it('ignores all-zero bulk rows but rejects an all-zero single receipt', () => {
    expect(bulkReceiptLines([{ id: 1, shortage_qty: 0 }], {}, {})).toEqual([])
    expect(receiptQuantityError(0, 0, 0)).toBeTruthy()
  })
  it.each([[-1, 5, 0], [0, -1, 0], [1, 5, 0], [11, 2, 10], [NaN, 5, 0], [0, Infinity, 0]])(
    'rejects invalid or excessive quantities %s / %s against shortage %s',
    (qty, spare, shortage) => {
      expect(receiptQuantityError(qty, spare, shortage)).toBeTruthy()
      expect(() => bulkReceiptLines([{ id: 1, shortage_qty: shortage }], { 1: qty }, { 1: spare })).toThrow()
    },
  )
  it('keeps normal partial and mixed receipts working', () => {
    expect(receiptQuantityError(10, 0, 20)).toBeUndefined()
    expect(receiptQuantityError(20, 2.5, 20)).toBeUndefined()
    expect(receiptQuantityError(0, 2.5, 20)).toBeUndefined()
  })
})
