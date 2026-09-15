<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import * as XLSX from 'xlsx'
import AppLayout from '../components/AppLayout.vue'
import { pb } from '../pb'
import { useFactoriesStore } from '../stores/factories'
import { useAuthStore } from '../stores/auth'
import { canEditQuality, allowedRegions, canViewCraft } from '../utils/permissions'
import { buildQualityInspectionImportColumns, formatImportedDate, normalizeExcelHeader, resolveQualityInspectionFactory } from '../utils/qualityInspectionImport'
import { matchesQualityInspectionFilters, qualityInspectionProcessTypes } from '../utils/qualityInspectionFilters'
import type { OrderDateFilter } from '../utils/orderDateFilter'
import { REGIONS, REGION_LABELS, regionOf, type Craft, type Region } from '../constants/roles'
import type { QualityInspection } from '../types/qualityInspection'
import { useTableColumnPreferences } from '../composables/useTableColumnPreferences'

const factories = useFactoriesStore()
const auth = useAuthStore()
const records = ref<QualityInspection[]>([])
const myRegions = computed(() => (auth.role ? allowedRegions(auth.role) : REGIONS))
const regionFilter = ref<Region | ''>((useRoute().query.region as Region) || '')
const processTypeFilter = ref('')
const dateMode = ref<'all' | 'day' | 'month' | 'range'>('all')
const selectedDate = ref(new Date().toISOString().slice(0, 10))
const selectedMonth = ref(new Date().toISOString().slice(0, 7))
const rangeStart = ref('')
const rangeEnd = ref('')
const search = ref('')
const factoryName = (r: QualityInspection) => r.expand?.factory?.name ?? '-'

function normalizeSearch(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, '').replace(/[/.]/g, '-').toLowerCase()
}

function dateSearchValues(value: unknown): string[] {
  const date = String(value ?? '').slice(0, 10)
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return [date]
  const [, year, month, day] = m
  const m1 = String(Number(month))
  const d1 = String(Number(day))
  return [date, `${year}-${m1}-${d1}`, `${month}-${day}`, `${m1}-${d1}`, `${year}${month}${day}`]
}

function matchesSearch(r: QualityInspection): boolean {
  const q = normalizeSearch(search.value)
  if (!q) return true
  return [
    ...dateSearchValues(r.inspect_date),
    factoryName(r),
    r.customer,
    r.item_no,
  ].some((value) => normalizeSearch(value).includes(q))
}

const scopedRecords = computed(() =>
  records.value
    .filter((r) => !r.expand?.factory?.craft || canViewCraft(r.expand.factory.craft as Craft))
    .filter((r) => myRegions.value.includes(regionOf(r.expand?.factory)))
    .filter((r) => !regionFilter.value || regionOf(r.expand?.factory) === regionFilter.value))
const processTypeOptions = computed(() => qualityInspectionProcessTypes(scopedRecords.value))
const dateFilter = computed<OrderDateFilter>(() => {
  if (dateMode.value === 'day') return { mode: 'range', start: selectedDate.value, end: selectedDate.value }
  if (dateMode.value === 'month') return { mode: 'month', month: selectedMonth.value }
  if (dateMode.value === 'range') return { mode: 'range', start: rangeStart.value, end: rangeEnd.value }
  return { mode: 'all' }
})
const filteredRecords = computed(() =>
  scopedRecords.value
    .filter((r) => matchesQualityInspectionFilters(r, processTypeFilter.value, dateFilter.value))
    .filter(matchesSearch))

function clearDateFilter() {
  dateMode.value = 'all'
  rangeStart.value = ''
  rangeEnd.value = ''
}
const showForm = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const RESULTS = ['PASS', 'FAIL']
interface InspectionImportDraftRow {
  rowNo: number
  factoryName: string
  payload: Record<string, any>
  error: string
  // 写入失败可重试，不计入异常行（否则会禁用确认按钮导致永远无法重试）
  saveError?: string
}
const importDraftRows = ref<InspectionImportDraftRow[]>([])
const importPreviewOpen = ref(false)
const importConfirming = ref(false)
const importDraftInvalidCount = computed(() => importDraftRows.value.filter((row) => row.error).length)
const tableColumns = [
  { key: 'index', label: '序号', width: 64, hideable: false },
  { key: 'date', label: '送货日期', width: 138 },
  { key: 'factory', label: '加工厂名称', width: 260 },
  { key: 'processType', label: '加工类型', width: 120 },
  { key: 'customer', label: '客户', width: 120 },
  { key: 'deliveryNo', label: '送货单号', width: 130 },
  { key: 'itemNo', label: '货号', width: 120 },
  { key: 'product', label: '产品名称', width: 160 },
  { key: 'quantity', label: '数量', width: 90 },
  { key: 'orderCount', label: '单数', width: 80 },
  { key: 'internalResult', label: '内部-检验结果', width: 120 },
  { key: 'internalDefect', label: '内部-不良描述', width: 140 },
  { key: 'internalInspector', label: '内部-检验人员', width: 120 },
  { key: 'custDate', label: '客户-检验日期', width: 130 },
  { key: 'custResult', label: '客户-检验结果', width: 120 },
  { key: 'custDefect', label: '客户-不良描述', width: 140 },
  { key: 'notes', label: '备注', width: 160 },
  { key: 'actions', label: '操作', width: 190 },
]
const { frozenThrough, columnPanelOpen, visibleColumns, isVisible, isFrozen, columnStyle, toggleColumn, showAllColumns } =
  useTableColumnPreferences('quality-inspection-table-columns', tableColumns)
const visibleColumnCount = computed(() => visibleColumns.value.filter((column) => column.key !== 'actions' || canOperate.value).length)

async function load() {
  records.value = await pb.collection('quality_inspections').getFullList<QualityInspection>({
    sort: 'inspect_date,delivery_no,item_no,product', expand: 'factory',
  })
}
onMounted(async () => { await Promise.all([factories.fetchAll(), load()]) })
const canEdit = computed(() => (auth.role ? canEditQuality(auth.role) : false))
const canDelete = computed(() => canEdit.value)
const canOperate = computed(() => canEdit.value || canDelete.value)

function blankDraft() {
  return {
    inspect_date: '', factory: '', process_type: '', customer: '', delivery_no: '', item_no: '',
    product: '', quantity: null as number | null,
    internal_result: '', internal_defect: '', internal_inspector: '',
    cust_inspect_date: '', cust_result: '', cust_defect: '', notes: '',
  }
}
const draft = reactive(blankDraft())
const saving = ref(false)
const editingId = ref<string | null>(null)
const rowSavingId = ref<string | null>(null)
const rowDraft = reactive(blankDraft())

function startEdit(r: QualityInspection) {
  editingId.value = r.id
  Object.assign(rowDraft, blankDraft(), {
    inspect_date: r.inspect_date?.slice(0, 10) ?? '', factory: r.factory ?? '',
    process_type: r.process_type ?? '', customer: r.customer ?? '', delivery_no: r.delivery_no ?? '',
    item_no: r.item_no ?? '', product: r.product ?? '', quantity: r.quantity ?? null,
    internal_result: r.internal_result ?? '', internal_defect: r.internal_defect ?? '',
    internal_inspector: r.internal_inspector ?? '', cust_inspect_date: r.cust_inspect_date ?? '',
    cust_result: r.cust_result ?? '', cust_defect: r.cust_defect ?? '', notes: r.notes ?? '',
  })
}

async function saveEdit(r: QualityInspection) {
  if (editingId.value !== r.id) { alert('请先点击编辑'); return }
  if (!rowDraft.factory) { alert('请选择加工厂'); return }
  rowSavingId.value = r.id
  const payload: Record<string, any> = {}
  for (const [key, value] of Object.entries(rowDraft)) {
    if (key === 'inspect_date') payload.inspect_date = value || null
    else payload[key] = key === 'quantity' && value !== null && value !== '' ? Number(value) : value
  }
  try {
    await pb.collection('quality_inspections').update(r.id, payload)
    editingId.value = null
    await load()
    alert('保存成功')
  } catch (error) {
    console.error(error)
    alert('保存失败，请检查填写内容后重试')
  } finally { rowSavingId.value = null }
}

async function submit() {
  if (!draft.factory) { alert('请选择加工厂'); return }
  saving.value = true
  const payload: Record<string, any> = { created_by: auth.userId ?? undefined }
  for (const [k, v] of Object.entries(draft)) {
    if (k === 'inspect_date') { if (v) payload.inspect_date = v; continue }
    if (v == null) continue
    payload[k] = v
  }
  try {
    await pb.collection('quality_inspections').create(payload)
    Object.assign(draft, blankDraft())
    showForm.value = false
    await load()
  } finally { saving.value = false }
}

async function remove(r: QualityInspection) {
  if (!confirm('确定删除这条检验记录?')) return
  await pb.collection('quality_inspections').delete(r.id)
  await load()
}

async function importExcel(ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0]
  if (!file) return
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { cellDates: true })
  const aoa = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: false })
  const headerIdx = aoa.findIndex((row) => row.some((c) => normalizeExcelHeader(c) === '货号') && row.some((c) => normalizeExcelHeader(c) === '产品名称'))
  if (headerIdx < 0) { alert('未识别到表头(需含「货号/产品名称」)'); return }
  const idx = buildQualityInspectionImportColumns(aoa[headerIdx])
  const cell = (row: any[], i: number) => (i >= 0 ? row[i] : '')
  const str = (row: any[], i: number) => { const v = cell(row, i); return v == null ? '' : String(v).trim() }
  const toNumber = (v: any) => Number(String(v ?? '').replace(/,/g, ''))
  const preview: InspectionImportDraftRow[] = []
  for (const [offset, row] of aoa.slice(headerIdx + 1).entries()) {
    const fname = str(row, idx.factory)
    const prod = str(row, idx.product)
    if (prod.includes('小计') || prod.includes('合计')) continue
    if (!fname && !prod) continue
    const factoryMatch = resolveQualityInspectionFactory(factories.items, fname, str(row, idx.ptype), regionFilter.value)
    const payload: Record<string, any> = {
      created_by: auth.userId ?? undefined,
      factory: factoryMatch.status === 'matched' ? factoryMatch.id : '', process_type: str(row, idx.ptype), customer: str(row, idx.customer),
      delivery_no: str(row, idx.delivery_no), item_no: str(row, idx.item_no), product: prod,
      internal_result: str(row, idx.ir), internal_defect: str(row, idx.idf), internal_inspector: str(row, idx.iins),
      cust_inspect_date: str(row, idx.cdate), cust_result: str(row, idx.cres), cust_defect: str(row, idx.cdef),
      notes: str(row, idx.notes),
    }
    const dv = cell(row, idx.date); if (dv) payload.inspect_date = formatImportedDate(dv)
    const qv = cell(row, idx.qty); if (qv !== '' && qv != null) payload.quantity = toNumber(qv)
    const errors: string[] = []
    if (!fname) errors.push('缺少加工厂名称')
    else if (factoryMatch.status !== 'matched') errors.push(factoryMatch.status === 'ambiguous' ? '工厂简称匹配到多家工厂' : '工厂名未匹配')
    if (!prod) errors.push('缺少产品名称')
    preview.push({ rowNo: headerIdx + offset + 2, factoryName: fname, payload, error: errors.join('；') })
  }
  if (fileInput.value) fileInput.value.value = ''
  if (!preview.length) { alert('未识别到可预览的数据行'); return }
  importDraftRows.value = preview
  importPreviewOpen.value = true
}

function cancelImportPreview() {
  importPreviewOpen.value = false
  importDraftRows.value = []
}

async function confirmImportPreview() {
  if (importDraftInvalidCount.value) { alert('草稿中仍有异常行，请取消后修正 Excel 再重新导入'); return }
  if (!importDraftRows.value.length || importConfirming.value) return
  importConfirming.value = true
  const failedRows: InspectionImportDraftRow[] = []
  let ok = 0
  try {
    for (const row of importDraftRows.value) {
      try {
        await pb.collection('quality_inspections').create(row.payload)
        ok++
      } catch (error: any) {
        console.error(error)
        const message = error?.response?.message || error?.message || '写入失败'
        failedRows.push({ ...row, error: '', saveError: `写入失败：${message}` })
      }
    }
    if (ok) await load()
    if (!failedRows.length) {
      cancelImportPreview()
      alert(`正式导入完成：成功 ${ok} 条`)
    } else {
      importDraftRows.value = failedRows
      alert(`正式导入完成：成功 ${ok} 条，失败 ${failedRows.length} 条；失败行已保留在草稿中`)
    }
  } finally { importConfirming.value = false }
}

function exportExcel() {
  const title = '加工厂品质检验明细'
  // 三行表头:标题 / 分组 / 列名
  const titleRow = new Array(17).fill(''); titleRow[0] = title
  const groupRow = ['序号', '送货日期', '加工厂名称', '加工类型', '客户', '送货单号', '货号', '产品名称', '数量', '单数',
    '内部验货状态', '', '', '客户验货状态（适用于装配与包装加工）', '', '', '备注']
  const subRow = ['', '', '', '', '', '', '', '', '', '', '检验结果', '不良描述', '检验人员', '检验日期', '检验结果', '不良描述', '']
  const body = filteredRecords.value.map((r, i) => [
    i + 1, r.inspect_date ? r.inspect_date.slice(0, 10) : '', factoryName(r), r.process_type ?? '', r.customer ?? '',
    r.delivery_no ?? '', r.item_no ?? '', r.product ?? '', r.quantity ?? '', 1,
    r.internal_result ?? '', r.internal_defect ?? '', r.internal_inspector ?? '',
    r.cust_inspect_date ?? '', r.cust_result ?? '', r.cust_defect ?? '', r.notes ?? '',
  ])
  const ws = XLSX.utils.aoa_to_sheet([titleRow, groupRow, subRow, ...body])
  const merges: any[] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 16 } }]
  for (const c of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 16]) merges.push({ s: { r: 1, c }, e: { r: 2, c } })
  merges.push({ s: { r: 1, c: 10 }, e: { r: 1, c: 12 } })  // 内部验货状态
  merges.push({ s: { r: 1, c: 13 }, e: { r: 1, c: 15 } })  // 客户验货状态
  ws['!merges'] = merges
  const cw = (v: any) => { let w = 0; for (const ch of String(v ?? '')) w += /[⺀-￿]/.test(ch) ? 2 : 1; return w }
  ws['!cols'] = groupRow.map((_, c) => {
    let max = Math.max(cw(groupRow[c]), cw(subRow[c]))
    for (const row of body) max = Math.max(max, cw(row[c]))
    return { wch: Math.min(Math.max(max + 2, 6), 32) }
  })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '品质检验明细')
  XLSX.writeFile(wb, `${title}.xlsx`)
}
</script>
<template>
  <AppLayout>
    <div class="page wide">
      <div class="toolbar">
        <h2 style="margin:0">品质检验明细</h2>
        <span class="muted">共 {{ filteredRecords.length }} 条</span>
        <select v-model="regionFilter" class="region-sel">
          <option value="">全部厂区</option>
          <option v-for="rg in myRegions" :key="rg" :value="rg">{{ REGION_LABELS[rg] }}厂区</option>
        </select>
        <select v-model="processTypeFilter" class="filter-sel" aria-label="加工类型筛选">
          <option value="">全部加工类型</option>
          <option v-for="processType in processTypeOptions" :key="processType" :value="processType">{{ processType }}</option>
        </select>
        <div class="date-filter">
          <select v-model="dateMode" class="filter-sel" aria-label="品质检验时间段筛选">
            <option value="all">全部时间</option>
            <option value="day">按日期</option>
            <option value="month">按月份</option>
            <option value="range">自定义时间段</option>
          </select>
          <input v-if="dateMode === 'day'" v-model="selectedDate" type="date" aria-label="品质检验日期" />
          <input v-else-if="dateMode === 'month'" v-model="selectedMonth" type="month" aria-label="品质检验月份" />
          <template v-else-if="dateMode === 'range'">
            <input v-model="rangeStart" type="date" :max="rangeEnd || undefined" aria-label="品质检验开始日期" />
            <span class="date-separator">至</span>
            <input v-model="rangeEnd" type="date" :min="rangeStart || undefined" aria-label="品质检验结束日期" />
          </template>
          <button v-if="dateMode !== 'all'" class="ghost date-clear" type="button" title="清除时间筛选" aria-label="清除品质检验时间筛选" @click="clearDateFilter">×</button>
        </div>
        <input
          v-model="search"
          class="search-box"
          placeholder="搜索 送货日期/加工厂/客户/货号"
        />
        <label class="freeze-control">冻结至
          <select v-model="frozenThrough" class="region-sel">
            <option value="">不冻结列</option>
            <option v-for="column in visibleColumns" :key="column.key" :value="column.key" :disabled="column.key === 'actions'">{{ column.label }}</option>
          </select>
        </label>
        <div class="column-menu">
          <button class="ghost" @click="columnPanelOpen = !columnPanelOpen">栏目显示</button>
          <div v-if="columnPanelOpen" class="column-panel">
            <div class="column-panel-head"><b>显示/隐藏栏目</b><button class="link-btn" @click="showAllColumns">全部显示</button></div>
            <label v-for="column in tableColumns.filter(c => c.hideable !== false && (c.key !== 'actions' || canOperate))" :key="column.key">
              <input type="checkbox" :checked="isVisible(column.key)" @change="toggleColumn(column.key)" /> {{ column.label }}
            </label>
          </div>
        </div>
        <span class="spacer"></span>
        <button v-if="canEdit" class="ghost" @click="fileInput?.click()">导入 Excel</button>
        <input ref="fileInput" type="file" accept=".xlsx,.xls,.csv" style="display:none" @change="importExcel" />
        <button v-if="canEdit" class="ghost" @click="showForm = !showForm">{{ showForm ? '收起' : '+ 新增检验记录' }}</button>
        <button @click="exportExcel">导出 Excel</button>
      </div>

      <section v-if="showForm" class="card form-card">
        <div class="grid">
          <label>送货日期 <input v-model="draft.inspect_date" type="date" /></label>
          <label>加工厂
            <select v-model="draft.factory">
              <option value="">选择工厂</option>
              <option v-for="f in factories.items" :key="f.id" :value="f.id">{{ f.name }}</option>
            </select>
          </label>
          <label>加工类型 <input v-model="draft.process_type" placeholder="如半成品组装" /></label>
          <label>客户 <input v-model="draft.customer" /></label>
          <label>送货单号 <input v-model="draft.delivery_no" /></label>
          <label>货号 <input v-model="draft.item_no" /></label>
          <label>产品名称 <input v-model="draft.product" /></label>
          <label>数量 <input v-model.number="draft.quantity" type="number" min="0" /></label>
          <label>内部-检验结果
            <select v-model="draft.internal_result"><option value="">-</option><option v-for="o in RESULTS" :key="o" :value="o">{{ o }}</option></select>
          </label>
          <label>内部-不良描述 <input v-model="draft.internal_defect" /></label>
          <label>内部-检验人员 <input v-model="draft.internal_inspector" /></label>
          <label>客户-检验日期 <input v-model="draft.cust_inspect_date" placeholder="如 6月23日" /></label>
          <label>客户-检验结果
            <select v-model="draft.cust_result"><option value="">-</option><option v-for="o in RESULTS" :key="o" :value="o">{{ o }}</option></select>
          </label>
          <label>客户-不良描述 <input v-model="draft.cust_defect" /></label>
          <label>备注 <input v-model="draft.notes" /></label>
        </div>
        <div class="actions"><button :disabled="saving" @click="submit">{{ saving ? '保存中…' : '保存记录' }}</button></div>
      </section>

      <div v-if="importPreviewOpen" class="import-overlay" @click.self="cancelImportPreview">
        <section class="import-dialog" role="dialog" aria-modal="true" aria-label="品质检验 Excel 导入草稿预览">
          <div class="import-dialog-head">
            <div><h3>Excel 导入草稿预览</h3><span class="muted">共 {{ importDraftRows.length }} 条，异常 {{ importDraftInvalidCount }} 条</span></div>
            <button class="ghost" @click="cancelImportPreview">关闭</button>
          </div>
          <p class="import-tip">此时尚未写入系统。请检查内容；如有异常行，请取消并修正 Excel 后重新导入。</p>
          <div class="import-table-wrap">
            <table class="import-preview-table">
              <thead><tr><th>Excel行</th><th>送货日期</th><th>加工厂</th><th>加工类型</th><th>客户</th><th>货号</th><th>产品名称</th><th>数量</th><th>检查结果</th></tr></thead>
              <tbody>
                <tr v-for="row in importDraftRows" :key="row.rowNo" :class="{ 'import-row-error': row.error || row.saveError }">
                  <td>{{ row.rowNo }}</td><td>{{ row.payload.inspect_date || '-' }}</td><td>{{ row.factoryName || '-' }}</td>
                  <td>{{ row.payload.process_type || '-' }}</td><td>{{ row.payload.customer || '-' }}</td><td>{{ row.payload.item_no || '-' }}</td>
                  <td>{{ row.payload.product || '-' }}</td><td>{{ row.payload.quantity ?? '-' }}</td><td>{{ row.error || row.saveError || '可导入' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="import-actions">
            <button class="ghost" :disabled="importConfirming" @click="cancelImportPreview">取消导入</button>
            <button :disabled="importConfirming || !!importDraftInvalidCount" @click="confirmImportPreview">
              {{ importConfirming ? '导入中…' : `确认导入 ${importDraftRows.length} 条` }}
            </button>
          </div>
        </section>
      </div>

      <div class="scroll">
        <table class="qi">
          <thead>
            <tr>
              <th v-for="column in visibleColumns.filter(c => c.key !== 'actions' || canOperate)" :key="column.key"
                :class="{ frozen: isFrozen(column.key), 'freeze-edge': frozenThrough === column.key }" :style="columnStyle(column.key)">
                {{ column.label }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in filteredRecords" :key="r.id">
              <td :class="{ frozen: isFrozen('index'), 'freeze-edge': frozenThrough === 'index' }" :style="columnStyle('index')">{{ i + 1 }}</td>
              <td v-if="isVisible('date')" :class="{ frozen: isFrozen('date'), 'freeze-edge': frozenThrough === 'date' }" :style="columnStyle('date')"><input v-if="editingId === r.id" v-model="rowDraft.inspect_date" class="table-input date-input" type="date" /><template v-else>{{ r.inspect_date ? r.inspect_date.slice(0, 10) : '-' }}</template></td>
              <td v-if="isVisible('factory')" :class="{ frozen: isFrozen('factory'), 'freeze-edge': frozenThrough === 'factory' }" :style="columnStyle('factory')">
                <select v-if="editingId === r.id" v-model="rowDraft.factory" class="table-input factory-input">
                  <option value="">选择工厂</option>
                  <option v-for="f in factories.items" :key="f.id" :value="f.id">{{ f.name }}</option>
                </select>
                <template v-else>{{ factoryName(r) }}</template>
              </td>
              <td v-if="isVisible('processType')" :class="{ frozen: isFrozen('processType'), 'freeze-edge': frozenThrough === 'processType' }" :style="columnStyle('processType')"><input v-if="editingId === r.id" v-model="rowDraft.process_type" class="table-input" /><template v-else>{{ r.process_type || '-' }}</template></td>
              <td v-if="isVisible('customer')" :class="{ frozen: isFrozen('customer'), 'freeze-edge': frozenThrough === 'customer' }" :style="columnStyle('customer')"><input v-if="editingId === r.id" v-model="rowDraft.customer" class="table-input" /><template v-else>{{ r.customer || '-' }}</template></td>
              <td v-if="isVisible('deliveryNo')" :class="{ frozen: isFrozen('deliveryNo'), 'freeze-edge': frozenThrough === 'deliveryNo' }" :style="columnStyle('deliveryNo')"><input v-if="editingId === r.id" v-model="rowDraft.delivery_no" class="table-input" /><template v-else>{{ r.delivery_no || '-' }}</template></td>
              <td v-if="isVisible('itemNo')" :class="{ frozen: isFrozen('itemNo'), 'freeze-edge': frozenThrough === 'itemNo' }" :style="columnStyle('itemNo')"><input v-if="editingId === r.id" v-model="rowDraft.item_no" class="table-input" /><template v-else>{{ r.item_no || '-' }}</template></td>
              <td v-if="isVisible('product')" :class="{ frozen: isFrozen('product'), 'freeze-edge': frozenThrough === 'product' }" :style="columnStyle('product')"><input v-if="editingId === r.id" v-model="rowDraft.product" class="table-input product-input" /><template v-else>{{ r.product || '-' }}</template></td>
              <td v-if="isVisible('quantity')" :class="{ frozen: isFrozen('quantity'), 'freeze-edge': frozenThrough === 'quantity' }" :style="columnStyle('quantity')"><input v-if="editingId === r.id" v-model.number="rowDraft.quantity" class="table-input quantity-input" type="number" min="0" /><template v-else>{{ r.quantity ?? '-' }}</template></td>
              <td v-if="isVisible('orderCount')" :class="{ frozen: isFrozen('orderCount'), 'freeze-edge': frozenThrough === 'orderCount' }" :style="columnStyle('orderCount')">1</td>
              <td v-if="isVisible('internalResult')" :class="{ frozen: isFrozen('internalResult'), 'freeze-edge': frozenThrough === 'internalResult' }" :style="columnStyle('internalResult')"><select v-if="editingId === r.id" v-model="rowDraft.internal_result" class="table-input result-input"><option value="">-</option><option v-for="o in RESULTS" :key="o" :value="o">{{ o }}</option></select><template v-else>{{ r.internal_result || '-' }}</template></td>
              <td v-if="isVisible('internalDefect')" :class="{ frozen: isFrozen('internalDefect'), 'freeze-edge': frozenThrough === 'internalDefect' }" :style="columnStyle('internalDefect')"><input v-if="editingId === r.id" v-model="rowDraft.internal_defect" class="table-input" /><template v-else>{{ r.internal_defect || '-' }}</template></td>
              <td v-if="isVisible('internalInspector')" :class="{ frozen: isFrozen('internalInspector'), 'freeze-edge': frozenThrough === 'internalInspector' }" :style="columnStyle('internalInspector')"><input v-if="editingId === r.id" v-model="rowDraft.internal_inspector" class="table-input" /><template v-else>{{ r.internal_inspector || '-' }}</template></td>
              <td v-if="isVisible('custDate')" :class="{ frozen: isFrozen('custDate'), 'freeze-edge': frozenThrough === 'custDate' }" :style="columnStyle('custDate')"><input v-if="editingId === r.id" v-model="rowDraft.cust_inspect_date" class="table-input" /><template v-else>{{ r.cust_inspect_date || '-' }}</template></td>
              <td v-if="isVisible('custResult')" :class="{ frozen: isFrozen('custResult'), 'freeze-edge': frozenThrough === 'custResult' }" :style="columnStyle('custResult')"><select v-if="editingId === r.id" v-model="rowDraft.cust_result" class="table-input result-input"><option value="">-</option><option v-for="o in RESULTS" :key="o" :value="o">{{ o }}</option></select><template v-else>{{ r.cust_result || '-' }}</template></td>
              <td v-if="isVisible('custDefect')" :class="{ frozen: isFrozen('custDefect'), 'freeze-edge': frozenThrough === 'custDefect' }" :style="columnStyle('custDefect')"><input v-if="editingId === r.id" v-model="rowDraft.cust_defect" class="table-input" /><template v-else>{{ r.cust_defect || '-' }}</template></td>
              <td v-if="isVisible('notes')" :class="{ frozen: isFrozen('notes'), 'freeze-edge': frozenThrough === 'notes' }" :style="columnStyle('notes')"><input v-if="editingId === r.id" v-model="rowDraft.notes" class="table-input notes-input" /><template v-else>{{ r.notes || '-' }}</template></td>
              <td v-if="canOperate && isVisible('actions')">
                <div class="op-actions">
                  <button v-if="canEdit" class="ghost mini" @click="startEdit(r)">编辑</button>
                  <button v-if="canEdit" class="ghost mini" :disabled="editingId !== r.id || rowSavingId === r.id" @click="saveEdit(r)">{{ rowSavingId === r.id ? '保存中…' : '保存' }}</button>
                  <button v-if="canDelete" class="ghost mini danger" @click="remove(r)">删除</button>
                </div>
              </td>
            </tr>
            <tr v-if="!filteredRecords.length"><td :colspan="visibleColumnCount" class="hint" style="text-align:center">暂无检验记录</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </AppLayout>
</template>
<style scoped>
.wide { max-width: none; }
.region-sel { height: 34px; padding: 0 .6rem; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); cursor: pointer; }
.filter-sel { height: 34px; padding: 0 .6rem; }
.date-filter { display: flex; align-items: center; gap: .4rem; }
.date-filter input { width: 138px; height: 34px; padding: 0 .5rem; }
.date-separator { color: var(--text-soft); white-space: nowrap; }
.date-clear { width: 34px; height: 34px; padding: 0; color: var(--text-soft); }
.search-box { width: 280px; height: 34px; padding: 0 .7rem; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); }
.form-card { margin-bottom: 1rem; }
.grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: .8rem; }
.grid label { display: flex; flex-direction: column; gap: .25rem; font-size: .85rem; }
.actions { margin-top: .9rem; }
.toolbar { position: sticky; top: 58px; z-index: 9; margin: -.35rem 0 1rem; padding: .35rem 0; background: var(--bg); }
.scroll { position: relative; max-height: calc(100vh - 178px); overflow: auto; isolation: isolate; }
.qi { min-width: 1900px; margin-top: 0; overflow: visible; }
.qi th, .qi td { white-space: nowrap; text-align: center; font-size: .85rem; }
.qi thead tr { height: 52px; }
.qi thead th { position: sticky; top: 0; z-index: 3; background: #fafbfc; }
.qi .frozen { position: sticky; z-index: 2; background: var(--surface); }
.qi thead .frozen { z-index: 5; background: #fafbfc; }
.qi .freeze-edge { box-shadow: 5px 0 7px -7px rgba(31, 37, 51, .55); }
.freeze-control { display: flex; align-items: center; gap: .35rem; color: var(--text-soft); font-size: .85rem; white-space: nowrap; }
.column-menu { position: relative; }
.column-panel { position: absolute; top: calc(100% + .4rem); left: 0; z-index: 20; width: 300px; max-height: 430px; overflow: auto; padding: .75rem; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); box-shadow: var(--shadow); display: grid; gap: .45rem; }
.column-panel label { display: flex; align-items: flex-start; gap: .45rem; font-size: .84rem; }
.column-panel-head { display: flex; justify-content: space-between; align-items: center; padding-bottom: .35rem; border-bottom: 1px solid var(--border); }
.link-btn { padding: 0; border: 0; background: transparent; color: var(--primary); font-size: .82rem; }
.import-overlay { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; padding: 2rem; background: rgba(31,37,51,.42); }
.import-dialog { width: min(1180px, 96vw); max-height: 88vh; display: flex; flex-direction: column; gap: .8rem; padding: 1rem; border-radius: var(--radius); background: var(--surface); box-shadow: var(--shadow-lg); }
.import-dialog-head, .import-actions { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.import-dialog-head h3 { margin: 0; }
.import-tip { color: var(--text-soft); font-size: .88rem; }
.import-table-wrap { min-height: 0; overflow: auto; }
.import-preview-table { min-width: 1050px; margin: 0; overflow: visible; }
.import-preview-table th { position: sticky; top: 0; z-index: 2; }
.import-preview-table th, .import-preview-table td { text-align: left; white-space: nowrap; }
.import-row-error td { background: #fff1f2; color: #b91c1c; }
.import-actions { justify-content: flex-end; }
.mini { padding: .25rem .6rem; font-size: .82rem; }
.table-input { width: 112px; min-width: 0; height: 32px; padding: 0 .45rem; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); }
.date-input { width: 138px; }
.factory-input { width: 210px; }
.product-input, .notes-input { width: 150px; }
.quantity-input { width: 92px; }
.result-input { width: 88px; }
.op-actions { display: flex; align-items: center; justify-content: center; gap: .35rem; min-width: 178px; }
.danger { color: #ef4444; border-color: #fecaca; }
</style>
