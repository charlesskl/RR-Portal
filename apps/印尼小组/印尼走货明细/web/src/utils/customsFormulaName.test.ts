import { describe, expect, it } from 'vitest'
import { customsFormulaName } from './customsExport'

describe('customs formula fastener names', () => {
  it.each(['PB螺丝', 'PWB螺丝2.6*6PWB D=8', '2.6*10PB螺丝', '五金配件-自攻螺丝'])('exports %s as 螺丝', name => {
    expect(customsFormulaName({}, { name_zh: name })).toBe('螺丝')
    expect(customsFormulaName({}, { name_zh: name }, '深圳市华胜益出口贸易有限公司')).toBe('螺丝')
  })
  it.each(['M3螺母', '六角螺母M4', '五金配件-防松螺母'])('exports %s as 螺母', name => {
    expect(customsFormulaName({}, { name_zh: name })).toBe('螺母')
    expect(customsFormulaName({ formula_name: name }, undefined, '华胜益')).toBe('螺母')
  })
  it('keeps detailed material fields unchanged and respects the chosen formula name', () => {
    const material = { name_zh: 'PB螺丝2.6*6', name_en: 'PB screw', spec: '2.6*6PB' }
    const original = { ...material }
    expect(customsFormulaName({}, material)).toBe('螺丝')
    expect(customsFormulaName({ formula_name: '连接件' }, material)).toBe('连接件')
    expect(material).toEqual(original)
  })
  it.each(['螺丝刀', '电动螺丝批', '螺母扳手', '螺丝螺母套装'])('does not misclassify %s', name => {
    expect(customsFormulaName({}, { name_zh: name })).toBe(name)
  })
  it('preserves existing company-specific rules for other materials', () => {
    expect(customsFormulaName({}, { name_zh: '五金配件-轴' })).toBe('五金配件')
    expect(customsFormulaName({}, { name_zh: '五金配件-轴' }, '华胜益')).toBe('五金配件-轴')
  })
})
