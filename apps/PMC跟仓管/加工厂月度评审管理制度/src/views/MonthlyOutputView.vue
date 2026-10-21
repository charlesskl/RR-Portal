<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import AppLayout from '../components/AppLayout.vue'
import { useFactoriesStore } from '../stores/factories'
import { useOutputStore } from '../stores/output'
import { useOrdersStore } from '../stores/orders'
import { useAuthStore } from '../stores/auth'
import { pb } from '../pb'
import { allowedCrafts, allowedRegions } from '../utils/permissions'
import { CRAFT_LABELS, REGION_LABELS, regionOf, type Craft, type Region } from '../constants/roles'

import { outputPeriod, outputAmounts, type OutputPeriod, type OutputPeriodMode } from '../utils/outputPeriod'
import type { Order } from '../types/order'
import type { MonthlyOutput } from '../types/output'
import type { Factory } from '../types/factory'

const month = ref(new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' }).format(new Date()))
const mode = ref<OutputPeriodMode>('month')
const year = ref(month.value.slice(0, 4))
const quarter = ref(Math.ceil(Number(month.value.slice(5)) / 3))
const startMonth = ref(month.value)
const endMonth = ref(month.value)
const period = computed(() => {
  try { return { range: outputPeriod(mode.value, month.value, year.value, quarter.value, startMonth.value, endMonth.value), error: '' } }
  catch (e) { return { range: null, error: (e as Error).message } }
})
const loadedRange = ref<OutputPeriod | null>(null)
const loadedOrders = ref<Order[]>([])
const loadedFactories = ref<Factory[]>([])
const loadedOutputs = ref<MonthlyOutput[]>([])
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const message = ref('')
let request = 0
const stopAuth = pb.authStore.onChange(() => {
  // The page owns snapshots, so clearing only the shared stores is insufficient.
  request++
  clearSnapshot()
  loading.value = false
  error.value = '账号或权限已变更，请重新查询。'
})
onBeforeUnmount(() => { request++; stopAuth() })
const singleMonth = computed(() => loadedRange.value?.start === loadedRange.value?.end)
const rangeLabel = computed(() => !loadedRange.value ? '' : singleMonth.value ? loadedRange.value.start : `${loadedRange.value.start} 至 ${loadedRange.value.end}`)
const ready = computed(() => !!loadedRange.value && !loading.value && !error.value && !period.value.error)
const formatAmount = (value: number) => value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const factories = useFactoriesStore()
const output = useOutputStore()
const orders = useOrdersStore()
const auth = useAuthStore()
const drafts = ref<Record<string, { source_doc?: string }>>({})
const search = ref('')
const deptFilter = ref('')
const myRegions = computed(() => (auth.role ? allowedRegions(auth.role) : ['dongguan', 'hunan', 'heyuan'] as Region[]))
const regionFilter = ref<Region | ''>('')

// 按厂区/部门/工厂名搜索过滤（受授权厂区限制）
const filteredFactories = computed(() => {
  const kw = search.value.trim().toLowerCase()
  return loadedFactories.value
    .filter((f) => {
      if (!myRegions.value.includes(regionOf(f))) return false
      if (!allowedCrafts().includes(f.craft)) return false
      if (regionFilter.value && regionOf(f) !== regionFilter.value) return false
      if (deptFilter.value && f.craft !== deptFilter.value) return false
      if (!kw) return true
      return f.name.toLowerCase().includes(kw) || (CRAFT_LABELS[f.craft] ?? '').includes(kw)
    })
    .sort((a, b) => {
      const amountDiff = (outputByFactory.value[b.id] ?? 0) - (outputByFactory.value[a.id] ?? 0)
      return amountDiff || a.name.localeCompare(b.name, 'zh-CN')
    })
})

function exportExcel() {
  if (!ready.value || saving.value) return
  const header = ['统计开始月份', '统计结束月份', '工厂', '厂区', '部门', '期间产值', '对账单号']
  const rows = [header]
  for (const f of filteredFactories.value) {
    rows.push([
      loadedRange.value!.start, loadedRange.value!.end, f.name,
      REGION_LABELS[regionOf(f)],
      CRAFT_LABELS[f.craft] ?? '',
      String(outputByFactory.value[f.id] ?? 0),
      singleMonth.value ? drafts.value[f.id]?.source_doc ?? '' : sourceDocs(f.id),
    ])
  }
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `产值_${loadedRange.value!.start}_${loadedRange.value!.end}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// Preserve the existing order-date/amount basis, using a completed request snapshot.
const outputByFactory = computed(() => loadedRange.value ? outputAmounts(loadedOrders.value, loadedRange.value) : {})
const total = computed(() => filteredFactories.value.reduce((sum, f) => sum + (outputByFactory.value[f.id] || 0), 0))
function sourceDocs(factoryId: string) {
  return loadedOutputs.value.filter(o => o.factory === factoryId && o.source_doc).sort((a,b) => a.year_month.localeCompare(b.year_month))
    .map(o => `${o.year_month}：${o.source_doc}`).join('\n')
}
function clearSnapshot() {
  loadedRange.value = null; loadedOrders.value = []; loadedOutputs.value = []; loadedFactories.value = []; drafts.value = {}
}
async function load() {
  const id = ++request
  const range = period.value.range
  clearSnapshot(); error.value = ''; message.value = ''
  if (!range || !auth.userId) { loading.value = false; return }
  loading.value = true
  try {
    const [factoryRecords, outputs, records] = await Promise.all([
      factories.fetchAll(), output.fetchByRange(range.start, range.end), orders.fetchAll(undefined, { force: true }),
    ])
    if (id !== request) return
    loadedFactories.value = factoryRecords
    loadedOrders.value = records
    loadedOutputs.value = outputs
    loadedRange.value = { ...range }
    if (range.start === range.end) for (const o of outputs) drafts.value[o.factory] = { source_doc: o.source_doc }
  } catch { if (id === request) error.value = '产值数据加载失败，请重新查询。' }
  finally { if (id === request) loading.value = false }
}
watch([mode, month, year, quarter, startMonth, endMonth, () => auth.userId, () => auth.role], () => { void load() }, { immediate: true, flush: 'sync' })
async function save(factoryId: string) {
  if (!ready.value || !singleMonth.value || saving.value || !filteredFactories.value.some(f => f.id === factoryId)) return
  const range = loadedRange.value!
  const id = request
  saving.value = true; message.value = ''
  try {
    await output.upsert({ factory: factoryId, year_month: range.start, monthly_amount: outputByFactory.value[factoryId] ?? 0,
      source_doc: drafts.value[factoryId]?.source_doc, entered_by: auth.userId ?? undefined, entered_at: new Date().toISOString() })
    if (id === request) message.value = '对账单号已保存。'
  } catch { if (id === request) message.value = '保存失败，请重试。' }
  finally { saving.value = false }
}
</script>
<template>
  <AppLayout>
    <div class="page">
    <h2>产值管理</h2>
    <div class="toolbar">
      <label>查询方式<select v-model="mode" :disabled="saving" aria-label="查询方式"><option value="month">单月</option><option value="quarter">季度</option><option value="year">全年</option><option value="custom">自定义月份</option></select></label>
      <label v-if="mode === 'month'">月份<input v-model="month" type="month" :disabled="saving" /></label>
      <template v-if="mode === 'quarter' || mode === 'year'">
        <label>年份<input v-model="year" type="number" min="1000" max="9999" :disabled="saving" aria-label="年份" /></label>
        <label v-if="mode === 'quarter'">季度<select v-model="quarter" :disabled="saving" aria-label="季度"><option v-for="q in 4" :key="q" :value="q">第{{ q }}季度（{{ q * 3 - 2 }}—{{ q * 3 }}月）</option></select></label>
      </template>
      <template v-if="mode === 'custom'"><label>开始月份<input v-model="startMonth" type="month" :disabled="saving" aria-label="开始月份" /></label><label>结束月份<input v-model="endMonth" type="month" :disabled="saving" aria-label="结束月份" /></label></template>
      <button :disabled="loading || saving || !!period.error" @click="load">{{ loading ? '查询中…' : '查询' }}</button>
      <span class="spacer"></span>
      <select v-model="regionFilter" aria-label="厂区">
        <option value="">全部厂区</option>
        <option v-for="rg in myRegions" :key="rg" :value="rg">{{ REGION_LABELS[rg] }}厂区</option>
      </select>
      <select v-model="deptFilter" aria-label="部门">
        <option value="">全部部门</option>
        <option v-for="craft in allowedCrafts()" :key="craft" :value="craft">{{ CRAFT_LABELS[craft as Craft] }}</option>
      </select>
      <input v-model="search" placeholder="搜索工厂 / 部门" />
      <button class="ghost" :disabled="!ready || saving" @click="exportExcel">导出 Excel</button>
    </div>
    <p class="muted">按「货期管理」的订单日期统计，包含所选起止月份，金额自动汇总。</p>
    <p v-if="period.error || error" role="alert" class="error">{{ period.error || error }}</p>
    <p v-if="loading" role="status">正在加载产值…</p>
    <p v-if="message" role="status">{{ message }}</p>
    <template v-if="ready">
    <p class="period-summary">统计期间：{{ rangeLabel }} · 当前筛选 {{ filteredFactories.length }} 家工厂 · 产值合计：<strong>{{ formatAmount(total) }}</strong></p>
    <p v-if="!singleMonth" class="muted">多月查询显示各月对账单号；需要修改时请选择对应单月。</p>
    <div class="output-scroll"><table>
      <thead><tr><th>工厂</th><th>厂区</th><th>部门</th><th>{{ singleMonth ? '当月产值' : '期间产值' }}（订单金额汇总）</th><th>对账单号</th><th v-if="singleMonth">操作</th></tr></thead>
      <tbody>
        <tr v-for="f in filteredFactories" :key="f.id">
          <td>{{ f.name }}</td>
          <td class="muted">{{ REGION_LABELS[regionOf(f)] }}</td>
          <td class="muted">{{ CRAFT_LABELS[f.craft] }}</td>
          <td><span class="amount">{{ formatAmount(outputByFactory[f.id] ?? 0) }}</span></td>
          <td><input v-if="singleMonth" v-model="(drafts[f.id] ??= {}).source_doc" :disabled="saving" :aria-label="`${f.name}对账单号`" placeholder="对账单号" /><span v-else class="source-docs">{{ sourceDocs(f.id) || '—' }}</span></td>
          <td v-if="singleMonth"><button :disabled="saving" @click="save(f.id)">保存</button></td>
        </tr>
        <tr v-if="!filteredFactories.length"><td :colspan="singleMonth ? 6 : 5">暂无符合筛选条件的工厂。</td></tr>
      </tbody>
      <tfoot><tr><th colspan="3">合计</th><td class="amount">{{ formatAmount(total) }}</td><td :colspan="singleMonth ? 2 : 1"></td></tr></tfoot>
    </table></div>
    </template>
    </div>
  </AppLayout>
</template>
<style scoped>
.toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; }
.toolbar label { display: flex; flex-direction: column; gap: 6px; }
.toolbar input[type=number] { width: 110px; }
.output-scroll { overflow: auto; }
.output-scroll table { min-width: 750px; width: 100%; }
.source-docs { white-space: pre-wrap; }
.error { color: #b42318; }
.period-summary { padding: 14px; background: #eef0ff; border-radius: 8px; }
.amount { font-weight: 600; font-size: 1rem; }
</style>
