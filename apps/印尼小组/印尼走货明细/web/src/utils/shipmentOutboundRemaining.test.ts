import { expect, it } from 'vitest'
import { outboundCandidates, planOutboundPull } from './shipmentOutboundRemaining'

const sources = [
  { outbound_id: 70, material_id: 974, allocatable_qty: 9000, outbound_qty: 9000, allocated_current: 9000 },
  { outbound_id: 74, material_id: 975, allocatable_qty: 8150, outbound_qty: 8150, allocated_current: 6000 },
  { outbound_id: 75, material_id: 975, allocatable_qty: 82, outbound_qty: 82, allocated_current: 0 },
]
it('全部拉入隐藏，部分拉入仅显示剩余量，同物料另一笔出库不受影响', () => {
  const rows = [{ outbound_id: 70, qty: 9000 }, { outbound_id: 74, qty: 6000 }]
  expect(outboundCandidates(sources, rows).map(row => [row.outbound_id, row.remaining_qty, row.allocated_in_editor]))
    .toEqual([[74, 2150, 6000], [75, 82, 0]])
})
it('扣除所有已保存和未保存源行，不扣 API allocated_current 两次或用汇总行重复计数', () => {
  const rows = [{ _rowKey: 1, outbound_id: 74, qty: 6000 }, { _rowKey: 2, outbound_id: 74, qty: 2000 }]
  const before = structuredClone({ sources, rows })
  expect(outboundCandidates(sources, rows).find(row => row.outbound_id === 74)?.remaining_qty).toBe(150)
  expect({ sources, rows }).toEqual(before)
  expect(sources[1].allocatable_qty).toBe(8150)
})
it('删除本柜尚未保存的行后恢复额度，后台保存的当前柜占用不阻止重新拉入', () => {
  expect(outboundCandidates(sources, []).find(row => row.outbound_id === 70)?.remaining_qty).toBe(9000)
})
it('其他柜占用已经包含在上限里，本柜仅扣自己的实时数量', () => {
  const source = { outbound_id: 70, allocatable_qty: 7000, outbound_qty: 9000, allocated_other: 2000, allocated_current: 3000 }
  expect(outboundCandidates([source], [{ outbound_id: 70, qty: 3000 }])[0].remaining_qty).toBe(4000)
})
it('超配、无效额度和浮点尾差不产生虚假的可选记录，正常小数余量保留精度', () => {
  expect(outboundCandidates([{ outbound_id: 1, allocatable_qty: .3 }], [{ outbound_id: 1, qty: .1 }, { outbound_id: 1, qty: .2 }])).toEqual([])
  expect(outboundCandidates([{ outbound_id: 1, allocatable_qty: .3001 }], [{ outbound_id: 1, qty: .3 }])[0].remaining_qty).toBeCloseTo(.0001, 12)
  expect(outboundCandidates([{ outbound_id: 1, allocatable_qty: 10 }], [{ outbound_id: 1, qty: 11 }])).toEqual([])
  for (const allocatable_qty of [0, -1, NaN, Infinity, undefined])
    expect(outboundCandidates([{ outbound_id: 1, allocatable_qty }], [])).toEqual([])
})
it('按最新剩余额度规划拉入，重复勾选同一出库只拉一次', () => {
  const rows = [{ outbound_id: 74, qty: 8000 }]
  expect(planOutboundPull(sources, rows, [74, 74, 75]).map(row => [row.outbound_id, row.remaining_qty])).toEqual([[74, 150], [75, 82]])
})
it('所选一笔失效则整次拦截，提示具体 OUT 单，不部分拉入', () => {
  expect(() => planOutboundPull(sources, [{ outbound_id: 70, qty: 9000 }], [74, 70])).toThrow('OUT-70')
  expect(() => planOutboundPull(sources, [], [999])).toThrow('OUT-999')
  expect(() => planOutboundPull(sources, [], [])).toThrow('请先勾选')
})
