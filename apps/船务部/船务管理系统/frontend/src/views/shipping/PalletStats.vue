<template>
  <div>
    <el-card>
      <template #header>
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 18px; font-weight: bold;">卡板数统计</span>
          <div style="display: flex; gap: 8px;">
            <el-button type="primary" size="small" @click="loadData" :loading="loading">
              <el-icon><Refresh /></el-icon> 刷新
            </el-button>
            <el-button type="success" size="small" @click="exportExcel" :loading="exporting">
              <el-icon><Download /></el-icon> 导出 Excel
            </el-button>
          </div>
        </div>
      </template>

      <!-- 筛选器 -->
      <el-form :inline="true" size="small" style="margin-bottom: 12px;">
        <el-form-item label="月份">
          <el-date-picker v-model="filterMonth" type="month" format="YYYY-MM" value-format="YYYY-MM"
            placeholder="选择月份" style="width: 130px;" @change="onMonthChange" />
        </el-form-item>
        <el-form-item label="日期范围">
          <el-date-picker v-model="filterRange" type="daterange" format="YYYY-MM-DD" value-format="YYYY-MM-DD"
            range-separator="~" start-placeholder="开始" end-placeholder="结束" style="width: 240px;" />
        </el-form-item>
        <el-form-item label="工厂">
          <el-select v-model="filterFactories" multiple collapse-tags placeholder="全部" style="width: 180px;">
            <el-option v-for="f in allFactories" :key="f" :label="f" :value="f" />
          </el-select>
        </el-form-item>
        <el-form-item label="分类">
          <el-select v-model="filterCategory" placeholder="全部" style="width: 130px;" clearable>
            <el-option label="本厂做柜" value="self" />
            <el-option label="送外厂" value="local" />
            <el-option label="外厂送来" value="external" />
            <el-option label="送博锐" value="borui" />
            <el-option label="送库有" value="kuyou" />
          </el-select>
        </el-form-item>
      </el-form>

      <!-- 统计卡片 -->
      <el-row :gutter="16" style="margin-bottom: 20px;">
        <el-col :span="6"><el-statistic title="本厂做柜卡板数" :value="totals.self" /></el-col>
        <el-col :span="6"><el-statistic title="送外厂卡板数" :value="totals.local" /></el-col>
        <el-col :span="6"><el-statistic title="外厂送来卡板数" :value="totals.external" /></el-col>
        <el-col :span="6"><el-statistic title="总卡板数" :value="totals.grand" /></el-col>
      </el-row>

      <!-- 树状分组主表 -->
      <PalletCategoryCard v-if="categoryVisible('self')" title="本厂做柜卡板（兴信做柜）"
        type="self" :items="filteredSelf" header-color="#e8f4fd" />
      <PalletCategoryCard v-if="categoryVisible('local')" title="送外厂卡板（兴信→外厂拼柜）"
        type="grouped" factory-field="zuogui_factory" :items="filteredLocal" header-color="#fdf6ec" />
      <PalletCategoryCard v-if="categoryVisible('external')" title="外厂送来卡板（外厂→兴信拼柜）"
        type="grouped" factory-field="factory_remark" :items="filteredExternal" header-color="#f0f9eb" />
      <PalletManualCard v-if="categoryVisible('borui')" title="送博锐手填" v-model:items="boruiPallets"
        @change="saveManualData" header-color="#fef0f0" />
      <PalletManualCard v-if="categoryVisible('kuyou')" title="送库有手填" v-model:items="kuyouPallets"
        @change="saveManualData" header-color="#f0f9eb" />
    </el-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { Refresh, Download } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { listEmails } from '../../api/emails'
import { exportPalletReport } from '../../api/pallets'
import api from '../../api/auth'
import PalletCategoryCard from './_pallet/PalletCategoryCard.vue'
import PalletManualCard from './_pallet/PalletManualCard.vue'

const records = ref([])
const loading = ref(false)
const exporting = ref(false)
const productMap = ref({})

const filterMonth = ref(getLastMonth())
const filterRange = ref(monthToRange(getLastMonth()))
const filterFactories = ref([])
const filterCategory = ref('')

const boruiPallets = ref([])
const kuyouPallets = ref([])

function getLastMonth() {
  const d = new Date()
  d.setDate(1); d.setMonth(d.getMonth() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function monthToRange(month) {
  const [y, m] = month.split('-').map(Number)
  const start = new Date(y, m - 1, 1)
  const end = new Date(y, m, 0)
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return [fmt(start), fmt(end)]
}
function onMonthChange(v) { if (v) filterRange.value = monthToRange(v) }

function parseShipDate(s) {
  if (!s || typeof s !== 'string') return null
  if (s.includes('-') && s.length >= 8) return s
  if (s.includes('/')) {
    const [m, d] = s.split('/')
    const y = new Date().getFullYear()
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }
  return null
}
function inRange(shipDate, range) {
  if (!range || !range[0]) return true
  const d = parseShipDate(shipDate); if (!d) return false
  return d >= range[0] && d <= range[1]
}

async function loadData() {
  loading.value = true
  try {
    const all = await listEmails()
    records.value = all.filter(r => r.status === 'shipment_created')
    await fillProductNames()
  } finally { loading.value = false }
}

async function fillProductNames() {
  const codes = new Set()
  for (const r of records.value) {
    for (const it of (r.parsed_data || {}).packing_list_items || []) {
      if (it.product_code) codes.add(it.product_code)
    }
  }
  const pending = [...codes].filter(code => !productMap.value[code])
  await Promise.all(pending.map(async (code) => {
    try {
      const { data } = await api.get('/master-data/product-mappings/', { params: { search: code, page_size: 1 } })
      const items = data.results || data
      if (items.length && items[0].product_name) productMap.value[code] = items[0].product_name
    } catch (e) { /* ignore */ }
  }))
  productMap.value = { ...productMap.value }
}

function buildAllItems() {
  const self_ = [], local = [], external = []
  for (const r of records.value) {
    const p = r.parsed_data || {}
    const zg = p.zuogui_factory || ''
    const so = p.so_number || '-'
    const shipDate = p.ship_date || ''
    for (const it of p.packing_list_items || []) {
      const pc = parseInt(it.pallet_count) || 0
      if (pc <= 0) continue
      const fr = (it.factory_remark || '').trim()
      const enriched = {
        ship_date: shipDate, so_number: so, zuogui_factory: zg,
        product_code: it.product_code, product_name: productMap.value[it.product_code] || '',
        contract_number: it.contract_number, customer_po: it.customer_po,
        pieces: parseInt(it.pieces) || 0, pallet_count: pc, factory_remark: fr,
      }
      const isXxZg = !zg || zg.includes('兴信') || zg.toLowerCase().includes('hanson')
      const isXxFr = !fr || fr.includes('兴信') || fr.toLowerCase().includes('hanson')
      if (isXxZg) {
        if (isXxFr) self_.push(enriched)
        else external.push(enriched)
      } else {
        local.push(enriched)
      }
    }
  }
  return { self: self_, local, external }
}

const allItems = computed(() => buildAllItems())

function applyFilter(items) {
  return items.filter(it => {
    if (!inRange(it.ship_date, filterRange.value)) return false
    if (filterFactories.value.length) {
      if (!filterFactories.value.includes(it.factory_remark) &&
          !filterFactories.value.includes(it.zuogui_factory)) return false
    }
    return true
  })
}
const filteredSelf = computed(() => applyFilter(allItems.value.self))
const filteredLocal = computed(() => applyFilter(allItems.value.local))
const filteredExternal = computed(() => applyFilter(allItems.value.external))

const totals = computed(() => {
  const sum = (arr) => arr.reduce((s, it) => s + (it.pallet_count || 0), 0)
  const s = sum(filteredSelf.value), l = sum(filteredLocal.value), e = sum(filteredExternal.value)
  return { self: s, local: l, external: e, grand: s + l + e }
})

const allFactories = computed(() => {
  const set = new Set()
  for (const items of [allItems.value.self, allItems.value.local, allItems.value.external]) {
    for (const it of items) {
      if (it.factory_remark) set.add(it.factory_remark)
      if (it.zuogui_factory) set.add(it.zuogui_factory)
    }
  }
  return [...set].sort()
})

function categoryVisible(cat) {
  return !filterCategory.value || filterCategory.value === cat
}

function saveManualData() {
  localStorage.setItem('pallet_borui', JSON.stringify(boruiPallets.value))
  localStorage.setItem('pallet_kuyou', JSON.stringify(kuyouPallets.value))
}
function loadManualData() {
  try {
    const b = localStorage.getItem('pallet_borui'); if (b) boruiPallets.value = JSON.parse(b)
    const k = localStorage.getItem('pallet_kuyou'); if (k) kuyouPallets.value = JSON.parse(k)
  } catch (e) {
    console.warn('Failed to load pallet manual data from localStorage:', e)
  }
}

async function exportExcel() {
  exporting.value = true
  try {
    const payload = {
      start: filterRange.value[0], end: filterRange.value[1],
      factories: filterFactories.value, categories: filterCategory.value ? [filterCategory.value] : [],
      self_items: categoryVisible('self') ? filteredSelf.value : [],
      local_items: categoryVisible('local') ? filteredLocal.value : [],
      external_items: categoryVisible('external') ? filteredExternal.value : [],
      manual_borui: categoryVisible('borui') ? boruiPallets.value : [],
      manual_kuyou: categoryVisible('kuyou') ? kuyouPallets.value : [],
    }
    const blob = await exportPalletReport(payload)
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([blob]))
    link.download = `卡板数报表_${payload.start}_至_${payload.end}.xlsx`
    link.click()
    URL.revokeObjectURL(link.href)
    ElMessage.success('导出成功')
  } catch (e) {
    ElMessage.error('导出失败: ' + (e?.response?.data?.error || e.message))
  } finally { exporting.value = false }
}

onMounted(async () => {
  await loadData()
  loadManualData()
})
</script>
