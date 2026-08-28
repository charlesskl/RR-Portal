<script setup lang="ts">
import { onMounted, computed } from 'vue'
import AppLayout from '../../components/AppLayout.vue'
import { useScoreTemplatesStore } from '../../stores/scoreTemplates'
import type { ScoreTemplate } from '../../types/score'

const store = useScoreTemplatesStore()
onMounted(() => store.fetchAll())
const commonTotal = computed(() => store.items
  .filter((t) => t.is_active && !t.craft_filter)
  .reduce((sum, t) => sum + t.max_score, 0))
const scoreConfigValid = computed(() => commonTotal.value === 100
  && !store.items.some((t) => t.is_active && (t.craft_filter || t.module === 'craft_specific')))

async function toggle(t: ScoreTemplate) {
  await store.update(t.id, { is_active: !t.is_active })
  await store.fetchAll()
}
</script>
<template>
  <AppLayout>
    <div class="page">
    <h2>评分模板配置（通用 {{ commonTotal }} 分）</h2>
    <p v-if="!scoreConfigValid" class="warn">提示：启用的通用评分项总分应为100分，且不应包含部门专项评分</p>
    <table>
      <thead><tr><th>名称</th><th>模块</th><th>分值</th><th>打分主体</th><th>部门</th><th>启用</th></tr></thead>
      <tbody>
        <tr v-for="t in store.items" :key="t.id">
          <td>{{ t.name }}</td><td>{{ t.module }}</td><td>{{ t.max_score }}</td>
          <td>{{ t.scoring_role === 'buyer' ? '采购' : '品质' }}</td>
          <td>通用</td>
          <td><button @click="toggle(t)">{{ t.is_active ? '停用' : '启用' }}</button></td>
        </tr>
      </tbody>
    </table>
    </div>
  </AppLayout>
</template>
<style scoped>
.warn { color: var(--grade-d); font-size: .9rem; }
</style>
