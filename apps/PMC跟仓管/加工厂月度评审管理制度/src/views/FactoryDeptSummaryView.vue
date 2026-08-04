<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import AppLayout from '../components/AppLayout.vue'
import { pb } from '../pb'
import { useAuthStore } from '../stores/auth'
import { useFactoriesStore } from '../stores/factories'
import { CRAFT_LABELS, REGION_LABELS, regionOf, type Craft, type Region } from '../constants/roles'
import { allowedRegions } from '../utils/permissions'
import { computeFactoryStats, computeSiteStats, type FactoryStats } from '../utils/factoryStats'
import type { Factory } from '../types/factory'
import type { Order } from '../types/order'

const route = useRoute()
const factoriesStore = useFactoriesStore()
const auth = useAuthStore()
const craft = computed(() => route.params.craft as Craft)
const region = computed(() => (route.query.region as Region) || null)
const myRegions = computed(() => (auth.role ? allowedRegions(auth.role) : null))
const deptName = computed(() =>
  (region.value ? REGION_LABELS[region.value] + '厂区 · ' : '') + (CRAFT_LABELS[craft.value] ?? '部门'))
const backTo = computed(() => ({
  path: `/factory-view/dept/${craft.value}`,
  query: region.value ? { region: region.value } : {},
}))

const loading = ref(true)
const error = ref('')
const factoryCount = ref(0)
interface FactorySummary {
  factory: Factory
  stats: FactoryStats
  siteScore: number | string
  siteRate: string
}
const summaries = ref<FactorySummary[]>([])
const totalStats = ref<FactoryStats | null>(null)
const totalSiteScore = ref<string>('-')
const totalSiteRate = ref<string>('-')

function average(values: number[]) {
  if (!values.length) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function formatNumber(value: number | null, suffix = '') {
  if (value == null) return '-'
  const rounded = Math.round(value * 100) / 100
  return `${rounded.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')}${suffix}`
}

onMounted(async () => {
  try {
    await factoriesStore.fetchAll()
    const targetFactories = factoriesStore.items
      .filter((factory: Factory) => factory.craft === craft.value && (!region.value || regionOf(factory) === region.value))
      .filter((factory) => !myRegions.value || myRegions.value.includes(regionOf(factory)))
    factoryCount.value = targetFactories.length
    const factoryIds = new Set(targetFactories.map((factory) => factory.id))

    const [orders, inspections, checks] = await Promise.all([
      pb.collection('orders').getFullList<Order>(),
      pb.collection('quality_inspections').getFullList(),
      pb.collection('quality_5s_checks').getFullList({ sort: '-check_date' }),
    ])

    const latestCheckByFactory = new Map<string, any>()
    for (const check of checks as any[]) {
      if (factoryIds.has(check.factory) && !latestCheckByFactory.has(check.factory)) {
        latestCheckByFactory.set(check.factory, check)
      }
    }
    const deptOrders = orders.filter((order) => factoryIds.has(order.factory))
    const deptInspections = (inspections as any[]).filter((record) => factoryIds.has(record.factory))
    const deptSiteStats = [...latestCheckByFactory.values()].map((check) => computeSiteStats([check]))
    totalStats.value = computeFactoryStats(deptOrders, deptInspections)
    totalSiteScore.value = formatNumber(average(deptSiteStats.map((item) => item.siteScore)))
    totalSiteRate.value = formatNumber(average(deptSiteStats
      .map((item) => Number.parseFloat(item.finalRate))
      .filter((value) => Number.isFinite(value))), '%')

    summaries.value = targetFactories.map((factory) => {
      const factoryOrders = orders.filter((order) => order.factory === factory.id)
      const factoryInspections = (inspections as any[]).filter((record) => record.factory === factory.id)
      const latestCheck = latestCheckByFactory.get(factory.id)
      const site = latestCheck ? computeSiteStats([latestCheck]) : null
      return {
        factory,
        stats: computeFactoryStats(factoryOrders, factoryInspections),
        siteScore: site?.siteScore ?? '-',
        siteRate: site?.finalRate ?? '-',
      }
    }).sort((a, b) => a.factory.name.localeCompare(b.factory.name, 'zh-CN'))
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '汇总数据加载失败'
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <AppLayout>
    <div class="page summary-page">
      <div class="toolbar">
        <RouterLink :to="backTo" class="back">← 工厂列表</RouterLink>
        <h2 style="margin:0">{{ deptName }} · 汇总</h2>
        <span class="muted">共 {{ factoryCount }} 家</span>
      </div>

      <div v-if="loading" class="state">正在汇总数据...</div>
      <div v-else-if="error" class="state error">{{ error }}</div>
      <div v-else-if="!summaries.length" class="state">该部门暂无加工厂</div>
      <section v-else class="factory-comparison">
        <article v-for="summary in summaries" :key="summary.factory.id" class="factory-summary">
          <h3 class="factory-name">{{ summary.factory.name }}</h3>
          <div class="metrics-grid">
            <div class="metric-card price-card">
              <h4><span class="metric-icon">💰</span>价格</h4>
              <div class="metric-line"><span>核价总金额</span><b>{{ summary.stats.quoteAmount }}</b></div>
              <div class="metric-line"><span>外发总金额</span><b>{{ summary.stats.outAmount }}</b></div>
              <div class="metric-line highlight"><span>占比</span><b>{{ summary.stats.amountRatio }}</b></div>
            </div>

            <div class="metric-card delivery-card">
              <h4><span class="metric-icon">📅</span>交期</h4>
              <div class="metric-line"><span>订单总单数</span><b>{{ summary.stats.orderCount }}</b></div>
              <div class="metric-line"><span>延期单数</span><b>{{ summary.stats.delayedCount }}</b></div>
              <div class="metric-line highlight"><span>占比</span><b>{{ summary.stats.delayRatio }}</b></div>
              <div class="metric-line"><span>延期平均天数</span><b>{{ summary.stats.delayDaysAvg }}</b></div>
            </div>

            <div class="metric-card quality-card">
              <h4><span class="metric-icon">🔍</span>品质</h4>
              <div class="metric-line"><span>验货总单数</span><b>{{ summary.stats.intInspect }}</b></div>
              <div class="metric-line"><span>合格单数</span><b>{{ summary.stats.intPass }}</b></div>
              <div class="metric-line highlight"><span>合格率</span><b>{{ summary.stats.intRate }}</b></div>
            </div>

            <div class="metric-card site-card">
              <h4><span class="metric-icon">🧹</span>现场管理</h4>
              <div class="metric-line"><span>现场得分</span><b>{{ summary.siteScore }}</b></div>
              <div class="metric-line"><span>折算总达成率</span><b class="site-rate">{{ summary.siteRate }}</b></div>
            </div>
          </div>
        </article>

        <article v-if="totalStats" class="factory-summary total-summary">
          <h3 class="factory-name total-name">{{ factoryCount }} 家工厂总计</h3>
          <div class="metrics-grid">
            <div class="metric-card price-card">
              <h4><span class="metric-icon">💰</span>价格</h4>
              <div class="metric-line"><span>核价总金额</span><b>{{ totalStats.quoteAmount }}</b></div>
              <div class="metric-line"><span>外发总金额</span><b>{{ totalStats.outAmount }}</b></div>
              <div class="metric-line highlight"><span>占比</span><b>{{ totalStats.amountRatio }}</b></div>
            </div>

            <div class="metric-card delivery-card">
              <h4><span class="metric-icon">📅</span>交期</h4>
              <div class="metric-line"><span>订单总单数</span><b>{{ totalStats.orderCount }}</b></div>
              <div class="metric-line"><span>延期单数</span><b>{{ totalStats.delayedCount }}</b></div>
              <div class="metric-line highlight"><span>占比</span><b>{{ totalStats.delayRatio }}</b></div>
              <div class="metric-line"><span>延期平均天数</span><b>{{ totalStats.delayDaysAvg }}</b></div>
            </div>

            <div class="metric-card quality-card">
              <h4><span class="metric-icon">🔍</span>品质</h4>
              <div class="metric-line"><span>验货总单数</span><b>{{ totalStats.intInspect }}</b></div>
              <div class="metric-line"><span>合格单数</span><b>{{ totalStats.intPass }}</b></div>
              <div class="metric-line highlight"><span>合格率</span><b>{{ totalStats.intRate }}</b></div>
            </div>

            <div class="metric-card site-card">
              <h4><span class="metric-icon">🧹</span>现场管理</h4>
              <div class="metric-line"><span>现场平均得分</span><b>{{ totalSiteScore }}</b></div>
              <div class="metric-line"><span>平均折算达成率</span><b class="site-rate">{{ totalSiteRate }}</b></div>
            </div>
          </div>
        </article>
      </section>
    </div>
  </AppLayout>
</template>

<style scoped>
.summary-page { display: flex; flex-direction: column; gap: 1rem; }
.back { font-size: .95rem; }
.state { padding: 3rem 1rem; text-align: center; color: var(--muted); border: 1px solid var(--border); border-radius: var(--radius-sm); background: #fff; }
.state.error { color: #dc2626; }
.factory-comparison { display: flex; flex-direction: column; gap: 1.15rem; }
.factory-summary { display: flex; flex-direction: column; gap: .55rem; }
.factory-name { margin: 0; padding: .15rem .25rem .45rem; border-bottom: 3px solid #84cc16; color: #1f2937; font-size: 1.1rem; word-break: break-word; }
.total-summary { margin-top: .8rem; padding-top: 1rem; border-top: 2px solid #4f46e5; }
.total-name { color: #3730a3; border-bottom-color: #4f46e5; font-size: 1.2rem; }
.total-summary .metric-card { box-shadow: 0 5px 16px rgba(79, 70, 229, .08); }
.metrics-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .85rem; }
.metric-card { --accent: #4f46e5; min-height: 210px; border: 1px solid var(--border); border-top: 4px solid var(--accent); border-bottom: 4px solid var(--accent); border-radius: 8px; overflow: hidden; background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 7%, #fff), #fff 42%); }
.metric-card h4 { display: flex; align-items: center; gap: .55rem; margin: 0 0 .7rem; padding: .85rem 1rem; color: var(--accent); border-bottom: 1px solid color-mix(in srgb, var(--accent) 18%, #fff); font-size: 1.15rem; }
.metric-icon { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 7px; background: color-mix(in srgb, var(--accent) 14%, #fff); }
.metric-line { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; padding: .2rem 1.1rem; font-size: 1.05rem; }
.metric-line b { font-size: 1.1rem; }
.metric-line.highlight, .metric-line.highlight b { color: #dc2626; }
.metric-line .site-rate { color: #4f46e5; font-size: 1.25rem; }
.price-card { --accent: #4f46e5; }
.delivery-card { --accent: #d97706; }
.quality-card { --accent: #0d9488; }
.site-card { --accent: #16a34a; }
@media (max-width: 1050px) { .metrics-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 620px) { .metrics-grid { grid-template-columns: 1fr; } }
</style>
