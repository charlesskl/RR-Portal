// PO 号生成 + 数字转中文金额 — 移植自旧 HTML
// 参考: 印尼走货明细生成系统.html 2475-2537 + 4235-4272

export type PoEntity = 'HSY' | 'HD_INDUSTRY' | 'HD_GLOBAL'

export interface PoEntityMeta {
  name: string
  addr: string
  tel: string
  currency: 'RMB' | 'USD'
  currencySymbol: string
  priceIncludesVAT: boolean
}

export const PO_ENTITY_META: Record<PoEntity, PoEntityMeta> = {
  HSY: {
    name: '深圳市华胜益出口贸易有限公司',
    addr: '深圳市龙华区大浪街道龙胜社区龙胜综合服务大楼602',
    tel: 'TEL:0755-27745367',
    currency: 'RMB', currencySymbol: '￥',
    priceIncludesVAT: true,
  },
  HD_INDUSTRY: {
    name: '華登製品實業有限公司',
    addr: '九龍尖沙咀科學館道1號康宏廣場南座12樓07-08室',
    tel: 'TEL:00852-2425 0720',
    currency: 'USD', currencySymbol: 'US$',
    priceIncludesVAT: false,
  },
  HD_GLOBAL: {
    name: '華登(全球)有限公司',
    addr: '九龍尖沙咀科學館道1號康宏廣場南座12樓07-08室',
    tel: 'TEL:00852-2425 0720',
    currency: 'USD', currencySymbol: 'US$',
    priceIncludesVAT: false,
  },
}

export function poDetermineEntity(supplier?: string, customsCompany?: string, source?: string): PoEntity {
  const customs = (customsCompany || '').trim()
  if (/华胜益/.test(customs)) return 'HSY'
  if (customs && customs === (supplier || '').trim()) {
    return source === 'RRM' ? 'HD_GLOBAL' : 'HD_INDUSTRY'
  }
  return 'HD_INDUSTRY'  // 兜底
}

export function poFactoryCode(supplier?: string): string {
  const s = (supplier || '').trim()
  if (/\(B\)|（B）|华登B|华登\(B\)|华登（B）/.test(s)) return 'HB'
  if (/华登/.test(s)) return 'HD'
  if (/兴信|华兴/.test(s)) return 'HS'
  if (/华康/.test(s)) return 'HK'
  if (/华胜益/.test(s)) return 'HSY'
  return 'XX'
}

// 与旧系统一致：厂房码 wcode 由用户每批输入（HS/HD/HB/HK），整批共用，而非按供应商推断
export function poContractPrefix(entity: PoEntity, wcode: string): string {
  const w = (wcode || '').trim().toUpperCase()
  if (entity === 'HD_INDUSTRY') return 'IRRI' + w
  if (entity === 'HD_GLOBAL') return 'IRRM' + w
  if (entity === 'HSY') return new Date().getFullYear() + ''
  return 'IRR' + w
}

export function poNextSeq(existing: string[], prefix: string): number {
  const used = existing.filter(n => (n ?? '').startsWith(prefix))
  let max = 0
  for (const n of used) {
    // 取前缀之后的部分当流水（年份制整串都是数字，不能用末尾数字，否则年份被反复叠加）
    const tail = String(n).slice(prefix.length)
    const m = tail.match(/(\d+)$/)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return max + 1
}

export function poGenContractNo(existing: string[], entity: PoEntity, wcode: string): string {
  const prefix = poContractPrefix(entity, wcode)
  // 华登实业 HS 合同号从 IRRIHS0301 起排；若已有更大编号则继续递增。
  const startSeq = prefix === 'IRRIHS' ? 301 : 1
  const seq = Math.max(poNextSeq(existing, prefix), startSeq)
  const digits = entity === 'HSY' ? 6 : 4
  return prefix + String(seq).padStart(digits, '0')
}

// ============ 数字转中文金额 ============
export function numToChinese(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === '' || isNaN(Number(n))) return '零'
  const digits = '零壹贰叁肆伍陆柒捌玖'
  const units = ['', '拾', '佰', '仟']
  const sections = ['', '万', '亿', '万亿']
  function fmtInt(intStr: string): string {
    let result = ''
    const sec: string[] = []
    for (let i = intStr.length; i > 0; i -= 4) sec.unshift(intStr.slice(Math.max(0, i - 4), i))
    sec.forEach((s, idx) => {
      let part = ''
      let zero = false
      for (let i = 0; i < s.length; i++) {
        const d = parseInt(s[i], 10)
        if (d === 0) zero = true
        else {
          if (zero) part += digits[0]
          zero = false
          part += digits[d] + units[s.length - i - 1]
        }
      }
      if (part) result += part + sections[sec.length - idx - 1]
    })
    return result || digits[0]
  }
  const num = Math.abs(Number(n))
  const intPart = Math.floor(num)
  const decStr = num.toFixed(2).split('.')[1]
  let result = fmtInt(String(intPart)) + '元'
  if (decStr === '00') result += '整'
  else {
    const j = parseInt(decStr[0], 10), f = parseInt(decStr[1], 10)
    if (j) result += digits[j] + '角'
    if (f) result += digits[f] + '分'
    if (!j && f) result = result.replace('元', '元零')
  }
  return result
}
