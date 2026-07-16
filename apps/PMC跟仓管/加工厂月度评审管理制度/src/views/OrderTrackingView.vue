<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import AppLayout from '../components/AppLayout.vue'
import { useOrdersStore } from '../stores/orders'
import { CRAFT_LABELS } from '../constants/roles'
import { allowedCrafts } from '../utils/permissions'
import type { Order } from '../types/order'

const orders = useOrdersStore()
const deptFilter = ref('')
const qualityFilter = ref('') // ''=全部, abnormal=仅异常
const search = ref('')

const STATUS: Record<string, { label: string; cls: string }> = {
  placed: { label: '已下单', cls: 'status-limited' },
  producing: { label: '生产中', cls: 'badge-B' },
  delivered: { label: '已交货', cls: 'status-active' },
  cancelled: { label: '已取消', cls: 'status-eliminated' },
  returned: { label: '退货', cls: 'flag-red' },
}

onMounted(() => orders.fetchAll())

// 合格率 =(抽检-不良)/抽检
function passRate(o: Order): number | null {
  const n = Number(o.inspect_count) || 0
  if (n <= 0) return null
  const bad = Number(o.defect_count) || 0
  return Math.round(((n - bad) / n) * 1000) / 10
}
// 异常：有不良/问题点 且 未解决
function isAbnormal(o: Order): boolean {
  const hasIssue = (Number(o.defect_count) || 0) > 0 || !!o.quality_issues || o.status === 'returned'
  return hasIssue && !o.is_resolved
}

async function patch(o: Order, data: Partial<Order>) {
  await orders.update(o.id, data)
  await orders.fetchAll()
}
function onNum(o: Order, key: 'inspect_count' | 'defect_count', ev: Event) {
  const raw = (ev.target as HTMLInputElement).value
  patch(o, { [key]: raw === '' ? undefined : Number(raw) })
}
function onResolved(o: Order, ev: Event) {
  patch(o, { is_resolved: (ev.target as HTMLSelectElement).value === 'true' })
}
function onIssues(o: Order, ev: Event) {
  patch(o, { quality_issues: (ev.target as HTMLInputElement).value })
}

const rows = computed(() => {
  const kw = search.value.trim().toLowerCase()
  return orders.items.filter((o) => {
    if (deptFilter.value && o.expand?.factory?.craft !== deptFilter.value) return false
    if (qualityFilter.value === 'abnormal' && !isAbnormal(o)) return false
    if (!kw) return true
    const hay = `${o.expand?.factory?.name ?? ''} ${o.product ?? ''} ${o.item_no ?? ''}`.toLowerCase()
    return hay.includes(kw)
  })
})
const abnormalCount = computed(() => rows.value.filter(isAbnormal).length)
function dept(o: Order) { const c = o.expand?.factory?.craft; return c ? CRAFT_LABELS[c as keyof typeof CRAFT_LABELS] : '' }
</script>
<template>
  <AppLayout>
    <div class="page">
      <div class="toolbar">
        <h2 style="margin:0">品质管理</h2>
        <span class="muted">共 {{ rows.length }} 单<span v-if="abnormalCount" class="ab"> · {{ abnormalCount }} 单异常</span></span>
        <span class="spacer"></span>
        <select v-model="deptFilter">
          <option value="">全部部门</option>
          <option v-for="craft in allowedCrafts()" :key="craft" :value="craft">{{ CRAFT_LABELS[craft] }}</option>
        </select>
        <select v-model="qualityFilter">
          <option value="">全部品质</option>
          <option value="abnormal">仅看异常</option>
        </select>
        <input v-model="search" placeholder="搜索工厂/产品/货号" />
      </div>
      <table>
        <thead><tr>
          <th>工厂</th><th>部门</th><th>货号</th><th>产品</th><th>状态</th>
          <th>来料抽检单数</th><th>不良单数</th><th>合格率</th><th>是否已解决</th><th>外发/品质巡查问题点</th>
        </tr></thead>
        <tbody>
          <tr v-for="o in rows" :key="o.id" :class="{ abnormal: isAbnormal(o) }">
            <td>{{ o.expand?.factory?.name ?? '-' }}</td>
            <td class="muted">{{ dept(o) }}</td>
            <td>{{ o.item_no || '-' }}</td>
            <td>{{ o.product }}</td>
            <td><span class="badge" :class="STATUS[o.status ?? 'placed']?.cls">{{ STATUS[o.status ?? 'placed']?.label }}</span></td>
            <td><input class="num" :value="o.inspect_count ?? ''" type="number" min="0" placeholder="-" @change="onNum(o, 'inspect_count', $event)" /></td>
            <td><input class="num" :value="o.defect_count ?? ''" type="number" min="0" placeholder="-" @change="onNum(o, 'defect_count', $event)" /></td>
            <td><strong v-if="passRate(o) != null" :class="{ low: (passRate(o) ?? 100) < 95 }">{{ passRate(o) }}%</strong><span v-else class="muted">-</span></td>
            <td>
              <select class="resolved" :value="String(o.is_resolved ?? false)" @change="onResolved(o, $event)">
                <option value="false">否</option>
                <option value="true">是</option>
              </select>
            </td>
            <td><input class="issues" :value="o.quality_issues ?? ''" placeholder="问题点" @change="onIssues(o, $event)" /></td>
          </tr>
          <tr v-if="!rows.length"><td colspan="10" class="hint" style="text-align:center">暂无订单</td></tr>
        </tbody>
      </table>
    </div>
  </AppLayout>
</template>
<style scoped>
.ab { color: var(--grade-d); font-weight: 600; }
.abnormal td { background: #fff6f6 !important; }
.num { width: 70px; padding: .3rem .4rem; font-size: .85rem; }
.resolved { padding: .25rem .4rem; font-size: .82rem; }
.issues { width: 160px; padding: .3rem .5rem; font-size: .85rem; }
.low { color: var(--grade-d); }
</style>
