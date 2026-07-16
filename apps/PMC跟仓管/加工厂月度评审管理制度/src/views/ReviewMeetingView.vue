<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import AppLayout from '../components/AppLayout.vue'
import { useReviewsStore } from '../stores/reviews'
import { useAuthStore } from '../stores/auth'
import { canApproveStatus } from '../utils/permissions'

const route = useRoute()
const month = route.params.month as string
const reviews = useReviewsStore()
const auth = useAuthStore()
const suggestions = ref('')

onMounted(async () => {
  const m = await reviews.fetchByMonth(month)
  if (m) suggestions.value = m.optimization_suggestions ?? ''
})
async function saveDraft() {
  await reviews.save(month, { optimization_suggestions: suggestions.value })
  alert('已保存')
}
async function approve() {
  await reviews.save(month, {
    optimization_suggestions: suggestions.value,
    status: 'approved', approved_by: auth.userId ?? undefined,
    meeting_date: new Date().toISOString(),
  })
  alert('评审已审批通过')
}
</script>
<template>
  <AppLayout>
    <div class="page">
      <h2>月度评审会议 — {{ month }}</h2>
      <section class="card">
        <label class="block">优化 / 整合 / 淘汰建议
          <textarea v-model="suggestions" rows="6"></textarea>
        </label>
        <div class="actions">
          <button class="ghost" @click="saveDraft">保存草稿</button>
          <button v-if="auth.role && canApproveStatus(auth.role)" @click="approve">审批通过</button>
        </div>
        <p class="muted" style="margin-top:.75rem">状态：
          <span class="badge" :class="reviews.current?.status === 'approved' ? 'status-active' : 'status-limited'">
            {{ reviews.current?.status === 'approved' ? '已审批' : '草稿' }}
          </span>
        </p>
      </section>
    </div>
  </AppLayout>
</template>
<style scoped>
.block { display: flex; flex-direction: column; gap: 0.3rem; }
.block textarea { width: 100%; }
.actions { display: flex; gap: 0.75rem; margin-top: 0.75rem; }
</style>
