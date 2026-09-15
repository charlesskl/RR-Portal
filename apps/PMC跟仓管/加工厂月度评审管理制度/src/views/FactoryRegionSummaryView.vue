<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import XLSX from 'xlsx-js-style'
import AppLayout from '../components/AppLayout.vue'
import { pb } from '../pb'
import { useAuthStore } from '../stores/auth'
import { useFactoriesStore } from '../stores/factories'
import { CRAFT_LABELS, CRAFTS, REGION_LABELS, regionOf, type Craft, type Region } from '../constants/roles'
import { allowedCrafts, allowedRegions } from '../utils/permissions'
import { computeFactoryStats, computeSiteStats, type FactoryStats } from '../utils/factoryStats'
import { buildFactorySummaryWorkbook } from '../utils/factorySummaryExcel'
import { matchesOrderDate, type OrderDateFilter } from '../utils/orderDateFilter'
import type { Factory } from '../types/factory'
import type { Order } from '../types/order'

interface FactorySummary {
  factory: Factory
  stats: FactoryStats
  grade: string
  siteScore: number | string
  siteRate: string
}

interface DepartmentSummary {
  craft: Craft
  name: string
  factories: FactorySummary[]
  totalStats: FactoryStats
  totalSiteScore: string
  totalSiteRate: string
}

const route = useRoute()
const factoriesStore = useFactoriesStore()
const auth = useAuthStore()
const region = computed(() => route.params.region as Region)
const regionName = computed(() => `${REGION_LABELS[region.value] ?? ''}厂区`)
const visibleCrafts = computed(() => CRAFTS
  .filter((craft) => allowedCrafts().includes(craft))
  .filter((craft) => craft !== 'electronics' || region.value !== 'heyuan'))

const loading = ref(true)
const error = ref('')
const dateMode = ref<'all' | 'month' | 'range'>('all')
const selectedMonth = ref(new Date().toISOString().slice(0, 7))
const rangeStart = ref('')
const rangeEnd = ref('')
const departments = ref<DepartmentSummary[]>([])
const targetFactories = ref<Factory[]>([])
const allOrders = ref<Order[]>([])
const allInspections = ref<any[]>([])
const allChecks = ref<any[]>([])
const allMonthlyScores = ref<any[]>([])

const factoryCount = computed(() => targetFactories.value.length)
const dateFilter = computed<OrderDateFilter>(() => {
  if (dateMode.value === 'month') return { mode: 'month', month: selectedMonth.value }
  if (dateMode.value === 'range') return { mode: 'range', start: rangeStart.value, end: rangeEnd.value }
  return { mode: 'all' }
})
const dateSummaryLabel = computed(() => {
  if (dateMode.value === 'month' && selectedMonth.value) return `·${selectedMonth.value}`
  if (dateMode.value === 'range' && (rangeStart.value || rangeEnd.value)) {
    return `·${rangeStart.value || '开始'}至${rangeEnd.value || '结束'}`
  }
  return ''
})

function clearDateFilter() {
  dateMode.value = 'all'
  rangeStart.value = ''
  rangeEnd.value = ''
}

function average(values: number[]) {
  if (!values.length) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function formatNumber(value: number | null, suffix = '') {
  if (value == null) return '-'
  const rounded = Math.round(value * 100) / 100
  return `${rounded.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')}${suffix}`
}

function formatAmount(value: number) {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value)
}

function refreshSummaries() {
  const targetIds = new Set(targetFactories.value.map((factory) => factory.id))
  const orders = allOrders.value.filter((order) =>
    targetIds.has(order.factory) && matchesOrderDate(order.order_date, dateFilter.value))
  const inspections = allInspections.value.filter((record) =>
    targetIds.has(record.factory) && matchesOrderDate(record.inspect_date, dateFilter.value))
  const checks = allChecks.value.filter((check) =>
    targetIds.has(check.factory) && matchesOrderDate(check.check_date, dateFilter.value))

  const latestCheckByFactory = new Map<string, any>()
  for (const check of checks) {
    if (!latestCheckByFactory.has(check.factory)) latestCheckByFactory.set(check.factory, check)
  }
  const gradeByFactory = new Map<string, string>()
  for (const score of allMonthlyScores.value) {
    if (!gradeByFactory.has(score.factory) && score.grade) gradeByFactory.set(score.factory, score.grade)
  }

  departments.value = visibleCrafts.value.map((craft) => {
    const craftFactories = targetFactories.value.filter((factory) => factory.craft === craft)
    const factoryIds = new Set(craftFactories.map((factory) => factory.id))
    const craftOrders = orders.filter((order) => factoryIds.has(order.factory))
    const craftInspections = inspections.filter((record) => factoryIds.has(record.factory))
    const craftSiteStats = craftFactories
      .map((factory) => latestCheckByFactory.get(factory.id))
      .filter(Boolean)
      .map((check) => computeSiteStats([check]))

    const factories = craftFactories.map((factory) => {
      const latestCheck = latestCheckByFactory.get(factory.id)
      const site = latestCheck ? computeSiteStats([latestCheck]) : null
      return {
        factory,
        stats: computeFactoryStats(
          craftOrders.filter((order) => order.factory === factory.id),
          craftInspections.filter((record) => record.factory === factory.id),
        ),
        grade: gradeByFactory.get(factory.id) || '-',
        siteScore: site?.siteScore ?? '-',
        siteRate: site?.finalRate ?? '-',
      }
    }).sort((a, b) => a.factory.name.localeCompare(b.factory.name, 'zh-CN'))

    return {
      craft,
      name: CRAFT_LABELS[craft],
      factories,
      totalStats: computeFactoryStats(craftOrders, craftInspections),
      totalSiteScore: formatNumber(average(craftSiteStats.map((item) => item.siteScore))),
      totalSiteRate: formatNumber(average(craftSiteStats
        .map((item) => Number.parseFloat(item.finalRate))
        .filter((value) => Number.isFinite(value))), '%'),
    }
  })
}

function exportExcel() {
  if (!departments.value.length) return
  const workbook = buildFactorySummaryWorkbook(departments.value.map((department) => ({
    title: `${regionName.value} · ${department.name}${dateSummaryLabel.value}加工厂汇总表`,
    items: department.factories.map((summary) => ({
      name: summary.factory.name,
      grade: summary.grade,
      ipControl: summary.factory.ip_control || '-',
      stats: summary.stats,
      siteScore: summary.siteScore,
      siteRate: summary.siteRate,
    })),
    total: {
      name: `${department.factories.length} 家加工厂总计`,
      grade: '-',
      ipControl: '-',
      stats: department.totalStats,
      siteScore: department.totalSiteScore,
      siteRate: department.totalSiteRate,
    },
  })))
  XLSX.writeFile(workbook, `${regionName.value}${dateSummaryLabel.value}加工厂汇总表.xlsx`)
}

watch([dateMode, selectedMonth, rangeStart, rangeEnd], refreshSummaries)

onMounted(async () => {
  try {
    if (!REGION_LABELS[region.value] || (auth.role && !allowedRegions(auth.role).includes(region.value))) {
      throw new Error('无权访问该厂区')
    }
    await factoriesStore.fetchAll()
    targetFactories.value = factoriesStore.items
      .filter((factory) => regionOf(factory) === region.value)
      .filter((factory) => visibleCrafts.value.includes(factory.craft))

    const [orders, inspections, checks, monthlyScores] = await Promise.all([
      pb.collection('orders').getFullList<Order>(),
      pb.collection('quality_inspections').getFullList(),
      pb.collection('quality_5s_checks').getFullList({ sort: '-check_date' }),
      pb.collection('monthly_scores').getFullList({ sort: '-year_month' }),
    ])
    allOrders.value = orders
    allInspections.value = inspections as any[]
    allChecks.value = checks as any[]
    allMonthlyScores.value = monthlyScores as any[]
    refreshSummaries()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '汇总数据加载失败'
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <AppLayout>
    <div class="page region-summary-page">
      <div class="toolbar">
        <RouterLink to="/factory-view" class="back">← 厂区/部门</RouterLink>
        <h2 style="margin:0">{{ regionName }} · 汇总</h2>
        <span class="muted">共 {{ factoryCount }} 家</span>
        <span class="spacer"></span>
        <div class="date-filter">
          <select v-model="dateMode" aria-label="汇总日期筛选方式">
            <option value="all">全部日期</option>
            <option value="month">按月份</option>
            <option value="range">按时间段</option>
          </select>
          <input v-if="dateMode === 'month'" v-model="selectedMonth" type="month" aria-label="选择月份" />
          <template v-else-if="dateMode === 'range'">
            <input v-model="rangeStart" type="date" :max="rangeEnd || undefined" aria-label="开始日期" />
            <span class="date-separator">至</span>
            <input v-model="rangeEnd" type="date" :min="rangeStart || undefined" aria-label="结束日期" />
          </template>
          <button v-if="dateMode !== 'all'" class="ghost date-clear" type="button" title="清除日期筛选"
            aria-label="清除日期筛选" @click="clearDateFilter">×</button>
        </div>
        <button :disabled="loading || !!error || !departments.length" @click="exportExcel">导出 Excel</button>
      </div>

      <div v-if="loading" class="state">正在汇总数据...</div>
      <div v-else-if="error" class="state error">{{ error }}</div>
      <template v-else>
        <section v-for="department in departments" :key="department.craft" class="department-section">
          <h3>{{ department.name }}<span>{{ department.factories.length }} 家加工厂</span></h3>
          <div class="summary-scroll" tabindex="0" :aria-label="`${department.name}汇总表`">
            <table class="summary-table">
              <thead>
                <tr>
                  <th>加工厂名称</th><th>评级</th>
                  <th class="price">核价总金额</th><th class="price">外发总金额</th><th class="price">价格占比</th>
                  <th class="delivery">订单总单数</th><th class="delivery">延期单数</th><th class="delivery">延期占比</th><th class="delivery">延期平均天数</th>
                  <th class="quality">验货总单数</th><th class="quality">合格单数</th><th class="quality">合格率</th>
                  <th class="site">IP管控</th><th class="site">现场得分</th><th class="site">折算总达成率</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="summary in department.factories" :key="summary.factory.id">
                  <td>{{ summary.factory.name }}</td><td>{{ summary.grade }}</td>
                  <td class="price">{{ formatAmount(summary.stats.quoteAmount) }}</td><td class="price">{{ formatAmount(summary.stats.outAmount) }}</td><td class="price">{{ summary.stats.amountRatio }}</td>
                  <td class="delivery">{{ summary.stats.orderCount }}</td><td class="delivery">{{ summary.stats.delayedCount }}</td><td class="delivery">{{ summary.stats.delayRatio }}</td><td class="delivery">{{ summary.stats.delayDaysAvg }}</td>
                  <td class="quality">{{ summary.stats.intInspect }}</td><td class="quality">{{ summary.stats.intPass }}</td><td class="quality">{{ summary.stats.intRate }}</td>
                  <td class="site">{{ summary.factory.ip_control || '-' }}</td><td class="site">{{ summary.siteScore }}</td><td class="site">{{ summary.siteRate }}</td>
                </tr>
                <tr v-if="!department.factories.length"><td colspan="15" class="empty">该部门暂无加工厂</td></tr>
              </tbody>
              <tfoot>
                <tr>
                  <td>{{ department.factories.length }} 家加工厂总计</td><td>-</td>
                  <td class="price">{{ formatAmount(department.totalStats.quoteAmount) }}</td><td class="price">{{ formatAmount(department.totalStats.outAmount) }}</td><td class="price">{{ department.totalStats.amountRatio }}</td>
                  <td class="delivery">{{ department.totalStats.orderCount }}</td><td class="delivery">{{ department.totalStats.delayedCount }}</td><td class="delivery">{{ department.totalStats.delayRatio }}</td><td class="delivery">{{ department.totalStats.delayDaysAvg }}</td>
                  <td class="quality">{{ department.totalStats.intInspect }}</td><td class="quality">{{ department.totalStats.intPass }}</td><td class="quality">{{ department.totalStats.intRate }}</td>
                  <td class="site">-</td><td class="site">{{ department.totalSiteScore }}</td><td class="site">{{ department.totalSiteRate }}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      </template>
    </div>
  </AppLayout>
</template>

<style scoped>
.region-summary-page { display: flex; flex-direction: column; gap: 1rem; }
.back { font-size: .95rem; }
.date-filter { display: flex; align-items: center; gap: .35rem; min-height: 38px; }
.date-filter select, .date-filter input { height: 38px; padding: .35rem .55rem; font-size: .86rem; border: 1px solid var(--border); border-radius: var(--radius-sm); background: white; }
.date-filter input[type="month"], .date-filter input[type="date"] { width: 138px; }
.date-separator { color: var(--text-soft); font-size: .82rem; }
.date-clear { width: 34px; height: 34px; padding: 0; font-size: 1.15rem; line-height: 1; }
.state { padding: 3rem 1rem; text-align: center; color: var(--muted); border: 1px solid var(--border); border-radius: var(--radius-sm); background: #fff; }
.state.error { color: #dc2626; }
.department-section { display: flex; flex-direction: column; gap: .55rem; }
.department-section h3 { display: flex; align-items: baseline; gap: .7rem; margin: .35rem 0 0; padding-left: .65rem; border-left: 4px solid var(--primary, #4f46e5); font-size: 1.08rem; }
.department-section h3 span { color: var(--muted); font-size: .84rem; font-weight: 400; }
.summary-scroll { overflow-x: auto; border: 1px solid #6b7280; background: #fff; }
.summary-table { width: max-content; min-width: 100%; border-collapse: collapse; font-size: .8rem; }
.summary-table th, .summary-table td { min-width: 86px; padding: .42rem .55rem; text-align: center; white-space: nowrap; border: 1px solid #6b7280; }
.summary-table th:first-child, .summary-table td:first-child { min-width: 240px; }
.summary-table th { font-weight: 700; }
.summary-table .price { background: #dce6f1; }
.summary-table .delivery { background: #f2dcdb; }
.summary-table .quality { background: #e4dfec; }
.summary-table .site { background: #fde9d9; }
.summary-table tbody tr:nth-child(even) td:not(.price):not(.delivery):not(.quality):not(.site) { background: #f8fafc; }
.summary-table tfoot td { font-weight: 700; }
.summary-table tfoot td:first-child, .summary-table tfoot td:nth-child(2) { background: #eef2ff; }
.summary-table .empty { padding: 1.2rem; color: var(--muted); background: #fff; }
@media (max-width: 900px) { .toolbar { flex-wrap: wrap; } .spacer { display: none; } }
</style>
