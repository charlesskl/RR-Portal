<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import AppLayout from '../components/AppLayout.vue'
import { useFactoriesStore } from '../stores/factories'
import { useAuthStore } from '../stores/auth'
import { allowedRegions } from '../utils/permissions'
import { CRAFT_LABELS, REGION_LABELS, regionOf, type Craft, type Region } from '../constants/roles'
import type { Factory } from '../types/factory'

const route = useRoute()
const store = useFactoriesStore()
const auth = useAuthStore()
const myRegions = computed(() => (auth.role ? allowedRegions(auth.role) : null))
const craft = computed(() => route.params.craft as Craft)
const region = computed(() => (route.query.region as Region) || null)
const deptName = computed(() =>
  (region.value ? REGION_LABELS[region.value] + '厂区 · ' : '') + (CRAFT_LABELS[craft.value] ?? '部门'))
const search = ref('')

onMounted(() => store.fetchAll())

const statusLabel: Record<string, string> = { active: '正常', limited: '限单', suspended: '暂停', eliminated: '淘汰' }
const list = computed(() => {
  const q = search.value.trim().toLowerCase()
  return store.items
    .filter((f: Factory) => f.craft === craft.value && (!region.value || regionOf(f) === region.value))
    .filter((f) => !myRegions.value || myRegions.value.includes(regionOf(f)))
    .filter((f) => !q || [f.name, f.contact_person].some((s) => (s ?? '').toLowerCase().includes(q)))
})
</script>
<template>
  <AppLayout>
    <div class="page">
      <div class="toolbar">
        <RouterLink to="/factory-view" class="back">← 部门</RouterLink>
        <h2 style="margin:0">{{ deptName }}</h2>
        <span class="muted">共 {{ list.length }} 家</span>
        <span class="spacer"></span>
        <input class="search-box" v-model="search" placeholder="搜索 厂名/联系人" />
      </div>
      <table>
        <thead><tr><th>名称</th><th>联系人</th><th>电话</th><th>状态</th></tr></thead>
        <tbody>
          <tr v-for="f in list" :key="f.id">
            <td><RouterLink class="name-link" :to="`/factory-view/${f.id}`">{{ f.name }}</RouterLink></td>
            <td>{{ f.contact_person || '-' }}</td>
            <td>{{ f.contact_phone || '-' }}</td>
            <td><span class="badge" :class="'status-' + f.status">{{ statusLabel[f.status] }}</span></td>
          </tr>
          <tr v-if="!list.length"><td colspan="4" class="hint" style="text-align:center">该部门暂无工厂</td></tr>
        </tbody>
      </table>
    </div>
  </AppLayout>
</template>
<style scoped>
.back { font-size: .9rem; }
.search-box { width: 220px; padding: .4rem .7rem; font-size: .9rem; border: 1px solid var(--border); border-radius: var(--radius-sm); }
.name-link { color: var(--primary, #4f46e5); font-weight: 500; text-decoration: none; }
.name-link:hover { text-decoration: underline; }
</style>
