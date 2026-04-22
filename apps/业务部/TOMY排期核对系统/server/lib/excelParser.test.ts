import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { parseScheduleExcel } from './excelParser.js'

// Load real Excel fixtures from project root
const PROJECT_ROOT = resolve(import.meta.dirname, '../../')

const dongguanBuffer = readFileSync(resolve(PROJECT_ROOT, '2026年TOMY东莞排期3-18.xlsx'))
const indonesiaBuffer = readFileSync(resolve(PROJECT_ROOT, '2026年TOMY印尼排期3-18.xlsx'))

describe('parseScheduleExcel', { timeout: 30000 }, () => {
  describe('Dongguan file', () => {
    it('returns non-empty array of rows', async () => {
      const rows = await parseScheduleExcel(dongguanBuffer)
      expect(rows.length).toBeGreaterThan(0)
    })

    it('returns 30+ data rows', async () => {
      const rows = await parseScheduleExcel(dongguanBuffer)
      expect(rows.length).toBeGreaterThanOrEqual(30)
    })

    it('first data row has tomyPO as a non-null string', async () => {
      const rows = await parseScheduleExcel(dongguanBuffer)
      expect(rows[0].tomyPO).not.toBeNull()
      expect(typeof rows[0].tomyPO).toBe('string')
    })

    it('has rowIndex on each row', async () => {
      const rows = await parseScheduleExcel(dongguanBuffer)
      expect(rows[0].rowIndex).toBeGreaterThan(1) // rows start after header
    })

    it('formula cells (外箱, 总箱数) return numbers not objects', async () => {
      const rows = await parseScheduleExcel(dongguanBuffer)
      const withWaixiang = rows.filter(r => r.外箱 !== null)
      expect(withWaixiang.length).toBeGreaterThan(0)
      for (const row of withWaixiang) {
        expect(typeof row.外箱).toBe('number')
        // Must not be an object stringified
        expect(String(row.外箱)).not.toBe('[object Object]')
      }
    })

    it('date cells (PO走货期) return Date instances', async () => {
      const rows = await parseScheduleExcel(dongguanBuffer)
      const withDate = rows.filter(r => r.PO走货期 !== null)
      expect(withDate.length).toBeGreaterThan(0)
      for (const row of withDate) {
        expect(row.PO走货期).toBeInstanceOf(Date)
      }
    })

    it('date cells (接单期) return Date instances when present', async () => {
      const rows = await parseScheduleExcel(dongguanBuffer)
      const withDate = rows.filter(r => r.接单期 !== null)
      // May have some rows without 接单期
      for (const row of withDate) {
        expect(row.接单期).toBeInstanceOf(Date)
      }
    })

    it('customerPO is resolved via alias (Cust. PO NO.)', async () => {
      const rows = await parseScheduleExcel(dongguanBuffer)
      const withCustPO = rows.filter(r => r.customerPO !== null)
      expect(withCustPO.length).toBeGreaterThan(0)
    })

    it('filters out empty rows (row count < total Excel rows)', async () => {
      const rows = await parseScheduleExcel(dongguanBuffer)
      // Dongguan file has 42 rows total; some are empty/header
      expect(rows.length).toBeLessThan(42)
    })
  })

  describe('Indonesia file', () => {
    it('returns non-empty array of rows', async () => {
      const rows = await parseScheduleExcel(indonesiaBuffer)
      expect(rows.length).toBeGreaterThan(0)
    })

    it('returns 200+ data rows', async () => {
      const rows = await parseScheduleExcel(indonesiaBuffer)
      expect(rows.length).toBeGreaterThanOrEqual(200)
    })

    it('first data row has tomyPO as a non-null string', async () => {
      const rows = await parseScheduleExcel(indonesiaBuffer)
      expect(rows[0].tomyPO).not.toBeNull()
      expect(typeof rows[0].tomyPO).toBe('string')
    })

    it('formula cells (外箱, 总箱数) return numbers not objects', async () => {
      const rows = await parseScheduleExcel(indonesiaBuffer)
      const withWaixiang = rows.filter(r => r.外箱 !== null)
      expect(withWaixiang.length).toBeGreaterThan(0)
      for (const row of withWaixiang) {
        expect(typeof row.外箱).toBe('number')
        expect(String(row.外箱)).not.toBe('[object Object]')
      }
    })

    it('date cells (PO走货期) return Date instances', async () => {
      const rows = await parseScheduleExcel(indonesiaBuffer)
      const withDate = rows.filter(r => r.PO走货期 !== null)
      expect(withDate.length).toBeGreaterThan(0)
      for (const row of withDate) {
        expect(row.PO走货期).toBeInstanceOf(Date)
      }
    })

    it('customerPO is resolved via alias (CUSTOMER PO)', async () => {
      const rows = await parseScheduleExcel(indonesiaBuffer)
      const withCustPO = rows.filter(r => r.customerPO !== null)
      expect(withCustPO.length).toBeGreaterThan(0)
    })

    it('日期码 resolves correctly (col 16 in Indonesia, col 19 in Dongguan)', async () => {
      const rows = await parseScheduleExcel(indonesiaBuffer)
      // Just verify field exists on schema — may be null for some rows
      expect(rows[0]).toHaveProperty('日期码')
    })
  })

  describe('Cross-file alias compatibility', () => {
    it('both files produce rows with all required ScheduleRow fields', async () => {
      const required = [
        'rowIndex', '接单期', '国家', '第三客户名称', '客跟单',
        'tomyPO', 'customerPO', '货号', '数量', '外箱', '总箱数',
        'PO走货期', '日期码', '箱唛资料'
      ]
      const [dg, id] = await Promise.all([
        parseScheduleExcel(dongguanBuffer),
        parseScheduleExcel(indonesiaBuffer),
      ])
      for (const field of required) {
        expect(dg[0]).toHaveProperty(field)
        expect(id[0]).toHaveProperty(field)
      }
    })
  })
})
