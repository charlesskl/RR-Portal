// Polyfill browser APIs required by pdfjs-dist in Node.js
if (typeof globalThis.DOMMatrix === 'undefined') {
  (globalThis as any).DOMMatrix = class DOMMatrix {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0
    constructor(_init?: any) {}
    isIdentity = true
    inverse() { return new DOMMatrix() }
    multiply() { return new DOMMatrix() }
    translate() { return new DOMMatrix() }
    scale() { return new DOMMatrix() }
    transformPoint(p: any) { return p }
  }
}
if (typeof globalThis.ImageData === 'undefined') {
  (globalThis as any).ImageData = class ImageData {
    width: number; height: number; data: Uint8ClampedArray
    constructor(w: number, h: number) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4) }
  }
}
if (typeof globalThis.Path2D === 'undefined') {
  (globalThis as any).Path2D = class Path2D { constructor(_d?: any) {} }
}

import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { pathToFileURL, fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import type { POData, POItem } from '../types/index.js'
import { normalize } from './normalize.js'

// Resolve pdfjs-dist paths — works both in dev (tsx) and bundled (server.cjs)
const __dirname = dirname(fileURLToPath(import.meta.url))
// Try multiple paths: bundled (./node_modules/) and dev (../../node_modules/)
function findPdfjsDir(): string {
  const candidates = [
    resolve(__dirname, 'node_modules/pdfjs-dist'),          // bundled: server.cjs sits next to node_modules/
    resolve(__dirname, '../node_modules/pdfjs-dist'),        // one level up
    resolve(__dirname, '../../node_modules/pdfjs-dist'),     // dev: server/lib/ → project root
  ]
  for (const dir of candidates) {
    try {
      const { statSync } = require('fs') as typeof import('fs')
      if (statSync(resolve(dir, 'legacy/build/pdf.worker.mjs')).isFile()) return dir
    } catch {}
  }
  return candidates[candidates.length - 1] // fallback to dev path
}
const pdfjsDir = findPdfjsDir()
const workerSrc = pathToFileURL(resolve(pdfjsDir, 'legacy/build/pdf.worker.mjs')).href
GlobalWorkerOptions.workerSrc = workerSrc
const standardFontDataUrl = resolve(pdfjsDir, 'standard_fonts/') + '/'

/**
 * Extract all text from a PDF buffer by concatenating text items across all pages.
 * Each text item is joined with a newline.
 */
async function extractPDFText(buffer: Buffer): Promise<string> {
  const loadingTask = getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
    standardFontDataUrl,
  })
  const pdf = await loadingTask.promise
  let text = ''
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const content = await page.getTextContent()
      const pageText = content.items
        .map(item => ('str' in item ? item.str : ''))
        .join('\n')
      text += pageText + '\n'
      page.cleanup()
    }
  } finally {
    await pdf.destroy()
  }
  return text
}

/**
 * Extract a single field value using a label-anchored regex.
 * Handles the PDF text format: "LabelText\n \n: value" or "LabelText\n:\s*value"
 */
function extractField(text: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Try same-line first: "Label: value"
  const sameLine = new RegExp(`${escaped}\\s*:\\s*([^\\n]+)`)
  const m1 = text.match(sameLine)
  if (m1 && m1[1].trim()) return normalize(m1[1])
  // Try next-line: "Label:\n \nValue" (PDF splits label and value across lines)
  const nextLine = new RegExp(`${escaped}\\s*:\\s*\\n\\s*\\n\\s*([^\\n]+)`)
  const m2 = text.match(nextLine)
  return m2 ? normalize(m2[1]) : null
}

/**
 * Extract "Customer Name" excluding "Ship To Customer Name" or "Ship Customer Name".
 * Scans the text for all "Customer Name:" occurrences and filters out those
 * preceded by "Ship To" or "Ship" on the previous line or same context.
 */
function extractCustomerName(text: string): string {
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    // Must contain "Customer Name" with optional colon
    if (!/Customer\s*Name\s*:/.test(line)) continue
    // Skip if this line contains "Ship To" or "Ship" before "Customer Name"
    if (/Ship\s*(To\s*)?Customer\s*Name/i.test(line)) continue
    // Check previous line for "Ship To" / "Ship" (PDF may split across lines)
    if (i > 0 && /^Ship(\s*To)?$/i.test(lines[i - 1].trim())) continue
    // Value might be on same line after colon, or on a subsequent line
    const afterColon = line.replace(/.*Customer\s*Name\s*:\s*/, '').trim()
    if (afterColon) return normalize(afterColon)
    // Value on next non-empty line
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const val = lines[j].trim()
      if (val && val !== ':') return normalize(val)
    }
  }
  return ''
}

/**
 * Extract all line items from the PDF text.
 *
 * Each item block in the text stream looks like:
 *   PARTNO\n \n00-RR\n \nDD Mon YYYY\n \nNNNN\n \nEA
 *
 * After the item block, factory code (RR01/RR02) appears on its own line.
 * Carton packing appears as "N EA / MASTER CARTON" or "N SET / MASTER CARTON".
 */
function extractItems(text: string): POItem[] {
  const items: POItem[] = []

  // Pattern: Part No line, then revision code (NN-RR), then date, then quantity, then EA/SET/PC
  // Part numbers: alphanumeric, at least 2 chars. Can start with digit (47280A) or letter (T72465ML3, E73856).
  // Separator between fields in the PDF text stream is "\n \n" (newline, space, newline).
  const itemPattern =
    /([A-Z0-9][A-Z0-9]+)\s*\n\s*\d{2}-RR\s*\n\s*(\d{1,2} \w+ \d{4})\s*\n\s*([\d,]+)\s*\n(?:EA|SET|PC)/g

  let match: RegExpExecArray | null
  const matches: Array<{ index: number; partNo: string; date: string; qty: string }> = []

  while ((match = itemPattern.exec(text)) !== null) {
    matches.push({
      index: match.index,
      partNo: match[1],
      date: match[2],
      qty: match[3],
    })
  }

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]
    // Determine the text segment after this item's match, up to the next item's match
    const segmentStart = m.index
    const segmentEnd = i + 1 < matches.length ? matches[i + 1].index : text.length
    const segment = text.slice(segmentStart, segmentEnd)

    // Extract factory code (RR01 or RR02) from segment
    const factoryMatch = segment.match(/\n(RR0[12])\n/)
    const factoryCode = factoryMatch ? factoryMatch[1] : 'RR01'

    // Extract carton packing from "N EA / MASTER CARTON" or "N SET / MASTER CARTON" pattern
    const cartonMatch = segment.match(/(\d+)\s*(?:EA|SET|PC)\s*\/\s*MASTER CARTON/)
    const 外箱 = cartonMatch ? parseInt(cartonMatch[1], 10) : null

    // Detect JD label: <FC>JDHL-0PL in item segment
    const hasJDLabel = segment.includes('JDHL-0PL')

    items.push({
      货号: m.partNo,
      PO走货期: m.date,
      数量: parseInt(m.qty.replace(/,/g, ''), 10),
      factoryCode,
      外箱,
      hasJDLabel,
    })
  }

  return items
}

/**
 * Extract QC/remarks text from the PDF for 箱唛資料 rule evaluation.
 * Scans for common QC section indicators and captures the remainder of the text.
 * Also scans the full text for TTT and EU shipment keywords.
 */
function extractQCInstructions(text: string): string {
  // Try to find a dedicated QC / remarks section
  const qcSectionPattern = /(?:QC\s+Instruction|Quality\s+Control|REMARKS?|MASTER\s+CARTON|INSTRUCTION)[\s\S]*/i
  const sectionMatch = text.match(qcSectionPattern)
  if (sectionMatch) {
    return sectionMatch[0].trim()
  }

  // Fallback: look for TTT or EU shipments keywords and return surrounding context
  const keywordPattern = /(?:TTT|For\s+EU\s+shipments?|欧盟).{0,500}/i
  const kwMatch = text.match(keywordPattern)
  if (kwMatch) {
    return kwMatch[0].trim()
  }

  // Last resort: return the tail of the document (after the last item pattern)
  // This ensures the downstream rules have something to scan
  const lastItemPattern =
    /[A-Z0-9]{2,}\s*\n\s*\d{2}-RR\s*\n\s*\d{1,2} \w+ \d{4}\s*\n\s*[\d,]+\s*\n(?:EA|SET|PC)/g
  let lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = lastItemPattern.exec(text)) !== null) {
    lastIndex = m.index + m[0].length
  }
  return text.slice(lastIndex).trim()
}

/**
 * Extract PO data from a PDF buffer.
 *
 * @param buffer - The PDF file content as a Buffer
 * @param filename - The original filename (stored in sourceFile)
 * @returns POData with all extractable fields populated
 */
export async function extractPO(buffer: Buffer, filename: string): Promise<POData> {
  const text = await extractPDFText(buffer)

  // Header fields — extract from first occurrence only (header repeats on every page)
  const tomyPO = extractField(text, 'Purchase Order No') ?? ''
  const customerPO = extractField(text, 'Customer PO No') ?? ''
  const handleBy = extractField(text, 'Handle By') ?? ''
  // Ship To Customer Name (specific label, no collision)
  const shipToCustomerName = extractField(text, 'Ship To Customer Name')
    ?? extractField(text, 'Ship Customer Name') ?? ''
  // Customer Name: find "Customer Name:" NOT preceded by "Ship To" or "Ship" on same line
  // Scan all matches and pick the one that isn't part of "Ship To/Ship Customer Name"
  const customerName = extractCustomerName(text)
  const destCountry = extractField(text, 'Port of Discharge / Destination Country') ?? ''

  // Extract all line items
  const items = extractItems(text)

  // Extract QC/remarks text for 箱唛資料 rule evaluation
  const qcInstructions = extractQCInstructions(text)

  console.log(`[pdfExtractor] ${filename}: customerName="${customerName}", shipToCustomerName="${shipToCustomerName}"`)

  return {
    tomyPO,
    customerPO,
    handleBy,
    customerName,
    shipToCustomerName,
    destCountry,
    items,
    sourceFile: filename,
    qcInstructions,
  }
}
