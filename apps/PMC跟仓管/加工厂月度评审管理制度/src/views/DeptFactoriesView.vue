<script setup lang="ts">
import { onMounted, computed, ref } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import * as XLSX from 'xlsx'
import AppLayout from '../components/AppLayout.vue'
import { useFactoriesStore } from '../stores/factories'
import { useAuthStore } from '../stores/auth'
import { CRAFT_LABELS, REGION_LABELS, regionOf, type Craft, type Region } from '../constants/roles'
import { canEditFactories, allowedRegions } from '../utils/permissions'
import type { Factory } from '../types/factory'
import { resolveFactoryName } from '../utils/factoryName'
import { taxPointRate } from '../utils/taxPoint'

const route = useRoute()
const store = useFactoriesStore()
const auth = useAuthStore()
const fileInput = ref<HTMLInputElement | null>(null)
const craft = computed(() => route.params.craft as Craft)
const region = computed(() => (route.query.region as Region) || null)
const title = computed(() =>
  (region.value ? REGION_LABELS[region.value] + '厂区 · ' : '') + (CRAFT_LABELS[craft.value] ?? '部门'))
const newLink = computed(() => `/factories/new?craft=${craft.value}` + (region.value ? `&region=${region.value}` : ''))
const canDelete = computed(() => auth.role === 'admin')

onMounted(() => store.fetchAll())

const myRegions = computed(() => (auth.role ? allowedRegions(auth.role) : null))
const list = computed(() =>
  store.items.filter((f: Factory) =>
    f.craft === craft.value
    && (!region.value || regionOf(f) === region.value)
    && (!myRegions.value || myRegions.value.includes(regionOf(f)))))
const statusLabel: Record<string, string> = {
  active: '正常', limited: '限单', suspended: '暂停', eliminated: '淘汰',
}

// 在本部门界面导入：所有导入的工厂自动归到当前厂区+部门（只需「名称」即可）
async function importExcel(ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0]
  if (!file) return
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { cellDates: true })
  const norm = (s: string) => s.replace(/\s+/g, '')
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const matrix = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: '' })
  const headerRow = matrix.findIndex((row) => row.some((cell) =>
    ['名称', '工厂名称', '加工厂名称'].includes(norm(String(cell ?? '')))))
  if (headerRow < 0) {
    alert('导入失败：未识别到“加工厂名称”表头')
    if (fileInput.value) fileInput.value.value = ''
    return
  }
  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { range: headerRow, defval: '' })
  let created = 0, updated = 0, fail = 0
  const candidates = store.items.filter((factory) =>
    factory.craft === craft.value && regionOf(factory) === (region.value || 'dongguan'))
  for (const r of rows) {
    const cells: Record<string, any> = {}
    for (const k of Object.keys(r)) cells[norm(k)] = r[k]
    const pick = (...al: string[]) => {
      for (const a of al) { const v = cells[norm(a)]; if (v != null && String(v).trim() !== '') return v }
      return undefined
    }
    const setNum = (fd: FormData, key: string, ...al: string[]) => {
      const v = pick(...al); if (v != null && String(v).trim() !== '') fd.append(key, String(v).trim())
    }
    const setText = (fd: FormData, key: string, ...al: string[]) => {
      const v = pick(...al); if (v != null) fd.append(key, String(v).trim())
    }
    const name = String(pick('名称', '工厂名称', '加工厂名称', 'name') ?? '').trim()
    if (!name) { fail++; continue }
    const fd = new FormData()
    fd.append('name', name)
    fd.append('craft', craft.value)
    fd.append('region', region.value || 'dongguan')
    setText(fd, 'contact_person', '联系人')
    setText(fd, 'contact_phone', '电话', '联系电话')
    setText(fd, 'address', '地址', '工厂地址')
    setText(fd, 'processable_types', '加工类型', '可加工类型')
    setText(fd, 'cooperative_workshops', '合作车间')
    setText(fd, 'ip_control', 'IP管控', 'IP管控情况')
    setText(fd, 'production_lines', '帮我们生产的机台/生产线', '帮我们生产的几台/生产线')
    setText(fd, 'cooperation_period', '同我们工厂合作年限', '合作年限')
    setNum(fd, 'workshop_area', '厂房面积(㎡)', '厂房面积')
    setNum(fd, 'staff_count', '员工人数', '人员')
    setNum(fd, 'monthly_capacity', '月产能')
    setNum(fd, 'equipment_qty', '设备台数/生产拉线', '设备台数', '设备数量')
    if (craft.value === 'sewing') {
      const taxPoint = taxPointRate(pick('税点'))
      if (taxPoint != null) fd.append('tax_point', String(taxPoint))
    }
    const certs = String(pick('环评/消防/安监资质', '环评/消防/安监', '资质') ?? '').trim()
    if (certs) fd.append('cert_status', certs)
    try {
      const resolved = resolveFactoryName(candidates, name)
      if (resolved.status === 'matched') {
        await store.update(resolved.id, fd)
        updated++
      } else if (resolved.status === 'ambiguous') {
        fail++
      } else {
        fd.append('status', 'active')
        if (auth.userId) fd.append('created_by', auth.userId)
        const added = await store.create(fd)
        candidates.push(added)
        created++
      }
    } catch { fail++ }
  }
  await store.fetchAll()
  if (fileInput.value) fileInput.value.value = ''
  alert(`导入完成：更新 ${updated} 家，新增 ${created} 家` + (fail ? `，失败 ${fail} 家（缺名称或名称不唯一）` : '') + `\n（已自动归到「${title.value}」；厂房图片/证书需在详情页单独上传）`)
}

async function remove(f: Factory) {
  if (!confirm(`确定删除工厂「${f.name}」？此操作不可恢复。`)) return
  try {
    await store.remove(f.id)
    await store.fetchAll()
  } catch (e: any) {
    alert('删除失败：' + (e?.message ?? ''))
  }
}
</script>
<template>
  <AppLayout>
    <div class="page">
      <div class="toolbar">
        <RouterLink to="/factories" class="back">← 厂区/部门</RouterLink>
        <h2 style="margin:0">{{ title }}</h2>
        <span class="muted">共 {{ list.length }} 家</span>
        <span class="spacer"></span>
        <template v-if="auth.role && canEditFactories(auth.role)">
          <button class="ghost" @click="fileInput?.click()">导入 Excel</button>
          <input ref="fileInput" type="file" accept=".xlsx,.xls,.csv" style="display:none" @change="importExcel" />
          <RouterLink :to="newLink"><button>+ 新增工厂</button></RouterLink>
        </template>
      </div>
      <table>
        <thead><tr><th>名称</th><th>联系人</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="f in list" :key="f.id">
            <td><RouterLink class="name-link" :to="`/factories/${f.id}`" title="查看工厂详情">{{ f.name }}</RouterLink></td>
            <td>{{ f.contact_person || '-' }}</td>
            <td><span class="badge" :class="'status-' + f.status">{{ statusLabel[f.status] }}</span></td>
            <td>
              <div class="ops">
                <RouterLink :to="`/factories/${f.id}`"><button class="ghost mini">编辑</button></RouterLink>
                <button v-if="canDelete" class="mini danger" @click="remove(f)">删除</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!list.length" class="hint">该部门暂无工厂</p>
    </div>
  </AppLayout>
</template>
<style scoped>
.back { font-size: .9rem; }
.name-link { color: var(--primary, #4f46e5); font-weight: 500; text-decoration: none; }
.name-link:hover { text-decoration: underline; }
.ops { display: flex; gap: .5rem; }
.mini { padding: .3rem .7rem; font-size: .82rem; }
.danger { background: var(--grade-d); border-color: var(--grade-d); }
.danger:hover { filter: brightness(1.07); }
</style>
