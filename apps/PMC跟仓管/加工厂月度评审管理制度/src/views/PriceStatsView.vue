<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import * as XLSX from 'xlsx'
import AppLayout from '../components/AppLayout.vue'
import { useOrdersStore } from '../stores/orders'
import { CRAFT_LABELS, REGION_LABELS, regionOf, type Craft, type Region } from '../constants/roles'
import { allowedRegions } from '../utils/permissions'
import { useAuthStore } from '../stores/auth'
import { buildPriceStatsRows, type PriceStatsRow } from '../utils/priceStats'

const route = useRoute()
const orders = useOrdersStore()
const auth = useAuthStore()
const myRegions = computed(() => (auth.role ? allowedRegions(auth.role) : null))

const craft = computed(() => route.params.craft as Craft)
const region = computed(() => (route.query.region as Region) || null)
const deptName = computed(() =>
  (region.value ? REGION_LABELS[region.value] + '厂区 · ' : '') + (CRAFT_LABELS[craft.value] ?? '部门'))

onMounted(() => orders.fetchAll())

const rows = computed<PriceStatsRow[]>(() => {
  const list = orders.items.filter((o) =>
    o.expand?.factory?.craft === craft.value
    && (!region.value || regionOf(o.expand?.factory) === region.value)
    && (!myRegions.value || myRegions.value.includes(regionOf(o.expand?.factory))))
  return buildPriceStatsRows(list, (o) => o.expand?.factory?.name ?? '')
})

const pct = (v: number | null) => (v == null ? '-' : v + '%')
const num = (v: number | null) => (v == null ? '-' : v)

function exportExcel() {
  const title = `${deptName.value}-外发产品单价统计表`
  // 三行表头
  const titleRow = [title, '', '', '', '', '', '', '', '', '']
  const groupRow = ['车间', '加工厂名称', '加工类别', '货号', '配件名称/模号', '价格管理', '', '', '', '备注']
  const subRow = ['', '', '', '', '', '核价生产工价$', '外发单价$', '扣税点1.13后单价$', '占比', '']
  const body = rows.value.map((r) => [
    r.workshopSpan ? r.workshop : '',
    r.factorySpan ? r.factory : '',
    r.categorySpan ? r.category : '',
    r.item_no,
    r.product,
    r.quote_labor_price ?? '',
    r.unit_price ?? '',
    r.after_tax ?? '',
    r.ratio_pct == null ? '' : r.ratio_pct + '%',
    r.notes,
  ])
  const aoa = [titleRow, groupRow, subRow, ...body]
  const ws = XLSX.utils.aoa_to_sheet(aoa)

  // 合并：标题、表头分组、左侧三列纵向合并
  const merges = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 9 } },           // 标题横跨
    { s: { r: 1, c: 5 }, e: { r: 1, c: 8 } },           // 价格管理 横跨 4 列
  ]
  // 表头第 1、2 行：车间/加工厂/加工类别/货号/配件名称/备注 纵向合并
  for (const c of [0, 1, 2, 3, 4, 9]) merges.push({ s: { r: 1, c }, e: { r: 2, c } })
  // 数据区 车间/加工厂/加工类别 纵向合并（数据从第 3 行开始）
  rows.value.forEach((r, i) => {
    const rr = 3 + i
    if (r.workshopSpan > 1) merges.push({ s: { r: rr, c: 0 }, e: { r: rr + r.workshopSpan - 1, c: 0 } })
    if (r.factorySpan > 1) merges.push({ s: { r: rr, c: 1 }, e: { r: rr + r.factorySpan - 1, c: 1 } })
    if (r.categorySpan > 1) merges.push({ s: { r: rr, c: 2 }, e: { r: rr + r.categorySpan - 1, c: 2 } })
  })
  ws['!merges'] = merges

  // 列宽（中文按 2 字宽）
  const cw = (v: any) => {
    let w = 0
    for (const ch of String(v ?? '')) w += /[⺀-￿]/.test(ch) ? 2 : 1
    return w
  }
  ws['!cols'] = groupRow.map((_, c) => {
    let max = Math.max(cw(groupRow[c]), cw(subRow[c]))
    for (const row of body) max = Math.max(max, cw(row[c]))
    return { wch: Math.min(Math.max(max + 2, 6), 40) }
  })

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '外发-工价表')
  XLSX.writeFile(wb, `${title}.xlsx`)
}
</script>
<template>
  <AppLayout>
    <div class="page wide">
      <div class="toolbar">
        <RouterLink to="/price-stats" class="back">← 部门</RouterLink>
        <h2 style="margin:0">{{ deptName }} · 外发产品单价统计表</h2>
        <span class="muted">共 {{ rows.length }} 条</span>
        <span class="spacer"></span>
        <button @click="exportExcel">导出 Excel</button>
      </div>
      <div class="scroll">
        <table class="stats">
          <thead>
            <tr>
              <th rowspan="2">车间</th><th rowspan="2">加工厂名称</th><th rowspan="2">加工类别</th>
              <th rowspan="2">货号</th><th rowspan="2">配件名称/模号</th>
              <th colspan="4">价格管理</th>
              <th rowspan="2">备注</th>
            </tr>
            <tr>
              <th>核价生产工价</th><th>外发单价</th><th>扣税点1.13后单价</th><th>占比</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in rows" :key="i">
              <td v-if="r.workshopSpan" :rowspan="r.workshopSpan">{{ r.workshop || '-' }}</td>
              <td v-if="r.factorySpan" :rowspan="r.factorySpan">{{ r.factory || '-' }}</td>
              <td v-if="r.categorySpan" :rowspan="r.categorySpan">{{ r.category || '-' }}</td>
              <td>{{ r.item_no || '-' }}</td>
              <td>{{ r.product || '-' }}</td>
              <td>{{ num(r.quote_labor_price) }}</td>
              <td>{{ num(r.unit_price) }}</td>
              <td>{{ num(r.after_tax) }}</td>
              <td>{{ pct(r.ratio_pct) }}</td>
              <td>{{ r.notes || '-' }}</td>
            </tr>
            <tr v-if="!rows.length"><td colspan="10" class="hint" style="text-align:center">该部门暂无数据</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </AppLayout>
</template>
<style scoped>
.wide { max-width: none; }
.back { font-size: .9rem; }
.scroll { overflow-x: auto; }
.stats { min-width: 1100px; }
.stats th, .stats td { text-align: left; white-space: nowrap; }
</style>
