<template>
  <el-container style="height: 100vh">
    <el-aside width="220px" style="background-color: #304156">
      <div style="height: 60px; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 18px; font-weight: bold;">
        船务管理系统
      </div>
      <el-menu
        :default-active="$route.path"
        background-color="#304156"
        text-color="#bfcbd9"
        active-text-color="#409eff"
        router
      >
        <el-menu-item v-if="auth.canAccess('emails')" index="/emails">
          <el-icon><Message /></el-icon>
          <span>邮件导入</span>
        </el-menu-item>
        <el-menu-item v-if="auth.canAccess('shipments')" index="/shipments">
          <el-icon><Document /></el-icon>
          <span>出货单管理</span>
        </el-menu-item>
        <el-menu-item v-if="auth.canAccess('products')" index="/master/products">
          <el-icon><Goods /></el-icon>
          <span>货号映射</span>
        </el-menu-item>
        <el-menu-item v-if="auth.canAccess('factories')" index="/master/factories">
          <el-icon><OfficeBuilding /></el-icon>
          <span>工厂映射</span>
        </el-menu-item>
        <el-menu-item v-if="auth.canAccess('daily-import')" index="/daily-import">
          <el-icon><Plus /></el-icon>
          <span>每日新增出货</span>
        </el-menu-item>
        <el-menu-item v-if="auth.canAccess('pallets')" index="/pallets">
          <el-icon><Box /></el-icon>
          <span>卡板数统计</span>
        </el-menu-item>
        <el-menu-item v-if="auth.canAccess('bill-of-lading')" index="/bill-of-lading">
          <el-icon><DocumentChecked /></el-icon>
          <span>找提单/核对</span>
        </el-menu-item>
        <el-menu-item v-if="auth.canAccess('user-management')" index="/master/users">
          <el-icon><UserFilled /></el-icon>
          <span>用户管理</span>
        </el-menu-item>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header style="display: flex; align-items: center; justify-content: flex-end; background: #fff; box-shadow: 0 1px 4px rgba(0,21,41,.08); gap: 16px;">
        <!-- 通知铃铛 -->
        <el-popover placement="bottom-end" :width="360" trigger="click" @show="markAllRead">
          <template #reference>
            <el-badge :value="unreadCount || ''" :hidden="unreadCount === 0" type="danger">
              <el-button circle size="small" style="border: none; box-shadow: none;">
                <el-icon :size="18"><Bell /></el-icon>
              </el-button>
            </el-badge>
          </template>
          <div style="max-height: 400px; overflow-y: auto;">
            <div style="font-weight: bold; margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid #eee;">
              通知消息
            </div>
            <div v-if="notifications.length === 0" style="text-align: center; color: #909399; padding: 20px;">
              暂无通知
            </div>
            <div
              v-for="n in notifications" :key="n.id"
              style="padding: 8px 0; border-bottom: 1px solid #f5f5f5; cursor: pointer;"
              :style="{ background: n.is_read ? 'transparent' : '#ecf5ff' }"
              @click="goToShipment(n)"
            >
              <div style="font-size: 13px; color: #303133;">{{ n.message }}</div>
              <div style="font-size: 11px; color: #909399; margin-top: 2px;">{{ n.created_at }}</div>
            </div>
          </div>
        </el-popover>

        <!-- 用户下拉 -->
        <el-dropdown @command="handleCommand">
          <span style="cursor: pointer; display: flex; align-items: center; gap: 4px;">
            {{ auth.user?.display_name || auth.user?.username || '用户' }}
            <el-tag size="small" type="info" style="margin-left: 4px;">{{ auth.user?.role_display }}</el-tag>
            <el-icon style="margin-left: 2px;"><ArrowDown /></el-icon>
          </span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="changePwd">修改密码</el-dropdown-item>
              <el-dropdown-item command="logout" divided>退出登录</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </el-header>

      <el-main style="background: #f0f2f5; overflow-y: auto;">
        <router-view />
      </el-main>
    </el-container>
  </el-container>

  <!-- 修改密码对话框 -->
  <el-dialog v-model="pwdDialogVisible" title="修改密码" width="360px">
    <el-form label-width="80px">
      <el-form-item label="新密码">
        <el-input v-model="newPassword" type="password" placeholder="至少6位" show-password />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="pwdDialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="changingPwd" @click="handleChangePwd">确认修改</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '../stores/auth'
import { changeMyPassword } from '../api/accounts'
import { listNotifications, markRead } from '../api/qc'

const router = useRouter()
const auth = useAuthStore()

const pwdDialogVisible = ref(false)
const newPassword = ref('')
const changingPwd = ref(false)
const notifications = ref([])
const unreadCount = computed(() => notifications.value.filter(n => !n.is_read).length)

let pollTimer = null

async function fetchNotifications() {
  try {
    const data = await listNotifications()
    notifications.value = data.notifications || []
  } catch {
    // 静默失败
  }
}

async function markAllRead() {
  const unreadIds = notifications.value.filter(n => !n.is_read).map(n => n.id)
  if (!unreadIds.length) return
  await markRead(unreadIds)
  notifications.value.forEach(n => { n.is_read = true })
}

function goToShipment(n) {
  if (n.shipment_id) {
    router.push(`/shipments/${n.shipment_id}`)
  }
}

function handleCommand(cmd) {
  if (cmd === 'logout') {
    auth.logout()
    router.push('/login')
  } else if (cmd === 'changePwd') {
    newPassword.value = ''
    pwdDialogVisible.value = true
  }
}

async function handleChangePwd() {
  if (newPassword.value.length < 6) {
    ElMessage.warning('密码至少6位')
    return
  }
  changingPwd.value = true
  try {
    await changeMyPassword(newPassword.value)
    ElMessage.success('密码已修改，请重新登录')
    pwdDialogVisible.value = false
    auth.logout()
    router.push('/login')
  } catch {
    ElMessage.error('修改失败')
  } finally {
    changingPwd.value = false
  }
}

onMounted(() => {
  fetchNotifications()
  pollTimer = setInterval(fetchNotifications, 30000) // 每30秒轮询
})

onUnmounted(() => {
  clearInterval(pollTimer)
})
</script>
