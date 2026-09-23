import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, message } from 'antd'
import { api, type Dictionaries, type SupplierDict } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { canonicalSupplierProfiles, HUASHENGYI_FULL_NAME, supplierCustomsCompany } from '../utils/supplierProfiles'

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

  const companies = useMemo(() => canonicalSupplierProfiles(rows), [rows])
  const filtered = useMemo(() => companies.filter(r =>
    [r.full, r.nameEn, r.contact].some(x => (x || '').toLowerCase().includes(search.toLowerCase()))
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
      keyword: editing?.keyword?.trim() || full,
      customs: values.customs === HUASHENGYI_FULL_NAME ? HUASHENGYI_FULL_NAME : full,
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
      <Input.Search allowClear placeholder="搜索公司名或联系人" style={{ width: 300 }} onChange={e => setSearch(e.target.value)} />
      <Button onClick={load} loading={loading}>刷新</Button>
      <Button type="primary" disabled={!auth.canEdit('products')} onClick={add}>新增供应商</Button>
    </Space>}>
      <p style={{ color: '#666' }}>在此维护供应商公司资料及默认报关公司。物料明细选择供应商后，会自动关联报关公司并用于合同、发票和装箱单。</p>
      <Table rowKey={r => r.id || r.keyword} loading={loading} dataSource={filtered} scroll={{ x: 1500 }}
        pagination={{ defaultPageSize: 30 }} columns={[
          { title: '公司中文名称', dataIndex: 'full', width: 240, fixed: 'left' },
          { title: '公司英文名称', dataIndex: 'nameEn', width: 240 },
          { title: '中文地址', dataIndex: 'addressZh', width: 240, ellipsis: true },
          { title: '英文地址', dataIndex: 'addressEn', width: 260, ellipsis: true },
          { title: '电话', dataIndex: 'phone', width: 140 },
          { title: '邮箱', dataIndex: 'email', width: 210 },
          { title: '联系人', dataIndex: 'contact', width: 140 },
          { title: '报关公司', width: 190, render: (_: unknown, r: SupplierDict) =>
            supplierCustomsCompany(r) === HUASHENGYI_FULL_NAME
              ? <Tag color="blue">华胜益</Tag>
              : <Tag color="green">本公司</Tag> },
          { title: '资料', width: 100, render: (_: unknown, r: SupplierDict) =>
            profileFields.every(f => String(r[f.name] || '').trim()) ? <Tag color="green">齐全</Tag> : <Tag color="orange">待补充</Tag> },
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
        {profileFields.map(f => <Form.Item key={f.name} name={f.name} label={f.label}
          rules={f.name === 'full' ? [{ required: true, whitespace: true, message: '请填写' }] : f.name === 'email' ? [{ type: 'email', warningOnly: true }] : undefined}>
          <Input.TextArea autoSize={f.name === 'addressZh' || f.name === 'addressEn' ? { minRows: 2, maxRows: 4 } : { minRows: 1, maxRows: 1 }} />
        </Form.Item>)}
        <Form.Item name="customs" label="报关公司" rules={[{ required: true, message: '请选择报关公司' }]}
          extra="物料明细选择该供应商后会自动带入此项。">
          <Select placeholder="请选择" options={[
            ...(companyName ? [{ value: companyName, label: `本公司（${companyName}）` }] : []),
            { value: HUASHENGYI_FULL_NAME, label: `华胜益（${HUASHENGYI_FULL_NAME}）` },
          ]} />
        </Form.Item>
      </Form>
    </Modal>
  </div>
}
