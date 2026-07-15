<script setup lang="ts">
import { ref, computed } from 'vue'
import AppLayout from '../components/AppLayout.vue'
import { useFactoriesStore } from '../stores/factories'
import { useOutputStore } from '../stores/output'
import { useOrdersStore } from '../stores/orders'
import { useAuthStore } from '../stores/auth'
import { allowedCrafts, allowedRegions } from '../utils/permissions'
import { CRAFT_LABELS, REGION_LABELS, regionOf, type Craft, type Region } from '../constants/roles'

const month = ref(new Date().toISOString().slice(0, 7))
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
  return factories.items.filter((f) => {
    if (!myRegions.value.includes(regionOf(f))) return false
    if (!allowedCrafts().includes(f.craft)) return false
    if (regionFilter.value && regionOf(f) !== regionFilter.value) return false
    if (deptFilter.value && f.craft !== deptFilter.value) return false
    if (!kw) return true
    return f.name.toLowerCase().includes(kw) || (CRAFT_LABELS[f.craft] ?? '').includes(kw)
  })
})

function exportExcel() {
  const header = ['工厂', '厂区', '部门', '当月产值', '对账单号']
  const rows = [header]
  for (const f of filteredFactories.value) {
    rows.push([
      f.name,
      REGION_LABELS[regionOf(f)],
      CRAFT_LABELS[f.craft] ?? '',
      String(outputByFactory.value[f.id] ?? 0),
      drafts.value[f.id]?.source_doc ?? '',
    ])
  }
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `月度产值_${month.value}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// 各工厂当月产值 = 货期管理中 order_date 落在所选月份的订单金额之和（只读，自动汇总）
const outputByFactory = computed(() => {
  const map: Record<string, number> = {}
  for (const o of orders.items) {
    if (!o.order_date || o.order_date.slice(0, 7) !== month.value) continue
    map[o.factory] = (map[o.factory] ?? 0) + (Number(o.amount) || 0)
  }
  return map
})

async function load() {
  await Promise.all([factories.fetchAll(), output.fetchByMonth(month.value), orders.fetchAll()])
  drafts.value = {}
  const existing = new Map(output.items.map((o) => [o.factory, o]))
  for (const f of factories.items) {
    drafts.value[f.id] = { source_doc: existing.get(f.id)?.source_doc }
  }
}
load()

async function save(factoryId: string) {
  await output.upsert({
    factory: factoryId,
    year_month: month.value,
    monthly_amount: outputByFactory.value[factoryId] ?? 0, // 自动取订单合计
    source_doc: drafts.value[factoryId]?.source_doc,
    entered_by: auth.userId ?? undefined,
    entered_at: new Date().toISOString(),
  })
  await output.fetchByMonth(month.value)
}
</script>
<template>
  <AppLayout>
    <div class="page">
    <h2>月度产值管理</h2>
    <div class="toolbar">
      <label>月份 <input v-model="month" type="month" @change="load" /></label>
      <button @click="load">加载</button>
      <span class="muted">当月产值由「货期管理」订单金额自动汇总，不可手动修改</span>
      <span class="spacer"></span>
      <select v-model="regionFilter">
        <option value="">全部厂区</option>
        <option v-for="rg in myRegions" :key="rg" :value="rg">{{ REGION_LABELS[rg] }}厂区</option>
      </select>
      <select v-model="deptFilter">
        <option value="">全部部门</option>
        <option v-for="craft in allowedCrafts()" :key="craft" :value="craft">{{ CRAFT_LABELS[craft as Craft] }}</option>
      </select>
      <input v-model="search" placeholder="搜索工厂 / 部门" />
      <button class="ghost" @click="exportExcel">导出 Excel</button>
    </div>
    <table>
      <thead><tr><th>工厂</th><th>厂区</th><th>部门</th><th>当月产值（订单金额汇总）</th><th>对账单号</th><th></th></tr></thead>
      <tbody>
        <tr v-for="f in filteredFactories" :key="f.id">
          <td>{{ f.name }}</td>
          <td class="muted">{{ REGION_LABELS[regionOf(f)] }}</td>
          <td class="muted">{{ CRAFT_LABELS[f.craft] }}</td>
          <td><span class="amount">{{ (outputByFactory[f.id] ?? 0).toLocaleString() }}</span></td>
          <td><input v-model="(drafts[f.id] ??= {}).source_doc" placeholder="对账单号" /></td>
          <td><button @click="save(f.id)">保存</button></td>
        </tr>
      </tbody>
    </table>
    </div>
  </AppLayout>
</template>
<style scoped>
.amount { font-weight: 600; font-size: 1rem; }
</style>
