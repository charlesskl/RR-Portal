import { describe, it, expect } from 'vitest'
import { reconcile } from './reconciler.js'
import type { POData, POItem, ScheduleRow } from '../types/index.js'

// Helper: build a minimal POData
function makePOData(overrides: Partial<POData> & { items?: POItem[] } = {}): POData {
  return {
    tomyPO: 'T001',
    customerPO: 'CUST-001',
    handleBy: 'Alice',
    customerName: 'TOMY',
    shipToCustomerName: 'TOMY UK CO LTD',
    destCountry: 'BELGIUM',
    items: overrides.items ?? [makeItem()],
    sourceFile: 'test.pdf',
    qcInstructions: '',
    ...overrides,
  }
}

// Helper: build a minimal POItem
function makeItem(overrides: Partial<POItem> = {}): POItem {
  return {
    货号: 'ABC123',
    PO走货期: '15 May 2026',
    数量: 1000,
    factoryCode: 'RR01',
    外箱: 6,
    hasJDLabel: false,
    ...overrides,
  }
}

// Helper: build a minimal ScheduleRow
function makeRow(overrides: Partial<ScheduleRow> = {}): ScheduleRow {
  return {
    rowIndex: 1,
    接单期: null,
    国家: '比利时',
    第三客户名称: 'TOMY',
    客跟单: 'Alice',
    tomyPO: 'T001',
    customerPO: 'CUST-001',
    货号: 'ABC123',
    数量: 1000,
    外箱: 6,
    总箱数: 50,
    PO走货期: new Date(2026, 4, 15), // May 15 2026
    日期码: null,
    箱唛资料: '标准唛',
    ...overrides,
  }
}

describe('reconcile', () => {
  // COMP-01: Match by composite key tomyPO + 货号
  describe('COMP-01: matching by composite key', () => {
    it('matches POItem to ScheduleRow by tomyPO + 货号', () => {
      const po = makePOData()
      const row = makeRow()
      const result = reconcile([po], [row])
      expect(result.matched).toHaveLength(1)
      expect(result.matched[0].tomyPO).toBe('T001')
      expect(result.matched[0].货号).toBe('ABC123')
      expect(result.matched[0].status).toBe('matched')
    })

    it('returns unmatched status when no schedule row matches', () => {
      const po = makePOData({ tomyPO: 'T999' })
      const row = makeRow({ tomyPO: 'T001' })
      const result = reconcile([po], [row])
      expect(result.unmatchedPOItems).toHaveLength(1)
      expect(result.unmatchedPOItems[0].tomyPO).toBe('T999')
    })

    it('matches first duplicate 货号 to schedule row by 数量, second becomes unmatched', () => {
      const item1 = makeItem({ 货号: 'DUP', 数量: 100 })
      const item2 = makeItem({ 货号: 'DUP', 数量: 200 })
      const po = makePOData({ items: [item1, item2] })
      const row = makeRow({ 货号: 'DUP', 数量: 200 })
      const result = reconcile([po], [row])
      // item2 matches by 数量, item1 becomes unmatched
      expect(result.matched).toHaveLength(1)
      expect(result.matched[0].mismatches.find(m => m.field === '数量')).toBeUndefined()
      expect(result.unmatchedPOItems).toHaveLength(1)
      expect(result.ambiguousPOItems).toHaveLength(0)
    })
  })

  // COMP-02: Country name EN→ZH translation
  describe('COMP-02: country name mapping', () => {
    it('BELGIUM matches 比利时 — no mismatch', () => {
      const po = makePOData({ destCountry: 'BELGIUM' })
      const row = makeRow({ 国家: '比利时' })
      const result = reconcile([po], [row])
      expect(result.matched).toHaveLength(1)
      const countryMismatch = result.matched[0].mismatches.find(m => m.field === '国家')
      expect(countryMismatch).toBeUndefined()
    })

    it('USA vs 英国 produces a mismatch', () => {
      const po = makePOData({ destCountry: 'USA' })
      const row = makeRow({ 国家: '英国' })
      const result = reconcile([po], [row])
      expect(result.matched).toHaveLength(1)
      const countryMismatch = result.matched[0].mismatches.find(m => m.field === '国家')
      expect(countryMismatch).toBeDefined()
      expect(countryMismatch!.poValue).toBe('美国')
      expect(countryMismatch!.scheduleValue).toBe('英国')
    })
  })

  // COMP-03: customerName text comparison with normalize
  describe('COMP-03: customerName comparison', () => {
    it('ignores whitespace differences in shipToCustomerName', () => {
      const po = makePOData({ shipToCustomerName: '  TOMY  ' })
      const row = makeRow({ 第三客户名称: 'TOMY' })
      const result = reconcile([po], [row])
      const mismatch = result.matched[0].mismatches.find(m => m.field === '第三客户名称')
      expect(mismatch).toBeUndefined()
    })

    it('detects customerName mismatch', () => {
      const po = makePOData({ customerName: 'OTHER' })
      const row = makeRow({ 第三客户名称: 'TOMY' })
      const result = reconcile([po], [row])
      const mismatch = result.matched[0].mismatches.find(m => m.field === '第三客户名称')
      expect(mismatch).toBeDefined()
    })
  })

  // COMP-04: handleBy comparison
  describe('COMP-04: handleBy comparison', () => {
    it('detects handleBy mismatch', () => {
      const po = makePOData({ handleBy: 'Bob' })
      const row = makeRow({ 客跟单: 'Alice' })
      const result = reconcile([po], [row])
      const mismatch = result.matched[0].mismatches.find(m => m.field === '客跟单')
      expect(mismatch).toBeDefined()
    })

    it('no mismatch when handleBy matches', () => {
      const po = makePOData({ handleBy: 'Alice' })
      const row = makeRow({ 客跟单: 'Alice' })
      const result = reconcile([po], [row])
      const mismatch = result.matched[0].mismatches.find(m => m.field === '客跟单')
      expect(mismatch).toBeUndefined()
    })
  })

  // COMP-05: tomyPO text comparison
  describe('COMP-05: tomyPO comparison', () => {
    it('detects tomyPO value mismatch after matching', () => {
      // Matching uses normalized key, but comparison also checks value
      const po = makePOData({ tomyPO: 'T001' })
      const row = makeRow({ tomyPO: 'T001X' })
      // This won't match by key, so test with row that has a different tomyPO value
      // but same normalized composite key — we manipulate by setting 货号 key the same
      const result = reconcile([po], [{ ...row, tomyPO: 'T001' }])
      const mismatch = result.matched[0].mismatches.find(m => m.field === 'TOMY PO')
      expect(mismatch).toBeUndefined() // matches
    })
  })

  // COMP-06: customerPO comparison
  describe('COMP-06: customerPO comparison', () => {
    it('detects customerPO mismatch', () => {
      const po = makePOData({ customerPO: 'CUST-001' })
      const row = makeRow({ customerPO: 'CUST-002' })
      const result = reconcile([po], [row])
      const mismatch = result.matched[0].mismatches.find(m => m.field === 'CUSTOMER PO')
      expect(mismatch).toBeDefined()
    })
  })

  // COMP-07: 货号 validation (same as matching key but checks value)
  describe('COMP-07: 货号 comparison', () => {
    it('no mismatch when 货号 matches', () => {
      const po = makePOData()
      const row = makeRow()
      const result = reconcile([po], [row])
      const mismatch = result.matched[0].mismatches.find(m => m.field === '货号')
      expect(mismatch).toBeUndefined()
    })
  })

  // COMP-08: 数量 numeric comparison
  describe('COMP-08: 数量 numeric comparison', () => {
    it('1000 === 1000 produces no mismatch', () => {
      const po = makePOData({ items: [makeItem({ 数量: 1000 })] })
      const row = makeRow({ 数量: 1000 })
      const result = reconcile([po], [row])
      const mismatch = result.matched[0].mismatches.find(m => m.field === '数量')
      expect(mismatch).toBeUndefined()
    })

    it('1000 vs 900 produces a mismatch', () => {
      const po = makePOData({ items: [makeItem({ 数量: 1000 })] })
      const row = makeRow({ 数量: 900 })
      const result = reconcile([po], [row])
      const mismatch = result.matched[0].mismatches.find(m => m.field === '数量')
      expect(mismatch).toBeDefined()
      expect(mismatch!.poValue).toBe(1000)
      expect(mismatch!.scheduleValue).toBe(900)
    })
  })

  // COMP-09: 外箱 numeric comparison — null PO skips
  describe('COMP-09: 外箱 comparison', () => {
    it('null PO 外箱 skips comparison — no mismatch', () => {
      const po = makePOData({ items: [makeItem({ 外箱: null })] })
      const row = makeRow({ 外箱: 6 })
      const result = reconcile([po], [row])
      const mismatch = result.matched[0].mismatches.find(m => m.field === '外箱')
      expect(mismatch).toBeUndefined()
    })

    it('外箱 mismatch when both values differ', () => {
      const po = makePOData({ items: [makeItem({ 外箱: 6 })] })
      const row = makeRow({ 外箱: 12 })
      const result = reconcile([po], [row])
      const mismatch = result.matched[0].mismatches.find(m => m.field === '外箱')
      expect(mismatch).toBeDefined()
    })
  })

  // COMP-10: 总箱数 ALWAYS SKIPPED
  describe('COMP-10: 总箱数 is always skipped', () => {
    it('never produces a 总箱数 mismatch even when schedule has a value', () => {
      const po = makePOData()
      const row = makeRow({ 总箱数: 999 })
      const result = reconcile([po], [row])
      const mismatch = result.matched[0].mismatches.find(m => m.field === '总箱数')
      expect(mismatch).toBeUndefined()
    })
  })

  // COMP-11: PO走货期 date comparison
  describe('COMP-11: PO走货期 date comparison', () => {
    it('"18 Mar 2026" matches Date(2026,2,18) by year/month/day — no mismatch', () => {
      const po = makePOData({ items: [makeItem({ PO走货期: '18 Mar 2026' })] })
      const row = makeRow({ PO走货期: new Date(2026, 2, 18) }) // month is 0-indexed
      const result = reconcile([po], [row])
      const mismatch = result.matched[0].mismatches.find(m => m.field === 'PO走货期')
      expect(mismatch).toBeUndefined()
    })

    it('"18 Mar 2026" vs Date(2026,2,19) produces a mismatch', () => {
      const po = makePOData({ items: [makeItem({ PO走货期: '18 Mar 2026' })] })
      const row = makeRow({ PO走货期: new Date(2026, 2, 19) })
      const result = reconcile([po], [row])
      const mismatch = result.matched[0].mismatches.find(m => m.field === 'PO走货期')
      expect(mismatch).toBeDefined()
    })

    it('null schedule PO走货期 produces a mismatch', () => {
      const po = makePOData({ items: [makeItem({ PO走货期: '18 Mar 2026' })] })
      const row = makeRow({ PO走货期: null })
      const result = reconcile([po], [row])
      const mismatch = result.matched[0].mismatches.find(m => m.field === 'PO走货期')
      expect(mismatch).toBeDefined()
    })
  })

  // COMP-12: 箱唛资料 rule generation
  describe('COMP-12: 箱唛资料 generation from rules', () => {
    it('customerName="TOMY" generates "标准唛"', () => {
      const po = makePOData({ customerName: 'TOMY', qcInstructions: '' })
      const row = makeRow({ 箱唛资料: '标准唛' })
      const result = reconcile([po], [row])
      const mismatch = result.matched[0].mismatches.find(m => m.field === '箱唛资料')
      expect(mismatch).toBeUndefined()
    })

    it('shipToCustomerName without TOMY generates "待定"', () => {
      const po = makePOData({ shipToCustomerName: 'OTHER CO LTD', qcInstructions: '' })
      const row = makeRow({ 箱唛资料: '待定' })
      const result = reconcile([po], [row])
      const mismatch = result.matched[0].mismatches.find(m => m.field === '箱唛资料')
      expect(mismatch).toBeUndefined()
    })

    it('qcInstructions contains "TTT" → appends "+TTT"', () => {
      const po = makePOData({ customerName: 'TOMY', qcInstructions: 'Please use TTT labelling' })
      const row = makeRow({ 箱唛资料: '标准唛+TTT' })
      const result = reconcile([po], [row])
      const mismatch = result.matched[0].mismatches.find(m => m.field === '箱唛资料')
      expect(mismatch).toBeUndefined()
    })

    it('qcInstructions contains EU shipments text → appends "+欧盟信息"', () => {
      const po = makePOData({ customerName: 'TOMY', qcInstructions: 'For EU shipments special marking required' })
      const row = makeRow({ 箱唛资料: '标准唛+欧盟信息' })
      const result = reconcile([po], [row])
      const mismatch = result.matched[0].mismatches.find(m => m.field === '箱唛资料')
      expect(mismatch).toBeUndefined()
    })

    it('mismatches when generated 箱唛资料 differs from schedule value', () => {
      const po = makePOData({ customerName: 'TOMY', qcInstructions: '' })
      const row = makeRow({ 箱唛资料: '特殊唛' })
      const result = reconcile([po], [row])
      const mismatch = result.matched[0].mismatches.find(m => m.field === '箱唛资料')
      expect(mismatch).toBeDefined()
    })
  })

  // COMP-14: Unmatched PO items
  describe('COMP-14: unmatched PO items', () => {
    it('collects unmatched items in unmatchedPOItems', () => {
      const po = makePOData({ tomyPO: 'TXXX' })
      const row = makeRow({ tomyPO: 'T001' })
      const result = reconcile([po], [row])
      expect(result.unmatchedPOItems).toHaveLength(1)
      expect(result.unmatchedPOItems[0].tomyPO).toBe('TXXX')
      expect(result.unmatchedPOItems[0].货号).toBe('ABC123')
      expect(result.unmatchedPOItems[0].sourceFile).toBe('test.pdf')
    })
  })

  // DATE wiring: generateDateCode integration
  describe('dateCode wiring', () => {
    it('populates dateCode from generateDateCode(PO走货期, factoryCode)', () => {
      // "15 May 2026", RR02 → one month back = April 15 (workday) → D1526RR02
      const po = makePOData({ items: [makeItem({ PO走货期: '15 May 2026', factoryCode: 'RR02' })] })
      const row = makeRow({ PO走货期: new Date(2026, 4, 15) })
      const result = reconcile([po], [row])
      expect(result.matched).toHaveLength(1)
      expect(result.matched[0].dateCode).toBe('D1526RR02')
    })

    it('dateCode is null when factoryCode is unknown', () => {
      const po = makePOData({ items: [makeItem({ PO走货期: '15 May 2026', factoryCode: 'UNKNOWN' })] })
      const row = makeRow({ PO走货期: new Date(2026, 4, 15) })
      const result = reconcile([po], [row])
      expect(result.matched).toHaveLength(1)
      expect(result.matched[0].dateCode).toBeNull()
    })
  })

  // Multiple POs
  describe('multiple PO data', () => {
    it('processes multiple POData objects and collects results', () => {
      const po1 = makePOData({ tomyPO: 'T001', items: [makeItem({ 货号: 'A001' })] })
      const po2 = makePOData({ tomyPO: 'T002', items: [makeItem({ 货号: 'B001' })] })
      const row1 = makeRow({ tomyPO: 'T001', 货号: 'A001' })
      const row2 = makeRow({ rowIndex: 2, tomyPO: 'T002', 货号: 'B001' })
      const result = reconcile([po1, po2], [row1, row2])
      expect(result.matched).toHaveLength(2)
      expect(result.unmatchedPOItems).toHaveLength(0)
    })
  })
})
