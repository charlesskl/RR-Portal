<script setup lang="ts">
import { ref, computed, reactive, onMounted } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import AppLayout from '../components/AppLayout.vue'
import { pb } from '../pb'
import { useOrdersStore } from '../stores/orders'
import { useAuthStore } from '../stores/auth'
import { canEditOrders } from '../utils/permissions'
import { CRAFT_LABELS, type Craft } from '../constants/roles'
import type { Order } from '../types/order'

const route = useRoute()
const orders = useOrdersStore()
const auth = useAuthStore()
const canEdit = computed(() => (auth.role ? canEditOrders(auth.role) : false))

const craft = computed(() => route.params.craft as Craft)
const id = computed(() => route.params.id as string)
const backTo = computed(() => `/orders/dept/${craft.value}`)
const deptName = computed(() => CRAFT_LABELS[craft.value] ?? '部门')

const order = ref<Order | null>(null)
const factoryName = computed(() => order.value?.expand?.factory?.name ?? '-')

// 生产进度相关字段（可编辑）
const form = reactive({
  current_product: '',
  progress: null as number | null,
  is_delayed: false,
  delay_days: null as number | null,
  delay_reason: '',
})
const saving = ref(false)
const saved = ref(false)

// 价格信息（可编辑）
const price = reactive({
  quote_labor_price: null as number | null,
  unit_price: null as number | null,
  unit_price_cny_tax: null as number | null,
  supplier_price: null as number | null,
  process_category: '',
})
const priceSaving = ref(false)
const priceSaved = ref(false)

function initPrice(o: Order) {
  price.quote_labor_price = o.quote_labor_price ?? null
  price.unit_price = o.unit_price ?? null
  price.unit_price_cny_tax = o.unit_price_cny_tax ?? null
  price.supplier_price = o.supplier_price ?? null
  price.process_category = o.process_category ?? ''
}

// 交期/客退信息（可编辑）
const delivery = reactive({
  pmc: '',
  order_no: '',
  actual_delivery_date: '',
  return_count: null as number | null,
})
const delivSaving = ref(false)
const delivSaved = ref(false)
function initDelivery(o: Order) {
  delivery.pmc = o.pmc ?? ''
  delivery.order_no = o.order_no ?? ''
  delivery.actual_delivery_date = o.actual_delivery_date ? o.actual_delivery_date.slice(0, 10) : ''
  delivery.return_count = o.return_count ?? null
}
async function saveDelivery() {
  delivSaving.value = true
  delivSaved.value = false
  await orders.update(id.value, {
    pmc: delivery.pmc,
    order_no: delivery.order_no,
    actual_delivery_date: delivery.actual_delivery_date || undefined,
    return_count: num(delivery.return_count),
  })
  delivSaving.value = false
  delivSaved.value = true
}

onMounted(async () => {
  const o = await pb.collection('orders').getOne<Order>(id.value, { expand: 'factory' })
  order.value = o
  form.current_product = o.current_product ?? ''
  form.progress = o.progress ?? null
  form.is_delayed = o.is_delayed ?? false
  form.delay_days = o.delay_days ?? null
  form.delay_reason = o.delay_reason ?? ''
  initPrice(o)
  initDelivery(o)
})

// 空输入/NaN 归一为 undefined（不更新该数值字段），避免把 '' 发给数值字段
const num = (v: number | null) => (v == null || Number.isNaN(v) || (v as any) === '' ? undefined : Number(v))

async function save() {
  saving.value = true
  saved.value = false
  await orders.update(id.value, {
    current_product: form.current_product,
    progress: num(form.progress),
    is_delayed: form.is_delayed,
    delay_days: num(form.delay_days),
    delay_reason: form.delay_reason,
  })
  saving.value = false
  saved.value = true
}

async function savePrice() {
  priceSaving.value = true
  priceSaved.value = false
  await orders.update(id.value, {
    quote_labor_price: num(price.quote_labor_price),
    unit_price: num(price.unit_price),
    unit_price_cny_tax: num(price.unit_price_cny_tax),
    supplier_price: num(price.supplier_price),
    process_category: price.process_category,
  })
  priceSaving.value = false
  priceSaved.value = true
}
</script>
<template>
  <AppLayout>
    <div class="page">
      <div class="toolbar">
        <RouterLink :to="backTo" class="back">← 返回{{ deptName }}货期管理</RouterLink>
        <h2 style="margin:0">订单详情</h2>
      </div>

      <section class="card" v-if="order">
        <h3 class="sec-title">订单信息</h3>
        <dl class="info">
          <div><dt>工厂</dt><dd>{{ factoryName }}</dd></div>
          <div><dt>工序</dt><dd>{{ order.process || '-' }}</dd></div>
          <div><dt>车间</dt><dd>{{ order.workshop || '-' }}</dd></div>
          <div><dt>货号</dt><dd>{{ order.item_no || '-' }}</dd></div>
          <div><dt>产品</dt><dd>{{ order.product }}</dd></div>
          <div><dt>数量</dt><dd>{{ order.quantity ?? '-' }}</dd></div>
          <div><dt>核价生产工价</dt><dd>{{ order.quote_labor_price ?? '-' }}</dd></div>
          <div><dt>外发单价</dt><dd>{{ order.unit_price ?? '-' }}</dd></div>
          <div><dt>外发工价(人民币含税)</dt><dd>{{ order.unit_price_cny_tax ?? '-' }}</dd></div>
          <div><dt>扣税点1.13后单价</dt><dd>{{ order.unit_price != null ? Math.round((order.unit_price / 1.13) * 10000) / 10000 : '-' }}</dd></div>
          <div><dt>占比</dt><dd>{{ order.unit_price != null && order.quote_labor_price ? Math.round(((order.unit_price / 1.13) / order.quote_labor_price) * 1000) / 10 + '%' : '-' }}</dd></div>
          <div><dt>金额</dt><dd>{{ order.amount != null ? order.amount.toLocaleString() : '-' }}</dd></div>
          <div><dt>下单日期</dt><dd>{{ order.order_date ? order.order_date.slice(0, 10) : '-' }}</dd></div>
          <div><dt>交货日期</dt><dd>{{ order.delivery_date ? order.delivery_date.slice(0, 10) : '-' }}</dd></div>
        </dl>
      </section>

      <section class="card" v-if="order && canEdit">
        <h3 class="sec-title">价格信息</h3>
        <form class="prog-form" @submit.prevent="savePrice">
          <label>加工类别 <input v-model="price.process_category" placeholder="如塑胶半成品" /></label>
          <label>核价生产工价 <input v-model.number="price.quote_labor_price" type="number" min="0" step="0.01" /></label>
          <label>供应商外发价 <input v-model.number="price.supplier_price" type="number" min="0" step="0.01" /></label>
          <label>外发单价 <input v-model.number="price.unit_price" type="number" min="0" step="0.01" /></label>
          <label>外发工价(人民币含税) <input v-model.number="price.unit_price_cny_tax" type="number" min="0" step="0.01" /></label>
          <div class="actions">
            <button type="submit" :disabled="priceSaving">{{ priceSaving ? '保存中…' : '保存' }}</button>
            <span v-if="priceSaved" class="ok">已保存 ✓</span>
          </div>
        </form>
      </section>

      <section class="card" v-if="order && canEdit">
        <h3 class="sec-title">交期 / 客退</h3>
        <form class="prog-form" @submit.prevent="saveDelivery">
          <label>下单PMC <input v-model="delivery.pmc" placeholder="下单跟单人" /></label>
          <label>订单号 <input v-model="delivery.order_no" placeholder="订单号" /></label>
          <label>实际交货时间 <input v-model="delivery.actual_delivery_date" type="date" /></label>
          <label>客退货单数 <input v-model.number="delivery.return_count" type="number" min="0" /></label>
          <div class="actions">
            <button type="submit" :disabled="delivSaving">{{ delivSaving ? '保存中…' : '保存' }}</button>
            <span v-if="delivSaved" class="ok">已保存 ✓</span>
          </div>
        </form>
      </section>

      <section class="card" v-if="order && canEdit">
        <h3 class="sec-title">生产进度</h3>
        <form class="prog-form" @submit.prevent="save">
          <label>当前在生产产品 <input v-model="form.current_product" placeholder="产品" /></label>
          <label>生产完成进度(%) <input v-model.number="form.progress" type="number" min="0" max="100" /></label>
          <label>是否延期
            <select v-model="form.is_delayed">
              <option :value="false">否</option>
              <option :value="true">是</option>
            </select>
          </label>
          <label>延期天数 <input v-model.number="form.delay_days" type="number" min="0" /></label>
          <label class="full">主要延期原因 <input v-model="form.delay_reason" placeholder="原因" /></label>
          <div class="actions">
            <button type="submit" :disabled="saving">{{ saving ? '保存中…' : '保存' }}</button>
            <span v-if="saved" class="ok">已保存 ✓</span>
          </div>
        </form>
      </section>

      <p v-else class="hint">加载中…</p>
    </div>
  </AppLayout>
</template>
<style scoped>
.back { font-size: .9rem; }
.card + .card { margin-top: 1rem; }
.sec-title { margin: 0 0 .9rem; font-size: 1rem; }
.info { display: grid; grid-template-columns: repeat(2, 1fr); gap: .6rem 1.5rem; margin: 0; }
.info > div { display: flex; gap: .6rem; }
.info dt { color: var(--text-soft); min-width: 6.5em; }
.info dd { margin: 0; font-weight: 500; }
.prog-form { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; max-width: 640px; }
.prog-form label { display: flex; flex-direction: column; gap: .3rem; }
.prog-form .full { grid-column: 1 / -1; }
.actions { grid-column: 1 / -1; display: flex; align-items: center; gap: 1rem; margin-top: .25rem; }
.ok { color: var(--success, #16a34a); font-size: .9rem; }
</style>
