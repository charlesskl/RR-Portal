'use strict'
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const path = require('node:path')
const http = require('node:http')
const net = require('node:net')
const { spawn } = require('node:child_process')
const { createRequire } = require('node:module')
assert.equal(process.env.PR1055_ISOLATED_CHECK, '1', 'isolated candidate execution required')
const root = path.resolve(process.env.TOMY_CHECK_APP_ROOT || '/app')
const load = createRequire(path.join(root, 'package.json'))
const ExcelJS = load('exceljs')
const JSZip = load('jszip')
const port = Number(process.env.PR1055_CHECK_PORT || 3016)
assert.ok(Number.isInteger(port) && port > 1024 && port < 65536)
const base = `http://127.0.0.1:${port}`
const hash = value => crypto.createHash('sha256').update(value).digest('hex')
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const headers = ['Ship To Cust Name', 'Customer PO #', 'Ship To Country', 'Part Number', 'PO Num',
  'Order Qty', 'Unit Cost', 'Purchase Amount', 'PO Due Date', 'QC Result', 'QC Inspection Date', 'Purchase Point Name']
const factoryNames = ['DONGGUAN HANSON PLASTIC PRODUCT LTD', 'PT ROYAL REGENT INDONESIA', 'PT ROYAL REGENT MANUFACTURING']
const shipDate = () => new Date(2026, 9, 20)
const qcDate = () => new Date(2026, 9, 10)
const records = [0, 1, 2].map(i => ({ po: `1055111${i + 1}`, part: `SYN55${i + 1}A`, qty: 100 * (i + 1), factory: i, customer: 'TOMY' }))

function addFactory(book, name, rows) {
  const sheet = book.addWorksheet(name)
  sheet.addRow(['Tomy PO', 'Cust. PO NO.', '货号', '国家', '客名', '第三客户名称', '客跟单',
    '数量', '外箱', '总箱数', 'PO走货期', '单价USD', '金额USD', '验货期', '实际验货期', '箱唛资料'])
  for (const item of rows) {
    const row = sheet.addRow([item.po, `C-${item.po}`, item.part, '美国', item.customer, item.customer, 'Smoke',
      item.qty, 10, item.qty / 10, shipDate(), item.price || 1.25, item.qty * (item.price || 1.25), qcDate(), qcDate(), '标准唛'])
    row.getCell(15).font = { color: { argb: 'FF0000FF' } }
  }
}
async function factoryBooks(rows = records) {
  const dg = new ExcelJS.Workbook(), id = new ExcelJS.Workbook()
  addFactory(dg, '总排期', rows.filter(r => r.factory === 0))
  addFactory(id, 'KIK总排期', rows.filter(r => r.factory === 1))
  addFactory(id, 'RRM总排期', rows.filter(r => r.factory === 2))
  return { dg: Buffer.from(await dg.xlsx.writeBuffer()), id: Buffer.from(await id.xlsx.writeBuffer()) }
}
async function customerBook(rows = records, mismatch = false) {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Open Order')
  book.creator = 'PR1055 synthetic isolation checks'
  sheet.addRow([...headers, '原备注', '原公式', '原链接'])
  for (const [i, item] of rows.entries()) {
    const bad = mismatch && i === 0
    const row = sheet.addRow([item.customer, `C-${item.po}`, 'USA', item.part, item.po, item.qty,
      bad ? 2 : 1.25, item.qty * (bad ? 2 : 1.25), shipDate(), 'Pass', qcDate(), factoryNames[item.factory],
      { richText: [{ text: 'Original $& ' }, { text: '<remark>', font: { bold: true } }] },
      { formula: 'SUM(20,22)', result: 42 }, { text: 'Reference', hyperlink: 'https://example.invalid/pr1055-fixture' }])
    row.getCell(13).note = 'Original owner note: retain this text'
    row.getCell(7).numFmt = '0.000'
  }
  const aux = book.addWorksheet('原始辅助', { state: 'hidden' })
  aux.getCell('A1').value = 'Preserved secondary sheet'
  aux.mergeCells('B4:C4'); aux.getCell('B4').value = 'Preserved merge'
  const zip = await JSZip.loadAsync(await book.xlsx.writeBuffer())
  zip.file('custom/pr1055-sentinel.bin', Buffer.from([0, 255, 3, 8, 18, 55]))
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}
function pdf(record, empty = false) {
  const lines = empty ? ['Unrelated synthetic document'] : [
    `Purchase Order No: ${record.po}`, `Customer PO No: C-${record.po}`, 'Handle By: Smoke',
    'Customer Name: TOMY', 'Ship To Customer Name: TOMY', 'Port of Discharge / Destination Country: USA',
    record.part, '00-RR', '20 Oct 2026', String(record.qty), 'EA', `RR0${record.factory + 1}`, '10 EA / MASTER CARTON']
  const stream = 'BT /F1 10 Tf 14 TL 30 760 Td\n' + lines.map((s, i) => `${i ? 'T* ' : ''}(${s}) Tj`).join('\n') + '\nET'
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`]
  let body = '%PDF-1.4\n'; const offsets = [0]
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(body)); body += `${i + 1} 0 obj\n${object}\nendobj\n` })
  const xref = Buffer.byteLength(body)
  body += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(o => String(o).padStart(10, '0') + ' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(body)
}
function form(books, customer, pos = []) {
  const data = new FormData()
  if (books.dg) data.append('scheduleDg', new Blob([books.dg]), 'SYN_DG.xlsx')
  if (books.id) data.append('scheduleId', new Blob([books.id]), 'SYN_ID.xlsx')
  if (customer) data.append('scheduleCustomer', new Blob([customer]), 'SYN_CUSTOMER.dat')
  for (const p of pos) data.append('pos', new Blob([p.buffer], { type: 'application/pdf' }), p.name)
  return data
}
async function processForm(data) {
  const response = await fetch(base + '/api/process', { method: 'POST', body: data, signal: AbortSignal.timeout(120000) })
  assert.equal(response.status, 200)
  return response.json()
}
async function download(token, mime) {
  assert.equal(typeof token, 'string')
  const response = await fetch(base + '/api/download/' + token, { signal: AbortSignal.timeout(30000) })
  assert.equal(response.status, 200)
  assert.ok(response.headers.get('content-type').startsWith(mime))
  assert.match(response.headers.get('content-disposition'), /attachment/)
  return Buffer.from(await response.arrayBuffer())
}

const names = ['healthAndPrefixedAssets', 'customerDatThreeFactories', 'originalWorkbookPartsRetained',
  'repeatedCustomerAndZipDownloads', 'ambiguousRowNotGreen', 'invalidCustomerNoOutput',
  'emptyPoNoOutput', 'legacyPdfThreeFactoriesAndOriginals', 'uploadLimitResponse']
const checks = {}; let attempted = 0, failed = 0, stage = 'setup', child, childOutput = ''
let books, original, result, direct, childSpawnError, ownedPgid
async function portFree() {
  await new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen({ host: '127.0.0.1', port, exclusive: true }, () => probe.close(error => error ? reject(error) : resolve()))
  })
}
function groupExists() {
  if (!ownedPgid) return false
  try { process.kill(-ownedPgid, 0); return true } catch (error) {
    if (error.code === 'ESRCH') return false
    throw error
  }
}
function signalGroup(signal) {
  try { process.kill(-ownedPgid, signal) } catch (error) { if (error.code !== 'ESRCH') throw error }
}
async function run(name, callback) { stage = name; attempted++; await callback(); checks[name] = true }
async function stop() {
  if (ownedPgid) {
    if (groupExists()) signalGroup('SIGTERM')
    for (let i = 0; i < 30 && groupExists(); i++) await wait(100)
    if (groupExists()) signalGroup('SIGKILL')
    for (let i = 0; i < 30 && groupExists(); i++) await wait(100)
    assert.equal(groupExists(), false, 'owned isolated process group still exists')
    await portFree()
  }
}
;(async () => {
  try {
    await run(names[0], async () => {
      await portFree()
      child = spawn(process.execPath, ['--import', load.resolve('tsx'), 'server/index.ts'], {
        cwd: root, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: { PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin', NODE_ENV: 'production', PORT: String(port),
          NODE_OPTIONS: '--max-old-space-size=384', NO_COLOR: '1' },
      })
      ownedPgid = child.pid
      const capture = b => { if (childOutput.length < 524288) childOutput += b.toString() }
      child.stdout.on('data', capture); child.stderr.on('data', capture)
      child.on('error', error => { childSpawnError = error.name })
      let ready = false
      for (let i = 0; i < 100; i++) {
        assert.equal(child.exitCode, null, 'isolated server exited before health')
        assert.equal(childSpawnError, undefined, 'isolated server could not spawn')
        try { if ((await fetch(base + '/health', { signal: AbortSignal.timeout(1000) })).status === 200) { ready = true; break } } catch {}
        await wait(200)
      }
      assert.ok(ready, 'isolated health timeout')
      const index = await (await fetch(base + '/')).text()
      const assets = [...index.matchAll(/(?:src|href)="(\/tomy-paiqi\/assets\/[^"<>]+)"/g)].map(m => m[1])
      assert.ok(assets.length >= 2)
      for (const asset of assets) {
        const response = await fetch(base + asset.replace('/tomy-paiqi', ''))
        assert.equal(response.status, 200)
        assert.ok((await response.arrayBuffer()).byteLength > 0)
      }
    })
    await run(names[1], async () => {
      books = await factoryBooks(); original = await customerBook(records, true)
      result = await processForm(form(books, original))
      assert.equal(result.scheduleCustomer.status, 'done'); assert.equal(result.scheduleCustomer.rowCount, 3)
      assert.equal(result.reconciliationCustomer.matchedCount, 3)
      assert.equal(result.reconciliationCustomer.unmatchedCount, 0); assert.equal(result.reconciliationCustomer.ambiguousCount, 0)
      assert.equal(result.reconciliationCustomer.mismatchedFieldCount, 2)
      assert.deepEqual(result.reconciliationCustomer.errors, []); assert.equal(result.outputReady, true)
      direct = await download(result.customerSessionId, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    })
    await run(names[2], async () => {
      const before = await JSZip.loadAsync(original), after = await JSZip.loadAsync(direct)
      for (const name of Object.keys(before.files)) {
        if (before.files[name].dir || ['xl/worksheets/sheet1.xml', 'xl/styles.xml'].includes(name)) continue
        assert.ok(after.file(name), 'original package part missing')
        assert.equal(hash(await before.file(name).async('nodebuffer')), hash(await after.file(name).async('nodebuffer')), 'original package part changed')
      }
      const book = new ExcelJS.Workbook(); await book.xlsx.load(direct)
      const sheet = book.getWorksheet('Open Order')
      assert.equal(sheet.getCell('G2').value, 2); assert.equal(sheet.getCell('H2').value, 200)
      assert.equal(sheet.getCell('G2').fill.fgColor.argb, 'FFFFC7CE')
      const note = sheet.getCell('M2').note
      assert.equal(typeof note === 'string' ? note : note.texts.map(part => part.text).join(''), 'Original owner note: retain this text')
      assert.deepEqual(sheet.getCell('N2').value, { formula: 'SUM(20,22)', result: 42 })
      assert.equal(sheet.getCell('O2').hyperlink, 'https://example.invalid/pr1055-fixture')
      assert.equal(book.getWorksheet('原始辅助').getCell('B4').value, 'Preserved merge')
      const row = sheet.getRow(1).values
      assert.ok(row.includes('核对状态') && row.includes('核对说明'))
    })
    await run(names[3], async () => {
      assert.equal(hash(await download(result.customerSessionId, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')), hash(direct))
      const zipOne = await download(result.sessionId, 'application/zip')
      assert.equal(hash(await download(result.sessionId, 'application/zip')), hash(zipOne))
      const zip = await JSZip.loadAsync(zipOne)
      const annotated = Object.keys(zip.files).find(n => n.startsWith('客户排期/') && n.endsWith('.xlsx'))
      assert.ok(annotated); assert.equal(hash(await zip.file(annotated).async('nodebuffer')), hash(direct))
    })
    await run(names[4], async () => {
      const duplicate = [{ ...records[0] }, { ...records[0], price: 1.5 }]
      const source = await factoryBooks(duplicate), input = await customerBook([records[0]])
      const response = await processForm(form({ dg: source.dg }, input))
      assert.equal(response.reconciliationCustomer.ambiguousCount, 1)
      assert.equal(response.reconciliationCustomer.matchedCount, 0)
      const output = await download(response.customerSessionId, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      const book = new ExcelJS.Workbook(); await book.xlsx.load(output)
      assert.equal(book.getWorksheet('Open Order').getCell('A2').fill.fgColor.argb, 'FFFFEB9C')
    })
    await run(names[5], async () => {
      const response = await processForm(form({ dg: books.dg }, Buffer.from('not an XLSX file')))
      assert.equal(response.scheduleCustomer.status, 'error'); assert.equal(response.outputReady, false)
      assert.equal(response.sessionId, undefined); assert.equal(response.customerSessionId, undefined)
    })
    await run(names[6], async () => {
      const response = await processForm(form({ dg: books.dg }, null, [{ name: 'SYN_unrelated.pdf', buffer: pdf(records[0], true) }]))
      assert.equal(response.files[0].status, 'error'); assert.equal(response.outputReady, false)
      assert.equal(response.sessionId, undefined); assert.equal(response.customerSessionId, undefined)
    })
    await run(names[7], async () => {
      const pos = records.map(record => ({ name: `SYN_${record.po}.pdf`, buffer: pdf(record) }))
      const response = await processForm(form(books, null, pos))
      assert.ok(response.files.every(f => f.status === 'done'))
      for (const key of ['reconciliationDg', 'reconciliationId', 'reconciliationRrm']) {
        assert.equal(response[key].matchedCount, 1); assert.deepEqual(response[key].errors, [])
      }
      const bytes = await download(response.sessionId, 'application/zip'), zip = await JSZip.loadAsync(bytes)
      assert.equal(hash(await download(response.sessionId, 'application/zip')), hash(bytes))
      for (const [i, folder] of ['DG', 'ID', 'RRM'].entries()) {
        const annotated = Object.keys(zip.files).find(n => n.startsWith(folder + '/') && n.endsWith('.xlsx'))
        assert.ok(annotated)
        const source = Object.keys(zip.files).find(n => n.startsWith(folder + '/PO/') && n.endsWith('.pdf'))
        assert.ok(source); assert.equal(hash(await zip.file(source).async('nodebuffer')), hash(pos[i].buffer))
      }
    })
    await run(names[8], async () => {
      const response = await new Promise((resolve, reject) => {
        const request = http.request(base + '/api/process', { method: 'POST', headers: {
          'Content-Type': 'multipart/form-data; boundary=synthetic', 'Content-Length': 50 * 1024 * 1024 + 1,
        } }, r => { const parts = []; r.on('data', b => parts.push(b)); r.on('end', () => resolve({ status: r.statusCode, body: Buffer.concat(parts).toString() })) })
        request.setTimeout(10000, () => request.destroy(new Error('bounded test timeout')))
        request.on('error', reject); request.end('x')
      })
      assert.equal(response.status, 413); assert.equal(typeof JSON.parse(response.body).error, 'string')
    })
  } catch (error) {
    failed = 1; checks[stage] = false
    process.stderr.write(`Isolated native case failed: ${stage}; ${error.name}\n`)
    if (process.env.PR1055_NATIVE_DEBUG === '1') process.stderr.write(error.stack + '\n')
  } finally {
    let cleanupPassed = false
    try { await stop(); cleanupPassed = true } catch (error) {
      failed = 1
      process.stderr.write(`Isolated native cleanup failed: ${error.name}\n`)
      if (process.env.PR1055_NATIVE_DEBUG === '1') process.stderr.write(error.stack + '\n')
    }
    console.log(JSON.stringify({ success: failed === 0 && names.every(n => checks[n] === true), node: process.version,
      passed: Object.values(checks).filter(Boolean).length, failed, skipped: names.length - attempted,
      checks, cleanupPassed, childOutputSHA256: hash(childOutput) }))
    if (failed) process.exitCode = 1
  }
})()
