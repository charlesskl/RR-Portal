export const toolCurrencies = [
  { value: 'CNY', label: '人民币 CNY' }, { value: 'USD', label: '美金 USD' },
  { value: 'HKD', label: '港币 HKD' }, { value: 'IDR', label: '印尼盾 IDR' },
]
export function normalizeToolCurrency(value: string): string | undefined {
  const text = value.normalize('NFKC').replace(/\s+/g, '').toUpperCase()
  return ({
    CNY: 'CNY', RMB: 'CNY', '¥': 'CNY', 人民币: 'CNY',
    USD: 'USD', 'US$': 'USD', 美元: 'USD', 美金: 'USD',
    HKD: 'HKD', 'HK$': 'HKD', 港币: 'HKD', 港元: 'HKD',
    IDR: 'IDR', RP: 'IDR', 印尼盾: 'IDR',
  } as Record<string, string>)[text]
}

function currencyInPrice(value: unknown): string | undefined {
  const text = String(value ?? '').normalize('NFKC').replace(/["\\\s]/g, '').toUpperCase()
  if (/US\$|USD|美元|美金/.test(text)) return 'USD'
  if (/HK\$|HKD|港币|港元/.test(text)) return 'HKD'
  if (/CNY|RMB|¥|人民币/.test(text)) return 'CNY'
  if (/IDR|RP|印尼盾/.test(text)) return 'IDR'
  return undefined
}

export function readToolPrice(cell: { v?: unknown; w?: string; z?: unknown } | undefined, currencyColumn = '') {
  const value = cell?.v
  const textNumber = String(value ?? '').normalize('NFKC')
    .replace(/US\$|HK\$|USD|HKD|CNY|RMB|IDR|RP|人民币|美元|美金|港币|港元|印尼盾|¥/gi, '')
    .replace(/[,\s]/g, '')
  const price = typeof value === 'number' ? value : /^\d+(?:\.\d+)?$/.test(textNumber) ? Number(textNumber) : undefined
  const signals = [currencyInPrice(cell?.w), currencyInPrice(value), currencyInPrice(cell?.z)].filter(Boolean)
  const explicit = normalizeToolCurrency(currencyColumn)
  if (explicit) signals.push(explicit)
  const conflict = new Set(signals).size > 1
  return {
    price: price != null && Number.isFinite(price) && price >= 0 ? price : undefined,
    currency: conflict || (currencyColumn.trim() && !explicit) ? undefined : explicit || signals[0],
    conflict,
  }
}
