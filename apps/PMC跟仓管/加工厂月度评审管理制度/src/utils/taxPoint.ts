function round4(value: number) {
  return Math.round(value * 10000) / 10000
}

/** Stored factory tax rate (0.03) -> displayed/calculation factor (1.03). */
export function taxPointFactor(value: unknown): number | null {
  const rate = Number(value)
  if (!Number.isFinite(rate) || rate < 0) return null
  return round4(rate < 1 ? 1 + rate : rate)
}

/** Accept either a rate (0.03) or factor (1.03), and store it as a rate. */
export function taxPointRate(value: unknown): number | null {
  const entered = Number(value)
  if (!Number.isFinite(entered) || entered < 0) return null
  return round4(entered >= 1 ? entered - 1 : entered)
}

export interface FactoryTaxPointRecord {
  id: string
  name: string
  craft?: string
  region?: string
  tax_point?: number | null
  status?: string
  created?: string
  updated?: string
}

function factoryMasterKey(factory: FactoryTaxPointRecord): string {
  // 工厂服务的订单厂区可能与工厂所在地不同，历史重复主档的 region 也可能不一致；
  // 同一部门下完整厂名相同即视为同一工厂，税点不应再按 region 拆分。
  return [factory.craft ?? '', factory.name.trim().replace(/\s+/g, '').toLowerCase()].join('|')
}

function masterPriority(factory: FactoryTaxPointRecord): string {
  return `${factory.status === 'active' ? '1' : '0'}|${factory.updated ?? factory.created ?? ''}`
}

/** 同部门、同完整厂名的重复 ID，统一采用最近更新的有效主档税点。 */
export function factoryTaxPointFactors(factories: FactoryTaxPointRecord[]): Map<string, number | null> {
  const canonical = new Map<string, FactoryTaxPointRecord>()
  for (const factory of factories) {
    const key = factoryMasterKey(factory)
    const current = canonical.get(key)
    if (!current || masterPriority(factory) > masterPriority(current)) canonical.set(key, factory)
  }

  const result = new Map<string, number | null>()
  for (const factory of factories) {
    result.set(factory.id, taxPointFactor(canonical.get(factoryMasterKey(factory))?.tax_point))
  }
  return result
}
