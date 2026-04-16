import type { ReconciliationResult } from '../types/index.js'

const DG_LABEL = 'RR01/东莞'
const ID_LABEL = 'RR02/印尼'

const EMPTY_RESULT: ReconciliationResult = {
  matched: [],
  unmatchedPOItems: [],
  ambiguousPOItems: [],
  errors: [],
}

/**
 * Builds a plain-text summary report from reconciliation results for both factories.
 *
 * @param dgResult - Reconciliation result for Dongguan (RR01) factory; null/undefined treated as empty
 * @param idResult - Reconciliation result for Indonesia (RR02) factory; null/undefined treated as empty
 * @returns Formatted plain-text report string
 */
export function buildSummaryReport(
  dgResult: ReconciliationResult | null | undefined,
  idResult: ReconciliationResult | null | undefined,
): string {
  const dg = dgResult ?? EMPTY_RESULT
  const id = idResult ?? EMPTY_RESULT

  const lines: string[] = []

  // Header
  lines.push('========================================')
  lines.push('TOMY 排期核对汇总报告')
  lines.push(`生成时间: ${new Date().toLocaleString('zh-CN')}`)
  lines.push('========================================')
  lines.push('')

  // Section 1: Field mismatches
  const dgMismatched = dg.matched.filter(r => r.mismatches.length > 0)
  const idMismatched = id.matched.filter(r => r.mismatches.length > 0)
  const totalMismatched = dgMismatched.length + idMismatched.length

  lines.push(`【字段不一致】共 ${totalMismatched} 条`)
  lines.push('----------------------------------------')

  for (const row of dgMismatched) {
    lines.push(`PO: ${row.tomyPO}  货号: ${row.货号}  工厂: ${DG_LABEL}`)
    for (const m of row.mismatches) {
      lines.push(`  字段: ${m.field}`)
      lines.push(`    排期值: ${m.scheduleValue}`)
      lines.push(`    PO值:   ${m.poValue}`)
    }
  }

  for (const row of idMismatched) {
    lines.push(`PO: ${row.tomyPO}  货号: ${row.货号}  工厂: ${ID_LABEL}`)
    for (const m of row.mismatches) {
      lines.push(`  字段: ${m.field}`)
      lines.push(`    排期值: ${m.scheduleValue}`)
      lines.push(`    PO值:   ${m.poValue}`)
    }
  }

  lines.push('')

  // Section 2: Unmatched PO items
  const totalUnmatched = dg.unmatchedPOItems.length + id.unmatchedPOItems.length

  lines.push(`【PO未匹配】共 ${totalUnmatched} 条`)
  lines.push('----------------------------------------')

  for (const item of dg.unmatchedPOItems) {
    lines.push(`PO: ${item.tomyPO}  货号: ${item.货号}  工厂: ${DG_LABEL}  来源: ${item.sourceFile}`)
  }

  for (const item of id.unmatchedPOItems) {
    lines.push(`PO: ${item.tomyPO}  货号: ${item.货号}  工厂: ${ID_LABEL}  来源: ${item.sourceFile}`)
  }

  lines.push('')

  // Section 3: Summary counts
  const totalErrors = dg.errors.length + id.errors.length
  lines.push('========================================')
  lines.push('汇总统计')
  lines.push('========================================')
  lines.push(`不一致行数: ${totalMismatched}`)
  lines.push(`未匹配PO条目: ${totalUnmatched}`)
  lines.push(`错误数: ${totalErrors}`)

  return lines.join('\n')
}
