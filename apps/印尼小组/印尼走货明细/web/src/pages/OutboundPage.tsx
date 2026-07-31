import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowUpOutlined, EditOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import {
  App, Button, Card, Col, DatePicker, Input, InputNumber, Modal, Popconfirm, Row, Select,
  Space, Statistic, Table, Tabs, Tag, Typography,
} from 'antd'
import dayjs from 'dayjs'
import { api } from '../api/client'
import './OutboundPage.css'

interface OutboundRow {
  id: number
  po_item_id?: number
  po_no?: string
  material_id?: number
  qty?: number
  out_date?: string
  notes?: string
  created_at?: string
  material_name?: string
  product_code?: string
  supplier?: string
  received_qty?: number
  total_out?: number
  available_qty?: number
  allocated_qty?: number
  unallocated_qty?: number
}

interface SummaryRow {
  po_no?: string
  material_id?: number
  total_out?: number
}

interface StockRow {
  po_item_id: number
  po_id: number
  po_no?: string
  supplier?: string
  material_id?: number
  product_code?: string
  material_name?: string
  spec?: string
  purchase_qty?: number
  received_qty?: number
  total_out?: number
  available_qty?: number
  purchase_unit?: string
}

interface LedgerRow {
  movement_id: string
  po_item_id: number
  movement_date?: string
  movement_type: 'receipt' | 'outbound'
  reference_no?: string
  po_no?: string
  product_code?: string
  material_name?: string
  in_qty?: number
  out_qty?: number
  balance?: number
  notes?: string
}

interface AuditRow {
  id: number
  occurred_at?: string
  username?: string
  module?: string
  action?: string
  entity_type?: string
  entity_id?: string
  summary?: string
  ip_address?: string
}

export default function OutboundPage() {
  const { message } = App.useApp()
  const [rows, setRows] = useState<OutboundRow[]>([])
  const [summary, setSummary] = useState<SummaryRow[]>([])
  const [filter, setFilter] = useState('')
  const [poFilter, setPoFilter] = useState('')
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<OutboundRow | null>(null)
  const [creating, setCreating] = useState(false)
  const [stockRows, setStockRows] = useState<StockRow[]>([])
  const [ledgerRows, setLedgerRows] = useState<LedgerRow[]>([])
  const [auditRows, setAuditRows] = useState<AuditRow[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [list, sum, stock, ledger, audit] = await Promise.all([
        api.get<OutboundRow[]>('/outbound', { params: poFilter ? { po_no: poFilter } : {} }),
        api.get<SummaryRow[]>('/outbound/summary/by-po'),
        api.get<StockRow[]>('/outbound/available'),
        api.get<LedgerRow[]>('/outbound/ledger'),
        api.get<AuditRow[]>('/outbound/audit-logs'),
      ])
      setRows(Array.isArray(list.data) ? list.data : [])
      setSummary(Array.isArray(sum.data) ? sum.data : [])
      setStockRows(Array.isArray(stock.data) ? stock.data : [])
      setLedgerRows(Array.isArray(ledger.data) ? ledger.data : [])
      setAuditRows(Array.isArray(audit.data) ? audit.data : [])
    } finally { setLoading(false) }
  }, [poFilter])
  useEffect(() => { load() }, [load])

  function openCreate() { setCreating(true); setEditing({ id: 0, qty: 0, out_date: dayjs().format('YYYY-MM-DD') }) }
  function openEdit(r: OutboundRow) { setCreating(false); setEditing({ ...r }) }
  async function save() {
    if (!editing) return
    if (!editing.po_item_id) { message.warning('请选择有可用库存的采购物料'); return }
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

  const selectedStock = useMemo(() => {
    if (!editing?.po_item_id) return undefined
    const available = stockRows.find(x => x.po_item_id === editing.po_item_id)
    if (available) {
      return !creating
        ? {
            ...available,
            total_out: Math.max(Number(available.total_out ?? 0) - Number(editing.qty ?? 0), 0),
            available_qty: Number(available.available_qty ?? 0) + Number(editing.qty ?? 0),
          }
        : available
    }
    if (!creating && editing) {
      return {
        po_item_id: editing.po_item_id,
        po_id: 0,
        po_no: editing.po_no,
        supplier: editing.supplier,
        material_id: editing.material_id,
        product_code: editing.product_code,
        material_name: editing.material_name,
        received_qty: editing.received_qty,
        total_out: Number(editing.total_out ?? 0) - Number(editing.qty ?? 0),
        available_qty: Number(editing.available_qty ?? 0) + Number(editing.qty ?? 0),
      } satisfies StockRow
    }
    return undefined
  }, [editing, stockRows, creating])

  const inventoryStats = useMemo(() => {
    const byItem = new Map<number, { received: number; out: number; available: number }>()
    for (const r of stockRows) {
      byItem.set(r.po_item_id, {
        received: Number(r.received_qty ?? 0),
        out: Number(r.total_out ?? 0),
        available: Number(r.available_qty ?? 0),
      })
    }
    for (const r of rows) {
      if (!r.po_item_id) continue
      byItem.set(r.po_item_id, {
        received: Number(r.received_qty ?? 0),
        out: Number(r.total_out ?? 0),
        available: Number(r.available_qty ?? 0),
      })
    }
    const values = [...byItem.values()]
    return {
      materialCount: byItem.size,
      received: values.reduce((sum, x) => sum + x.received, 0),
      out: values.reduce((sum, x) => sum + x.out, 0),
      available: values.reduce((sum, x) => sum + x.available, 0),
    }
  }, [rows, stockRows])

  return (
    <div className="outbound-page">
      <div className="outbound-page-heading">
        <div>
          <Typography.Title level={3}>出库管理</Typography.Title>
          <Typography.Text type="secondary">入库库存与出库记录实时同步</Typography.Text>
        </div>
      </div>

      <Row gutter={[12, 12]} className="outbound-stat-grid">
        <Col xs={12} xl={6}>
          <Card className="outbound-stat-card" bordered={false}>
            <Statistic title="可出库物料" value={inventoryStats.materialCount} suffix="项" />
          </Card>
        </Col>
        <Col xs={12} xl={6}>
          <Card className="outbound-stat-card outbound-stat-received" bordered={false}>
            <Statistic title="累计入库" value={inventoryStats.received} precision={0} />
          </Card>
        </Col>
        <Col xs={12} xl={6}>
          <Card className="outbound-stat-card outbound-stat-out" bordered={false}>
            <Statistic title="累计出库" value={inventoryStats.out} precision={0} />
          </Card>
        </Col>
        <Col xs={12} xl={6}>
          <Card className="outbound-stat-card outbound-stat-stock" bordered={false}>
            <Statistic title="当前库存" value={inventoryStats.available} precision={0} />
          </Card>
        </Col>
      </Row>

      <Tabs
        className="outbound-tabs"
        items={[
          {
            key: 'list', label: '出库登记',
            children: (
              <Card
                className="outbound-list-card"
                title={
                  <Space size={10}>
                    <span>出库记录</span>
                    <Tag bordered={false} color="blue">{filtered.length} 条</Tag>
                  </Space>
                }
              >
                <div className="outbound-toolbar">
                  <div className="outbound-toolbar-searches">
                    <Input
                      allowClear
                      prefix={<SearchOutlined />}
                      placeholder="按 PO 号过滤"
                      value={poFilter}
                      onChange={(e) => setPoFilter(e.target.value)}
                    />
                    <Input
                      allowClear
                      prefix={<SearchOutlined />}
                      placeholder="搜索货号、物料或备注"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    />
                  </div>
                  <Space>
                    <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
                    <Button type="primary" icon={<ArrowUpOutlined />} onClick={openCreate}>新增出库</Button>
                  </Space>
                </div>
                <Table
                  className="outbound-table"
                  rowKey="id"
                  size="small"
                  loading={loading}
                  dataSource={filtered}
                  scroll={{ x: 1460 }}
                  pagination={{
                    defaultPageSize: 20,
                    showSizeChanger: true,
                    hideOnSinglePage: true,
                    showTotal: (total) => `共 ${total} 条`,
                  }}
                  columns={[
                    { title: '#', width: 58, fixed: 'left', render: (_v, _r, index) => <Typography.Text type="secondary">{index + 1}</Typography.Text> },
                    { title: '出库日期', width: 116, dataIndex: 'out_date', fixed: 'left', render: (v) => v ? dayjs(v).format('YYYY-MM-DD') : '-' },
                    { title: 'PO 号', width: 155, dataIndex: 'po_no', fixed: 'left', render: (v) => <Typography.Text strong>{v || '-'}</Typography.Text> },
                    { title: '货号', width: 110, dataIndex: 'product_code' },
                    { title: '物料名', width: 200, dataIndex: 'material_name', ellipsis: true },
                    { title: '累计入库', width: 105, dataIndex: 'received_qty', align: 'right', render: (v) => <span className="number-muted">{Number(v ?? 0).toLocaleString()}</span> },
                    { title: '本次出库', width: 105, dataIndex: 'qty', align: 'right', render: (v) => <span className="number-out">{Number(v ?? 0).toLocaleString()}</span> },
                    {
                      title: '剩余库存', width: 110, dataIndex: 'available_qty', align: 'right',
                      render: (v) => Number(v ?? 0) > 0
                        ? <span className="stock-pill">{Number(v).toLocaleString()}</span>
                        : <Tag bordered={false}>已出完</Tag>,
                    },
                    { title: '累计出库', width: 105, dataIndex: 'total_out', align: 'right', render: (v) => <span className="number-muted">{Number(v ?? 0).toLocaleString()}</span> },
                    {
                      title: '装柜分配', width: 135,
                      render: (_v, r) => {
                        const allocated = Number(r.allocated_qty ?? 0)
                        const remaining = Number(r.unallocated_qty ?? r.qty ?? 0)
                        if (allocated <= 0) return <Tag bordered={false}>未分配</Tag>
                        if (remaining > 0) return <Tag bordered={false} color="processing">部分 {allocated.toLocaleString()}</Tag>
                        return <Tag bordered={false} color="success">已分配完</Tag>
                      },
                    },
                    { title: '备注', width: 220, dataIndex: 'notes', ellipsis: true, render: (v) => v || <Typography.Text type="secondary">—</Typography.Text> },
                    {
                      title: '操作', width: 128, fixed: 'right',
                      render: (_v, r) => (
                        <Space size={4}>
                          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>编辑</Button>
                          <Popconfirm title="删除该出库记录?" onConfirm={() => del(r.id)}>
                            <Button type="link" size="small" danger>删除</Button>
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
              <Card className="outbound-list-card" title={`按 PO 汇总 · ${summaryByPo.length} 个采购单`}>
                <Table
                  className="outbound-table"
                  rowKey={(_, i) => String(i)}
                  size="small"
                  dataSource={summaryByPo.map(([po, total]) => ({ po, total }))}
                  pagination={{ pageSize: 20, hideOnSinglePage: true }}
                  columns={[
                    { title: 'PO 号', dataIndex: 'po', render: (v) => <Typography.Text strong>{v}</Typography.Text> },
                    { title: '总出库量', dataIndex: 'total', align: 'right', render: (v) => <span className="number-out">{Number(v ?? 0).toLocaleString()}</span> },
                    {
                      title: '操作', width: 100,
                      render: (_v, r) => <a onClick={() => setPoFilter(r.po)}>查看明细</a>,
                    },
                  ]}
                />
              </Card>
            ),
          },
          {
            key: 'ledger', label: '库存流水',
            children: (
              <Card className="outbound-list-card" title={`库存流水 · ${ledgerRows.length} 条`}>
                <Table
                  className="outbound-table"
                  rowKey="movement_id"
                  size="small"
                  dataSource={ledgerRows}
                  pagination={{ defaultPageSize: 30, showSizeChanger: true, hideOnSinglePage: true }}
                  scroll={{ x: 1180 }}
                  columns={[
                    { title: '日期', dataIndex: 'movement_date', width: 115, render: (v) => v ? dayjs(v).format('YYYY-MM-DD') : '-' },
                    { title: '类型', dataIndex: 'movement_type', width: 85, render: (v) => v === 'receipt' ? <Tag color="success">入库</Tag> : <Tag color="orange">出库</Tag> },
                    { title: '单据', dataIndex: 'reference_no', width: 120, render: (v, r) => v || r.movement_id },
                    { title: 'PO 号', dataIndex: 'po_no', width: 160 },
                    { title: '货号', dataIndex: 'product_code', width: 110 },
                    { title: '物料', dataIndex: 'material_name', width: 220, ellipsis: true },
                    { title: '入库', dataIndex: 'in_qty', width: 100, align: 'right', render: (v) => Number(v || 0) ? <Typography.Text type="success">{Number(v).toLocaleString()}</Typography.Text> : '-' },
                    { title: '出库', dataIndex: 'out_qty', width: 100, align: 'right', render: (v) => Number(v || 0) ? <span className="number-out">{Number(v).toLocaleString()}</span> : '-' },
                    { title: '结余', dataIndex: 'balance', width: 100, align: 'right', render: (v) => <Typography.Text strong>{Number(v ?? 0).toLocaleString()}</Typography.Text> },
                    { title: '备注', dataIndex: 'notes', width: 220, ellipsis: true },
                  ]}
                />
              </Card>
            ),
          },
          {
            key: 'audit', label: '操作审计',
            children: (
              <Card className="outbound-list-card" title={`关键操作记录 · ${auditRows.length} 条`}>
                <Table
                  className="outbound-table"
                  rowKey="id"
                  size="small"
                  dataSource={auditRows}
                  pagination={{ defaultPageSize: 30, showSizeChanger: true, hideOnSinglePage: true }}
                  columns={[
                    { title: '操作时间', dataIndex: 'occurred_at', width: 170, render: (v) => v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-' },
                    { title: '操作人', dataIndex: 'username', width: 120, render: (v) => v || '系统' },
                    { title: '模块', dataIndex: 'module', width: 100 },
                    { title: '动作', dataIndex: 'action', width: 110 },
                    { title: '对象', width: 150, render: (_v, r) => `${r.entity_type || '-'} #${r.entity_id || '-'}` },
                    { title: '内容', dataIndex: 'summary', ellipsis: true },
                    { title: 'IP', dataIndex: 'ip_address', width: 140 },
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
        width={620}
      >
        {editing && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="选择已入库物料 *">
              <Select
                value={editing.po_item_id}
                onChange={(v) => {
                  const stock = stockRows.find(x => x.po_item_id === v)
                  setEditing({
                    ...editing,
                    po_item_id: v,
                    po_no: stock?.po_no,
                    material_id: stock?.material_id,
                    material_name: stock?.material_name,
                    product_code: stock?.product_code,
                    qty: Math.min(Number(editing.qty ?? 0), Number(stock?.available_qty ?? 0)),
                  })
                }}
                options={[
                  ...stockRows.map(o => ({
                    value: o.po_item_id,
                    label: `${o.po_no || '-'} · ${o.product_code || '-'} / ${o.material_name || '-'} · 可出 ${Number(o.available_qty ?? 0).toLocaleString()}`,
                  })),
                  ...(!creating && selectedStock && !stockRows.some(x => x.po_item_id === selectedStock.po_item_id)
                    ? [{
                        value: selectedStock.po_item_id,
                        label: `${selectedStock.po_no || '-'} · ${selectedStock.product_code || '-'} / ${selectedStock.material_name || '-'} · 可编辑 ${Number(selectedStock.available_qty ?? 0).toLocaleString()}`,
                      }]
                    : []),
                ]}
                showSearch
                filterOption={(input, opt) => (opt?.label?.toString() ?? '').toLowerCase().includes(input.toLowerCase())}
                style={{ width: '100%' }}
                placeholder="搜索采购单、货号或物料"
              />
            </Field>
            {selectedStock && (
              <Card size="small">
                <Space size="large" wrap>
                  <span>采购单：<b>{selectedStock.po_no}</b></span>
                  <span>累计入库：<b>{Number(selectedStock.received_qty ?? 0).toLocaleString()}</b></span>
                  <span>已出库：<b>{Number(selectedStock.total_out ?? 0).toLocaleString()}</b></span>
                  <span>本记录可用：<b style={{ color: '#1677ff' }}>{Number(selectedStock.available_qty ?? 0).toLocaleString()}</b></span>
                </Space>
              </Card>
            )}
            <Field label="数量 *">
              <InputNumber
                value={editing.qty}
                min={0}
                max={Number(selectedStock?.available_qty ?? 0)}
                step={0.0001}
                onChange={(v) => setEditing({ ...editing, qty: v ?? 0 })}
                style={{ width: '100%' }}
              />
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
