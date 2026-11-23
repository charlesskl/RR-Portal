import { expect, it } from 'vitest'
import { invoiceDetailGroups, invoiceDetailSumFormula, shouldMergeInvoiceCompany } from './invoiceDetailGroups'

it.each(['螺丝', '螺母', '五金配件', '塑胶件', '搪胶件', '毛绒裁片', '成份商标', '白色弹力棉带'])('merges %s with matching names/units', name => {
  expect(invoiceDetailGroups([0, 1].map(index => ({ index, name, hs: '001', unit: 'KGM' })))).toEqual([[0, 1]])
})
it('groups all same-name/unit rows while preserving different units, names and missing units', () => {
  const rows = [
    { name: '螺丝', hs: '001', unit: 'KGM' },
    { name: '螺丝', hs: '002', unit: 'KGM' },
    { name: '螺丝', hs: '001', unit: 'PCE' },
    { name: '螺母', hs: '001', unit: 'KGM' },
    ...Array(2).fill({ name: '彩盒', hs: '003', unit: 'KGM' }),
    ...Array(2).fill({ name: '螺丝', hs: '', unit: 'KGM' }),
    ...Array(2).fill({ name: '螺丝', hs: '001', unit: '' }),
  ].map((row, index) => ({ ...row, index }))
  expect(invoiceDetailGroups(rows)).toEqual([[0, 1, 6, 7], [2], [3], [4, 5], [8], [9]])
})
it('preserves first-appearance order and non-contiguous source indices', () => {
  const rows = ['螺丝', '螺母', '螺丝'].map((name, index) => ({ index, name, hs: '001', unit: 'KGM' }))
  expect(invoiceDetailGroups(rows)).toEqual([[0, 2], [1]])
  expect(rows).toHaveLength(3)
})

it('exports 256 consecutive members as one range, preserving escaped sheet names', () => {
  const references = Array.from({ length: 256 }, (_, index) => `'O''Brien, (明细)'!AA${index + 4}`)
  expect(invoiceDetailSumFormula(references)).toBe("SUM('O''Brien, (明细)'!AA4:AA259)")
})

it('keeps all 256 sparse members and limits every nested SUM to 255 arguments', () => {
  const references = Array.from({ length: 256 }, (_, index) => `'明细'!AA${index * 2 + 4}`)
  const formula = invoiceDetailSumFormula(references)
  const tokens = formula.match(/SUM|[(),]|'(?:[^']|'')+'![A-Z]+\d+(?::[A-Z]+\d+)?/g)!
  expect(tokens.join('')).toBe(formula)
  let position = 0
  const read = (): string[] => {
    const token = tokens[position++]
    if (token !== 'SUM') return [token]
    expect(tokens[position++]).toBe('(')
    const leaves: string[] = []
    let argumentsCount = 0
    do {
      leaves.push(...read())
      argumentsCount++
      if (tokens[position] !== ',') break
      position++
    } while (position < tokens.length)
    expect(tokens[position++]).toBe(')')
    expect(argumentsCount).toBeLessThanOrEqual(255)
    return leaves
  }
  expect(read()).toEqual(references)
  expect(position).toBe(tokens.length)
})

it('does not include gaps, other sheets or columns, or discard repeated members', () => {
  expect(invoiceDetailSumFormula(["'A'!K4", "'A'!K4", "'A'!K5", "'A'!K7", "'B'!K8", "'B'!L9"]))
    .toBe("SUM('A'!K4,'A'!K4:K5,'A'!K7,'B'!K8,'B'!L9)")
})

it('rejects an overlong sparse formula instead of producing an invalid Excel workbook', () => {
  const references = Array.from({ length: 256 }, (_, index) => `'${'A'.repeat(31)}'!AA${index * 2 + 4}`)
  expect(() => invoiceDetailSumFormula(references)).toThrow(/发票合并明细公式.*8192.*减少/)
})


it.each([
  '东莞华登塑胶制品有限公司', '华康塑胶制品(东源)有限公司', '东莞兴信塑胶制品有限公司',
  '河源市港正五金制造有限公司', '华兴玩具制品（河源）有限公司', '华登（河源）玩具制品有限公司',
  ' 华康塑胶制品（东源）有限公司 ', '华登(河源)玩具制品有限公司',
])('仅指定公司的完整名称允许合并：%s', company => expect(shouldMergeInvoiceCompany(company)).toBe(true))
it.each(['东莞市科驰立实业有限公司', '深圳市华胜益出口贸易有限公司', '其他公司',
  '东莞华登塑胶制品有限公司（分公司）', '', undefined])('其他公司保留逐行明细：%s', company => expect(shouldMergeInvoiceCompany(company)).toBe(false))
