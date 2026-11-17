import * as XLSX from 'xlsx-js-style'
import JSZip from 'jszip'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import type { QuantityComment } from './shipmentQuantityComments'

const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const relNS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const docRelNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const contentNS = 'http://schemas.openxmlformats.org/package/2006/content-types'
const parse = (xml: string) => new DOMParser().parseFromString(xml.replace(/^\uFEFF/, ''), 'application/xml')

/** Add standard Excel/WPS notes after template merges, retaining picture relationships. */
export async function addWorksheetComments(zip: JSZip, sheetPath: string, notes: ReadonlyMap<string, readonly QuantityComment[]>) {
  if (!notes.size) return
  const sheet: XLSX.WorkSheet = {}
  for (const [address, comments] of notes) {
    // A legacy Excel note has one author per cell. Join bodies explicitly so
    // SheetJS does not wrap them as Comment/Reply text on every round trip.
    const c: XLSX.Comments = [{ a: comments.length === 1 ? comments[0].author : 'RR-Portal', t: comments.map(comment => comment.text).join('\n') }]
    c.hidden = true
    sheet[address] = { t: 'n', v: 0, c }
  }
  const cells = [...notes.keys()].map(XLSX.utils.decode_cell)
  sheet['!ref'] = XLSX.utils.encode_range({ r: 0, c: 0 }, { r: Math.max(...cells.map(c => c.r)), c: Math.max(...cells.map(c => c.c)) })
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Notes')
  const generated = await JSZip.loadAsync(XLSX.write(book, { type: 'array', bookType: 'xlsx' }))
  const commentsPath = 'xl/shipment-quantity-comments.xml', vmlPath = 'xl/drawings/shipment-quantity-comments.vml'
  zip.file(commentsPath, await generated.file('xl/comments1.xml')!.async('uint8array'))
  zip.file(vmlPath, await generated.file('xl/drawings/vmlDrawing1.vml')!.async('uint8array'))

  const directory = sheetPath.slice(0, sheetPath.lastIndexOf('/'))
  const relsPath = `${directory}/_rels/${sheetPath.slice(directory.length + 1)}.rels`
  const rels = parse(await zip.file(relsPath)?.async('string') || `<Relationships xmlns="${relNS}"/>`)
  const relations = Array.from(rels.getElementsByTagNameNS(relNS, 'Relationship'))
  for (const relation of relations) if (/\/(comments|vmlDrawing)$/.test(relation.getAttribute('Type') || '')) relation.parentNode?.removeChild(relation)
  const ids = new Set(relations.map(relation => relation.getAttribute('Id')))
  const relative = (path: string) => {
    const from = directory.split('/'), to = path.split('/')
    while (from.length && to.length && from[0] === to[0]) { from.shift(); to.shift() }
    return [...from.map(() => '..'), ...to].join('/')
  }
  let vmlId = ''
  for (const [type, path] of [['comments', commentsPath], ['vmlDrawing', vmlPath]]) {
    let id = `rIdShipmentQuantity${type}`, suffix = 1
    while (ids.has(id)) id = `rIdShipmentQuantity${type}${suffix++}`
    ids.add(id)
    const relation = rels.createElementNS(relNS, 'Relationship')
    relation.setAttribute('Id', id); relation.setAttribute('Type', `${docRelNS}/${type}`); relation.setAttribute('Target', relative(path))
    rels.documentElement!.appendChild(relation)
    if (type === 'vmlDrawing') vmlId = id
  }
  const doc = parse(await zip.file(sheetPath)!.async('string')), root = doc.documentElement!
  for (const old of Array.from(doc.getElementsByTagNameNS(ns, 'legacyDrawing'))) old.parentNode?.removeChild(old)
  const legacy = doc.createElementNS(ns, 'legacyDrawing')
  legacy.setAttributeNS(docRelNS, 'r:id', vmlId)
  const following = Array.from(root.childNodes).find(node => node.nodeType === 1 && ['legacyDrawingHF', 'picture', 'oleObjects', 'controls', 'webPublishItems', 'tableParts', 'extLst'].includes(((node as typeof root).localName || '')))
  root.insertBefore(legacy, following || null)

  const types = parse(await zip.file('[Content_Types].xml')!.async('string'))
  if (!Array.from(types.getElementsByTagNameNS(contentNS, 'Default')).some(node => node.getAttribute('Extension') === 'vml')) {
    const vml = types.createElementNS(contentNS, 'Default')
    vml.setAttribute('Extension', 'vml'); vml.setAttribute('ContentType', 'application/vnd.openxmlformats-officedocument.vmlDrawing')
    types.documentElement!.appendChild(vml)
  }
  if (!Array.from(types.getElementsByTagNameNS(contentNS, 'Override')).some(node => node.getAttribute('PartName') === '/' + commentsPath)) {
    const comment = types.createElementNS(contentNS, 'Override')
    comment.setAttribute('PartName', '/' + commentsPath); comment.setAttribute('ContentType', 'application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml')
    types.documentElement!.appendChild(comment)
  }
  const serializer = new XMLSerializer()
  zip.file(sheetPath, serializer.serializeToString(doc)); zip.file(relsPath, serializer.serializeToString(rels)); zip.file('[Content_Types].xml', serializer.serializeToString(types))
}
