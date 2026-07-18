import { DeleteOutlined, EditOutlined, KeyOutlined, PlusOutlined } from '@ant-design/icons'
import { App, Button, Card, Form, Input, Modal, Popconfirm, Radio, Space, Switch, Table, Tag, Typography } from 'antd'
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { PERMISSION_MODULES } from '../auth/permissions'

interface UserRow {
  id: number
  username: string
  displayName: string
  userbqrpower: string
  usereditpower: string
  isActive: boolean
  createdAt: string
}
type Level = 'none' | 'read' | 'edit'

function levelsFrom(u?: UserRow): Record<string, Level> {
  return Object.fromEntries(PERMISSION_MODULES.map(m => {
    const edit = m.positions.every(p => u?.usereditpower?.[p] === '1')
    const access = m.positions.every(p => u?.userbqrpower?.[p] === '1')
    return [m.key, edit ? 'edit' : access ? 'read' : 'none']
  }))
}

function powersFrom(levels: Record<string, Level>) {
  const access = Array(9).fill('0'), edit = Array(9).fill('0')
  for (const m of PERMISSION_MODULES) {
    const level = levels[m.key] || 'none'
    for (const p of m.positions) {
      if (level !== 'none') access[p] = '1'
      if (level === 'edit') edit[p] = '1'
    }
  }
  return { userbqrpower: access.join(''), usereditpower: edit.join('') }
}

export default function UsersPage() {
  const { message } = App.useApp()
  const [rows, setRows] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<UserRow | null>(null)
  const [levels, setLevels] = useState<Record<string, Level>>(() => levelsFrom())
  const [form] = Form.useForm()

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get('/users', { params: { page: 1, pageSize: 500 } })
      setRows(data.items || [])
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  function showCreate() {
    setEditing(null); setLevels(levelsFrom()); form.resetFields(); form.setFieldsValue({ isActive: true }); setOpen(true)
  }
  function showEdit(u: UserRow) {
    setEditing(u); setLevels(levelsFrom(u)); form.setFieldsValue({ displayName: u.displayName, isActive: u.isActive }); setOpen(true)
  }
  async function save() {
    const v = await form.validateFields()
    const powers = powersFrom(levels)
    if (editing) await api.put(`/users/${editing.id}`, { displayName: v.displayName, isActive: v.isActive, ...powers })
    else await api.post('/users', { username: v.username, password: v.password, displayName: v.displayName, ...powers })
    message.success(editing ? '账户已更新' : '账户已创建'); setOpen(false); load()
  }
  async function resetPassword(u: UserRow) {
    let value = ''
    Modal.confirm({
      title: `重置 ${u.username} 的密码`,
      content: <Input.Password autoFocus placeholder="新密码（至少 6 位）" onChange={e => { value = e.target.value }} />,
      onOk: async () => {
        if (value.length < 6) { message.warning('新密码至少 6 位'); return Promise.reject() }
        await api.post(`/users/${u.id}/password`, { newPassword: value }); message.success('密码已重置')
      },
    })
  }
  async function remove(u: UserRow) { await api.delete(`/users/${u.id}`); message.success('账户已删除'); load() }

  return (
    <Card title="账户与权限管理" extra={<Button type="primary" icon={<PlusOutlined />} onClick={showCreate}>新增账户</Button>}>
      <Typography.Paragraph type="secondary">每个模块可设置为不可访问、只读或可编辑。只读账户可以查看和搜索，但所有新增、修改、删除操作都会被服务器拒绝。</Typography.Paragraph>
      <Table<UserRow> rowKey="id" loading={loading} dataSource={rows} pagination={false} columns={[
        { title: '用户名', dataIndex: 'username', width: 150 },
        { title: '显示名称', dataIndex: 'displayName', width: 180 },
        { title: '状态', width: 90, render: (_, r) => r.isActive ? <Tag color="success">启用</Tag> : <Tag>停用</Tag> },
        { title: '权限摘要', render: (_, r) => {
          const ls = levelsFrom(r)
          const edit = PERMISSION_MODULES.filter(m => ls[m.key] === 'edit').length
          const read = PERMISSION_MODULES.filter(m => ls[m.key] === 'read').length
          return <Space><Tag color="blue">可编辑 {edit}</Tag><Tag>只读 {read}</Tag></Space>
        } },
        { title: '操作', width: 260, render: (_, r) => <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => showEdit(r)}>编辑</Button>
          <Button size="small" icon={<KeyOutlined />} onClick={() => resetPassword(r)}>重置密码</Button>
          <Popconfirm title={`删除账户 ${r.username}？`} onConfirm={() => remove(r)}><Button size="small" danger icon={<DeleteOutlined />}>删除</Button></Popconfirm>
        </Space> },
      ]} />

      <Modal open={open} title={editing ? `编辑账户：${editing.username}` : '新增账户'} onCancel={() => setOpen(false)} onOk={save} width={760} destroyOnHidden>
        <Form form={form} layout="vertical">
          {!editing && <Form.Item name="username" label="用户名" rules={[{ required: true }]}><Input /></Form.Item>}
          {!editing && <Form.Item name="password" label="初始密码" rules={[{ required: true }, { min: 6, message: '至少 6 位' }]}><Input.Password /></Form.Item>}
          <Form.Item name="displayName" label="显示名称" rules={[{ required: true }]}><Input /></Form.Item>
          {editing && <Form.Item name="isActive" label="账户状态" valuePropName="checked"><Switch checkedChildren="启用" unCheckedChildren="停用" /></Form.Item>}
        </Form>
        <Typography.Title level={5}>模块权限</Typography.Title>
        <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, overflow: 'hidden' }}>
          {PERMISSION_MODULES.map((m, i) => <div key={m.key} style={{ display: 'grid', gridTemplateColumns: '1fr 360px', alignItems: 'center', padding: '11px 16px', borderTop: i ? '1px solid #f0f0f0' : undefined }}>
            <span>{m.name}</span>
            <Radio.Group value={levels[m.key]} onChange={e => setLevels(x => ({ ...x, [m.key]: e.target.value }))} optionType="button" buttonStyle="solid" options={[
              { label: '不可访问', value: 'none' }, { label: '只读', value: 'read' }, { label: '可编辑', value: 'edit' },
            ]} />
          </div>)}
        </div>
      </Modal>
    </Card>
  )
}
