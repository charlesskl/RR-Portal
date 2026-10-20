import * as XLSX from 'xlsx'
import { resolveFactoryName } from './factoryName'
import type { Factory } from '../types/factory'
import { PATROL_FIELDS, PATROL_GRADES } from './qualityPatrol'

export interface PatrolImportRow {
  rowNo: number
  factoryName: string
  factory: string
  values: Record<string, string | number | boolean | null>
  photos: File[]
  errors: string[]
  warnings: string[]
  saved?: boolean
  saveError?: string
}
export interface PatrolImportResult {
  rows: PatrolImportRow[]
  checkDate: string
  region: string
  warnings: string[]
}
const norm = (v: unknown) => String(v ?? '').replace(/\s+/g, '').replace(/[（]/g, '(').replace(/[）]/g, ')')
const text = (v: unknown) => String(v ?? '').trim()
const fieldLabels: Record<string, string> = Object.fromEntries(PATROL_FIELDS.map(f => [f.key, f.label]))
export function validPatrolDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(value + 'T00:00:00Z')
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value
}
function dateText(value: unknown, date1904: boolean): string {
  if (value == null || value === '') return ''
  if (typeof value === 'number') {
    const d = XLSX.SSF.parse_date_code(value, { date1904 })
    if (!d) throw new Error('日期无效')
    const result = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
    if (!validPatrolDate(result)) throw new Error('日期无效')
    return result
  }
  const parts = text(value).match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/)
  const result = parts ? `${parts[1]}-${parts[2]!.padStart(2, '0')}-${parts[3]!.padStart(2, '0')}` : ''
  if (!validPatrolDate(result)) throw new Error('请使用含年份的有效日期')
  return result
}
function numeric(value: unknown, integer: boolean): number | null {
  if (value == null || text(value) === '') return null
  const v = typeof value === 'number' ? value : Number(text(value).replace(/,/g, ''))
  if (!Number.isFinite(v) || v < 0 || (integer && !Number.isInteger(v))) throw new Error('须为非负' + (integer ? '整数' : '数字'))
  return v
}

// XLSX's public CFB ZIP reader plus OOXML relationships preserve embedded photos
// without uploading the workbook or following any external links.
function extractPhotos(data: ArrayBuffer, sheetName: string): { byRow: Map<number, File[]>; warnings: string[] } {
  const archive = XLSX.CFB.read(new Uint8Array(data), { type: 'array' })
  const entries = new Map(archive.FullPaths.map((p: string, i: number) => [p.replace(/^[^/]+\//, ''), archive.FileIndex[i]!.content]))
  function xml(path: string): Document {
    const bytes = entries.get(path)
    if (!bytes) throw new Error(`缺少 Excel 图片关系文件：${path}`)
    const doc = new DOMParser().parseFromString(new TextDecoder().decode(new Uint8Array(bytes as Uint8Array)), 'application/xml')
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Excel 图片关系文件损坏')
    return doc
  }
  const elements = (root: Document | Element, local: string) => Array.from(root.getElementsByTagNameNS('*', local))
  const rid = (el: Element, local: string) => el.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', local) || ''
  function resolve(base: string, target: string): string {
    if (/^[a-z]+:/i.test(target)) throw new Error('不支持外部图片链接')
    const parts = (target.startsWith('/') ? target.slice(1) : base.slice(0, base.lastIndexOf('/') + 1) + target).split('/')
    const result: string[] = []
    for (const part of parts) { if (part === '..') result.pop(); else if (part && part !== '.') result.push(part) }
    return result.join('/')
  }
  function relationships(path: string): Map<string, string> {
    const split = path.lastIndexOf('/')
    const relPath = path.slice(0, split + 1) + '_rels/' + path.slice(split + 1) + '.rels'
    return new Map(elements(xml(relPath), 'Relationship').filter(el => el.getAttribute('TargetMode') !== 'External').map(el => [el.getAttribute('Id') || '', resolve(path, el.getAttribute('Target') || '')]))
  }
  const sheet = elements(xml('xl/workbook.xml'), 'sheet').find(el => el.getAttribute('name') === sheetName)
  const path = sheet && relationships('xl/workbook.xml').get(rid(sheet, 'id'))
  if (!path) throw new Error('无法定位工作表')
  const byRow = new Map<number, File[]>()
  const warnings: string[] = []
  const drawings = elements(xml(path), 'drawing')
  if (!drawings.length) return { byRow, warnings }
  const sheetRels = relationships(path)
  for (const drawing of drawings) {
    const drawingPath = sheetRels.get(rid(drawing, 'id'))
    if (!drawingPath) throw new Error('无法定位工作表图片')
    const rels = relationships(drawingPath)
    const doc = xml(drawingPath)
    for (const anchor of [...elements(doc, 'twoCellAnchor'), ...elements(doc, 'oneCellAnchor')]) {
      const from = elements(anchor, 'from')[0]
      const row = Number(from && elements(from, 'row')[0]?.textContent) + 1
      for (const blip of elements(anchor, 'blip')) {
        const imagePath = rels.get(rid(blip, 'embed'))
        const bytes = imagePath && entries.get(imagePath)
        if (!imagePath || !bytes) throw new Error(`第${row}行图片无法读取（不支持外部链接图片）`)
        const ext = imagePath.split('.').pop()?.toLowerCase()
        const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ['jpg', 'jpeg'].includes(ext || '') ? 'image/jpeg' : ''
        if (!mime) throw new Error(`第${row}行图片格式不支持，请使用 JPG、PNG 或 WebP`)
        const file = new File([new Uint8Array(bytes as Uint8Array)], `巡查_${row}_${imagePath.split('/').pop()}`, { type: mime })
        byRow.set(row, [...(byRow.get(row) || []), file])
      }
    }
    if (elements(doc, 'absoluteAnchor').length) warnings.push('存在无法按行定位的浮动对象，请核对现场照片。')
  }
  return { byRow, warnings }
}

export function parsePatrolWorkbook(data: ArrayBuffer): PatrolImportResult {
  const wb = XLSX.read(data, { type: 'array', cellStyles: true })
  const sheetName = wb.SheetNames.includes('总结') ? '总结' : wb.SheetNames[0]
  const ws = sheetName && wb.Sheets[sheetName]
  if (!sheetName || !ws) throw new Error('Excel 中没有工作表')
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1')
  if (range.e.r > 5000 || range.e.c > 100) throw new Error('请使用巡查总结模板，最多支持5000行、100列')
  const cell = (r: number, c: number) => ws[XLSX.utils.encode_cell({ r, c })]
  let header = -1
  for (let r = 0; r <= Math.min(20, range.e.r); r++) {
    const labels = Array.from({ length: range.e.c + 1 }, (_, c) => norm(cell(r, c)?.v))
    if (labels.includes('厂名') && labels.includes('员工人数')) { header = r; break }
  }
  if (header < 0) throw new Error('未找到“厂名、员工人数”表头，请使用单次巡查总结表')
  const labels = Array.from({ length: range.e.c + 1 }, (_, c) => {
    const merge = ws['!merges']?.find(m => m.s.r <= header && m.e.r >= header && m.s.c <= c && m.e.c >= c)
    return norm(cell(merge?.s.r ?? header, merge?.s.c ?? c)?.v)
  })
  const col = (...aliases: string[]) => labels.findIndex(h => aliases.some(a => norm(a) === h))
  const gradeCols = labels.map((v, i) => /评级$/.test(v) ? i : -1).filter(i => i >= 0)
  if (gradeCols.length !== 1) throw new Error('模板须仅包含一次巡查评级，请将不同日期的巡查分别导入')
  const feeCols = labels.map((v, i) => /加工费\(万(?:元)?\)$/.test(v) ? i : -1).filter(i => i >= 0)
  if (feeCols.length > 1) throw new Error('加工费列不唯一，请保留一次统计期间的加工费')
  const cols: Record<string, number> = {
    factory: col('厂名'), staff: col('员工人数'), lines: col('拉线'), area: col('场地面积（平方）'), grade: gradeCols[0]!,
    responsibility_scope: col('责任范围'), responsible_supervisor: col('责任主管'), processing_fee: feeCols[0] ?? -1,
    evaluation: col('评价', '本次评价'), correction: col('整改描述', '本次整改描述'), planned_date: col('计划完成时间', '计划完成日期', '整改计划完成时间'),
    completed_date: col('整改完成时间', '整改完成日期'), production_type: col('符合类型', '符合生产类型'), notes: col('备注'),
  }
  for (const key of ['staff', 'lines', 'area', 'evaluation', 'correction', 'production_type']) if (cols[key]! < 0) throw new Error(`模板缺少“${fieldLabels[key]}”列，请检查表头`)
  const title = Array.from({ length: header }, (_, r) => Array.from({ length: range.e.c + 1 }, (_, c) => text(cell(r, c)?.v)).join(' ')).join(' ')
  const normalizedTitle = title.replace(/\s+/g, '')
  const titleDate = normalizedTitle.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/)
  let checkDate = titleDate ? dateText(titleDate[0], false) : ''
  // A visit period such as 2026年10月14日-16日 is recorded on its final day.
  const period = normalizedTitle.match(/(\d{4})年(\d{1,2})月(\d{1,2})日[-–—~～至](?:(\d{4})年)?(?:(\d{1,2})月)?(\d{1,2})日/)
  if (period) {
    const start = dateText(`${period[1]}年${period[2]}月${period[3]}日`, false)
    const end = dateText(`${period[4] || period[1]}年${period[5] || period[2]}月${period[6]}日`, false)
    if (end < start) throw new Error('标题中的巡查结束日期不能早于开始日期，请核对')
    checkDate = end
  }
  const gradeDate = labels[gradeCols[0]!]!.match(/(\d{1,2})\/(\d{1,2})/)
  if (checkDate && gradeDate && checkDate.slice(5) !== `${gradeDate[1]!.padStart(2, '0')}-${gradeDate[2]!.padStart(2, '0')}`) throw new Error('标题日期与评级表头日期不一致，请核对模板')
  const region = /湖南/.test(title) ? 'hunan' : /东莞/.test(title) ? 'dongguan' : /河源/.test(title) ? 'heyuan' : ''
  const images = extractPhotos(data, sheetName)
  for (const key of ['planned_date', 'completed_date']) {
    if (cols[key]! < 0) images.warnings.push(`未提供“${fieldLabels[key]}”列，该项将留空，不使用其他日期代替。`)
  }
  const rows: PatrolImportRow[] = []
  const serialCol = col('序号')
  for (let r = header + 1; r <= range.e.r; r++) {
    if (/^(合计|总计)/.test(norm(cell(r, serialCol)?.v))) break
    const name = text(cell(r, cols.factory!)?.v)
    const serial = cell(r, serialCol)?.v
    if (!name && !serial) continue
    if (!/^\d+$/.test(text(serial))) continue // summaries and legends are not patrols
    const errors: string[] = [], warnings: string[] = []
    const values: PatrolImportRow['values'] = {}
    for (const [key, c] of Object.entries(cols)) {
      if (key === 'factory') continue
      const value = c >= 0 ? cell(r, c)?.v : undefined
      try {
        // Completion cells can contain several item-specific dates or prose.
        // Keep that text verbatim without claiming a single completion date.
        if (key === 'completed_date' && typeof value === 'string' && text(value) && !/^\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?$/.test(text(value))) {
          values.completion_details = text(value)
          values.completed_date = ''
          continue
        }
        values[key] = ['staff', 'lines', 'area', 'processing_fee'].includes(key) ? numeric(value, ['staff', 'lines'].includes(key))
          : key.endsWith('_date') ? dateText(value, !!wb.Workbook?.WBProps?.date1904) : text(value)
      } catch (e) { errors.push(`${labels[c] || fieldLabels[key]}：${(e as Error).message}`) }
    }
    values.completion_details ??= ''
    values.processing_fee_period = feeCols.length ? labels[feeCols[0]!]!.replace(/加工费\(万(?:元)?\)$/, '') : ''
    values.grade = text(values.grade).toUpperCase().replace(/级$/, '')
    if (values.grade && !PATROL_GRADES.includes(values.grade as typeof PATROL_GRADES[number])) errors.push('评级须为 A、B、C、D 或留空')
    const fill = (c: number) => String(cell(r, c)?.s?.fgColor?.rgb || '').slice(-6).toUpperCase()
    values.visitor_ready = ['00B050', 'C6EFCE', 'BCE9C8'].includes(fill(cols.factory!))
    values.below_standard = values.grade === 'A' && ['FFFF00', 'FFEB9C', 'FFF09C'].includes(fill(cols.staff!))
    if (values.grade !== 'A' && ['FFFF00', 'FFEB9C'].includes(fill(cols.staff!))) warnings.push('人数有黄色填充，但不是A级；不设“A级未达标”标记')
    const photos = images.byRow.get(r + 1) || []
    if (photos.length > 10 || photos.some(p => p.size > 10 * 1024 * 1024) || photos.reduce((sum, p) => sum + p.size, 0) > 30 * 1024 * 1024) errors.push('每条巡查最多10张照片，每张不超过10MB，合计不超过30MB')
    rows.push({ rowNo: r + 1, factoryName: name, factory: '', values, photos, errors, warnings })
  }
  if (!rows.length) throw new Error('未找到可导入的巡查明细')
  return { rows, checkDate, region, warnings: images.warnings }
}

export function matchPatrolFactories(rows: PatrolImportRow[], factories: Pick<Factory, 'id' | 'name'>[]) {
  for (const row of rows) {
    const match = resolveFactoryName(factories, row.factoryName)
    row.factory = match.status === 'matched' ? match.id : ''
  }
}
export function patrolImportStatus(row: PatrolImportRow, rows: PatrolImportRow[], existing: { factory: string; check_date: string }[], checkDate: string): string {
  if (row.saved) return '已导入'
  if (row.errors.length) return row.errors.join('；')
  if (!row.factory) return '请选择匹配的工厂'
  if (!validPatrolDate(checkDate)) return '请选择有效的检查日期'
  if (rows.some(r => r !== row && r.factory === row.factory)) return '文件中同一工厂重复，请核对后重新选择文件'
  if (existing.some(r => r.factory === row.factory && r.check_date.slice(0, 10) === checkDate)) return '已存在，将跳过'
  return '可导入'
}
