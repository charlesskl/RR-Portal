<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import AppLayout from '../components/AppLayout.vue'
import DelayedOrderTable from '../components/DelayedOrderTable.vue'
import { useOrdersStore } from '../stores/orders'
import { useFactoriesStore } from '../stores/factories'
import { useAuthStore } from '../stores/auth'
import { allowedCrafts, allowedRegions } from '../utils/permissions'
import { REGIONS, REGION_LABELS, CRAFT_LABELS, type Region, type Craft } from '../constants/roles'
import type { Order } from '../types/order'
import { buildDelayedSections } from '../utils/delayedOrders'
import { matchesOrderDate, type OrderDateFilter } from '../utils/orderDateFilter'
import { factoryTaxPointFactors } from '../utils/taxPoint'
const route = useRoute()
const orders = useOrdersStore()
const factories = useFactoriesStore()
const auth = useAuthStore()
const source = shallowRef<Order[]>([])
const loading = ref(false)
const error = ref('')
const department = ref<Craft | ''>('')
const region = computed(() => route.params.region as Region)
const crafts = computed(() => allowedCrafts().filter((c) => c !== 'electronics' || region.value !== 'heyuan'))
const dateMode = ref<'all' | 'month' | 'range'>('all')
const selectedMonth = ref('')
const rangeStart = ref('')
const rangeEnd = ref('')
const exporting = ref(false)
const exportError = ref('')
const dateError = computed(() => dateMode.value === 'range' && rangeStart.value && rangeEnd.value && rangeStart.value > rangeEnd.value ? '开始日期不能晚于结束日期' : '')
const dateFilter = computed<OrderDateFilter>(() => dateMode.value === 'month' ? { mode: 'month', month: selectedMonth.value } : dateMode.value === 'range' ? { mode: 'range', start: rangeStart.value, end: rangeEnd.value } : { mode: 'all' })
const filteredSource = computed(() => dateError.value ? [] : source.value.filter((o) => matchesOrderDate(o.order_date, dateFilter.value)))
const sections = computed(() => buildDelayedSections(filteredSource.value, region.value, crafts.value, factoryTaxPointFactors(factories.items)))
const visibleSections = computed(() => sections.value.filter((s) => !department.value || s.craft === department.value))
const canExport = computed(() => !loading.value && !error.value && !dateError.value && !exporting.value && visibleSections.value.some((s) => s.count))
async function exportExcel() {
  if (!canExport.value) return
  exporting.value = true
  exportError.value = ''
  const snapshot = visibleSections.value.filter((s) => s.count)
  const regionName = REGION_LABELS[region.value]
  const period = dateMode.value === 'month' ? selectedMonth.value || '全部日期' : dateMode.value === 'range' ? `${rangeStart.value || '不限'}至${rangeEnd.value || '不限'}` : '全部日期'
  const userId = auth.userId
  try {
    const { downloadDelayedOrdersExcel } = await import('../utils/delayedOrdersExcel')
    if (userId !== auth.userId) throw new Error('登录账号已变更，请重新导出')
    downloadDelayedOrdersExcel(snapshot, regionName, period)
  } catch (cause) {
    exportError.value = cause instanceof Error ? cause.message : '导出失败，请重试'
  } finally { exporting.value = false }
}
let request = 0
async function load() {
  const current = ++request
  source.value = []
  error.value = ''
  loading.value = true
  try {
    if (!REGIONS.includes(region.value) || !auth.role || !allowedRegions(auth.role).includes(region.value)) throw new Error('无权查看此厂区')
    const userId = auth.userId
    const selectedRegion = region.value
    const [groups] = await Promise.all([Promise.all(crafts.value.map((c) => orders.fetchForScope(c, selectedRegion, { force: true }))), factories.fetchAll()])
    if (current !== request) return
    if (userId !== auth.userId) throw new Error('登录账号已变更，请重新读取')
    source.value = groups.flat()
  } catch (cause) {
    if (current === request) error.value = cause instanceof Error ? cause.message : '读取失败，请重试'
  } finally { if (current === request) loading.value = false }
}
watch([region, () => auth.userId], () => { department.value = ''; void load() }, { immediate: true })
</script>
<template>
  <AppLayout><div class="page">
    <RouterLink to="/orders">← 返回货期管理</RouterLink>
    <div class="toolbar"><h2>{{ REGION_LABELS[region] }}厂区 · 汇总延期订单</h2><span class="spacer"></span>
      <label>时间筛选 <select v-model="dateMode" aria-label="下单日期筛选方式"><option value="all">全部日期</option><option value="month">按月份</option><option value="range">按时间段</option></select></label>
      <input v-if="dateMode === 'month'" v-model="selectedMonth" type="month" aria-label="选择月份" />
      <template v-if="dateMode === 'range'"><input v-model="rangeStart" type="date" :max="rangeEnd || undefined" aria-label="开始日期" /><span>至</span><input v-model="rangeEnd" type="date" :min="rangeStart || undefined" aria-label="结束日期" /></template>
      <button :disabled="!canExport" @click="exportExcel">{{ exporting ? '导出中…' : '导出 Excel' }}</button>
      <label>部门 <select v-model="department"><option value="">全部部门</option><option v-for="craft in crafts" :key="craft" :value="craft">{{ CRAFT_LABELS[craft] }}</option></select></label>
      <button class="ghost" :disabled="loading" @click="load">{{ loading ? '读取中…' : '刷新汇总' }}</button>
    </div>
    <p class="muted">按厂区、部门、下单PMC、加工厂汇总。仅统计已保存的“延迟时间 ≥ 1”的订单，不按日期自动推算，已取消订单不计入。单数按同组订单号去重，占比以本表延期订单为基数。时间筛选按下单时间，起止日期均包含当天；导出包含当前筛选下所有页的数据。</p>
    <p v-if="dateError" role="alert" class="error">{{ dateError }}</p>
    <p v-if="exportError" role="alert" class="error">{{ exportError }}</p>
    <p v-if="loading" role="status">正在读取完整订单数据，请稍候…</p>
    <p v-else-if="error" role="alert" class="error">{{ error }} <button class="ghost mini" @click="load">重试</button></p>
    <template v-else><DelayedOrderTable v-for="section in visibleSections" :key="section.craft" :section="section" :region-name="REGION_LABELS[region]" /></template>
  </div></AppLayout>
</template>
<style scoped>
.error { color: #b91c1c; }
select, input { padding: 7px 12px; border: 1px solid var(--border); border-radius: 6px; background: white; }
.muted { line-height: 1.7; font-size: 13px; }
</style>
