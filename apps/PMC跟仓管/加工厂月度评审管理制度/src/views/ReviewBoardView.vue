<script setup lang="ts">
import { onMounted, computed, ref } from 'vue'
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
const startMonth = ref(month)
const endMonth = ref(month)
const loadedRange = ref({ start: month, end: month })
const loading = ref(false)
const error = ref('')
const rangeLabel = computed(() => loadedRange.value.start === loadedRange.value.end
  ? loadedRange.value.start : `${loadedRange.value.start} 至 ${loadedRange.value.end}`)
const singleMonth = computed(() => loadedRange.value.start === loadedRange.value.end)
const factories = useFactoriesStore()
const scores = useScoresStore()
const output = useOutputStore()
const reviews = useReviewsStore()
const auth = useAuthStore()

const summary = ref<ReturnType<typeof summarizeByCraft>>({} as ReturnType<typeof summarizeByCraft>)
async function loadRange() {
  if (loading.value) return
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(startMonth.value) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(endMonth.value)) {
    error.value = '请选择开始月份和结束月份'
    return
  }
  if (startMonth.value > endMonth.value) {
    error.value = '开始月份不能晚于结束月份'
    return
  }
  const start = startMonth.value
  const end = endMonth.value
  loading.value = true
  error.value = ''
  try {
    await Promise.all([factories.fetchAll(), scores.fetchByRange(start, end), output.fetchByRange(start, end)])
    summary.value = summarizeByCraft(factories.items, scores.items, output.items)
    loadedRange.value = { start, end }
  } catch (err) {
    error.value = err instanceof Error ? err.message : '大盘加载失败，请重试'
  } finally {
    loading.value = false
  }
}
onMounted(loadRange)
const crafts = computed(() => Object.keys(summary.value) as Craft[])

async function saveSummary() {
  if (!singleMonth.value || loading.value || error.value) return
  await reviews.save(loadedRange.value.start, { summary_by_craft: summary.value, summary_by: auth.userId ?? undefined })
  alert('大盘已存档')
}
</script>
<template>
  <AppLayout>
    <div class="page">
      <div class="toolbar">
        <h2 style="margin:0">月度评审大盘</h2>
        <span class="muted">{{ rangeLabel }}</span>
        <form class="range-filter" @submit.prevent="loadRange">
          <label>开始月份 <input v-model="startMonth" type="month" :disabled="loading" aria-label="开始月份" /></label>
          <span>至</span>
          <label>结束月份 <input v-model="endMonth" type="month" :disabled="loading" aria-label="结束月份" /></label>
          <button type="submit" :disabled="loading">{{ loading ? '加载中...' : '查询' }}</button>
        </form>
        <span class="spacer"></span>
        <button v-if="auth.role === 'sc_clerk' || auth.role === 'admin'" :disabled="loading || !singleMonth || !!error" @click="saveSummary">存档大盘</button>
        <RouterLink :to="`/review/${loadedRange.end}/meeting`"><button class="ghost">评审会议记录 →</button></RouterLink>
      </div>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <p v-if="!singleMonth" class="muted range-note">期间等级按各工厂已评分月份的平均分计算，产值累加；存档请筛选单个月份，会议记录对应结束月份。</p>
      <table :aria-busy="loading">
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

<style scoped>
.toolbar { flex-wrap: wrap; }
.range-filter { display: flex; align-items: center; flex-wrap: wrap; gap: .5rem; }
.range-filter label { display: flex; align-items: center; gap: .35rem; font-size: .85rem; }
.range-filter input { width: 155px; }
.range-note { font-size: .85rem; }
.error { color: #dc2626; }
</style>
