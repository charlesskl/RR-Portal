// 修改批次时先排除原数量，不能直接把当前欠数当成新数量上限。
export function receiptEditLimit(ordered: number, received: number, originalQty: number): number {
  return Math.max(ordered - (received - originalQty), 0)
}

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

// 每次打开或关闭弹窗都会更换会话；同一物料重新打开也不能接收旧请求。
export interface ReceiptSession {
  readonly revision: number
  readonly itemId: number
}

export function createReceiptSession() {
  let revision = 0
  let active: ReceiptSession | null = null
  return {
    open(itemId: number): ReceiptSession {
      active = { revision: ++revision, itemId }
      return active
    },
    close() {
      revision++
      active = null
    },
    current(itemId: number): ReceiptSession | null {
      return active?.itemId === itemId ? active : null
    },
    isCurrent(session: ReceiptSession | null): session is ReceiptSession {
      return session !== null && active === session
    },
  }
}
