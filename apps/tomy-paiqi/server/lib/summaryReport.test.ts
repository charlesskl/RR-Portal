import { describe, it, expect } from 'vitest'
import type { ReconciliationResult, RowMatchResult, POItem, POData } from '../types/index.js'
import { buildSummaryReport } from './summaryReport.js'

// Helper: build minimal RowMatchResult
function makeMatchResult(overrides: Partial<RowMatchResult> = {}): RowMatchResult {
  return {
    scheduleRowIndex: 1,
    tomyPO: 'T001',
    货号: 'ABC123',
    status: 'matched',
    mismatches: [],
    dateCode: '2603',
    sourceFile: 'test.pdf',
    ...overrides,
  }
}

// Helper: build minimal POItem
function makePOItem(overrides: Partial<POItem> = {}): POItem {
  return {
    货号: 'ABC123',
    PO走货期: '15 May 2026',
    数量: 1000,
    factoryCode: 'RR01',
    外箱: 6,
    ...overrides,
  }
}

// Helper: build minimal POData
function makePOData(overrides: Partial<POData> = {}): POData {
  return {
    tomyPO: 'T001',
    customerPO: 'CUST-001',
    handleBy: 'Alice',
    customerName: 'TOMY UK',
    destCountry: 'UK',
    items: [makePOItem()],
    sourceFile: 'test.pdf',
    qcInstructions: '',
    ...overrides,
  }
}

// Helper: build empty ReconciliationResult
function emptyResult(): ReconciliationResult {
  return {
    matched: [],
    unmatchedPOItems: [],
    ambiguousPOItems: [],
    errors: [],
  }
}

describe('buildSummaryReport', () => {
  it('report header contains TOMY 排期核对汇总报告 and generation timestamp', () => {
    const report = buildSummaryReport(emptyResult(), emptyResult())
    expect(report).toContain('TOMY 排期核对汇总报告')
    // Timestamp: should contain at least year and some date-like characters
    expect(report).toMatch(/202[0-9]/)
  })

  it('matched rows with mismatches appear with PO number, factory label, field name, scheduleValue and poValue', () => {
    const dgResult: ReconciliationResult = {
      matched: [
        makeMatchResult({
          tomyPO: 'T-DG-001',
          货号: 'ITEM001',
          mismatches: [
            { field: 'PO走货期', scheduleValue: '2026-03-15', poValue: '2026-04-10' },
          ],
        }),
      ],
      unmatchedPOItems: [],
      ambiguousPOItems: [],
      errors: [],
    }
    const report = buildSummaryReport(dgResult, emptyResult())
    expect(report).toContain('T-DG-001')
    expect(report).toContain('ITEM001')
    expect(report).toContain('RR01/东莞')
    expect(report).toContain('PO走货期')
    expect(report).toContain('2026-03-15')
    expect(report).toContain('2026-04-10')
  })

  it('unmatched PO items appear with PO number, 货号, sourceFile, and factory label', () => {
    const idResult: ReconciliationResult = {
      matched: [],
      unmatchedPOItems: [
        {
          tomyPO: 'T-ID-002',
          货号: 'ITEM002',
          sourceFile: 'po-indonesia.pdf',
          poItem: makePOItem({ factoryCode: 'RR02' }),
          poData: makePOData({ tomyPO: 'T-ID-002', sourceFile: 'po-indonesia.pdf' }),
        },
      ],
      ambiguousPOItems: [],
      errors: [],
    }
    const report = buildSummaryReport(emptyResult(), idResult)
    expect(report).toContain('T-ID-002')
    expect(report).toContain('ITEM002')
    expect(report).toContain('po-indonesia.pdf')
    expect(report).toContain('RR02/印尼')
  })

  it('when both results have zero mismatches and zero unmatched, report shows 共 0 条 for both sections', () => {
    const report = buildSummaryReport(emptyResult(), emptyResult())
    // Should appear twice (once for mismatches section, once for unmatched section)
    const matches = report.match(/共 0 条/g)
    expect(matches).not.toBeNull()
    expect(matches!.length).toBeGreaterThanOrEqual(2)
  })

  it('factory labels use RR01/东莞 for dgResult and RR02/印尼 for idResult', () => {
    const dgResult: ReconciliationResult = {
      matched: [
        makeMatchResult({
          tomyPO: 'DG-PO',
          mismatches: [{ field: '数量', scheduleValue: 100, poValue: 200 }],
        }),
      ],
      unmatchedPOItems: [
        {
          tomyPO: 'DG-UNMATCHED',
          货号: 'DGUNMATCHED',
          sourceFile: 'dg.pdf',
          poItem: makePOItem(),
          poData: makePOData(),
        },
      ],
      ambiguousPOItems: [],
      errors: [],
    }
    const idResult: ReconciliationResult = {
      matched: [
        makeMatchResult({
          tomyPO: 'ID-PO',
          mismatches: [{ field: '数量', scheduleValue: 50, poValue: 100 }],
        }),
      ],
      unmatchedPOItems: [
        {
          tomyPO: 'ID-UNMATCHED',
          货号: 'IDUNMATCHED',
          sourceFile: 'id.pdf',
          poItem: makePOItem({ factoryCode: 'RR02' }),
          poData: makePOData(),
        },
      ],
      ambiguousPOItems: [],
      errors: [],
    }
    const report = buildSummaryReport(dgResult, idResult)
    // Both factory labels should appear
    expect(report).toContain('RR01/东莞')
    expect(report).toContain('RR02/印尼')
  })
})
