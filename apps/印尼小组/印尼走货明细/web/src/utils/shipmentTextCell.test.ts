import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'

// Execute the actual component and event handlers with deterministic hooks.
// No browser login, business data, or API writes are needed for IME sequences.
const source = readFileSync(new URL('../components/ShipmentTextCell.tsx', import.meta.url), 'utf8')
const tree = ts.createSourceFile('cell.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const component = tree.statements.find(ts.isFunctionDeclaration)!
const code = ts.transpileModule(component.getText(tree).replace('export default ', ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
}).outputText
function mount(props: Record<string, any> = {}) {
  const hooks: any[] = []
  let cursor = 0
  const effects: (() => void)[] = []
  const onCommit = vi.fn(() => true as boolean | Promise<boolean>)
  const state = {
    props: { value: '1-2/1', onCommit, ...props },
    pendingDraft: (() => true) as () => boolean | Promise<boolean>,
    useShipmentSheetDraft: (commit: () => boolean | Promise<boolean>) => { state.pendingDraft = commit },
    useState: (initial: any) => {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = initial
      return [hooks[index], (next: any) => { hooks[index] = next }]
    },
    useRef: (initial: any) => {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = { current: initial }
      return hooks[index]
    },
    useEffect: (fn: () => void, deps: any[]) => {
      const index = cursor++
      if (!hooks[index] || deps.some((value, i) => value !== hooks[index][i])) { hooks[index] = deps; effects.push(fn) }
    },
    React: { createElement: (tag: any, props: any) => ({ tag, props }) },
    Input: Object.assign(() => null, { TextArea: () => null }),
  }
  const context = createContext(state)
  runInContext(code, context)
  const render = () => {
    cursor = 0
    const editor = runInContext('ShipmentTextCell(props)', context)
    for (const effect of effects.splice(0)) effect()
    return editor.props
  }
  const change = (text: string) => { render().onChange({ target: { value: text } }); return render() }
  const blur = (text: string) => render().onBlur({ currentTarget: { value: text } })
  render()
  return { state, render, change, blur, onCommit, flush: () => state.pendingDraft() }
}

it('连续拼音、英文、空格和换行保留本地草稿，不逐字触发整表更新', async () => {
  const cell = mount({ multiline: true })
  for (const text of ['1-2/1k', '1-2/1ka', '1-2/1卡', '1-2/1卡\n3-4/2卡', 'Royal Regent 001']) {
    expect(cell.change(text).value).toBe(text)
    expect(cell.onCommit).not.toHaveBeenCalled()
  }
  await cell.blur('Royal Regent 001')
  expect(cell.onCommit).toHaveBeenCalledExactlyOnceWith('Royal Regent 001')
})
it('中文合成过程不写回父级，选字后的完整中文离格时一次提交', async () => {
  const cell = mount()
  cell.render().onCompositionStart()
  for (const text of ['1-2/1k', '1-2/1ka']) cell.change(text)
  cell.render().onCompositionEnd({ currentTarget: { value: '1-2/1卡' } })
  expect(cell.render().value).toBe('1-2/1卡')
  expect(cell.onCommit).not.toHaveBeenCalled()
  await cell.blur('1-2/1卡')
  expect(cell.onCommit).toHaveBeenCalledExactlyOnceWith('1-2/1卡')
})
it('在中间插入、删除、清空和未变化的重新聚焦不产生过期写入', async () => {
  const cell = mount()
  expect(cell.change('1-2/12卡').value).toBe('1-2/12卡')
  expect(cell.change('1-2/1卡').value).toBe('1-2/1卡')
  expect(cell.change('').value).toBe('')
  await cell.blur('')
  expect(cell.onCommit).toHaveBeenCalledWith('')
  cell.state.props.value = ''
  cell.render(); await cell.blur('')
  expect(cell.onCommit).toHaveBeenCalledTimes(1)
})
it('输入法 Escape 不取消草稿，普通 Escape 撤销，外部填充会同步新值', () => {
  const cell = mount()
  cell.change('ka')
  cell.render().onCompositionStart()
  cell.render().onKeyDown({ key: 'Escape', nativeEvent: { isComposing: false, keyCode: 27 } })
  expect(cell.render().value).toBe('ka')
  cell.render().onCompositionEnd({ currentTarget: { value: '卡' } })
  cell.render().onKeyDown({ key: 'Escape', nativeEvent: { isComposing: false, keyCode: 27 } })
  expect(cell.render().value).toBe('1-2/1')
  cell.state.props.value = '填充值'; cell.render()
  expect(cell.render().value).toBe('填充值')
})
it('每箱数量只在提交时格式化，拒绝写入会恢复原值且不会覆盖较新的草稿', async () => {
  const cell = mount({ format: (text: string) => text.trim() })
  cell.change(' 3000 ')
  expect(cell.render().value).toBe(' 3000 ')
  cell.onCommit.mockReturnValue(false)
  await cell.blur(' 3000 ')
  expect(cell.onCommit).toHaveBeenCalledWith('3000')
  expect(cell.render().value).toBe('1-2/1')
  let reject!: (accepted: boolean) => void
  cell.onCommit.mockReturnValue(new Promise<boolean>(resolve => { reject = resolve }))
  const pending = cell.blur('old')
  cell.change('new')
  reject(false); await pending
  expect(cell.render().value).toBe('new')
})

it('批量填充先提交完整草稿，随后弹窗触发的 blur 不会重复写入', async () => {
  const cell = mount()
  cell.change('1-2/1卡')
  let finish!: (accepted: boolean) => void
  cell.onCommit.mockImplementation(() => new Promise<boolean>(resolve => { finish = resolve }))
  const flushing = cell.flush()
  const blurring = cell.blur('1-2/1卡')
  expect(cell.onCommit).toHaveBeenCalledExactlyOnceWith('1-2/1卡')
  cell.state.props.value = '1-2/1卡'; cell.render()
  finish(true)
  expect(await flushing).toBe(true)
  await blurring
  await cell.blur('1-2/1卡')
  expect(cell.onCommit).toHaveBeenCalledTimes(1)
})
it('中文选字尚未完成时阻止批量操作，不提交半截拼音', async () => {
  const cell = mount()
  cell.render().onCompositionStart(); cell.change('ka')
  expect(await cell.flush()).toBe(false)
  expect(cell.onCommit).not.toHaveBeenCalled()
  expect(cell.render().value).toBe('ka')
})
