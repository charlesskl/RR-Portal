import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import app from '../index.js'
import type { Server } from 'http'
import type { ProcessResponse, FileResult } from '../types/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '../../')

// Find real fixtures from project root
function findPDFFiles(): string[] {
  const files = readdirSync(PROJECT_ROOT).filter(
    (f) => f.startsWith('PO_') && f.endsWith('.pdf')
  )
  return files.map((f) => resolve(PROJECT_ROOT, f))
}

function findExcelFiles(): string[] {
  const files = readdirSync(PROJECT_ROOT).filter((f) => f.endsWith('.xlsx'))
  return files.map((f) => resolve(PROJECT_ROOT, f))
}

let server: Server
let baseUrl: string

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      baseUrl = `http://localhost:${port}`
      resolve()
    })
  })
}, 10000)

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()))
  })
})

describe('POST /api/process', () => {
  it('returns empty results when no files are uploaded', async () => {
    const formData = new FormData()
    const response = await fetch(`${baseUrl}/api/process`, {
      method: 'POST',
      body: formData,
    })
    expect(response.status).toBe(200)
    const data = (await response.json()) as ProcessResponse
    expect(data.files).toEqual([])
    expect(data.scheduleDg).toBeNull()
    expect(data.scheduleId).toBeNull()
  }, 30000)

  it('processes a real PDF file and returns FileResult with status done', async () => {
    const pdfPaths = findPDFFiles()
    expect(pdfPaths.length).toBeGreaterThan(0)

    const pdfPath = pdfPaths[0]
    const filename = pdfPath.split(/[/\\]/).pop()!
    const buffer = readFileSync(pdfPath)
    const blob = new Blob([buffer], { type: 'application/pdf' })

    const formData = new FormData()
    formData.append('pos', blob, filename)

    const response = await fetch(`${baseUrl}/api/process`, {
      method: 'POST',
      body: formData,
    })
    expect(response.status).toBe(200)
    const data = (await response.json()) as ProcessResponse
    expect(data.files).toHaveLength(1)

    const fileResult: FileResult = data.files[0]
    expect(fileResult.filename).toBe(filename)
    expect(fileResult.status).toBe('done')
    expect(fileResult.data).not.toBeNull()
    expect(fileResult.data?.tomyPO).toBeTruthy()
    expect(fileResult.data?.items.length).toBeGreaterThan(0)
    expect(fileResult.error).toBeUndefined()
  }, 60000)

  it('processes a real Excel schedule file (东莞) and returns scheduleDg with status done', async () => {
    const excelPaths = findExcelFiles()
    expect(excelPaths.length).toBeGreaterThan(0)

    // Use the Dongguan file
    const excelPath = excelPaths.find((p) => p.includes('东莞')) ?? excelPaths[0]
    const filename = excelPath.split(/[/\\]/).pop()!
    const buffer = readFileSync(excelPath)
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })

    const formData = new FormData()
    formData.append('scheduleDg', blob, filename)

    const response = await fetch(`${baseUrl}/api/process`, {
      method: 'POST',
      body: formData,
    })
    expect(response.status).toBe(200)
    const data = (await response.json()) as ProcessResponse
    expect(data.files).toEqual([])
    expect(data.scheduleDg).not.toBeNull()
    // filename may be re-encoded by multer for non-ASCII chars; just check it's a string
    expect(typeof data.scheduleDg?.filename).toBe('string')
    expect(data.scheduleDg?.status).toBe('done')
    expect(data.scheduleDg?.rowCount).toBeGreaterThan(0)
    expect(data.scheduleDg?.error).toBeUndefined()
    expect(data.scheduleId).toBeNull()
  }, 60000)

  it('processes multiple PDF files and returns per-file results', async () => {
    const pdfPaths = findPDFFiles().slice(0, 2)
    expect(pdfPaths.length).toBeGreaterThanOrEqual(2)

    const formData = new FormData()
    for (const pdfPath of pdfPaths) {
      const filename = pdfPath.split(/[/\\]/).pop()!
      const buffer = readFileSync(pdfPath)
      const blob = new Blob([buffer], { type: 'application/pdf' })
      formData.append('pos', blob, filename)
    }

    const response = await fetch(`${baseUrl}/api/process`, {
      method: 'POST',
      body: formData,
    })
    expect(response.status).toBe(200)
    const data = (await response.json()) as ProcessResponse
    expect(data.files).toHaveLength(2)

    for (const fileResult of data.files) {
      expect(fileResult).toHaveProperty('filename')
      expect(fileResult).toHaveProperty('status')
      expect(fileResult).toHaveProperty('data')
      expect(['done', 'error']).toContain(fileResult.status)
    }
  }, 60000)

  it('each FileResult has required fields: filename, status, and data', async () => {
    const pdfPaths = findPDFFiles()
    expect(pdfPaths.length).toBeGreaterThan(0)

    const pdfPath = pdfPaths[0]
    const filename = pdfPath.split(/[/\\]/).pop()!
    const buffer = readFileSync(pdfPath)
    const blob = new Blob([buffer], { type: 'application/pdf' })

    const formData = new FormData()
    formData.append('pos', blob, filename)

    const response = await fetch(`${baseUrl}/api/process`, {
      method: 'POST',
      body: formData,
    })
    const data = (await response.json()) as ProcessResponse

    const result = data.files[0]
    expect(result).toHaveProperty('filename')
    expect(result).toHaveProperty('status')
    expect(result).toHaveProperty('data')
    // data is present and has the POData shape
    expect(result.data).toHaveProperty('tomyPO')
    expect(result.data).toHaveProperty('customerPO')
    expect(result.data).toHaveProperty('items')
    expect(Array.isArray(result.data?.items)).toBe(true)
  }, 60000)
})
