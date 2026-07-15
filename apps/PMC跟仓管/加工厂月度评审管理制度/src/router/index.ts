import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { canAccessPath, canViewCraft } from '../utils/permissions'
import type { Craft } from '../constants/roles'

const routes: RouteRecordRaw[] = [
  { path: '/login', component: () => import('../views/LoginView.vue'), meta: { public: true } },
  { path: '/', redirect: '/dashboard' },
  { path: '/dashboard', component: () => import('../views/DashboardView.vue') },
  { path: '/grade/:month/:grade', component: () => import('../views/GradeDetailView.vue') },
  { path: '/factories', component: () => import('../views/FactoryListView.vue') },
  { path: '/factory-view', component: () => import('../views/FactoryAdminView.vue') },
  { path: '/factory-view/dept/:craft', component: () => import('../views/FactoryAdminDeptView.vue') },
  { path: '/factory-view/:id', component: () => import('../views/FactoryViewDetail.vue') },
  { path: '/factories/new', component: () => import('../views/FactoryDetailView.vue') },
  { path: '/factories/dept/:craft', component: () => import('../views/DeptFactoriesView.vue') },
  { path: '/factories/:id', component: () => import('../views/FactoryDetailView.vue') },
  { path: '/factories/:id/score/:month', component: () => import('../views/ScoreSheetView.vue') },
  { path: '/orders', component: () => import('../views/OrdersView.vue') },
  { path: '/orders/new', component: () => import('../views/OrderFormView.vue') },
  { path: '/orders/dept/:craft', component: () => import('../views/DeptOrdersView.vue') },
  { path: '/orders/dept/:craft/new', component: () => import('../views/OrderFormView.vue') },
  { path: '/orders/dept/:craft/:id', component: () => import('../views/OrderDetailView.vue') },
  { path: '/order-tracking', component: () => import('../views/OrderTrackingView.vue') },
  { path: '/quality', component: () => import('../views/QualityHubView.vue') },
  { path: '/quality-5s', component: () => import('../views/Quality5sView.vue') },
  { path: '/quality-inspection', component: () => import('../views/QualityInspectionView.vue') },
  { path: '/monthly-output', component: () => import('../views/MonthlyOutputView.vue') },
  { path: '/review/:month', component: () => import('../views/ReviewBoardView.vue') },
  { path: '/review/:month/meeting', component: () => import('../views/ReviewMeetingView.vue') },
  { path: '/kpi', component: () => import('../views/KpiBoardView.vue') },
  { path: '/scoring', component: () => import('../views/MonthlyScoringView.vue') },
  { path: '/price-stats', component: () => import('../views/PriceStatsDeptsView.vue') },
  { path: '/price-stats/dept/:craft', component: () => import('../views/PriceStatsView.vue') },
  { path: '/summary', component: () => import('../views/SummaryView.vue') },
  { path: '/admin/score-templates', component: () => import('../views/admin/ScoreTemplateAdminView.vue'), meta: { adminOnly: true } },
  { path: '/admin/users', component: () => import('../views/admin/UserAdminView.vue'), meta: { adminOnly: true } },
]

export const router = createRouter({ history: createWebHistory(), routes })

router.beforeEach((to) => {
  const auth = useAuthStore()
  if (!to.meta.public && !auth.isLoggedIn) return '/login'
  if (auth.role && !canAccessPath(auth.role, to.path)) return '/dashboard'
  const craft = to.params.craft as Craft | undefined
  if (craft && !canViewCraft(craft)) return '/dashboard'
  return true
})

// 重新发布后旧分包文件失效，导致按需加载页面失败（点击菜单“没反应”）。
// 捕获到这类动态导入错误时，自动刷新一次以拉取最新版本，避免手动硬刷新。
router.onError((err, to) => {
  const msg = String((err && (err as any).message) || err || '')
  if (/dynamically imported module|Importing a module script failed|Failed to fetch/i.test(msg)) {
    const key = 'chunk-reload-at'
    const last = Number(sessionStorage.getItem(key) || 0)
    // 10 秒内只自动刷新一次，避免极端情况下反复刷新
    if (Date.now() - last > 10000) {
      sessionStorage.setItem(key, String(Date.now()))
      window.location.assign(to?.fullPath || window.location.href)
    }
  }
})
