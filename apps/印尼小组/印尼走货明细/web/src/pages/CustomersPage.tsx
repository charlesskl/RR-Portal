import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Input, List, Popconfirm, Space, Switch, Typography, App } from 'antd'
import { api } from '../api/client'

interface CustomerRow { name: string; active: boolean }

export default function CustomersPage() {
  const { message } = App.useApp()
  const [items, setItems] = useState<CustomerRow[]>([])
  const [filter, setFilter] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [showInactive, setShowInactive] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get<CustomerRow[]>('/customers', { params: { detailed: true, includeInactive: showInactive } })
      setItems(Array.isArray(data) ? data : [])
    } finally { setLoading(false) }
  }, [showInactive])
  useEffect(() => { load() }, [load])

  async function add() {
    const n = name.trim()
    if (!n) return message.warning('请输入客人名称')
    if (items.some(i => i.name === n)) return message.warning('客人已存在')
    await api.post('/customers', { name: n })
    setName(''); message.success('已添加'); load()
  }

  async function deactivate(n: string) { try { await api.delete(`/customers/${encodeURIComponent(n)}`); message.success('已停用'); load() } catch {} }
  async function restore(n: string) { try { await api.post(`/customers/${encodeURIComponent(n)}/restore`); message.success('已启用'); load() } catch {} }
  async function hardDel(n: string) { try { await api.delete(`/customers/${encodeURIComponent(n)}?hard=true`); message.success('已彻底删除'); load() } catch {} }

  const filtered = items.filter(i => !filter || i.name.toLowerCase().includes(filter.toLowerCase()))

  return (
    <div style={{ padding: 16 }}>
      <Card
        title={<Typography.Title level={4} style={{ margin: 0 }}>客户管理 — 共 {items.length} 位</Typography.Title>}
        extra={
          <Space>
            <Input.Search allowClear placeholder="搜索" style={{ width: 200 }}
              onSearch={setFilter} onChange={(e) => !e.target.value && setFilter('')} />
            <Switch checkedChildren="含停用" unCheckedChildren="仅启用" checked={showInactive} onChange={setShowInactive} />
            <Input placeholder="新增客人名称" value={name} onChange={(e) => setName(e.target.value)}
              onPressEnter={add} style={{ width: 220 }} />
            <Button type="primary" onClick={add}>➕ 添加</Button>
            <Button onClick={load}>🔄 刷新</Button>
          </Space>
        }
      >
        <List
          loading={loading}
          bordered
          dataSource={filtered}
          rowKey="name"
          locale={{ emptyText: items.length ? '无匹配项' : '暂无客人' }}
          renderItem={(row) => (
            <List.Item
              style={row.active === false ? { color: '#999', background: '#fafafa' } : undefined}
              actions={[
                row.active === false
                  ? <a key="restore" onClick={() => restore(row.name)}>启用</a>
                  : <Popconfirm key="deact" title={`停用客户 "${row.name}"?（可随时启用）`} onConfirm={() => deactivate(row.name)}>
                      <a>停用</a>
                    </Popconfirm>,
                <Popconfirm key="hard" title={`彻底删除 "${row.name}"?`} onConfirm={() => hardDel(row.name)}>
                  <a style={{ color: '#ff4d4f' }}>彻底删除</a>
                </Popconfirm>,
              ]}
            >
              {row.name}{row.active === false && <span style={{ marginLeft: 8, fontSize: 12, color: '#bbb' }}>[已停用]</span>}
            </List.Item>
          )}
        />
      </Card>
    </div>
  )
}
