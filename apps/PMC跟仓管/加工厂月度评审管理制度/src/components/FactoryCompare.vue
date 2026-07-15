<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import XLSX from 'xlsx-js-style'
import { pb } from '../pb'
import { useFactoriesStore } from '../stores/factories'
import { CRAFT_LABELS, type Craft } from '../constants/roles'
import { computeFactoryStats, computeSiteStats, type FactoryStats, type SiteStats } from '../utils/factoryStats'
import type { Factory } from '../types/factory'
import type { Order } from '../types/order'

const store = useFactoriesStore()

const selectedIds = ref<string[]>([])
const kw = ref('')
const open = ref(false)
const loading = ref(false)

type Cell = { factory: Partial<Factory>; stats: FactoryStats; site: SiteStats; grade: string }
const data = ref<Record<string, Cell>>({})

onMounted(() => { if (!store.items.length) store.fetchAll() })

const nameOf = (id: string) => store.items.find((f) => f.id === id)?.name ?? id
const deptOf = (f: Factory) => (f.craft ? CRAFT_LABELS[f.craft as Craft] : '')

// 工厂简称：去掉省/市前缀、括号，截到行业/公司类型词之前。如「东莞市华盛源塑料制品有限公司」→「华盛源」
const BRAND_STOP = ['塑料', '塑胶', '电子', '科技', '五金', '金属', '喷涂', '喷油', '表面', '处理', '装配', '车缝', '缝纫', '玩具', '布艺', '模具', '制品', '实业', '工业', '精密', '机械', '包装', '印刷', '硅胶', '橡胶', '纸品', '加工', '有限', '责任', '股份', '集团', '公司', '厂']
function shortName(full: string): string {
  let s = (full || '').replace(/\s/g, '')
  s = s.replace(/^[一-龥]{2,3}省/, '').replace(/^[一-龥]{2,4}市/, '').replace(/[（）()]/g, '')
  let cut = s.length
  for (const k of BRAND_STOP) { const i = s.indexOf(k); if (i > 0 && i < cut) cut = i }
  return s.slice(0, cut) || s.slice(0, 4) || (full || '-')
}
// 地址只取到市级；无市级取到镇级；都没有则原文
function cityOf(addr?: string): string {
  const t = (addr || '').replace(/\s/g, '').replace(/^[一-龥]{2,3}省/, '')
  const mi = t.indexOf('市')
  if (mi >= 0) return t.slice(0, mi + 1)
  const zi = t.indexOf('镇')
  if (zi >= 0) return t.slice(0, zi + 1)
  return t || '-'
}

const filtered = computed(() => {
  const q = kw.value.trim().toLowerCase()
  return store.items
    .filter((f) => !selectedIds.value.includes(f.id))
    .filter((f) => !q || (f.name ?? '').toLowerCase().includes(q) || (f.contact_person ?? '').toLowerCase().includes(q))
    .slice(0, 30)
})

function add(id: string) {
  if (!selectedIds.value.includes(id)) selectedIds.value = [...selectedIds.value, id]
  kw.value = ''
  open.value = false
}
function remove(id: string) {
  selectedIds.value = selectedIds.value.filter((x) => x !== id)
}
function blurClose() {
  setTimeout(() => (open.value = false), 150)
}

watch(selectedIds, async (ids) => {
  if (!ids.length) { data.value = {}; return }
  loading.value = true
  const flt = ids.map((id) => `factory = "${id}"`).join(' || ')
  const [os, qis, checks, scs] = await Promise.all([
    pb.collection('orders').getFullList<Order>({ filter: flt }),
    pb.collection('quality_inspections').getFullList({ filter: flt }),
    pb.collection('quality_5s_checks').getFullList({ filter: flt, sort: '-check_date' }),
    pb.collection('monthly_scores').getFullList({ filter: flt, sort: '-year_month' }),
  ])
  const next: Record<string, Cell> = {}
  for (const id of ids) {
    next[id] = {
      factory: store.items.find((f) => f.id === id) ?? {},
      stats: computeFactoryStats(os.filter((o) => o.factory === id), (qis as any[]).filter((q) => q.factory === id)),
      site: computeSiteStats((checks as any[]).filter((c) => c.factory === id)),
      grade: (scs as any[]).filter((s) => s.factory === id).find((s) => s.grade)?.grade ?? '',
    }
  }
  data.value = next
  loading.value = false
})

// —— 指标定义（hl：min=越小越优 / max=越大越优 / grade=A 最优 / null=不评优）——
type Row = { label: string; get: (c: Cell) => number | string; hl: 'min' | 'max' | 'grade' | null }
const groups: { title: string; color: string; rows: Row[] }[] = [
  { title: '基础信息', color: '#2563eb', rows: [
    { label: '部门', get: (c) => (c.factory.craft ? CRAFT_LABELS[c.factory.craft as Craft] : '-'), hl: null },
    { label: '联系人', get: (c) => c.factory.contact_person || '-', hl: null },
    { label: '电话', get: (c) => c.factory.contact_phone || '-', hl: null },
    { label: '地址', get: (c) => cityOf(c.factory.address), hl: null },
    { label: '设备台数/生产拉线', get: (c) => c.factory.equipment_qty ?? '-', hl: null },
    { label: '帮我们生产的机台/生产线', get: (c) => c.factory.production_lines || '-', hl: null },
    { label: '员工人数', get: (c) => c.factory.staff_count ?? '-', hl: null },
    { label: '月产能', get: (c) => c.factory.monthly_capacity ?? '-', hl: null },
    { label: '加工类型', get: (c) => c.factory.processable_types || '-', hl: null },
    { label: '厂房面积(㎡)', get: (c) => c.factory.workshop_area ?? '-', hl: null },
    { label: '合作车间', get: (c) => c.factory.cooperative_workshops || '-', hl: null },
  ] },
  { title: '综合', color: '#6b7280', rows: [
    { label: '工厂评级', get: (c) => c.grade || '-', hl: 'grade' },
  ] },
  { title: '价格', color: '#4f46e5', rows: [
    { label: '核价总金额', get: (c) => c.stats.quoteAmount, hl: null },
    { label: '外发总金额', get: (c) => c.stats.outAmount, hl: null },
    { label: '占比', get: (c) => c.stats.amountRatio, hl: 'min' },
  ] },
  { title: '交期', color: '#d97706', rows: [
    { label: '订单总单数', get: (c) => c.stats.orderCount, hl: null },
    { label: '延期单数', get: (c) => c.stats.delayedCount, hl: 'min' },
    { label: '占比', get: (c) => c.stats.delayRatio, hl: 'min' },
    { label: '延期平均天数', get: (c) => c.stats.delayDaysAvg, hl: 'min' },
  ] },
  { title: '品质', color: '#0d9488', rows: [
    { label: '验货总单数', get: (c) => c.stats.intInspect, hl: null },
    { label: '合格单数', get: (c) => c.stats.intPass, hl: null },
    { label: '合格率', get: (c) => c.stats.intRate, hl: 'max' },
  ] },
  { title: '现场管理', color: '#16a34a', rows: [
    { label: '现场得分', get: (c) => c.site.siteScore, hl: 'max' },
    { label: '折算总达成率', get: (c) => c.site.finalRate, hl: 'max' },
  ] },
]

const GRADE_RANK: Record<string, number> = { A: 4, B: 3, C: 2, D: 1 }
function toNum(v: number | string): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v).trim()
  if (s === '' || s === '-') return null
  const m = s.replace(/[^0-9.-]/g, '')
  const n = parseFloat(m)
  return Number.isNaN(n) ? null : n
}
function display(row: Row, id: string): string {
  const c = data.value[id]
  if (!c) return '…'
  const v = row.get(c)
  return v === '' ? '-' : String(v)
}
function isBest(row: Row, id: string): boolean {
  const ids = selectedIds.value
  if (ids.length < 2 || !row.hl) return false
  const cells = ids.map((i) => data.value[i]).filter(Boolean)
  if (cells.length < 2) return false
  if (row.hl === 'grade') {
    const ranks = ids.map((i) => GRADE_RANK[data.value[i]?.grade ?? ''] ?? null).filter((x): x is number => x != null)
    if (ranks.length < 2) return false
    const best = Math.max(...ranks)
    if (Math.min(...ranks) === best) return false
    const mine = GRADE_RANK[data.value[id]?.grade ?? ''] ?? null
    return mine === best
  }
  const nums = ids.map((i) => (data.value[i] ? toNum(row.get(data.value[i])) : null)).filter((x): x is number => x != null)
  if (nums.length < 2) return false
  const best = row.hl === 'min' ? Math.min(...nums) : Math.max(...nums)
  if (Math.min(...nums) === Math.max(...nums)) return false
  const mine = data.value[id] ? toNum(row.get(data.value[id])) : null
  return mine != null && mine === best
}

// 导出对比表 Excel（版式与画面一致：指标列 + 各工厂列，分组标题整行合并，最优值绿底标注）
function exportExcel() {
  const ids = selectedIds.value
  if (!ids.length) return
  const header = ['指标', ...ids.map(nameOf)]
  const aoa: any[][] = [header]
  type Meta = { type: 'header' } | { type: 'group'; color: string } | { type: 'metric'; row: Row }
  const meta: Meta[] = [{ type: 'header' }]
  const merges: any[] = []
  for (const g of groups) {
    const r = aoa.length
    aoa.push([g.title, ...ids.map(() => '')])
    merges.push({ s: { r, c: 0 }, e: { r, c: ids.length } })
    meta.push({ type: 'group', color: g.color })
    for (const row of g.rows) {
      aoa.push([row.label, ...ids.map((id) => {
        const c = data.value[id]
        if (!c) return '-'
        const v = row.get(c)
        return v === '' ? '-' : v
      })])
      meta.push({ type: 'metric', row })
    }
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!merges'] = merges
  const cw = (v: any) => { let w = 0; for (const ch of String(v ?? '')) w += /[⺀-￿]/.test(ch) ? 2 : 1; return w }
  ws['!cols'] = header.map((_, ci) => {
    let max = 6
    for (const r of aoa) max = Math.max(max, cw(r[ci]))
    return { wch: Math.min(max + 2, 40) }
  })

  const B = { style: 'thin', color: { rgb: 'E5E7EB' } }
  const border = { top: B, bottom: B, left: B, right: B }
  const hex = (c: string) => c.replace('#', '').toUpperCase()
  for (let r = 0; r < aoa.length; r++) {
    const m = meta[r]
    for (let c = 0; c < header.length; c++) {
      const ref = XLSX.utils.encode_cell({ r, c })
      const cell = ws[ref] || (ws[ref] = { t: 's', v: '' })
      const s: any = { border, alignment: { vertical: 'center', horizontal: c === 0 ? 'left' : 'center', wrapText: true } }
      if (m.type === 'header') {
        s.font = { bold: true, color: { rgb: '1F2533' } }
        s.fill = { patternType: 'solid', fgColor: { rgb: 'FAFBFF' } }
      } else if (m.type === 'group') {
        s.font = { bold: true, color: { rgb: hex(m.color) } }
        s.fill = { patternType: 'solid', fgColor: { rgb: 'F4F6FF' } }
      } else if (c === 0) {
        s.font = { color: { rgb: '1F2533' } }
        s.fill = { patternType: 'solid', fgColor: { rgb: 'FAFBFF' } }
      } else if (isBest(m.row, ids[c - 1])) {
        s.font = { bold: true, color: { rgb: '16A34A' } }
        s.fill = { patternType: 'solid', fgColor: { rgb: 'E8F7EE' } }
      }
      cell.s = s
    }
  }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '工厂对比')
  XLSX.writeFile(wb, '工厂对比表.xlsx')
}
</script>

<template>
  <section class="cmp">
    <div class="cmp-head">
      <h3 class="panel-title">工厂对比 <small>任意选择多家工厂，对比价格/交期/品质/现场管理</small></h3>
      <button v-if="selectedIds.length" @click="exportExcel">导出 Excel</button>
    </div>

    <!-- 选择器 -->
    <div class="picker">
      <span v-for="id in selectedIds" :key="id" class="chip">
        {{ nameOf(id) }}<button type="button" class="x" @click="remove(id)">×</button>
      </span>
      <div class="ic-wrap">
        <input class="kw" v-model="kw" placeholder="搜索并添加工厂…"
          @focus="open = true" @click="open = true" @input="open = true" @blur="blurClose" />
        <ul v-if="open && filtered.length" class="dropdown">
          <li v-for="f in filtered" :key="f.id" @mousedown.prevent="add(f.id)">
            <span>{{ f.name }}</span><small>{{ deptOf(f) }}</small>
          </li>
        </ul>
      </div>
    </div>

    <!-- 对比表 -->
    <div v-if="selectedIds.length" class="scroll">
      <table class="cmp-tbl">
        <thead>
          <tr>
            <th class="corner">指标</th>
            <th v-for="id in selectedIds" :key="id" :title="nameOf(id)">{{ shortName(nameOf(id)) }}</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="g in groups" :key="g.title">
            <tr class="grp"><td :colspan="selectedIds.length + 1"><span :style="{ color: g.color }">{{ g.title }}</span></td></tr>
            <tr v-for="row in g.rows" :key="g.title + row.label">
              <td class="rlabel">{{ row.label }}</td>
              <td v-for="id in selectedIds" :key="id" :class="{ best: isBest(row, id) }">{{ display(row, id) }}</td>
            </tr>
          </template>
        </tbody>
      </table>
      <p class="legend"><span class="dot"></span>绿色 = 该项最优</p>
    </div>
    <p v-else class="empty">搜索并选择工厂开始对比（可多选）。</p>
  </section>
</template>

<style scoped>
.cmp { background: #fff; border: 1px solid #eef0f4; border-radius: 14px; padding: 1.25rem 1.4rem; box-shadow: 0 1px 3px rgba(0,0,0,.04); }
.cmp-head { display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin-bottom: 1rem; }
.panel-title { margin: 0; font-size: 1rem; color: #1f2533; }
.panel-title small { font-weight: 400; color: #9aa1ad; font-size: .8rem; margin-left: .5rem; }

.picker { display: flex; flex-wrap: wrap; align-items: center; gap: .45rem; border: 1px solid var(--border); border-radius: 10px; padding: .45rem .55rem; }
.chip { display: inline-flex; align-items: center; gap: .3rem; background: #eef0ff; color: #4f46e5; font-size: .85rem; padding: .2rem .25rem .2rem .6rem; border-radius: 999px; }
.chip .x { border: 0; background: transparent; color: #6b7280; cursor: pointer; font-size: 1rem; line-height: 1; padding: 0 .2rem; }
.chip .x:hover { color: #dc2626; }
.ic-wrap { position: relative; flex: 1; min-width: 180px; }
.kw { width: 100%; border: 0; outline: none; padding: .3rem .2rem; font-size: .9rem; background: transparent; }
.dropdown { position: absolute; z-index: 20; top: 110%; left: 0; right: 0; max-height: 260px; overflow-y: auto; margin: 0; padding: .3rem; list-style: none; background: #fff; border: 1px solid var(--border); border-radius: 10px; box-shadow: 0 12px 28px -12px rgba(0,0,0,.25); }
.dropdown li { display: flex; justify-content: space-between; align-items: center; gap: 1rem; padding: .5rem .6rem; border-radius: 8px; cursor: pointer; font-size: .9rem; }
.dropdown li:hover { background: #f5f7ff; }
.dropdown li small { color: #9aa1ad; font-size: .78rem; }

.scroll { overflow-x: auto; margin-top: 1rem; }
.cmp-tbl { border-collapse: collapse; width: 100%; min-width: 420px; }
.cmp-tbl th, .cmp-tbl td { border: 1px solid #eef0f4; padding: .5rem .8rem; font-size: .88rem; text-align: center; white-space: nowrap; }
.cmp-tbl thead th { background: #fafbff; font-weight: 600; color: #1f2533; position: sticky; top: 0; }
.cmp-tbl th.corner, .cmp-tbl td.rlabel { text-align: left; color: #1f2533; }
.cmp-tbl td.rlabel { background: #fafbff; font-weight: 500; padding-left: 2rem; }
.cmp-tbl tr.grp td { text-align: left; font-weight: 700; background: #f4f6ff; padding-left: .5rem; }
.cmp-tbl td.best { background: #e8f7ee; color: #16a34a; font-weight: 700; }
.legend { margin: .6rem 0 0; font-size: .8rem; color: #9aa1ad; display: flex; align-items: center; gap: .4rem; }
.legend .dot { width: 12px; height: 12px; border-radius: 3px; background: #e8f7ee; border: 1px solid #16a34a; display: inline-block; }
.empty { color: #9aa1ad; font-size: .9rem; margin: 1rem 0 0; }
</style>
