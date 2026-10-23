import { describe, expect, it } from 'vitest'
import { linkPurchaseLine, matchingLineSchedules } from './purchaseScheduleLink'

const schedule = { code: '35874VAZJ', orderNo: '10130001', eta: '2026-12-23', qty: 5000, source: 'RRM' }
const line = { id: 12, material_id: 81, product_code: '35874VAZJ', material_name: '贴纸',
  tomy_po: '', eta: '2026-10-28', ordered_qty: 20004, purchase_qty: 20200, material_qty: 20004,
  spoilage_qty: 196, price: 0.08, currency: '¥', ship_unit: 'TNE', net_per_pc: 0.0004, notes: '保留备注' }

describe('purchase line schedule association', () => {
  it('only changes order association and shipment date, without adding a line or overwriting money/quantities', () => {
    const linked = linkPurchaseLine(line, schedule, [schedule], [line], 'IRRMHS0066')
    expect(linked).toEqual({ ...line, tomy_po: '10130001', eta: '2026-12-23' })
    expect(line.eta).toBe('2026-10-28')
    expect(line.tomy_po).toBe('')
  })
  it('retains the manually entered date when the schedule has none', () => {
    const missingDate = { ...schedule, eta: '  ' }
    expect(linkPurchaseLine(line, missingDate, [missingDate], [line], '').eta).toBe(line.eta)
  })
  it('matches exact product codes, including suffixes, and requires an order number', () => {
    const unrelated = [{ ...schedule, code: '35874VAZ' }, { ...schedule, code: '35874VAZJ2' }, { ...schedule, orderNo: '' }]
    expect(matchingLineSchedules({ product_code: ' 35874vazj ' }, [...unrelated, schedule])).toEqual([schedule])
    expect(() => linkPurchaseLine(line, unrelated[0], unrelated, [line], '')).toThrow('完全一致')
  })
  it('does not replace associations of merged multi-product rows', () => {
    expect(matchingLineSchedules({ product_code: '35874VAZJ / 47669' }, [schedule])).toEqual([])
  })
  it('retains RRI/RRM contract source safeguards, including HSY orders', () => {
    expect(() => linkPurchaseLine(line, schedule, [schedule], [line], 'IRRIHS0410')).toThrow('当前 RRI')
    const existing = { ...line, product_code: '47669', tomy_po: 'OTHER' }
    const otherSchedule = { code: '47669', orderNo: 'OTHER', source: 'RRI' }
    expect(() => linkPurchaseLine(line, schedule, [schedule, otherSchedule], [line, existing], '2026900172')).toThrow('当前 RRI')
    expect(() => linkPurchaseLine(line, schedule, [schedule], [line, existing], '2026900172')).toThrow('未能确认')
  })
  it('replaces the selected row association only and can be reapplied without cumulative changes', () => {
    const existing = { ...line, tomy_po: schedule.orderNo }
    const newSchedule = { ...schedule, orderNo: '10130002', eta: '2026-12-30' }
    const linked = linkPurchaseLine(existing, newSchedule, [schedule, newSchedule], [existing], 'IRRMHS0066')
    expect(linked.tomy_po).toBe(newSchedule.orderNo)
    expect(linkPurchaseLine(linked, newSchedule, [schedule, newSchedule], [linked], 'IRRMHS0066')).toEqual(linked)
  })
  it('recognizes multiple full Spin SKUs in an existing merged HSY line', () => {
    const first = '94704/1099803/6077834', second = '97282/1099235/6077462'
    const selected = { code: first, orderNo: 'NEW', source: 'Spin Master', customer: 'Spin Master' }
    const history = [selected, { ...selected, orderNo: 'OLD1' }, { ...selected, code: second, orderNo: 'OLD2' }]
    const target = { ...line, product_code: first }
    const merged = { product_code: first + ' / ' + second, tomy_po: 'OLD1; OLD2' }
    const products = [first, second].map(code => ({ code, customer: 'Spin Master' }))
    expect(linkPurchaseLine(target, selected, history, [target, merged], '2026900171', products))
      .toEqual({ ...target, tomy_po: 'NEW' })
    // Unknown order origins remain blocked; never infer them from SKU fragments.
    expect(() => linkPurchaseLine(target, selected, history.slice(0, 2), [target, merged], '2026900171', products))
      .toThrow('来源未能确认')
  })
  it('uses the existing suffix resolver for a legacy order absent from the latest schedule', () => {
    const selected = { code: '47669TSCA', orderNo: 'NEW', source: 'KIK', customer: 'TOMY' }
    const target = { ...line, product_code: selected.code, tomy_po: 'OLD' }
    const resolve = (code: string) => code === selected.code ? '47669' : code
    expect(linkPurchaseLine(target, selected, [selected], [target], 'IRRIHS0405',
      [{ code: '47669', customer: 'TOMY' }], resolve)).toEqual({ ...target, tomy_po: 'NEW' })
    expect(() => linkPurchaseLine(target, selected, [selected], [target], 'IRRIHS0405',
      [{ code: '47669', customer: 'Spin Master' }], resolve)).toThrow('客户不一致')
  })
})
