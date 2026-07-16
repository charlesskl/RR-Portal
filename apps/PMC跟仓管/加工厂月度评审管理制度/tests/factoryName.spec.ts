import { describe, it, expect } from 'vitest'
import { normalizeFactoryName, resolveFactoryName } from '../src/utils/factoryName'
import type { Factory } from '../src/types/factory'

const make = (id: string, name: string): Factory =>
  ({ id, name, craft: 'injection', status: 'active' })

describe('normalizeFactoryName', () => {
  it('ignores spaces and bracket styles', () => {
    expect(normalizeFactoryName(' 东莞市（锋利宏塑胶加工厂） ')).toBe('东莞市锋利宏塑胶加工厂')
  })
})

describe('resolveFactoryName', () => {
  const factories = [
    make('junhao', '东莞市清溪俊豪塑胶厂'),
    make('huasheng', '东莞市华盛源塑料制品有限公司'),
    make('hongya', '东莞市清溪鸿亚塑胶加工厂'),
  ]

  it('matches exact factory names first', () => {
    expect(resolveFactoryName(factories, '东莞市清溪俊豪塑胶厂')).toMatchObject({
      status: 'matched',
      id: 'junhao',
    })
  })

  it('matches a unique short name such as 俊豪', () => {
    expect(resolveFactoryName(factories, '俊豪')).toMatchObject({
      status: 'matched',
      id: 'junhao',
    })
  })

  it('matches equivalent company and factory suffixes', () => {
    const result = resolveFactoryName(
      [make('hongshen', '东莞市清溪鸿深电子厂')],
      '东莞市清溪鸿深公司',
    )

    expect(result).toMatchObject({ status: 'matched', id: 'hongshen' })
  })

  it('matches names that omit the local town segment', () => {
    const result = resolveFactoryName(
      [make('junhao', '东莞市清溪俊豪塑胶厂')],
      '东莞市俊豪塑胶厂',
    )

    expect(result).toMatchObject({ status: 'matched', id: 'junhao' })
  })

  it('does not match one-character abbreviations', () => {
    expect(resolveFactoryName(factories, '豪')).toMatchObject({ status: 'not_found' })
  })

  it('rejects ambiguous abbreviations', () => {
    const result = resolveFactoryName([...factories, make('junhao2', '河源市俊豪五金厂')], '俊豪')

    expect(result.status).toBe('ambiguous')
  })
})
