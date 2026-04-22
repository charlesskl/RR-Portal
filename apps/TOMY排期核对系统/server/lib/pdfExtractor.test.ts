import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { extractPO } from './pdfExtractor.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '../../')

describe('extractPO', () => {
  // Test against PO 10114426 — PURCHASE ORDER sub-type, multi-item (RR01, 4 SKUs)
  describe('PO 10114426 (PURCHASE ORDER, multi-item, RR01)', () => {
    const buffer = readFileSync(
      resolve(PROJECT_ROOT, 'PO_10114426_RR_20260318_103339.pdf')
    )
    let result: Awaited<ReturnType<typeof extractPO>>

    it('extracts tomyPO correctly', async () => {
      result = await extractPO(buffer, 'PO_10114426_RR_20260318_103339.pdf')
      expect(result.tomyPO).toBe('10114426')
    }, 30000)

    it('extracts customerPO correctly', async () => {
      const r = await extractPO(buffer, 'PO_10114426_RR_20260318_103339.pdf')
      expect(r.customerPO).toBeTruthy()
      expect(r.customerPO.length).toBeGreaterThan(0)
    }, 30000)

    it('extracts handleBy correctly', async () => {
      const r = await extractPO(buffer, 'PO_10114426_RR_20260318_103339.pdf')
      expect(r.handleBy).toBeTruthy()
      expect(r.handleBy.length).toBeGreaterThan(0)
    }, 30000)

    it('extracts customerName correctly', async () => {
      const r = await extractPO(buffer, 'PO_10114426_RR_20260318_103339.pdf')
      expect(r.customerName).toBeTruthy()
    }, 30000)

    it('extracts destCountry correctly', async () => {
      const r = await extractPO(buffer, 'PO_10114426_RR_20260318_103339.pdf')
      expect(r.destCountry).toBeTruthy()
    }, 30000)

    it('returns items array with at least 3 items (multi-item PO)', async () => {
      const r = await extractPO(buffer, 'PO_10114426_RR_20260318_103339.pdf')
      expect(r.items.length).toBeGreaterThanOrEqual(3)
    }, 30000)

    it('each item has required fields populated', async () => {
      const r = await extractPO(buffer, 'PO_10114426_RR_20260318_103339.pdf')
      for (const item of r.items) {
        expect(item.货号, `货号 should not be empty`).toBeTruthy()
        expect(item.PO走货期, `PO走货期 should not be empty`).toBeTruthy()
        expect(item.数量, `数量 should be > 0`).toBeGreaterThan(0)
        expect(item.factoryCode, `factoryCode should match RR0x`).toMatch(/^RR0[12]$/)
      }
    }, 30000)

    it('preserves sourceFile', async () => {
      const r = await extractPO(buffer, 'PO_10114426_RR_20260318_103339.pdf')
      expect(r.sourceFile).toBe('PO_10114426_RR_20260318_103339.pdf')
    }, 30000)
  })

  // Test against PO 10114976 — PURCHASE ORDER, 2 SKUs
  describe('PO 10114976 (PURCHASE ORDER, 2 SKUs)', () => {
    it('returns items array with at least 2 items', async () => {
      const buffer = readFileSync(
        resolve(PROJECT_ROOT, 'PO_10114976_RR_20260318_164647.pdf')
      )
      const r = await extractPO(buffer, 'PO_10114976_RR_20260318_164647.pdf')
      expect(r.tomyPO).toBe('10114976')
      expect(r.items.length).toBeGreaterThanOrEqual(2)
    }, 30000)
  })

  // Test against PO 10122817 — SUBSEQUENT ORDER sub-type
  describe('PO 10122817 (SUBSEQUENT ORDER)', () => {
    it('extracts header fields from SUBSEQUENT ORDER correctly', async () => {
      const buffer = readFileSync(
        resolve(PROJECT_ROOT, 'PO_10122817_RR_20260318_122816.pdf')
      )
      const r = await extractPO(buffer, 'PO_10122817_RR_20260318_122816.pdf')
      expect(r.tomyPO).toBe('10122817')
      expect(r.customerPO).toBeTruthy()
      expect(r.handleBy).toBeTruthy()
      expect(r.items.length).toBeGreaterThanOrEqual(1)
    }, 30000)
  })

  // Test against PO 10122821 — SUBSEQUENT ORDER, multi-item
  describe('PO 10122821 (SUBSEQUENT ORDER, multi-item)', () => {
    it('returns multiple items for multi-item SUBSEQUENT ORDER', async () => {
      const buffer = readFileSync(
        resolve(PROJECT_ROOT, 'PO_10122821_RR_20260318_122906.pdf')
      )
      const r = await extractPO(buffer, 'PO_10122821_RR_20260318_122906.pdf')
      expect(r.tomyPO).toBe('10122821')
      expect(r.items.length).toBeGreaterThanOrEqual(2)
    }, 30000)
  })

  // Test 外箱 extraction
  describe('carton packing (外箱)', () => {
    it('extracts 外箱 as a number from MASTER CARTON pattern', async () => {
      const buffer = readFileSync(
        resolve(PROJECT_ROOT, 'PO_10114426_RR_20260318_103339.pdf')
      )
      const r = await extractPO(buffer, 'PO_10114426_RR_20260318_103339.pdf')
      // At least some items should have 外箱 extracted
      const itemsWithCarton = r.items.filter(i => i.外箱 !== null)
      expect(itemsWithCarton.length).toBeGreaterThan(0)
    }, 30000)
  })
})
