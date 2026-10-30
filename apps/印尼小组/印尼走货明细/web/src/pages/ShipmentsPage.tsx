import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import {
  Alert, App, AutoComplete, Button, Card, Checkbox, Col, DatePicker, Drawer, Form, Input, InputNumber, Modal, Popconfirm,
  Row, Select, Space, Spin, Table, Tag, Typography,
} from 'antd'
import dayjs from 'dayjs'
import { api, type Dictionaries, type Material } from '../api/client'
import { toolShipmentFields } from '../utils/toolShipment'
import { sortShipmentItems, cartonLayout, cartonGroupKey, shipmentScope } from '../utils/shipmentOrder'
import { withShipmentInvoicePrices } from '../utils/shipmentInvoice'
import { consolidateShipmentItems } from '../utils/shipmentConsolidation'
import { createCartonGroupId } from '../utils/cartonGroupId'
import { receiptChargeRatio, shipmentChargeQuantity, shipmentPurchaseAmount, shipmentUsesDeclarationPrice } from '../utils/shipmentPurchase'
import ShipmentImport from '../components/ShipmentImport'
import ShipmentImportSource from '../components/ShipmentImportSource'
import ShipmentSheetTable from '../components/ShipmentSheetTable'
import ShipmentNumberCell from '../components/ShipmentNumberCell'
import ShipmentTextCell from '../components/ShipmentTextCell'
import { ShipmentSheetFillContext } from '../components/ShipmentSheetDraft'
import { formatShipmentDeclaration, isShipmentCountUnit, roundedShipmentDeclaration, shipmentDeclarationPrecision } from '../utils/shipmentDeclaration'
import { shipmentDeclarationSaveError } from '../utils/shipmentDeclarationSaveValidation'
import { shipmentDateOnly, shipmentPurchaseDates } from '../utils/shipmentDates'
import { formatShipmentPallet, shipmentOptionalNumber } from '../utils/shipmentDisplay'
import { applyMergedShipmentEdits, mergedReadOnlyFields, type MergedEditorRow } from '../utils/shipmentMergedEditor'
import { shipmentSheetFields, type SheetEdit } from '../utils/shipmentSheet'
import { linkShipmentOutbound, remainingOutboundQuantity } from '../utils/shipmentOutboundLink'
import { outboundCandidates, planOutboundPull } from '../utils/shipmentOutboundRemaining'
import { mergeShipmentImportMaterial, type ShipmentImportItem } from '../utils/shipmentImport'
import { MATERIAL_CATEGORIES } from '../utils/engineeringImport'
import { HUASHENGYI_FULL_NAME } from '../utils/supplierProfiles'
import { publicAsset } from '../deployment'
import './ShipmentsPage.css'
import {
  formatShipmentPackingLines, isPaperRope, parseShipmentPacking,
  shipmentCbmPerCarton, shipmentGrossPerPc, shipmentKgWeight, shipmentPackingAverageQty, shipmentWeightQuantity,
} from '../utils/shipmentWeight'

interface ShipmentSummary {
  id: number
  customer?: string
  container_no?: string
  container_count?: number
  ship_date?: string
  load_date?: string
  bl_no?: string
  rate?: number
  status?: string
  created_at?: string
  item_count?: number
}

interface ShipmentItem {
  purchase_charge_ratio?: number
  _rowKey?: number
  material_snapshot?: Material
  carton_no?: string
  id?: number
  outbound_id?: number
  material_id?: number
  seq?: number
  kg?: number
  qty?: number
  cartons?: number
  carton_group?: string
  qty_per_carton?: string
  weighing_qty?: number
  purchase_unit?: string
  pallet?: string
  price?: number
  currency?: string
  po_no?: string
  po_date?: string
  supplier?: string
  customs_company?: string
  bl_head?: string
  contract_no?: string
  contract_date?: string
  invoice_no?: string
  invoice_date?: string
  invoice_price?: number
  product_use?: string
  formula_name?: string
}

interface ShipmentDetail extends ShipmentSummary {
  items?: ShipmentItem[]
}

interface OutByMat {
  purchase_charge_ratio?: number
  outbound_id: number
  po_item_id?: number
  material_id?: number
  code?: string
  name_zh?: string
  spec?: string
  po_no?: string
  supplier?: string
  out_date?: string
  outbound_qty?: number
  allocated_other?: number
  allocated_current?: number
  allocatable_qty?: number
  price?: number
  currency?: string
  purchase_unit?: string
  po_date?: string
  customs_company?: string
}

interface ShipmentForm {
  customer?: string
  container_no?: string
  container_count?: number
  ship_date?: string
  load_date?: string
  bl_no?: string
  rate?: number
  status?: string
}

const STATUS = [
  { value: 'draft',    label: '草稿',    color: 'default' as const },
  { value: 'loaded',   label: '已装箱',  color: 'processing' as const },
  { value: 'shipped',  label: '已出运',  color: 'warning' as const },
  { value: 'arrived',  label: '已到港',  color: 'success' as const },
]
const CURR = [
  { value: 'IDR', label: '印尼盾 IDR' },
  { value: '¥',   label: '¥' },
  { value: 'HK$', label: 'HK$' },
  { value: 'US$', label: 'US$' },
  { value: '€',   label: '€' },
  { value: '£',   label: '£' },
  { value: '¥(JPY)', label: '¥(JPY)' },
]
const UNIT_LIST = ['KGM', 'PCE', 'SET', 'TNE']
const BL_HEAD_LIST = ['華登製品實業有限公司', '華登(全球)有限公司', '东莞市雅洛轩进出口贸易有限公司']
// 灰底计算列样式
const GRAY = { background: '#f0f3f7' }

interface FillableShipmentCellProps {
  rowIndex: number
  rowCount: number
  field: string
  onFill: (sourceIndex: number, targetIndex: number, field: string) => void
  onFillToEnd: (sourceIndex: number, field: string) => void
  children: React.ReactNode
}

// 放在页面组件外，避免每次输入后重建组件导致输入框丢失焦点。
function FillableShipmentCell({ rowIndex, rowCount, field, onFill, onFillToEnd, children }: FillableShipmentCellProps) {
  const batchFill = useContext(ShipmentSheetFillContext)
  return (
    <div
      className="shipment-fillable-cell"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('application/x-shipment-fill')) event.preventDefault()
      }}
      onDrop={(event) => {
        event.preventDefault()
        try {
          const payload = JSON.parse(event.dataTransfer.getData('application/x-shipment-fill'))
          if (payload.field === field) (batchFill || onFill)(Number(payload.rowIndex), rowIndex, field)
        } catch { /* 忽略其它拖动内容 */ }
      }}
    >
      {children}
      <span
        className="shipment-fill-handle"
        draggable
        role="button"
        aria-label="复制到下面全部行"
        title="点击复制到下面全部行；拖动可复制到指定行"
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          if (batchFill) batchFill(rowIndex, rowCount - 1, field)
          else onFillToEnd(rowIndex, field)
        }}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'copy'
          event.dataTransfer.setData('application/x-shipment-fill', JSON.stringify({ rowIndex, field }))
        }}
      >↓</span>
    </div>
  )
}

export default function ShipmentsPage() {
  const { message } = App.useApp()
  const [rows, setRows] = useState<ShipmentSummary[]>([])
  const [filter, setFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [customerFilter, setCustomerFilter] = useState('')
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<ShipmentDetail | null>(null)
  const [creating, setCreating] = useState(false)
  const [editorLoad, setEditorLoad] = useState<'ready' | 'loading' | 'error'>('ready')
  const editorLoadState = useRef<'ready' | 'loading' | 'error'>('ready')
  const [rawItems, setRawItems] = useState<ShipmentItem[]>([])
  const nextRowKey = useRef(0)
  const [cartonSelection, setCartonSelection] = useState<React.Key[]>([])
  const [mergeOpen, setMergeOpen] = useState(false)
  const [sharedCartons, setSharedCartons] = useState<number | null>(1)
  const [form] = Form.useForm<ShipmentForm>()
  const [drawerFull, setDrawerFull] = useState(false)
  const [saving, setSaving] = useState(false)
  const [sheetEditing, setSheetEditing] = useState(false)
  const editorSession = useRef(0)
  useEffect(() => () => { editorSession.current++ }, [])
  const [editorDirty, setEditorDirty] = useState(false)
  const [customers, setCustomers] = useState<string[]>([])
  const [customsNames, setCustomsNames] = useState<string[]>([])
  const [selKeys, setSelKeys] = useState<React.Key[]>([])
  const [schedRows, setSchedRows] = useState<any[]>([])
  const [schedPickerOpen, setSchedPickerOpen] = useState(false)
  const [schedPickerFilter, setSchedPickerFilter] = useState('')
  const [schedPickerSel, setSchedPickerSel] = useState<React.Key[]>([])
  // 从出库拉物料
  const [outRows, setOutRows] = useState<OutByMat[]>([])
  const [outOpen, setOutOpen] = useState(false)
  const [outFilter, setOutFilter] = useState('')
  const [outSel, setOutSel] = useState<React.Key[]>([])
  const [outLoading, setOutLoading] = useState(false)
  const [outPulling, setOutPulling] = useState(false)
  const outRequest = useRef(0)
  const outPullPending = useRef<number | null>(null)
  const [linkRowKey, setLinkRowKey] = useState<number | null>(null)
  const [linkRows, setLinkRows] = useState<OutByMat[]>([])
  const [linkFilter, setLinkFilter] = useState('')
  const [linkSelected, setLinkSelected] = useState<number | null>(null)
  const [linkConfirmed, setLinkConfirmed] = useState(false)
  const [linkBusy, setLinkBusy] = useState(false)
  const linkRequest = useRef(0)
  // 按货号选物料（补充）
  const [manOpen, setManOpen] = useState(false)
  const [toolOpen, setToolOpen] = useState(false)
  const [toolLoading, setToolLoading] = useState(false)
  const [toolRows, setToolRows] = useState<Material[]>([])
  const [toolQuery, setToolQuery] = useState('')
  const [toolSel, setToolSel] = useState<React.Key[]>([])
  const [manCode, setManCode] = useState('')
  const [manMats, setManMats] = useState<any[]>([])
  const [manSel, setManSel] = useState<React.Key[]>([])
  const [productCodes, setProductCodes] = useState<string[]>([])
  // 数据核对报告
  const [valOpen, setValOpen] = useState(false)
  const [valReport, setValReport] = useState<{ hard: string[]; warn: string[] }>({ hard: [], warn: [] })
  // 物料主数据映射（录入表显示只读列 + 计算列 + 写回尺寸）
  const [baseMatMap, setMatMap] = useState<Map<number, any>>(new Map())
  const matMap = useMemo(() => {
    const result = new Map(baseMatMap)
    for (const item of rawItems) if (item.material_snapshot && item.material_id != null && !result.has(item.material_id))
      result.set(item.material_id, item.material_snapshot)
    return result
  }, [baseMatMap, rawItems])
  const orderedItems = (values: ShipmentItem[]) => withShipmentInvoicePrices(sortShipmentItems(values, matMap), matMap).map((it, i) => ({ ...it, seq: i + 1 }))
  const items = useMemo(() => orderedItems(rawItems), [rawItems, matMap])
  const outCandidates = useMemo(() => outboundCandidates(outRows, items), [outRows, items])
  const selectedOutIds = outSel.filter(key => outCandidates.some(row => String(row.outbound_id) === String(key)))
  const sheetRevision = useRef({ rawItems, matMap, session: 0 })
  const sheetWritePending = useRef(false)
  useLayoutEffect(() => { sheetRevision.current = { rawItems, matMap, session: editorSession.current } })
  const consolidatedItems = useMemo(() => withShipmentInvoicePrices(
    sortShipmentItems(consolidateShipmentItems(items, matMap), matMap)
      .map(item => roundedShipmentDeclaration(item, matMap.get(item.material_id!))), matMap,
  ), [items, matMap])
  const showConsolidated = consolidatedItems.length < items.length
  const consolidatedCartons = useMemo(() => cartonLayout(consolidatedItems, matMap), [consolidatedItems, matMap])
  const customsOptions = useMemo(() => [...new Set([
    HUASHENGYI_FULL_NAME, ...customsNames,
    ...items.flatMap(item => {
      const material = matMap.get(item.material_id!)
      return [item.customs_company, material?.customs_company, item.supplier || material?.supplier]
    }),
  ].filter((value): value is string => typeof value === 'string' && !!value.trim()).map(value => value.trim()))]
    .sort((a, b) => a.localeCompare(b, 'zh-CN')).map(value => ({ value, label: value })), [items, matMap, customsNames])
  const cartonRows = useMemo(() => cartonLayout(items, matMap), [items, matMap])
  // All index-based edits, deletion and fill-down operate on the displayed order.
  function setItems(update: React.SetStateAction<ShipmentItem[]>) {
    setRawItems(current => {
      const next = typeof update === 'function' ? update(orderedItems(current)) : update
      return next.map(it => {
        const rowKey = it._rowKey ?? ++nextRowKey.current
        return { ...it, _rowKey: rowKey, material_id: it.material_snapshot ? -rowKey : it.material_id }
      })
    })
  }
  function requestMergeCartons() {
    const keys = selectedSourceKeys()
    const selected = items.filter(it => keys.has(it._rowKey!))
    if (selected.length < 2) { message.warning('请勾选至少两条明细'); return }
    if (new Set(selected.map(it => shipmentScope(it, matMap))).size !== 1) {
      message.warning('仅能合并同一报关公司、同一供应商的明细'); return
    }
    if (selected.some(it => it.carton_group)) { message.warning('请先取消已有箱数组合，再重新选择'); return }
    setSharedCartons(selected[0].cartons || 1); setMergeOpen(true)
  }
  function mergeCartons() {
    if (!sharedCartons || !Number.isInteger(sharedCartons) || sharedCartons < 1) return
    const group = createCartonGroupId()
    const keys = selectedSourceKeys()
    setItems(current => current.map(it => keys.has(it._rowKey!)
      ? { ...it, carton_group: group, cartons: sharedCartons } : it))
    setEditorDirty(true); setMergeOpen(false); setCartonSelection([])
  }
  function unmergeCartons() {
    const keys = selectedSourceKeys()
    const groups = new Set(items.filter(it => keys.has(it._rowKey!)).map(it => cartonGroupKey(it, matMap)).filter(Boolean))
    if (!groups.size) { message.warning('请勾选已合并的明细'); return }
    Modal.confirm({ title: '取消箱数合并？', content: '拆开后每行保留当前箱数，并分别计入合计；请核对各行实际箱数。',
      onOk: () => {
        setItems(current => current.map(it => groups.has(cartonGroupKey(it, matMap)) ? { ...it, carton_group: undefined } : it))
        setEditorDirty(true); setCartonSelection([])
      } })
  }
  function selectedSourceKeys() {
    return new Set(consolidatedItems.filter(row => cartonSelection.includes(row._rowKey!))
      .flatMap(row => row.sources.map(source => source._rowKey!)))
  }
  const [dirtyMatIds, setDirtyMatIds] = useState<Set<number>>(new Set())
  // material_id → 出库总量（按货号选物料时带入数量）
  const outByMat = useMemo(() => {
    const m = new Map<number, number>()
    for (const o of outRows) {
      if (o.material_id == null) continue
      m.set(o.material_id, (m.get(o.material_id) ?? 0) + (Number(o.allocatable_qty) || 0))
    }
    return m
  }, [outRows])

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get<ShipmentSummary[]>('/shipments')
      setRows(Array.isArray(data) ? data : [])
    } finally { setLoading(false) }
  }
  async function loadCustomers() {
    try { const { data } = await api.get<string[]>('/customers'); setCustomers(data || []) } catch {}
  }
  async function loadLatestSchedule() {
    try {
      const { data } = await api.get<{ raw_rows?: string }>('/schedules/latest')
      const parsed = data.raw_rows ? JSON.parse(data.raw_rows) : []
      setSchedRows(Array.isArray(parsed) ? parsed : [])
    } catch {}
  }
  useEffect(() => { load(); loadCustomers() }, [])
  useEffect(() => {
    void api.get<Dictionaries>('/dictionaries').then(({ data }) => {
      setCustomsNames((data.suppliers || []).flatMap(supplier => [supplier.full || '', supplier.customs || '']))
    }).catch(() => { message.warning('报关公司字典未加载，仍可选择当前明细中的公司') })
  }, [])

  // 公共：查最近 PO，建 material_id → 最近一张 PO 明细 的映射，回填供应商/单价/PO
  async function buildMatToPo(): Promise<Map<number, { po: any; it: any }>> {
    const matToPo = new Map<number, { po: any; it: any }>()
    try {
      const { data: poList } = await api.get<any[]>('/purchase')
      const recent = poList.slice(0, 200)
      const dets = await Promise.all(recent.map(p => api.get<any>(`/purchase/${p.id}`).then(r => r.data).catch(() => null)))
      for (const po of dets.filter(Boolean)) {
        for (const it of (po.items ?? [])) {
          if (!it.material_id) continue
          const cur = matToPo.get(it.material_id)
          if (!cur || (po.created_at && cur.po.created_at && po.created_at > cur.po.created_at)) {
            matToPo.set(it.material_id, { po, it })
          }
        }
      }
    } catch {}
    return matToPo
  }

  // 公共：物料 + 数量 → 走货明细行（poInfo 来自 buildMatToPo；poNo/productUse 可覆盖）
  function makeItem(m: any, qty: number, opts: { poInfo?: { po: any; it: any }; poNo?: string; productUse?: string; outboundId?: number } = {}): ShipmentItem {
    const kg = shipmentKgWeight(m.unit_kg, qty, m.net_per_pc, m.name_zh)
    const qtyPerCarton = Number(m.qty_per_carton) || 0
    const cartons = qtyPerCarton > 0 ? Math.ceil(qty / qtyPerCarton) : 0
    const poInfo = opts.poInfo
    return {
      outbound_id: opts.outboundId,
      material_id: m.id,
      qty, kg, cartons,
      qty_per_carton: qtyPerCarton > 0 ? String(qtyPerCarton) : '',
      weighing_qty: shipmentWeightQuantity(m.name_zh, qtyPerCarton),
      purchase_unit: poInfo?.it?.purchase_unit || (isPaperRope(m.name_zh) ? '米' : '个'),
      price: poInfo?.it?.price ?? 0,
      purchase_charge_ratio: receiptChargeRatio(poInfo?.it),
      currency: poInfo?.it?.currency ?? 'US$',
      po_no: opts.poNo ?? poInfo?.po?.po_no ?? '',
      po_date: poInfo?.po?.order_date ?? '',
      supplier: poInfo?.po?.supplier ?? m.supplier ?? '',
      customs_company: m.customs_company ?? '',
      bl_head: '',
      contract_no: '', contract_date: '', invoice_no: '', invoice_date: '',
      invoice_price: poInfo?.it?.price ?? 0,
      product_use: opts.productUse ?? '',
      formula_name: m.name_zh ?? '',
    }
  }

  // 公共：按货号批量取 active 物料（缓存去重）
  async function loadMatsByCodes(codes: string[]): Promise<Map<string, any[]>> {
    const uniq = [...new Set(codes.filter(Boolean))]
    const map = new Map<string, any[]>()
    await Promise.all(uniq.map(async code => {
      try {
        const { data } = await api.get<any[]>('/materials', { params: { code } })
        map.set(code, Array.isArray(data) ? data.filter(m => m.active !== false) : [])
      } catch { map.set(code, []) }
    }))
    return map
  }

  function appendItems(newItems: ShipmentItem[]) {
    setEditorDirty(true)
    setItems(its => {
      const merged = [...its, ...newItems].map((it, i) => ({ ...it, seq: i + 1 }))
      loadMatsForItems(merged.map(x => x.material_id))
      return merged
    })
  }

  // 加载这些物料的主数据（显示只读列 + 计算 + 写回基准）
  async function loadMatsForItems(idsRaw: (number | undefined)[], force = false) {
    const session = editorSession.current
    const ids = [...new Set(idsRaw.filter((x): x is number => x != null && x > 0))]
    const missing = force ? ids : ids.filter(id => !matMap.has(id))
    if (!missing.length) return
    try {
      const { data } = await api.get<any[]>('/materials/by-ids', { params: { ids: missing.join(',') } })
      if (editorSession.current !== session) return
      setMatMap(prev => {
        const next = new Map(prev)
        for (const m of (data || [])) if (m.id != null) next.set(m.id, m)
        return next
      })
    } catch {}
  }
  // 计算列辅助
  const num = (v: any) => Number(v) || 0
  function calc(it: ShipmentItem) {
    const m = it.material_id != null ? matMap.get(it.material_id) : null
    const weightQty = shipmentWeightQuantity(m?.name_zh, it.qty)
    const grossTotal = shipmentGrossPerPc(m?.weight_per_carton, effectiveWeighingQty(it, m)) * weightQty
    const netTotal = num(m?.net_per_pc) * weightQty
    const cbmEach = shipmentCbmPerCarton(m?.length, m?.width, m?.height)
    const cbmTotal = cbmEach * num(it.cartons)
    const invoiceAmount = num(it.invoice_price) * num(it.kg)
    const purchaseAmount = shipmentPurchaseAmount(it)
    return { m, grossTotal, netTotal, cbmEach, cbmTotal, invoiceAmount, purchaseAmount }
  }

  function effectiveWeighingQty(it: ShipmentItem, material: any): number {
    if (it.weighing_qty != null) return Number(it.weighing_qty) || 0
    return shipmentWeightQuantity(material?.name_zh, shipmentPackingAverageQty(it.qty_per_carton))
  }

  // 客户分区：PO 号前缀 IRRI→RRI、IRRM→RRM（HD_INDUSTRY/HD_GLOBAL），其它返回 ''
  function partitionOf(poNo?: string): '' | 'RRI' | 'RRM' {
    const s = (poNo || '').toUpperCase().trim()
    if (s.startsWith('IRRI')) return 'RRI'
    if (s.startsWith('IRRM')) return 'RRM'
    return ''
  }
  // 拉料后：单一分区→自动填客户；混合 IRRI+IRRM→拦截提示（不允许混柜）
  function applyPartition(merged: ShipmentItem[]) {
    const parts = new Set(merged.map(it => partitionOf(it.po_no)).filter(Boolean))
    if (parts.size > 1) {
      message.warning('本票混合了 RRI 与 RRM 的 PO，不允许混柜，请拆成两票')
      return
    }
    if (parts.size === 1) form.setFieldsValue({ customer: [...parts][0] })
  }

  // 从勾选的排期行 → 拉每个货号的所有 active 物料 → 转成走货明细
  async function pullFromSchedule() {
    if (!schedPickerSel.length) { message.warning('请先勾选排期行'); return }
    const picked = schedPickerSel.map(k => schedRows[Number(k)]).filter(Boolean)
    if (!picked.length) return
    const matToPo = await buildMatToPo()
    const matsByCode = await loadMatsByCodes(picked.map(p => p.code))
    const newItems: ShipmentItem[] = []
    for (const sched of picked) {
      const mats = matsByCode.get(sched.code ?? '') ?? []
      for (const m of mats) {
        const usage = Number(m.usage_qty ?? 1) || 1
        const qty = (Number(sched.qty) || 0) * usage
        newItems.push(makeItem(m, qty, { poInfo: m.id ? matToPo.get(m.id) : undefined, productUse: sched.productName ?? '' }))
      }
    }
    appendItems(newItems)
    applyPartition([...items, ...newItems])
    setSchedPickerOpen(false); setSchedPickerSel([])
    message.success(`已从 ${picked.length} 条排期拉出 ${newItems.length} 条物料明细`)
  }

  async function loadOutbound(shipmentId?: number) {
    const request = ++outRequest.current
    setOutLoading(true)
    setOutRows([])
    try {
      const { data } = await api.get<OutByMat[]>('/outbound/allocatable', {
        params: shipmentId ? { shipment_id: shipmentId } : {},
      })
      if (request === outRequest.current) setOutRows(Array.isArray(data) ? data : [])
    } catch { if (request === outRequest.current) setOutRows([]) }
    finally { if (request === outRequest.current) setOutLoading(false) }
  }
  function closeOutboundLink() {
    linkRequest.current++
    setLinkRowKey(null); setLinkRows([]); setLinkSelected(null); setLinkConfirmed(false); setLinkBusy(false)
  }
  async function openOutboundLink(row: ShipmentItem) {
    const request = ++linkRequest.current
    setLinkRowKey(row._rowKey!); setLinkRows([]); setLinkSelected(null); setLinkConfirmed(false); setLinkBusy(true)
    const material = matMap.get(row.material_id!)
    setLinkFilter(row.material_snapshot && !row.material_snapshot.id ? material?.product_code || material?.name_zh || '' : '')
    try {
      const { data } = await api.get<OutByMat[]>('/outbound/allocatable', { params: editing?.id ? { shipment_id: editing.id } : {} })
      if (request === linkRequest.current) setLinkRows(Array.isArray(data) ? data : [])
    } catch { /* API interceptor reports failure; stale candidates have been cleared. */ }
    finally { if (request === linkRequest.current) setLinkBusy(false) }
  }
  async function confirmOutboundLink() {
    if (linkRowKey == null || !linkSelected || !linkConfirmed || linkBusy) return
    const request = linkRequest.current
    const revision = { ...sheetRevision.current }
    setLinkBusy(true)
    try {
      // Re-read balance at confirmation; the server checks again under lock on Save.
      const { data } = await api.get<OutByMat[]>('/outbound/allocatable', { params: editing?.id ? { shipment_id: editing.id } : {} })
      const source = data.find(r => r.outbound_id === linkSelected)
      if (!source?.material_id) throw new Error('该出库已不可分配或缺少物料，请重新选择')
      const { data: materials } = await api.get<Material[]>('/materials/by-ids', { params: { ids: String(source.material_id) } })
      const material = materials.find(m => m.id === source.material_id)
      if (!material) throw new Error('出库对应物料不存在，请刷新重试')
      if (request !== linkRequest.current) return
      if (revision.rawItems !== sheetRevision.current.rawItems || revision.matMap !== sheetRevision.current.matMap)
        throw new Error('明细已变化，请重新核对后关联')
      const previous = linkRows.find(r => r.outbound_id === linkSelected)
      if (!previous || ['material_id', 'po_no', 'po_date', 'supplier', 'price', 'currency', 'purchase_unit', 'purchase_charge_ratio', 'customs_company', 'code', 'name_zh', 'spec'].some(key =>
        previous[key as keyof OutByMat] !== source[key as keyof OutByMat])) {
        setLinkRows(data); setLinkConfirmed(false)
        throw new Error('出库资料已更新，请核对后重新确认')
      }
      const next = linkShipmentOutbound(revision.rawItems, linkRowKey, source, material, revision.matMap)
      const original = revision.rawItems.find(r => r._rowKey === linkRowKey)!
      setMatMap(current => {
        const map = new Map(current)
        if (original.material_snapshot) map.delete(original.material_id!)
        else if (!map.has(material.id!)) map.set(material.id!, material)
        return map
      })
      setItems(next); setEditorDirty(true); applyPartition(next); closeOutboundLink()
      message.success(`已关联 OUT-${source.outbound_id}，装箱资料已保留，请保存走货单`)
    } catch (error: any) { if (request === linkRequest.current) message.error(error?.message || '关联失败，请重试') }
    finally { if (request === linkRequest.current) setLinkBusy(false) }
  }
  async function loadProductCodes() {
    try { const { data } = await api.get<{ code: string }[]>('/products'); setProductCodes((data || []).map(p => p.code).filter(Boolean)) } catch {}
  }

  // 从出库拉物料：每行绑定具体出库记录，数量可拆分到不同柜。
  function closeOutboundPicker() {
    outRequest.current++
    outPullPending.current = null
    setOutPulling(false)
    setOutOpen(false); setOutSel([]); setOutLoading(false)
  }
  async function pullFromOutbound() {
    if (outPullPending.current != null || outLoading) return
    const selected = selectedOutIds.map(Number)
    if (!selected.length) { message.warning('请先勾选出库物料'); return }
    const original = { ...sheetRevision.current }
    const request = ++outRequest.current
    const unchanged = () => request === outRequest.current && original.session === sheetRevision.current.session
      && original.rawItems === sheetRevision.current.rawItems && original.matMap === sheetRevision.current.matMap
    outPullPending.current = request
    setOutPulling(true)
    try {
      const { data } = await api.get<OutByMat[]>('/outbound/allocatable', { params: editing?.id ? { shipment_id: editing.id } : {} })
      if (!unchanged()) return
      const sources = Array.isArray(data) ? data : []
      setOutRows(sources)
      const picked = planOutboundPull(sources, original.rawItems, selected)
      const [matToPo, materialResponse] = await Promise.all([
        picked.some(row => !row.po_no) ? buildMatToPo() : Promise.resolve(new Map()),
        api.get<any[]>('/materials/by-ids', { params: { ids: [...new Set(picked.map(row => row.material_id))].join(',') } }),
      ])
      if (!unchanged()) return
      const newItems = picked.map(o => {
        const m = materialResponse.data.find(x => String(x.id) === String(o.material_id))
        if (!m) throw new Error(`OUT-${o.outbound_id} 的物料资料不可用，请刷新后重试`)
        const poInfo = {
          po: { po_no: o.po_no, order_date: o.po_date, supplier: o.supplier },
          it: { price: o.price, currency: o.currency, purchase_unit: o.purchase_unit, purchase_charge_ratio: o.purchase_charge_ratio },
        }
        return makeItem(m, o.remaining_qty, {
          poInfo: o.po_no ? poInfo : (m.id ? matToPo.get(m.id) : undefined),
          poNo: o.po_no || undefined,
          outboundId: o.outbound_id,
        })
      })
      appendItems(newItems)
      applyPartition([...items, ...newItems])
      setOutOpen(false); setOutSel([])
      message.success(`已从出库拉出 ${newItems.length} 条物料明细`)
    } catch (error: any) {
      message.error(error?.response?.data?.error || error?.message || '拉入失败，请重试')
    } finally {
      if (outPullPending.current === request) {
        outPullPending.current = null
        setOutPulling(false)
      }
    }
  }

  // 按货号选物料（补充）：出库量有则带入，否则 0
  async function loadManMats(code: string) {
    setManCode(code); setManSel([])
    if (!code) { setManMats([]); return }
    try {
      const { data } = await api.get<any[]>('/materials', { params: { code } })
      setManMats(Array.isArray(data) ? data.filter(m => m.active !== false) : [])
    } catch { setManMats([]) }
  }
  async function pullManual() {
    if (outLoading) { message.info('正在读取出库量，请稍候再添加'); return }
    const picked = manSel.map(k => manMats.find(m => String(m.id) === String(k))).filter(Boolean)
    if (!picked.length) { message.warning('请先勾选物料'); return }
    const matToPo = await buildMatToPo()
    const newItems = picked.map((m: any) =>
      makeItem(m, m.id != null ? (outByMat.get(m.id) ?? 0) : 0, { poInfo: m.id ? matToPo.get(m.id) : undefined }))
    appendItems(newItems)
    applyPartition([...items, ...newItems])
    setManOpen(false); setManSel([])
    message.success(`已添加 ${newItems.length} 条物料明细`)
  }

  async function openTools() {
    setToolOpen(true); setToolSel([]); setToolQuery(''); setToolRows([]); setToolLoading(true)
    try {
      const { data } = await api.get<Material[]>('/materials/tools')
      setToolRows((data || []).filter(m => m.active !== false && m.id != null))
    } finally { setToolLoading(false) }
  }
  function pullTools() {
    const picked = toolRows.filter(m => toolSel.includes(m.id!) && !items.some(it => it.material_id === m.id))
    if (!picked.length) { message.warning('请勾选尚未添加的工具'); return }
    if (picked.some(m => m.purchase_price != null && !m.purchase_currency)) {
      message.warning('所选工具有采购单价但缺少币种，请先在工具库补充'); return
    }
    const newItems = picked.map(m => ({ ...makeItem(m, 0), ...toolShipmentFields(m) }))
    appendItems(newItems)
    setToolOpen(false); setToolSel([])
    message.success(`已添加 ${newItems.length} 条工具，请填写本次送货数量和装箱资料`)
  }

  function openCreate() {
    const session = ++editorSession.current
    editorLoadState.current = 'ready'; setEditorLoad('ready')
    setCreating(true); setEditing({ id: 0, status: 'draft', rate: 0.93, container_count: 1 })
    setItems([]); setMatMap(new Map()); setDirtyMatIds(new Set())
    setEditorDirty(false)
    form.resetFields()
    setTimeout(() => { if (editorSession.current !== session) return; form.setFieldsValue({
      status: 'draft',
      rate: 0.93,
      container_count: 1,
      ship_date: dayjs().format('YYYY-MM-DD'),
    }) }, 0)
  }
  async function openEdit(s: ShipmentSummary) {
    const session = ++editorSession.current
    editorLoadState.current = 'loading'; setEditorLoad('loading')
    setCreating(false); setEditing(s)
    form.resetFields(); setItems([]); setMatMap(new Map()); setDirtyMatIds(new Set())
    setEditorDirty(false)
    try {
      const { data } = await api.get<ShipmentDetail>(`/shipments/${s.id}`)
      if (editorSession.current !== session) return
      if (data.id !== s.id || !Array.isArray(data.items)) throw new Error('走货详情响应不完整，请重试')
      const its = data.items.map(item => ({
        ...item,
        material_snapshot: typeof item.material_snapshot === 'string' ? JSON.parse(item.material_snapshot) : item.material_snapshot,
      }))
      const ids = [...new Set(its.filter(item => !item.material_snapshot).map(item => item.material_id).filter((id): id is number => id != null && id > 0))]
      const materials = ids.length ? (await api.get<Material[]>('/materials/by-ids', { params: { ids: ids.join(',') } })).data : []
      if (editorSession.current !== session) return
      if (!Array.isArray(materials) || ids.some(id => !materials.some(material => material.id === id)))
        throw new Error('物料资料未完整加载，请重试后再编辑')
      // Publish the detail and metadata together: no half-loaded editable table.
      setMatMap(new Map(materials.map(material => [material.id!, material])))
      form.setFieldsValue({
        customer: data.customer,
        container_no: data.container_no,
        container_count: data.container_count,
        ship_date: data.ship_date ? dayjs(data.ship_date).format('YYYY-MM-DD') : '',
        load_date: data.load_date ? dayjs(data.load_date).format('YYYY-MM-DD') : '',
        bl_no: data.bl_no,
        rate: data.rate,
        status: data.status,
      })
      setItems(its)
      setEditorDirty(false)
      editorLoadState.current = 'ready'; setEditorLoad('ready')
    } catch (e: any) {
      if (editorSession.current !== session) return
      editorLoadState.current = 'error'; setEditorLoad('error')
      message.error('加载失败: ' + (e?.message ?? e))
    }
  }
  async function save(closeAfterSave = false): Promise<boolean> {
    if (editorLoadState.current !== 'ready') { message.info('明细尚未完整加载，请加载成功后再保存'); return false }
    if (sheetEditing) { message.info('数量正在校验，请完成后再保存'); return false }
    try {
      const v = await form.validateFields()
      const priceError = shipmentDeclarationSaveError(items)
      if (priceError) { message.error(priceError); return false }
      setSaving(true)
      // 空字符串日期 → null，否则后端 DateTime? 绑定失败 400
      const dOrNull = (x: any) => (x ? x : null)
      const cleanItems = items.map(it => ({
        ...it,
        _rowKey: undefined,
        material_id: it.material_snapshot ? it.material_snapshot.id ?? null : it.material_id,
        material_snapshot: it.material_snapshot ? matMap.get(it.material_id!) : undefined,
        weighing_qty: effectiveWeighingQty(it, matMap.get(it.material_id!)),
        po_date: dOrNull(it.po_date),
        contract_date: dOrNull(it.contract_date),
        invoice_date: dOrNull(it.invoice_date),
      }))
      const body = {
        customer:     v.customer ?? '',
        container_no: v.container_no ?? '',
        container_count: v.container_count ?? 1,
        ship_date:    v.ship_date || null,
        load_date:    v.load_date || null,
        bl_no:        v.bl_no ?? '',
        rate:         v.rate ?? 0.93,
        status:       v.status ?? 'draft',
        items:        cleanItems,
      }
      if (creating) {
        const { data } = await api.post<{ id: number }>('/shipments', body)
        setEditing(prev => ({
          ...(prev ?? { id: data.id }),
          id: data.id,
          customer: v.customer ?? '',
          container_no: v.container_no ?? '',
          status: v.status ?? 'draft',
        }))
        setCreating(false)
        message.success('已新建')
      } else if (editing) {
        await api.put(`/shipments/${editing.id}`, body)
        setEditing(prev => prev ? {
          ...prev,
          customer: v.customer ?? '',
          container_no: v.container_no ?? '',
          status: v.status ?? 'draft',
        } : prev)
        message.success('已更新')
      }
      // 写回货号库：被改过尺寸/毛净重/单位的物料
      if (dirtyMatIds.size) {
        await Promise.all([...dirtyMatIds].map(id => {
          if (id < 0) return Promise.resolve()
          const m = matMap.get(id)
          if (!m) return Promise.resolve()
          return api.put(`/materials/${id}/dims`, {
            length: num(m.length), width: num(m.width), height: num(m.height),
            weight_per_carton: num(m.weight_per_carton),
            gross_per_pc: num(m.gross_per_pc), net_per_pc: num(m.net_per_pc),
            unit_kg: m.unit_kg || 'KGM',
          }).catch(() => {})
        }))
        setDirtyMatIds(new Set())
      }
      setEditorDirty(false)
      if (closeAfterSave) closeEditor()
      load()
      return true
    } catch {
      /* 拦截器已提示 */
      return false
    } finally {
      setSaving(false)
    }
  }

  function closeEditor() {
    editorSession.current++
    editorLoadState.current = 'ready'; setEditorLoad('ready')
    closeOutboundLink()
    setEditing(null)
    setCreating(false)
    setDrawerFull(false)
    setEditorDirty(false)
  }

  function requestCloseEditor() {
    if (sheetWritePending.current) { message.info('数量正在校验，请完成后再关闭'); return }
    if (!editorDirty) { closeEditor(); return }
    Modal.confirm({
      title: '保存后退出？',
      content: '当前有未保存的修改，请先保存，避免本次修改丢失。',
      okText: '保存并退出',
      cancelText: '继续编辑',
      onOk: async () => {
        const ok = await save(true)
        if (!ok) return Promise.reject()
      },
    })
  }

  function requestDiscardChanges() {
    if (sheetWritePending.current) { message.info('数量正在校验，请完成后再取消修改'); return }
    if (!editorDirty) {
      message.info('当前没有未保存的修改')
      return
    }
    Modal.confirm({
      title: '取消本次修改？',
      content: creating
        ? '这张新走货单尚未保存，取消后将关闭。'
        : '将放弃本次尚未保存的内容，并恢复上一次保存的数据。',
      okText: '确认取消修改',
      okButtonProps: { danger: true },
      cancelText: '继续编辑',
      onOk: async () => {
        if (creating) {
          closeEditor()
          return
        }
        if (editing) await openEdit(editing)
      },
    })
  }
  async function del(id: number) {
    try {
      await api.delete(`/shipments/${id}`)
      message.success('已删除'); load()
    } catch { /* 拦截器已提示 */ }
  }
  async function delSelected() {
    if (!selKeys.length) return
    setLoading(true)
    const fails: string[] = []
    let ok = 0
    for (const k of selKeys) {
      try { await api.delete(`/shipments/${k}`); ok++ }
      catch (e: any) { fails.push(`#${k}: ${e?.response?.data?.error ?? e?.message ?? '失败'}`) }
    }
    setLoading(false); setSelKeys([])
    if (fails.length) Modal.warning({ title: `成功 ${ok} 条，失败 ${fails.length} 条`, content: fails.join('\n') })
    else message.success(`已删除 ${ok} 条`)
    load()
  }

  // ============ 出口报关明细 Excel 导出（基于模板，移植自旧版 buildExcel） ============
  const [exporting, setExporting] = useState(false)
  // 数据核对只作提醒，不拦截导出。返回 {hard,warn} 以区分问题级别。
  const decimals = (n: any) => { const s = String(n ?? ''); const i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1 }
  async function computeValidation(): Promise<{ hard: string[]; warn: string[] }> {
    const v = form.getFieldsValue()
    const hard: string[] = [], warn: string[] = []
    if (!(v.container_no || '').trim()) hard.push('整柜信息：柜号必填')
    if (!v.ship_date) hard.push('整柜信息：走柜日期必填')
    if (!v.load_date) warn.push('整柜信息：未填写装柜日期，导出文件名将标注“未填装柜日期”')
    if (!v.rate || v.rate <= 0) hard.push('整柜信息：汇率必须 > 0')
    if (!items.length) warn.push('没有任何明细行（对应旧系统“未勾选需填物料”）')
    const parts = new Set(items.map(it => partitionOf(it.po_no)).filter(Boolean))
    if (parts.size > 1) hard.push('本票混合了 RRI 与 RRM 的 PO，不允许混柜，请拆成两票')
    // 警告需要物料毛/净重：按 material_id 批量取
    const ids = [...new Set(items.map(it => it.material_id).filter((x): x is number => x != null && x > 0))]
    const matById = new Map<number, any>(matMap)
    if (ids.length) {
      try {
        const { data } = await api.get<any[]>('/materials/by-ids', { params: { ids: ids.join(',') } })
        for (const m of (data || [])) if (m.id != null) matById.set(m.id, m)
      } catch {}
    }
    items.forEach((it, i) => {
      const tag = `行${i + 1}（物料#${it.material_id ?? '-'} ${it.formula_name ?? ''}）：`
      if (!it.outbound_id) warn.push(tag + '未关联具体出库记录，不参与出库余额校验')
      if (!(Number(it.kg) > 0)) hard.push(tag + '申报数量必须 > 0（按申报单位）')
      if (!(Number(it.qty) > 0)) hard.push(tag + '送货数量必须 > 0')
      if (!(Number(it.cartons) > 0)) hard.push(tag + '箱数必须 > 0')
      const packing = parseShipmentPacking(it.qty_per_carton)
      if (packing.mode === 'invalid') hard.push(tag + '每箱数量格式不合法（例如“3000”或“1-2/3000 3/4000”）')
      if (packing.mode === 'ranges' && Number(it.qty) > 0 && Math.abs(packing.totalQty - Number(it.qty)) > 0.0001)
        warn.push(tag + `每箱数量分段合计 ${packing.totalQty} 与送货数量 ${it.qty} 不一致`)
      if (!(Number(it.price) > 0)) hard.push(tag + '采购单价必须 > 0')
      if (decimals(it.kg) > 4) hard.push(tag + '申报数量小数超过 4 位')
      // Per-piece purchase prices may need more than four decimal places.
      // Display precision must not reject or round the source PO price.
      if (it.pallet && !/^\d+-\d+\/.+/.test(it.pallet) && !/^\d+-\d+$/.test(it.pallet))
        hard.push(tag + '卡板格式不合法（"1-22/2卡" 或 "1-22"）')
      const m = it.material_id != null ? matById.get(it.material_id) : null
      if (m && shipmentGrossPerPc(m.weight_per_carton, effectiveWeighingQty(it, m)) > 0 && Number(m.net_per_pc) && shipmentGrossPerPc(m.weight_per_carton, effectiveWeighingQty(it, m)) < Number(m.net_per_pc))
        warn.push(tag + '单个毛重 < 单个净重')
      if (!it.supplier) warn.push(tag + '供应商为空')
      if (!it.po_no) warn.push(tag + '采购单号为空')
      if (!it.contract_no) warn.push(tag + '合同号为空')
    })
    return { hard, warn }
  }
  async function runValidation() {
    const rep = await computeValidation()
    setValReport(rep); setValOpen(true)
  }
  async function exportShipmentExcel() {
    if (!editing) { message.warning('请先打开一票走货'); return }
    const v = form.getFieldsValue()
    const rep = await computeValidation()
    if (rep.hard.length || rep.warn.length) {
      setValReport(rep)
      message.warning(`发现 ${rep.hard.length + rep.warn.length} 项待核对问题，仍将导出；正式报关前请运行核对`)
    }

    setExporting(true)
    try {
      const { buildCustomsWorkbook, customsFileName, dataUrlToBytes, isIndonesiaBlHead } = await import('../utils/customsExport')
      // 1) RRI/RRM 模板本身已按顺序预留多份合同、发票和装箱单；整票只生成一个工作簿。
      const templateName = String(v.customer || '').toUpperCase().includes('RRI')
        ? 'template-customs-rri.xlsx'
        : 'template-customs-rrm.xlsx'
      const [tplResp, indonesiaTplResp] = await Promise.all([
        fetch(publicAsset(import.meta.env.BASE_URL, templateName)),
        fetch(publicAsset(import.meta.env.BASE_URL, 'template-customs.xlsx')),
      ])
      if (!tplResp.ok) throw new Error(`模板加载失败 ${templateName} (HTTP ${tplResp.status})`)
      if (!indonesiaTplResp.ok) throw new Error(`印尼单据模板加载失败 (HTTP ${indonesiaTplResp.status})`)
      const [templateBuffer, indonesiaTemplateBuffer] = await Promise.all([
        tplResp.arrayBuffer(), indonesiaTplResp.arrayBuffer(),
      ])
      // 2) 物料富化：products → materials by code → material_id 映射
      const { data: prods } = await api.get<any[]>('/products')
      const productHs = new Map<string, { hsCN?: string; hsID?: string }>()
      for (const p of prods) productHs.set(p.code, { hsCN: p.hs_cn, hsID: p.hs_id })
      const materials = new Map<number, any>()
      const { data: usedMaterials } = await api.get<any[]>('/materials/by-ids', { params: { ids: [...new Set(items.map(it => it.material_id).filter(id => id != null && id > 0))].join(',') } })
      for (const m of usedMaterials) if (m.id != null) materials.set(m.id, m)
      for (const id of dirtyMatIds) if (id > 0 && matMap.has(id)) materials.set(id, matMap.get(id))
      for (const it of items) if (it.material_snapshot && it.material_id != null) materials.set(it.material_id, matMap.get(it.material_id))
      // 3) 图片：对用到的物料按 image_id 拉 dataURL → bytes
      const images = new Map<number, { bytes: Uint8Array; ext: string }>()
      for (const it of items) {
        const image = it.material_snapshot && matMap.get(it.material_id!)?.image
        if (image && it.material_id != null) {
          const parsed = dataUrlToBytes(image)
          if (parsed) images.set(it.material_id, parsed)
        }
      }
      const withImg = items
        .map(it => it.material_id != null ? materials.get(it.material_id) : null)
        .filter((m: any) => m && m.image_id && items.some(it => !it.material_snapshot && it.material_id === m.id))
      await Promise.all(withImg.map(async (m: any) => {
        try {
          const { data } = await api.get<{ data_url?: string }>(`/images/${m.image_id}`)
          const parsed = data?.data_url ? dataUrlToBytes(data.data_url) : null
          if (parsed) images.set(m.id, parsed)
        } catch {}
      }))
      // 4) 生成
      const form2 = {
        customer: v.customer, containerNo: v.container_no, containerCount: v.container_count,
        shipDate: v.ship_date, loadDate: v.load_date, blNo: v.bl_no, rate: v.rate,
      }
      const { documentSellerForLine, supplierForLine } = await import('../utils/supplierProfiles')
      const { data: dictionaries } = await api.get<Dictionaries>('/dictionaries')
      const sellerKeys = new Set<string>()
      for (const item of items) {
        const material = materials.get(item.material_id!)
        const seller = isIndonesiaBlHead(item.bl_head)
          ? supplierForLine(item.supplier || material?.supplier || '', dictionaries.suppliers || [], true)
          : documentSellerForLine(
            item.supplier || material?.supplier || '',
            item.customs_company || material?.customs_company || '',
            dictionaries.suppliers || [],
            true,
          )
        sellerKeys.add(String(seller.id || seller.full || seller.keyword || '未填卖方'))
      }
      const fname = customsFileName(form2)
      const blob = await buildCustomsWorkbook({
        templateBuffer, indonesiaTemplateBuffer, items, materials, productHs, images, form: form2,
        supplierProfiles: dictionaries.suppliers || [],
      })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob); a.download = fname; document.body.appendChild(a); a.click()
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1000)
      message.success(`已生成 1 个工作簿（${sellerKeys.size} 家卖方）：${fname}`)
    } catch (e: any) {
      // 模板 fetch / 生成工作簿 抛的是普通 Error（非 axios），拦截器不覆盖，需自行提示
      message.error('导出失败：' + (e?.response?.data?.error ?? e?.message ?? e))
    } finally {
      setExporting(false)
    }
  }

  function patchItem(i: number, k: keyof ShipmentItem, v: any) {
    if (k === 'material_id') {
      const source = consolidatedItems[i]?.sources[0]
      if (!source || consolidatedItems[i].sources.length !== 1) return
      setItems(current => current.map(it => it._rowKey === source._rowKey ? { ...it, material_id: v, carton_group: undefined } : it))
      setEditorDirty(true)
      return
    }
    return writeMergedCells([{ row: i, field: k, value: String(v ?? '') }], false, true)
  }

  function editSheetCells(edits: SheetEdit[]) {
    return writeMergedCells(edits, true)
  }
  function mergedCellValue(row: number, field: string): string | number | undefined {
    const item = consolidatedItems[row]
    const material = item?.material_id != null ? matMap.get(item.material_id) : undefined
    if (field === 'currency') return item?.currency || '¥'
    if (field === 'material:unit_kg') return material?.unit_kg || 'KGM'
    if (field === 'kg') return formatShipmentDeclaration(item?.kg, material?.unit_kg)
    if (field === 'pallet') return formatShipmentPallet(item?.pallet)
    if (field === 'weighing_qty') return shipmentOptionalNumber(effectiveWeighingQty(item, material))
    if (['material:length', 'material:width', 'material:height', 'material:weight_per_carton'].includes(field))
      return shipmentOptionalNumber(material?.[field.slice(9)])
    if (item?.sources.length > 1 && field === 'po_date')
      return shipmentPurchaseDates(item.sources).join(' / ')
    if (field === 'po_date' || field === 'contract_date' || field === 'invoice_date')
      return shipmentDateOnly(item?.[field])
    return field.startsWith('material:') || field.startsWith('snapshot:') ? material?.[field.slice(9)]
      : item?.[field as keyof ShipmentItem] as string | number | undefined
  }
  // Clipboard/previews read the full data model, never just the mounted viewport.
  function sheetDisplayValue(row: number, col: number): string | number | undefined {
    const item = consolidatedItems[row]
    if (!item) return ''
    const material = matMap.get(item.material_id!)
    const field = shipmentSheetFields[col]
    if (field) return mergedCellValue(row, field)
    const calculated = calc(item)
    switch (col) {
      case 0: return row + 1
      case 1: return item.outbound_ids.map(id => `OUT-${id}`).join(' / ') || '未关联'
      case 3: return item.material_snapshot?.id || (item.material_snapshot ? '导入' : item.material_id)
      case 4: return material?.name_zh
      case 5: return material?.product_code
      case 9: return material?.name_en
      case 10: return material?.spec
      case 11: return material?.category
      case 15: return item.purchase_unit || (isPaperRope(material?.name_zh) ? '米' : '个')
      case 16: return calculated.grossTotal ? calculated.grossTotal.toFixed(2) : ''
      case 17: return calculated.netTotal ? calculated.netTotal.toFixed(2) : ''
      case 18: return calculated.cbmEach ? calculated.cbmEach.toFixed(4) : ''
      case 19: return calculated.cbmTotal ? calculated.cbmTotal.toFixed(4) : ''
      case 25: return item.invoice_price?.toFixed(4)
      case 26: return calculated.invoiceAmount ? calculated.invoiceAmount.toFixed(2) : ''
      case 32: return calculated.purchaseAmount.toFixed(2)
      case 44: return shipmentGrossPerPc(material?.weight_per_carton, effectiveWeighingQty(item, material)).toFixed(6)
      default: return ''
    }
  }
  async function writeMergedCells(edits: SheetEdit[], batch: boolean, synchronous = false) {
    if (!edits.length || sheetWritePending.current) return false
    sheetWritePending.current = true
    const checksQuantity = edits.some(edit => edit.field === 'qty')
    if (checksQuantity) setSheetEditing(true)
    try {
      for (const edit of edits) if (edit.field === 'customs_company' && edit.value.trim()
        && !customsOptions.some(option => option.value === edit.value.trim()))
        throw new Error(`第 ${edit.row + 1} 行：报关出口公司不在可选名单中，请先维护供应商资料`)
      const original = { ...sheetRevision.current }
      const unchanged = () => sheetRevision.current.rawItems === original.rawItems && sheetRevision.current.matMap === original.matMap
        && sheetRevision.current.session === original.session
      const calculate = (balances = outRows) => {
        if (!unchanged()) throw new Error('明细已变化，请重新选择编辑位置')
        return applyMergedShipmentEdits(items, matMap, consolidatedItems, edits, balances, { preserveTextWhitespace: !batch })
      }
      const calculateQuantity = async () => {
        const { data } = await api.get<OutByMat[]>('/outbound/allocatable', { params: editing?.id ? { shipment_id: editing.id } : {} })
        const balances = Array.isArray(data) ? data : []
        setOutRows(balances)
        return calculate(balances)
      }
      const apply = (result: ReturnType<typeof applyMergedShipmentEdits<ShipmentItem>>) => {
        const commit = () => {
          setItems(result.items)
          if (result.dirtyMaterials.size || edits.some(edit => edit.field.startsWith('snapshot:'))) {
            setMatMap(result.materials)
          }
          if (result.dirtyMaterials.size) {
            setDirtyMatIds(current => new Set([...current, ...result.dirtyMaterials]))
          }
          setEditorDirty(true)
        }
        // Batch actions await the draft, then must read the newly rendered row model.
        if (synchronous) flushSync(commit)
        else commit()
      }
      // Non-quantity blur commits must reach React before the following Save/copy/fill click.
      const result = checksQuantity ? await calculateQuantity() : calculate()
      // Paste and fill update the editor immediately; persistence still requires Save.
      apply(result)
      return true
    } catch (error) { message.error((error as Error).message); return false }
    finally {
      sheetWritePending.current = false
      if (checksQuantity) setSheetEditing(false)
    }
  }
  // 申报数量按所选单位：KGM 为净重，PCE 为件数，TNE 为吨数。
  function kgForItem(it: ShipmentItem, m: any): number {
    return shipmentKgWeight(m?.unit_kg, it.qty, m?.net_per_pc, m?.name_zh)
  }
  // 改 数量 / 每箱数量 时联动：统一数量按除法算箱数，分段写法按箱号计数。
  function patchQtyOrPack(i: number, k: 'qty' | 'qty_per_carton', v: any) {
    return patchItem(i, k, v)
  }
  // 改物料主数据（单位/尺寸/毛净重）→ 更新 matMap、标脏、并按单位重算相关行的送货KG重量
  function patchMatDim(materialId: number | undefined, field: string, value: any) {
    if (materialId == null) return
    if (field === 'unit_kg') {
      const row = consolidatedItems.findIndex(item => item.material_id === materialId)
      if (row >= 0) return writeMergedCells([{ row, field: 'material:unit_kg', value: String(value || 'KGM') }], false)
      return
    }
    setEditorDirty(true)
    const newM = { ...(matMap.get(materialId) || {}), [field]: value }
    setMatMap(prev => new Map(prev).set(materialId, newM))
    setDirtyMatIds(prev => new Set(prev).add(materialId))
    if (field === 'net_per_pc')
      setItems(its => its.map(it => it.material_id === materialId
        ? { ...it, kg: kgForItem(it, newM) }
        : it))
  }
  function addItem() {
    setEditorDirty(true)
    setItems(its => [...its, { seq: its.length + 1, qty: 0, kg: 0, cartons: 0, currency: 'US$' }])
  }
  function delItem(i: number) {
    const keys = new Set(consolidatedItems[i]?.sources.map(source => source._rowKey))
    setEditorDirty(true)
    setItems(its => its.filter(it => !keys.has(it._rowKey)).map((it, idx) => ({ ...it, seq: idx + 1 })))
  }

  function fillItemDown(sourceIndex: number, targetIndex: number, field: keyof ShipmentItem) {
    if (targetIndex <= sourceIndex) {
      message.warning('请把复制点向下拖动到目标行')
      return
    }
    editSheetCells(Array.from({ length: targetIndex - sourceIndex }, (_, offset) => ({
      row: sourceIndex + offset + 1, field, value: String(mergedCellValue(sourceIndex, field) ?? ''),
    })))
  }

  function fillable(i: number, field: keyof ShipmentItem, control: React.ReactNode) {
    return (
      <FillableShipmentCell
        rowIndex={i}
        rowCount={consolidatedItems.length}
        field={field}
        onFill={(sourceIndex, targetIndex, sourceField) => fillItemDown(sourceIndex, targetIndex, sourceField as keyof ShipmentItem)}
        onFillToEnd={(sourceIndex, sourceField) => fillItemDown(sourceIndex, consolidatedItems.length - 1, sourceField as keyof ShipmentItem)}
      >
        {control}
      </FillableShipmentCell>
    )
  }

  function fillMaterialDown(sourceIndex: number, targetIndex: number, field: string) {
    if (targetIndex <= sourceIndex) {
      message.warning('请把复制点向下拖动到目标行')
      return
    }
    editSheetCells(Array.from({ length: targetIndex - sourceIndex }, (_, offset) => ({
      row: sourceIndex + offset + 1, field, value: String(mergedCellValue(sourceIndex, field) ?? ''),
    })))
  }

  function fillableMaterial(i: number, field: string, control: React.ReactNode) {
    const fillField = `material:${field}`
    return (
      <FillableShipmentCell
        rowIndex={i}
        rowCount={consolidatedItems.length}
        field={fillField}
        onFill={fillMaterialDown}
        onFillToEnd={(sourceIndex, sourceField) => fillMaterialDown(sourceIndex, consolidatedItems.length - 1, sourceField)}
      >
        {control}
      </FillableShipmentCell>
    )
  }

  function importedHsCell(row: ShipmentItem, index: number, field: 'hs_cn' | 'hs_id') {
    const code = matMap.get(row.material_id!)?.[field] ?? ''
    if (!row.material_snapshot || !(row.material_id! < 0)) return code
    const sheetField = `snapshot:${field}`
    return <FillableShipmentCell rowIndex={index} rowCount={consolidatedItems.length} field={sheetField} onFill={fillMaterialDown}
      onFillToEnd={(sourceIndex, sourceField) => fillMaterialDown(sourceIndex, consolidatedItems.length - 1, sourceField)}>
      <ShipmentTextCell value={code} inputMode="numeric" maxLength={field === 'hs_cn' ? 10 : 8}
        aria-label={`第 ${index + 1} 行${field === 'hs_cn' ? '中国' : '印尼'}海关编码`}
        title="仅修改本票走货的导入资料，不写回货号库；支持粘贴和向下填充"
        onCommit={value => writeMergedCells([{ row: index, field: sheetField, value }], false, true)} />
    </FillableShipmentCell>
  }

  const filtered = useMemo(() => rows.filter(r => {
    if (statusFilter && r.status !== statusFilter) return false
    if (customerFilter && (r.customer || '(未分配)') !== customerFilter) return false
    if (!filter) return true
    const s = filter.toLowerCase()
    return ((r.customer || '') + (r.container_no || '') + (r.bl_no || '')).toLowerCase().includes(s)
  }), [rows, filter, statusFilter, customerFilter])

  const statsByStatus = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rows) m.set(r.status || 'draft', (m.get(r.status || 'draft') ?? 0) + 1)
    return m
  }, [rows])

  const customerStats = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rows) m.set(r.customer || '(未分配)', (m.get(r.customer || '(未分配)') ?? 0) + 1)
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [rows])

  // Totals (for footer of items table)
  const tot = useMemo(() => {
    let cbm = 0, gross = 0, net = 0
    for (const it of items) {
      const m = it.material_id != null ? matMap.get(it.material_id) : null
      cbm += (Number(m?.length) || 0) * (Number(m?.width) || 0) * (Number(m?.height) || 0) / 1e6 * (Number(it.cartons) || 0)
      const weightQty = shipmentWeightQuantity(m?.name_zh, it.qty)
      gross += shipmentGrossPerPc(m?.weight_per_carton, effectiveWeighingQty(it, m)) * weightQty
      net += (Number(m?.net_per_pc) || 0) * weightQty
    }
    return {
      rows: items.length,
      qty: items.reduce((s, it) => s + (it.qty ?? 0), 0),
      kg:  items.reduce((s, it) => s + (it.kg ?? 0), 0),
      cartons: cartonRows.reduce((s, row) => s + row.count, 0),
      amount: items.reduce((s, it) => s + shipmentPurchaseAmount(it), 0),
      cbm, gross, net,
    }
  }, [items, matMap])

  return (
    <div style={{ padding: 16 }}>
      <Card
        title={`走货明细 — 共 ${rows.length} 票`}
        extra={
          <Space wrap>
            <Input.Search allowClear placeholder="搜索 客户/集装箱/封号" style={{ width: 220 }}
              onSearch={setFilter} onChange={(e) => !e.target.value && setFilter('')} />
            <Select
              value={statusFilter} onChange={setStatusFilter}
              style={{ width: 140 }}
              options={[{ value: '', label: `全部 (${rows.length})` },
                ...STATUS.map(s => ({ value: s.value, label: `${s.label} (${statsByStatus.get(s.value) ?? 0})` }))]}
            />
            <Popconfirm title={`删除选中的 ${selKeys.length} 票?`} onConfirm={delSelected} disabled={!selKeys.length}>
              <Button danger disabled={!selKeys.length}>🗑 批量删除 ({selKeys.length})</Button>
            </Popconfirm>
            <Button type="primary" onClick={openCreate}>➕ 新建走货</Button>
            <Button onClick={load}>🔄 刷新</Button>
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
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={filtered}
          pagination={{ defaultPageSize: 50, showSizeChanger: true }}
          rowSelection={{ selectedRowKeys: selKeys, onChange: (k) => setSelKeys(k) }}
          columns={[
            { title: '客户', dataIndex: 'customer', width: 130 },
            { title: '集装箱号', dataIndex: 'container_no', width: 160 },
            { title: '箱数', dataIndex: 'container_count', width: 70, align: 'right' },
            { title: '封号', dataIndex: 'bl_no', width: 160 },
            { title: '汇率', dataIndex: 'rate', width: 90, align: 'right', render: (v) => Number(v ?? 0).toFixed(4) },
            { title: '截关日期', dataIndex: 'ship_date', width: 120, render: (v) => v ? dayjs(v).format('YYYY-MM-DD') : '' },
            { title: '装柜时间', dataIndex: 'load_date', width: 120, render: (v) => v ? dayjs(v).format('YYYY-MM-DD') : '' },
            {
              title: '状态', dataIndex: 'status', width: 100,
              render: (v) => {
                const s = STATUS.find(x => x.value === v) ?? STATUS[0]
                return <Tag color={s.color}>{s.label}</Tag>
              },
            },
            { title: '行数', dataIndex: 'item_count', width: 70, align: 'right' },
            {
              title: '操作', width: 130,
              render: (_v, r) => (
                <Space>
                  <a onClick={() => openEdit(r)}>编辑</a>
                  <Popconfirm title={`删除该走货?`} onConfirm={() => del(r.id)}>
                    <a style={{ color: '#ff4d4f' }}>删除</a>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Drawer
        open={editing !== null}
        width={drawerFull ? '100vw' : '92vw'}
        className="shipment-editor"
        title={creating ? '新建走货' : `编辑走货 #${editing?.id} — ${editing?.container_no || ''}`}
        onClose={requestCloseEditor}
        destroyOnClose
        extra={
          <Space size={8} wrap>
            <Button onClick={runValidation} disabled={editorLoad !== 'ready' || sheetEditing}>🔍 运行核对</Button>
            <Button onClick={exportShipmentExcel} loading={exporting} disabled={editorLoad !== 'ready' || sheetEditing}>📤 导出报关明细</Button>
            <Button onClick={() => setDrawerFull(!drawerFull)}>{drawerFull ? '⤢ 退出全屏' : '⤡ 全屏'}</Button>
            <Button onClick={requestDiscardChanges} disabled={!editorDirty || sheetEditing}>↩ 取消修改</Button>
            <Button type="primary" onClick={() => save()} loading={saving || sheetEditing} disabled={editorLoad !== 'ready'}>💾 保存</Button>
          </Space>
        }
      >
        {editorLoad === 'loading' && <div className="shipment-editor-loading" role="status"><Spin /><Typography.Text>正在加载走货明细和物料资料，请稍候…</Typography.Text></div>}
        {editorLoad === 'error' && <Alert type="error" showIcon message="走货资料加载失败，尚未修改原数据" description="请重试。详情和物料完整载入前不能编辑、保存或导出。" action={<Button onClick={() => editing && openEdit(editing)}>重新加载</Button>} />}
        {sheetEditing && <div role="status">正在校验数量，请稍候再继续编辑…</div>}
        <div hidden={editorLoad !== 'ready'} inert={sheetEditing}>
        <Form form={form} layout="vertical" disabled={editorLoad !== 'ready'} onValuesChange={() => setEditorDirty(true)}>
          <Row gutter={12}>
            <Col span={5}>
              <Form.Item name="customer" label="客户（分区 RRI/RRM，按 PO 前缀自动判定）">
                <AutoComplete
                  options={[{ value: 'RRI', label: 'RRI' }, { value: 'RRM', label: 'RRM' }, ...customers.map(c => ({ value: c, label: c }))]}
                  filterOption={(input, opt) => (opt?.label?.toString() ?? '').toLowerCase().includes(input.toLowerCase())}
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </Col>
            <Col span={5}>
              <Form.Item name="container_no" label="集装箱号"><Input placeholder="例如 BMOU1234567" /></Form.Item>
            </Col>
            <Col span={3}>
              <Form.Item name="container_count" label="箱数"><InputNumber min={1} style={{ width: '100%' }} /></Form.Item>
            </Col>
            <Col span={5}>
              <Form.Item name="bl_no" label="封号"><Input /></Form.Item>
            </Col>
            <Col span={3}>
              <Form.Item name="rate" label="汇率"><InputNumber min={0} step={0.0001} style={{ width: '100%' }} /></Form.Item>
            </Col>
            <Col span={3}>
              <Form.Item name="status" label="状态">
                <Select options={STATUS.map(s => ({ value: s.value, label: s.label }))} />
              </Form.Item>
            </Col>
            <Col span={5}>
              <Form.Item name="ship_date" label="截关日期"
                getValueProps={(v) => ({ value: v ? dayjs(v) : null })}
                normalize={(v: any) => v ? dayjs(v).format('YYYY-MM-DD') : ''}>
                <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
              </Form.Item>
            </Col>
            <Col span={5}>
              <Form.Item name="load_date" label="装柜时间"
                getValueProps={(v) => ({ value: v ? dayjs(v) : null })}
                normalize={(v: any) => v ? dayjs(v).format('YYYY-MM-DD') : ''}>
                <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
              </Form.Item>
            </Col>
          </Row>
        </Form>

        <Card
          size="small"
          className="shipment-detail-card"
          title={
            <div className="shipment-summary">
              <span><b>{consolidatedItems.length}</b><small>明细行</small></span>
              <span><b>{tot.qty.toFixed(2)}</b><small>送货数量</small></span>
              <span><b>{tot.net.toFixed(2)} kg</b><small>净重合计</small></span>
              <span><b>{tot.gross.toFixed(2)} kg</b><small>毛重总重</small></span>
              <span><b>{tot.cartons}</b><small>总箱数</small></span>
              <span><b>{tot.cbm.toFixed(4)}</b><small>总 CBM</small></span>
              <span><b>{tot.amount.toFixed(2)}</b><small>采购金额</small></span>
            </div>
          }
          extra={
            <Space wrap>
              <Button size="small" type="primary" onClick={() => { setOutSel([]); loadOutbound(editing?.id || undefined); setOutOpen(true) }}>📦 从出库精确分配</Button>
              <Button size="small" onClick={() => { setManOpen(true); loadProductCodes(); loadOutbound(editing?.id || undefined); if (!manMats.length) loadManMats(manCode) }}>🗂 按货号选物料</Button>
              <Button size="small" onClick={openTools}>从工具库选择</Button>
              <Button size="small" onClick={() => { loadLatestSchedule(); setSchedPickerOpen(true) }}>🔗 从排期勾选</Button>
              <Button size="small" onClick={addItem}>➕ 加一行</Button>
              <ShipmentImport existing={items.map(row => ({ ...row, material_snapshot: matMap.get(row.material_id!) }))} onImport={(imported: ShipmentImportItem[], targets: number[]) => {
                setItems(current => {
                  const next = [...current]
                  imported.forEach((row, index) => {
                    const target = targets[index]
                    if (target < 0) { next.push(row); return }
                    const old = next[target]
                    const provided = Object.fromEntries(Object.entries(row).filter(([, value]) => value != null && value !== ''))
                    next[target] = { ...old, ...provided, material_snapshot:
                      mergeShipmentImportMaterial(matMap.get(old.material_id!), row.material_snapshot) }
                  })
                  return next
                })
                setMatMap(current => {
                  const next = new Map(current)
                  targets.filter(target => target >= 0).forEach(target => {
                    const id = items[target].material_id
                    if (id != null && id < 0) next.delete(id)
                  })
                  return next
                })
                setEditorDirty(true)
              }} />
              <Button size="small" onClick={requestMergeCartons} disabled={cartonSelection.length < 2}>合并箱数</Button>
              <Button size="small" onClick={unmergeCartons} disabled={!cartonSelection.length}>取消合并</Button>
            </Space>
          }
        >
          {showConsolidated && <Typography.Paragraph type="secondary">
            同柜相同物料已合并，可直接在本表编辑、粘贴或向下填充。合并行的数量和重量只显示汇总，采购单号和日期保留各自来源。修改后请保存。
          </Typography.Paragraph>}
          {items.some(item => !shipmentUsesDeclarationPrice(item) && (item.purchase_charge_ratio ?? 1) < 1) && <Typography.Paragraph type="secondary">
            备品不收费：数量和重量保留实际走货（含备品），采购金额按对应采购明细的正常入库／总入库比例折算；分批及合并走货不重复计费。
          </Typography.Paragraph>}
          {items.some(item => item.material_snapshot) && <Typography.Paragraph type="secondary">
            Excel 导入行的中国／印尼海关编码可直接编辑、粘贴或向下填充；保存后仅影响本票走货及导出，不写回货号库。
          </Typography.Paragraph>}
          <Typography.Paragraph type="secondary">
            申报数量按申报单位：PCE 为实际件数，SET 为套数，KGM 为净重公斤，TNE 为净重吨数。送货数量及其数量单位单独保留；毛重、净重始终以 kg 显示。
          </Typography.Paragraph>
          <ShipmentSheetTable<MergedEditorRow<ShipmentItem>>
            fields={shipmentSheetFields}
            editableAt={(row, field) => {
              const item = consolidatedItems[row]
              const material = item?.material_id != null ? matMap.get(item.material_id) : undefined
              return !(item?.sources.length > 1 && mergedReadOnlyFields.has(field))
                && (field !== 'kg' || !isShipmentCountUnit(material?.unit_kg))
                && (!field.startsWith('snapshot:') || (!!item?.material_snapshot && item.material_id != null && item.material_id < 0))
            }}
            onEdits={editSheetCells}
            rowOrder={consolidatedItems.map(item => item.sources.map(source => source._rowKey).join('-')).join(',')}
            valueAt={mergedCellValue}
            displayAt={sheetDisplayValue}
            extraEditorAt={(row, col) => col === 3 ? !consolidatedItems[row]?.material_id && !consolidatedItems[row]?.material_snapshot
              : col === 11 && !consolidatedItems[row]?.outbound_id && consolidatedItems[row]?.material_id != null && matMap.has(consolidatedItems[row].material_id)}
            viewportOffset={drawerFull ? 350 : 400}
            rowKey={r => String(r._rowKey)}
            rowSelection={{ selectedRowKeys: cartonSelection.map(String), onChange: keys => setCartonSelection(keys.map(Number)), fixed: true }}
            size="small"
            pagination={false}
            scroll={{ x: 4600, y: drawerFull ? 'calc(100vh - 350px)' : 'calc(100vh - 400px)' }}
            dataSource={consolidatedItems}
            columns={[
              { title: '序号', width: 50, fixed: 'left', align: 'center', render: (_, _r, i) => i + 1 },
              {
                title: '出库来源', dataIndex: 'outbound_id', width: 115,
                render: (v, r) => v
                  ? <Space size={0} wrap>{r.outbound_ids.map(id => <Tag key={id} bordered={false} color="blue">OUT-{id}</Tag>)}</Space>
                  : <Space direction="vertical" size={0}><Tag bordered={false}>未关联</Tag><Button type="link" size="small" onClick={() => openOutboundLink(r)}>关联出库</Button></Space>,
              },
              {
                title: '图片', width: 56, align: 'center',
                render: (_v, r) => {
                  const m = r.material_id != null ? matMap.get(r.material_id) : null
                  return m?.image
                    ? <img src={m.image} style={{ width: 36, height: 36, objectFit: 'contain', border: '1px solid #eee', borderRadius: 3 }} />
                    : <span style={{ color: '#bbb', fontSize: 12 }}>无</span>
                },
              },
              { title: '物料ID', width: 100, render: (_v, r, i) => r.material_snapshot ? <><Tag title="Excel 导入资料只保存在本次走货单">{r.material_snapshot.id || '导入'}</Tag><ShipmentImportSource source={matMap.get(r.material_id!)?.import_source} /></> : r.material_id ? <Tag>{r.material_id}</Tag> : <Input.Search size="small" placeholder="物料ID" enterButton="选" onSearch={value => { const id = Number(value); if (Number.isInteger(id) && id > 0) { patchItem(i, 'material_id', id); loadMatsForItems([id]) } else message.warning('请输入有效物料 ID') }} /> },
              { title: '产品中文名称', width: 160, fixed: 'left', render: (_v, r) => matMap.get(r.material_id!)?.name_zh ?? '' },
              { title: '货号', width: 100, fixed: 'left', render: (_v, r) => matMap.get(r.material_id!)?.product_code ?? '' },
              { title: '中国HSCODE', width: 150, render: (_v, r, i) => importedHsCell(r, i, 'hs_cn') },
              { title: '印尼HSCODE', width: 140, render: (_v, r, i) => importedHsCell(r, i, 'hs_id') },
              { title: '套公式名称栏', width: 150, render: (_v, r, i) => fillable(i, 'formula_name', <ShipmentTextCell value={r.formula_name} onCommit={value => patchItem(i, 'formula_name', value)} />) },
              { title: '产品英文名称', width: 160, render: (_v, r) => matMap.get(r.material_id!)?.name_en ?? '' },
              { title: '规格', width: 110, render: (_v, r) => matMap.get(r.material_id!)?.spec ?? '' },
              { title: '类别', width: 150, render: (_v, r) => {
                const material = matMap.get(r.material_id!)
                if (r.outbound_id || !material) return material?.category ?? ''
                const options = [...new Set([...MATERIAL_CATEGORIES, material.category].filter(Boolean))]
                return <Select size="small" showSearch style={{ width: '100%' }} placeholder="选择类别"
                  value={material.category || undefined} options={options.map(value => ({ value, label: value }))}
                  onChange={category => {
                    setItems(current => current.map(item => item._rowKey === r._rowKey
                      ? { ...item, material_snapshot: { ...material, category } } : item))
                    if (r.material_id != null && r.material_id < 0) setMatMap(current => {
                      const next = new Map(current); next.delete(r.material_id!); return next
                    })
                    setEditorDirty(true)
                  }} />
              } },
              { title: '申报单位', width: 130, render: (_v, r, i) => fillableMaterial(i, 'unit_kg', <Select size="small" value={matMap.get(r.material_id!)?.unit_kg || 'KGM'} options={UNIT_LIST.map(u => ({ value: u, label: u }))} onChange={(v) => patchMatDim(r.material_id, 'unit_kg', v)} style={{ width: '100%' }} />) },
              { title: '申报数量', width: 120, onCell: r => ({ style: r.sources.length > 1 || isShipmentCountUnit(matMap.get(r.material_id!)?.unit_kg) ? GRAY : undefined }), render: (_v, r, i) => r.sources.length > 1 || isShipmentCountUnit(matMap.get(r.material_id!)?.unit_kg)
                ? <span title="按申报单位自动对应；PCE/SET 请修改送货数量">{formatShipmentDeclaration(r.kg, matMap.get(r.material_id!)?.unit_kg)}</span>
                : fillable(i, 'kg', <ShipmentNumberCell value={r.kg} precision={shipmentDeclarationPrecision(matMap.get(r.material_id!)?.unit_kg)} onCommit={v => patchItem(i, 'kg', v)} />) },
              { title: '送货数量', width: 120, onCell: r => ({ style: r.sources.length > 1 ? GRAY : undefined }), render: (_v, r, i) => r.sources.length > 1 ? num(r.qty).toLocaleString('en-US', { maximumFractionDigits: 4 }) : fillable(i, 'qty', <ShipmentNumberCell value={r.qty} onCommit={v => patchQtyOrPack(i, 'qty', v)} />) },
              { title: '数量单位', width: 80, align: 'center', render: (_v, r) => r.purchase_unit || (isPaperRope(matMap.get(r.material_id!)?.name_zh) ? '米' : '个') },
              { title: '毛重总重', width: 90, align: 'right', onCell: () => ({ style: GRAY }), render: (_v, r) => { const c = calc(r); return c.grossTotal ? c.grossTotal.toFixed(2) : '' } },
              { title: '净重总重', width: 90, align: 'right', onCell: () => ({ style: GRAY }), render: (_v, r) => { const c = calc(r); return c.netTotal ? c.netTotal.toFixed(2) : '' } },
              { title: '立方数/每箱', width: 100, align: 'right', onCell: () => ({ style: GRAY }), render: (_v, r) => { const c = calc(r); return c.cbmEach ? c.cbmEach.toFixed(4) : '' } },
              { title: '总立方数', width: 90, align: 'right', onCell: () => ({ style: GRAY }), render: (_v, r) => { const c = calc(r); return c.cbmTotal ? c.cbmTotal.toFixed(4) : '' } },
              { title: '产品用途', width: 140, render: (_v, r, i) => fillable(i, 'product_use', <ShipmentTextCell value={r.product_use} onCommit={value => patchItem(i, 'product_use', value)} />) },
              { title: '合同号码', width: 180, render: (_v, r, i) => fillable(i, 'contract_no', <ShipmentTextCell value={r.contract_no} onCommit={value => patchItem(i, 'contract_no', value)} />) },
              { title: '合同日期', width: 155, render: (_v, r, i) => fillable(i, 'contract_date', <DatePicker size="small" style={{ width: '100%' }} format="YYYY-MM-DD" value={r.contract_date ? dayjs(r.contract_date) : null} onChange={(v) => patchItem(i, 'contract_date', v ? v.format('YYYY-MM-DD') : '')} />) },
              { title: '发票号', width: 180, render: (_v, r, i) => fillable(i, 'invoice_no', <ShipmentTextCell value={r.invoice_no} onCommit={value => patchItem(i, 'invoice_no', value)} />) },
              { title: '发票日期', width: 155, render: (_v, r, i) => fillable(i, 'invoice_date', <DatePicker size="small" style={{ width: '100%' }} format="YYYY-MM-DD" value={r.invoice_date ? dayjs(r.invoice_date) : null} onChange={(v) => patchItem(i, 'invoice_date', v ? v.format('YYYY-MM-DD') : '')} />) },
              { title: '发票单价', width: 120, onCell: () => ({ style: GRAY }), render: (_v, r) => <span title="自动按导出公式计算；金额按申报数量及申报单位计算">{r.invoice_price?.toFixed(4)}</span> },
              { title: '金额', width: 90, align: 'right', onCell: () => ({ style: GRAY }), render: (_v, r) => { const c = calc(r); return c.invoiceAmount ? c.invoiceAmount.toFixed(2) : '' } },
              { title: '供应商', width: 160, render: (_v, r, i) => fillable(i, 'supplier', <ShipmentTextCell value={r.supplier} onCommit={value => patchItem(i, 'supplier', value)} />) },
              { title: '采购单日期', width: 160, onCell: r => ({ style: r.sources.length > 1 ? GRAY : undefined }), render: (_v, r, i) => r.sources.length > 1 ? mergedCellValue(i, 'po_date') : fillable(i, 'po_date', <DatePicker size="small" style={{ width: '100%' }} format="YYYY-MM-DD" value={r.po_date ? dayjs(r.po_date) : null} onChange={(v) => patchItem(i, 'po_date', v ? v.format('YYYY-MM-DD') : '')} />) },
              { title: '采购单号', width: 160, onCell: r => ({ style: r.sources.length > 1 ? GRAY : undefined }), render: (_v, r, i) => r.sources.length > 1 ? r.po_no : fillable(i, 'po_no', <ShipmentTextCell value={r.po_no} onCommit={value => patchItem(i, 'po_no', value)} />) },
              { title: '采购单价', width: 120, render: (_v, r, i) => fillable(i, 'price', <ShipmentNumberCell value={r.price} title={r.sources.length > 1 ? '按计费数量加权的采购单价；修改后各来源批次统一采用新单价，备品不收费' : shipmentUsesDeclarationPrice(r) ? '导入单价：按送货重量/申报数量计价' : `原采购单价：按计费数量（${r.purchase_unit || '个'}）计价，备品不收费；导出时换算申报单位单价`} onCommit={v => patchItem(i, 'price', v)} />) },
              { title: '币种', width: 90, render: (_v, r, i) => fillable(i, 'currency', <Select size="small" value={r.currency || '¥'} options={CURR} onChange={(v) => patchItem(i, 'currency', v)} style={{ width: '100%' }} />) },
              { title: '采购金额', width: 90, align: 'right', onCell: () => ({ style: GRAY }), render: (_v, r) => { const c = calc(r); return <span title={`备品不收费；计费数量 ${shipmentChargeQuantity(r).toLocaleString('en-US', { maximumFractionDigits: 6 })}，实际走货数量和重量不变`}>{c.purchaseAmount.toFixed(2)}</span> } },
              { title: '报关出口公司', width: 240, render: (_v, r, i) => fillable(i, 'customs_company',
                <Select size="small" showSearch allowClear style={{ width: '100%' }} placeholder="选择报关出口公司"
                  options={customsOptions} popupMatchSelectWidth={false} value={r.customs_company || undefined}
                  onChange={value => patchItem(i, 'customs_company', value || '')} />) },
              { title: '提单抬头', width: 180, render: (_v, r, i) => fillable(i, 'bl_head', <Select size="small" value={r.bl_head || undefined} options={BL_HEAD_LIST.map(v => ({ value: v, label: v }))} onChange={(v) => patchItem(i, 'bl_head', v)} style={{ width: '100%' }} allowClear />) },
              { title: '箱数', width: 90, onCell: (_, i) => ({ rowSpan: consolidatedCartons[i!]?.span ?? 1 }), render: (_v, r, i) => <div>
                <ShipmentNumberCell integer value={r.cartons} title={r.sources.length > 1 ? '填写实际总箱数；共箱只计一次，独立箱数按批次分配' : undefined} onCommit={v => patchItem(i, 'cartons', v)} />
                {(consolidatedCartons[i]?.span || 0) > 1 && <Tag>同箱合并</Tag>}
              </div> },
              { title: '每箱数量', width: 190, render: (_v, r, i) => fillable(i, 'qty_per_carton', <ShipmentTextCell multiline value={r.qty_per_carton} placeholder={'3000 或 1-2/3000\n3/4000'} title="可填统一数量 3000，或按箱号分段：1-2/3000 3/4000" format={formatShipmentPackingLines} onCommit={value => patchQtyOrPack(i, 'qty_per_carton', value)} style={{ resize: 'none' }} />) },
              { title: '卡板', width: 140, render: (_v, r, i) => fillable(i, 'pallet', <ShipmentTextCell multiline value={r.pallet} placeholder="1-3/4卡 8-9/9卡" title="用空格分隔卡板，显示和导出时自动换行" onCommit={value => patchItem(i, 'pallet', value)} style={{ resize: 'none', overflowWrap: 'anywhere' }} />) },
              { title: '箱号', width: 120, render: (_, r, i) => fillable(i, 'carton_no', <ShipmentTextCell value={r.carton_no} onCommit={value => patchItem(i, 'carton_no', value)} />) },
              { title: '长', width: 90, render: (_v, r, i) => fillableMaterial(i, 'length', <InputNumber size="small" controls={false} min={0} step={0.0001} value={matMap.get(r.material_id!)?.length || null} onChange={(v) => patchMatDim(r.material_id, 'length', v ?? 0)} style={{ width: '100%' }} />) },
              { title: '宽', width: 90, render: (_v, r, i) => fillableMaterial(i, 'width', <InputNumber size="small" controls={false} min={0} step={0.0001} value={matMap.get(r.material_id!)?.width || null} onChange={(v) => patchMatDim(r.material_id, 'width', v ?? 0)} style={{ width: '100%' }} />) },
              { title: '高', width: 90, render: (_v, r, i) => fillableMaterial(i, 'height', <InputNumber size="small" controls={false} min={0} step={0.0001} value={matMap.get(r.material_id!)?.height || null} onChange={(v) => patchMatDim(r.material_id, 'height', v ?? 0)} style={{ width: '100%' }} />) },
              { title: '每箱重量', width: 100, render: (_v, r, i) => fillableMaterial(i, 'weight_per_carton', <InputNumber size="small" controls={false} min={0} step={0.0001} value={matMap.get(r.material_id!)?.weight_per_carton || null} onChange={(v) => patchMatDim(r.material_id, 'weight_per_carton', v ?? 0)} style={{ width: '100%' }} />) },
              { title: '称重数量', width: 100, render: (_v, r, i) => { const m = matMap.get(r.material_id!); return fillable(i, 'weighing_qty', <InputNumber size="small" controls={false} min={0} step={1} value={shipmentOptionalNumber(effectiveWeighingQty(r, m)) ?? null} onChange={(v) => patchItem(i, 'weighing_qty', v ?? 0)} style={{ width: '100%' }} />) } },
              { title: '单个毛重', width: 100, onCell: () => ({ style: GRAY }), render: (_v, r) => { const m = matMap.get(r.material_id!); return <span title="单个毛重 = 每箱重量 ÷ 称重数量">{shipmentGrossPerPc(m?.weight_per_carton, effectiveWeighingQty(r, m)).toFixed(6)}</span> } },
              { title: '单个净重', width: 100, render: (_v, r, i) => fillableMaterial(i, 'net_per_pc', <InputNumber size="small" controls={false} min={0} step={0.000001} value={matMap.get(r.material_id!)?.net_per_pc} onChange={(v) => patchMatDim(r.material_id, 'net_per_pc', v ?? 0)} style={{ width: '100%' }} />) },
              {
                title: '', width: 44, fixed: 'right',
                render: (_v, _r, i) => (
                  <Popconfirm title={consolidatedItems[i]?.sources.length > 1 ? '删除合并行及其全部出库分配？' : '删除该行？'} onConfirm={() => delItem(i)}>
                    <a style={{ color: '#ff4d4f' }}>×</a>
                  </Popconfirm>
                ),
              },
            ]}
          />
        </Card>
        </div>
      </Drawer>

      <Modal open={mergeOpen} title="合并箱数" onCancel={() => setMergeOpen(false)} onOk={mergeCartons}
        okButtonProps={{ disabled: !sharedCartons || !Number.isInteger(sharedCartons) || sharedCartons < 1 }}>
        <Typography.Paragraph>所选明细共用以下箱数，仅计算一次。物料数量、价格、重量等仍各自保留。</Typography.Paragraph>
        <InputNumber min={1} precision={0} value={sharedCartons} onChange={setSharedCartons} addonBefore="合计箱数" />
      </Modal>
      <Modal
        open={schedPickerOpen}
        title={`从排期勾选拉物料（共 ${schedRows.length} 行 · 已选 ${schedPickerSel.length}）`}
        width="80vw"
        onCancel={() => { setSchedPickerOpen(false); setSchedPickerSel([]) }}
        footer={null}
        destroyOnClose
      >
        <Space style={{ marginBottom: 8 }} wrap>
          <Input.Search allowClear placeholder="搜索 货号/品名/TOMY PO/第三客户" style={{ width: 320 }}
            onSearch={setSchedPickerFilter} onChange={(e) => !e.target.value && setSchedPickerFilter('')} />
          <Popconfirm
            title={`按勾选的 ${schedPickerSel.length} 行排期 → 自动拉该货号下所有物料明细`}
            onConfirm={pullFromSchedule}
            disabled={!schedPickerSel.length}
          >
            <Button type="primary" disabled={!schedPickerSel.length}>📥 拉物料到本走货</Button>
          </Popconfirm>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            数量 = 排期 qty × 用量；总重 = 数量 × 净重/件；箱数 = ceil(数量 / 件箱)；自动套最近一张 PO 的供应商/单价
          </Typography.Text>
        </Space>
        <Table
          rowKey={(_, i) => String(i)}
          size="small"
          rowSelection={{ selectedRowKeys: schedPickerSel, onChange: (k) => setSchedPickerSel(k) }}
          dataSource={schedRows
            .map((r, i) => ({ ...r, _i: i }))
            .filter(r => {
              if (!schedPickerFilter) return true
              const s = schedPickerFilter.toLowerCase()
              return ((r.code || '') + (r.productName || '') + (r.orderNo || '') + (r.endCustomer || ''))
                .toLowerCase().includes(s)
            })}
          pagination={{ pageSize: 30 }}
          scroll={{ x: 1200, y: 480 }}
          columns={[
            { title: '来源', dataIndex: 'source', width: 70 },
            { title: '国家', dataIndex: 'country', width: 80 },
            { title: '货号', dataIndex: 'code', width: 100 },
            { title: '品名', dataIndex: 'productName', width: 200, ellipsis: true },
            { title: 'TOMY PO', dataIndex: 'orderNo', width: 130 },
            { title: 'CUST PO', dataIndex: 'customerPO', width: 130 },
            { title: '数量', dataIndex: 'qty', width: 90, align: 'right' },
            { title: '单价USD', dataIndex: 'unitPrice', width: 90, align: 'right', render: (v) => v ? Number(v).toFixed(3) : '' },
            { title: 'PO走货期', dataIndex: 'eta', width: 110 },
          ]}
        />
      </Modal>

      {/* 从出库拉物料 */}
      <Modal open={linkRowKey != null} title="给当前明细关联出库（不新增行）" width="90vw"
        onCancel={closeOutboundLink} onOk={confirmOutboundLink}
        okText="确认物料并关联" cancelText="取消" okButtonProps={{ loading: linkBusy, disabled: !linkSelected || !linkConfirmed || linkBusy }} destroyOnClose>
        {(() => {
          const row = items.find(r => r._rowKey === linkRowKey)
          const m = row ? matMap.get(row.material_id!) : undefined
          const knownId = row?.material_snapshot?.id || (!row?.material_snapshot ? row?.material_id : undefined)
          return <>
            <Typography.Paragraph>当前明细：{m?.product_code || '未填货号'} / {m?.name_zh || '未填物料'} / {m?.spec || '无规格'}；送货数量：{row?.qty ?? 0} {row?.purchase_unit || (isPaperRope(m?.name_zh) ? '米' : '个')}</Typography.Paragraph>
            <Typography.Paragraph type="secondary">请核对对应物料与出库批次；关联按物料 ID，下方名称、规格为采购快照，可能与当前物料库不同。保留本行数量、重量、箱号、箱数、卡板和尺寸；PO、供应商、报关公司及采购价格按出库来源带入。关联不会重复扣库存，点击走货单“保存”后生效。</Typography.Paragraph>
            {row?.material_snapshot && <Typography.Paragraph type="warning">这是导入资料：请先确认下方所选物料与当前行一致。确认后绑定真实物料 ID，导入的装箱资料仍保留在本单，不写回物料库。</Typography.Paragraph>}
            <Input.Search allowClear disabled={linkBusy} value={linkFilter} placeholder="搜索货号 / 名称 / 规格 / PO；可清空搜索查看候选" style={{ width: 480, maxWidth: '100%', marginBottom: 12 }} onChange={e => { setLinkFilter(e.target.value); setLinkSelected(null); setLinkConfirmed(false) }} />
            <Table<OutByMat> size="small" loading={linkBusy} rowKey="outbound_id" scroll={{ x: 1250, y: 350 }} pagination={{ pageSize: 10 }}
              locale={{ emptyText: '暂无符合条件的可分配出库。请核对搜索条件，或先在出库页面完成对应物料的出库。' }}
              dataSource={linkRows.filter(r => (!knownId || knownId < 0 || r.material_id === knownId) &&
                [r.code, r.name_zh, r.spec, r.po_no, String(r.outbound_id)].join(' ').toLowerCase().includes(linkFilter.trim().toLowerCase()))}
              rowSelection={{ type: 'radio', selectedRowKeys: linkSelected ? [linkSelected] : [],
                onChange: keys => { setLinkSelected(Number(keys[0]) || null); setLinkConfirmed(false) },
                getCheckboxProps: r => ({ disabled: linkBusy || !r.material_id || remainingOutboundQuantity(items, linkRowKey!, r) < (row?.qty || 0) }) }}
              columns={[
                { title: '出库记录', dataIndex: 'outbound_id', render: v => `OUT-${v}` },
                { title: '物料 ID', dataIndex: 'material_id' }, { title: '货号', dataIndex: 'code' },
                { title: '采购物料名称', dataIndex: 'name_zh' }, { title: '采购规格', dataIndex: 'spec' },
                { title: 'PO', dataIndex: 'po_no' }, { title: '供应商', dataIndex: 'supplier' },
                { title: '出库日期', dataIndex: 'out_date', render: v => v?.slice(0, 10) },
                { title: '本行可分配', render: (_, r) => remainingOutboundQuantity(items, linkRowKey!, r) },
                { title: '数量单位', dataIndex: 'purchase_unit', render: (v, r) => v || (isPaperRope(r.name_zh) ? '米' : '个') },
                { title: '采购单价', dataIndex: 'price' }, { title: '币种', dataIndex: 'currency' },
              ]} />
            <Typography.Paragraph type="secondary">本行可分配量已扣除其他柜及当前柜其他明细的占用；不足时请先调整或拆分本行数量，不会自动截减。</Typography.Paragraph>
            <Checkbox checked={linkConfirmed} disabled={!linkSelected || linkBusy} onChange={e => setLinkConfirmed(e.target.checked)}>已核对物料、规格、数量单位及 PO，确认是本行对应的出库</Checkbox>
          </>
        })()}
      </Modal>

      <Modal
        open={outOpen}
        title={`从出库精确分配到本柜（共 ${outLoading ? 0 : outCandidates.length} 笔 · 已选 ${selectedOutIds.length}）`}
        width="90vw"
        onCancel={closeOutboundPicker}
        footer={null}
        destroyOnClose
      >
        <Space style={{ marginBottom: 8 }} wrap>
          <Input.Search allowClear placeholder="搜索 货号/物料/PO" style={{ width: 320 }}
            onSearch={setOutFilter} onChange={(e) => !e.target.value && setOutFilter('')} />
          <Button type="primary" loading={outPulling} disabled={!selectedOutIds.length || outLoading} onClick={pullFromOutbound}>📥 拉物料到本走货</Button>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            仅显示尚有剩余的出库，已扣除本柜已拉入的数量（含未保存明细）；全部拉入后自动隐藏，部分拉入只带入剩余量。
          </Typography.Text>
        </Space>
        <Table
          rowKey={(r) => String(r.outbound_id)}
          size="small"
          loading={outLoading || outPulling}
          locale={{ emptyText: '暂无剩余可拉入的出库；已全部分配的记录自动隐藏' }}
          rowSelection={{ selectedRowKeys: selectedOutIds, onChange: (k) => setOutSel(k),
            getCheckboxProps: () => ({ disabled: outLoading || outPulling }) }}
          dataSource={outCandidates.filter(r => {
            if (!outFilter) return true
            const s = outFilter.toLowerCase()
            return ((r.code || '') + (r.name_zh || '') + (r.spec || '') + (r.po_no || '')).toLowerCase().includes(s)
          })}
          pagination={{ pageSize: 30 }}
          scroll={{ x: 1100, y: 480 }}
          columns={[
            { title: '出库记录', dataIndex: 'outbound_id', width: 95, render: (v) => `OUT-${v}` },
            { title: '货号', dataIndex: 'code', width: 120 },
            { title: '物料', dataIndex: 'name_zh', width: 220, ellipsis: true },
            { title: '规格', dataIndex: 'spec', width: 160, ellipsis: true, render: v => v || <Typography.Text type="secondary">—</Typography.Text> },
            { title: '本次出库', dataIndex: 'outbound_qty', width: 110, align: 'right', render: (v) => Number(v ?? 0).toFixed(2) },
            { title: '本柜已拉入', dataIndex: 'allocated_in_editor', width: 120, align: 'right', render: v => Number(v ?? 0).toLocaleString('en-US', { maximumFractionDigits: 4 }) },
            {
              title: '剩余可拉入', dataIndex: 'remaining_qty', width: 120, align: 'right',
              render: (v) => <Typography.Text strong type="success">{Number(v ?? 0).toLocaleString('en-US', { maximumFractionDigits: 4 })}</Typography.Text>,
            },
            { title: 'PO号', dataIndex: 'po_no', width: 180, ellipsis: true },
            { title: '出库日期', dataIndex: 'out_date', width: 120, render: (v) => v ? dayjs(v).format('YYYY-MM-DD') : '' },
          ]}
        />
      </Modal>

      <Modal open={toolOpen} title="从工具库选择" width={1000}
        onCancel={() => setToolOpen(false)} onOk={pullTools} okText="添加到走货明细"
        okButtonProps={{ disabled: toolLoading || !toolSel.length }}>
        <Typography.Paragraph type="secondary">直接带入工具资料、采购单价和币种，不关联采购或出库、不扣库存。请填写本次数量，核实装箱资料和发票单价后导出。</Typography.Paragraph>
        <Input.Search allowClear placeholder="搜索供应商 / 名称 / 规格 / 关联货号" value={toolQuery}
          onChange={e => setToolQuery(e.target.value)} style={{ marginBottom: 12 }} />
        <Table<Material> rowKey={m => m.id!} loading={toolLoading} size="small"
          dataSource={toolRows.filter(m => [m.supplier, m.name_zh, m.spec, m.related_product_code].some(v => (v || '').toLowerCase().includes(toolQuery.trim().toLowerCase())))}
          rowSelection={{ selectedRowKeys: toolSel, onChange: setToolSel, preserveSelectedRowKeys: true,
            getCheckboxProps: m => ({ disabled: items.some(it => it.material_id === m.id) }) }}
          pagination={{ pageSize: 20 }} scroll={{ x: 900, y: 420 }} columns={[
            { title: '供应商', dataIndex: 'supplier' },
            { title: '名称', dataIndex: 'name_zh' },
            { title: '类别', dataIndex: 'tool_kind' },
            { title: '规格', dataIndex: 'spec' },
            { title: '关联货号', dataIndex: 'related_product_code' },
            { title: '单位', dataIndex: 'unit_kg' },
            { title: '采购单价', dataIndex: 'purchase_price' },
            { title: '币种', dataIndex: 'purchase_currency' },
          ]} />
      </Modal>

      {/* 按货号选物料（补充） */}
      <Modal
        open={manOpen}
        title={`按货号选物料（已选 ${manSel.length}）`}
        width="70vw"
        onCancel={() => { setManOpen(false); setManSel([]) }}
        footer={null}
        destroyOnClose
      >
        <Space style={{ marginBottom: 8 }} wrap>
          <span>货号：</span>
          <Select
            showSearch
            value={manCode || undefined}
            placeholder="选择或输入货号"
            style={{ width: 240 }}
            options={productCodes.map(c => ({ value: c, label: c }))}
            onChange={(v) => loadManMats(v)}
            filterOption={(input, opt) => (opt?.value?.toString() ?? '').toLowerCase().includes(input.toLowerCase())}
          />
          <Button type="primary" disabled={!manSel.length || outLoading} loading={outLoading} onClick={pullManual}>📥 添加选中物料</Button>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>有出库记录的物料自动带入出库量，否则数量=0 待填</Typography.Text>
        </Space>
        <Table
          rowKey={(r) => String(r.id)}
          size="small"
          rowSelection={{ selectedRowKeys: manSel, onChange: (k) => setManSel(k) }}
          dataSource={manMats}
          pagination={{ pageSize: 30 }}
          scroll={{ x: 800, y: 460 }}
          columns={[
            { title: '物料ID', dataIndex: 'id', width: 90, align: 'right' },
            { title: '中文名', dataIndex: 'name_zh', width: 200, ellipsis: true },
            { title: '规格', dataIndex: 'spec', width: 160, ellipsis: true },
            { title: '类别', dataIndex: 'category', width: 110 },
            { title: '出库量', width: 100, align: 'right', render: (_v, r) => r.id != null && outByMat.has(r.id) ? Number(outByMat.get(r.id)).toFixed(2) : <span style={{ color: '#bbb' }}>—</span> },
            { title: '供应商', dataIndex: 'supplier', width: 160, ellipsis: true },
          ]}
        />
      </Modal>

      {/* 数据核对报告 */}
      <Modal
        open={valOpen}
        title="数据核对报告"
        width={680}
        onCancel={() => setValOpen(false)}
        footer={<Button onClick={() => setValOpen(false)}>关闭</Button>}
      >
        <div style={{ marginBottom: 10 }}>
          待修正问题：<b style={{ color: '#cf1322' }}>{valReport.hard.length}</b>
          警告：<b style={{ color: '#b8860b' }}>{valReport.warn.length}</b>
          <span style={{ marginLeft: 10 }}>以上问题不阻止导出，正式报关前请核实</span>
        </div>
        {valReport.hard.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ color: '#cf1322', fontWeight: 600, marginBottom: 4 }}>待修正问题（不阻止导出）</div>
            <ul style={{ margin: 0, paddingLeft: 20, color: '#cf1322', maxHeight: 200, overflow: 'auto' }}>
              {valReport.hard.map((s, i) => <li key={i} style={{ fontSize: 13 }}>{s}</li>)}
            </ul>
          </div>
        )}
        {valReport.warn.length > 0 && (
          <div>
            <div style={{ color: '#b8860b', fontWeight: 600, marginBottom: 4 }}>警告（不阻止导出）</div>
            <ul style={{ margin: 0, paddingLeft: 20, color: '#b8860b', maxHeight: 200, overflow: 'auto' }}>
              {valReport.warn.map((s, i) => <li key={i} style={{ fontSize: 13 }}>{s}</li>)}
            </ul>
          </div>
        )}
      </Modal>
    </div>
  )
}
