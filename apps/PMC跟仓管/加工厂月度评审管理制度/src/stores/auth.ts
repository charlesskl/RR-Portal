import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { pb } from '../pb'
import type { Role, Craft } from '../constants/roles'
import { setAuthorizedCrafts, setPermissionOverrides } from '../utils/permissions'

function recordCrafts(record: any): Craft[] {
  if (Array.isArray(record?.crafts) && record.crafts.length) return record.crafts as Craft[]
  return record?.craft ? [record.craft as Craft] : []
}

export const useAuthStore = defineStore('auth', () => {
  const userId = ref<string | null>(pb.authStore.record?.id ?? null)
  const role = ref<Role | null>((pb.authStore.record?.role as Role) ?? null)
  const craft = ref<Craft | null>((pb.authStore.record?.craft as Craft) ?? null)
  const crafts = ref<Craft[]>(recordCrafts(pb.authStore.record))
  const displayName = ref<string>(pb.authStore.record?.display_name ?? '')
  // 初始注入当前用户的权限覆盖项
  setPermissionOverrides((pb.authStore.record?.permissions as Record<string, boolean>) ?? null)
  setAuthorizedCrafts(crafts.value)

  const isLoggedIn = computed(() => !!userId.value)

  function sync() {
    const rec = pb.authStore.record
    userId.value = rec?.id ?? null
    role.value = (rec?.role as Role) ?? null
    craft.value = (rec?.craft as Craft) ?? null
    crafts.value = recordCrafts(rec)
    displayName.value = rec?.display_name ?? ''
    setPermissionOverrides((rec?.permissions as Record<string, boolean>) ?? null)
    setAuthorizedCrafts(crafts.value)
  }

  async function login(email: string, password: string) {
    await pb.collection('users').authWithPassword(email, password)
    sync()
  }
  function logout() {
    pb.authStore.clear()
    sync()
  }
  return { userId, role, craft, crafts, displayName, isLoggedIn, login, logout, sync }
})
