import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'

const tree = ts.createSourceFile('number.tsx', readFileSync(new URL('../components/ShipmentNumberCell.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const component = tree.statements.find(ts.isFunctionDeclaration)!
const code = ts.transpileModule(component.getText(tree).replace('export default ', ''), { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText
function mount(value: number | undefined = 12) {
  let cursor = 0
  const hooks: any[] = [], effects: (() => void)[] = []
  const onCommit = vi.fn(() => true as boolean | Promise<boolean>)
  const props: { value: number | undefined; onCommit: typeof onCommit } = { value, onCommit }
  const state = {
    props, flush: (() => true) as () => boolean | Promise<boolean>,
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

it('未提供显示值时选中输入框为空，输入 0 后离格恢复空白且不写入数据', async () => {
  const cell = mount()
  cell.state.props.value = undefined; cell.render()
  expect(cell.render().value).toBeNull()
  cell.render().onChange(0)
  expect(cell.render().value).toBe(0)
  expect(await cell.render().onBlur()).toBe(true)
  expect(cell.render().value).toBeNull()
  expect(cell.onCommit).not.toHaveBeenCalled()
})

it('隐藏零值不截断 0 开头的小数输入，非零数量离格正常提交', async () => {
  const cell = mount()
  cell.state.props.value = undefined; cell.render()
  cell.render().onChange(0)
  expect(cell.render().value).toBe(0)
  cell.render().onChange(.0081)
  expect(cell.render().value).toBe(.0081)
  expect(await cell.render().onBlur()).toBe(true)
  expect(cell.onCommit).toHaveBeenCalledExactlyOnceWith(.0081)
})

it('从非零数量修改为 0 时仍提交真实的 0，仅把回显设为空白', async () => {
  const cell = mount(9)
  cell.render().onChange(0); cell.render()
  expect(await cell.render().onBlur()).toBe(true)
  expect(cell.onCommit).toHaveBeenCalledExactlyOnceWith(0)
  cell.state.props.value = undefined; cell.render()
  expect(cell.render().value).toBeNull()
})
