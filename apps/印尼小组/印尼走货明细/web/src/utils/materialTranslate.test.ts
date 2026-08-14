import { describe, expect, it } from 'vitest'
import { resolveMaterialTranslation, translateMaterialName } from './materialTranslate'

describe('translateMaterialName', () => {
  it.each([
    ['2.6*10PB螺丝', '2.6*10PB Screw'],
    ['3.0*8PB螺丝', '3.0*8PB Screw'],
    ['五金配件-前/后轮双波花轴', 'Hardware accessories - Front/Rear Wheel Double Knurled Axle'],
    ['挖掘机贴纸-FSC', 'Excavator Sticker - FSC'],
    ['毛绒裁片', 'Plush Fabric Cut Piece'],
    ['塑胶件', 'Plastic Part'],
    ['搪胶件', 'Vinyl Part'],
    ['强力线', 'High-strength Thread'],
  ])('translates %s', (source, expected) => {
    expect(translateMaterialName(source)).toBe(expected)
  })

  it('keeps an existing English value unchanged', () => {
    expect(translateMaterialName('PB Screw')).toBe('PB Screw')
  })

  it('does not return a partial translation', () => {
    expect(translateMaterialName('尚未收录物料')).toBe('')
  })
})

describe('resolveMaterialTranslation', () => {
  const memory = [
    { keyword: '塑胶件', english: 'Customer-confirmed Plastic Component', active: true },
    { keyword: '搪胶件', english: 'Disabled Vinyl Name', active: false },
  ]

  it('prefers an active exact manual translation', () => {
    expect(resolveMaterialTranslation(' 塑胶件 ', memory)).toBe('Customer-confirmed Plastic Component')
  })

  it('ignores disabled entries and falls back to built-in terms', () => {
    expect(resolveMaterialTranslation('搪胶件', memory)).toBe('Vinyl Part')
  })

  it('does not fuzzy-match a different Chinese material name', () => {
    expect(resolveMaterialTranslation('透明塑胶件', memory)).toBe('')
  })
})
