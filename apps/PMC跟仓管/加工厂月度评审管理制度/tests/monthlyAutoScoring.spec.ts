import { describe, expect, it } from 'vitest'
import {
  calculateAutoScore,
  factoryIdsWithOrdersInRange,
  filterMonthlyScoringData,
  mergeAutomaticScores,
} from '../src/utils/monthlyAutoScoring'
import type { Factory } from '../src/types/factory'
import type { ScoreTemplate } from '../src/types/score'

const factory = {
  id: 'factory-1', name: '测试工厂', craft: 'injection', status: 'active',
  cert_status: '有效期内', ip_control: '已建立IP管控',
} as Factory

describe('monthly automatic scoring', () => {
  it('只返回评分范围内有订单的工厂', () => {
    const orders = [
      { id: 'july', factory: 'factory-july', product: '甲', delivery_date: '2026-07-31' },
      { id: 'august', factory: 'factory-august', product: '乙', delivery_date: '2026-08-15' },
      { id: 'september', factory: 'factory-september', product: '丙', delivery_date: '2026-09-01' },
      { id: 'august-2', factory: 'factory-august', product: '丁', delivery_date: '2026-08-20' },
    ]

    expect([...factoryIdsWithOrdersInRange(orders, '2026-08', '2026-08')]).toEqual(['factory-august'])
    expect([...factoryIdsWithOrdersInRange(orders, '2026-08', '2026-09')]).toEqual([
      'factory-august',
      'factory-september',
    ])
  })

  it('scores qualification and IP control as separate five-point items', () => {
    const emptyData = { orders: [], inspections: [], checks: [] }
    expect(calculateAutoScore('qualification', 5, factory, emptyData)?.score).toBe(5)
    expect(calculateAutoScore('qualification', 5, { ...factory, cert_status: '' }, emptyData)?.score).toBe(0)
    expect(calculateAutoScore('ip_control', 5, factory, emptyData)?.score).toBe(5)
    expect(calculateAutoScore('ip_control', 5, { ...factory, ip_control: '' }, emptyData)?.score).toBe(0)
  })

  it('deduplicates order numbers for linear delivery scoring', () => {
    const orders = [
      { id: '1', factory: 'factory-1', order_no: 'A', product: '甲', delivery_date: '2026-07-10', is_delayed: false },
      { id: '2', factory: 'factory-1', order_no: 'A', product: '乙', delivery_date: '2026-07-10', is_delayed: false },
      { id: '3', factory: 'factory-1', order_no: 'B', product: '丙', delivery_date: '2026-07-12', is_delayed: true },
    ]
    expect(calculateAutoScore('delivery', 20, factory, { orders, inspections: [], checks: [] })?.score).toBe(10)
  })

  it('uses REJ ratio and PASS ratio for quality scores', () => {
    const inspections = [
      { id: '1', inspect_date: '2026-07-01', internal_result: 'PASS' },
      { id: '2', inspect_date: '2026-07-02', internal_result: 'REJ' },
      { id: '3', inspect_date: '2026-07-03', internal_result: 'PASS' },
      { id: '4', inspect_date: '2026-07-04', internal_result: 'PASS' },
    ]
    const data = { orders: [], inspections, checks: [] }
    expect(calculateAutoScore('defect_rate', 20, factory, data)?.score).toBe(15)
    expect(calculateAutoScore('process', 5, factory, data)?.score).toBe(3.75)
  })

  it('uses the latest 5S record and preserves manual items', () => {
    const checks = [
      { id: 'old', check_date: '2026-07-01', s_area: 5 },
      { id: 'new', check_date: '2026-07-20', s_area: 10, s_material: 10, s_hygiene: 10, s_sharp: 15, s_nonconform: 15, s_standard: 15, s_qc_staff: 15, s_correction: 10 },
    ]
    expect(calculateAutoScore('5s', 20, factory, { orders: [], inspections: [], checks })?.score).toBe(20)

    const templates = [
      { id: 'auto', module: 'qualification', max_score: 5 },
      { id: 'manual', module: 'cooperation', max_score: 10 },
    ] as ScoreTemplate[]
    const merged = mergeAutomaticScores(templates, [{ template_id: 'manual', score: 8, notes: '人工评价' }], factory, { orders: [], inspections: [], checks })
    expect(merged[0].score).toBe(5)
    expect(merged[1]).toMatchObject({ score: 8, notes: '人工评价' })
  })

  it('scores craft-specific items from defect rate and 5S scores', () => {
    const data = {
      orders: [],
      inspections: [
        { id: '1', inspect_date: '2026-07-01', internal_result: 'PASS' },
        { id: '2', inspect_date: '2026-07-02', internal_result: 'PASS' },
        { id: '3', inspect_date: '2026-07-03', internal_result: 'PASS' },
        { id: '4', inspect_date: '2026-07-04', internal_result: 'REJ' },
      ],
      checks: [
        { id: '1', check_date: '2026-07-20', s_area: 10, s_material: 10, s_hygiene: 10, s_sharp: 15, s_nonconform: 15, s_standard: 15, s_qc_staff: 15, s_correction: 10 },
      ],
    }
    const result = calculateAutoScore('craft_specific', 15, factory, data)
    expect(result?.score).toBe(13.13)
    expect(result?.notes).toContain('月度综合不良率 15/20')
    expect(result?.notes).toContain('5S现场评分 20/20')
  })

  it('filters records into the selected month', () => {
    const data = filterMonthlyScoringData({
      orders: [
        { id: '1', factory: 'factory-1', product: '甲', delivery_date: '2026-07-31' },
        { id: '2', factory: 'factory-1', product: '乙', delivery_date: '2026-08-01' },
      ],
      inspections: [{ id: '1', inspect_date: '2026-07-01' }, { id: '2', inspect_date: '2026-08-01' }],
      checks: [{ id: '1', check_date: '2026-07-01' }, { id: '2', check_date: '2026-08-01' }],
    }, '2026-07')
    expect(data.orders).toHaveLength(1)
    expect(data.inspections).toHaveLength(1)
    expect(data.checks).toHaveLength(1)
  })
})
