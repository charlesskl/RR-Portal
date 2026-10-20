import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import fs from 'node:fs'
import { parsePatrolWorkbook, matchPatrolFactories, patrolImportStatus, validPatrolDate } from '../src/utils/qualityPatrolImport'
const header = ['序号', '厂名', '员工人数', '拉线', '场地面积（平方）', '9/18\n评级', '评价', '整改描述', '计划完\n成时间', '符合类型', '现场照片', '', '']
function workbook(rows: unknown[][], title = '2026年9月18日湖南加工厂检查总结', headers = header): ArrayBuffer {
  const sheet = XLSX.utils.aoa_to_sheet([[title, '', '', '', '', '', '', '', '', '', '', '', '备注'], headers, ...rows, ['合计', '', 999], ['10/16巡查汇总，加工厂共39家'], ['A级', 11, .28]])
  sheet['!merges'] = [{ s: { r: 0, c: 12 }, e: { r: 1, c: 12 } }]
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, '总结')
  return XLSX.write(book, { type: 'array', bookType: 'xlsx' })
}
const row = [1, '华宏', 90, 3, 1200, 'A', '整洁', '增加隔离墙', 46310, 'IP管控加包装', '', '', '停产']
describe('single-visit Excel parser', () => {
  it('imports template 02 responsibilities, decimal fees, period and verbatim completion details', () => {
    const headers = ['序号', '厂名', '员工人数', '拉线', '场地面积（平方）', '责任范围', '责任主管', '1月-9月份\n加工费（万）', '10/16评级', '评价', '整改描述', '整改完\n成时间', '符合生产类型', '现场照片', '', '备注']
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
      ['2026年10月16日湖南加工厂检查总结'], headers,
      [1, '甲厂', 30, 2, 100, '责任人甲', '主管乙', 12.75, 'A', '整洁', '分项整改', '1:10/21完成\n2:10/26完成', '包装'],
      [2, '乙厂', 0, 0, 0, '', '', 0, 'B', '', '', 46317, ''],
      [3, '丙厂', '', '', '', '', '', '', '', '', '', '已完成', ''],
    ]), '总结')
    const result = parsePatrolWorkbook(XLSX.write(book, {type:'array', bookType:'xlsx'}))
    expect(result.rows.flatMap(r => r.errors)).toEqual([])
    expect(result.rows[0]?.values).toMatchObject({ responsibility_scope: '责任人甲', responsible_supervisor: '主管乙', processing_fee: 12.75, processing_fee_period: '1月-9月份', completed_date: '', completion_details: '1:10/21完成\n2:10/26完成' })
    expect(result.rows[1]?.values).toMatchObject({ processing_fee: 0, completed_date: '2026-10-22', completion_details: '' })
    expect(result.rows[2]?.values).toMatchObject({ processing_fee: null, completed_date: '', completion_details: '已完成' })
  })
  it.runIf(!!process.env.PATROL_TEMPLATE02_XLSX)('reads all rows, photos and new columns from the supplied template 02', () => {
    const bytes = fs.readFileSync(process.env.PATROL_TEMPLATE02_XLSX!)
    const result = parsePatrolWorkbook(new Uint8Array(bytes).buffer)
    expect(result.checkDate).toBe('2026-10-16')
    expect(result.rows).toHaveLength(39)
    expect(result.rows.flatMap(r => r.photos)).toHaveLength(77)
    expect(result.rows.flatMap(r => r.errors)).toEqual([])
    expect(result.rows[0]?.values).toMatchObject({ processing_fee: 338, processing_fee_period: '1月-9月份', completion_details: '10/21全部整改好', completed_date: '' })
    expect(result.rows[1]?.values.completed_date).toBe('2026-10-22')
  })
  it('reads merged remarks, title date and detail rows without importing summaries', () => {
    const result = parsePatrolWorkbook(workbook([row]))
    expect(result.checkDate).toBe('2026-09-18'); expect(result.region).toBe('hunan'); expect(result.rows).toHaveLength(1)
    expect(result.rows[0]?.values).toMatchObject({ staff: 90, grade: 'A', notes: '停产', planned_date: '2026-10-15', production_type: 'IP管控加包装' })
  })
  it('preserves blanks and zero; rejects invalid numbers, grades and dates', () => {
    const result = parsePatrolWorkbook(workbook([[1, '甲厂', '', 0, '', '', '', '', '', ''], [2, '乙厂', -1, 1.5, 10, 'E', '', '', '2026-02-30', '']]))
    expect(result.rows[0]?.values).toMatchObject({ staff: null, lines: 0, area: null })
    expect(result.rows[1]?.errors).toHaveLength(4)
  })
  it('rejects multi-period sheets and conflicting title/header dates', () => {
    expect(() => parsePatrolWorkbook(workbook([row], undefined, [...header, '10/16评级']))).toThrow('一次巡查')
    expect(() => parsePatrolWorkbook(workbook([row], '2026年10月16日湖南加工厂检查总结'))).toThrow('不一致')
    expect(validPatrolDate('2026-02-30')).toBe(false)
  })
  it('accepts October completion dates without inventing planned dates', () => {
    const headers = [...header]; headers[5] = '10/16评级'; headers[8] = '整改完\n成时间'
    const result = parsePatrolWorkbook(workbook([row], '2026年10月14日-16日湖南加工厂检查总结', headers))
    expect(result.checkDate).toBe('2026-10-16')
    expect(result.rows[0]?.values).toMatchObject({ planned_date: '', completed_date: '2026-10-15' })
    expect(result.warnings.join('')).toContain('计划完成时间')
  })
  it('allows absent date columns and keeps separate date values when both exist', () => {
    const headers = [...header]; headers[8] = ''
    expect(parsePatrolWorkbook(workbook([row], undefined, headers)).rows[0]?.values).toMatchObject({ planned_date: '', completed_date: '' })
    const result = parsePatrolWorkbook(workbook([[...row, 46311]], undefined, [...header, '整改完成日期']))
    expect(result.rows[0]?.values).toMatchObject({ planned_date: '2026-10-15', completed_date: '2026-10-16' })
  })
  it('explains missing required columns in Chinese and rejects invalid date periods', () => {
    const headers = [...header]; headers[6] = ''
    expect(() => parsePatrolWorkbook(workbook([row], undefined, headers))).toThrow('评价')
    const october = [...header]; october[5] = '10/16评级'
    expect(() => parsePatrolWorkbook(workbook([row], '2026年10月18日-16日湖南加工厂检查总结', october))).toThrow('早于')
    expect(() => parsePatrolWorkbook(workbook([row], '2026年10月14日-32日湖南加工厂检查总结', october))).toThrow()
    expect(parsePatrolWorkbook(workbook([row], '2026年9月30日至10月16日湖南加工厂检查总结', october)).checkDate).toBe('2026-10-16')
  })
  it('validates both endpoints when whitespace occurs inside the title dates', () => {
    const march = [...header]; march[5] = '3/2评级'
    expect(() => parsePatrolWorkbook(workbook([row], '2026 年2 月30 日–3 月2 日湖南加工厂检查总结', march))).toThrow('有效日期')
    const october = [...header]; october[5] = '10/16评级'
    expect(() => parsePatrolWorkbook(workbook([row], '2026 年10 月18 日–16 日湖南加工厂检查总结', october))).toThrow('早于')
    expect(parsePatrolWorkbook(workbook([row], '2026 年10 月14 日–16 日湖南加工厂检查总结', october)).checkDate).toBe('2026-10-16')
  })
  it('compares a period against its own start rather than an earlier date in the title', () => {
    const october = [...header]; october[5] = '10/16评级'
    expect(() => parsePatrolWorkbook(workbook([row], '2026年9月18日模板 2026年10月18日–16日湖南加工厂检查总结', october))).toThrow('早于')
  })
  it.runIf(!!process.env.PATROL_OCTOBER_REFERENCE_XLSX)('reads the supplied October workbook with its visit period and photos', () => {
    const bytes = fs.readFileSync(process.env.PATROL_OCTOBER_REFERENCE_XLSX!)
    const result = parsePatrolWorkbook(new Uint8Array(bytes).buffer)
    expect(result.checkDate).toBe('2026-10-16')
    expect(result.rows).toHaveLength(39)
    expect(result.rows.flatMap(r => r.photos)).toHaveLength(78)
    expect(result.rows.flatMap(r => r.errors)).toEqual([])
    expect(result.rows[0]?.values).toMatchObject({ planned_date: '', completed_date: '' })
  })
  it('matches factories, blocks duplicate mappings, and skips existing dates', () => {
    const { rows } = parsePatrolWorkbook(workbook([row, [2, '不明工厂', 10, 1, 100, 'B']]))
    matchPatrolFactories(rows, [{ id: 'f1', name: '华宏' }])
    expect(rows[0]?.factory).toBe('f1'); expect(rows[1]?.factory).toBe('')
    expect(patrolImportStatus(rows[0]!, rows, [], '2026-09-18')).toBe('可导入')
    expect(patrolImportStatus(rows[1]!, rows, [], '2026-09-18')).toContain('请选择匹配')
    expect(patrolImportStatus(rows[0]!, rows, [{factory:'f1',check_date:'2026-09-18 00:00:00Z'}], '2026-09-18')).toContain('跳过')
    rows[1]!.factory = 'f1'
    expect(patrolImportStatus(rows[0]!, rows, [], '2026-09-18')).toContain('重复')
  })
  it.runIf(!!process.env.PATROL_REFERENCE_XLSX)('reads the supplied workbook with all photos and cell colors', () => {
    const bytes = fs.readFileSync(process.env.PATROL_REFERENCE_XLSX!)
    const result = parsePatrolWorkbook(new Uint8Array(bytes).buffer)
    expect(result.checkDate).toBe('2026-09-18')
    expect(result.rows).toHaveLength(39)
    expect(result.rows.flatMap(r => r.photos)).toHaveLength(78)
    expect(result.rows.flatMap(r => r.errors)).toEqual([])
    expect(result.rows[0]?.values.visitor_ready).toBe(true)
    expect(result.rows[38]?.values.notes).toBe('取消')
  })
})
