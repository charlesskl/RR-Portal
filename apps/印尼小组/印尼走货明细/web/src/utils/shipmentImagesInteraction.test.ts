import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'

// Exercise events on the actual returned Upload/Modal, without a browser/server.
function fixture() {
  const source = readFileSync(new URL('../components/ShipmentImages.tsx', import.meta.url), 'utf8')
  const tree = ts.createSourceFile('ShipmentImages.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const fn = tree.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'ShipmentImages')!
  const code = ts.transpileModule(fn.getText(tree).replace('export default ', ''), { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText
  const slots: any[] = [], cleanups = new Map<number, (() => void) | undefined>()
  let cursor = 0, effects: (() => void)[] = []
  const message = { error: vi.fn(), warning: vi.fn() }, change = vi.fn()
  const compress = vi.fn(async (file: File) => 'photo-' + file.name)
  let images = ['old']
  const context = createContext({
    React: { Fragment: 'Fragment', createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }) },
    App: { useApp: () => ({ message }) }, Image: { PreviewGroup: 'PreviewGroup' }, Modal: 'Modal', Button: 'Button', Space: 'Space', Upload: 'Upload',
    compressShipmentImage: compress,
    useState(initial: unknown) {
      const index = cursor++; if (!(index in slots)) slots[index] = initial
      return [slots[index], (next: any) => { slots[index] = typeof next === 'function' ? next(slots[index]) : next }]
    },
    useRef(initial: unknown) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index] },
    useLayoutEffect(effect: () => (() => void), deps: unknown[]) {
      const index = cursor++, old = slots[index]
      if (!old || deps.some((value, i) => value !== old[i])) effects.push(() => { cleanups.get(index)?.(); cleanups.set(index, effect()); slots[index] = deps })
    },
  })
  runInContext(code, context)
  const all = (node: any): any[] => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(all)]
  function render() {
    cursor = 0; effects = []
    const output = context.ShipmentImages({ images, onChange: change })
    effects.forEach(fn => fn())
    const nodes = all(output)
    return { upload: nodes.find(n => n.type === 'Upload').props, modal: nodes.find(n => n.type === 'Modal').props,
      remove: nodes.filter(n => n.type === 'Button' && n.props.children?.[0]?.startsWith?.('移除')).map(n => n.props) }
  }
  return { render, change, compress, message, setImages: (value: string[]) => { images = value } }
}

it('多选文件只提交一次，全部压缩成功才整体追加，移除保留其余图片', async () => {
  const f = fixture(), files = ['a.png', 'b.png'].map(name => new File(['img'], name))
  const upload = f.render().upload
  await Promise.all(files.map(file => upload.beforeUpload(file, files)))
  expect(f.compress).toHaveBeenCalledTimes(2)
  expect(f.change).toHaveBeenCalledExactlyOnceWith(['old', 'photo-a.png', 'photo-b.png'])
  f.setImages(['old', 'photo-a.png', 'photo-b.png'])
  f.render().remove[1].onClick()
  expect(f.change).toHaveBeenLastCalledWith(['old', 'photo-b.png'])
  f.setImages(['old']); f.render().remove[0].onClick()
  expect(f.change).toHaveBeenLastCalledWith([])
})

it('图片读取期间明细切换，过期结果不能写到新明细', async () => {
  const f = fixture()
  let resolve!: (value: string) => void
  f.compress.mockImplementation(() => new Promise(r => { resolve = r }))
  const file = new File(['img'], 'a.png'), pending = f.render().upload.beforeUpload(file, [file])
  f.setImages(['another-row']); f.render()
  resolve('late-image'); await pending
  expect(f.change).not.toHaveBeenCalled()
  expect(f.message.warning).toHaveBeenCalledWith(expect.stringContaining('明细已变化'))
})

it('第二张图片失败时不部分覆盖原图库', async () => {
  const f = fixture(), files = ['a.png', 'b.png'].map(name => new File(['img'], name))
  f.compress.mockResolvedValueOnce('new-image').mockRejectedValueOnce(new Error('decode failed'))
  await f.render().upload.beforeUpload(files[0], files)
  expect(f.change).not.toHaveBeenCalled()
  expect(f.message.error).toHaveBeenCalled()
})
