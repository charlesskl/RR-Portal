<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import * as XLSX from 'xlsx'
import AppLayout from '../components/AppLayout.vue'
import { pb } from '../pb'
import { useFactoriesStore } from '../stores/factories'
import { useAuthStore } from '../stores/auth'
import { canEditQuality, allowedRegions, canViewCraft } from '../utils/permissions'
import { REGIONS, REGION_LABELS, regionOf, type Craft, type Region } from '../constants/roles'
import type { Quality5sCheck } from '../types/quality5s'
import { useTableColumnPreferences } from '../composables/useTableColumnPreferences'
import { resolveFactoryName } from '../utils/factoryName'
import { normalizeQuality5sHeader, quality5sColumnOf, quality5sImportDate } from '../utils/quality5sExcelImport'

const factories = useFactoriesStore()
const auth = useAuthStore()
const records = ref<Quality5sCheck[]>([])
const myRegions = computed(() => (auth.role ? allowedRegions(auth.role) : REGIONS))
const regionFilter = ref<Region | ''>((useRoute().query.region as Region) || '')
const search = ref('')
const factoryName = (r: Quality5sCheck) => r.expand?.factory?.name ?? '-'

function normalizeSearch(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, '').toLowerCase()
}

function matchesSearch(r: Quality5sCheck): boolean {
  const q = normalizeSearch(search.value)
  if (!q) return true
  return [factoryName(r), r.customer].some((value) => normalizeSearch(value).includes(q))
}

const filteredRecords = computed(() =>
  records.value
    .filter((r) => !r.expand?.factory?.craft || canViewCraft(r.expand.factory.craft as Craft))
    .filter((r) => myRegions.value.includes(regionOf(r.expand?.factory)))
    .filter((r) => !regionFilter.value || regionOf(r.expand?.factory) === regionFilter.value)
    .filter(matchesSearch))
const showForm = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

// 8 个评分项（顺序与图二一致）
const SCORE_FIELDS = [
  { key: 's_area', label: '现场区域规划(10分)' },
  { key: 's_material', label: '物料摆放及标识(10分)' },
  { key: 's_hygiene', label: '卫生整洁及异物防护(10分)' },
  { key: 's_sharp', label: '利器及断针管理(15分)' },
  { key: 's_nonconform', label: '不合格品隔离及追溯(15分)' },
  { key: 's_standard', label: '检验标准及样板管理(15分)' },
  { key: 's_qc_staff', label: '质检人员配置及过程品质控制(15分)' },
  { key: 's_correction', label: '整改及记录管理(10分)' },
] as const
const CHECK_TYPES = ['首次审核', '复审', '定期巡查']
interface Quality5sImportDraftRow {
  rowNo: number
  factoryName: string
  payload: Record<string, any>
  error: string
  // 写入失败可重试，不计入异常行（否则会禁用确认按钮导致永远无法重试）
  saveError?: string
}
const importDraftRows = ref<Quality5sImportDraftRow[]>([])
const importPreviewOpen = ref(false)
const importConfirming = ref(false)
const importDraftInvalidCount = computed(() => importDraftRows.value.filter((row) => row.error).length)

const tableColumns = [
  { key: 'index', label: '序号', width: 64, hideable: false },
  { key: 'date', label: '检查日期', width: 138 },
  { key: 'factory', label: '加工厂名称', width: 260 },
  { key: 'type', label: '检查类型', width: 120 },
  { key: 'project', label: '加工项目', width: 130 },
  { key: 'customer', label: '客户', width: 120 },
  { key: 'inspector', label: '检查人员', width: 120 },
  ...SCORE_FIELDS.map((field) => ({ key: field.key, label: field.label, width: 150 })),
  { key: 'rate', label: '达成率', width: 100 },
  { key: 'ip', label: 'IP保护得分', width: 120 },
  { key: 'finalRate', label: '折算总达成率', width: 130 },
  { key: 'notes', label: '备注', width: 160 },
  { key: 'actions', label: '操作', width: 190 },
]
const columnPrefs = useTableColumnPreferences('quality-5s-table-columns', tableColumns)
const { frozenThrough, columnPanelOpen, visibleColumns, isVisible, isFrozen, columnStyle, toggleColumn, showAllColumns } = columnPrefs
const visibleColumnCount = computed(() => visibleColumns.value.filter((column) => column.key !== 'actions' || canOperate.value).length)

async function load() {
  records.value = await pb.collection('quality_5s_checks').getFullList<Quality5sCheck>({
    sort: '-check_date', expand: 'factory',
  })
}
onMounted(async () => {
  await Promise.all([factories.fetchAll(), load()])
})

// 现场得分 = 8 项之和（满分100）
function siteScore(r: Quality5sCheck): number {
  return SCORE_FIELDS.reduce((a, f) => a + (Number((r as any)[f.key]) || 0), 0)
}
// IP保护得分:存 'NA'(不适用) 或 数字字符串。解析为 number 或 null(NA)
function parseIP(v?: string): number | null {
  const s = String(v ?? '').trim()
  if (!s || !/^[0-9]+(\.[0-9]+)?$/.test(s)) return null
  return Number(s)
}
const achieveRate = (r: Quality5sCheck) => siteScore(r) + '%'        // 达成率 = 现场得分/100
const ipDisplay = (r: Quality5sCheck) => { const ip = parseIP(r.ip_control); return ip == null ? 'NA' : String(ip) }
// 折算总达成率：NA→现场/100；适用→(现场+IP得分)/110
function finalRate(r: Quality5sCheck): string {
  const s = siteScore(r); const ip = parseIP(r.ip_control)
  return ip == null ? s + '%' : Math.round(((s + ip) / 110) * 100) + '%'
}
// —— 新增表单 ——
function blankDraft() {
  return {
    check_date: '', factory: '', check_type: '', project: '', customer: '', inspector: '',
    s_area: null as number | null, s_material: null as number | null, s_hygiene: null as number | null,
    s_sharp: null as number | null, s_nonconform: null as number | null, s_standard: null as number | null,
    s_qc_staff: null as number | null, s_correction: null as number | null,
    ip_applicable: false, ip_score: null as number | null, notes: '',
  }
}
const draft = reactive(blankDraft())
const factorySearch = ref('')
const factoryPickerOpen = ref(false)
const selectedFactoryName = computed(() => factories.items.find((factory) => factory.id === draft.factory)?.name ?? '')
const filteredDraftFactories = computed(() => {
  const q = normalizeSearch(factorySearch.value)
  const available = regionFilter.value
    ? factories.items.filter((factory) => regionOf(factory) === regionFilter.value)
    : factories.items
  if (!q) return available.slice(0, 60)
  return available.filter((factory) => normalizeSearch(factory.name).includes(q)).slice(0, 60)
})

function selectDraftFactory(id: string, name: string) {
  draft.factory = id
  factorySearch.value = name
  factoryPickerOpen.value = false
}

function onDraftFactoryInput(event: Event) {
  const value = (event.target as HTMLInputElement).value
  factorySearch.value = value
  factoryPickerOpen.value = true
  if (selectedFactoryName.value !== value) draft.factory = ''
}

function closeDraftFactoryPicker() {
  window.setTimeout(() => { factoryPickerOpen.value = false }, 120)
}
const draftSite = computed(() => SCORE_FIELDS.reduce((a, f) => a + (Number((draft as any)[f.key]) || 0), 0))
const draftFinal = computed(() => draft.ip_applicable
  ? Math.round(((draftSite.value + (Number(draft.ip_score) || 0)) / 110) * 100) + '%'
  : draftSite.value + '%')
const saving = ref(false)

async function submit() {
  if (!draft.factory) { alert('请选择加工厂'); return }
  saving.value = true
  const payload: Record<string, any> = {
    created_by: auth.userId ?? undefined,
    factory: draft.factory,
    check_type: draft.check_type,
    project: draft.project,
    customer: draft.customer,
    inspector: draft.inspector,
    notes: draft.notes,
    ip_control: draft.ip_applicable ? String(draft.ip_score ?? 0) : 'NA',
  }
  if (draft.check_date) payload.check_date = draft.check_date
  for (const f of SCORE_FIELDS) { const v = (draft as any)[f.key]; if (v != null && v !== '') payload[f.key] = v }
  try {
    await pb.collection('quality_5s_checks').create(payload)
    Object.assign(draft, blankDraft())
    factorySearch.value = ''
    factoryPickerOpen.value = false
    showForm.value = false
    await load()
  } finally {
    saving.value = false
  }
}

async function remove(r: Quality5sCheck) {
  if (!confirm('确定删除这条检查记录?')) return
  await pb.collection('quality_5s_checks').delete(r.id)
  await load()
}
const canEdit = computed(() => (auth.role ? canEditQuality(auth.role) : false))
const canDelete = computed(() => canEdit.value)
const canOperate = computed(() => canEdit.value || canDelete.value)
const editingId = ref<string | null>(null)
const rowSavingId = ref<string | null>(null)

function blankRowDraft() {
  return {
    check_date: '', factory: '', check_type: '', project: '', customer: '', inspector: '',
    s_area: '' as number | '', s_material: '' as number | '', s_hygiene: '' as number | '',
    s_sharp: '' as number | '', s_nonconform: '' as number | '', s_standard: '' as number | '',
    s_qc_staff: '' as number | '', s_correction: '' as number | '', ip_control: '', notes: '',
  }
}
const rowDraft = reactive(blankRowDraft())

function startEdit(r: Quality5sCheck) {
  editingId.value = r.id
  Object.assign(rowDraft, blankRowDraft(), {
    check_date: r.check_date?.slice(0, 10) ?? '', factory: r.factory ?? '',
    check_type: r.check_type ?? '', project: r.project ?? '', customer: r.customer ?? '',
    inspector: r.inspector ?? '', ip_control: r.ip_control ?? '', notes: r.notes ?? '',
  })
  for (const f of SCORE_FIELDS) rowDraft[f.key] = r[f.key] ?? ''
}

function rowPreview(r: Quality5sCheck): Quality5sCheck {
  return editingId.value === r.id ? { ...r, ...rowDraft } as Quality5sCheck : r
}

async function saveEdit(r: Quality5sCheck) {
  if (editingId.value !== r.id) { alert('请先点击编辑'); return }
  if (!rowDraft.factory) { alert('请选择加工厂'); return }
  rowSavingId.value = r.id
  const payload: Record<string, any> = {
    check_date: rowDraft.check_date || null, factory: rowDraft.factory,
    check_type: rowDraft.check_type, project: rowDraft.project, customer: rowDraft.customer,
    inspector: rowDraft.inspector, ip_control: rowDraft.ip_control, notes: rowDraft.notes,
  }
  for (const f of SCORE_FIELDS) payload[f.key] = rowDraft[f.key] === '' ? null : Number(rowDraft[f.key])
  try {
    await pb.collection('quality_5s_checks').update(r.id, payload)
    editingId.value = null
    await load()
    alert('保存成功')
  } catch (error) {
    console.error(error)
    alert('保存失败，请检查填写内容后重试')
  } finally { rowSavingId.value = null }
}

async function importExcel(ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0]
  if (!file) return
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { cellDates: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const aoa = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' })
  const norm = normalizeQuality5sHeader
  // 跳过可能的标题行，定位真正的表头行
  const headerIdx = aoa.findIndex((row) => row.some((c) => ['加工厂名称', '检查日期', '检查类型'].includes(norm(c))))
  if (headerIdx < 0) { alert('未识别到表头(需含「加工厂名称/检查日期」)'); return }
  const header = aoa[headerIdx]
  const colOf = (...aliases: string[]) => quality5sColumnOf(header, ...aliases)
  const idx: Record<string, number> = {
    date: colOf('检查日期'), factory: colOf('加工厂名称', '加工厂'), type: colOf('检查类型'),
    project: colOf('加工项目'), customer: colOf('客户'), inspector: colOf('检查人员'),
    ip: colOf('IP保护得分(NA=不适用;适用)', 'IP保护得分', 'IP控制(如适用)', 'IP控制'), notes: colOf('备注'),
  }
  for (const f of SCORE_FIELDS) idx[f.key] = colOf(f.label, f.label.replace(/\(.*\)/, ''))
  const toDate = quality5sImportDate
  const cell = (row: any[], i: number) => (i >= 0 ? row[i] : '')
  const candidates = regionFilter.value
    ? factories.items.filter((factory) => regionOf(factory) === regionFilter.value)
    : factories.items
  const preview: Quality5sImportDraftRow[] = []
  for (const [offset, row] of aoa.slice(headerIdx + 1).entries()) {
    const fname = String(cell(row, idx.factory) ?? '').trim()
    const dv = cell(row, idx.date)
    if (!fname && !dv) continue // 跳过空行
    const factoryMatch = resolveFactoryName(candidates, fname)
    const payload: Record<string, any> = { created_by: auth.userId ?? undefined }
    if (dv) payload.check_date = toDate(dv)
    if (factoryMatch.status === 'matched') payload.factory = factoryMatch.id
    const str = (i: number) => { const v = cell(row, i); return v == null ? '' : String(v).trim() }
    payload.check_type = str(idx.type)
    payload.project = str(idx.project)
    payload.customer = str(idx.customer)
    payload.inspector = str(idx.inspector)
    payload.ip_control = str(idx.ip)
    payload.notes = str(idx.notes)
    for (const f of SCORE_FIELDS) {
      const v = cell(row, idx[f.key])
      if (v !== '' && v != null) payload[f.key] = Number(v)
    }
    const errors: string[] = []
    if (!fname) errors.push('缺少加工厂名称')
    else if (factoryMatch.status !== 'matched') errors.push(factoryMatch.status === 'ambiguous' ? '工厂简称匹配到多家工厂' : '工厂名未匹配')
    if (!dv) errors.push('缺少检查日期')
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
  const failedRows: Quality5sImportDraftRow[] = []
  let ok = 0
  try {
    for (const row of importDraftRows.value) {
      try {
        await pb.collection('quality_5s_checks').create(row.payload)
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
  const headers = [
    '序号', '检查日期', '加工厂名称', '检查类型', '加工项目', '客户', '检查人员',
    ...SCORE_FIELDS.map((f) => f.label),
    '达成率', 'IP保护得分(NA=不适用;适用)', '折算总达成率(100%)', '备注',
  ]
  const title = '加工厂现场品质及5S检查记录登记表'
  const titleRow = new Array(headers.length).fill('')
  titleRow[0] = title
  const body = filteredRecords.value.map((r, i) => {
    return [
      i + 1, r.check_date ? r.check_date.slice(0, 10) : '', factoryName(r), r.check_type ?? '',
      r.project ?? '', r.customer ?? '', r.inspector ?? '',
      ...SCORE_FIELDS.map((f) => (r as any)[f.key] ?? ''),
      achieveRate(r), ipDisplay(r), finalRate(r), r.notes ?? '',
    ]
  })
  const ws = XLSX.utils.aoa_to_sheet([titleRow, headers, ...body])
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } }]
  const cw = (v: any) => {
    let w = 0
    for (const ch of String(v ?? '')) w += /[⺀-￿]/.test(ch) ? 2 : 1
    return w
  }
  ws['!cols'] = headers.map((h, c) => {
    let max = cw(h)
    for (const row of body) max = Math.max(max, cw(row[c]))
    return { wch: Math.min(Math.max(max + 2, 6), 40) }
  })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '现场品质及5S检查')
  XLSX.writeFile(wb, `${title}.xlsx`)
}
</script>
<template>
  <AppLayout>
    <div class="page wide">
      <div class="toolbar">
        <h2 style="margin:0">品质管理</h2>
        <span class="muted">共 {{ filteredRecords.length }} 条</span>
        <select v-model="regionFilter" class="region-sel">
          <option value="">全部厂区</option>
          <option v-for="rg in myRegions" :key="rg" :value="rg">{{ REGION_LABELS[rg] }}厂区</option>
        </select>
        <input
          v-model="search"
          class="search-box"
          placeholder="搜索 加工厂/客户"
        />
        <label class="freeze-control">冻结至
          <select v-model="frozenThrough" class="region-sel">
            <option value="">不冻结列</option>
            <option v-for="column in visibleColumns" :key="column.key" :value="column.key" :disabled="column.key === 'actions'">
              {{ column.label }}
            </option>
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
        <button v-if="canEdit" class="ghost" @click="showForm = !showForm">{{ showForm ? '收起' : '+ 新增检查记录' }}</button>
        <button @click="exportExcel">导出 Excel</button>
      </div>

      <!-- 新增表单 -->
      <section v-if="showForm" class="card form-card">
        <div class="grid">
          <label>检查日期 <input v-model="draft.check_date" type="date" /></label>
          <label>加工厂
            <div class="factory-picker">
              <input
                :value="factorySearch"
                placeholder="输入工厂名称搜索"
                autocomplete="off"
                @focus="factoryPickerOpen = true"
                @input="onDraftFactoryInput"
                @blur="closeDraftFactoryPicker"
              />
              <div v-if="factoryPickerOpen" class="factory-picker-menu">
                <button
                  v-for="factory in filteredDraftFactories"
                  :key="factory.id"
                  type="button"
                  class="factory-picker-option"
                  @mousedown.prevent="selectDraftFactory(factory.id, factory.name)"
                >
                  {{ factory.name }}
                </button>
                <div v-if="!filteredDraftFactories.length" class="factory-picker-empty">没有匹配的工厂</div>
              </div>
            </div>
          </label>
          <label>检查类型
            <select v-model="draft.check_type">
              <option value="">选择</option>
              <option v-for="t in CHECK_TYPES" :key="t" :value="t">{{ t }}</option>
            </select>
          </label>
          <label>加工项目 <input v-model="draft.project" /></label>
          <label>客户 <input v-model="draft.customer" /></label>
          <label>检查人员 <input v-model="draft.inspector" /></label>
          <label v-for="f in SCORE_FIELDS" :key="f.key">{{ f.label }}
            <input v-model.number="(draft as any)[f.key]" type="number" min="0" step="0.1" />
          </label>
          <label>IP保护得分
            <select v-model="draft.ip_applicable">
              <option :value="false">不适用(NA)</option>
              <option :value="true">适用</option>
            </select>
          </label>
          <label v-if="draft.ip_applicable">IP得分(0-10) <input v-model.number="draft.ip_score" type="number" min="0" max="10" /></label>
          <label>备注 <input v-model="draft.notes" /></label>
          <div class="computed">现场得分 <b>{{ draftSite }}</b> · 达成率 <b>{{ draftSite }}%</b> · 折算总达成率 <b>{{ draftFinal }}</b></div>
        </div>
        <div class="actions">
          <button :disabled="saving" @click="submit">{{ saving ? '保存中…' : '保存记录' }}</button>
        </div>
      </section>

      <div v-if="importPreviewOpen" class="import-overlay" @click.self="cancelImportPreview">
        <section class="import-dialog" role="dialog" aria-modal="true" aria-label="5S Excel 导入草稿预览">
          <div class="import-dialog-head">
            <div><h3>Excel 导入草稿预览</h3><span class="muted">共 {{ importDraftRows.length }} 条，异常 {{ importDraftInvalidCount }} 条</span></div>
            <button class="ghost" @click="cancelImportPreview">关闭</button>
          </div>
          <p class="import-tip">此时尚未写入系统。请检查内容；如有异常行，请取消并修正 Excel 后重新导入。</p>
          <div class="import-table-wrap">
            <table class="import-preview-table">
              <thead><tr><th>Excel行</th><th>检查日期</th><th>加工厂</th><th>检查类型</th><th>加工项目</th><th>客户</th><th>检查人员</th><th v-for="field in SCORE_FIELDS" :key="field.key">{{ field.label }}</th><th>现场得分</th><th>IP保护</th><th>检查结果</th></tr></thead>
              <tbody>
                <tr v-for="row in importDraftRows" :key="row.rowNo" :class="{ 'import-row-error': row.error || row.saveError }">
                  <td>{{ row.rowNo }}</td><td>{{ row.payload.check_date || '-' }}</td><td>{{ row.factoryName || '-' }}</td>
                  <td>{{ row.payload.check_type || '-' }}</td><td>{{ row.payload.project || '-' }}</td><td>{{ row.payload.customer || '-' }}</td>
                  <td>{{ row.payload.inspector || '-' }}</td>
                  <td v-for="field in SCORE_FIELDS" :key="field.key">{{ row.payload[field.key] ?? '-' }}</td>
                  <td>{{ SCORE_FIELDS.reduce((sum, field) => sum + (Number(row.payload[field.key]) || 0), 0) }}</td>
                  <td>{{ row.payload.ip_control || 'NA' }}</td><td>{{ row.error || row.saveError || '可导入' }}</td>
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
        <table class="q5s">
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
              <td v-if="isVisible('date')" :class="{ frozen: isFrozen('date'), 'freeze-edge': frozenThrough === 'date' }" :style="columnStyle('date')"><input v-if="editingId === r.id" v-model="rowDraft.check_date" class="table-input date-input" type="date" /><template v-else>{{ r.check_date ? r.check_date.slice(0, 10) : '-' }}</template></td>
              <td v-if="isVisible('factory')" :class="{ frozen: isFrozen('factory'), 'freeze-edge': frozenThrough === 'factory' }" :style="columnStyle('factory')">
                <select v-if="editingId === r.id" v-model="rowDraft.factory" class="table-input factory-input">
                  <option value="">选择工厂</option>
                  <option v-for="f in factories.items" :key="f.id" :value="f.id">{{ f.name }}</option>
                </select>
                <template v-else>{{ factoryName(r) }}</template>
              </td>
              <td v-if="isVisible('type')" :class="{ frozen: isFrozen('type'), 'freeze-edge': frozenThrough === 'type' }" :style="columnStyle('type')"><select v-if="editingId === r.id" v-model="rowDraft.check_type" class="table-input"><option value="">-</option><option v-for="t in CHECK_TYPES" :key="t" :value="t">{{ t }}</option></select><template v-else>{{ r.check_type || '-' }}</template></td>
              <td v-if="isVisible('project')" :class="{ frozen: isFrozen('project'), 'freeze-edge': frozenThrough === 'project' }" :style="columnStyle('project')"><input v-if="editingId === r.id" v-model="rowDraft.project" class="table-input" /><template v-else>{{ r.project || '-' }}</template></td>
              <td v-if="isVisible('customer')" :class="{ frozen: isFrozen('customer'), 'freeze-edge': frozenThrough === 'customer' }" :style="columnStyle('customer')"><input v-if="editingId === r.id" v-model="rowDraft.customer" class="table-input" /><template v-else>{{ r.customer || '-' }}</template></td>
              <td v-if="isVisible('inspector')" :class="{ frozen: isFrozen('inspector'), 'freeze-edge': frozenThrough === 'inspector' }" :style="columnStyle('inspector')"><input v-if="editingId === r.id" v-model="rowDraft.inspector" class="table-input" /><template v-else>{{ r.inspector || '-' }}</template></td>
              <template v-for="f in SCORE_FIELDS" :key="f.key"><td v-if="isVisible(f.key)" :class="{ frozen: isFrozen(f.key), 'freeze-edge': frozenThrough === f.key }" :style="columnStyle(f.key)"><input v-if="editingId === r.id" v-model.number="rowDraft[f.key]" class="table-input score-input" type="number" min="0" step="0.1" /><template v-else>{{ r[f.key] ?? '-' }}</template></td></template>
              <td v-if="isVisible('rate')" class="score" :class="{ frozen: isFrozen('rate'), 'freeze-edge': frozenThrough === 'rate' }" :style="columnStyle('rate')">{{ achieveRate(rowPreview(r)) }}</td>
              <td v-if="isVisible('ip')" :class="{ frozen: isFrozen('ip'), 'freeze-edge': frozenThrough === 'ip' }" :style="columnStyle('ip')"><input v-if="editingId === r.id" v-model="rowDraft.ip_control" class="table-input score-input" placeholder="NA/0-10" /><template v-else>{{ ipDisplay(r) }}</template></td>
              <td v-if="isVisible('finalRate')" class="score" :class="{ frozen: isFrozen('finalRate'), 'freeze-edge': frozenThrough === 'finalRate' }" :style="columnStyle('finalRate')">{{ finalRate(rowPreview(r)) }}</td>
              <td v-if="isVisible('notes')" :class="{ frozen: isFrozen('notes'), 'freeze-edge': frozenThrough === 'notes' }" :style="columnStyle('notes')"><input v-if="editingId === r.id" v-model="rowDraft.notes" class="table-input notes-input" /><template v-else>{{ r.notes || '-' }}</template></td>
              <td v-if="canOperate && isVisible('actions')">
                <div class="op-actions">
                  <button v-if="canEdit" class="ghost mini" @click="startEdit(r)">编辑</button>
                  <button v-if="canEdit" class="ghost mini" :disabled="editingId !== r.id || rowSavingId === r.id" @click="saveEdit(r)">{{ rowSavingId === r.id ? '保存中…' : '保存' }}</button>
                  <button v-if="canDelete" class="ghost mini danger" @click="remove(r)">删除</button>
                </div>
              </td>
            </tr>
            <tr v-if="!filteredRecords.length"><td :colspan="visibleColumnCount" class="hint" style="text-align:center">暂无检查记录</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </AppLayout>
</template>
<style scoped>
.wide { max-width: none; }
.region-sel { height: 34px; padding: 0 .6rem; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); cursor: pointer; }
.search-box { width: 240px; height: 34px; padding: 0 .7rem; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); }
.form-card { margin-bottom: 1rem; }
.grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: .8rem; }
.grid label { display: flex; flex-direction: column; gap: .25rem; font-size: .85rem; }
.factory-picker { position: relative; }
.factory-picker > input { width: 100%; }
.factory-picker-menu { position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 30; max-height: 280px; overflow-y: auto; padding: .3rem; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); box-shadow: var(--shadow-lg); }
.factory-picker-option { width: 100%; padding: .55rem .65rem; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--text); text-align: left; font-weight: 400; }
.factory-picker-option:hover { background: var(--primary-soft); color: var(--primary); }
.factory-picker-empty { padding: .7rem; color: var(--text-soft); text-align: center; }
.computed { align-self: end; font-size: .9rem; color: var(--text-soft); }
.computed b { color: var(--primary, #4f46e5); font-size: 1.1rem; }
.actions { margin-top: .9rem; }
.toolbar { position: sticky; top: 58px; z-index: 9; margin: -.35rem 0 1rem; padding: .35rem 0; background: var(--bg); }
.scroll { position: relative; max-height: calc(100vh - 178px); overflow: auto; isolation: isolate; }
.q5s { min-width: 2200px; margin-top: 0; overflow: visible; }
.q5s th, .q5s td { white-space: nowrap; text-align: left; }
.q5s thead th { position: sticky; top: 0; z-index: 3; background: #fafbfc; }
.q5s .frozen { position: sticky; z-index: 2; background: var(--surface); }
.q5s thead .frozen { z-index: 5; background: #fafbfc; }
.q5s .freeze-edge { box-shadow: 5px 0 7px -7px rgba(31, 37, 51, .55); }
.freeze-control { display: flex; align-items: center; gap: .35rem; color: var(--text-soft); font-size: .85rem; white-space: nowrap; }
.column-menu { position: relative; }
.column-panel { position: absolute; top: calc(100% + .4rem); left: 0; z-index: 20; width: 330px; max-height: 430px; overflow: auto; padding: .75rem; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); box-shadow: var(--shadow); display: grid; grid-template-columns: 1fr; gap: .45rem; }
.column-panel label { display: flex; align-items: flex-start; gap: .45rem; font-size: .84rem; }
.column-panel-head { display: flex; justify-content: space-between; align-items: center; padding-bottom: .35rem; border-bottom: 1px solid var(--border); }
.link-btn { padding: 0; border: 0; background: transparent; color: var(--primary); font-size: .82rem; }
.import-overlay { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; padding: 2rem; background: rgba(31,37,51,.42); }
.import-dialog { width: min(1180px, 96vw); max-height: 88vh; display: flex; flex-direction: column; gap: .8rem; padding: 1rem; border-radius: var(--radius); background: var(--surface); box-shadow: var(--shadow-lg); }
.import-dialog-head, .import-actions { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.import-dialog-head h3 { margin: 0; }
.import-tip { color: var(--text-soft); font-size: .88rem; }
.import-table-wrap { min-height: 0; overflow: auto; }
.import-preview-table { min-width: 2300px; margin: 0; overflow: visible; }
.import-preview-table th { position: sticky; top: 0; z-index: 2; }
.import-preview-table th, .import-preview-table td { text-align: left; white-space: nowrap; }
.import-row-error td { background: #fff1f2; color: #b91c1c; }
.import-actions { justify-content: flex-end; }
.score { font-weight: 600; }
.mini { padding: .25rem .6rem; font-size: .82rem; }
.table-input { width: 112px; min-width: 0; height: 32px; padding: 0 .45rem; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); }
.date-input { width: 138px; }
.factory-input { width: 210px; }
.score-input { width: 76px; }
.notes-input { width: 150px; }
.op-actions { display: flex; align-items: center; gap: .35rem; min-width: 178px; }
.danger { color: #ef4444; border-color: #fecaca; }
</style>
