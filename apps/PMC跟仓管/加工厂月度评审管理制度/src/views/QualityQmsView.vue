<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import AppLayout from '../components/AppLayout.vue'
import { pb } from '../pb'
import { REGION_LABELS, type Region } from '../constants/roles'

type Inspection = Record<string, string | number>
const route = useRoute()
const region = computed(() => route.query.region as Region)
const factories = ref<{ id: string; name: string }[]>([])
const records = ref<Inspection[]>([])
const loading = ref(false)
const error = ref('')
const factory = ref('')
const search = ref('')
const from = ref('')
const to = ref('')
const result = ref('')
const page = ref(1)
const pageSize = 50
let request = 0
const names = computed(() => [...new Set(factories.value.map(f => f.name.trim()))])
const dateError = computed(() => from.value && to.value && from.value > to.value)
const filtered = computed(() => records.value.filter(r => {
  const date = String(r.inspDate || r.date || '').slice(0, 10)
  return !dateError.value && (!factory.value || r.factoryId === factory.value) &&
    (!from.value || date >= from.value) && (!to.value || date <= to.value) &&
    (!result.value || r.result === result.value) &&
    (!search.value.trim() || [r.factoryName, r.supplier, r.productNo, r.productName, r.orderNo, r.defect, r.qc]
      .some(v => String(v || '').toLowerCase().includes(search.value.trim().toLowerCase())))
}).sort((a, b) => String(b.inspDate || b.date).localeCompare(String(a.inspDate || a.date)) || Number(b.id) - Number(a.id)))
const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize)))
const rows = computed(() => filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize))
const results = computed(() => [...new Set(records.value.map(r => String(r.result)).filter(Boolean))].sort())
watch([factory, search, from, to, result], () => { page.value = 1 })
async function refresh() {
  const current = ++request
  loading.value = true
  error.value = ''
  records.value = []
  factories.value = []
  page.value = 1
  try {
    const data = await pb.send<{ factories: { id: string; name: string }[]; records: Inspection[] }>(
      '/api/factory-review/qms-inspections', { method: 'GET', query: { region: region.value } })
    if (current !== request) return
    factories.value = data.factories
    records.value = data.records
    if (!factories.value.some(f => f.id === factory.value)) factory.value = ''
  } catch (err: any) {
    if (current === request) error.value = err?.response?.message || '验货明细加载失败，请重试'
  } finally {
    if (current === request) loading.value = false
  }
}
watch(region, () => { factory.value = ''; void refresh() }, { immediate: true })
const columns = [
  ['inspDate', '验货日期'], ['companyName', '来源公司'], ['factoryName', '加工厂'], ['supplier', '品质系统供应商'], ['client', '客户'], ['productNo', '货号'],
  ['productName', '款式名称'], ['orderNo', 'PO号'], ['deliveryNo', '送货单号'], ['type', '类型'],
  ['qty', '来料数'], ['sampleQty', '抽查数'], ['fail', 'FAIL数'], ['defectRate', '不良率'],
  ['defect', '不良现象'], ['result', '判定'], ['qc', '检验员'], ['remark', '备注'],
] as const
function cell(row: Inspection, key: string) {
  const value = key === 'inspDate' ? row.inspDate || row.date : row[key]
  return value === '' || value == null ? '—' : value
}
</script>

<template>
  <AppLayout>
    <div class="page">
      <div class="toolbar">
        <h2>验货明细 · {{ REGION_LABELS[region] }}厂区</h2>
        <RouterLink to="/quality">返回品质管理</RouterLink>
        <button :disabled="loading" @click="refresh">{{ loading ? '加载中…' : '刷新数据' }}</button>
      </div>
      <p class="hint">数据来源：品质管理系统。支持加工厂简称与全称自动匹配；同一简称对应多家工厂时不自动归属。仅供查看。</p>
      <div class="filters">
        <label>加工厂<select v-model="factory"><option value="">全部加工厂</option><option v-for="item in factories" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
        <label>搜索<input v-model="search" placeholder="加工厂 / 货号 / 款式 / PO号 / 检验员" type="search"></label>
        <label>验货日期从<input v-model="from" type="date"></label>
        <label>至<input v-model="to" type="date"></label>
        <label>判定<select v-model="result"><option value="">全部判定</option><option v-for="item in results" :key="item">{{ item }}</option></select></label>
        <button @click="factory = ''; search = ''; from = ''; to = ''; result = ''">清除筛选</button>
      </div>
      <p v-if="dateError" class="error" role="alert">开始日期不能晚于结束日期。</p>
      <p v-if="error" class="error" role="alert">{{ error }} <button @click="refresh">重试</button></p>
      <p v-else-if="loading" role="status">正在拉取品质管理系统验货明细…</p>
      <template v-else>
        <p class="hint">已有加工厂 {{ names.length }} 家 · 已匹配 {{ records.length }} 条 · 当前显示 {{ filtered.length }} 条验货记录</p>
        <div class="table-scroll">
          <table>
            <thead><tr><th v-for="[key, label] in columns" :key="key">{{ label }}</th></tr></thead>
            <tbody>
              <tr v-for="row in rows" :key="row.recordKey"><td v-for="[key] in columns" :key="key" :class="{ pass: key === 'result' && row.result === 'PASS', fail: key === 'result' && row.result === 'REJ' }">{{ cell(row, key) }}</td></tr>
              <tr v-if="!rows.length"><td :colspan="columns.length" class="empty">{{ !names.length ? '该厂区暂无可查看的加工厂。' : records.length ? '当前筛选条件下暂无匹配记录，请清除筛选或扩大日期范围。' : '暂无匹配的验货记录；已支持常见简称与全称匹配，请核对厂区、供应商名称，或是否存在同名加工厂。' }}</td></tr>
            </tbody>
          </table>
        </div>
        <div class="pagination"><button :disabled="page <= 1" @click="page--">上一页</button><span>第 {{ page }} / {{ pageCount }} 页</span><button :disabled="page >= pageCount" @click="page++">下一页</button></div>
      </template>
    </div>
  </AppLayout>
</template>

<style scoped>
h2 { margin: 0; }
.toolbar, .filters, .pagination { display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; }
.filters { margin: 1.2rem 0; align-items: end; }
.filters label { display: flex; flex-direction: column; gap: .4rem; font-size: .85rem; }
input, select { padding: .6rem; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--text); }
input[type=search] { min-width: 280px; }
.hint { color: var(--text-soft); font-size: .9rem; }
.table-scroll { overflow-x: auto; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); }
table { width: 100%; border-collapse: collapse; font-size: .88rem; }
th, td { padding: .8rem; text-align: left; border-bottom: 1px solid var(--border); white-space: nowrap; }
th { background: var(--primary-soft); }
.empty { padding: 2rem; text-align: center; white-space: normal; }
.pass { color: #15803d; font-weight: 600; }
.fail, .error { color: #b91c1c; }
.pagination { justify-content: end; margin-top: 1rem; }
</style>
