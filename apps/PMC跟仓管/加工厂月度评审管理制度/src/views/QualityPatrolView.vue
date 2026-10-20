<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { getTokenPayload, type RecordModel } from 'pocketbase'
import AppLayout from '../components/AppLayout.vue'
import { pb } from '../pb'
import { useAuthStore } from '../stores/auth'
import { useFactoriesStore } from '../stores/factories'
import { allowedRegions, canEditQuality, canViewCraft } from '../utils/permissions'
import { REGION_LABELS, regionOf, type Region } from '../constants/roles'
import { PATROL_FIELDS, PATROL_TABLE_FIELDS, PATROL_GRADES, PATROL_GUIDANCE, patrolSummary, patrolDisplayValue } from '../utils/qualityPatrol'

const QualityPatrolImport = defineAsyncComponent(() => import('../components/QualityPatrolImport.vue'))
const QualityPatrolCompare = defineAsyncComponent(() => import('../components/QualityPatrolCompare.vue'))
const importOpen = ref(false)
const compareOpen = ref(false)
const tableFields = PATROL_TABLE_FIELDS
const columnCount = computed(() => tableFields.length + 4 + (editable.value ? 1 : 0))
const auth = useAuthStore()
const factories = useFactoriesStore()
const route = useRoute()
const region = ref<Region | ''>((route.query.region as Region) || '')
const regions = computed(() => auth.role ? allowedRegions(auth.role) : [])
const editable = computed(() => !!auth.role && canEditQuality(auth.role))
const authorizedFactories = computed(() => factories.items.filter(f => regions.value.includes(regionOf(f)) && canViewCraft(f.craft)))
const availableFactories = computed(() => authorizedFactories.value.filter(f => !region.value || regionOf(f) === region.value))
const records = ref<RecordModel[]>([])
const date = ref('')
const search = ref('')
const grade = ref('')
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const formError = ref('')
const editing = ref(false)
const editingId = ref('')
const photos = ref<File[]>([])
const keptPhotos = ref<string[]>([])
const draft = reactive<Record<string, any>>({})
const dialog = ref<HTMLElement | null>(null)
const formAlert = ref<HTMLParagraphElement | null>(null)
const addButton = ref<HTMLButtonElement | null>(null)
const fileToken = ref('')
const photoError = ref('')
let dateInitialized = false
let returnFocus: HTMLElement | null = null
let tokenTimer: ReturnType<typeof setTimeout> | undefined
let tokenDeadline: ReturnType<typeof setTimeout> | undefined
let tokenRequest: AbortController | undefined
let tokenPromise: Promise<void> | undefined
let tokenGeneration = 0
let disposed = false
const factoryName = (id: string) => factories.items.find(f => f.id === id)?.name || '未知工厂'
const scopedRecords = computed(() => records.value.filter(r => availableFactories.value.some(f => f.id === r.factory)))
const dates = computed(() => [...new Set(scopedRecords.value.map(r => String(r.check_date).slice(0, 10)))].sort().reverse())
const rows = computed(() => scopedRecords.value.filter(r => (!route.query.factory || r.factory === route.query.factory) && (!date.value || r.check_date.slice(0, 10) === date.value) && (!grade.value || r.grade === grade.value) && factoryName(r.factory).includes(search.value.trim())))
const stats = computed(() => patrolSummary(rows.value.map(r => ({ factory: r.factory, grade: r.grade, staff: r.staff }))))
const display = (r: Record<string, any>, field: typeof PATROL_FIELDS[number]) => patrolDisplayValue(r, field.key)
const feePeriods = computed(() => [...new Set(rows.value.filter(r => r.processing_fee_period || (r.processing_fee != null && r.processing_fee !== '')).map(r => String(r.processing_fee_period || '').trim()))])
const feeLabel = computed(() => feePeriods.value.length === 1 && feePeriods.value[0] ? `${feePeriods.value[0]}\n加工费（万）` : '加工费（万）')
const headerLabel = (field: typeof PATROL_FIELDS[number]) => field.key === 'processing_fee' ? feeLabel.value : field.label

const photoUrl = (r: RecordModel, name: string) => pb.files.getURL(r, name, { token: fileToken.value })

function stopPhotoAccess() {
  ++tokenGeneration
  clearTimeout(tokenTimer)
  clearTimeout(tokenDeadline)
  tokenTimer = undefined
  tokenDeadline = undefined
  tokenRequest?.abort()
  tokenRequest = undefined
  tokenPromise = undefined
  fileToken.value = ''
}
function refreshPhotoAccess(): Promise<void> {
  if (tokenPromise) return tokenPromise
  clearTimeout(tokenTimer)
  tokenTimer = undefined
  if (disposed || !records.value.some(r => r.photos?.length)) { fileToken.value = ''; photoError.value = ''; return Promise.resolve() }
  const generation = tokenGeneration
  const controller = new AbortController()
  tokenRequest = controller
  const deadline = setTimeout(() => controller.abort(), 10000)
  tokenDeadline = deadline
  photoError.value = ''
  const pending = Promise.resolve().then(async () => {
    try {
      const token = await pb.files.getToken({ signal: controller.signal })
      if (disposed || generation !== tokenGeneration) return
      const expires = Number(getTokenPayload(token).exp) * 1000
      if (!token || !Number.isFinite(expires) || expires <= Date.now()) throw new Error('expired file token')
      fileToken.value = token
      tokenTimer = setTimeout(() => { void refreshPhotoAccess() }, Math.max(1000, expires - Date.now() - 30000))
    } catch {
      if (disposed || generation !== tokenGeneration) return
      fileToken.value = ''
      photoError.value = '照片授权获取失败，请确认登录及查看权限后重试。'
    } finally {
      clearTimeout(deadline)
      if (tokenPromise === pending) { tokenPromise = undefined; tokenRequest = undefined; tokenDeadline = undefined }
    }
  })
  tokenPromise = pending
  return pending
}
function photoFailed() {
  stopPhotoAccess()
  photoError.value = '照片加载失败，请检查服务或查看权限，再刷新照片重试。'
}
watch(() => auth.userId, () => { stopPhotoAccess(); photoError.value = '' })
watch(region, () => { date.value = dates.value[0] || '' })
onBeforeUnmount(() => { disposed = true; stopPhotoAccess() })

async function onImported(checkDate: string, importedRegion: Region) {
  region.value = importedRegion
  await nextTick()
  date.value = checkDate
  await load()
}
async function load() {
  loading.value = true
  error.value = ''
  try {
    await factories.fetchAll()
    records.value = await pb.collection('quality_patrols').getFullList({ sort: '-check_date,factory' })
    if (!dateInitialized || (date.value && !dates.value.includes(date.value))) date.value = (typeof route.query.date === 'string' && dates.value.includes(route.query.date) ? route.query.date : dates.value[0]) || ''
    dateInitialized = true
    void refreshPhotoAccess()
  } catch { error.value = '巡查记录加载失败，请确认服务已更新并重试。' }
  finally { loading.value = false }
}
onMounted(load)
function openForm(record?: RecordModel) {
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  formError.value = ''
  for (const key of Object.keys(draft)) delete draft[key]
  Object.assign(draft, { factory: '', check_date: date.value || new Date().toLocaleDateString('sv-SE'), visitor_ready: false, below_standard: false })
  for (const f of PATROL_FIELDS) draft[f.key] = ''
  if (record) {
    for (const key of Object.keys(draft)) draft[key] = record[key] ?? draft[key]
    for (const key of ['check_date', ...PATROL_FIELDS.filter(f => f.type === 'date').map(f => f.key)]) draft[key] = draft[key]?.slice(0, 10) || ''
  }
  editingId.value = record?.id || ''
  keptPhotos.value = [...(record?.photos || [])]
  photos.value = []
  editing.value = true
  void nextTick(() => { dialog.value?.querySelector<HTMLElement>('select, input, button')?.focus() })
}
function closeForm() {
  if (saving.value) return
  editing.value = false
  void nextTick(() => { (returnFocus?.isConnected ? returnFocus : addButton.value)?.focus() })
}
function dialogKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); closeForm(); return }
  if (event.key !== 'Tab' || !dialog.value) return
  const controls = [...dialog.value.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]')]
  const first = controls[0], last = controls[controls.length - 1]
  if (!first || !last) { event.preventDefault(); dialog.value.focus(); return }
  if (!dialog.value.contains(document.activeElement) || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
    event.preventDefault(); (event.shiftKey ? last : first).focus()
  }
}
function selectFactory() {
  if (editingId.value) return
  const f = factories.items.find(f => f.id === draft.factory)
  draft.staff = f?.staff_count ?? ''
  draft.area = f?.workshop_area ?? ''
}
function choosePhotos(event: Event) {
  const selected = Array.from((event.target as HTMLInputElement).files || [])
  if (!validPhotos(selected)) {
    formError.value = '最多保存10张照片，每张不超过10MB，本次新增照片合计不超过30MB，支持 JPG、PNG、WebP。'
    ;(event.target as HTMLInputElement).value = ''
    photos.value = []
    return
  }
  formError.value = ''
  photos.value = selected
}
function validPhotos(selected: File[]) {
  return selected.length + keptPhotos.value.length <= 10 && selected.reduce((sum, f) => sum + f.size, 0) <= 30 * 1024 * 1024 && selected.every(f => f.size <= 10 * 1024 * 1024 && ['image/jpeg', 'image/png', 'image/webp'].includes(f.type))
}
async function save() {
  if (!editable.value || saving.value) return
  formError.value = ''
  if (!draft.factory || !draft.check_date || !availableFactories.value.some(f => f.id === draft.factory)) { formError.value = '请选择加工厂和检查日期。'; return }
  if (records.value.some(r => r.id !== editingId.value && r.factory === draft.factory && r.check_date.slice(0, 10) === draft.check_date)) { formError.value = '该工厂在此日期已有巡查记录，请编辑已有记录。'; return }
  if (draft.below_standard && draft.grade !== 'A') { formError.value = '基本条件未达标的黄色标记仅适用于A级工厂。'; return }
  if (!validPhotos(photos.value)) { formError.value = '请检查照片数量及大小，本次新增照片合计不能超过30MB。'; return }
  saving.value = true
  try {
    const body = new FormData()
    for (const [key, value] of Object.entries(draft)) body.append(key, String(value ?? ''))
    for (const f of PATROL_FIELDS.filter(f => f.type === 'number')) body.set(f.key, draft[f.key] === '' ? 'null' : JSON.stringify(Number(draft[f.key])))
    body.delete('photos')
    body.append('photos', '')
    for (const name of keptPhotos.value) body.append('photos', name)
    for (const file of photos.value) body.append('photos', file)
    if (editingId.value) await pb.collection('quality_patrols').update(editingId.value, body)
    else await pb.collection('quality_patrols').create(body)
    date.value = draft.check_date
    await load()
    saving.value = false
    closeForm()
  } catch { formError.value = '保存失败，请检查填写内容、照片大小及操作权限后重试。'; void nextTick(() => { formAlert.value?.focus() }) }
  finally { saving.value = false }
}
async function remove(r: RecordModel) {
  if (!editable.value || saving.value || !confirm(`确定删除“${factoryName(r.factory)}”的这条巡查记录？`)) return
  saving.value = true
  try { await pb.collection('quality_patrols').delete(r.id); await load() }
  catch { error.value = '删除失败，请重试。' }
  finally { saving.value = false }
}
</script>

<template>
  <AppLayout>
    <div class="page patrol-page">
      <div class="toolbar"><div><RouterLink to="/quality">← 品质管理</RouterLink><h2>巡查现场</h2><p v-if="route.query.factory">当前定位：{{ factoryName(String(route.query.factory)) }} <RouterLink :to="{ path: '/quality-patrol', query: { region } }">查看全部工厂</RouterLink></p></div><div class="actions"><button :disabled="loading" @click="compareOpen = true">多次巡查对比</button><button v-if="editable" :disabled="loading || saving" @click="importOpen = true">导入 Excel</button><button v-if="editable" ref="addButton" class="primary" :disabled="loading || saving" @click="openForm()">新增巡查</button></div></div>
      <div class="filters">
        <label>厂区<select v-model="region"><option value="">全部授权厂区</option><option v-for="r in regions" :key="r" :value="r">{{ REGION_LABELS[r] }}</option></select></label>
        <label>检查日期<select v-model="date"><option value="">全部日期</option><option v-for="d in dates" :key="d">{{ d }}</option></select></label>
        <label>厂名<input v-model="search" placeholder="搜索加工厂" /></label>
        <label>本次评级<select v-model="grade"><option value="">全部等级</option><option v-for="g in PATROL_GRADES" :key="g" :value="g">{{ g }}级</option></select></label>
        <button :disabled="loading || saving" @click="load">刷新</button>
      </div>
      <div v-if="error" role="alert" class="error">{{ error }} <button @click="load">重试</button></div>
      <div v-if="photoError" role="alert" class="error">{{ photoError }} <button @click="refreshPhotoAccess">刷新照片</button></div>
      <p v-if="loading" role="status">正在加载巡查记录…</p>
      <template v-else-if="!error">
        <div class="sheet-heading">{{ date || '各期' }} {{ region ? REGION_LABELS[region] : '' }}加工厂检查总结</div>
        <div class="sheet-scroll">
          <table class="patrol-table">
            <thead><tr><th scope="col">序号</th><th scope="col">厂名</th><th v-for="f in tableFields" :key="f.key" scope="col" :class="['field-' + f.key, { narrative: f.type === 'text' }]">{{ headerLabel(f) }}</th><th scope="col">现场照片</th><th scope="col">备注</th><th v-if="editable" scope="col">操作</th></tr></thead>
            <tbody>
              <tr v-for="(r, i) in rows" :key="r.id">
                <td>{{ i + 1 }}</td><td class="factory-cell" :class="{ visitor: r.visitor_ready }"><strong>{{ factoryName(r.factory) }}</strong><small>{{ r.check_date.slice(0, 10) }}</small></td>
                <td v-for="f in tableFields" :key="f.key" :class="['field-' + f.key, { narrative: f.type === 'text', 'grade-cell': f.type === 'grade', warning: f.key === 'staff' && r.below_standard }]">{{ display(r, f) }}<small v-if="f.key === 'processing_fee' && feePeriods.length !== 1 && r.processing_fee_period">{{ r.processing_fee_period }}</small></td>
                <td class="photo-cell"><template v-if="fileToken"><a v-for="name in r.photos || []" :key="name" :href="photoUrl(r, name)" target="_blank" rel="noopener noreferrer"><img :src="photoUrl(r, name)" alt="现场照片" loading="lazy" referrerpolicy="no-referrer" @error="photoFailed" /></a></template><span v-if="r.photos?.length && !fileToken">照片暂不可用</span><span v-if="!r.photos?.length">—</span></td><td class="narrative">{{ r.notes || '—' }}</td>
                <td v-if="editable"><div class="actions"><button :disabled="saving" @click="openForm(r)">编辑</button><button :disabled="saving" @click="remove(r)">删除</button></div></td>
              </tr>
              <tr v-if="!rows.length"><td :colspan="columnCount" class="empty">暂无匹配的巡查记录{{ editable ? '，可点击“新增巡查”登记。' : '。' }}</td></tr>
            </tbody>
            <tfoot v-if="rows.length"><tr><th colspan="2">合计</th><td>{{ stats.staff }}</td><td :colspan="columnCount - 3">员工人数合计（仅计算已填写数据）</td></tr></tfoot>
          </table>
        </div>
        <section class="summary"><div><h3>{{ date || '所选范围' }}巡查汇总，加工厂共 {{ stats.factories }} 家</h3><p v-if="!date">共 {{ rows.length }} 条巡查记录；跨日期人数和评级按记录统计，同一工厂可能重复计入。</p><table class="grade-summary"><thead><tr><th>等级</th><th>数量</th><th>占比</th></tr></thead><tbody><tr v-for="g in stats.grades" :key="g.grade"><th>{{ g.grade }}级</th><td>{{ g.count }}</td><td>{{ g.percent }}</td></tr><tr v-if="stats.unrated"><th>未评级</th><td>{{ stats.unrated }}</td><td>—</td></tr></tbody></table></div>
          <div class="legend"><p><span class="swatch visitor"></span>厂名绿色填充：可供客户参观加工厂。</p><p><span class="swatch warning"></span>人数黄色填充：评级为A级，但基本条件未达到标准。</p><p>颜色标记由巡查人员登记；等级占比按当前筛选的全部巡查记录计算。</p></div>
        </section>
        <p class="guidance">等级划分执行方式：{{ PATROL_GUIDANCE }}</p>
      </template>
      <QualityPatrolImport v-if="importOpen && editable" :factories="authorizedFactories" :records="records" :regions="regions" :initial-region="region" @close="importOpen = false" @saved="onImported" />
      <QualityPatrolCompare v-if="compareOpen" :records="scopedRecords" :factories="availableFactories" :photo-url="photoUrl" :photo-ready="!!fileToken" :photo-error="photoError" @photo-failed="photoFailed" @refresh-photos="refreshPhotoAccess" @close="compareOpen = false" />
      <div v-if="editing" class="patrol-overlay"><section ref="dialog" role="dialog" aria-modal="true" aria-labelledby="patrol-form-title" tabindex="-1" class="patrol-dialog" @keydown="dialogKeydown"><form @submit.prevent="save"><h3 id="patrol-form-title">{{ editingId ? '编辑' : '新增' }}巡查记录</h3><div class="form-grid">
        <label>加工厂<select v-model="draft.factory" required @change="selectFactory"><option value="">请选择加工厂</option><option v-for="f in availableFactories" :key="f.id" :value="f.id">{{ f.name }}</option></select></label>
        <label>检查日期<input v-model="draft.check_date" type="date" required /></label>
        <label v-for="f in PATROL_FIELDS" :key="f.key" :class="{ wide: f.type === 'text' }">{{ f.label }}<textarea v-if="f.type === 'text'" v-model="draft[f.key]" rows="3" maxlength="10000" /><select v-else-if="f.type === 'grade'" v-model="draft[f.key]"><option value="">未评级</option><option v-for="g in PATROL_GRADES" :key="g" :value="g">{{ g }}</option></select><input v-else v-model="draft[f.key]" :type="f.type === 'short' ? 'text' : f.type" :min="f.type === 'number' ? 0 : undefined" :step="['area', 'processing_fee'].includes(f.key) ? 'any' : 1" /></label>
        <p class="wide field-help">加工费按填写的统计期间记录，单位为万元。整改分项日期或“已完成”等文字请填入“整改完成说明（原文）”；该说明会显示在主表的整改完成时间列。</p>
        <label class="check"><input v-model="draft.visitor_ready" type="checkbox" />可供客户参观（厂名绿色）</label><label class="check"><input v-model="draft.below_standard" type="checkbox" />A级但基本条件未达标（人数黄色）</label>
        <label class="wide">现场照片（最多10张，每张≤10MB，本次新增合计≤30MB）<input type="file" accept="image/jpeg,image/png,image/webp" multiple @change="choosePhotos" /><span>{{ photos.length }} 张待上传</span></label>
        <div v-if="keptPhotos.length" class="wide kept-photos"><label v-for="name in keptPhotos" :key="name">{{ name }}<button type="button" @click="keptPhotos = keptPhotos.filter(n => n !== name)">移除照片</button></label></div>
      </div><p v-if="formError" ref="formAlert" role="alert" tabindex="-1" class="error">{{ formError }}</p><div class="form-actions"><button type="button" :disabled="saving" @click="closeForm">取消</button><button type="submit" class="primary" :disabled="saving">{{ saving ? '保存中…' : '保存' }}</button></div></form></section></div>
    </div>
  </AppLayout>
</template>

<style scoped>
.patrol-page { max-width: none; min-width: 0; }
.toolbar, .filters, .actions, .form-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.toolbar { justify-content: space-between; } h2 { margin: 10px 0 18px; }
.filters { padding: 16px; background: white; border: 1px solid #e1e4eb; border-radius: 12px; margin-bottom: 18px; align-items: end; }
label { display: flex; flex-direction: column; gap: 6px; font-size: 14px; }
input, select, textarea { padding: 9px; border: 1px solid #cbd0dc; border-radius: 6px; font: inherit; min-width: 0; background: white; color: #202635; }
button { min-height: 44px; min-width: 44px; padding: 8px 14px; border: 1px solid #ccd0df; border-radius: 6px; background: white; color: var(--text); cursor: pointer; } button:disabled { opacity: .5; cursor: default; }
.primary { color: white; background: #4f46e5; border-color: #4f46e5; }
.sheet-scroll { overflow: auto; max-height: 65vh; background: white; border: 1px solid #c8ccd5; }
table { border-collapse: separate; border-spacing: 0; font-size: 14px; }
th, td { padding: 12px; border-right: 1px solid #bfc4cc; border-bottom: 1px solid #bfc4cc; text-align: center; white-space: pre-wrap; }
.patrol-table { min-width: 2300px; width: 100%; margin: 0; border-radius: 0; box-shadow: none; }
.patrol-table thead { position: sticky; top: 0; z-index: 2; }
.patrol-table thead th { background: #fff; }
th { background: #f2f2f2; color: #202635; }
.sheet-heading { font-size: 20px; font-weight: 700; text-align: center; padding: 20px; background: #fff; border: 1px solid #c8ccd5; border-bottom: 0; }
.narrative { min-width: 230px; max-width: 340px; text-align: left; line-height: 1.65; overflow-wrap: anywhere; }
.factory-cell { min-width: 170px; max-width: 220px; overflow-wrap: anywhere; } small { display: block; margin-top: 8px; color: #45515e; }
.field-responsibility_scope, .field-responsible_supervisor { min-width: 90px; max-width: 150px; overflow-wrap: anywhere; }
.field-processing_fee { min-width: 130px; }
.field-completed_date { min-width: 165px; max-width: 230px; line-height: 1.65; overflow-wrap: anywhere; }
.field-help { color: #596275; margin: 0; line-height: 1.6; }
.grade-cell { font-size: 18px; font-weight: 700; } .changed { color: #c93427; }
.visitor { background: #bce9c8; } .warning { background: #fff09c; }
.photo-cell { min-width: 180px; } .photo-cell img { width: 76px; height: 76px; object-fit: cover; margin: 3px; border-radius: 5px; }
.empty { padding: 48px; text-align: left; } tfoot td, tfoot th { background: #fff5da; }
tfoot td:last-child { text-align: left; }
.summary { display: flex; gap: 50px; flex-wrap: wrap; margin-top: 22px; padding: 22px; border: 1px solid #e1e4eb; border-radius: 12px; background: #fff; }
.summary > div { min-width: 0; max-width: 100%; } .summary > div:first-child { flex: 0 1 320px; }
.summary h3 { margin-top: 0; } .grade-summary { min-width: 0; border-top: 1px solid #bfc4cc; border-left: 1px solid #bfc4cc; }
.legend { color: #4b5563; align-self: center; } .swatch { display: inline-block; width: 20px; height: 16px; vertical-align: middle; margin-right: 6px; border: 1px solid #a9b2bc; }
.guidance { background: #fff4d2; padding: 16px; line-height: 1.8; } .error { color: #b42318; background: #fff0ee; padding: 12px; }
.patrol-overlay { position: fixed; inset: 0; background: #17203380; display: grid; place-items: center; z-index: 1000; padding: 24px; }
.patrol-dialog { background: white; padding: 24px; border-radius: 14px; width: min(900px, 100%); max-height: 90vh; overflow: auto; }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.kept-photos { overflow-wrap: anywhere; }
.wide { grid-column: 1 / -1; } .check { flex-direction: row; align-items: center; } .form-actions { justify-content: flex-end; margin-top: 20px; position: sticky; bottom: -24px; padding: 16px 0; background: white; }
@media (max-width: 700px) { .form-grid { grid-template-columns: 1fr; } .patrol-overlay { padding: 10px; } .filters label { width: 100%; } .summary { padding: 12px; gap: 20px; } .grade-summary th, .grade-summary td { padding: 8px 2px; font-size: 12px; overflow-wrap: anywhere; } .patrol-dialog { padding: 16px; } .form-actions { bottom: -16px; } }
</style>
