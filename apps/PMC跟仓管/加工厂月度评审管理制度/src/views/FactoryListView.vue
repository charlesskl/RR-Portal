<script setup lang="ts">
import { onMounted, computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import * as XLSX from 'xlsx'
import AppLayout from '../components/AppLayout.vue'
import { useFactoriesStore, filterByCraft } from '../stores/factories'
import { useAuthStore } from '../stores/auth'
import { allowedCrafts, canEditFactories, allowedRegions } from '../utils/permissions'
import { CRAFT_LABELS, REGIONS, REGION_LABELS, regionOf, type Craft, type Region } from '../constants/roles'
import type { Factory } from '../types/factory'

const store = useFactoriesStore()
const auth = useAuthStore()
const fileInput = ref<HTMLInputElement | null>(null)
// 导出筛选：厂区 + 部门 可组合（都留空=导出全部）
const exportRegion = ref<Region | ''>('')
const exportCraft = ref<Craft | ''>('')

onMounted(() => store.fetchAll())

// 部门名 → craft（同时接受「注塑部」「注塑」两种写法）
const DEPT_TO_CRAFT: Record<string, Craft> = {}
for (const [craft, label] of Object.entries(CRAFT_LABELS)) {
  DEPT_TO_CRAFT[label] = craft as Craft
  DEPT_TO_CRAFT[label.replace('部', '')] = craft as Craft
}

// craft=null 且 region=null 导出全部；指定 craft 仅导该部门；指定 region 仅导该厂区。
// 文件名贴近模板「{部门/厂区}-外发加工厂信息.xlsx」
function exportExcel(craft: Craft | null = null, region: Region | null = null) {
  let list = visible.value
  if (craft) list = list.filter((f) => f.craft === craft)
  if (region) list = list.filter((f) => regionOf(f) === region)
  // 表头与「喷油-外发加工厂信息」模板完全一致(顺序固定)
  const headers = ['序号', '名称', '部门', '联系人', '联系电话', '地址', '设备台数/生产拉线', '帮我们生产的机台/生产线', '员工人数', '月产能', '加工类型', '环评/消防/安监资质', '合作车间', 'IP管控']
  const row = (f: Factory, i: number) => ({
    序号: i + 1,
    名称: f.name,
    部门: CRAFT_LABELS[f.craft],
    联系人: f.contact_person ?? '',
    联系电话: f.contact_phone ?? '',
    地址: f.address ?? '',
    '设备台数/生产拉线': f.equipment_qty ?? '',
    '帮我们生产的机台/生产线': f.production_lines ?? '',
    员工人数: f.staff_count ?? '',
    月产能: f.monthly_capacity ?? '',
    加工类型: f.processable_types ?? '',
    '环评/消防/安监资质': f.cert_status ?? '',
    合作车间: f.cooperative_workshops ?? '',
    IP管控: f.ip_control ?? '',
  })
  const data = list.length
    ? list.map(row)
    : [Object.fromEntries(headers.map((h) => [h, ''])) as Record<string, any>]
  const ws = XLSX.utils.json_to_sheet(data, { header: headers })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '工厂信息')
  const parts: string[] = []
  if (region) parts.push(REGION_LABELS[region])
  if (craft) parts.push(CRAFT_LABELS[craft].replace('部', ''))
  const prefix = parts.length ? parts.join('-') : '全部'
  XLSX.writeFile(wb, `${prefix}-外发加工厂信息.xlsx`)
}

async function importExcel(ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0]
  if (!file) return
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { cellDates: true })
  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets[wb.SheetNames[0]])
  let ok = 0, fail = 0
  for (const r of rows) {
    // 表头容错：去掉所有空白(含换行)，并支持多种别名写法
    const norm = (s: string) => s.replace(/\s+/g, '')
    const cells: Record<string, any> = {}
    for (const k of Object.keys(r)) cells[norm(k)] = r[k]
    const pick = (...aliases: string[]) => {
      for (const a of aliases) {
        const v = cells[norm(a)]
        if (v != null && String(v).trim() !== '') return v
      }
      return undefined
    }
    const setNum = (fd: FormData, key: string, ...aliases: string[]) => {
      const v = pick(...aliases)
      if (v != null && String(v).trim() !== '') fd.append(key, String(v).trim())
    }

    const name = String(pick('名称', '工厂名称', 'name') ?? '').trim()
    const deptRaw = String(pick('部门', '工艺') ?? '').trim()
    const craft = DEPT_TO_CRAFT[deptRaw]
    if (!name || !craft) { fail++; continue }
    const fd = new FormData()
    fd.append('name', name)
    fd.append('craft', craft)
    fd.append('contact_person', String(pick('联系人') ?? ''))
    fd.append('contact_phone', String(pick('电话', '联系电话') ?? ''))
    fd.append('address', String(pick('地址') ?? ''))
    fd.append('processable_types', String(pick('加工类型', '可加工类型') ?? ''))
    fd.append('cooperative_workshops', String(pick('合作车间') ?? ''))
    fd.append('ip_control', String(pick('IP管控', 'IP管控情况') ?? ''))
    fd.append('production_lines', String(pick('帮我们生产的机台/生产线', '帮我们生产的几台/生产线', '帮我们生产的设备/生产线') ?? ''))
    setNum(fd, 'workshop_area', '厂房面积(㎡)', '厂房面积')
    setNum(fd, 'staff_count', '员工人数', '人员', '人员(人)')
    setNum(fd, 'monthly_capacity', '月产能')
    setNum(fd, 'annual_revenue', '年生意额(万)', '年生意额')
    // 设备(类型×数量)：解析 "注塑机×3，喷涂线×2"
    const equipRaw = String(pick('设备(类型×数量)', '设备类型') ?? '').trim()
    if (equipRaw) {
      const list = equipRaw.split(/[，,]/).map((s) => s.trim()).filter(Boolean).map((seg) => {
        const m = seg.split(/[×x*]/)
        return { type: m[0].trim(), qty: m[1] ? Number(m[1]) : null }
      })
      fd.append('equipment_list', JSON.stringify(list))
      fd.append('equipment_type', list.map((e) => e.type).join(','))
    }
    // 设备台数/生产拉线 总数量：优先用该列，留空则按上面明细自动合计
    const qtyRaw = pick('设备台数/生产拉线', '设备台数', '设备数量')
    if (qtyRaw != null && String(qtyRaw).trim() !== '') {
      fd.append('equipment_qty', String(qtyRaw).trim())
    } else if (equipRaw) {
      const sum = equipRaw.split(/[，,]/).reduce((s, seg) => s + (Number(seg.split(/[×x*]/)[1]) || 0), 0)
      if (sum) fd.append('equipment_qty', String(sum))
    }
    // 资质：直接存原文本（如「有效期内」「有效期至2026-12」）
    const certs = String(pick('环评/消防/安监资质', '环评/消防/安监', '资质') ?? '').trim()
    if (certs) fd.append('cert_status', certs)
    fd.append('status', 'active')
    if (auth.userId) fd.append('created_by', auth.userId)
    // 注：厂房图片/证书为文件，无法从 Excel 单元格导入，请在工厂详情页单独上传
    try { await store.create(fd); ok++ } catch { fail++ }
  }
  await store.fetchAll()
  if (fileInput.value) fileInput.value.value = ''
  alert(`导入完成：成功 ${ok} 家` + (fail ? `，失败 ${fail} 家（缺名称或部门无法识别）` : '') + '\n（厂房图片/证书为文件，需在工厂详情页单独上传）')
}

const visible = computed(() => {
  const allowed = allowedCrafts()
  const byCraft = filterByCraft(store.items, null).filter((f) => allowed.includes(f.craft))
  const regs = auth.role ? allowedRegions(auth.role) : REGIONS
  return byCraft.filter((f) => regs.includes(regionOf(f)))
})
// 部门定义（底层值仍是 craft）
const DEPTS: { craft: Craft; name: string; icon: string }[] = [
  { craft: 'injection', name: '注塑部', icon: '🧩' },
  { craft: 'painting', name: '喷油部', icon: '🎨' },
  { craft: 'assembly', name: '装配部', icon: '🔧' },
  { craft: 'sewing', name: '车缝部', icon: '🧵' },
]
// 按厂区分块；每个厂区固定展示 4 个部门卡（含厂区，便于进入后新增）
const myRegions = computed(() => (auth.role ? allowedRegions(auth.role) : REGIONS))
const regionBlocks = computed(() =>
  myRegions.value.map((region) => ({
    region,
    name: REGION_LABELS[region],
    cards: DEPTS.filter((d) => allowedCrafts().includes(d.craft)).map((d) => {
      const list = visible.value.filter((f: Factory) => regionOf(f) === region && f.craft === d.craft)
      return {
        ...d,
        count: list.length,
        warn: list.filter((f) => f.status === 'limited' || f.status === 'suspended' || f.status === 'eliminated').length,
      }
    }),
  })),
)
</script>
<template>
  <AppLayout>
    <div class="page">
      <div class="toolbar">
        <h2 style="margin:0">工厂信息管理</h2>
        <span class="muted">共 {{ visible.length }} 家 · {{ myRegions.length }} 厂区</span>
        <span class="spacer"></span>
        <select v-model="exportRegion" class="ghost dept-export">
          <option value="">全部厂区</option>
          <option v-for="rg in myRegions" :key="rg" :value="rg">{{ REGION_LABELS[rg] }}厂区</option>
        </select>
        <select v-model="exportCraft" class="ghost dept-export">
          <option value="">全部部门</option>
          <option v-for="d in DEPTS" :key="d.craft" :value="d.craft">{{ d.name }}</option>
        </select>
        <button class="ghost" @click="exportExcel(exportCraft || null, exportRegion || null)">导出 Excel</button>
        <button v-if="auth.role && canEditFactories(auth.role)" class="ghost" @click="fileInput?.click()">导入 Excel</button>
        <input ref="fileInput" type="file" accept=".xlsx,.xls,.csv" style="display:none" @change="importExcel" />
        <RouterLink v-if="auth.role && canEditFactories(auth.role)" to="/factories/new"><button>+ 新增工厂</button></RouterLink>
      </div>

      <section v-for="b in regionBlocks" :key="b.region" class="region-block">
        <h3 class="region-title">{{ b.name }}厂区</h3>
        <div class="dept-grid">
          <RouterLink v-for="c in b.cards" :key="c.craft" class="dept-card" :to="`/factories/dept/${c.craft}?region=${b.region}`">
            <span class="ico">{{ c.icon }}</span>
            <div class="info">
              <span class="name">{{ c.name }}</span>
              <span class="sub">{{ c.count }} 家工厂<span v-if="c.warn" class="warn"> · {{ c.warn }} 家预警</span></span>
            </div>
            <span class="arrow">→</span>
          </RouterLink>
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
.warn { color: var(--grade-c); font-weight: 600; }
.arrow { color: var(--text-faint); font-size: 1.2rem; }
</style>
