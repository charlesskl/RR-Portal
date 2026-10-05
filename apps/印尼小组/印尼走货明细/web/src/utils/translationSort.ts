import type { TranslationDict } from '../api/client'

const pinyin = new Intl.Collator('zh-CN-u-co-pinyin', { numeric: true, sensitivity: 'base' })

export function sortedTranslations(rows: TranslationDict[], filter = '') {
  const query = filter.trim().toLowerCase()
  return rows.map((q, _i) => ({ q, _i }))
    .filter(({ q }) => !query || `${q.keyword || ''}${q.english || ''}`.toLowerCase().includes(query))
    .sort((a, b) => pinyin.compare((a.q.keyword || '').trim(), (b.q.keyword || '').trim()) || a._i - b._i)
}
