<template>
  <div v-loading="loading" class="review-page">
    <el-card>
      <template #header>
        <div class="page-header">
          <span class="page-title">柜单审核</span>
          <div style="display:flex;gap:8px;">
            <el-button @click="$router.back()">返回</el-button>
            <el-button type="success" :loading="saving" @click="saveOnly">保存修改</el-button>
            <el-button type="primary" :loading="downloading" @click="downloadOnly">
              <el-icon><Download /></el-icon> 生成柜单
            </el-button>
          </div>
        </div>
      </template>

      <div v-if="form">
        <!-- 基本信息 -->
        <div class="section-title">基本信息</div>
        <el-form :model="form" label-width="90px" size="small" class="info-form">
          <el-row :gutter="16">
            <el-col :span="6">
              <el-form-item label="SO 号">
                <el-input v-model="form.so_number" />
              </el-form-item>
            </el-col>
            <el-col :span="6">
              <el-form-item label="柜型">
                <el-input v-model="form.container_type" />
              </el-form-item>
            </el-col>
            <el-col :span="6">
              <el-form-item label="做柜工厂">
                <el-input v-model="form.main_factory" />
              </el-form-item>
            </el-col>
            <el-col :span="6">
              <el-form-item label="国家">
                <el-input v-model="form.country" />
              </el-form-item>
            </el-col>
          </el-row>
          <el-row :gutter="16">
            <el-col :span="6">
              <el-form-item label="出货时间">
                <el-input v-model="form.ship_date" placeholder="格式：2026-05-01" />
              </el-form-item>
            </el-col>
            <el-col :span="6">
              <el-form-item label="SI 截止">
                <el-input v-model="form.si_deadline_display" placeholder="如：4/29 16:00" />
              </el-form-item>
            </el-col>
            <el-col :span="6">
              <el-form-item label="截数期">
                <el-input v-model="form.cutoff_date_display" placeholder="如：5/1 16:00" />
              </el-form-item>
            </el-col>
            <el-col :span="6">
              <el-form-item label="港口">
                <el-input v-model="form.port" />
              </el-form-item>
            </el-col>
          </el-row>
          <el-row :gutter="16">
            <el-col :span="12">
              <el-form-item label="特殊要求">
                <el-input v-model="form.special_requirements" />
              </el-form-item>
            </el-col>
            <el-col :span="6">
              <el-form-item label="收货地">
                <el-input v-model="form.delivery_address" />
              </el-form-item>
            </el-col>
            <el-col :span="6">
              <el-form-item label="总 CBM">
                <el-input :value="totalCbm" disabled />
              </el-form-item>
            </el-col>
          </el-row>
        </el-form>

        <!-- 货物明细 -->
        <div class="section-title" style="margin-top:12px;">
          货物明细
          <el-button type="primary" size="small" plain style="margin-left:12px;" @click="addItem">
            + 新增行
          </el-button>
          <el-button type="danger" size="small" plain style="margin-left:8px;" @click="removeEmptyRows">
            清除空行
          </el-button>
        </div>

        <el-table :data="form.items" border stripe size="small" max-height="480" class="items-table">
          <el-table-column type="index" label="#" width="40" />
          <el-table-column label="货号" width="110">
            <template #default="{ row }">
              <el-input v-model="row.product_code" size="small" />
            </template>
          </el-table-column>
          <el-table-column label="合同号" width="130">
            <template #default="{ row }">
              <el-input v-model="row.contract_number" size="small" />
            </template>
          </el-table-column>
          <el-table-column label="客PO" width="120">
            <template #default="{ row }">
              <el-input v-model="row.customer_po" size="small" />
            </template>
          </el-table-column>
          <el-table-column label="数量" width="85">
            <template #default="{ row }">
              <el-input v-model="row.quantity" size="small" />
            </template>
          </el-table-column>
          <el-table-column label="件数" width="75">
            <template #default="{ row }">
              <el-input v-model="row.pieces" size="small" />
            </template>
          </el-table-column>
          <el-table-column label="卡板数" width="70">
            <template #default="{ row }">
              <el-input v-model="row.pallet_count" size="small" />
            </template>
          </el-table-column>
          <el-table-column label="CBM" width="90">
            <template #default="{ row }">
              <el-input v-model="row.volume" size="small" />
            </template>
          </el-table-column>
          <el-table-column label="工厂" width="80">
            <template #default="{ row }">
              <el-input v-model="row.factory_remark" size="small" />
            </template>
          </el-table-column>
          <el-table-column label="规格(每箱)" width="85">
            <template #default="{ row }">
              <el-input v-model="row.spec" size="small" />
            </template>
          </el-table-column>
          <el-table-column label="长宽高" width="110" v-if="showDimensions">
            <template #default="{ row }">
              <el-input v-model="row.box_dimensions" size="small" />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="55" fixed="right">
            <template #default="{ $index }">
              <el-button type="danger" size="small" plain @click.stop="removeItem($index)">删</el-button>
            </template>
          </el-table-column>
        </el-table>

        <div style="margin-top:8px;color:#909399;font-size:12px;">
          共 {{ form.items.length }} 行，总 CBM：{{ totalCbm }}
        </div>
      </div>

      <el-empty v-else-if="!loading" description="出货单数据加载失败" />
    </el-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '../../api/auth'
import { apiPath } from '../../api/request'
import { updateShipment, updateShipmentItem, deleteShipmentItem } from '../../api/shipments'
import { ElMessage } from 'element-plus'
import { Download } from '@element-plus/icons-vue'

const route = useRoute()
const router = useRouter()
const shipmentId = route.params.id

const loading = ref(false)
const saving = ref(false)
const downloading = ref(false)
const form = ref(null)
const deletedItemIds = ref([])  // 记录被删除的已有行 ID

const totalCbm = computed(() => {
  if (!form.value) return '0.000'
  const sum = (form.value.items || []).reduce((acc, it) => acc + (parseFloat(it.volume) || 0), 0)
  return sum.toFixed(3)
})

const showDimensions = computed(() => {
  const ct = (form.value?.container_type || '').toUpperCase()
  return ct.endsWith('T')
})

function formatDateDisplay(iso) {
  // "2026-04-29T16:00:00+08:00" → "4/29 16:00"
  if (!iso) return ''
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return iso
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
  } catch (e) { return iso }
}

function parseDisplayToISO(display) {
  // "4/29 16:00" → "2026-04-29T16:00:00+08:00" (本年, 显式北京时区)
  // 显式带 +08:00：避免 DRF 按 UTC 解析造成 ±8 小时偏移
  if (!display) return null
  if (/^\d{4}-\d{2}-\d{2}T/.test(display)) return display
  const year = new Date().getFullYear()
  const m = display.match(/^(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/)
  if (!m) return null
  const month = String(m[1]).padStart(2, '0')
  const day = String(m[2]).padStart(2, '0')
  const hour = m[3] ? String(m[3]).padStart(2, '0') : '00'
  const min = m[4] ? m[4] : '00'
  return `${year}-${month}-${day}T${hour}:${min}:00+08:00`
}

async function loadData() {
  loading.value = true
  try {
    const { data } = await api.get(`/shipments/${shipmentId}/`)
    form.value = {
      so_number: data.so_number || '',
      container_type: data.container_type || '',
      main_factory: data.main_factory || '',   // 模型实际字段名
      country: data.country || '',
      ship_date: data.ship_date || '',          // DateField，格式 "2026-05-01"
      si_deadline: data.si_deadline || '',      // 原始 ISO，用于保存
      si_deadline_display: formatDateDisplay(data.si_deadline),  // 显示用
      cutoff_date: data.cutoff_date || '',
      cutoff_date_display: formatDateDisplay(data.cutoff_date),
      port: data.port || '',
      special_requirements: data.special_requirements || '',
      delivery_address: data.delivery_address || '',
      items: (data.items || []).map(it => ({ ...it })),
    }
    deletedItemIds.value = []
  } catch (e) {
    ElMessage.error('加载出货单数据失败')
  } finally {
    loading.value = false
  }
}

function addItem() {
  form.value.items.push({
    product_code: '', contract_number: '', customer_po: '',
    quantity: '', pieces: '', pallet_count: '', volume: '',
    factory_remark: '', spec: '', box_dimensions: '',
  })
}

function removeItem(index) {
  const item = form.value.items[index]
  if (!item) return
  if (item.id && item.id > 0) {
    deletedItemIds.value.push(item.id)
  }
  // 重新赋值数组，确保 fixed 列下响应式更新
  form.value.items = form.value.items.filter((_, i) => i !== index)
}

function removeEmptyRows() {
  // 清除所有"空行"：货号 + 合同号 + 客PO + 数量 + 件数 + CBM 全部为空/0 的行
  const isEmpty = (it) => !((it.product_code || '').trim()
    || (it.contract_number || '').trim()
    || (it.customer_po || '').trim()
    || parseFloat(it.quantity) > 0
    || parseFloat(it.pieces) > 0
    || parseFloat(it.volume) > 0)
  const toRemove = form.value.items.filter(isEmpty)
  if (!toRemove.length) {
    ElMessage.info('没有空行可清除')
    return
  }
  // 已存在的行（有 id）加入 delete 队列
  for (const it of toRemove) {
    if (it.id && it.id > 0) deletedItemIds.value.push(it.id)
  }
  form.value.items = form.value.items.filter(it => !isEmpty(it))
  ElMessage.success(`已清除 ${toRemove.length} 行空行（点保存生效）`)
}

async function doSave() {
  // 1. 保存出货单头部信息
  const siISO = parseDisplayToISO(form.value.si_deadline_display)
  const coISO = parseDisplayToISO(form.value.cutoff_date_display)

  console.log('[doSave] shipmentId:', shipmentId, 'siISO:', siISO, 'coISO:', coISO)
  await updateShipment(shipmentId, {
    so_number: form.value.so_number,
    container_type: form.value.container_type,
    main_factory: form.value.main_factory,    // ← 正确的模型字段名
    country: form.value.country,
    ship_date: form.value.ship_date || null,
    si_deadline: siISO,
    cutoff_date: coISO,
    port: form.value.port,
    special_requirements: form.value.special_requirements,
    delivery_address: form.value.delivery_address,
  })

  // 2. 删除被移除的行
  if (deletedItemIds.value.length) {
    await Promise.all(deletedItemIds.value.map(id => deleteShipmentItem(shipmentId, id)))
    deletedItemIds.value = []
  }

  // 3. 逐行保存货物（id > 0 的才 PATCH，新增行跳过）
  const itemsToSave = form.value.items.filter(it => it.id && it.id > 0)
  console.log('[doSave] items to save:', itemsToSave.map(it => it.id))
  if (itemsToSave.length) {
    await Promise.all(itemsToSave.map(it =>
      updateShipmentItem(shipmentId, it.id, {
        product_code: it.product_code,
        contract_number: it.contract_number,
        customer_po: it.customer_po,
        quantity: it.quantity !== '' ? it.quantity : null,
        pieces: it.pieces !== '' ? it.pieces : null,
        pallet_count: it.pallet_count !== '' ? it.pallet_count : null,
        volume: it.volume !== '' ? it.volume : null,
        factory_remark: it.factory_remark || '',
        spec: it.spec || '',
        box_dimensions: it.box_dimensions || '',
      })
    ))
  }
}

function getErrMsg(e) {
  if (e.response) {
    const d = e.response.data
    if (d && typeof d === 'object' && Object.keys(d).length) return JSON.stringify(d)
    return `HTTP ${e.response.status}`
  }
  return e.message || String(e)
}

async function saveOnly() {
  saving.value = true
  try {
    await doSave()
    ElMessage.success('保存成功')
  } catch (e) {
    console.error('saveOnly error', e, e.response?.data)
    ElMessage({ type: 'error', message: '保存失败：' + getErrMsg(e), duration: 8000 })
  } finally {
    saving.value = false
  }
}

async function downloadOnly() {
  downloading.value = true
  try {
    await doSave()
    const token = localStorage.getItem('token')
    // 加时间戳 + no-store：防止浏览器 disk cache 返回上次生成的旧柜单
    const res = await fetch(apiPath(`/generator/${shipmentId}/generate/?t=${Date.now()}`), {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`生成失败 (${res.status}): ${errText.slice(0, 200)}`)
    }
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `柜单_${form.value.so_number || shipmentId}.xlsx`
    a.click()
    URL.revokeObjectURL(a.href)
    ElMessage.success('保存成功，柜单已下载')
  } catch (e) {
    console.error('downloadOnly error', e, e.response?.data)
    ElMessage({ type: 'error', message: '操作失败：' + getErrMsg(e), duration: 8000 })
  } finally {
    downloading.value = false
  }
}

onMounted(loadData)
</script>

<style scoped>
.review-page { padding: 0; }
.page-header { display: flex; justify-content: space-between; align-items: center; }
.page-title { font-size: 18px; font-weight: bold; }
.section-title {
  font-size: 14px; font-weight: bold; color: #303133;
  margin-bottom: 10px; padding-left: 8px; border-left: 3px solid #409eff;
}
.info-form :deep(.el-form-item) { margin-bottom: 10px; }
.items-table :deep(.el-input__inner) { padding: 0 4px; }
</style>
