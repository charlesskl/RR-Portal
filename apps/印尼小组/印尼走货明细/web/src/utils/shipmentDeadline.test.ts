import { afterEach, describe, expect, it, vi } from 'vitest'
import { deliveryDeadline, loadHolidayCalendar, shipmentDeadline, syncedShipmentDeadline } from './shipmentDeadline'

afterEach(() => vi.unstubAllGlobals())

const calendar = (year: number) => ({ year, papers: ['https://www.gov.cn/test.htm'], days:
  ['元旦', '春节', '清明节', '劳动节', '端午节', '中秋节', '国庆节'].map((name, i) => ({ name, date: `${year}-${String(i + 1).padStart(2, '0')}-01`, isOffDay: true })) })
function storage() {
  const entries = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => entries.set(key, value) })
  return entries
}

describe('automatic holiday sync', () => {
  it('downloads a new year and reuses the validated cache', async () => {
    storage()
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => calendar(2027) })
    vi.stubGlobal('fetch', fetcher)
    expect(await syncedShipmentDeadline('2027-09-06')).toBe('BEFORE September.4,2027')
    await loadHolidayCalendar(2027)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('retains stale cache offline', async () => {
    storage().set('indo-holidays-v1-2027', JSON.stringify({ updatedAt: 0, calendar: calendar(2027) }))
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    expect((await loadHolidayCalendar(2027)).has('2027-01-01')).toBe(true)
  })
  it('rejects unpublished or partial years and falls back to built-in 2026', async () => {
    storage()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ year: 2027, papers: [], days: [] }) }))
    await expect(loadHolidayCalendar(2027)).rejects.toThrow('尚未公布或同步失败')
    expect((await loadHolidayCalendar(2026)).has('2026-09-26')).toBe(true)
  })
  it('tries the backup source and tolerates disabled storage', async () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error() }, setItem: () => { throw new Error() } })
    const fetcher = vi.fn().mockRejectedValueOnce(new Error()).mockResolvedValue({ ok: true, json: async () => calendar(2027) })
    vi.stubGlobal('fetch', fetcher)
    expect((await loadHolidayCalendar(2027)).size).toBe(7)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})

describe('shipment deadline', () => {
  it.each([
    ['BEFORE September.23,2026', 'BEFORE September.16,2026'],
    ['BEFORE September.24,2026', 'BEFORE September.17,2026'],
    ['BEFORE March.3,2026', 'BEFORE February.24,2026'],
    ['BEFORE January.3,2026', 'BEFORE December.27,2025'],
    ['', ''],
  ])('sets delivery exactly one week before %s', (shipment, expected) => {
    expect(deliveryDeadline(shipment)).toBe(expected)
  })
  it.each([
    ['2026-09-30', 'September.29,2026'],
    ['2026-09-21', 'September.19,2026'],
    ['2026-09-20', 'September.19,2026'],
    ['2026-09-19', 'September.18,2026'],
    ['2026-09-28', 'September.24,2026'],
    ['2026-10-08', 'September.30,2026'],
    ['2026-02-24', 'February.14,2026'],
    ['2026-01-04', 'December.31,2025'],
  ])('%s skips Sundays and mainland holidays but allows Saturdays', (cutoff, expected) => {
    expect(shipmentDeadline(cutoff)).toBe(`BEFORE ${expected}`)
  })
  it('does not guess holidays for unsupported years or accept invalid dates', () => {
    expect(() => shipmentDeadline('2027-09-30')).toThrow('日历')
    expect(() => shipmentDeadline('2026-02-30')).toThrow('格式')
  })
})
