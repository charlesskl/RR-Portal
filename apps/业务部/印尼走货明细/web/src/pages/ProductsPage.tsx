import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AutoComplete, Button, Card, Col, Drawer, Form, Input, InputNumber, Popconfirm,
  Row, Select, Space, Switch, Table, Tabs, Tag, Typography, App,
} from 'antd'
import { api, type Dictionaries, type Material, type Molding, type MoldingPart, type Product, type ProductDetail } from '../api/client'
import { MATERIAL_CATEGORIES, inferMaterialCategory } from '../utils/engineeringImport'
import { CUSTOMS_FIXED } from '../utils/customsExport'

interface ProductForm {
  code: string
  name?: string
  customer?: string
}

const WORKSHOPS = ['兴信A车间', '兴信B车间', '华登']

export default function ProductsPage() {
  const { message } = App.useApp()
  const [rows, setRows] = useState<Product[]>([])
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [creating, setCreating] = useState(false)
  const [form] = Form.useForm<ProductForm>()
  const [moldings, setMoldings] = useState<Molding[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [customers, setCustomers] = useState<string[]>([])
  const [savingDetail, setSavingDetail] = useState(false)
  const [activeTab, setActiveTab] = useState<'mold' | 'mat'>('mold')
  const [dicts, setDicts] = useState<Dictionaries>({ hs: [], suppliers: [] })
  const [drawerFull, setDrawerFull] = useState(false)
  const [showInactive, setShowInactive] = useState(false)

  async function loadList() {
    setLoading(true)
    try {
      const { data } = await api.get<Product[]>('/products', { params: { includeInactive: showInactive } })
      setRows(Array.isArray(data) ? data : [])
    } finally { setLoading(false) }
  }
  async function loadCustomers() {
    try { const { data } = await api.get<string[]>('/customers'); setCustomers(data || []) } catch {}
  }
  async function loadDicts() {
    try { const { data } = await api.get<Dictionaries>('/dictionaries'); setDicts({ hs: data.hs || [], suppliers: data.suppliers || [] }) } catch {}
  }
  useEffect(() => { loadList(); loadCustomers(); loadDicts() }, [])
  useEffect(() => { loadList() }, [showInactive])

  function openCreate() {
    setCreating(true); setEditing(null); setActiveTab('mold')
    form.resetFields(); setMoldings([]); setMaterials([])
  }

  async function openEdit(p: Product, tab: 'mold' | 'mat' = 'mold') {
    setEditing(p); setCreating(false); setActiveTab(tab)
    form.resetFields()
    setTimeout(() => form.setFieldsValue({ code: p.code, name: p.name, customer: p.customer }), 0)
    setMoldings([]); setMaterials([])
    try {
      const { data } = await api.get<ProductDetail>(`/products/${encodeURIComponent(p.code)}`)
      setMoldings(Array.isArray(data.moldings) ? data.moldings : [])
      setMaterials(Array.isArray(data.materials) ? data.materials : [])
    } catch (e: any) {
      message.error('加载货号详情失败: ' + (e?.message ?? e))
    }
  }

  async function save() {
    const v = await form.validateFields()
    if (!v.code) return
    setSavingDetail(true)
    try {
      await api.put(`/products/${encodeURIComponent(v.code)}`, {
        name: v.name ?? '',
        customer: v.customer ?? '',
        moldings,
      })
      // Replace materials via bulk PUT. Backend upserts by id; rows removed in UI are soft-removed if referenced, else deleted.
      await api.put(`/materials/bulk/${encodeURIComponent(v.code)}`, {
        materials: materials.map((m) => ({
          ...(m.id != null ? { id: m.id } : {}),
          itemNo: m.item_no ?? '',
          nameZh: m.name_zh ?? '',
          nameEn: m.name_en ?? '',
          spec: m.spec ?? '',
          category: m.category ?? '',
          materialCode: m.material_code ?? '',
          hsCN: m.hs_cn ?? '',
          hsID: m.hs_id ?? '',
          supplier: m.supplier ?? '',
          customsCompany: m.customs_company ?? '',
          unitKg: m.unit_kg ?? 'KGM',
          grossPerPc: m.gross_per_pc ?? 0,
          netPerPc: m.net_per_pc ?? 0,
          length: m.length ?? 0,
          width: m.width ?? 0,
          height: m.height ?? 0,
          qtyPerCarton: m.qty_per_carton ?? 0,
          weightPerCarton: m.weight_per_carton ?? 0,
          imageId: m.image_id ?? null,
          active: m.active !== false,
          usage_qty: m.usage_qty ?? 1,
        })),
      })
      message.success('已保存')
      setCreating(false)
      loadList()
      // 停留在编辑页；重新拉详情回填物料 id（再次保存按 id upsert，不重复新增）
      try {
        const { data } = await api.get<ProductDetail>(`/products/${encodeURIComponent(v.code)}`)
        if (Array.isArray(data.materials)) setMaterials(data.materials)
        if (Array.isArray(data.moldings)) setMoldings(data.moldings)
        setEditing(prev => prev ?? { code: v.code, name: v.name ?? '', customer: v.customer ?? '' })
      } catch {}
    } catch {
      /* 拦截器已提示 */
    } finally {
      setSavingDetail(false)
    }
  }

  async function deactivate(code: string) {
    try { await api.delete(`/products/${encodeURIComponent(code)}`); message.success('已停用'); loadList() } catch {}
  }
  async function restore(code: string) {
    try { await api.post(`/products/${encodeURIComponent(code)}/restore`); message.success('已启用'); loadList() } catch {}
  }
  async function hardDel(code: string) {
    try { await api.delete(`/products/${encodeURIComponent(code)}?hard=true`); message.success('已彻底删除'); loadList() } catch {/* 409 由拦截器提示 */ }
  }

  const [customerFilter, setCustomerFilter] = useState<string>('')
  const engFileRef = useRef<HTMLInputElement>(null)

  async function importEngineering(file: File) {
    try {
      const { importEngineeringFile } = await import('../utils/engineeringImport')
      const r = await importEngineeringFile(file, { hsDict: dicts.hs })
      // 内嵌图片(dataURL) → 上传换 image_id（物料用 image_id；排模件直接把 image 换成 image_id 字符串）
      const matImg = r.materials.filter((m: any) => m.image && String(m.image).startsWith('data:'))
      const partImg = r.moldings.flatMap(md => (md.parts ?? [])).filter((p: any) => p.image && String(p.image).startsWith('data:'))
      if (matImg.length || partImg.length) {
        const { uploadImageDataUrl } = await import('../utils/imageUpload')
        await Promise.all([
          ...matImg.map(async (m: any) => { const id = await uploadImageDataUrl(m.image); if (id) m.image_id = id; delete m.image }),
          ...partImg.map(async (p: any) => { const id = await uploadImageDataUrl(p.image); p.image = id || undefined }),
        ])
        message.info(`已识别并上传图片：物料 ${matImg.length} 张 / 排模件 ${partImg.length} 张`)
      }
      const existing = rows.find(p => p.code === r.code)
      const importedCustomer = r.customer || existing?.customer || customerFilter || ''
      const p: Product = existing ?? { code: r.code, name: r.name, customer: importedCustomer }
      setEditing(p); setCreating(!existing); setActiveTab('mat'); setMoldings([]); setMaterials([])
      form.resetFields()
      setTimeout(() => form.setFieldsValue({ code: r.code, name: r.name || existing?.name || '', customer: importedCustomer }), 0)
      // If existing, fetch current detail then merge (replace strategy)
      if (existing) {
        try {
          const { data } = await api.get<ProductDetail>(`/products/${encodeURIComponent(r.code)}`)
          // Merge: imported overrides matching names; existing extras stay
          const existingMats = Array.isArray(data.materials) ? data.materials : []
          const merged = [...existingMats]
          for (const m of r.materials) {
            const dupe = merged.find(x => x.name_zh === m.name_zh)
            // image_id 以本次导入为准：BOM 匹配到则用新图，未匹配则清空（避免保留旧的错图）
            if (dupe) Object.assign(dupe, { ...m, id: dupe.id, active: dupe.active, image_id: (m as any).image_id ?? undefined })
            else merged.push(m)
          }
          setMaterials(merged)
          // moldings: replace if same moldId/moldName; else append
          const existingMoldings = Array.isArray(data.moldings) ? data.moldings : []
          const mergedMoldings = [...existingMoldings]
          for (const m of r.moldings) {
            const dupe = mergedMoldings.find(x => (x.moldId && x.moldId === m.moldId) || (!x.moldId && !m.moldId && x.moldName === m.moldName))
            if (dupe) Object.assign(dupe, m, { setsPerShot: dupe.setsPerShot, workshop: dupe.workshop, notes: dupe.notes })
            else mergedMoldings.push(m)
          }
          setMoldings(mergedMoldings)
        } catch {}
      } else {
        setMoldings(r.moldings); setMaterials(r.materials)
      }
      message.success(`已识别：${r.moldings.length} 个模具 / ${r.materials.length} 个物料 — 检查后点 💾 保存`)
    } catch (e: any) {
      message.error('导入失败: ' + (e?.message ?? e))
    }
  }

  const customerStats = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of rows) {
      const k = p.customer || '(未分配)'
      m.set(k, (m.get(k) ?? 0) + 1)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [rows])

  const filtered = useMemo(() => {
    return rows
      .filter(p => {
        if (customerFilter && (p.customer || '(未分配)') !== customerFilter) return false
        if (!filter) return true
        const s = filter.toLowerCase()
        return ((p.code || '') + (p.name || '') + (p.customer || '')).toLowerCase().includes(s)
      })
      .sort((a, b) => (a.customer || '').localeCompare(b.customer || '') || a.code.localeCompare(b.code))
  }, [rows, filter, customerFilter])

  const isOpen = creating || editing !== null

  return (
    <div style={{ padding: 16 }}>
      <Card
        title={`货号库 — 共 ${rows.length} 个货号`}
        extra={
          <Space>
            <Input.Search allowClear placeholder="搜索 编码/名称/客户" style={{ width: 280 }}
              onSearch={setFilter} onChange={(e) => !e.target.value && setFilter('')} />
            <Button type="primary" onClick={openCreate}>➕ 新建货号</Button>
            <Button onClick={() => engFileRef.current?.click()}>📋 导入工程放产资料</Button>
            <input ref={engFileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) importEngineering(f); e.target.value = '' }} />
            <Switch checkedChildren="含停用" unCheckedChildren="仅启用" checked={showInactive} onChange={setShowInactive} />
            <Button onClick={loadList}>🔄 刷新</Button>
          </Space>
        }
        tabList={[
          { key: '', tab: `全部 (${rows.length})` },
          ...customerStats.map(([name, count]) => ({ key: name, tab: `${name} (${count})` })),
        ]}
        activeTabKey={customerFilter}
        onTabChange={setCustomerFilter}
      >
        <Table
          rowKey="code"
          size="small"
          loading={loading}
          dataSource={filtered}
          pagination={{ defaultPageSize: 50, showSizeChanger: true }}
          columns={[
            { title: '编码', dataIndex: 'code', width: 160, sorter: (a, b) => a.code.localeCompare(b.code) },
            {
              title: '名称', dataIndex: 'name', ellipsis: true,
              render: (v, r) => <a onClick={() => openEdit(r, 'mat')} title="点击查看该货号的物料子表">{v || <span style={{ color: '#bbb' }}>(无名称)</span>}</a>,
            },
            { title: '客户', dataIndex: 'customer', width: 160 },
            {
              title: '物料 (active / 全部)', width: 160, align: 'right',
              render: (_v, r) => (
                <span><Tag color="green">{r.active_count ?? 0}</Tag>/<Tag>{r.total_count ?? 0}</Tag></span>
              ),
            },
            {
              title: '操作', width: 200,
              render: (_v, r) => (
                <Space>
                  <a onClick={() => openEdit(r)}>编辑</a>
                  {r.active === false
                    ? <a onClick={() => restore(r.code)}>启用</a>
                    : <Popconfirm title={`停用货号 ${r.code}?（被单据引用也安全，可随时启用）`} onConfirm={() => deactivate(r.code)}><a>停用</a></Popconfirm>}
                  <Popconfirm title={`彻底删除 ${r.code}? 仅在无任何单据引用时可删`} onConfirm={() => hardDel(r.code)}>
                    <a style={{ color: '#ff4d4f' }}>彻底删除</a>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Drawer
        open={isOpen}
        width={drawerFull ? '100vw' : '40vw'}
        title={creating ? '新建货号' : `编辑货号 — ${editing?.code}`}
        onClose={() => { setEditing(null); setCreating(false); setDrawerFull(false) }}
        destroyOnClose
        extra={
          <Space>
            <Button onClick={() => setDrawerFull(!drawerFull)}>{drawerFull ? '⤢ 退出全屏' : '⤡ 全屏'}</Button>
            <Button type="primary" loading={savingDetail} onClick={save}>💾 保存</Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical">
          <Row gutter={16}>
            <Col span={6}>
              <Form.Item name="code" label="编码" rules={[{ required: true, message: '必填' }]}>
                <Input disabled={!creating} placeholder="例如 LDH-23001" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="name" label="名称"><Input /></Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="customer" label="客户">
                <AutoComplete
                  style={{ width: '100%' }}
                  options={customers.map(c => ({ value: c, label: c }))}
                  filterOption={(input, opt) => (opt?.label?.toString() ?? '').toLowerCase().includes(input.toLowerCase())}
                />
              </Form.Item>
            </Col>
          </Row>
        </Form>

        <Tabs
          activeKey={activeTab}
          onChange={(k) => setActiveTab(k as 'mold' | 'mat')}
          items={[
            {
              key: 'mold', label: `排模表 (${moldings.length})`,
              children: <MoldingsEditor value={moldings} onChange={setMoldings} dicts={dicts} />,
            },
            {
              key: 'mat', label: `物料子表 (${materials.length})`,
              children: <MaterialsEditor
                rows={materials}
                onChange={setMaterials}
                dicts={dicts}
                productCode={editing?.code ?? form.getFieldValue('code')}
              />,
            },
          ]}
        />

        <p style={{ color: '#999', fontSize: 12, marginTop: 16 }}>
          📌 阶段 2b 待加：模具图片上传、物料直接增删改 + Excel 批量导入、HS / 供应商自动填充按钮。
        </p>
      </Drawer>
    </div>
  )
}

// ---------------- Moldings editor (nested) ----------------

function MoldingsEditor({ value, onChange, dicts }: { value: Molding[]; onChange: (v: Molding[]) => void; dicts: Dictionaries }) {
  const { message } = App.useApp()
  function patch(i: number, k: keyof Molding, v: any) {
    onChange(value.map((m, idx) => idx === i ? { ...m, [k]: v } : m))
  }
  // 按字典给所有塑胶件补/纠 HS（命中即覆盖，字典为权威）
  function autoFillHs() {
    const dict = (dicts.hs || []).filter(d => d.keyword)
    if (!dict.length) { message.warning('字典里没有 HS 关键字'); return }
    let filled = 0
    const next = value.map(m => ({
      ...m,
      parts: (m.parts ?? []).map(p => {
        const hit = dict.find(d => (p.partName || '').includes(d.keyword!))
        if (!hit) return p
        const cn = hit.hsCN || p.hsCN, id = hit.hsID || p.hsID
        if (cn === p.hsCN && id === p.hsID) return p
        filled++
        return { ...p, hsCN: cn, hsID: id }
      }),
    }))
    onChange(next)
    message.success(`塑胶件 HS 自动填充：${filled} 件`)
  }
  function addMold() {
    onChange([...value, { moldId: '', moldName: '', materialName: '', colorName: '', pigmentCode: '', netGramsPerShot: 0, setsPerShot: 1, workshop: '', notes: '', parts: [] }])
  }
  function delMold(i: number) {
    onChange(value.filter((_, idx) => idx !== i))
  }
  function patchParts(i: number, parts: MoldingPart[]) {
    patch(i, 'parts', parts)
  }

  return (
    <div>
      <Space style={{ marginBottom: 12 }}>
        <Button type="primary" onClick={addMold}>＋ 新增模具</Button>
        <Button onClick={autoFillHs}>🔍 HS 自动填充</Button>
        <Typography.Text type="secondary">每个模具下含若干塑胶件 · 字典 HS {dicts.hs.length} 条</Typography.Text>
      </Space>
      {value.length === 0 && (
        <div style={{ textAlign: 'center', color: '#999', padding: 24, border: '1px dashed #ddd', borderRadius: 6 }}>
          暂无模具 — 点上方"＋ 新增模具"
        </div>
      )}
      {value.map((m, i) => (
        <Card key={i} size="small"
          style={{ marginBottom: 12, background: '#fafbfc' }}
          title={<Space><Tag color="blue">模具 #{i + 1}</Tag>{m.moldName && <span style={{ fontWeight: 600 }}>{m.moldName}</span>}</Space>}
          extra={
            <Popconfirm title={`删除模具 #${i + 1}?`} onConfirm={() => delMold(i)}>
              <Button danger size="small">🗑 删模具</Button>
            </Popconfirm>
          }
        >
          <Space.Compact style={{ width: '100%', marginBottom: 8, display: 'flex' }}>
            <Input addonBefore="编号" value={m.moldId} onChange={(e) => patch(i, 'moldId', e.target.value)} style={{ flex: 1 }} />
            <Input addonBefore="名称" value={m.moldName} onChange={(e) => patch(i, 'moldName', e.target.value)} style={{ flex: 2 }} />
          </Space.Compact>
          <Space.Compact style={{ width: '100%', marginBottom: 8, display: 'flex' }}>
            <Input addonBefore="用料名称" value={m.materialName} placeholder="ABS PA-757 / TPE 50° 本白" onChange={(e) => patch(i, 'materialName', e.target.value)} style={{ flex: 2 }} />
            <Input addonBefore="颜色" value={m.colorName} onChange={(e) => patch(i, 'colorName', e.target.value)} style={{ flex: 1 }} />
            <Input addonBefore="色粉号" value={m.pigmentCode} onChange={(e) => patch(i, 'pigmentCode', e.target.value)} style={{ flex: 1 }} />
          </Space.Compact>
          <Space style={{ width: '100%', marginBottom: 12 }} size="small">
            <span>整啤净重(G):</span>
            <InputNumber value={m.netGramsPerShot} onChange={(v) => patch(i, 'netGramsPerShot', v ?? 0)} step={0.01} min={0} />
            <span style={{ color: '#c0392b', fontWeight: 600 }}>每啤套数 ⚠:</span>
            <InputNumber value={m.setsPerShot} onChange={(v) => patch(i, 'setsPerShot', v ?? 1)} step={1} min={1} />
            <span>车间:</span>
            <Select value={m.workshop} onChange={(v) => patch(i, 'workshop', v)} style={{ width: 100 }}
              options={[{ value: '', label: '—' }, ...WORKSHOPS.map(w => ({ value: w, label: w }))]} />
            <span>备注:</span>
            <Input value={m.notes} onChange={(e) => patch(i, 'notes', e.target.value)} style={{ width: 180 }} />
          </Space>

          <PartsTable parts={m.parts ?? []} materialName={m.materialName ?? ''} onChange={(p) => patchParts(i, p)} />
        </Card>
      ))}
    </div>
  )
}

function PartsTable({ parts, materialName, onChange }: { parts: MoldingPart[]; materialName: string; onChange: (v: MoldingPart[]) => void }) {
  const defaultCategory = /搪胶/.test(materialName) ? '搪胶' : '塑胶'
  function patch(i: number, k: keyof MoldingPart, v: any) {
    onChange(parts.map((p, idx) => idx === i ? { ...p, [k]: v } : p))
  }
  function add() {
    onChange([...parts, { category: defaultCategory, partCode: '', partName: '', partNameEn: '', usage: 1, ejections: 1, netPerPc: 0, grossPerPc: 0 }])
  }
  function del(i: number) { onChange(parts.filter((_, idx) => idx !== i)) }

  return (
    <div style={{ background: '#fff', border: '1px solid #d6dbe2', borderRadius: 6, padding: 8 }}>
      <Space style={{ marginBottom: 8 }}>
        <Tag color="blue">🧩 塑胶件清单 ({parts.length})</Tag>
        <Button size="small" onClick={add}>＋ 加塑胶件</Button>
      </Space>
      <Table
        rowKey={(_, i) => String(i)}
        size="small"
        pagination={false}
        dataSource={parts}
        columns={[
          { title: '#', width: 40, render: (_v, _r, i) => i + 1 },
          { title: '图片', width: 70, render: (_v, r, i) => <MaterialImageCell imageId={r.image} onChange={(id) => patch(i, 'image', id)} /> },
          {
            title: '类别', width: 80,
            render: (_v, r, i) => (
              <Select size="small" value={r.category ?? defaultCategory} style={{ width: '100%' }}
                onChange={(v) => patch(i, 'category', v)}
                options={[{ value: '塑胶', label: '塑胶件' }, { value: '搪胶', label: '搪胶件' }]} />
            ),
          },
          { title: '件号', width: 130, render: (_v, r, i) => <Input size="small" value={r.partCode} onChange={(e) => patch(i, 'partCode', e.target.value)} /> },
          { title: '中文名', render: (_v, r, i) => <Input size="small" value={r.partName} onChange={(e) => patch(i, 'partName', e.target.value)} /> },
          { title: 'English', render: (_v, r, i) => <Input size="small" value={r.partNameEn} onChange={(e) => patch(i, 'partNameEn', e.target.value)} /> },
          { title: '中国 HS', width: 110, render: (_v, r, i) => <Input size="small" value={r.hsCN} onChange={(e) => patch(i, 'hsCN', e.target.value)} /> },
          { title: '印尼 HS', width: 110, render: (_v, r, i) => <Input size="small" value={r.hsID} onChange={(e) => patch(i, 'hsID', e.target.value)} /> },
          { title: '啤数', width: 70, render: (_v, r, i) => <InputNumber size="small" min={0} value={r.ejections} onChange={(v) => patch(i, 'ejections', v ?? 0)} style={{ width: '100%' }} /> },
          { title: '用量', width: 70, render: (_v, r, i) => <InputNumber size="small" min={0} value={r.usage} onChange={(v) => patch(i, 'usage', v ?? 0)} style={{ width: '100%' }} /> },
          { title: '毛重/件', width: 90, render: (_v, r, i) => <InputNumber size="small" step={0.0001} min={0} value={r.grossPerPc} onChange={(v) => patch(i, 'grossPerPc', v ?? 0)} style={{ width: '100%' }} /> },
          { title: '净重/件', width: 90, render: (_v, r, i) => <InputNumber size="small" step={0.0001} min={0} value={r.netPerPc} onChange={(v) => patch(i, 'netPerPc', v ?? 0)} style={{ width: '100%' }} /> },
          {
            title: '', width: 50,
            render: (_v, _r, i) => (
              <Popconfirm title="删除该塑胶件?" onConfirm={() => del(i)}>
                <a style={{ color: '#ff4d4f' }}>×</a>
              </Popconfirm>
            ),
          },
        ]}
      />
    </div>
  )
}

// ---------------- Materials editor (phase 2b) ----------------

function MaterialsEditor({ rows, onChange, dicts, productCode }: {
  rows: Material[]
  onChange: (rows: Material[]) => void
  dicts: Dictionaries
  productCode?: string
}) {
  const { message } = App.useApp()
  const fileRef = useRef<HTMLInputElement>(null)

  function patch(i: number, k: keyof Material, v: any) {
    onChange(rows.map((m, idx) => idx === i ? { ...m, [k]: v } : m))
  }
  function add() {
    onChange([
      ...rows,
      {
        product_code: productCode, item_no: '', name_zh: '', name_en: '', spec: '',
        category: '', supplier: '', hs_cn: '', hs_id: '',
        gross_per_pc: 0, net_per_pc: 0, qty_per_carton: 0, weight_per_carton: 0,
        unit_kg: 'KGM', active: true,
      },
    ])
  }
  function del(i: number) { onChange(rows.filter((_, idx) => idx !== i)) }

  function autoFillHs() {
    const dict = dicts.hs.filter(d => d.keyword)
    if (!dict.length) { message.warning('字典里没有 HS 关键字'); return }
    let filled = 0
    const next = rows.map((m) => {
      const name = m.name_zh || ''
      if (!name) return m
      const hit = dict.find(d => name.includes(d.keyword))
      if (!hit) return m
      // 字典即权威：命中即覆盖（含已填错的，如内置规则给的螺丝 HS）
      const newCn = hit.hsCN || m.hs_cn
      const newId = hit.hsID || m.hs_id
      if (newCn === m.hs_cn && newId === m.hs_id) return m
      filled++
      return { ...m, hs_cn: newCn, hs_id: newId }
    })
    onChange(next)
    message.success(`HS 自动填充：${filled} 行`)
  }
  function autoFillSupplier() {
    const dict = dicts.suppliers.filter(d => d.keyword)
    if (!dict.length) { message.warning('字典里没有供应商关键字'); return }
    let filled = 0
    const next = rows.map((m) => {
      const sup = (m.supplier || '').trim()
      if (!sup) return m
      const hit = dict.find(d => sup.includes(d.keyword) || d.keyword === sup || (d.full && sup.includes(d.full)))
      const newSup = hit?.full || sup
      // 报关公司也一并扩展：字典指定优先（可能是华胜益），否则保留原值，再否则默认用供应商本身
      const newCustoms = hit?.customs || m.customs_company || newSup
      if (newSup === m.supplier && newCustoms === m.customs_company) return m
      filled++
      return { ...m, supplier: newSup, customs_company: newCustoms }
    })
    onChange(next)
    message.success(`供应商/报关公司自动扩展：${filled} 行`)
  }

  async function importExcel(file: File) {
    try {
      const XLSX = await import('xlsx')
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      if (!ws) { message.error('Excel 无数据'); return }
      const arr = XLSX.utils.sheet_to_json<any>(ws, { defval: '' })
      const norm = (k: string) => k.replace(/\s+/g, '').toLowerCase()
      const pick = (row: any, names: string[]) => {
        for (const n of names) for (const k of Object.keys(row))
          if (norm(k) === norm(n)) return row[k]
        return undefined
      }
      const imported: Material[] = arr.map((r) => ({
        product_code: productCode,
        item_no:        String(pick(r, ['料号', 'itemno', 'item_no']) ?? ''),
        name_zh:        String(pick(r, ['中文名', '名称', 'namezh', 'name_zh']) ?? ''),
        name_en:        String(pick(r, ['英文名', 'nameen', 'name_en']) ?? ''),
        spec:           String(pick(r, ['规格', 'spec']) ?? ''),
        category:       inferMaterialCategory(`${pick(r, ['类别', 'category']) ?? ''} ${pick(r, ['中文名', '名称', 'namezh', 'name_zh']) ?? ''} ${pick(r, ['规格', 'spec']) ?? ''}`),
        material_code:  String(pick(r, ['物料编码', 'materialcode', 'material_code']) ?? ''),
        supplier:       String(pick(r, ['供应商', 'supplier']) ?? ''),
        customs_company:String(pick(r, ['报关公司', 'customs', 'customscompany', 'customs_company']) ?? ''),
        hs_cn:          String(pick(r, ['HSCN', '中国HS', 'hs_cn']) ?? ''),
        hs_id:          String(pick(r, ['HSID', '印尼HS', 'hs_id']) ?? ''),
        unit_kg:        String(pick(r, ['单位', 'unit', 'unitkg', 'unit_kg']) ?? 'KGM'),
        gross_per_pc:   Number(pick(r, ['毛重/件', '毛重', 'grossperpc']) ?? 0) || 0,
        net_per_pc:     Number(pick(r, ['净重/件', '净重', 'netperpc']) ?? 0) || 0,
        length:         Number(pick(r, ['长', 'length']) ?? 0) || 0,
        width:          Number(pick(r, ['宽', 'width']) ?? 0) || 0,
        height:         Number(pick(r, ['高', 'height']) ?? 0) || 0,
        qty_per_carton: Number(pick(r, ['件/箱', '装箱量', 'qtypercarton']) ?? 0) || 0,
        weight_per_carton: Number(pick(r, ['箱重', 'weightpercarton']) ?? 0) || 0,
        active: true,
      })).filter(m => m.name_zh || m.item_no || m.material_code)
      if (!imported.length) { message.warning('没识别到有效行 (需含 中文名 / 料号 列)'); return }
      onChange([...rows, ...imported])
      message.success(`已导入 ${imported.length} 行 — 别忘点 💾 保存`)
    } catch (e: any) {
      message.error('导入失败: ' + (e?.message ?? e))
    }
  }

  return (
    <div>
      <Space style={{ marginBottom: 8 }} wrap>
        <Button onClick={add}>＋ 新增物料</Button>
        <Button onClick={() => fileRef.current?.click()}>📥 Excel 导入</Button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) importExcel(f); e.target.value = '' }} />
        <Button onClick={autoFillHs}>🔍 HS 自动填充</Button>
        <Button onClick={autoFillSupplier}>🏭 供应商扩展</Button>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          字典: HS {dicts.hs.length} 条 / 供应商 {dicts.suppliers.length} 条
        </Typography.Text>
      </Space>
      <Table
        rowKey={(_, i) => String(i)}
        size="small"
        sticky
        pagination={false}
        dataSource={rows}
        rowClassName={(r) => r.active === false ? 'mat-row-inactive' : ''}
        scroll={{ x: 2760, y: 560 }}
        columns={[
          { title: '#', width: 45, align: 'center', fixed: 'left', render: (_v, _r, i) => <span style={{ color: '#999' }}>{i + 1}</span> },
          {
            title: '图片', width: 70, fixed: 'left',
            render: (_v, r, i) => (
              <MaterialImageCell imageId={r.image_id} onChange={(id) => patch(i, 'image_id', id)} />
            ),
          },
          { title: '料号', width: 100, fixed: 'left', render: (_v, r, i) => <Input size="small" value={r.item_no} onChange={(e) => patch(i, 'item_no', e.target.value)} /> },
          { title: '中文名', width: 240, fixed: 'left', render: (_v, r, i) => <Input size="small" value={r.name_zh} onChange={(e) => patch(i, 'name_zh', e.target.value)} /> },
          { title: '英文名', width: 200, render: (_v, r, i) => <Input size="small" value={r.name_en} onChange={(e) => patch(i, 'name_en', e.target.value)} /> },
          { title: '规格', width: 180, render: (_v, r, i) => <Input size="small" value={r.spec} onChange={(e) => patch(i, 'spec', e.target.value)} /> },
          { title: '类别', width: 130, render: (_v, r, i) => (
            <Select size="small" showSearch allowClear placeholder="选类别" style={{ width: '100%' }}
              value={r.category || undefined}
              options={MATERIAL_CATEGORIES.map(c => ({ value: c, label: c }))}
              onChange={(v) => patch(i, 'category', v ?? '')} />
          ) },
          { title: '物料编码', width: 130, render: (_v, r, i) => <Input size="small" value={r.material_code} onChange={(e) => patch(i, 'material_code', e.target.value)} /> },
          { title: '供应商', width: 200, render: (_v, r, i) => <Input size="small" value={r.supplier} onChange={(e) => patch(i, 'supplier', e.target.value)} /> },
          { title: '报关公司', width: 200, render: (_v, r, i) => {
            const opts = Array.from(new Set([
              CUSTOMS_FIXED,
              ...(r.supplier ? [r.supplier] : []),
              ...dicts.suppliers.map(s => s.customs || '').filter(Boolean),
              ...(r.customs_company ? [r.customs_company] : []),
            ])) as string[]
            return <Select size="small" showSearch allowClear placeholder="选报关公司" style={{ width: '100%' }}
              value={r.customs_company || undefined}
              options={opts.map(o => ({ value: o, label: o }))}
              onChange={(v) => patch(i, 'customs_company', v ?? '')} popupMatchSelectWidth={false} />
          } },
          { title: 'HS (CN)', width: 110, render: (_v, r, i) => <Input size="small" value={r.hs_cn} onChange={(e) => patch(i, 'hs_cn', e.target.value)} /> },
          { title: 'HS (ID)', width: 110, render: (_v, r, i) => <Input size="small" value={r.hs_id} onChange={(e) => patch(i, 'hs_id', e.target.value)} /> },
          { title: '用量', width: 80, render: (_v, r, i) => <InputNumber size="small" min={0} step={1} value={r.usage_qty ?? 1} onChange={(x) => patch(i, 'usage_qty', x ?? 0)} style={{ width: '100%' }} /> },
          { title: '单毛重', width: 90, render: (_v, r, i) => <InputNumber size="small" min={0} step={0.0001} value={r.gross_per_pc} onChange={(x) => patch(i, 'gross_per_pc', x ?? 0)} style={{ width: '100%' }} /> },
          { title: '单净重', width: 90, render: (_v, r, i) => <InputNumber size="small" min={0} step={0.0001} value={r.net_per_pc} onChange={(x) => patch(i, 'net_per_pc', x ?? 0)} style={{ width: '100%' }} /> },
          { title: '件/箱', width: 80, render: (_v, r, i) => <InputNumber size="small" min={0} value={r.qty_per_carton} onChange={(x) => patch(i, 'qty_per_carton', x ?? 0)} style={{ width: '100%' }} /> },
          { title: '箱重', width: 90, render: (_v, r, i) => <InputNumber size="small" min={0} step={0.0001} value={r.weight_per_carton} onChange={(x) => patch(i, 'weight_per_carton', x ?? 0)} style={{ width: '100%' }} /> },
          { title: '长', width: 70, render: (_v, r, i) => <InputNumber size="small" min={0} value={r.length} onChange={(x) => patch(i, 'length', x ?? 0)} style={{ width: '100%' }} /> },
          { title: '宽', width: 70, render: (_v, r, i) => <InputNumber size="small" min={0} value={r.width} onChange={(x) => patch(i, 'width', x ?? 0)} style={{ width: '100%' }} /> },
          { title: '高', width: 70, render: (_v, r, i) => <InputNumber size="small" min={0} value={r.height} onChange={(x) => patch(i, 'height', x ?? 0)} style={{ width: '100%' }} /> },
          { title: '单位', width: 90, render: (_v, r, i) => (
            <Select size="small" style={{ width: '100%' }} value={r.unit_kg || 'KGM'}
              options={['KGM', 'PCE', 'SET', 'TNE'].map(u => ({ value: u, label: u }))}
              onChange={(v) => patch(i, 'unit_kg', v)} />
          ) },
          {
            title: '状态', width: 80, align: 'center', fixed: 'right',
            render: (_v, r, i) => (
              <a onClick={() => patch(i, 'active', !(r.active !== false))}>
                {r.active === false ? <Tag>停用</Tag> : <Tag color="green">启用</Tag>}
              </a>
            ),
          },
          {
            title: '', width: 50, align: 'center', fixed: 'right',
            render: (_v, _r, i) => (
              <Popconfirm title="删除该物料?" onConfirm={() => del(i)}>
                <a style={{ color: '#ff4d4f', fontSize: 16 }}>×</a>
              </Popconfirm>
            ),
          },
        ]}
      />
      <style>{`.mat-row-inactive td { color: #999 !important; background: #fafafa !important; }`}</style>
    </div>
  )
}


function MaterialImageCell({ imageId, onChange }: { imageId?: string; onChange: (id?: string) => void }) {
  const { message } = App.useApp()
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)

  async function handleFile(file: File) {
    setUploading(true)
    try {
      const { uploadImageFile } = await import('../utils/imageUpload')
      const id = await uploadImageFile(file, { maxDim: 400, quality: 0.75 })
      onChange(id)
      message.success('已上传')
    } catch (e: any) {
      message.error('上传失败: ' + (e?.message ?? e))
    } finally {
      setUploading(false)
    }
  }
  function clear() { onChange(undefined) }
  // /api/images/{id} 返回 JSON {data_url}，需取出 data_url 当 <img src>（不能直接指到接口）
  const [src, setSrc] = useState('')
  useEffect(() => {
    let cancelled = false
    if (!imageId) { setSrc(''); return }
    api.get<{ data_url?: string }>(`/images/${encodeURIComponent(imageId)}`)
      .then(r => { if (!cancelled) setSrc(r.data?.data_url || '') })
      .catch(() => { if (!cancelled) setSrc('') })
    return () => { cancelled = true }
  }, [imageId])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      {imageId ? (
        <img
          src={src}
          alt=""
          style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4, border: '1px solid #ddd', cursor: 'pointer' }}
          onClick={() => setPreviewOpen(true)}
          title="点击预览大图"
          onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0.3' }}
        />
      ) : (
        <div onClick={() => inputRef.current?.click()}
          style={{ width: 40, height: 40, border: '1px dashed #ccc', borderRadius: 4, color: '#bbb',
                   display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 11 }}
        >+图</div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
      />
      <div style={{ display: 'flex', gap: 2 }}>
        <a style={{ fontSize: 11 }} onClick={() => inputRef.current?.click()}>{uploading ? '上传中' : '换'}</a>
        {imageId && <a style={{ fontSize: 11, color: '#ff4d4f' }} onClick={clear}>×</a>}
      </div>
      {imageId && (
        <Drawer
          open={previewOpen}
          title="图片预览"
          onClose={() => setPreviewOpen(false)}
          width={520}
          destroyOnClose
        >
          <img src={src} alt="" style={{ width: '100%', objectFit: 'contain' }} />
        </Drawer>
      )}
    </div>
  )
}
