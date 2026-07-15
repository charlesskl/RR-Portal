<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import AppLayout from '../components/AppLayout.vue'
import { useFactoriesStore } from '../stores/factories'
import { useScoresStore } from '../stores/scores'
import { useOutputStore } from '../stores/output'
import { useReviewsStore } from '../stores/reviews'
import { summarizeByCraft } from '../utils/summary'
import { CRAFT_LABELS, type Craft } from '../constants/roles'
import { useAuthStore } from '../stores/auth'

const route = useRoute()
const month = route.params.month as string
const factories = useFactoriesStore()
const scores = useScoresStore()
const output = useOutputStore()
const reviews = useReviewsStore()
const auth = useAuthStore()

onMounted(async () => {
  await Promise.all([factories.fetchAll(), scores.fetchByMonth(month), output.fetchByMonth(month)])
})
const summary = computed(() => summarizeByCraft(factories.items, scores.items, output.items))
const crafts = computed(() => Object.keys(summary.value) as Craft[])

async function saveSummary() {
  await reviews.save(month, { summary_by_craft: summary.value, summary_by: auth.userId ?? undefined })
  alert('大盘已存档')
}
</script>
<template>
  <AppLayout>
    <div class="page">
      <div class="toolbar">
        <h2 style="margin:0">月度评审大盘</h2>
        <span class="muted">{{ month }}</span>
        <span class="spacer"></span>
        <button v-if="auth.role === 'sc_clerk' || auth.role === 'admin'" @click="saveSummary">存档大盘</button>
        <RouterLink :to="`/review/${month}/meeting`"><button class="ghost">评审会议记录 →</button></RouterLink>
      </div>
      <table>
        <thead><tr><th>部门</th><th>工厂数</th><th>A</th><th>B</th><th>C</th><th>D</th><th>平均分</th><th>总产值(元)</th></tr></thead>
        <tbody>
          <tr v-for="craft in crafts" :key="craft">
            <td><strong>{{ CRAFT_LABELS[craft] }}</strong></td>
            <td>{{ summary[craft].factory_count }}</td>
            <td><span v-if="summary[craft].grade_dist.A" class="badge badge-A">{{ summary[craft].grade_dist.A }}</span><span v-else class="muted">0</span></td>
            <td><span v-if="summary[craft].grade_dist.B" class="badge badge-B">{{ summary[craft].grade_dist.B }}</span><span v-else class="muted">0</span></td>
            <td><span v-if="summary[craft].grade_dist.C" class="badge badge-C">{{ summary[craft].grade_dist.C }}</span><span v-else class="muted">0</span></td>
            <td><span v-if="summary[craft].grade_dist.D" class="badge badge-D">{{ summary[craft].grade_dist.D }}</span><span v-else class="muted">0</span></td>
            <td><strong>{{ summary[craft].avg_score }}</strong></td>
            <td>{{ summary[craft].total_output.toLocaleString() }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </AppLayout>
</template>
