import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, it } from 'vitest'
import type { Dictionaries, Material, SupplierDict } from '../api/client'
import { materialCustomsCompany, supplierCustomsCompany } from '../utils/supplierProfiles'

// Exercise the actual page handlers while dictionary refresh remains pending.
// All API/state dependencies are synthetic; no DOM, network or saved data is used.
const page = ts.createSourceFile('ProductsPage.tsx', readFileSync(fileURLToPath(new URL('./ProductsPage.tsx', import.meta.url)), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function find(predicate: (node: ts.Node) => boolean): ts.Node {
  let result: ts.Node | undefined
  function visit(node: ts.Node) {
    if (!result && predicate(node)) result = node
    ts.forEachChild(node, visit)
  }
  visit(page)
  assert.ok(result)
  return result
}
function callback(name: string): ts.Expression {
  const attribute = find(node => ts.isJsxAttribute(node) && node.name.getText(page) === name) as ts.JsxAttribute
  assert.ok(attribute.initializer && ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression)
  return attribute.initializer.expression
}
function compile(node: ts.Node, bindings: Record<string, unknown>) {
  const output = ts.transpileModule(`const actual = ${node.getText(page)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React },
  }).outputText
  return new Function(...Object.keys(bindings), output + '\nreturn actual;')(...Object.values(bindings))
}
const saveNode = find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'save')
const supplier: SupplierDict = { id: 7, keyword: 'fixture-supplier', full: 'Fixture Supplier', customs: 'Previous Customs' }
async function actualSave(materials: Material[], dicts: Dictionaries) {
  const calls: { url: string; data: unknown }[] = []
  const noop = () => {}
  const save = compile(saveNode, {
    form: { validateFields: async () => ({ code: 'fixture', name: 'Edited product' }) },
    editing: { code: 'fixture' }, setSavingDetail: noop,
    api: {
      put: async (url: string, data: unknown) => { calls.push({ url, data }); return { data: {} } },
      post: async () => ({ data: {} }), get: async () => ({ data: { materials: [], moldings: [] } }),
    },
    moldings: [], materials, dicts, originalMaterialsRef: { current: materials.map(row => ({ ...row })) },
    materialCustomsCompany, modal: { confirm: noop }, message: { success: noop, warning: noop },
    loadDicts: noop, setCreating: noop, loadList: noop, setMaterials: noop, setMoldings: noop, setEditing: noop,
  })
  await save()
  const bulk = calls.find(call => call.url.startsWith('/materials/bulk/'))
  assert.ok(bulk)
  return (bulk.data as { materials: Record<string, unknown>[] }).materials
}

describe('product supplier-profile save boundary', () => {
  it('uses a successfully saved profile immediately, before dictionary refresh completes', async () => {
    let rows: Material[] = [{ id: 1, supplier: supplier.keyword, customs_company: supplier.customs, name_zh: 'Manually edited name', unit_kg: 'TNE', net_per_pc: 0.1234 }]
    const other: SupplierDict = { id: 8, keyword: 'other-alias', full: supplier.full, customs: 'Other Customs' }
    let dicts: Dictionaries = { suppliers: [supplier, other], hs: [], translations: [] }
    let refreshes = 0
    const parent = compile(callback('onSuppliersChanged'), {
      dictionaryRequestRef: { current: 0 },
      setDicts: (update: (current: Dictionaries) => Dictionaries) => { dicts = update(dicts) },
      loadDicts: () => { refreshes++; return new Promise<void>(() => {}) },
    })
    const onSaved = compile(callback('onSaved'), {
      i: 0, rows, onChange: (next: Material[]) => { rows = next }, supplierCustomsCompany, onSuppliersChanged: parent,
    })
    const committed = { ...supplier, customs: 'Committed New Customs' }
    onSaved(committed, supplier)
    assert.equal(refreshes, 1)
    assert.equal(rows[0].customs_company, committed.customs)
    assert.equal(dicts.suppliers[1], other)
    const [payload] = await actualSave(rows, dicts)
    assert.equal(payload.customsCompany, committed.customs)
    assert.equal(payload.nameZh, 'Manually edited name')
    assert.equal(payload.unitKg, 'TNE')
    assert.equal(payload.netPerPc, 0.1234)
  })

  it('appends a newly created profile without changing other archives', () => {
    let dicts: Dictionaries = { suppliers: [supplier], hs: [], translations: [] }
    const parent = compile(callback('onSuppliersChanged'), {
      dictionaryRequestRef: { current: 0 },
      setDicts: (update: (current: Dictionaries) => Dictionaries) => { dicts = update(dicts) }, loadDicts: () => {},
    })
    const created = { keyword: 'new-supplier', full: 'New Supplier', customs: 'New Customs' }
    parent(created)
    assert.deepEqual(dicts.suppliers, [supplier, created])
    parent({ ...created, customs: 'Edited New Customs' })
    assert.equal(dicts.suppliers.length, 2)
    assert.equal(dicts.suppliers[1].customs, 'Edited New Customs')
  })

  it('preserves ambiguous and unknown fallback values and all input objects during save', async () => {
    const dicts: Dictionaries = { suppliers: [{ keyword: 'one', full: 'Same Company', customs: 'One' }, { keyword: 'two', full: 'Same Company', customs: 'Two' }], hs: [], translations: [] }
    const rows: Material[] = [{ id: 1, supplier: 'Same Company', customs_company: 'Explicit Fallback', name_zh: 'Edited', unit_kg: 'SET', net_per_pc: 0.15 }, { id: 2, supplier: 'Unknown', customs_company: '  Retained  ', name_en: 'Manual English' }]
    const before = JSON.stringify({ dicts, rows })
    const payload = await actualSave(rows, dicts)
    assert.equal(payload[0].customsCompany, 'Explicit Fallback')
    assert.equal(payload[1].customsCompany, 'Retained')
    assert.equal(payload[1].nameEn, 'Manual English')
    assert.equal(JSON.stringify({ dicts, rows }), before)
  })

  it('uses delayed dictionaries on save without mutating material rows during display', async () => {
    const row: Material = { id: 1, supplier: supplier.full, customs_company: '', name_zh: 'Edited' }
    const before = JSON.stringify(row)
    assert.equal(materialCustomsCompany(row, []), '')
    const dicts: Dictionaries = { suppliers: [supplier], hs: [], translations: [] }
    const displayed = materialCustomsCompany(row, dicts.suppliers)
    assert.equal(JSON.stringify(row), before)
    const [payload] = await actualSave([row], dicts)
    assert.equal(payload.customsCompany, displayed)
    assert.equal(JSON.stringify(row), before)
  })
  it('does not let an older dictionary response overwrite a committed profile', async () => {
    const loadNode = find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'loadDicts')
    for (const order of ['old-before-fresh', 'fresh-before-old', 'fresh-fails'] as const) {
      let rows: Material[] = [{ id: 1, supplier: supplier.keyword, customs_company: supplier.customs }]
      let dicts: Dictionaries = { suppliers: [supplier], hs: [], translations: [] }
      const dictionaryRequestRef = { current: 0 }
      type Response = { data: Dictionaries }
      const requests: { resolve: (value: Response) => void; reject: (error: Error) => void }[] = []
      const pendingLoads: Promise<void>[] = []
      const setDicts = (next: Dictionaries | ((current: Dictionaries) => Dictionaries)) => {
        dicts = typeof next === 'function' ? next(dicts) : next
      }
      const loader = compile(loadNode, {
        dictionaryRequestRef, setDicts,
        api: { get: () => new Promise<Response>((resolve, reject) => { requests.push({ resolve, reject }) }) },
      })
      const loadDicts = () => { const pending = loader(); pendingLoads.push(pending); return pending }
      const parent = compile(callback('onSuppliersChanged'), { dictionaryRequestRef, setDicts, loadDicts })
      const onSaved = compile(callback('onSaved'), {
        i: 0, rows, onChange: (next: Material[]) => { rows = next }, supplierCustomsCompany, onSuppliersChanged: parent,
      })
      const oldLoad = loadDicts()
      const committed = { ...supplier, customs: 'Committed New Customs' }
      onSaved(committed, supplier)
      assert.equal(requests.length, 2)
      const oldResponse = { data: { suppliers: [supplier], hs: [], translations: [] } }
      const freshResponse = { data: { suppliers: [committed], hs: [], translations: [] } }
      if (order === 'old-before-fresh') {
        requests[0].resolve(oldResponse); await oldLoad
        assert.equal(dicts.suppliers[0].customs, committed.customs)
        requests[1].resolve(freshResponse); await pendingLoads[1]
      } else {
        if (order === 'fresh-fails') requests[1].reject(new Error('Synthetic refresh unavailable'))
        else requests[1].resolve(freshResponse)
        await pendingLoads[1]
        requests[0].resolve(oldResponse); await oldLoad
      }
      assert.equal(dicts.suppliers[0].customs, committed.customs)
      const [payload] = await actualSave(rows, dicts)
      assert.equal(payload.customsCompany, committed.customs)
    }
  })

})
