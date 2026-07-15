<script setup lang="ts">
import { ref, computed } from 'vue'
import { RouterLink } from 'vue-router'
import AppLayout from '../components/AppLayout.vue'
import { useFactoriesStore, filterByCraft } from '../stores/factories'
import { useScoresStore } from '../stores/scores'
import { allowedCrafts } from '../utils/permissions'
import { CRAFT_LABELS, type Craft } from '../constants/roles'
import type { MonthlyScore } from '../types/score'

const month = ref(new Date().toISOString().slice(0, 7))
const factories = useFactoriesStore()
const scores = useScoresStore()
const deptFilter = ref('')

const gradeCls: Record<string, string> = { A: 'badge-A', B: 'badge-B', C: 'badge-C', D: 'badge-D' }
const statusLabel: Record<string, string> = { draft: '草稿', submitted: '已提交', approved: '已审批' }
const flagLabel: Record<string, string> = { yellow: '黄牌', red: '红牌' }

const scoreByFactory = computed(() => {
  const m: Record<string, MonthlyScore> = {}
  for (const s of scores.items) m[s.factory] = s
  return m
})

const rows = computed(() => {
  let list = filterByCraft(factories.items, null).filter((f) => allowedCrafts().includes(f.craft))
  if (deptFilter.value) list = list.filter((f) => f.craft === deptFilter.value)
  return list
})

async function load() {
  await Promise.all([factories.fetchAll(), scores.fetchByMonth(month.value)])
}
load()
</script>
<template>
  <AppLayout>
    <div class="page">
      <div class="toolbar">
        <h2 style="margin:0">工厂月度评分</h2>
        <span class="muted">{{ month }}</span>
        <span class="spacer"></span>
        <select v-model="deptFilter">
          <option value="">全部部门</option>
          <option v-for="craft in allowedCrafts()" :key="craft" :value="craft">{{ CRAFT_LABELS[craft as Craft] }}</option>
        </select>
        <label>月份 <input v-model="month" type="month" @change="load" /></label>
      </div>
      <table>
        <thead><tr><th>工厂</th><th>部门</th><th>总分</th><th>等级</th><th>红黄牌</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="f in rows" :key="f.id">
            <td>{{ f.name }}</td>
            <td class="muted">{{ CRAFT_LABELS[f.craft] }}</td>
            <td><strong v-if="scoreByFactory[f.id]?.total_score != null">{{ scoreByFactory[f.id].total_score }}</strong><span v-else class="muted">—</span></td>
            <td>
              <span v-if="scoreByFactory[f.id]?.grade" class="badge" :class="gradeCls[scoreByFactory[f.id].grade!]">{{ scoreByFactory[f.id].grade }}</span>
              <span v-else class="muted">—</span>
            </td>
            <td>
              <span v-if="scoreByFactory[f.id] && scoreByFactory[f.id].flag !== 'none'" class="badge" :class="'flag-' + scoreByFactory[f.id].flag">{{ flagLabel[scoreByFactory[f.id].flag] }}</span>
              <span v-else class="muted">—</span>
            </td>
            <td>
              <span class="badge" :class="scoreByFactory[f.id]?.status === 'approved' ? 'status-active' : scoreByFactory[f.id]?.status === 'submitted' ? 'badge-B' : 'status-eliminated'">
                {{ statusLabel[scoreByFactory[f.id]?.status ?? 'draft'] }}
              </span>
            </td>
            <td><RouterLink :to="`/factories/${f.id}/score/${month}`"><button class="ghost mini">评分 →</button></RouterLink></td>
          </tr>
          <tr v-if="!rows.length"><td colspan="7" class="hint" style="text-align:center">暂无工厂</td></tr>
        </tbody>
      </table>
    </div>
  </AppLayout>
</template>
<style scoped>
.mini { padding: .25rem .6rem; font-size: .8rem; }
</style>
