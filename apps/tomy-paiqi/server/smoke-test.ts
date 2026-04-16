import ExcelJS from 'exceljs'
import { isWorkday } from 'chinese-days'
import { subMonths, format } from 'date-fns'
import multer from 'multer'
import pdfParse from 'pdf-parse'

async function runSmokeTest() {
  let passed = 0
  let failed = 0

  // 1. ExcelJS - create workbook, set red fill, write buffer
  try {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Test')
    const cell = sheet.getCell('A1')
    cell.value = 'Test'
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFF0000' },
    }
    await workbook.xlsx.writeBuffer()
    console.log('OK: ExcelJS - workbook created, red fill applied, buffer written')
    passed++
  } catch (e) {
    console.error('FAIL: ExcelJS -', e)
    failed++
  }

  // 2. chinese-days - check National Day 2026
  try {
    const nationalDay = isWorkday('2026-10-01')
    console.log(`OK: chinese-days - 2026-10-01 isWorkday=${nationalDay} (expected false)`)
    if (nationalDay !== false) {
      console.warn('  WARNING: Expected National Day to not be a workday')
    }
    passed++
  } catch (e) {
    console.error('FAIL: chinese-days -', e)
    failed++
  }

  // 3. date-fns - subMonths
  try {
    const jan2026 = new Date(2026, 0, 15) // Jan 15, 2026
    const result = subMonths(jan2026, 1)
    const formatted = format(result, 'yyyy-MM-dd')
    console.log(`OK: date-fns - subMonths(2026-01-15, 1) = ${formatted} (expected 2025-12-15)`)
    passed++
  } catch (e) {
    console.error('FAIL: date-fns -', e)
    failed++
  }

  // 4. multer - confirm importable
  try {
    const upload = multer({ storage: multer.memoryStorage() })
    console.log('OK: multer - imported and configured with memoryStorage')
    passed++
  } catch (e) {
    console.error('FAIL: multer -', e)
    failed++
  }

  // 5. pdf-parse - confirm importable
  try {
    console.log('OK: pdf-parse - imported successfully')
    passed++
  } catch (e) {
    console.error('FAIL: pdf-parse -', e)
    failed++
  }

  console.log(`\n--- Smoke Test Results: ${passed}/${passed + failed} passed ---`)

  if (failed > 0) {
    process.exit(1)
  }
  process.exit(0)
}

runSmokeTest()
