<template>
  <div class="shipment-list-page">
    <el-card shadow="never" class="main-card">
      <template #header>
        <div class="card-header">
          <span class="page-title">出货单管理</span>
          <el-button type="primary" :loading="loading" @click="loadData">
            <el-icon><Refresh /></el-icon>&nbsp;刷新
          </el-button>
        </div>
      </template>

      <!-- 筛选区域 -->
      <div class="filter-bar">
        <el-input v-model="filters.so" placeholder="SO号" clearable style="width:150px" size="small" />
        <el-input v-model="filters.port" placeholder="港口" clearable style="width:90px" size="small" />
        <el-input v-model="filters.country" placeholder="收货地" clearable style="width:90px" size="small" />
        <el-input v-model="filters.containerType" placeholder="柜型" clearable style="width:90px" size="small" />
        <el-select v-model="filters.status" placeholder="状态" clearable style="width:110px" size="small">
          <el-option label="已创建" value="created" />
          <el-option label="待验货" value="pending_qc" />
          <el-option label="待装柜" value="pending_loading" />
          <el-option label="已出货" value="shipped" />
        </el-select>
        <el-date-picker v-model="filters.dateRange" type="daterange" range-separator="至"
          start-placeholder="开始日期" end-placeholder="结束日期" size="small" style="width:230px"
          value-format="YYYY-MM-DD" />
        <el-input v-model="filters.cbm" placeholder="CBM" clearable size="small" style="width:90px" />
        <el-button size="small" @click="resetFilters">重置</el-button>
        <span v-if="pagination.total" style="color:#909399;font-size:13px;margin-left:4px">
          共 {{ pagination.total }} 条
        </span>
      </div>

      <el-table
        :data="filteredRecords"
        border
        stripe
        style="width:100%"
        v-loading="loading"
        size="small"
        @selection-change="handleSelectionChange"
      >
        <el-table-column type="selection" width="38" />
        <el-table-column prop="id" label="ID" width="52" align="center" />
        <el-table-column label="柜号" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="mono">{{ row.container_number || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="SO号" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="mono text-primary">{{ row.so_number || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="柜型" width="80" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.container_type" size="small" type="info" effect="plain">
              {{ row.container_type }}
            </el-tag>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="出货时间" width="90" align="center">
          <template #default="{ row }">{{ row.ship_date || '-' }}</template>
        </el-table-column>
        <el-table-column label="SI截止" width="120" align="center">
          <template #default="{ row }">{{ formatDatetime(row.si_deadline) }}</template>
        </el-table-column>
        <el-table-column label="截数期" width="120" align="center">
          <template #default="{ row }">{{ formatDatetime(row.cutoff_date) }}</template>
        </el-table-column>
        <el-table-column label="港口" width="65" align="center">
          <template #default="{ row }">{{ row.port || '-' }}</template>
        </el-table-column>
        <el-table-column label="收货地" width="65" align="center">
          <template #default="{ row }">{{ row.delivery_address || '-' }}</template>
        </el-table-column>
        <el-table-column label="PL项数" width="65" align="center">
          <template #default="{ row }">
            <el-badge v-if="row.items_count || row.items?.length" :value="row.items_count || row.items.length" type="primary" />
            <span v-else>0</span>
          </template>
        </el-table-column>
        <el-table-column label="CBM" width="80" align="right">
          <template #default="{ row }">
            <span :class="calcCbm(row) === '-' ? 'text-muted' : 'text-success cbm-val'">
              {{ calcCbm(row) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="特殊要求" min-width="90" show-overflow-tooltip>
          <template #default="{ row }">
            <span style="color:#e6a23c;font-size:12px">{{ row.special_requirements || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="82" align="center">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small" effect="light">
              {{ statusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="230" fixed="right">
          <template #default="{ row }">
            <div class="op-btns">
              <el-button type="primary" size="small" plain @click="viewDetail(row)">查看</el-button>
              <el-button type="warning" size="small" plain @click="openVolume(row)">体积</el-button>
              <el-button type="success" size="small" plain @click="goGenerate(row)">柜单</el-button>
              <el-button type="danger" size="small" plain @click="deleteRecord(row)">删除</el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-bar">
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.pageSize"
          :page-sizes="[20, 50, 100, 200]"
          :total="pagination.total"
          layout="total, sizes, prev, pager, next"
          small
          background
          @size-change="handlePageSizeChange"
          @current-change="loadData"
        />
      </div>

      <!-- 批量操作 -->
      <div v-if="selectedRows.length" class="batch-bar">
        <span class="batch-hint">已选 {{ selectedRows.length }} 条</span>
        <el-popconfirm title="确定批量删除选中的记录吗？" @confirm="batchDelete">
          <template #reference>
            <el-button type="danger" size="small">批量删除</el-button>
          </template>
        </el-popconfirm>
      </div>
    </el-card>

    <!-- 详情弹窗 -->
    <el-dialog v-model="showDetail" title="出货单详情" width="92%" top="4vh" destroy-on-close>
      <template v-if="selected">
        <el-descriptions :column="3" border size="small" class="detail-desc">
          <el-descriptions-item label="SO号">
            <b>{{ selected.so_number || '-' }}</b>
          </el-descriptions-item>
          <el-descriptions-item label="柜型">{{ selected.container_type || '-' }}</el-descriptions-item>
          <el-descriptions-item label="SI截止">{{ formatDatetime(selected.si_deadline) }}</el-descriptions-item>
          <el-descriptions-item label="出货时间">{{ selected.ship_date || '-' }}</el-descriptions-item>
          <el-descriptions-item label="截数期">{{ formatDatetime(selected.cutoff_date) }}</el-descriptions-item>
          <el-descriptions-item label="港口">{{ selected.port || '-' }}</el-descriptions-item>
          <el-descriptions-item label="收货地">{{ selected.delivery_address || '-' }}</el-descriptions-item>
          <el-descriptions-item label="CBM总和">
            <b class="text-success">{{ calcCbm(selected) }}</b>
          </el-descriptions-item>
          <el-descriptions-item label="特殊要求">
            <span style="color:#e6a23c">{{ selected.special_requirements || '-' }}</span>
          </el-descriptions-item>
        </el-descriptions>

        <div class="section-header">
          <span>Packing List 明细</span>
          <el-tag size="small" type="info">{{ selectedDisplayItems.length }} 项</el-tag>
        </div>
        <el-table :data="selectedDisplayItems" border stripe size="small" max-height="400">
          <el-table-column prop="product_code" label="货号" width="100" />
          <el-table-column prop="contract_number" label="合同号" width="120" />
          <el-table-column prop="quantity" label="数量" width="70" align="right" />
          <el-table-column prop="pieces" label="件数" width="70" align="right" />
          <el-table-column prop="pallet_count" label="卡板数" width="70" align="right" />
          <el-table-column prop="customer_po" label="客PO" width="120" />
          <el-table-column label="体积(CBM)" width="95" align="right">
            <template #default="{ row: item }">
              <span v-if="item.volume" class="text-success">{{ Number(item.volume).toFixed(3) }}</span>
              <el-tag v-else size="small" type="danger" effect="plain">未填</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="factory_remark" label="工厂" width="80" />
          <el-table-column prop="box_dimensions" label="长宽高" width="120" v-if="!isCabinetType(selected)" />
        </el-table>
      </template>
    </el-dialog>

    <!-- 体积编辑弹窗 -->
    <el-dialog v-model="showVolume" title="填写体积 (CBM)" width="720px" top="8vh" destroy-on-close
      :close-on-click-modal="false">
      <div v-if="volumeShipment">
        <el-alert
          v-if="hasMissingVolume"
          type="warning"
          show-icon
          :closable="false"
          style="margin-bottom:12px"
        >
          <template #title>
            以下货物体积未填写，请补全后方可生成柜单
          </template>
        </el-alert>
        <el-table :data="volumeItems" border stripe size="small" max-height="460">
          <el-table-column prop="product_code" label="货号" width="110" />
          <el-table-column prop="contract_number" label="合同号" width="130" />
          <el-table-column prop="customer_po" label="客PO" width="120" />
          <el-table-column prop="pieces" label="件数" width="65" align="right" />
          <el-table-column label="体积(CBM)" min-width="130">
            <template #default="{ row: item }">
              <el-input-number
                v-model="item._vol"
                :precision="3"
                :step="0.001"
                :min="0"
                :max="999"
                size="small"
                style="width:115px"
                :class="!item._vol ? 'vol-empty' : ''"
                placeholder="请填写"
              />
            </template>
          </el-table-column>
        </el-table>

        <div class="volume-footer">
          <span style="color:#606266;font-size:13px">
            合计 CBM：
            <b class="text-success">{{ volumeTotalCbm }}</b>
          </span>
          <div style="display:flex;gap:8px">
            <el-button @click="showVolume = false">取消</el-button>
            <el-button type="primary" :loading="volSaving" @click="saveVolumes">保存体积</el-button>
          </div>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, reactive, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { listShipments, getShipment, deleteShipment, updateShipmentItem } from '../../api/shipments'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'

const router = useRouter()

const records = ref([])
const loading = ref(false)
const showDetail = ref(false)
const selected = ref(null)
const selectedRows = ref([])
const pagination = reactive({
  page: 1,
  pageSize: 50,
  total: 0,
})

// 体积编辑
const showVolume = ref(false)
const volumeShipment = ref(null)
const volumeItems = ref([])
const volSaving = ref(false)

// 外厂做柜时只显示兴信（本厂）的货物；兴信做柜时显示全部
const selectedDisplayItems = computed(() => {
  const items = selected.value?.items || []
  const mainFactory = selected.value?.main_factory || ''
  if (mainFactory && !mainFactory.includes('兴信')) {
    return items.filter(i => (i.factory_remark || '').includes('兴信'))
  }
  return items
})

const hasMissingVolume = computed(() =>
  volumeItems.value.some(i => !i._vol)
)
const volumeTotalCbm = computed(() => {
  const sum = volumeItems.value.reduce((s, i) => s + (i._vol || 0), 0)
  return sum > 0 ? sum.toFixed(3) : '-'
})

const filters = reactive({
  so: '', port: '', country: '', containerType: '', status: '', dateRange: null,
  cbm: '',
})

const filteredRecords = computed(() => {
  return records.value.filter(r => {
    if (filters.so && !(r.so_number || '').toLowerCase().includes(filters.so.toLowerCase())) return false
    if (filters.port && !(r.port || '').includes(filters.port)) return false
    if (filters.country && !(r.delivery_address || '').includes(filters.country)) return false
    if (filters.containerType && !(r.container_type || '').toUpperCase().includes(filters.containerType.toUpperCase())) return false
    if (filters.status && r.status !== filters.status) return false
    if (filters.dateRange?.length === 2) {
      const created = (r.created_at || '').substring(0, 10)
      if (created < filters.dateRange[0] || created > filters.dateRange[1]) return false
    }
    // CBM 筛选：按 CBM 列显示值的字符串包含匹配（如输入 "67" 匹配 67.190 / 67.018 等）
    if (filters.cbm) {
      const cbmStr = calcCbm(r)
      if (cbmStr === '-' || !cbmStr.includes(filters.cbm.trim())) return false
    }
    return true
  })
})

function resetFilters() {
  Object.assign(filters, {
    so: '', port: '', country: '', containerType: '', status: '', dateRange: null,
    cbm: '',
  })
  pagination.page = 1
}

function handleSelectionChange(rows) { selectedRows.value = rows }

function formatDatetime(val) {
  if (!val) return '-'
  return val.replace('T', ' ').substring(0, 16)
}

function calcCbm(row) {
  if (row.items) {
    const sum = row.items.reduce((acc, item) => acc + (parseFloat(item.volume) || 0), 0)
    return sum > 0 ? sum.toFixed(3) : '-'
  }
  const sum = parseFloat(row.total_cbm)
  return sum > 0 ? sum.toFixed(3) : '-'
}

async function loadData() {
  loading.value = true
  try {
    const params = {
      page: pagination.page,
      page_size: pagination.pageSize,
      so: filters.so || undefined,
      port: filters.port || undefined,
      country: filters.country || undefined,
      container_type: filters.containerType || undefined,
      status: filters.status || undefined,
      date_from: filters.dateRange?.[0] || undefined,
      date_to: filters.dateRange?.[1] || undefined,
    }
    const data = await listShipments(params)
    records.value = data.results || data
    pagination.total = data.count ?? records.value.length
  } catch {
    ElMessage.error('加载数据失败')
  } finally {
    loading.value = false
  }
}

function handlePageSizeChange() {
  pagination.page = 1
  loadData()
}

let filterTimer = null
watch(filters, () => {
  clearTimeout(filterTimer)
  filterTimer = setTimeout(() => {
    pagination.page = 1
    loadData()
  }, 300)
}, { deep: true })

async function viewDetail(row) {
  loading.value = true
  try {
    selected.value = await getShipment(row.id)
    showDetail.value = true
  } catch {
    ElMessage.error('加载详情失败')
  } finally {
    loading.value = false
  }
}

async function openVolume(row) {
  // 拉取最新明细（list 接口可能无 items，getShipment 有）
  let shipment = row
  if (!row.items) {
    try { shipment = await getShipment(row.id) } catch { shipment = row }
  }
  volumeShipment.value = shipment
  volumeItems.value = (shipment.items || []).map(item => ({
    ...item,
    _vol: item.volume ? parseFloat(item.volume) : null,
  }))
  showVolume.value = true
}

async function saveVolumes() {
  volSaving.value = true
  let changed = 0
  try {
    for (const item of volumeItems.value) {
      const orig = item.volume ? parseFloat(item.volume) : null
      if (item._vol !== orig) {
        await updateShipmentItem(volumeShipment.value.id, item.id, { volume: item._vol })
        changed++
      }
    }
    ElMessage.success(`已保存 ${changed} 条体积数据`)
    showVolume.value = false
    await loadData()
  } catch (e) {
    ElMessage.error('保存失败：' + (e.response?.data?.detail || e.message))
  } finally {
    volSaving.value = false
  }
}

function goGenerate(row) {
  router.push(`/review/${row.id}`)
}

async function deleteRecord(row) {
  try {
    await ElMessageBox.confirm(`确定删除出货单 ${row.so_number || '#' + row.id} 吗？`, '确认删除', { type: 'warning' })
    await deleteShipment(row.id)
    ElMessage.success('删除成功')
    await loadData()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error('删除失败：' + (e.response?.data?.error || e.message))
  }
}

async function batchDelete() {
  try {
    for (const row of selectedRows.value) await deleteShipment(row.id)
    ElMessage.success(`成功删除 ${selectedRows.value.length} 条记录`)
    selectedRows.value = []
    await loadData()
  } catch {
    ElMessage.error('批量删除失败')
    await loadData()
  }
}

function isCabinetType(record) {
  const ct = (record?.container_type || '').toUpperCase()
  return ct && !ct.endsWith('T')
}

function statusLabel(s) {
  return { created: '已创建', pending_qc: '待验货', pending_loading: '待装柜', shipped: '已出货' }[s] || s
}

function statusType(s) {
  return { created: 'info', pending_qc: 'warning', pending_loading: '', shipped: 'success' }[s] || ''
}

onMounted(loadData)
</script>

<style scoped>
.shipment-list-page { padding: 0; }

.main-card :deep(.el-card__header) {
  padding: 12px 20px;
  background: #fafafa;
  border-bottom: 1px solid #ebeef5;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.page-title {
  font-size: 17px;
  font-weight: 600;
  color: #303133;
}

.filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
  align-items: center;
}

.mono { font-family: monospace; font-size: 13px; }
.text-primary { color: #409eff; }
.text-success { color: #67c23a; font-weight: 600; }
.text-muted { color: #c0c4cc; }
.cbm-val { font-size: 13px; font-weight: 600; }

.op-btns {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.batch-bar {
  margin-top: 12px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background: #fef9f0;
  border-radius: 4px;
  border: 1px solid #faecd8;
}

.pagination-bar {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}

.batch-hint { color: #e6a23c; font-size: 13px; }

.detail-desc :deep(.el-descriptions__label) {
  font-weight: 600;
  color: #606266;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 16px 0 8px;
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}

.volume-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid #ebeef5;
}

.vol-empty :deep(.el-input__wrapper) {
  box-shadow: 0 0 0 1px #f56c6c inset;
}
</style>
