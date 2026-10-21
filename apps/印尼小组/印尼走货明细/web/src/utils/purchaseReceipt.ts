export function receiptQuantityError(qty: number, spareQty: number, shortage: number): string | undefined {
  if (!Number.isFinite(qty) || qty < 0) return '入库数量不能小于 0'
  if (!Number.isFinite(spareQty) || spareQty < 0) return '备品入数不能小于 0'
  if (qty === 0 && spareQty === 0) return '请填写本批入库数量或备品入数'
  if (qty > Math.max(shortage, 0)) return `不能超过当前欠数 ${Math.max(shortage, 0)}`
}

// 按采购单实际物料组装，清零后仅填写备品也不会漏掉该行。
export function bulkReceiptLines(
  rows: { id: number; shortage_qty?: number }[],
  quantities: Record<number, number>,
  spares: Record<number, number>,
) {
  return rows.map(row => {
    const qty = Number(quantities[row.id] ?? 0)
    const spare_qty = Number(spares[row.id] ?? 0)
    if (qty !== 0 || spare_qty !== 0) {
      const error = receiptQuantityError(qty, spare_qty, Number(row.shortage_qty ?? 0))
      if (error) throw new Error(`采购明细 #${row.id}：${error}`)
    }
    return { po_item_id: row.id, qty, spare_qty }
  }).filter(row => row.qty > 0 || row.spare_qty > 0)
}
