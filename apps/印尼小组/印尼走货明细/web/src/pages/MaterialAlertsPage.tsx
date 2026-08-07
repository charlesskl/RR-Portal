import { useEffect, useMemo, useRef, useState } from 'react'
import {
  App, Badge, Button, Card, Col, Empty, Form, Input, InputNumber, Modal, Popover, Progress, Row, Segmented,
  Space, Statistic, Switch, Table, Tag, Tooltip, Typography,
} from 'antd'
import {
  BellOutlined, CheckCircleOutlined, ClockCircleOutlined, ExclamationCircleOutlined,
  EditOutlined, InboxOutlined, PlusOutlined, ReloadOutlined, UploadOutlined, WarningOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { api } from '../api/client'

interface AlertItem {
  key: string
  product_code: string
  material_id: number
  item_no?: string
  material_name?: string
  category?: string
  lead_category?: string
  supplier?: string
  order_count: number
  order_nos: string[]
  order_details?: Array<{ order_no: string; accepted_date: string; required_qty: number; received_qty: number; outbound_qty: number; status: string }>
  accepted_date: string
  due_date?: string
  lead_days?: number
  required_qty: number
  ordered_qty: number
  available_qty: number
  in_transit_qty: number
  received_qty: number
  outbound_qty: number
  purchase_shortage_qty: number
  receipt_shortage_qty: number
  outbound_shortage_qty: number
  shortage_qty: number
  workflow_status: string
  days_remaining?: number
  tracking_type: 'purchase' | 'plastic' | 'vinyl'
  detail?: string
  capacity_per_day?: number
  status: 'critical' | 'warning' | 'normal' | 'covered' | 'unconfigured'
}

interface AlertResponse {
  schedule_id?: number
  schedule_label?: string
  schedule_upload_date?: string
  order_count?: number
  items: AlertItem[]
}

interface LeadProfile {
  id?: number
  product_code: string
  product_name?: string
  category: string
  component_name?: string
  lead_days: number
  capacity_per_day?: number
  source_name?: string
  active?: boolean
  updated_at?: string
}

interface ProfileMatrixRow {
  product_code: string
  product_name: string
  active: boolean
  source_name?: string
  updated_at?: string
  categories: Record<string, LeadProfile[]>
}

const numberFmt = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 })
const PROFILE_CATEGORIES = ['五金', '吸塑', '彩盒', '电子', '电池', '搪胶', '喷油', '塑胶', '平卡', '其他外购']

const statusMeta: Record<AlertItem['status'], { text: string; color: string }> = {
  critical: { text: '超急/逾期', color: 'red' },
  warning: { text: '7天内到期', color: 'orange' },
  normal: { text: '待追踪', color: 'blue' },
  covered: { text: '已完成', color: 'green' },
  unconfigured: { text: '周期未配置', color: 'default' },
}

export default function MaterialAlertsPage() {
  const { message } = App.useApp()
  const fileRef = useRef<HTMLInputElement>(null)
  const [data, setData] = useState<AlertResponse>({ items: [] })
  const [profiles, setProfiles] = useState<LeadProfile[]>([])
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')
  const [scope, setScope] = useState<string>('待处理')
  const [typeScope, setTypeScope] = useState<string>('全部类型')
  const [preview, setPreview] = useState<LeadProfile[]>([])
  const [previewOpen, setPreviewOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [profileSearch, setProfileSearch] = useState('')
  const [profileEditorOpen, setProfileEditorOpen] = useState(false)
  const [editingCode, setEditingCode] = useState<string | null>(null)
  const [profileSaving, setProfileSaving] = useState(false)
  const [orderDetailItem, setOrderDetailItem] = useState<AlertItem | null>(null)
  const [profileForm] = Form.useForm()

  async function load() {
    setLoading(true)
    try {
      const [alertsResp, profilesResp] = await Promise.all([
        api.get<AlertResponse>('/material-alerts'),
        api.get<LeadProfile[]>('/material-alerts/profiles'),
      ])
      setData(alertsResp.data?.items ? alertsResp.data : { items: [] })
      setProfiles(Array.isArray(profilesResp.data) ? profilesResp.data : [])
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const stats = useMemo(() => {
    const items = data.items || []
    return {
      critical: items.filter(x => x.status === 'critical').length,
      warning: items.filter(x => x.status === 'warning').length,
      shortage: items.reduce((sum, x) => sum + Number(x.shortage_qty || 0), 0),
      orders: data.order_count ?? new Set(items.flatMap(x => x.order_nos || [])).size,
      covered: items.filter(x => x.status === 'covered').length,
      unconfigured: items.filter(x => x.status === 'unconfigured').length,
      purchase: items.filter(x => x.tracking_type === 'purchase').length,
      plastic: items.filter(x => x.tracking_type === 'plastic').length,
      vinyl: items.filter(x => x.tracking_type === 'vinyl').length,
    }
  }, [data.items, data.order_count])

  const filtered = useMemo(() => {
    const keyword = q.trim().toLowerCase()
    return (data.items || []).filter(x => {
      if (typeScope === '外购物料' && x.tracking_type !== 'purchase') return false
      if (typeScope === '塑胶件' && x.tracking_type !== 'plastic') return false
      if (typeScope === '搪胶件' && x.tracking_type !== 'vinyl') return false
      if (scope === '待处理' && x.status === 'covered') return false
      if (scope === '已完成' && x.status !== 'covered') return false
      if (scope === '未配置' && x.status !== 'unconfigured') return false
      if (!keyword) return true
      return [x.product_code, x.item_no, x.material_name, x.category, x.supplier, ...(x.order_nos || [])]
        .some(v => String(v || '').toLowerCase().includes(keyword))
    })
  }, [data.items, q, scope, typeScope])

  const profileRows = useMemo<ProfileMatrixRow[]>(() => {
    const grouped = new Map<string, LeadProfile[]>()
    profiles.forEach(profile => {
      const key = profile.product_code.trim()
      grouped.set(key, [...(grouped.get(key) || []), profile])
    })
    const keyword = profileSearch.trim().toLowerCase()
    return [...grouped.entries()].map(([productCode, rows]) => {
      const newest = [...rows].sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))[0]
      return {
        product_code: productCode,
        product_name: rows.find(x => x.product_name)?.product_name || '',
        active: rows.some(x => x.active !== false),
        source_name: newest?.source_name,
        updated_at: newest?.updated_at,
        categories: Object.fromEntries(PROFILE_CATEGORIES.map(category => [category, rows.filter(x => x.category === category)])),
      }
    }).filter(row => !keyword || `${row.product_code} ${row.product_name}`.toLowerCase().includes(keyword))
      .sort((a, b) => a.product_code.localeCompare(b.product_code, 'zh-CN', { numeric: true }))
  }, [profiles, profileSearch])

  function openNewProfile() {
    setEditingCode(null)
    profileForm.resetFields()
    profileForm.setFieldsValue({ active: true })
    setProfileEditorOpen(true)
  }

  function openEditProfile(row: ProfileMatrixRow) {
    setEditingCode(row.product_code)
    const values: Record<string, any> = {
      product_code: row.product_code,
      product_name: row.product_name,
      active: row.active,
    }
    PROFILE_CATEGORIES.forEach(category => {
      const categoryProfiles = row.categories[category] || []
      if (category === '搪胶' || category === '喷油') {
        values[`components_${category}`] = categoryProfiles.map(profile => ({
          component_name: profile.component_name,
          lead_days: profile.lead_days || 15,
          capacity_per_day: profile.capacity_per_day || undefined,
        }))
      } else {
        const profile = categoryProfiles[0]
        values[`days_${category}`] = profile?.lead_days || undefined
        values[`capacity_${category}`] = profile?.capacity_per_day || undefined
      }
    })
    profileForm.setFieldsValue(values)
    setProfileEditorOpen(true)
  }

  async function saveProductProfile() {
    const values = await profileForm.validateFields()
    const productCode = String(values.product_code || '').trim()
    if (!editingCode && profiles.some(x => x.product_code.toLowerCase() === productCode.toLowerCase())) {
      message.error('这个货号已存在，请在表格中点击“编辑”')
      return
    }
    const rows: Array<{ category: string; component_name?: string; lead_days: number; capacity_per_day: number }> = []
    PROFILE_CATEGORIES.forEach(category => {
      if (category === '搪胶' || category === '喷油') {
        ;(values[`components_${category}`] || []).forEach((component: any) => {
          const capacity = Number(component?.capacity_per_day || 0)
          const name = String(component?.component_name || '').trim()
          if (name && capacity > 0) rows.push({
            category,
            component_name: name,
            lead_days: Number(component?.lead_days || 15),
            capacity_per_day: capacity,
          })
        })
      } else {
        const leadDays = Number(values[`days_${category}`] || 0)
        const capacity = Number(values[`capacity_${category}`] || 0)
        if (leadDays > 0 || capacity > 0) rows.push({ category, lead_days: leadDays, capacity_per_day: capacity })
      }
    })
    if (!rows.length) {
      message.error('至少填写一个物料类别的交货周期或日产能')
      return
    }
    setProfileSaving(true)
    try {
      await api.put('/material-alerts/profiles/product', {
        product_code: productCode,
        product_name: String(values.product_name || '').trim(),
        active: values.active !== false,
        profiles: rows,
      })
      message.success(editingCode ? `已更新货号 ${productCode}` : `已新增货号 ${productCode}`)
      setProfileEditorOpen(false)
      await load()
    } finally { setProfileSaving(false) }
  }

  async function enableDesktopNotifications() {
    if (!('Notification' in window)) { message.warning('当前浏览器不支持桌面通知'); return }
    const permission = await Notification.requestPermission()
    if (permission === 'granted') {
      new Notification('物料追踪提醒已开启', { body: '系统将在物料临期、逾期或仍有欠数时提醒你。' })
      message.success('桌面提醒已开启')
    } else message.warning('浏览器未允许通知，请在地址栏的网站设置中开启')
  }

  async function parseLeadTimeFile(file: File) {
    try {
      const XLSX = await import('xlsx')
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
      const sheetName = workbook.SheetNames.find(x => x.trim() === '印尼') || workbook.SheetNames[0]
      const grid = XLSX.utils.sheet_to_json<any[]>(workbook.Sheets[sheetName], { header: 1, defval: null })
      const headers = (grid[0] || []).map(x => String(x || '').replace(/\s+/g, ''))
      const codeCol = headers.findIndex(x => x === 'item' || x === '货号')
      const nameCol = headers.findIndex(x => x === '品名' || x.includes('名称'))
      if (codeCol < 0) throw new Error('没有找到 item/货号列')

      const categories = ['五金', '吸塑', '彩盒', '电子', '电池', '搪胶', '喷油', '塑胶', '电镀', '平卡', '其他外购']
      const parsed: LeadProfile[] = []
      for (let rowIndex = 1; rowIndex < grid.length; rowIndex++) {
        const row = grid[rowIndex] || []
        const rawCodes = String(row[codeCol] || '').trim()
        if (!rawCodes) continue
        const productName = String(row[nameCol] || '').trim()
        const codes = rawCodes.split(/[\/\n]+/).map(x => x.replace(/^（旧）|^\(旧\)/, '').trim()).filter(Boolean)
        for (const category of categories) {
          const markerCol = headers.findIndex(x => x === category)
          const cycleCol = headers.findIndex(x => x === `${category}周期`)
          if (cycleCol < 0) continue
          const marker = markerCol >= 0 ? String(row[markerCol] || '').trim() : ''
          const rawCycle = row[cycleCol]
          const cycleText = String(rawCycle ?? '')
          const componentCapacities = cycleText.split(/\r?\n+/).map(line => {
            const componentMatch = line.trim().match(/^(.+?)\s*日产能\s*[:：]?\s*(\d+(?:\.\d+)?)/)
            return componentMatch ? { component_name: componentMatch[1].trim(), capacity: Number(componentMatch[2]) } : null
          }).filter((x): x is { component_name: string; capacity: number } => Boolean(x?.component_name && x.capacity > 0))
          const capacityMatches = [...cycleText.matchAll(/日产能\s*[:：]?\s*(\d+(?:\.\d+)?)/g)]
          const capacityPerDay = capacityMatches.length
            ? Math.min(...capacityMatches.map(x => Number(x[1])))
            : 0
          const match = cycleText.match(/^\s*(\d+(?:\.\d+)?)\s*天?\s*$/)
          const leadDays = match
            ? Math.round(Number(match[1]))
            : capacityPerDay > 0 && (category === '搪胶' || category === '喷油') ? 15 : 0
          if (!marker && !leadDays && !capacityPerDay) continue
          if (!leadDays && !capacityPerDay) continue
          for (const code of codes) {
            const base = {
              product_code: code,
              product_name: productName,
              category,
              lead_days: leadDays,
              source_name: `${file.name}-${sheetName}`,
              active: !/^（旧）|^\(旧\)/.test(rawCodes),
            }
            if (componentCapacities.length && (category === '搪胶' || category === '喷油')) {
              componentCapacities.forEach(component => parsed.push({
                ...base,
                component_name: component.component_name,
                capacity_per_day: component.capacity,
              }))
            } else parsed.push({ ...base, capacity_per_day: capacityPerDay })
          }
        }
      }
      const unique = new Map(parsed.map(x => [`${x.product_code}|${x.category}|${x.component_name || ''}`, x]))
      setPreview([...unique.values()])
      setPreviewOpen(true)
      message.success(`识别 ${unique.size} 条货号物料交货周期`)
    } catch (e: any) {
      message.error('读取产品总表失败：' + (e?.message || e))
    }
  }

  async function saveImport() {
    setSaving(true)
    try {
      await api.put('/material-alerts/profiles?replace=true', preview)
      message.success(`已按新版总表更新 ${preview.length} 条周期/产能资料`)
      setPreviewOpen(false)
      await load()
    } finally { setSaving(false) }
  }

  const columns: any[] = [
    {
      title: '风险', dataIndex: 'status', width: 112, fixed: 'left',
      render: (v: AlertItem['status']) => <Tag color={statusMeta[v].color}>{statusMeta[v].text}</Tag>,
    },
    {
      title: '货号 / 物料', width: 260, fixed: 'left',
      render: (_: any, r: AlertItem) => (
        <div>
          <Space size={6}>
            <Typography.Text strong>{r.product_code}</Typography.Text>
            <Tag color={r.tracking_type === 'plastic' ? 'purple' : r.tracking_type === 'vinyl' ? 'magenta' : 'blue'}>
              {r.tracking_type === 'plastic' ? '塑胶生产' : r.tracking_type === 'vinyl' ? '搪胶生产' : '外购'}
            </Tag>
            <Tag>{r.lead_category || r.category}</Tag>
          </Space>
          <div style={{ marginTop: 4 }}>{r.item_no ? `${r.item_no} · ` : ''}{r.material_name || '未命名物料'}</div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {r.supplier || (r.tracking_type === 'purchase' ? '供应商未填写' : '车间未填写')}
            {r.detail ? ` · ${r.detail}` : ''}
          </Typography.Text>
        </div>
      ),
    },
    {
      title: '流程 / 完成率', dataIndex: 'workflow_status', width: 225,
      render: (v: string, r: AlertItem) => {
        const pct = r.required_qty > 0 ? Math.min(100, Math.round(r.outbound_qty / r.required_qty * 100)) : 100
        return (
          <Space direction="vertical" size={6} style={{ width: '100%' }}>
            <Space size={[4, 4]} wrap>
              {(v || '待处理').split('·').map((step) => (
                <Tag
                  key={step}
                  bordered={false}
                  color={step === '已完成' ? 'success' : step.includes('欠') ? 'error' : step.includes('部分') ? 'warning' : step.includes('待') ? 'default' : 'processing'}
                  style={{ marginInlineEnd: 0 }}
                >
                  {step}
                </Tag>
              ))}
            </Space>
            <Tooltip title={`入库 ${numberFmt.format(r.received_qty)} / 出库 ${numberFmt.format(r.outbound_qty)}；出库达到需求后才算完成`}>
              <Progress
                percent={pct}
                size="small"
                status={pct >= 100 && r.received_qty >= r.required_qty ? 'success' : r.status === 'critical' ? 'exception' : 'active'}
              />
            </Tooltip>
          </Space>
        )
      },
    },
    {
      title: '对应订单', dataIndex: 'order_count', width: 110, align: 'center',
      render: (v: number, r: AlertItem) => (
        <Tooltip title={(r.order_nos || []).join('、') || '排期未填写订单号'}>
          <Badge count={v} showZero color="#1677ff" overflowCount={999} />
        </Tooltip>
      ),
    },
    {
      title: '最早接单日', dataIndex: 'accepted_date', width: 110,
      render: (v: string) => v || '-',
    },
    {
      title: '周期/产能', dataIndex: 'lead_days', width: 110, align: 'right',
      render: (v: number | undefined, r: AlertItem) => r.capacity_per_day
        ? <b>{v ? `${v} 天 + ` : ''}{numberFmt.format(r.capacity_per_day)} / 天</b>
        : v ? <b>{v} 天</b> : <Tag>待设置</Tag>,
    },
    {
      title: '最早应交日', dataIndex: 'due_date', width: 120,
      render: (v: string | undefined, r: AlertItem) => v ? (
        <Space direction="vertical" size={0}>
          <Typography.Text strong={r.status === 'critical'} type={r.status === 'critical' ? 'danger' : undefined}>{v}</Typography.Text>
          <Typography.Text type={r.days_remaining != null && r.days_remaining < 0 ? 'danger' : 'secondary'} style={{ fontSize: 12 }}>
            {r.days_remaining == null ? '' : r.days_remaining < 0 ? `已逾期 ${Math.abs(r.days_remaining)} 天` : `剩余 ${r.days_remaining} 天`}
          </Typography.Text>
        </Space>
      ) : '-',
    },
    {
      title: '订单需求', dataIndex: 'required_qty', width: 120, align: 'right',
      render: (v: number) => numberFmt.format(v),
    },
    {
      title: '已采购/已排产', dataIndex: 'ordered_qty', width: 125, align: 'right',
      render: (v: number) => <span style={{ color: '#1677ff' }}>{numberFmt.format(v)}</span>,
    },
    {
      title: '入库 / 出库 / 库存', width: 170,
      render: (_: any, r: AlertItem) => (
        <Space direction="vertical" size={1} style={{ width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>入库</Typography.Text>
            <Typography.Text style={{ color: '#52c41a' }}>{numberFmt.format(r.received_qty)}</Typography.Text>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>出库</Typography.Text>
            <Typography.Text strong style={{ color: '#389e0d' }}>{numberFmt.format(r.outbound_qty)}</Typography.Text>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>库存</Typography.Text>
            <Typography.Text>{numberFmt.format(r.available_qty)}</Typography.Text>
          </div>
        </Space>
      ),
    },
    {
      title: '欠数', width: 175,
      render: (_: any, r: AlertItem) => (
        <Space direction="vertical" size={1} style={{ width: '100%' }}>
          {[
            ['采购/排产', r.purchase_shortage_qty],
            ['入库', r.receipt_shortage_qty],
            ['出库', r.outbound_shortage_qty],
          ].map(([label, value]) => {
            const qty = Number(value ?? 0)
            return <div key={String(label)} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>{label}</Typography.Text>
              <Typography.Text strong={label === '出库'} type={qty > 0 ? 'danger' : 'success'}>{numberFmt.format(qty)}</Typography.Text>
            </div>
          })}
        </Space>
      ),
    },
  ]

  return (
    <div style={{ padding: 16, width: '100%' }}>
      <Row justify="space-between" align="middle" gutter={[16, 12]} style={{ marginBottom: 16 }}>
        <Col>
          <Typography.Title level={2} style={{ margin: 0 }}>物料追踪</Typography.Title>
          <Typography.Text type="secondary">
            以排期订单接单日期为起点，按货号物料交货周期自动计算应交时间和欠数
          </Typography.Text>
        </Col>
        <Col>
          <Space wrap>
            <Button icon={<BellOutlined />} onClick={enableDesktopNotifications}>开启桌面提醒</Button>
            <Button icon={<UploadOutlined />} onClick={() => fileRef.current?.click()}>导入产品交货周期</Button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" hidden onChange={e => {
              const file = e.target.files?.[0]; if (file) parseLeadTimeFile(file); e.target.value = ''
            }} />
            <Button icon={<ReloadOutlined />} loading={loading} onClick={load}>刷新</Button>
          </Space>
        </Col>
      </Row>

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={4}><KpiCard title="超急/逾期" value={stats.critical} color="#cf1322" icon={<ExclamationCircleOutlined />} /></Col>
        <Col xs={12} md={4}><KpiCard title="7天内到期" value={stats.warning} color="#d46b08" icon={<WarningOutlined />} /></Col>
        <Col xs={12} md={4}><KpiCard title="关联订单" value={stats.orders} color="#1677ff" icon={<ClockCircleOutlined />} /></Col>
        <Col xs={12} md={4}><KpiCard title="总欠出库" value={numberFmt.format(stats.shortage)} color="#cf1322" icon={<InboxOutlined />} /></Col>
        <Col xs={12} md={4}><KpiCard title="已完成物料" value={stats.covered} color="#389e0d" icon={<CheckCircleOutlined />} /></Col>
        <Col xs={12} md={4}><KpiCard title="周期未配置" value={stats.unconfigured} color="#8c8c8c" icon={<WarningOutlined />} /></Col>
      </Row>

      <Card styles={{ body: { padding: 0 } }}>
        <div style={{ padding: 16, borderBottom: '1px solid #f0f0f0' }}>
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Space wrap>
                <Tag color="blue">当前排期：{data.schedule_label || '暂无'}</Tag>
                <Typography.Text type="secondary">应交日 = 接单日期 + 货号物料交货周期</Typography.Text>
                <Tag color="green">完成 = 入库达标 + 出库达标</Tag>
                <Tag color="purple">日产能生产天数不计周日</Tag>
            </Space>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <Space wrap size={8}>
                <Segmented value={typeScope} onChange={v => setTypeScope(String(v))} options={[
                  { label: `全部类型 ${data.items.length}`, value: '全部类型' },
                  { label: `外购物料 ${stats.purchase}`, value: '外购物料' },
                  { label: `塑胶件 ${stats.plastic}`, value: '塑胶件' },
                  { label: `搪胶件 ${stats.vinyl}`, value: '搪胶件' },
                ]} />
                <Segmented value={scope} onChange={v => setScope(String(v))} options={[
                  { label: `待处理 ${data.items.filter(x => x.status !== 'covered').length}`, value: '待处理' },
                  { label: `已完成 ${stats.covered}`, value: '已完成' },
                  { label: `未配置 ${stats.unconfigured}`, value: '未配置' },
                  { label: `全部 ${data.items.length}`, value: '全部' },
                ]} />
              </Space>
              <Input.Search allowClear value={q} onChange={e => setQ(e.target.value)} placeholder="搜索货号、物料、模具、车间或订单" style={{ width: 320, maxWidth: '100%' }} />
            </div>
          </Space>
        </div>
        <Table
          rowKey="key"
          size="small"
          loading={loading}
          dataSource={filtered}
          columns={columns}
          sticky={{ offsetHeader: 47 }}
          pagination={{ defaultPageSize: 30, showSizeChanger: true, showTotal: total => `共 ${total} 项物料` }}
          scroll={{ x: 1600 }}
          locale={{ emptyText: <Empty description="当前筛选条件下没有物料" /> }}
          expandable={{
            expandedRowRender: r => (
              <Space wrap style={{ padding: '4px 20px' }}>
                <Typography.Text type="secondary">对应排期订单：</Typography.Text>
                {(r.order_nos || []).map(x => <Tag color="blue" key={x}>{x}</Tag>)}
                {r.order_count > r.order_nos.length && <Button type="link" size="small" onClick={() => setOrderDetailItem(r)}>
                  另有 {r.order_count - r.order_nos.length} 张，查看全部
                </Button>}
                {r.order_count <= r.order_nos.length && r.order_count > 0 && <Button type="link" size="small" onClick={() => setOrderDetailItem(r)}>
                  查看订单数量明细
                </Button>}
              </Space>
            ),
          }}
        />
      </Card>

      <Modal
        open={Boolean(orderDetailItem)}
        title={orderDetailItem ? `${orderDetailItem.product_code} · ${orderDetailItem.material_name || orderDetailItem.item_no} · 对应排期订单` : '对应排期订单'}
        width={980}
        footer={null}
        onCancel={() => setOrderDetailItem(null)}
      >
        <Typography.Paragraph type="secondary">入库、出库数量按最早接单日期 FIFO 自动分配到订单，出库达到该订单需求后才标记完成。</Typography.Paragraph>
        <Table
          rowKey="order_no"
          size="small"
          dataSource={orderDetailItem?.order_details || []}
          pagination={{ defaultPageSize: 20, showTotal: total => `共 ${total} 张订单` }}
          summary={rows => <Table.Summary.Row>
            <Table.Summary.Cell index={0} colSpan={2}><Typography.Text strong>合计</Typography.Text></Table.Summary.Cell>
            <Table.Summary.Cell index={2} align="right">
              <Typography.Text strong>{numberFmt.format(rows.reduce((sum, row) => sum + Number(row.required_qty || 0), 0))}</Typography.Text>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={3} align="right">
              <Typography.Text strong>{numberFmt.format(rows.reduce((sum, row) => sum + Number(row.received_qty || 0), 0))}</Typography.Text>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={4} align="right">
              <Typography.Text strong>{numberFmt.format(rows.reduce((sum, row) => sum + Number(row.outbound_qty || 0), 0))}</Typography.Text>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={5} />
          </Table.Summary.Row>}
          columns={[
            { title: '订单号', dataIndex: 'order_no', render: v => <Tag color="blue">{v}</Tag> },
            { title: '接单日期', dataIndex: 'accepted_date', width: 150 },
            { title: '需求数量', dataIndex: 'required_qty', width: 130, align: 'right', render: v => numberFmt.format(v) },
            { title: '分配入库', dataIndex: 'received_qty', width: 130, align: 'right', render: v => numberFmt.format(v) },
            { title: '分配出库', dataIndex: 'outbound_qty', width: 130, align: 'right', render: v => numberFmt.format(v) },
            { title: '订单状态', dataIndex: 'status', width: 170, render: v => <Tag color={v === '已完成' ? 'green' : v.includes('部分') ? 'orange' : 'blue'}>{v}</Tag> },
          ]}
        />
      </Modal>

      <Card
        title={<Space><span>产品物料周期主档</span><Tag color="blue">{profileRows.length} 个货号</Tag></Space>}
        size="small"
        style={{ marginTop: 16 }}
        extra={<Space>
          <Input.Search allowClear value={profileSearch} onChange={e => setProfileSearch(e.target.value)}
            placeholder="搜索货号或品名" style={{ width: 250 }} />
          <Button type="primary" icon={<PlusOutlined />} onClick={openNewProfile}>新增货号</Button>
        </Space>}
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
          每个货号横向显示各物料类别；搪胶、喷油为“接单后 15 天 + 日产能”，日产能生产天数跳过周日，周六正常计算。
        </Typography.Paragraph>
        <Table
          rowKey="product_code"
          size="small"
          dataSource={profileRows}
          pagination={{ defaultPageSize: 20, showSizeChanger: true, showTotal: total => `共 ${total} 个货号` }}
          scroll={{ x: 1700 }}
          columns={[
            { title: '货号', dataIndex: 'product_code', width: 135, fixed: 'left', render: v => <Typography.Text strong>{v}</Typography.Text> },
            { title: '品名', dataIndex: 'product_name', width: 190, fixed: 'left', ellipsis: true },
            ...PROFILE_CATEGORIES.map(category => ({
              title: category,
              width: category === '搪胶' || category === '喷油' ? 145 : 100,
              align: 'center' as const,
              render: (_v: any, row: ProfileMatrixRow) => {
                const categoryProfiles = row.categories[category] || []
                if (!categoryProfiles.length) return <Typography.Text type="secondary">-</Typography.Text>
                if (categoryProfiles.length === 1 && !categoryProfiles[0].component_name) {
                  const profile = categoryProfiles[0]
                  return profile.capacity_per_day
                    ? <Tag color="purple">{profile.lead_days ? `${profile.lead_days}天 + ` : ''}{numberFmt.format(profile.capacity_per_day)}/天</Tag>
                    : <Tag color="blue">{profile.lead_days}天</Tag>
                }
                const capacities = categoryProfiles.map(x => Number(x.capacity_per_day || 0)).filter(Boolean)
                const min = Math.min(...capacities)
                const max = Math.max(...capacities)
                const detail = (
                  <div style={{ minWidth: 300 }}>
                    <Typography.Text strong>{row.product_code} · {category}部件</Typography.Text>
                    {categoryProfiles.map(profile => <div key={`${profile.component_name}-${profile.capacity_per_day}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 24, marginTop: 8 }}>
                      <span>{profile.component_name || '通用'}</span>
                      <Typography.Text strong>{profile.lead_days || 15}天 + {numberFmt.format(profile.capacity_per_day || 0)}/天</Typography.Text>
                    </div>)}
                  </div>
                )
                return <Popover content={detail} title="部件产能明细" trigger="click">
                  <Button type="link" size="small" style={{ height: 'auto', padding: 0 }}>
                    <Space direction="vertical" size={0}>
                      <span>{categoryProfiles.length}个部件</span>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {numberFmt.format(min)}{min !== max ? `~${numberFmt.format(max)}` : ''}/天
                      </Typography.Text>
                    </Space>
                  </Button>
                </Popover>
              },
            })),
            {
              title: '资料', width: 150,
              render: (_v: any, row: ProfileMatrixRow) => (
                <Tooltip title={`${row.source_name || '-'}·${row.updated_at ? dayjs(row.updated_at).format('YYYY-MM-DD HH:mm') : '-'}`}>
                  <Space direction="vertical" size={0}>
                    <Tag color={row.active ? 'green' : 'default'}>{row.active ? '启用' : '停用'}</Tag>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {row.updated_at ? dayjs(row.updated_at).format('YYYY-MM-DD') : '-'}
                    </Typography.Text>
                  </Space>
                </Tooltip>
              ),
            },
            {
              title: '操作', width: 90, fixed: 'right',
              render: (_v: any, row: ProfileMatrixRow) => <Button type="link" icon={<EditOutlined />} onClick={() => openEditProfile(row)}>编辑</Button>,
            },
          ]}
        />
      </Card>

      <Modal
        open={profileEditorOpen}
        title={editingCode ? `编辑货号 ${editingCode}` : '新增货号物料周期'}
        width={1040}
        okText="保存"
        cancelText="取消"
        confirmLoading={profileSaving}
        onOk={saveProductProfile}
        onCancel={() => setProfileEditorOpen(false)}
        destroyOnHidden
      >
        <Form form={profileForm} layout="vertical" preserve={false}>
          <Row gutter={16}>
            <Col span={7}>
              <Form.Item name="product_code" label="货号" rules={[{ required: true, message: '请输入货号' }]}>
                <Input disabled={Boolean(editingCode)} placeholder="例如 46720J" />
              </Form.Item>
            </Col>
            <Col span={13}>
              <Form.Item name="product_name" label="品名" rules={[{ required: true, message: '请输入品名' }]}>
                <Input placeholder="输入产品名称" />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item name="active" label="状态" valuePropName="checked">
                <Switch checkedChildren="启用" unCheckedChildren="停用" />
              </Form.Item>
            </Col>
          </Row>
          <Typography.Paragraph type="secondary">
            交货天数和日产能可同时使用。搪胶、喷油默认先准备 15 天，再按“订单数量 ÷ 日产能”推算；生产天数不计周日，周六正常计算。
          </Typography.Paragraph>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            {PROFILE_CATEGORIES.map(category => (
              <Card key={category} size="small" title={category} styles={{ body: { paddingBottom: 4 } }}>
                {category === '搪胶' || category === '喷油' ? (
                  <Form.List name={`components_${category}`}>
                    {(fields, { add, remove }) => <>
                      {fields.map(field => <Row gutter={8} key={field.key} align="middle">
                        <Col span={11}>
                          <Form.Item name={[field.name, 'component_name']} label={field.name === 0 ? '部件/玩具名称' : undefined}
                            rules={[{ required: true, message: '请输入名称' }]}>
                            <Input placeholder="例如 马里奥" />
                          </Form.Item>
                        </Col>
                        <Col span={9}>
                          <Form.Item name={[field.name, 'capacity_per_day']} label={field.name === 0 ? '日产能' : undefined}
                            rules={[{ required: true, message: '请输入产能' }]}>
                            <InputNumber min={1} precision={2} style={{ width: '100%' }} addonAfter="/天" />
                          </Form.Item>
                        </Col>
                        <Col span={4}>
                          <Form.Item label={field.name === 0 ? ' ' : undefined}>
                            <Button danger type="link" onClick={() => remove(field.name)}>删除</Button>
                          </Form.Item>
                        </Col>
                        <Form.Item name={[field.name, 'lead_days']} hidden initialValue={15}><InputNumber /></Form.Item>
                      </Row>)}
                      <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add({ lead_days: 15 })}>
                        添加{category}部件
                      </Button>
                    </>}
                  </Form.List>
                ) : (
                  <Row gutter={12}>
                    <Col span={12}>
                      <Form.Item name={`days_${category}`} label="交货天数">
                        <InputNumber min={0} precision={0} style={{ width: '100%' }} addonAfter="天" placeholder="例如 20" />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item name={`capacity_${category}`} label="日产能">
                        <InputNumber min={0} precision={2} style={{ width: '100%' }} addonAfter="/天" placeholder="例如 4800" />
                      </Form.Item>
                    </Col>
                  </Row>
                )}
              </Card>
            ))}
          </div>
        </Form>
      </Modal>

      <Modal open={previewOpen} title="确认导入产品物料交货周期" width={900} okText="确认更新" confirmLoading={saving}
        onOk={saveImport} onCancel={() => setPreviewOpen(false)}>
        <Typography.Paragraph type="secondary">
          本次文件内出现的货号将以新版总表为准替换原类别；文件未出现的其他货号资料会保留。
        </Typography.Paragraph>
        <Table rowKey={r => `${r.product_code}-${r.category}-${r.component_name || ''}`} size="small" dataSource={preview.slice(0, 200)}
          pagination={false} scroll={{ y: 480 }} columns={[
            { title: '货号', dataIndex: 'product_code', width: 150 },
            { title: '品名', dataIndex: 'product_name' },
            { title: '物料类别', dataIndex: 'category', width: 110 },
            { title: '部件/玩具名称', dataIndex: 'component_name', width: 150, render: v => v || '-' },
            { title: '交货周期/日产能', width: 180, align: 'right', render: (_v, r: LeadProfile) => r.capacity_per_day ? `${r.lead_days ? `${r.lead_days} 天 + ` : ''}${numberFmt.format(r.capacity_per_day)} / 天` : `${r.lead_days} 天` },
          ]} />
        {preview.length > 200 && <Typography.Text type="secondary">仅预览前200条，共{preview.length}条。</Typography.Text>}
      </Modal>
    </div>
  )
}

function KpiCard({ title, value, color, icon }: { title: string; value: string | number; color: string; icon: React.ReactNode }) {
  return (
    <Card size="small" style={{ height: '100%', borderTop: `3px solid ${color}` }}>
      <Statistic title={title} value={value} valueStyle={{ color, fontSize: 25 }} prefix={icon} />
    </Card>
  )
}
