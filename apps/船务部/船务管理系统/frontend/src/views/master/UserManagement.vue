<template>
  <div style="padding: 20px;">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
      <h2 style="margin: 0;">用户管理</h2>
      <el-button type="primary" @click="openCreate">新建用户</el-button>
    </div>

    <el-table :data="users" border stripe>
      <el-table-column prop="id" label="ID" width="60" />
      <el-table-column prop="username" label="用户名" width="140" />
      <el-table-column prop="display_name" label="显示名" width="140" />
      <el-table-column prop="role_display" label="角色" width="120" />
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="row.is_active ? 'success' : 'danger'" size="small">
            {{ row.is_active ? '启用' : '禁用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="date_joined" label="创建时间" min-width="160">
        <template #default="{ row }">{{ row.date_joined?.slice(0, 10) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="220" fixed="right">
        <template #default="{ row }">
          <el-button size="small" @click="openEdit(row)">编辑</el-button>
          <el-button size="small" @click="openResetPwd(row)">重置密码</el-button>
          <el-button size="small" type="danger" @click="handleDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 新建/编辑用户对话框 -->
    <el-dialog v-model="dialogVisible" :title="editingUser ? '编辑用户' : '新建用户'" width="420px">
      <el-form :model="form" label-width="80px">
        <el-form-item label="用户名" v-if="!editingUser">
          <el-input v-model="form.username" placeholder="登录用户名" />
        </el-form-item>
        <el-form-item label="密码" v-if="!editingUser">
          <el-input v-model="form.password" type="password" placeholder="至少6位" show-password />
        </el-form-item>
        <el-form-item label="显示名">
          <el-input v-model="form.display_name" placeholder="姓名或昵称" />
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="form.role" style="width: 100%;">
            <el-option v-for="r in roleOptions" :key="r.value" :label="r.label" :value="r.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态" v-if="editingUser">
          <el-switch v-model="form.is_active" active-text="启用" inactive-text="禁用" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>

    <!-- 重置密码对话框 -->
    <el-dialog v-model="pwdDialogVisible" title="重置密码" width="380px">
      <el-form label-width="80px">
        <el-form-item label="新密码">
          <el-input v-model="newPassword" type="password" placeholder="至少6位" show-password />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="pwdDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleResetPwd">确认重置</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { listUsers, createUser, updateUser, deleteUser, resetPassword } from '../../api/accounts'

const users = ref([])
const dialogVisible = ref(false)
const pwdDialogVisible = ref(false)
const editingUser = ref(null)
const saving = ref(false)
const newPassword = ref('')
const resetTarget = ref(null)

const form = ref({ username: '', password: '', display_name: '', role: 'shipping', is_active: true })

const roleOptions = [
  { value: 'supervisor',        label: '主管' },
  { value: 'shipping',          label: '船务' },
  { value: 'warehouse_clerk',   label: '仓库跟单' },
  { value: 'cargo_tracker',     label: '货物跟踪' },
  { value: 'qc',                label: 'QC' },
  { value: 'warehouse_manager', label: '仓管' },
  { value: 'customs',           label: '报关' },
]

async function load() {
  users.value = await listUsers()
}

function openCreate() {
  editingUser.value = null
  form.value = { username: '', password: '', display_name: '', role: 'shipping', is_active: true }
  dialogVisible.value = true
}

function openEdit(user) {
  editingUser.value = user
  form.value = { display_name: user.display_name, role: user.role, is_active: user.is_active }
  dialogVisible.value = true
}

function openResetPwd(user) {
  resetTarget.value = user
  newPassword.value = ''
  pwdDialogVisible.value = true
}

async function handleSave() {
  saving.value = true
  try {
    if (editingUser.value) {
      await updateUser(editingUser.value.id, form.value)
      ElMessage.success('保存成功')
    } else {
      if (!form.value.username || !form.value.password) {
        ElMessage.warning('用户名和密码不能为空')
        return
      }
      await createUser(form.value)
      ElMessage.success('创建成功')
    }
    dialogVisible.value = false
    await load()
  } catch (e) {
    const d = e.response?.data
    // DRF 字段验证错误：{ username: ["..."], password: ["..."] }
    const fieldErr = d && typeof d === 'object'
      ? Object.entries(d).map(([k, v]) => `${k}: ${Array.isArray(v) ? v[0] : v}`).join('；')
      : null
    ElMessage.error(fieldErr || d?.error || d?.detail || '操作失败')
  } finally {
    saving.value = false
  }
}

async function handleDelete(user) {
  await ElMessageBox.confirm(`确定删除用户「${user.display_name || user.username}」？`, '确认', { type: 'warning' })
  await deleteUser(user.id)
  ElMessage.success('已删除')
  await load()
}

async function handleResetPwd() {
  if (newPassword.value.length < 6) {
    ElMessage.warning('密码至少6位')
    return
  }
  saving.value = true
  try {
    await resetPassword(resetTarget.value.id, newPassword.value)
    ElMessage.success('密码已重置')
    pwdDialogVisible.value = false
  } catch {
    ElMessage.error('重置失败')
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>
