<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import AppLayout from '../components/AppLayout.vue'
import { pb } from '../pb'
import { useFactoriesStore } from '../stores/factories'
import { computeFactoryStats, computeSiteStats, type FactoryStats, type SiteStats } from '../utils/factoryStats'
import { CRAFT_LABELS, type Craft } from '../constants/roles'
import type { Factory } from '../types/factory'
import type { Order } from '../types/order'

const route = useRoute()
const store = useFactoriesStore()
const factory = ref<Partial<Factory>>({})
const ready = ref(false)
const stats = ref<FactoryStats | null>(null)
const site = ref<SiteStats | null>(null)
const grade = ref<string>('')

onMounted(async () => {
  const id = route.params.id as string
  factory.value = await store.get(id)
  ready.value = true
  const [os, qis, scores, checks] = await Promise.all([
    pb.collection('orders').getFullList<Order>({ filter: `factory = "${id}"` }),
    pb.collection('quality_inspections').getFullList({ filter: `factory = "${id}"` }),
    pb.collection('monthly_scores').getFullList({ filter: `factory = "${id}"`, sort: '-year_month' }),
    pb.collection('quality_5s_checks').getFullList({ filter: `factory = "${id}"`, sort: '-check_date' }),
  ])
  stats.value = computeFactoryStats(os, qis as any[])
  site.value = computeSiteStats(checks as any[])
  grade.value = (scores as any[]).find((s) => s.grade)?.grade ?? ''
})
</script>
<template>
  <AppLayout>
    <div class="page detail">
      <div class="toolbar">
        <RouterLink to="/factory-view" class="back">← 加工厂管理</RouterLink>
        <h2 style="margin:0">{{ factory.name }}</h2>
        <span class="muted">只读</span>
      </div>
      <section class="card">
        <div v-if="ready" class="m-box info-box">
          <div class="m-title">加工厂管理</div>
          <div class="info-grid">
            <div class="m-line"><span>名称</span><b>{{ factory.name || '-' }}</b></div>
            <div class="m-line"><span>部门</span><b>{{ factory.craft ? CRAFT_LABELS[factory.craft as Craft] : '-' }}</b></div>
            <div class="m-line"><span>联系人</span><b>{{ factory.contact_person || '-' }}</b></div>
            <div class="m-line"><span>电话</span><b>{{ factory.contact_phone || '-' }}</b></div>
            <div class="m-line"><span>地址</span><b>{{ factory.address || '-' }}</b></div>
            <div class="m-line"><span>月产能</span><b>{{ factory.monthly_capacity ?? '-' }}</b></div>
            <div class="m-line"><span>同我们工厂合作年限</span><b>{{ factory.cooperation_period || '-' }}</b></div>
            <div class="m-line"><span>厂房面积(㎡)</span><b>{{ factory.workshop_area ?? '-' }}</b></div>
            <div class="m-line"><span>帮我们生产的机台/生产线</span><b>{{ factory.production_lines || '-' }}</b></div>
            <div class="m-line"><span>加工类型</span><b>{{ factory.processable_types || '-' }}</b></div>
            <div class="m-line"><span>设备台数/生产拉线</span><b>{{ factory.equipment_qty ?? '-' }}</b></div>
            <div class="m-line"><span>合作车间</span><b>{{ factory.cooperative_workshops || '-' }}</b></div>
            <div class="m-line"><span>IP管控</span><b>{{ factory.ip_control || '-' }}</b></div>
            <div class="m-line"><span>员工人数</span><b>{{ factory.staff_count ?? '-' }}</b></div>
          </div>
        </div>
        <div v-if="stats" class="metrics-col">
          <div class="m-row">
            <div class="m-box"><div class="m-line grade-line"><span>工厂评级</span><b><span v-if="grade" class="badge" :class="'badge-' + grade">{{ grade }}</span><span v-else>-</span></b></div></div>
          </div>
          <div class="m-cols">
            <div class="m-box b-price">
              <div class="m-title"><span class="ic">💰</span>价格</div>
              <div class="m-line"><span>核价总金额</span><b>{{ stats.quoteAmount }}</b></div>
              <div class="m-line"><span>外发总金额</span><b>{{ stats.outAmount }}</b></div>
              <div class="m-line rate-red"><span>占比</span><b>{{ stats.amountRatio }}</b></div>
            </div>
            <div class="m-box b-delivery">
              <div class="m-title"><span class="ic">📅</span>交期</div>
              <div class="m-line"><span>订单总单数</span><b>{{ stats.orderCount }}</b></div>
              <div class="m-line"><span>延期单数</span><b>{{ stats.delayedCount }}</b></div>
              <div class="m-line rate-red"><span>占比</span><b>{{ stats.delayRatio }}</b></div>
              <div class="m-line"><span>延期平均天数</span><b>{{ stats.delayDaysAvg }}</b></div>
            </div>
            <div class="m-box b-qc">
              <div class="m-title"><span class="ic">🔍</span>品质</div>
              <div class="m-line"><span>验货总单数</span><b>{{ stats.intInspect }}</b></div>
              <div class="m-line"><span>合格单数</span><b>{{ stats.intPass }}</b></div>
              <div class="m-line rate-red"><span>合格率</span><b>{{ stats.intRate }}</b></div>
            </div>
            <div class="m-box b-site">
              <div class="m-title"><span class="ic">🧹</span>现场管理</div>
              <div class="m-line"><span>现场得分</span><b>{{ site ? site.siteScore : '-' }}</b></div>
              <div class="m-line"><span>折算总达成率</span><b class="hl">{{ site ? site.finalRate : '-' }}</b></div>
            </div>
          </div>
        </div>
      </section>
    </div>
  </AppLayout>
</template>
<style scoped>
.detail { display: flex; flex-direction: column; gap: .5rem; }
.detail :deep(.card) { padding: .8rem 1rem; }
.back { font-size: 1rem; }
.info-box { margin-bottom: .5rem; }
.info-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0 2.5rem; }
.info-grid .m-line { gap: 1rem; }
.info-grid .m-line b { text-align: right; word-break: break-all; }
@media (max-width: 820px) { .info-grid { grid-template-columns: 1fr; } }
.metrics-col { display: flex; flex-direction: column; gap: .5rem; }
.m-row { display: flex; gap: .5rem; }
.m-cols { display: grid; grid-template-columns: repeat(4, 1fr); gap: .5rem; align-items: stretch; }
.m-box { flex: 1; border: 1px solid var(--border); border-radius: var(--radius-sm); padding: .6rem .9rem; }
@media (max-width: 1000px) { .m-cols { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 560px) { .m-cols { grid-template-columns: 1fr; } }
.m-title { font-size: 1.1rem; font-weight: 600; color: var(--primary, #4f46e5); margin-bottom: .4rem; }

/* 框头强调：顶部色条 + 标题彩色图标块 + 标题下分隔线 */
.m-cols .m-box { border-top: 3px solid var(--acc, #4f46e5); border-bottom: 3px solid var(--acc, #4f46e5); border-radius: 10px; overflow: hidden; background:
  linear-gradient(180deg, color-mix(in srgb, var(--acc, #4f46e5) 7%, #fff), #fff 38%); }
.m-cols .m-title { display: flex; align-items: center; gap: .45rem; color: var(--acc, #4f46e5);
  margin: -.6rem -.9rem .5rem; padding: .55rem .9rem; border-bottom: 1px solid color-mix(in srgb, var(--acc, #4f46e5) 18%, #fff); }
.m-cols .m-title .ic { width: 30px; height: 30px; display: grid; place-items: center; font-size: 1rem; border-radius: 9px;
  background: color-mix(in srgb, var(--acc, #4f46e5) 14%, #fff); }
.b-price { --acc: #4f46e5; }
.b-delivery { --acc: #d97706; }
.b-qc { --acc: #0d9488; }
.b-site { --acc: #16a34a; }
.m-line { display: flex; justify-content: space-between; align-items: baseline; font-size: 1.05rem; margin: .28rem 0; }
.m-line span { color: #1f2533; }
.m-line.rate-red span, .m-line.rate-red b { color: #dc2626; }
.m-line.grade-line { justify-content: flex-start; gap: 1rem; }
.m-line b { font-weight: 600; }
.m-line b.hl { color: var(--primary, #4f46e5); font-size: 1.2rem; }
</style>
