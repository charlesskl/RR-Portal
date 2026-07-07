<template>
  <div>
    <el-card shadow="hover" style="border-radius: 8px;">
      <template #header>
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <el-icon :size="22" color="#e6a23c"><OfficeBuilding /></el-icon>
            <span style="font-size: 18px; font-weight: bold;">工厂映射管理</span>
            <el-tag effect="dark" round size="small">{{ factories.length }}</el-tag>
          </div>
          <el-button type="primary" @click="addNew" size="small">
            <el-icon><Plus /></el-icon> 新增
          </el-button>
        </div>
      </template>

      <el-table :data="factories" border v-loading="loading" style="width: 100%;" size="default"
        :header-cell-style="{ background: '#fafafa', color: '#303133', fontWeight: '600', fontSize: '14px', padding: '12px 0' }"
        :row-style="{ height: '48px' }"
        :cell-style="{ fontSize: '13px', padding: '8px 0' }">
        <el-table-column prop="english_name" label="英文名称" min-width="250">
          <template #default="{ row }">
            <span style="color: #303133;">{{ row.english_name }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="chinese_short_name" label="中文简称" width="120" align="center">
          <template #default="{ row }">
            <el-tag size="default" effect="plain" round>{{ row.chinese_short_name }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="本厂" width="80" align="center">
          <template #default="{ row }">
            <el-tag :type="row.is_local ? 'success' : 'info'" size="small" effect="light">
              {{ row.is_local ? '是' : '否' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="130" align="center" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="editRow(row)"><el-icon><Edit /></el-icon> 编辑</el-button>
            <el-button link type="danger" @click="deleteRow(row)"><el-icon><Delete /></el-icon> 删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 编辑弹窗 -->
    <el-dialog v-model="showEdit" :title="editForm.id ? '编辑工厂映射' : '新增工厂映射'" width="460px" :close-on-click-modal="false">
      <el-form :model="editForm" label-width="90px" style="padding: 0 10px;">
        <el-form-item label="英文名称" required>
          <el-input v-model="editForm.english_name" placeholder="如 Dong Guan Hanson" />
        </el-form-item>
        <el-form-item label="中文简称" required>
          <el-input v-model="editForm.chinese_short_name" placeholder="如 兴信" />
        </el-form-item>
        <el-form-item label="本厂">
          <el-switch v-model="editForm.is_local" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEdit = false">取消</el-button>
        <el-button type="primary" @click="saveEdit" :loading="saving">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import api from '../../api/auth'
import { ElMessage, ElMessageBox } from 'element-plus'

const factories = ref([])
const loading = ref(false)
const saving = ref(false)
const showEdit = ref(false)
const editForm = ref({})

async function loadData() {
  loading.value = true
  try {
    const { data } = await api.get('/master-data/factory-mappings/')
    factories.value = data.results || data
  } catch (e) {
    ElMessage.error('加载失败')
  } finally {
    loading.value = false
  }
}

function addNew() {
  editForm.value = { english_name: '', chinese_short_name: '', is_local: false }
  showEdit.value = true
}

function editRow(row) {
  editForm.value = { ...row }
  showEdit.value = true
}

async function saveEdit() {
  if (!editForm.value.english_name || !editForm.value.chinese_short_name) {
    ElMessage.warning('请填写英文名称和中文简称')
    return
  }
  saving.value = true
  try {
    if (editForm.value.id) {
      await api.patch(`/master-data/factory-mappings/${editForm.value.id}/`, editForm.value)
    } else {
      await api.post('/master-data/factory-mappings/', editForm.value)
    }
    ElMessage.success('保存成功')
    showEdit.value = false
    await loadData()
  } catch (e) {
    const detail = e?.response?.data
    if (detail?.english_name) {
      ElMessage.error('该英文名称已存在')
    } else {
      ElMessage.error('保存失败')
    }
  } finally {
    saving.value = false
  }
}

async function deleteRow(row) {
  try {
    await ElMessageBox.confirm(`确定删除 ${row.english_name} → ${row.chinese_short_name} 吗？`, '确认', { type: 'warning' })
    await api.delete(`/master-data/factory-mappings/${row.id}/`)
    ElMessage.success('删除成功')
    await loadData()
  } catch (e) {
    if (e !== 'cancel') ElMessage.error('删除失败')
  }
}

onMounted(loadData)
</script>
