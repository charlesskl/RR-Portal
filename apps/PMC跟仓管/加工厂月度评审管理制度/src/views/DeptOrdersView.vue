<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import AppLayout from '../components/AppLayout.vue'
import { useOrdersStore } from '../stores/orders'
import { useFactoriesStore } from '../stores/factories'
import { useAuthStore } from '../stores/auth'
import { CRAFT_LABELS, REGION_LABELS, regionOf, type Craft, type Region } from '../constants/roles'
import { canEditOrders, allowedRegions } from '../utils/permissions'
import { buildDeliveryReport, deliveryHeaders, exportDeliveryExcel, parseDeliveryImport, splitSewingContractItemNo, type ReportRow, type DetailRow } from '../utils/deliveryStats'
import { readDeliveryPdfAsAoa } from '../utils/pdfDeliveryImport'
import { parseDeliveryExcelFiles } from '../utils/deliveryExcelImport'
import { cnyTaxToHkdUntaxed, cnyTaxToUntaxedRmb, DEFAULT_CNY_TO_HKD_RATE } from '../utils/orderPricing'
import { matchesOrderDate, type OrderDateFilter } from '../utils/orderDateFilter'
import { deliveryImportFactoryMap } from '../utils/deliveryImportScope'
import { isPercentOver100 } from '../utils/percentage'
import type { Order } from '../types/order'

const route = useRoute()
const orders = useOrdersStore()
const factories = useFactoriesStore()
const auth = useAuthStore()
const fileInput = ref<HTMLInputElement | null>(null)
const importingExcel = ref(false)
const pdfInput = ref<HTMLInputElement | null>(null)

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

onMounted(() => Promise.all([orders.fetchAll(), factories.fetchAll()]))

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
const rows = computed<ReportRow[]>(() =>
  buildDeliveryReport(deptOrders.value, deptName.value, (o) => o.expand?.factory?.name ?? '', craft.value === 'sewing'))
const showMoldNumber = computed(() => craft.value === 'injection')
const showContractNumber = computed(() => craft.value === 'sewing')
const visibleHeaders = computed(() => deliveryHeaders(showMoldNumber.value, showContractNumber.value))
const visibleColumnCount = computed(() => visibleHeaders.value.length + (canEdit.value ? 1 : 0))
const subtotalLabelSpan = computed(() => Math.max(1, visibleHeaders.value.indexOf('订单总单数') - 1))

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
}
const drafts = ref<Record<string, RowDraft>>({})

function convertedOutPrice(cnyTaxPrice: number, rateOrTaxPoint: number) {
  return craft.value === 'sewing'
    ? cnyTaxToUntaxedRmb(cnyTaxPrice, rateOrTaxPoint)
    : cnyTaxToHkdUntaxed(cnyTaxPrice, rateOrTaxPoint)
}

function normalizeDeptPricing(payload: Record<string, any>) {
  if (craft.value !== 'sewing') return payload
  const cnyTaxPrice = Number(payload.unit_price_cny_tax)
  const taxPoint = Number(payload.exchange_rate)
  if (Number.isFinite(cnyTaxPrice) && Number.isFinite(taxPoint) && taxPoint > 0) {
    payload.unit_price = cnyTaxToUntaxedRmb(cnyTaxPrice, taxPoint)
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
      ? String(convertedOutPrice(cnyTaxPrice, exchangeRate))
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
  )
}

async function saveRow(row: DetailRow) {
  const draft = drafts.value[row.id] ?? draftFromRow(row)
  const product = draft.product.trim()
  const quantity = parsePrice(draft.quantity)
  const quote = parsePrice(draft.quote_labor_price)
  const enteredUnitPrice = parsePrice(draft.unit_price)
  const unitPriceCnyTax = parsePrice(draft.unit_price_cny_tax)
  const exchangeRate = parsePrice(draft.exchange_rate)
  const unitPrice = craft.value === 'sewing' && unitPriceCnyTax != null && exchangeRate != null
    ? cnyTaxToUntaxedRmb(unitPriceCnyTax, exchangeRate)
    : enteredUnitPrice
  if (!product) {
    alert('请输入物料名称')
    return
  }
  if (quantity === undefined) {
    alert('数量请输入有效数字')
    return
  }
  if (quote === undefined || unitPrice === undefined || unitPriceCnyTax === undefined || exchangeRate === undefined || (exchangeRate != null && exchangeRate <= 0)) {
    alert('工价请输入有效数字')
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
  await orders.update(row.id, data)
  await orders.fetchAll()
  drafts.value[row.id] = draft
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
  const exchangeRate = parsePrice(draft.exchange_rate)
  const unitPrice = craft.value === 'sewing' && unitPriceCnyTax != null && exchangeRate != null
    ? cnyTaxToUntaxedRmb(unitPriceCnyTax, exchangeRate)
    : enteredUnitPrice
  if (quantity === undefined) {
    alert('数量请输入有效数字')
    return
  }
  if (quote === undefined || unitPrice === undefined || unitPriceCnyTax === undefined || exchangeRate === undefined || (exchangeRate != null && exchangeRate <= 0)) {
    alert('工价请输入有效数字')
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
    notes: source.notes,
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
        <table class="report">
          <thead>
            <tr>
              <th
                v-for="h in visibleHeaders"
                :key="h"
                :class="{ 'item-no-col': h === '货号', 'notes-col': h === '备注' }"
              >{{ h }}</th>
              <th v-if="canEdit" class="op-col">操作</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="(r, i) in rows" :key="i">
              <tr v-if="r.kind === 'detail'">
                <td v-if="r.rangeSpan" :rowspan="r.rangeSpan" class="grp">{{ r.range }}</td>
                <td>
                  <input v-if="canEdit" class="pmc-inp" :value="draftValue(r, 'pmc')"
                    @input="setDraftValue(r, 'pmc', ($event.target as HTMLInputElement).value)" />
                  <span v-else>{{ r.pmc || '-' }}</span>
                </td>
                <td v-if="r.factorySpan" :rowspan="r.factorySpan" class="grp">{{ r.factory || '-' }}</td>
                <td v-if="showContractNumber" class="contract-no-col" :title="sewingItemParts(r).contractNo">
                  {{ sewingItemParts(r).contractNo || '-' }}
                </td>
                <td class="item-no-col" :title="r.item_no || ''">
                  {{ showContractNumber ? (sewingItemParts(r).itemNo || '-') : (r.item_no || '-') }}
                </td>
                <td v-if="showMoldNumber">
                  <input v-if="canEdit" class="mold-no-inp" :value="draftValue(r, 'mold_no')"
                    @input="setDraftValue(r, 'mold_no', ($event.target as HTMLInputElement).value)" />
                  <span v-else>{{ r.mold_no || '-' }}</span>
                </td>
                <td>{{ r.order_no || '-' }}</td>
                <td>{{ r.category || '-' }}</td>
                <td>
                  <input v-if="canEdit" class="text-inp" :value="draftValue(r, 'product')"
                    @input="setDraftValue(r, 'product', ($event.target as HTMLInputElement).value)" />
                  <span v-else>{{ r.product || '-' }}</span>
                </td>
                <td>
                  <input v-if="canEdit" type="number" class="qty-inp" min="0" :value="draftValue(r, 'quantity')"
                    @input="setDraftValue(r, 'quantity', ($event.target as HTMLInputElement).value)" />
                  <span v-else>{{ r.quantity ?? '-' }}</span>
                </td>
                <td>{{ r.order_date || '-' }}</td>
                <td>{{ r.delivery_date || '-' }}</td>
                <td>
                  <input v-if="canEdit" type="date" class="date-inp" :value="draftValue(r, 'actual_delivery_date')"
                    @input="setDraftValue(r, 'actual_delivery_date', ($event.target as HTMLInputElement).value)" />
                  <span v-else>{{ r.actual_delivery_date || '-' }}</span>
                </td>
                <td>{{ r.delay_days ?? '-' }}</td>
                <td>{{ r.orderCount }}</td>
                <td>{{ r.delayedCount }}</td>
                <td>{{ r.delayRatio }}</td>
                <td>{{ r.delayAvg }}</td>
                <td>
                  <input v-if="canEdit" type="number" class="price-inp" min="0" step="0.0001"
                    :value="draftValue(r, 'quote_labor_price')"
                    @input="setDraftValue(r, 'quote_labor_price', ($event.target as HTMLInputElement).value)" />
                  <span v-else>{{ r.quote }}</span>
                </td>
                <td>
                  <input v-if="canEdit" type="number" class="price-inp" min="0" step="0.0001"
                    :readonly="showContractNumber"
                    :value="draftValue(r, 'unit_price')"
                    @input="setDraftValue(r, 'unit_price', ($event.target as HTMLInputElement).value)" />
                  <span v-else>{{ r.outPrice }}</span>
                </td>
                <td>
                  <input v-if="canEdit" type="number" class="price-inp" min="0" step="0.01"
                    :value="draftValue(r, 'unit_price_cny_tax')"
                    @input="setDraftValue(r, 'unit_price_cny_tax', ($event.target as HTMLInputElement).value)" />
                  <span v-else>{{ r.outPriceCnyTax }}</span>
                </td>
                <td>
                  <input v-if="canEdit" type="number" class="rate-inp" min="0.0001" step="0.01"
                    :value="draftValue(r, 'exchange_rate')"
                    @input="setDraftValue(r, 'exchange_rate', ($event.target as HTMLInputElement).value)" />
                  <span v-else>{{ r.exchangeRate }}</span>
                </td>
                <td :class="{ 'over-limit': isPercentOver100(r.priceRatio) }">{{ r.priceRatio }}</td>
                <td class="notes-col">{{ r.notes || '-' }}</td>
                <td v-if="canEdit" class="op-cell">
                  <div class="op-actions">
                    <button class="ghost mini" @click="saveRow(r)">保存</button>
                    <button class="ghost mini" @click="copyRow(r)">复制单</button>
                    <button class="ghost mini danger" @click="removeRow(r)">删除</button>
                  </div>
                </td>
              </tr>
              <tr v-else class="subtotal">
                <td></td>
                <td :colspan="subtotalLabelSpan">{{ r.factory }}-小计</td>
                <td>{{ r.orderCount }}</td>
                <td>{{ r.delayedCount }}</td>
                <td>{{ r.delayRatio }}</td>
                <td>{{ r.delayAvg }}</td>
                <td>{{ r.quote }}</td>
                <td>{{ r.outPrice }}</td>
                <td>{{ r.outPriceCnyTax }}</td>
                <td></td>
                <td :class="{ 'over-limit': isPercentOver100(r.priceRatio) }">{{ r.priceRatio }}</td>
                <td></td>
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
.wide { max-width: none; }
.back { font-size: .9rem; }
.date-filter { display: flex; align-items: center; gap: .35rem; min-height: 38px; }
.date-filter select, .date-filter input { height: 38px; padding: .35rem .55rem; font-size: .86rem; border: 1px solid var(--border); border-radius: var(--radius-sm); background: white; }
.date-filter input[type="month"] { width: 138px; }
.date-filter input[type="date"] { width: 138px; }
.date-separator { color: var(--text-soft); font-size: .82rem; }
.date-clear { width: 34px; height: 34px; padding: 0; font-size: 1.15rem; line-height: 1; }
.search-box { width: 240px; padding: .4rem .7rem; font-size: .9rem; border: 1px solid var(--border); border-radius: var(--radius-sm); }
@media (max-width: 1180px) {
  .toolbar { flex-wrap: wrap; }
  .spacer { display: none; }
}
.scroll { overflow-x: auto; }
.report { min-width: 3140px; }
.report th, .report td { white-space: nowrap; text-align: center; font-size: .85rem; }
.report .over-limit { color: #dc2626; font-weight: 600; }
.report .item-no-col {
  width: 220px;
  min-width: 220px;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.report .contract-no-col {
  width: 150px;
  min-width: 150px;
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
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
.report td.grp { font-weight: 600; background: #fafbff; }
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
</style>
