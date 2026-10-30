import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'

const tree = ts.createSourceFile('number.tsx', readFileSync(new URL('../components/ShipmentNumberCell.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const component = tree.statements.find(ts.isFunctionDeclaration)!
const code = ts.transpileModule(component.getText(tree).replace('export default ', ''), { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText
function mount() {
  let cursor = 0
  const hooks: any[] = [], effects: (() => void)[] = []
  const onCommit = vi.fn(() => true as boolean | Promise<boolean>)
  const state = {
    props: { value: 12, onCommit }, flush: (() => true) as () => boolean | Promise<boolean>,
    React: { createElement: (_tag: unknown, props: any) => props }, InputNumber: {},
    useState: (initial: any) => {
      const index = cursor++; if (!(index in hooks)) hooks[index] = initial
      return [hooks[index], (value: any) => { hooks[index] = value }]
    },
    useRef: (initial: any) => { const index = cursor++; return hooks[index] ||= { current: initial } },
    useEffect: (fn: () => void, deps: any[]) => {
      const index = cursor++
      if (!hooks[index] || deps.some((value, i) => value !== hooks[index][i])) { hooks[index] = deps; effects.push(fn) }
    },
    useShipmentSheetDraft: (commit: () => boolean | Promise<boolean>) => { state.flush = commit },
  }
  const context = createContext(state); runInContext(code, context)
  const render = () => {
    cursor = 0; const editor = runInContext('ShipmentNumberCell(props)', context)
    for (const effect of effects.splice(0)) effect()
    return editor
  }
  render()
  return { state, render, onCommit }
}
it('数字草稿等待数量校验，随后滚动/blur 与批量提交共用同一次请求', async () => {
  const cell = mount()
  cell.render().onChange(34); cell.render()
  let complete!: (accepted: boolean) => void
  cell.onCommit.mockReturnValue(new Promise<boolean>(resolve => { complete = resolve }))
  const flush = cell.state.flush(), blur = cell.render().onBlur()
  expect(cell.onCommit).toHaveBeenCalledExactlyOnceWith(34)
  cell.state.props.value = 34; cell.render()
  complete(true)
  expect(await flush).toBe(true); expect(await blur).toBe(true)
  await cell.render().onBlur()
  expect(cell.onCommit).toHaveBeenCalledTimes(1)
})
it('数量校验拒绝时返回 false，保持原数字，不允许继续填充', async () => {
  const cell = mount()
  cell.render().onChange(99); cell.render()
  cell.onCommit.mockReturnValue(false)
  expect(await cell.state.flush()).toBe(false)
  expect(cell.render().value).toBe(12)
})
