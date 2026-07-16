<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import AppLayout from '../components/AppLayout.vue'
import { useAuthStore } from '../stores/auth'
import { allowedRegions } from '../utils/permissions'
import { REGIONS, REGION_LABELS } from '../constants/roles'

const auth = useAuthStore()
const myRegions = computed(() => (auth.role ? allowedRegions(auth.role) : REGIONS))
const cards = [
  { to: '/quality-5s', icon: '🧹', name: '现场品质及5S检查记录', sub: '加工厂现场品质及5S检查记录登记表' },
  { to: '/quality-inspection', icon: '🔍', name: '品质检验明细', sub: '加工厂品质检验明细' },
]
</script>
<template>
  <AppLayout>
    <div class="page">
      <div class="toolbar">
        <h2 style="margin:0">品质管理</h2>
      </div>
      <section v-for="region in myRegions" :key="region" class="region-block">
        <h3 class="region-title">{{ REGION_LABELS[region] }}厂区</h3>
        <div class="hub-grid">
          <RouterLink v-for="c in cards" :key="c.to" class="hub-card" :to="`${c.to}?region=${region}`">
            <span class="ico">{{ c.icon }}</span>
            <div class="info">
              <span class="name">{{ c.name }}</span>
              <span class="sub">{{ c.sub }}</span>
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
.hub-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1rem; }
.hub-card {
  display: flex; align-items: center; gap: 1rem; text-decoration: none; color: var(--text);
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 1.25rem 1.4rem; box-shadow: var(--shadow); transition: all .15s ease;
}
.hub-card:hover { border-color: var(--primary-border); transform: translateY(-2px); box-shadow: 0 10px 24px -12px rgba(79,70,229,.45); }
.ico { width: 52px; height: 52px; display: grid; place-items: center; font-size: 1.6rem; background: var(--primary-soft); border-radius: 14px; }
.info { display: flex; flex-direction: column; flex: 1; }
.name { font-size: 1.1rem; font-weight: 600; }
.sub { font-size: .85rem; color: var(--text-soft); }
.arrow { color: var(--text-faint); font-size: 1.2rem; }
</style>
