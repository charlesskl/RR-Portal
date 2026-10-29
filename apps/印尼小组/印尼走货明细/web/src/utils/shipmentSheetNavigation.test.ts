import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'
import { sheetArrowKeys, sheetArrowPoint, sheetArrowUsesEditor } from './shipmentSheetNavigation'

it.each([
  ['ArrowLeft', 1, 0], ['ArrowRight', 1, 2], ['ArrowUp', 0, 1], ['ArrowDown', 2, 1],
])('方向键沿同一行或列移动，允许停在只读单元格 %s', (key, row, col) => {
  expect(sheetArrowPoint({ row: 1, col: 1 }, key as string, 3, 3, () => true)).toEqual({ row, col })
})
it.each([
  ['ArrowLeft', 0, 0], ['ArrowUp', 0, 0], ['ArrowRight', 2, 2], ['ArrowDown', 2, 2],
])('边界停止，不换行、不跳出表格 %s', (key, row, col) => {
  expect(sheetArrowPoint({ row: row as number, col: col as number }, key as string, 3, 3, () => true)).toBeNull()
})
it('跳过合并或未渲染的格子，不改变另一条轴', () => {
  expect(sheetArrowPoint({ row: 0, col: 1 }, 'ArrowDown', 4, 3, p => p.row === 3)).toEqual({ row: 3, col: 1 })
  expect(sheetArrowPoint({ row: 1, col: 0 }, 'ArrowRight', 3, 4, p => p.col === 3)).toEqual({ row: 1, col: 3 })
  expect(sheetArrowPoint({ row: -1, col: 0 }, 'ArrowDown', 3, 3, () => true)).toBeNull()
  expect(sheetArrowPoint({ row: 0, col: 0 }, 'Tab', 3, 3, () => true)).toBeNull()
})

function target(editor?: Record<string, unknown>, interactive = false) {
  return { closest: (selector: string) => selector === 'input,textarea' ? editor || null
    : selector === 'button,a,select,[contenteditable="true"]' && interactive ? {} : null,
    getAttribute: () => null } as unknown as HTMLElement
}
it('左右键保留文字光标和选区，到边界才允许跳格；上下键不增减数字', () => {
  const input = { tagName: 'INPUT', value: 'ABC', selectionStart: 1, selectionEnd: 1 }
  expect(sheetArrowUsesEditor(target(input), 'ArrowLeft')).toBe(true)
  expect(sheetArrowUsesEditor(target(input), 'ArrowRight')).toBe(true)
  expect(sheetArrowUsesEditor(target({ ...input, selectionStart: 0, selectionEnd: 0 }), 'ArrowLeft')).toBe(false)
  expect(sheetArrowUsesEditor(target({ ...input, selectionStart: 3, selectionEnd: 3 }), 'ArrowRight')).toBe(false)
  expect(sheetArrowUsesEditor(target({ ...input, selectionStart: 0, selectionEnd: 3 }), 'ArrowRight')).toBe(true)
  expect(sheetArrowUsesEditor(target(input), 'ArrowUp')).toBe(false)
  expect(sheetArrowUsesEditor(target(input), 'ArrowDown')).toBe(false)
  expect(sheetArrowUsesEditor(target({ ...input, selectionStart: null, selectionEnd: null }), 'ArrowLeft')).toBe(true)
})
it('多行文字、按钮和原生选择保留自身键盘行为，只读格仍可导航', () => {
  expect(sheetArrowUsesEditor(target({ tagName: 'TEXTAREA' }), 'ArrowDown')).toBe(true)
  expect(sheetArrowUsesEditor(target(undefined, true), 'ArrowDown')).toBe(true)
  expect(sheetArrowUsesEditor(target({ readOnly: true }), 'ArrowRight')).toBe(false)
  expect(sheetArrowUsesEditor(target(), 'ArrowRight')).toBe(false)
})

it.each(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])('Select 和日期编辑器保留自身%s，闭合或只读搜索框也不被网格抢占', key => {
  for (const readOnly of [false, true]) {
    const editor = target({ tagName: 'INPUT', readOnly, value: '', selectionStart: 0, selectionEnd: 0 })
    const closest = editor.closest.bind(editor)
    editor.closest = ((selector: string) => selector === '.ant-select,.ant-picker' ? {} : closest(selector)) as any
    expect(sheetArrowUsesEditor(editor, key)).toBe(true)
  }
})

// Execute the actual React keyboard handler. Never invoke a business API.
const text = readFileSync(new URL('../components/ShipmentSheetTable.tsx', import.meta.url), 'utf8')
const tree = ts.createSourceFile('table.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let keyboard = ''
function walk(node: ts.Node) {
  if (ts.isJsxAttribute(node) && node.name.getText(tree) === 'onKeyDownCapture')
    keyboard = ((node.initializer as ts.JsxExpression).expression!).getText(tree)
  ts.forEachChild(node, walk)
}
walk(tree)
const executable = ts.transpileModule(`const keyHandler = ${keyboard}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
function setup(key: string, at = { row: 1, col: 1 }) {
  const input = target()
  const state = {
    sheetArrowKeys, sheetArrowPoint, sheetArrowUsesEditor, point: () => at,
    count: 3, fields: ['', 'name', 'qty'], editableAt: () => true,
    cellAt: () => ({ querySelector: () => null }), hasCell: () => true,
    canEdit: (p: { row: number; col: number }): boolean => p.col === 0 ? !!state.editorAt() : state.editableAt(),
    editorAt: vi.fn(() => ({} as HTMLElement | null)), focus: vi.fn(),
    setAnchor: vi.fn(), setEnd: vi.fn(), fillDown: vi.fn(),
    event: { key, target: input, nativeEvent: { isComposing: false },
      ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false,
      preventDefault: vi.fn(), stopPropagation: vi.fn() },
  }
  const context = createContext(state)
  runInContext(executable, context)
  return { state, run: () => runInContext('keyHandler(event)', context) }
}
it.each(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])('实际表格捕获%s，聚焦目标单元格而不是输入框', key => {
  const { state, run } = setup(key)
  run()
  expect(state.event.preventDefault).toHaveBeenCalledOnce()
  expect(state.event.stopPropagation).toHaveBeenCalledOnce()
  expect(state.focus).toHaveBeenCalledWith(sheetArrowPoint({ row: 1, col: 1 }, key, 3, 3, () => true), false)
  expect(state.fillDown).not.toHaveBeenCalled()
})
it('边界阻止页面滚动/数字步进，但不移动或写入数据', () => {
  const { state, run } = setup('ArrowUp', { row: 0, col: 1 })
  run()
  expect(state.event.preventDefault).toHaveBeenCalledOnce()
  expect(state.focus).not.toHaveBeenCalled()
})
it('灰底只读数字仍能跳转，新行物料和类别选择器保留自身键盘选择', () => {
  for (const picker of [false, true]) {
    const { state, run } = setup('ArrowDown', { row: 1, col: 0 })
    const input = { readOnly: true }
    state.event.target.closest = ((selector: string) => {
      if (selector === '.ant-select,.ant-picker') return picker ? {} : null
      if (['input,textarea,button,[role="combobox"]', 'input[readonly],textarea[readonly]', 'input,textarea'].includes(selector)) return input
      return null
    }) as any
    run()
    if (picker) {
      expect(state.focus).not.toHaveBeenCalled()
      expect(state.event.preventDefault).not.toHaveBeenCalled()
    } else expect(state.focus).toHaveBeenCalledWith({ row: 2, col: 0 }, false)
  }
})
it('输入法、系统修饰键和打开的下拉选择不被方向导航抢占', () => {
  for (const modifier of ['isComposing', 'ctrlKey', 'metaKey', 'altKey', 'expanded']) {
    const { state, run } = setup('ArrowDown')
    if (modifier === 'isComposing') state.event.nativeEvent.isComposing = true
    else if (modifier === 'expanded') state.event.target.getAttribute = () => 'true'
    else Object.assign(state.event, { [modifier]: true })
    run()
    expect(state.focus).not.toHaveBeenCalled()
    expect(state.event.preventDefault).not.toHaveBeenCalled()
  }
})
it.each(['.ant-select', '.ant-picker'])('F2 后处于可编辑列的闭合%s 内，方向键交给控件而非跳到下一行', control => {
  const { state, run } = setup('ArrowDown')
  const input = { tagName: 'INPUT', readOnly: control === '.ant-select', value: '', selectionStart: 0, selectionEnd: 0 }
  state.event.target.closest = ((selector: string) => {
    if (selector === '.ant-select,.ant-picker') return {}
    if (selector === 'input,textarea' || selector === 'input,textarea,button,[role="combobox"]') return input
    return null
  }) as any
  run()
  expect(state.focus).not.toHaveBeenCalled()
  expect(state.event.preventDefault).not.toHaveBeenCalled()
  expect(state.event.stopPropagation).not.toHaveBeenCalled()
})
it('F2可进入编辑，Tab/Enter/向下填充继续使用原有逻辑', () => {
  const edit = setup('F2'); edit.run()
  expect(edit.state.focus).toHaveBeenCalledWith({ row: 1, col: 1 })
  const tab = setup('Tab'); tab.run()
  expect(tab.state.focus).toHaveBeenCalledWith({ row: 1, col: 2 })
  const enter = setup('Enter'); enter.run()
  expect(enter.state.focus).toHaveBeenCalledWith({ row: 2, col: 1 })
  const fill = setup('d'); fill.state.event.metaKey = true; fill.run()
  expect(fill.state.fillDown).toHaveBeenCalledOnce()
})

it('F2可进入批量保护列中的已有选择器，禁止进入合并只读格及无编辑器的显示格', () => {
  const picker = setup('F2', { row: 1, col: 0 }); picker.run()
  expect(picker.state.focus).toHaveBeenCalledWith({ row: 1, col: 0 })
  const merged = setup('F2'); merged.state.editableAt = () => false; merged.run()
  expect(merged.state.focus).not.toHaveBeenCalled()
  const display = setup('F2', { row: 1, col: 0 }); display.state.editorAt.mockReturnValue(null); display.run()
  expect(display.state.focus).not.toHaveBeenCalled()
})
