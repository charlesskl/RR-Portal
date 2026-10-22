<script setup lang="ts">
import AnalysisAiPanel from './AnalysisAiPanel.vue'
import { computed, onMounted, onScopeDispose, ref } from 'vue'
import { RouterLink } from 'vue-router'
import type { RecordModel } from 'pocketbase'
import { useDynamicAnalysis } from '../composables/useDynamicAnalysis'
import { pb } from '../pb'
import { regionOf } from '../constants/roles'
import { overdueMoreThan50, resolveRiskBatch } from '../utils/analysisBulkResolve'
import { chinaToday } from '../utils/dynamicAnalysis'
import type { AnalysisIssue } from '../utils/dynamicAnalysis'
const props = defineProps<{ compact?: boolean; factoryId?: string }>()
const { factories, result, loading, errors, readFailed, updated, refresh } = useDynamicAnalysis()
const kind = ref(''), level = ref(''), factoryFilter = ref(''), statusFilter = ref('')
const states = ref<RecordModel[]>([]), statusError = ref(''), saving = ref(''), stateReady = ref(false)
const bulkBusy = ref(false), bulkMessage = ref(''), bulkDone = ref(0)
let generation = 0
async function loadStates() {
  const current = ++generation
  stateReady.value = false; states.value = []; statusError.value = ''
  try {
    const list = await pb.collection('analysis_followups').getFullList({ fields: 'id,issue_key,status', requestKey: null })
    if (current === generation) { states.value = list; stateReady.value = true }
  } catch { if (current === generation) statusError.value = '跟进状态读取失败，请确认后台已部署最新迁移后重试；风险分析仍可查看。' }
}
const stop = pb.authStore.onChange(() => { generation++; states.value = []; stateReady.value = false; bulkMessage.value = ''; bulkDone.value = 0; if (pb.authStore.record) void loadStates() })
onMounted(() => { if (!props.compact) void loadStates() })
onScopeDispose(() => { generation++; stop() })
const stateMap = computed(() => new Map(states.value.map(s => [s.issue_key, s])))
const status = (key: string) => stateMap.value.get(key)?.status || 'pending'
async function save(issue: AnalysisIssue, next: string) {
  const owner = pb.authStore.record?.id, current = generation
  if (!owner || saving.value || bulkBusy.value || !stateReady.value) return
  saving.value = issue.key; statusError.value = ''
  try {
    const existing = states.value.find(s => s.issue_key === issue.key)
    const record = existing ? await pb.collection('analysis_followups').update(existing.id, { status: next }) : await pb.collection('analysis_followups').create({ owner, issue_key: issue.key, status: next })
    if (current === generation) states.value = [...states.value.filter(s => s.issue_key !== issue.key), record]
  } catch { if (current === generation) statusError.value = '状态保存失败，原状态未更改。请刷新跟进状态后重试。' }
  finally { saving.value = '' }
}
function changeStatus(issue: AnalysisIssue, event: Event) {
  const input = event.target as HTMLSelectElement
  const next = input.value
  input.value = status(issue.key)
  void save(issue, next)
}
const scoped = computed(() => result.value.issues.filter(i => !props.factoryId || i.factory === props.factoryId))
const visible = computed(() => scoped.value.filter(i => (!kind.value || i.kind === kind.value) && (!level.value || i.level === level.value) && (!factoryFilter.value || i.factory === factoryFilter.value) && (!statusFilter.value || status(i.key) === statusFilter.value)))
const oldRisks = computed(() => scoped.value.filter(i => overdueMoreThan50(i, chinaToday()) && status(i.key) !== 'resolved'))
async function resolveOldRisks() {
  if (bulkBusy.value || saving.value || loading.value || readFailed.value || !stateReady.value) return
  const items = [...oldRisks.value], owner = pb.authStore.record?.id, current = generation
  if (!owner || !items.length) return
  if (!window.confirm(`将当前${props.factoryId ? '工厂' : '全部授权工厂'}范围内逾期超过50天的 ${items.length} 项风险标为“已解决”？仅修改本账号的跟进状态，不受下方筛选条件影响，不修改订单交付或整改记录。`)) return
  bulkBusy.value = true; bulkDone.value = 0; bulkMessage.value = ''; statusError.value = ''
  const snapshot = new Map(stateMap.value)
  const active = () => current === generation && pb.authStore.record?.id === owner
  try {
    const outcome = await resolveRiskBatch(items, active, async issue => {
      const existing = snapshot.get(issue.key)
      const row = existing ? await pb.collection('analysis_followups').update(existing.id, { status: 'resolved' }) : await pb.collection('analysis_followups').create({ owner, issue_key: issue.key, status: 'resolved' })
      if (active()) snapshot.set(issue.key, row)
    }, done => { if (active()) bulkDone.value = done })
    if (active()) {
      states.value = [...snapshot.values()]
      bulkMessage.value = `已成功标记 ${outcome.done} 项。` + (outcome.failed ? '部分请求失败，已停止；请刷新跟进状态后重试，已保存的项目会跳过。' : '原始业务记录保持不变。')
      if (outcome.failed) { stateReady.value = false; statusError.value = '部分跟进状态保存失败，已停止。请刷新跟进状态后重试。' }
    }
  } finally { bulkBusy.value = false }
}
const name = (id: string) => factories.value.find(f => f.id === id)?.name || '未知工厂'
function source(issue: AnalysisIssue) {
  const f = factories.value.find(f => f.id === issue.factory)
  return issue.kind === 'delivery' ? `/orders/dept/${f?.craft}/${issue.source}` : { path: '/quality-patrol', query: { region: regionOf(f), factory: issue.factory, date: issue.sourceDate } }
}
const target = computed(() => ({ path: '/analysis', query: props.factoryId ? { factory: props.factoryId } : {} }))
</script>
<template>
  <section class="analysis-panel">
    <header><div><h2>动态分析中心</h2><p>基于已录入数据的规则预警 · 页面可见时每60秒刷新</p></div><button :disabled="loading" @click="refresh">{{ loading ? '分析中…' : '立即刷新' }}</button></header>
    <p v-for="error in errors" :key="error" role="alert" class="error">{{ error }}</p>
    <p v-if="updated" class="muted">最近分析：{{ updated }}；仅分析当前账号可查看的数据。</p>
    <div class="metrics"><strong>当前风险 {{ scoped.length }} 项</strong><span>重点关注 {{ scoped.filter(i => i.level === 'high').length }} 项</span><span>涉及 {{ new Set(scoped.map(i => i.factory)).size }} 家工厂</span></div>
    <template v-if="compact"><p>巡查整改、最近评级下降、未交付订单逾期。{{ errors.length ? '部分数据不可用，结果可能不完整。' : '' }}</p><RouterLink :to="target">查看问题依据与跟进 →</RouterLink></template>
    <template v-else>
      <AnalysisAiPanel :factories="factories" :factory-id="factoryId" />
      <details><summary>分析规则与数据缺口</summary><p>整改有描述且计划日期早于今天、未登记有效完成日期时提示；最近两次巡查评级由A向D下降时提示；订单交期早于今天且未登记交付时提示（排除已交付、已取消、已退回订单）。逾期至少7天或评级降至D列为重点关注。日期按北京时间计算，评级变化不会推断为质量不合格。</p><p>授权范围内：{{ result.missingPatrolDates }} 条未完成整改缺少有效计划日期，{{ result.missingOrderDates }} 条未交付订单缺少有效交期，无法判断是否逾期。源数据错误请进入原始记录修正。</p></details>
      <p>跟进状态仅当前账号可见。“已解决”代表个人跟进标记；源数据仍触发规则时，预警继续保留。下方为规则预警；上方AI分析需配置服务后主动生成。</p>
      <p v-if="statusError" class="error" role="alert">{{ statusError }} <button :disabled="bulkBusy" @click="loadStates">刷新跟进状态</button></p>
      <div class="bulk-actions"><p>当前{{ factoryId ? '工厂' : '全部授权工厂' }}范围内，逾期超过50天且尚未标为已解决：{{ oldRisks.length }} 项（不受下方筛选影响）。</p><button :disabled="bulkBusy || !!saving || loading || readFailed || !stateReady || !oldRisks.length" @click="resolveOldRisks">{{ bulkBusy ? `正在标记，已完成 ${bulkDone} 项…` : '逾期超过50天批量标为已解决' }}</button><p v-if="bulkMessage" role="status">{{ bulkMessage }}</p></div>
      <div class="filters">
        <label v-if="!factoryId">工厂<select v-model="factoryFilter"><option value="">全部有预警工厂</option><option v-for="id in [...new Set(scoped.map(i => i.factory))]" :key="id" :value="id">{{ name(id) }}</option></select></label>
        <label>问题类型<select v-model="kind"><option value="">全部</option><option value="correction">整改逾期</option><option value="grade">评级下降</option><option value="delivery">交期延期</option></select></label>
        <label>级别<select v-model="level"><option value="">全部</option><option value="high">重点关注</option><option value="medium">关注</option></select></label>
        <label>我的跟进<select v-model="statusFilter" :disabled="!stateReady"><option value="">全部</option><option value="pending">待处理</option><option value="following">跟进中</option><option value="resolved">已解决</option></select></label>
      </div>
      <p v-if="!loading && !visible.length">{{ errors.length ? '当前可用数据中暂无匹配预警，请处理上方数据读取提示。' : '当前条件下暂无规则预警，不代表未录入的问题不存在。' }}</p>
      <article v-for="issue in visible" :key="issue.key" :class="{ high: issue.level === 'high' }">
        <header><h3>{{ name(issue.factory) }} · {{ issue.title }}</h3><strong>{{ issue.level === 'high' ? '重点关注' : '关注' }}</strong></header>
        <p>{{ issue.evidence }}</p><p class="muted">建议：{{ issue.suggestion }}</p>
        <footer><RouterLink :to="source(issue)">查看原始记录 →</RouterLink><label>我的跟进<select :value="status(issue.key)" :disabled="bulkBusy || !!saving || !stateReady" @change="changeStatus(issue, $event)"><option value="pending">待处理</option><option value="following">跟进中</option><option value="resolved">已解决</option></select></label></footer>
      </article>
    </template>
  </section>
</template>
<style scoped>
.analysis-panel { background: white; border: 1px solid #e0e3ec; border-radius: 12px; padding: 24px; margin-bottom: 24px; } header, footer, .metrics, .filters { display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; } h2,h3 { margin: 0; } p { line-height: 1.65; } .muted { color: #647084; } .error { color: #b42318; } .metrics { justify-content: flex-start; background: #f2f1ff; padding: 18px; border-radius: 8px; margin: 16px 0; } .filters { justify-content: flex-start; margin: 20px 0; } label { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; } select, button { font: inherit; color: #202635; background: white; border: 1px solid #bdc4d3; padding: 8px 12px; border-radius: 6px; max-width: 100%; } article { border: 1px solid #e1e5ed; border-left: 4px solid #d99d26; border-radius: 8px; padding: 20px; margin-top: 16px; } article.high { border-left-color: #d14444; } details { background: #f7f8fb; padding: 12px; border-radius: 6px; } summary { cursor: pointer; } button:disabled { opacity: .5; } @media(max-width:600px) { .analysis-panel { padding: 14px; } article { padding: 12px; } }
</style>
