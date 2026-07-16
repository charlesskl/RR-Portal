<script setup lang="ts">
import { computed } from 'vue'
import { CRAFTS, CRAFT_LABELS, type Craft } from '../constants/roles'

const props = defineProps<{ modelValue: Craft[] }>()
const emit = defineEmits<{ 'update:modelValue': [value: Craft[]] }>()

const summary = computed(() => props.modelValue.length
  ? props.modelValue.map((craft) => CRAFT_LABELS[craft]).join('、')
  : '全部部门')

function toggle(craft: Craft, checked: boolean) {
  const next = new Set(props.modelValue)
  if (checked) next.add(craft)
  else next.delete(craft)
  emit('update:modelValue', CRAFTS.filter((item) => next.has(item)))
}
</script>

<template>
  <details class="craft-picker">
    <summary :title="summary">{{ summary }}</summary>
    <div class="craft-menu">
      <label v-for="craft in CRAFTS" :key="craft">
        <input
          type="checkbox"
          :checked="modelValue.includes(craft)"
          @change="toggle(craft, ($event.target as HTMLInputElement).checked)"
        />
        <span>{{ CRAFT_LABELS[craft] }}</span>
      </label>
      <p>不勾选表示全部部门</p>
    </div>
  </details>
</template>

<style scoped>
.craft-picker { position: relative; width: 220px; }
.craft-picker summary {
  list-style: none; cursor: pointer; border: 1px solid var(--border); border-radius: var(--radius-sm);
  background: #fff; padding: .42rem 2rem .42rem .65rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.craft-picker summary::-webkit-details-marker { display: none; }
.craft-picker summary::after { content: '⌄'; position: absolute; right: .65rem; top: .38rem; color: var(--text-soft); }
.craft-menu {
  position: absolute; z-index: 30; top: calc(100% + 4px); left: 0; width: 100%;
  background: #fff; border: 1px solid var(--border); border-radius: var(--radius-sm); box-shadow: var(--shadow); padding: .4rem;
}
.craft-menu label { display: flex; align-items: center; gap: .5rem; padding: .4rem .45rem; cursor: pointer; }
.craft-menu label:hover { background: var(--primary-soft); }
.craft-menu input { width: 16px; height: 16px; }
.craft-menu p { margin: .35rem .45rem .2rem; color: var(--text-soft); font-size: .75rem; }
</style>
