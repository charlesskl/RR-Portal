import JSZip from 'jszip'

// Reuse the cleaned archive across parsing KIK/RRM and writing their results.
// A weak key lets the input and cleaned copy be collected after the request.
const prepared = new WeakMap<Buffer, Promise<Buffer>>()

/** Remove only empty, format-only rows after the last explicitly stored cell.
 * Some WPS/Excel exports contain a height record for all 1,048,576 rows.
 * ExcelJS otherwise allocates a Row object for every one of those records.
 * Cell-bearing rows (including formulas, styled blank cells and notes), row
 * numbers, merges, other worksheet metadata and all other ZIP entries remain.
 */
export function trimTrailingEmptyRows(xml: string): string {
  const section = /<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/.exec(xml)
  if (!section) return xml
  let lastCellRow = 0
  for (const match of section[1].matchAll(/<c\b[^>]*\br=["'][A-Z]+(\d+)["']/g)) {
    lastCellRow = Math.max(lastCellRow, Number(match[1]))
  }
  const compact = section[1].replace(/<row\b([^>]*?)(?:\/>|>\s*<\/row>)/g, (row: string, attrs: string) => {
    const number = /\br=["'](\d+)["']/.exec(attrs)
    // Keep structural row properties such as hiding/outlines/page borders.
    const extra = attrs.replace(/\b(?:r|ht|customHeight)=["'][^"']*["']/g, '').trim()
    return number && Number(number[1]) > lastCellRow && !extra ? '' : row
  })
  if (compact === section[1]) return xml
  const start = section.index + section[0].indexOf('>') + 1
  return xml.slice(0, start) + compact + xml.slice(start + section[1].length)
}

export function prepareScheduleWorkbook(buffer: Buffer): Promise<Buffer> {
  let result = prepared.get(buffer)
  if (!result) {
    result = (async () => {
      const zip = await JSZip.loadAsync(buffer)
      let changed = false
      for (const [name, entry] of Object.entries(zip.files)) {
        if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) continue
        const original = await entry.async('string')
        const compact = trimTrailingEmptyRows(original)
        if (compact !== original) {
          zip.file(name, compact)
          changed = true
        }
      }
      return changed ? zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }) : buffer
    })()
    prepared.set(buffer, result)
  }
  return result
}
