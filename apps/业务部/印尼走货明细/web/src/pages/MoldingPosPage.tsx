import { useEffect, useMemo, useRef, useState } from 'react'
import {
  App, AutoComplete, Button, Card, Checkbox, Col, DatePicker, Drawer, Form, Input, InputNumber, Modal, Popconfirm,
  Row, Select, Space, Table, Tag,
} from 'antd'
import dayjs from 'dayjs'
import { api } from '../api/client'

interface MpoItem {
  code?: string           // 货号
  productName?: string
  orderNo?: string        // TOMY PO
  moldId?: string
  moldName?: string
  partCode?: string
  partName?: string
  partsSummary?: string
  partsCount?: number
  materialName?: string
  colorName?: string
  colorCode?: string
  colorDisplay?: string
  pigmentCode?: string
  qty?: number
  unitPrice?: number
  currency?: string
  netGramsPerShot?: number
  setsPerShot?: number
  ejections?: number
  usage?: number
  deliveryDate?: string
  notes?: string
}

interface SchedRow {
  source?: string
  customer?: string
  country?: string
  endCustomer?: string
  code?: string
  productName?: string
  orderNo?: string
  customerPO?: string
  qty?: number
  eta?: string
}

interface Mpo {
  no?: string
  customer?: string
  category?: '塑胶' | '搪胶' | string
  workshop?: string
  status?: string
  orderDate?: string
  deliveryDate?: string
  currency?: string
  notes?: string
  items?: MpoItem[]
}

const STATUS = [
  { value: 'draft',    label: '草稿',   color: 'default' as const },
  { value: 'sent',     label: '已发出', color: 'processing' as const },
  { value: 'received', label: '已收货', color: 'success' as const },
]
const CATEGORIES = ['塑胶', '搪胶']
const WORKSHOPS  = ['兴信A车间', '兴信B车间', '华登']
const CURR = [
  { value: 'HK$', label: 'HK$ 港币' },
  { value: '¥',   label: '¥ 人民币' },
  { value: 'US$', label: 'US$ 美金' },
  { value: 'Rp',  label: 'Rp 印尼盾' },
]

export default function MoldingPosPage() {
  const { message } = App.useApp()
  const [rows, setRows] = useState<Mpo[]>([])
  const [filter, setFilter] = useState('')
  const [customerFilter, setCustomerFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [loading, setLoading] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [editingForm] = Form.useForm<Mpo>()
  const [items, setItems] = useState<MpoItem[]>([])
  const [customers, setCustomers] = useState<string[]>([])
  const [drawerFull, setDrawerFull] = useState(false)
  const [schedRows, setSchedRows] = useState<SchedRow[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerFilter, setPickerFilter] = useState('')
  const [pickerSel, setPickerSel] = useState<React.Key[]>([])
  const [hidePlaced, setHidePlaced] = useState(true)
  const blobVersion = useRef<string>('')
  const placedOrderNos = useMemo(() => {
    const set = new Set<string>()
    for (const po of rows) {
      for (const it of (po.items ?? [])) {
        const orderNos = String(it.orderNo ?? '').split(/\s*[;；]\s*/).map(x => x.trim()).filter(Boolean)
        for (const orderNo of orderNos) set.add(orderNo)
      }
    }
    return set
  }, [rows])

  async function load() {
    setLoading(true)
    try {
      const resp = await api.get<Mpo[]>('/molding-pos/blob')
      blobVersion.current = resp.headers['x-blob-version'] ?? ''
      setRows(Array.isArray(resp.data) ? resp.data : [])
      setDirty(false)
    } finally { setLoading(false) }
  }
  async function loadCustomers() {
    try { const { data } = await api.get<string[]>('/customers'); setCustomers(data || []) } catch {}
  }
  async function loadLatestSchedule() {
    try {
      const { data: list } = await api.get<{ id: number }[]>('/schedules')
      if (!list?.length) return
      const top = list[0]
      const { data: det } = await api.get<{ raw_rows?: string }>(`/schedules/${top.id}`)
      const parsed = det.raw_rows ? JSON.parse(det.raw_rows) as SchedRow[] : []
      setSchedRows(Array.isArray(parsed) ? parsed : [])
    } catch {}
  }
  useEffect(() => { load(); loadCustomers(); loadLatestSchedule() }, [])

  // ============ 从排期生成生产单（旧 generateMoldingPOFromPick 港版逻辑） ============
  async function generateFromPicked() {
    if (!pickerSel.length) { message.warning('请至少勾选一行排期'); return }
    const picked = pickerSel.map(k => schedRows[Number(k)]).filter(Boolean)
    if (!picked.length) return

    // groups: key = `${category}||${workshop}` → { category, workshop, items: [] }
    type Group = { category: string; workshop: string; items: MpoItem[] }
    const groups = new Map<string, Group>()

    // Fetch all involved products in parallel (with moldings)
    const codes = [...new Set(picked.map(p => p.code).filter(Boolean) as string[])]
    const prodMap = new Map<string, any>()
    await Promise.all(codes.map(async code => {
      try {
        const { data } = await api.get<any>(`/products/${encodeURIComponent(code)}`)
        prodMap.set(code, data)
      } catch {}
    }))

    for (const sched of picked) {
      const prod = prodMap.get(sched.code ?? '')
      if (!prod) continue
      const moldings = Array.isArray(prod.moldings) ? prod.moldings : []
      for (const md of moldings) {
        const firstPart = md.parts?.[0]
        const cat = firstPart?.category || (/搪胶/.test(md.materialName || '') ? '搪胶' : '塑胶')
        const ws  = md.workshop || (cat === '搪胶' ? '华登' : '兴信A车间')
        const gk = `${cat}||${ws}`
        if (!groups.has(gk)) groups.set(gk, { category: cat, workshop: ws, items: [] })
        const g = groups.get(gk)!
        const parts = (md.parts && md.parts.length) ? md.parts : [{ partCode: '', partName: md.moldName, usage: 1, ejections: 1, netPerPc: 0 }]
        const colorDisplay = md.colorCode ? `${md.colorName ?? ''}/${md.colorCode}` : (md.colorName ?? '')

        if (cat === '塑胶') {
          // 塑胶: 1 模具 1 行
          const qty = Number(sched.qty) || 0
          const ejections = Number(parts[0]?.ejections) || 1
          g.items.push({
            code: sched.code, productName: sched.productName ?? prod.name,
            orderNo: sched.orderNo,
            moldId: md.moldId ?? '', moldName: md.moldName ?? '',
            partCode: '', partName: md.moldName ?? '',
            partsSummary: parts.map((p: any) => stripMatPrefix(p.partName)).join(' / '),
            partsCount: parts.length,
            colorName: md.colorName ?? '', colorCode: md.colorCode ?? '', colorDisplay,
            materialName: md.materialName ?? '', pigmentCode: md.pigmentCode ?? '',
            netGramsPerShot: Number(md.netGramsPerShot) || 0,
            setsPerShot: Number(md.setsPerShot) || 1,
            ejections, usage: 1, qty,
            unitPrice: 0, currency: 'HK$',
            deliveryDate: sched.eta ?? '',
            notes: '',
          })
          continue
        }
        // 搪胶: 1 件 1 行
        for (const pt of parts) {
          const usage = Number(pt.usage) || 1
          const qty = (Number(sched.qty) || 0) * usage
          g.items.push({
            code: sched.code, productName: sched.productName ?? prod.name,
            orderNo: sched.orderNo,
            moldId: md.moldId ?? '', moldName: md.moldName ?? '',
            partCode: pt.partCode ?? '',
            partName: stripMatPrefix(pt.partName) || md.moldName || '',
            colorName: md.colorName ?? '', colorCode: md.colorCode ?? '', colorDisplay,
            materialName: md.materialName ?? '', pigmentCode: md.pigmentCode ?? '',
            netGramsPerShot: Number(md.netGramsPerShot) || 0,
            setsPerShot: Number(md.setsPerShot) || 1,
            ejections: Number(pt.ejections) || 1,
            usage, qty,
            unitPrice: 0, currency: 'HK$',
            deliveryDate: sched.eta ?? '',
            notes: '',
          })
        }
      }
    }

    if (!groups.size) {
      message.warning('无可生成的生产单：所选货号未配置模具（请先在货号库录入排模表）')
      return
    }

    // 合并：同 (货号 + 模号 + 件号/件名) 在同一张生产单内汇总数量
    for (const g of groups.values()) {
      const merged = new Map<string, MpoItem & { _etas?: Set<string>; _orderNos?: Set<string> }>()
      const order: string[] = []
      for (const it of g.items) {
        const k = `${it.code ?? ''}||${it.moldId ?? ''}||${it.partCode ?? ''}||${it.partName ?? ''}`
        if (!merged.has(k)) {
          merged.set(k, { ...it, _etas: new Set(it.deliveryDate ? [it.deliveryDate] : []), _orderNos: new Set(it.orderNo ? [it.orderNo] : []) })
          order.push(k)
        } else {
          const cur = merged.get(k)!
          cur.qty = (Number(cur.qty) || 0) + (Number(it.qty) || 0)
          if (it.orderNo) cur._orderNos!.add(it.orderNo)
          if (it.deliveryDate) cur._etas!.add(it.deliveryDate)
        }
      }
      g.items = order.map(k => {
        const it = merged.get(k)!
        it.orderNo = [...(it._orderNos ?? [])].join('; ')
        it.deliveryDate = [...(it._etas ?? [])].sort()[0] || ''
        delete it._etas; delete it._orderNos
        return it
      })
    }

    // 生成单号
    // 搪胶: YYYYMMDD + 2 位序号
    // 塑胶: YYYYMMDD + 3 位序号 + 车间后缀 (/A, /B, 华登无后缀)
    const orderDate = dayjs().format('YYYY-MM-DD')
    const dateStr = orderDate.replace(/-/g, '')
    const existingNos = (rows ?? []).map(r => r.no ?? '')
    function dailySeq(suffix: string, padN: number): number {
      const re = new RegExp(`^${dateStr}(\\d{${padN}})${suffix ? suffix.replace(/\//g, '\\/') : ''}$`)
      let max = 0
      for (const n of existingNos) { const m = n.match(re); if (m) max = Math.max(max, parseInt(m[1], 10)) }
      return max + 1
    }
    const newMpos: Mpo[] = []
    for (const g of groups.values()) {
      let no: string
      if (g.category === '搪胶') {
        const seq = dailySeq('', 2)
        no = dateStr + String(seq).padStart(2, '0')
      } else {
        const suffix = g.workshop === '兴信A车间' ? '/A' : g.workshop === '兴信B车间' ? '/B' : ''
        const seq = dailySeq(suffix, 3)
        no = dateStr + String(seq).padStart(3, '0') + suffix
      }
      existingNos.push(no)
      newMpos.push({
        no,
        customer: picked[0]?.customer || 'TOMY',
        category: g.category,
        workshop: g.workshop,
        status: 'draft',
        orderDate,
        deliveryDate: '',
        currency: 'HK$',
        notes: '',
        items: g.items,
      })
    }

    setRows(rs => [...newMpos, ...rs])
    setDirty(true)
    setPickerOpen(false); setPickerSel([])
    message.success(`已生成 ${newMpos.length} 张生产单（${newMpos.map(m => m.category + ' ' + m.workshop).join(' · ')}）— 别忘点 💾 保存全部`)
  }

  function stripMatPrefix(s?: string): string {
    if (!s) return ''
    return s.replace(/^(塑胶件|搪胶件)-/, '').trim()
  }

  async function saveAll() {
    setLoading(true)
    try {
      const resp = await api.put('/molding-pos/blob', rows, { headers: { 'X-Expected-Version': blobVersion.current } })
      blobVersion.current = resp.headers['x-blob-version'] ?? blobVersion.current
      message.success('已保存')
      setDirty(false)
    } catch (e: any) {
      if ((e as any)?.response?.status === 409) {
        message.error('数据已被他人修改，正在刷新…')
        load()
        return
      }
      message.error('保存失败: ' + (e?.message ?? e))
    } finally { setLoading(false) }
  }

  function openCreate() {
    const next: Mpo = { no: '', customer: customerFilter, category: '塑胶', workshop: '兴信A车间', status: 'draft', currency: 'HK$', items: [] }
    setRows(rs => [next, ...rs])
    setDirty(true)
    openEdit(0)
  }
  function openEdit(idx: number) {
    const m = rows[idx]
    setEditingIdx(idx)
    setItems(Array.isArray(m.items) ? [...m.items] : [])
    editingForm.resetFields()
    setTimeout(() => editingForm.setFieldsValue({
      no: m.no, customer: m.customer, category: m.category, workshop: m.workshop,
      status: m.status || 'draft', orderDate: m.orderDate, deliveryDate: m.deliveryDate,
      currency: m.currency || 'HK$', notes: m.notes,
    }), 0)
  }
  function closeEdit() {
    setEditingIdx(null); setItems([]); setDrawerFull(false)
  }
  function applyEdit() {
    if (editingIdx === null) return
    const v = editingForm.getFieldsValue()
    setRows(rs => rs.map((r, i) => i === editingIdx ? { ...r, ...v, items } : r))
    setDirty(true)
    closeEdit()
  }
  function delMpo(idx: number) {
    setRows(rs => rs.filter((_, i) => i !== idx))
    setDirty(true)
  }

  function patchItem(i: number, k: keyof MpoItem, v: any) {
    setItems(its => its.map((it, idx) => idx === i ? { ...it, [k]: v } : it))
  }
  function addItem() { setItems(its => [...its, { qty: 0, unitPrice: 0, currency: editingForm.getFieldValue('currency') || 'HK$' }]) }
  function delItem(i: number) { setItems(its => its.filter((_, idx) => idx !== i)) }

  const customerStats = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rows) m.set(r.customer || '(未分配)', (m.get(r.customer || '(未分配)') ?? 0) + 1)
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [rows])

  const filtered = useMemo(() => rows
    .map((m, _i) => ({ m, _i }))
    .filter(({ m }) => {
      if (customerFilter && (m.customer || '(未分配)') !== customerFilter) return false
      if (statusFilter && (m.status || 'draft') !== statusFilter) return false
      if (!filter) return true
      const s = filter.toLowerCase()
      return ((m.no || '') + (m.customer || '') + (m.notes || '')).toLowerCase().includes(s)
    }), [rows, filter, customerFilter, statusFilter])

  const statsByStatus = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rows) m.set(r.status || 'draft', (m.get(r.status || 'draft') ?? 0) + 1)
    return m
  }, [rows])

  const itemsTotal = useMemo(() => items.reduce((s, it) => s + (it.qty ?? 0) * (it.unitPrice ?? 0), 0), [items])

  return (
    <div style={{ padding: 16 }}>
      <Card
        title={
          <span>
            啤货/搪胶生产单 — 共 <b>{rows.length}</b> 张
            {dirty && <span style={{ color: '#fa8c16' }}> · 未保存</span>}
          </span>
        }
        extra={
          <Space wrap>
            <Input.Search allowClear placeholder="搜索 单号/客户/备注" style={{ width: 240 }}
              onSearch={setFilter} onChange={(e) => !e.target.value && setFilter('')} />
            <Select
              value={statusFilter} onChange={setStatusFilter}
              style={{ width: 140 }}
              options={[{ value: '', label: `全部状态 (${rows.length})` },
                ...STATUS.map(s => ({ value: s.value, label: `${s.label} (${statsByStatus.get(s.value) ?? 0})` }))]}
            />
            <Button onClick={load} disabled={loading}>🔄 重新加载</Button>
            <Button type="primary" onClick={() => setPickerOpen(true)}>🔗 从排期生成生产单</Button>
            <Button onClick={openCreate}>➕ 手动新增</Button>
            <Button type="primary" onClick={saveAll} loading={loading} disabled={!dirty}>💾 保存全部</Button>
          </Space>
        }
        tabList={[
          { key: '', tab: `全部 (${rows.length})` },
          ...customerStats.map(([name, count]) => ({ key: name, tab: `${name} (${count})` })),
        ]}
        activeTabKey={customerFilter}
        onTabChange={setCustomerFilter}
      >
        <Table
          rowKey={(_, i) => String(i)}
          size="small"
          loading={loading}
          dataSource={filtered}
          pagination={{ defaultPageSize: 50, showSizeChanger: true }}
          columns={[
            { title: '单号', dataIndex: ['m', 'no'], width: 180 },
            { title: '客户', dataIndex: ['m', 'customer'], width: 160 },
            {
              title: '类别', dataIndex: ['m', 'category'], width: 80,
              render: (v) => <Tag color={v === '搪胶' ? 'orange' : 'blue'}>{v || '塑胶'}</Tag>,
            },
            { title: '车间', dataIndex: ['m', 'workshop'], width: 110 },
            {
              title: '状态', dataIndex: ['m', 'status'], width: 100,
              render: (v) => {
                const s = STATUS.find(x => x.value === v) ?? STATUS[0]
                return <Tag color={s.color}>{s.label}</Tag>
              },
            },
            { title: '下单日期', dataIndex: ['m', 'orderDate'], width: 110 },
            { title: '交货日期', dataIndex: ['m', 'deliveryDate'], width: 110 },
            {
              title: '行数', width: 70, align: 'right',
              render: (_v, r) => r.m.items?.length ?? 0,
            },
            {
              title: '总数量', width: 90, align: 'right',
              render: (_v, r) => (r.m.items ?? []).reduce((s, it) => s + (it.qty ?? 0), 0),
            },
            {
              title: '金额', width: 130, align: 'right',
              render: (_v, r) => {
                const tot = (r.m.items ?? []).reduce((s, it) => s + (it.qty ?? 0) * (it.unitPrice ?? 0), 0)
                return `${r.m.currency || 'HK$'} ${tot.toFixed(2)}`
              },
            },
            {
              title: '操作', width: 180,
              render: (_v, r) => (
                <Space>
                  <a onClick={() => openEdit(r._i)}>编辑</a>
                  <a onClick={async () => {
                    const { exportMpo } = await import('../utils/moldingPoExport')
                    await exportMpo(r.m as any)
                    message.success(`已导出 ${r.m.no}`)
                  }}>📤 导出</a>
                  <Popconfirm title={`删除 ${r.m.no}?`} onConfirm={() => delMpo(r._i)}>
                    <a style={{ color: '#ff4d4f' }}>删除</a>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Drawer
        open={editingIdx !== null}
        width={drawerFull ? '100vw' : '70vw'}
        title={editingIdx !== null && rows[editingIdx]?.no ? `编辑生产单 — ${rows[editingIdx]?.no}` : '编辑生产单'}
        onClose={closeEdit}
        destroyOnClose
        extra={
          <Space>
            <Button onClick={() => setDrawerFull(!drawerFull)}>{drawerFull ? '⤢ 退出全屏' : '⤡ 全屏'}</Button>
            <Button type="primary" onClick={applyEdit}>✓ 应用到列表（仍需点 💾 保存全部）</Button>
          </Space>
        }
      >
        <Form form={editingForm} layout="vertical"
          onValuesChange={(changed) => {
            if (changed.currency) setItems(its => its.map(it => ({ ...it, currency: changed.currency })))
          }}
        >
          <Row gutter={12}>
            <Col span={6}><Form.Item name="no" label="单号"><Input /></Form.Item></Col>
            <Col span={6}>
              <Form.Item name="customer" label="客户">
                <AutoComplete
                  style={{ width: '100%' }}
                  options={customers.map(c => ({ value: c, label: c }))}
                  filterOption={(input, opt) => (opt?.label?.toString() ?? '').toLowerCase().includes(input.toLowerCase())}
                />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item name="category" label="类别">
                <Select options={CATEGORIES.map(c => ({ value: c, label: c }))} />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item name="workshop" label="车间">
                <Select options={WORKSHOPS.map(w => ({ value: w, label: w }))} />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item name="status" label="状态">
                <Select options={STATUS.map(s => ({ value: s.value, label: s.label }))} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="orderDate" label="下单日期"
                getValueProps={(v) => ({ value: v ? dayjs(v) : null })}
                normalize={(v: any) => v ? dayjs(v).format('YYYY-MM-DD') : ''}>
                <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="deliveryDate" label="交货日期"
                getValueProps={(v) => ({ value: v ? dayjs(v) : null })}
                normalize={(v: any) => v ? dayjs(v).format('YYYY-MM-DD') : ''}>
                <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item name="currency" label="币种">
                <Select options={CURR} />
              </Form.Item>
            </Col>
            <Col span={8}><Form.Item name="notes" label="备注"><Input /></Form.Item></Col>
          </Row>
        </Form>

        <Card
          size="small"
          title={`明细 (${items.length}) · 金额合计 ${itemsTotal.toFixed(2)}`}
          extra={<Button size="small" onClick={addItem}>➕ 加一行</Button>}
        >
          <Table
            rowKey={(_, i) => String(i)}
            size="small"
            pagination={false}
            scroll={{ x: 1400 }}
            dataSource={items}
            columns={[
              { title: '#', width: 40, render: (_v, _r, i) => i + 1 },
              { title: '件号', width: 120, render: (_v, r, i) => <Input size="small" value={r.partCode} onChange={(e) => patchItem(i, 'partCode', e.target.value)} /> },
              { title: '名称', width: 200, render: (_v, r, i) => <Input size="small" value={r.partName} onChange={(e) => patchItem(i, 'partName', e.target.value)} /> },
              { title: '用料', width: 160, render: (_v, r, i) => <Input size="small" value={r.materialName} onChange={(e) => patchItem(i, 'materialName', e.target.value)} /> },
              { title: '颜色', width: 100, render: (_v, r, i) => <Input size="small" value={r.colorName} onChange={(e) => patchItem(i, 'colorName', e.target.value)} /> },
              { title: '色粉号', width: 90, render: (_v, r, i) => <Input size="small" value={r.pigmentCode} onChange={(e) => patchItem(i, 'pigmentCode', e.target.value)} /> },
              { title: '数量', width: 100, render: (_v, r, i) => <InputNumber size="small" min={0} value={r.qty} onChange={(v) => patchItem(i, 'qty', v ?? 0)} style={{ width: '100%' }} /> },
              { title: '单价', width: 110, render: (_v, r, i) => <InputNumber size="small" min={0} step={0.0001} value={r.unitPrice} onChange={(v) => patchItem(i, 'unitPrice', v ?? 0)} style={{ width: '100%' }} /> },
              { title: '币种', width: 100, render: (_v, r, i) => <Select size="small" value={r.currency || 'HK$'} options={CURR} onChange={(v) => patchItem(i, 'currency', v)} style={{ width: '100%' }} /> },
              { title: '小计', width: 100, align: 'right', render: (_v, r) => ((r.qty ?? 0) * (r.unitPrice ?? 0)).toFixed(2) },
              { title: '交货', width: 130, render: (_v, r, i) => <DatePicker size="small" style={{ width: '100%' }} format="YYYY-MM-DD" value={r.deliveryDate ? dayjs(r.deliveryDate) : null} onChange={(v) => patchItem(i, 'deliveryDate', v ? v.format('YYYY-MM-DD') : '')} /> },
              { title: '备注', render: (_v, r, i) => <Input size="small" value={r.notes} onChange={(e) => patchItem(i, 'notes', e.target.value)} /> },
              {
                title: '', width: 50, fixed: 'right',
                render: (_v, _r, i) => (
                  <Popconfirm title="删除该行?" onConfirm={() => delItem(i)}>
                    <a style={{ color: '#ff4d4f' }}>×</a>
                  </Popconfirm>
                ),
              },
            ]}
          />
        </Card>
      </Drawer>

      <SchedPickerModal
        open={pickerOpen}
        onCancel={() => { setPickerOpen(false); setPickerSel([]) }}
        schedRows={schedRows}
        filter={pickerFilter}
        setFilter={setPickerFilter}
        selected={pickerSel}
        setSelected={setPickerSel}
        placedOrderNos={placedOrderNos}
        hidePlaced={hidePlaced}
        setHidePlaced={setHidePlaced}
        onGenerate={generateFromPicked}
      />
    </div>
  )
}

function SchedPickerModal(props: {
  open: boolean
  onCancel: () => void
  schedRows: SchedRow[]
  filter: string
  setFilter: (v: string) => void
  selected: React.Key[]
  setSelected: (k: React.Key[]) => void
  placedOrderNos: Set<string>
  hidePlaced: boolean
  setHidePlaced: (v: boolean) => void
  onGenerate: () => void
}) {
  const filtered = props.schedRows
    .map((r, i) => ({ ...r, _i: i }))
    .filter(r => {
      if (props.hidePlaced && r.orderNo && props.placedOrderNos.has(r.orderNo.trim())) return false
      if (!props.filter) return true
      const s = props.filter.toLowerCase()
      return ((r.code || '') + (r.productName || '') + (r.orderNo || '') + (r.endCustomer || ''))
        .toLowerCase().includes(s)
    })
  return (
    <Modal
      open={props.open}
      title={`从排期生成生产单（共 ${props.schedRows.length} 行 · 已选 ${props.selected.length}）`}
      width="80vw"
      onCancel={props.onCancel}
      footer={null}
      destroyOnClose
    >
      <Space style={{ marginBottom: 8 }} wrap>
        <Input.Search allowClear placeholder="搜索 货号/品名/TOMY PO/第三客户" style={{ width: 320 }}
          onSearch={props.setFilter} onChange={(e) => !e.target.value && props.setFilter('')} />
        <Checkbox checked={props.hidePlaced} onChange={(e) => props.setHidePlaced(e.target.checked)}>隐藏已下单</Checkbox>
        <Popconfirm
          title={`按 (类别+车间) 聚合生成生产单 — 已勾 ${props.selected.length} 行`}
          onConfirm={props.onGenerate}
          disabled={!props.selected.length}
        >
          <Button type="primary" disabled={!props.selected.length}>🏭 按车间聚合生成</Button>
        </Popconfirm>
        <span style={{ color: '#999', fontSize: 12 }}>规则：搪胶/华登 1 单；塑胶/兴信A车间 1 单 (/A)；塑胶/兴信B车间 1 单 (/B)</span>
      </Space>
      <Table
        rowKey={(r: any) => String(r._i)}
        size="small"
        rowSelection={{ selectedRowKeys: props.selected, onChange: (k) => props.setSelected(k) }}
        dataSource={filtered}
        pagination={{ pageSize: 30 }}
        scroll={{ x: 1200, y: 480 }}
        columns={[
          { title: '来源', dataIndex: 'source', width: 70 },
          { title: '国家', dataIndex: 'country', width: 80 },
          { title: '货号', dataIndex: 'code', width: 100 },
          { title: '品名', dataIndex: 'productName', width: 200, ellipsis: true },
          { title: 'TOMY PO', dataIndex: 'orderNo', width: 130 },
          { title: '数量', dataIndex: 'qty', width: 90, align: 'right' },
          { title: '交期', dataIndex: 'eta', width: 110 },
        ]}
      />
    </Modal>
  )
}
