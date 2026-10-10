import { useEffect, useMemo, useState } from 'react'
import { AutoComplete, Button, Card, Form, Input, Modal, Popconfirm, Space, Table, Tag, message } from 'antd'
import { api, type Dictionaries, type SupplierDict } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { supplierSummaryRows, HUASHENGYI_FULL_NAME, supplierCustomsCompany } from '../utils/supplierProfiles'
import { supplierFilterOptions, supplierFilterValue, type SupplierFilterField } from '../utils/supplierFilters'

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
  const [rows, setRows] = useState<SupplierDict[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [columnFilters, setColumnFilters] = useState<Partial<Record<SupplierFilterField, string[]>>>({})
  const [editing, setEditing] = useState<SupplierDict | null>(null)
  const [open, setOpen] = useState(false)
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
  const filtered = useMemo(() => supplierSummaryRows(companies).filter(r =>
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
      await api.delete(`/dictionaries/suppliers/${row.id}`)
      message.success('已删除供应商')
      await load()
    } catch (e: any) { message.error(e?.response?.data?.error || '删除失败：' + (e?.message || e)) }
    finally { setLoading(false) }
  }

  return <div style={{ padding: 16 }}>
    <Card title={`供应商汇总（${companies.length} 家）`} extra={<Space>
      <Input.Search allowClear value={search} placeholder="搜索供应商、报关公司、合同公司或联系人" style={{ width: 360 }} onChange={e => setSearch(e.target.value)} />
      <Button onClick={() => { setSearch(''); setColumnFilters({}) }}>重置筛选</Button>
      <Button onClick={load} loading={loading}>刷新</Button>
      <Button type="primary" disabled={!auth.canEdit('products')} onClick={add}>新增供应商</Button>
    </Space>}>
      <p style={{ color: '#666' }}>供应商显示名称与合同卖方分开显示。报关公司选择华胜益时，合同使用华胜益档案；其他情况使用供应商档案。合同地址及联系方式随卖方档案带出，需修改华胜益资料时请编辑华胜益档案。</p>
      <Table<(typeof filtered)[number]> rowKey={r => r.id || r.keyword} loading={loading} dataSource={filtered} scroll={{ x: 2400 }}
        locale={{ filterConfirm: '确定', filterReset: '重置', filterSearchPlaceholder: '搜索选项' }}
        onChange={(_pagination, filters) => setColumnFilters({
          displayName: filters.displayName?.map(String),
          customsCompany: filters.customsCompany?.map(String),
        })}
        pagination={{ defaultPageSize: 30 }} columns={[
          { title: '供应商显示名称', width: 220, fixed: 'left', ...columnFilter('displayName'), render: (_: unknown, r) => r.keyword || r.full },
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
          { title: '操作', width: 130, fixed: 'right', render: (_: unknown, r: SupplierDict) => <Space size={0}>
            <Button type="link" disabled={!auth.canEdit('products')} onClick={() => edit(r)}>编辑</Button>
            <Popconfirm title="删除该供应商？" description="已被物料或走货使用的供应商不能删除。" onConfirm={() => remove(r)}>
              <Button type="link" danger disabled={!auth.canEdit('products')}>删除</Button>
            </Popconfirm>
          </Space> },
        ]} />
    </Card>
    <Modal title={editing ? `编辑供应商：${editing.full || ''}` : '新增供应商'} open={open} onCancel={() => setOpen(false)}
      onOk={save} okText="保存" confirmLoading={loading} destroyOnHidden>
      <Form form={form} layout="vertical">
        <Form.Item name="keyword" label="供应商显示名称" extra="可填写简称，例如“台聚”；留空时使用公司中文名称，不改变合同公司全称。">
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
