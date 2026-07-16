<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { RouterLink } from 'vue-router'
import AppLayout from '../components/AppLayout.vue'
import FactoryCompare from '../components/FactoryCompare.vue'
import { useAuthStore } from '../stores/auth'
import { useScoresStore } from '../stores/scores'
import { useFactoriesStore } from '../stores/factories'
import { ROLE_LABELS } from '../constants/roles'
import { canEditOutput, canEditTemplates } from '../utils/permissions'

const auth = useAuthStore()
const scores = useScoresStore()
const factories = useFactoriesStore()
const month = ref(new Date().toISOString().slice(0, 7))

onMounted(async () => {
  await Promise.all([scores.fetchByMonth(month.value), factories.fetchAll()])
})

const submitted = computed(() => scores.items.filter((s) => s.status !== 'draft').length)
const flagged = computed(() => scores.items.filter((s) => s.flag && s.flag !== 'none'))
const redCount = computed(() => flagged.value.filter((s) => s.flag === 'red').length)
const yellowCount = computed(() => flagged.value.filter((s) => s.flag === 'yellow').length)
const scored = computed(() => scores.items.filter((s) => typeof s.total_score === 'number'))
const avgScore = computed(() =>
  scored.value.length
    ? Math.round((scored.value.reduce((a, s) => a + (s.total_score ?? 0), 0) / scored.value.length) * 10) / 10
    : 0,
)
const gradeDist = computed<Record<string, number>>(() => {
  const d: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 }
  for (const s of scores.items) if (s.grade) d[s.grade]++
  return d
})
const gradeTotal = computed(() => Object.values(gradeDist.value).reduce((a, b) => a + b, 0) || 1)
const gradeMeta: Record<string, { label: string; color: string }> = {
  A: { label: 'A 优秀', color: '#16a34a' },
  B: { label: 'B 良好', color: '#2563eb' },
  C: { label: 'C 限单', color: '#d97706' },
  D: { label: 'D 预警', color: '#dc2626' },
}
const roleLabel = computed(() => (auth.role ? ROLE_LABELS[auth.role] : ''))
</script>

<template>
  <AppLayout>
    <div class="dash">
      <!-- 欢迎横幅 -->
      <section class="hero">
        <div class="hero-text">
          <h1>欢迎回来，{{ auth.displayName }}</h1>
          <p>{{ roleLabel }} · 本月外协加工厂月度评审</p>
        </div>
        <div class="hero-month">
          <span class="m-label">当前周期</span>
          <span class="m-value">{{ month }}</span>
        </div>
      </section>

      <!-- 统计卡片 -->
      <section class="stats">
        <div class="stat">
          <span class="stat-ico ico-blue">🏭</span>
          <div><span class="stat-num">{{ factories.items.length }}</span><span class="stat-lbl">在册工厂</span></div>
        </div>
        <div class="stat">
          <span class="stat-ico ico-green">📝</span>
          <div><span class="stat-num">{{ submitted }}</span><span class="stat-lbl">本月已评分</span></div>
        </div>
        <div class="stat">
          <span class="stat-ico ico-amber">⚖️</span>
          <div><span class="stat-num">{{ avgScore }}</span><span class="stat-lbl">平均得分</span></div>
        </div>
        <div class="stat">
          <span class="stat-ico ico-red">🚩</span>
          <div>
            <span class="stat-num">{{ flagged.length }}</span>
            <span class="stat-lbl">红黄牌预警<small v-if="flagged.length">（红{{ redCount }}/黄{{ yellowCount }}）</small></span>
          </div>
        </div>
      </section>

      <div class="cols">
        <!-- 等级分布 -->
        <section class="panel">
          <h3 class="panel-title">本月等级分布</h3>
          <RouterLink v-for="(meta, g) in gradeMeta" :key="g" class="grade-row" :to="`/grade/${month}/${g}`" title="查看该等级工厂">
            <span class="grade-tag" :style="{ background: meta.color }">{{ g }}</span>
            <span class="grade-name">{{ meta.label }}</span>
            <div class="grade-bar">
              <div class="grade-fill" :style="{ width: (gradeDist[g] / gradeTotal * 100) + '%', background: meta.color }"></div>
            </div>
            <span class="grade-cnt">{{ gradeDist[g] }}</span>
          </RouterLink>
        </section>

        <!-- 快捷入口 -->
        <section class="panel">
          <h3 class="panel-title">快捷入口</h3>
          <div class="quick">
            <RouterLink class="q-card" to="/factories"><span class="q-ico">🏭</span>工厂管理</RouterLink>
            <RouterLink class="q-card" :to="`/review/${month}`"><span class="q-ico">📊</span>评审大盘</RouterLink>
            <RouterLink v-if="auth.role && canEditOutput(auth.role)" class="q-card" to="/monthly-output"><span class="q-ico">💰</span>产值管理</RouterLink>
            <RouterLink v-if="auth.role && canEditTemplates(auth.role)" class="q-card" to="/admin/score-templates"><span class="q-ico">⚙️</span>评分模板</RouterLink>
            <RouterLink v-if="auth.role && canEditTemplates(auth.role)" class="q-card" to="/admin/users"><span class="q-ico">👥</span>用户管理</RouterLink>
          </div>
        </section>
      </div>

      <!-- 工厂对比 -->
      <FactoryCompare />
    </div>
  </AppLayout>
</template>

<style scoped>
.dash { max-width: 1100px; margin: 0 auto; display: flex; flex-direction: column; gap: 1.25rem; }

.hero {
  display: flex; justify-content: space-between; align-items: center;
  background: linear-gradient(135deg, #4f46e5 0%, #6366f1 50%, #818cf8 100%);
  color: #fff; border-radius: 16px; padding: 1.75rem 2rem;
  box-shadow: 0 10px 30px -10px rgba(79, 70, 229, .5);
}
.hero-text h1 { margin: 0 0 .35rem; font-size: 1.5rem; }
.hero-text p { margin: 0; opacity: .9; font-size: .95rem; }
.hero-month { text-align: right; display: flex; flex-direction: column; }
.m-label { font-size: .75rem; opacity: .85; }
.m-value { font-size: 1.6rem; font-weight: 700; letter-spacing: 1px; }

.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; }
.stat {
  display: flex; align-items: center; gap: .85rem;
  background: #fff; border: 1px solid #eef0f4; border-radius: 14px; padding: 1.1rem 1.25rem;
  box-shadow: 0 1px 3px rgba(0,0,0,.04);
}
.stat-ico { font-size: 1.4rem; width: 46px; height: 46px; display: grid; place-items: center; border-radius: 12px; }
.ico-blue { background: #eaf1ff; } .ico-green { background: #e8f7ee; }
.ico-amber { background: #fdf3e3; } .ico-red { background: #fdeaea; }
.stat-num { display: block; font-size: 1.6rem; font-weight: 700; line-height: 1.1; color: #1f2533; }
.stat-lbl { font-size: .82rem; color: #6b7280; }
.stat-lbl small { color: #9aa1ad; }

.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem; }
.panel { background: #fff; border: 1px solid #eef0f4; border-radius: 14px; padding: 1.25rem 1.4rem; box-shadow: 0 1px 3px rgba(0,0,0,.04); }
.panel-title { margin: 0 0 1rem; font-size: 1rem; color: #1f2533; }

.grade-row { display: grid; grid-template-columns: 28px 64px 1fr 28px; align-items: center; gap: .6rem; margin-bottom: .7rem; text-decoration: none; color: inherit; padding: .3rem .4rem; margin-left: -.4rem; margin-right: -.4rem; border-radius: 8px; cursor: pointer; transition: background .15s ease; }
.grade-row:hover { background: #f5f7ff; }
.grade-tag { color: #fff; font-weight: 700; text-align: center; border-radius: 6px; font-size: .8rem; padding: .15rem 0; }
.grade-name { font-size: .82rem; color: #6b7280; }
.grade-bar { background: #f1f3f7; border-radius: 6px; height: 10px; overflow: hidden; }
.grade-fill { height: 100%; border-radius: 6px; transition: width .4s ease; min-width: 2px; }
.grade-cnt { text-align: right; font-weight: 600; color: #374151; font-size: .85rem; }

.quick { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; }
.q-card {
  display: flex; align-items: center; gap: .6rem; text-decoration: none;
  padding: .85rem 1rem; border: 1px solid #eef0f4; border-radius: 12px; color: #374151;
  font-weight: 500; transition: all .15s ease; background: #fafbfd;
}
.q-card:hover { border-color: #c7d2fe; background: #f5f7ff; transform: translateY(-1px); box-shadow: 0 4px 12px -6px rgba(79,70,229,.4); }
.q-ico { font-size: 1.15rem; }

@media (max-width: 820px) {
  .stats { grid-template-columns: repeat(2, 1fr); }
  .cols { grid-template-columns: 1fr; }
  .hero { flex-direction: column; align-items: flex-start; gap: 1rem; }
  .hero-month { text-align: left; }
}
</style>
