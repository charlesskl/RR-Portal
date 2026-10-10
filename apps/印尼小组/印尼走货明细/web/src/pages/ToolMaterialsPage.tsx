import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Col, Form, Image, Input, InputNumber, Modal, Row, Select, Space, Switch, Table, Tag, Upload, message } from 'antd'
import { api, type Material, type Dictionaries, type HsDict } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { importIndonesiaMaterialFile } from '../utils/indonesiaMaterialImport'
import { mergeToolMaterial, planToolImport, toolKinds, type ToolImportRow } from '../utils/toolMaterialImport'
import { fileToDataUrl } from '../utils/imageUpload'
import { fillMissingToolHs, toolHsCandidates } from '../utils/toolHsMatch'
import { filterToolMaterials, toolFilterFields, toolFilterOptions, type ToolFilterField, type ToolFilters } from '../utils/toolMaterialFilters'
import { toolCurrencies } from '../utils/toolPrice'
import { toolImportDefaults } from '../utils/toolImportDefaults'
import { HUASHENGYI_FULL_NAME } from '../utils/supplierProfiles'
import { supplierCustomsCompany } from '../utils/supplierProfiles'
import SupplierProfileEditor from '../components/SupplierProfileEditor'

type HsPreview = { material: Material; candidates: HsDict[]; choice: number }

const kinds = toolKinds.map(value => ({ value, label: value }))
const textFields: [keyof Material, string][] = [
  ['name_zh', '中文名称'], ['name_en', '英文名称'], ['material_code', '物料编码'],
  ['related_product_code', '关联货号（可空，不进入产品 BOM）'], ['spec', '规格'], ['supplier', '供应商'],
  ['hs_cn', '中国 HS CODE'], ['hs_id', '印尼 HS CODE'], ['customs_company', '报关公司'],
]
const numberFields: [keyof Material, string][] = [
  ['gross_per_pc', '单件毛重（kg）'], ['net_per_pc', '单件净重（kg）'],
  ['length', '箱长（cm）'], ['width', '箱宽（cm）'], ['height', '箱高（cm）'],
  ['qty_per_carton', '每箱数量'], ['weight_per_carton', '每箱重量（kg）'],
]

export default function ToolMaterialsPage() {
  const auth = useAuth()
  const [rows, setRows] = useState<Material[]>([])
  const [companyNames, setCompanyNames] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [columnFilters, setColumnFilters] = useState<ToolFilters>({})
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<Material | null>(null)
  const [plans, setPlans] = useState<ToolImportRow[] | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [hsPreview, setHsPreview] = useState<HsPreview[] | null>(null)
  const [form] = Form.useForm()
  const draftImage = Form.useWatch('image', form)
  const draftSupplier = Form.useWatch('supplier', form)
  const draftCompany = Form.useWatch('customs_company', form)
  const companyOptions = [...new Set([
    HUASHENGYI_FULL_NAME, ...companyNames, draftSupplier, draftCompany,
    ...rows.flatMap(row => [row.customs_company, row.supplier]),
    ...(plans || []).flatMap(plan => [plan.incoming.customs_company, plan.incoming.supplier]),
  ].filter((value): value is string => typeof value === 'string' && !!value.trim()).map(value => value.trim()))]
    .sort((a, b) => a.localeCompare(b, 'zh-CN')).map(value => ({ value, label: value }))
  const editable = auth.canEdit('products')
  async function load() {
    setLoading(true)
    try { const { data } = await api.get<Material[]>('/materials/tools'); setRows(data); return data }
    finally { setLoading(false) }
  }
  useEffect(() => { void load().catch(() => {}) }, [])
  useEffect(() => {
    void api.get<Dictionaries>('/dictionaries').then(({ data }) => {
      setCompanyNames(data.suppliers.flatMap(supplier => [supplier.full || '', supplier.customs || '']))
    }).catch(() => { message.warning('公司字典未加载，仍可选择已有公司') })
  }, [])
  const filtered = useMemo(() => filterToolMaterials(rows, columnFilters, query), [rows, query, columnFilters])
  const filterOptions = useMemo(() => Object.fromEntries(toolFilterFields.map(field => [field, toolFilterOptions(rows, field)])), [rows])
  const columnFilter = (field: ToolFilterField) => ({
    key: field, filters: filterOptions[field], filterSearch: true, filteredValue: columnFilters[field] || [],
  })
  async function save(materials: Material[]) {
    if (materials.some(m => m.purchase_price != null && !m.purchase_currency)) {
      message.warning('有采购单价的物料必须选择币种'); return
    }
    setBusy(true)
    try {
      await api.put('/materials/tools', materials.map(m => ({
        ...m,
        ...Object.fromEntries(textFields.map(([key]) => [key, m[key] ?? ''])),
        ...Object.fromEntries(numberFields.map(([key]) => [key, m[key] ?? 0])),
        purchase_price: m.purchase_price ?? null,
        purchase_currency: m.purchase_currency || null,
        image: m.image === rows.find(r => r.id === m.id)?.image ? undefined : m.image,
      })))
      try {
        await api.post('/dictionaries/suppliers/sync', { entries: materials
          .filter(m => m.supplier?.trim())
          .map(m => ({ supplier: m.supplier!.trim(), customs: m.customs_company || '' })) })
      } catch {
        message.warning('物料已保存，但供应商汇总同步失败；请重试保存')
      }
      setEditing(null); setPlans(null)
      setHsPreview(null)
      message.success(`已保存 ${materials.length} 条工具及非生产物料`)
      await load()
    } finally { setBusy(false) }
  }
  function edit(m: Material) {
    setEditing(m)
    form.resetFields()
    form.setFieldsValue({ ...m, unit_kg: m.unit_kg || 'PCE', tool_kind: m.tool_kind || '工具', active: m.active !== false })
  }
  async function matchHs() {
    const ids = new Set(filtered.map(m => m.id))
    setBusy(true)
    try {
      const [current, dictionary] = await Promise.all([load(), api.get<Dictionaries>('/dictionaries')])
      const targets = current.filter(m => ids.has(m.id) && m.active !== false && (!m.hs_cn?.trim() || !m.hs_id?.trim()))
      if (!targets.length) { message.info('当前列表没有需要补充 HS CODE 的启用物料'); return }
      setHsPreview(targets.map(material => {
        const candidates = toolHsCandidates(material, dictionary.data.hs || [])
        return { material, candidates, choice: candidates.length === 1 ? 0 : -1 }
      }))
    } finally { setBusy(false) }
  }
  function confirmHs() {
    const selected = (hsPreview || []).filter(p => p.choice >= 0 && p.candidates[p.choice])
    if (!selected.length) { message.warning('请选择候选编码；未匹配的请人工填写或维护字典'); return }
    if (selected.length > 500) { message.warning('每次最多保存 500 条，请先缩小搜索范围'); return }
    void save(selected.map(p => fillMissingToolHs(p.material, p.candidates[p.choice]))).catch(() => {})
  }
  async function readFile(file: File) {
    if (file.size > 20 * 1024 * 1024) { message.error('文件超过 20MB，请分批导入'); return false }
    setBusy(true)
    try {
      const current = await load()
      const parsed = await importIndonesiaMaterialFile(file, true)
      const { data: dictionaries } = await api.get<Dictionaries>('/dictionaries')
      const notices = [...parsed.warnings]
      setPlans(planToolImport(current, parsed.groups.flatMap(g => g.materials)).map(p => {
        const merged = mergeToolMaterial(current.find(m => m.id === p.choice), p.incoming)
        const enriched = toolImportDefaults(merged, dictionaries)
        notices.push(...enriched.warnings)
        // Only fill missing incoming values; preserve existing records on blank imports.
        return { ...p, incoming: { ...p.incoming,
          customs_company: p.incoming.customs_company || (!merged.customs_company ? enriched.material.customs_company : undefined),
          name_en: p.incoming.name_en || (!merged.name_en ? enriched.material.name_en : undefined),
          hs_cn: p.incoming.hs_cn || (!merged.hs_cn ? enriched.material.hs_cn : undefined),
          hs_id: p.incoming.hs_id || (!merged.hs_id ? enriched.material.hs_id : undefined) } }
      }))
      setWarnings(notices)
    } catch (e) { message.error(e instanceof Error ? e.message : '导入识别失败') }
    finally { setBusy(false) }
    return false
  }
  function applyImport() {
    const selected = (plans || []).filter(p => p.choice !== 'skip')
    if (!selected.length) { message.warning('没有选择要导入的物料'); return }
    const ids = selected.filter(p => typeof p.choice === 'number').map(p => p.choice)
    if (new Set(ids).size !== ids.length) { message.warning('同一旧物料被重复选中，请调整'); return }
    const materials = selected.map(p => mergeToolMaterial(rows.find(r => r.id === p.choice), p.incoming))
    if (materials.some(m => !m.tool_kind)) { message.warning('请先确认每条物料的类别'); return }
    void save(materials).catch(() => {})
  }
  const changePlan = (index: number, change: Partial<ToolImportRow>) => setPlans(ps => ps!.map((p, i) => i === index ? { ...p, ...change } : p))
  return <Card title="工具及非生产物料" extra={<Space>
    <Button disabled={!editable || busy || loading} onClick={() => { void matchHs().catch(() => {}) }}>HS 自动匹配</Button>
    <Upload accept=".xlsx" showUploadList={false} beforeUpload={readFile} disabled={!editable || busy}>
      <Button disabled={!editable} loading={busy}>Excel 导入</Button>
    </Upload>
    <Button type="primary" disabled={!editable} onClick={() => edit({})}>新增物料</Button>
  </Space>}>
    <Alert type="info" showIcon message="独立工具资料库，保存资料、采购单价及币种；走货可直接选用并导出资料，无需关联采购、入库或出库。关联货号仅作参考。" style={{ marginBottom: 16 }} />
    <Space wrap style={{ marginBottom: 16 }}>
      <Input.Search placeholder="搜索名称 / 编码 / 关联货号 / 类别 / 供应商" allowClear value={query} onChange={e => setQuery(e.target.value)} style={{ width: 420, maxWidth: '100%' }} />
      <span>共 {filtered.length} 条</span>
      <Button onClick={() => { setColumnFilters({}); setQuery('') }}>重置筛选</Button>
    </Space>
    <Table rowKey="id" dataSource={filtered} loading={loading} scroll={{ x: 1400 }}
      onChange={(_, filters) => setColumnFilters(Object.fromEntries(toolFilterFields.map(field => [field, (filters[field] || []).map(String)])))} columns={[
      { title: '图片', ...columnFilter('image'), width: 90, render: (_, m) => m.image ? <Image width={44} height={44} style={{ objectFit: 'contain' }} src={m.image} /> : '—' },
      { title: '供应商', dataIndex: 'supplier', ...columnFilter('supplier') },
      { title: '报关公司', dataIndex: 'customs_company', ...columnFilter('customs_company') },
      { title: '类别', dataIndex: 'tool_kind', ...columnFilter('tool_kind'), width: 110 },
      { title: '中文名称', dataIndex: 'name_zh', ...columnFilter('name_zh') },
      { title: '规格', dataIndex: 'spec', ...columnFilter('spec') }, { title: '关联货号', dataIndex: 'related_product_code', ...columnFilter('related_product_code') },
      { title: '中国 HS CODE', dataIndex: 'hs_cn', ...columnFilter('hs_cn'), width: 150 }, { title: '印尼 HS CODE', dataIndex: 'hs_id', ...columnFilter('hs_id'), width: 150 },
      { title: '单位', dataIndex: 'unit_kg', ...columnFilter('unit_kg'), width: 90 },
      { title: '采购单价', dataIndex: 'purchase_price', ...columnFilter('purchase_price'), width: 120, render: value => value ?? '—' },
      { title: '币种', dataIndex: 'purchase_currency', ...columnFilter('purchase_currency'), width: 100, render: value => value || '—' },
      { title: '状态', ...columnFilter('active'), width: 100, render: (_, m) => <Tag color={m.active === false ? 'default' : 'green'}>{m.active === false ? '停用' : '启用'}</Tag> },
      { title: '物料编码', dataIndex: 'material_code', ...columnFilter('material_code') },
      { title: '操作', width: 80, render: (_, m) => <Button type="link" onClick={() => edit(m)}>{editable ? '编辑' : '查看'}</Button> },
    ]} />
    <Modal title="核对 HS 字典候选" open={hsPreview !== null} width={1100} okText="确认填入并保存"
      confirmLoading={busy} okButtonProps={{ disabled: !editable }} onOk={confirmHs}
      onCancel={() => { if (!busy) setHsPreview(null) }}>
      <Alert type="info" showIcon message="匹配当前搜索列表中缺少编码的启用物料。仅使用现有 HS 字典，候选不代表归类结论；多项匹配请自行选择。只补空白，已有编码保留；无匹配或与已有编码冲突时不自动填入。" />
      <Table style={{ marginTop: 12 }} size="small" pagination={false} scroll={{ y: 420 }}
        rowKey={p => p.material.id!} dataSource={hsPreview || []} columns={[
          { title: '物料 / 规格', render: (_, p) => <>{p.material.name_zh}<br />{p.material.spec}</> },
          { title: '现有中国 / 印尼编码', width: 180, render: (_, p) => <>{p.material.hs_cn || '—'}<br />{p.material.hs_id || '—'}</> },
          { title: '字典关键词 → 中国 / 印尼编码', width: 420, render: (_, p, index) => p.candidates.length ? <Select style={{ width: '100%' }}
            disabled={busy} value={p.choice} onChange={choice => setHsPreview(ps => ps!.map((x, i) => i === index ? { ...x, choice } : x))}
            options={[{ value: -1, label: '跳过，不填入' }, ...p.candidates.map((d, i) => ({ value: i, label: `${d.keyword} → ${d.hsCN || '—'} / ${d.hsID || '—'}` }))]} /> : '未匹配，请人工填写或维护字典' },
          { title: '保存后中国 / 印尼编码', width: 180, render: (_, p) => {
            const result = p.choice >= 0 ? fillMissingToolHs(p.material, p.candidates[p.choice]) : p.material
            return <>{result.hs_cn || '—'}<br />{result.hs_id || '—'}</>
          } },
        ]} />
    </Modal>
    <Modal title={editing?.id ? '编辑工具及非生产物料' : '新增工具及非生产物料'} open={!!editing} width={850}
      onCancel={() => { if (!busy) setEditing(null) }} confirmLoading={busy} okButtonProps={{ disabled: !editable }}
      onOk={() => { void form.validateFields().then(v => save([{ ...editing, ...v }])).catch(() => {}) }}>
      <Form form={form} layout="vertical" disabled={!editable || busy}>
        <Row gutter={16}>
          <Col span={24}>
            <Form.Item name="image" hidden><Input /></Form.Item>
            <Space style={{ marginBottom: 16 }}>
              {draftImage && <Image width={60} height={60} style={{ objectFit: 'contain' }} src={draftImage} />}
              <Upload accept="image/png,image/jpeg,image/gif,image/webp" showUploadList={false} disabled={!editable || busy} beforeUpload={async file => {
                if (file.size > 5 * 1024 * 1024) { message.error('图片不能超过 5MB'); return false }
                form.setFieldValue('image', await fileToDataUrl(file)); return false
              }}><Button disabled={!editable || busy}>选择 / 更换图片</Button></Upload>
            </Space>
          </Col>
          <Col span={8}><Form.Item name="tool_kind" label="类别" rules={[{ required: true }]}><Select options={kinds} /></Form.Item></Col>
          <Col span={8}><Form.Item name="unit_kg" label="走货单位" rules={[{ required: true }]}><Select options={['PCE', 'SET', 'KGM', 'TNE', 'MTR'].map(value => ({ value, label: value }))} /></Form.Item></Col>
          <Col span={8}><Form.Item name="active" label="启用" valuePropName="checked"><Switch /></Form.Item></Col>
          <Col span={12}><Form.Item name="purchase_price" label="采购单价"><InputNumber min={0} max={999999999} precision={6} style={{ width: '100%' }} /></Form.Item></Col>
          <Col span={12}><Form.Item name="purchase_currency" label="币种" dependencies={['purchase_price']}
            rules={[({ getFieldValue }) => ({ validator: (_, value) => getFieldValue('purchase_price') != null && !value ? Promise.reject(new Error('请选择币种')) : Promise.resolve() })]}>
            <Select allowClear placeholder="请选择，不自动推断" options={toolCurrencies} /></Form.Item></Col>
          {textFields.map(([key, label]) => <Col span={12} key={key}><Form.Item name={key} label={label} rules={key === 'name_zh' ? [{ required: true, whitespace: true }] : []}>{key === 'customs_company'
            ? <Select showSearch allowClear placeholder="选择报关公司" options={companyOptions} popupMatchSelectWidth={false} />
            : <Input maxLength={['related_product_code', 'material_code', 'hs_cn', 'hs_id'].includes(key) ? 64 : 256} />}</Form.Item></Col>)}
          {numberFields.map(([key, label]) => <Col span={8} key={key}><Form.Item name={key} label={label}><InputNumber min={0} max={999999999} style={{ width: '100%' }} /></Form.Item></Col>)}
          <Col span={24}><SupplierProfileEditor name={draftSupplier || ''} disabled={!editable} onSaved={(profile) => {
            form.setFieldsValue({ supplier: profile.full || profile.keyword, customs_company: supplierCustomsCompany(profile) })
            setCompanyNames(current => [...current, profile.full || '', supplierCustomsCompany(profile)])
            void load()
          }} /></Col>
        </Row>
      </Form>
    </Modal>
    <Modal title="核对工具物料导入" open={!!plans} width={1200} confirmLoading={busy} okText="确认并保存"
      onCancel={() => { if (!busy) setPlans(null) }} onOk={applyImport}>
      <Alert type="info" showIcon message="导入档案、包装基准及采购单价/币种，不导入采购单号、日期、需求数量及箱号，不生成业务单据。文件未写币种时请确认；空白不覆盖旧资料。" />
      {warnings.length > 0 && <Alert type="warning" style={{ marginTop: 8 }} message={<details><summary>有 {warnings.length} 项提示，点击查看</summary>{warnings.map((w, i) => <div key={i}>{w}</div>)}</details>} />}
      <Space style={{ margin: '12px 0' }}>
        <span>新增 {(plans || []).filter(p => p.choice === 'new').length} / 更新 {(plans || []).filter(p => typeof p.choice === 'number').length} / 跳过 {(plans || []).filter(p => p.choice === 'skip').length}</span>
        <Button disabled={busy} onClick={() => setPlans(ps => ps!.map(p => ({ ...p, choice: 'skip' })))}>全部跳过</Button>
        <Button disabled={busy} onClick={() => setPlans(ps => planToolImport(rows, ps!.map(p => p.incoming)))}>恢复自动匹配</Button>
        <Select placeholder="未注明币种统一设为" style={{ width: 220 }} options={toolCurrencies} disabled={busy} value={null}
          onChange={purchase_currency => setPlans(ps => ps!.map(p => {
            const merged = mergeToolMaterial(rows.find(r => r.id === p.choice), p.incoming)
            return merged.purchase_currency ? p : { ...p, incoming: { ...p.incoming, purchase_currency } }
          }))} />
      </Space>
      <Table size="small" dataSource={plans || []} rowKey={(_, i) => String(i)} pagination={false} scroll={{ y: 420 }} columns={[
        { title: '图片', width: 60, render: (_, p) => p.incoming.image ? <Image width={40} src={p.incoming.image} /> : '—' },
        { title: '导入物料 / 规格 / 关联货号', render: (_, p) => <>{p.incoming.name_zh}<br />{p.incoming.spec || '未填规格'} · {p.incoming.related_product_code || '无关联货号'}<br />{p.incoming.supplier}</> },
        { title: '单位 / 单件毛重 / 净重 (kg)', width: 155, render: (_, p) => <>{p.incoming.unit_kg || 'PCE'}<br />{p.incoming.gross_per_pc ?? '—'} / {p.incoming.net_per_pc ?? '—'}</> },
        { title: '报关公司 / 英文名 / HS（中 / 印尼）', width: 240, render: (_, p, i) => <>
          <Select showSearch allowClear style={{ width: '100%' }} placeholder="选择报关公司" value={p.incoming.customs_company || undefined} disabled={busy}
            options={companyOptions} popupMatchSelectWidth={false}
            onChange={value => changePlan(i, { incoming: { ...p.incoming, customs_company: value || '' } })} />
          {p.incoming.name_en || '—'}<br />{p.incoming.hs_cn || '—'} / {p.incoming.hs_id || '—'}
        </> },
        { title: '采购单价 / 币种', width: 165, render: (_, p, i) => {
          const merged = mergeToolMaterial(rows.find(r => r.id === p.choice), p.incoming)
          return <>{merged.purchase_price ?? '—'}<br /><Select style={{ width: 150 }} placeholder="请选择币种" options={toolCurrencies}
            disabled={busy} value={merged.purchase_currency} onChange={purchase_currency => changePlan(i, { incoming: { ...p.incoming, purchase_currency } })} /></>
        } },
        { title: '类别', width: 120, render: (_, p, i) => <Select placeholder="请选择" value={p.incoming.tool_kind} disabled={busy} options={kinds} style={{ width: 100 }} onChange={tool_kind => changePlan(i, { incoming: { ...p.incoming, tool_kind } })} /> },
        { title: '处理方式', width: 400, render: (_, p, i) => <Select style={{ width: '100%' }} value={p.choice} disabled={busy} onChange={choice => changePlan(i, { choice })} options={[
          { value: 'skip', label: '跳过，不导入' }, { value: 'new', label: '作为新物料添加' },
          ...p.candidates.map(m => ({ value: m.id!, label: `更新 #${m.id} ${m.name_zh} / ${m.spec || '无规格'} / ${m.related_product_code || '无货号'} / ${m.supplier || '无供应商'}` })),
        ]} /> },
      ]} />
    </Modal>
  </Card>
}
