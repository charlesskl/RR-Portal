<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import type { RecordModel } from 'pocketbase'
import AppLayout from '../components/AppLayout.vue'
import { pb } from '../pb'
import { useAuthStore } from '../stores/auth'
import { useFactoriesStore } from '../stores/factories'
import { allowedRegions, canEditQuality, canViewCraft } from '../utils/permissions'
import { REGION_LABELS, regionOf, type Region } from '../constants/roles'
import { PATROL_FIELDS, PATROL_GRADES, PATROL_GUIDANCE, patrolSummary } from '../utils/qualityPatrol'

const tableFields = PATROL_FIELDS.filter(f => f.key !== 'notes')
const auth = useAuthStore()
const factories = useFactoriesStore()
const route = useRoute()
const region = ref<Region | ''>((route.query.region as Region) || '')
const regions = computed(() => auth.role ? allowedRegions(auth.role) : [])
const editable = computed(() => !!auth.role && canEditQuality(auth.role))
const availableFactories = computed(() => factories.items.filter(f => regions.value.includes(regionOf(f)) && canViewCraft(f.craft) && (!region.value || regionOf(f) === region.value)))
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
const factoryName = (id: string) => factories.items.find(f => f.id === id)?.name || '未知工厂'
const scopedRecords = computed(() => records.value.filter(r => availableFactories.value.some(f => f.id === r.factory)))
const dates = computed(() => [...new Set(scopedRecords.value.map(r => String(r.check_date).slice(0, 10)))].sort().reverse())
const rows = computed(() => scopedRecords.value.filter(r => (!date.value || r.check_date.slice(0, 10) === date.value) && (!grade.value || r.grade === grade.value) && factoryName(r.factory).includes(search.value.trim())))
const stats = computed(() => patrolSummary(rows.value.map(r => ({ factory: r.factory, grade: r.grade, staff: r.staff }))))
const display = (r: Record<string, any>, field: typeof PATROL_FIELDS[number]) => field.type === 'date' ? (r[field.key]?.slice(0, 10) || '—') : (r[field.key] === '' || r[field.key] == null ? '—' : r[field.key])
const photoUrl = (r: RecordModel, name: string) => pb.files.getURL(r, name)

async function load() {
  loading.value = true
  error.value = ''
  try {
    await factories.fetchAll()
    records.value = await pb.collection('quality_patrols').getFullList({ sort: '-check_date,factory' })
    if (!date.value) date.value = dates.value[0] || ''
  } catch { error.value = '巡查记录加载失败，请确认服务已更新并重试。' }
  finally { loading.value = false }
}
onMounted(load)
function openForm(record?: RecordModel) {
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
}
function selectFactory() {
  if (editingId.value) return
  const f = factories.items.find(f => f.id === draft.factory)
  draft.staff = f?.staff_count ?? ''
  draft.area = f?.workshop_area ?? ''
  const previous = records.value.find(r => r.factory === draft.factory && r.check_date.slice(0, 10) < draft.check_date)
  for (const [dest, source] of [['previous_date', 'check_date'], ['previous_grade', 'grade'], ['previous_evaluation', 'evaluation'], ['previous_correction', 'correction'], ['previous_type', 'production_type']]) {
    if (dest && source) draft[dest] = previous?.[source] || ''
  }
  draft.previous_date = draft.previous_date.slice(0, 10)
}
function choosePhotos(event: Event) {
  const selected = Array.from((event.target as HTMLInputElement).files || [])
  if (selected.length + keptPhotos.value.length > 10 || selected.some(f => f.size > 10 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(f.type))) {
    formError.value = '最多保存10张照片，每张不超过10MB，支持 JPG、PNG、WebP。'
    ;(event.target as HTMLInputElement).value = ''
    photos.value = []
    return
  }
  formError.value = ''
  photos.value = selected
}
async function save() {
  if (!editable.value || saving.value) return
  formError.value = ''
  if (!draft.factory || !draft.check_date || !availableFactories.value.some(f => f.id === draft.factory)) { formError.value = '请选择加工厂和检查日期。'; return }
  if (draft.previous_date && draft.previous_date >= draft.check_date) { formError.value = '上次评级日期必须早于本次检查日期。'; return }
  if (records.value.some(r => r.id !== editingId.value && r.factory === draft.factory && r.check_date.slice(0, 10) === draft.check_date)) { formError.value = '该工厂在此日期已有巡查记录，请编辑已有记录。'; return }
  if (draft.below_standard && draft.grade !== 'A') { formError.value = '基本条件未达标的黄色标记仅适用于A级工厂。'; return }
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
    editing.value = false
    await load()
  } catch { formError.value = '保存失败，请检查填写内容、照片大小及操作权限后重试。' }
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
      <div class="toolbar"><div><RouterLink to="/quality">← 品质管理</RouterLink><h2>巡查现场</h2></div><button v-if="editable" class="primary" :disabled="loading || saving" @click="openForm()">新增巡查</button></div>
      <div class="filters">
        <label>厂区<select v-model="region" @change="date = ''"><option value="">全部授权厂区</option><option v-for="r in regions" :key="r" :value="r">{{ REGION_LABELS[r] }}</option></select></label>
        <label>检查日期<select v-model="date"><option value="">全部日期</option><option v-for="d in dates" :key="d">{{ d }}</option></select></label>
        <label>厂名<input v-model="search" placeholder="搜索加工厂" /></label>
        <label>本次评级<select v-model="grade"><option value="">全部等级</option><option v-for="g in PATROL_GRADES" :key="g" :value="g">{{ g }}级</option></select></label>
        <button :disabled="loading || saving" @click="load">刷新</button>
      </div>
      <div v-if="error" role="alert" class="error">{{ error }} <button @click="load">重试</button></div>
      <p v-if="loading" role="status">正在加载巡查记录…</p>
      <template v-else-if="!error">
        <div class="sheet-scroll">
          <table class="patrol-table">
            <thead><tr><th :colspan="PATROL_FIELDS.length + 3" class="sheet-title">{{ date || '各期' }} {{ region ? REGION_LABELS[region] : '' }}加工厂检查总结</th><th v-if="editable" rowspan="2">操作</th></tr><tr><th>序号</th><th>厂名</th><th v-for="f in tableFields" :key="f.key" :class="{ narrative: f.type === 'text' }">{{ f.label }}</th><th>现场照片</th><th>备注</th></tr></thead>
            <tbody>
              <tr v-for="(r, i) in rows" :key="r.id">
                <td>{{ i + 1 }}</td><td class="factory-cell" :class="{ visitor: r.visitor_ready }"><strong>{{ factoryName(r.factory) }}</strong><small>{{ r.check_date.slice(0, 10) }}</small></td>
                <td v-for="f in tableFields" :key="f.key" :class="{ narrative: f.type === 'text', 'grade-cell': f.type === 'grade', warning: f.key === 'staff' && r.below_standard, changed: f.key === 'grade' && r.previous_grade && r.grade !== r.previous_grade }">{{ display(r, f) }}</td>
                <td class="photo-cell"><a v-for="name in r.photos || []" :key="name" :href="photoUrl(r, name)" target="_blank" rel="noopener"><img :src="photoUrl(r, name)" alt="现场照片" loading="lazy" /></a><span v-if="!r.photos?.length">—</span></td><td class="narrative">{{ r.notes || '—' }}</td>
                <td v-if="editable"><div class="actions"><button :disabled="saving" @click="openForm(r)">编辑</button><button :disabled="saving" @click="remove(r)">删除</button></div></td>
              </tr>
              <tr v-if="!rows.length"><td :colspan="PATROL_FIELDS.length + 3 + (editable ? 1 : 0)" class="empty">暂无匹配的巡查记录{{ editable ? '，可点击“新增巡查”登记。' : '。' }}</td></tr>
            </tbody>
            <tfoot v-if="rows.length"><tr><th colspan="2">合计</th><td>{{ stats.staff }}</td><td :colspan="PATROL_FIELDS.length + (editable ? 1 : 0)">员工人数合计（仅计算已填写数据）</td></tr></tfoot>
          </table>
        </div>
        <section class="summary"><div><h3>{{ date || '所选范围' }}巡查汇总，加工厂共 {{ stats.factories }} 家</h3><p v-if="!date">共 {{ rows.length }} 条巡查记录；跨日期人数和评级按记录统计，同一工厂可能重复计入。</p><table class="grade-summary"><thead><tr><th>等级</th><th>数量</th><th>占比</th></tr></thead><tbody><tr v-for="g in stats.grades" :key="g.grade"><th>{{ g.grade }}级</th><td>{{ g.count }}</td><td>{{ g.percent }}</td></tr><tr v-if="stats.unrated"><th>未评级</th><td>{{ stats.unrated }}</td><td>—</td></tr></tbody></table></div>
          <div class="legend"><p><span class="swatch visitor"></span>厂名绿色填充：可供客户参观加工厂。</p><p><span class="swatch warning"></span>人数黄色填充：评级为A级，但基本条件未达到标准。</p><p>颜色标记由巡查人员登记；等级占比按当前筛选的全部巡查记录计算。</p></div>
        </section>
        <p class="guidance">等级划分执行方式：{{ PATROL_GUIDANCE }}</p>
      </template>
      <div v-if="editing" class="patrol-overlay"><section role="dialog" aria-modal="true" aria-labelledby="patrol-form-title" class="patrol-dialog"><form @submit.prevent="save"><h3 id="patrol-form-title">{{ editingId ? '编辑' : '新增' }}巡查记录</h3><div class="form-grid">
        <label>加工厂<select v-model="draft.factory" required @change="selectFactory"><option value="">请选择加工厂</option><option v-for="f in availableFactories" :key="f.id" :value="f.id">{{ f.name }}</option></select></label>
        <label>检查日期<input v-model="draft.check_date" type="date" required @change="selectFactory" /></label>
        <label v-for="f in PATROL_FIELDS" :key="f.key" :class="{ wide: f.type === 'text' }">{{ f.label }}<textarea v-if="f.type === 'text'" v-model="draft[f.key]" rows="3" maxlength="10000" /><select v-else-if="f.type === 'grade'" v-model="draft[f.key]"><option value="">未评级</option><option v-for="g in PATROL_GRADES" :key="g" :value="g">{{ g }}</option></select><input v-else v-model="draft[f.key]" :type="f.type" :min="f.type === 'number' ? 0 : undefined" :step="f.key === 'area' ? 'any' : 1" /></label>
        <label class="check"><input v-model="draft.visitor_ready" type="checkbox" />可供客户参观（厂名绿色）</label><label class="check"><input v-model="draft.below_standard" type="checkbox" />A级但基本条件未达标（人数黄色）</label>
        <label class="wide">现场照片（最多10张，每张≤10MB）<input type="file" accept="image/jpeg,image/png,image/webp" multiple @change="choosePhotos" /><span>{{ photos.length }} 张待上传</span></label>
        <div v-if="keptPhotos.length" class="wide kept-photos"><label v-for="name in keptPhotos" :key="name">{{ name }}<button type="button" @click="keptPhotos = keptPhotos.filter(n => n !== name)">移除照片</button></label></div>
      </div><p v-if="formError" role="alert" class="error">{{ formError }}</p><div class="form-actions"><button type="button" :disabled="saving" @click="editing = false">取消</button><button type="submit" class="primary" :disabled="saving">{{ saving ? '保存中…' : '保存' }}</button></div></form></section></div>
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
button { padding: 8px 14px; border: 1px solid #ccd0df; border-radius: 6px; background: white; cursor: pointer; } button:disabled { opacity: .5; cursor: default; }
.primary { color: white; background: #4f46e5; border-color: #4f46e5; }
.sheet-scroll { overflow: auto; max-height: 65vh; background: white; border: 1px solid #c8ccd5; }
table { border-collapse: separate; border-spacing: 0; font-size: 14px; }
th, td { padding: 12px; border-right: 1px solid #bfc4cc; border-bottom: 1px solid #bfc4cc; text-align: center; white-space: pre-wrap; }
.patrol-table { min-width: 2900px; width: 100%; }
.patrol-table thead { position: sticky; top: 0; z-index: 2; }
th { background: #f2f2f2; color: #202635; }
.sheet-title { font-size: 20px; padding: 18px; background: #fff; }
.narrative { min-width: 230px; max-width: 340px; text-align: left; line-height: 1.65; overflow-wrap: anywhere; }
.factory-cell { min-width: 135px; } small { display: block; margin-top: 8px; color: #45515e; }
.grade-cell { font-size: 18px; font-weight: 700; } .changed { color: #c93427; }
.visitor { background: #bce9c8; } .warning { background: #fff09c; }
.photo-cell { min-width: 180px; } .photo-cell img { width: 76px; height: 76px; object-fit: cover; margin: 3px; border-radius: 5px; }
.empty { padding: 48px; text-align: left; } tfoot td, tfoot th { background: #fff5da; }
.summary { display: flex; gap: 50px; flex-wrap: wrap; margin-top: 22px; padding: 22px; border: 1px solid #e1e4eb; border-radius: 12px; background: #fff; }
.summary h3 { margin-top: 0; } .grade-summary { min-width: 300px; border-top: 1px solid #bfc4cc; border-left: 1px solid #bfc4cc; }
.legend { color: #4b5563; align-self: center; } .swatch { display: inline-block; width: 20px; height: 16px; vertical-align: middle; margin-right: 6px; border: 1px solid #a9b2bc; }
.guidance { background: #fff4d2; padding: 16px; line-height: 1.8; } .error { color: #b42318; background: #fff0ee; padding: 12px; }
.patrol-overlay { position: fixed; inset: 0; background: #17203380; display: grid; place-items: center; z-index: 1000; padding: 24px; }
.patrol-dialog { background: white; padding: 24px; border-radius: 14px; width: min(900px, 100%); max-height: 90vh; overflow: auto; }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.wide { grid-column: 1 / -1; } .check { flex-direction: row; align-items: center; } .form-actions { justify-content: flex-end; margin-top: 20px; position: sticky; bottom: -24px; padding: 16px 0; background: white; }
@media (max-width: 700px) { .form-grid { grid-template-columns: 1fr; } .patrol-overlay { padding: 10px; } .filters label { width: 100%; } }
</style>
