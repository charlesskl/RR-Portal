import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Input, InputNumber, Popconfirm, Space, Switch, Table, Tabs, Tag, message } from 'antd'
import { api, type Dictionaries, type HsDict, type SupplierDict, type TranslationDict } from '../api/client'

export default function DictionariesPage() {
  const [hs,  setHs]  = useState<HsDict[]>([])
  const [sup, setSup] = useState<SupplierDict[]>([])
  const [translations, setTranslations] = useState<TranslationDict[]>([])
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get<Dictionaries>('/dictionaries')
      setHs(data.hs ?? [])
      setSup(data.suppliers ?? [])
      setTranslations(data.translations ?? [])
      setDirty(false)
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  async function save() {
    setLoading(true)
    try {
      await api.put('/dictionaries', { hs, suppliers: sup, translations })
      message.success(`已保存 (HS ${hs.length} · 供应商 ${sup.length} · 英文翻译 ${translations.length})`)
      setDirty(false)
    } catch (e: any) {
      message.error('保存失败: ' + (e?.message ?? e))
    } finally { setLoading(false) }
  }

  return (
    <div style={{ padding: 16 }}>
      <Card
        title={`字典库 — HS ${hs.length} 条 · 供应商 ${sup.length} 条 · 英文翻译 ${translations.length} 条${dirty ? ' (未保存)' : ''}`}
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
            {
              key: 'translation', label: '英文翻译字典',
              children: <TranslationTable rows={translations} setRows={(r) => { setTranslations(r); setDirty(true) }} />,
            },
          ]}
        />
      </Card>
    </div>
  )
}

function TranslationTable({ rows, setRows }: { rows: TranslationDict[]; setRows: (r: TranslationDict[]) => void }) {
  const [filter, setFilter] = useState('')
  const filtered = useMemo(() => rows
    .map((q, _i) => ({ q, _i }))
    .filter(({ q }) => !filter || `${q.keyword || ''}${q.english || ''}`.toLowerCase().includes(filter.toLowerCase())),
    [rows, filter])
  function patch(i: number, k: keyof TranslationDict, v: string | boolean) {
    setRows(rows.map((q, idx) => idx === i ? { ...q, [k]: v } : q))
  }
  function add() { setRows([{ keyword: '', english: '', active: true, source: 'dictionary' }, ...rows]) }
  function del(i: number) { setRows(rows.filter((_, idx) => idx !== i)) }
  return (
    <>
      <Space style={{ marginBottom: 8 }}>
        <Input.Search placeholder="搜索中文名 / 英文名" allowClear style={{ width: 320 }}
          onSearch={setFilter} onChange={(e) => !e.target.value && setFilter('')} />
        <Button onClick={add}>➕ 新增翻译</Button>
        <span style={{ color: '#8c8c8c' }}>精确匹配中文名；停用后不再自动带出</span>
      </Space>
      <Table
        rowKey={(_, i) => String(i)} size="small" dataSource={filtered}
        pagination={{ defaultPageSize: 50, showSizeChanger: true }}
        columns={[
          { title: '#', width: 50, render: (_v, _r, i) => i + 1 },
          { title: '物料中文名（精确匹配）', render: (_v, r) => <Input value={r.q.keyword} onChange={(e) => patch(r._i, 'keyword', e.target.value)} /> },
          { title: '英文名', render: (_v, r) => <Input value={r.q.english} onChange={(e) => patch(r._i, 'english', e.target.value)} /> },
          { title: '来源', width: 150, render: (_v, r) => <Tag>{r.q.source === 'material-save' ? '物料保存学习' : r.q.source === 'existing-material' ? '已有物料' : '字典维护'}</Tag> },
          { title: '启用', width: 90, render: (_v, r) => <Switch checked={r.q.active !== false} onChange={(v) => patch(r._i, 'active', v)} /> },
          {
            title: '', width: 70,
            render: (_v, r) => <Popconfirm title="删除该翻译?" onConfirm={() => del(r._i)}><a style={{ color: '#ff4d4f' }}>删除</a></Popconfirm>,
          },
        ]}
      />
    </>
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
