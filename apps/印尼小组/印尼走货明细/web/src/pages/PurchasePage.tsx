import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  App, Button, Card, Checkbox, Col, DatePicker, Drawer, Form, Input, InputNumber, Modal, Popconfirm,
  Row, Select, Space, Table, Tag, Typography,
} from 'antd'
import dayjs from 'dayjs'
import { api, type Material, type Dictionaries } from '../api/client'
import { purchaseItemCodes, resolvePurchaseCustoms } from '../utils/purchaseCustoms'
import { numToChinese, poCorrectHsyNumber, poLineCurrency, poDetermineEntity, poGenContractNo, PO_ENTITY_META, type PoEntity } from '../utils/poNumber'
import './PurchasePage.css'
import { combinePurchaseContracts, formatPurchaseContractFonts, formatPurchaseContractTotals, roundPurchaseContractAmount, setPurchaseContractLineAmounts } from '../utils/purchaseContractWorkbook'
import PurchaseMaterialPicker from '../components/PurchaseMaterialPicker'
import { purchaseMaterialBucket, purchaseMaterialLine, purchaseSelectionSource, purchaseSelectionSupplier, type PurchaseMaterialChoice } from '../utils/purchaseMaterialSelection'
import { linkPurchaseLine, matchingLineSchedules } from '../utils/purchaseScheduleLink'
import { autoLinkPurchaseMaterials, planPurchaseNetWeight } from '../utils/purchaseNetWeight'
import { purchaseLineDeliveryDate, purchaseLineSourceKey, purchaseOrderNumbers } from '../utils/purchaseOrderMerge'
import { schedulePurchasePlaced, type ScheduleStatusRow } from '../utils/scheduleLineStatus'
import { bulkReceiptLines, receiptQuantityError } from '../utils/purchaseReceipt'

interface SchedRow extends ScheduleStatusRow {
  source?: string
  customer?: string
  country?: string
  endCustomer?: string
  code?: string
  productName?: string
  orderNo?: string
  customerPO?: string
  qty?: number
  cartons?: number
  unitPrice?: number
  eta?: string
}

interface PoSummary {
  id: number
  merge_revision?: number
  merged_po_numbers?: string[]
  po_no?: string
  supplier?: string
  status?: string
  order_date?: string
  delivery_date?: string
  notes?: string
  created_at?: string
  item_count?: number
  total_amount?: number
  received_qty?: number
  spare_qty?: number
  shortage_qty?: number
}

interface PoItem {
  id?: number
  source_po_no?: string | null
  source_delivery_date?: string | null
  source_order_date?: string | null
  delivery_date_override?: string | null
  has_delivery_date_override?: boolean
  product_code?: string
  material_id?: number
  material_name?: string
  qty?: number
  price?: number
  currency?: string
  notes?: string
  category?: string
  spec?: string
  usage_qty?: number
  ordered_qty?: number
  material_qty?: number
  spoilage_qty?: number
  purchase_qty?: number
  purchase_unit?: string
  ship_unit?: string
  net_per_pc?: number
  eta?: string
  tomy_po?: string
  received_qty?: number
  spare_qty?: number
  shortage_qty?: number
}

interface QuoteRow {
  supplier?: string
  productCode?: string
  product_code?: string
  code?: string
  matName?: string
  spec?: string
  minQty?: number
  unitPrice?: number
  currency?: string
  notes?: string
}

interface PoDetail extends PoSummary {
  items?: PoItem[]
}

type SyncField = 'material_name' | 'category' | 'spec' | 'ship_unit' | 'net_per_pc'
const SYNC_FIELDS: { field: SyncField; label: string; materialField: keyof Material }[] = [
  { field: 'material_name', label: '物料名称', materialField: 'name_zh' },
  { field: 'category', label: '类别', materialField: 'category' },
  { field: 'spec', label: '规格', materialField: 'spec' },
  { field: 'ship_unit', label: '走货单位', materialField: 'unit_kg' },
  { field: 'net_per_pc', label: '单件净重', materialField: 'net_per_pc' },
]

interface MaterialChange {
  index: number
  materialId: number
  field: SyncField
  label: string
  before: string | number | undefined
  after: string | number
}

function materialChanges(items: PoItem[], materials: Map<number, Material>): MaterialChange[] {
  return items.flatMap((item, index) => {
    const material = item.material_id == null ? undefined : materials.get(Number(item.material_id))
    if (!material) return []
    return SYNC_FIELDS.flatMap(({ field, label, materialField }) => {
      const after = material[materialField]
      if (after == null || typeof after === 'boolean' || String(item[field] ?? '') === String(after)) return []
      return [{ index, materialId: Number(item.material_id), field, label, before: item[field], after }]
    })
  })
}

function applyMaterialChanges(items: PoItem[], changes: MaterialChange[]): PoItem[] {
  const next = items.map(item => ({ ...item }))
  for (const change of changes) {
    const item = next[change.index]
    // 弹窗打开期间若用户已修改明细，不覆盖新的手工输入。
    if (item?.material_id != null && Number(item.material_id) === change.materialId
      && String(item[change.field] ?? '') === String(change.before ?? '')) {
      (item as any)[change.field] = change.after
    }
  }
  return next
}

interface PurchaseItemRow extends PoItem {
  id: number
  po_id: number
  po_no?: string
  supplier?: string
  status?: string
  order_date?: string
  delivery_date?: string
  po_notes?: string
  receipt_summary?: string
}

interface ReceiptRecord {
  id: number
  po_item_id: number
  receipt_date: string
  qty: number
  spare_qty?: number
  batch_no?: string
  notes?: string
  created_at?: string
}

interface PoForm {
  po_no?: string
  supplier?: string
  status?: string
  order_date?: string
  delivery_date?: string
  notes?: string
}

const STATUS = [
  { value: 'draft',     label: '草稿',  color: 'default' as const },
  { value: 'sent',      label: '已发出', color: 'processing' as const },
  { value: 'received',  label: '已入库', color: 'success' as const },
  { value: 'cancelled', label: '已取消', color: 'error' as const },
]
const CURR = [
  { value: '¥',   label: '¥ 人民币' },
  { value: 'HK$', label: 'HK$ 港币' },
  { value: 'US$', label: 'US$ 美金' },
  { value: 'Rp',  label: 'Rp 印尼盾' },
]

function spoilageRate(category: string | undefined, materialQty: number): number {
  if (['工具', '机器设备', '模具', '设备', '耗材'].includes(category || '')) return 0
  if (!String(category ?? '').includes('五金')) return 0.01
  if (materialQty < 10000) return 0.10
  if (materialQty < 20000) return 0.05
  return 0.04
}

function applyAutoSpoilage(item: PoItem): PoItem {
  const materialQty = Math.max(0, Number(item.material_qty ?? 0) || 0)
  const spoilageQty = Math.round(materialQty * spoilageRate(item.category, materialQty) * 100) / 100
  const purchaseQty = Math.round((materialQty + spoilageQty) * 100) / 100
  return {
    ...item,
    material_qty: materialQty,
    spoilage_qty: spoilageQty,
    purchase_qty: purchaseQty,
    qty: purchaseQty,
  }
}

function patchPoItem(item: PoItem, field: keyof PoItem, value: any): PoItem {
  const next: PoItem = { ...item, [field]: value }
  if (field === 'ordered_qty' || field === 'usage_qty') {
    next.material_qty = (next.ordered_qty ?? 0) * (next.usage_qty ?? 1)
    return applyAutoSpoilage(next)
  }
  if (field === 'category') return applyAutoSpoilage(next)
  if (field === 'spoilage_qty') {
    next.purchase_qty = (next.material_qty ?? 0) + (next.spoilage_qty ?? 0)
    next.qty = next.purchase_qty
  }
  return next
}

function FillablePurchaseCell({ rowIndex, field, onFill, onFillToEnd, children }: {
  rowIndex: number
  field: keyof PoItem
  onFill: (sourceIndex: number, targetIndex: number, field: keyof PoItem) => void
  onFillToEnd: (sourceIndex: number, field: keyof PoItem) => void
  children: ReactNode
}) {
  return (
    <div className="purchase-fillable-cell"
      onDragOver={event => {
        if (event.dataTransfer.types.includes('application/x-purchase-fill')) event.preventDefault()
      }}
      onDrop={event => {
        event.preventDefault()
        try {
          const payload = JSON.parse(event.dataTransfer.getData('application/x-purchase-fill'))
          if (payload.field === field) onFill(Number(payload.rowIndex), rowIndex, field)
        } catch { /* 忽略其它拖动内容 */ }
      }}
    >
      {children}
      <span className="purchase-fill-handle" draggable role="button" aria-label="复制到下面全部行"
        title="点击复制到下面全部行；拖动可复制到指定行"
        onClick={event => { event.preventDefault(); event.stopPropagation(); onFillToEnd(rowIndex, field) }}
        onDragStart={event => {
          event.dataTransfer.effectAllowed = 'copy'
          event.dataTransfer.setData('application/x-purchase-fill', JSON.stringify({ rowIndex, field }))
        }}
      >↓</span>
    </div>
  )
}

function restoreSavedSpoilage(item: PoItem): PoItem {
  const materialQty = Math.max(0, Number(item.material_qty ?? 0) || 0)
  // Existing purchase orders may contain a manually adjusted loss. Only use the
  // category default for legacy rows where loss was never stored.
  const hasSavedSpoilage = item.spoilage_qty !== null && item.spoilage_qty !== undefined
  const spoilageQty = hasSavedSpoilage
    ? Math.max(0, Number(item.spoilage_qty) || 0)
    : Math.round(materialQty * spoilageRate(item.category, materialQty) * 100) / 100
  const hasSavedPurchaseQty = item.purchase_qty !== null && item.purchase_qty !== undefined
  const purchaseQty = hasSavedPurchaseQty
    ? Math.max(0, Number(item.purchase_qty) || 0)
    : Math.round((materialQty + spoilageQty) * 100) / 100
  return {
    ...item,
    material_qty: materialQty,
    spoilage_qty: spoilageQty,
    purchase_qty: purchaseQty,
    qty: purchaseQty,
  }
}

function shipQuantity(item: PoItem): number {
  const purchaseQty = Number(item.purchase_qty ?? item.qty ?? 0) || 0
  const unit = String(item.ship_unit || '').trim().toUpperCase()
  const netKg = purchaseQty * (Number(item.net_per_pc) || 0)
  const qty = unit === 'KGM' || unit === 'KG'
    ? netKg
    : unit === 'TNE' || unit === 'TON'
      ? netKg / 1000
      : purchaseQty
  return Math.round(qty * 1_000_000) / 1_000_000
}

function shipQuantityDigits(unit: string | undefined): number {
  const code = String(unit || '').trim().toUpperCase()
  return code === 'TNE' || code === 'TON' ? 4 : 2
}

function contractUnitLabel(unit: string | undefined): string {
  const code = String(unit ?? '').trim().toUpperCase()
  const labels: Record<string, string> = {
    PCE: '个', PCS: '个', EA: '个',
    KGM: '千克', KG: '千克',
    MTR: '米', M: '米',
    SET: '套',
    PAR: '对', PAIR: '对',
    ROLL: '卷',
    TNE: '吨', TON: '吨',
    CTN: '箱',
  }
  return labels[code] || unit || ''
}

function applyQuotePrices(sourceItems: PoItem[], quotes: QuoteRow[], supplier: string, overwrite: boolean) {
  let hit = 0
  const normalizedSupplier = supplier.trim()
  if (!normalizedSupplier) return { items: sourceItems, hit }
  const normalizeCode = (value: unknown) => String(value ?? '').trim().toUpperCase()
  const normalizeSpec = (value: unknown) => String(value ?? '')
    .trim().toUpperCase().replace(/[×*]/g, 'X').replace(/\s+/g, '')
  const quoteCode = (q: QuoteRow) => normalizeCode(
    q.productCode
    || q.product_code
    || q.code
    || String(q.notes ?? '').match(/(?:^|\/)\s*货号\s*[:：]\s*([^/]+?)\s*$/)?.[1]
    || '')

  const items = sourceItems.map(it => {
    if (!overwrite && Number(it.price) > 0) return it
    const matName = (it.material_name ?? '').trim()
      || ((it.notes ?? '').split('·')[1]?.replace(/\(.*\)/, '').trim() ?? '')
    const nameGroup = quotes.filter(q => {
      const quoteName = (q.matName ?? '').trim()
      return (q.supplier ?? '').trim() === normalizedSupplier
        && !!quoteName
        && (quoteName === matName || (!!matName && matName.includes(quoteName)))
    })
    const purchaseCodes = new Set(String(it.product_code ?? '')
      .split(/\s*\/\s*|[,，;]/)
      .map(normalizeCode)
      .filter(Boolean))
    const codeGroups = [
      nameGroup.filter(q => purchaseCodes.has(quoteCode(q))),
      nameGroup.filter(q => quoteCode(q) === '共用'),
      nameGroup.filter(q => !quoteCode(q)),
    ]
    let sameGroup: QuoteRow[] = []
    for (const codeGroup of codeGroups) {
      if (!codeGroup.length) continue
      const exactGroup = codeGroup.filter(q => normalizeSpec(q.spec) === normalizeSpec(it.spec))
      const quoteSpecs = new Set(codeGroup.map(q => normalizeSpec(q.spec)))
      const matched = exactGroup.length ? exactGroup : (quoteSpecs.size === 1 ? codeGroup : [])
      if (matched.length) { sameGroup = matched; break }
    }
    if (!sameGroup.length) return it
    const qty = it.purchase_qty ?? it.qty ?? 0
    sameGroup.sort((a, b) => (Number(a.minQty) || 0) - (Number(b.minQty) || 0))
    let pick = sameGroup[0]
    for (const q of sameGroup) if ((Number(q.minQty) || 0) <= qty) pick = q
    if (Number(pick.unitPrice) <= 0) return it
    hit++
    return { ...it, price: Number(pick.unitPrice), currency: pick.currency || it.currency }
  })
  return { items, hit }
}

export default function PurchasePage() {
  const { message } = App.useApp()
  const [rows, setRows] = useState<PoSummary[]>([])
  const [itemRows, setItemRows] = useState<PurchaseItemRow[]>([])
  const [filter, setFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [dateRange, setDateRange] = useState<[string, string]>([
    dayjs().subtract(1, 'month').format('YYYY-MM-DD'),
    dayjs().format('YYYY-MM-DD'),
  ])
  const [statsOpen, setStatsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<PoDetail | null>(null)
  const [creating, setCreating] = useState(false)
  const [items, setItems] = useState<PoItem[]>([])
  const [mergeUndo, setMergeUndo] = useState<PoItem[] | null>(null)  // 合并同名前的快照，用于"取消合并"
  const [mergeOpen, setMergeOpen] = useState(false)                  // 合并同名 勾选弹窗
  const [mergeSel, setMergeSel] = useState<React.Key[]>([])          // 勾选参与合并的行(索引)
  const [form] = Form.useForm<PoForm>()
  const deliveryDate = Form.useWatch('delivery_date', form)
  const [applyDeliveryDateAll, setApplyDeliveryDateAll] = useState(false)
  function changeWholeDeliveryDate(value: dayjs.Dayjs | null) {
    const date = value?.format('YYYY-MM-DD') || null
    setApplyDeliveryDateAll(true)
    setItems(current => current.map(it => ({ ...it, has_delivery_date_override: true, delivery_date_override: date })))
  }
  const [drawerFull, setDrawerFull] = useState(false)
  const [schedRows, setSchedRows] = useState<SchedRow[]>([])
  const [productCodes, setProductCodes] = useState<string[]>([])
  const [schedPickerOpen, setSchedPickerOpen] = useState(false)
  const [lineScheduleLink, setLineScheduleLink] = useState<{ index: number; original: PoItem } | null>(null)
  const [lineLinkRows, setLineLinkRows] = useState<SchedRow[]>([])
  const [lineLinkLoading, setLineLinkLoading] = useState(false)
  const [lineLinkSelection, setLineLinkSelection] = useState<number | null>(null)
  const [lineLinkSearch, setLineLinkSearch] = useState('')
  const [lineLinkRevision, setLineLinkRevision] = useState('')
  const [materialSelection, setMaterialSelection] = useState<{
    mode: 'append' | 'generate' | 'separate'; schedules?: SchedRow[]
  } | null>(null)
  const materialGroups = useMemo(() => materialSelection?.schedules?.map((row, index) => ({
    key: String(index), code: row.code || '', quantity: Number(row.qty) || 0,
    label: [row.source, row.orderNo, row.productName].filter(Boolean).join(' · '),
  })), [materialSelection])
  const [schedPickerFilter, setSchedPickerFilter] = useState('')
  const [pickerSelKeys, setPickerSelKeys] = useState<React.Key[]>([])
  const [placedSet, setPlacedSet] = useState<Set<string>>(new Set())  // 自动 PO + 货号匹配
  const [manualPlacedSet, setManualPlacedSet] = useState<Set<string>>(new Set())
  const isSchedulePlaced = useCallback((r: SchedRow) => schedulePurchasePlaced(r, placedSet, manualPlacedSet), [placedSet, manualPlacedSet])
  const [hidePlaced, setHidePlaced] = useState(false)                 // 部分物料下单后仍可补选剩余物料
  const [receiptItem, setReceiptItem] = useState<PurchaseItemRow | null>(null)
  const [receiptRows, setReceiptRows] = useState<ReceiptRecord[]>([])
  const [receiptLoading, setReceiptLoading] = useState(false)
  const [receiptForm] = Form.useForm()
  const [bulkReceiptPo, setBulkReceiptPo] = useState<PoSummary | null>(null)
  const [bulkReceiptQty, setBulkReceiptQty] = useState<Record<number, number>>({})
  const [bulkReceiptSpareQty, setBulkReceiptSpareQty] = useState<Record<number, number>>({})
  const [bulkReceiptDate, setBulkReceiptDate] = useState(dayjs())
  const [bulkReceiptBatch, setBulkReceiptBatch] = useState('')
  const [bulkReceiptNotes, setBulkReceiptNotes] = useState('')

  async function load() {
    setLoading(true)
    try {
      const [{ data }, { data: detailRows }] = await Promise.all([
        api.get<PoSummary[]>('/purchase'),
        api.get<PurchaseItemRow[]>('/purchase/items'),
      ])
      setRows(Array.isArray(data) ? data : [])
      setItemRows(Array.isArray(detailRows) ? detailRows : [])
    } finally { setLoading(false) }
  }

  async function loadReceipts(itemId: number) {
    setReceiptLoading(true)
    try {
      const { data } = await api.get<ReceiptRecord[]>(`/purchase/items/${itemId}/receipts`)
      setReceiptRows(Array.isArray(data) ? data : [])
    } finally { setReceiptLoading(false) }
  }

  async function openReceipt(item: PurchaseItemRow) {
    setReceiptItem(item)
    receiptForm.resetFields()
    receiptForm.setFieldsValue({
      receipt_date: dayjs(),
      qty: Number(item.shortage_qty ?? 0),
      spare_qty: 0,
      batch_no: '',
      notes: '',
    })
    await loadReceipts(item.id)
  }

  async function saveReceipt() {
    if (!receiptItem) return
    const values = await receiptForm.validateFields()
    const nextShortage = Math.max(
      Number(receiptItem.shortage_qty ?? 0) - Number(values.qty ?? 0),
      0,
    )
    const nextReceived = Number(receiptItem.received_qty ?? 0) + Number(values.qty ?? 0)
    const nextSpare = Number(receiptItem.spare_qty ?? 0) + Number(values.spare_qty ?? 0)
    await api.post(`/purchase/items/${receiptItem.id}/receipts`, {
      receipt_date: values.receipt_date?.format('YYYY-MM-DD'),
      qty: values.qty,
      spare_qty: values.spare_qty,
      batch_no: values.batch_no,
      notes: values.notes,
    })
    message.success('本批入库已登记，欠数已自动更新')
    await load()
    await loadReceipts(receiptItem.id)
    setReceiptItem({ ...receiptItem, received_qty: nextReceived, spare_qty: nextSpare, shortage_qty: nextShortage })
    receiptForm.setFieldsValue({ qty: nextShortage, spare_qty: 0, batch_no: '', notes: '' })
  }

  async function deleteReceipt(receiptId: number) {
    if (!receiptItem) return
    const deletedQty = Number(receiptRows.find(x => x.id === receiptId)?.qty ?? 0)
    const deletedSpareQty = Number(receiptRows.find(x => x.id === receiptId)?.spare_qty ?? 0)
    await api.delete(`/purchase/receipts/${receiptId}`)
    message.success('入库记录已删除，欠数已重新计算')
    setReceiptItem({
      ...receiptItem,
      received_qty: Math.max(Number(receiptItem.received_qty ?? 0) - deletedQty, 0),
      spare_qty: Math.max(Number(receiptItem.spare_qty ?? 0) - deletedSpareQty, 0),
      shortage_qty: Number(receiptItem.shortage_qty ?? 0) + deletedQty,
    })
    await Promise.all([load(), loadReceipts(receiptItem.id)])
  }

  function openBulkReceipt(po: PoSummary) {
    const poItems = itemRows.filter(x => x.po_id === po.id)
    setBulkReceiptPo(po)
    setBulkReceiptQty(Object.fromEntries(poItems.map(x => [x.id, 0])))
    setBulkReceiptSpareQty(Object.fromEntries(poItems.map(x => [x.id, 0])))
    setBulkReceiptDate(dayjs())
    setBulkReceiptBatch('')
    setBulkReceiptNotes('')
  }

  async function saveBulkReceipt() {
    if (!bulkReceiptPo) return
    let items
    try {
      items = bulkReceiptLines(itemsByPo.get(bulkReceiptPo.id) || [], bulkReceiptQty, bulkReceiptSpareQty)
    } catch (error) { message.warning((error as Error).message); return }
    if (!items.length) { message.warning('请至少填写一项本批入库数量或备品入数'); return }
    await api.post(`/purchase/${bulkReceiptPo.id}/receipts/bulk`, {
      receipt_date: bulkReceiptDate.format('YYYY-MM-DD'),
      batch_no: bulkReceiptBatch,
      notes: bulkReceiptNotes,
      items,
    })
    message.success(`采购单 ${bulkReceiptPo.po_no || ''} 已统一入库 ${items.length} 项`)
    setBulkReceiptPo(null)
    await load()
  }
  async function loadProductCodes() {
    try {
      const { data } = await api.get<{ code?: string }[]>('/products', { params: { includeInactive: true } })
      setProductCodes((data || []).map(p => p.code || '').filter(Boolean))
    } catch {}
  }
  // 把带客户后缀的排期货号(如 47669TSCA)解析到货号库的基础货号(47669)
  const resolveProductCode = useCallback((code?: string): string => {
    const c = (code || '').trim()
    if (!c || productCodes.includes(c)) return c
    const noTail = c.replace(/[A-Za-z]+$/, '')
    if (noTail && productCodes.includes(noTail)) return noTail
    const digits = (c.match(/^\d+/) || [])[0]
    if (digits && productCodes.includes(digits)) return digits
    const pre = productCodes.find(k => k && c.startsWith(k))
    return pre || c
  }, [productCodes])
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
  async function loadPlaced() {
    const set = new Set<string>()
    try {
      const { data } = await api.get<{ tomy_po?: string; product_code?: string }[]>('/purchase/placed-keys')
      for (const x of data) {
        const pos = String(x.tomy_po || '').split(/\s*[;；]\s*/).map(s => s.trim()).filter(Boolean)
        const codes = String(x.product_code || '').split(/\s*\/\s*/).map(s => s.trim()).filter(Boolean)
        for (const po of pos) for (const c of codes) set.add(`${po}|${c}`)
      }
    } catch {}
    setPlacedSet(set)
    try {
      const { data } = await api.get<string[]>('/schedules/placed-manual')
      setManualPlacedSet(new Set(Array.isArray(data) ? data : []))
    } catch {}
  }
  useEffect(() => { load(); loadLatestSchedule(); loadProductCodes(); loadPlaced() }, [])

  function pickFromSchedule(r: SchedRow) {
    setMaterialSelection({ mode: 'append', schedules: [r] })
  }

  async function openLineScheduleLink(index: number) {
    const original = items[index]
    if (!original?.product_code?.trim()) { message.warning('请先填写该行货号'); return }
    if (original.product_code.includes('/')) { message.warning('多货号合并行请先拆分，再分别关联排期'); return }
    setLineScheduleLink({ index, original }); setLineLinkSelection(null); setLineLinkSearch('')
    setLineLinkRows([]); setLineLinkRevision(''); setLineLinkLoading(true)
    try {
      const { data: list } = await api.get<{ id: number; week_label?: string }[]>('/schedules')
      if (!list.length) { message.info('暂无排期可关联'); return }
      const { data } = await api.get<{ raw_rows?: string | SchedRow[] }>(`/schedules/${list[0].id}`)
      const parsed = typeof data.raw_rows === 'string' ? JSON.parse(data.raw_rows) : data.raw_rows
      if (!Array.isArray(parsed)) throw new Error('排期数据格式无效')
      setLineLinkRows(parsed); setLineLinkRevision(list[0].week_label || String(list[0].id))
    } catch { message.error('排期加载失败，请关闭后重试'); }
    finally { setLineLinkLoading(false) }
  }

  function applyLineScheduleLink() {
    if (!lineScheduleLink || lineLinkSelection == null) return
    const { index, original } = lineScheduleLink
    if (items[index] !== original) { message.warning('明细已变化，请重新打开关联排期'); return }
    try {
      const linked = linkPurchaseLine(original, lineLinkRows[lineLinkSelection], lineLinkRows, items, String(form.getFieldValue('po_no') || ''))
      setItems(current => current.map((item, i) => i === index ? linked : item))
      setMergeUndo(null); setLineScheduleLink(null)
      message.success('已关联排期并带入走货期，数量和单价未改变；请保存采购单')
    } catch (error) { message.warning((error as Error).message) }
  }

  function selectedSchedRows(): SchedRow[] {
    return pickerSelKeys.map(k => schedRows[Number(k)]).filter(Boolean)
  }

  function mergeIntoCurrentPo() {
    const picks = selectedSchedRows()
    if (!picks.length) { message.warning('请先勾选排期行'); return }
    setMaterialSelection({ mode: 'append', schedules: picks })
  }

  async function confirmMaterials(choices: PurchaseMaterialChoice[]): Promise<boolean> {
    if (!materialSelection) return false
    if (materialSelection.mode !== 'append') return generateBySupplier(choices)
    const currentSupplier = String(form.getFieldValue('supplier') || '').trim()
    let supplier: string
    try {
      supplier = purchaseSelectionSupplier(choices, currentSupplier)
      const existingSources = items.flatMap(item => String(item.tomy_po || '').split(/\s*[;；]\s*/).filter(Boolean).flatMap(orderNo => {
        const codes = String(item.product_code || '').split(/\s*\/\s*/).filter(Boolean)
        const matches = schedRows.filter(row => row.orderNo?.trim() === orderNo.trim()
          && codes.some(code => resolveProductCode(row.code) === resolveProductCode(code)))
        return matches.length ? matches.map(row => row.source?.trim() || 'RRI') : [undefined]
      }))
      purchaseSelectionSource(choices, Object.fromEntries((materialSelection.schedules || []).map((row, i) => [String(i), row.source])), String(form.getFieldValue('po_no') || ''), existingSources)
    }
    catch (error) { message.warning((error as Error).message); return false }
    const first = choices[0]
    const source = first.groupKey == null ? undefined : materialSelection.schedules?.[Number(first.groupKey)]?.source
    const currency = poLineCurrency(String(form.getFieldValue('po_no') || ''), supplier, first.material.customs_company, source)
    const added = choices.map(choice => {
      const schedule = choice.groupKey == null ? undefined : materialSelection.schedules?.[Number(choice.groupKey)]
      return applyAutoSpoilage({ ...purchaseMaterialLine(choice, currency),
        tomy_po: schedule?.orderNo, eta: schedule?.eta || '',
        notes: schedule?.customerPO ? 'CUST PO ' + schedule.customerPO : '' })
    })
    setItems(current => [...current, ...added])
    setMergeUndo(null)
    if (!currentSupplier && supplier) form.setFieldValue('supplier', supplier)
    setSchedPickerOpen(false); setPickerSelKeys([])
    message.success(`已加入 ${added.length} 条所选物料，请保存采购单`)
    return true
  }

  // 旧系统逻辑：每批 PO 由用户输入一次「下单车间代号」(HS/HD/HB/HK)，整批共用作编号厂房码
  function askWcode(): string | null {
    const last = (localStorage.getItem('po_wcode') || '').toUpperCase()
    const w = window.prompt('本批 PO 的下单车间代号（用于编号，如 HS=兴信 / HD=华登 / HB=华登B / HK=华康）：', last)
    if (w === null) return null
    const v = w.trim().toUpperCase()
    if (!v) { message.warning('车间代号不能为空'); return null }
    localStorage.setItem('po_wcode', v)
    return v
  }

  function confirmBatchOrder(suppliers: string[], orderCount: number, materialCount: number): Promise<string | null> {
    let wcode = (localStorage.getItem('po_wcode') || '').toUpperCase()
    return new Promise(resolve => {
      Modal.confirm({
        title: `确认批量下单：${orderCount} 张草稿采购单`,
        content: <Space direction="vertical" style={{ width: '100%' }}>
          <div>已选 {materialCount} 条物料，{suppliers.length} 家供应商：{suppliers.join('、')}。未勾选的物料不会下单。</div>
          <div>下单车间代号（HS=兴信 / HD=华登 / HB=华登B / HK=华康）</div>
          <Input aria-label="批量下单车间代号" defaultValue={wcode} onChange={e => { wcode = e.target.value }} />
        </Space>,
        okText: '确认生成', cancelText: '返回勾选',
        onOk: () => {
          const value = wcode.trim().toUpperCase()
          if (!value) { message.warning('车间代号不能为空'); return Promise.reject(new Error('车间代号不能为空')) }
          localStorage.setItem('po_wcode', value)
          resolve(value)
        },
        onCancel: () => resolve(null),
      })
    })
  }

  // 按物料供应商聚合：选 N 条排期 → 拉每个货号的物料 → 按 supplier 分桶 → 每个供应商一张 PO
  async function generateBySupplier(choices: PurchaseMaterialChoice[]): Promise<boolean> {
    if (choices.some(c => !c.material.supplier?.trim())) {
      message.warning('所选物料存在未填写供应商的记录，请先在货号库补齐。')
      return false
    }
    const orderDate = dayjs().format('YYYY-MM-DD')
    // bucket: 来源分区 + supplierName。RRI/RRM 不可因供应商相同而合并到同一张 PO。
    const buckets = new Map<string, { sched: SchedRow; mat: any }[]>()
    const codeCount = new Set(choices.map(c => c.productCode)).size
    let matCount = 0
    for (const choice of choices) {
      const savedSchedule = materialSelection?.schedules?.[Number(choice.groupKey)]
      {
          const sr: SchedRow = { ...savedSchedule, code: choice.productCode, qty: choice.quantity }
          const m = choice.material
          const sup = (m.supplier || '').trim() || '(无供应商)'
          if (m.active === false) continue
          matCount++
          const bucketKey = purchaseMaterialBucket(sr.source, sup, materialSelection?.mode === 'separate' ? choice.groupKey : undefined)
          if (!buckets.has(bucketKey)) buckets.set(bucketKey, [])
          buckets.get(bucketKey)!.push({ sched: sr, mat: m })
      }
    }
    if (!buckets.size) {
      message.warning('选中的排期对应的货号下没有物料，请先在货号库录入物料')
      return false
    }
    const wcode = await confirmBatchOrder([...new Set(choices.map(c => c.material.supplier!.trim()))], buckets.size, matCount)
    if (wcode === null) return false
    let autoQuotes: QuoteRow[] = []
    try {
      const { data } = await api.get<QuoteRow[]>('/quotes/blob', { skipErrorToast: true } as any)
      autoQuotes = Array.isArray(data) ? data : []
    } catch {
      // 报价读取失败不阻断采购单生成，生成后仍可手工套用。
    }
    let ok = 0, fail = 0, suppliers = 0, quoteHits = 0
    const existingNos = purchaseOrderNumbers(rows)
    for (const [bucketKey, lines] of buckets) {
      const supplier = bucketKey.split('\u0000', 2)[1]
      // 推断实体：用第一条物料的报关公司
      const customsCompany = lines[0]?.mat?.customs_company || ''
      const entity = poDetermineEntity(supplier, customsCompany, lines[0]?.sched?.source)
      const po_no = poGenContractNo(existingNos, entity, wcode)
      existingNos.push(po_no)
      // 与旧系统一致：生成时按 货号 + 物料名 + 规格 合并（合并同货号重复行、累加数量、合并订单号），
      // 不跨货号自动合并；跨货号合并由「🔀 合并同名」手动按钮完成。
      const merged = new Map<string, any>()
      for (const { sched, mat } of lines) {
        const k = `${sched.code ?? ''}|${(mat.name_zh ?? '').trim()}|${(mat.spec ?? '').trim()}`
        const usage = mat.usage_qty == null ? 1 : Math.max(0, Number(mat.usage_qty) || 0)
        const orderedQty = sched.qty ?? 0
        const matQty = orderedQty * usage
        const cur = merged.get(k)
        if (cur) {
          cur.ordered_qty += orderedQty
          cur.material_qty += matQty
          cur.qty = cur.material_qty + (cur.spoilage_qty ?? 0)
          cur.purchase_qty = cur.qty
          if (sched.eta && (!cur.eta || sched.eta < cur.eta)) cur.eta = sched.eta
          cur._pos.add(sched.orderNo ?? '')
        } else {
          merged.set(k, {
            product_code: sched.code,
            material_id: mat.id,
            material_name: mat.name_zh ?? '',
            qty: matQty,
            price: 0,
            currency: entity === 'HSY' ? '¥' : 'US$',   // 除华胜益(RMB)外默认美金
            category: mat.category ?? '',
            spec: mat.spec ?? '',
            usage_qty: usage,
            ordered_qty: orderedQty,
            material_qty: matQty,
            spoilage_qty: 0,
            purchase_qty: matQty,
            purchase_unit: '个',
            ship_unit: mat.unit_kg || 'PCE',
            net_per_pc: Number(mat.net_per_pc) || 0,
            eta: sched.eta ?? '',
            _name: mat.name_zh ?? '',
            _spec: mat.spec ?? '',
            _productName: sched.productName ?? '',
            _pos: new Set<string>([sched.orderNo ?? '']),
          })
        }
      }
      const items = [...merged.values()].map(it => applyAutoSpoilage({
        product_code: it.product_code,
        material_id: it.material_id,
        material_name: it.material_name,
        qty: it.qty,
        price: it.price,
        currency: it.currency,
        category: it.category,
        spec: it.spec,
        usage_qty: it.usage_qty,
        ordered_qty: it.ordered_qty,
        material_qty: it.material_qty,
        spoilage_qty: it.spoilage_qty,
        purchase_qty: it.purchase_qty,
        purchase_unit: it.purchase_unit,
        ship_unit: it.ship_unit,
        net_per_pc: it.net_per_pc,
        eta: it.eta,
        tomy_po: [...(it._pos as Set<string>)].filter(Boolean).join('; '),
        notes: '',
      }))
      const priced = applyQuotePrices(items, autoQuotes, supplier, false)
      quoteHits += priced.hit
      try {
        await api.post('/purchase', {
          po_no, supplier,
          status: 'draft',
          order_date: orderDate,
          notes: `${materialSelection?.schedules?.length ? '从排期生成' : '从物料库生成'} · 货号: ${[...new Set(lines.map(l => l.sched.code))].join(', ')}`,
          items: priced.items,
        }, { skipErrorToast: true } as any)
        ok++; suppliers++
      } catch { fail++ }
    }
    setSchedPickerOpen(false); setPickerSelKeys([])
    // 从当前采购单打开批量下单时，另建采购单但保留当前未保存的编辑内容。
    if (materialSelection?.mode !== 'append') {
      setEditing(null); setCreating(false); setDrawerFull(false)
    }
    const resultText = `已生成 ${ok} 张 PO（${suppliers} 个供应商 · 总 ${matCount} 行物料 · ${codeCount} 个货号）${quoteHits ? ` · 自动导入报价 ${quoteHits} 行` : ''}${fail ? ` · 失败 ${fail}` : ''}`
    if (fail) message.warning({ key: 'generate-po-result', content: resultText })
    else message.success({ key: 'generate-po-result', content: resultText })
    load()
    return true
  }

  function createSeparatePos() {
    const picks = selectedSchedRows()
    if (!picks.length) { message.warning('请先勾选排期行'); return }
    setMaterialSelection({ mode: 'separate', schedules: picks })
  }

  function openCreate() {
    setApplyDeliveryDateAll(false)
    setCreating(true); setEditing({ id: 0, status: 'draft' }); setItems([]); setMergeUndo(null)
    form.resetFields()
    setTimeout(() => form.setFieldsValue({ status: 'draft', order_date: dayjs().format('YYYY-MM-DD') }), 0)
  }
  async function loadPurchaseMaterials(poItems: PoItem[]) {
    const ids = [...new Set(poItems.map(it => it.material_id).filter(id => id != null))]
    if (!ids.length) return new Map<number, Material>()
    const { data } = await api.get<Material[]>('/materials/by-ids', { params: { ids: ids.join(',') } })
    return new Map(data.filter(m => m.id != null).map(m => [Number(m.id), m]))
  }
  async function loadPurchaseMaterialCandidates(poItems: PoItem[]) {
    const linked = await loadPurchaseMaterials(poItems)
    const codes = [...new Set(poItems.filter(it => !linked.has(Number(it.material_id)))
      .flatMap(it => purchaseItemCodes(it.product_code)))]
    const fallback = (await Promise.all(codes.map(code =>
      api.get<Material[]>('/materials', { params: { code } }).then(r => r.data)))).flat()
    const profiles = codes.length ? (await api.get<Dictionaries>('/dictionaries')).data.suppliers || [] : []
    return { materials: [...linked.values(), ...fallback], profiles }
  }
  function promptMaterialSync(poItems: PoItem[], materials: Map<number, Material>) {
    const changes = materialChanges(poItems, materials)
    if (!changes.length) { message.info('已与货号库一致，没有需要同步的资料'); return }
    const affected = new Set(changes.map(change => change.index)).size
    Modal.confirm({
      title: `货号库有更新：${affected} 行、${changes.length} 项差异`,
      width: 760,
      okText: '同步这些资料',
      cancelText: '保持采购单原值',
      content: <>
        <p>只同步名称、类别、规格、走货单位及单件净重；用量、订单量、单价、金额、损耗与入库记录均保持原值。确认后仍需点击“保存”才会写入采购单。</p>
        <div style={{ maxHeight: 320, overflow: 'auto' }}>
          {changes.map((change, i) => <div key={i} style={{ padding: '4px 0', borderBottom: '1px solid #eee' }}>
            第 {change.index + 1} 行 · {change.label}：{change.before == null || change.before === '' ? '空' : String(change.before)} → {change.after === '' ? '空' : String(change.after)}
          </div>)}
        </div>
      </>,
      onOk: () => {
        setItems(current => applyMaterialChanges(current, changes))
        message.success('已在当前采购单中更新资料，请点击保存以生效')
      },
    })
  }
  async function checkMaterialSync() {
    try {
      const materials = await loadPurchaseMaterials(items)
      if (!materials.size && items.some(item => item.material_id != null)) {
        message.warning('未找到关联的货号库物料，请核对货号及物料关联')
        return
      }
      promptMaterialSync(items, materials)
    } catch (e: any) {
      message.error('检查货号库失败：' + (e?.message ?? e))
    }
  }
  async function correctHsyNumber() {
    if (!editing?.id || creating) return
    const id = editing.id
    const readPlan = async () => {
      const [{ data: detail }, { data: all }, { data: dictionaries }] = await Promise.all([
        api.get<PoDetail>(`/purchase/${id}`), api.get<PoSummary[]>('/purchase'),
        api.get<Dictionaries>('/dictionaries'),
      ])
      const savedItems = detail.items || []
      const linked = await loadPurchaseMaterials(savedItems)
      const fallbackCodes = [...new Set(savedItems.flatMap(item =>
        item.material_id == null || !linked.has(Number(item.material_id)) || purchaseItemCodes(item.product_code).length > 1
          ? purchaseItemCodes(item.product_code) : [],
      ))]
      const fallbackMaterials = (await Promise.all(fallbackCodes.map(code =>
        api.get<Material[]>('/materials', { params: { code } }).then(r => r.data),
      ))).flat()
      const materials = [...new Map([...linked.values(), ...fallbackMaterials].map(m => [m.id, m])).values()]
      const evidence = resolvePurchaseCustoms(savedItems, detail.supplier || '', materials, dictionaries.suppliers || [])
      const oldNo = detail.po_no || ''
      const newNo = poCorrectHsyNumber(oldNo, evidence.map(row => row.company), purchaseOrderNumbers(all))
      return { oldNo, newNo, evidence }
    }
    try {
      const plan = await readPlan()
      if (plan.oldNo === plan.newNo) { message.info('当前已是华胜益编号，无需修改'); return }
      Modal.confirm({
        title: '修正当前采购单为华胜益编号',
        okText: '确认修改编号', cancelText: '取消',
        content: <>
          <p>{plan.oldNo} → {plan.newNo}</p>
          <div style={{ maxHeight: 180, overflow: 'auto' }}>{plan.evidence.map((row, i) => <p key={i}>{row.source}：{row.company}</p>)}</div>
          <p>按已保存明细核对，仅修改这张采购单编号。供应商、物料、金额、入库记录及基础资料不变；当前其他未保存编辑不会写入。</p>
          <p>合同将按新编号使用华胜益主体。现有币种和单价不自动换算，请核对报价后再导出。</p>
        </>,
        onOk: async () => {
          try {
            const latest = await readPlan()
            if (latest.oldNo !== plan.oldNo || latest.newNo !== plan.newNo
              || JSON.stringify(latest.evidence) !== JSON.stringify(plan.evidence)) {
              throw new Error('订单、报关资料或可用编号已变化，请取消后重新检查')
            }
            await api.patch(`/purchase/${id}`, { po_no: plan.newNo })
            form.setFieldsValue({ po_no: plan.newNo })
            setEditing(current => current?.id === id ? { ...current, po_no: plan.newNo } : current)
            message.success(`编号已修改：${plan.newNo}`)
            load()
          } catch (e: any) {
            message.error(e?.message || '编号修改失败')
            throw e
          }
        },
      })
    } catch (e: any) {
      message.error(e?.message || '无法检查采购单编号')
    }
  }
  async function openEdit(p: PoSummary) {
    setApplyDeliveryDateAll(false)
    setCreating(false); setEditing(p)
    form.resetFields()
    setItems([]); setMergeUndo(null)
    try {
      const { data } = await api.get<PoDetail>(`/purchase/${p.id}`)
      setEditing(data)
      form.setFieldsValue({
        po_no: data.po_no, supplier: data.supplier, status: data.status,
        order_date: data.order_date ? dayjs(data.order_date).format('YYYY-MM-DD') : '',
        delivery_date: data.delivery_date ? dayjs(data.delivery_date).format('YYYY-MM-DD') : '',
        notes: data.notes,
      })
      let rawItems = Array.isArray(data.items) ? data.items : []
      // 货号库无法读取时仍可打开采购单，保留已经保存的订单原值。
      let materials = new Map<number, Material>()
      try {
        const candidates = await loadPurchaseMaterialCandidates(rawItems)
        const associated = autoLinkPurchaseMaterials(rawItems, candidates.materials, data.supplier || '', candidates.profiles)
        rawItems = associated.items
        materials = new Map(candidates.materials.map(m => [Number(m.id), m]))
        if (associated.linked) message.info(`已自动补齐 ${associated.linked} 行物料关联，请保存采购单`)
        if (associated.issues.length) message.warning('部分物料暂未关联，可点击“回填净重”查看逐行原因')
      } catch { message.warning('货号库暂时无法读取，保留采购单原值；请稍后重试关联') }
      const openedItems = rawItems.map(it => {
        const mat = it.material_id == null ? undefined : materials.get(Number(it.material_id))
        const wasLegacyUnitLayout = !it.ship_unit && !!mat?.unit_kg && it.purchase_unit === mat.unit_kg
        const schedule = schedRows.find(s =>
          String(it.product_code || '').split(/\s*\/\s*/).includes(String(s.code || ''))
          && (!it.tomy_po || String(it.tomy_po).split(/\s*[;，]\s*/).includes(String(s.orderNo || '')))
        )
        return restoreSavedSpoilage({
          ...it,
          purchase_unit: wasLegacyUnitLayout ? '个' : (it.purchase_unit || '个'),
          ship_unit: it.ship_unit || 'PCE',
          net_per_pc: Number(it.net_per_pc) || 0,
          eta: it.eta || schedule?.eta || '',
        })
      })
      setItems(openedItems)
      if (materials.size && materialChanges(openedItems, materials).length) promptMaterialSync(openedItems, materials)
    } catch (e: any) {
      message.error('加载详情失败: ' + (e?.message ?? e))
    }
  }
  async function save() {
    const v = await form.validateFields()
    if (!v.po_no) { message.warning('PO 号必填'); return }
    const normalizeDate = (value: unknown) => {
      if (!value) return null
      const parsed = dayjs(value as any)
      return parsed.isValid() ? parsed.format('YYYY-MM-DD') : null
    }
    let saveItems = items
    let quoteHits = 0
    try {
      const candidates = await loadPurchaseMaterialCandidates(saveItems)
      const associated = autoLinkPurchaseMaterials(saveItems, candidates.materials, v.supplier || '', candidates.profiles)
      saveItems = associated.items
      if (associated.linked) {
        setItems(saveItems)
        message.info(`已自动补齐 ${associated.linked} 行物料关联，数量、单价和基础资料未改动`)
      }
      if (associated.issues.length) message.warning('部分行无法唯一关联，已保留原值；请点击“回填净重”核对')
    } catch (error: any) {
      if (error?.response?.status === 403) {
        message.warning('没有货号库访问权限，本次保留现有物料关联；数量、单价及资料未改动')
      } else {
        message.error('物料关联检查失败，尚未保存，请稍后重试'); return
      }
    }
    // 已下单采购单的既有单价不因本次同步/保存被最新报价悄悄覆盖。
    if (creating && v.supplier) {
      try {
        const { data: quotes } = await api.get<QuoteRow[]>('/quotes/blob', { skipErrorToast: true } as any)
        const priced = applyQuotePrices(saveItems, Array.isArray(quotes) ? quotes : [], v.supplier, false)
        saveItems = priced.items
        quoteHits = priced.hit
        if (quoteHits) setItems(saveItems)
      } catch {
        // 报价不可用时仍允许保存采购单，避免影响下单。
      }
    }
    const payload = {
      ...v,
      merge_revision: editing?.merge_revision ?? 0,
      apply_delivery_date_all: applyDeliveryDateAll,
      order_date: normalizeDate(v.order_date),
      delivery_date: normalizeDate(v.delivery_date),
      items: saveItems,
    }
    try {
      if (creating) {
        const { data } = await api.post<{ id?: number }>('/purchase', payload)
        message.success(`已新建${quoteHits ? `，自动导入报价 ${quoteHits} 行` : ''}`)
        // 切到编辑态，留在当前页（后续保存走更新）
        setCreating(false)
        setEditing({ ...(editing as any), id: data?.id ?? editing?.id, po_no: v.po_no, supplier: v.supplier, status: v.status })
      } else if (editing) {
        await api.put(`/purchase/${editing.id}`, payload)
        message.success(`已更新${quoteHits ? `，自动导入报价 ${quoteHits} 行` : ''}`)
      }
      setApplyDeliveryDateAll(false)
      load()  // 后台刷新列表，不关闭抽屉
    } catch {
      /* 拦截器已提示 */
    }
  }
  const [poSelKeys, setPoSelKeys] = useState<React.Key[]>([])
  const [mergeOrdersOpen, setMergeOrdersOpen] = useState(false)
  const [mergeTarget, setMergeTarget] = useState<number>()
  const [mergingOrders, setMergingOrders] = useState(false)
  const selectedOrders = rows.filter(po => poSelKeys.includes(po.id))
  function openOrderMerge() {
    if (selectedOrders.length < 2) { message.warning('请至少勾选两张采购单'); return }
    if (selectedOrders.some(po => po.status !== 'draft')) { message.warning('仅支持合并草稿采购单'); return }
    const first = selectedOrders[0]
    if (!first.supplier?.trim() || selectedOrders.some(po => po.supplier?.trim() !== first.supplier?.trim())) {
      message.warning('请选择同一供应商的采购单'); return
    }
    if (selectedOrders.some(po => !po.order_date)) {
      message.warning('请先补齐采购单的下单日期'); return
    }
    setMergeTarget(first.id)
    setMergeOrdersOpen(true)
  }
  async function mergeOrders() {
    if (!mergeTarget || mergingOrders) return
    setMergingOrders(true)
    try {
      const { data } = await api.post<{ id: number; po_no: string; item_count: number }>('/purchase/merge', {
        target_id: mergeTarget, ids: selectedOrders.map(po => po.id),
      })
      setMergeOrdersOpen(false); setPoSelKeys([])
      message.success(`已合并到 ${data.po_no}，保留 ${data.item_count} 条明细`)
      await load()
    } catch { /* 后端校验失败时保留勾选，不修改单据 */ }
    finally { setMergingOrders(false) }
  }
  async function delSelected() {
    if (!poSelKeys.length) return
    setLoading(true)
    const fails: string[] = []
    let ok = 0
    for (const k of poSelKeys) {
      try { await api.delete(`/purchase/${k}`); ok++ }
      catch (e: any) { fails.push(`#${k}: ${e?.response?.data?.error ?? e?.message ?? '失败'}`) }
    }
    setLoading(false); setPoSelKeys([])
    if (fails.length) Modal.warning({ title: `成功 ${ok} 条，失败 ${fails.length} 条`, content: fails.join('\n') })
    else message.success(`已删除 ${ok} 条`)
    load()
  }

  async function wipeAll() {
    setLoading(true)
    let ok = 0, fail = 0
    for (const r of rows) {
      try { await api.delete(`/purchase/${r.id}`); ok++ } catch { fail++ }
    }
    setLoading(false)
    message.success(`已清空 ${ok} 张 PO${fail ? ` · 失败 ${fail}` : ''}`)
    load()
  }

  // 按新规则给现有 PO 重编号（基于每张 PO 当前 supplier + 第一行物料的 customs_company）
  async function renumberAll() {
    const wcode = askWcode()
    if (wcode === null) return
    setLoading(true)
    try {
      // 拉每张 PO 的详情拿到 customs_company（从 po_items[0] 反查物料）
      const dets = await Promise.all(rows.map(p => api.get<PoDetail>(`/purchase/${p.id}`).then(r => r.data).catch(() => null)))
      // 按现有 supplier 分批；customs_company 取第一行物料的 customs（需要查物料）
      // 简化：直接用 supplier，customs_company 留空（除非该 PO notes 含华胜益等）
      const existingNos: string[] = rows.flatMap(po => po.merged_po_numbers || [])
      let renamed = 0, failed = 0
      for (let i = 0; i < rows.length; i++) {
        const po = rows[i]
        const det = dets[i]
        if (!det) { failed++; continue }
        // 推断 customs_company
        let customs = ''
        const firstItem = det.items?.[0]
        if (firstItem?.material_id && firstItem?.product_code) {
          try {
            const { data } = await api.get<any[]>('/materials', { params: { code: firstItem.product_code } })
            const m = (data || []).find(x => x.id === firstItem.material_id)
            if (m?.customs_company) customs = m.customs_company
          } catch {}
        }
        const entity = poDetermineEntity(po.supplier, customs, undefined)
        const newNo = poGenContractNo(existingNos, entity, wcode)
        existingNos.push(newNo)
        if (newNo === po.po_no) continue   // 已经是新格式
        try {
          await api.patch(`/purchase/${po.id}`, { po_no: newNo })
          renamed++
        } catch { failed++ }
      }
      message.success(`已重编号 ${renamed} 张${failed ? ` · 失败 ${failed}` : ''}`)
      load()
    } finally { setLoading(false) }
  }

  // Export the currently-filtered POs to one xlsx (flat row per item with PO header info)
  async function exportFiltered() {
    if (!filtered.length) { message.warning('当前没有可导出的 PO'); return }
    const XLSX = await import('xlsx')
    // Fetch all PO details in parallel
    const details = await Promise.all(filtered.map(p => api.get<PoDetail>(`/purchase/${p.id}`).then(r => r.data).catch(() => null)))
    const flat: any[] = []
    for (const po of details.filter(Boolean) as PoDetail[]) {
      const items = po.items ?? []
      if (!items.length) {
        flat.push({ 'PO号': po.po_no, '供应商': po.supplier, '状态': po.status, '下单日期': po.order_date, '备注': po.notes })
        continue
      }
      for (const it of items) {
        flat.push({
          'PO号':    po.po_no,
          '来源采购单': it.source_po_no || '',
          '原下单日期': it.source_order_date?.slice(0, 10) || '',
          '交货日期': purchaseLineDeliveryDate(it, po.delivery_date),
          '供应商':  po.supplier,
          '状态':    po.status,
          '下单日期': po.order_date,
          '货号':    it.product_code,
          '物料ID':  it.material_id,
          '数量':    it.qty,
          '单价':    it.price,
          '币种':    it.currency,
          '小计':    (it.qty ?? 0) * (it.price ?? 0),
          'PO备注':  po.notes,
          '行备注':  it.notes,
        })
      }
    }
    const ws = XLSX.utils.json_to_sheet(flat)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '采购订单')
    XLSX.writeFile(wb, `采购订单_${dayjs().format('YYYY-MM-DD')}.xlsx`)
    message.success(`已导出 ${filtered.length} 张 PO · ${flat.length} 行明细`)
  }

  // 单张和批量导出共用同一合同格式；批量仅使用已保存的订单。
  async function buildContractSheet(po?: PoDetail) {
    const XLSX = await import('xlsx-js-style')
    const v = po || form.getFieldsValue()
    const contractItems = po ? (po.items ?? []) : items
    const hasMergeSources = contractItems.some(it => it.source_po_no != null)
    const poNo = v.po_no || String(po?.id ?? editing?.id)
    const supplier = v.supplier || ''
    // 实体由 PO 号前缀推断（IRRM→华登全球 / IRRI→华登实业 / 年份→华胜益）
    let entity: PoEntity = 'HD_INDUSTRY'
    if (/^IRRM/i.test(poNo)) entity = 'HD_GLOBAL'
    else if (/^IRRI/i.test(poNo)) entity = 'HD_INDUSTRY'
    else if (/^\d{4}/.test(poNo)) entity = 'HSY'
    else if (po) throw new Error(`订单 ${poNo} 无法识别采购主体`)
    const meta = PO_ENTITY_META[entity]
    const today = po?.order_date && dayjs(po.order_date).isValid() ? dayjs(po.order_date).toDate() : new Date()
    const todayStr = today.getFullYear() + '/' + String(today.getMonth() + 1).padStart(2, '0') + '/' + String(today.getDate()).padStart(2, '0')
    const todayCN = today.getFullYear() + '年' + (today.getMonth() + 1) + '月' + today.getDate() + '日'
    const deliveryDay = v.delivery_date ? dayjs(v.delivery_date) : null
    const deliveryDateCN = deliveryDay?.isValid()
      ? deliveryDay.year() + '年' + (deliveryDay.month() + 1) + '月' + deliveryDay.date() + '日'
      : todayCN.replace(String(today.getFullYear()), String(today.getFullYear() + 1))

    // 导出时从货号库补全英文名称和物料编码。PO 明细只保存物料 ID，不重复存储这两个可维护字段。
    const productCodes = [...new Set(contractItems.map(it => resolveProductCode(it.product_code)).filter(Boolean))]
    const materials = (await Promise.all(productCodes.map(code =>
      api.get<Material[]>('/materials', { params: { code } }).then(r => r.data || [])
    ))).flat()
    materials.push(...(await loadPurchaseMaterials(contractItems)).values())
    const materialById = new Map(materials.filter(m => m.id != null).map(m => [Number(m.id), m]))
    const normalize = (value: unknown) => String(value ?? '').trim().toUpperCase().replace(/[×*]/g, 'X').replace(/\s+/g, '')
    const findMaterial = (item: PoItem) => {
      if (item.material_id != null) {
        const exact = materialById.get(Number(item.material_id))
        if (exact) return exact
      }
      const code = normalize(resolveProductCode(item.product_code))
      const name = normalize(item.material_name)
      const spec = normalize(item.spec)
      return materials.find(m => normalize(m.product_code) === code
        && normalize(m.name_zh) === name
        && normalize(m.spec) === spec)
    }

    // 按 (货号+物料+规格) 聚合：合同数量/单位/单价使用走货口径，金额保持与采购口径一致。
    const merged = new Map<string, any>()
    for (const it of contractItems) {
      const material = findMaterial(it)
      const k = (it.material_id || '') + '||' + (it.product_code || '') + '||' + (it.material_name || '') + '||' + (it.spec || '') + '||' + purchaseLineSourceKey(it)
      const cur = merged.get(k) || {
        code: it.product_code || '',
        matName: it.material_name || '',
        spec: it.spec || '',
        unit: it.ship_unit || 'PCE',
        nameEn: material?.name_en || '',
        materialCode: material?.material_code || '',
        sourcePo: it.source_po_no || '',
        deliveryDate: purchaseLineDeliveryDate(it, v.delivery_date),
        totalShipQty: 0,
        totalAmount: 0,
        totalPurchaseQty: 0,
      }
      const purchaseQty = Number(it.purchase_qty ?? ((it.material_qty || 0) + (it.spoilage_qty || 0))) || 0
      cur.totalShipQty += shipQuantity(it)
      cur.totalAmount += purchaseQty * (Number(it.price) || 0)
      cur.totalPurchaseQty += purchaseQty
      merged.set(k, cur)
    }
    const mergedRows = [...merged.values()]
    let totalCents = 0
    // 与 Excel 的逐行 ROUND(..., 2) 后求和一致，大写和合计共用此金额。
    mergedRows.forEach(m => totalCents += Math.round(roundPurchaseContractAmount(m.totalAmount || 0) * 100))
    const totalAmount = roundPurchaseContractAmount(totalCents / 100)

    const PAD = (n: number) => Array(n).fill('')
    const rows: any[][] = []
    rows.push([meta.name, ...PAD(7)])
    rows.push([meta.addr, ...PAD(7)])
    rows.push([meta.tel, ...PAD(7)])
    rows.push(['购销合同', ...PAD(7)])
    rows.push(PAD(8))
    rows.push(['甲方：', meta.name, '', '', '', '合同编号：', poNo, ''])
    rows.push(['乙方：', supplier, '', '', '', '日期：', todayStr, ''])
    rows.push(PAD(8))
    const hdrRow = 8
    rows.push(['货 号', '货品名称', '规格型号', '数量', '单位', '单 价 (' + meta.currency + ')', '金额', '备 注', '英文名称', '物料编码'])
    const itemStart = rows.length
    for (const m of mergedRows) {
      const contractUnit = contractUnitLabel(m.unit)
      // D/F/G 由下方统一写入：数量沿用单位精度，单价按原金额反算。
      const remark = '数量：' + Number(m.totalPurchaseQty.toFixed(2)) + 'pcs'
        + (hasMergeSources ? `\n交货：${m.deliveryDate || '待确认'}\n来源：${m.sourcePo || poNo}` : '')
      rows.push([m.code, m.matName, m.spec, '', contractUnit, '', '', remark, m.nameEn, m.materialCode])
    }
    rows.push(['以下空白！', '按工程签板生产！', '', '', '', '', '', ''])
    const sumRow = rows.length
    rows.push(['', '', '', '', '合计', '', Number(totalAmount.toFixed(2)), ''])
    rows.push(['', '', '', '', '大写', meta.currency === 'RMB' ? '人民币' : '美金', numToChinese(totalAmount), ''])
    // 交货说明紧接大写金额，避免中间出现无边框的空白格。
    const notesStart = rows.length
    rows.push([hasMergeSources ? '1. 按各明细备注中的交货日期交货；待确认日期须另行确认。' : '1.  ' + deliveryDateCN + '前交货', ...PAD(7)])
    rows.push([meta.priceIncludesVAT ? '2.单价已含 13 %增值税，月结 90 天；' : '2.单价为美金单价，月结 90 天；', ...PAD(7)])
    rows.push(['3、货物及部件质量符合国外现行最新标准', ...PAD(7)])
    rows.push(PAD(8))
    rows.push(['注意事项：', ...PAD(7)])
    rows.push(['甲乙双方经过友好协商，就甲方项目中订购以上清单共同达成如下合同条款：', ...PAD(7)])
    const paymentTerms = entity === 'HSY'
      ? '一.付款及结算条件:需方在收到PT ROYAL REGENT INDONESIA货款后与供方结算货款;供方在出货后15天内开出 13 %的增值税发票'
      : '一.付款及结算条件:需方在收到PT ROYAL REGENT INDONESIA货款后与供方结算货款'
    rows.push([paymentTerms, ...PAD(7)])
    rows.push(['二.包装条款：纸箱打托', ...PAD(7)])
    rows.push(['三.解决合同纠纷的方式：如有异议，经双方协商同意之后，方可修改本合同。', ...PAD(7)])
    rows.push(['四.此合同传真件与正本具有相同法律效力', ...PAD(7)])
    if (meta.priceIncludesVAT) rows.push(['五.此单价含税及送货运费', ...PAD(7)])
    rows.push(PAD(8))
    rows.push(['甲方盖章：', meta.name, '', '', '乙方盖章：', supplier, '', ''])
    rows.push(['日期：', todayStr, '', '', '日期：', todayStr, '', ''])

    const ws = XLSX.utils.aoa_to_sheet(rows)
    const firstItemExcelRow = itemStart + 1
    const lastItemExcelRow = itemStart + mergedRows.length
    for (let r = itemStart; r < itemStart + mergedRows.length; r++) {
      const item = mergedRows[r - itemStart]
      setPurchaseContractLineAmounts(ws, r + 1, item.totalShipQty, item.totalAmount, shipQuantityDigits(item.unit))
    }
    const totalAddr = XLSX.utils.encode_cell({ r: sumRow, c: 6 })
    const totalFormula = mergedRows.length
      ? `ROUND(SUM(G${firstItemExcelRow}:G${lastItemExcelRow}),2)`
      : '0'
    ;(ws as any)[totalAddr] = {
      t: 'n',
      v: Number(totalAmount.toFixed(2)),
      f: totalFormula,
      z: meta.currencySymbol ? `"${meta.currencySymbol}"#,##0.00` : '#,##0.00',
    }
    ws['!merges'] = []
    const mg = (sR: number, sC: number, eR: number, eC: number) => ws['!merges']!.push({ s: { r: sR, c: sC }, e: { r: eR, c: eC } })
    mg(0, 0, 0, 7); mg(1, 0, 1, 7); mg(2, 0, 2, 7); mg(3, 0, 3, 7)
    mg(5, 1, 5, 4); mg(5, 6, 5, 7); mg(6, 1, 6, 4); mg(6, 6, 6, 7)
    for (let r = notesStart; r < rows.length - 2; r++) { if (String(rows[r][0] || '')) mg(r, 0, r, 7) }
    mg(rows.length - 2, 1, rows.length - 2, 3); mg(rows.length - 2, 5, rows.length - 2, 7)
    mg(rows.length - 1, 1, rows.length - 1, 3); mg(rows.length - 1, 5, rows.length - 1, 7)
    // 反算单价可能带较长小数；保留数值精度并预留显示宽度，避免原生表格显示 ###。
    ws['!cols'] = [{ wch: 12 }, { wch: 22 }, { wch: 16 }, { wch: 10 }, { wch: 8 }, { wch: 20 }, { wch: 13 }, { wch: 18 }, { wch: 32 }, { wch: 16 }]
    const rowH: any[] = [{ hpt: 30 }, { hpt: 18 }, { hpt: 18 }, { hpt: 24 }, { hpt: 10 }, { hpt: 22 }, { hpt: 22 }, { hpt: 10 }, { hpt: 26 }]
    // 所有物料明细行使用相同行高；多行名称/规格仍可完整换行显示。
    for (let r = itemStart; r < itemStart + mergedRows.length; r++) rowH[r] = { hpt: hasMergeSources ? 78 : 45 }
    rowH[itemStart + mergedRows.length] = { hpt: 24 }
    ws['!rows'] = rowH

    const center = { horizontal: 'center', vertical: 'center', wrapText: true }
    const left = { horizontal: 'left', vertical: 'center', wrapText: true }
    const border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }
    const setStyle = (r: number, c: number, st: any) => { const a = XLSX.utils.encode_cell({ r, c }); if (!(ws as any)[a]) (ws as any)[a] = { t: 's', v: '' }; (ws as any)[a].s = st }
    setStyle(0, 0, { font: { bold: true, sz: 22 }, alignment: center })
    setStyle(1, 0, { font: { sz: 12 }, alignment: center })
    setStyle(2, 0, { font: { sz: 12 }, alignment: center })
    setStyle(3, 0, { font: { bold: true, sz: 18 }, alignment: center })
    for (const r of [5, 6]) {
      setStyle(r, 0, { font: { sz: 12 }, alignment: { horizontal: 'right', vertical: 'center' } })
      setStyle(r, 1, { font: { sz: 12 }, alignment: left })
      setStyle(r, 5, { font: { sz: 12 }, alignment: { horizontal: 'right', vertical: 'center' } })
      setStyle(r, 6, { font: { sz: 12, bold: true }, alignment: left })
    }
    for (let c = 0; c < 10; c++) setStyle(hdrRow, c, {
      font: { bold: true, sz: 12 },
      alignment: center,
      border,
      ...(c >= 8 ? { fill: { patternType: 'solid', fgColor: { rgb: 'FFFF00' } } } : {}),
    })
    for (let r = itemStart; r <= sumRow + 1; r++) for (let c = 0; c < 8; c++) setStyle(r, c, { font: { sz: 11 }, alignment: center, border })
    for (let r = itemStart; r < itemStart + mergedRows.length; r++) {
      for (let c = 8; c < 10; c++) setStyle(r, c, {
        font: { sz: 11 }, alignment: center, border,
        fill: { patternType: 'solid', fgColor: { rgb: 'FFFF00' } },
      })
    }
    for (let r = notesStart; r < rows.length - 2; r++) setStyle(r, 0, { font: { sz: 11 }, alignment: left })
    // 三条合同说明各自加完整格子边框，与上方明细表保持一致。
    for (let r = notesStart; r < notesStart + 3; r++) {
      for (let c = 0; c < 8; c++) setStyle(r, c, { font: { sz: 11 }, alignment: left, border })
    }
    for (const r of [rows.length - 2, rows.length - 1]) {
      setStyle(r, 0, { font: { sz: 12 }, alignment: { horizontal: 'right', vertical: 'center' } })
      setStyle(r, 1, { font: { sz: 12 }, alignment: left })
      setStyle(r, 4, { font: { sz: 12 }, alignment: { horizontal: 'right', vertical: 'center' } })
      setStyle(r, 5, { font: { sz: 12 }, alignment: left })
    }

    formatPurchaseContractTotals(ws, sumRow)
    formatPurchaseContractFonts(ws)
    return { ws, poNo, supplier, entity }
  }

  async function exportSingle() {
    if (!editing?.id) { message.warning('请先打开 / 保存一张 PO'); return }
    try {
      const XLSX = await import('xlsx-js-style')
      const { ws, poNo, supplier } = await buildContractSheet()
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, '购销合同')
      XLSX.writeFile(wb, `${poNo}_${supplier}_购销合同.xlsx`)
      message.success('已导出购销合同')
    } catch {
      message.error('导出失败，请确认订单及物料数据可读取后重试')
    }
  }

  const [exportingContracts, setExportingContracts] = useState(false)
  async function exportContractsByEntity() {
    if (!filtered.length) { message.warning('当前筛选没有可导出的采购订单'); return }
    setExportingContracts(true)
    try {
      const XLSX = await import('xlsx-js-style')
      const contracts = []
      // 逐单加载，避免大批导出时同时请求过多物料数据；任何失败均停止导出。
      for (const summary of filtered) {
        const { data } = await api.get<PoDetail>(`/purchase/${summary.id}`)
        contracts.push(await buildContractSheet(data))
      }
      const wb = combinePurchaseContracts(contracts)
      XLSX.writeFile(wb, `采购合同_按主体_${dayjs().format('YYYY-MM-DD')}.xlsx`)
      message.success(`已导出 ${contracts.length} 张订单，分为 ${wb.SheetNames.length} 个采购主体工作表`)
    } catch (error) {
      message.error(`合并导出失败，未生成文件：${error instanceof Error ? error.message : '请重试'}`)
    } finally {
      setExportingContracts(false)
    }
  }

  function patchItem(i: number, k: keyof PoItem, v: any) {
    setItems(its => its.map((it, idx) => idx === i ? patchPoItem(it, k, v) : it))
  }
  function fillItemDown(sourceIndex: number, targetIndex: number, field: keyof PoItem) {
    if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || targetIndex <= sourceIndex || targetIndex >= items.length) {
      message.warning('请把复制点向下拖动到目标行')
      return
    }
    setItems(current => {
      const value = current[sourceIndex]?.[field]
      return current.map((item, index) => {
        if (index <= sourceIndex || index > targetIndex || (field === 'ship_unit' && item.material_id)) return item
        return patchPoItem(item, field, value)
      })
    })
    message.success(`已向下复制 ${targetIndex - sourceIndex} 行`)
  }
  function fillable(i: number, field: keyof PoItem, control: ReactNode) {
    return <FillablePurchaseCell rowIndex={i} field={field} onFill={fillItemDown}
      onFillToEnd={(sourceIndex, sourceField) => fillItemDown(sourceIndex, items.length - 1, sourceField)}>
      {control}
    </FillablePurchaseCell>
  }
  function addItem() {
    const poNo = String(form.getFieldValue('po_no') || '')
    const cur = poLineCurrency(poNo)
    setItems(its => [...its, { product_code: '', qty: 0, price: 0, currency: cur, usage_qty: 1, ordered_qty: 0, material_qty: 0, spoilage_qty: 0, purchase_qty: 0, purchase_unit: '个', ship_unit: 'PCE', net_per_pc: 0, eta: '' }])
  }
  function delItem(i: number) { setItems(its => its.filter((_, idx) => idx !== i)) }

  // 合并同名：弹窗逐行勾选（默认全选），只合并勾选的行（与旧系统一致——可排除不想合并的行）
  function mergeSameName() {
    if (items.length < 2) { message.warning('需要至少 2 行才能合并'); return }
    setMergeSel(items.map((_, i) => i))   // 默认全选
    setMergeOpen(true)
  }
  // 把勾选的行按 (物料名 + 规格) 分组合并；未勾选的原样保留；合并行落在该组首次出现位置
  function doMergeSelected() {
    const sel = new Set(mergeSel.map(Number))
    if (sel.size < 2) { message.warning('至少勾选 2 行'); return }
    const splitSet = (s: string | undefined, sep: RegExp) => new Set(String(s || '').split(sep).map(x => x.trim()).filter(Boolean))
    const groups = new Map<string, PoItem[]>(); const order: string[] = []
    items.forEach((it, idx) => {
      if (!sel.has(idx)) return
      const k = (it.material_name || '').trim() + '||' + (it.spec || '').trim() + '||' + purchaseLineSourceKey(it)
      if (!groups.has(k)) { groups.set(k, []); order.push(k) }
      groups.get(k)!.push(it)
    })
    const mergedByKey = new Map<string, PoItem>()
    for (const k of order) {
      const rows = groups.get(k)!
      if (rows.length < 2) continue
      const base: PoItem = { ...rows[0] }
      let qq = 0, oq = 0, mq = 0, sp = 0, pq = 0
      const codes = new Set<string>(), tps = new Set<string>()
      for (const it of rows) {
        qq += it.qty || 0; oq += it.ordered_qty || 0; mq += it.material_qty || 0; sp += it.spoilage_qty || 0; pq += it.purchase_qty || 0
        splitSet(it.product_code, /\s*\/\s*/).forEach(x => codes.add(x))
        splitSet(it.tomy_po, /\s*[;；]\s*/).forEach(x => tps.add(x))
      }
      base.qty = qq; base.ordered_qty = oq; base.material_qty = mq; base.spoilage_qty = sp; base.purchase_qty = pq
      base.product_code = [...codes].join(' / '); base.tomy_po = [...tps].join('; ')
      mergedByKey.set(k, applyAutoSpoilage(base))
    }
    if (!mergedByKey.size) { message.warning('勾选的行里没有 (物料名+规格) 相同的，无可合并'); return }
    setMergeUndo(items)  // 快照供"取消合并"
    const newItems: PoItem[] = []; const inserted = new Set<string>()
    items.forEach((it, idx) => {
      if (!sel.has(idx)) { newItems.push(it); return }
      const k = (it.material_name || '').trim() + '||' + (it.spec || '').trim() + '||' + purchaseLineSourceKey(it)
      if (mergedByKey.has(k)) { if (!inserted.has(k)) { newItems.push(mergedByKey.get(k)!); inserted.add(k) } }
      else newItems.push(it)
    })
    setItems(newItems); setMergeOpen(false)
    message.success('已合并勾选的同名行')
  }
  function undoMerge() {
    if (!mergeUndo) return
    setItems(mergeUndo); setMergeUndo(null)
    message.success('已还原合并前的明细')
  }

  // 套用报价：货号优先级为「具体货号 → 共用 → 空白旧报价」，
  // 每一级再按供应商、物料名、规格和采购数量选择阶梯价。
  async function applyQuotes() {
    try {
      const { data: quotes } = await api.get<QuoteRow[]>('/quotes/blob')
      const supplier = form.getFieldValue('supplier') as string ?? ''
      if (!supplier) { message.warning('请先填供应商'); return }
      const priced = applyQuotePrices(items, Array.isArray(quotes) ? quotes : [], supplier, true)
      setItems(priced.items)
      message.success(`已套用报价：${priced.hit}/${items.length} 行`)
    } catch {
      /* 拦截器已提示 */
    }
  }

  // 回填单个净重和走货单位，用于计算 KGM 走货数量。
  async function backfillNetWeight() {
    if (!items.length) { message.info('请先添加采购明细'); return }
    const snapshot = items
    const supplier = String(form.getFieldValue('supplier') || '')
    try {
      const candidates = await loadPurchaseMaterialCandidates(snapshot)
      const plan = planPurchaseNetWeight(snapshot, candidates.materials, supplier, candidates.profiles)
      const ready = plan.filter(row => row.ready)
      const content = <>
        <p>仅回填当前采购单的物料关联、单件净重（kg/件）及走货单位，不修改货号库、数量或单价；确认后仍需保存采购单。</p>
        <div style={{ maxHeight: 360, overflow: 'auto' }}>{plan.map(row => <div key={row.index} style={{ padding: 8, borderBottom: '1px solid #eee' }}>
          <b>第 {row.index + 1} 行 · {row.original.product_code} · {row.original.material_name || '未命名物料'}</b>
          <div>{row.ready ? <><Tag color="green">可回填</Tag>{row.matchedBy}；单件净重 {row.original.net_per_pc || 0} → {row.next.net_per_pc} kg/件；走货单位 {row.next.ship_unit}</>
            : <><Tag color="orange">未回填</Tag>{row.reason}（本行保持原值）</>}</div>
        </div>)}</div>
      </>
      if (!ready.length) { Modal.warning({ title: '没有可回填的净重，请核对以下明细', width: 800, content }); return }
      Modal.confirm({ title: `净重回填核对：可回填 ${ready.length}/${snapshot.length} 行`, width: 800,
        okText: `回填 ${ready.length} 行`, cancelText: '取消', content,
        onOk: () => {
          setItems(current => current.map((item, index) => {
            const row = plan[index]
            return row?.ready && item === row.original ? row.next : item
          }))
          setMergeUndo(null)
          message.info('已应用回填；核对期间发生变化的行保持原值，请检查后保存采购单')
        },
      })
    } catch (error: any) { message.error('净重资料加载失败，未回填，请重试：' + (error?.message || error)) }
  }

  const filtered = useMemo(() => rows.filter(r => {
    if (statusFilter && r.status !== statusFilter) return false
    if (dateRange[0] || dateRange[1]) {
      const d = r.order_date ? dayjs(r.order_date) : null
      if (!d) return false
      if (dateRange[0] && d.isBefore(dayjs(dateRange[0]), 'day')) return false
      if (dateRange[1] && d.isAfter(dayjs(dateRange[1]), 'day')) return false
    }
    if (!filter) return true
    const s = filter.toLowerCase()
    return ((r.po_no || '') + (r.supplier || '') + (r.notes || '')).toLowerCase().includes(s)
  }), [rows, filter, statusFilter, dateRange])

  const filteredItems = useMemo(() => itemRows.filter(r => {
    if (statusFilter && r.status !== statusFilter) return false
    if (dateRange[0] || dateRange[1]) {
      const d = r.order_date ? dayjs(r.order_date) : null
      if (!d) return false
      if (dateRange[0] && d.isBefore(dayjs(dateRange[0]), 'day')) return false
      if (dateRange[1] && d.isAfter(dayjs(dateRange[1]), 'day')) return false
    }
    if (!filter) return true
    const s = filter.toLowerCase()
    return [
      r.po_no, r.supplier, r.product_code, r.material_name, r.spec,
      r.notes, r.po_notes, r.receipt_summary,
    ].join(' ').toLowerCase().includes(s)
  }), [itemRows, filter, statusFilter, dateRange])

  const itemsByPo = useMemo(() => {
    const map = new Map<number, PurchaseItemRow[]>()
    for (const item of itemRows) map.set(item.po_id, [...(map.get(item.po_id) || []), item])
    return map
  }, [itemRows])

  const visiblePurchaseOrders = useMemo(() => {
    const matchedPoIds = new Set(filteredItems.map(x => x.po_id))
    return rows.filter(po => {
      if (statusFilter && po.status !== statusFilter) return false
      if (dateRange[0] || dateRange[1]) {
        const d = po.order_date ? dayjs(po.order_date) : null
        if (!d) return false
        if (dateRange[0] && d.isBefore(dayjs(dateRange[0]), 'day')) return false
        if (dateRange[1] && d.isAfter(dayjs(dateRange[1]), 'day')) return false
      }
      if (!filter) return true
      const header = `${po.po_no || ''} ${po.supplier || ''} ${po.notes || ''}`.toLowerCase()
      return header.includes(filter.toLowerCase()) || matchedPoIds.has(po.id)
    })
  }, [rows, filteredItems, filter, statusFilter, dateRange])

  const statsByStatus = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rows) m.set(r.status || 'draft', (m.get(r.status || 'draft') ?? 0) + 1)
    return m
  }, [rows])

  const totalItems = useMemo(() => items.reduce((s, it) => s + (it.qty ?? 0) * (it.price ?? 0), 0), [items])

  return (
    <div style={{ padding: 16 }}>
      <Card
        title={`采购管理 — 共 ${visiblePurchaseOrders.length} 张采购单（物料默认收起）`}
        extra={
          <Space wrap size={[4, 8]}>
            <Input.Search allowClear placeholder="搜索采购单 / 货号 / 物料 / 供应商" style={{ width: 260 }}
              onSearch={setFilter} onChange={(e) => !e.target.value && setFilter('')} />
            <Select
              value={statusFilter} onChange={setStatusFilter}
              style={{ width: 130 }}
              options={[{ value: '', label: `全部 (${rows.length})` },
                ...STATUS.map(s => ({ value: s.value, label: `${s.label} (${statsByStatus.get(s.value) ?? 0})` }))]}
            />
            <DatePicker.RangePicker
              value={[dateRange[0] ? dayjs(dateRange[0]) : null, dateRange[1] ? dayjs(dateRange[1]) : null]}
              onChange={(v) => setDateRange([
                v?.[0] ? v[0].format('YYYY-MM-DD') : '',
                v?.[1] ? v[1].format('YYYY-MM-DD') : '',
              ])}
              allowClear
              placeholder={['下单起', '下单止']}
              style={{ width: 240 }}
            />
            <Button onClick={() => setStatsOpen(true)}>📋 PO 数据</Button>
            <Button onClick={exportFiltered}>📤 导出 Excel (按筛选)</Button>
            <Button loading={exportingContracts} onClick={exportContractsByEntity}>合并导出合同（按主体/当前筛选）</Button>
            <Button disabled={poSelKeys.length < 2} onClick={openOrderMerge}>合并采购单 ({poSelKeys.length})</Button>
            <Popconfirm
              title={`删除选中的 ${poSelKeys.length} 张 PO？不可恢复`}
              onConfirm={delSelected}
              disabled={!poSelKeys.length}
            >
              <Button danger disabled={!poSelKeys.length}>🗑 批量删除 ({poSelKeys.length})</Button>
            </Popconfirm>
            <Popconfirm title={`给全部 ${rows.length} 张 PO 重编号（会先问一次车间代号 HS/HD/HB/HK，整批共用）`} onConfirm={renumberAll} disabled={!rows.length}>
              <Button disabled={!rows.length}>🔢 一键重编号</Button>
            </Popconfirm>
            <Popconfirm title={`清空全部 ${rows.length} 张 PO？不可恢复！`} onConfirm={wipeAll} disabled={!rows.length}>
              <Button danger disabled={!rows.length}>🗑 全部清空</Button>
            </Popconfirm>
            <Button type="primary" onClick={openCreate}>➕ 新建 PO</Button>
            <Button onClick={load}>🔄 刷新</Button>
          </Space>
        }
      >
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={visiblePurchaseOrders}
          rowSelection={{
            selectedRowKeys: poSelKeys,
            onChange: setPoSelKeys,
          }}
          pagination={{ defaultPageSize: 30, showSizeChanger: true }}
          scroll={{ x: 1200 }}
          rowClassName={(r) => Number(r.shortage_qty ?? 0) <= 0 ? 'purchase-row-complete' : ''}
          expandable={{
            expandedRowRender: (po) => {
              const details = itemsByPo.get(po.id) || []
              return (
                <Table
                  rowKey="id"
                  size="small"
                  pagination={false}
                  dataSource={details}
                  scroll={{ x: 1250 }}
                  columns={[
                    { title: '货号', dataIndex: 'product_code', width: 120 },
                    { title: '来源采购单', dataIndex: 'source_po_no', width: 150, render: v => v || '—' },
                    { title: '原下单日期', dataIndex: 'source_order_date', width: 110, render: v => v ? dayjs(v).format('YYYY-MM-DD') : '—' },
                    { title: '交货日期', width: 110, render: (_v, r) => purchaseLineDeliveryDate(r, po.delivery_date) || '待确认' },
                    { title: '物料', dataIndex: 'material_name', width: 220, ellipsis: true },
                    { title: '规格', dataIndex: 'spec', width: 160, ellipsis: true, render: v => v || <Typography.Text type="secondary">—</Typography.Text> },
                    { title: '采购数量', width: 110, align: 'right', render: (_v, r) => Number(r.purchase_qty ?? r.qty ?? 0).toLocaleString() },
                    { title: '单位', dataIndex: 'purchase_unit', width: 70, render: v => v || '个' },
                    { title: '累计入库', dataIndex: 'received_qty', width: 110, align: 'right', render: v => Number(v ?? 0).toLocaleString() },
                    { title: '累计备品', dataIndex: 'spare_qty', width: 110, align: 'right', render: v => Number(v ?? 0).toLocaleString() },
                    { title: '欠数', dataIndex: 'shortage_qty', width: 100, align: 'right', render: v => Number(v ?? 0) > 0 ? <Typography.Text type="danger">{Number(v).toLocaleString()}</Typography.Text> : <Tag color="success">完成</Tag> },
                    { title: '入库批次', dataIndex: 'receipt_summary', width: 330, render: v => v || <Typography.Text type="secondary">尚未入库</Typography.Text> },
                    { title: '操作', width: 90, render: (_v, r) => <Button size="small" onClick={() => openReceipt(r)}>单项入库</Button> },
                  ]}
                />
              )
            },
            rowExpandable: po => (itemsByPo.get(po.id)?.length || 0) > 0,
            columnTitle: '物料',
          }}
          columns={[
            {
              title: '下单日期', dataIndex: 'order_date', width: 110,
              render: (v) => v ? dayjs(v).format('YYYY-MM-DD') : '',
            },
            {
              title: '采购单号', dataIndex: 'po_no', width: 180, fixed: 'left',
              render: (v, po) => <a onClick={() => openEdit(po)}>{v || `#${po.id}`}</a>,
            },
            { title: '供应商', dataIndex: 'supplier', width: 170, ellipsis: true },
            {
              title: '物料项', dataIndex: 'item_count', width: 90, align: 'center',
              render: v => <Tag bordered={false} color="blue">{Number(v ?? 0)} 项</Tag>,
            },
            {
              title: '交货期', dataIndex: 'delivery_date', width: 110,
              render: (v, po) => {
                const dates = [...new Set((itemsByPo.get(po.id) || []).map(it => purchaseLineDeliveryDate(it, v)))]
                return dates.length > 1 ? '按明细交期' : dates.length ? dates[0] || '-' : v ? dayjs(v).format('YYYY-MM-DD') : '-'
              },
            },
            {
              title: '累计入库', dataIndex: 'received_qty', width: 120, align: 'right',
              render: v => Number(v ?? 0).toLocaleString(),
            },
            {
              title: '累计备品', dataIndex: 'spare_qty', width: 110, align: 'right',
              render: v => Number(v ?? 0).toLocaleString(),
            },
            {
              title: '总欠数', dataIndex: 'shortage_qty', width: 120, align: 'right',
              render: v => Number(v ?? 0) > 0
                ? <Typography.Text strong type="danger">{Number(v).toLocaleString()}</Typography.Text>
                : <Tag color="success">全部入库</Tag>,
            },
            {
              title: '状态', dataIndex: 'status', width: 100,
              render: v => {
                const status = STATUS.find(x => x.value === v) || STATUS[0]
                return <Tag color={status.color}>{status.label}</Tag>
              },
            },
            {
              title: '操作', width: 190, fixed: 'right',
              render: (_v, po) => (
                <Space size={4}>
                  <Button size="small" type="primary" ghost disabled={!(itemsByPo.get(po.id)?.length)} onClick={() => openBulkReceipt(po)}>
                    {Number(po.shortage_qty ?? 0) <= 0 ? '补录备品' : '统一入库'}
                  </Button>
                  <Button size="small" onClick={() => openEdit(po)}>编辑订单</Button>
                </Space>
              ),
            },
          ]}
        />
        <style>{`
          .purchase-row-complete td { background: #f6ffed !important; }
          .purchase-row-complete:hover td { background: #eaffdc !important; }
        `}</style>
      </Card>

      <Modal title="合并采购单" open={mergeOrdersOpen} confirmLoading={mergingOrders}
        okText="确认合并" cancelText="取消" onOk={mergeOrders}
        onCancel={() => { if (!mergingOrders) setMergeOrdersOpen(false) }}>
        <p>支持不同下单日期；仅合并同供应商、同币种、同采购主体的草稿，已有入库、出库或走货关联的单据不可合并。</p>
        <p>保留所选单号及其下单日期，其余采购单归档。明细数量、价格、排期关联、原下单日期及各自交货日期保留。</p>
        <Select style={{ width: '100%' }} value={mergeTarget} onChange={setMergeTarget} disabled={mergingOrders}
          options={selectedOrders.map(po => ({ value: po.id, label: `保留单号：${po.po_no}` }))} />
        <Table size="small" rowKey="id" pagination={false} dataSource={selectedOrders}
          columns={[
            { title: '单号', dataIndex: 'po_no' },
            { title: '下单日期', dataIndex: 'order_date', render: v => v ? dayjs(v).format('YYYY-MM-DD') : '未填写' },
            { title: '明细', dataIndex: 'item_count' },
            { title: '金额', dataIndex: 'total_amount', render: v => Number(v || 0).toFixed(2) },
            { title: '交货日期', dataIndex: 'delivery_date', render: v => v ? dayjs(v).format('YYYY-MM-DD') : '待确认' },
          ]} />
        <Typography.Text type="secondary">合并记录包含操作人及原单据内容；合并后的采购单可继续编辑和导出。</Typography.Text>
      </Modal>

      <Drawer
        rootClassName="purchase-editor-drawer"
        open={editing !== null}
        width={drawerFull ? '100vw' : '60vw'}
        title={creating ? '新建采购订单' : `编辑 PO — ${editing?.po_no || editing?.id}`}
        onClose={() => { setEditing(null); setCreating(false); setDrawerFull(false) }}
        destroyOnClose
        extra={
          <Space wrap>
            <Button onClick={() => setSchedPickerOpen(true)}>🔗 从排期选</Button>
            <Button onClick={() => setMaterialSelection({ mode: 'append' })}>📦 从物料库选择</Button>
            {!creating && <Button onClick={checkMaterialSync}>🔄 检查货号库更新</Button>}
            {!creating && <Button onClick={correctHsyNumber}>修正华胜益编号</Button>}
            <Button onClick={mergeSameName}>🔀 合并同名</Button>
            <Button onClick={undoMerge} disabled={!mergeUndo}>↩ 取消合并</Button>
            <Button onClick={applyQuotes}>💲 套用报价</Button>
            <Button onClick={backfillNetWeight}>⚖ 回填净重</Button>
            <Button onClick={exportSingle}>📤 导出本张</Button>
            <Button onClick={() => setDrawerFull(!drawerFull)}>{drawerFull ? '⤢ 退出全屏' : '⤡ 全屏'}</Button>
            <Button type="primary" onClick={save}>💾 保存</Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical">
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="po_no" label="PO 号" rules={[{ required: true, message: '必填' }]}>
                <Input placeholder="例如 PO-20260608-01" />
              </Form.Item>
            </Col>
            <Col span={10}>
              <Form.Item name="supplier" label="供应商"><Input /></Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="status" label="状态">
                <Select options={STATUS.map(s => ({ value: s.value, label: s.label }))} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="order_date" label="下单日期"
                getValueProps={(val) => ({ value: val ? dayjs(val) : null })}
                normalize={(val: any) => (val ? dayjs(val).format('YYYY-MM-DD') : '')}>
                <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="delivery_date" label="交货日期（整单统一修改）"
                extra={<Button type="link" size="small" onClick={() => changeWholeDeliveryDate(deliveryDate ? dayjs(deliveryDate) : null)}>将此日期应用到整单（保存后生效）</Button>}
                getValueProps={(val) => ({ value: val ? dayjs(val) : null })}
                normalize={(val: any) => (val ? dayjs(val).format('YYYY-MM-DD') : '')}>
                <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" onChange={changeWholeDeliveryDate} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="notes" label="备注"><Input /></Form.Item>
            </Col>
          </Row>
        </Form>

        <Card
          size="small"
          title={`明细 (${items.length}) · 金额合计 ${totalItems.toFixed(2)}`}
          extra={<Button size="small" onClick={addItem}>➕ 加一行</Button>}
          styles={{
            header: { position: 'sticky', top: 0, zIndex: 5, background: '#fff' },
            body: { paddingTop: 0 },
          }}
        >
          <Table
            rowKey={(_, i) => String(i)}
            size="small"
            pagination={false}
            dataSource={items}
            sticky={{ offsetHeader: 47 }}
            scroll={{ x: 2700, y: 'calc(100vh - 330px)' }}
            columns={[
              { title: '#', width: 40, fixed: 'left', render: (_v, _r, i) => i + 1 },
              { title: '货号', width: 120, fixed: 'left', render: (_v, r, i) => fillable(i, 'product_code', <Input size="small" value={r.product_code} onChange={(e) => patchItem(i, 'product_code', e.target.value)} />) },
              { title: '物料名称', width: 200, fixed: 'left', render: (_v, r, i) => fillable(i, 'material_name', <Input size="small" value={r.material_name} onChange={(e) => patchItem(i, 'material_name', e.target.value)} />) },
              { title: '类别', width: 100, render: (_v, r, i) => fillable(i, 'category', <Input size="small" value={r.category} onChange={(e) => patchItem(i, 'category', e.target.value)} />) },
              { title: '规格', width: 160, render: (_v, r, i) => fillable(i, 'spec', <Input size="small" value={r.spec} onChange={(e) => patchItem(i, 'spec', e.target.value)} />) },
              { title: '用量', width: 100, render: (_v, r, i) => fillable(i, 'usage_qty', <InputNumber size="small" min={0} step={0.001} value={r.usage_qty} onChange={(v) => patchItem(i, 'usage_qty', v ?? 0)} style={{ width: '100%' }} />) },
              { title: '订单量', width: 120, render: (_v, r, i) => fillable(i, 'ordered_qty', <InputNumber size="small" min={0} value={r.ordered_qty} onChange={(v) => patchItem(i, 'ordered_qty', v ?? 0)} style={{ width: '100%' }} />) },
              { title: '物料量', width: 100, align: 'right', render: (_v, r) => Number(r.material_qty ?? 0).toFixed(0) },
              { title: '损耗量', width: 110, render: (_v, r, i) => fillable(i, 'spoilage_qty', <InputNumber size="small" min={0} value={r.spoilage_qty} onChange={(v) => patchItem(i, 'spoilage_qty', v ?? 0)} style={{ width: '100%' }} />) },
              { title: '采购量', width: 100, align: 'right', render: (_v, r) => <b style={{ color: '#1677ff' }}>{Number(r.purchase_qty ?? r.qty ?? 0).toFixed(2)}</b> },
              { title: '单价', width: 150, render: (_v, r, i) => fillable(i, 'price', <InputNumber size="small" min={0} precision={8} step={0.00000001} value={r.price} onChange={(v) => patchItem(i, 'price', v ?? 0)} style={{ width: '100%' }} />) },
              { title: '金额', width: 100, align: 'right', render: (_v, r) => <b style={{ color: '#c0392b' }}>{((r.purchase_qty ?? r.qty ?? 0) * (r.price ?? 0)).toFixed(2)}</b> },
              { title: '采购单位', width: 110, render: (_v, r, i) => fillable(i, 'purchase_unit',
                <Select size="small" value={r.purchase_unit || '个'} style={{ width: '100%' }}
                  options={['个', '只', '米', '卷', '套'].map(x => ({ value: x, label: x }))}
                  onChange={(v) => patchItem(i, 'purchase_unit', v)} />
              ) },
              { title: '走货单位（货号库）', width: 150, render: (_v, r, i) => r.material_id ? (
                <Select size="small" value={r.ship_unit || 'PCE'} style={{ width: '100%' }} disabled
                  options={['PCE', 'KGM', 'MTR', 'SET', 'PAR', 'ROLL', 'TNE'].map(x => ({ value: x, label: x }))} />
              ) : fillable(i, 'ship_unit',
                <div title={r.material_id ? '已关联货号库物料，单位跟随货号库' : '手工明细未关联物料库，可自行选择'}>
                  <Select size="small" value={r.ship_unit || 'PCE'} style={{ width: '100%' }}
                    options={['PCE', 'KGM', 'MTR', 'SET', 'PAR', 'ROLL', 'TNE'].map(x => ({ value: x, label: x }))}
                    onChange={(v) => patchItem(i, 'ship_unit', v)} />
                </div>
              ) },
              { title: '走货数量', width: 100, align: 'right', render: (_v, r) => <b style={{ color: '#28a06a' }}>{shipQuantity(r).toFixed(shipQuantityDigits(r.ship_unit))}</b> },
              { title: '走货单价', width: 100, align: 'right', render: (_v, r) => {
                const shipQty = shipQuantity(r)
                const amount = Number(r.purchase_qty ?? r.qty ?? 0) * Number(r.price ?? 0)
                return <b style={{ color: '#2878c8' }}>{shipQty > 0 ? Number((amount / shipQty).toFixed(8)).toString() : '0'}</b>
              } },
              { title: '来源采购单', dataIndex: 'source_po_no', width: 150, render: v => v || '—' },
              { title: '原下单日期', dataIndex: 'source_order_date', width: 110, render: v => v ? dayjs(v).format('YYYY-MM-DD') : '—' },
              { title: '交货时间', width: 110, render: (_v, r) => purchaseLineDeliveryDate(r, deliveryDate) || '待确认' },
              { title: '关联排期订单', width: 190, render: (_v, r, i) => <Space direction="vertical" size={0}>
                <Typography.Text style={{ whiteSpace: 'normal' }}>{r.tomy_po || '未关联'}</Typography.Text>
                <Button type="link" size="small" onClick={() => openLineScheduleLink(i)}>关联排期</Button>
              </Space> },
              { title: '走货期', width: 130, render: (_v, r, i) => fillable(i, 'eta', <Input size="small" value={r.eta} onChange={(e) => patchItem(i, 'eta', e.target.value)} />) },
              { title: '币种', width: 120, render: (_v, r, i) => fillable(i, 'currency', <Select size="small" value={r.currency || '¥'} options={CURR} onChange={(v) => patchItem(i, 'currency', v)} style={{ width: '100%' }} />) },
              { title: '备注', width: 200, render: (_v, r, i) => fillable(i, 'notes', <Input size="small" value={r.notes} onChange={(e) => patchItem(i, 'notes', e.target.value)} />) },
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

      {materialSelection && <PurchaseMaterialPicker codes={productCodes} groups={materialGroups}
        resolveCode={resolveProductCode} generate={materialSelection.mode !== 'append'}
        onCancel={() => setMaterialSelection(null)} onConfirm={confirmMaterials} onBatchConfirm={generateBySupplier} />}

      <Modal
        open={bulkReceiptPo !== null}
        title={`整单统一入库 · ${bulkReceiptPo?.po_no || ''}`}
        width={1180}
        onCancel={() => setBulkReceiptPo(null)}
        onOk={saveBulkReceipt}
        okText="确认本批统一入库"
        destroyOnClose
      >
        <Typography.Paragraph type="secondary">
          同一张采购单只登记一次日期、批次和备注；未到货的物料保持 0。已收齐物料仍可补录备品，本批入库填 0，备品单独累计、不抵扣欠数。
        </Typography.Paragraph>
        <Row gutter={12} style={{ marginBottom: 12 }}>
          <Col span={7}>
            <Field label="入库日期">
              <DatePicker value={bulkReceiptDate} onChange={v => v && setBulkReceiptDate(v)} style={{ width: '100%' }} />
            </Field>
          </Col>
          <Col span={7}>
            <Field label="统一批次号">
              <Input value={bulkReceiptBatch} onChange={e => setBulkReceiptBatch(e.target.value)} placeholder="可选" />
            </Field>
          </Col>
          <Col span={10}>
            <Field label="统一备注">
              <Input value={bulkReceiptNotes} onChange={e => setBulkReceiptNotes(e.target.value)} placeholder="送货单号、异常说明等" />
            </Field>
          </Col>
        </Row>
        <Space style={{ marginBottom: 8 }}>
          <Button onClick={() => setBulkReceiptQty(Object.fromEntries(
            (itemsByPo.get(bulkReceiptPo?.id || 0) || []).map(x => [x.id, Number(x.shortage_qty ?? 0)]),
          ))}>填入全部欠数</Button>
          <Button onClick={() => { setBulkReceiptQty({}); setBulkReceiptSpareQty({}) }}>全部清零</Button>
          <Typography.Text type="secondary">仅提交本批入库或备品入数大于 0 的物料</Typography.Text>
        </Space>
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          scroll={{ x: 1080, y: 420 }}
          dataSource={itemsByPo.get(bulkReceiptPo?.id || 0) || []}
          columns={[
            { title: '货号', dataIndex: 'product_code', width: 120 },
            { title: '物料名称', dataIndex: 'material_name', width: 240, ellipsis: true },
            { title: '规格', dataIndex: 'spec', width: 160, ellipsis: true, render: v => v || <Typography.Text type="secondary">—</Typography.Text> },
            { title: '采购数', width: 105, align: 'right', render: (_v, r) => Number(r.purchase_qty ?? r.qty ?? 0).toLocaleString() },
            { title: '已入库', dataIndex: 'received_qty', width: 100, align: 'right', render: v => Number(v ?? 0).toLocaleString() },
            { title: '欠数', dataIndex: 'shortage_qty', width: 100, align: 'right', render: v => <Typography.Text type="danger">{Number(v ?? 0).toLocaleString()}</Typography.Text> },
            {
              title: '本批入库', width: 150, fixed: 'right',
              render: (_v, r) => <InputNumber
                min={0}
                max={Number(r.shortage_qty ?? 0)}
                value={bulkReceiptQty[r.id] || 0}
                onChange={v => setBulkReceiptQty(q => ({ ...q, [r.id]: Number(v ?? 0) }))}
                style={{ width: '100%' }}
              />,
            },
            {
              title: '备品入数', width: 140, fixed: 'right',
              render: (_v, r) => <InputNumber
                min={0}
                value={bulkReceiptSpareQty[r.id] || 0}
                onChange={v => setBulkReceiptSpareQty(q => ({ ...q, [r.id]: Number(v ?? 0) }))}
                style={{ width: '100%' }}
              />,
            },
          ]}
        />
      </Modal>

      <Modal
        open={receiptItem !== null}
        title={`分批入库 · ${receiptItem?.po_no || ''} · ${receiptItem?.material_name || receiptItem?.product_code || ''}${receiptItem?.spec ? ` · ${receiptItem.spec}` : ''}`}
        width={760}
        onCancel={() => { setReceiptItem(null); setReceiptRows([]); receiptForm.resetFields() }}
        onOk={saveReceipt}
        okText={Number(receiptItem?.shortage_qty ?? 0) > 0 ? '确认本批入库' : '确认补录备品'}
        destroyOnClose
      >
        <Row gutter={12} style={{ marginBottom: 12 }}>
          <Col span={8}>
            <Card size="small">
              采购数量<br />
              <Typography.Text strong style={{ fontSize: 20 }}>
                {Number(receiptItem?.purchase_qty ?? receiptItem?.qty ?? 0).toLocaleString()}
              </Typography.Text>
            </Card>
          </Col>
          <Col span={8}>
            <Card size="small">
              累计入库<br />
              <Typography.Text strong style={{ fontSize: 20, color: '#1677ff' }}>
                {Number(receiptItem?.received_qty ?? 0).toLocaleString()}
              </Typography.Text>
              {Number(receiptItem?.spare_qty ?? 0) > 0 && (
                <Typography.Text type="secondary"> + 备品 {Number(receiptItem?.spare_qty ?? 0).toLocaleString()}</Typography.Text>
              )}
            </Card>
          </Col>
          <Col span={8}>
            <Card size="small">
              当前欠数<br />
              <Typography.Text strong type={Number(receiptItem?.shortage_qty ?? 0) > 0 ? 'danger' : 'success'} style={{ fontSize: 20 }}>
                {Number(receiptItem?.shortage_qty ?? 0).toLocaleString()}
              </Typography.Text>
            </Card>
          </Col>
        </Row>

        {receiptItem && (
          <Form form={receiptForm} layout="vertical">
            <Row gutter={12}>
              <Col span={6}>
                <Form.Item name="receipt_date" label="入库日期" rules={[{ required: true, message: '请选择入库日期' }]}>
                  <DatePicker style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item
                  name="qty"
                  label="本批入库数量"
                  dependencies={['spare_qty']}
                  rules={[
                    { required: true, message: '请输入数量' },
                    {
                      validator: async (_rule, value) => {
                        const qty = Number(value ?? 0)
                        const shortage = Number(receiptItem?.shortage_qty ?? 0)
                        const error = receiptQuantityError(qty, Number(receiptForm.getFieldValue('spare_qty') ?? 0), shortage)
                        if (error) throw new Error(error)
                      },
                    },
                  ]}
                >
                  <InputNumber min={0} max={Math.max(Number(receiptItem?.shortage_qty ?? 0), 0)} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item name="spare_qty" label="备品入数" initialValue={0}>
                  <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item name="batch_no" label="批次号">
                  <Input placeholder="可选，例如 2026-07-A" />
                </Form.Item>
              </Col>
              <Col span={24}>
                <Form.Item name="notes" label="备注">
                  <Input placeholder="送货单号、异常说明等" />
                </Form.Item>
              </Col>
            </Row>
          </Form>
        )}

        <Typography.Title level={5}>历史入库批次</Typography.Title>
        <Table
          rowKey="id"
          size="small"
          loading={receiptLoading}
          pagination={false}
          dataSource={receiptRows}
          locale={{ emptyText: '尚无入库记录' }}
          columns={[
            { title: '入库日期', dataIndex: 'receipt_date', width: 110, render: (v) => dayjs(v).format('YYYY-MM-DD') },
            { title: '数量', dataIndex: 'qty', width: 110, align: 'right', render: (v) => Number(v).toLocaleString() },
            { title: '备品入数', dataIndex: 'spare_qty', width: 110, align: 'right', render: (v) => Number(v ?? 0).toLocaleString() },
            { title: '批次号', dataIndex: 'batch_no', width: 140, render: (v) => v || '-' },
            { title: '备注', dataIndex: 'notes', ellipsis: true, render: (v) => v || '-' },
            {
              title: '操作', width: 70,
              render: (_v, r) => (
                <Popconfirm title="删除这条入库记录？欠数会自动恢复。" onConfirm={() => deleteReceipt(r.id)}>
                  <a style={{ color: '#ff4d4f' }}>删除</a>
                </Popconfirm>
              ),
            },
          ]}
        />
      </Modal>

      <Modal
        open={schedPickerOpen}
        title={`从排期选 TOMY PO 下单（未下单 ${schedRows.filter(r => !isSchedulePlaced(r)).length} 行 · 已选 ${pickerSelKeys.length} 行）`}
        width="80vw"
        onCancel={() => { setSchedPickerOpen(false); setPickerSelKeys([]) }}
        footer={null}
        destroyOnClose
      >
        <Space style={{ marginBottom: 8 }} wrap>
          <Input.Search allowClear placeholder="搜索 货号/品名/TOMY PO/第三客户" style={{ width: 320 }}
            onSearch={setSchedPickerFilter} onChange={(e) => !e.target.value && setSchedPickerFilter('')} />
          <Checkbox checked={hidePlaced} onChange={(e) => setHidePlaced(e.target.checked)}>隐藏已有采购记录的排期（含部分下单）</Checkbox>
          <Button type="primary" disabled={!pickerSelKeys.length}
            onClick={() => setMaterialSelection({ mode: 'generate', schedules: selectedSchedRows() })}>
            🏭 选物料后按供应商生成 PO ({pickerSelKeys.length})
          </Button>
          <Button onClick={mergeIntoCurrentPo} disabled={!pickerSelKeys.length}>
            📥 选物料加入当前 PO ({pickerSelKeys.length})
          </Button>
          <Button onClick={createSeparatePos} disabled={!pickerSelKeys.length}>📦 选物料后按排期分单</Button>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            均先勾选对应物料；按排期分单时，不同供应商仍分开下单。
          </Typography.Text>
        </Space>
        <Table
          rowKey={(r: any) => String(r._origIdx)}
          size="small"
          rowSelection={{
            selectedRowKeys: pickerSelKeys,
            onChange: (keys) => setPickerSelKeys(keys),
            preserveSelectedRowKeys: true,   // 跨搜索/翻页保留勾选，可一次选多个货号的行
          }}
          dataSource={schedRows.map((r, i) => ({ ...r, _origIdx: i })).filter(r => {
            if (hidePlaced && isSchedulePlaced(r)) return false  // 隐藏已下单
            if (!schedPickerFilter) return true
            const s = schedPickerFilter.toLowerCase()
            return ((r.code || '') + (r.productName || '') + (r.orderNo || '') + (r.endCustomer || ''))
              .toLowerCase().includes(s)
          })}
          pagination={{ pageSize: 30 }}
          scroll={{ x: 1300, y: 480 }}
          rowClassName={(r) => isSchedulePlaced(r) ? 'po-row-done' : ''}
          columns={[
            {
              title: '操作', width: 60, fixed: 'left',
              render: (_v, r) => <Button size="small" type="link" onClick={() => pickFromSchedule(r)}>选物料</Button>,
            },
            { title: '来源', dataIndex: 'source', width: 70 },
            { title: '国家', dataIndex: 'country', width: 80 },
            { title: '第三客户', dataIndex: 'endCustomer', width: 140, ellipsis: true },
            { title: '货号', dataIndex: 'code', width: 100 },
            { title: '品名', dataIndex: 'productName', width: 200, ellipsis: true },
            {
              title: 'TOMY PO', dataIndex: 'orderNo', width: 130,
              render: (v, r) => v ? (isSchedulePlaced(r) ? <Tag color="default">{v} · 已下</Tag> : <Tag color="blue">{v}</Tag>) : '',
            },
            { title: 'CUST PO', dataIndex: 'customerPO', width: 130 },
            { title: '数量', dataIndex: 'qty', width: 80, align: 'right' },
            { title: '单价USD', dataIndex: 'unitPrice', width: 90, align: 'right', render: (v) => v ? Number(v).toFixed(3) : '' },
            { title: 'PO走货期', dataIndex: 'eta', width: 110 },
          ]}
        />
        <style>{`.po-row-done td { background: #fafafa !important; color: #999 !important; }`}</style>
      </Modal>

      <Modal open={Boolean(lineScheduleLink)} title={`关联排期 · 第 ${(lineScheduleLink?.index ?? 0) + 1} 行 · ${lineScheduleLink?.original.product_code || ''}`}
        width={1000} onCancel={() => { if (!lineLinkLoading) setLineScheduleLink(null) }} onOk={applyLineScheduleLink}
        okText="确认关联" cancelText="取消" okButtonProps={{ disabled: lineLinkLoading || lineLinkSelection == null }}>
        <Typography.Paragraph>最新排期：{lineLinkRevision || '—'}。只显示与该行货号一致的订单，已下单订单也可选择。</Typography.Paragraph>
        <Typography.Paragraph type="warning">确认后替换本行当前关联（{lineScheduleLink?.original.tomy_po || '未关联'}），并带入所选走货期；排期未填走货期则保留原值。采购数量、单价和交货日期不变，最后仍需保存采购单。</Typography.Paragraph>
        <Input.Search placeholder="搜索订单号、客户、走货期" value={lineLinkSearch} onChange={e => setLineLinkSearch(e.target.value)} allowClear style={{ marginBottom: 12 }} />
        <Table size="small" rowKey="_linkIndex" loading={lineLinkLoading} scroll={{ x: 800 }}
          pagination={{ pageSize: 10, showSizeChanger: false }}
          rowSelection={{ type: 'radio', selectedRowKeys: lineLinkSelection == null ? [] : [lineLinkSelection],
            onChange: keys => setLineLinkSelection(keys.length ? Number(keys[0]) : null), preserveSelectedRowKeys: true }}
          dataSource={lineLinkRows.map((row, index) => ({ ...row, _linkIndex: index })).filter(row =>
            lineScheduleLink && matchingLineSchedules(lineScheduleLink.original, [row]).length > 0
            && `${row.orderNo || ''} ${row.customer || ''} ${row.eta || ''}`.toLowerCase().includes(lineLinkSearch.trim().toLowerCase()))}
          columns={[
            { title: '来源', dataIndex: 'source', width: 70 }, { title: '客户', dataIndex: 'customer', width: 100 },
            { title: '货号', dataIndex: 'code', width: 120 }, { title: '排期订单号', dataIndex: 'orderNo', width: 150 },
            { title: '品名', dataIndex: 'productName' }, { title: '排期数量（参考）', dataIndex: 'qty', width: 140 },
            { title: '走货期', dataIndex: 'eta', width: 120 },
          ]} />
      </Modal>

      <Modal
        open={statsOpen}
        title="📋 PO 数据统计"
        footer={null}
        onCancel={() => setStatsOpen(false)}
        width={560}
      >
        <StatsView rows={rows} filtered={filtered} statsByStatus={statsByStatus} />
      </Modal>

      <Modal
        open={mergeOpen}
        title="🔀 合并同名 — 勾选要合并的行（默认全选；按 物料名+规格 分组合并，取消勾选即不参与）"
        width="70vw"
        onCancel={() => setMergeOpen(false)}
        onOk={doMergeSelected}
        okText="合并勾选"
        destroyOnClose
      >
        <Table
          rowKey={(_, i) => String(i)}
          size="small"
          pagination={false}
          scroll={{ y: '55vh' }}
          dataSource={items}
          rowSelection={{ selectedRowKeys: mergeSel, onChange: (k) => setMergeSel(k) }}
          columns={[
            { title: '货号', dataIndex: 'product_code', width: 140 },
            { title: '物料名称', dataIndex: 'material_name', ellipsis: true },
            { title: '规格', dataIndex: 'spec', width: 160, ellipsis: true },
            { title: '用量', dataIndex: 'usage_qty', width: 70, align: 'right' },
            { title: '订单量', dataIndex: 'ordered_qty', width: 90, align: 'right' },
            { title: '物料量', dataIndex: 'material_qty', width: 90, align: 'right' },
            { title: 'TOMY PO', dataIndex: 'tomy_po', width: 130, ellipsis: true },
          ]}
        />
      </Modal>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12, color: '#666' }}>{label}</span>
      {children}
    </label>
  )
}

function StatsView({ rows, filtered, statsByStatus }: { rows: PoSummary[]; filtered: PoSummary[]; statsByStatus: Map<string, number> }) {
  const totalAmount = rows.reduce((s, r) => s + (r.total_amount ?? 0), 0)
  const filteredAmount = filtered.reduce((s, r) => s + (r.total_amount ?? 0), 0)
  const totalItems = rows.reduce((s, r) => s + (r.item_count ?? 0), 0)
  const suppliers = new Set(rows.map(r => r.supplier).filter(Boolean))
  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Card size="small" title="全库">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
          <div>📦 PO 总张数: <b>{rows.length}</b></div>
          <div>🏭 供应商数: <b>{suppliers.size}</b></div>
          <div>📋 明细行数: <b>{totalItems}</b></div>
          <div>💰 金额合计: <b>{totalAmount.toFixed(2)}</b></div>
        </div>
      </Card>
      <Card size="small" title="按状态">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
          {STATUS.map(s => (
            <div key={s.value}>
              <Tag color={s.color}>{s.label}</Tag>
              <b>{statsByStatus.get(s.value) ?? 0}</b> 张
            </div>
          ))}
        </div>
      </Card>
      <Card size="small" title="当前筛选">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
          <div>过滤后张数: <b>{filtered.length}</b></div>
          <div>过滤后金额: <b>{filteredAmount.toFixed(2)}</b></div>
        </div>
      </Card>
    </Space>
  )
}

// Avoid unused warning if DatePicker is removed later
void DatePicker
