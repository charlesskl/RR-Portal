import { readFileSync } from 'node:fs'
import ts from 'typescript'
import dayjs from 'dayjs'
import * as XLSX from 'xlsx'
import { describe, expect, it, vi } from 'vitest'
import { parseScheduleWorkbook } from '../utils/scheduleImport'

const source = readFileSync(new URL('./SchedulesPage.tsx', import.meta.url), 'utf8')
const tree = ts.createSourceFile('SchedulesPage.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const names = ['resetUploadContext', 'openUpload', 'closeUpload', 'changeUploadCustomer', 'changeUploadWeekLabel', 'parseFile', 'upload']
const functions: ts.FunctionDeclaration[] = []
let customerChange: ts.Expression | undefined, cancel: ts.Expression | undefined
function collect(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) functions.push(node)
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
    const attributes = node.attributes.properties.filter(ts.isJsxAttribute)
    const text = (name: string) => attributes.find(a => a.name.getText(tree) === name)?.initializer?.getText(tree) || ''
    const expression = (name: string) => {
      const value = attributes.find(a => a.name.getText(tree) === name)?.initializer
      return value && ts.isJsxExpression(value) ? value.expression : undefined
    }
    if (text('placeholder').includes('从文件识别客户')) customerChange = expression('onChange')
    if (text('title').includes('上传新周次排期')) cancel = expression('onCancel')
  }
  ts.forEachChild(node, collect)
}
collect(tree)
if (!customerChange || !cancel) throw new Error('Actual upload/customer controls must be present')
const code = ts.transpileModule(functions.map(node => node.getText(tree)).join('\n')
  .replace("const XLSX = await import('xlsx')", 'const XLSX = importedXLSX')
  + `\nreturn { ${functions.map(node => node.name!.text).join(', ')}, changeCustomer: ${customerChange.getText(tree)}, cancel: ${cancel.getText(tree)} };`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText

function bytes(customer = 'Spin Master', code = 'SYNTHETIC/200/300') {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['客名', '货号', '数量', '订单PO.NO'], [customer, code, 10, 'SYNTHETIC-PO'],
  ]), '接单总排期')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}
function delayedFile() {
  let resolve!: (value: ArrayBuffer) => void, reject!: (error: Error) => void
  const promise = new Promise<ArrayBuffer>((yes, no) => { resolve = yes; reject = no })
  return { file: { arrayBuffer: () => promise } as File, resolve, reject }
}
function fixture() {
  const state = { rows: [] as unknown[], customer: '', week: 'W1', open: true, session: 1, parsing: false, uploading: false }
  const uploadDraftRef = { current: { session: 1, request: 0, open: true, phase: 'idle', rows: state.rows, customer: '', weekLabel: 'W1' } }
  const message = { error: vi.fn(), warning: vi.fn(), success: vi.fn() }
  const api = { post: vi.fn(async () => ({ data: {} })) }
  const load = vi.fn()
  const render = () => {
    const bindings = {
      uploadDraftRef, uploadSessionId: state.session, uploadCustomer: state.customer, uploadRows: state.rows,
      weekLabel: state.week, customerFilter: '', importedXLSX: XLSX, parseScheduleWorkbook, dayjs, message, api, load,
      suggestWeekLabel: () => 'SUGGESTED',
      setUploadRows: (rows: unknown[]) => { state.rows = rows }, setUploadCustomer: (customer: string) => { state.customer = customer },
      setWeekLabel: (week: string) => { state.week = week }, setShowUpload: (open: boolean) => { state.open = open },
      setUploadSessionId: (session: number) => { state.session = session },
      setParsing: (value: boolean) => { state.parsing = value }, setUploading: (value: boolean) => { state.uploading = value },
    }
    return new Function(...Object.keys(bindings), code)(...Object.values(bindings))
  }
  return { state, uploadDraftRef, message, api, load, render }
}

describe('schedule upload request and customer context', () => {
  it('does not let a pending file restore the previous customer after the real customer-change event', async () => {
    const f = fixture(), old = delayedFile()
    const pending = f.render().parseFile(old.file)
    f.render().changeCustomer('TOMY')
    old.resolve(bytes())
    await pending
    expect(f.state.customer).toBe('TOMY')
    expect(f.state.rows).toEqual([])
    expect(f.state.parsing).toBe(false)
    expect(f.message.success).not.toHaveBeenCalled()
    expect(f.message.error).not.toHaveBeenCalled()
    expect(f.api.post).not.toHaveBeenCalled()
  })
  it.each(['old-first', 'new-first'])('only the latest selected file owns rows and loading (%s)', async order => {
    const f = fixture(), older = delayedFile(), newer = delayedFile()
    const first = f.render().parseFile(older.file)
    const second = f.render().parseFile(newer.file)
    if (order === 'old-first') {
      older.resolve(bytes())
      await first
      expect(f.state.parsing).toBe(true)
      expect(f.state.rows).toEqual([])
      expect(f.message.success).not.toHaveBeenCalled()
      newer.resolve(bytes('TOMY', 'SYNTHETIC-B'))
      await second
    } else {
      newer.resolve(bytes('TOMY', 'SYNTHETIC-B'))
      await second
      older.resolve(bytes())
      await first
    }
    expect(f.state.parsing).toBe(false)
    expect(f.state.customer).toBe('TOMY')
    expect(f.state.rows).toMatchObject([{ code: 'SYNTHETIC-B' }])
    expect(f.message.success).toHaveBeenCalledTimes(1)
  })

  it('ignores an older failure while the replacement file is still loading', async () => {
    const f = fixture(), older = delayedFile(), newer = delayedFile()
    const first = f.render().parseFile(older.file)
    const second = f.render().parseFile(newer.file)
    older.reject(new Error('obsolete read failure'))
    await first
    expect(f.state.parsing).toBe(true)
    expect(f.message.error).not.toHaveBeenCalled()
    newer.resolve(bytes())
    await second
    expect(f.state.parsing).toBe(false)
    expect(f.state.rows).toHaveLength(1)
  })

  it.each(['success', 'failure'])('closing and reopening rejects the old file %s and old cancel callback', async result => {
    const f = fixture(), old = delayedFile()
    const beforeClose = f.render()
    const pending = beforeClose.parseFile(old.file)
    beforeClose.cancel()
    expect(f.state.open).toBe(false)
    f.render().openUpload()
    expect(f.state.open).toBe(true)
    beforeClose.cancel()
    expect(f.state.open).toBe(true)
    if (result === 'success') old.resolve(bytes())
    else old.reject(new Error('obsolete closed-session failure'))
    await pending
    expect(f.state.customer).toBe('')
    expect(f.state.rows).toEqual([])
    expect(f.state.parsing).toBe(false)
    expect(f.message.success).not.toHaveBeenCalled()
    expect(f.message.error).not.toHaveBeenCalled()
  })

  it('keeps a week label entered while a file was reading', async () => {
    const f = fixture(), file = delayedFile()
    const pending = f.render().parseFile(file.file)
    f.render().changeUploadWeekLabel('W99')
    file.resolve(bytes())
    await pending
    expect(f.state.week).toBe('W99')
    const expectedRows = f.state.rows
    await f.render().upload()
    expect(f.api.post).toHaveBeenCalledWith('/schedules', expect.objectContaining({
      customer: 'Spin Master', week_label: 'W99', raw_rows: expectedRows,
    }))
  })

  it('an old confirmation cannot submit replacement rows, changed customer or a reopened session', async () => {
    const f = fixture()
    await f.render().parseFile({ arrayBuffer: async () => bytes() } as File)
    const firstDraft = f.render()
    await f.render().parseFile({ arrayBuffer: async () => bytes('Spin Master', 'SYNTHETIC/400/500') } as File)
    await firstDraft.upload()
    expect(f.api.post).not.toHaveBeenCalled()
    const replacement = f.render()
    replacement.changeCustomer('TOMY')
    await replacement.upload()
    expect(f.api.post).not.toHaveBeenCalled()
    replacement.cancel()
    f.render().openUpload()
    await f.render().parseFile({ arrayBuffer: async () => bytes('TOMY', 'SYNTHETIC-C') } as File)
    await firstDraft.upload()
    expect(f.api.post).not.toHaveBeenCalled()
    await f.render().upload()
    expect(f.api.post).toHaveBeenCalledTimes(1)
    expect(f.api.post).toHaveBeenCalledWith('/schedules', expect.objectContaining({
      customer: 'TOMY', raw_rows: [expect.objectContaining({ code: 'SYNTHETIC-C' })],
    }))
  })

  it('submits once and freezes the confirmed context until the response arrives', async () => {
    const f = fixture()
    await f.render().parseFile({ arrayBuffer: async () => bytes() } as File)
    let finish!: (value: { data: {} }) => void
    f.api.post.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const confirmed = f.render()
    const pending = confirmed.upload()
    expect(f.state.uploading).toBe(true)
    await f.render().upload()
    f.render().cancel()
    f.render().changeCustomer('TOMY')
    f.render().changeUploadWeekLabel('W99')
    await f.render().parseFile({ arrayBuffer: async () => bytes('TOMY') } as File)
    expect(f.state.open).toBe(true)
    expect(f.state.customer).toBe('Spin Master')
    expect(f.state.week).toBe('W1')
    expect(f.api.post).toHaveBeenCalledTimes(1)
    finish({ data: {} })
    await pending
    expect(f.state.open).toBe(false)
    expect(f.state.uploading).toBe(false)
    expect(f.load).toHaveBeenCalledTimes(1)
  })

  it('retains the parsed draft after upload rejection and allows a deliberate retry', async () => {
    const f = fixture()
    await f.render().parseFile({ arrayBuffer: async () => bytes() } as File)
    const rows = f.state.rows
    f.api.post.mockRejectedValueOnce(new Error('synthetic upload rejected'))
    await f.render().upload()
    expect(f.state.open).toBe(true)
    expect(f.state.uploading).toBe(false)
    expect(f.state.rows).toBe(rows)
    expect(f.message.error).toHaveBeenCalledWith(expect.stringContaining('synthetic upload rejected'))
    await f.render().upload()
    expect(f.api.post).toHaveBeenCalledTimes(2)
    expect(f.state.open).toBe(false)
  })

})
