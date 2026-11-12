import { expect, it, vi } from 'vitest'
import ts from 'typescript'
import { createContext, runInContext } from 'node:vm'
import { readFileSync } from 'node:fs'
import { planShipmentImport, shipmentImportCandidates, type ShipmentImportItem, type ShipmentImportRow } from './shipmentImport'
import { applyShipmentImport } from './shipmentImportApply'
import { SHIPMENT_IMPORT_BATCH_LIMIT, shipmentImportBatches } from './shipmentImportBatch'
import { shipmentNetTotalKg } from './shipmentWeight'

// Execute the entire production component with deterministic hook commits and
// lightweight AntD element placeholders. Events come from its actual returned
// Upload, Table and Modal props; no handler is copied into the test.
function component(parsed: { rows: ShipmentImportRow[]; warnings: string[]; loadImages?: (rows: ShipmentImportRow[]) => Promise<void> }) {
  const text = readFileSync(new URL('../components/ShipmentImport.tsx', import.meta.url), 'utf8')
  const tree = ts.createSourceFile('ShipmentImport.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const declaration = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'ShipmentImport')!
  const code = ts.transpileModule(declaration.getText(tree).replace('export default ', ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText
  const slots: unknown[] = [], cleanups = new Map<number, (() => void) | undefined>()
  let cursor = 0, effects: (() => void)[] = []
  const message = { warning: vi.fn(), success: vi.fn(), error: vi.fn() }
  const imageReview = { confirm: vi.fn() }
  const original = { id: 1, product_code: 'A', name_zh: '合成A', supplier: '合成供应商', image: 'original-local-image' }
  let props = { existing: [{ material_id: 1, material_snapshot: original, outbound_id: 22, qty: 7, kg: 3, price: 5, currency: 'US$', cartons: 1 }],
    materials: new Map([[1, original]]), onImport: vi.fn<(rows: ShipmentImportItem[], targets: number[], reviewed?: readonly (number | undefined)[]) => boolean>(() => true) }
  const context = createContext({
    React: { Fragment: 'Fragment', createElement: (type: unknown, attributes: object, ...children: unknown[]) => ({ type, props: { ...attributes, children } }) },
    App: { useApp: () => ({ message, modal: imageReview }) },
    useState(initial: unknown) {
      const index = cursor++
      if (!(index in slots)) slots[index] = initial
      return [slots[index], (next: unknown) => { slots[index] = typeof next === 'function' ? next(slots[index]) : next }]
    },
    useMemo(factory: () => unknown) { return factory() },
    useRef(initial: unknown) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index] },
    useLayoutEffect(effect: () => (() => void), deps: unknown[]) {
      const index = cursor++, old = slots[index] as unknown[] | undefined
      if (!old || deps.some((value, i) => value !== old[i])) {
        effects.push(() => { cleanups.get(index)?.(); cleanups.set(index, effect()); slots[index] = deps })
      }
    },
    ...Object.fromEntries(['Alert', 'Button', 'Descriptions', 'Image', 'InputNumber', 'Modal', 'Select', 'Space', 'Table', 'Upload'].map(name => [name, name])),
    importShipmentFile: vi.fn(async () => parsed),
    api: { get: async (url: string) => ({ data: url === '/dictionaries' ? { hs: [], suppliers: [], translations: [] } : [] }) },
    matchShipmentMaterial: (material: object) => ({ material, matches: 0 }),
    toolImportDefaults: (material: object) => ({ material, warnings: [] }),
    createCartonGroupId: () => 'synthetic-carton',
    SHIPMENT_IMPORT_BATCH_LIMIT, shipmentImportBatches, planShipmentImport, shipmentImportCandidates, applyShipmentImport,
    shipmentNetTotalKg, shipmentGrossPerPc: () => 0, shipmentWeightQuantity: () => 0, isShipmentCountUnit: () => false,
    ShipmentImportSource: 'ShipmentImportSource',
  })
  runInContext("const currencies=[];\n" + code, context)
  function render() {
    cursor = 0; effects = []
    const output = context.ShipmentImport(props)
    effects.forEach(effect => effect())
    const nodes = output.props.children as { type: string; props: Record<string, any> }[]
    const modal = nodes.find(node => node.type === 'Modal')!
    return { upload: nodes.find(node => node.type === 'Upload')!.props, modal: modal.props,
      table: (modal.props.children as { type: string; props: Record<string, any> }[]).find(node => node?.type === 'Table')!.props }
  }
  return { render, message, imageReview, onImport: props.onImport,
    changeContext: () => { props = { ...props, materials: new Map(props.materials) } },
    current: () => props,
  }
}
const row = (code: string): ShipmentImportRow => ({ key: code, sheet: '合成表', row: code.charCodeAt(0), imageCol: 5, selected: true, warnings: [],
  item: { material_snapshot: { product_code: code, name_zh: '合成' + code, supplier: '合成供应商' }, qty: 111, price: 999, currency: '¥' } })
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

it('actual upload, selection and confirm events read only selected images and retain the linked stock/PO basis', async () => {
  const images = vi.fn(async (rows: ShipmentImportRow[]) => {
    for (const selected of rows) {
      selected.item.material_snapshot.image = 'selected-image-' + selected.key
      selected.item._fileMaterialFields = [...selected.item._fileMaterialFields || [], 'image']
    }
  })
  const fixture = component({ rows: ['A', 'B', 'C'].map(row), warnings: [], loadImages: images })
  const reading = fixture.render().upload.beforeUpload(new File([], 'synthetic.xlsx'))
  fixture.render(); await reading
  let view = fixture.render()
  view.table.rowSelection.onChange(['A', 'C']); view = fixture.render()
  await view.modal.onOk()
  expect(images).toHaveBeenCalledOnce()
  expect(images.mock.calls[0][0].map(value => value.key)).toEqual(['A', 'C'])
  const [imported, targets] = fixture.onImport.mock.calls[0] as unknown as [ShipmentImportItem[], number[]]
  expect(targets).toEqual([0, -1])
  const next = applyShipmentImport(fixture.current().existing, fixture.current().materials, imported, targets)
  expect(next[0]).toMatchObject({ outbound_id: 22, qty: 7, kg: 3, price: 5, currency: 'US$', material_snapshot: { id: 1, image: 'selected-image-A' } })
  expect(next[1].material_snapshot?.image).toBe('selected-image-C')
  expect(fixture.render().modal.open).toBe(false)
})

it.each(['selection', 'materials'])('an actual %s commit during deferred images prevents stale onImport', async change => {
  let finish!: () => void
  const fixture = component({ rows: ['A', 'B'].map(row), warnings: [], loadImages: () => new Promise<void>(resolve => { finish = resolve }) })
  await fixture.render().upload.beforeUpload(new File([], 'synthetic.xlsx'))
  let view = fixture.render()
  const pending = view.modal.onOk()
  view = fixture.render()
  if (change === 'selection') view.table.rowSelection.onChange(['A'])
  else fixture.changeContext()
  fixture.render(); finish(); await pending
  expect(fixture.onImport).not.toHaveBeenCalled()
  expect(fixture.message.warning).toHaveBeenCalledWith(expect.stringContaining('重新核对'))
  expect(fixture.render().modal.open).toBe(true)
})

it('a context change during the actual upload event cannot publish an old preview', async () => {
  const fixture = component({ rows: [row('A')], warnings: [] })
  const reading = fixture.render().upload.beforeUpload(new File([], 'synthetic.xlsx'))
  fixture.changeContext(); fixture.render(); await reading; await tick()
  expect(fixture.render().modal.open).toBe(false)
  expect(fixture.message.warning).toHaveBeenCalledWith(expect.stringContaining('重新选择文件'))
})

it('image failure locations require explicit acknowledgement and a rejected parent import keeps an unchanged preview for retry', async () => {
  const source = row('A')
  const fixture = component({ rows: [source], warnings: [], loadImages: async rows => { rows[0].warnings.push('图片读取失败') } })
  await fixture.render().upload.beforeUpload(new File([], 'synthetic.xlsx'))
  fixture.onImport.mockReturnValueOnce(false)
  let confirming = fixture.render().modal.onOk()
  await tick()
  expect(fixture.onImport).not.toHaveBeenCalled()
  expect(fixture.message.success).not.toHaveBeenCalled()
  const firstReview = fixture.imageReview.confirm.mock.calls[0][0]
  expect(firstReview.title).toBe('1 行图片需要核对')
  expect(JSON.stringify(firstReview.content)).toContain('合成表')
  expect(JSON.stringify(firstReview.content)).toContain('65')
  firstReview.onOk(); await confirming
  expect(fixture.render().modal.open).toBe(true)
  expect(source.warnings).toEqual([])
  expect(fixture.message.success).not.toHaveBeenCalled()
  confirming = fixture.render().modal.onOk()
  await tick()
  fixture.imageReview.confirm.mock.calls[1][0].onOk(); await confirming
  expect(fixture.message.success).toHaveBeenCalledOnce()
  expect(source.warnings).toEqual([])
})

it('cancelling persistent image review or changing targets while it is open cannot import partial content', async () => {
  const source = row('A')
  const fixture = component({ rows: [source], warnings: [], loadImages: async rows => { rows[0].warnings.push('单张图片原始数据超过 32 MB') } })
  await fixture.render().upload.beforeUpload(new File([], 'synthetic.xlsx'))
  let confirming = fixture.render().modal.onOk()
  await tick()
  fixture.imageReview.confirm.mock.calls[0][0].onCancel(); await confirming
  expect(fixture.onImport).not.toHaveBeenCalled()
  expect(fixture.render().modal.open).toBe(true)
  confirming = fixture.render().modal.onOk()
  await tick()
  fixture.changeContext(); fixture.render()
  fixture.imageReview.confirm.mock.calls[1][0].onOk(); await confirming
  expect(fixture.onImport).not.toHaveBeenCalled()
  expect(source.warnings).toEqual([])
  expect(fixture.message.warning).toHaveBeenCalledWith(expect.stringContaining('重新核对'))
})


function reviewChoice(view: ReturnType<ReturnType<typeof component>['render']>, source: ShipmentImportRow) {
  const column = view.table.columns.find((column: { title: string }) => column.title === '导入方式')
  const rendered = column.render(null, source)
  return rendered.props.children.find((node: { type: string }) => node.type === 'Select').props
}

it('重复匹配可手动选择第二条出库明细，导入只更新所选行并保留其数量和采购来源', async () => {
  const source = row('A')
  source.item.cartons = 4
  const fixture = component({ rows: [source], warnings: [] })
  fixture.current().existing.push({ ...fixture.current().existing[0], outbound_id: 23, qty: 11, cartons: 3 })
  const before = structuredClone(fixture.current().existing)
  await fixture.render().upload.beforeUpload(new File([], 'duplicates.xlsx'))
  let view = fixture.render()
  await view.modal.onOk()
  expect(fixture.onImport).not.toHaveBeenCalled()
  expect(fixture.message.warning).toHaveBeenCalledWith(expect.stringContaining('重复匹配'))
  const select = reviewChoice(view, source)
  expect(select.options.map((option: { label: string }) => option.label)).toEqual([
    expect.stringContaining('OUT-22'), expect.stringContaining('OUT-23'),
  ])
  select.onChange(1)
  view = fixture.render()
  await view.modal.onOk()
  expect(fixture.onImport).toHaveBeenCalledOnce()
  const [imported, targets] = fixture.onImport.mock.calls[0] as unknown as [ShipmentImportItem[], number[]]
  expect(targets).toEqual([1])
  const updated = applyShipmentImport(fixture.current().existing, fixture.current().materials, imported, targets, fixture.onImport.mock.calls[0][2])
  expect(updated[0]).toEqual(before[0])
  expect(updated[1]).toMatchObject({ outbound_id: 23, qty: 11, price: 5, currency: 'US$', cartons: 4 })
  expect(fixture.current().existing).toEqual(before)
})

it('同一现有明细不能被两条导入行同时覆盖，改选不同目标后整次应用', async () => {
  const sources = [row('A'), { ...row('A'), key: 'A2' }]
  const fixture = component({ rows: sources, warnings: [] })
  fixture.current().existing.push({ ...fixture.current().existing[0], outbound_id: 23 })
  await fixture.render().upload.beforeUpload(new File([], 'duplicates.xlsx'))
  let view = fixture.render()
  reviewChoice(view, sources[0]).onChange(0)
  view = fixture.render()
  reviewChoice(view, sources[1]).onChange(0)
  view = fixture.render()
  await view.modal.onOk()
  expect(fixture.onImport).not.toHaveBeenCalled()
  reviewChoice(view, sources[1]).onChange(1)
  view = fixture.render()
  await view.modal.onOk()
  expect(fixture.onImport.mock.calls[0][1]).toEqual([0, 1])
})

it('原明细或物料更新后手动核对选择失效，必须重新确认覆盖对象', async () => {
  const source = row('A')
  const fixture = component({ rows: [source], warnings: [] })
  fixture.current().existing.push({ ...fixture.current().existing[0], outbound_id: 23 })
  await fixture.render().upload.beforeUpload(new File([], 'duplicates.xlsx'))
  reviewChoice(fixture.render(), source).onChange(1)
  fixture.render()
  fixture.changeContext()
  const view = fixture.render()
  expect(reviewChoice(view, source).value).toBeUndefined()
  await view.modal.onOk()
  expect(fixture.onImport).not.toHaveBeenCalled()
})

it('超过500行可先预览，批次选择只读取本批图片且不会静默截掉明细', async () => {
  const rows = Array.from({ length: 501 }, (_, index) => ({ ...row(`ROW-${index}`), selected: false }))
  const images = vi.fn(async (_rows: ShipmentImportRow[]) => {})
  const f = component({ rows, warnings: [], loadImages: images })
  await f.render().upload.beforeUpload(new File([], 'multi.xlsx'))
  let view = f.render()
  expect(view.table.dataSource).toHaveLength(501)
  expect(view.modal.okButtonProps.disabled).toBe(true)
  const descendants = (node: any): any[] => !node || typeof node !== 'object' ? [] : [node, ...(Array.isArray(node.props?.children) ? node.props.children : [node.props?.children]).flatMap(descendants)]
  const batchPicker = descendants({ props: { children: view.modal.children } }).find(node => node.type === 'Select' && node.props.placeholder === '选择预览批次')
  expect(batchPicker.props.options.map((option: any) => option.disabled)).toEqual([false, false])
  batchPicker.props.onChange(1); view = f.render()
  expect(view.table.rowSelection.selectedRowKeys).toEqual(['ROW-500'])
  await view.modal.onOk()
  expect(images.mock.calls[0][0].map(row => row.key)).toEqual(['ROW-500'])
  expect(f.onImport.mock.calls[0][0]).toHaveLength(1)
})

it('所选超过500行时不能通过直接确认绕过批次限制，也不会提前读取图片', async () => {
  const images = vi.fn(async (_rows: ShipmentImportRow[]) => {})
  const f = component({ rows: Array.from({ length: 501 }, (_, index) => row(`ROW-${index}`)), warnings: [], loadImages: images })
  await f.render().upload.beforeUpload(new File([], 'multi.xlsx'))
  const view = f.render()
  expect(view.modal.okButtonProps.disabled).toBe(true)
  await view.modal.onOk()
  expect(images).not.toHaveBeenCalled()
  expect(f.onImport).not.toHaveBeenCalled()
  expect(f.message.warning).toHaveBeenCalledWith(expect.stringContaining('500'))
})
