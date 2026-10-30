import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'

const text = readFileSync(new URL('../components/ShipmentSheetTable.tsx', import.meta.url), 'utf8')
const tree = ts.createSourceFile('table.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const handlers: Record<string, string> = {}
let finish = ''
function collect(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'finishSelection') finish = (node.initializer as ts.CallExpression).arguments[0].getText(tree)
  if (ts.isJsxAttribute(node) && ['onPointerDownCapture', 'onPointerMoveCapture', 'onClickCapture', 'onFocusCapture'].includes(node.name.getText(tree)))
    handlers[node.name.getText(tree)] = ((node.initializer as ts.JsxExpression).expression!).getText(tree)
  ts.forEachChild(node, collect)
}
collect(tree)
const compile = (source: string) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
function cell(row: number, col: number, kind = 'plain') {
  return { p: { row, col }, kind, matches: () => kind === 'input',
    closest: (selector: string) => {
      if (kind === 'button' && selector.includes('[role="button"]')) return {}
      if (kind === 'input' && selector.includes('input,textarea')) return {}
      return null
    } }
}
function setup() {
  const root = { focus: vi.fn(), contains: () => true }
  const state = {
    anchor: null as { row: number; col: number } | null, end: null as { row: number; col: number } | null,
    editingCell: null as { row: number; col: number } | null, batchPending: { current: false },
    pendingFocus: { current: null as unknown }, selectionGesture: { current: null as any }, suppressClick: { current: false },
    point: (element: any) => element?.p || null, hasCell: () => true, canEdit: () => true,
    root: { current: root }, document: { activeElement: null },
    setAnchor: (p: any) => { state.anchor = p }, setEnd: (p: any) => { state.end = p },
    setEditingCell: (p: any) => { state.editingCell = p },
    focus: vi.fn((p: any, edit = true) => { state.anchor = p; state.end = p; state.editingCell = edit ? p : null }),
    event: {} as any,
  }
  const context = createContext(state)
  runInContext(compile(`const finishSelection = ${finish}`), context)
  for (const [name, code] of Object.entries(handlers)) runInContext(compile(`const ${name} = ${code}`), context)
  const dispatch = (name: string, target: any, extra: Record<string, any> = {}) => {
    state.event = { target, button: 0, buttons: 1, pointerType: 'mouse', shiftKey: false,
      preventDefault: vi.fn(), stopPropagation: vi.fn(), ...extra }
    runInContext(`${name}(event)`, context)
    return state.event
  }
  return { state, dispatch, release: () => runInContext('finishSelection()', context) }
}

it('按住鼠标从首格拖到末格，释放后的 click 不会把矩形选区收回一格', () => {
  const { state, dispatch, release } = setup()
  dispatch('onPointerDownCapture', cell(0, 0))
  dispatch('onPointerMoveCapture', cell(2, 3))
  expect(state.anchor).toEqual({ row: 0, col: 0 }); expect(state.end).toEqual({ row: 2, col: 3 })
  release()
  const click = dispatch('onClickCapture', cell(2, 3))
  expect(click.preventDefault).toHaveBeenCalledOnce()
  expect(state.anchor).toEqual({ row: 0, col: 0 }); expect(state.end).toEqual({ row: 2, col: 3 })
  expect(state.editingCell).toBeNull(); expect(state.focus).not.toHaveBeenCalled()
})
it('Shift 指针按下时即建立选区；焦点事件与释放 Shift 后的 click 均不收缩范围', () => {
  const { state, dispatch, release } = setup()
  state.anchor = state.end = { row: 0, col: 0 }
  state.pendingFocus.current = { point: state.anchor, edit: false }
  dispatch('onPointerDownCapture', cell(4, 2, 'input'), { shiftKey: true })
  expect(state.end).toEqual({ row: 4, col: 2 }); expect(state.pendingFocus.current).toBeNull()
  dispatch('onFocusCapture', cell(4, 2, 'input'))
  expect(state.anchor).toEqual({ row: 0, col: 0 })
  release()
  dispatch('onClickCapture', cell(4, 2, 'input'), { shiftKey: false })
  expect(state.anchor).toEqual({ row: 0, col: 0 }); expect(state.end).toEqual({ row: 4, col: 2 })
})
it('反向拖选、快速移动和窗口级松开都保留最初锚点', () => {
  const { state, dispatch, release } = setup()
  dispatch('onPointerDownCapture', cell(5, 4))
  dispatch('onPointerMoveCapture', cell(3, 2))
  dispatch('onPointerMoveCapture', cell(1, 0))
  release()
  expect(state.anchor).toEqual({ row: 5, col: 4 }); expect(state.end).toEqual({ row: 1, col: 0 })
  expect(state.selectionGesture.current).toBeNull()
})
it('普通点击仍可跳格，已选输入框点击后明确恢复编辑焦点', () => {
  const { state, dispatch, release } = setup()
  dispatch('onPointerDownCapture', cell(1, 1)); release()
  dispatch('onClickCapture', cell(1, 1))
  expect(state.focus).toHaveBeenLastCalledWith({ row: 1, col: 1 }, false)
  dispatch('onPointerDownCapture', cell(1, 1, 'input')); release()
  dispatch('onClickCapture', cell(1, 1, 'input'))
  expect(state.focus).toHaveBeenLastCalledWith({ row: 1, col: 1 })
  expect(state.editingCell).toEqual({ row: 1, col: 1 })
})
it('编辑模式保留文本拖动选字；小蓝点按钮、右键和触摸不启动网格拖选', () => {
  const { state, dispatch } = setup()
  state.editingCell = { row: 1, col: 1 }
  const native = dispatch('onPointerDownCapture', cell(1, 1, 'input'))
  expect(native.preventDefault).not.toHaveBeenCalled()
  expect(state.selectionGesture.current).toBeNull()
  for (const [target, extra] of [[cell(1, 2, 'button'), {}], [cell(1, 2), { button: 2 }], [cell(1, 2), { pointerType: 'touch' }]] as const) {
    dispatch('onPointerDownCapture', target, extra)
    expect(state.selectionGesture.current).toBeNull()
  }
})
it('没有按住鼠标时划过单元格不改变选区，批量校验期间也不能拖动改区', () => {
  const { state, dispatch } = setup()
  dispatch('onPointerDownCapture', cell(0, 0))
  dispatch('onPointerMoveCapture', cell(3, 3), { buttons: 0 })
  expect(state.anchor).toBeNull()
  state.batchPending.current = true
  const event = dispatch('onPointerDownCapture', cell(3, 3))
  expect(event.preventDefault).toHaveBeenCalledOnce()
})
