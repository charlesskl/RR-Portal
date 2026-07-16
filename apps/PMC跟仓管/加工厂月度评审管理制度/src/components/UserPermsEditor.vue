<script setup lang="ts">
import { PERM_MODULES, type PermModule } from '../utils/permissions'
import { REGIONS, REGION_LABELS, type Region } from '../constants/roles'

const props = defineProps<{ modelValue: Record<string, boolean> }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: Record<string, boolean>): void }>()

function setView(m: PermModule, v: boolean) {
  const next = { ...props.modelValue, [`${m.key}.view`]: v }
  if (!v && m.edit) next[`${m.key}.edit`] = false // 不能访问就不能编辑
  emit('update:modelValue', next)
}
function setEdit(m: PermModule, v: boolean) {
  emit('update:modelValue', { ...props.modelValue, [`${m.key}.edit`]: v })
}
function setRegion(r: Region, v: boolean) {
  emit('update:modelValue', { ...props.modelValue, [`region.${r}`]: v })
}
</script>
<template>
  <div class="perm">
    <div class="prow head"><span>模块</span><span>访问</span><span>可编辑</span></div>
    <div class="prow" v-for="m in PERM_MODULES" :key="m.key">
      <span class="pname">{{ m.label }}</span>
      <label class="pc">
        <input type="checkbox" :checked="!!modelValue[`${m.key}.view`]"
          @change="setView(m, ($event.target as HTMLInputElement).checked)" />
      </label>
      <label v-if="m.edit" class="pc">
        <input type="checkbox" :checked="!!modelValue[`${m.key}.edit`]" :disabled="!modelValue[`${m.key}.view`]"
          @change="setEdit(m, ($event.target as HTMLInputElement).checked)" />
      </label>
      <span v-else class="na">—</span>
    </div>
  </div>
  <div class="regions">
    <span class="rg-title">可访问厂区</span>
    <label v-for="r in REGIONS" :key="r" class="rg">
      <input type="checkbox" :checked="!!modelValue[`region.${r}`]"
        @change="setRegion(r, ($event.target as HTMLInputElement).checked)" />
      {{ REGION_LABELS[r] }}
    </label>
  </div>
</template>
<style scoped>
.perm { border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; max-width: 420px; }
.prow { display: grid; grid-template-columns: 1fr 64px 72px; align-items: center; padding: .4rem .7rem; border-top: 1px solid #f0f1f5; font-size: .85rem; }
.prow.head { border-top: 0; background: #fafbff; font-weight: 600; color: #6b7280; }
.prow.head span:not(:first-child), .pc, .na { text-align: center; justify-self: center; }
.pname { color: #1f2533; }
.pc input { width: 16px; height: 16px; cursor: pointer; }
.na { color: #c7cad2; }
.regions { display: flex; align-items: center; gap: 1.2rem; max-width: 420px; margin-top: .6rem; padding: .5rem .2rem; }
.rg-title { font-size: .85rem; font-weight: 600; color: #6b7280; }
.rg { display: inline-flex; align-items: center; gap: .35rem; font-size: .88rem; cursor: pointer; }
.rg input { width: 16px; height: 16px; cursor: pointer; }
</style>
