import { useEffect, useMemo, useState } from 'react'
import { AutoComplete, Button, Card, Form, Grid, Input, Modal, Popconfirm, Space, Table, Tag, message } from 'antd'
import { api, type Dictionaries, type SupplierDict } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { supplierSummaryRows, HUASHENGYI_FULL_NAME, supplierCustomsCompany } from '../utils/supplierProfiles'
import { sortSuppliersByDisplayName, supplierFilterOptions, supplierFilterValue, type SupplierFilterField } from '../utils/supplierFilters'

type SupplierUsage = { type: string; id: number; document: string | null; productCode: string | null; materialCode: string | null; materialName: string | null; supplier: string | null }
type SupplierUsageReport = { name: string; total: number; usages: SupplierUsage[]; truncated: boolean }

const profileFields: Array<{ name: keyof SupplierDict; label: string }> = [
  { name: 'full', label: '公司中文名称' },
  { name: 'nameEn', label: '公司英文名称' },
  { name: 'addressZh', label: '中文地址' },
  { name: 'addressEn', label: '英文地址' },
  { name: 'phone', label: '电话' },
  { name: 'email', label: '邮箱' },
  { name: 'contact', label: '联系人' },
]

export default function SupplierSummaryPage() {
  const auth = useAuth()
  const screens = Grid.useBreakpoint()
  const [rows, setRows] = useState<SupplierDict[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [columnFilters, setColumnFilters] = useState<Partial<Record<SupplierFilterField, string[]>>>({})
  const [editing, setEditing] = useState<SupplierDict | null>(null)
  const [open, setOpen] = useState(false)
  const [usageReport, setUsageReport] = useState<SupplierUsageReport | null>(null)
  const [form] = Form.useForm<SupplierDict>()
  const companyName = Form.useWatch('full', form)?.trim() || ''

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get<Dictionaries>('/dictionaries')
      setRows(data.suppliers || [])
    } catch (e: any) { message.error('加载供应商失败：' + (e?.message || e)) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  const companies = rows
  const columnFilter = (field: SupplierFilterField) => ({
    key: field,
    filters: supplierFilterOptions(companies, field),
    filterSearch: true,
    filterMultiple: true,
    filteredValue: columnFilters[field] || null,
    onFilter: (value: unknown, row: SupplierDict) => supplierFilterValue(row, field) === String(value),
  })
  const filtered = useMemo(() => sortSuppliersByDisplayName(supplierSummaryRows(companies)).filter(r =>
    [r.keyword, r.full, r.nameEn, r.contact, supplierCustomsCompany(r), r.seller.full, r.seller.nameEn, r.seller.contact]
      .some(x => (x || '').toLowerCase().includes(search.toLowerCase()))
  ), [companies, search])

  function edit(row: SupplierDict) {
    setEditing(row)
    form.setFieldsValue({ ...row, customs: supplierCustomsCompany(row) })
    setOpen(true)
  }

  function add() {
    setEditing(null)
    form.resetFields()
    setOpen(true)
  }

  async function save() {
    const values = await form.validateFields()
    const full = values.full?.trim() || ''
    const payload: SupplierDict = {
      ...values,
      full,
      keyword: values.keyword?.trim() || full,
      customs: values.customs?.trim() || full,
    }
    setLoading(true)
    try {
      if (editing?.id) await api.put(`/dictionaries/suppliers/${editing.id}`, payload)
      else await api.post('/dictionaries/suppliers', payload)
      message.success('供应商资料已保存')
      setOpen(false)
      setEditing(null)
      await load()
    } catch (e: any) { message.error(e?.response?.data?.error || '保存失败：' + (e?.message || e)) }
    finally { setLoading(false) }
  }

  async function remove(row: SupplierDict) {
    if (!row.id) return
    setLoading(true)
    try {
      await api.delete(`/dictionaries/suppliers/${row.id}`, { skipErrorToast: true } as any)
      message.success('已删除供应商')
      await load()
    } catch (e: any) {
      const data = e?.response?.data
      if (e?.response?.status === 409 && Array.isArray(data?.usages)) {
        setUsageReport({ ...data, name: supplierFilterValue(row, 'displayName') })
      } else message.error(data?.error || '删除失败：' + (e?.message || e))
    }
    finally { setLoading(false) }
  }

  return <div style={{ padding: 16 }}>
    <Card styles={{ title: { whiteSpace: 'normal' } }} title={<div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, paddingBlock: 12 }}>
      <span style={{ marginInlineEnd: 'auto' }}>{`供应商汇总（${companies.length} 家）`}</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, maxWidth: '100%', fontWeight: 400 }}>
      <Input.Search allowClear value={search} placeholder="搜索供应商、报关公司、合同公司或联系人" style={{ width: 360, maxWidth: '100%' }} onChange={e => setSearch(e.target.value)} />
      <Button onClick={() => { setSearch(''); setColumnFilters({}) }}>重置筛选</Button>
      <Button onClick={load} loading={loading}>刷新</Button>
      <Button type="primary" disabled={!auth.canEdit('products')} onClick={add}>新增供应商</Button>
      </div>
    </div>}>
      <p style={{ color: '#666' }}>供应商显示名称与合同卖方分开显示。报关公司选择华胜益时，合同使用华胜益档案；其他情况使用供应商档案。合同地址及联系方式随卖方档案带出，需修改华胜益资料时请编辑华胜益档案。</p>
      <Table<(typeof filtered)[number]> rowKey={r => r.id || r.keyword} loading={loading} dataSource={filtered} scroll={{ x: 2400 }}
        locale={{ filterConfirm: '确定', filterReset: '重置', filterSearchPlaceholder: '搜索选项' }}
        onChange={(_pagination, filters) => setColumnFilters({
          displayName: filters.displayName?.map(String),
          customsCompany: filters.customsCompany?.map(String),
        })}
        pagination={{ defaultPageSize: 30 }} columns={[
          { title: '供应商显示名称（拼音 A–Z）', width: 220, fixed: screens.md ? 'left' : undefined, ...columnFilter('displayName'), render: (_: unknown, r) => supplierFilterValue(r, 'displayName') },
          { title: '对应报关公司', width: 260, ...columnFilter('customsCompany'), render: (_: unknown, r) => supplierCustomsCompany(r) },
          { title: '合同中文公司名', dataIndex: ['seller', 'full'], width: 260 },
          { title: '合同英文公司名', dataIndex: ['seller', 'nameEn'], width: 260 },
          { title: '合同中文地址', dataIndex: ['seller', 'addressZh'], width: 240, ellipsis: true },
          { title: '合同英文地址', dataIndex: ['seller', 'addressEn'], width: 260, ellipsis: true },
          { title: '合同电话', dataIndex: ['seller', 'phone'], width: 140 },
          { title: '合同邮箱', dataIndex: ['seller', 'email'], width: 210 },
          { title: '合同联系人', dataIndex: ['seller', 'contact'], width: 140 },
          { title: '合同资料', width: 100, render: (_: unknown, r) =>
            profileFields.every(f => String(r.seller[f.name] || '').trim()) ? <Tag color="green">齐全</Tag> : <Tag color="orange">待补充</Tag> },
          { title: '操作', width: 130, fixed: screens.md ? 'right' : undefined, render: (_: unknown, r: SupplierDict) => <Space size={0}>
            <Button type="link" disabled={!auth.canEdit('products')} onClick={() => edit(r)}>编辑</Button>
            <Popconfirm title="删除该供应商？" description="被物料、采购单或走货资料占用时不能删除，将显示占用明细。" onConfirm={() => remove(r)}>
              <Button type="link" danger disabled={!auth.canEdit('products')}>删除</Button>
            </Popconfirm>
          </Space> },
        ]} />
    </Card>
    <Modal title="无法删除供应商" open={!!usageReport} width={1100}
      styles={{ body: { maxHeight: '65vh', overflowY: 'auto', overflowWrap: 'anywhere' } }}
      onCancel={() => setUsageReport(null)} footer={<Button onClick={() => setUsageReport(null)}>知道了</Button>}>
      <p style={{ marginBottom: 8 }}>供应商：{usageReport?.name || '（未填写）'}</p>
      <p>该供应商共被 {usageReport?.total || 0} 条资料占用，请先核对并在对应资料中处理供应商关联，再尝试删除。历史资料也会检查，本次未删除或修改任何资料。</p>
      {usageReport?.truncated && <p>每类最多显示前 100 条；处理后重新尝试删除可查看剩余占用。</p>}
      <Table<SupplierUsage> size="small" rowKey={r => `${r.type}-${r.id}`} dataSource={usageReport?.usages || []}
        tableLayout="fixed" scroll={{ x: 1000, y: 'min(40vh, 420px)' }} pagination={{ pageSize: 10, showSizeChanger: false, responsive: true }} columns={[
          { title: '占用位置', dataIndex: 'type', width: 100 },
          { title: '记录 ID', dataIndex: 'id', width: 85 },
          { title: '单号 / 柜号', dataIndex: 'document', width: 180 },
          { title: '货号', dataIndex: 'productCode', width: 120 },
          { title: '物料编码', dataIndex: 'materialCode', width: 120 },
          { title: '物料名称', dataIndex: 'materialName', width: 180 },
          { title: '资料中的供应商', dataIndex: 'supplier', width: 200 },
        ]} />
    </Modal>
    <Modal title={editing ? `编辑供应商：${editing.full || ''}` : '新增供应商'} open={open} onCancel={() => setOpen(false)}
      onOk={save} okText="保存" confirmLoading={loading} destroyOnHidden>
      <Form form={form} layout="vertical">
        <Form.Item name="keyword" label="供应商显示名称" extra="显示名称不能重复；公司中文名称可以相同。留空时使用公司中文名称。">
          <Input maxLength={128} placeholder="请输入供应商显示名称" />
        </Form.Item>
        <p style={{ color: '#666' }}>以下维护本供应商档案。华胜益报关时，合同信息从华胜益档案读取，不会覆盖本供应商资料。</p>
        {profileFields.map(f => <Form.Item key={f.name} name={f.name} label={f.label}
          rules={f.name === 'full' ? [{ required: true, whitespace: true, message: '请填写' }] : f.name === 'email' ? [{ type: 'email', warningOnly: true }] : undefined}>
          <Input.TextArea autoSize={f.name === 'addressZh' || f.name === 'addressEn' ? { minRows: 2, maxRows: 4 } : { minRows: 1, maxRows: 1 }} />
        </Form.Item>)}
        <Form.Item name="customs" label="报关公司" rules={[{ required: true, whitespace: true, message: '请选择或填写报关公司' }]}
          extra="可选择快捷项，也可直接输入其他报关公司全称。物料明细选择该供应商后会自动带入此项。">
          <AutoComplete placeholder="请选择或输入报关公司" options={[
            ...(companyName ? [{ value: companyName, label: `本公司（${companyName}）` }] : []),
            { value: HUASHENGYI_FULL_NAME, label: `华胜益（${HUASHENGYI_FULL_NAME}）` },
          ]} />
        </Form.Item>
      </Form>
    </Modal>
  </div>
}
