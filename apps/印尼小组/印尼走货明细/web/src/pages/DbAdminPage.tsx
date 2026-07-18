import { useEffect, useState } from 'react'
import { Button, Card, Space, Table, Tag, message, Popconfirm, Modal, Form, Input, InputNumber, Select, DatePicker } from 'antd'
import dayjs from 'dayjs'
import { api } from '../api/client'

interface TableInfo { table: string; count: number }
interface ColumnInfo { name: string; type: string; pk: boolean; nn: boolean }

export default function DbAdminPage() {
  const [tables, setTables] = useState<TableInfo[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [rows, setRows] = useState<any[]>([])
  const [columns, setColumns] = useState<ColumnInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [editRow, setEditRow] = useState<any | null>(null)
  const [editMode, setEditMode] = useState<'create' | 'update'>('create')
  const [form] = Form.useForm()

  async function loadTables() {
    setLoading(true)
    try {
      const { data } = await api.get<TableInfo[]>('/db')
      setTables(data)
    } finally { setLoading(false) }
  }
  useEffect(() => { loadTables() }, [])

  async function loadTable(t: string) {
    setActive(t); setLoading(true)
    try {
      const { data } = await api.get<{ rows: any[]; columns: ColumnInfo[]; total: number }>(`/db/${t}`, { params: { limit: 500, offset: 0 } })
      setRows(data.rows); setColumns(data.columns)
    } finally { setLoading(false) }
  }

  function pkCol(): ColumnInfo | undefined { return columns.find(c => c.pk) ?? columns[0] }

  function openCreate() {
    setEditMode('create'); setEditRow({}); form.resetFields()
  }
  function openEdit(row: any) {
    setEditMode('update'); setEditRow(row); form.resetFields()
    setTimeout(() => form.setFieldsValue(row), 0)
  }

  async function saveRow() {
    if (!active) return
    const v = await form.validateFields()
    if (editMode === 'create') {
      await api.post(`/db/${active}`, v)
    } else {
      const pk = pkCol()?.name ?? 'id'
      await api.put(`/db/${active}/${encodeURIComponent(editRow[pk])}`, v)
    }
    message.success('已保存')
    setEditRow(null); loadTable(active); loadTables()
  }

  async function delRow(row: any) {
    if (!active) return
    const pk = pkCol()?.name ?? 'id'
    await api.delete(`/db/${active}/${encodeURIComponent(row[pk])}`)
    message.success('已删除'); loadTable(active); loadTables()
  }

  async function truncate() {
    if (!active) return
    await api.delete(`/db/${active}`, { params: { confirm: 'YES' } })
    message.success('已清空'); loadTable(active); loadTables()
  }

  const tableCols = columns.map(c => ({
    title: <span>{c.name}{c.pk && <Tag color="gold" style={{ marginLeft: 4 }}>PK</Tag>}</span>,
    dataIndex: c.name,
    ellipsis: true,
    render: (v: any) => {
      if (v === null || v === undefined) return <span style={{ color: '#bbb' }}>NULL</span>
      const s = typeof v === 'string' ? v : JSON.stringify(v)
      return s.length > 80 ? s.slice(0, 80) + '…' : s
    },
  }))

  return (
    <div style={{ padding: 16, display: 'flex', gap: 16 }}>
      <Card title="表" style={{ width: 240 }} size="small" extra={<Button size="small" onClick={loadTables}>刷新</Button>}>
        <Table
          rowKey="table"
          size="small"
          showHeader={false}
          pagination={false}
          dataSource={tables}
          loading={loading && !active}
          onRow={(r) => ({ onClick: () => loadTable(r.table), style: { cursor: 'pointer', background: active === r.table ? '#e6f4ff' : undefined } })}
          columns={[
            { dataIndex: 'table' },
            { dataIndex: 'count', width: 70, align: 'right', render: (v) => <span style={{ color: '#999' }}>{v}</span> },
          ]}
        />
      </Card>

      <Card
        style={{ flex: 1 }}
        title={active ? `${active}（${rows.length} 行）` : '请选择左侧表'}
        extra={active && (
          <Space>
            <Button onClick={() => loadTable(active)}>刷新</Button>
            <Button onClick={openCreate}>➕ 新增</Button>
            <Popconfirm title={`清空 ${active}? 不可恢复！`} onConfirm={truncate}>
              <Button danger>🗑 清空表</Button>
            </Popconfirm>
          </Space>
        )}
      >
        {active && (
          <Table
            rowKey={(_, i) => String(i)}
            size="small"
            scroll={{ x: 'max-content' }}
            loading={loading}
            dataSource={rows}
            pagination={{ defaultPageSize: 50, showSizeChanger: true }}
            columns={[
              ...tableCols,
              {
                title: '操作', width: 130, fixed: 'right',
                render: (_v, row) => (
                  <Space>
                    <a onClick={() => openEdit(row)}>编辑</a>
                    <Popconfirm title="删除该行?" onConfirm={() => delRow(row)}>
                      <a style={{ color: '#ff4d4f' }}>删除</a>
                    </Popconfirm>
                  </Space>
                ),
              },
            ]}
          />
        )}
      </Card>

      <Modal
        title={editMode === 'create' ? `新增 — ${active}` : `编辑 — ${active}`}
        open={editRow !== null}
        onCancel={() => setEditRow(null)}
        onOk={saveRow}
        width={640}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          {columns.filter(c => editMode === 'create' ? !c.pk || c.type === 'nvarchar' : true).map(c => {
            const label = <span>{c.name} <Tag>{c.type}</Tag>{c.pk && <Tag color="gold">PK</Tag>}{c.nn && <Tag color="red">NOT NULL</Tag>}</span>
            const disabled = editMode === 'update' && c.pk
            const kind = typeKind(c.type)
            if (kind === 'int' || kind === 'decimal') {
              return <Form.Item key={c.name} name={c.name} label={label}>
                <InputNumber style={{ width: '100%' }} disabled={disabled} />
              </Form.Item>
            }
            if (kind === 'bit') {
              return <Form.Item key={c.name} name={c.name} label={label}>
                <Select disabled={disabled} options={[{ value: 1, label: 'true (1)' }, { value: 0, label: 'false (0)' }]} allowClear />
              </Form.Item>
            }
            if (kind === 'date') {
              return <Form.Item key={c.name} name={c.name} label={label}
                getValueProps={(v) => ({ value: v ? dayjs(v) : null })}
                normalize={(v: any) => (v ? (v as ReturnType<typeof dayjs>).format('YYYY-MM-DD') : null)}>
                <DatePicker style={{ width: '100%' }} disabled={disabled} />
              </Form.Item>
            }
            return <Form.Item key={c.name} name={c.name} label={label}>
              <Input.TextArea autoSize={{ minRows: 1, maxRows: 6 }} disabled={disabled} />
            </Form.Item>
          })}
        </Form>
      </Modal>
    </div>
  )
}

function typeKind(t: string): 'int' | 'decimal' | 'bit' | 'date' | 'text' {
  const s = (t || '').toLowerCase()
  if (s === 'bit') return 'bit'
  if (['int', 'bigint', 'smallint', 'tinyint'].includes(s)) return 'int'
  if (['decimal', 'numeric', 'float', 'real', 'money', 'smallmoney'].includes(s)) return 'decimal'
  if (['date', 'datetime', 'datetime2', 'smalldatetime', 'datetimeoffset'].includes(s)) return 'date'
  return 'text'
}
