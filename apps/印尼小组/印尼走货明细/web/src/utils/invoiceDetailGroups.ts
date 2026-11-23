const normalizeInvoiceCompany = (company: string) => company.normalize('NFKC').replace(/\s+/g, '')
const mergedInvoiceCompanies = new Set([
  '东莞华登塑胶制品有限公司',
  '华康塑胶制品(东源)有限公司',
  '东莞兴信塑胶制品有限公司',
  '河源市港正五金制造有限公司',
  '华兴玩具制品（河源）有限公司',
  '华登（河源）玩具制品有限公司',
].map(normalizeInvoiceCompany))

export function shouldMergeInvoiceCompany(company?: string): boolean {
  return Boolean(company && mergedInvoiceCompanies.has(normalizeInvoiceCompany(company)))
}

// Invoice summaries use the displayed product name and declaration unit within one customs company.
// Source HS values remain unchanged in the main table; the summary code comes from 商品汇总表.
export function invoiceDetailGroups(rows: Array<{ index: number; name: string; hs?: string; unit: string }>): number[][] {
  const groups = new Map<string, number[]>()
  for (const row of rows) {
    const name = row.name, unit = row.unit.trim().toUpperCase()
    const key = name.trim() && unit ? JSON.stringify([name.toLowerCase(), unit]) : `single:${row.index}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(row.index)
  }
  return [...groups.values()]
}

// Keep the exact source members while respecting Excel's 255 arguments per function.
export function invoiceDetailSumFormula(references: readonly string[]): string {
  if (!references.length) return '0'
  const terms: string[] = []
  const cell = /^(.+!)(\$?[A-Z]+)(\$?)(\d+)$/
  for (let start = 0; start < references.length;) {
    let end = start
    const first = cell.exec(references[start])
    let last = first
    if (first) {
      while (end + 1 < references.length) {
        const next = cell.exec(references[end + 1])
        if (!next || next[1] !== first[1] || next[2] !== first[2] || next[3] !== first[3]
          || Number(next[4]) !== Number(last![4]) + 1) break
        last = next
        end++
      }
    }
    terms.push(end === start ? references[start] : `${references[start]}:${last![2]}${last![3]}${last![4]}`)
    start = end + 1
  }
  let sums = terms
  do {
    const next: string[] = []
    for (let i = 0; i < sums.length; i += 255) next.push(`SUM(${sums.slice(i, i + 255).join(',')})`)
    sums = next
  } while (sums.length > 1)
  const formula = sums[0]
  if (formula.length > 8192) throw new Error('发票合并明细公式超过 Excel 的 8192 字符限制，请减少本次导出的明细行数。')
  return formula
}
