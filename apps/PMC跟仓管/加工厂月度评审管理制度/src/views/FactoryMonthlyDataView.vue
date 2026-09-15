<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import AppLayout from '../components/AppLayout.vue'
import { pb } from '../pb'
import { useFactoriesStore } from '../stores/factories'
import { CRAFT_LABELS, REGION_LABELS, regionOf } from '../constants/roles'
import { filterMonthlyScoringData } from '../utils/monthlyAutoScoring'
import type { Factory } from '../types/factory'
import type { Order } from '../types/order'
import type { QualityInspection } from '../types/qualityInspection'
import type { Quality5sCheck } from '../types/quality5s'

const route = useRoute()
const router = useRouter()
const factories = useFactoriesStore()
const factoryId = String(route.params.id ?? '')
const routeMonth = String(route.params.month ?? '')
const month = ref(/^\d{4}-\d{2}$/.test(routeMonth) ? routeMonth : new Date().toISOString().slice(0, 7))
const factory = ref<Factory | null>(null)
const orders = ref<Order[]>([])
const inspections = ref<QualityInspection[]>([])
const checks = ref<Quality5sCheck[]>([])
const loading = ref(true)
const loadError = ref('')

const SCORE_FIELDS: (keyof Quality5sCheck)[] = [
  's_area', 's_material', 's_hygiene', 's_sharp',
  's_nonconform', 's_standard', 's_qc_staff', 's_correction',
]

const monthlyData = computed(() => filterMonthlyScoringData({
  orders: orders.value,
  inspections: inspections.value,
  checks: checks.value,
}, month.value))

const deliveryRows = computed(() => [...monthlyData.value.orders].sort((a, b) =>
  String(b.delivery_date ?? b.actual_delivery_date ?? b.order_date ?? '')
    .localeCompare(String(a.delivery_date ?? a.actual_delivery_date ?? a.order_date ?? ''))))
const inspectionRows = computed(() => [...monthlyData.value.inspections].sort((a, b) =>
  String(b.inspect_date ?? '').localeCompare(String(a.inspect_date ?? ''))))
const checkRows = computed(() => [...monthlyData.value.checks].sort((a, b) =>
  String(b.check_date ?? '').localeCompare(String(a.check_date ?? ''))))

const deliverySummary = computed(() => {
  const groups = new Map<string, Order[]>()
  for (const order of deliveryRows.value) {
    const key = order.order_no?.trim() || `record:${order.id}`
    const group = groups.get(key)
    if (group) group.push(order)
    else groups.set(key, [order])
  }
  const delayed = [...groups.values()].filter((group) => group.some((order) => order.is_delayed || Number(order.delay_days) > 0)).length
  return { total: groups.size, delayed, onTime: groups.size - delayed }
})
const qualitySummary = computed(() => {
  const valid = inspectionRows.value.filter((item) => String(item.internal_result ?? '').trim())
  const pass = valid.filter((item) => String(item.internal_result).trim().toUpperCase() === 'PASS').length
  return { total: inspectionRows.value.length, pass, failed: valid.length - pass }
})

function date(value: unknown) {
  return String(value ?? '').slice(0, 10) || '-'
}

function siteScore(check: Quality5sCheck) {
  return SCORE_FIELDS.reduce((sum, field) => sum + (Number(check[field]) || 0), 0)
}

function resultClass(value: unknown) {
  const result = String(value ?? '').trim().toUpperCase()
  return result === 'PASS' ? 'result-pass' : result ? 'result-fail' : ''
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const filter = `factory = ${JSON.stringify(factoryId)}`
    const [factoryRecord, orderRecords, inspectionRecords, checkRecords] = await Promise.all([
      factories.get(factoryId),
      pb.collection('orders').getFullList<Order>({ filter }),
      pb.collection('quality_inspections').getFullList<QualityInspection>({ filter }),
      pb.collection('quality_5s_checks').getFullList<Quality5sCheck>({ filter }),
    ])
    factory.value = factoryRecord
    orders.value = orderRecords
    inspections.value = inspectionRecords
    checks.value = checkRecords
  } catch (error: any) {
    loadError.value = error?.response?.message || error?.message || '数据读取失败'
  } finally {
    loading.value = false
  }
}

function changeMonth() {
  if (!/^\d{4}-\d{2}$/.test(month.value)) return
  void router.replace(`/factories/${factoryId}/monthly-data/${month.value}`)
}

onMounted(load)
</script>

<template>
  <AppLayout>
    <div class="page monthly-data-page">
      <div class="toolbar">
        <RouterLink :to="{ path: '/scoring', query: { month } }" class="back">← 工厂月度评分</RouterLink>
        <h2>{{ factory?.name || '工厂月度数据' }}</h2>
        <span v-if="factory" class="muted">
          {{ REGION_LABELS[regionOf(factory)] }}厂区 · {{ CRAFT_LABELS[factory.craft] }}
        </span>
        <span class="spacer"></span>
        <label class="month-picker">月份 <input v-model="month" type="month" @change="changeMonth" /></label>
      </div>

      <div v-if="loading" class="card state-box">正在读取货期和品质数据…</div>
      <div v-else-if="loadError" class="card state-box error-box" role="alert">
        读取失败：{{ loadError }} <button class="ghost mini" @click="load">重试</button>
      </div>

      <template v-else>
        <div class="summary-grid">
          <div class="summary-card delivery-card"><span>货期订单</span><strong>{{ deliverySummary.total }}</strong><small>准时 {{ deliverySummary.onTime }} · 延期 {{ deliverySummary.delayed }}</small></div>
          <div class="summary-card inspection-card"><span>品质验货</span><strong>{{ qualitySummary.total }}</strong><small>PASS {{ qualitySummary.pass }} · 其他 {{ qualitySummary.failed }}</small></div>
          <div class="summary-card check-card"><span>5S 检查</span><strong>{{ checkRows.length }}</strong><small>{{ month }} 评分数据</small></div>
        </div>

        <section class="card data-section">
          <div class="section-title"><h3>货期管理数据</h3><span class="muted">{{ deliveryRows.length }} 条明细</span></div>
          <div class="table-scroll">
            <table>
              <thead><tr><th>订单号</th><th>货号</th><th v-if="factory?.craft === 'injection'">模具编号</th><th>物料名称</th><th>数量</th><th>下单时间</th><th>下单交货时间</th><th>实际交货时间</th><th>延期天数</th><th>状态</th></tr></thead>
              <tbody>
                <tr v-for="order in deliveryRows" :key="order.id">
                  <td>{{ order.order_no || '-' }}</td><td>{{ order.item_no || '-' }}</td><td v-if="factory?.craft === 'injection'">{{ order.mold_no || '-' }}</td>
                  <td>{{ order.product || '-' }}</td><td>{{ order.quantity ?? '-' }}</td><td>{{ date(order.order_date) }}</td><td>{{ date(order.delivery_date) }}</td><td>{{ date(order.actual_delivery_date) }}</td>
                  <td :class="{ delayed: Number(order.delay_days) > 0 }">{{ order.delay_days ?? 0 }}</td><td>{{ order.is_delayed || Number(order.delay_days) > 0 ? '延期' : '准时' }}</td>
                </tr>
                <tr v-if="!deliveryRows.length"><td :colspan="factory?.craft === 'injection' ? 10 : 9" class="empty">该月无货期管理数据</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="card data-section">
          <div class="section-title"><h3>品质管理数据 · 验货记录</h3><span class="muted">{{ inspectionRows.length }} 条</span></div>
          <div class="table-scroll">
            <table>
              <thead><tr><th>送货日期</th><th>加工类型</th><th>客户</th><th>送货单号</th><th>货号</th><th>产品名称</th><th>数量</th><th>内部检验结果</th><th>不良描述</th><th>检验人员</th><th>客户检验结果</th></tr></thead>
              <tbody>
                <tr v-for="inspection in inspectionRows" :key="inspection.id">
                  <td>{{ date(inspection.inspect_date) }}</td><td>{{ inspection.process_type || '-' }}</td><td>{{ inspection.customer || '-' }}</td><td>{{ inspection.delivery_no || '-' }}</td>
                  <td>{{ inspection.item_no || '-' }}</td><td>{{ inspection.product || '-' }}</td><td>{{ inspection.quantity ?? '-' }}</td>
                  <td :class="resultClass(inspection.internal_result)">{{ inspection.internal_result || '-' }}</td><td>{{ inspection.internal_defect || '-' }}</td><td>{{ inspection.internal_inspector || '-' }}</td>
                  <td :class="resultClass(inspection.cust_result)">{{ inspection.cust_result || '-' }}</td>
                </tr>
                <tr v-if="!inspectionRows.length"><td colspan="11" class="empty">该月无品质验货记录</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="card data-section">
          <div class="section-title"><h3>品质管理数据 · 5S 检查</h3><span class="muted">{{ checkRows.length }} 条</span></div>
          <div class="table-scroll">
            <table>
              <thead><tr><th>检查日期</th><th>检查类型</th><th>加工项目</th><th>客户</th><th>检查人员</th><th>现场得分</th><th>IP 管控</th><th>备注</th></tr></thead>
              <tbody>
                <tr v-for="check in checkRows" :key="check.id">
                  <td>{{ date(check.check_date) }}</td><td>{{ check.check_type || '-' }}</td><td>{{ check.project || '-' }}</td><td>{{ check.customer || '-' }}</td><td>{{ check.inspector || '-' }}</td>
                  <td><strong>{{ siteScore(check) }}/100</strong></td><td>{{ check.ip_control || '-' }}</td><td>{{ check.notes || '-' }}</td>
                </tr>
                <tr v-if="!checkRows.length"><td colspan="8" class="empty">该月无 5S 检查记录</td></tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>
    </div>
  </AppLayout>
</template>

<style scoped>
.monthly-data-page { display: flex; flex-direction: column; gap: 1rem; }
.toolbar h2 { margin: 0; }
.back { font-size: .9rem; }
.month-picker { display: flex; align-items: center; gap: .45rem; }
.state-box { text-align: center; color: var(--text-soft); }
.error-box { color: #b91c1c; }
.mini { padding: .25rem .6rem; font-size: .8rem; }
.summary-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .8rem; }
.summary-card { --accent: #4f46e5; display: grid; gap: .25rem; padding: .9rem 1.1rem; background: var(--surface); border: 1px solid var(--border); border-left: 4px solid var(--accent); border-radius: var(--radius); }
.summary-card span, .summary-card small { color: var(--text-soft); }
.summary-card strong { font-size: 1.65rem; color: var(--accent); }
.delivery-card { --accent: #d97706; }
.inspection-card { --accent: #0d9488; }
.check-card { --accent: #16a34a; }
.data-section { padding: 0; overflow: hidden; }
.section-title { display: flex; align-items: center; gap: .7rem; padding: .85rem 1rem; border-bottom: 1px solid var(--border); }
.section-title h3 { margin: 0; font-size: 1rem; }
.table-scroll { overflow: auto; }
table { min-width: 100%; border: 0; border-radius: 0; }
th, td { padding: .65rem .75rem; white-space: nowrap; font-size: .82rem; text-align: center; }
td:nth-child(4), td:nth-child(6) { max-width: 240px; overflow: hidden; text-overflow: ellipsis; }
.empty { padding: 1.5rem; color: var(--text-soft); }
.delayed, .result-fail { color: #dc2626; font-weight: 600; }
.result-pass { color: #15803d; font-weight: 600; }
@media (max-width: 760px) { .summary-grid { grid-template-columns: 1fr; } }
</style>
