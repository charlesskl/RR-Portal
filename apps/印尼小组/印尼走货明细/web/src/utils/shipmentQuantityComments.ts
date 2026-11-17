import type { Material } from '../api/client'
import type { CustomsItem } from './customsExport'
import { receiptChargeRatio, shipmentUsesDeclarationPrice } from './shipmentPurchase'

export interface QuantityComment { author: string; text: string }

const quantityLabel = (value: string) => /^(送货数量|产品数量|需求数量)/.test(value.normalize('NFKC').replace(/\s+/g, ''))
const spareNote = (value: string) => /^\d+(?:\.\d+)?\s*(?:pcs?|pce|个|只|件|套|卷|米|m|mtr|kg|kgm|千克|吨|tne)?\s*备品$/i.test(value.trim())

/** Comments describe physical purchase quantities, never declaration weight. */
export function shipmentQuantityComments(sources: readonly CustomsItem[], unit: string): QuantityComment[] {
  const known = sources.filter(source => source.purchase_charge_ratio != null && !shipmentUsesDeclarationPrice(source))
  const spare = known.reduce((total, source) => total + Math.max(0, Number(source.qty) || 0) * (1 - receiptChargeRatio(source)), 0)
  const quantity = Number.isFinite(spare) ? Number(spare.toFixed(4)) : 0
  const comments: QuantityComment[] = []
  for (const source of sources) {
    const snapshot = source.material_snapshot as Material | undefined
    for (const cell of snapshot?.import_source?.cells || []) {
      if (!quantityLabel(cell.label)) continue
      for (const comment of cell.comments || []) {
        const text = known.includes(source) ? comment.text.split(/\r?\n/).filter(line => !spareNote(line)).join('\n').trim() : comment.text
        if (!text.trim()) continue
        if (!comments.some(existing => existing.author === comment.author && existing.text === text)) comments.push({ author: comment.author, text })
      }
    }
  }
  if (quantity > 0) {
    const label = /^(pcs?|pce|个|只|件)$/i.test(unit.trim()) ? 'pcs' : unit.trim()
    comments.push({ author: 'RR-Portal', text: `${quantity}${label}备品` })
  }
  return comments
}
