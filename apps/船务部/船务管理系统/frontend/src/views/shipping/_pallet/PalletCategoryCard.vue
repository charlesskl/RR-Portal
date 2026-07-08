<template>
  <div style="margin-bottom: 16px;">
    <div :style="{ background: headerColor, padding: '8px 12px', fontWeight: 'bold', display: 'flex', justifyContent: 'space-between' }">
      <span>{{ title }}</span>
      <span>小计: <span style="color:#409eff;">{{ subtotal }}</span> 卡板</span>
    </div>

    <el-table v-if="type === 'self'" :data="flatSelfRows" border size="small" :span-method="selfSpan"
      :header-cell-style="{ background: '#fafafa', fontWeight: '600' }">
      <el-table-column prop="ship_date" label="时间" width="90" />
      <el-table-column prop="so_number" label="SO号" width="160" />
      <el-table-column prop="product_code" label="货号" width="120" />
      <el-table-column prop="product_name" label="货名" min-width="160" show-overflow-tooltip />
      <el-table-column prop="contract_number" label="合同号" width="120" />
      <el-table-column prop="customer_po" label="客PO" width="120" />
      <el-table-column prop="pieces" label="件数" width="80" align="right" />
      <el-table-column prop="pallet_count" label="卡板数" width="80" align="right">
        <template #default="{ row }">
          <span style="color:#409eff;font-weight:600;">{{ row.pallet_count }}</span>
        </template>
      </el-table-column>
    </el-table>

    <el-collapse v-else v-model="activeFactories">
      <el-collapse-item v-for="group in groupedTableRows" :key="group.factory" :name="group.factory">
        <template #title>
          <span style="font-weight: bold;">{{ group.factory }}</span>
          &nbsp;&nbsp;小计: <span style="color:#e6a23c;font-weight:600;">{{ group.subtotal }}</span> 卡板
        </template>
        <el-table :data="group.rows" border size="small" :span-method="groupedSpan"
          :header-cell-style="{ background: '#fafafa', fontWeight: '600' }">
          <el-table-column prop="ship_date" label="时间" width="90" />
          <el-table-column prop="so_number" label="SO号" width="160" />
          <el-table-column prop="product_code" label="货号" width="120" />
          <el-table-column prop="product_name" label="货名" min-width="160" show-overflow-tooltip />
          <el-table-column prop="contract_number" label="合同号" width="120" />
          <el-table-column prop="customer_po" label="客PO" width="120" />
          <el-table-column prop="pieces" label="件数" width="80" align="right" />
          <el-table-column prop="pallet_count" label="卡板数" width="80" align="right">
            <template #default="{ row }">
              <span style="color:#e6a23c;font-weight:600;">{{ row.pallet_count }}</span>
            </template>
          </el-table-column>
        </el-table>
      </el-collapse-item>
    </el-collapse>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({
  title: String,
  type: { type: String, required: true },
  factoryField: { type: String, default: 'factory_remark' },
  items: { type: Array, default: () => [] },
  headerColor: { type: String, default: '#fafafa' },
})

const activeFactories = ref([])

const subtotal = computed(() => props.items.reduce((s, it) => s + (it.pallet_count || 0), 0))

const flatSelfRows = computed(() => {
  const arr = [...props.items]
  arr.sort((a, b) => (a.so_number || '').localeCompare(b.so_number || ''))
  return arr
})

// 预先构建 grouped 视图：每个工厂保留 flatten 后的 rows、subtotal，
// 以及 row → { factoryRows, indexInFactory } 的 Map，便于 span-method O(1) 查找。
const groupedTableRows = computed(() => {
  const factoryMap = new Map() // factory -> { so -> rows[] }
  for (const it of props.items) {
    const f = (it[props.factoryField] || '未知').trim() || '未知'
    const so = it.so_number || '-'
    if (!factoryMap.has(f)) factoryMap.set(f, new Map())
    const soDict = factoryMap.get(f)
    if (!soDict.has(so)) soDict.set(so, [])
    soDict.get(so).push(it)
  }
  const groups = []
  for (const [factory, soDict] of factoryMap.entries()) {
    const rows = []
    let sub = 0
    for (const lst of soDict.values()) {
      for (const it of lst) {
        rows.push(it)
        sub += it.pallet_count || 0
      }
    }
    groups.push({ factory, rows, subtotal: sub })
  }
  return groups
})

// row 引用 → { rows, index } 的反向查找表，供 groupedSpan O(1) 使用。
const rowLookup = computed(() => {
  const map = new Map()
  for (const g of groupedTableRows.value) {
    g.rows.forEach((row, idx) => {
      map.set(row, { rows: g.rows, index: idx })
    })
  }
  return map
})

function rowsBySoSpan(rows, columnIndex, rowIndex) {
  if (columnIndex >= 2) return
  const key = rows[rowIndex].so_number
  let start = rowIndex
  while (start > 0 && rows[start - 1].so_number === key) start--
  let count = 0
  for (let i = start; i < rows.length && rows[i].so_number === key; i++) count++
  return rowIndex === start ? { rowspan: count, colspan: 1 } : { rowspan: 0, colspan: 0 }
}
function selfSpan({ rowIndex, columnIndex }) {
  return rowsBySoSpan(flatSelfRows.value, columnIndex, rowIndex)
}
function groupedSpan({ row, columnIndex }) {
  const entry = rowLookup.value.get(row)
  if (!entry) return
  return rowsBySoSpan(entry.rows, columnIndex, entry.index)
}

// 默认展开第一个工厂，仅在首次出现工厂列表时设置一次，
// 之后用户手动折叠/展开不会被覆盖。
let _defaultExpanded = false
watch(groupedTableRows, (groups) => {
  if (_defaultExpanded) return
  if (groups && groups.length > 0) {
    activeFactories.value = [groups[0].factory]
    _defaultExpanded = true
  }
}, { immediate: true })
</script>
