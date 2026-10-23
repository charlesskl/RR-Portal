import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  App, Button, Card, Drawer, Empty, Input, Modal, Popconfirm, Select, Space, Table, Tabs, Tag, Tooltip, Typography,
} from 'antd'
import dayjs from 'dayjs'
import { api } from '../api/client'
import { parseScheduleWorkbook } from '../utils/scheduleImport'
import { purchaseItemCodes } from '../utils/purchaseCustoms'
import { scheduleLineKey, scheduleManualPlaced, toggleScheduleManual, scheduleAutoPlaced,
  scheduleActualProduction, scheduleProductionOverride, schedulePurchasePlaced } from '../utils/scheduleLineStatus'

interface ScheduleSummary {
  id: number
  customer?: string
  week_label?: string
  upload_date?: string
  row_count?: number
}
interface ScheduleDetail {
  id: number
  customer?: string
  week_label?: string
  upload_date?: string
  raw_rows?: string
  diff_from_prev?: string
  created_at?: string
}
interface SchedRow {
  source?: string         // KIK / RRM ...
  customer?: string
  country?: string
  endCustomer?: string
  code?: string
  productName?: string
  orderNo?: string        // 订单 PO
  customerPO?: string
  orderDate?: string      // 接单期
  qty?: number
  cartons?: number        // 总箱数
  unitPrice?: number      // 单价 USD
  eta?: string            // PO 走货期
  inspDate?: string       // 验货期
  [k: string]: any
}
interface Diff {
  added?: SchedRow[]
  removed?: SchedRow[]
  changed?: { from?: SchedRow; to?: SchedRow }[]
}
interface ScheduleUploadDraft {
  session: number
  request: number
  open: boolean
  phase: 'idle' | 'parsing' | 'ready' | 'uploading'
  rows: SchedRow[]
  customer: string
  weekLabel: string
}

export default function SchedulesPage() {
  const { message } = App.useApp()
  const [rows, setRows] = useState<ScheduleSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [openId, setOpenId] = useState<number | null>(null)
  const [drawerFull, setDrawerFull] = useState(false)
  const [detail, setDetail] = useState<ScheduleDetail | null>(null)
  const [showUpload, setShowUpload] = useState(false)
  const [weekLabel, setWeekLabel] = useState('')
  const [uploadRows, setUploadRows] = useState<SchedRow[]>([])
  const [customerFilter, setCustomerFilter] = useState<string>()
  const [uploadCustomer, setUploadCustomer] = useState('')
  const [uploadSessionId, setUploadSessionId] = useState(0)
  const [parsing, setParsing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const uploadDraftRef = useRef<ScheduleUploadDraft>({
    session: 0, request: 0, open: false, phase: 'idle', rows: [], customer: '', weekLabel: '',
  })
  const [customers, setCustomers] = useState<string[]>([])
  const customerNames = [...new Set(['TOMY', 'Spin Master', ...customers, ...rows.map(r => r.customer || 'TOMY')])]
  const customerOptions = customerNames.map(value => ({ label: value, value }))
  const visibleRows = customerFilter ? rows.filter(r => (r.customer || 'TOMY') === customerFilter) : rows
  const fileRef = useRef<HTMLInputElement>(null)

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get<ScheduleSummary[]>('/schedules')
      setRows(Array.isArray(data) ? data : [])
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])
  useEffect(() => { api.get<string[]>('/customers').then(({ data }) => setCustomers(data || [])).catch(() => {}) }, [])
  useEffect(() => () => { uploadDraftRef.current.open = false; uploadDraftRef.current.request++ }, [])

  async function openDetail(id: number) {
    setOpenId(id); setDetail(null)
    try {
      const { data } = await api.get<ScheduleDetail>(`/schedules/${id}`)
      setDetail(data)
    } catch (e: any) {
      message.error('加载失败: ' + (e?.message ?? e))
    }
  }
  function resetUploadContext(open: boolean, customer = '') {
    const session = uploadDraftRef.current.session + 1
    uploadDraftRef.current = { session, request: 0, open, phase: 'idle', rows: [], customer, weekLabel: '' }
    setUploadSessionId(session)
    setShowUpload(open); setUploadRows([]); setUploadCustomer(customer); setWeekLabel('')
    setParsing(false); setUploading(false)
  }
  function openUpload() {
    if (uploadDraftRef.current.phase !== 'uploading') resetUploadContext(true, customerFilter || '')
  }
  function closeUpload() {
    const draft = uploadDraftRef.current
    if (draft.session === uploadSessionId && draft.phase !== 'uploading') resetUploadContext(false)
  }
  function changeUploadCustomer(value?: string) {
    const draft = uploadDraftRef.current
    if (!draft.open || draft.session !== uploadSessionId || draft.phase === 'uploading') return
    draft.request++; draft.phase = 'idle'; draft.rows = []; draft.customer = value || ''
    setUploadCustomer(draft.customer); setUploadRows([]); setParsing(false)
  }
  function changeUploadWeekLabel(value: string) {
    const draft = uploadDraftRef.current
    if (!draft.open || draft.session !== uploadSessionId || draft.phase === 'uploading') return
    draft.weekLabel = value
    setWeekLabel(value)
  }
  async function parseFile(file: File) {
    const draft = uploadDraftRef.current
    if (!draft.open || draft.session !== uploadSessionId || draft.phase === 'uploading') return
    const session = draft.session, request = ++draft.request, customer = draft.customer
    const current = () => uploadDraftRef.current.open && uploadDraftRef.current.session === session
      && uploadDraftRef.current.request === request
    draft.phase = 'parsing'; draft.rows = []
    setUploadRows([])
    setParsing(true)
    try {
      const XLSX = await import('xlsx')
      const bytes = await file.arrayBuffer()
      if (!current()) return
      const wb = XLSX.read(bytes, { type: 'array', cellDates: false })
      const parsed = parseScheduleWorkbook(wb, XLSX.utils, customer)
      if (!current()) return
      draft.phase = 'ready'; draft.rows = parsed.rows; draft.customer = parsed.customer
      setUploadRows(parsed.rows)
      setUploadCustomer(parsed.customer)
      if (!draft.weekLabel) { draft.weekLabel = suggestWeekLabel(); setWeekLabel(draft.weekLabel) }
      message.success(`已识别 ${parsed.customer} 排期 ${parsed.rows.length} 条；仅导入总排期主表`)
    } catch (e: any) {
      if (!current()) return
      draft.phase = 'idle'
      message.error('解析失败: ' + (e?.message ?? e))
    } finally { if (current()) setParsing(false) }
  }

  async function upload() {
    const draft = uploadDraftRef.current
    // The visible confirmation must still describe this session's parsed draft.
    // An old modal callback cannot submit a later session or a replacement file.
    if (!draft.open || draft.session !== uploadSessionId || draft.phase === 'uploading') return
    if (draft.phase !== 'ready' || draft.rows !== uploadRows || draft.customer !== uploadCustomer
      || draft.weekLabel !== weekLabel) return
    if (!draft.weekLabel.trim()) { message.warning('请填写周次标签'); return }
    if (!draft.rows.length) { message.warning('请先选 Excel'); return }
    const session = draft.session, request = draft.request
    const current = () => uploadDraftRef.current.open && uploadDraftRef.current.session === session
      && uploadDraftRef.current.request === request
    draft.phase = 'uploading'
    setUploading(true)
    try {
      await api.post('/schedules', {
        customer: draft.customer,
        week_label: draft.weekLabel.trim(),
        upload_date: dayjs().format('YYYY-MM-DD'),
        raw_rows: draft.rows,
      })
      if (!current()) return
      message.success(`已上传 ${draft.rows.length} 行`)
      resetUploadContext(false)
      load()
    } catch (e: any) {
      if (!current()) return
      draft.phase = 'ready'
      message.error('上传失败: ' + (e?.message ?? e))
    } finally { if (current()) setUploading(false) }
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ marginBottom: 12, padding: '8px 12px', background: '#fafafa', borderRadius: 6, fontSize: 13 }}>
        <span style={{ color: '#666', marginRight: 12 }}>上传排期 Excel → 与已有排期比对：</span>
        <Tag color="success">绿色 = 新增</Tag>
        <Tag color="warning">黄色 = 数量/交期改动</Tag>
        <Tag color="error">红色 = 导入超 7 天未下采购单</Tag>
        <Tag>白色 = 已下单 / 无变化</Tag>
      </div>
      <Card
        title={`排期管理 — 共 ${visibleRows.length} 个周次`}
        extra={
          <Space>
            <Select allowClear showSearch placeholder="全部客户" style={{ width: 180 }}
              value={customerFilter} options={customerOptions} onChange={setCustomerFilter} />
            <Button onClick={load}>🔄 刷新</Button>
            <Button type="primary" onClick={openUpload}>📥 上传新周次</Button>
          </Space>
        }
      >
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={visibleRows}
          pagination={{ defaultPageSize: 50, showSizeChanger: true }}
          columns={[
            { title: '#', dataIndex: 'id', width: 70 },
            { title: '客户', dataIndex: 'customer', width: 140, render: v => v || 'TOMY' },
            { title: '周次', dataIndex: 'week_label', width: 200, render: (v) => <Tag color="blue">{v}</Tag> },
            { title: '上传日期', dataIndex: 'upload_date', width: 130, render: (v) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '' },
            { title: '行数', dataIndex: 'row_count', width: 90, align: 'right' },
            {
              title: '操作', width: 150,
              render: (_v, r) => <a onClick={() => openDetail(r.id)}>📋 查看明细 + 差异</a>,
            },
          ]}
        />
      </Card>

      <Drawer
        open={openId !== null}
        width={drawerFull ? '100vw' : '80vw'}
        title={detail ? `${detail.customer || 'TOMY'} · 周次 — ${detail.week_label}` : '加载中…'}
        onClose={() => { setOpenId(null); setDetail(null); setDrawerFull(false) }}
        destroyOnClose
        extra={
          <Button onClick={() => setDrawerFull(!drawerFull)}>
            {drawerFull ? '⤢ 退出全屏' : '⤡ 全屏'}
          </Button>
        }
      >
        {detail && <DetailView key={detail.id} detail={detail} />}
      </Drawer>

      <Modal
        open={showUpload}
        title="上传新周次排期"
        width={780}
        onCancel={closeUpload}
        onOk={upload}
        okText="上传"
        confirmLoading={uploading}
        okButtonProps={{ disabled: parsing || !uploadRows.length }}
        closable={!uploading} maskClosable={!uploading} keyboard={!uploading}
        destroyOnClose
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Space>
            <span>客户：</span>
            <Select allowClear showSearch placeholder="从文件识别客户（TOMY 模板默认 TOMY）" style={{ width: 360 }}
              value={uploadCustomer || undefined} options={customerOptions}
              disabled={uploading} onChange={changeUploadCustomer} />
          </Space>
          <Space>
            <span>周次标签：</span>
            <Input value={weekLabel} disabled={uploading} onChange={(e) => changeUploadWeekLabel(e.target.value)} placeholder="例如 W23 / 2026-W23 / 2026-06-08" style={{ width: 280 }} />
            <Button disabled={uploading} onClick={() => fileRef.current?.click()}>📂 选 Excel</Button>
            {parsing && <Typography.Text type="secondary">正在读取文件…</Typography.Text>}
            <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
              disabled={uploading}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) parseFile(f); e.target.value = '' }} />
          </Space>
          <Typography.Text type="secondary">
            支持 TOMY 的 KIK/RRM 总排期及 Spin Master 接单总排期；仅覆盖同一客户的同周次，不覆盖其他客户。完整货号不拆分，下单状态不依赖单元格底色。
          </Typography.Text>
          {uploadRows.length > 0 && (
            <Table
              rowKey={(_, i) => String(i)}
              size="small"
              dataSource={uploadRows.slice(0, 50)}
              pagination={false}
              scroll={{ x: 1500, y: 320 }}
              columns={[
                { title: '#', width: 45, render: (_v, _r, i) => i + 1 },
                { title: '客户', dataIndex: 'customer', width: 110 },
                { title: '来源', dataIndex: 'source', width: 70 },
                { title: '国家', dataIndex: 'country', width: 80 },
                { title: '第三客户', dataIndex: 'endCustomer', width: 130, ellipsis: true },
                { title: '货号', dataIndex: 'code', width: 200 },
                { title: '品名', dataIndex: 'productName', width: 200, ellipsis: true },
                { title: '订单 PO', dataIndex: 'orderNo', width: 110 },
                { title: 'CUST PO', dataIndex: 'customerPO', width: 110 },
                { title: '数量', dataIndex: 'qty', width: 80, align: 'right' },
                { title: '总箱数', dataIndex: 'cartons', width: 80, align: 'right' },
                { title: '单价USD', dataIndex: 'unitPrice', width: 90, align: 'right', render: (v) => v ? Number(v).toFixed(3) : '' },
                { title: 'PO走货期', dataIndex: 'eta', width: 110 },
                { title: '验货期', dataIndex: 'inspDate', width: 110 },
              ]}
              footer={() => uploadRows.length > 50 ? `… 还有 ${uploadRows.length - 50} 行` : null}
            />
          )}
        </Space>
      </Modal>
    </div>
  )
}

function DetailView({ detail }: { detail: ScheduleDetail }) {
  const rawRows = useMemo(() => safeParse<SchedRow[]>(detail.raw_rows) ?? [], [detail])
  const diff = useMemo(() => safeParse<Diff>(detail.diff_from_prev) ?? {}, [detail])
  const added = useMemo(() => diff.added ?? [], [diff.added])
  const removed = useMemo(() => diff.removed ?? [], [diff.removed])
  const changed = useMemo(() => diff.changed ?? [], [diff.changed])

  // Build sets for status coloring
  const addedKeys   = useMemo(() => new Set(added.map(schedKeyOf)), [added])
  const changedKeys = useMemo(() => new Set(changed.map(c => schedKeyOf(c.to ?? c.from ?? {}))), [changed])
  // 每个改动行 → 变动关键字段的 原值/新值（数量/走货期/品名/单价），用于高亮单元格并 tooltip 显示差异
  const changedFields = useMemo(() => {
    const m = new Map<string, Record<string, { from: any; to: any }>>()
    for (const c of changed) {
      m.set(schedKeyOf(c.to ?? c.from ?? {}), significantChangedDiff(c.from ?? {}, c.to ?? {}))
    }
    return m
  }, [changed])

  const { message } = App.useApp()
  // Fetch placed-order keys (TOMY PO + 货号) to know which schedule lines are "已下单"
  const [placedKeys, setPlacedKeys] = useState<Set<string>>(new Set())   // 自动匹配
  const [manualKeys, setManualKeys] = useState<Set<string>>(new Set())   // 手动标记
  const [productionPlacedPos, setProductionPlacedPos] = useState<Set<string>>(new Set())
  const [productionManual, setProductionManual] = useState<Map<string, boolean>>(new Map())
  const [productionDataLoaded, setProductionDataLoaded] = useState(false)
  const [matCost, setMatCost] = useState<Map<string, { cost: number; currency: string }>>(new Map())
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get<{ tomy_po?: string; product_code?: string }[]>('/purchase/placed-keys')
        const set = new Set<string>()
        // 合并同名后 tomy_po 可能是 "o1; o2"、货号 "a / b"，拆开做交叉对，保证合并单也能匹配
        for (const x of data) {
          const pos = String(x.tomy_po || '').split(/\s*[;；]\s*/).map(s => s.trim()).filter(Boolean)
          const codes = purchaseItemCodes(x.product_code, rawRows.map(r => r.code))
          for (const po of pos) for (const c of codes) set.add(`${po}|${c}`)
        }
        setPlacedKeys(set)
      } catch {}
      try {
        const { data } = await api.get<string[]>('/schedules/placed-manual')
        setManualKeys(new Set(Array.isArray(data) ? data : []))
      } catch {}
      try {
        const { data } = await api.get<Record<string, boolean>>('/schedules/production-placed-manual')
        setProductionManual(new Map(Object.entries(data && typeof data === 'object' ? data : {})))
      } catch {}
      try {
        const { data } = await api.get<any[]>('/molding-pos/blob')
        const set = new Set<string>()
        for (const mpo of (Array.isArray(data) ? data : [])) {
          for (const it of (Array.isArray(mpo.items) ? mpo.items : [])) {
            const pos = String(it.orderNo || '').split(/\s*[;；]\s*/).map(s => s.trim()).filter(Boolean)
            for (const po of pos) set.add(po)
          }
        }
        setProductionPlacedPos(set)
      } catch {} finally { setProductionDataLoaded(true) }
      try {
        const { data } = await api.get<{ code?: string; cost?: number; currency?: string }[]>('/purchase/material-cost-by-code')
        const m = new Map<string, { cost: number; currency: string }>()
        for (const x of data) if (x.code) m.set(x.code, { cost: Number(x.cost) || 0, currency: x.currency || '¥' })
        setMatCost(m)
      } catch {}
    })()
  }, [])
  // 物料单价合计：按货号 Σ(单价×用量)，来自所有采购单
  // 物料成本按币种折算美金（物料多以 ¥ 记；未知币种按 ¥ 处理）
  const matCostInfo = (r: SchedRow): { usd: number; orig: string } | null => {
    const m = matCost.get(r.code ?? '')
    if (!m || !(m.cost > 0)) return null
    const per = FX_PER_USD[m.currency] ?? FX_PER_USD['¥']
    return { usd: m.cost / per, orig: `${m.currency} ${m.cost.toFixed(3)}` }
  }
  // 全部货号(去重)的物料成本合计(US$)
  const matCostTotalUsd = useMemo(() => {
    let s = 0
    for (const m of matCost.values()) s += (m.cost > 0 ? m.cost / (FX_PER_USD[m.currency] ?? FX_PER_USD['¥']) : 0)
    return s
  }, [matCost])

  // 切换手动标记并持久化
  async function toggleManual(r: SchedRow) {
    if (!r.orderNo || !r.code) { message.warning('该行缺少订单 PO 或货号，无法标记'); return }
    const k = placedKeyOf(r)
    if (!k) { message.warning('请刷新排期后再标记'); return }
    const removing = scheduleManualPlaced(r, manualKeys)
    const next = toggleScheduleManual(r, manualKeys)
    // 分开取消采购时，保留取消前的生产状态，之后可单独取消生产。
    const productionNext = new Map(productionManual)
    if (removing && isProductionPlaced(r) && !isActualProductionPlaced(r)) productionNext.set(k, true)
    setManualKeys(next)
    setProductionManual(productionNext)
    try {
      await Promise.all([
        api.put('/schedules/placed-manual', [...next]),
        api.put('/schedules/production-placed-manual', Object.fromEntries(productionNext)),
      ])
      message.success(next.has(k) ? '已标记已下单' : '已取消标记')
    } catch (e: any) {
      setManualKeys(manualKeys)  // 回滚
      setProductionManual(productionManual)
      message.error('保存失败: ' + (e?.message ?? e))
    }
  }

  // 已下单：自动(采购单命中) 或 手动标记
  const isAutoPlaced = useCallback((r: SchedRow) => scheduleAutoPlaced(r, placedKeys), [placedKeys])
  const isPlaced = useCallback((r: SchedRow) => schedulePurchasePlaced(r, placedKeys, manualKeys), [placedKeys, manualKeys])
  const isActualProductionPlaced = useCallback((r: SchedRow) => scheduleActualProduction(r, productionPlacedPos), [productionPlacedPos])
  // 手动覆盖优先；未单独设置时生产状态跟随采购，真实生产单始终为已下。
  const isProductionPlaced = useCallback((r: SchedRow) => {
    if (isActualProductionPlaced(r)) return true
    const override = scheduleProductionOverride(r, productionManual)
    return override ?? isPlaced(r)
  }, [isActualProductionPlaced, isPlaced, productionManual])
  async function toggleProductionManual(r: SchedRow) {
    if (!r.orderNo || !r.code) { message.warning('该行缺少订单 PO 或货号，无法标记'); return }
    if (isActualProductionPlaced(r)) { message.warning('该订单 PO 已生成真实生产单，不能手动取消'); return }
    const k = placedKeyOf(r)
    if (!k) { message.warning('请刷新排期后再标记'); return }
    const nextValue = !isProductionPlaced(r)
    const next = new Map(productionManual)
    next.set(k, nextValue)
    setProductionManual(next)
    try {
      await api.put('/schedules/production-placed-manual', Object.fromEntries(next))
      message.success(nextValue ? '已标记生产已下' : '已取消生产标记')
    } catch (e: any) {
      setProductionManual(productionManual)
      message.error('保存失败: ' + (e?.message ?? e))
    }
  }

  // Determine row status (used by 本周明细 tab)
  function statusOf(r: SchedRow): 'new' | 'modified' | 'overdue' | 'normal' {
    const k = schedKeyOf(r)
    if (addedKeys.has(k)) return 'new'
    if (changedKeys.has(k)) return 'modified'
    // 导入超 7 天且仍未下单 → 红
    const ageDays = detail.upload_date ? dayjs().diff(dayjs(detail.upload_date), 'day') : 0
    if (ageDays > 7 && !isPlaced(r)) return 'overdue'
    return 'normal'
  }
  const placedCount = useMemo(() => rawRows.filter(isPlaced).length, [rawRows, isPlaced])
  const productionPlacedCount = useMemo(() => rawRows.filter(isProductionPlaced).length, [rawRows, isProductionPlaced])

  // 搜索过滤：货号/品名/TOMY PO/CUST PO/第三客户/客户/来源
  const [q, setQ] = useState('')
  const match = (r: SchedRow) => {
    if (!q) return true
    const s = q.toLowerCase()
    return [r.code, r.productName, r.orderNo, r.customerPO, r.endCustomer, r.customer, r.source]
      .some(v => String(v ?? '').toLowerCase().includes(s))
  }
  const fRows    = rawRows.filter(match)
  const fUnplaced = rawRows.filter(r => !isPlaced(r) && match(r))
  const fAdded   = added.filter(match)
  const fRemoved = removed.filter(match)
  const fChanged = changed.filter(c => match(c.to ?? c.from ?? {}))

  return (
    <>
      <Input.Search allowClear placeholder="搜索 货号 / 品名 / 订单 PO / CUST PO / 第三客户" style={{ maxWidth: 420, marginBottom: 12 }}
        onChange={(e) => setQ(e.target.value)} onSearch={setQ} />
      <Tabs
        items={[
          {
            key: 'rows', label: `本周明细 (${fRows.length}${placedCount ? ` · 采购已下 ${placedCount}` : ''}${productionPlacedCount ? ` · 生产已下 ${productionPlacedCount}` : ''})`,
            children: <SchedRowsTable rows={fRows} statusOf={statusOf} changedFields={changedFields}
              isPlaced={isPlaced} isAutoPlaced={isAutoPlaced} onToggleManual={toggleManual}
              isProductionPlaced={isProductionPlaced} isActualProductionPlaced={isActualProductionPlaced}
              productionDataLoaded={productionDataLoaded} onToggleProductionManual={toggleProductionManual}
              matCostInfo={matCostInfo} matCostTotalUsd={matCostTotalUsd} />,
          },
          {
            key: 'unplaced', label: `未下单 (${fUnplaced.length})`,
            children: fUnplaced.length === 0
              ? <Empty description="暂无未下单排期" />
              : <SchedRowsTable rows={fUnplaced} statusOf={statusOf} changedFields={changedFields}
                  isPlaced={isPlaced} isAutoPlaced={isAutoPlaced} onToggleManual={toggleManual}
                  isProductionPlaced={isProductionPlaced} isActualProductionPlaced={isActualProductionPlaced}
                  productionDataLoaded={productionDataLoaded} onToggleProductionManual={toggleProductionManual}
                  matCostInfo={matCostInfo} matCostTotalUsd={matCostTotalUsd} />,
          },
          {
            key: 'add', label: `新增 (${fAdded.length})`,
            children: fAdded.length === 0
              ? <Empty description="无新增" />
              : <SchedRowsTable rows={fAdded} highlight="add" />,
          },
          {
            key: 'rm', label: `删除 (${fRemoved.length})`,
            children: fRemoved.length === 0
              ? <Empty description="无删除" />
              : <SchedRowsTable rows={fRemoved} highlight="rm" />,
          },
          {
            key: 'chg', label: `修改 (${fChanged.length})`,
            children: fChanged.length === 0
              ? <Empty description="无修改" />
              : <ChangedTable changed={fChanged} />,
          },
        ]}
      />
    </>
  )
}

function SchedRowsTable({ rows, highlight, statusOf, changedFields, isPlaced, isAutoPlaced, isProductionPlaced, isActualProductionPlaced, productionDataLoaded, onToggleManual, onToggleProductionManual, matCostInfo, matCostTotalUsd }: {
  rows: SchedRow[]
  highlight?: 'add' | 'rm'
  statusOf?: (r: SchedRow) => 'new' | 'modified' | 'overdue' | 'normal'
  changedFields?: Map<string, Record<string, { from: any; to: any }>>
  isPlaced?: (r: SchedRow) => boolean
  isAutoPlaced?: (r: SchedRow) => boolean
  isProductionPlaced?: (r: SchedRow) => boolean
  isActualProductionPlaced?: (r: SchedRow) => boolean
  productionDataLoaded?: boolean
  onToggleManual?: (r: SchedRow) => void
  onToggleProductionManual?: (r: SchedRow) => void
  matCostInfo?: (r: SchedRow) => { usd: number; orig: string } | null
  matCostTotalUsd?: number
}) {
  function classOf(r: SchedRow): string {
    if (highlight === 'add') return 'sched-row-add'
    if (highlight === 'rm') return 'sched-row-rm'
    if (statusOf) {
      const s = statusOf(r)
      if (s === 'new')      return 'sched-row-add'
      if (s === 'modified') return 'sched-row-mod'
      if (s === 'overdue')  return 'sched-row-rm'
    }
    return ''
  }
  // 变动单元格醒目高亮（橙色），仅对该行实际变动的关键字段
  const diffOf = (r: SchedRow, field: string) => changedFields?.get(schedKeyOf(r))?.[field]
  const cellHi = (field: string) => (r: SchedRow) =>
    diffOf(r, field) ? { className: 'sched-cell-changed' as const } : {}
  // 改动单元格：显示新值 + tooltip 标出 原值→新值
  const cellTip = (field: string, fmt: (v: any) => any = (v) => v) => (val: any, r: SchedRow) => {
    const d = diffOf(r, field)
    const shown = fmt(val)
    if (!d) return shown
    return <Tooltip title={`原: ${d.from ?? '-'} → 新: ${d.to ?? '-'}`}><span>{shown}</span></Tooltip>
  }
  return (
    <>
    <style>{`
      .sched-row-add td { background: #f6ffed !important; }
      .sched-row-mod td { background: #fffbe6 !important; }
      .sched-row-rm  td { background: #fff1f0 !important; }
      td.sched-cell-changed { background: #fa8c16 !important; color: #fff !important; font-weight: 700; }
    `}</style>
    <Table
      rowKey={(_, i) => String(i)}
      size="small"
      dataSource={rows}
      pagination={{ defaultPageSize: 50, showSizeChanger: true }}
      rowClassName={(r) => classOf(r)}
      scroll={{ x: 1500 }}
      columns={[
        { title: '#', width: 45, render: (_v, _r, i) => i + 1 },
        ...(isPlaced ? [{
          title: '下单状态', width: 380, fixed: 'left' as const,
          render: (_v: any, r: SchedRow) => {
            const auto = isAutoPlaced?.(r)
            const placed = isPlaced(r)
            const productionPlaced = isProductionPlaced?.(r)
            const actualProduction = isActualProductionPlaced?.(r)
            return (
              <Space size={4}>
                <Space size={2}>
                  {placed
                    ? <Tag color="success" style={{ margin: 0 }}>采购已下{auto ? '' : '(手动)'}</Tag>
                    : <Tag style={{ margin: 0, color: '#bbb' }}>采购未下</Tag>}
                  {onToggleManual && !auto && <a style={{ fontSize: 12 }} onClick={() => onToggleManual(r)}>{placed ? '取消采购' : '标记采购'}</a>}
                </Space>
                <Space size={2}>
                  {productionPlaced
                    ? <Tag color="blue" style={{ margin: 0 }}>生产已下</Tag>
                    : <Tag style={{ margin: 0, color: '#bbb' }}>生产未下</Tag>}
                  {onToggleProductionManual && productionDataLoaded && !actualProduction && (
                    <a style={{ fontSize: 12 }} onClick={() => onToggleProductionManual(r)}>{productionPlaced ? '取消生产' : '标记生产'}</a>
                  )}
                </Space>
              </Space>
            )
          },
        }] : []),
        { title: '来源', dataIndex: 'source', width: 70 },
        { title: '国家', dataIndex: 'country', width: 80 },
        { title: '第三客户', dataIndex: 'endCustomer', width: 140, ellipsis: true },
        { title: '货号', dataIndex: 'code', width: 100 },
        { title: '品名', dataIndex: 'productName', width: 200, ellipsis: true, onCell: cellHi('productName'), render: cellTip('productName') },
        { title: '订单 PO', dataIndex: 'orderNo', width: 120 },
        { title: 'CUST PO', dataIndex: 'customerPO', width: 110 },
        { title: '数量', dataIndex: 'qty', width: 80, align: 'right', onCell: cellHi('qty'), render: cellTip('qty') },
        { title: '总箱数', dataIndex: 'cartons', width: 80, align: 'right' },
        { title: '单价USD', dataIndex: 'unitPrice', width: 90, align: 'right', onCell: cellHi('unitPrice'), render: cellTip('unitPrice', (v) => v ? Number(v).toFixed(3) : '') },
        ...(matCostInfo ? [{
          title: '物料单价合计(US$)', width: 140, align: 'right' as const,
          render: (_v: any, r: SchedRow) => {
            const m = matCostInfo(r)
            if (!m) return <span style={{ color: '#bbb' }} title="该货号未生成 PO 或物料未填单价">—</span>
            return <Tooltip title={`原值 ${m.orig}（按 ¥7.1 / HK$7.8 折美金）`}>
              <span style={{ fontWeight: 600, color: '#3a7bc0' }}>US$ {m.usd.toFixed(3)}</span>
            </Tooltip>
          },
        }] : []),
        { title: 'PO走货期', dataIndex: 'eta', width: 110, onCell: cellHi('eta'), render: cellTip('eta') },
        { title: '验货期', dataIndex: 'inspDate', width: 110 },
      ]}
      summary={matCostInfo ? () => (
        <Table.Summary fixed>
          <Table.Summary.Row>
            <Table.Summary.Cell index={0} colSpan={99}>
              <span style={{ color: '#3a7bc0', fontWeight: 600 }}>
                物料单价合计（全部货号去重）：US$ {(matCostTotalUsd ?? 0).toFixed(3)}
              </span>
              <span style={{ color: '#999', marginLeft: 8, fontSize: 12 }}>
                ※ 物料成本来自采购单 Σ(单价×用量)，按 ¥7.1 / HK$7.8 折算美金
              </span>
            </Table.Summary.Cell>
          </Table.Summary.Row>
        </Table.Summary>
      ) : undefined}
    />
    </>
  )
}

// 各币种兑 1 美元的汇率（单位货币数量 / 1 USD），用于物料成本折算美金
const FX_PER_USD: Record<string, number> = {
  '¥': 7.1, 'CNY': 7.1, 'RMB': 7.1, '人民币': 7.1,
  'HK$': 7.8, 'HKD': 7.8, '港币': 7.8,
  'US$': 1, 'USD': 1, '$': 1, '美元': 1, '美金': 1,
  '€': 0.92, 'EUR': 0.92,
}

// 后端逐条跨期配对的明细身份；同一个 MA + 货号可以有多条独立订单。
function schedKeyOf(r: SchedRow): string {
  return scheduleLineKey(r)
}

function placedKeyOf(r: SchedRow): string {
  return scheduleLineKey(r)
}
// 关键字段实际变动的 原值/新值（数量/走货期/品名/单价），与后端 IsModified 同口径
function significantChangedDiff(from: SchedRow, to: SchedRow): Record<string, { from: any; to: any }> {
  const d: Record<string, { from: any; to: any }> = {}
  if ((Number(from.qty) || 0) !== (Number(to.qty) || 0)) d.qty = { from: from.qty ?? 0, to: to.qty ?? 0 }
  if (String(from.eta ?? '') !== String(to.eta ?? '')) d.eta = { from: from.eta ?? '', to: to.eta ?? '' }
  if (String(from.productName ?? '') !== String(to.productName ?? '')) d.productName = { from: from.productName ?? '', to: to.productName ?? '' }
  if ((Number(from.unitPrice) || 0) !== (Number(to.unitPrice) || 0)) d.unitPrice = { from: from.unitPrice ?? 0, to: to.unitPrice ?? 0 }
  return d
}

function ChangedTable({ changed }: { changed: { from?: SchedRow; to?: SchedRow }[] }) {
  return (
    <Table
      rowKey={(_, i) => String(i)}
      size="small"
      dataSource={changed}
      pagination={{ defaultPageSize: 50, showSizeChanger: true }}
      columns={[
        { title: '#', width: 50, render: (_v, _r, i) => i + 1 },
        { title: '货号', width: 110, render: (_v, r) => r.to?.code ?? r.from?.code },
        { title: '客户', width: 90, render: (_v, r) => r.to?.customer ?? r.from?.customer },
        { title: '订单 PO', width: 120, render: (_v, r) => r.to?.orderNo ?? r.from?.orderNo },
        { title: 'CUST PO', width: 120, render: (_v, r) => r.to?.customerPO ?? r.from?.customerPO },
        {
          title: '变化',
          render: (_v, r) => <FieldDiff from={r.from ?? {}} to={r.to ?? {}} />,
        },
      ]}
    />
  )
}

function FieldDiff({ from, to }: { from: SchedRow; to: SchedRow }) {
  const keys = new Set([...Object.keys(from), ...Object.keys(to)])
  const diffs: { k: string; from: any; to: any }[] = []
  for (const k of keys) {
    if (JSON.stringify(from[k]) !== JSON.stringify(to[k])) diffs.push({ k, from: from[k], to: to[k] })
  }
  if (!diffs.length) return <span style={{ color: '#999' }}>无差异</span>
  const SIG = new Set(['qty', 'eta', 'productName', 'unitPrice'])
  // 关键字段排前面并醒目标注
  diffs.sort((a, b) => (SIG.has(b.k) ? 1 : 0) - (SIG.has(a.k) ? 1 : 0))
  return (
    <div>
      {diffs.map(d => {
        const sig = SIG.has(d.k)
        return (
          <div key={d.k} style={{ fontSize: 12, ...(sig ? { background: '#fff7e6', borderLeft: '3px solid #fa8c16', padding: '1px 6px', margin: '2px 0', borderRadius: 3 } : {}) }}>
            <b style={sig ? { color: '#d46b08' } : undefined}>{d.k}</b>：
            <span style={{ color: '#cf1322' }}>{String(d.from ?? '-')}</span>
            {' → '}
            <span style={{ color: '#389e0d', fontWeight: sig ? 700 : 400 }}>{String(d.to ?? '-')}</span>
          </div>
        )
      })}
    </div>
  )
}

function safeParse<T>(s: string | undefined | null): T | null {
  if (!s) return null
  try { return JSON.parse(s) as T } catch { return null }
}

function suggestWeekLabel(): string {
  const d = dayjs()
  // Approx ISO week
  const start = d.startOf('year')
  const week = Math.ceil((d.diff(start, 'day') + start.day() + 1) / 7)
  return `${d.year()}-W${String(week).padStart(2, '0')}`
}

void Popconfirm
