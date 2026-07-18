<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import AppLayout from '../components/AppLayout.vue'
import { useOrdersStore } from '../stores/orders'
import { useFactoriesStore } from '../stores/factories'
import { useAuthStore } from '../stores/auth'
import { CRAFT_LABELS, type Craft } from '../constants/roles'
import type { Order } from '../types/order'

const route = useRoute()
const router = useRouter()
const orders = useOrdersStore()
const factories = useFactoriesStore()
const auth = useAuthStore()

const craft = computed(() => route.params.craft as Craft | undefined)
const deptName = computed(() => (craft.value ? CRAFT_LABELS[craft.value] ?? '部门' : '全部'))
const backTo = computed(() => (craft.value ? `/orders/dept/${craft.value}` : '/orders'))

const draft = ref<Partial<Order>>({ status: 'placed' })
// 指定部门只列该部门工厂；不限部门(从货期管理落地页进入)则列全部
const deptFactories = computed(() => (craft.value ? factories.items.filter((f) => f.craft === craft.value) : factories.items))
const draftAmount = computed(() => {
  const price = draft.value.unit_price_cny_tax ?? draft.value.unit_price ?? 0
  return (Number(draft.value.quantity) || 0) * (Number(price) || 0)
})
const factorySearch = ref('')
const factoryOpen = ref(false)
const selectedFactoryName = computed(() => deptFactories.value.find((f) => f.id === draft.value.factory)?.name ?? '')
const filteredFactories = computed(() => {
  const q = factorySearch.value.trim().toLowerCase()
  if (!q) return deptFactories.value.slice(0, 60)
  return deptFactories.value
    .filter((f) => f.name.toLowerCase().includes(q))
    .slice(0, 60)
})

onMounted(() => factories.fetchAll())

function selectFactory(id: string, name: string) {
  draft.value.factory = id
  factorySearch.value = name
  factoryOpen.value = false
}

function onFactoryInput(ev: Event) {
  const value = (ev.target as HTMLInputElement).value
  factorySearch.value = value
  factoryOpen.value = true
  if (selectedFactoryName.value !== value) draft.value.factory = ''
}

function closeFactoryPicker() {
  window.setTimeout(() => { factoryOpen.value = false }, 120)
}

async function submit() {
  if (!draft.value.factory) { alert('请选择工厂'); return }
  if (!draft.value.product) { alert('请输入产品名称'); return }
  await orders.create({ ...draft.value, amount: draftAmount.value, created_by: auth.userId ?? undefined })
  router.push(backTo.value)
}
</script>
<template>
  <AppLayout>
    <div class="page">
      <div class="toolbar">
        <RouterLink :to="backTo" class="back">← 返回</RouterLink>
        <h2 style="margin:0">{{ deptName }} · 新增下单</h2>
      </div>
      <section class="card">
        <form class="order-form" @submit.prevent="submit">
          <div class="field">工厂
            <div class="factory-picker">
              <input
                :value="factorySearch"
                placeholder="搜索/选择工厂"
                autocomplete="off"
                required
                @focus="factoryOpen = true"
                @input="onFactoryInput"
                @blur="closeFactoryPicker"
              />
              <div v-if="factoryOpen" class="factory-menu">
                <button
                  v-for="f in filteredFactories"
                  :key="f.id"
                  type="button"
                  class="factory-option"
                  @mousedown.prevent="selectFactory(f.id, f.name)"
                >
                  {{ f.name }}
                </button>
                <div v-if="!filteredFactories.length" class="factory-empty">没有匹配的工厂</div>
              </div>
            </div>
          </div>
          <label>下单PMC <input v-model="draft.pmc" placeholder="下单跟单人" /></label>
          <label>工序 <input v-model="draft.process" placeholder="如注塑/喷油" /></label>
          <label>车间 <input v-model="draft.workshop" placeholder="如注塑车间" /></label>
          <label>货号 <input v-model="draft.item_no" placeholder="货号" /></label>
          <label>订单号 <input v-model="draft.order_no" placeholder="订单号" /></label>
          <label>产品 <input v-model="draft.product" placeholder="产品名称" required /></label>
          <label>数量 <input v-model.number="draft.quantity" type="number" min="0" /></label>
          <label>加工类别 <input v-model="draft.process_category" placeholder="如塑胶半成品" /></label>
          <label>核价生产工价 <input v-model.number="draft.quote_labor_price" type="number" min="0" step="0.01" /></label>
          <label>外发单价 <input v-model.number="draft.unit_price" type="number" min="0" step="0.01" /></label>
          <label>外发工价(人民币含税) <input v-model.number="draft.unit_price_cny_tax" type="number" min="0" step="0.01" /></label>
          <label>金额 <input :value="draftAmount" type="number" disabled /></label>
          <label>下单日期 <input v-model="draft.order_date" type="date" /></label>
          <label>交货日期 <input v-model="draft.delivery_date" type="date" /></label>
          <label>实际交货时间 <input v-model="draft.actual_delivery_date" type="date" /></label>
          <label>客退货单数 <input v-model.number="draft.return_count" type="number" min="0" /></label>
          <label>备注 <input v-model="draft.notes" placeholder="可选" /></label>
          <div class="actions">
            <button type="submit">提交下单</button>
            <RouterLink :to="backTo"><button type="button" class="ghost">取消</button></RouterLink>
          </div>
        </form>
      </section>
    </div>
  </AppLayout>
</template>
<style scoped>
.back { font-size: .9rem; }
.order-form { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; max-width: 760px; }
.order-form label, .field { display: flex; flex-direction: column; gap: .3rem; }
.factory-picker { position: relative; }
.factory-picker input { width: 100%; }
.factory-menu {
  position: absolute; z-index: 20; top: calc(100% + 4px); left: 0; right: 0;
  max-height: 320px; overflow-y: auto; background: var(--surface);
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  box-shadow: var(--shadow); padding: .35rem;
}
.factory-option {
  display: block; width: 100%; padding: .45rem .55rem; text-align: left;
  background: transparent; color: var(--text); border: 0; border-radius: var(--radius-sm);
  font-size: .92rem; line-height: 1.3; cursor: pointer;
}
.factory-option:hover { background: var(--primary-soft); }
.factory-empty { padding: .65rem .55rem; color: var(--text-soft); font-size: .9rem; }
.actions { grid-column: 1 / -1; display: flex; gap: .75rem; margin-top: .5rem; }
</style>
