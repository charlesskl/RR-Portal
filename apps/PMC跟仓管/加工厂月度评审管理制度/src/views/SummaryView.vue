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
import type { MonthlyScore } from '../types/score'
import type { QualityInspection } from '../types/qualityInspection'
import { matchesOrderDate, type OrderDateFilter } from '../utils/orderDateFilter'
import { useTableColumnPreferences } from '../composables/useTableColumnPreferences'

const orders = useOrdersStore()
const factories = useFactoriesStore()
const auth = useAuthStore()
const monthlyScores = ref<MonthlyScore[]>([])
const inspections = ref<QualityInspection[]>([])
const dateMode = ref<'all' | 'month' | 'range'>('all')
const today = new Date()
const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
const selectedMonth = ref(currentMonth)
const rangeStart = ref('')
const rangeEnd = ref('')
const dateFilter = computed<OrderDateFilter>(() => {
  if (dateMode.value === 'month' && selectedMonth.value) return { mode: 'month', month: selectedMonth.value }
  if (dateMode.value === 'range' && (rangeStart.value || rangeEnd.value)) {
    const reverse = rangeStart.value && rangeEnd.value && rangeStart.value > rangeEnd.value
    return { mode: 'range', start: reverse ? rangeEnd.value : rangeStart.value, end: reverse ? rangeStart.value : rangeEnd.value }
  }
  return { mode: 'all' }
})
const timeLabel = computed(() => {
  const filter = dateFilter.value
  if (filter.mode === 'month') return filter.month
  if (filter.mode === 'range') return `${filter.start || '不限开始'}至${filter.end || '不限结束'}`
  return '全部时间'
})
const factoryGrade = computed(() => {
  const filter = dateFilter.value
  const records = monthlyScores.value.filter((score) => {
    if (filter.mode === 'all') return true
    if (filter.mode === 'month') return score.year_month === filter.month
    return (!filter.start || score.year_month >= filter.start.slice(0, 7))
      && (!filter.end || score.year_month <= filter.end.slice(0, 7))
  }).sort((a, b) => b.year_month.localeCompare(a.year_month))
  const grades: Record<string, string> = {}
  for (const score of records) if (!(score.factory in grades) && score.grade) grades[score.factory] = score.grade
  return grades
})
const qiByFactory = computed(() => {
  const grouped: Record<string, QualityInspection[]> = {}
  for (const inspection of inspections.value) {
    if (inspection.factory && matchesOrderDate(inspection.inspect_date, dateFilter.value)) {
      (grouped[inspection.factory] ??= []).push(inspection)
    }
  }
  return grouped
})
const search = ref<string>('')
const myRegions = computed(() => (auth.role ? allowedRegions(auth.role) : ['dongguan', 'hunan', 'heyuan'] as Region[]))
const regionFilter = ref<Region | ''>('')
const craftFilter = ref<Craft | ''>('')
const CRAFT_OPTIONS = computed(() => allowedCrafts())

onMounted(async () => {
  await Promise.all([orders.fetchAll(), factories.fetchAll()])
  const [scores, qis] = await Promise.all([
    pb.collection('monthly_scores').getFullList<MonthlyScore>({ sort: '-year_month' }),
    pb.collection('quality_inspections').getFullList<QualityInspection>(),
  ])
  monthlyScores.value = scores
  inspections.value = qis
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

const tableColumns = [
  { key: 'factory', label: '厂名', width: 300, hideable: false },
  { key: 'contact', label: '联系人', width: 120 },
  { key: 'phone', label: '联系电话', width: 150 },
  { key: 'address', label: '工厂地址', width: 240 },
  { key: 'cooperation', label: '合作年限', width: 120 },
  { key: 'equipment', label: '设备台数/生产拉线', width: 180 },
  { key: 'lines', label: '帮我们生产的机台/生产线', width: 230 },
  { key: 'staff', label: '员工人数', width: 110 },
  { key: 'capacity', label: '月产能', width: 120 },
  { key: 'types', label: '加工类型', width: 180 },
  { key: 'quoteSum', label: '价格-核价总工价', width: 150 },
  { key: 'unitSum', label: '价格-外发总工价', width: 150 },
  { key: 'priceRatio', label: '价格-占比', width: 110 },
  { key: 'orderCount', label: '交期-订单总单数', width: 140 },
  { key: 'delayedCount', label: '交期-延期单数', width: 130 },
  { key: 'delayRatio', label: '交期-延期占比', width: 130 },
  { key: 'delayAvg', label: '交期-延期平均天数', width: 160 },
  { key: 'inspectCount', label: 'QC-验货总单数', width: 140 },
  { key: 'passCount', label: 'QC-合格单数', width: 130 },
  { key: 'passRate', label: 'QC-合格率', width: 120 },
  { key: 'combinedRate', label: '现场综合合格率', width: 160 },
  { key: 'grade', label: '工厂评级(A/B/C/D)', width: 170 },
  { key: 'notes', label: '备注', width: 160 },
]
const { frozenThrough, columnPanelOpen, visibleColumns, isVisible, isFrozen, columnStyle, toggleColumn, showAllColumns } =
  useTableColumnPreferences('summary-table-columns', tableColumns)
const visibleColumnCount = computed(() => visibleColumns.value.length)
const baseKeys = ['contact', 'phone', 'address', 'cooperation', 'equipment', 'lines', 'staff', 'capacity', 'types']
const priceKeys = ['quoteSum', 'unitSum', 'priceRatio']
const deliveryKeys = ['orderCount', 'delayedCount', 'delayRatio', 'delayAvg']
const inspectionKeys = ['inspectCount', 'passCount', 'passRate']
const visibleCount = (keys: string[]) => keys.filter(isVisible).length
const groupStyle = (keys: string[]) => {
  const first = keys.find(isVisible)
  return first && keys.filter(isVisible).every(isFrozen) ? columnStyle(first) : undefined
}
const groupFrozen = (keys: string[]) => keys.some(isVisible) && keys.filter(isVisible).every(isFrozen)

const rows = computed<Row[]>(() => {
  const byFactory: Record<string, Order[]> = {}
  for (const o of orders.items) {
    if (matchesOrderDate(o.order_date, dateFilter.value)) (byFactory[o.factory] ??= []).push(o)
  }
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
    + (dateFilter.value.mode === 'all' ? '' : `-${timeLabel.value}`)
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
        <select v-model="dateMode" class="region-sel" aria-label="汇总时间筛选方式">
          <option value="all">全部时间</option>
          <option value="month">按月筛选</option>
          <option value="range">自定义日期范围</option>
        </select>
        <input v-if="dateMode === 'month'" v-model="selectedMonth" type="month" aria-label="汇总月份" />
        <template v-if="dateMode === 'range'">
          <input v-model="rangeStart" type="date" aria-label="汇总开始日期" />
          <span class="muted">至</span>
          <input v-model="rangeEnd" type="date" aria-label="汇总结束日期" />
        </template>
        <button v-if="dateMode !== 'all'" class="ghost" @click="dateMode = 'all'">清除时间筛选</button>
        <select v-model="regionFilter" class="region-sel">
          <option value="">全部厂区</option>
          <option v-for="rg in myRegions" :key="rg" :value="rg">{{ REGION_LABELS[rg] }}厂区</option>
        </select>
        <select v-model="craftFilter" class="region-sel">
          <option value="">全部部门</option>
          <option v-for="c in CRAFT_OPTIONS" :key="c" :value="c">{{ CRAFT_LABELS[c as Craft] }}</option>
        </select>
        <label class="freeze-control">冻结至
          <select v-model="frozenThrough" class="column-select">
            <option value="">不冻结列</option>
            <option v-for="column in visibleColumns" :key="column.key" :value="column.key">{{ column.label }}</option>
          </select>
        </label>
        <div class="column-menu">
          <button class="ghost" @click="columnPanelOpen = !columnPanelOpen">栏目显示</button>
          <div v-if="columnPanelOpen" class="column-panel">
            <div class="column-panel-head"><b>显示/隐藏栏目</b><button class="link-btn" @click="showAllColumns">全部显示</button></div>
            <label v-for="column in tableColumns.filter(c => c.hideable !== false)" :key="column.key">
              <input type="checkbox" :checked="isVisible(column.key)" @change="toggleColumn(column.key)" /> {{ column.label }}
            </label>
          </div>
        </div>
        <span class="spacer"></span>
        <input class="search-box" v-model="search" placeholder="搜索 厂名/联系人/加工类型" />
        <button @click="exportExcel">导出 Excel</button>
      </div>
      <p v-if="dateMode !== 'all'" class="date-hint">
        {{ timeLabel }} · 价格、交期按下单日期统计；品质按验货日期统计；评级取范围内最近评分月份（按整月）。
      </p>
      <div class="scroll" tabindex="0" aria-label="汇总表滚动区域">
        <table class="summary">
          <thead>
            <tr class="grp">
              <th rowspan="3" :class="{ frozen: isFrozen('factory'), 'freeze-edge': frozenThrough === 'factory' }" :style="columnStyle('factory')">厂名</th>
              <th v-if="visibleCount(baseKeys)" :colspan="visibleCount(baseKeys)" rowspan="2"
                :class="{ frozen: groupFrozen(baseKeys) }" :style="groupStyle(baseKeys)">工厂基础信息</th>
              <th v-if="visibleCount(priceKeys) + visibleCount(deliveryKeys)" :colspan="visibleCount(priceKeys) + visibleCount(deliveryKeys)">
                PMC/外发组
              </th>
              <th v-if="visibleCount(inspectionKeys) + (isVisible('combinedRate') ? 1 : 0)"
                :colspan="visibleCount(inspectionKeys) + (isVisible('combinedRate') ? 1 : 0)">QC品质</th>
              <th v-if="isVisible('grade')" rowspan="2" :class="{ frozen: isFrozen('grade') }" :style="columnStyle('grade')">综合评级</th>
              <th v-if="isVisible('notes')" rowspan="3" :class="{ frozen: isFrozen('notes'), 'freeze-edge': frozenThrough === 'notes' }" :style="columnStyle('notes')">备注</th>
            </tr>
            <tr class="grp">
              <th v-if="visibleCount(priceKeys)" :colspan="visibleCount(priceKeys)"
                :class="{ frozen: groupFrozen(priceKeys) }" :style="groupStyle(priceKeys)">价格</th>
              <th v-if="visibleCount(deliveryKeys)" :colspan="visibleCount(deliveryKeys)"
                :class="{ frozen: groupFrozen(deliveryKeys) }" :style="groupStyle(deliveryKeys)">交期</th>
              <th v-if="visibleCount(inspectionKeys)" :colspan="visibleCount(inspectionKeys)"
                :class="{ frozen: groupFrozen(inspectionKeys) }" :style="groupStyle(inspectionKeys)">品质验货</th>
              <th v-if="isVisible('combinedRate')" rowspan="2"
                :class="{ frozen: isFrozen('combinedRate'), 'freeze-edge': frozenThrough === 'combinedRate' }" :style="columnStyle('combinedRate')">现场综合合格率</th>
            </tr>
            <tr>
              <th v-if="isVisible('contact')" :class="{ frozen: isFrozen('contact'), 'freeze-edge': frozenThrough === 'contact' }" :style="columnStyle('contact')">联系人</th>
              <th v-if="isVisible('phone')" :class="{ frozen: isFrozen('phone'), 'freeze-edge': frozenThrough === 'phone' }" :style="columnStyle('phone')">联系电话</th>
              <th v-if="isVisible('address')" :class="{ frozen: isFrozen('address'), 'freeze-edge': frozenThrough === 'address' }" :style="columnStyle('address')">工厂地址</th>
              <th v-if="isVisible('cooperation')" :class="{ frozen: isFrozen('cooperation'), 'freeze-edge': frozenThrough === 'cooperation' }" :style="columnStyle('cooperation')">合作年限</th>
              <th v-if="isVisible('equipment')" :class="{ frozen: isFrozen('equipment'), 'freeze-edge': frozenThrough === 'equipment' }" :style="columnStyle('equipment')">设备台数/生产拉线</th>
              <th v-if="isVisible('lines')" :class="{ frozen: isFrozen('lines'), 'freeze-edge': frozenThrough === 'lines' }" :style="columnStyle('lines')">帮我们生产的机台/生产线</th>
              <th v-if="isVisible('staff')" :class="{ frozen: isFrozen('staff'), 'freeze-edge': frozenThrough === 'staff' }" :style="columnStyle('staff')">员工人数</th>
              <th v-if="isVisible('capacity')" :class="{ frozen: isFrozen('capacity'), 'freeze-edge': frozenThrough === 'capacity' }" :style="columnStyle('capacity')">月产能</th>
              <th v-if="isVisible('types')" :class="{ frozen: isFrozen('types'), 'freeze-edge': frozenThrough === 'types' }" :style="columnStyle('types')">加工类型</th>
              <th v-if="isVisible('quoteSum')" :class="{ frozen: isFrozen('quoteSum'), 'freeze-edge': frozenThrough === 'quoteSum' }" :style="columnStyle('quoteSum')">核价总工价</th>
              <th v-if="isVisible('unitSum')" :class="{ frozen: isFrozen('unitSum'), 'freeze-edge': frozenThrough === 'unitSum' }" :style="columnStyle('unitSum')">外发总工价</th>
              <th v-if="isVisible('priceRatio')" :class="{ frozen: isFrozen('priceRatio'), 'freeze-edge': frozenThrough === 'priceRatio' }" :style="columnStyle('priceRatio')">占比</th>
              <th v-if="isVisible('orderCount')" :class="{ frozen: isFrozen('orderCount'), 'freeze-edge': frozenThrough === 'orderCount' }" :style="columnStyle('orderCount')">订单总单数</th>
              <th v-if="isVisible('delayedCount')" :class="{ frozen: isFrozen('delayedCount'), 'freeze-edge': frozenThrough === 'delayedCount' }" :style="columnStyle('delayedCount')">延期单数</th>
              <th v-if="isVisible('delayRatio')" :class="{ frozen: isFrozen('delayRatio'), 'freeze-edge': frozenThrough === 'delayRatio' }" :style="columnStyle('delayRatio')">占比</th>
              <th v-if="isVisible('delayAvg')" :class="{ frozen: isFrozen('delayAvg'), 'freeze-edge': frozenThrough === 'delayAvg' }" :style="columnStyle('delayAvg')">延期平均天数</th>
              <th v-if="isVisible('inspectCount')" :class="{ frozen: isFrozen('inspectCount'), 'freeze-edge': frozenThrough === 'inspectCount' }" :style="columnStyle('inspectCount')">验货总单数</th>
              <th v-if="isVisible('passCount')" :class="{ frozen: isFrozen('passCount'), 'freeze-edge': frozenThrough === 'passCount' }" :style="columnStyle('passCount')">合格单数</th>
              <th v-if="isVisible('passRate')" :class="{ frozen: isFrozen('passRate'), 'freeze-edge': frozenThrough === 'passRate' }" :style="columnStyle('passRate')">合格率</th>
              <th v-if="isVisible('grade')" :class="{ frozen: isFrozen('grade'), 'freeze-edge': frozenThrough === 'grade' }" :style="columnStyle('grade')">工厂评级(A/B/C/D)</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.f.id">
              <td :class="{ frozen: isFrozen('factory'), 'freeze-edge': frozenThrough === 'factory' }" :style="columnStyle('factory')">{{ r.f.name || '-' }}</td>
              <td v-if="isVisible('contact')" :class="{ frozen: isFrozen('contact'), 'freeze-edge': frozenThrough === 'contact' }" :style="columnStyle('contact')">{{ r.f.contact_person || '-' }}</td>
              <td v-if="isVisible('phone')" :class="{ frozen: isFrozen('phone'), 'freeze-edge': frozenThrough === 'phone' }" :style="columnStyle('phone')">{{ r.f.contact_phone || '-' }}</td>
              <td v-if="isVisible('address')" :class="{ frozen: isFrozen('address'), 'freeze-edge': frozenThrough === 'address' }" :style="columnStyle('address')">{{ r.f.address || '-' }}</td>
              <td v-if="isVisible('cooperation')" :class="{ frozen: isFrozen('cooperation'), 'freeze-edge': frozenThrough === 'cooperation' }" :style="columnStyle('cooperation')">{{ r.f.cooperation_period || '-' }}</td>
              <td v-if="isVisible('equipment')" :class="{ frozen: isFrozen('equipment'), 'freeze-edge': frozenThrough === 'equipment' }" :style="columnStyle('equipment')">{{ r.f.equipment_qty ?? '-' }}</td>
              <td v-if="isVisible('lines')" :class="{ frozen: isFrozen('lines'), 'freeze-edge': frozenThrough === 'lines' }" :style="columnStyle('lines')">{{ r.f.production_lines || '-' }}</td>
              <td v-if="isVisible('staff')" :class="{ frozen: isFrozen('staff'), 'freeze-edge': frozenThrough === 'staff' }" :style="columnStyle('staff')">{{ r.f.staff_count ?? '-' }}</td>
              <td v-if="isVisible('capacity')" :class="{ frozen: isFrozen('capacity'), 'freeze-edge': frozenThrough === 'capacity' }" :style="columnStyle('capacity')">{{ r.f.monthly_capacity ?? '-' }}</td>
              <td v-if="isVisible('types')" :class="{ frozen: isFrozen('types'), 'freeze-edge': frozenThrough === 'types' }" :style="columnStyle('types')">{{ r.f.processable_types || '-' }}</td>
              <td v-if="isVisible('quoteSum')" :class="{ frozen: isFrozen('quoteSum'), 'freeze-edge': frozenThrough === 'quoteSum' }" :style="columnStyle('quoteSum')">{{ r.quoteSum }}</td>
              <td v-if="isVisible('unitSum')" :class="{ frozen: isFrozen('unitSum'), 'freeze-edge': frozenThrough === 'unitSum' }" :style="columnStyle('unitSum')">{{ r.unitSum }}</td>
              <td v-if="isVisible('priceRatio')" :class="{ frozen: isFrozen('priceRatio'), 'freeze-edge': frozenThrough === 'priceRatio' }" :style="columnStyle('priceRatio')">{{ r.priceRatio }}</td>
              <td v-if="isVisible('orderCount')" :class="{ frozen: isFrozen('orderCount'), 'freeze-edge': frozenThrough === 'orderCount' }" :style="columnStyle('orderCount')">{{ r.orderCount }}</td>
              <td v-if="isVisible('delayedCount')" :class="{ frozen: isFrozen('delayedCount'), 'freeze-edge': frozenThrough === 'delayedCount' }" :style="columnStyle('delayedCount')">{{ r.delayedCount }}</td>
              <td v-if="isVisible('delayRatio')" :class="{ frozen: isFrozen('delayRatio'), 'freeze-edge': frozenThrough === 'delayRatio' }" :style="columnStyle('delayRatio')">{{ r.delayRatio }}</td>
              <td v-if="isVisible('delayAvg')" :class="{ frozen: isFrozen('delayAvg'), 'freeze-edge': frozenThrough === 'delayAvg' }" :style="columnStyle('delayAvg')">{{ r.delayDaysAvg }}</td>
              <td v-if="isVisible('inspectCount')" :class="{ frozen: isFrozen('inspectCount'), 'freeze-edge': frozenThrough === 'inspectCount' }" :style="columnStyle('inspectCount')">{{ r.intInspect }}</td>
              <td v-if="isVisible('passCount')" :class="{ frozen: isFrozen('passCount'), 'freeze-edge': frozenThrough === 'passCount' }" :style="columnStyle('passCount')">{{ r.intPass }}</td>
              <td v-if="isVisible('passRate')" :class="{ frozen: isFrozen('passRate'), 'freeze-edge': frozenThrough === 'passRate' }" :style="columnStyle('passRate')">{{ r.intRate }}</td>
              <td v-if="isVisible('combinedRate')" class="strong" :class="{ frozen: isFrozen('combinedRate'), 'freeze-edge': frozenThrough === 'combinedRate' }" :style="columnStyle('combinedRate')">{{ r.combinedRate }}</td>
              <td v-if="isVisible('grade')" :class="{ frozen: isFrozen('grade'), 'freeze-edge': frozenThrough === 'grade' }" :style="columnStyle('grade')"><span v-if="r.grade" class="badge" :class="'badge-' + r.grade">{{ r.grade }}</span><span v-else>-</span></td>
              <td v-if="isVisible('notes')" :class="{ frozen: isFrozen('notes'), 'freeze-edge': frozenThrough === 'notes' }" :style="columnStyle('notes')">-</td>
            </tr>
            <tr v-if="!rows.length"><td :colspan="visibleColumnCount" class="hint" style="text-align:center">暂无数据</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </AppLayout>
</template>
<style scoped>
.wide {
  max-width: none;
  height: calc(100vh - 106px);
  height: calc(100dvh - 106px);
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.toolbar {
  flex-wrap: wrap;
  position: relative;
  flex: 0 0 auto;
  z-index: 9;
  margin: -.35rem 0 1rem;
  padding: .35rem 0;
  background: var(--bg);
}
.scroll {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  isolation: isolate;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}
.date-hint { flex: 0 0 auto; margin: -.4rem 0 .7rem; color: var(--text-soft); font-size: .82rem; }
.summary {
  width: max-content;
  min-width: 100%;
  table-layout: fixed;
  margin-top: 0;
  overflow: visible;
}
.summary th, .summary td { white-space: nowrap; text-align: center; }
.summary thead tr { height: 44px; }
.summary thead th {
  position: sticky;
  z-index: 3;
  background: #fafbfc;
}
.summary thead tr:first-child th { top: 0; }
.summary thead tr:nth-child(2) th { top: 44px; }
.summary thead tr:nth-child(3) th { top: 88px; }
.summary .frozen { position: sticky; z-index: 2; background: var(--surface); }
.summary thead .frozen { z-index: 5; background: #fafbfc; }
.summary .freeze-edge { box-shadow: 5px 0 7px -7px rgba(31, 37, 51, .55); }
.grp th { background: #f0f2f8; border-left: 1px solid var(--border); }
.search-box { width: 240px; padding: .4rem .7rem; font-size: .9rem; border: 1px solid var(--border); border-radius: var(--radius-sm); margin-right: .6rem; }
.region-sel { height: 34px; padding: 0 .6rem; margin-left: .6rem; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); cursor: pointer; }
.freeze-control { display: flex; align-items: center; gap: .35rem; color: var(--text-soft); font-size: .85rem; white-space: nowrap; }
.column-select { height: 34px; max-width: 200px; padding: 0 .55rem; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); }
.column-menu { position: relative; }
.column-panel { position: absolute; top: calc(100% + .4rem); left: 0; z-index: 20; width: 330px; max-height: 430px; overflow: auto; padding: .75rem; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); box-shadow: var(--shadow); display: grid; gap: .45rem; }
.column-panel label { display: flex; align-items: flex-start; gap: .45rem; font-size: .84rem; }
.column-panel-head { display: flex; justify-content: space-between; align-items: center; padding-bottom: .35rem; border-bottom: 1px solid var(--border); }
.link-btn { padding: 0; border: 0; background: transparent; color: var(--primary); font-size: .82rem; }
.strong { font-weight: 600; }
</style>
