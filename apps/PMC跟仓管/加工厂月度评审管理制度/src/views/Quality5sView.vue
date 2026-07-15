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
const canDelete = computed(() => auth.role === 'admin')
const canEdit = computed(() => (auth.role ? canEditQuality(auth.role) : false))

async function importExcel(ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0]
  if (!file) return
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { cellDates: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const aoa = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' })
  const norm = (s: any) => String(s).replace(/\s+/g, '')
  // 跳过可能的标题行，定位真正的表头行
  const headerIdx = aoa.findIndex((row) => row.some((c) => ['加工厂名称', '检查日期', '检查类型'].includes(norm(c))))
  if (headerIdx < 0) { alert('未识别到表头(需含「加工厂名称/检查日期」)'); return }
  const header = aoa[headerIdx].map(norm)
  const colOf = (...aliases: string[]) => {
    for (const a of aliases) { const i = header.indexOf(norm(a)); if (i >= 0) return i }
    return -1
  }
  const idx: Record<string, number> = {
    date: colOf('检查日期'), factory: colOf('加工厂名称', '加工厂'), type: colOf('检查类型'),
    project: colOf('加工项目'), customer: colOf('客户'), inspector: colOf('检查人员'),
    ip: colOf('IP保护得分(NA=不适用;适用)', 'IP保护得分', 'IP控制(如适用)', 'IP控制'), notes: colOf('备注'),
  }
  for (const f of SCORE_FIELDS) idx[f.key] = colOf(f.label, f.label.replace(/\(.*\)/, ''))
  const fByName: Record<string, string> = {}
  for (const f of factories.items) fByName[f.name] = f.id
  const toDate = (v: any) => (v instanceof Date ? v.toISOString() : String(v ?? '').trim())
  const cell = (row: any[], i: number) => (i >= 0 ? row[i] : '')
  let ok = 0, fail = 0
  for (const row of aoa.slice(headerIdx + 1)) {
    const fname = String(cell(row, idx.factory) ?? '').trim()
    const dv = cell(row, idx.date)
    if (!fname && !dv) continue // 跳过空行
    const payload: Record<string, any> = { created_by: auth.userId ?? undefined }
    if (dv) payload.check_date = toDate(dv)
    if (fname && fByName[fname]) payload.factory = fByName[fname]
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
    try { await pb.collection('quality_5s_checks').create(payload); ok++ } catch { fail++ }
  }
  if (fileInput.value) fileInput.value.value = ''
  await load()
  alert(`导入完成：成功 ${ok} 条` + (fail ? `，失败 ${fail} 条` : '') + '\n(加工厂名称需与系统中工厂名一致才会关联)')
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
            <select v-model="draft.factory">
              <option value="">选择工厂</option>
              <option v-for="f in factories.items" :key="f.id" :value="f.id">{{ f.name }}</option>
            </select>
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

      <div class="scroll">
        <table class="q5s">
          <thead>
            <tr>
              <th>序号</th><th>检查日期</th><th>加工厂名称</th><th>检查类型</th><th>加工项目</th><th>客户</th><th>检查人员</th>
              <th v-for="f in SCORE_FIELDS" :key="f.key">{{ f.label }}</th>
              <th>达成率</th><th>IP保护得分</th><th>折算总达成率</th><th>备注</th>
              <th v-if="canDelete">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in filteredRecords" :key="r.id">
              <td>{{ i + 1 }}</td>
              <td>{{ r.check_date ? r.check_date.slice(0, 10) : '-' }}</td>
              <td>{{ factoryName(r) }}</td>
              <td>{{ r.check_type || '-' }}</td>
              <td>{{ r.project || '-' }}</td>
              <td>{{ r.customer || '-' }}</td>
              <td>{{ r.inspector || '-' }}</td>
              <td v-for="f in SCORE_FIELDS" :key="f.key">{{ (r as any)[f.key] ?? '-' }}</td>
              <td class="score">{{ achieveRate(r) }}</td>
              <td>{{ ipDisplay(r) }}</td>
              <td class="score">{{ finalRate(r) }}</td>
              <td>{{ r.notes || '-' }}</td>
              <td v-if="canDelete"><button class="ghost mini" @click="remove(r)">删除</button></td>
            </tr>
            <tr v-if="!filteredRecords.length"><td :colspan="canDelete ? 20 : 19" class="hint" style="text-align:center">暂无检查记录</td></tr>
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
.computed { align-self: end; font-size: .9rem; color: var(--text-soft); }
.computed b { color: var(--primary, #4f46e5); font-size: 1.1rem; }
.actions { margin-top: .9rem; }
.scroll { overflow-x: auto; }
.q5s { min-width: 2200px; }
.q5s th, .q5s td { white-space: nowrap; text-align: left; }
.score { font-weight: 600; }
.mini { padding: .25rem .6rem; font-size: .82rem; }
</style>
