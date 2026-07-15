<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import AppLayout from '../components/AppLayout.vue'
import { useScoresStore } from '../stores/scores'
import { useFactoriesStore } from '../stores/factories'
import { CRAFT_LABELS } from '../constants/roles'
import type { Grade } from '../constants/grading'

const route = useRoute()
const scores = useScoresStore()
const factories = useFactoriesStore()

const month = computed(() => route.params.month as string)
const grade = computed(() => route.params.grade as Grade)

const GRADE_META: Record<string, { label: string; color: string }> = {
  A: { label: 'A 优秀', color: '#16a34a' },
  B: { label: 'B 良好', color: '#2563eb' },
  C: { label: 'C 限单', color: '#d97706' },
  D: { label: 'D 预警', color: '#dc2626' },
}
const meta = computed(() => GRADE_META[grade.value] ?? { label: grade.value, color: '#6b7280' })

const FLAG_LABEL: Record<string, string> = { none: '-', yellow: '黄牌', red: '红牌' }
const STATUS_LABEL: Record<string, string> = { draft: '草稿', submitted: '已提交', approved: '已通过' }

onMounted(async () => {
  await Promise.all([scores.fetchByMonth(month.value), factories.fetchAll()])
})

const factoryById = computed(() => {
  const m: Record<string, { name: string; craft: string }> = {}
  for (const f of factories.items) m[f.id] = { name: f.name, craft: f.craft }
  return m
})

const rows = computed(() =>
  scores.items
    .filter((s) => s.grade === grade.value)
    .map((s) => {
      const f = factoryById.value[s.factory]
      return {
        id: s.factory,
        name: f?.name ?? '(未知工厂)',
        dept: f ? (CRAFT_LABELS[f.craft as keyof typeof CRAFT_LABELS] ?? '-') : '-',
        total: s.total_score,
        flag: s.flag ?? 'none',
        status: s.status ?? 'draft',
      }
    })
    .sort((a, b) => (b.total ?? 0) - (a.total ?? 0)),
)
</script>
<template>
  <AppLayout>
    <div class="page">
      <div class="toolbar">
        <RouterLink to="/dashboard" class="back">← 返回首页</RouterLink>
        <h2 style="margin:0">
          {{ month }} ·
          <span class="grade-tag" :style="{ background: meta.color }">{{ grade }}</span>
          {{ meta.label }}
        </h2>
        <span class="muted">共 {{ rows.length }} 家</span>
      </div>

      <table>
        <thead><tr><th>工厂名称</th><th>部门</th><th>总分</th><th>红黄牌</th><th>评分状态</th><th>明细</th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id">
            <td>{{ r.name }}</td>
            <td>{{ r.dept }}</td>
            <td class="score">{{ r.total ?? '-' }}</td>
            <td>
              <span v-if="r.flag !== 'none'" class="flag" :class="'flag-' + r.flag">{{ FLAG_LABEL[r.flag] }}</span>
              <span v-else>-</span>
            </td>
            <td>{{ STATUS_LABEL[r.status] }}</td>
            <td><RouterLink class="detail-link" :to="`/factories/${r.id}/score/${month}`">查看评分表 →</RouterLink></td>
          </tr>
          <tr v-if="!rows.length"><td colspan="6" class="hint" style="text-align:center">本月暂无 {{ grade }} 级工厂</td></tr>
        </tbody>
      </table>
    </div>
  </AppLayout>
</template>
<style scoped>
.back { font-size: .9rem; }
.grade-tag { color: #fff; font-weight: 700; border-radius: 6px; font-size: .85rem; padding: .1rem .5rem; }
.score { font-weight: 600; }
.flag { color: #fff; font-weight: 600; font-size: .78rem; padding: .12rem .5rem; border-radius: 999px; }
.flag-red { background: #dc2626; }
.flag-yellow { background: #d97706; }
.detail-link { color: var(--primary, #4f46e5); text-decoration: none; font-weight: 500; }
.detail-link:hover { text-decoration: underline; }
</style>
