import { describe, expect, it } from 'vitest'
import { quality5sColumnOf, quality5sImportDate } from '../src/utils/quality5sExcelImport'

describe('quality 5S Excel import', () => {
  const headers = [
    '现场区域规划\n（10分）', '物料摆放及标识\n（10分）', '卫生整洁及异物防护\n（10分）',
    '利器及断针管理\n（15分）', '不合格品隔离及追溯\n（15分）', '检验标准及样板管理\n（15分）',
    '质检人员配置及过程品质控制\n（15分）', '整改及记录管理\n（10分）',
  ]

  it('recognizes all eight score headers with line breaks and full-width brackets', () => {
    expect(quality5sColumnOf(headers, '现场区域规划(10分)')).toBe(0)
    expect(quality5sColumnOf(headers, '物料摆放及标识(10分)')).toBe(1)
    expect(quality5sColumnOf(headers, '卫生整洁及异物防护(10分)')).toBe(2)
    expect(quality5sColumnOf(headers, '利器及断针管理(15分)')).toBe(3)
    expect(quality5sColumnOf(headers, '不合格品隔离及追溯(15分)')).toBe(4)
    expect(quality5sColumnOf(headers, '检验标准及样板管理(15分)')).toBe(5)
    expect(quality5sColumnOf(headers, '质检人员配置及过程品质控制(15分)')).toBe(6)
    expect(quality5sColumnOf(headers, '整改及记录管理(10分)')).toBe(7)
  })

  it('keeps an Excel local date on the same calendar day', () => {
    expect(quality5sImportDate(new Date(2026, 6, 1, 0, 0, 17))).toBe('2026-07-01')
  })
})
