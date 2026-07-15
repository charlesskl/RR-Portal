<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import AppLayout from '../../components/AppLayout.vue'
import { useScoreTemplatesStore } from '../../stores/scoreTemplates'
import type { ScoreTemplate } from '../../types/score'
import { CRAFT_LABELS, type Craft } from '../../constants/roles'

const store = useScoreTemplatesStore()
const draft = ref<Partial<ScoreTemplate>>({
  module: 'craft_specific', scoring_role: 'quality_qc', is_active: true, max_score: 0, sort_order: 99,
})
onMounted(() => store.fetchAll())
const total = computed(() => store.items.filter((t) => t.is_active).reduce((s, t) => s + t.max_score, 0))

async function add() {
  await store.create({ ...draft.value })
  await store.fetchAll()
}
async function toggle(t: ScoreTemplate) {
  await store.update(t.id, { is_active: !t.is_active })
  await store.fetchAll()
}
</script>
<template>
  <AppLayout>
    <div class="page">
    <h2>评分模板配置（当前启用合计 {{ total }} 分）</h2>
    <p v-if="total !== 100" class="warn">提示：通用70+专项30 应为100分，当前 {{ total }} 分</p>
    <table>
      <thead><tr><th>名称</th><th>模块</th><th>分值</th><th>打分主体</th><th>部门</th><th>启用</th></tr></thead>
      <tbody>
        <tr v-for="t in store.items" :key="t.id">
          <td>{{ t.name }}</td><td>{{ t.module }}</td><td>{{ t.max_score }}</td>
          <td>{{ t.scoring_role === 'buyer' ? '采购' : '品质' }}</td>
          <td>{{ t.craft_filter ? CRAFT_LABELS[t.craft_filter as Craft] : '通用' }}</td>
          <td><button @click="toggle(t)">{{ t.is_active ? '停用' : '启用' }}</button></td>
        </tr>
      </tbody>
    </table>
    <h3>新增评分项</h3>
    <form class="tpl-form" @submit.prevent="add">
      <input v-model="draft.name" placeholder="名称" required />
      <input v-model.number="draft.max_score" type="number" placeholder="分值" required />
      <select v-model="draft.scoring_role">
        <option value="buyer">采购</option>
        <option value="quality_qc">品质QC</option>
      </select>
      <select v-model="draft.craft_filter">
        <option value="">通用</option>
        <option v-for="(label, key) in CRAFT_LABELS" :key="key" :value="key">{{ label }}</option>
      </select>
      <button type="submit">添加</button>
    </form>
    </div>
  </AppLayout>
</template>
<style scoped>
h3 { margin-top: 1.5rem; }
.tpl-form { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.5rem; align-items: center; }
.warn { color: var(--grade-d); font-size: .9rem; }
</style>
