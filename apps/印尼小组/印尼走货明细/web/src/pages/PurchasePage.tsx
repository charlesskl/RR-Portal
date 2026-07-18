import { useEffect, useMemo, useState } from 'react'
import {
  App, Button, Card, Checkbox, Col, DatePicker, Drawer, Form, Input, InputNumber, Modal, Popconfirm,
  Row, Select, Space, Table, Tag, Typography,
} from 'antd'
import dayjs from 'dayjs'
import { api } from '../api/client'
import { numToChinese, poDetermineEntity, poGenContractNo, PO_ENTITY_META, type PoEntity } from '../utils/poNumber'

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
  cartons?: number
  unitPrice?: number
  eta?: string
}

interface PoSummary {
  id: number
  po_no?: string
  supplier?: string
  status?: string
  order_date?: string
  delivery_date?: string
  notes?: string
  created_at?: string
  item_count?: number
  total_amount?: number
}

interface PoItem {
  id?: number
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
}

interface PoDetail extends PoSummary {
  items?: PoItem[]
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

export default function PurchasePage() {
  const { message } = App.useApp()
  const [rows, setRows] = useState<PoSummary[]>([])
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
  const [drawerFull, setDrawerFull] = useState(false)
  const [schedRows, setSchedRows] = useState<SchedRow[]>([])
  const [productCodes, setProductCodes] = useState<string[]>([])
  const [placedTomyPos, setPlacedTomyPos] = useState<Set<string>>(new Set())
  const [schedPickerOpen, setSchedPickerOpen] = useState(false)
  const [schedPickerFilter, setSchedPickerFilter] = useState('')
  const [pickerSelKeys, setPickerSelKeys] = useState<React.Key[]>([])
  const [placedSet, setPlacedSet] = useState<Set<string>>(new Set())  // 已下单(自动+手动) orderNo|code
  const [hidePlaced, setHidePlaced] = useState(true)                  // 默认隐藏已下单

  async function load() {
    setLoading(true)
    try {
      const { data } = await api.get<PoSummary[]>('/purchase')
      setRows(Array.isArray(data) ? data : [])
      // Track placed TOMY POs by po_no (used to grey out rows in picker)
      const placed = new Set<string>()
      for (const p of data) if (p.po_no) placed.add(p.po_no)
      setPlacedTomyPos(placed)
    } finally { setLoading(false) }
  }
  async function loadProductCodes() {
    try {
      const { data } = await api.get<{ code?: string }[]>('/products', { params: { includeInactive: true } })
      setProductCodes((data || []).map(p => p.code || '').filter(Boolean))
    } catch {}
  }
  // 把带客户后缀的排期货号(如 47669TSCA)解析到货号库的基础货号(47669)
  function resolveProductCode(code?: string): string {
    const c = (code || '').trim()
    if (!c || productCodes.includes(c)) return c
    const noTail = c.replace(/[A-Za-z]+$/, '')
    if (noTail && productCodes.includes(noTail)) return noTail
    const digits = (c.match(/^\d+/) || [])[0]
    if (digits && productCodes.includes(digits)) return digits
    const pre = productCodes.find(k => k && c.startsWith(k))
    return pre || c
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
    try {
      const { data } = await api.get<string[]>('/schedules/placed-manual')
      for (const k of (Array.isArray(data) ? data : [])) set.add(k)
    } catch {}
    setPlacedSet(set)
  }
  useEffect(() => { load(); loadLatestSchedule(); loadProductCodes(); loadPlaced() }, [])

  function pickFromSchedule(r: SchedRow) {
    // Single-row: auto-fill PO header + add an item line
    form.setFieldsValue({
      po_no: r.orderNo || form.getFieldValue('po_no'),
      supplier: form.getFieldValue('supplier'),
      status: form.getFieldValue('status') || 'draft',
      order_date: form.getFieldValue('order_date') || dayjs().format('YYYY-MM-DD'),
      notes: `关联排期 · ${r.source ?? ''} · ${r.code ?? ''} ${r.productName ?? ''} · 数量 ${r.qty ?? 0}`,
    })
    setItems(its => [
      ...its,
      {
        product_code: r.code,
        qty: r.qty,
        price: r.unitPrice || 0,
        currency: 'US$',
        tomy_po: r.orderNo,
        notes: `${r.productName ?? ''}${r.customerPO ? ' · CUST PO ' + r.customerPO : ''}`,
      },
    ])
    setSchedPickerOpen(false)
    message.success(`已关联 TOMY PO ${r.orderNo ?? ''}`)
  }

  function selectedSchedRows(): SchedRow[] {
    return pickerSelKeys.map(k => schedRows[Number(k)]).filter(Boolean)
  }

  function mergeIntoCurrentPo() {
    const picks = selectedSchedRows()
    if (!picks.length) { message.warning('请先勾选排期行'); return }
    setItems(its => [
      ...its,
      ...picks.map(r => ({
        product_code: r.code,
        qty: r.qty,
        price: r.unitPrice || 0,
        currency: 'US$',
        tomy_po: r.orderNo,
        notes: `${r.orderNo ? 'TOMY PO ' + r.orderNo + ' · ' : ''}${r.productName ?? ''}${r.customerPO ? ' · CUST PO ' + r.customerPO : ''}`,
      })),
    ])
    // Update notes header to log multi-link
    const tomyList = picks.map(r => r.orderNo).filter(Boolean).join(', ')
    if (tomyList) {
      const prev = form.getFieldValue('notes') || ''
      form.setFieldsValue({ notes: prev ? `${prev}\n关联排期 TOMY PO: ${tomyList}` : `关联排期 TOMY PO: ${tomyList}` })
    }
    setSchedPickerOpen(false); setPickerSelKeys([])
    message.success(`已合并 ${picks.length} 行到当前 PO 明细`)
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

  // 按物料供应商聚合：选 N 条排期 → 拉每个货号的物料 → 按 supplier 分桶 → 每个供应商一张 PO
  async function generateBySupplier() {
    const picks = selectedSchedRows()
    if (!picks.length) { message.warning('请先勾选排期行'); return }
    const orderDate = dayjs().format('YYYY-MM-DD')
    // bucket: supplierName -> [{ scheduleRow, material }]
    const buckets = new Map<string, { sched: SchedRow; mat: any }[]>()
    let codeCount = 0
    let matCount = 0
    for (const sr of picks) {
      if (!sr.code) continue
      codeCount++
      try {
        const { data } = await api.get<any[]>('/materials', { params: { code: resolveProductCode(sr.code) } })
        const mats = Array.isArray(data) ? data : []
        for (const m of mats) {
          const sup = (m.supplier || '').trim() || '(无供应商)'
          if (m.active === false) continue
          matCount++
          if (!buckets.has(sup)) buckets.set(sup, [])
          buckets.get(sup)!.push({ sched: sr, mat: m })
        }
      } catch (e: any) {
        console.warn('load materials failed for', sr.code, e)
      }
    }
    if (!buckets.size) {
      message.warning('选中的排期对应的货号下没有物料，请先在货号库录入物料')
      return
    }
    const wcode = askWcode()
    if (wcode === null) return
    let ok = 0, fail = 0, suppliers = 0
    const existingNos = rows.map(r => r.po_no || '').concat([])
    for (const [supplier, lines] of buckets) {
      // 推断实体：用第一条物料的报关公司
      const customsCompany = lines[0]?.mat?.customs_company || ''
      const entity = poDetermineEntity(supplier, customsCompany, undefined)
      const po_no = poGenContractNo(existingNos, entity, wcode)
      existingNos.push(po_no)
      // 与旧系统一致：生成时按 货号 + 物料名 + 规格 合并（合并同货号重复行、累加数量、合并订单号），
      // 不跨货号自动合并；跨货号合并由「🔀 合并同名」手动按钮完成。
      const merged = new Map<string, any>()
      for (const { sched, mat } of lines) {
        const k = `${sched.code ?? ''}|${(mat.name_zh ?? '').trim()}|${(mat.spec ?? '').trim()}`
        const usage = Number(mat.usage_qty ?? 1) || 1
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
      try {
        await api.post('/purchase', {
          po_no, supplier,
          status: 'draft',
          order_date: orderDate,
          notes: `从排期生成 · 货号: ${[...new Set(lines.map(l => l.sched.code))].join(', ')}`,
          items,
        })
        ok++; suppliers++
      } catch { fail++ }
    }
    setSchedPickerOpen(false); setPickerSelKeys([])
    setEditing(null); setCreating(false); setDrawerFull(false)
    message.success(`已生成 ${ok} 张 PO（${suppliers} 个供应商 · 总 ${matCount} 行物料 · ${codeCount} 个货号）${fail ? ` · 失败 ${fail}` : ''}`)
    load()
  }

  async function createSeparatePos() {
    const picks = selectedSchedRows()
    if (!picks.length) { message.warning('请先勾选排期行'); return }
    const orderDate = dayjs().format('YYYY-MM-DD')
    let ok = 0, fail = 0
    for (const r of picks) {
      try {
        await api.post('/purchase', {
          po_no: r.orderNo || '',
          supplier: '',
          status: 'draft',
          order_date: orderDate,
          notes: `关联排期 · ${r.source ?? ''} · ${r.code ?? ''} ${r.productName ?? ''}${r.customerPO ? ' · CUST PO ' + r.customerPO : ''}`,
          items: [{
            product_code: r.code,
            qty: r.qty,
            price: r.unitPrice || 0,
            currency: 'US$',
            tomy_po: r.orderNo,
            notes: r.productName ?? '',
          }],
        })
        ok++
      } catch { fail++ }
    }
    setSchedPickerOpen(false); setPickerSelKeys([])
    setEditing(null); setCreating(false); setDrawerFull(false)
    if (fail) message.warning(`成功 ${ok} 单 · 失败 ${fail} 单`)
    else message.success(`已建 ${ok} 个 PO`)
    load()
  }

  function openCreate() {
    setCreating(true); setEditing({ id: 0, status: 'draft' }); setItems([]); setMergeUndo(null)
    form.resetFields()
    setTimeout(() => form.setFieldsValue({ status: 'draft', order_date: dayjs().format('YYYY-MM-DD') }), 0)
  }
  async function openEdit(p: PoSummary) {
    setCreating(false); setEditing(p)
    form.resetFields()
    setItems([]); setMergeUndo(null)
    try {
      const { data } = await api.get<PoDetail>(`/purchase/${p.id}`)
      form.setFieldsValue({
        po_no: data.po_no, supplier: data.supplier, status: data.status,
        order_date: data.order_date ? dayjs(data.order_date).format('YYYY-MM-DD') : '',
        delivery_date: data.delivery_date ? dayjs(data.delivery_date).format('YYYY-MM-DD') : '',
        notes: data.notes,
      })
      const rawItems = Array.isArray(data.items) ? data.items : []
      const materialLists = new Map<string, any[]>()
      const codes = [...new Set(rawItems.map(it => String(it.product_code || '').split(/\s*\/\s*/)[0]).filter(Boolean))]
      await Promise.all(codes.map(async code => {
        try {
          const { data: mats } = await api.get<any[]>('/materials', { params: { code: resolveProductCode(code) } })
          materialLists.set(code, Array.isArray(mats) ? mats : [])
        } catch { materialLists.set(code, []) }
      }))
      setItems(rawItems.map(it => {
        const code = String(it.product_code || '').split(/\s*\/\s*/)[0]
        const mat = (materialLists.get(code) || []).find(m => m.id === it.material_id)
        const wasLegacyUnitLayout = !it.ship_unit && !!mat?.unit_kg && it.purchase_unit === mat.unit_kg
        const schedule = schedRows.find(s =>
          String(it.product_code || '').split(/\s*\/\s*/).includes(String(s.code || ''))
          && (!it.tomy_po || String(it.tomy_po).split(/\s*[;，]\s*/).includes(String(s.orderNo || '')))
        )
        return applyAutoSpoilage({
          ...it,
          purchase_unit: wasLegacyUnitLayout ? '个' : (it.purchase_unit || '个'),
          // 走货单位以物料库为准，避免采购单里的旧值（如误存 TNE）覆盖 KGM。
          ship_unit: mat?.unit_kg || it.ship_unit || 'PCE',
          net_per_pc: Number(it.net_per_pc) || Number(mat?.net_per_pc) || 0,
          eta: it.eta || schedule?.eta || '',
        })
      }))
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
    const payload = {
      ...v,
      order_date: normalizeDate(v.order_date),
      delivery_date: normalizeDate(v.delivery_date),
      items,
    }
    try {
      if (creating) {
        const { data } = await api.post<{ id?: number }>('/purchase', payload)
        message.success('已新建')
        // 切到编辑态，留在当前页（后续保存走更新）
        setCreating(false)
        setEditing({ ...(editing as any), id: data?.id ?? editing?.id, po_no: v.po_no, supplier: v.supplier, status: v.status })
      } else if (editing) {
        await api.put(`/purchase/${editing.id}`, payload)
        message.success('已更新')
      }
      load()  // 后台刷新列表，不关闭抽屉
    } catch {
      /* 拦截器已提示 */
    }
  }
  async function del(id: number) {
    try {
      await api.delete(`/purchase/${id}`)
      message.success('已删除'); load()
    } catch { /* 拦截器已提示 */ }
  }

  const [poSelKeys, setPoSelKeys] = useState<React.Key[]>([])
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
      const existingNos: string[] = []
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

  // Export the single PO currently being edited
  async function exportSingle() {
    if (!editing?.id) { message.warning('请先打开 / 保存一张 PO'); return }
    const XLSX = await import('xlsx-js-style')
    const v = form.getFieldsValue()
    const poNo = v.po_no || String(editing.id)
    const supplier = v.supplier || ''
    // 实体由 PO 号前缀推断（IRRM→华登全球 / IRRI→华登实业 / 年份→华胜益）
    let entity: PoEntity = 'HD_INDUSTRY'
    if (/^IRRM/i.test(poNo)) entity = 'HD_GLOBAL'
    else if (/^IRRI/i.test(poNo)) entity = 'HD_INDUSTRY'
    else if (/^\d{4}/.test(poNo)) entity = 'HSY'
    const meta = PO_ENTITY_META[entity]
    const today = new Date()
    const todayStr = today.getFullYear() + '/' + String(today.getMonth() + 1).padStart(2, '0') + '/' + String(today.getDate()).padStart(2, '0')
    const todayCN = today.getFullYear() + '年' + (today.getMonth() + 1) + '月' + today.getDate() + '日'
    const deliveryDay = v.delivery_date ? dayjs(v.delivery_date) : null
    const deliveryDateCN = deliveryDay?.isValid()
      ? deliveryDay.year() + '年' + (deliveryDay.month() + 1) + '月' + deliveryDay.date() + '日'
      : todayCN.replace(String(today.getFullYear()), String(today.getFullYear() + 1))
    // 按 (货号+物料+规格) 聚合：合同数量/单位/单价使用走货口径，金额保持与采购口径一致。
    const merged = new Map<string, any>()
    for (const it of items) {
      const k = (it.product_code || '') + '||' + (it.material_name || '') + '||' + (it.spec || '')
      const cur = merged.get(k) || { code: it.product_code || '', matName: it.material_name || '', spec: it.spec || '', unit: it.ship_unit || 'PCE', totalShipQty: 0, totalAmount: 0, totalTomyQty: 0 }
      const purchaseQty = Number(it.purchase_qty ?? ((it.material_qty || 0) + (it.spoilage_qty || 0))) || 0
      cur.totalShipQty += shipQuantity(it)
      cur.totalAmount += purchaseQty * (Number(it.price) || 0)
      cur.totalTomyQty += Number(it.ordered_qty) || 0
      merged.set(k, cur)
    }
    const mergedRows = [...merged.values()]
    let totalAmount = 0
    mergedRows.forEach(m => totalAmount += m.totalAmount || 0)

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
    rows.push(['货 号', '货品名称', '规格型号', '数量', '单位', '单 价 (' + meta.currency + ')', '金额', '备 注'])
    const itemStart = rows.length
    for (const m of mergedRows) {
      const shipUnitPrice = m.totalShipQty > 0 ? m.totalAmount / m.totalShipQty : 0
      const contractUnit = contractUnitLabel(m.unit)
      rows.push([m.code, m.matName, m.spec, Number(m.totalShipQty.toFixed(shipQuantityDigits(m.unit))), contractUnit, Number(shipUnitPrice.toFixed(4)), Number(m.totalAmount.toFixed(2)), '数量：' + m.totalTomyQty + 'pcs'])
    }
    rows.push(['以下空白！', '按工程签板生产！', '', '', '', '', '', ''])
    const sumRow = rows.length
    rows.push(['', '', '', '', '', '合计', Number(totalAmount.toFixed(2)), ''])
    rows.push(['', '', '', '', '', '大写', meta.currency === 'RMB' ? '人民币' : '美金', numToChinese(totalAmount)])
    rows.push(PAD(8))
    rows.push(['1.  ' + deliveryDateCN + '前交货', ...PAD(7)])
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
      const excelRow = r + 1
      const amountAddr = XLSX.utils.encode_cell({ r, c: 6 })
      ;(ws as any)[amountAddr] = {
        t: 'n',
        v: Number(rows[r][6]) || 0,
        f: `ROUND(D${excelRow}*F${excelRow},2)`,
        z: '0.00',
      }
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
    mg(sumRow, 6, sumRow, 7)
    for (let r = sumRow + 3; r < rows.length - 2; r++) { if (String(rows[r][0] || '')) mg(r, 0, r, 7) }
    mg(rows.length - 2, 1, rows.length - 2, 3); mg(rows.length - 2, 5, rows.length - 2, 7)
    mg(rows.length - 1, 1, rows.length - 1, 3); mg(rows.length - 1, 5, rows.length - 1, 7)
    ws['!cols'] = [{ wch: 12 }, { wch: 22 }, { wch: 16 }, { wch: 10 }, { wch: 8 }, { wch: 13 }, { wch: 13 }, { wch: 18 }]
    const rowH: any[] = [{ hpt: 30 }, { hpt: 18 }, { hpt: 18 }, { hpt: 24 }, { hpt: 10 }, { hpt: 22 }, { hpt: 22 }, { hpt: 10 }, { hpt: 26 }]
    // 所有物料明细行使用相同行高；多行名称/规格仍可完整换行显示。
    for (let r = itemStart; r < itemStart + mergedRows.length; r++) rowH[r] = { hpt: 45 }
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
    for (let c = 0; c < 8; c++) setStyle(hdrRow, c, { font: { bold: true, sz: 12 }, alignment: center, border })
    for (let r = itemStart; r <= sumRow + 1; r++) for (let c = 0; c < 8; c++) setStyle(r, c, { font: { sz: 11 }, alignment: center, border })
    for (let r = sumRow + 3; r < rows.length - 2; r++) setStyle(r, 0, { font: { sz: 11 }, alignment: left })
    // 三条合同说明各自加完整格子边框，与上方明细表保持一致。
    for (let r = sumRow + 3; r <= sumRow + 5; r++) {
      for (let c = 0; c < 8; c++) setStyle(r, c, { font: { sz: 11 }, alignment: left, border })
    }
    for (const r of [rows.length - 2, rows.length - 1]) {
      setStyle(r, 0, { font: { sz: 12 }, alignment: { horizontal: 'right', vertical: 'center' } })
      setStyle(r, 1, { font: { sz: 12 }, alignment: left })
      setStyle(r, 4, { font: { sz: 12 }, alignment: { horizontal: 'right', vertical: 'center' } })
      setStyle(r, 5, { font: { sz: 12 }, alignment: left })
    }

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '购销合同')
    XLSX.writeFile(wb, `${poNo}_${supplier}_购销合同.xlsx`)
    message.success('已导出购销合同')
  }

  // Merge multiple POs of the same supplier into one (keeps earliest PO's header)
  async function mergeSameSupplier() {
    if (!poSelKeys.length) { message.warning('请先勾选 2 张以上同供应商的 PO'); return }
    const picked = rows.filter(r => poSelKeys.includes(r.id))
    if (picked.length < 2) { message.warning('至少选 2 张'); return }
    const suppliers = new Set(picked.map(p => p.supplier ?? ''))
    if (suppliers.size > 1) { message.warning('选中的 PO 不是同一供应商，无法合并'); return }
    setLoading(true)
    try {
      // Sort by id ASC, keep the first as host
      picked.sort((a, b) => a.id - b.id)
      const host = picked[0]
      const others = picked.slice(1)
      // Load all details + concat items
      const dets = await Promise.all(picked.map(p => api.get<PoDetail>(`/purchase/${p.id}`).then(r => r.data)))
      const allItems = dets.flatMap(d => d.items ?? [])
      // Delete others
      for (const o of others) await api.delete(`/purchase/${o.id}`)
      // Recreate host with merged items (legacy backend can't update items, so delete + insert)
      await api.delete(`/purchase/${host.id}`)
      await api.post('/purchase', {
        po_no: host.po_no, supplier: host.supplier, status: host.status,
        order_date: host.order_date,
        notes: (host.notes ?? '') + ` · 已合并 ${others.length} 张：${others.map(o => o.po_no).join(', ')}`,
        items: allItems.map(it => ({
          product_code: it.product_code,
          material_id: it.material_id,
          material_name: it.material_name,
          qty: it.qty,
          price: it.price,
          currency: it.currency,
          notes: it.notes,
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
          tomy_po: it.tomy_po,
        })),
      })
      message.success(`已合并 ${picked.length} 张 PO 为一张（${host.po_no}）`)
      setPoSelKeys([])
      load()
    } catch {
      /* 拦截器已提示 */
    } finally { setLoading(false) }
  }

  function patchItem(i: number, k: keyof PoItem, v: any) {
    setItems(its => its.map((it, idx) => {
      if (idx !== i) return it
      const next: PoItem = { ...it, [k]: v }
      // Auto compute material_qty + purchase_qty
      if (k === 'ordered_qty' || k === 'usage_qty') {
        const mat = (next.ordered_qty ?? 0) * (next.usage_qty ?? 1)
        next.material_qty = mat
        return applyAutoSpoilage(next)
      }
      if (k === 'category') {
        return applyAutoSpoilage(next)
      }
      if (k === 'spoilage_qty') {
        next.purchase_qty = (next.material_qty ?? 0) + (next.spoilage_qty ?? 0)
        next.qty = next.purchase_qty
      }
      return next
    }))
  }
  function addItem() {
    const poNo = String(form.getFieldValue('po_no') || '')
    const cur = /^\d{4}\d/.test(poNo) ? '¥' : 'US$'   // 年份号=华胜益→¥，否则默认美金
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
      const k = (it.material_name || '').trim() + '||' + (it.spec || '').trim()
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
      const k = (it.material_name || '').trim() + '||' + (it.spec || '').trim()
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

  // 套用报价: for each item, look up quotes by (supplier, name_zh~=notes, spec, qty) and set price
  async function applyQuotes() {
    try {
      const { data: quotes } = await api.get<any[]>('/quotes/blob')
      const supplier = form.getFieldValue('supplier') as string ?? ''
      if (!supplier) { message.warning('请先填供应商'); return }
      let hit = 0
      const next = items.map(it => {
        const matName = (it.material_name ?? '').trim()
          || ((it.notes ?? '').split('·')[1]?.replace(/\(.*\)/, '').trim() ?? '')
        const nameGroup = (quotes ?? []).filter((q: any) =>
          (q.supplier ?? '').trim() === supplier.trim()
          && ((q.matName ?? '').trim() === matName || (matName && matName.includes((q.matName ?? '').trim())))
        )
        const normalizeSpec = (value: unknown) => String(value ?? '')
          .trim().toUpperCase().replace(/[×*]/g, 'X').replace(/\s+/g, '')
        const exactGroup = nameGroup.filter((q: any) => normalizeSpec(q.spec) === normalizeSpec(it.spec))
        const quoteSpecs = new Set(nameGroup.map((q: any) => normalizeSpec(q.spec)))
        // 规格优先精确匹配；名称下只有一种报价规格时，允许名称唯一回退。
        const sameGroup = exactGroup.length ? exactGroup : (quoteSpecs.size === 1 ? nameGroup : [])
        if (!sameGroup.length) return it
        // 报价档位使用报价单的采购口径；导出合同时再换算为走货数量/单价。
        const qty = it.purchase_qty ?? it.qty ?? 0
        sameGroup.sort((a: any, b: any) => (Number(a.minQty) || 0) - (Number(b.minQty) || 0))
        let pick = sameGroup[0]
        for (const q of sameGroup) if ((Number(q.minQty) || 0) <= qty) pick = q
        if (Number(pick.unitPrice) > 0) {
          hit++
          return { ...it, price: Number(pick.unitPrice), currency: pick.currency || it.currency }
        }
        return it
      })
      setItems(next)
      message.success(`已套用报价：${hit}/${items.length} 行`)
    } catch {
      /* 拦截器已提示 */
    }
  }

  // 回填单个净重和走货单位，用于计算 KGM 走货数量。
  async function backfillNetWeight() {
    let hit = 0
    const next = await Promise.all(items.map(async (it) => {
      if (!it.material_id) return it
      try {
        // Fetch the material via product code (need to find material by id; backend has no by-id route in legacy, but we get a list and find)
        if (!it.product_code) return it
        const { data: mats } = await api.get<any[]>('/materials', { params: { code: it.product_code } })
        const mat = (mats || []).find(m => m.id === it.material_id)
        if (!mat) return it
        const netPerPc = Number(mat.net_per_pc) || 0
        if (netPerPc <= 0) return it
        hit++
        return { ...it, net_per_pc: netPerPc, ship_unit: mat.unit_kg || 'KGM' }
      } catch { return it }
    }))
    setItems(next)
    message.success(`已回填净重：${hit}/${items.length} 行`)
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

  const statsByStatus = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rows) m.set(r.status || 'draft', (m.get(r.status || 'draft') ?? 0) + 1)
    return m
  }, [rows])

  const totalItems = useMemo(() => items.reduce((s, it) => s + (it.qty ?? 0) * (it.price ?? 0), 0), [items])

  return (
    <div style={{ padding: 16 }}>
      <Card
        title={`采购订单 — 共 ${rows.length} 张`}
        extra={
          <Space wrap size={[4, 8]}>
            <Input.Search allowClear placeholder="搜索 PO / 供应商 / 备注" style={{ width: 220 }}
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
            <Popconfirm
              title={`合并选中的 ${poSelKeys.length} 张 PO 为一张（须同供应商）`}
              onConfirm={mergeSameSupplier}
              disabled={poSelKeys.length < 2}
            >
              <Button disabled={poSelKeys.length < 2}>🔗 合并同名 ({poSelKeys.length})</Button>
            </Popconfirm>
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
          dataSource={filtered}
          rowSelection={{
            selectedRowKeys: poSelKeys,
            onChange: (keys) => setPoSelKeys(keys),
          }}
          pagination={{ defaultPageSize: 50, showSizeChanger: true }}
          columns={[
            { title: 'PO 号', dataIndex: 'po_no', width: 160 },
            { title: '供应商', dataIndex: 'supplier' },
            {
              title: '状态', dataIndex: 'status', width: 100,
              render: (v) => {
                const s = STATUS.find(x => x.value === v) ?? STATUS[0]
                return <Tag color={s.color}>{s.label}</Tag>
              },
            },
            { title: '下单日期', dataIndex: 'order_date', width: 120, render: (v) => v ? dayjs(v).format('YYYY-MM-DD') : '' },
            { title: '行数', dataIndex: 'item_count', width: 70, align: 'right' },
            { title: '金额', dataIndex: 'total_amount', width: 110, align: 'right', render: (v) => v != null ? Number(v).toFixed(2) : '' },
            {
              title: '操作', width: 130,
              render: (_v, r) => (
                <Space>
                  <a onClick={() => openEdit(r)}>编辑</a>
                  <Popconfirm title={`删除 PO ${r.po_no}?`} onConfirm={() => del(r.id)}>
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
        width={drawerFull ? '100vw' : '60vw'}
        title={creating ? '新建采购订单' : `编辑 PO — ${editing?.po_no || editing?.id}`}
        onClose={() => { setEditing(null); setCreating(false); setDrawerFull(false) }}
        destroyOnClose
        extra={
          <Space>
            <Button onClick={() => setSchedPickerOpen(true)}>🔗 从排期选</Button>
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
              <Form.Item name="delivery_date" label="交货日期"
                getValueProps={(val) => ({ value: val ? dayjs(val) : null })}
                normalize={(val: any) => (val ? dayjs(val).format('YYYY-MM-DD') : '')}>
                <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
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
            scroll={{ x: 2500, y: 'calc(100vh - 330px)' }}
            columns={[
              { title: '#', width: 40, fixed: 'left', render: (_v, _r, i) => i + 1 },
              { title: '货号', width: 100, fixed: 'left', render: (_v, r, i) => <Input size="small" value={r.product_code} onChange={(e) => patchItem(i, 'product_code', e.target.value)} /> },
              { title: '物料名称', width: 180, fixed: 'left', render: (_v, r, i) => <Input size="small" value={r.material_name} onChange={(e) => patchItem(i, 'material_name', e.target.value)} /> },
              { title: '类别', width: 80, render: (_v, r, i) => <Input size="small" value={r.category} onChange={(e) => patchItem(i, 'category', e.target.value)} /> },
              { title: '规格', width: 140, render: (_v, r, i) => <Input size="small" value={r.spec} onChange={(e) => patchItem(i, 'spec', e.target.value)} /> },
              { title: '用量', width: 80, render: (_v, r, i) => <InputNumber size="small" min={0} step={0.001} value={r.usage_qty} onChange={(v) => patchItem(i, 'usage_qty', v ?? 0)} style={{ width: '100%' }} /> },
              { title: '订单量', width: 100, render: (_v, r, i) => <InputNumber size="small" min={0} value={r.ordered_qty} onChange={(v) => patchItem(i, 'ordered_qty', v ?? 0)} style={{ width: '100%' }} /> },
              { title: '物料量', width: 100, align: 'right', render: (_v, r) => Number(r.material_qty ?? 0).toFixed(2) },
              { title: '损耗量', width: 90, render: (_v, r, i) => <InputNumber size="small" min={0} value={r.spoilage_qty} onChange={(v) => patchItem(i, 'spoilage_qty', v ?? 0)} style={{ width: '100%' }} /> },
              { title: '采购量', width: 100, align: 'right', render: (_v, r) => <b style={{ color: '#1677ff' }}>{Number(r.purchase_qty ?? r.qty ?? 0).toFixed(2)}</b> },
              { title: '单价', width: 110, render: (_v, r, i) => <InputNumber size="small" min={0} step={0.0001} value={r.price} onChange={(v) => patchItem(i, 'price', v ?? 0)} style={{ width: '100%' }} /> },
              { title: '金额', width: 100, align: 'right', render: (_v, r) => <b style={{ color: '#c0392b' }}>{((r.purchase_qty ?? r.qty ?? 0) * (r.price ?? 0)).toFixed(2)}</b> },
              { title: '采购单位', width: 90, render: (_v, r, i) => (
                <Select size="small" value={r.purchase_unit || '个'} style={{ width: '100%' }}
                  options={['个', '只', '米'].map(x => ({ value: x, label: x }))}
                  onChange={(v) => patchItem(i, 'purchase_unit', v)} />
              ) },
              { title: '走货单位', width: 90, render: (_v, r, i) => (
                <Select size="small" value={r.ship_unit || 'PCE'} style={{ width: '100%' }}
                  options={['PCE', 'KGM', 'MTR', 'SET', 'PAR', 'ROLL', 'TNE'].map(x => ({ value: x, label: x }))}
                  onChange={(v) => patchItem(i, 'ship_unit', v)} />
              ) },
              { title: '走货数量', width: 100, align: 'right', render: (_v, r) => <b style={{ color: '#28a06a' }}>{shipQuantity(r).toFixed(shipQuantityDigits(r.ship_unit))}</b> },
              { title: '走货单价', width: 100, align: 'right', render: (_v, r) => {
                const shipQty = shipQuantity(r)
                const amount = Number(r.purchase_qty ?? r.qty ?? 0) * Number(r.price ?? 0)
                return <b style={{ color: '#2878c8' }}>{shipQty > 0 ? (amount / shipQty).toFixed(4) : '0.0000'}</b>
              } },
              { title: '交货时间', width: 110, render: () => deliveryDate || '' },
              { title: '走货期', width: 110, render: (_v, r, i) => <Input size="small" value={r.eta} onChange={(e) => patchItem(i, 'eta', e.target.value)} /> },
              { title: '币种', width: 100, render: (_v, r, i) => <Select size="small" value={r.currency || '¥'} options={CURR} onChange={(v) => patchItem(i, 'currency', v)} style={{ width: '100%' }} /> },
              { title: '备注', width: 180, render: (_v, r, i) => <Input size="small" value={r.notes} onChange={(e) => patchItem(i, 'notes', e.target.value)} /> },
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

      <Modal
        open={schedPickerOpen}
        title={`从排期选 TOMY PO 下单（共 ${schedRows.length} 行 · 已选 ${pickerSelKeys.length} 行）`}
        width="80vw"
        onCancel={() => { setSchedPickerOpen(false); setPickerSelKeys([]) }}
        footer={null}
        destroyOnClose
      >
        <Space style={{ marginBottom: 8 }} wrap>
          <Input.Search allowClear placeholder="搜索 货号/品名/TOMY PO/第三客户" style={{ width: 320 }}
            onSearch={setSchedPickerFilter} onChange={(e) => !e.target.value && setSchedPickerFilter('')} />
          <Checkbox checked={hidePlaced} onChange={(e) => setHidePlaced(e.target.checked)}>隐藏已下单</Checkbox>
          <Popconfirm title={`按物料供应商聚合：每个供应商生成一张 PO（包含他名下所有物料）？`} onConfirm={generateBySupplier} disabled={!pickerSelKeys.length}>
            <Button type="primary" disabled={!pickerSelKeys.length}>
              🏭 按物料供应商聚合生成 PO ({pickerSelKeys.length})
            </Button>
          </Popconfirm>
          <Button onClick={mergeIntoCurrentPo} disabled={!pickerSelKeys.length}>
            📥 合并 {pickerSelKeys.length || ''} 行到当前 PO 明细
          </Button>
          <Popconfirm title={`一次性建 ${pickerSelKeys.length} 个采购单，每个对应一条排期行？`} onConfirm={createSeparatePos} disabled={!pickerSelKeys.length}>
            <Button disabled={!pickerSelKeys.length}>📦 按选中行 · 各建一张 PO（不拆物料）</Button>
          </Popconfirm>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            🏭 = 按物料供应商聚合 (常用) · 📥 = 合并到当前 PO · 📦 = 一行一张 PO
          </Typography.Text>
        </Space>
        <Table
          rowKey={(r: any) => String(r._origIdx)}
          size="small"
          rowSelection={{
            selectedRowKeys: pickerSelKeys,
            onChange: (keys) => setPickerSelKeys(keys),
            getCheckboxProps: (r: any) => ({ disabled: !!(r.orderNo && placedTomyPos.has(r.orderNo)) }),
            preserveSelectedRowKeys: true,   // 跨搜索/翻页保留勾选，可一次选多个货号的行
          }}
          dataSource={schedRows.map((r, i) => ({ ...r, _origIdx: i })).filter(r => {
            if (hidePlaced && r.orderNo && r.code && placedSet.has(`${r.orderNo}|${r.code}`)) return false  // 隐藏已下单
            if (!schedPickerFilter) return true
            const s = schedPickerFilter.toLowerCase()
            return ((r.code || '') + (r.productName || '') + (r.orderNo || '') + (r.endCustomer || ''))
              .toLowerCase().includes(s)
          })}
          pagination={{ pageSize: 30 }}
          scroll={{ x: 1300, y: 480 }}
          rowClassName={(r) => r.orderNo && placedTomyPos.has(r.orderNo) ? 'po-row-done' : ''}
          columns={[
            {
              title: '操作', width: 60, fixed: 'left',
              render: (_v, r) => <Button size="small" type="link" onClick={() => pickFromSchedule(r)} disabled={!!(r.orderNo && placedTomyPos.has(r.orderNo))}>➕</Button>,
            },
            { title: '来源', dataIndex: 'source', width: 70 },
            { title: '国家', dataIndex: 'country', width: 80 },
            { title: '第三客户', dataIndex: 'endCustomer', width: 140, ellipsis: true },
            { title: '货号', dataIndex: 'code', width: 100 },
            { title: '品名', dataIndex: 'productName', width: 200, ellipsis: true },
            {
              title: 'TOMY PO', dataIndex: 'orderNo', width: 130,
              render: (v) => v ? (placedTomyPos.has(v) ? <Tag color="default">{v} · 已下</Tag> : <Tag color="blue">{v}</Tag>) : '',
            },
            { title: 'CUST PO', dataIndex: 'customerPO', width: 130 },
            { title: '数量', dataIndex: 'qty', width: 80, align: 'right' },
            { title: '单价USD', dataIndex: 'unitPrice', width: 90, align: 'right', render: (v) => v ? Number(v).toFixed(3) : '' },
            { title: 'PO走货期', dataIndex: 'eta', width: 110 },
          ]}
        />
        <style>{`.po-row-done td { background: #fafafa !important; color: #999 !important; }`}</style>
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
