import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'

function load(path: string) {
  return readFileSync(new URL('../' + path, import.meta.url), 'utf8')
}
function findCode(path: string, match: (node: ts.Node, tree: ts.SourceFile) => boolean) {
  const tree = ts.createSourceFile(path, load(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let result = ''
  function visit(node: ts.Node) {
    if (match(node, tree)) result = ts.isJsxAttribute(node)
      ? ((node.initializer as ts.JsxExpression).expression!).getText(tree)
      : node.getText(tree)
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return result
}
const table = 'components/ShipmentSheetTable.tsx'
const page = 'pages/ShipmentsPage.tsx'
const copy = findCode(table, (node, tree) => ts.isJsxAttribute(node) && node.name.getText(tree) === 'onCopyCapture')
const scroll = findCode(table, (node, tree) => ts.isJsxAttribute(node) && node.name.getText(tree) === 'onScrollCapture')
const close = findCode(page, node => ts.isFunctionDeclaration(node) && node.name?.text === 'requestCloseEditor')
const discard = findCode(page, node => ts.isFunctionDeclaration(node) && node.name?.text === 'requestDiscardChanges')
const compile = (source: string) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText

function copyRange(inputs: Array<{ value: string; closest: (selector: string) => unknown }>, values: string[]) {
  const setData = vi.fn()
  const context = createContext({
    anchor: { row: 0, col: 0 }, end: { row: values.length - 1, col: 0 }, fields: ['customs_company'],
    // The input is in the mounted first row; the remaining rows are virtual.
    cellAt: (p: {row: number}) => p.row === 0 ? { querySelectorAll: () => inputs, querySelector: () => inputs[0] } : null,
    valueAt: (row: number) => values[row], displayAt: () => '', cellText: () => '',
    quote: (value: string) => /[\t\n"]/g.test(value) ? `"${value.replaceAll('"', '""')}"` : value,
    event: { target: { closest: () => null }, preventDefault: vi.fn(), clipboardData: { setData } },
  })
  runInContext(compile(`(${copy})(event)`), context)
  return setData.mock.calls[0][1]
}
it.each(['', 'only a search query'])('copy uses selected model values rather than a searchable Select input (%s)', searchValue => {
  const searchInput = { value: searchValue, closest: () => ({ className: 'ant-select' }) }
  expect(copyRange([searchInput], ['Company A', 'Company B'])).toBe('Company A\nCompany B')
})
it('copy uses the selected date model rather than uncommitted date-picker search text', () => {
  const pickerInput = { value: 'invalid draft', closest: () => ({ className: 'ant-picker' }) }
  expect(copyRange([pickerInput], ['2026-10-30', '2026-10-31'])).toBe('2026-10-30\n2026-10-31')
})
it.each(['', '00123', 'line one\nline two'])('copy still includes the latest local text draft (%j)', draft => {
  expect(copyRange([{ value: draft, closest: () => null }], ['OLD', 'OFFSCREEN']))
    .toBe((draft.includes('\n') ? `"${draft}"` : draft) + '\nOFFSCREEN')
})

function scrollDraft({ cellTop = 0, cellBottom = 20, virtual = true, picker = false, belongs = true } = {}) {
  const blur = vi.fn(), committed = vi.fn()
  const cell = { getBoundingClientRect: () => ({ top: cellTop, bottom: cellBottom }) }
  const active = {
    matches: () => true,
    closest: (selector: string) => selector.includes('data-sheet-col') ? cell : picker ? {} : null,
    // Blurring commits before the virtual list's target/bubble listener removes
    // its row; the test invokes the real capture handler first, as DOM does.
    blur: () => { blur(); committed('UNSAVED-DRAFT') },
  }
  const holder = { matches: () => virtual, getBoundingClientRect: () => ({ top: 100, bottom: 500 }) }
  const context = createContext({ root: { current: { contains: () => belongs } }, document: { activeElement: active }, event: { target: holder } })
  runInContext(compile(`(${scroll})(event)`), context)
  return { blur, committed }
}
it.each([{ cellTop: 0, cellBottom: 100 }, { cellTop: 500, cellBottom: 520 }])('non-wheel scrolling flushes an active cell leaving the viewport: %j', geometry => {
  const result = scrollDraft(geometry)
  expect(result.blur).toHaveBeenCalledOnce()
  expect(result.committed).toHaveBeenCalledExactlyOnceWith('UNSAVED-DRAFT')
})
it.each([
  { cellTop: 120, cellBottom: 150 },
  { virtual: false },
  { picker: true },
  { belongs: false },
])('scroll keeps visible/newly focused editors and other controls intact: %j', config => {
  const result = scrollDraft(config)
  expect(result.blur).not.toHaveBeenCalled()
  expect(result.committed).not.toHaveBeenCalled()
})

it.each(['close', 'discard'])('pending quantity validation blocks %s without opening a destructive confirmation', action => {
  const context = createContext({ sheetWritePending: { current: true }, editorDirty: true, creating: false, editing: { id: 11 },
    message: { info: vi.fn() }, closeEditor: vi.fn(), Modal: { confirm: vi.fn() } })
  runInContext(compile(close + '\n' + discard), context)
  runInContext(action === 'close' ? 'requestCloseEditor()' : 'requestDiscardChanges()', context)
  expect(context.closeEditor).not.toHaveBeenCalled()
  expect(context.Modal.confirm).not.toHaveBeenCalled()
  expect(context.message.info).toHaveBeenCalledWith(expect.stringContaining('正在校验'))
  context.sheetWritePending.current = false
  runInContext(action === 'close' ? 'requestCloseEditor()' : 'requestDiscardChanges()', context)
  expect(context.Modal.confirm).toHaveBeenCalledOnce()
})

