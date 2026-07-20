import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Input, InputNumber, Popconfirm, Space, Table, Tabs, message } from 'antd'
import { api, type Dictionaries, type HsDict, type SupplierDict } from '../api/client'

export default function DictionariesPage() {
  const [hs,  setHs]  = useState<HsDict[]>([])
  const [sup, setSup] = useState<SupplierDict[]>([])
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get<Dictionaries>('/dictionaries')
      setHs(data.hs ?? [])
      setSup(data.suppliers ?? [])
      setDirty(false)
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  async function save() {
    setLoading(true)
    try {
      await api.put('/dictionaries', { hs, suppliers: sup })
      message.success(`已保存 (HS ${hs.length} · 供应商 ${sup.length})`)
      setDirty(false)
    } catch (e: any) {
      message.error('保存失败: ' + (e?.message ?? e))
    } finally { setLoading(false) }
  }

  return (
    <div style={{ padding: 16 }}>
      <Card
        title={`字典库 — HS ${hs.length} 条 · 供应商 ${sup.length} 条${dirty ? ' (未保存)' : ''}`}
        extra={
          <Space>
            <Button onClick={load} disabled={loading}>🔄 重新加载</Button>
            <Button type="primary" onClick={save} loading={loading} disabled={!dirty}>💾 保存全部</Button>
          </Space>
        }
      >
        <Tabs
          items={[
            {
              key: 'hs', label: 'HS 编码字典',
              children: <HsTable rows={hs} setRows={(r) => { setHs(r); setDirty(true) }} />,
            },
            {
              key: 'sup', label: '供应商字典',
              children: <SupTable rows={sup} setRows={(r) => { setSup(r); setDirty(true) }} />,
            },
          ]}
        />
      </Card>
    </div>
  )
}

function HsTable({ rows, setRows }: { rows: HsDict[]; setRows: (r: HsDict[]) => void }) {
  const [filter, setFilter] = useState('')
  const filtered = useMemo(() => rows
    .map((q, _i) => ({ q, _i }))
    .filter(({ q }) => !filter || ((q.keyword || '') + (q.hsCN || '') + (q.hsID || '')).toLowerCase().includes(filter.toLowerCase())),
    [rows, filter])
  function patch(i: number, k: keyof HsDict, v: string) {
    setRows(rows.map((q, idx) => idx === i ? { ...q, [k]: v } : q))
  }
  function add() { setRows([{ keyword: '', hsCN: '', hsID: '' }, ...rows]) }
  function del(i: number) { setRows(rows.filter((_, idx) => idx !== i)) }
  return (
    <>
      <Space style={{ marginBottom: 8 }}>
        <Input.Search placeholder="搜索关键字 / HS 编码" allowClear style={{ width: 280 }}
          onSearch={setFilter} onChange={(e) => !e.target.value && setFilter('')} />
        <Button onClick={add}>➕ 新增</Button>
      </Space>
      <Table
        rowKey={(_, i) => String(i)}
        size="small"
        dataSource={filtered}
        pagination={{ defaultPageSize: 50, showSizeChanger: true }}
        columns={[
          { title: '#', width: 50, render: (_v, _r, i) => i + 1 },
          { title: '关键字 (含此词的中文名)', render: (_v, r) => <Input value={r.q.keyword} onChange={(e) => patch(r._i, 'keyword', e.target.value)} /> },
          { title: '中国 HSCODE', width: 200, render: (_v, r) => <Input value={r.q.hsCN} onChange={(e) => patch(r._i, 'hsCN', e.target.value)} /> },
          { title: '印尼 HS CODE', width: 200, render: (_v, r) => <Input value={r.q.hsID} onChange={(e) => patch(r._i, 'hsID', e.target.value)} /> },
          {
            title: '', width: 70,
            render: (_v, r) => (
              <Popconfirm title="删除该条?" onConfirm={() => del(r._i)}>
                <a style={{ color: '#ff4d4f' }}>删除</a>
              </Popconfirm>
            ),
          },
        ]}
      />
    </>
  )
}

function SupTable({ rows, setRows }: { rows: SupplierDict[]; setRows: (r: SupplierDict[]) => void }) {
  const [filter, setFilter] = useState('')
  const filtered = useMemo(() => rows
    .map((q, _i) => ({ q, _i }))
    .filter(({ q }) => !filter || ((q.keyword || '') + (q.full || '') + (q.customs || '')).toLowerCase().includes(filter.toLowerCase())),
    [rows, filter])
  function patch(i: number, k: keyof SupplierDict, v: string) {
    setRows(rows.map((q, idx) => idx === i ? { ...q, [k]: v } : q))
  }
  function add() { setRows([{ keyword: '', full: '', customs: '' }, ...rows]) }
  function del(i: number) { setRows(rows.filter((_, idx) => idx !== i)) }
  return (
    <>
      <Space style={{ marginBottom: 8 }}>
        <Input.Search placeholder="搜索关键字 / 全称 / 报关公司" allowClear style={{ width: 280 }}
          onSearch={setFilter} onChange={(e) => !e.target.value && setFilter('')} />
        <Button onClick={add}>➕ 新增</Button>
      </Space>
      <Table
        rowKey={(_, i) => String(i)}
        size="small"
        dataSource={filtered}
        pagination={{ defaultPageSize: 50, showSizeChanger: true }}
        columns={[
          { title: '#', width: 50, render: (_v, _r, i) => i + 1 },
          { title: '简称 (关键字)', width: 200, render: (_v, r) => <Input value={r.q.keyword} onChange={(e) => patch(r._i, 'keyword', e.target.value)} /> },
          { title: '全称', render: (_v, r) => <Input value={r.q.full} onChange={(e) => patch(r._i, 'full', e.target.value)} /> },
          { title: '报关公司', render: (_v, r) => <Input value={r.q.customs} onChange={(e) => patch(r._i, 'customs', e.target.value)} /> },
          {
            title: '', width: 70,
            render: (_v, r) => (
              <Popconfirm title="删除该条?" onConfirm={() => del(r._i)}>
                <a style={{ color: '#ff4d4f' }}>删除</a>
              </Popconfirm>
            ),
          },
        ]}
      />
    </>
  )
}

// Silence "InputNumber unused" if a future field needs it
void InputNumber
