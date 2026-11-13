import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'
import { shipmentFrozenColumns } from './shipmentSheetFreeze'

const source = readFileSync(new URL('../components/ShipmentSheetTable.tsx', import.meta.url), 'utf8')
const tree = ts.createSourceFile('table.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let wheel = '', resize = '', scrollBody = ''
function walk(node: ts.Node) {
  if (ts.isJsxAttribute(node) && node.initializer && ts.isJsxExpression(node.initializer)) {
    if (node.name.getText(tree) === 'onWheelCapture') wheel = node.initializer.expression!.getText(tree)
    if (node.name.getText(tree) === 'onPointerDown' && node.initializer.expression!.getText(tree).includes('pendingWidth'))
      resize = node.initializer.expression!.getText(tree)
  }
  if (ts.isPropertyAssignment(node) && node.name.getText(tree) === 'scrollBody') scrollBody = node.initializer.getText(tree)
  ts.forEachChild(node, walk)
}
walk(tree)
const compile = (code: string) => ts.transpile(code, { target: ts.ScriptTarget.ES2022 })

it.each([
  { deltaX: 40, deltaY: 0, shiftKey: false },
  { deltaX: 40, deltaY: 3, shiftKey: false },
  { deltaX: 0, deltaY: 40, shiftKey: true },
])('horizontal wheel preserves continuous typing and the caret: %j', gesture => {
  const blur = vi.fn(), cancelPending = vi.fn()
  const active = { matches: () => true, closest: () => null, blur }
  const context = createContext({ event: { ...gesture, target: { closest: () => null } },
    root: { current: { contains: () => true } }, document: { activeElement: active }, horizontalScroll: { current: { cancelPending } } })
  runInContext(compile(`(${wheel})(event)`), context)
  expect(blur).not.toHaveBeenCalled()
  expect(cancelPending).toHaveBeenCalledOnce()
})

it('vertical wheel still commits a draft before its row can be unmounted', () => {
  const blur = vi.fn(), active = { matches: () => true, closest: () => null, blur }
  const context = createContext({ event: { deltaX: 0, deltaY: 40, target: { closest: () => null } },
    root: { current: { contains: () => true } }, document: { activeElement: active }, horizontalScroll: { current: null } })
  runInContext(compile(`(${wheel})(event)`), context)
  expect(blur).toHaveBeenCalledOnce()
})

function resizing() {
  const listeners = new Map<string, (event?: unknown) => void>(), frames = new Map<number, () => void>()
  let id = 0, widths: Record<number, number> = {}
  const setWidths = vi.fn((update: (current: typeof widths) => typeof widths) => { widths = update(widths) })
  const resizeCleanup = { current: null as (() => void) | null }
  const context = createContext({ event: { clientX: 100, preventDefault: vi.fn(), stopPropagation: vi.fn() },
    resizeCleanup, widths, col: 0, column: { width: 120 }, columns: [{ width: 120 }], root: { current: { clientWidth: 1200 } }, setWidths,
    shipmentFrozenColumns, frozen: { col: null },
    window: { addEventListener: (type: string, fn: (event?: unknown) => void) => listeners.set(type, fn),
      removeEventListener: (type: string) => listeners.delete(type) },
    requestAnimationFrame: (fn: () => void) => { frames.set(++id, fn); return id }, cancelAnimationFrame: (key: number) => frames.delete(key) })
  expect(resize).toBeTruthy()
  runInContext(compile(`(${resize})(event)`), context)
  const flush = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn()) }
  return { listeners, frames, flush, widths: () => widths, setWidths, resizeCleanup }
}

it.each(['pointerup', 'pointercancel', 'blur'])('column resize throttles render work and terminates on %s', end => {
  const t = resizing()
  for (const clientX of [120, 180, 160]) t.listeners.get('pointermove')!({ clientX })
  expect(t.frames.size).toBe(1)
  expect(t.setWidths).not.toHaveBeenCalled()
  t.listeners.get(end)!()
  expect(t.widths()[0]).toBe(180)
  expect(t.listeners.size).toBe(0)
  expect(t.frames.size).toBe(0)
  expect(t.resizeCleanup.current).toBeNull()
  t.flush()
  expect(t.setWidths).toHaveBeenCalledOnce()
})

it('unmount cancels a column resize without updating React state afterwards', () => {
  const t = resizing()
  t.listeners.get('pointermove')!({ clientX: 220 })
  t.resizeCleanup.current!(); t.flush()
  expect(t.listeners.size).toBe(0)
  expect(t.setWidths).not.toHaveBeenCalled()
})

it('empty table never receives a row-scroll API call as a horizontal offset', () => {
  const scrollTo = vi.fn()
  let virtual = false
  const context = createContext({ root: { current: { querySelector: () => virtual ? {} : null } }, table: { current: { scrollTo } } })
  expect(scrollBody).toBeTruthy()
  const code = compile(`(${scrollBody})(300)`)
  runInContext(code, context)
  expect(scrollTo).not.toHaveBeenCalled()
  virtual = true
  runInContext(code, context)
  expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ left: 300 })
})
