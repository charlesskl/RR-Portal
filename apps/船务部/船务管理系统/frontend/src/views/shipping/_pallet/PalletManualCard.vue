<template>
  <div style="margin-bottom: 16px;">
    <div :style="{ background: headerColor, padding: '8px 12px', fontWeight: 'bold', display: 'flex', justifyContent: 'space-between' }">
      <span>{{ title }}</span>
      <div>
        <span>小计: <span style="color:#67c23a;">{{ subtotal }}</span> 卡板</span>
        <el-button type="primary" size="small" @click="addRow" style="margin-left: 12px;">
          <el-icon><Plus /></el-icon> 新增
        </el-button>
      </div>
    </div>
    <el-table :data="items" border size="small" :header-cell-style="{ background: '#fafafa', fontWeight: '600' }">
      <el-table-column label="日期" width="100">
        <template #default="{ row }"><el-input v-model="row.date" size="small" placeholder="如 4/6" @change="emit('change')" /></template>
      </el-table-column>
      <el-table-column label="SO号" width="150">
        <template #default="{ row }"><el-input v-model="row.so_number" size="small" @change="emit('change')" /></template>
      </el-table-column>
      <el-table-column label="货号" width="120">
        <template #default="{ row }"><el-input v-model="row.product_code" size="small" @blur="onProductCodeChange(row)" /></template>
      </el-table-column>
      <el-table-column label="货名" min-width="160">
        <template #default="{ row }">
          <span style="color:#606266;">{{ row.product_name || '-' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="合同号" width="130">
        <template #default="{ row }"><el-input v-model="row.contract_number" size="small" @change="emit('change')" /></template>
      </el-table-column>
      <el-table-column label="件数" width="100">
        <template #default="{ row }">
          <el-input-number v-model="row.pieces" size="small" :min="0" controls-position="right" style="width:100%;" @change="emit('change')" />
        </template>
      </el-table-column>
      <el-table-column label="卡板数" width="100">
        <template #default="{ row }">
          <el-input-number v-model="row.pallet_count" size="small" :min="0" controls-position="right" style="width:100%;" @change="emit('change')" />
        </template>
      </el-table-column>
      <el-table-column label="操作" width="70" align="center">
        <template #default="{ $index }">
          <el-button link type="danger" size="small" @click="removeRow($index)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { Plus } from '@element-plus/icons-vue'
import api from '../../../api/auth'

const props = defineProps({
  title: String,
  items: { type: Array, default: () => [] },
  headerColor: { type: String, default: '#fafafa' },
})
const emit = defineEmits(['update:items', 'change'])

const subtotal = computed(() => props.items.reduce((s, it) => s + (it.pallet_count || 0), 0))

function addRow() {
  const newItem = { date: '', so_number: '', product_code: '', product_name: '', contract_number: '', pieces: 0, pallet_count: 0 }
  emit('update:items', [...props.items, newItem])
  emit('change')
}
function removeRow(idx) {
  const newArr = [...props.items]; newArr.splice(idx, 1)
  emit('update:items', newArr); emit('change')
}

async function onProductCodeChange(row) {
  if (!row.product_code) return
  let productName = ''
  try {
    const { data } = await api.get('/master-data/product-mappings/', { params: { search: row.product_code, page_size: 1 } })
    const items = data.results || data
    if (items.length && items[0].product_name) productName = items[0].product_name
  } catch (e) { /* ignore */ }
  if (productName) {
    const idx = props.items.indexOf(row)
    if (idx >= 0) {
      const newArr = [...props.items]
      newArr[idx] = { ...row, product_name: productName }
      emit('update:items', newArr)
    }
  }
  emit('change')
}
</script>
