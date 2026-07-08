<template>
  <div v-loading="loading">
    <!-- 主信息卡片 -->
    <el-card>
      <template #header>
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <span style="font-size: 18px; font-weight: bold;">编辑出货单 #{{ shipmentId }}</span>
            <el-tag :type="statusTagType(form?.status)" size="large">{{ statusLabel(form?.status) }}</el-tag>
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            <!-- 状态推进/撤回 -->
            <el-popconfirm
              v-if="form && form.status !== 'shipped'"
              :title="`确定推进到「${nextStatusLabel(form?.status)}」？`"
              @confirm="doAdvance"
            >
              <template #reference>
                <el-button type="success" :loading="advancing">
                  推进 → {{ nextStatusLabel(form?.status) }}
                </el-button>
              </template>
            </el-popconfirm>
            <el-popconfirm
              v-if="authStore.isSupervisor && form && form.status !== 'created'"
              title="确定撤回到上一个状态？"
              @confirm="doRollback"
            >
              <template #reference>
                <el-button size="small">撤回</el-button>
              </template>
            </el-popconfirm>
            <el-button @click="$router.back()">返回</el-button>
            <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
          </div>
        </div>
      </template>

      <el-form :model="form" label-width="120px" v-if="form">
        <el-row :gutter="20">
          <el-col :span="8">
            <el-form-item label="类型">
              <el-select v-model="form.type" style="width: 100%;">
                <el-option label="整柜 (FCL)" value="FCL" />
                <el-option label="散货 (LCL)" value="LCL" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="SO号">
              <el-input v-model="form.so_number" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="柜型">
              <el-input v-model="form.container_type" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="20">
          <el-col :span="8">
            <el-form-item label="港口">
              <el-input v-model="form.port" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="出货日期">
              <el-date-picker v-model="form.ship_date" type="date" value-format="YYYY-MM-DD" style="width: 100%;" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="柜号">
              <el-input v-model="form.container_number" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="20">
          <el-col :span="8">
            <el-form-item label="SI截止">
              <el-date-picker v-model="form.si_deadline" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" style="width: 100%;" placeholder="SI截止时间" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="截数期">
              <el-date-picker v-model="form.cutoff_date" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" style="width: 100%;" placeholder="截数期" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="报关截止">
              <el-date-picker v-model="form.customs_cutoff" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" style="width: 100%;" placeholder="报关截止时间" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="20">
          <el-col :span="8">
            <el-form-item label="封号">
              <el-input v-model="form.seal_number" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="柜重(kg)">
              <el-input-number v-model="form.container_weight" :precision="2" :min="0" style="width: 100%;" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="仓库">
              <el-input v-model="form.warehouse" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="20">
          <el-col :span="8">
            <el-form-item label="报关行">
              <el-input v-model="form.customs_broker" />
            </el-form-item>
          </el-col>
          <el-col :span="16">
            <el-form-item label="特殊要求">
              <el-input v-model="form.special_requirements" type="textarea" :rows="2" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="20">
          <el-col :span="24">
            <el-form-item label="备注">
              <el-input v-model="form.remarks" type="textarea" :rows="2" />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
    </el-card>

    <!-- 明细 -->
    <el-card style="margin-top: 16px;" v-if="form">
      <ShipmentItemTable :items="form.items || []" :editable="true" @update-item="handleItemUpdate" @refresh="loadData" />
    </el-card>

    <!-- QC验货（仅QC角色可见） -->
    <el-card style="margin-top: 16px;" v-if="form && authStore.user?.role === 'qc'">
      <template #header>
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-weight: bold;">QC验货记录</span>
          <el-button type="primary" size="small" @click="qcDrawerVisible = true">
            新增验货记录
          </el-button>
        </div>
      </template>

      <div v-if="qcList.length === 0" style="text-align: center; padding: 20px; color: #909399;">暂无验货记录</div>
      <div v-for="ins in qcList" :key="ins.id" style="border: 1px solid #e4e7ed; border-radius: 6px; padding: 12px; margin-bottom: 12px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <div style="display: flex; gap: 12px; align-items: center;">
            <el-tag :type="resultTagType(ins.result)" size="small">{{ ins.result_display }}</el-tag>
            <span style="font-size: 13px; color: #606266;">{{ ins.inspector?.display_name }}</span>
            <span style="font-size: 12px; color: #909399;">{{ ins.created_at }}</span>
          </div>
        </div>
        <div v-if="ins.notes" style="font-size: 13px; margin-bottom: 8px; color: #303133;">{{ ins.notes }}</div>
        <!-- 照片 -->
        <div v-if="ins.photos?.length" style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px;">
          <el-image
            v-for="p in ins.photos" :key="p.id"
            :src="p.url" :preview-src-list="ins.photos.map(x => x.url)"
            style="width: 80px; height: 80px; object-fit: cover; border-radius: 4px; cursor: pointer;"
            fit="cover"
          />
        </div>
        <!-- 补充上传照片 -->
        <el-upload
          :action="qcPhotoUploadUrl(ins)"
          :headers="uploadHeaders"
          name="photos"
          multiple
          :show-file-list="false"
          accept="image/*"
          :on-success="() => loadQC()"
        >
          <el-button size="small" text type="primary">+ 补充照片</el-button>
        </el-upload>
      </div>
    </el-card>

    <!-- 新增验货抽屉 -->
    <el-drawer v-model="qcDrawerVisible" title="新增验货记录" size="420px" direction="rtl">
      <el-form :model="qcForm" label-width="80px" style="padding: 0 16px;">
        <el-form-item label="验货结果">
          <el-radio-group v-model="qcForm.result">
            <el-radio value="pass">通过</el-radio>
            <el-radio value="partial">部分通过</el-radio>
            <el-radio value="fail">不通过</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="qcForm.notes" type="textarea" :rows="4" placeholder="问题描述、注意事项等..." />
        </el-form-item>
        <el-form-item label="照片">
          <el-upload
            v-model:file-list="qcPhotos"
            list-type="picture-card"
            :auto-upload="false"
            accept="image/*"
            multiple
          >
            <el-icon><Plus /></el-icon>
          </el-upload>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="qcDrawerVisible = false">取消</el-button>
        <el-button type="primary" :loading="qcSaving" @click="submitQC">提交</el-button>
      </template>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { getShipment, updateShipment } from '../../api/shipments'
import { listQC, createQC, uploadPhotos, advanceStatus, rollbackStatus } from '../../api/qc'
import ShipmentItemTable from '../../components/ShipmentItemTable.vue'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '../../stores/auth'
import { apiPath } from '../../api/request'

const route = useRoute()
const authStore = useAuthStore()
const shipmentId = route.params.id
const form = ref(null)
const loading = ref(false)
const saving = ref(false)
const advancing = ref(false)

const qcList = ref([])
const qcDrawerVisible = ref(false)
const qcSaving = ref(false)
const qcForm = ref({ result: 'pass', notes: '' })
const qcPhotos = ref([])

const uploadHeaders = computed(() => ({
  Authorization: `Bearer ${localStorage.getItem('token')}`,
}))

function qcPhotoUploadUrl(ins) {
  return apiPath(`/shipments/qc/${ins.id}/photos/`)
}

const STATUS_LABELS = {
  created: '已创建',
  pending_qc: '待验货',
  pending_loading: '待装柜',
  shipped: '已出货',
}
const NEXT_STATUS_LABEL = {
  created: '待验货',
  pending_qc: '待装柜',
  pending_loading: '已出货',
}
const STATUS_TAG = {
  created: 'info',
  pending_qc: 'warning',
  pending_loading: 'primary',
  shipped: 'success',
}

function statusLabel(s) { return STATUS_LABELS[s] || s || '-' }
function nextStatusLabel(s) { return NEXT_STATUS_LABEL[s] || '' }
function statusTagType(s) { return STATUS_TAG[s] || 'info' }
function resultTagType(r) {
  return r === 'pass' ? 'success' : r === 'fail' ? 'danger' : 'warning'
}

async function loadData() {
  loading.value = true
  try {
    form.value = await getShipment(shipmentId)
  } catch {
    ElMessage.error('加载出货单失败')
  } finally {
    loading.value = false
  }
}

async function loadQC() {
  qcList.value = await listQC(shipmentId)
}

function handleItemUpdate({ index, field, value }) {
  if (form.value?.items?.[index]) {
    form.value.items[index][field] = value
  }
}

async function handleSave() {
  saving.value = true
  try {
    // eslint-disable-next-line no-unused-vars
    const { items, customer, customer_name, created_by, created_at, id, shipment_type, qc_inspections, notifications, bl_records, ...payload } = form.value
    await updateShipment(shipmentId, payload)
    ElMessage.success('保存成功')
  } catch (e) {
    ElMessage.error('保存失败：' + (e.response?.data?.detail || e.message))
  } finally {
    saving.value = false
  }
}

async function doAdvance() {
  advancing.value = true
  try {
    const res = await advanceStatus(shipmentId)
    form.value.status = res.status
    ElMessage.success(`状态已推进为「${res.status_display}」`)
  } catch (e) {
    ElMessage.error(e.response?.data?.error || '操作失败')
  } finally {
    advancing.value = false
  }
}

async function doRollback() {
  try {
    const res = await rollbackStatus(shipmentId)
    form.value.status = res.status
    ElMessage.success(`已撤回为「${res.status_display}」`)
  } catch (e) {
    ElMessage.error(e.response?.data?.error || '操作失败')
  }
}

async function submitQC() {
  if (!qcForm.value.result) {
    ElMessage.warning('请选择验货结果')
    return
  }
  qcSaving.value = true
  try {
    const ins = await createQC(shipmentId, qcForm.value)
    // 上传照片
    if (qcPhotos.value.length) {
      const files = qcPhotos.value.map(f => f.raw).filter(Boolean)
      if (files.length) await uploadPhotos(ins.id, files)
    }
    ElMessage.success('验货记录已提交')
    qcDrawerVisible.value = false
    qcForm.value = { result: 'pass', notes: '' }
    qcPhotos.value = []
    await loadQC()
  } catch {
    ElMessage.error('提交失败')
  } finally {
    qcSaving.value = false
  }
}

onMounted(async () => {
  await loadData()
  await loadQC()
})
</script>
