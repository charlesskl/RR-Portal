<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import AppLayout from '../components/AppLayout.vue'
import { useFactoriesStore } from '../stores/factories'
import { useAuthStore } from '../stores/auth'
import { allowedCrafts, allowedRegions } from '../utils/permissions'
import { REGIONS, REGION_LABELS, regionOf, type Craft } from '../constants/roles'
import type { Factory } from '../types/factory'

const store = useFactoriesStore()
const auth = useAuthStore()
const myRegions = computed(() => (auth.role ? allowedRegions(auth.role) : REGIONS))
onMounted(() => store.fetchAll())

const DEPTS: { craft: Craft; name: string; icon: string }[] = [
  { craft: 'injection', name: '注塑部', icon: '🧩' },
  { craft: 'painting', name: '喷油部', icon: '🎨' },
  { craft: 'assembly', name: '装配部', icon: '🔧' },
  { craft: 'sewing', name: '车缝部', icon: '🧵' },
]
const regionBlocks = computed(() =>
  myRegions.value.map((region) => ({
    region,
    name: REGION_LABELS[region],
    cards: DEPTS.filter((d) => allowedCrafts().includes(d.craft)).map((d) => ({
      ...d,
      count: store.items.filter((f: Factory) => regionOf(f) === region && f.craft === d.craft).length,
    })),
  })),
)
</script>
<template>
  <AppLayout>
    <div class="page">
      <div class="toolbar">
        <h2 style="margin:0">加工厂管理</h2>
        <span class="muted">共 {{ store.items.length }} 家 · 只读总览</span>
      </div>
      <section v-for="b in regionBlocks" :key="b.region" class="region-block">
        <h3 class="region-title">{{ b.name }}厂区</h3>
        <div class="dept-grid">
          <RouterLink v-for="c in b.cards" :key="c.craft" class="dept-card" :to="`/factory-view/dept/${c.craft}?region=${b.region}`">
            <span class="ico">{{ c.icon }}</span>
            <div class="info">
              <span class="name">{{ c.name }}</span>
              <span class="sub">{{ c.count }} 家工厂</span>
            </div>
            <span class="arrow">→</span>
          </RouterLink>
        </div>
      </section>
    </div>
  </AppLayout>
</template>
<style scoped>
.region-block { margin-top: 1.5rem; }
.region-title { margin: 0 0 .8rem; font-size: 1.05rem; color: #1f2533; padding-left: .6rem; border-left: 4px solid var(--primary, #4f46e5); }
.dept-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 1rem; }
.dept-card {
  display: flex; align-items: center; gap: 1rem; text-decoration: none; color: var(--text);
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 1.25rem 1.4rem; box-shadow: var(--shadow); transition: all .15s ease;
}
.dept-card:hover { border-color: var(--primary-border); transform: translateY(-2px); box-shadow: 0 10px 24px -12px rgba(79,70,229,.45); }
.ico { width: 52px; height: 52px; display: grid; place-items: center; font-size: 1.6rem; background: var(--primary-soft); border-radius: 14px; }
.info { display: flex; flex-direction: column; flex: 1; }
.name { font-size: 1.1rem; font-weight: 600; }
.sub { font-size: .85rem; color: var(--text-soft); }
.arrow { color: var(--text-faint); font-size: 1.2rem; }
</style>
