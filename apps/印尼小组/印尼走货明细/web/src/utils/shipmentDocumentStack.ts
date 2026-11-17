import JSZip from 'jszip'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import { rebindDocumentFormula, type DocumentTableLayout } from './documentTemplateFormula'
import { renameDocumentSheets } from './shipmentDocumentOverflow'

const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const relNS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const docRelNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const families = ['实业合同', '实业发票', '全球合同', '全球发票', '印尼合同', '印尼发票', '装箱单']
const familyOf = (name: string) => families.find(base => name === base || new RegExp(`^${base}·续\\d+(?:-\\d+)?$`).test(name))
const parse = (value: string) => new DOMParser().parseFromString(value.replace(/^\uFEFF/, ''), 'application/xml')
type Doc = ReturnType<typeof parse>
type Element = NonNullable<Doc['documentElement']>
const children = (parent: any, name: string): Element[] => Array.from(parent?.childNodes || []).filter((node: any) => node.nodeType === 1 && node.localName === name) as Element[]
const xml = (doc: Doc) => new XMLSerializer().serializeToString(doc)
const address = (text: string, offset: number) => text.replace(/(\$?[A-Z]{1,3}\$?)(\d+)/g, (_, column, row) => `${column}${Number(row) + offset}`)
function bounds(doc: Doc) {
  let row = 1, col = 1, letters = 'A'
  for (const tag of ['c', 'mergeCell']) for (const node of Array.from(doc.getElementsByTagNameNS(ns, tag))) {
    for (const match of (node.getAttribute(tag === 'c' ? 'r' : 'ref') || '').matchAll(/([A-Z]+)(\d+)/g)) {
      row = Math.max(row, Number(match[2]))
      const index = [...match[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0)
      if (index > col) { col = index; letters = match[1] }
    }
  }
  for (const node of Array.from(doc.getElementsByTagNameNS(ns, 'row'))) row = Math.max(row, Number(node.getAttribute('r')) || 0)
  return { row, letters }
}
const worksheetOrder = ['sheetPr', 'dimension', 'sheetViews', 'sheetFormatPr', 'cols', 'sheetData', 'sheetCalcPr', 'sheetProtection', 'protectedRanges', 'scenarios', 'autoFilter', 'sortState', 'dataConsolidate', 'customSheetViews', 'mergeCells', 'phoneticPr', 'conditionalFormatting', 'dataValidations', 'hyperlinks', 'printOptions', 'pageMargins', 'pageSetup', 'headerFooter', 'rowBreaks', 'colBreaks', 'customProperties', 'cellWatches', 'ignoredErrors', 'smartTags', 'drawing', 'legacyDrawing', 'legacyDrawingHF', 'picture', 'oleObjects', 'controls', 'webPublishItems', 'tableParts', 'extLst']
function collection(doc: Doc, name: string) {
  const root = doc.documentElement!
  let node = children(root, name)[0]
  if (!node) {
    node = doc.createElementNS(ns, name)
    const next = Array.from(root.childNodes).find((child: any) => child.nodeType === 1 && worksheetOrder.indexOf(child.localName) > worksheetOrder.indexOf(name))
    root.insertBefore(node, next || null)
  }
  return node
}

/** Continue each financial document vertically on its original tab. */
export async function stackShipmentDocumentSheets(zip: JSZip, mainName: string) {
  const book = parse(await zip.file('xl/workbook.xml')!.async('string'))
  const sheets = book.getElementsByTagNameNS(ns, 'sheets')[0]
  const oldNodes = children(sheets, 'sheet')
  if (!oldNodes.some(node => /·续\d/.test(node.getAttribute('name') || ''))) return
  const relationships = parse(await zip.file('xl/_rels/workbook.xml.rels')!.async('string'))
  const relations = Array.from(relationships.getElementsByTagNameNS(relNS, 'Relationship'))
  const groups = new Map<string, Array<{ name: string; node: Element; path: string; doc: Doc; offset: number }>>()
  for (const node of oldNodes) {
    const name = node.getAttribute('name') || '', family = familyOf(name)
    if (!family) continue
    const relation = relations.find(rel => rel.getAttribute('Id') === node.getAttributeNS(docRelNS, 'id'))!
    const target = relation.getAttribute('Target')!.replace(/^\//, '')
    const path = target.startsWith('xl/') ? target : 'xl/' + target
    const entries = groups.get(family) || []
    const offset = entries.length ? entries.at(-1)!.offset + bounds(entries.at(-1)!.doc).row + 1 : 0
    entries.push({ name, node, path, doc: parse(await zip.file(path)!.async('string')), offset })
    groups.set(family, entries)
  }
  const names = new Map<string, string>(), layouts = new Map<string, DocumentTableLayout[]>()
  for (const [family, entries] of groups) for (const entry of entries) {
    names.set(entry.name, family)
    layouts.set(entry.name, [{ start: 1, end: 1, finalStart: entry.offset + 1, finalTotal: entry.offset + 2 }])
  }
  const rewrite = (formula: string, sheet: string) => renameDocumentSheets(rebindDocumentFormula(formula, { sheet, main: mainName, layouts }), names)
  const removed = new Set<Element>(), areas = new Map<Element, string>()
  const content = parse(await zip.file('[Content_Types].xml')!.async('string'))
  for (const [family, entries] of groups) {
    const base = entries[0], target = base.doc, data = collection(target, 'sheetData')
    for (const entry of entries) {
      for (const f of ['f', 'formula', 'formula1', 'formula2'].flatMap(tag => Array.from(entry.doc.getElementsByTagNameNS(ns, tag)))) {
        f.textContent = rewrite(f.textContent || '', entry.name)
        if (f.hasAttribute('ref')) f.setAttribute('ref', address(f.getAttribute('ref')!, entry.offset))
      }
      if (!entry.offset) continue
      for (const row of children(collection(entry.doc, 'sheetData'), 'row')) {
        const copy = target.importNode(row, true) as Element
        copy.setAttribute('r', String(Number(copy.getAttribute('r')) + entry.offset))
        for (const cell of children(copy, 'c')) cell.setAttribute('r', address(cell.getAttribute('r') || '', entry.offset))
        data.appendChild(copy)
      }
      for (const tag of ['mergeCells', 'rowBreaks', 'dataValidations']) {
        const source = children(entry.doc.documentElement, tag)[0]
        if (!source) continue
        const dest = collection(target, tag)
        for (const child of Array.from(source.childNodes).filter((n: any) => n.nodeType === 1)) {
          const copy = target.importNode(child, true) as Element
          if (copy.hasAttribute('ref')) copy.setAttribute('ref', address(copy.getAttribute('ref')!, entry.offset))
          if (copy.hasAttribute('sqref')) copy.setAttribute('sqref', address(copy.getAttribute('sqref')!, entry.offset))
          if (tag === 'rowBreaks') copy.setAttribute('id', String(Number(copy.getAttribute('id')) + entry.offset))
          dest.appendChild(copy)
        }
        dest.setAttribute('count', String(Array.from(dest.childNodes).filter((n: any) => n.nodeType === 1).length))
      }
      for (const cf of children(entry.doc.documentElement, 'conditionalFormatting')) {
        const copy = target.importNode(cf, true) as Element
        copy.setAttribute('sqref', address(copy.getAttribute('sqref') || '', entry.offset))
        const next = Array.from(target.documentElement!.childNodes).find((n: any) => n.nodeType === 1 && worksheetOrder.indexOf(n.localName) > worksheetOrder.indexOf('conditionalFormatting'))
        target.documentElement!.insertBefore(copy, next || null)
      }
      const breaks = collection(target, 'rowBreaks'), page = target.createElementNS(ns, 'brk')
      for (const [name, value] of Object.entries({ id: String(entry.offset), min: '0', max: '16383', man: '1' })) page.setAttribute(name, value)
      breaks.appendChild(page)
      breaks.setAttribute('count', String(children(breaks, 'brk').length)); breaks.setAttribute('manualBreakCount', String(children(breaks, 'brk').filter(b => b.getAttribute('man') === '1').length))
      removed.add(entry.node)
      const relation = relations.find(rel => rel.getAttribute('Id') === entry.node.getAttributeNS(docRelNS, 'id'))
      relation?.parentNode?.removeChild(relation)
      for (const type of Array.from(content.getElementsByTagNameNS('http://schemas.openxmlformats.org/package/2006/content-types', 'Override')))
        if (type.getAttribute('PartName') === '/' + entry.path) type.parentNode?.removeChild(type)
      zip.remove(entry.path); zip.remove(entry.path.replace(/^(.*\/)([^/]+)$/, '$1_rels/$2.rels'))
    }
    base.node.setAttribute('name', family)
    const last = bounds(target)
    collection(target, 'dimension').setAttribute('ref', `A1:${last.letters}${last.row}`)
    const setup = collection(target, 'pageSetup'); setup.setAttribute('fitToWidth', '1'); setup.setAttribute('fitToHeight', '0')
    const properties = collection(target, 'sheetPr')
    let fit = children(properties, 'pageSetUpPr')[0]
    if (!fit) { fit = target.createElementNS(ns, 'pageSetUpPr'); properties.appendChild(fit) }
    fit.setAttribute('fitToPage', '1')
    areas.set(base.node, `'${family}'!$A$1:$${last.letters}$${last.row}`)
    zip.file(base.path, xml(target))
  }
  const surviving = oldNodes.filter(node => !removed.has(node))
  const financial = families.flatMap(name => surviving.filter(node => node.getAttribute('name') === name))
  const ordinary = surviving.filter(node => !financial.includes(node))
  const insert = oldNodes.slice(0, oldNodes.findIndex(node => !!familyOf(node.getAttribute('name') || ''))).filter(node => !removed.has(node)).length
  const ordered = [...ordinary.slice(0, insert), ...financial, ...ordinary.slice(insert)]
  for (const node of [...oldNodes]) sheets.removeChild(node)
  for (const node of ordered) sheets.appendChild(node)
  for (const defined of Array.from(book.getElementsByTagNameNS(ns, 'definedName'))) {
    const local = defined.getAttribute('localSheetId')
    if (local != null && local !== '') {
      const owner = oldNodes[Number(local)]
      if (removed.has(owner)) { defined.parentNode?.removeChild(defined); continue }
      defined.setAttribute('localSheetId', String(ordered.indexOf(owner)))
      defined.textContent = defined.getAttribute('name') === '_xlnm.Print_Area' && areas.has(owner)
        ? areas.get(owner)! : rewrite(defined.textContent || '', owner.getAttribute('name') || '')
    } else defined.textContent = renameDocumentSheets(defined.textContent || '', names)
  }
  let definitions = book.getElementsByTagNameNS(ns, 'definedNames')[0]
  if (!definitions) { definitions = book.createElementNS(ns, 'definedNames'); book.documentElement!.insertBefore(definitions, book.getElementsByTagNameNS(ns, 'calcPr')[0] || null) }
  for (const [node, area] of areas) if (!children(definitions, 'definedName').some(n => n.getAttribute('name') === '_xlnm.Print_Area' && n.getAttribute('localSheetId') === String(ordered.indexOf(node)))) {
    const defined = book.createElementNS(ns, 'definedName'); defined.setAttribute('name', '_xlnm.Print_Area'); defined.setAttribute('localSheetId', String(ordered.indexOf(node))); defined.textContent = area; definitions.appendChild(defined)
  }
  for (const view of Array.from(book.getElementsByTagNameNS(ns, 'workbookView'))) for (const field of ['activeTab', 'firstSheet']) {
    if (!view.hasAttribute(field)) continue
    const old = oldNodes[Number(view.getAttribute(field))], mapped = removed.has(old) ? groups.get(familyOf(old.getAttribute('name') || '')!)?.[0].node : old
    view.setAttribute(field, String(Math.max(0, ordered.indexOf(mapped!))))
  }
  zip.file('xl/workbook.xml', xml(book)); zip.file('xl/_rels/workbook.xml.rels', xml(relationships)); zip.file('[Content_Types].xml', xml(content))
  const appFile = zip.file('docProps/app.xml')
  if (appFile) {
    const app = parse(await appFile.async('string')), titles = app.getElementsByTagNameNS('*', 'TitlesOfParts')[0]?.getElementsByTagNameNS('*', 'vector')[0]
    if (titles) {
      while (titles.firstChild) titles.removeChild(titles.firstChild)
      for (const node of ordered) { const title = app.createElementNS(titles.namespaceURI, 'vt:lpstr'); title.textContent = node.getAttribute('name'); titles.appendChild(title) }
      titles.setAttribute('size', String(ordered.length))
    }
    const pairs = Array.from(app.getElementsByTagNameNS('*', 'HeadingPairs')[0]?.getElementsByTagNameNS('*', 'variant') || [])
    pairs.forEach((pair, index) => { if (pair.textContent === 'Worksheets') { const count = pairs[index + 1]?.getElementsByTagNameNS('*', 'i4')[0]; if (count) count.textContent = String(ordered.length) } })
    zip.file('docProps/app.xml', xml(app))
  }
}
