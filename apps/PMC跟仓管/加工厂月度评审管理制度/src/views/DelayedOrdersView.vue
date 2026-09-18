<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import AppLayout from '../components/AppLayout.vue'
import DelayedOrderTable from '../components/DelayedOrderTable.vue'
import { useOrdersStore } from '../stores/orders'
import { useFactoriesStore } from '../stores/factories'
import { useAuthStore } from '../stores/auth'
import { allowedCrafts, allowedRegions } from '../utils/permissions'
import { REGIONS, REGION_LABELS, CRAFT_LABELS, type Region, type Craft } from '../constants/roles'
import type { Order } from '../types/order'
import { buildDelayedSections } from '../utils/delayedOrders'
import { factoryTaxPointFactors } from '../utils/taxPoint'
const route = useRoute()
const orders = useOrdersStore()
const factories = useFactoriesStore()
const auth = useAuthStore()
const source = shallowRef<Order[]>([])
const loading = ref(false)
const error = ref('')
const department = ref<Craft | ''>('')
const region = computed(() => route.params.region as Region)
const crafts = computed(() => allowedCrafts().filter((c) => c !== 'electronics' || region.value !== 'heyuan'))
const today = ref('')
const sections = computed(() => buildDelayedSections(source.value, region.value, crafts.value, today.value, factoryTaxPointFactors(factories.items)))
const visibleSections = computed(() => sections.value.filter((s) => !department.value || s.craft === department.value))
let request = 0
async function load() {
  const current = ++request
  source.value = []
  error.value = ''
  loading.value = true
  try {
    if (!REGIONS.includes(region.value) || !auth.role || !allowedRegions(auth.role).includes(region.value)) throw new Error('无权查看此厂区')
    const userId = auth.userId
    const selectedRegion = region.value
    const [groups] = await Promise.all([Promise.all(crafts.value.map((c) => orders.fetchForScope(c, selectedRegion, { force: true }))), factories.fetchAll()])
    if (current !== request) return
    if (userId !== auth.userId) throw new Error('登录账号已变更，请重新读取')
    const now = new Date()
    today.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    source.value = groups.flat()
  } catch (cause) {
    if (current === request) error.value = cause instanceof Error ? cause.message : '读取失败，请重试'
  } finally { if (current === request) loading.value = false }
}
watch([region, () => auth.userId], () => { department.value = ''; void load() }, { immediate: true })
</script>
<template>
  <AppLayout><div class="page">
    <RouterLink to="/orders">← 返回货期管理</RouterLink>
    <div class="toolbar"><h2>{{ REGION_LABELS[region] }}厂区 · 汇总延期订单</h2><span class="spacer"></span>
      <label>部门 <select v-model="department"><option value="">全部部门</option><option v-for="craft in crafts" :key="craft" :value="craft">{{ CRAFT_LABELS[craft] }}</option></select></label>
      <button class="ghost" :disabled="loading" @click="load">{{ loading ? '读取中…' : '刷新汇总' }}</button>
    </div>
    <p class="muted">按厂区、部门、下单PMC、加工厂汇总。包含已标记延期、实际迟交及截至 {{ today || '今天' }} 到期未交的订单，已取消订单不计入。单数按同组订单号去重，占比以本表延期订单为基数。</p>
    <p v-if="loading" role="status">正在读取完整订单数据，请稍候…</p>
    <p v-else-if="error" role="alert" class="error">{{ error }} <button class="ghost mini" @click="load">重试</button></p>
    <template v-else><DelayedOrderTable v-for="section in visibleSections" :key="section.craft" :section="section" :region-name="REGION_LABELS[region]" /></template>
  </div></AppLayout>
</template>
<style scoped>
.error { color: #b91c1c; }
select { padding: 7px 12px; border: 1px solid var(--border); border-radius: 6px; background: white; }
.muted { line-height: 1.7; font-size: 13px; }
</style>
