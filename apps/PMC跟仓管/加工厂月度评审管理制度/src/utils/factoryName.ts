import type { Factory } from '../types/factory'

type FactoryNameRecord = Pick<Factory, 'id' | 'name'>

export type FactoryNameResolveResult =
  | { status: 'matched'; id: string; name: string }
  | { status: 'empty' | 'not_found' }
  | { status: 'ambiguous'; names: string[] }

const MIN_ALIAS_LENGTH = 2

export function normalizeFactoryName(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[()（）【】\[\]{}《》〈〉]/g, '')
    .toLowerCase()
}

function normalizeFactoryCore(value: unknown): string {
  return normalizeFactoryName(value).replace(
    /(?:有限责任公司|股份有限公司|有限公司|塑胶制品公司|公司|电子厂|塑胶厂|玩具厂|加工厂|制品厂|厂)$/,
    '',
  )
}

function normalizeFactoryAlias(value: unknown): string {
  return normalizeFactoryCore(value)
    .replace(/^(?:广东省|湖南省)?/, '')
    .replace(/^(?:东莞市|河源市|冷水江市|新宁县|邵阳县|隆回县|东安县)?/, '')
    .replace(/^(?:[\p{Script=Han}]{2,3}省)?[\p{Script=Han}]{2,4}市/u, '')
    .replace(/^[\p{Script=Han}]{2,4}(?:县|区)/u, '')
    .replace(/^(?:清溪镇|清溪)?/, '')
}

function normalizeFactoryBrand(value: unknown): string {
  return normalizeFactoryAlias(value)
    .replace(/(?:五金|塑胶|塑料|电子|玩具|制品|加工|制造|制衣|服装|缝纫|毛绒|实业|科技|商行|店)/g, '')
}

function uniqueById(factories: FactoryNameRecord[]): FactoryNameRecord[] {
  const seen = new Set<string>()
  const out: FactoryNameRecord[] = []
  for (const factory of factories) {
    if (seen.has(factory.id)) continue
    seen.add(factory.id)
    out.push(factory)
  }
  return out
}

export function resolveFactoryName(
  factories: FactoryNameRecord[],
  input: unknown,
): FactoryNameResolveResult {
  const key = normalizeFactoryName(input)
  if (!key) return { status: 'empty' }

  const exact = uniqueById(factories.filter((factory) => normalizeFactoryName(factory.name) === key))
  if (exact.length === 1) return { status: 'matched', id: exact[0].id, name: exact[0].name }
  if (exact.length > 1) return { status: 'ambiguous', names: exact.map((factory) => factory.name) }

  if (key.length < MIN_ALIAS_LENGTH) return { status: 'not_found' }

  const coreKey = normalizeFactoryCore(input)
  const core = uniqueById(factories.filter((factory) => {
    const factoryCore = normalizeFactoryCore(factory.name)
    return factoryCore === coreKey || factoryCore.includes(coreKey) || coreKey.includes(factoryCore)
  }))
  if (core.length === 1) return { status: 'matched', id: core[0].id, name: core[0].name }
  if (core.length > 1) return { status: 'ambiguous', names: core.map((factory) => factory.name) }

  const aliasKey = normalizeFactoryAlias(input)
  const normalizedAlias = aliasKey.length < MIN_ALIAS_LENGTH ? [] : uniqueById(factories.filter((factory) => {
    const factoryAlias = normalizeFactoryAlias(factory.name)
    return factoryAlias === aliasKey || factoryAlias.includes(aliasKey) || aliasKey.includes(factoryAlias)
  }))
  if (normalizedAlias.length === 1) {
    return { status: 'matched', id: normalizedAlias[0].id, name: normalizedAlias[0].name }
  }
  if (normalizedAlias.length > 1) {
    return { status: 'ambiguous', names: normalizedAlias.map((factory) => factory.name) }
  }

  const brandKey = normalizeFactoryBrand(input)
  const brand = brandKey.length < MIN_ALIAS_LENGTH ? [] : uniqueById(factories.filter((factory) => {
    const factoryBrand = normalizeFactoryBrand(factory.name)
    return factoryBrand === brandKey || factoryBrand.includes(brandKey) || brandKey.includes(factoryBrand)
  }))
  if (brand.length === 1) {
    return { status: 'matched', id: brand[0].id, name: brand[0].name }
  }
  if (brand.length > 1) {
    return { status: 'ambiguous', names: brand.map((factory) => factory.name) }
  }

  const alias = uniqueById(factories.filter((factory) => {
    const factoryName = normalizeFactoryName(factory.name)
    return factoryName.includes(key) || key.includes(factoryName)
  }))
  if (alias.length === 1) return { status: 'matched', id: alias[0].id, name: alias[0].name }
  if (alias.length > 1) return { status: 'ambiguous', names: alias.map((factory) => factory.name) }
  return { status: 'not_found' }
}
