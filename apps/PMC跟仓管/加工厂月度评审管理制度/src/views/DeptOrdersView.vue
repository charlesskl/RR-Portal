<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import AppLayout from '../components/AppLayout.vue'
import { useOrdersStore } from '../stores/orders'
import { useFactoriesStore } from '../stores/factories'
import { useAuthStore } from '../stores/auth'
import { CRAFT_LABELS, REGION_LABELS, regionOf, type Craft, type Region } from '../constants/roles'
import { canEditOrders, allowedRegions } from '../utils/permissions'
import { buildDeliveryReport, deliveryHeaders, exportDeliveryExcel, parseDeliveryImport, splitSewingContractItemNo, type DeliveryPricingMode, type ReportRow, type DetailRow } from '../utils/deliveryStats'
import { readDeliveryPdfAsAoa } from '../utils/pdfDeliveryImport'
import { parseDeliveryExcelFiles } from '../utils/deliveryExcelImport'
import { cnyTaxToHkdUntaxed, cnyTaxToUntaxedRmb, DEFAULT_CNY_TO_HKD_RATE } from '../utils/orderPricing'
import { matchesOrderDate, type OrderDateFilter } from '../utils/orderDateFilter'
import { deliveryImportFactoryMap } from '../utils/deliveryImportScope'
import { isPercentOver100 } from '../utils/percentage'
import { taxPointFactor } from '../utils/taxPoint'
import type { Order } from '../types/order'

const route = useRoute()
const orders = useOrdersStore()
const factories = useFactoriesStore()
const auth = useAuthStore()
const fileInput = ref<HTMLInputElement | null>(null)
const importingExcel = ref(false)
const pdfInput = ref<HTMLInputElement | null>(null)
const savingRowId = ref<string | null>(null)
const saveToast = ref<{ type: 'success' | 'error'; message: string } | null>(null)
let saveToastTimer: ReturnType<typeof setTimeout> | null = null

function showSaveToast(type: 'success' | 'error', message: string) {
  saveToast.value = { type, message }
  if (saveToastTimer) clearTimeout(saveToastTimer)
  saveToastTimer = setTimeout(() => {
    saveToast.value = null
    saveToastTimer = null
  }, 3000)
}

onUnmounted(() => {
  if (saveToastTimer) clearTimeout(saveToastTimer)
})

const craft = computed(() => route.params.craft as Craft)
const region = computed(() => (route.query.region as Region) || null)
const deptName = computed(() =>
  (region.value ? REGION_LABELS[region.value] + '厂区 · ' : '') + (CRAFT_LABELS[craft.value] ?? '部门'))
const newLink = computed(() => `/orders/dept/${craft.value}/new` + (region.value ? `?region=${region.value}` : ''))
const search = ref<string>('')
const dateMode = ref<'all' | 'month' | 'range'>('all')
const selectedMonth = ref(new Date().toISOString().slice(0, 7))
const rangeStart = ref('')
const rangeEnd = ref('')
const canEdit = computed(() => (auth.role ? canEditOrders(auth.role) : false))

const dateFilter = computed<OrderDateFilter>(() => {
  if (dateMode.value === 'month') return { mode: 'month', month: selectedMonth.value }
  if (dateMode.value === 'range') return { mode: 'range', start: rangeStart.value, end: rangeEnd.value }
  return { mode: 'all' }
})

function clearDateFilter() {
  dateMode.value = 'all'
  rangeStart.value = ''
  rangeEnd.value = ''
}

const myRegions = computed(() => (auth.role ? allowedRegions(auth.role) : null))
const deptOrders = computed(() => {
  const q = search.value.trim().toLowerCase()
  return orders.items
    .filter((o) => o.expand?.factory?.craft === craft.value && (!region.value || regionOf(o.expand?.factory) === region.value))
    .filter((o) => !myRegions.value || myRegions.value.includes(regionOf(o.expand?.factory)))
    .filter((o) => matchesOrderDate(o.order_date, dateFilter.value))
    .filter((o) => {
      if (!q) return true
      return [o.expand?.factory?.name, o.pmc, o.item_no, o.mold_no, o.order_no, o.product]
        .some((s) => (s ?? '').toLowerCase().includes(q))
    })
})
const orderCount = computed(() => deptOrders.value.length)
function factoryTaxPoint(factoryId: string | null | undefined) {
  return taxPointFactor(factories.items.find((factory) => factory.id === factoryId)?.tax_point)
}

const isHunan = computed(() => region.value === 'hunan')
const isDongguanTaxDept = computed(() => region.value === 'dongguan' && ['injection', 'painting', 'assembly'].includes(craft.value))
// 湖南四部门、车缝部按人民币未税展示；东莞三部门保留港币列并同时显示工厂税点。
const pricingMode = computed<DeliveryPricingMode>(() =>
  isHunan.value || craft.value === 'sewing' ? 'rmb-tax' : isDongguanTaxDept.value ? 'hkd-tax' : 'hkd')
const usesFactoryTaxPoint = computed(() => pricingMode.value !== 'hkd')
const reportOrders = computed(() => pricingMode.value === 'rmb-tax'
  ? deptOrders.value.map((order) => ({
      ...order,
      exchange_rate: factoryTaxPoint(order.factory) ?? order.exchange_rate,
    }))
  : deptOrders.value)
const rows = computed<ReportRow[]>(() =>
  buildDeliveryReport(reportOrders.value, deptName.value, (o) => o.expand?.factory?.name ?? '', pricingMode.value, (o) => factoryTaxPoint(o.factory)))
const showMoldNumber = computed(() => craft.value === 'injection')
const showContractNumber = computed(() => craft.value === 'sewing')
const visibleHeaders = computed(() => deliveryHeaders(showMoldNumber.value, showContractNumber.value, pricingMode.value))

const COLUMN_WIDTHS: Record<string, number> = {
  '范围': 140,
  '下单PMC': 140,
  '加工厂': 140,
  '合同号': 150,
  '货号': 140,
  '模具编号': 140,
  '订单号': 140,
  '加工类别': 120,
  '物料名称': 160,
  '数量': 110,
  '下单时间': 120,
  '下单交货时间': 130,
  '实际交货时间': 130,
  '延迟时间': 100,
  '订单总单数': 110,
  '延期单数': 100,
  '占比': 90,
  '延期平均天数': 130,
  '核价工价(港币不含税$)': 150,
  '外发工价(港币不含税$)': 150,
  '核价工价(不含税RMB)': 150,
  '外发工价(不含税RMB)': 150,
  '外发工价(人民币含税)': 150,
  '换算汇率': 100,
  '税点': 100,
  '备注': 220,
}

const freezeTo = ref('')
const freezeReady = ref(false)
const freezeOptions = computed(() => visibleHeaders.value.map((header, index) => ({
  key: `${index}:${header}`,
  index,
  label: header === '占比'
    ? (visibleHeaders.value.indexOf(header) === index ? '延期占比' : '价格占比')
    : header,
})))
const hiddenColumnKeys = ref<string[]>([])
const columnsReady = ref(false)
const freezeIndex = computed(() => freezeOptions.value.find((option) => option.key === freezeTo.value)?.index ?? -1)
const freezeStorageKey = computed(() => `delivery-report-freeze:${craft.value}`)
const columnStorageKey = computed(() => `delivery-report-hidden-columns:${craft.value}`)
const visibleColumnCount = computed(() => visibleHeaders.value.filter((_, index) => isColumnVisible(index)).length + (canEdit.value ? 1 : 0))

function columnKey(index: number) {
  return `${index}:${visibleHeaders.value[index]}`
}

function isColumnVisible(index: number) {
  return !hiddenColumnKeys.value.includes(columnKey(index))
}

function setColumnVisible(index: number, visible: boolean) {
  const key = columnKey(index)
  hiddenColumnKeys.value = visible
    ? hiddenColumnKeys.value.filter((value) => value !== key)
    : [...new Set([...hiddenColumnKeys.value, key])]
}

function showAllColumns() {
  hiddenColumnKeys.value = []
}

function restoreColumnVisibility() {
  columnsReady.value = false
  try {
    const saved = JSON.parse(window.localStorage.getItem(columnStorageKey.value) ?? '[]')
    hiddenColumnKeys.value = Array.isArray(saved)
      ? saved.filter((value): value is string => typeof value === 'string' && freezeOptions.value.some((option) => option.key === value))
      : []
  } catch {
    hiddenColumnKeys.value = []
  }
  columnsReady.value = true
}

function defaultFreezeKey() {
  const index = visibleHeaders.value.indexOf('物料名称')
  return index < 0 ? '' : `${index}:物料名称`
}

function restoreFreezePreference() {
  freezeReady.value = false
  try {
    const saved = window.localStorage.getItem(freezeStorageKey.value)
    freezeTo.value = freezeOptions.value.some((option) => option.key === saved) ? saved! : defaultFreezeKey()
  } catch {
    freezeTo.value = defaultFreezeKey()
  }
  freezeReady.value = true
}

watch(freezeTo, (value) => {
  if (!freezeReady.value) return
  try { window.localStorage.setItem(freezeStorageKey.value, value) } catch { /* 浏览器禁用存储时仍可正常使用 */ }
})
watch(hiddenColumnKeys, (value) => {
  if (!columnsReady.value) return
  try { window.localStorage.setItem(columnStorageKey.value, JSON.stringify(value)) } catch { /* 浏览器禁用存储时仍可正常使用 */ }
})
watch(craft, () => {
  restoreFreezePreference()
  restoreColumnVisibility()
})

function columnIndex(header: string, occurrence = 0) {
  let found = 0
  for (let index = 0; index < visibleHeaders.value.length; index++) {
    if (visibleHeaders.value[index] !== header) continue
    if (found === occurrence) return index
    found++
  }
  return -1
}

function columnClass(index: number) {
  const header = visibleHeaders.value[index]
  return {
    'freeze-col': isColumnVisible(index) && index >= 0 && index <= freezeIndex.value,
    'range-col': header === '范围',
    'pmc-col': header === '下单PMC',
    'factory-col': header === '加工厂',
    'contract-no-col': header === '合同号',
    'item-no-col': header === '货号',
    'mold-no-col': header === '模具编号',
    'order-no-col': header === '订单号',
    'category-col': header === '加工类别',
    'product-col': header === '物料名称',
    'notes-col': header === '备注',
  }
}

function columnClassFor(header: string, occurrence = 0) {
  return columnClass(columnIndex(header, occurrence))
}

function columnStyle(index: number) {
  const width = COLUMN_WIDTHS[visibleHeaders.value[index]] ?? 120
  const style: Record<string, string> = {
    width: `${width}px`,
    minWidth: `${width}px`,
    maxWidth: `${width}px`,
  }
  if (!isColumnVisible(index)) {
    style.display = 'none'
  } else if (index >= 0 && index <= freezeIndex.value) {
    const left = visibleHeaders.value.slice(0, index)
      .reduce((total, header, previousIndex) => total + (isColumnVisible(previousIndex) ? (COLUMN_WIDTHS[header] ?? 120) : 0), 0)
    style['--freeze-left'] = `${left}px`
  }
  return style
}

function columnStyleFor(header: string, occurrence = 0) {
  return columnStyle(columnIndex(header, occurrence))
}

onMounted(() => {
  restoreFreezePreference()
  restoreColumnVisibility()
  return Promise.all([orders.fetchAll(), factories.fetchAll()])
})

function subtotalValue(header: string, index: number, row: Extract<ReportRow, { kind: 'subtotal' }>) {
  if (header === '加工厂') return `${row.factory}-小计`
  if (header === '订单总单数') return row.orderCount
  if (header === '延期单数') return row.delayedCount
  if (header === '延期平均天数') return row.delayAvg
  if (header === '占比') {
    return index === visibleHeaders.value.indexOf('占比') ? row.delayRatio : row.priceRatio
  }
  if (header.startsWith('核价工价')) return row.quote
  if (header === '外发工价(人民币含税)') return row.outPriceCnyTax
  if (header.startsWith('外发工价')) return row.outPrice
  return ''
}

type RowDraft = {
  pmc: string
  mold_no: string
  product: string
  quantity: string
  actual_delivery_date: string
  quote_labor_price: string
  unit_price: string
  unit_price_cny_tax: string
  exchange_rate: string
  notes: string
}
const drafts = ref<Record<string, RowDraft>>({})

function convertedOutPrice(cnyTaxPrice: number, exchangeRate: number, taxPoint: number | null): number | undefined {
  if (pricingMode.value === 'rmb-tax') return cnyTaxToUntaxedRmb(cnyTaxPrice, taxPoint ?? exchangeRate)
  if (pricingMode.value === 'hkd-tax') {
    // 缺税点时不按 0 折算（会静默把工价写成 0），返回 undefined 让校验拦截并提示维护税点
    if (taxPoint == null) return undefined
    return cnyTaxToHkdUntaxed(cnyTaxPrice, exchangeRate, taxPoint)
  }
  return cnyTaxToHkdUntaxed(cnyTaxPrice, exchangeRate)
}

function normalizeDeptPricing(payload: Record<string, any>) {
  const configuredTaxPoint = factoryTaxPoint(payload.factory)
  const cnyTaxPrice = Number(payload.unit_price_cny_tax)
  if (pricingMode.value === 'rmb-tax' && configuredTaxPoint != null) {
    payload.exchange_rate = configuredTaxPoint
    if (Number.isFinite(cnyTaxPrice)) payload.unit_price = cnyTaxToUntaxedRmb(cnyTaxPrice, configuredTaxPoint)
  } else if (pricingMode.value === 'hkd-tax' && configuredTaxPoint != null && Number.isFinite(cnyTaxPrice)) {
    const exchangeRate = Number(payload.exchange_rate) || DEFAULT_CNY_TO_HKD_RATE
    payload.exchange_rate = exchangeRate
    payload.unit_price = cnyTaxToHkdUntaxed(cnyTaxPrice, exchangeRate, configuredTaxPoint)
  }
  return payload
}

async function importRows(aoa: any[][]) {
  const fByName = deliveryImportFactoryMap(factories.items, craft.value, region.value)
  const { payloads, failed } = parseDeliveryImport(aoa, fByName)
  if (!payloads.length && !failed) { alert('未识别到表头(需含「货号/物料名称」)'); return }
  let ok = 0, fail = failed
  for (const p of payloads) {
    try { await orders.create(normalizeDeptPricing({ ...p, created_by: auth.userId ?? undefined }) as any); ok++ } catch { fail++ }
  }
  await orders.fetchAll()
  alert(`导入完成：成功 ${ok} 条` + (fail ? `，失败 ${fail} 条(工厂名对不上或缺物料名称)` : '') + '\n(小计/合计行已自动跳过;加工厂名称需与系统一致)')
}

async function importExcel(ev: Event) {
  const files = Array.from((ev.target as HTMLInputElement).files ?? [])
  if (!files.length) return
  const fByName = deliveryImportFactoryMap(factories.items, craft.value, region.value)
  importingExcel.value = true
  try {
    const parsed = await parseDeliveryExcelFiles(files, fByName, { preferCnyTaxPrice: true })
    let ok = 0, fail = parsed.failedRows
    const saveErrors: string[] = []
    for (const p of parsed.payloads) {
      try {
        await orders.create(normalizeDeptPricing({ ...p, created_by: auth.userId ?? undefined }) as any)
        ok++
      } catch (err: any) {
        fail++
        const message = err?.response?.message || err?.message || '记录保存失败'
        if (!saveErrors.includes(message)) saveErrors.push(message)
      }
    }
    await orders.fetchAll()
    const issues = [
      parsed.unrecognizedFiles.length ? `未识别 ${parsed.unrecognizedFiles.length} 个文件` : '',
      parsed.readFailedFiles.length ? `读取失败 ${parsed.readFailedFiles.length} 个文件` : '',
      saveErrors.length ? `保存失败：${saveErrors.slice(0, 3).join('；')}` : '',
    ].filter(Boolean).join('，')
    alert(`批量导入完成：共 ${parsed.fileCount} 个文件，成功 ${ok} 条，失败 ${fail} 条${issues ? `\n${issues}` : ''}`)
  } finally {
    importingExcel.value = false
    if (fileInput.value) fileInput.value.value = ''
  }
}

async function importPdf(ev: Event) {
  const files = Array.from((ev.target as HTMLInputElement).files ?? []).filter((file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))
  if (!files.length) return
  try {
    const merged: any[][] = []
    for (const file of files) {
      const aoa = await readDeliveryPdfAsAoa(file)
      if (!aoa.length) continue
      if (!merged.length) merged.push(...aoa)
      else merged.push(...aoa.slice(1))
    }
    await importRows(merged)
  } catch (err) {
    console.error(err)
    alert('PDF 解析失败，请确认文件是文字版表格 PDF，不是扫描图片。')
  } finally {
    if (pdfInput.value) pdfInput.value.value = ''
  }
}

function priceInputValue(val: number | null | undefined) {
  return val == null ? '' : String(val)
}

function draftFromRow(row: DetailRow): RowDraft {
  return {
    pmc: row.pmc || '',
    mold_no: row.mold_no || '',
    product: row.product || '',
    quantity: priceInputValue(row.quantity),
    actual_delivery_date: row.actual_delivery_date || '',
    quote_labor_price: priceInputValue(row.quote),
    unit_price: priceInputValue(row.outPrice),
    unit_price_cny_tax: priceInputValue(row.outPriceCnyTax),
    exchange_rate: priceInputValue(row.exchangeRate),
    notes: row.notes || '',
  }
}

function syncDrafts() {
  const next: Record<string, RowDraft> = {}
  for (const row of rows.value) {
    if (row.kind !== 'detail') continue
    next[row.id] = drafts.value[row.id] ?? draftFromRow(row)
  }
  drafts.value = next
}

watch(rows, syncDrafts, { immediate: true })

function draftValue(row: DetailRow, field: keyof RowDraft) {
  if (!drafts.value[row.id]) drafts.value[row.id] = draftFromRow(row)
  return drafts.value[row.id][field]
}

function setDraftValue(row: DetailRow, field: keyof RowDraft, value: string) {
  if (!drafts.value[row.id]) drafts.value[row.id] = draftFromRow(row)
  drafts.value[row.id][field] = value
  if (field === 'unit_price_cny_tax' || field === 'exchange_rate') {
    const cnyTaxPrice = Number(drafts.value[row.id].unit_price_cny_tax)
    const exchangeRate = Number(drafts.value[row.id].exchange_rate)
    drafts.value[row.id].unit_price = drafts.value[row.id].unit_price_cny_tax.trim() && Number.isFinite(cnyTaxPrice) && Number.isFinite(exchangeRate) && exchangeRate > 0
      ? String(convertedOutPrice(cnyTaxPrice, exchangeRate, factoryTaxPoint(sourceOrder(row)?.factory)) ?? '')
      : ''
  }
}

function parsePrice(val: string) {
  const raw = val.trim()
  if (!raw) return null
  const next = Number(raw)
  return Number.isFinite(next) ? next : undefined
}

function sourceOrder(row: DetailRow) {
  return orders.items.find((order) => order.id === row.id)
}

function sewingItemParts(row: DetailRow) {
  return splitSewingContractItemNo(row.item_no)
}

function exportExcel() {
  exportDeliveryExcel(
    rows.value,
    `${deptName.value}外发加工厂交货延期统计表`,
    showMoldNumber.value,
    showContractNumber.value,
    pricingMode.value,
  )
}

async function saveRow(row: DetailRow) {
  if (savingRowId.value) return
  const draft = drafts.value[row.id] ?? draftFromRow(row)
  const product = draft.product.trim()
  const quantity = parsePrice(draft.quantity)
  const quote = parsePrice(draft.quote_labor_price)
  const enteredUnitPrice = parsePrice(draft.unit_price)
  const unitPriceCnyTax = parsePrice(draft.unit_price_cny_tax)
  const source = sourceOrder(row)
  const taxPoint = factoryTaxPoint(source?.factory)
  const exchangeRate = pricingMode.value === 'rmb-tax' ? taxPoint : parsePrice(draft.exchange_rate)
  const unitPrice = unitPriceCnyTax != null && exchangeRate != null
    ? convertedOutPrice(unitPriceCnyTax, exchangeRate, taxPoint)
    : enteredUnitPrice
  if (!product) {
    showSaveToast('error', '保存失败：请输入物料名称')
    return
  }
  if (quantity === undefined) {
    showSaveToast('error', '保存失败：数量请输入有效数字')
    return
  }
  if (quote === undefined || unitPrice === undefined || unitPriceCnyTax === undefined || exchangeRate === undefined || (exchangeRate != null && exchangeRate <= 0)) {
    showSaveToast('error', usesFactoryTaxPoint.value && taxPoint == null
      ? '保存失败：请先在工厂信息管理中维护该加工厂的税点'
      : '保存失败：工价请输入有效数字')
    return
  }

  const data: Partial<any> = {
    pmc: draft.pmc.trim(),
    mold_no: draft.mold_no.trim(),
    product,
    quantity,
    actual_delivery_date: draft.actual_delivery_date ? new Date(draft.actual_delivery_date).toISOString() : '',
    quote_labor_price: quote,
    unit_price: unitPrice,
    unit_price_cny_tax: unitPriceCnyTax,
    exchange_rate: exchangeRate ?? DEFAULT_CNY_TO_HKD_RATE,
    notes: draft.notes.trim(),
    amount: quantity === null || (unitPriceCnyTax === null && unitPrice === null)
      ? null
      : quantity * (unitPriceCnyTax ?? unitPrice!),
  }
  if (draft.actual_delivery_date && row.delivery_date) {
    const days = Math.round((new Date(draft.actual_delivery_date).getTime() - new Date(row.delivery_date).getTime()) / 86400000)
    data.delay_days = days > 0 ? days : 0
    data.is_delayed = days > 0
  } else {
    data.delay_days = 0
    data.is_delayed = false
  }
  savingRowId.value = row.id
  try {
    await orders.update(row.id, data)
    await orders.fetchAll()
    drafts.value[row.id] = draft
    showSaveToast('success', '保存成功')
  } catch (error: any) {
    const message = error?.response?.message || error?.message || '未知错误'
    showSaveToast('error', `保存失败：${message}`)
  } finally {
    savingRowId.value = null
  }
}

async function copyRow(row: DetailRow) {
  const source = sourceOrder(row)
  if (!source) {
    alert('未找到原订单，无法复制')
    return
  }
  const draft = drafts.value[row.id] ?? draftFromRow(row)
  const product = draft.product.trim() || source.product
  const quantity = parsePrice(draft.quantity)
  const quote = parsePrice(draft.quote_labor_price)
  const enteredUnitPrice = parsePrice(draft.unit_price)
  const unitPriceCnyTax = parsePrice(draft.unit_price_cny_tax)
  const taxPoint = factoryTaxPoint(source.factory)
  const exchangeRate = pricingMode.value === 'rmb-tax' ? taxPoint : parsePrice(draft.exchange_rate)
  const unitPrice = unitPriceCnyTax != null && exchangeRate != null
    ? convertedOutPrice(unitPriceCnyTax, exchangeRate, taxPoint)
    : enteredUnitPrice
  if (quantity === undefined) {
    alert('数量请输入有效数字')
    return
  }
  if (quote === undefined || unitPrice === undefined || unitPriceCnyTax === undefined || exchangeRate === undefined || (exchangeRate != null && exchangeRate <= 0)) {
    alert(usesFactoryTaxPoint.value && taxPoint == null
      ? '请先在工厂信息管理中维护该加工厂的税点'
      : '工价请输入有效数字')
    return
  }
  const payload: Partial<Order> = {
    factory: source.factory,
    process: source.process,
    workshop: source.workshop,
    item_no: source.item_no,
    mold_no: draft.mold_no.trim(),
    product,
    quantity: quantity ?? undefined,
    supplier_price: source.supplier_price,
    process_category: source.process_category,
    quote_labor_price: quote ?? undefined,
    unit_price: unitPrice ?? undefined,
    unit_price_cny_tax: unitPriceCnyTax ?? undefined,
    exchange_rate: exchangeRate ?? DEFAULT_CNY_TO_HKD_RATE,
    amount: quantity != null && (unitPriceCnyTax != null || unitPrice != null)
      ? quantity * (unitPriceCnyTax ?? unitPrice!)
      : source.amount,
    defect_rate: source.defect_rate,
    pmc: draft.pmc.trim(),
    order_no: source.order_no,
    order_date: source.order_date,
    delivery_date: source.delivery_date,
    actual_delivery_date: draft.actual_delivery_date || source.actual_delivery_date,
    return_count: source.return_count,
    status: source.status ?? 'placed',
    current_product: source.current_product,
    progress: source.progress,
    is_delayed: source.is_delayed,
    delay_days: source.delay_days,
    delay_reason: source.delay_reason,
    inspect_count: source.inspect_count,
    defect_count: source.defect_count,
    is_resolved: source.is_resolved,
    quality_issues: source.quality_issues,
    manager_rating: source.manager_rating,
    notes: draft.notes.trim(),
    created_by: auth.userId ?? source.created_by,
  }
  await orders.create(payload)
  await orders.fetchAll()
}

async function removeRow(row: DetailRow) {
  if (!confirm(`确定删除「${row.product || row.order_no || row.item_no}」这条订单记录？此操作不可恢复。`)) return
  await orders.remove(row.id)
  delete drafts.value[row.id]
  await orders.fetchAll()
}
</script>
<template>
  <AppLayout>
    <div class="page wide">
      <Transition name="save-toast">
        <div v-if="saveToast" class="save-toast" :class="saveToast.type" role="status" aria-live="polite">
          <span class="save-toast-icon">{{ saveToast.type === 'success' ? '✓' : '!' }}</span>
          {{ saveToast.message }}
        </div>
      </Transition>
      <div class="toolbar">
        <RouterLink to="/orders" class="back">← 部门</RouterLink>
        <h2 style="margin:0">{{ deptName }} · 货期管理</h2>
        <span class="muted">共 {{ orderCount }} 单</span>
        <RouterLink v-if="canEdit" :to="newLink"><button>+ 新增下单</button></RouterLink>
        <span class="spacer"></span>
        <div class="date-filter">
          <select v-model="dateMode" aria-label="下单日期筛选方式">
            <option value="all">全部日期</option>
            <option value="month">按月份</option>
            <option value="range">按时间段</option>
          </select>
          <input v-if="dateMode === 'month'" v-model="selectedMonth" type="month" aria-label="选择月份" />
          <template v-else-if="dateMode === 'range'">
            <input v-model="rangeStart" type="date" :max="rangeEnd || undefined" aria-label="开始日期" />
            <span class="date-separator">至</span>
            <input v-model="rangeEnd" type="date" :min="rangeStart || undefined" aria-label="结束日期" />
          </template>
          <button v-if="dateMode !== 'all'" class="ghost date-clear" type="button" title="清除日期筛选"
            aria-label="清除日期筛选" @click="clearDateFilter">×</button>
        </div>
        <label class="freeze-control">
          冻结到
          <select v-model="freezeTo" aria-label="选择冻结到的栏目">
            <option value="">不冻结</option>
            <option v-for="option in freezeOptions" :key="option.key" :value="option.key">
              {{ option.label }}
            </option>
          </select>
        </label>
        <details class="column-control">
          <summary>显示栏目</summary>
          <div class="column-menu">
            <div class="column-menu-top">
              <strong>显示/隐藏栏目</strong>
              <button type="button" class="link-button" @click="showAllColumns">全部显示</button>
            </div>
            <label v-for="option in freezeOptions" :key="option.key" class="column-option">
              <input
                type="checkbox"
                :checked="isColumnVisible(option.index)"
                @change="setColumnVisible(option.index, ($event.target as HTMLInputElement).checked)"
              />
              {{ option.label }}
            </label>
          </div>
        </details>
        <button v-if="canEdit" class="ghost" @click="pdfInput?.click()">导入 PDF</button>
        <input ref="pdfInput" type="file" accept=".pdf,application/pdf" multiple style="display:none" @change="importPdf" />
        <button v-if="canEdit" class="ghost" :disabled="importingExcel" @click="fileInput?.click()">
          {{ importingExcel ? '导入中…' : '批量导入 Excel' }}
        </button>
        <input ref="fileInput" type="file" accept=".xlsx,.xls,.csv" multiple style="display:none" @change="importExcel" />
        <input class="search-box" v-model="search" :placeholder="showMoldNumber
          ? '搜索 工厂/PMC/货号/模具编号/订单号/产品'
          : showContractNumber
            ? '搜索 工厂/PMC/合同号/货号/订单号/产品'
            : '搜索 工厂/PMC/货号/订单号/产品'" />
        <button @click="exportExcel">导出 Excel</button>
      </div>
      <div class="scroll">
        <table class="report" :class="{ 'sewing-report': showContractNumber, 'injection-report': showMoldNumber }">
          <thead>
            <tr>
              <th
                v-for="(h, headerIndex) in visibleHeaders"
                :key="h"
                :class="columnClass(headerIndex)"
                :style="columnStyle(headerIndex)"
              >{{ h }}</th>
              <th v-if="canEdit" class="op-col">操作</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="(r, i) in rows" :key="i">
              <tr v-if="r.kind === 'detail'">
                <td v-if="r.rangeSpan" :rowspan="r.rangeSpan" :class="['grp', columnClassFor('范围')]" :style="columnStyleFor('范围')">{{ r.range }}</td>
                <td :class="columnClassFor('下单PMC')" :style="columnStyleFor('下单PMC')">
                  <input v-if="canEdit" class="pmc-inp" :value="draftValue(r, 'pmc')"
                    @input="setDraftValue(r, 'pmc', ($event.target as HTMLInputElement).value)" />
                  <span v-else>{{ r.pmc || '-' }}</span>
                </td>
                <td v-if="r.factorySpan" :rowspan="r.factorySpan" :class="['grp', columnClassFor('加工厂')]" :style="columnStyleFor('加工厂')">{{ r.factory || '-' }}</td>
                <td v-if="showContractNumber" :class="columnClassFor('合同号')" :style="columnStyleFor('合同号')" :title="sewingItemParts(r).contractNo">
                  {{ sewingItemParts(r).contractNo || '-' }}
                </td>
                <td :class="columnClassFor('货号')" :style="columnStyleFor('货号')" :title="r.item_no || ''">
                  {{ showContractNumber ? (sewingItemParts(r).itemNo || '-') : (r.item_no || '-') }}
                </td>
                <td v-if="showMoldNumber" :class="columnClassFor('模具编号')" :style="columnStyleFor('模具编号')">
                  <input v-if="canEdit" class="mold-no-inp" :value="draftValue(r, 'mold_no')"
                    @input="setDraftValue(r, 'mold_no', ($event.target as HTMLInputElement).value)" />
                  <span v-else>{{ r.mold_no || '-' }}</span>
                </td>
                <td :class="columnClassFor('订单号')" :style="columnStyleFor('订单号')">{{ r.order_no || '-' }}</td>
                <td :class="columnClassFor('加工类别')" :style="columnStyleFor('加工类别')">{{ r.category || '-' }}</td>
                <td :class="columnClassFor('物料名称')" :style="columnStyleFor('物料名称')">
                  <input v-if="canEdit" class="text-inp" :value="draftValue(r, 'product')"
                    @input="setDraftValue(r, 'product', ($event.target as HTMLInputElement).value)" />
                  <span v-else>{{ r.product || '-' }}</span>
                </td>
                <td :class="columnClassFor('数量')" :style="columnStyleFor('数量')">
                  <input v-if="canEdit" type="number" class="qty-inp" min="0" :value="draftValue(r, 'quantity')"
                    @input="setDraftValue(r, 'quantity', ($event.target as HTMLInputElement).value)" />
                  <span v-else>{{ r.quantity ?? '-' }}</span>
                </td>
                <td :class="columnClassFor('下单时间')" :style="columnStyleFor('下单时间')">{{ r.order_date || '-' }}</td>
                <td :class="columnClassFor('下单交货时间')" :style="columnStyleFor('下单交货时间')">{{ r.delivery_date || '-' }}</td>
                <td :class="columnClassFor('实际交货时间')" :style="columnStyleFor('实际交货时间')">
                  <input v-if="canEdit" type="date" class="date-inp" :value="draftValue(r, 'actual_delivery_date')"
                    @input="setDraftValue(r, 'actual_delivery_date', ($event.target as HTMLInputElement).value)" />
                  <span v-else>{{ r.actual_delivery_date || '-' }}</span>
                </td>
                <td :class="columnClassFor('延迟时间')" :style="columnStyleFor('延迟时间')">{{ r.delay_days ?? '-' }}</td>
                <td :class="columnClassFor('订单总单数')" :style="columnStyleFor('订单总单数')">{{ r.orderCount }}</td>
                <td :class="columnClassFor('延期单数')" :style="columnStyleFor('延期单数')">{{ r.delayedCount }}</td>
                <td :class="columnClassFor('占比', 0)" :style="columnStyleFor('占比', 0)">{{ r.delayRatio }}</td>
                <td :class="columnClassFor('延期平均天数')" :style="columnStyleFor('延期平均天数')">{{ r.delayAvg }}</td>
                <td :class="columnClassFor(visibleHeaders[columnIndex('核价工价(港币不含税$)')] ? '核价工价(港币不含税$)' : '核价工价(不含税RMB)')" :style="columnStyleFor(visibleHeaders[columnIndex('核价工价(港币不含税$)')] ? '核价工价(港币不含税$)' : '核价工价(不含税RMB)')">
                  <input v-if="canEdit" type="number" class="price-inp" min="0" step="0.0001"
                    :value="draftValue(r, 'quote_labor_price')"
                    @input="setDraftValue(r, 'quote_labor_price', ($event.target as HTMLInputElement).value)" />
                  <span v-else>{{ r.quote }}</span>
                </td>
                <td :class="columnClassFor(visibleHeaders[columnIndex('外发工价(港币不含税$)')] ? '外发工价(港币不含税$)' : '外发工价(不含税RMB)')" :style="columnStyleFor(visibleHeaders[columnIndex('外发工价(港币不含税$)')] ? '外发工价(港币不含税$)' : '外发工价(不含税RMB)')">
                  <input v-if="canEdit" type="number" class="price-inp" min="0" step="0.0001"
                    :readonly="pricingMode === 'rmb-tax' || pricingMode === 'hkd-tax'"
                    :value="draftValue(r, 'unit_price')"
                    @input="setDraftValue(r, 'unit_price', ($event.target as HTMLInputElement).value)" />
                  <span v-else>{{ r.outPrice }}</span>
                </td>
                <td :class="columnClassFor('外发工价(人民币含税)')" :style="columnStyleFor('外发工价(人民币含税)')">
                  <input v-if="canEdit" type="number" class="price-inp" min="0" step="0.01"
                    :value="draftValue(r, 'unit_price_cny_tax')"
                    @input="setDraftValue(r, 'unit_price_cny_tax', ($event.target as HTMLInputElement).value)" />
                  <span v-else>{{ r.outPriceCnyTax }}</span>
                </td>
                <td :class="columnClassFor(pricingMode === 'rmb-tax' ? '税点' : '换算汇率')" :style="columnStyleFor(pricingMode === 'rmb-tax' ? '税点' : '换算汇率')">
                  <input v-if="canEdit" type="number" class="rate-inp" min="0.0001" step="0.01"
                    :readonly="pricingMode === 'rmb-tax'"
                    :value="draftValue(r, 'exchange_rate')"
                    @input="setDraftValue(r, 'exchange_rate', ($event.target as HTMLInputElement).value)" />
                  <span v-else>{{ r.exchangeRate }}</span>
                </td>
                <td v-if="pricingMode === 'hkd-tax'" :class="columnClassFor('税点')" :style="columnStyleFor('税点')">
                  {{ r.taxPoint ?? '-' }}
                </td>
                <td :class="[columnClassFor('占比', 1), { 'over-limit': isPercentOver100(r.priceRatio) }]" :style="columnStyleFor('占比', 1)">{{ r.priceRatio }}</td>
                <td :class="columnClassFor('备注')" :style="columnStyleFor('备注')">
                  <textarea v-if="canEdit" class="notes-inp" rows="2" :value="draftValue(r, 'notes')"
                    @input="setDraftValue(r, 'notes', ($event.target as HTMLTextAreaElement).value)" />
                  <span v-else>{{ r.notes || '-' }}</span>
                </td>

                <td v-if="canEdit" class="op-cell">
                  <div class="op-actions">
                    <button class="ghost mini" :disabled="savingRowId === r.id" @click="saveRow(r)">
                      {{ savingRowId === r.id ? '保存中…' : '保存' }}
                    </button>
                    <button class="ghost mini" @click="copyRow(r)">复制单</button>
                    <button class="ghost mini danger" @click="removeRow(r)">删除</button>
                  </div>
                </td>
              </tr>
              <tr v-else class="subtotal">
                <td
                  v-for="(header, subtotalIndex) in visibleHeaders.slice(1)"
                  :key="subtotalIndex"
                  :class="[columnClass(subtotalIndex + 1), {
                    'over-limit': header === '占比' && subtotalIndex + 1 !== visibleHeaders.indexOf('占比') && isPercentOver100(r.priceRatio),
                  }]"
                  :style="columnStyle(subtotalIndex + 1)"
                >{{ subtotalValue(header, subtotalIndex + 1, r) }}</td>
                <td v-if="canEdit"></td>
              </tr>
            </template>
            <tr v-if="!rows.length"><td :colspan="visibleColumnCount" class="hint" style="text-align:center">没有符合条件的订单</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </AppLayout>
</template>
<style scoped>
.wide {
  max-width: none;
  height: calc(100vh - 106px);
  height: calc(100dvh - 106px);
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.back { font-size: .9rem; }
.date-filter { display: flex; align-items: center; gap: .35rem; min-height: 38px; }
.date-filter select, .date-filter input { height: 38px; padding: .35rem .55rem; font-size: .86rem; border: 1px solid var(--border); border-radius: var(--radius-sm); background: white; }
.date-filter input[type="month"] { width: 138px; }
.date-filter input[type="date"] { width: 138px; }
.date-separator { color: var(--text-soft); font-size: .82rem; }
.date-clear { width: 34px; height: 34px; padding: 0; font-size: 1.15rem; line-height: 1; }
.freeze-control { display: flex; align-items: center; gap: .35rem; min-height: 38px; white-space: nowrap; color: var(--text-soft); font-size: .86rem; }
.freeze-control select { height: 38px; max-width: 148px; padding: .35rem .5rem; font: inherit; color: var(--text); border: 1px solid var(--border); border-radius: var(--radius-sm); background: white; }
.column-control { position: relative; flex: 0 0 auto; }
.column-control summary { height: 38px; box-sizing: border-box; display: flex; align-items: center; padding: .35rem .7rem; cursor: pointer; list-style: none; color: var(--text); font-size: .88rem; white-space: nowrap; border: 1px solid var(--border); border-radius: var(--radius-sm); background: white; }
.column-control summary::-webkit-details-marker { display: none; }
.column-control summary::after { content: '⌄'; margin-left: .38rem; color: var(--text-soft); font-size: 1rem; }
.column-control[open] summary { border-color: #aaa7ff; }
.column-menu { position: absolute; top: calc(100% + .35rem); right: 0; z-index: 20; width: 232px; max-height: min(490px, calc(100vh - 150px)); overflow-y: auto; padding: .65rem; border: 1px solid var(--border); border-radius: var(--radius-sm); background: white; box-shadow: 0 12px 28px rgba(31, 37, 51, .18); }
.column-menu-top { display: flex; align-items: center; justify-content: space-between; gap: .5rem; margin-bottom: .45rem; padding-bottom: .45rem; border-bottom: 1px solid var(--border); font-size: .84rem; }
.link-button { padding: 0; color: var(--primary); font-size: .8rem; background: transparent; border: 0; box-shadow: none; }
.column-option { display: flex; align-items: center; gap: .5rem; min-height: 30px; padding: .18rem .1rem; cursor: pointer; font-size: .85rem; }
.column-option input { margin: 0; }
.search-box { width: 240px; padding: .4rem .7rem; font-size: .9rem; border: 1px solid var(--border); border-radius: var(--radius-sm); }
@media (max-width: 1180px) {
  .toolbar { flex-wrap: wrap; }
  .spacer { display: none; }
}
.toolbar {
  position: relative;
  flex: 0 0 auto;
  z-index: 9;
  margin: -.35rem 0 1rem;
  padding: .35rem 0;
  background: var(--bg);
}
.scroll {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  isolation: isolate;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}
.report {
  min-width: 2860px;
  margin-top: 0;
  overflow: visible;
}
.report th, .report td { white-space: nowrap; text-align: center; font-size: .85rem; }
.report thead th {
  position: sticky;
  top: 0;
  z-index: 3;
  background: #fafbfc;
}
.report .freeze-col {
  position: sticky;
  left: var(--freeze-left);
  z-index: 2;
  box-sizing: border-box;
  background: var(--surface);
}
.report thead .freeze-col { z-index: 5; background: #fafbfc; }
.report .freeze-col.product-col { box-shadow: 5px 0 7px -7px rgba(31, 37, 51, .55); }
.report .over-limit { color: #dc2626; font-weight: 600; }
.report .item-no-col {
  width: 140px;
  min-width: 140px;
  max-width: 140px;
}
.report .range-col,
.report .factory-col,
.report .item-no-col {
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
  line-height: 1.4;
}
.report .contract-no-col {
  width: 150px;
  min-width: 150px;
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.report .mold-no-col,
.report .order-no-col {
  width: 140px;
  min-width: 140px;
  max-width: 140px;
}
.report .category-col {
  width: 120px;
  min-width: 120px;
  max-width: 120px;
}
.report .product-col {
  width: 160px;
  min-width: 160px;
  max-width: 160px;
}
.report .notes-col {
  width: 220px;
  min-width: 220px;
  max-width: 220px;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
  line-height: 1.45;
}
.notes-inp {
  box-sizing: border-box;
  width: 100%;
  min-height: 52px;
  padding: .35rem .45rem;
  resize: vertical;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  line-height: 1.4;
  font: inherit;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
.report td.grp { font-weight: 600; background: #fafbff; }
.report td.grp.freeze-col { background: #fafbff; }
.report tr.subtotal td { background: #fff7e6; font-weight: 600; }
.date-inp { padding: .25rem .4rem; font-size: .82rem; border: 1px solid var(--border); border-radius: var(--radius-sm); }
.pmc-inp { width: 96px; padding: .25rem .4rem; font-size: .82rem; text-align: center; border: 1px solid var(--border); border-radius: var(--radius-sm); }
.mold-no-inp { width: 120px; padding: .25rem .4rem; font-size: .82rem; text-align: center; border: 1px solid var(--border); border-radius: var(--radius-sm); }
.price-inp { width: 96px; padding: .25rem .4rem; font-size: .82rem; text-align: center; border: 1px solid var(--border); border-radius: var(--radius-sm); }
.rate-inp { width: 76px; padding: .25rem .4rem; font-size: .82rem; text-align: center; border: 1px solid var(--border); border-radius: var(--radius-sm); }
.text-inp { width: 132px; padding: .25rem .4rem; font-size: .82rem; border: 1px solid var(--border); border-radius: var(--radius-sm); }
.qty-inp { width: 88px; padding: .25rem .4rem; font-size: .82rem; text-align: center; border: 1px solid var(--border); border-radius: var(--radius-sm); }
.op-col { min-width: 172px; }
.op-actions { display: flex; gap: .35rem; justify-content: center; align-items: center; }
.mini { padding: .25rem .5rem; font-size: .8rem; }
.danger { color: #dc2626; border-color: #fecaca; }
.save-toast {
  position: fixed;
  top: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: .55rem;
  min-width: 220px;
  max-width: min(520px, calc(100vw - 32px));
  padding: .8rem 1rem;
  border: 1px solid;
  border-radius: 10px;
  box-shadow: 0 12px 30px rgba(31, 37, 51, .18);
  background: #fff;
  font-size: .92rem;
  font-weight: 600;
}
.save-toast.success { color: #15803d; border-color: #bbf7d0; background: #f0fdf4; }
.save-toast.error { color: #b91c1c; border-color: #fecaca; background: #fef2f2; }
.save-toast-icon {
  width: 22px;
  height: 22px;
  display: inline-grid;
  place-items: center;
  flex: 0 0 auto;
  border-radius: 50%;
  color: #fff;
  font-size: .78rem;
}
.save-toast.success .save-toast-icon { background: #16a34a; }
.save-toast.error .save-toast-icon { background: #dc2626; }
.save-toast-enter-active, .save-toast-leave-active { transition: opacity .2s ease, transform .2s ease; }
.save-toast-enter-from, .save-toast-leave-to { opacity: 0; transform: translate(-50%, -10px); }
</style>
