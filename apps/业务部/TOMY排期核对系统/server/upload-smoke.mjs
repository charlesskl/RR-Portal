// Synthetic upload/download verification; no real orders or source documents.
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'

function pdf(number, factory) {
  const lines = [`Purchase Order No: ${number}`, 'Customer PO No: SMOKE', 'Handle By: Smoke',
    'Customer Name: TOMY', 'Ship To Customer Name: TOMY', 'Port of Discharge / Destination Country: USA',
    '47280A', '00-RR', '20 Oct 2026', '100', 'EA', factory, '10 EA / MASTER CARTON']
  const stream = 'BT /F1 10 Tf 14 TL 30 760 Td\n' + lines.map((s, i) => `${i ? 'T* ' : ''}(${s}) Tj`).join('\n') + '\nET'
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`]
  let document = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((obj, i) => { offsets.push(Buffer.byteLength(document)); document += `${i + 1} 0 obj\n${obj}\nendobj\n` })
  const xref = Buffer.byteLength(document)
  document += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(o => String(o).padStart(10, '0') + ' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(document)
}

function addSheet(book, name, number) {
  const sheet = book.addWorksheet(name)
  sheet.addRow(['Tomy PO', 'Cust. PO NO.', '货号', '国家', '第三客户名称', '客跟单', '数量', '外箱', 'PO走货期', '箱唛资料'])
  sheet.addRow([number, 'SMOKE', '47280A', '美国', 'TOMY', 'Smoke', 100, 10, new Date('2026-10-20'), '标准唛'])
}

export async function smokeUpload(base = 'http://127.0.0.1:3006') {
  const dg = new ExcelJS.Workbook()
  addSheet(dg, '总排期', '10123456')
  dg.addWorksheet('JD').addRow(['辅助表'])
  const zip = await JSZip.loadAsync(await dg.xlsx.writeBuffer())
  const name = 'xl/worksheets/sheet2.xml'
  const xml = await zip.file(name).async('string')
  const blocks = []
  for (let start = 2; start <= 1048576; start += 4096) {
    let block = ''
    for (let row = start; row < Math.min(start + 4096, 1048577); row++) block += `<row r="${row}" ht="14.25"/>`
    blocks.push(block)
  }
  zip.file(name, xml.replace('</sheetData>', blocks.join('') + '</sheetData>'))
  const dgBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  const id = new ExcelJS.Workbook()
  addSheet(id, 'KIK总排期', '10123457')
  addSheet(id, 'RRM总排期', '10123458')
  const idBuffer = await id.xlsx.writeBuffer()
  for (let round = 1; round <= 2; round++) {
    const form = new FormData()
    const numbers = ['10123456', '10123457', '10123458']
    numbers.forEach((number, i) => form.append('pos', new Blob([pdf(number, `RR0${i + 1}`)]), `SMOKE_${number}.pdf`))
    form.append('scheduleDg', new Blob([dgBuffer]), 'SMOKE_东莞.xlsx')
    form.append('scheduleId', new Blob([idBuffer]), 'SMOKE_印尼.xlsx')
    const response = await fetch(`${base}/api/process`, { method: 'POST', body: form, signal: AbortSignal.timeout(120000) })
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.equal(result.files.length, 3)
    assert.ok(result.files.every(f => f.status === 'done'), JSON.stringify(result))
    assert.equal(result.scheduleDg.status, 'done')
    assert.equal(result.scheduleId.status, 'done')
    for (const key of ['reconciliationDg', 'reconciliationId', 'reconciliationRrm']) {
      assert.equal(result[key].matchedCount, 1, JSON.stringify(result))
      assert.deepEqual(result[key].errors, [])
    }
    assert.equal(result.outputReady, true)
    const download = await fetch(`${base}/api/download/${result.sessionId}`, { signal: AbortSignal.timeout(30000) })
    assert.equal(download.status, 200)
    const output = await JSZip.loadAsync(await download.arrayBuffer())
    for (const folder of ['DG', 'ID', 'RRM']) {
      const file = Object.keys(output.files).find(n => n.startsWith(folder + '/') && n.endsWith('.xlsx'))
      assert.ok(file)
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(await output.file(file).async('nodebuffer'))
      const sheet = workbook.getWorksheet(folder === 'DG' ? '总排期' : folder === 'ID' ? 'KIK总排期' : 'RRM总排期')
      assert.equal(sheet.getRow(2).getCell(sheet.columnCount).value, '已核对')
      assert.equal(workbook.getWorksheet('JD')?.rowCount ?? 0, folder === 'DG' ? 1 : 0)
    }
    console.log(`UPLOAD_SMOKE_OK round=${round} PDFs=3 factories=3 millionEmptyRows=1048575 ZIP=downloaded`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await smokeUpload(process.env.TOMY_SMOKE_BASE)
}
