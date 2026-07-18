// 生产单 Excel 导出（搪胶采购单 / 塑胶啤货生产表）
// 忠实移植自旧 HTML mpoExportTangjiao + mpoExportSujiao —— 含完整合并/行高/样式（xlsx-js-style）。
import * as XLSX from 'xlsx-js-style'

export interface MpoExportItem {
  code?: string
  moldId?: string
  moldName?: string
  partName?: string
  colorName?: string
  colorCode?: string
  colorDisplay?: string
  pigmentCode?: string
  materialName?: string
  netGramsPerShot?: number
  setsPerShot?: number
  ejections?: number
  qty?: number
  unitPrice?: number
  notes?: string
}

export interface MpoExportData {
  no?: string
  customer?: string
  category?: string
  workshop?: string
  orderDate?: string
  deliveryDate?: string
  currency?: string
  vendorContact?: string
  buyerContact?: string
  buyerPhone?: string
  items?: MpoExportItem[]
}

const PAD = (n: number) => Array.from({ length: n }, () => '')

// ========== 搪胶采购单（11 列）==========
export async function exportTangjiao(mpo: MpoExportData) {
  const NCOL = 11
  const curr = (mpo.currency || 'HK$').replace('$', '')
  const today = new Date().toISOString().slice(0, 10)
  const delivery = mpo.deliveryDate || today
  const rows: any[][] = []
  rows.push(['东莞兴信塑胶制品有限公司', ...PAD(NCOL - 1)])
  rows.push(['广东省东莞市清溪镇上元管理区兴信塑胶制品有限公司银坑北环路59号B栋2楼', ...PAD(NCOL - 1)])
  rows.push(['TEL:0769-87362376    FAX:0769-87362377', ...PAD(NCOL - 1)])
  rows.push(['搪胶采购单', ...PAD(NCOL - 1)])
  rows.push(PAD(NCOL))
  rows.push(['', '厂  商：', '搪胶部', '', '', '', '', '', '订单编号：', mpo.no ?? '', ''])
  rows.push(['', '联 络 人：', mpo.vendorContact ?? '', '', '', '', '', '', '联 络 人：', mpo.buyerContact ?? '', ''])
  rows.push(['', '联系电话：', '', '', '', '', '', '', '联系电话：', mpo.buyerPhone ?? '', ''])
  rows.push(['', 'Fax：', '', '', '', '', '', '', 'Fax：', '', ''])
  rows.push(PAD(NCOL))
  rows.push(['货号', '模号', '货品名称', '颜色编号', '用料', '啤重', '出模数', '数量', `单价(${curr})`, `金额(${curr})`, '备注'])
  const hdrRow = 10
  const dataStart = 11
  for (const it of (mpo.items ?? [])) {
    const r = rows.length + 1
    rows.push([
      it.code ?? '', it.moldId ?? '', it.partName ?? '',
      it.colorDisplay ?? (it.colorCode ? `${it.colorName ?? ''}/${it.colorCode}` : (it.colorName ?? '')),
      it.materialName ?? '',
      +Number(it.netGramsPerShot ?? 0).toFixed(1),
      Number(it.ejections) || 1,
      Number(it.qty) || 0,
      +Number(it.unitPrice ?? 0).toFixed(2),
      { f: `H${r}*I${r}` },
      it.notes ?? '',
    ])
  }
  const dataEnd = rows.length - 1
  rows.push(['', '', '', '', '', '', '', '', '合计金额', { f: `SUM(J${dataStart + 1}:J${dataEnd + 1})` }, ''])
  const sumRow = rows.length - 1
  rows.push([`1.${delivery}前交货、货送   D栋3楼  处，收货人：${mpo.buyerContact ?? ''}`, ...PAD(NCOL - 1)])
  rows.push(['2.单价已含 13 %增值税，月结 90 天；附送免费1% 备品', ...PAD(NCOL - 1)])
  rows.push(['3、货物及部件质量符合国外现行最新标准', ...PAD(NCOL - 1)])
  rows.push(['注意事项：', ...PAD(NCOL - 1)])
  rows.push(['1、收到本采购订单后，请24小时内予确认（签名、或及盖章），未签回，拒找数。', ...PAD(NCOL - 1)])
  rows.push(['2、供应商按时交货，延期交货应承担违约责任，且采购方有权取消部分或全部订单；', ...PAD(NCOL - 1)])
  rows.push(['3.货物及部件质量符合欧洲、美国、中国的玩具标准、安全标准，符合欧盟ROHS标准及其最新指令', ...PAD(NCOL - 1)])
  rows.push(['4.货物之详细规格应与样品、或图纸相符；', ...PAD(NCOL - 1)])
  rows.push(['5.采购方收货仅为形式、数量收货，供应商保证货物质量、规格符合上述约定，同意随时抽检或全检，如有不符，同意补货或退货，如生产或市场销售中造成采购方损失，承担采购方损失；', ...PAD(NCOL - 1)])
  rows.push(['6、次月5号前提供当月对账单、送货单原件给甲方财务对账，双方同意付款时以港币折算为人民币付款，港币折算为人民币的汇率以送货当月月结后第60天的中国人民银行公布的港币汇率中间价核算，如第60天为节假日，顺延至工作日；付款前乙方提供发票、收款收据。', ...PAD(NCOL - 1)])
  rows.push(['如发生争议，同意由采购方法院管辖；', ...PAD(NCOL - 1)])
  rows.push(['7.其他事项：', ...PAD(NCOL - 1)])
  rows.push(['供应商确认：', '', `采购签核：${mpo.buyerContact ?? ''}`, '', '', '主管：', '', '经理：', '', '', ''])
  const od = mpo.orderDate ?? today
  const [yy, mm, dd] = od.split('-')
  rows.push([`时间：${yy ?? ''} 年 ${mm ?? ''} 月 ${dd ?? ''} 日`, ...PAD(NCOL - 3), '时间：', od, ''])

  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 14 }, { wch: 18 }, { wch: 24 }, { wch: 18 }, { wch: 18 }, { wch: 8 }, { wch: 8 }, { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 16 }]
  const rowHeights: any[] = [{ hpt: 32 }, { hpt: 20 }, { hpt: 20 }, { hpt: 36 }, { hpt: 10 }, { hpt: 24 }, { hpt: 24 }, { hpt: 24 }, { hpt: 24 }, { hpt: 10 }, { hpt: 28 }]
  while (rowHeights.length <= dataEnd) rowHeights.push({ hpt: 24 })
  rowHeights.push({ hpt: 28 })
  rowHeights.push({ hpt: 22 }, { hpt: 22 }, { hpt: 22 }, { hpt: 22 }, { hpt: 22 }, { hpt: 22 }, { hpt: 36 }, { hpt: 22 }, { hpt: 46 }, { hpt: 62 }, { hpt: 22 }, { hpt: 22 }, { hpt: 30 }, { hpt: 30 })
  ws['!rows'] = rowHeights
  ws['!merges'] = []
  const mg = (sR: number, sC: number, eR: number, eC: number) => ws['!merges']!.push({ s: { r: sR, c: sC }, e: { r: eR, c: eC } })
  mg(0, 0, 0, NCOL - 1); mg(1, 0, 1, NCOL - 1); mg(2, 0, 2, NCOL - 1); mg(3, 0, 3, NCOL - 1)
  for (const r of [5, 6, 7, 8]) { mg(r, 2, r, 7); mg(r, 9, r, 10) }
  mg(sumRow, 0, sumRow, 7)
  for (let r = sumRow + 1; r < rows.length - 2; r++) mg(r, 0, r, NCOL - 1)
  mg(rows.length - 2, 0, rows.length - 2, 1); mg(rows.length - 2, 2, rows.length - 2, 4); mg(rows.length - 2, 5, rows.length - 2, 7); mg(rows.length - 2, 8, rows.length - 2, NCOL - 1)
  mg(rows.length - 1, 0, rows.length - 1, NCOL - 4); mg(rows.length - 1, NCOL - 3, rows.length - 1, NCOL - 1)

  const center = { horizontal: 'center', vertical: 'center', wrapText: true }
  const left = { horizontal: 'left', vertical: 'center', wrapText: true, indent: 1 }
  const thin = { style: 'thin', color: { rgb: '808080' } }
  const medium = { style: 'medium', color: { rgb: '1A1A2E' } }
  const setStyle = (r: number, c: number, st: any) => { const a = XLSX.utils.encode_cell({ r, c }); if (!(ws as any)[a]) (ws as any)[a] = { t: 's', v: '' }; (ws as any)[a].s = st }
  setStyle(0, 0, { font: { bold: true, sz: 24, color: { rgb: '1A1A2E' } }, alignment: center })
  setStyle(1, 0, { font: { sz: 11, color: { rgb: '444444' } }, alignment: center })
  setStyle(2, 0, { font: { sz: 11, color: { rgb: '444444' } }, alignment: center })
  setStyle(3, 0, { font: { bold: true, sz: 22, color: { rgb: '1A1A2E' } }, alignment: center })
  for (const r of [5, 6, 7, 8]) {
    setStyle(r, 1, { font: { sz: 11, bold: true }, alignment: { horizontal: 'right', vertical: 'center' } })
    setStyle(r, 2, { font: { sz: 11 }, alignment: { horizontal: 'left', vertical: 'center', indent: 1 } })
    setStyle(r, 8, { font: { sz: 11, bold: true }, alignment: { horizontal: 'right', vertical: 'center' } })
    setStyle(r, 9, { font: { sz: 11, bold: r === 5 }, alignment: { horizontal: 'left', vertical: 'center', indent: 1 } })
  }
  for (let c = 0; c < NCOL; c++) setStyle(hdrRow, c, { font: { bold: true, sz: 12, color: { rgb: 'FFFFFF' } }, alignment: center, border: { top: medium, bottom: thin, left: c === 0 ? medium : thin, right: c === NCOL - 1 ? medium : thin }, fill: { patternType: 'solid', fgColor: { rgb: '4A90D9' } } })
  for (let r = dataStart; r <= dataEnd; r++) {
    const stripe = ((r - dataStart) % 2 === 1) ? { fill: { patternType: 'solid', fgColor: { rgb: 'F8FAFC' } } } : {}
    for (let c = 0; c < NCOL; c++) setStyle(r, c, { font: { sz: 11 }, alignment: center, border: { top: thin, bottom: thin, left: c === 0 ? medium : thin, right: c === NCOL - 1 ? medium : thin }, ...stripe })
    setStyle(r, 9, { font: { sz: 11, bold: true }, alignment: { horizontal: 'right', vertical: 'center' }, border: { top: thin, bottom: thin, left: thin, right: thin }, numFmt: '#,##0.00', ...stripe })
  }
  for (let c = 0; c < NCOL; c++) setStyle(sumRow, c, { font: { sz: 11 }, alignment: center, border: { top: thin, bottom: medium, left: c === 0 ? medium : thin, right: c === NCOL - 1 ? medium : thin }, fill: { patternType: 'solid', fgColor: { rgb: 'FFF8E1' } } })
  setStyle(sumRow, 8, { font: { bold: true, sz: 12 }, alignment: { horizontal: 'right', vertical: 'center' }, border: { top: thin, bottom: medium, left: thin, right: thin }, fill: { patternType: 'solid', fgColor: { rgb: 'FFF8E1' } } })
  setStyle(sumRow, 9, { font: { bold: true, sz: 13, color: { rgb: 'C0392B' } }, alignment: { horizontal: 'right', vertical: 'center' }, border: { top: thin, bottom: medium, left: thin, right: thin }, numFmt: '#,##0.00', fill: { patternType: 'solid', fgColor: { rgb: 'FFF8E1' } } })
  for (let r = sumRow + 1; r < rows.length - 2; r++) setStyle(r, 0, { font: { sz: 11 }, alignment: left })
  const sig = { font: { sz: 12, bold: true }, alignment: { horizontal: 'left', vertical: 'center', indent: 1 } }
  setStyle(rows.length - 2, 0, sig); setStyle(rows.length - 2, 2, sig); setStyle(rows.length - 2, 5, sig); setStyle(rows.length - 2, 8, sig)
  setStyle(rows.length - 1, 0, { font: { sz: 12 }, alignment: { horizontal: 'left', vertical: 'center', indent: 1 } })
  setStyle(rows.length - 1, NCOL - 3, { font: { sz: 12, bold: true }, alignment: { horizontal: 'right', vertical: 'center' } })
  setStyle(rows.length - 1, NCOL - 2, { font: { sz: 12, bold: true, color: { rgb: '1A1A2E' } }, alignment: { horizontal: 'left', vertical: 'center', indent: 1 } })

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '搪胶采购单')
  XLSX.writeFile(wb, `${mpo.no ?? '搪胶单'}_搪胶采购单.xlsx`)
}

// ========== 塑胶啤货生产表（14 列）==========
export async function exportSujiao(mpo: MpoExportData) {
  const NCOL = 14
  const rows: any[][] = []
  rows.push(['东莞兴信塑胶制品有限公司', ...PAD(NCOL - 1)])
  rows.push(['啤机部生产啤货表', ...PAD(NCOL - 1)])
  rows.push(['供应商：', mpo.workshop ?? '', ...PAD(NCOL - 4), '生产单号：', mpo.no ?? ''])
  rows.push(['地址：', '中国广东省东莞市清溪镇上元银坑路1号', ...PAD(NCOL - 2)])
  rows.push(['电话：', '0769-87388020', '传真：', '0769-87302082', '公司名称：', mpo.customer ?? '', ...PAD(2), '交货地点：', 'B车间C栋四楼', ...PAD(NCOL - 12), '交货日期：', mpo.deliveryDate ?? mpo.orderDate ?? ''])
  rows.push(PAD(NCOL))
  rows.push(['货号', '模具编号', '模具名称', '总套数', '啤数', '颜色', '色粉号', '用料名称', '整啤净重(G)', '总净重(KG)', '加工单价(HK)', '加工金额(HK)', '交货日期', '备注'])
  const hdrRow = 6
  const dataStart = 7
  for (const it of (mpo.items ?? [])) {
    const sets = Number(it.setsPerShot) || 1
    const shots = sets > 0 ? Math.ceil((Number(it.qty) || 0) / sets / (Number(it.ejections) || 1)) : 0
    const r = rows.length + 1
    rows.push([
      it.code ?? '', it.moldId ?? '', it.moldName ?? it.partName ?? '',
      Number(it.qty) || 0, shots,
      it.colorName ?? '', it.pigmentCode ?? '', it.materialName ?? '',
      +Number(it.netGramsPerShot ?? 0).toFixed(2),
      { f: `E${r}*I${r}/1000` },
      +Number(it.unitPrice ?? 0).toFixed(4),
      { f: `E${r}*K${r}` },
      mpo.deliveryDate ?? '', '',
    ])
  }
  const dataEnd = rows.length - 1
  rows.push(['', '', '', '', '', '', '', '合计', '', { f: `SUM(J${dataStart + 1}:J${dataEnd + 1})` }, '', { f: `SUM(L${dataStart + 1}:L${dataEnd + 1})` }, '', ''])
  const sumRow = rows.length - 1
  rows.push(PAD(NCOL))
  const matNames = [...new Set((mpo.items ?? []).map(it => it.materialName).filter(Boolean))] as string[]
  const dataRangeStart = dataStart + 1
  const dataRangeEnd = dataEnd + 1
  const matRowsStart = rows.length
  const SEG = 5
  const matRow: any[] = Array(NCOL).fill('')
  matNames.forEach((mn, idx) => {
    const base = idx * SEG
    if (base + 4 >= NCOL) return
    const sumExpr = `SUMIFS(J${dataRangeStart}:J${dataRangeEnd},H${dataRangeStart}:H${dataRangeEnd},"${mn.replace(/"/g, '""')}")`
    matRow[base] = mn; matRow[base + 1] = '总净重：'; matRow[base + 2] = { f: `ROUND(${sumExpr},2)&" KG"` }; matRow[base + 3] = '发料包数：'; matRow[base + 4] = { f: `ROUND(${sumExpr}/25,2)&" 包"` }
  })
  rows.push(matRow)
  const matSegs = matNames.length
  const specialRow = rows.length
  rows.push(['特别注明：', ...PAD(NCOL - 1)])
  rows.push(['备注：', ...PAD(NCOL - 1)])
  rows.push(['操作员：', '', '收货人：', '', '下单人：', '', '接单人：', '', ...PAD(NCOL - 8)])

  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 12 }, { wch: 16 }, { wch: 22 }, { wch: 16 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 18 }, { wch: 11 }, { wch: 11 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 18 }]
  ws['!rows'] = [{ hpt: 32 }, { hpt: 28 }, { hpt: 24 }, { hpt: 24 }, { hpt: 24 }, { hpt: 10 }, { hpt: 34 }]
  ws['!merges'] = []
  const mg = (sR: number, sC: number, eR: number, eC: number) => ws['!merges']!.push({ s: { r: sR, c: sC }, e: { r: eR, c: eC } })
  mg(0, 0, 0, NCOL - 1); mg(1, 0, 1, NCOL - 1)
  mg(2, 1, 2, NCOL - 3); mg(3, 1, 3, NCOL - 1)
  mg(4, 5, 4, 7); mg(4, 9, 4, 11)
  mg(specialRow, 0, specialRow, NCOL - 1); mg(specialRow + 1, 0, specialRow + 1, NCOL - 1)

  const center = { horizontal: 'center', vertical: 'center', wrapText: true }
  const left = { horizontal: 'left', vertical: 'center', wrapText: true }
  const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }
  const setStyle = (r: number, c: number, st: any) => { const a = XLSX.utils.encode_cell({ r, c }); if (!(ws as any)[a]) (ws as any)[a] = { t: 's', v: '' }; (ws as any)[a].s = st }
  setStyle(0, 0, { font: { bold: true, sz: 22 }, alignment: center })
  setStyle(1, 0, { font: { bold: true, sz: 18 }, alignment: center })
  for (const r of [2, 3, 4]) for (let c = 0; c < NCOL; c++) setStyle(r, c, { font: { sz: 11 }, alignment: left })
  setStyle(2, NCOL - 2, { font: { sz: 11 }, alignment: { horizontal: 'right', vertical: 'center' } })
  setStyle(2, NCOL - 1, { font: { sz: 12, bold: true }, alignment: left })
  setStyle(4, NCOL - 2, { font: { sz: 11 }, alignment: { horizontal: 'right', vertical: 'center' } })
  setStyle(4, NCOL - 1, { font: { sz: 12, bold: true }, alignment: left })
  for (let c = 0; c < NCOL; c++) setStyle(hdrRow, c, { font: { bold: true, sz: 11 }, alignment: center, border, fill: { patternType: 'solid', fgColor: { rgb: 'E8F0F8' } } })
  for (let r = dataStart; r <= dataEnd; r++) {
    for (let c = 0; c < NCOL; c++) setStyle(r, c, { font: { sz: 11 }, alignment: center, border })
    setStyle(r, 9, { font: { sz: 11 }, alignment: { horizontal: 'right', vertical: 'center' }, border, numFmt: '#,##0.00' })
    setStyle(r, 10, { font: { sz: 11 }, alignment: { horizontal: 'right', vertical: 'center' }, border, numFmt: '0.0000' })
    setStyle(r, 11, { font: { sz: 11 }, alignment: { horizontal: 'right', vertical: 'center' }, border, numFmt: '#,##0.00' })
  }
  for (let c = 0; c < NCOL; c++) setStyle(sumRow, c, { font: { sz: 11, bold: c === 7 || c === 9 || c === 11 }, alignment: center, border })
  setStyle(sumRow, 9, { font: { sz: 12, bold: true }, alignment: { horizontal: 'right', vertical: 'center' }, border, numFmt: '#,##0.00' })
  setStyle(sumRow, 11, { font: { sz: 12, bold: true, color: { rgb: 'C0392B' } }, alignment: { horizontal: 'right', vertical: 'center' }, border, numFmt: '#,##0.00' })
  for (let idx = 0; idx < matSegs; idx++) {
    const base = idx * 5
    if (base + 4 >= NCOL) break
    setStyle(matRowsStart, base, { font: { sz: 12, bold: true }, alignment: { horizontal: 'left', vertical: 'center', indent: 1 } })
    setStyle(matRowsStart, base + 1, { font: { sz: 11, bold: true }, alignment: { horizontal: 'right', vertical: 'center' } })
    setStyle(matRowsStart, base + 2, { font: { sz: 11, bold: true }, alignment: { horizontal: 'left', vertical: 'center', indent: 1 } })
    setStyle(matRowsStart, base + 3, { font: { sz: 11, bold: true }, alignment: { horizontal: 'right', vertical: 'center' } })
    setStyle(matRowsStart, base + 4, { font: { sz: 11, bold: true }, alignment: { horizontal: 'left', vertical: 'center', indent: 1 } })
  }
  setStyle(specialRow, 0, { font: { sz: 11 }, alignment: left })
  setStyle(specialRow + 1, 0, { font: { sz: 11 }, alignment: left })
  for (let c = 0; c < NCOL; c++) setStyle(specialRow + 2, c, { font: { sz: 11, bold: c === 0 || c === 2 || c === 4 || c === 6 }, alignment: { horizontal: 'left', vertical: 'center', indent: 1 } })

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '啤机部生产啤货表')
  XLSX.writeFile(wb, `${mpo.no ?? '塑胶单'}_啤货生产表.xlsx`)
}

export async function exportMpo(mpo: MpoExportData) {
  if (mpo.category === '搪胶') return exportTangjiao(mpo)
  return exportSujiao(mpo)
}
