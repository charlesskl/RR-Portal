import JSZip from 'jszip'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'

const sheetNS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const relNS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const documentRelNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const typeNS = 'http://schemas.openxmlformats.org/package/2006/content-types'
const financialSheet = /^(?:实业合同|实业发票|全球合同|全球发票|印尼合同|印尼发票|装箱单)$/
type Element = ReturnType<DOMParser['parseFromString']>['documentElement'] & { localName: string }
type Document = ReturnType<DOMParser['parseFromString']>
const children = (element: any, name: string): Element[] => Array.from(element?.childNodes || [])
  .filter((node: any) => node.nodeType === 1 && node.localName === name) as Element[]
const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml')
const xml = (doc: Document) => new XMLSerializer().serializeToString(doc)

/** A limit applies to each template set, never to the shipment's total groups. */
export function shipmentDocumentBatches<T extends { indo: boolean }>(groups: readonly T[], rri: boolean): T[][] {
  const batches: T[][] = []
  let current: T[] = [], primary = 0, indonesia = 0
  for (const group of groups) {
    if (current.length >= 15 || (group.indo ? indonesia >= (rri ? 1 : 2) : primary >= (rri ? 14 : 15))) {
      batches.push(current); current = []; primary = 0; indonesia = 0
    }
    current.push(group)
    if (group.indo) indonesia++; else primary++
  }
  if (current.length) batches.push(current)
  return batches
}

/** Change sheet-reference tokens, leaving quoted formula text and the main sheet intact. */
export function renameDocumentSheets(formula: string, names: ReadonlyMap<string, string>) {
  return formula.replace(/"(?:[^"]|"")*"|('(?:[^']|'')+'|[\p{L}\p{N}_.]+)!/gu, (token, sheet?: string) => {
    if (!sheet) return token
    const name = sheet.startsWith("'") ? sheet.slice(1, -1).replace(/''/g, "'") : sheet
    const next = names.get(name)
    return next ? `'${next.replace(/'/g, "''")}'!` : token
  })
}

// Compare style structure, not namespace prefixes or attribute order. Each
// continuation reuses the existing fonts, fills and borders instead of adding
// another whole 1,000+ style template to the workbook.
function key(node: any): string {
  if (node.nodeType !== 1) return node.nodeType === 3 ? node.data.trim() : ''
  const attributes = Array.from(node.attributes || []).filter((a: any) => a.namespaceURI !== 'http://www.w3.org/2000/xmlns/')
    .map((a: any) => [a.namespaceURI || '', a.localName, a.value]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  return JSON.stringify([node.namespaceURI, node.localName, attributes, Array.from(node.childNodes || []).map(key).filter(Boolean)])
}

function mergeStyles(target: Document, source: Document) {
  const order = ['numFmts', 'fonts', 'fills', 'borders', 'cellStyleXfs', 'cellXfs', 'cellStyles', 'dxfs', 'tableStyles', 'colors', 'extLst']
  const collection = (name: string) => {
    let result = children(target.documentElement, name)[0]
    if (!result) {
      result = target.createElementNS(sheetNS, name) as Element
      const next = Array.from(target.documentElement!.childNodes).find((n: any) => n.nodeType === 1 && order.indexOf(n.localName) > order.indexOf(name))
      target.documentElement!.insertBefore(result, next || null)
    }
    return result
  }
  const formats = new Map<number, number>()
  const targetFormats = collection('numFmts'), existingFormats = children(targetFormats, 'numFmt')
  let nextFormat = Math.max(163, ...existingFormats.map(n => Number(n.getAttribute('numFmtId')))) + 1
  const byFormat = new Map(existingFormats.map(n => [n.getAttribute('formatCode'), Number(n.getAttribute('numFmtId'))]))
  for (const format of children(children(source.documentElement, 'numFmts')[0], 'numFmt')) {
    const code = format.getAttribute('formatCode') || ''
    let id = byFormat.get(code)
    if (id == null) {
      id = nextFormat++; byFormat.set(code, id)
      const copy = target.importNode(format, true) as Element; copy.setAttribute('numFmtId', String(id)); targetFormats.appendChild(copy)
    }
    formats.set(Number(format.getAttribute('numFmtId')), id)
  }
  targetFormats.setAttribute('count', String(children(targetFormats, 'numFmt').length))
  const merge = (name: string, tag: string, adjust?: (node: Element) => void) => {
    const dest = collection(name), current = children(dest, tag), byKey = new Map(current.map((node, i) => [key(node), i]))
    let nextIndex = current.length
    return children(children(source.documentElement, name)[0], tag).map(node => {
      const copy = target.importNode(node, true) as Element; adjust?.(copy)
      const signature = key(copy)
      let index = byKey.get(signature)
      if (index == null) { index = nextIndex++; byKey.set(signature, index); dest.appendChild(copy) }
      dest.setAttribute('count', String(children(dest, tag).length))
      return index
    })
  }
  const fonts = merge('fonts', 'font'), fills = merge('fills', 'fill'), borders = merge('borders', 'border')
  const adjustXf = (node: Element) => {
    for (const [field, values] of [['fontId', fonts], ['fillId', fills], ['borderId', borders]] as const)
      if (node.hasAttribute(field)) node.setAttribute(field, String(values[Number(node.getAttribute(field))] ?? 0))
    const format = Number(node.getAttribute('numFmtId'))
    if (formats.has(format)) node.setAttribute('numFmtId', String(formats.get(format)))
  }
  const bases = merge('cellStyleXfs', 'xf', adjustXf)
  const cells = merge('cellXfs', 'xf', node => {
    adjustXf(node)
    if (node.hasAttribute('xfId')) node.setAttribute('xfId', String(bases[Number(node.getAttribute('xfId'))] ?? 0))
  })
  const differential = merge('dxfs', 'dxf', node => {
    for (const format of Array.from(node.getElementsByTagNameNS(sheetNS, 'numFmt')))
      if (formats.has(Number(format.getAttribute('numFmtId')))) format.setAttribute('numFmtId', String(formats.get(Number(format.getAttribute('numFmtId')))))
  })
  return { cells, differential }
}

function resolve(from: string, target: string) {
  const parts = target.startsWith('/') ? [] : from.split('/').slice(0, -1)
  for (const part of target.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') { if (!parts.length) throw new Error('单据关系路径无效'); parts.pop() }
    else parts.push(part)
  }
  return parts.join('/')
}
const relsPath = (path: string) => path.replace(/^(.*\/)([^/]+)$/, '$1_rels/$2.rels')
function relative(from: string, to: string) {
  const a = from.split('/').slice(0, -1), b = to.split('/')
  while (a.length && b.length && a[0] === b[0]) { a.shift(); b.shift() }
  return '../'.repeat(a.length) + b.join('/')
}

function printRange(doc: Document) {
  // Some approved Indonesian templates have no <dimension>. Derive the print
  // bounds from actual cells and merges so their continuation is not just A1.
  const addresses = [...Array.from(doc.getElementsByTagNameNS(sheetNS, 'c')).map(n => n.getAttribute('r') || ''),
    ...Array.from(doc.getElementsByTagNameNS(sheetNS, 'mergeCell')).map(n => n.getAttribute('ref') || ''),
    doc.getElementsByTagNameNS(sheetNS, 'dimension')[0]?.getAttribute('ref') || '']
  let row = 1, column = 1, letters = 'A'
  for (const address of addresses) for (const match of address.matchAll(/([A-Z]+)(\d+)/g)) {
    const index = [...match[1]].reduce((number, char) => number * 26 + char.charCodeAt(0) - 64, 0)
    row = Math.max(row, Number(match[2]))
    if (index > column) { column = index; letters = match[1] }
  }
  return `$A$1:$${letters}$${row}`
}

/** Append only financial documents; the complete main data and summaries stay single. */
export async function appendShipmentDocumentSheets(target: JSZip, source: JSZip, batch: number) {
  const workbook = parse(await target.file('xl/workbook.xml')!.async('string'))
  const sourceBook = parse(await source.file('xl/workbook.xml')!.async('string'))
  const relationships = parse(await target.file('xl/_rels/workbook.xml.rels')!.async('string'))
  const sourceRelationships = parse(await source.file('xl/_rels/workbook.xml.rels')!.async('string'))
  const content = parse(await target.file('[Content_Types].xml')!.async('string'))
  const sourceContent = parse(await source.file('[Content_Types].xml')!.async('string'))
  const styles = parse(await target.file('xl/styles.xml')!.async('string'))
  const styleMap = mergeStyles(styles, parse(await source.file('xl/styles.xml')!.async('string')))
  const sourceSheets = Array.from(sourceBook.getElementsByTagNameNS(sheetNS, 'sheet'))
  const destSheets = workbook.getElementsByTagNameNS(sheetNS, 'sheets')[0]
  const present = new Set(Array.from(workbook.getElementsByTagNameNS(sheetNS, 'sheet')).map(n => n.getAttribute('name')))
  const names = new Map<string, string>()
  sourceSheets.filter(n => financialSheet.test(n.getAttribute('name') || '')).forEach(node => {
    const original = node.getAttribute('name')!
    let name = `${original}·续${batch}`, suffix = 2
    while (present.has(name)) name = `${original}·续${batch}-${suffix++}`
    names.set(original, name); present.add(name)
  })
  const knownParts = new Set(Array.from(content.getElementsByTagNameNS(typeNS, 'Override')).map(n => n.getAttribute('PartName')))
  const defaults = new Set(Array.from(content.getElementsByTagNameNS(typeNS, 'Default')).map(n => n.getAttribute('Extension')))
  for (const node of Array.from(sourceContent.getElementsByTagNameNS(typeNS, 'Default'))) if (!defaults.has(node.getAttribute('Extension'))) {
    content.documentElement!.appendChild(content.importNode(node, true)); defaults.add(node.getAttribute('Extension'))
  }
  const overrides = new Map(Array.from(sourceContent.getElementsByTagNameNS(typeNS, 'Override')).map(n => [n.getAttribute('PartName'), n]))
  const copied = new Map<string, string>()
  const copyPart = async (path: string): Promise<string> => {
    if (copied.has(path)) return copied.get(path)!
    const file = source.file(path)
    if (!file) throw new Error(`缺少单据关联部件：${path}`)
    const destination = `xl/shipmentOverflow${batch}/${path.replace(/^xl\//, '')}`
    copied.set(path, destination)
    target.file(destination, await file.async('uint8array'))
    const type = overrides.get('/' + path)
    if (type && !knownParts.has('/' + destination)) {
      const copy = content.importNode(type, true) as Element; copy.setAttribute('PartName', '/' + destination)
      content.documentElement!.appendChild(copy); knownParts.add('/' + destination)
    }
    const rels = source.file(relsPath(path))
    if (rels) {
      const doc = parse(await rels.async('string'))
      for (const rel of Array.from(doc.getElementsByTagNameNS(relNS, 'Relationship'))) {
        if (rel.getAttribute('TargetMode') === 'External') continue
        rel.setAttribute('Target', relative(destination, await copyPart(resolve(path, rel.getAttribute('Target') || ''))))
      }
      target.file(relsPath(destination), xml(doc))
    }
    return destination
  }
  let nextId = Math.max(0, ...Array.from(workbook.getElementsByTagNameNS(sheetNS, 'sheet')).map(n => Number(n.getAttribute('sheetId')))) + 1
  let defined = workbook.getElementsByTagNameNS(sheetNS, 'definedNames')[0]
  if (!defined) {
    defined = workbook.createElementNS(sheetNS, 'definedNames')
    const calc = workbook.getElementsByTagNameNS(sheetNS, 'calcPr')[0]
    workbook.documentElement!.insertBefore(defined, calc || null)
  }
  for (const [sourceIndex, node] of sourceSheets.entries()) {
    const name = names.get(node.getAttribute('name') || '')
    if (!name) continue
    const id = node.getAttributeNS(documentRelNS, 'id') || node.getAttribute('r:id')
    const rel = Array.from(sourceRelationships.getElementsByTagNameNS(relNS, 'Relationship')).find(n => n.getAttribute('Id') === id)
    if (!rel) throw new Error('缺少单据工作表关系')
    const path = await copyPart(resolve('xl/workbook.xml', rel.getAttribute('Target') || ''))
    const doc = parse(await target.file(path)!.async('string'))
    for (const tag of ['c', 'row', 'col']) for (const cell of Array.from(doc.getElementsByTagNameNS(sheetNS, tag))) {
      const field = tag === 'col' ? 'style' : 's'
      if (cell.hasAttribute(field)) cell.setAttribute(field, String(styleMap.cells[Number(cell.getAttribute(field))] ?? 0))
    }
    for (const cell of Array.from(doc.getElementsByTagNameNS(sheetNS, 'f'))) cell.textContent = renameDocumentSheets(cell.textContent || '', names)
    for (const rule of Array.from(doc.getElementsByTagNameNS(sheetNS, 'cfRule')))
      if (rule.hasAttribute('dxfId')) rule.setAttribute('dxfId', String(styleMap.differential[Number(rule.getAttribute('dxfId'))] ?? 0))
    for (const prop of Array.from(doc.getElementsByTagNameNS(sheetNS, 'sheetPr'))) prop.removeAttribute('codeName')
    for (const view of Array.from(doc.getElementsByTagNameNS(sheetNS, 'sheetView'))) view.removeAttribute('tabSelected')
    target.file(path, xml(doc))
    const index = destSheets.getElementsByTagNameNS(sheetNS, 'sheet').length
    const rid = `rIdShipmentContinuation${batch}_${nextId}`
    const sheet = workbook.createElementNS(sheetNS, 'sheet')
    sheet.setAttribute('name', name); sheet.setAttribute('sheetId', String(nextId++)); sheet.setAttributeNS(documentRelNS, 'r:id', rid); destSheets.appendChild(sheet)
    const relation = relationships.createElementNS(relNS, 'Relationship')
    relation.setAttribute('Id', rid); relation.setAttribute('Type', documentRelNS + '/worksheet'); relation.setAttribute('Target', relative('xl/workbook.xml', path)); relationships.documentElement!.appendChild(relation)
    for (const entry of Array.from(sourceBook.getElementsByTagNameNS(sheetNS, 'definedName'))) {
      if (entry.getAttribute('localSheetId') !== String(sourceIndex) || entry.getAttribute('name') === '_xlnm.Print_Area') continue
      const copy = workbook.importNode(entry, true) as Element; copy.setAttribute('localSheetId', String(index)); copy.textContent = renameDocumentSheets(copy.textContent || '', names); defined.appendChild(copy)
    }
    const area = workbook.createElementNS(sheetNS, 'definedName')
    area.setAttribute('name', '_xlnm.Print_Area'); area.setAttribute('localSheetId', String(index)); area.textContent = `'${name.replace(/'/g, "''")}'!${printRange(doc)}`; defined.appendChild(area)
  }
  target.file('xl/workbook.xml', xml(workbook)); target.file('xl/_rels/workbook.xml.rels', xml(relationships))
  target.file('xl/styles.xml', xml(styles)); target.file('[Content_Types].xml', xml(content))
  const application = target.file('docProps/app.xml')
  if (application) {
    const doc = parse(await application.async('string'))
    const titles = doc.getElementsByTagNameNS('*', 'TitlesOfParts')[0]
    const vector = titles?.getElementsByTagNameNS('*', 'vector')[0]
    if (vector) {
      while (vector.firstChild) vector.removeChild(vector.firstChild)
      const sheets = Array.from(workbook.getElementsByTagNameNS(sheetNS, 'sheet'))
      for (const sheet of sheets) {
        const entry = doc.createElementNS(vector.namespaceURI, 'vt:lpstr')
        entry.textContent = sheet.getAttribute('name') || ''; vector.appendChild(entry)
      }
      vector.setAttribute('size', String(sheets.length))
      const pairs = doc.getElementsByTagNameNS('*', 'HeadingPairs')[0]
      const variants = pairs ? Array.from(pairs.getElementsByTagNameNS('*', 'variant')) : []
      variants.forEach((value, index) => {
        if (value.textContent === 'Worksheets') {
          const count = variants[index + 1]?.getElementsByTagNameNS('*', 'i4')[0]
          if (count) count.textContent = String(sheets.length)
        }
      })
    }
    target.file('docProps/app.xml', xml(doc))
  }
}
