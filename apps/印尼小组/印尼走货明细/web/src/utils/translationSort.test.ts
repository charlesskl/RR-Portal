import { describe, expect, it } from 'vitest'
import { sortedTranslations } from './translationSort'

describe('sortedTranslations', () => {
  it('sorts by pinyin and natural numbers without changing source indices', () => {
    const names = ['纸箱', '说明书', '保修卡', '绑片卡10', '绑片卡2', '充电器盒']
    const rows = names.map(keyword => ({ keyword, english: '' }))
    const result = sortedTranslations(rows)
    expect(result.map(r => r.q.keyword)).toEqual(['绑片卡2', '绑片卡10', '保修卡', '充电器盒', '说明书', '纸箱'])
    expect(result[0]._i).toBe(4)
    expect(rows.map(r => r.keyword)).toEqual(names)
  })
  it('keeps blank names first and filters English without changing original indices', () => {
    const rows = [{ keyword: '纸箱', english: 'Carton' }, { keyword: '', english: '' }, { keyword: '纸箱', english: 'Box' }]
    expect(sortedTranslations(rows).map(r => r._i)).toEqual([1, 0, 2])
    expect(sortedTranslations(rows, 'CARTON').map(r => r._i)).toEqual([0])
  })
})
