<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import AppLayout from '../components/AppLayout.vue'
import { useKpiStore } from '../stores/kpi'
import { groupByUser, onTimeRate } from '../utils/kpi'

const month = ref(new Date().toISOString().slice(0, 7))
const kpi = useKpiStore()

onMounted(() => kpi.fetchByMonth(month.value))
const grouped = computed(() => groupByUser(kpi.items))
const userIds = computed(() => Object.keys(grouped.value))

function nameOf(userId: string): string {
  const log = kpi.items.find((l) => l.user === userId) as any
  return log?.expand?.user?.display_name ?? userId
}
</script>
<template>
  <AppLayout>
    <div class="page">
    <div class="toolbar">
      <h2 style="margin:0">岗位 KPI 看板</h2>
      <span class="spacer"></span>
      <label>月份 <input v-model="month" type="month" @change="kpi.fetchByMonth(month)" /></label>
    </div>
    <table>
      <thead><tr><th>岗位/人员</th><th>履职次数</th><th>按时率</th></tr></thead>
      <tbody>
        <tr v-for="userId in userIds" :key="userId">
          <td>{{ nameOf(userId) }}</td>
          <td>{{ grouped[userId].length }}</td>
          <td>{{ onTimeRate(grouped[userId]) }}%</td>
        </tr>
      </tbody>
    </table>
    <p v-if="!userIds.length" class="hint">该月暂无履职记录</p>
    </div>
  </AppLayout>
</template>
