// 出口报关明细 Excel 导出（基于模板 template_报关明细.xlsx）
// 移植自旧 HTML 印尼走货明细生成系统.html 的 buildExcel(6408) / setCell(6395) /
//   excelDate(6402) / dataUrlToBytes(6588) / injectOoxmlImages(6598)
// 与旧版保持 1:1：56 列布局、模板公式保留、表头黄底、计算列灰底、报关公司置顶、
//   产品图片用 JSZip 注入到第 19 列(U)。
import * as XLSX from 'xlsx-js-style'
import JSZip from 'jszip'
import type { Material } from '../api/client'

export const CUSTOMS_FIXED = '深圳市华胜益出口贸易有限公司'

// 走货明细行（与 ShipmentsPage 的 ShipmentItem 字段一致，只列导出用到的）
export interface CustomsItem {
  material_id?: number
  kg?: number
  qty?: number
  cartons?: number
  qty_per_carton?: string
  pallet?: string
  price?: number
  currency?: string
  po_no?: string
  po_date?: string
  supplier?: string
  customs_company?: string
  bl_head?: string
  contract_no?: string
  contract_date?: string
  invoice_no?: string
  invoice_date?: string
  invoice_price?: number
  product_use?: string
  formula_name?: string
}

export interface CustomsExportForm {
  customer?: string
  containerNo?: string
  containerCount?: number | string
  shipDate?: string
  blNo?: string
  rate?: number
  // 旧版隐藏字段，新版暂无 → 默认空/0
  eta?: string
  vessel?: string
  exportCompany?: string
  blHead?: string
  freightCN?: number
  freightID?: number
}

export interface CustomsExportInput {
  templateBuffer: ArrayBuffer
  items: CustomsItem[]                              // 已按显示顺序
  materials: Map<number, Material>                  // material_id → 物料主数据
  productHs: Map<string, { hsCN?: string; hsID?: string }> // product_code → 产品级 HS（兜底）
  images: Map<number, { bytes: Uint8Array; ext: string }>  // material_id → 图片
  form: CustomsExportForm
}

// 输出文件名：月日+客户+柜数+柜号(报关).xlsx
export function customsFileName(form: CustomsExportForm): string {
  const customer = form.customer || '客户'
  const count = form.containerCount != null && form.containerCount !== '' ? String(form.containerCount) : '1'
  const no = (form.containerNo || '').trim()
  const d = form.shipDate ? new Date(form.shipDate) : new Date()
  return `${d.getMonth() + 1}月${d.getDate()}日${customer}${count}柜${no}(报关).xlsx`
}

export function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; ext: string } | null {
  const m = String(dataUrl || '').match(/^data:image\/([a-z]+);base64,(.+)$/i)
  if (!m) return null
  const ext = m[1].toLowerCase() === 'jpg' ? 'jpeg' : m[1].toLowerCase()
  const bin = atob(m[2])
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return { bytes, ext }
}

type CellType = 's' | 'n'
function setCell(ws: XLSX.WorkSheet, r: number, c: number, value: any, type: CellType = 's') {
  const addr = XLSX.utils.encode_cell({ r, c })
  if (value === '' || value == null) { delete (ws as any)[addr]; return }
  const cell: any = { v: value, t: type }
  if (typeof value === 'string' && value.startsWith('=')) { cell.f = value.substring(1); cell.t = 'n'; delete cell.v }
  ;(ws as any)[addr] = cell
}

function excelDate(d: any): number | string {
  if (!d) return ''
  const dt = (d instanceof Date) ? d : new Date(d)
  if (isNaN(dt.getTime())) return d
  return Math.floor((dt.getTime() - Date.UTC(1899, 11, 30)) / 86400000)
}

export async function buildCustomsWorkbook(input: CustomsExportInput): Promise<Blob> {
  const { templateBuffer, items, materials, productHs, images, form } = input
  const AUX = new Set(['类别金额', '实业合同', '实业发票', '装箱单', '商品汇总表', '发票',
    '出货地址', '销售合同', '装箱单 (2)', '草稿大单-1', '司机资料', '单位对照', 'WpsReserved_CellImgList'])
  const wbObj = XLSX.read(templateBuffer, { type: 'array', cellFormula: true })
  const oldName = wbObj.SheetNames.find(n => !AUX.has(n))!
  const newName = (form.containerNo || '').trim() || oldName
  wbObj.Sheets[newName] = wbObj.Sheets[oldName]
  if (newName !== oldName) delete wbObj.Sheets[oldName]
  wbObj.SheetNames = wbObj.SheetNames.map(n => n === oldName ? newName : n)
  const ws = wbObj.Sheets[newName]

  const tf = {
    containerNo: newName,
    shipDate: form.shipDate || '',
    blNo: (form.blNo || '').trim(),
    eta: form.eta || '',
    vessel: (form.vessel || '').trim(),
    rate: Number(form.rate) || 0,
    exportCompany: (form.exportCompany || '').trim(),
    blHead: (form.blHead || '').trim(),
    freightCN: Number(form.freightCN) || 0,
    freightID: Number(form.freightID) || 0,
  }
  setCell(ws, 0, 13, tf.rate, 'n')

  // 报关公司分组（华胜益置顶），同组内按供应商相邻
  const matOf = (it: CustomsItem) => (it.material_id != null ? materials.get(it.material_id) : undefined)
  const effCustoms = (it: CustomsItem) => {
    const m = matOf(it)
    return ((it.customs_company || m?.customs_company || it.supplier || m?.supplier) || '').trim()
  }
  const sorted = [...items].sort((a, b) => {
    const ca = effCustoms(a), cb = effCustoms(b)
    const wa = ca === CUSTOMS_FIXED ? 0 : (ca ? 1 : 2)
    const wb = cb === CUSTOMS_FIXED ? 0 : (cb ? 1 : 2)
    if (wa !== wb) return wa - wb
    const byC = ca.localeCompare(cb, 'zh')
    if (byC !== 0) return byC
    const sa = (a.supplier || matOf(a)?.supplier || '').trim()
    const sb = (b.supplier || matOf(b)?.supplier || '').trim()
    return sa.localeCompare(sb, 'zh')
  })

  const floatImages: { rowZeroIdx: number; bytes: Uint8Array; ext: string }[] = []
  sorted.forEach((it, i) => {
    const m = matOf(it)
    const ri = 3 + i
    if (it.material_id != null && images.has(it.material_id)) {
      const img = images.get(it.material_id)!
      floatImages.push({ rowZeroIdx: ri, bytes: img.bytes, ext: img.ext })
    }
    const phs = m?.product_code ? productHs.get(m.product_code) : undefined
    setCell(ws, ri, 0, i + 1, 'n')
    setCell(ws, ri, 1, m?.hs_cn || phs?.hsCN || '', 's')
    setCell(ws, ri, 2, m?.hs_id || phs?.hsID || '', 's')
    setCell(ws, ri, 3, m?.product_code || '', 's')
    setCell(ws, ri, 4, it.formula_name || m?.name_zh || m?.item_no || '', 's')
    setCell(ws, ri, 5, m?.name_zh || '', 's')
    setCell(ws, ri, 6, m?.name_en || '', 's')
    setCell(ws, ri, 7, m?.spec || '', 's')
    setCell(ws, ri, 8, m?.category || '', 's')
    setCell(ws, ri, 9, m?.unit_kg || 'KGM', 's')
    setCell(ws, ri, 10, it.kg || 0, 'n')
    setCell(ws, ri, 11, it.qty || 0, 'n')
    setCell(ws, ri, 12, '件', 's')
    setCell(ws, ri, 13, '=AO' + (ri + 1) + '/$N$1', 'n')
    setCell(ws, ri, 14, '=N' + (ri + 1) + '*L' + (ri + 1), 'n')
    setCell(ws, ri, 15, '=ROUND(BC' + (ri + 1) + '*L' + (ri + 1) + ',2)', 'n')
    setCell(ws, ri, 16, '=ROUND(BD' + (ri + 1) + '*L' + (ri + 1) + ',2)', 'n')
    setCell(ws, ri, 17, '=AW' + (ri + 1) + '*AX' + (ri + 1) + '*AY' + (ri + 1) + '/1000000', 'n')
    setCell(ws, ri, 18, '=R' + (ri + 1) + '*AT' + (ri + 1), 'n')
    setCell(ws, ri, 20, it.product_use || '', 's')
    setCell(ws, ri, 21, it.contract_no || '', 's')
    if (it.contract_date) setCell(ws, ri, 22, excelDate(it.contract_date), 'n')
    setCell(ws, ri, 23, it.invoice_no || '', 's')
    if (it.invoice_date) setCell(ws, ri, 24, excelDate(it.invoice_date), 'n')
    if (it.invoice_price) setCell(ws, ri, 25, it.invoice_price, 'n')
    if (it.invoice_price) setCell(ws, ri, 26, '=Z' + (ri + 1) + '*L' + (ri + 1), 'n')
    setCell(ws, ri, 28, tf.containerNo, 's')
    if (tf.shipDate) setCell(ws, ri, 29, excelDate(tf.shipDate), 'n')
    setCell(ws, ri, 30, tf.blNo, 's')
    if (tf.eta) setCell(ws, ri, 31, excelDate(tf.eta), 'n')
    setCell(ws, ri, 33, tf.vessel, 's')
    setCell(ws, ri, 34, tf.freightCN, 'n')
    setCell(ws, ri, 35, tf.freightID, 'n')
    setCell(ws, ri, 37, it.supplier || m?.supplier || '', 's')
    if (it.po_date) setCell(ws, ri, 38, excelDate(it.po_date), 'n')
    else if (it.contract_date) setCell(ws, ri, 38, excelDate(it.contract_date), 'n')
    setCell(ws, ri, 39, it.po_no || '', 's')
    setCell(ws, ri, 40, it.price || 0, 'n')
    setCell(ws, ri, 41, '=AO' + (ri + 1) + '*L' + (ri + 1), 'n')
    const currency = it.currency || '¥'
    const fmtMap: Record<string, string> = {
      '¥': '¥#,##0.0000', 'HK$': '"HK$"#,##0.0000', 'US$': '"US$"#,##0.0000',
      '€': '"€"#,##0.0000', '£': '"£"#,##0.0000', '¥(JPY)': '"¥"#,##0',
    }
    const fmt = fmtMap[currency] || '#,##0.0000'
    ;['AO', 'AP'].forEach((_col, j) => {
      const addr = XLSX.utils.encode_cell({ r: ri, c: 40 + j })
      if ((ws as any)[addr]) (ws as any)[addr].z = fmt
    })
    setCell(ws, ri, 43, it.customs_company || m?.customs_company || tf.exportCompany, 's')
    setCell(ws, ri, 44, it.bl_head || tf.blHead, 's')
    setCell(ws, ri, 45, it.cartons || 0, 'n')
    const qpc = it.qty_per_carton != null && it.qty_per_carton !== '' ? it.qty_per_carton : (m?.qty_per_carton ?? 0)
    setCell(ws, ri, 46, qpc, (typeof qpc === 'string' && /[^\d.]/.test(qpc)) ? 's' : 'n')
    setCell(ws, ri, 47, it.pallet || '', 's')
    setCell(ws, ri, 48, m?.length || 0, 'n')
    setCell(ws, ri, 49, m?.width || 0, 'n')
    setCell(ws, ri, 50, m?.height || 0, 'n')
    setCell(ws, ri, 53, m?.weight_per_carton || 0, 'n')
    setCell(ws, ri, 54, m?.gross_per_pc || 0, 'n')
    setCell(ws, ri, 55, m?.net_per_pc || 0, 'n')
  })
  if (sorted.length) ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 3 + sorted.length - 1, c: 55 } })

  // 样式
  const thinBorder = { style: 'thin', color: { rgb: '999999' } }
  const border = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder }
  const headerStyle = {
    font: { name: 'Microsoft YaHei', sz: 10, bold: true, color: { rgb: '1A1A2E' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    fill: { fgColor: { rgb: 'FFF2CC' } }, border,
  }
  const dataStyle = {
    font: { name: 'Microsoft YaHei', sz: 10 },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border,
  }
  const computedStyle = {
    font: { name: 'Microsoft YaHei', sz: 10, color: { rgb: '666666' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    fill: { fgColor: { rgb: 'F0F3F7' } }, border,
  }
  const COMPUTED_COLS = new Set([13, 14, 15, 16, 17, 18, 26, 27, 41, 42])
  for (let c = 0; c < 56; c++) {
    const addr = XLSX.utils.encode_cell({ r: 2, c })
    if (!(ws as any)[addr]) (ws as any)[addr] = { v: '', t: 's' }
    ;(ws as any)[addr].s = headerStyle
  }
  for (let i = 0; i < sorted.length; i++) {
    const ri = 3 + i
    for (let c = 0; c < 56; c++) {
      const addr = XLSX.utils.encode_cell({ r: ri, c })
      if (!(ws as any)[addr]) (ws as any)[addr] = { v: '', t: 's' }
      ;(ws as any)[addr].s = COMPUTED_COLS.has(c) ? computedStyle : dataStyle
    }
  }

  const COL_WIDTHS = [
    6, 14, 14, 10, 18, 24, 30, 14, 10, 8, 12, 12, 8,
    12, 12, 12, 12, 12, 14, 10, 16, 16, 14, 14, 14, 12, 14, 16,
    18, 14, 16, 14, 14, 24, 14, 14, 16,
    26, 14, 14, 12, 14, 14, 24, 24,
    10, 14, 14, 8, 8, 8, 14, 10, 10, 10,
  ]
  ws['!cols'] = COL_WIDTHS.map(w => ({ wch: w }))
  const rows: any[] = []
  rows[0] = { hpt: 24 }; rows[1] = { hpt: 24 }; rows[2] = { hpt: 36 }
  for (let i = 0; i < sorted.length; i++) rows[3 + i] = { hpt: 55 }
  ws['!rows'] = rows

  const out = XLSX.write(wbObj, { type: 'array', bookType: 'xlsx' })
  const outZip = await JSZip.loadAsync(out)
  if (floatImages.length) {
    const mainSheetIdx = wbObj.SheetNames.indexOf(newName) + 1
    await injectOoxmlImages(outZip, mainSheetIdx, floatImages)
  }
  return await outZip.generateAsync({ type: 'blob' })
}

async function injectOoxmlImages(
  zip: JSZip, mainSheetIdx: number,
  rowsWithImage: { rowZeroIdx: number; bytes: Uint8Array; ext: string }[],
) {
  if (!rowsWithImage.length) return
  let mediaSeq = 100
  while (zip.file('xl/media/image' + mediaSeq + '.png') || zip.file('xl/media/image' + mediaSeq + '.jpeg')) mediaSeq++
  const mediaEntries: { path: string; num: number; rowZeroIdx: number }[] = []
  for (const r of rowsWithImage) {
    const path = 'xl/media/image' + mediaSeq + '.' + r.ext
    zip.file(path, r.bytes)
    mediaEntries.push({ path, num: mediaSeq, rowZeroIdx: r.rowZeroIdx })
    mediaSeq++
  }
  const drawingNum = 999
  const drawingPath = 'xl/drawings/drawing' + drawingNum + '.xml'
  const drawingRelsPath = 'xl/drawings/_rels/drawing' + drawingNum + '.xml.rels'
  let anchors = '', relsItems = ''
  mediaEntries.forEach((m, i) => {
    const rid = 'rId' + (i + 1)
    anchors += `<xdr:oneCellAnchor>
  <xdr:from><xdr:col>19</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${m.rowZeroIdx}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
  <xdr:ext cx="600000" cy="600000"/>
  <xdr:pic>
    <xdr:nvPicPr><xdr:cNvPr id="${i + 2}" name="Picture ${i + 1}"/><xdr:cNvPicPr/></xdr:nvPicPr>
    <xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>
    <xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="600000" cy="600000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>
  </xdr:pic>
  <xdr:clientData/>
</xdr:oneCellAnchor>`
    relsItems += `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${m.path.split('/').pop()}"/>`
  })
  zip.file(drawingPath, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${anchors}</xdr:wsDr>`)
  zip.file(drawingRelsPath, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relsItems}</Relationships>`)
  const sheetRelsPath = 'xl/worksheets/_rels/sheet' + mainSheetIdx + '.xml.rels'
  const sheetRelsFile = zip.file(sheetRelsPath)
  let relsXml = sheetRelsFile ? await sheetRelsFile.async('string')
    : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'
  const newRid = 'rIdGenDrawing999'
  if (!relsXml.includes(newRid)) {
    relsXml = relsXml.replace('</Relationships>',
      `<Relationship Id="${newRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${drawingNum}.xml"/></Relationships>`)
    zip.file(sheetRelsPath, relsXml)
  }
  const sheetPath = 'xl/worksheets/sheet' + mainSheetIdx + '.xml'
  let sheetXml = await zip.file(sheetPath)!.async('string')
  if (!sheetXml.includes('<drawing ')) {
    sheetXml = sheetXml.replace('</worksheet>', `<drawing r:id="${newRid}"/></worksheet>`)
    zip.file(sheetPath, sheetXml)
  }
  let ct = await zip.file('[Content_Types].xml')!.async('string')
  if (!ct.includes('Extension="png"')) {
    ct = ct.replace(/<Types[^>]*>/, m => m + '<Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/>')
  }
  if (!ct.includes('drawing' + drawingNum + '.xml')) {
    ct = ct.replace('</Types>',
      `<Override PartName="/xl/drawings/drawing${drawingNum}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`)
  }
  zip.file('[Content_Types].xml', ct)
}
