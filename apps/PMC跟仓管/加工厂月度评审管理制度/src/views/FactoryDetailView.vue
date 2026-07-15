<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppLayout from '../components/AppLayout.vue'
import FactoryForm from '../components/FactoryForm.vue'
import { pb } from '../pb'
import { useFactoriesStore } from '../stores/factories'
import { useIncidentsStore } from '../stores/incidents'
import { useAuthStore } from '../stores/auth'
import { computeFactoryStats, computeSiteStats, type FactoryStats, type SiteStats } from '../utils/factoryStats'
import { canEditFactories } from '../utils/permissions'
import type { Factory, FactoryStatus } from '../types/factory'
import type { Order } from '../types/order'

const route = useRoute()
const router = useRouter()
const store = useFactoriesStore()
const incidents = useIncidentsStore()
const auth = useAuthStore()

const isNew = route.path.endsWith('/new')
const factory = ref<Partial<Factory>>(
  isNew
    ? { craft: (route.query.craft as Factory['craft']) || undefined, region: (route.query.region as Factory['region']) || 'dongguan' }
    : {},
)
const ready = ref(isNew) // 新建立即可渲染；编辑需等数据加载完再渲染表单
const newStatus = ref<FactoryStatus>('active')

const photoInput = ref<HTMLInputElement | null>(null)
const inc = ref<{ incident_date: string; incident_type: string; description: string }>({
  incident_date: '', incident_type: 'batch_defect', description: '',
})
const incidentTypeLabel: Record<string, string> = {
  batch_defect: '批量不良', env_violation: '环保违规', shutdown: '停工', other: '其他',
}

const statusLabel: Record<string, string> = {
  active: '正常', limited: '限单', suspended: '暂停', eliminated: '淘汰',
}

const stats = ref<FactoryStats | null>(null)
const site = ref<SiteStats | null>(null)
const grade = ref<string>('')

onMounted(async () => {
  if (!isNew) {
    const id = route.params.id as string
    factory.value = await store.get(id)
    ready.value = true // 数据到位后再渲染表单，确保回填已有内容
    await incidents.fetchByFactory(id)
    // 该工厂的价格/交期/品质指标(与汇总表一致)
    const [os, qis, scores, checks] = await Promise.all([
      pb.collection('orders').getFullList<Order>({ filter: `factory = "${id}"` }),
      pb.collection('quality_inspections').getFullList({ filter: `factory = "${id}"` }),
      pb.collection('monthly_scores').getFullList({ filter: `factory = "${id}"`, sort: '-year_month' }),
      pb.collection('quality_5s_checks').getFullList({ filter: `factory = "${id}"`, sort: '-check_date' }),
    ])
    stats.value = computeFactoryStats(os, qis as any[])
    site.value = computeSiteStats(checks as any[])
    grade.value = (scores as any[]).find((s) => s.grade)?.grade ?? ''
  }
})

async function submitIncident() {
  const fd = new FormData()
  fd.append('factory', route.params.id as string)
  fd.append('incident_date', inc.value.incident_date)
  fd.append('incident_type', inc.value.incident_type)
  fd.append('description', inc.value.description)
  fd.append('status', 'open')
  fd.append('entered_by', auth.userId ?? '')
  const files = photoInput.value?.files
  if (files) for (const f of Array.from(files)) fd.append('photos', f)
  await incidents.create(fd)
  await incidents.fetchByFactory(route.params.id as string)
}

async function onSave(fd: FormData) {
  if (isNew) {
    fd.append('status', 'active')
    if (auth.userId) fd.append('created_by', auth.userId)
    const created = await store.create(fd)
    router.push(`/factories/${created.id}`)
  } else {
    await store.update(route.params.id as string, fd)
    factory.value = await store.get(route.params.id as string)
  }
}

async function proposeStatus() {
  await store.update(route.params.id as string, { status: newStatus.value })
  factory.value = await store.get(route.params.id as string)
}
async function approveStatus() {
  await store.update(route.params.id as string, {
    status: newStatus.value, status_pending: '',
    status_updated_by: auth.userId ?? undefined,
    status_updated_at: new Date().toISOString(),
  })
  factory.value = await store.get(route.params.id as string)
}
</script>
<template>
  <AppLayout>
    <div class="page detail">
    <h2>{{ isNew ? '新增工厂' : factory.name }}</h2>
    <section class="card info-row">
      <div class="form-col">
        <FactoryForm v-if="ready" :model-value="factory" :readonly="!(auth.role && canEditFactories(auth.role))" @save="onSave" />
        <p v-else class="muted">加载中…</p>
      </div>
    </section>

    <section v-if="!isNew" class="card status-box">
      <h3>合作状态</h3>
      <p>
        当前：<span class="badge" :class="'status-' + factory.status">{{ factory.status ? statusLabel[factory.status] : '-' }}</span>
        <span class="muted" style="margin-left:1rem">待审批：{{ factory.status_pending ? statusLabel[factory.status_pending] : '无' }}</span>
      </p>
      <div v-if="auth.role === 'sc_manager' || auth.role === 'admin'">
        <label>审批为
          <select v-model="newStatus">
            <option value="active">正常</option>
            <option value="limited">限单</option>
            <option value="suspended">暂停</option>
            <option value="eliminated">淘汰</option>
          </select>
        </label>
        <button @click="approveStatus">确认审批</button>
      </div>
      <div v-else>
        <label>提报变更
          <select v-model="newStatus">
            <option value="active">正常</option>
            <option value="limited">限单</option>
            <option value="suspended">暂停</option>
            <option value="eliminated">淘汰</option>
          </select>
        </label>
        <button @click="proposeStatus">提报</button>
      </div>
    </section>

    <section v-if="!isNew" class="card incidents">
      <h3>异常 / 事故记录</h3>
      <form class="inc-form" @submit.prevent="submitIncident">
        <input v-model="inc.incident_date" type="date" required />
        <select v-model="inc.incident_type" required>
          <option value="batch_defect">批量不良</option>
          <option value="env_violation">环保违规</option>
          <option value="shutdown">停工</option>
          <option value="other">其他</option>
        </select>
        <input v-model="inc.description" placeholder="描述" />
        <input ref="photoInput" type="file" multiple accept="image/*" />
        <button type="submit">登记异常</button>
      </form>
      <ul>
        <li v-for="i in incidents.items" :key="i.id">
          {{ i.incident_date }} - {{ incidentTypeLabel[i.incident_type] }} - {{ i.status === 'open' ? '未关闭' : '已关闭' }}
        </li>
      </ul>
    </section>
    </div>
  </AppLayout>
</template>
<style scoped>
.detail { display: flex; flex-direction: column; gap: 1.25rem; }
.info-row { display: flex; gap: 2rem; align-items: flex-start; }
.form-col { flex: 0 0 auto; }
.metrics-col { flex: 1; display: flex; flex-direction: column; gap: 1rem; min-width: 360px; }
.m-row { display: flex; gap: 1rem; }
.m-box { flex: 1; border: 1px solid var(--border); border-radius: var(--radius-sm); padding: .8rem 1rem; }
.m-title { font-size: .9rem; font-weight: 600; color: var(--primary, #4f46e5); margin-bottom: .6rem; }
.m-line { display: flex; justify-content: space-between; align-items: baseline; font-size: .88rem; margin: .35rem 0; }
.m-line span { color: var(--text-soft); }
.m-line b { font-weight: 600; }
.m-line b.hl { color: var(--primary, #4f46e5); font-size: 1.05rem; }
@media (max-width: 960px) { .info-row { flex-direction: column; } }
.inc-form { display: flex; gap: .5rem; flex-wrap: wrap; align-items: center; margin-bottom: .75rem; }
.incidents ul { margin: 0; padding-left: 1.1rem; }
.incidents li { margin: .3rem 0; }
</style>
