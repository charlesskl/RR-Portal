import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const routes = [
  { path: '/login', name: 'Login', component: () => import('../views/Login.vue') },
  {
    path: '/',
    component: () => import('../components/AppLayout.vue'),
    meta: { requiresAuth: true },
    children: [
      { path: '', redirect: '/emails' },
      { path: '/emails', name: 'EmailImport', component: () => import('../views/shipping/EmailImport.vue') },
      { path: '/shipments', name: 'ShipmentList', component: () => import('../views/shipping/ShipmentList.vue') },
      { path: '/shipments/:id', name: 'ShipmentEdit', component: () => import('../views/shipping/ShipmentEdit.vue') },
      { path: '/generate/:id', name: 'ContainerSheetGen', component: () => import('../views/shipping/ContainerSheetGen.vue') },
      { path: '/review/:id', name: 'ContainerSheetReview', component: () => import('../views/shipping/ContainerSheetReview.vue') },
      { path: '/pallets', name: 'PalletStats', component: () => import('../views/shipping/PalletStats.vue') },
      { path: '/bill-of-lading', name: 'BillOfLading', component: () => import('../views/shipping/BillOfLading.vue') },
      { path: '/daily-import', name: 'DailyImport', component: () => import('../views/shipping/DailyImport.vue') },
      { path: '/master/products', name: 'ProductMapping', component: () => import('../views/master/ProductMapping.vue') },
      { path: '/master/factories', name: 'FactoryMapping', component: () => import('../views/master/FactoryMapping.vue') },
      { path: '/master/users', name: 'UserManagement', component: () => import('../views/master/UserManagement.vue'), meta: { requiresRole: 'supervisor' } },
    ],
  },
]

const router = createRouter({ history: createWebHistory(import.meta.env.BASE_URL), routes })

router.beforeEach((to, _from, next) => {
  const auth = useAuthStore()
  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    next('/login')
    return
  }
  if (to.meta.requiresRole) {
    const isSuperuser = auth.user?.is_superuser
    const hasRole = auth.user?.role === to.meta.requiresRole
    if (!isSuperuser && !hasRole) {
      next('/')
      return
    }
  }
  next()
})

export default router
