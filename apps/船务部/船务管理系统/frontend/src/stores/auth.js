import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { login as loginApi } from '../api/auth'

export const useAuthStore = defineStore('auth', () => {
  const token = ref(localStorage.getItem('token') || '')
  const user = ref(JSON.parse(localStorage.getItem('user') || 'null'))
  const isAuthenticated = computed(() => !!token.value)

  const isSupervisor = computed(() => user.value?.role === 'supervisor')
  const isShipping = computed(() => user.value?.role === 'shipping')

  // 权限矩阵：各角色可访问的页面
  const accessMap = {
    supervisor:       ['emails', 'shipments', 'products', 'factories', 'daily-import', 'pallets', 'bill-of-lading', 'user-management'],
    shipping:         ['emails', 'shipments', 'products', 'factories', 'daily-import', 'pallets', 'bill-of-lading'],
    warehouse_clerk:  ['shipments', 'daily-import', 'pallets'],
    cargo_tracker:    ['shipments', 'pallets'],
    qc:               ['shipments'],
    warehouse_manager:['shipments', 'daily-import', 'pallets'],
    customs:          ['shipments', 'bill-of-lading'],
  }

  function canAccess(page) {
    if (!user.value) return false
    if (user.value.is_superuser) return true
    return (accessMap[user.value.role] || []).includes(page)
  }

  async function login(username, password) {
    const data = await loginApi(username, password)
    token.value = data.access
    user.value = data.user
    localStorage.setItem('token', data.access)
    if (data.refresh) localStorage.setItem('refresh_token', data.refresh)
    localStorage.setItem('user', JSON.stringify(data.user))
    return data
  }

  function logout() {
    token.value = ''
    user.value = null
    localStorage.removeItem('token')
    localStorage.removeItem('refresh_token')
    localStorage.removeItem('user')
  }

  function updateUser(newUser) {
    user.value = newUser
    localStorage.setItem('user', JSON.stringify(newUser))
  }

  return { token, user, isAuthenticated, isSupervisor, isShipping, canAccess, login, logout, updateUser }
})
