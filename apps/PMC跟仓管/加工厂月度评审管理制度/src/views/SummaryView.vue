<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import * as XLSX from 'xlsx'
import AppLayout from '../components/AppLayout.vue'
import { pb } from '../pb'
import { useOrdersStore } from '../stores/orders'
import { useFactoriesStore } from '../stores/factories'
import { useAuthStore } from '../stores/auth'
import { allowedCrafts, allowedRegions } from '../utils/permissions'
import { REGION_LABELS, regionOf, CRAFT_LABELS, type Region, type Craft } from '../constants/roles'
import type { Order } from '../types/order'
import type { Factory } from '../types/factory'

const orders = useOrdersStore()
const factories = useFactoriesStore()
const auth = useAuthStore()
const factoryGrade = ref<Record<string, string>>({})
const qiByFactory = ref<Record<string, any[]>>({}) // 品质检验明细:工厂 → 记录
const search = ref<string>('')
const myRegions = computed(() => (auth.role ? allowedRegions(auth.role) : ['dongguan', 'hunan', 'heyuan'] as Region[]))
const regionFilter = ref<Region | ''>('')
const craftFilter = ref<Craft | ''>('')
const CRAFT_OPTIONS = computed(() => allowedCrafts())

onMounted(async () => {
  await Promise.all([orders.fetchAll(), factories.fetchAll()])
  const scores = await pb.collection('monthly_scores').getFullList({ sort: '-year_month' })
  const g: Record<string, string> = {}
  for (const s of scores as any[]) { if (!(s.factory in g) && s.grade) g[s.factory] = s.grade }
  factoryGrade.value = g
  const qis = await pb.collection('quality_inspections').getFullList()
  const m: Record<string, any[]> = {}
  for (const q of qis as any[]) { if (q.factory) (m[q.factory] ??= []).push(q) }
  qiByFactory.value = m
})

const sumOf = (arr: Order[], key: keyof Order) => arr.reduce((a, o) => a + (Number(o[key]) || 0), 0)
const r2 = (n: number) => Math.round(n * 100) / 100
const r1 = (n: number) => Math.round(n * 10) / 10
const pct2 = (numer: number, denom: number): string => (denom ? r2((numer / denom) * 100).toFixed(2) + '%' : '-')
const isPass = (v?: string) => String(v ?? '').trim().toUpperCase() === 'PASS'

interface Row {
  f: Factory
  grade: string
  // 价格
  quoteSum: number
  unitSum: number
  priceRatio: string
  // 交期
  orderCount: number
  delayedCount: number
  delayRatio: string
  delayDaysAvg: string
  // QC-内部验货
  intInspect: number
  intPass: number
  intRate: string
  // QC-客户验货
  custInspect: number
  custPass: number
  custRate: string
  // 综合合格率
  combinedRate: string
}

const rows = computed<Row[]>(() => {
  const byFactory: Record<string, Order[]> = {}
  for (const o of orders.items) (byFactory[o.factory] ??= []).push(o)
  const q = search.value.trim().toLowerCase()
  const list = factories.items
    .filter((f) => myRegions.value.includes(regionOf(f)))
    .filter((f) => !regionFilter.value || regionOf(f) === regionFilter.value)
    .filter((f) => !craftFilter.value || f.craft === craftFilter.value)
    .filter((f) => !q || [f.name, f.contact_person, f.processable_types].some((s) => (s ?? '').toLowerCase().includes(q)))
  return list.map((f) => {
    const os = byFactory[f.id] ?? []
    const quoteSum = r2(sumOf(os, 'quote_labor_price'))
    const unitSum = r2(sumOf(os, 'unit_price'))
    const orderCount = os.length
    const delayed = os.filter((o) => o.is_delayed)
    const delayedCount = delayed.length
    // QC 品质检验明细
    const qis = qiByFactory.value[f.id] ?? []
    const intInspect = qis.length
    const intPass = qis.filter((q) => isPass(q.internal_result)).length
    const custList = qis.filter((q) => String(q.cust_result ?? '').trim() !== '')
    const custInspect = custList.length
    const custPass = custList.filter((q) => isPass(q.cust_result)).length
    return {
      f,
      grade: factoryGrade.value[f.id] ?? '',
      quoteSum,
      unitSum,
      priceRatio: pct2(unitSum, quoteSum),
      orderCount,
      delayedCount,
      delayRatio: pct2(delayedCount, orderCount),
      delayDaysAvg: delayedCount ? r1(sumOf(delayed, 'delay_days') / delayedCount) + '天' : '-',
      intInspect,
      intPass,
      intRate: pct2(intPass, intInspect),
      custInspect,
      custPass,
      custRate: pct2(custPass, custInspect),
      combinedRate: pct2(intPass + custPass, intInspect + custInspect),
    }
  }).sort((a, b) => (Number(b.f.production_lines) || 0) - (Number(a.f.production_lines) || 0))
})

const TITLE = computed(() => {
  const region = regionFilter.value ? REGION_LABELS[regionFilter.value] + '厂区' : '全部厂区'
  const craft = craftFilter.value ? CRAFT_LABELS[craftFilter.value] : ''
  return region + (craft ? '-' + craft : '') + '-外发加工厂管理统计表'
})

function exportExcel() {
  const N = 23
  const titleRow = new Array(N).fill(''); titleRow[0] = TITLE.value
  const r1Row = new Array(N).fill('')
  r1Row[0] = '工厂基础信息'; r1Row[10] = 'PMC/外发组'; r1Row[17] = 'QC品质'; r1Row[21] = '综合评级'; r1Row[22] = '备注'
  const r2Row = new Array(N).fill('')
  r2Row[10] = '价格'; r2Row[13] = '交期'; r2Row[17] = '品质验货'; r2Row[20] = '现场综合合格率'
  const r3Row = [
    '厂名', '联系人', '联系电话', '工厂地址', '合作年限', '设备台数/生产拉线', '帮我们生产的机台/生产线', '员工人数', '月产能', '加工类型',
    '核价总工价', '外发总工价', '占比',
    '订单总单数', '延期单数', '占比', '延期平均天数',
    '验货总单数', '合格单数', '合格率',
    '', '工厂评级(A/B/C/D)', '',
  ]
  const body = rows.value.map((r) => {
    const f = r.f
    return [
      f.name ?? '', f.contact_person ?? '', f.contact_phone ?? '', f.address ?? '', f.cooperation_period ?? '',
      f.equipment_qty ?? '', f.production_lines ?? '', f.staff_count ?? '', f.monthly_capacity ?? '', f.processable_types ?? '',
      r.quoteSum, r.unitSum, r.priceRatio,
      r.orderCount, r.delayedCount, r.delayRatio, r.delayDaysAvg,
      r.intInspect, r.intPass, r.intRate,
      r.combinedRate, r.grade, '',
    ]
  })
  const ws = XLSX.utils.aoa_to_sheet([titleRow, r1Row, r2Row, r3Row, ...body])
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: N - 1 } },   // 标题
    { s: { r: 1, c: 0 }, e: { r: 2, c: 9 } },        // 工厂基础信息
    { s: { r: 1, c: 10 }, e: { r: 1, c: 16 } },      // PMC/外发组
    { s: { r: 2, c: 10 }, e: { r: 2, c: 12 } },      // 价格
    { s: { r: 2, c: 13 }, e: { r: 2, c: 16 } },      // 交期
    { s: { r: 1, c: 17 }, e: { r: 1, c: 20 } },      // QC品质
    { s: { r: 2, c: 17 }, e: { r: 2, c: 19 } },      // 品质验货
    { s: { r: 2, c: 20 }, e: { r: 3, c: 20 } },      // 现场综合合格率
    { s: { r: 1, c: 21 }, e: { r: 2, c: 21 } },      // 综合评级
    { s: { r: 1, c: 22 }, e: { r: 3, c: 22 } },      // 备注
  ]
  const cw = (v: any) => { let w = 0; for (const ch of String(v ?? '')) w += /[⺀-￿]/.test(ch) ? 2 : 1; return w }
  ws['!cols'] = r3Row.map((_, c) => {
    let max = Math.max(cw(r3Row[c]), cw(r2Row[c]))
    for (const row of body) max = Math.max(max, cw(row[c]))
    return { wch: Math.min(Math.max(max + 2, 6), 32) }
  })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '外发加工厂管理统计表')
  XLSX.writeFile(wb, `${TITLE.value}.xlsx`)
}
</script>
<template>
  <AppLayout>
    <div class="page wide">
      <div class="toolbar">
        <h2 style="margin:0">加工厂合作跟踪汇总表</h2>
        <span class="muted">共 {{ rows.length }} 家</span>
        <select v-model="regionFilter" class="region-sel">
          <option value="">全部厂区</option>
          <option v-for="rg in myRegions" :key="rg" :value="rg">{{ REGION_LABELS[rg] }}厂区</option>
        </select>
        <select v-model="craftFilter" class="region-sel">
          <option value="">全部部门</option>
          <option v-for="c in CRAFT_OPTIONS" :key="c" :value="c">{{ CRAFT_LABELS[c as Craft] }}</option>
        </select>
        <span class="spacer"></span>
        <input class="search-box" v-model="search" placeholder="搜索 厂名/联系人/加工类型" />
        <button @click="exportExcel">导出 Excel</button>
      </div>
      <div class="scroll">
        <table class="summary">
          <thead>
            <tr class="grp">
              <th :colspan="10" rowspan="2">工厂基础信息</th>
              <th :colspan="7">PMC/外发组</th>
              <th :colspan="4">QC品质</th>
              <th rowspan="2">综合评级</th>
              <th rowspan="3">备注</th>
            </tr>
            <tr class="grp">
              <th :colspan="3">价格</th>
              <th :colspan="4">交期</th>
              <th :colspan="3">品质验货</th>
              <th rowspan="2">现场综合合格率</th>
            </tr>
            <tr>
              <th>厂名</th><th>联系人</th><th>联系电话</th><th>工厂地址</th><th>合作年限</th>
              <th>设备台数/生产拉线</th><th>帮我们生产的机台/生产线</th><th>员工人数</th><th>月产能</th><th>加工类型</th>
              <th>核价总工价</th><th>外发总工价</th><th>占比</th>
              <th>订单总单数</th><th>延期单数</th><th>占比</th><th>延期平均天数</th>
              <th>验货总单数</th><th>合格单数</th><th>合格率</th>
              <th>工厂评级(A/B/C/D)</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.f.id">
              <td>{{ r.f.name || '-' }}</td>
              <td>{{ r.f.contact_person || '-' }}</td>
              <td>{{ r.f.contact_phone || '-' }}</td>
              <td>{{ r.f.address || '-' }}</td>
              <td>{{ r.f.cooperation_period || '-' }}</td>
              <td>{{ r.f.equipment_qty ?? '-' }}</td>
              <td>{{ r.f.production_lines || '-' }}</td>
              <td>{{ r.f.staff_count ?? '-' }}</td>
              <td>{{ r.f.monthly_capacity ?? '-' }}</td>
              <td>{{ r.f.processable_types || '-' }}</td>
              <td>{{ r.quoteSum }}</td>
              <td>{{ r.unitSum }}</td>
              <td>{{ r.priceRatio }}</td>
              <td>{{ r.orderCount }}</td>
              <td>{{ r.delayedCount }}</td>
              <td>{{ r.delayRatio }}</td>
              <td>{{ r.delayDaysAvg }}</td>
              <td>{{ r.intInspect }}</td>
              <td>{{ r.intPass }}</td>
              <td>{{ r.intRate }}</td>
              <td class="strong">{{ r.combinedRate }}</td>
              <td><span v-if="r.grade" class="badge" :class="'badge-' + r.grade">{{ r.grade }}</span><span v-else>-</span></td>
              <td>-</td>
            </tr>
            <tr v-if="!rows.length"><td colspan="23" class="hint" style="text-align:center">暂无数据</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </AppLayout>
</template>
<style scoped>
.wide { max-width: none; }
.scroll { overflow-x: auto; }
.summary { min-width: 2600px; }
.summary th, .summary td { white-space: nowrap; text-align: center; }
.grp th { background: #f0f2f8; border-left: 1px solid var(--border); }
.search-box { width: 240px; padding: .4rem .7rem; font-size: .9rem; border: 1px solid var(--border); border-radius: var(--radius-sm); margin-right: .6rem; }
.region-sel { height: 34px; padding: 0 .6rem; margin-left: .6rem; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); cursor: pointer; }
.strong { font-weight: 600; }
</style>
