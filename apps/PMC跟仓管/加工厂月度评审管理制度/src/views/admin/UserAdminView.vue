<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import AppLayout from '../../components/AppLayout.vue'
import CraftMultiSelect from '../../components/CraftMultiSelect.vue'
import UserPermsEditor from '../../components/UserPermsEditor.vue'
import { pb } from '../../pb'
import { ROLE_LABELS, type Craft, type Role } from '../../constants/roles'
import { roleDefault } from '../../utils/permissions'

const users = ref<any[]>([])
const emailEdits = ref<Record<string, string>>({})
const nameEdits = ref<Record<string, string>>({})
const roleEdits = ref<Record<string, Role>>({})
const craftEdits = ref<Record<string, Craft[]>>({})
const permEdits = ref<Record<string, Record<string, boolean>>>({})
const permOpen = ref<Record<string, boolean>>({})
const draft = ref<{ email: string; password: string; display_name: string; role: Role; crafts: Craft[] }>({
  email: '', password: '', display_name: '', role: 'buyer_injection', crafts: [],
})
const draftPerm = ref<Record<string, boolean>>(roleDefault('buyer_injection'))

// 选角色 → 自动填入该角色默认权限（可再逐项微调）
watch(() => draft.value.role, (r) => { draftPerm.value = roleDefault(r) })

// 存储为「相对角色默认值的差异」，为空表示完全按角色默认
function deltaOf(role: Role, perm: Record<string, boolean>): Record<string, boolean> {
  const def = roleDefault(role)
  const d: Record<string, boolean> = {}
  for (const k of Object.keys(def)) if (!!perm[k] !== !!def[k]) d[k] = !!perm[k]
  return d
}

async function load() {
  users.value = await pb.collection('users').getFullList({ sort: 'role' })
  emailEdits.value = {}; nameEdits.value = {}; roleEdits.value = {}; craftEdits.value = {}; permEdits.value = {}
  for (const u of users.value) {
    emailEdits.value[u.id] = u.email ?? ''
    nameEdits.value[u.id] = u.display_name ?? ''
    roleEdits.value[u.id] = u.role as Role
    craftEdits.value[u.id] = Array.isArray(u.crafts) && u.crafts.length ? [...u.crafts] : (u.craft ? [u.craft] : [])
    permEdits.value[u.id] = { ...roleDefault(u.role as Role), ...(u.permissions ?? {}) }
  }
}
onMounted(load)

async function createUser() {
  if (draft.value.password.length < 8) { alert('密码至少 8 位'); return }
  try {
    // 走管理员专用接口(超管上下文创建，可设 verified 等受保护字段)
    await pb.send('/api/admin/create-user', {
      method: 'POST',
      body: {
        email: draft.value.email,
        password: draft.value.password,
        display_name: draft.value.display_name,
        role: draft.value.role,
        crafts: draft.value.crafts,
        craft: draft.value.crafts[0] || '',
        permissions: deltaOf(draft.value.role, draftPerm.value),
      },
    })
    draft.value = { email: '', password: '', display_name: '', role: 'buyer_injection', crafts: [] }
    draftPerm.value = roleDefault('buyer_injection')
    await load()
    alert('用户已创建')
  } catch (e: any) {
    alert('创建失败：' + (e?.message ?? e))
  }
}

// 保存一行：姓名/角色/部门/权限直接更新;邮箱变了走专用接口(superuser 绕过邮箱保护)
async function saveRow(u: any) {
  try {
    const name = (nameEdits.value[u.id] ?? '').trim()
    const role = roleEdits.value[u.id]
    const crafts = craftEdits.value[u.id] ?? []
    const craft = crafts[0] ?? ''
    const permObj = deltaOf(role, permEdits.value[u.id] ?? {})
    const permChanged = JSON.stringify(permObj) !== JSON.stringify(u.permissions ?? {})
    const originalCrafts = Array.isArray(u.crafts) && u.crafts.length ? u.crafts : (u.craft ? [u.craft] : [])
    const craftsChanged = JSON.stringify(crafts) !== JSON.stringify(originalCrafts)
    if (name !== (u.display_name ?? '') || role !== u.role || craftsChanged || permChanged) {
      await pb.collection('users').update(u.id, { display_name: name, role, craft, crafts, permissions: permObj })
    }
    const email = (emailEdits.value[u.id] ?? '').trim()
    if (email && email !== u.email) {
      await pb.send('/api/admin/set-user-email', { method: 'POST', body: { userId: u.id, email } })
    }
    await load()
    alert('已保存')
  } catch (e: any) {
    alert('保存失败：' + (e?.message ?? e))
  }
}

// 行内点「角色」改变时，权限重置为新角色默认值
function onRowRole(u: any) {
  permEdits.value[u.id] = roleDefault(roleEdits.value[u.id])
}

async function resetPassword(u: any) {
  const pwd = prompt(`为「${u.display_name || u.email}」设置新密码(≥8位):`)
  if (pwd == null) return
  if (pwd.length < 8) { alert('密码至少 8 位'); return }
  try {
    await pb.send('/api/admin/set-user-password', { method: 'POST', body: { userId: u.id, password: pwd } })
    alert('密码已重置')
  } catch (e: any) {
    alert('重置失败：' + (e?.message ?? e))
  }
}

function rowChanged(u: any): boolean {
  const originalCrafts = Array.isArray(u.crafts) && u.crafts.length ? u.crafts : (u.craft ? [u.craft] : [])
  return (nameEdits.value[u.id] ?? '') !== (u.display_name ?? '')
    || roleEdits.value[u.id] !== u.role
    || JSON.stringify(craftEdits.value[u.id] ?? []) !== JSON.stringify(originalCrafts)
    || (emailEdits.value[u.id] ?? '') !== (u.email ?? '')
    || JSON.stringify(deltaOf(roleEdits.value[u.id], permEdits.value[u.id] ?? {})) !== JSON.stringify(u.permissions ?? {})
}
</script>
<template>
  <AppLayout>
    <div class="page">
    <h2>用户管理</h2>
    <table>
      <thead><tr><th>姓名</th><th>邮箱</th><th>角色</th><th>部门权限</th><th>操作</th></tr></thead>
      <tbody>
        <template v-for="u in users" :key="u.id">
          <tr>
            <td><input class="name-input" v-model="nameEdits[u.id]" /></td>
            <td><input class="email-input" v-model="emailEdits[u.id]" type="email" /></td>
            <td>
              <select v-model="roleEdits[u.id]" @change="onRowRole(u)">
                <option v-for="(label, key) in ROLE_LABELS" :key="key" :value="key">{{ label }}</option>
              </select>
            </td>
            <td>
              <CraftMultiSelect v-model="craftEdits[u.id]" />
            </td>
            <td class="ops">
              <button class="ghost mini" @click="permOpen[u.id] = !permOpen[u.id]">权限</button>
              <button class="ghost mini" :disabled="!rowChanged(u)" @click="saveRow(u)">保存</button>
              <button class="ghost mini" @click="resetPassword(u)">重置密码</button>
            </td>
          </tr>
          <tr v-if="permOpen[u.id]" class="perm-row-tr">
            <td colspan="5">
              <div class="perm-wrap">
                <span class="perm-hint">使用权限（角色默认，可逐项勾选微调）</span>
                <UserPermsEditor v-model="permEdits[u.id]" />
              </div>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
    <h3>新建用户</h3>
    <form class="user-form" @submit.prevent="createUser">
      <input v-model="draft.display_name" placeholder="姓名" required />
      <input v-model="draft.email" type="email" placeholder="邮箱" required />
      <input v-model="draft.password" type="password" placeholder="密码(≥8位)" required />
      <select v-model="draft.role">
        <option v-for="(label, key) in ROLE_LABELS" :key="key" :value="key">{{ label }}</option>
      </select>
      <CraftMultiSelect v-model="draft.crafts" />
      <button type="submit">创建</button>
    </form>
    <div class="create-perm">
      <span class="perm-hint">使用权限（选角色后自动填默认值，可逐项勾选微调）</span>
      <UserPermsEditor v-model="draftPerm" />
    </div>
    </div>
  </AppLayout>
</template>
<style scoped>
h3 { margin-top: 1.5rem; }
.user-form { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.5rem; align-items: center; }
.email-input { width: 230px; padding: .3rem .5rem; font-size: .85rem; }
.name-input { width: 120px; padding: .3rem .5rem; font-size: .85rem; }
.mini { padding: .25rem .6rem; font-size: .8rem; }
.ops { display: flex; gap: .4rem; }
.perm-row-tr td { background: #fafbff; }
.perm-wrap, .create-perm { display: flex; flex-direction: column; gap: .5rem; padding: .6rem 0; }
.perm-hint { font-size: .82rem; color: #6b7280; }
.create-perm { margin-top: 1rem; }
</style>
