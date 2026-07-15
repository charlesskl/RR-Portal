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

  const alias = uniqueById(factories.filter((factory) => {
    const factoryName = normalizeFactoryName(factory.name)
    return factoryName.includes(key) || key.includes(factoryName)
  }))
  if (alias.length === 1) return { status: 'matched', id: alias[0].id, name: alias[0].name }
  if (alias.length > 1) return { status: 'ambiguous', names: alias.map((factory) => factory.name) }
  return { status: 'not_found' }
}
