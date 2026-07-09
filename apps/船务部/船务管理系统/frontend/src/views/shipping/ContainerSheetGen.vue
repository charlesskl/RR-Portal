<template>
  <div v-loading="loading">
    <el-card>
      <template #header>
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 18px; font-weight: bold;">生成柜单</span>
          <el-button @click="$router.back()">返回</el-button>
        </div>
      </template>

      <div v-if="shipment">
        <el-descriptions :column="3" border>
          <el-descriptions-item label="SO号">{{ shipment.so_number || '-' }}</el-descriptions-item>
          <el-descriptions-item label="柜型">{{ shipment.container_type || '-' }}</el-descriptions-item>
          <el-descriptions-item label="港口">{{ shipment.port || '-' }}</el-descriptions-item>
          <el-descriptions-item label="出货时间">{{ shipment.ship_date || '-' }}</el-descriptions-item>
          <el-descriptions-item label="SI截止">{{ formatDatetime(shipment.si_deadline) }}</el-descriptions-item>
          <el-descriptions-item label="截数期">{{ formatDatetime(shipment.cutoff_date) }}</el-descriptions-item>
          <el-descriptions-item label="收货地">{{ shipment.delivery_address || '-' }}</el-descriptions-item>
          <el-descriptions-item label="CBM">{{ totalCbm || '-' }}</el-descriptions-item>
          <el-descriptions-item label="特殊要求">{{ shipment.special_requirements || '-' }}</el-descriptions-item>
        </el-descriptions>

        <h4 style="margin-top: 16px;">Packing List 明细 ({{ shipment.items?.length || 0 }} 项)</h4>
        <el-table :data="shipment.items || []" border stripe size="small" max-height="400">
          <el-table-column prop="product_code" label="货号" width="100" />
          <el-table-column prop="contract_number" label="合同号" width="120" />
          <el-table-column prop="quantity" label="数量" width="70" />
          <el-table-column prop="pieces" label="件数" width="70" />
          <el-table-column prop="pallet_count" label="卡板数" width="70" />
          <el-table-column prop="customer_po" label="客PO" width="120" />
          <el-table-column label="体积" width="80">
            <template #default="{ row }">
              {{ row.volume != null ? Number(row.volume).toFixed(3) : '-' }}
            </template>
          </el-table-column>
          <el-table-column prop="factory_remark" label="工厂" width="80" />
          <el-table-column prop="box_dimensions" label="长宽高" width="120" v-if="!isCabinet" />
        </el-table>

        <div style="margin-top: 24px; text-align: center;">
          <el-button type="primary" size="large" :loading="downloading" @click="downloadSheet">
            <el-icon><Download /></el-icon> 下载柜单 Excel
          </el-button>
        </div>
      </div>

      <el-empty v-else-if="!loading" description="出货单数据加载失败" />
    </el-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import api from '../../api/auth'
import { apiPath } from '../../api/request'
import { ElMessage } from 'element-plus'
import { Download } from '@element-plus/icons-vue'

const route = useRoute()
const shipmentId = route.params.id
const shipment = ref(null)
const loading = ref(false)
const downloading = ref(false)

const isCabinet = computed(() => {
  const ct = (shipment.value?.container_type || '').toUpperCase()
  return ct && !ct.endsWith('T')
})

const totalCbm = computed(() => {
  const items = shipment.value?.items || []
  const sum = items.reduce((acc, item) => acc + (parseFloat(item.volume) || 0), 0)
  return sum > 0 ? sum.toFixed(3) : null
})

function formatDatetime(val) {
  if (!val) return '-'
  return val.replace('T', ' ').substring(0, 16)
}

async function loadData() {
  loading.value = true
  try {
    const { data } = await api.get(`/shipments/${shipmentId}/`)
    shipment.value = data
  } catch (e) {
    ElMessage.error('加载出货单数据失败')
  } finally {
    loading.value = false
  }
}

async function downloadSheet() {
  downloading.value = true
  try {
    const token = localStorage.getItem('token')
    const res = await fetch(apiPath(`/generator/${shipmentId}/generate/`), {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error('生成失败')
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `柜单_${shipment.value?.so_number || shipmentId}.xlsx`
    a.click()
    URL.revokeObjectURL(a.href)
    ElMessage.success('柜单下载成功')
  } catch (e) {
    ElMessage.error('生成柜单失败：' + e.message)
  } finally {
    downloading.value = false
  }
}

onMounted(loadData)
</script>
