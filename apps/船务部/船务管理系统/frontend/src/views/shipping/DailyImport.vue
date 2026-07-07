<template>
  <div>
    <el-card shadow="hover" style="border-radius: 8px;">
      <template #header>
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <el-icon :size="22" color="#67c23a"><Plus /></el-icon>
            <span style="font-size: 18px; font-weight: bold;">每日新增出货资料</span>
          </div>
        </div>
      </template>

      <!-- 上传区域 -->
      <el-upload
        ref="uploadRef"
        drag
        multiple
        :auto-upload="false"
        accept=".xls,.xlsx"
        :on-change="handleFileChange"
        :on-remove="handleFileRemove"
      >
        <el-icon style="font-size: 48px; color: #67c23a;"><UploadFilled /></el-icon>
        <div style="margin-top: 8px;">将柜单 Excel 文件拖到此处，或 <em>点击上传</em>（支持多个 .xls/.xlsx）</div>
        <template #tip>
          <div style="color: #909399; font-size: 12px; margin-top: 4px;">系统将自动提取货号、货名、玩具类别、每箱毛重、每箱净重</div>
        </template>
      </el-upload>

      <!-- 客户选择 -->
      <div style="margin-top: 16px; display: flex; gap: 12px; align-items: center;">
        <span style="font-weight: 500;">归属客户：</span>
        <el-select v-model="customer" placeholder="选择客户" style="width: 150px;" @change="onCustomerChange">
          <el-option v-for="c in customers" :key="c" :label="c" :value="c" />
        </el-select>
        <el-button type="success" :loading="importing" :disabled="!fileList.length" @click="doImport" size="large">
          <el-icon><Upload /></el-icon> 导入 ({{ fileList.length }} 个文件)
        </el-button>
        <span v-if="importProgress" style="color: #409eff; font-size: 13px; margin-left: 12px;">{{ importProgress }}</span>
      </div>
    </el-card>

    <!-- 今日导入记录 -->
    <el-card shadow="hover" style="margin-top: 16px; border-radius: 8px;">
      <template #header>
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 16px; font-weight: bold;">最近导入记录</span>
          <el-button size="small" @click="loadRecent" :loading="loadingRecent">刷新</el-button>
        </div>
      </template>
      <el-table :data="recentProducts" border stripe size="small" v-loading="loadingRecent" max-height="400"
        :header-cell-style="{ background: '#fafafa', fontWeight: '600' }">
        <el-table-column prop="product_code" label="货号" width="130">
          <template #default="{ row }">
            <span style="font-weight: 600; color: #409eff;">{{ row.product_code }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="product_name" label="货名" width="160" show-overflow-tooltip />
        <el-table-column prop="toy_category" label="玩具类别" width="100" />
        <el-table-column label="每箱毛重" width="100" align="center">
          <template #default="{ row }">{{ row.gross_weight_per_box || '-' }}</template>
        </el-table-column>
        <el-table-column label="每箱净重" width="100" align="center">
          <template #default="{ row }">{{ row.net_weight_per_box || '-' }}</template>
        </el-table-column>
        <el-table-column prop="customer_name" label="客户" width="90" align="center">
          <template #default="{ row }">
            <el-tag size="small" effect="light" round>{{ row.customer_name || '-' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="source" label="来源" width="100" />
      </el-table>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import api from '../../api/auth'
import { ElMessage } from 'element-plus'

const uploadRef = ref(null)
const fileList = ref([])
const customer = ref('ZURU')
const importing = ref(false)
const recentProducts = ref([])
const loadingRecent = ref(false)
const importProgress = ref('')

const customers = ['ZURU', 'MOOSE', 'TIG', 'TOMY', 'CEPIA', 'AZAD', 'ZANZOON', 'JOHN ADAMS']

function handleFileChange(file, uploadFiles) {
  fileList.value = uploadFiles
}

function handleFileRemove(file, uploadFiles) {
  fileList.value = uploadFiles
}

function onCustomerChange() {
  // 切换客户时清空已选文件
  fileList.value = []
  if (uploadRef.value) {
    uploadRef.value.clearFiles()
  }
  loadRecent()
}

async function doImport() {
  if (!fileList.value.length) return
  importing.value = true
  importProgress.value = ''

  const BATCH_SIZE = 70
  const files = [...fileList.value]
  let totalCreated = 0
  let totalUpdated = 0
  let totalErrors = []

  try {
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE)
      const batchNum = Math.floor(i / BATCH_SIZE) + 1
      const totalBatches = Math.ceil(files.length / BATCH_SIZE)
      importProgress.value = `正在导入第 ${batchNum}/${totalBatches} 批（${i + 1}-${Math.min(i + BATCH_SIZE, files.length)} / ${files.length} 个文件）...`

      const formData = new FormData()
      for (const f of batch) {
        formData.append('files', f.raw)
      }
      formData.append('customer', customer.value)

      const { data } = await api.post('/master-data/import-daily/', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000,
      })
      totalCreated += data.created || 0
      totalUpdated += data.updated || 0
      if (data.errors?.length) totalErrors.push(...data.errors)
    }

    let msg = `导入完成：新增 ${totalCreated}，更新 ${totalUpdated}`
    if (totalErrors.length) msg += `，${totalErrors.length} 个文件解析失败`
    ElMessage.success(msg)
    fileList.value = []
    if (uploadRef.value) uploadRef.value.clearFiles()
    await loadRecent()
  } catch (e) {
    ElMessage.error('导入失败：' + (e.response?.data?.error || e.message))
  } finally {
    importing.value = false
    importProgress.value = ''
  }
}

async function loadRecent() {
  loadingRecent.value = true
  try {
    const { data } = await api.get('/master-data/product-mappings/', {
      params: { page_size: 30, source: 'daily', customer: customer.value }
    })
    recentProducts.value = data.results || data
  } catch (e) {
    console.error(e)
  } finally {
    loadingRecent.value = false
  }
}

onMounted(loadRecent)
</script>
