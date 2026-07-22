<script setup lang="ts">
import { ref, computed } from 'vue'
import { RouterLink } from 'vue-router'
import AppLayout from '../components/AppLayout.vue'
import { useFactoriesStore, filterByCraft } from '../stores/factories'
import { useScoresStore } from '../stores/scores'
import { useScoreTemplatesStore } from '../stores/scoreTemplates'
import { useAuthStore } from '../stores/auth'
import { pb } from '../pb'
import { filterMonthlyScoringData, mergeAutomaticScores } from '../utils/monthlyAutoScoring'
import { allowedCrafts, allowedRegions } from '../utils/permissions'
import { CRAFT_LABELS, REGION_LABELS, regionOf, REGIONS, type Craft, type Region } from '../constants/roles'
import type { MonthlyScore } from '../types/score'
import type { Order } from '../types/order'
import type { QualityInspection } from '../types/qualityInspection'
import type { Quality5sCheck } from '../types/quality5s'

const month = ref(new Date().toISOString().slice(0, 7))
const factories = useFactoriesStore()
const scores = useScoresStore()
const templates = useScoreTemplatesStore()
const auth = useAuthStore()
const deptFilter = ref('')
const regionFilter = ref<Region | ''>('')
const search = ref('')
const autoScoring = ref(false)
const autoProgress = ref('')
const myRegions = computed(() => (auth.role ? allowedRegions(auth.role) : REGIONS))

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
  list = list.filter((f) => myRegions.value.includes(regionOf(f)))
  if (regionFilter.value) list = list.filter((f) => regionOf(f) === regionFilter.value)
  if (deptFilter.value) list = list.filter((f) => f.craft === deptFilter.value)
  const query = search.value.trim().toLowerCase()
  if (query) list = list.filter((f) => f.name.toLowerCase().includes(query))
  return list
})

async function load() {
  await Promise.all([factories.fetchAll(), scores.fetchByMonth(month.value), templates.fetchAll()])
}

async function calculateMonthScores() {
  autoScoring.value = true
  autoProgress.value = '读取货期和品质数据...'
  try {
    const [orders, inspections, checks] = await Promise.all([
      pb.collection('orders').getFullList<Order>(),
      pb.collection('quality_inspections').getFullList<QualityInspection>(),
      pb.collection('quality_5s_checks').getFullList<Quality5sCheck>(),
    ])
    const existing = scoreByFactory.value
    let saved = 0
    let skipped = 0
    for (let index = 0; index < rows.value.length; index += 1) {
      const factory = rows.value[index]
      const current = existing[factory.id]
      if (current && current.status !== 'draft') {
        skipped += 1
        continue
      }
      autoProgress.value = `正在计算 ${index + 1}/${rows.value.length}：${factory.name}`
      const monthlyData = filterMonthlyScoringData({
        orders: orders.filter((item) => item.factory === factory.id),
        inspections: inspections.filter((item) => item.factory === factory.id),
        checks: checks.filter((item) => item.factory === factory.id),
      }, month.value)
      const scoreItems = mergeAutomaticScores(
        templates.applicable(factory.craft),
        current?.score_items ?? [],
        factory,
        monthlyData,
      )
      await scores.save(factory.id, month.value, { score_items: scoreItems, status: 'draft' })
      saved += 1
    }
    await scores.fetchByMonth(month.value)
    autoProgress.value = `自动评分完成：更新 ${saved} 家${skipped ? `，跳过已提交/已审批 ${skipped} 家` : ''}`
  } catch (error) {
    autoProgress.value = `自动评分失败：${error instanceof Error ? error.message : '未知错误'}`
  } finally {
    autoScoring.value = false
  }
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
        <input v-model="search" class="factory-search" placeholder="搜索工厂名称" />
        <select v-model="regionFilter">
          <option value="">全部厂区</option>
          <option v-for="region in myRegions" :key="region" :value="region">{{ REGION_LABELS[region] }}厂区</option>
        </select>
        <select v-model="deptFilter">
          <option value="">全部部门</option>
          <option v-for="craft in allowedCrafts()" :key="craft" :value="craft">{{ CRAFT_LABELS[craft as Craft] }}</option>
        </select>
        <label>月份 <input v-model="month" type="month" @change="load" /></label>
        <button class="ghost" :disabled="autoScoring" @click="calculateMonthScores">
          {{ autoScoring ? '自动评分中...' : '自动计算本月评分' }}
        </button>
      </div>
      <p v-if="autoProgress" class="auto-progress">{{ autoProgress }}</p>
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
.auto-progress { margin: .6rem 0; color: var(--text-soft); font-size: .88rem; }
.factory-search { width: 190px; min-width: 150px; }
</style>
