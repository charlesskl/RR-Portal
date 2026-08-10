import { describe, expect, it } from 'vitest'
import { deliveryImportFactoryMap } from '../src/utils/deliveryImportScope'
import type { Factory } from '../src/types/factory'

function factory(id: string, name: string, craft: Factory['craft'], region?: Factory['region']): Factory {
  return { id, name, craft, region, status: 'active' }
}

describe('deliveryImportFactoryMap', () => {
  const factories = [
    factory('dongguan-sewing', '同名车缝厂', 'sewing', 'dongguan'),
    factory('hunan-sewing', '同名车缝厂', 'sewing', 'hunan'),
    factory('dongguan-assembly', '东莞装配厂', 'assembly', 'dongguan'),
    factory('legacy-dongguan', '旧东莞车缝厂', 'sewing'),
  ]

  it('only exposes factories in the selected Dongguan craft and region', () => {
    expect(deliveryImportFactoryMap(factories, 'sewing', 'dongguan')).toEqual({
      同名车缝厂: 'dongguan-sewing',
      旧东莞车缝厂: 'legacy-dongguan',
    })
  })

  it('does not let a Hunan factory override a Dongguan factory with the same name', () => {
    expect(deliveryImportFactoryMap(factories, 'sewing', 'hunan')).toEqual({
      同名车缝厂: 'hunan-sewing',
    })
  })
})
