<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute } from 'vue-router'
import AppLayout from '../components/AppLayout.vue'
import { useScoresStore } from '../stores/scores'
import { useScoreTemplatesStore } from '../stores/scoreTemplates'
import { useFactoriesStore } from '../stores/factories'
import { useAuthStore } from '../stores/auth'
import { totalFromItems, gradeFromScore } from '../utils/grading'
import { isBuyer } from '../constants/roles'
import type { ScoreItem } from '../types/score'

const route = useRoute()
const scores = useScoresStore()
const templates = useScoreTemplatesStore()
const factories = useFactoriesStore()
const auth = useAuthStore()

const factoryId = route.params.id as string
const month = route.params.month as string
const craft = ref<string>('')
const itemMap = ref<Record<string, ScoreItem>>({})
const flag = ref<'none' | 'yellow' | 'red'>('none')
const flagReason = ref('')

onMounted(async () => {
  await templates.fetchAll()
  const f = await factories.get(factoryId)
  craft.value = f.craft
  const existing = await scores.getOne(factoryId, month)
  if (existing?.score_items) for (const it of existing.score_items) itemMap.value[it.template_id] = it
  if (existing) {
    flag.value = existing.flag ?? 'none'
    flagReason.value = existing.flag_reason ?? ''
  }
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

async function submit() {
  const score_items = applicable.value.map((t) => ({
    template_id: t.id,
    score: itemMap.value[t.id]?.score ?? 0,
    notes: itemMap.value[t.id]?.notes ?? '',
  }))
  await scores.save(factoryId, month, { score_items, status: 'submitted', submitted_by: auth.userId ?? undefined })
  alert('已提交，总分由服务端核定')
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
    <h2>评分单 — {{ month }}</h2>
    <table>
      <thead><tr><th>评分项</th><th>满分</th><th>得分</th><th>主体</th></tr></thead>
      <tbody>
        <tr v-for="t in applicable" :key="t.id">
          <td>{{ t.name }}</td>
          <td>{{ t.max_score }}</td>
          <td>
            <input type="number" :max="t.max_score" min="0"
              :disabled="!canEditItem(t.scoring_role)"
              v-model.number="(itemMap[t.id] ??= { template_id: t.id, score: 0 }).score" />
          </td>
          <td>{{ t.scoring_role === 'buyer' ? '采购' : '品质' }}</td>
        </tr>
      </tbody>
    </table>
    <p class="total-line">
      预估总分 <strong>{{ liveTotal }}</strong>
      <span class="badge" :class="'badge-' + liveGrade">{{ liveGrade }} 级</span>
      <span class="hint">最终以服务端核定为准</span>
    </p>
    <button @click="submit">提交评分</button>

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
</style>
