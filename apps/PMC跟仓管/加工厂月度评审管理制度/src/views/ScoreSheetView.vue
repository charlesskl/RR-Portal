<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import AppLayout from '../components/AppLayout.vue'
import { useScoresStore } from '../stores/scores'
import { useScoreTemplatesStore } from '../stores/scoreTemplates'
import { useFactoriesStore } from '../stores/factories'
import { useAuthStore } from '../stores/auth'
import { totalFromItems, gradeFromScore } from '../utils/grading'
import { pb } from '../pb'
import {
  filterMonthlyScoringData,
  isAutoScoreModule,
  mergeAutomaticScores,
  type MonthlyScoringData,
} from '../utils/monthlyAutoScoring'
import { isBuyer } from '../constants/roles'
import type { ScoreItem } from '../types/score'
import type { Factory } from '../types/factory'
import type { Order } from '../types/order'
import type { QualityInspection } from '../types/qualityInspection'
import type { Quality5sCheck } from '../types/quality5s'

const route = useRoute()
const scores = useScoresStore()
const templates = useScoreTemplatesStore()
const factories = useFactoriesStore()
const auth = useAuthStore()

const factoryId = route.params.id as string
const month = route.params.month as string
const craft = ref<string>('')
const factory = ref<Factory | null>(null)
const itemMap = ref<Record<string, ScoreItem>>({})
const flag = ref<'none' | 'yellow' | 'red'>('none')
const flagReason = ref('')
const recalculating = ref(false)
const autoError = ref('')
const submitting = ref(false)
const submitError = ref('')
const scoreNotice = ref('')
const scoreStatus = ref<'draft' | 'submitted' | 'approved'>('draft')

onMounted(async () => {
  if (!templates.items.length) await templates.fetchAll()
  const f = factories.items.find((item) => item.id === factoryId) ?? await factories.get(factoryId)
  factory.value = f
  craft.value = f.craft
  const existing = scores.findCached(factoryId, month) ?? await scores.getOne(factoryId, month)
  if (existing?.score_items) for (const it of existing.score_items) itemMap.value[it.template_id] = { ...it }
  if (existing) {
    scoreStatus.value = existing.status
    flag.value = existing.flag ?? 'none'
    flagReason.value = existing.flag_reason ?? ''
    if (existing.score_items?.length) scoreNotice.value = '已加载保存的评分结果'
  }
  if (!existing?.score_items?.length && scoreStatus.value === 'draft') await recalculateAutomaticScores()
})

const applicable = computed(() => templates.applicable(craft.value))
// 当前角色能编辑的评分项：采购角色编辑 scoring_role=buyer，品质编辑 quality_qc
const canEditItem = (scoringRole: string) =>
  (scoringRole === 'buyer' && auth.role && isBuyer(auth.role)) ||
  (scoringRole === 'quality_qc' && auth.role === 'quality_qc') ||
  auth.role === 'admin'

const isManager = computed(() => auth.role === 'sc_manager' || auth.role === 'admin')

const liveTotal = computed(() =>
  totalFromItems(applicable.value.map((t) => itemMap.value[t.id] ?? { template_id: t.id, score: 0 })),
)
const liveGrade = computed(() => gradeFromScore(liveTotal.value))

async function loadMonthlyData(): Promise<MonthlyScoringData> {
  const filter = `factory = "${factoryId}"`
  const [orders, inspections, checks] = await Promise.all([
    pb.collection('orders').getFullList<Order>({ filter }),
    pb.collection('quality_inspections').getFullList<QualityInspection>({ filter }),
    pb.collection('quality_5s_checks').getFullList<Quality5sCheck>({ filter }),
  ])
  return filterMonthlyScoringData({ orders, inspections, checks }, month)
}

async function recalculateAutomaticScores() {
  if (!factory.value || recalculating.value || scoreStatus.value !== 'draft') return
  recalculating.value = true
  autoError.value = ''
  scoreNotice.value = ''
  try {
    const data = await loadMonthlyData()
    const merged = mergeAutomaticScores(
      applicable.value,
      Object.values(itemMap.value),
      factory.value,
      data,
    )
    const saved = await scores.save(factoryId, month, { score_items: merged, status: 'submitted', submitted_by: auth.userId ?? undefined })
    for (const item of saved.score_items ?? merged) itemMap.value[item.template_id] = { ...item }
    scoreStatus.value = saved.status
    scoreNotice.value = '已自动计算并提交，总分已同步'
  } catch (error) {
    autoError.value = error instanceof Error ? error.message : '自动评分数据读取失败'
  } finally {
    recalculating.value = false
  }
}

async function submit() {
  if (submitting.value || recalculating.value) return
  submitError.value = ''
  const score_items = applicable.value.map((t) => ({
    template_id: t.id,
    score: itemMap.value[t.id]?.score ?? 0,
    notes: itemMap.value[t.id]?.notes ?? '',
  }))
  if (score_items.some((item, index) => !Number.isFinite(Number(item.score)) || Number(item.score) < 0 || Number(item.score) > applicable.value[index]!.max_score)) {
    submitError.value = '得分必须是 0 至对应满分之间的数字'
    return
  }
  submitting.value = true
  try {
    const saved = await scores.save(factoryId, month, { score_items, status: 'submitted', submitted_by: auth.userId ?? undefined })
    scoreStatus.value = saved.status
    scoreNotice.value = '已提交，总分由服务端核定'
  } catch (error) {
    submitError.value = error instanceof Error ? error.message : '提交失败，请重试'
  } finally { submitting.value = false }
}

async function saveReason() {
  await scores.save(factoryId, month, { flag_reason: flagReason.value, flag_issued_by: auth.userId ?? undefined })
  alert('依据已提交，等待经理终审')
}
async function saveFlag() {
  await scores.save(factoryId, month, {
    flag: flag.value, flag_reason: flagReason.value, flag_approved_by: auth.userId ?? undefined,
  })
  alert('红黄牌已终审')
}
</script>
<template>
  <AppLayout>
    <div class="page">
      <div class="score-head">
        <div>
          <RouterLink :to="{ path: '/scoring', query: { month } }" class="back">← 返回月度评分</RouterLink>
          <h2>评分单 — {{ month }}</h2>
        </div>
        <div class="score-actions">
          <span v-if="scoreNotice && !recalculating" class="cache-hint">{{ scoreNotice }}</span>
          <button class="ghost" :disabled="recalculating || scoreStatus !== 'draft'" @click="recalculateAutomaticScores">
            {{ recalculating ? '计算中...' : '重新计算自动评分' }}
          </button>
        </div>
      </div>
      <p v-if="autoError" class="error">自动评分失败：{{ autoError }}</p>
      <table>
        <thead><tr><th>评分项</th><th>满分</th><th>得分</th><th>主体</th><th>计算依据</th></tr></thead>
        <tbody>
          <tr v-for="t in applicable" :key="t.id">
            <td>{{ t.name }} <span v-if="isAutoScoreModule(t.module)" class="auto-tag">自动</span></td>
            <td>{{ t.max_score }}</td>
            <td>
              <input type="number" :max="t.max_score" min="0"
                :disabled="recalculating || submitting || !canEditItem(t.scoring_role)"
                v-model.number="(itemMap[t.id] ??= { template_id: t.id, score: 0 }).score" />
            </td>
            <td>{{ t.scoring_role === 'buyer' ? '采购' : '品质' }}</td>
            <td class="basis">{{ itemMap[t.id]?.notes || '人工评分' }}</td>
          </tr>
        </tbody>
      </table>
    <p class="total-line">
      预估总分 <strong>{{ liveTotal }}</strong>
      <span class="badge" :class="'badge-' + liveGrade">{{ liveGrade }} 级</span>
      <span class="hint">最终以服务端核定为准</span>
    </p>
    <p class="hint">自动计算后直接提交；需要调整时可修改有权限的得分，再次手动提交。</p>
    <p v-if="submitError" class="error" role="alert">{{ submitError }}</p>
    <button :disabled="submitting || recalculating" @click="submit">{{ submitting ? '提交中…' : scoreStatus === 'submitted' ? '再次提交评分' : '提交评分' }}</button>

    <section class="card flag-box">
      <h3>红黄牌</h3>
      <label class="block">问题依据 <textarea v-model="flagReason"></textarea></label>
      <div v-if="isManager" class="flag-act">
        <select v-model="flag">
          <option value="none">无</option>
          <option value="yellow">黄牌</option>
          <option value="red">红牌</option>
        </select>
        <button @click="saveFlag">经理终审</button>
      </div>
      <button v-else @click="saveReason">提交依据</button>
    </section>
    </div>
  </AppLayout>
</template>
<style scoped>
.total-line { display: flex; align-items: center; gap: .6rem; margin: 1rem 0; font-size: 1.05rem; }
.total-line strong { font-size: 1.3rem; color: var(--primary); }
.flag-box { margin-top: 1.5rem; }
.block { display: flex; flex-direction: column; gap: .3rem; }
.flag-box textarea { width: 100%; min-height: 3rem; }
.flag-act { display: flex; gap: .5rem; margin-top: .6rem; }
.score-head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.score-head h2 { margin: 0; }
.back { display: inline-block; margin-bottom: .55rem; color: var(--primary); text-decoration: none; }
.score-actions { display: flex; align-items: center; gap: .75rem; }
.cache-hint { color: var(--text-soft); font-size: .82rem; }
.auto-tag { display: inline-block; margin-left: .35rem; padding: .12rem .35rem; border-radius: 4px; background: #eef0ff; color: var(--primary); font-size: .72rem; }
.basis { min-width: 320px; color: var(--text-soft); font-size: .85rem; line-height: 1.5; }
.error { color: #dc2626; }
</style>
