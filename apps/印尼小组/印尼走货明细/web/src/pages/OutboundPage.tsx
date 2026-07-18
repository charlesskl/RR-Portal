import { useCallback, useEffect, useMemo, useState } from 'react'
import { App, Button, Card, DatePicker, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tabs, Tag } from 'antd'
import dayjs from 'dayjs'
import { api } from '../api/client'

interface OutboundRow {
  id: number
  po_no?: string
  material_id?: number
  qty?: number
  out_date?: string
  notes?: string
  created_at?: string
  material_name?: string
}

interface SummaryRow {
  po_no?: string
  material_id?: number
  total_out?: number
}

interface MaterialOpt { id: number; label: string }

export default function OutboundPage() {
  const { message } = App.useApp()
  const [rows, setRows] = useState<OutboundRow[]>([])
  const [summary, setSummary] = useState<SummaryRow[]>([])
  const [filter, setFilter] = useState('')
  const [poFilter, setPoFilter] = useState('')
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<OutboundRow | null>(null)
  const [creating, setCreating] = useState(false)
  const [matOpts, setMatOpts] = useState<MaterialOpt[]>([])
  const [shippedIds, setShippedIds] = useState<Set<number>>(new Set())  // 已做走货明细的物料

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [list, sum] = await Promise.all([
        api.get<OutboundRow[]>('/outbound', { params: poFilter ? { po_no: poFilter } : {} }),
        api.get<SummaryRow[]>('/outbound/summary/by-po'),
      ])
      setRows(Array.isArray(list.data) ? list.data : [])
      setSummary(Array.isArray(sum.data) ? sum.data : [])
      try { const { data } = await api.get<number[]>('/shipments/shipped-material-ids'); setShippedIds(new Set(Array.isArray(data) ? data : [])) } catch {}
    } finally { setLoading(false) }
  }, [poFilter])
  useEffect(() => { load() }, [load])

  async function loadMaterialsByPo(po: string) {
    // pull all materials of products that have this po? Fallback: small subset by first product code
    // For simplicity, just fetch products list and let user type material id manually.
    try {
      // Lazy approach: fetch full materials of first 5 products to populate; otherwise user types
      const { data: prods } = await api.get<{ code: string }[]>('/products')
      const all: MaterialOpt[] = []
      for (const p of prods.slice(0, 20)) {
        try {
          const { data } = await api.get<any[]>('/materials', { params: { code: p.code } })
          for (const m of data) all.push({ id: m.id, label: `${m.id} · ${p.code} / ${m.name_zh ?? ''}` })
        } catch {}
      }
      setMatOpts(all)
    } catch {}
    void po
  }
  useEffect(() => { loadMaterialsByPo('') }, [])

  function openCreate() { setCreating(true); setEditing({ id: 0, po_no: poFilter, qty: 0, out_date: dayjs().format('YYYY-MM-DD') }) }
  function openEdit(r: OutboundRow) { setCreating(false); setEditing({ ...r }) }
  async function save() {
    if (!editing) return
    if (!editing.po_no) { message.warning('PO 号必填'); return }
    if (!editing.qty || editing.qty <= 0) { message.warning('数量必须 > 0'); return }
    try {
      if (creating) {
        await api.post('/outbound', editing)
        message.success('已新增')
      } else {
        await api.put(`/outbound/${editing.id}`, editing)
        message.success('已更新')
      }
      setEditing(null); setCreating(false)
      load()
    } catch {
      /* 拦截器已提示 */
    }
  }
  async function del(id: number) {
    try {
      await api.delete(`/outbound/${id}`)
      message.success('已删除'); load()
    } catch { /* 拦截器已提示 */ }
  }

  const filtered = useMemo(() => rows.filter(r => {
    if (!filter) return true
    const s = filter.toLowerCase()
    return ((r.po_no || '') + (r.material_name || '') + (r.notes || '')).toLowerCase().includes(s)
  }), [rows, filter])

  const summaryByPo = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of summary) {
      const k = s.po_no || '(无 PO)'
      m.set(k, (m.get(k) ?? 0) + (s.total_out ?? 0))
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [summary])

  return (
    <div style={{ padding: 16 }}>
      <Tabs
        items={[
          {
            key: 'list', label: '出库登记',
            children: (
              <Card
                title={`出库记录 — 共 ${rows.length} 条`}
                extra={
                  <Space wrap>
                    <Input.Search allowClear placeholder="按 PO 号过滤" style={{ width: 200 }}
                      onSearch={setPoFilter} onChange={(e) => !e.target.value && setPoFilter('')} />
                    <Input.Search allowClear placeholder="搜索 PO / 物料 / 备注" style={{ width: 240 }}
                      onSearch={setFilter} onChange={(e) => !e.target.value && setFilter('')} />
                    <Button type="primary" onClick={openCreate}>➕ 新增出库</Button>
                    <Button onClick={load}>🔄 刷新</Button>
                  </Space>
                }
              >
                <Table
                  rowKey="id"
                  size="small"
                  loading={loading}
                  dataSource={filtered}
                  pagination={{ defaultPageSize: 50, showSizeChanger: true }}
                  columns={[
                    { title: '#', width: 60, dataIndex: 'id' },
                    { title: '出库日期', width: 120, dataIndex: 'out_date', render: (v) => v ? dayjs(v).format('YYYY-MM-DD') : '' },
                    { title: 'PO 号', width: 140, dataIndex: 'po_no' },
                    { title: '物料 ID', width: 90, dataIndex: 'material_id' },
                    { title: '物料名', dataIndex: 'material_name', ellipsis: true },
                    { title: '数量', width: 100, dataIndex: 'qty', align: 'right' },
                    {
                      title: '走货状态', width: 100,
                      render: (_v, r) => r.material_id != null && shippedIds.has(r.material_id)
                        ? <Tag color="success">已走货</Tag>
                        : <Tag>未走货</Tag>,
                    },
                    { title: '备注', dataIndex: 'notes', ellipsis: true },
                    {
                      title: '操作', width: 130,
                      render: (_v, r) => (
                        <Space>
                          <a onClick={() => openEdit(r)}>编辑</a>
                          <Popconfirm title="删除该出库记录?" onConfirm={() => del(r.id)}>
                            <a style={{ color: '#ff4d4f' }}>删除</a>
                          </Popconfirm>
                        </Space>
                      ),
                    },
                  ]}
                />
              </Card>
            ),
          },
          {
            key: 'sum', label: '按 PO 汇总',
            children: (
              <Card title={`按 PO 汇总 — 共 ${summaryByPo.length} 个 PO`}>
                <Table
                  rowKey={(_, i) => String(i)}
                  size="small"
                  dataSource={summaryByPo.map(([po, total]) => ({ po, total }))}
                  pagination={{ pageSize: 50 }}
                  columns={[
                    { title: 'PO 号', dataIndex: 'po', render: (v) => <Tag>{v}</Tag> },
                    { title: '总出库量', dataIndex: 'total', align: 'right' },
                    {
                      title: '操作', width: 100,
                      render: (_v, r) => <a onClick={() => setPoFilter(r.po)}>查看明细</a>,
                    },
                  ]}
                />
              </Card>
            ),
          },
        ]}
      />

      <Modal
        open={editing !== null}
        title={creating ? '新增出库记录' : `编辑出库 #${editing?.id}`}
        onCancel={() => { setEditing(null); setCreating(false) }}
        onOk={save}
        destroyOnClose
        width={520}
      >
        {editing && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="PO 号 *">
              <Input value={editing.po_no} onChange={(e) => setEditing({ ...editing, po_no: e.target.value })} />
            </Field>
            <Field label="物料 ID">
              <Select
                value={editing.material_id}
                onChange={(v) => setEditing({ ...editing, material_id: v })}
                options={matOpts.map(o => ({ value: o.id, label: o.label }))}
                showSearch
                allowClear
                filterOption={(input, opt) => (opt?.label?.toString() ?? '').toLowerCase().includes(input.toLowerCase())}
                style={{ width: '100%' }}
                placeholder="搜索物料（或直接填 ID）"
              />
            </Field>
            <Field label="数量 *">
              <InputNumber value={editing.qty} min={0} step={0.0001} onChange={(v) => setEditing({ ...editing, qty: v ?? 0 })} style={{ width: '100%' }} />
            </Field>
            <Field label="出库日期">
              <DatePicker
                value={editing.out_date ? dayjs(editing.out_date) : null}
                onChange={(v) => setEditing({ ...editing, out_date: v ? v.format('YYYY-MM-DD') : '' })}
                style={{ width: '100%' }}
              />
            </Field>
            <Field label="备注">
              <Input.TextArea value={editing.notes} rows={2} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  )
}

function Field({ label, children }: { label: string; children: any }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12, color: '#666' }}>{label}</span>
      {children}
    </label>
  )
}
