import { useEffect, useMemo, useState } from 'react'
import {
  App, AutoComplete, Button, Card, Col, DatePicker, Drawer, Form, Input, InputNumber, Modal, Popconfirm,
  Row, Select, Space, Table, Tag, Typography,
} from 'antd'
import dayjs from 'dayjs'
import { api } from '../api/client'

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
  id?: number
  material_id?: number
  seq?: number
  kg?: number
  qty?: number
  cartons?: number
  qty_per_carton?: string
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
  material_id?: number
  code?: string
  name_zh?: string
  total_out?: number
  po_nos?: string
  last_out_date?: string
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

export default function ShipmentsPage() {
  const { message } = App.useApp()
  const [rows, setRows] = useState<ShipmentSummary[]>([])
  const [filter, setFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [customerFilter, setCustomerFilter] = useState('')
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<ShipmentDetail | null>(null)
  const [creating, setCreating] = useState(false)
  const [items, setItems] = useState<ShipmentItem[]>([])
  const [form] = Form.useForm<ShipmentForm>()
  const [drawerFull, setDrawerFull] = useState(false)
  const [customers, setCustomers] = useState<string[]>([])
  const [selKeys, setSelKeys] = useState<React.Key[]>([])
  const [schedRows, setSchedRows] = useState<any[]>([])
  const [schedPickerOpen, setSchedPickerOpen] = useState(false)
  const [schedPickerFilter, setSchedPickerFilter] = useState('')
  const [schedPickerSel, setSchedPickerSel] = useState<React.Key[]>([])
  // 从出库拉物料
  const [outRows, setOutRows] = useState<OutByMat[]>([])
  const [shippedIds, setShippedIds] = useState<Set<number>>(new Set())  // 已走货物料
  const [outOpen, setOutOpen] = useState(false)
  const [outFilter, setOutFilter] = useState('')
  const [outSel, setOutSel] = useState<React.Key[]>([])
  // 按货号选物料（补充）
  const [manOpen, setManOpen] = useState(false)
  const [manCode, setManCode] = useState('')
  const [manMats, setManMats] = useState<any[]>([])
  const [manSel, setManSel] = useState<React.Key[]>([])
  const [productCodes, setProductCodes] = useState<string[]>([])
  // 数据核对报告
  const [valOpen, setValOpen] = useState(false)
  const [valReport, setValReport] = useState<{ hard: string[]; warn: string[] }>({ hard: [], warn: [] })
  // 物料主数据映射（录入表显示只读列 + 计算列 + 写回尺寸）
  const [matMap, setMatMap] = useState<Map<number, any>>(new Map())
  const [dirtyMatIds, setDirtyMatIds] = useState<Set<number>>(new Set())
  // material_id → 出库总量（按货号选物料时带入数量）
  const outByMat = useMemo(() => {
    const m = new Map<number, number>()
    for (const o of outRows) if (o.material_id != null) m.set(o.material_id, Number(o.total_out) || 0)
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
      const { data: list } = await api.get<{ id: number }[]>('/schedules')
      if (!list?.length) return
      const top = list[0]
      const { data: det } = await api.get<{ raw_rows?: string }>(`/schedules/${top.id}`)
      const parsed = det.raw_rows ? JSON.parse(det.raw_rows) : []
      setSchedRows(Array.isArray(parsed) ? parsed : [])
    } catch {}
  }
  useEffect(() => { load(); loadCustomers(); loadLatestSchedule(); loadOutbound(); loadProductCodes() }, [])

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
  function makeItem(m: any, qty: number, opts: { poInfo?: { po: any; it: any }; poNo?: string; productUse?: string } = {}): ShipmentItem {
    const netPerPc = Number(m.net_per_pc) || 0
    const kg = (m.unit_kg || 'KGM') === 'KGM' ? qty * netPerPc : qty   // KGM→净重；个数→数量
    const qtyPerCarton = Number(m.qty_per_carton) || 0
    const cartons = qtyPerCarton > 0 ? Math.ceil(qty / qtyPerCarton) : 0
    const poInfo = opts.poInfo
    return {
      material_id: m.id,
      qty, kg, cartons,
      qty_per_carton: qtyPerCarton > 0 ? String(qtyPerCarton) : '',
      price: poInfo?.it?.price ?? 0,
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
    setItems(its => {
      const merged = [...its, ...newItems].map((it, i) => ({ ...it, seq: i + 1 }))
      loadMatsForItems(merged.map(x => x.material_id))
      return merged
    })
  }

  // 加载这些物料的主数据（显示只读列 + 计算 + 写回基准）
  async function loadMatsForItems(idsRaw: (number | undefined)[]) {
    const ids = [...new Set(idsRaw.filter((x): x is number => x != null))]
    const missing = ids.filter(id => !matMap.has(id))
    if (!missing.length) return
    try {
      const { data } = await api.get<any[]>('/materials/by-ids', { params: { ids: missing.join(',') } })
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
    const grossTotal = num(m?.gross_per_pc) * num(it.qty)
    const netTotal = num(m?.net_per_pc) * num(it.qty)
    const cbmEach = num(m?.length) * num(m?.width) * num(m?.height) / 1e6
    const cbmTotal = cbmEach * num(it.cartons)
    const invoiceAmount = num(it.invoice_price) * num(it.qty)
    const purchaseAmount = num(it.price) * num(it.qty)
    return { m, grossTotal, netTotal, cbmEach, cbmTotal, invoiceAmount, purchaseAmount }
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

  async function loadOutbound() {
    try { const { data } = await api.get<OutByMat[]>('/outbound/by-material'); setOutRows(Array.isArray(data) ? data : []) } catch {}
    try { const { data } = await api.get<number[]>('/shipments/shipped-material-ids'); setShippedIds(new Set(Array.isArray(data) ? data : [])) } catch {}
  }
  async function loadProductCodes() {
    try { const { data } = await api.get<{ code: string }[]>('/products'); setProductCodes((data || []).map(p => p.code).filter(Boolean)) } catch {}
  }

  // 从出库拉物料：数量 = Σ出库量（已按物料合并）
  async function pullFromOutbound() {
    const picked = outSel.map(k => outRows.find(o => String(o.material_id) === String(k))).filter(Boolean) as OutByMat[]
    if (!picked.length) { message.warning('请先勾选出库物料'); return }
    const matToPo = await buildMatToPo()
    const matsByCode = await loadMatsByCodes(picked.map(o => o.code ?? ''))
    const newItems: ShipmentItem[] = []
    for (const o of picked) {
      const mats = matsByCode.get(o.code ?? '') ?? []
      const m = mats.find(x => String(x.id) === String(o.material_id))
      if (!m) continue
      newItems.push(makeItem(m, Number(o.total_out) || 0, {
        poInfo: m.id ? matToPo.get(m.id) : undefined,
        poNo: o.po_nos || undefined,
      }))
    }
    appendItems(newItems)
    applyPartition([...items, ...newItems])
    setOutOpen(false); setOutSel([])
    message.success(`已从出库拉出 ${newItems.length} 条物料明细`)
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

  function openCreate() {
    setCreating(true); setEditing({ id: 0, status: 'draft', rate: 0.93, container_count: 1 })
    setItems([]); setMatMap(new Map()); setDirtyMatIds(new Set())
    form.resetFields()
    setTimeout(() => form.setFieldsValue({
      status: 'draft',
      rate: 0.93,
      container_count: 1,
      ship_date: dayjs().format('YYYY-MM-DD'),
    }), 0)
  }
  async function openEdit(s: ShipmentSummary) {
    setCreating(false); setEditing(s)
    form.resetFields(); setItems([]); setMatMap(new Map()); setDirtyMatIds(new Set())
    try {
      const { data } = await api.get<ShipmentDetail>(`/shipments/${s.id}`)
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
      const its = Array.isArray(data.items) ? data.items : []
      setItems(its)
      loadMatsForItems(its.map(x => x.material_id))
    } catch (e: any) {
      message.error('加载失败: ' + (e?.message ?? e))
    }
  }
  async function save() {
    const v = await form.validateFields()
    try {
      // 空字符串日期 → null，否则后端 DateTime? 绑定失败 400
      const dOrNull = (x: any) => (x ? x : null)
      const cleanItems = items.map(it => ({
        ...it,
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
        await api.post('/shipments', body)
        message.success('已新建')
      } else if (editing) {
        await api.put(`/shipments/${editing.id}`, body)
        message.success('已更新')
      }
      // 写回货号库：被改过尺寸/毛净重/单位的物料
      if (dirtyMatIds.size) {
        await Promise.all([...dirtyMatIds].map(id => {
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
      setEditing(null); setCreating(false); setDrawerFull(false)
      load()
    } catch {
      /* 拦截器已提示 */
    }
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
  // 数据核对：完全对齐旧系统 runValidation —— 硬性拦截 + 警告不拦截。返回 {hard,warn}
  const decimals = (n: any) => { const s = String(n ?? ''); const i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1 }
  async function computeValidation(): Promise<{ hard: string[]; warn: string[] }> {
    const v = form.getFieldsValue()
    const hard: string[] = [], warn: string[] = []
    if (!(v.container_no || '').trim()) hard.push('整柜信息：柜号必填')
    if (!v.ship_date) hard.push('整柜信息：走柜日期必填')
    if (!v.rate || v.rate <= 0) hard.push('整柜信息：汇率必须 > 0')
    if (!items.length) warn.push('没有任何明细行（对应旧系统“未勾选需填物料”）')
    const parts = new Set(items.map(it => partitionOf(it.po_no)).filter(Boolean))
    if (parts.size > 1) hard.push('本票混合了 RRI 与 RRM 的 PO，不允许混柜，请拆成两票')
    // 警告需要物料毛/净重：按 material_id 批量取
    const ids = [...new Set(items.map(it => it.material_id).filter((x): x is number => x != null))]
    const matById = new Map<number, any>()
    if (ids.length) {
      try {
        const { data } = await api.get<any[]>('/materials/by-ids', { params: { ids: ids.join(',') } })
        for (const m of (data || [])) if (m.id != null) matById.set(m.id, m)
      } catch {}
    }
    items.forEach((it, i) => {
      const tag = `行${i + 1}（物料#${it.material_id ?? '-'} ${it.formula_name ?? ''}）：`
      if (!(Number(it.kg) > 0)) hard.push(tag + '送货 KG 必须 > 0')
      if (!(Number(it.qty) > 0)) hard.push(tag + '送货数量必须 > 0')
      if (!(Number(it.cartons) > 0)) hard.push(tag + '箱数必须 > 0')
      if (!(Number(it.price) > 0)) hard.push(tag + '采购单价必须 > 0')
      if (decimals(it.kg) > 4) hard.push(tag + '送货 KG 小数超过 4 位')
      if (it.price && decimals(it.price) > 4) hard.push(tag + '采购单价小数超过 4 位')
      if (it.pallet && !/^\d+-\d+\/.+/.test(it.pallet) && !/^\d+-\d+$/.test(it.pallet))
        hard.push(tag + '卡板格式不合法（"1-22/2卡" 或 "1-22"）')
      const m = it.material_id != null ? matById.get(it.material_id) : null
      if (m && Number(m.gross_per_pc) && Number(m.net_per_pc) && Number(m.gross_per_pc) < Number(m.net_per_pc))
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
    if (!items.length) { message.warning('没有明细行'); return }
    const v = form.getFieldsValue()
    const rep = await computeValidation()
    if (rep.hard.length) { setValReport(rep); setValOpen(true); message.error(`核对未通过：硬性问题 ${rep.hard.length} 项`); return }

    setExporting(true)
    try {
      const { buildCustomsWorkbook, customsFileName, dataUrlToBytes } = await import('../utils/customsExport')
      // 1) 模板
      const tplResp = await fetch('/template-customs.xlsx')
      if (!tplResp.ok) throw new Error('模板加载失败 template-customs.xlsx (HTTP ' + tplResp.status + ')')
      const templateBuffer = await tplResp.arrayBuffer()
      // 2) 物料富化：products → materials by code → material_id 映射
      const { data: prods } = await api.get<any[]>('/products')
      const productHs = new Map<string, { hsCN?: string; hsID?: string }>()
      for (const p of prods) productHs.set(p.code, { hsCN: p.hs_cn, hsID: p.hs_id })
      const materials = new Map<number, any>()
      await Promise.all((prods || []).map(async (p: any) => {
        try {
          const { data } = await api.get<any[]>('/materials', { params: { code: p.code } })
          for (const m of (data || [])) if (m.id != null) materials.set(m.id, m)
        } catch {}
      }))
      // 3) 图片：对用到的物料按 image_id 拉 dataURL → bytes
      const images = new Map<number, { bytes: Uint8Array; ext: string }>()
      const withImg = items
        .map(it => it.material_id != null ? materials.get(it.material_id) : null)
        .filter((m: any) => m && m.image_id)
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
        shipDate: v.ship_date, blNo: v.bl_no, rate: v.rate,
      }
      const blob = await buildCustomsWorkbook({ templateBuffer, items, materials, productHs, images, form: form2 })
      const fname = customsFileName(form2)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob); a.download = fname; document.body.appendChild(a); a.click()
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1000)
      message.success(`已导出：${fname}`)
    } catch (e: any) {
      // 模板 fetch / 生成工作簿 抛的是普通 Error（非 axios），拦截器不覆盖，需自行提示
      message.error('导出失败：' + (e?.response?.data?.error ?? e?.message ?? e))
    } finally {
      setExporting(false)
    }
  }

  function patchItem(i: number, k: keyof ShipmentItem, v: any) {
    setItems(its => its.map((it, idx) => idx === i ? { ...it, [k]: v } : it))
  }
  // 送货KG重量按单位：KGM→净重总重(单个净重×数量)；个数单位(PCE/SET/TNE)→送货数量
  function kgForItem(it: ShipmentItem, m: any): number {
    const unit = m?.unit_kg || 'KGM'
    if (unit === 'KGM') return +(((Number(m?.net_per_pc) || 0) * (Number(it.qty) || 0)).toFixed(4))
    return Number(it.qty) || 0
  }
  // 改 数量 / 每箱数量 时联动：箱数=ceil(数量/每箱数量)，并按单位重算送货KG重量
  function patchQtyOrPack(i: number, k: 'qty' | 'qty_per_carton', v: any) {
    setItems(its => its.map((it, idx) => {
      if (idx !== i) return it
      const next = { ...it, [k]: v }
      const pc = Number(next.qty_per_carton)
      const q = Number(next.qty)
      if (pc > 0 && q > 0) next.cartons = Math.ceil(q / pc)
      next.kg = kgForItem(next, matMap.get(next.material_id!))
      return next
    }))
  }
  // 改物料主数据（单位/尺寸/毛净重）→ 更新 matMap、标脏、并按单位重算相关行的送货KG重量
  function patchMatDim(materialId: number | undefined, field: string, value: any) {
    if (materialId == null) return
    const newM = { ...(matMap.get(materialId) || {}), [field]: value }
    setMatMap(prev => new Map(prev).set(materialId, newM))
    setDirtyMatIds(prev => new Set(prev).add(materialId))
    setItems(its => its.map(it => it.material_id === materialId ? { ...it, kg: kgForItem(it, newM) } : it))
  }
  function addItem() {
    setItems(its => [...its, { seq: its.length + 1, qty: 0, kg: 0, cartons: 0, currency: 'US$' }])
  }
  function delItem(i: number) {
    setItems(its => its.filter((_, idx) => idx !== i).map((it, idx) => ({ ...it, seq: idx + 1 })))
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
      gross += (Number(m?.gross_per_pc) || 0) * (Number(it.qty) || 0)
      net += (Number(m?.net_per_pc) || 0) * (Number(it.qty) || 0)
    }
    return {
      rows: items.length,
      qty: items.reduce((s, it) => s + (it.qty ?? 0), 0),
      kg:  items.reduce((s, it) => s + (it.kg ?? 0), 0),
      cartons: items.reduce((s, it) => s + (it.cartons ?? 0), 0),
      amount: items.reduce((s, it) => s + (it.qty ?? 0) * (it.price ?? 0), 0),
      cbm, gross, net,
    }
  }, [items, matMap])

  return (
    <div style={{ padding: 16 }}>
      <Card
        title={`走货明细 — 共 ${rows.length} 票`}
        extra={
          <Space wrap>
            <Input.Search allowClear placeholder="搜索 客户/集装箱/BL" style={{ width: 220 }}
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
            { title: 'BL 号', dataIndex: 'bl_no', width: 160 },
            { title: '汇率', dataIndex: 'rate', width: 90, align: 'right', render: (v) => Number(v ?? 0).toFixed(4) },
            { title: '船期', dataIndex: 'ship_date', width: 120, render: (v) => v ? dayjs(v).format('YYYY-MM-DD') : '' },
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
        width={drawerFull ? '100vw' : '85vw'}
        title={creating ? '新建走货' : `编辑走货 #${editing?.id} — ${editing?.container_no || ''}`}
        onClose={() => { setEditing(null); setCreating(false); setDrawerFull(false) }}
        destroyOnClose
        extra={
          <Space>
            <Button onClick={runValidation}>🔍 运行核对</Button>
            <Button onClick={exportShipmentExcel} loading={exporting}>📤 导出报关明细</Button>
            <Button onClick={() => setDrawerFull(!drawerFull)}>{drawerFull ? '⤢ 退出全屏' : '⤡ 全屏'}</Button>
            <Button type="primary" onClick={save}>💾 保存</Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical">
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
              <Form.Item name="bl_no" label="BL 号"><Input /></Form.Item>
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
              <Form.Item name="ship_date" label="船期"
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
          title={`明细 ${tot.rows} 行 · 数量 ${tot.qty.toFixed(2)} · 送货重 ${tot.kg.toFixed(2)}kg · 毛重 ${tot.gross.toFixed(2)} · 净重 ${tot.net.toFixed(2)} · 箱数 ${tot.cartons} · 总CBM ${tot.cbm.toFixed(4)} · 采购额 ${tot.amount.toFixed(2)}`}
          extra={
            <Space wrap>
              <Button size="small" type="primary" onClick={() => { loadOutbound(); setOutOpen(true) }}>📦 从出库拉物料</Button>
              <Button size="small" onClick={() => { setManOpen(true); if (!manMats.length) loadManMats(manCode) }}>🗂 按货号选物料</Button>
              <Button size="small" onClick={() => setSchedPickerOpen(true)}>🔗 从排期勾选</Button>
              <Button size="small" onClick={addItem}>➕ 加一行</Button>
            </Space>
          }
        >
          <Table
            rowKey={(_, i) => String(i)}
            size="small"
            pagination={false}
            scroll={{ x: 4400 }}
            dataSource={items}
            columns={[
              { title: '序号', dataIndex: 'seq', width: 50, fixed: 'left', align: 'center' },
              {
                title: '图片', width: 56, fixed: 'left', align: 'center',
                render: (_v, r) => {
                  const m = r.material_id != null ? matMap.get(r.material_id) : null
                  return m?.image
                    ? <img src={m.image} style={{ width: 36, height: 36, objectFit: 'contain', border: '1px solid #eee', borderRadius: 3 }} />
                    : <span style={{ color: '#bbb', fontSize: 12 }}>无</span>
                },
              },
              { title: '物料ID', width: 80, fixed: 'left', render: (_v, r, i) => <InputNumber size="small" value={r.material_id} onChange={(v) => { patchItem(i, 'material_id', v); loadMatsForItems([v as number]) }} style={{ width: '100%' }} /> },
              { title: '产品中文名称', width: 160, render: (_v, r) => matMap.get(r.material_id!)?.name_zh ?? '' },
              { title: '中国HSCODE', width: 110, render: (_v, r) => matMap.get(r.material_id!)?.hs_cn ?? '' },
              { title: '印尼HSCODE', width: 110, render: (_v, r) => matMap.get(r.material_id!)?.hs_id ?? '' },
              { title: '货号', width: 100, render: (_v, r) => matMap.get(r.material_id!)?.product_code ?? '' },
              { title: '套公式名称栏', width: 150, render: (_v, r, i) => <Input size="small" value={r.formula_name} onChange={(e) => patchItem(i, 'formula_name', e.target.value)} /> },
              { title: '产品英文名称', width: 160, render: (_v, r) => matMap.get(r.material_id!)?.name_en ?? '' },
              { title: '规格', width: 110, render: (_v, r) => matMap.get(r.material_id!)?.spec ?? '' },
              { title: '类别', width: 90, render: (_v, r) => matMap.get(r.material_id!)?.category ?? '' },
              { title: '单位', width: 80, render: (_v, r) => <Select size="small" value={matMap.get(r.material_id!)?.unit_kg || 'KGM'} options={UNIT_LIST.map(u => ({ value: u, label: u }))} onChange={(v) => patchMatDim(r.material_id, 'unit_kg', v)} style={{ width: '100%' }} /> },
              { title: '送货KG重量', width: 110, render: (_v, r, i) => { const unit = matMap.get(r.material_id!)?.unit_kg || 'KGM'; return <InputNumber size="small" min={0} step={0.0001} value={r.kg} onChange={(v) => patchItem(i, 'kg', v ?? 0)} addonAfter={unit === 'KGM' ? 'kg' : unit} style={{ width: '100%' }} /> } },
              { title: '送货数量', width: 90, render: (_v, r, i) => <InputNumber size="small" min={0} step={0.0001} value={r.qty} onChange={(v) => patchQtyOrPack(i, 'qty', v ?? 0)} style={{ width: '100%' }} /> },
              { title: '单位', width: 50, align: 'center', render: () => '件' },
              { title: '毛重总重', width: 90, align: 'right', onCell: () => ({ style: GRAY }), render: (_v, r) => { const c = calc(r); return c.grossTotal ? c.grossTotal.toFixed(2) : '' } },
              { title: '净重总重', width: 90, align: 'right', onCell: () => ({ style: GRAY }), render: (_v, r) => { const c = calc(r); return c.netTotal ? c.netTotal.toFixed(2) : '' } },
              { title: '立方数/每箱', width: 100, align: 'right', onCell: () => ({ style: GRAY }), render: (_v, r) => { const c = calc(r); return c.cbmEach ? c.cbmEach.toFixed(4) : '' } },
              { title: '总立方数', width: 90, align: 'right', onCell: () => ({ style: GRAY }), render: (_v, r) => { const c = calc(r); return c.cbmTotal ? c.cbmTotal.toFixed(4) : '' } },
              { title: '产品用途', width: 140, render: (_v, r, i) => <Input size="small" value={r.product_use} onChange={(e) => patchItem(i, 'product_use', e.target.value)} /> },
              { title: '合同号码', width: 130, render: (_v, r, i) => <Input size="small" value={r.contract_no} onChange={(e) => patchItem(i, 'contract_no', e.target.value)} /> },
              { title: '合同日期', width: 130, render: (_v, r, i) => <DatePicker size="small" style={{ width: '100%' }} format="YYYY-MM-DD" value={r.contract_date ? dayjs(r.contract_date) : null} onChange={(v) => patchItem(i, 'contract_date', v ? v.format('YYYY-MM-DD') : '')} /> },
              { title: '发票号', width: 130, render: (_v, r, i) => <Input size="small" value={r.invoice_no} onChange={(e) => patchItem(i, 'invoice_no', e.target.value)} /> },
              { title: '发票日期', width: 130, render: (_v, r, i) => <DatePicker size="small" style={{ width: '100%' }} format="YYYY-MM-DD" value={r.invoice_date ? dayjs(r.invoice_date) : null} onChange={(v) => patchItem(i, 'invoice_date', v ? v.format('YYYY-MM-DD') : '')} /> },
              { title: '发票单价', width: 100, render: (_v, r, i) => <InputNumber size="small" min={0} step={0.0001} value={r.invoice_price} onChange={(v) => patchItem(i, 'invoice_price', v ?? 0)} style={{ width: '100%' }} /> },
              { title: '金额', width: 90, align: 'right', onCell: () => ({ style: GRAY }), render: (_v, r) => { const c = calc(r); return c.invoiceAmount ? c.invoiceAmount.toFixed(2) : '' } },
              { title: '供应商', width: 160, render: (_v, r, i) => <Input size="small" value={r.supplier} onChange={(e) => patchItem(i, 'supplier', e.target.value)} /> },
              { title: '采购单日期', width: 130, render: (_v, r, i) => <DatePicker size="small" style={{ width: '100%' }} format="YYYY-MM-DD" value={r.po_date ? dayjs(r.po_date) : null} onChange={(v) => patchItem(i, 'po_date', v ? v.format('YYYY-MM-DD') : '')} /> },
              { title: '采购单号', width: 130, render: (_v, r, i) => <Input size="small" value={r.po_no} onChange={(e) => patchItem(i, 'po_no', e.target.value)} /> },
              { title: '采购单价', width: 100, render: (_v, r, i) => <InputNumber size="small" min={0} step={0.0001} value={r.price} onChange={(v) => patchItem(i, 'price', v ?? 0)} style={{ width: '100%' }} /> },
              { title: '币种', width: 90, render: (_v, r, i) => <Select size="small" value={r.currency || '¥'} options={CURR} onChange={(v) => patchItem(i, 'currency', v)} style={{ width: '100%' }} /> },
              { title: '采购金额', width: 90, align: 'right', onCell: () => ({ style: GRAY }), render: (_v, r) => { const c = calc(r); return c.purchaseAmount ? c.purchaseAmount.toFixed(2) : '' } },
              { title: '报关出口公司', width: 160, render: (_v, r, i) => <Input size="small" value={r.customs_company} onChange={(e) => patchItem(i, 'customs_company', e.target.value)} /> },
              { title: '提单抬头', width: 180, render: (_v, r, i) => <Select size="small" value={r.bl_head || undefined} options={BL_HEAD_LIST.map(v => ({ value: v, label: v }))} onChange={(v) => patchItem(i, 'bl_head', v)} style={{ width: '100%' }} allowClear /> },
              { title: '箱数', width: 70, render: (_v, r, i) => <InputNumber size="small" min={0} value={r.cartons} onChange={(v) => patchItem(i, 'cartons', v ?? 0)} style={{ width: '100%' }} /> },
              { title: '每箱数量', width: 120, render: (_v, r, i) => <Input size="small" value={r.qty_per_carton} placeholder="200" onChange={(e) => patchQtyOrPack(i, 'qty_per_carton', e.target.value)} /> },
              { title: '卡板', width: 110, render: (_v, r, i) => <Input size="small" value={r.pallet} placeholder="1-22/2卡" onChange={(e) => patchItem(i, 'pallet', e.target.value)} /> },
              { title: '长', width: 70, render: (_v, r) => <InputNumber size="small" min={0} step={0.0001} value={matMap.get(r.material_id!)?.length} onChange={(v) => patchMatDim(r.material_id, 'length', v ?? 0)} style={{ width: '100%' }} /> },
              { title: '宽', width: 70, render: (_v, r) => <InputNumber size="small" min={0} step={0.0001} value={matMap.get(r.material_id!)?.width} onChange={(v) => patchMatDim(r.material_id, 'width', v ?? 0)} style={{ width: '100%' }} /> },
              { title: '高', width: 70, render: (_v, r) => <InputNumber size="small" min={0} step={0.0001} value={matMap.get(r.material_id!)?.height} onChange={(v) => patchMatDim(r.material_id, 'height', v ?? 0)} style={{ width: '100%' }} /> },
              { title: '每箱重量', width: 80, render: (_v, r) => <InputNumber size="small" min={0} step={0.0001} value={matMap.get(r.material_id!)?.weight_per_carton} onChange={(v) => patchMatDim(r.material_id, 'weight_per_carton', v ?? 0)} style={{ width: '100%' }} /> },
              { title: '单个毛重', width: 80, render: (_v, r) => <InputNumber size="small" min={0} step={0.000001} value={matMap.get(r.material_id!)?.gross_per_pc} onChange={(v) => patchMatDim(r.material_id, 'gross_per_pc', v ?? 0)} style={{ width: '100%' }} /> },
              { title: '单个净重', width: 80, render: (_v, r) => <InputNumber size="small" min={0} step={0.000001} value={matMap.get(r.material_id!)?.net_per_pc} onChange={(v) => patchMatDim(r.material_id, 'net_per_pc', v ?? 0)} style={{ width: '100%' }} /> },
              {
                title: '', width: 44, fixed: 'right',
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
      <Modal
        open={outOpen}
        title={`从出库拉物料（共 ${outRows.length} 物料 · 已选 ${outSel.length}）`}
        width="80vw"
        onCancel={() => { setOutOpen(false); setOutSel([]) }}
        footer={null}
        destroyOnClose
      >
        <Space style={{ marginBottom: 8 }} wrap>
          <Input.Search allowClear placeholder="搜索 货号/物料/PO" style={{ width: 320 }}
            onSearch={setOutFilter} onChange={(e) => !e.target.value && setOutFilter('')} />
          <Button type="primary" disabled={!outSel.length} onClick={pullFromOutbound}>📥 拉物料到本走货</Button>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            数量 = 该物料出库总量；总重 = 数量 × 净重/件；箱数 = ceil(数量 / 件箱)；自动套最近一张 PO 的供应商/单价
          </Typography.Text>
        </Space>
        <Table
          rowKey={(r) => String(r.material_id)}
          size="small"
          rowSelection={{ selectedRowKeys: outSel, onChange: (k) => setOutSel(k) }}
          dataSource={outRows.filter(r => {
            if (r.material_id != null && shippedIds.has(r.material_id)) return false  // 已走货不再显示
            if (!outFilter) return true
            const s = outFilter.toLowerCase()
            return ((r.code || '') + (r.name_zh || '') + (r.po_nos || '')).toLowerCase().includes(s)
          })}
          pagination={{ pageSize: 30 }}
          scroll={{ x: 900, y: 480 }}
          columns={[
            { title: '货号', dataIndex: 'code', width: 120 },
            { title: '物料', dataIndex: 'name_zh', width: 220, ellipsis: true },
            { title: '物料ID', dataIndex: 'material_id', width: 90, align: 'right' },
            { title: '出库总量', dataIndex: 'total_out', width: 110, align: 'right', render: (v) => Number(v ?? 0).toFixed(2) },
            { title: 'PO号', dataIndex: 'po_nos', width: 200, ellipsis: true },
            { title: '末次出库', dataIndex: 'last_out_date', width: 120, render: (v) => v ? dayjs(v).format('YYYY-MM-DD') : '' },
          ]}
        />
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
          <Button type="primary" disabled={!manSel.length} onClick={pullManual}>📥 添加选中物料</Button>
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
          硬性问题：<b style={{ color: '#cf1322' }}>{valReport.hard.length}</b>
          警告：<b style={{ color: '#b8860b' }}>{valReport.warn.length}</b>
          {valReport.hard.length === 0 && <span style={{ marginLeft: 10, color: '#389e0d', fontWeight: 600 }}>✓ 硬性项全部通过，可以导出</span>}
        </div>
        {valReport.hard.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ color: '#cf1322', fontWeight: 600, marginBottom: 4 }}>硬性问题（必须修正）</div>
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
