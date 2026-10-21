<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import { pb } from '../pb'
import { useAuthStore } from '../stores/auth'
import { canViewOrders, canEditOrders } from '../utils/permissions'
import { deliveryReminderKey, deliveryReminderPage, type DeliveryReminderFeed, type DeliveryReminderItem } from '../utils/deliveryReminder'
import DeliveryReminderDialog from './DeliveryReminderDialog.vue'
const auth = useAuthStore(), route = useRoute()
const revision = ref(0)
const enabled = computed(() => { void revision.value; return !!auth.userId && !!auth.role && canViewOrders(auth.role) && canEditOrders(auth.role) && deliveryReminderPage(route.path) })
const feed = ref<DeliveryReminderFeed | null>(null)
const open = ref(false), error = ref('')
const storageKey = 'factory-review-delivery-reminders-v1'
let muted: Record<string, number> = {}
try { muted = JSON.parse(localStorage.getItem(storageKey) || '{}'); if (!muted || typeof muted !== 'object' || Array.isArray(muted)) muted = {} } catch { muted = {} }
let controller: AbortController | undefined, timer: ReturnType<typeof setInterval> | undefined, generation = 0
const unsubscribe = pb.authStore.onChange(() => { revision.value++ })
function defer(items: DeliveryReminderItem[]) {
  const now = Date.now()
  muted = Object.fromEntries(Object.entries(muted).filter(([, until]) => typeof until === 'number' && until > now))
  for (const item of items) muted[deliveryReminderKey(auth.userId!, item)] = now + 3600000
  try { localStorage.setItem(storageKey, JSON.stringify(muted)) } catch { /* Session fallback remains available. */ }
}
function later() { defer(feed.value?.items || []); open.value = false }
function register(item: DeliveryReminderItem) { defer([item]); open.value = false }
async function refresh() {
  if (!enabled.value || document.hidden || controller) return
  const id = generation, user = auth.userId
  const request = new AbortController(); controller = request
  const timeout = setTimeout(() => request.abort(), 10000)
  try {
    const result = await pb.send<DeliveryReminderFeed>('/api/factory-review/delivery-reminders', { method: 'GET', signal: request.signal, requestKey: null })
    if (id !== generation || user !== auth.userId || !enabled.value) return
    feed.value = result; error.value = ''
    if (!result.items.length) open.value = false
    const hasNew = result.items.some(item => !(muted[deliveryReminderKey(user!, item)] > Date.now()))
    const editing = document.activeElement?.matches('input,textarea,select,[contenteditable=true]') || document.querySelector('[aria-modal=true]')
    if (hasNew && !editing) open.value = true
  } catch { if (id === generation) { feed.value = null; open.value = false; error.value = '交付提醒读取失败，请重试。' } }
  finally { clearTimeout(timeout); if (controller === request) controller = undefined }
}
function reset() { generation++; controller?.abort(); controller = undefined; feed.value = null; open.value = false; error.value = ''; void refresh() }
watch([enabled, () => auth.userId, () => route.path, revision], reset, { immediate: true, flush: 'post' })
function visible() { if (!document.hidden) void refresh() }
onMounted(() => { timer = setInterval(() => { void refresh() }, 60000); window.addEventListener('focus', visible); document.addEventListener('visibilitychange', visible) })
onBeforeUnmount(() => { generation++; controller?.abort(); clearInterval(timer); unsubscribe(); window.removeEventListener('focus', visible); document.removeEventListener('visibilitychange', visible) })
</script>
<template>
  <div v-if="enabled && (feed?.items.length || feed?.nameAmbiguous || error)" class="delivery-notice">
    <template v-if="feed?.items.length">{{ feed.hasMore ? '至少' : '' }}{{ feed.items.length }} 条本人订单已到交期，待登记交付。<button @click="open = true">查看提醒</button></template>
    <span v-if="feed?.nameAmbiguous">账号姓名无法唯一匹配下单PMC，请管理员核对姓名；当前仅提醒PMC留空且由本人创建的订单。</span>
    <span v-if="error" role="status">{{ error }} <button @click="refresh">重试</button></span>
  </div>
  <DeliveryReminderDialog v-if="enabled && open && feed?.items.length" :items="feed.items" :today="feed.today" :has-more="feed.hasMore" @later="later" @register="register" />
</template>
<style scoped>
.delivery-notice { padding: 12px 16px; margin-bottom: 16px; border: 1px solid #f4ce84; border-radius: 8px; background: #fff7e6; color: #694b16; display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
button { background: #fff; color: #694b16; border: 1px solid #d9bd87; border-radius: 6px; padding: 6px 12px; }
</style>
