<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import * as XLSX from 'xlsx'
import AppLayout from '../components/AppLayout.vue'
import { pb } from '../pb'
import { useFactoriesStore } from '../stores/factories'
import { useAuthStore } from '../stores/auth'
import { canEditQuality, allowedRegions, canViewCraft } from '../utils/permissions'
import { resolveFactoryName } from '../utils/factoryName'
import { buildQualityInspectionImportColumns, formatImportedDate, normalizeExcelHeader } from '../utils/qualityInspectionImport'
import { REGIONS, REGION_LABELS, regionOf, type Craft, type Region } from '../constants/roles'
import type { QualityInspection } from '../types/qualityInspection'

const factories = useFactoriesStore()
const auth = useAuthStore()
const records = ref<QualityInspection[]>([])
const myRegions = computed(() => (auth.role ? allowedRegions(auth.role) : REGIONS))
const regionFilter = ref<Region | ''>((useRoute().query.region as Region) || '')
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

const filteredRecords = computed(() =>
  records.value
    .filter((r) => !r.expand?.factory?.craft || canViewCraft(r.expand.factory.craft as Craft))
    .filter((r) => myRegions.value.includes(regionOf(r.expand?.factory)))
    .filter((r) => !regionFilter.value || regionOf(r.expand?.factory) === regionFilter.value)
    .filter(matchesSearch))
const showForm = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const RESULTS = ['PASS', 'FAIL']

async function load() {
  records.value = await pb.collection('quality_inspections').getFullList<QualityInspection>({
    sort: 'inspect_date,delivery_no,item_no,product', expand: 'factory',
  })
}
onMounted(async () => { await Promise.all([factories.fetchAll(), load()]) })
const canDelete = computed(() => auth.role === 'admin')
const canEdit = computed(() => (auth.role ? canEditQuality(auth.role) : false))

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
  let ok = 0, fail = 0
  for (const row of aoa.slice(headerIdx + 1)) {
    const fname = str(row, idx.factory)
    const prod = str(row, idx.product)
    if (prod.includes('小计') || prod.includes('合计')) continue
    if (!fname && !prod) continue
    const factoryMatch = resolveFactoryName(factories.items, fname)
    if (!fname || factoryMatch.status !== 'matched') { if (prod) fail++; continue }
    const payload: Record<string, any> = {
      created_by: auth.userId ?? undefined,
      factory: factoryMatch.id, process_type: str(row, idx.ptype), customer: str(row, idx.customer),
      delivery_no: str(row, idx.delivery_no), item_no: str(row, idx.item_no), product: prod,
      internal_result: str(row, idx.ir), internal_defect: str(row, idx.idf), internal_inspector: str(row, idx.iins),
      cust_inspect_date: str(row, idx.cdate), cust_result: str(row, idx.cres), cust_defect: str(row, idx.cdef),
      notes: str(row, idx.notes),
    }
    const dv = cell(row, idx.date); if (dv) payload.inspect_date = formatImportedDate(dv)
    const qv = cell(row, idx.qty); if (qv !== '' && qv != null) payload.quantity = toNumber(qv)
    try { await pb.collection('quality_inspections').create(payload); ok++ } catch { fail++ }
  }
  if (fileInput.value) fileInput.value.value = ''
  await load()
  alert(`导入完成：成功 ${ok} 条` + (fail ? `，失败 ${fail} 条(工厂名未匹配或简称不唯一)` : '') + '\n(加工厂名称可填系统全称或唯一简称，如「俊豪」)')
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
        <input
          v-model="search"
          class="search-box"
          placeholder="搜索 送货日期/加工厂/客户/货号"
        />
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

      <div class="scroll">
        <table class="qi">
          <thead>
            <tr>
              <th rowspan="2">序号</th><th rowspan="2">送货日期</th><th rowspan="2">加工厂名称</th><th rowspan="2">加工类型</th>
              <th rowspan="2">客户</th><th rowspan="2">送货单号</th><th rowspan="2">货号</th><th rowspan="2">产品名称</th><th rowspan="2">数量</th><th rowspan="2">单数</th>
              <th colspan="3">内部验货状态</th>
              <th colspan="3">客户验货状态（适用于装配与包装加工）</th>
              <th rowspan="2">备注</th>
              <th v-if="canDelete" rowspan="2">操作</th>
            </tr>
            <tr>
              <th>检验结果</th><th>不良描述</th><th>检验人员</th>
              <th>检验日期</th><th>检验结果</th><th>不良描述</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in filteredRecords" :key="r.id">
              <td>{{ i + 1 }}</td>
              <td>{{ r.inspect_date ? r.inspect_date.slice(0, 10) : '-' }}</td>
              <td>{{ factoryName(r) }}</td>
              <td>{{ r.process_type || '-' }}</td>
              <td>{{ r.customer || '-' }}</td>
              <td>{{ r.delivery_no || '-' }}</td>
              <td>{{ r.item_no || '-' }}</td>
              <td>{{ r.product || '-' }}</td>
              <td>{{ r.quantity ?? '-' }}</td>
              <td>1</td>
              <td>{{ r.internal_result || '-' }}</td>
              <td>{{ r.internal_defect || '-' }}</td>
              <td>{{ r.internal_inspector || '-' }}</td>
              <td>{{ r.cust_inspect_date || '-' }}</td>
              <td>{{ r.cust_result || '-' }}</td>
              <td>{{ r.cust_defect || '-' }}</td>
              <td>{{ r.notes || '-' }}</td>
              <td v-if="canDelete"><button class="ghost mini" @click="remove(r)">删除</button></td>
            </tr>
            <tr v-if="!filteredRecords.length"><td :colspan="canDelete ? 18 : 17" class="hint" style="text-align:center">暂无检验记录</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </AppLayout>
</template>
<style scoped>
.wide { max-width: none; }
.region-sel { height: 34px; padding: 0 .6rem; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); cursor: pointer; }
.search-box { width: 280px; height: 34px; padding: 0 .7rem; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); }
.form-card { margin-bottom: 1rem; }
.grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: .8rem; }
.grid label { display: flex; flex-direction: column; gap: .25rem; font-size: .85rem; }
.actions { margin-top: .9rem; }
.scroll { overflow-x: auto; }
.qi { min-width: 1900px; }
.qi th, .qi td { white-space: nowrap; text-align: center; font-size: .85rem; }
.mini { padding: .25rem .6rem; font-size: .82rem; }
</style>
