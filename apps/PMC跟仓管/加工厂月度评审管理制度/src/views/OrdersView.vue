<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { RouterLink } from 'vue-router'
import AppLayout from '../components/AppLayout.vue'
import { useOrdersStore } from '../stores/orders'
import { useFactoriesStore } from '../stores/factories'
import { useAuthStore } from '../stores/auth'
import { allowedCrafts, canEditOrders, allowedRegions } from '../utils/permissions'
import { CRAFT_LABELS, REGIONS, REGION_LABELS, regionOf, type Craft } from '../constants/roles'
import { buildDeliveryReport, exportDeliveryExcel, type ReportRow } from '../utils/deliveryStats'
import { parseDeliveryExcelFiles } from '../utils/deliveryExcelImport'

const orders = useOrdersStore()
const factories = useFactoriesStore()
const auth = useAuthStore()
const fileInput = ref<HTMLInputElement | null>(null)
const importingExcel = ref(false)

onMounted(() => Promise.all([orders.fetchAll(), factories.fetchAll()]))

const DEPTS: { craft: Craft; name: string; icon: string }[] = [
  { craft: 'injection', name: '注塑部', icon: '🧩' },
  { craft: 'painting', name: '喷油部', icon: '🎨' },
  { craft: 'assembly', name: '装配部', icon: '🔧' },
  { craft: 'sewing', name: '车缝部', icon: '🧵' },
]
const canEdit = computed(() => (auth.role ? canEditOrders(auth.role) : false))
const visibleDepts = computed(() => DEPTS.filter((d) => allowedCrafts().includes(d.craft)))
const myRegions = computed(() => (auth.role ? allowedRegions(auth.role) : REGIONS))
const deptHref = (craft: Craft, region: string) => `/orders/dept/${craft}?region=${region}`
const regionBlocks = computed(() =>
  myRegions.value.map((region) => ({
    region,
    name: REGION_LABELS[region],
    cards: visibleDepts.value.map((d) => {
      const list = orders.items.filter((o) => regionOf(o.expand?.factory) === region && o.expand?.factory?.craft === d.craft)
      return { ...d, count: list.length, ongoing: list.filter((o) => o.status !== 'delivered').length }
    }),
  })),
)

const fname = (o: any) => o.expand?.factory?.name ?? ''
function craftRows(craft: Craft): ReportRow[] {
  return buildDeliveryReport(orders.items.filter((o) => o.expand?.factory?.craft === craft), CRAFT_LABELS[craft], fname)
}
// craft=null 导出全部(各部门拼接);指定部门只导该部门
function exportExcel(craft: Craft | null) {
  if (craft) { exportDeliveryExcel(craftRows(craft), `${CRAFT_LABELS[craft]}外发加工厂交货延期统计表`, craft === 'injection'); return }
  const all = visibleDepts.value.flatMap((d) => craftRows(d.craft))
  exportDeliveryExcel(all, '全部-外发加工厂交货延期统计表')
}
function onExportDept(ev: Event) {
  const sel = ev.target as HTMLSelectElement
  if (sel.value) exportExcel(sel.value as Craft)
  sel.value = ''
}

async function importExcel(ev: Event) {
  const fByName: Record<string, string> = {}
  for (const f of factories.items) fByName[f.name] = f.id
  const files = Array.from((ev.target as HTMLInputElement).files ?? [])
  if (!files.length) return
  importingExcel.value = true
  try {
    const parsed = await parseDeliveryExcelFiles(files, fByName)
    let ok = 0, fail = parsed.failedRows
    const saveErrors: string[] = []
    for (const p of parsed.payloads) {
      try {
        await orders.create({ ...p, created_by: auth.userId ?? undefined } as any)
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
</script>
<template>
  <AppLayout>
    <div class="page">
      <div class="toolbar">
        <h2 style="margin:0">货期管理</h2>
        <span class="muted">共 {{ orders.items.length }} 单 · {{ myRegions.length }} 厂区</span>
        <span class="spacer"></span>
        <button class="ghost" @click="exportExcel(null)">导出全部</button>
        <select class="dept-export" @change="onExportDept">
          <option value="">按部门导出…</option>
          <option v-for="d in visibleDepts" :key="d.craft" :value="d.craft">{{ d.name }}</option>
        </select>
        <button v-if="canEdit" class="ghost" :disabled="importingExcel" @click="fileInput?.click()">
          {{ importingExcel ? '导入中…' : '批量导入 Excel' }}
        </button>
        <input ref="fileInput" type="file" accept=".xlsx,.xls,.csv" multiple style="display:none" @change="importExcel" />
        <RouterLink v-if="canEdit" to="/orders/new"><button>+ 新增下单</button></RouterLink>
      </div>

      <section v-for="b in regionBlocks" :key="b.region" class="region-block">
        <h3 class="region-title">{{ b.name }}厂区</h3>
        <div class="dept-grid">
          <a v-for="c in b.cards" :key="c.craft" class="dept-card" :href="deptHref(c.craft, b.region)">
            <span class="ico">{{ c.icon }}</span>
            <div class="info">
              <span class="name">{{ c.name }}</span>
              <span class="sub">{{ c.count }} 单<span v-if="c.ongoing" class="ongoing"> · {{ c.ongoing }} 单进行中</span></span>
            </div>
            <span class="arrow">→</span>
          </a>
        </div>
      </section>
    </div>
  </AppLayout>
</template>
<style scoped>
.dept-export { height: 34px; padding: 0 .6rem; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); cursor: pointer; }
.region-block { margin-top: 1.5rem; }
.region-title { margin: 0 0 .8rem; font-size: 1.05rem; color: #1f2533; padding-left: .6rem; border-left: 4px solid var(--primary, #4f46e5); }
.dept-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 1rem; }
.dept-card {
  display: flex; align-items: center; gap: 1rem; text-decoration: none; color: var(--text);
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 1.25rem 1.4rem; box-shadow: var(--shadow); transition: all .15s ease;
}
.dept-card:hover {
  border-color: var(--primary-border); transform: translateY(-2px);
  box-shadow: 0 10px 24px -12px rgba(79,70,229,.45); text-decoration: none;
}
.ico { width: 52px; height: 52px; display: grid; place-items: center; font-size: 1.6rem; background: var(--primary-soft); border-radius: 14px; }
.info { display: flex; flex-direction: column; flex: 1; }
.name { font-size: 1.1rem; font-weight: 600; }
.sub { font-size: .85rem; color: var(--text-soft); }
.ongoing { color: var(--grade-b); font-weight: 600; }
.arrow { color: var(--text-faint); font-size: 1.2rem; }
</style>
