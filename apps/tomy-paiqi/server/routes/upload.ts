import express from 'express'
import multer from 'multer'
import crypto from 'crypto'
import { extractPO } from '../lib/pdfExtractor.js'
import { parseScheduleExcel } from '../lib/excelParser.js'
import { reconcile } from '../lib/reconciler.js'
import { writeAnnotatedSchedule } from '../lib/excelWriter.js'
import { buildZipBuffer } from '../lib/zipBuilder.js'
import { buildSummaryReport } from '../lib/summaryReport.js'
import type { FileResult, ProcessResponse, POData, ReconciliationResult, ReconciliationSummary } from '../types/index.js'

// Fix multer's Latin-1 decoded filename back to correct UTF-8.
// Multer decodes multipart filenames as Latin-1 (binary), but browsers send UTF-8.
function fixFilename(name: string): string {
  try {
    const fixed = Buffer.from(name, 'binary').toString('utf8')
    if (!fixed.includes('\ufffd')) return fixed
    return name
  } catch {
    return name
  }
}

const router = express.Router()

// Configure multer with memory storage and 25MB per-file limit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
})

// Session-scoped output buffer store: sessionId → { buffer, timer }
const outputStore = new Map<string, { buffer: Buffer; timer: ReturnType<typeof setTimeout> }>()

const SESSION_TTL_MS = 30 * 60 * 1000 // 30 minutes

function storeOutput(buffer: Buffer): string {
  const sessionId = crypto.randomUUID()
  const timer = setTimeout(() => {
    outputStore.delete(sessionId)
  }, SESSION_TTL_MS)
  outputStore.set(sessionId, { buffer, timer })
  return sessionId
}

function buildReconciliationSummary(result: ReconciliationResult): ReconciliationSummary {
  return {
    matchedCount: result.matched.length,
    unmatchedCount: result.unmatchedPOItems.length,
    ambiguousCount: result.ambiguousPOItems.length,
    mismatchedFieldCount: result.matched.reduce((sum, m) => sum + m.mismatches.length, 0),
    errors: result.errors,
    details: {
      matched: result.matched.map(m => ({
        tomyPO: m.tomyPO,
        货号: m.货号,
        sourceFile: m.sourceFile,
        mismatches: m.mismatches.map(mm => ({
          field: mm.field,
          scheduleValue: mm.scheduleValue,
          poValue: mm.poValue,
        })),
      })),
      unmatched: result.unmatchedPOItems.map(u => ({
        tomyPO: u.tomyPO,
        货号: u.货号,
        sourceFile: u.sourceFile,
      })),
    },
  }
}

// Empty result fallback for optional single-factory submissions
const emptyResult: ReconciliationResult = {
  matched: [],
  unmatchedPOItems: [],
  ambiguousPOItems: [],
  errors: [],
}

// POST /api/process - accepts PO PDFs and two schedule Excel files, returns per-file results + reconciliation summary
router.post(
  '/process',
  upload.fields([
    { name: 'pos', maxCount: 100 },
    { name: 'scheduleDg', maxCount: 1 },
    { name: 'scheduleId', maxCount: 1 },
  ]),
  async (req, res) => {
    const files = req.files as { [fieldname: string]: Express.Multer.File[] }
    const poFiles = files?.pos || []
    const scheduleDgFiles = files?.scheduleDg || []
    const scheduleIdFiles = files?.scheduleId || []

    // Use clean filenames sent from frontend (avoids multer encoding issues)
    let poNames: string[] = []
    try {
      poNames = JSON.parse((req.body?.poNames as string) || '[]')
    } catch { /* use multer names as fallback */ }
    const scheduleDgName = (req.body?.scheduleDgName as string) || ''
    const scheduleIdName = (req.body?.scheduleIdName as string) || ''

    // Process each PO PDF — keep original buffers for ZIP inclusion
    const results: FileResult[] = []
    const poBuffers: Array<{ filename: string; buffer: Buffer; factoryCode: string | null }> = []
    for (let i = 0; i < poFiles.length; i++) {
      const file = poFiles[i]
      const displayName = poNames[i] || fixFilename(file.originalname)
      try {
        const data = await extractPO(file.buffer, displayName)
        results.push({ filename: displayName, status: 'done', data })
        poBuffers.push({
          filename: displayName,
          buffer: file.buffer,
          factoryCode: data.items[0]?.factoryCode ?? null,
        })
      } catch (err) {
        results.push({
          filename: displayName,
          status: 'error',
          data: null,
          error: err instanceof Error ? err.message : 'Unknown error',
        })
      }
    }

    // Process 东莞 schedule Excel
    let scheduleDgResult: ProcessResponse['scheduleDg'] = null
    let dgBuffer: Buffer | null = null
    let dgScheduleRows = null

    if (scheduleDgFiles.length > 0) {
      const file = scheduleDgFiles[0]
      const displayName = scheduleDgName || fixFilename(file.originalname)
      try {
        const rows = await parseScheduleExcel(file.buffer)
        scheduleDgResult = { filename: displayName, status: 'done', rowCount: rows.length }
        dgBuffer = file.buffer
        dgScheduleRows = rows
      } catch (err) {
        scheduleDgResult = {
          filename: displayName,
          status: 'error',
          rowCount: 0,
          error: err instanceof Error ? err.message : 'Unknown error',
        }
      }
    }

    // Process 印尼 schedule Excel
    let scheduleIdResult: ProcessResponse['scheduleId'] = null
    let idBuffer: Buffer | null = null
    let idScheduleRows = null

    if (scheduleIdFiles.length > 0) {
      const file = scheduleIdFiles[0]
      const displayName = scheduleIdName || fixFilename(file.originalname)
      try {
        const rows = await parseScheduleExcel(file.buffer)
        scheduleIdResult = { filename: displayName, status: 'done', rowCount: rows.length }
        idBuffer = file.buffer
        idScheduleRows = rows
      } catch (err) {
        scheduleIdResult = {
          filename: displayName,
          status: 'error',
          rowCount: 0,
          error: err instanceof Error ? err.message : 'Unknown error',
        }
      }
    }

    const response: ProcessResponse = {
      files: results,
      scheduleDg: scheduleDgResult,
      scheduleId: scheduleIdResult,
    }

    // Run dual reconciliation if any schedule is available
    if (dgBuffer !== null || idBuffer !== null) {
      const poDataList: POData[] = results
        .filter((r) => r.status === 'done' && r.data !== null)
        .map((r) => r.data!)

      // CRITICAL: Filter POs by factory code BEFORE reconciling (Pitfall 3)
      // All items in a real PO share the same factory code — use items[0]
      const dgPOs = poDataList.filter((po) => po.items[0]?.factoryCode === 'RR01')
      const idPOs = poDataList.filter((po) => po.items[0]?.factoryCode === 'RR02')

      try {
        let dgResult: ReconciliationResult | null = null
        let idResult: ReconciliationResult | null = null
        let dgExcel: Buffer | null = null
        let idExcel: Buffer | null = null

        if (dgBuffer !== null && dgScheduleRows !== null) {
          dgResult = reconcile(dgPOs, dgScheduleRows)
          dgExcel = await writeAnnotatedSchedule(dgBuffer, dgResult, dgScheduleRows)
          response.reconciliationDg = buildReconciliationSummary(dgResult)
        }

        if (idBuffer !== null && idScheduleRows !== null) {
          idResult = reconcile(idPOs, idScheduleRows)
          idExcel = await writeAnnotatedSchedule(idBuffer, idResult, idScheduleRows)
          response.reconciliationId = buildReconciliationSummary(idResult)
        }

        // Build summary report and ZIP
        const summaryText = buildSummaryReport(dgResult ?? emptyResult, idResult ?? emptyResult)

        const zipEntries: Array<{ name: string; buffer: Buffer }> = []
        if (dgExcel) zipEntries.push({ name: 'DG/东莞排期核对结果.xlsx', buffer: dgExcel })
        if (idExcel) zipEntries.push({ name: 'ID/印尼排期核对结果.xlsx', buffer: idExcel })

        // Add original PO PDFs to their factory folders
        for (const po of poBuffers) {
          if (po.factoryCode === 'RR01') {
            zipEntries.push({ name: `DG/PO/${po.filename}`, buffer: po.buffer })
          } else if (po.factoryCode === 'RR02') {
            zipEntries.push({ name: `ID/PO/${po.filename}`, buffer: po.buffer })
          }
        }

        zipEntries.push({ name: '核对汇总报告.txt', buffer: Buffer.from(summaryText, 'utf-8') })

        const zipBuffer = await buildZipBuffer(zipEntries)
        const sessionId = storeOutput(zipBuffer)
        response.outputReady = true
        response.sessionId = sessionId
      } catch (err) {
        // Reconciliation failure is non-fatal: still return parse results
        const errMsg = err instanceof Error ? err.message : 'Reconciliation failed'
        const emptyErrorSummary: ReconciliationSummary = {
          matchedCount: 0, unmatchedCount: 0, ambiguousCount: 0,
          mismatchedFieldCount: 0, errors: [errMsg],
          details: { matched: [], unmatched: [] },
        }
        if (dgBuffer !== null) response.reconciliationDg = { ...emptyErrorSummary }
        if (idBuffer !== null) response.reconciliationId = { ...emptyErrorSummary }
        response.outputReady = false
      }
    }

    res.json(response)
  }
)

// GET /api/download/:sessionId - returns the ZIP archive
router.get('/download/:sessionId', (req, res) => {
  const { sessionId } = req.params
  const entry = outputStore.get(sessionId)

  if (!entry) {
    res.status(404).json({ error: 'Session not found or expired' })
    return
  }

  // Clear the auto-cleanup timer and remove from store (one-time download)
  clearTimeout(entry.timer)
  outputStore.delete(sessionId)

  res.setHeader('Content-Type', 'application/zip')
  res.setHeader('Content-Disposition', 'attachment; filename="TOMY_reconciliation.zip"')
  res.send(entry.buffer)
})

export { router as uploadRouter }
