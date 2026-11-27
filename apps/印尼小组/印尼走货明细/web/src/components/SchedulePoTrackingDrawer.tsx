import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Descriptions, Drawer, Empty, Space, Spin, Table, Tag, Typography } from 'antd'
import dayjs from 'dayjs'
import { api } from '../api/client'

export interface TrackingSelection { orderNo?: string; code?: string; source?: string }
export interface TrackingRecord {
  shipment_item_id: number; shipment_id: number; outbound_id?: number
  container_no?: string; status: string; ship_date?: string; load_date?: string; out_date?: string
  qty: number | null; unit?: string; regular_qty: number | null; spare_qty: number | null; counted: boolean; issues: string[]
}
export interface TrackingMaterial {
  po_item_id: number; po_id: number; po_no: string; source_po_no?: string; material_id?: number
  material_name?: string; spec?: string; supplier?: string; unit?: string; linked_order_nos?: string
  purchase_qty: number | null; received_qty: number | null; received_spare_qty: number | null
  outbound_qty: number | null; shipped_qty: number | null; shipped_spare_qty: number | null
  pending_qty: number | null; pending_spare_qty: number | null; remaining_qty: number | null
  status: string; issues: string[]; records: TrackingRecord[]
}
export interface PoTracking {
  schedule_id: number; customer: string; order_no: string; code: string; source: string
  product_name?: string; eta?: string; as_of: string; materials: TrackingMaterial[]
  material_count: number; purchase_order_count: number; completed_count: number; review_count: number; outstanding_count: number
}

export const trackingQuantity = (value: number | null | undefined) => value == null ? '—'
  : Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 4 })
const unitNames: Record<string, string> = { KGM: '千克', KG: '千克', TNE: '吨', PCE: '个', PCS: '个', SET: '套', ROL: '卷', ROLL: '卷', MTR: '米' }
const unitName = (unit?: string) => unitNames[(unit || '').trim().toUpperCase()] || unit || '—'
const date = (value?: string) => value ? dayjs(value).format('YYYY-MM-DD') : '—'
const statusNames: Record<string, { label: string; color?: string }> = {
  complete: { label: '已走齐', color: 'success' }, partial: { label: '部分走货', color: 'processing' },
  unshipped: { label: '未走货' }, review: { label: '待核对 / 分配', color: 'warning' },
  draft: { label: '草稿' }, loaded: { label: '已装箱', color: 'processing' },
  shipped: { label: '已出运', color: 'blue' }, arrived: { label: '已到港', color: 'success' },
}
const statusTag = (value: string) => <Tag color={statusNames[value]?.color}>{statusNames[value]?.label || value || '状态未知'}</Tag>
const withSpares = (quantity: number | null, spare: number | null) => <>
  <div>{trackingQuantity(quantity)}</div>
  {spare != null && spare > 0 && <Typography.Text type="secondary">另有备品 {trackingQuantity(spare)}</Typography.Text>}
</>

export default function SchedulePoTrackingDrawer({ scheduleId, selection, onClose }: {
  scheduleId: number; selection: TrackingSelection | null; onClose: () => void
}) {
  const [data, setData] = useState<PoTracking | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [expanded, setExpanded] = useState<React.Key[]>([])
  const request = useRef(0)
  const orderNo = selection?.orderNo, code = selection?.code, source = selection?.source
  useEffect(() => {
    const current = ++request.current
    const controller = new AbortController()
    setData(null); setError(''); setExpanded([])
    if (!orderNo || !code) { setLoading(false); return }
    setLoading(true)
    const config = { params: { order_no: orderNo, code, source }, signal: controller.signal, skipErrorToast: true }
    api.get<PoTracking>(`/schedules/${scheduleId}/po-tracking`, config).then(response => {
      if (current === request.current && !controller.signal.aborted) setData(response.data)
    }).catch((cause: unknown) => {
      if (current !== request.current || controller.signal.aborted) return
      const failure = cause as { response?: { data?: { error?: string } }; message?: string }
      setError(failure.response?.data?.error || failure.message || '加载失败，请重试')
    }).finally(() => {
      if (current === request.current && !controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [scheduleId, orderNo, code, source, revision])

  function recordTable(material: TrackingMaterial) {
    return <Space direction="vertical" style={{ width: '100%' }}>
      {material.issues.length > 0 && <Alert type="warning" showIcon message="这些数量尚不能准确归属本 PO"
        description={<ul>{[...new Set(material.issues)].map(issue => <li key={issue}>{issue}</li>)}</ul>} />}
      <Typography.Text type="secondary">
        采购明细 #{material.po_item_id} · 关联排期 PO：{material.linked_order_nos || '未关联'} · 累计出库（含备品）：{trackingQuantity(material.outbound_qty)} {unitName(material.unit)}
      </Typography.Text>
      <Table<TrackingRecord> rowKey="shipment_item_id" size="small" pagination={false} dataSource={material.records}
        locale={{ emptyText: '尚无货柜分配记录' }} scroll={{ x: 1150 }} columns={[
          { title: '货柜号', dataIndex: 'container_no', width: 160, render: (value, record) => <>{value || '未填写'}<div><Typography.Text type="secondary">走货单 #{record.shipment_id}</Typography.Text></div></> },
          { title: '出库记录', dataIndex: 'outbound_id', width: 110, render: value => value ? `OUT-${value}` : '未关联' },
          { title: '出库日期', dataIndex: 'out_date', width: 110, render: date },
          { title: '装柜日期', dataIndex: 'load_date', width: 110, render: date },
          { title: '出运日期', dataIndex: 'ship_date', width: 110, render: date },
          { title: '状态', dataIndex: 'status', width: 100, render: statusTag },
          { title: '实际数量', dataIndex: 'qty', align: 'right', width: 110, render: (value, record) => `${trackingQuantity(value)} ${unitName(record.unit)}` },
          { title: '其中正品', dataIndex: 'regular_qty', align: 'right', width: 90, render: trackingQuantity },
          { title: '其中备品', dataIndex: 'spare_qty', align: 'right', width: 90, render: trackingQuantity },
          { title: '统计说明', width: 240, render: (_, record) => record.status === 'draft' ? '草稿，未计入已走货及待出运'
            : record.counted ? record.status === 'loaded' ? '计入待出运' : '计入已走货'
              : <Typography.Text type="warning">{record.issues.join('；') || '归属尚未确认，未计入'}</Typography.Text> },
        ]} />
    </Space>
  }

  return <Drawer open={selection !== null} width="min(1150px, 100vw)" onClose={onClose} destroyOnClose
    title={`PO 物料追踪${orderNo ? ` · ${orderNo}` : ''}`}
    extra={<Button onClick={() => setRevision(value => value + 1)} disabled={loading}>刷新</Button>}>
    {loading && <div role="status" style={{ padding: 24, textAlign: 'center' }}><Spin /><div>正在读取采购、出库和货柜记录…</div></div>}
    {error && <Alert type="error" showIcon message="物料进度加载失败" description={error}
      action={<Button onClick={() => setRevision(value => value + 1)}>重新加载</Button>} />}
    {!loading && !error && data && <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Descriptions size="small" column={{ xs: 1, sm: 2, md: 3 }} items={[
        { key: 'customer', label: '客户 / 来源', children: `${data.customer} / ${data.source || 'RRI'}` },
        { key: 'code', label: '完整货号', children: data.code },
        { key: 'product', label: '品名', children: data.product_name || '—' },
        { key: 'eta', label: '排期走货期', children: data.eta || '—' },
        { key: 'basis', label: '查询范围', children: '同客户、同来源、同 PO 与货号的累计记录' },
        { key: 'time', label: '读取时间', children: dayjs(data.as_of).format('YYYY-MM-DD HH:mm:ss') },
      ]} />
      <Space wrap>
        <Tag>物料 {data.material_count} 项</Tag><Tag>采购单 {data.purchase_order_count} 张</Tag>
        <Tag color="success">已走齐 {data.completed_count} 项</Tag><Tag color="processing">未走齐 {data.outstanding_count} 项</Tag>
        {data.review_count > 0 && <Tag color="warning">待核对 / 分配 {data.review_count} 项</Tag>}
      </Space>
      {data.review_count > 0 && <Alert type="warning" showIcon message="部分明细的归属或数量待核对；以“—”显示，不按 0 或已走齐处理。展开物料可查看原因和参考货柜记录。" />}
      <Typography.Text type="secondary">
        数量按采购单位列示，不跨单位合计。已出运、已到港计入已走货；已装箱计入待出运，仍包含在还需走货中。
        正品与备品按已入库正品优先分配；先分配已出运，再分配待出运，草稿不参与。
      </Typography.Text>
      <Table<TrackingMaterial> size="small" rowKey="po_item_id" dataSource={data.materials} pagination={false} scroll={{ x: 1050 }}
        locale={{ emptyText: <Empty description="尚无可关联的采购物料。请在采购明细关联此排期 PO 与完整货号；手动标记已下单不会建立数量关联。" /> }}
        expandable={{ expandedRowKeys: expanded, onExpandedRowsChange: keys => setExpanded([...keys]), expandedRowRender: recordTable }}
        columns={[
          { title: '物料 / 规格', width: 200, render: (_, material) => <>
            <Button type="link" style={{ padding: 0, whiteSpace: 'normal', height: 'auto', textAlign: 'left' }}
              aria-expanded={expanded.includes(material.po_item_id)} onClick={() => setExpanded(values => values.includes(material.po_item_id)
                ? values.filter(key => key !== material.po_item_id) : [...values, material.po_item_id])}>{material.material_name || '未命名物料'}</Button>
            <div><Typography.Text type="secondary">{material.spec || '未填规格'}</Typography.Text></div>
          </> },
          { title: '采购单 / 供应商', width: 170, render: (_, material) => <>{material.po_no}
            {material.source_po_no && material.source_po_no !== material.po_no && <div><Typography.Text type="secondary">原单 {material.source_po_no}</Typography.Text></div>}
            <div><Typography.Text type="secondary">{material.supplier || '未填供应商'}</Typography.Text></div></> },
          { title: '单位', dataIndex: 'unit', width: 65, render: unitName },
          { title: '采购量（正品）', dataIndex: 'purchase_qty', align: 'right', width: 110, render: trackingQuantity },
          { title: '已到货', align: 'right', width: 115, render: (_, material) => withSpares(material.received_qty, material.received_spare_qty) },
          { title: '已走货', align: 'right', width: 115, render: (_, material) => withSpares(material.shipped_qty, material.shipped_spare_qty) },
          { title: '待出运', align: 'right', width: 115, render: (_, material) => withSpares(material.pending_qty, material.pending_spare_qty) },
          { title: '还需走货（正品）', dataIndex: 'remaining_qty', align: 'right', width: 125, render: trackingQuantity },
          { title: '状态', dataIndex: 'status', width: 130, fixed: 'right', render: statusTag },
        ]} />
    </Space>}
  </Drawer>
}
