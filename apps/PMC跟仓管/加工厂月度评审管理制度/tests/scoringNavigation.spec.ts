import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Router } from 'vue-router'

// Keep the application's real route records and guards, but isolate browser
// history and lazy pages so navigation cannot read or change business data.
vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-router')>()
  return { ...actual, createWebHistory: actual.createMemoryHistory }
})
vi.mock('../src/views/LoginView.vue', () => ({ default: { template: '<div />' } }))
vi.mock('../src/views/DashboardView.vue', () => ({ default: { template: '<div />' } }))
vi.mock('../src/views/MonthlyScoringView.vue', () => ({ default: { template: '<div />' } }))
vi.mock('../src/views/ScoreSheetView.vue', () => ({ default: { template: '<div />' } }))
vi.mock('../src/views/FactoryMonthlyDataView.vue', () => ({ default: { template: '<div />' } }))
vi.mock('../src/views/FactoryListView.vue', () => ({ default: { template: '<div />' } }))
vi.mock('../src/views/FactoryDetailView.vue', () => ({ default: { template: '<div />' } }))
vi.mock('../src/pb', () => ({
  pb: {
    authStore: { record: null },
    collection: vi.fn(() => { throw new Error('Navigation must not call the backend') }),
  },
}))

describe('monthly scoring navigation', () => {
  const scorePath = '/factories/factory123/score/2026-07'
  const monthlyDataPath = '/factories/factory123/monthly-data/2026-07'
  let router: Router
  let auth: ReturnType<typeof import('../src/stores/auth')['useAuthStore']>
  let setPermissionOverrides: typeof import('../src/utils/permissions')['setPermissionOverrides']

  beforeEach(async () => {
    vi.resetModules()
    const { createPinia, setActivePinia } = await import('pinia')
    setActivePinia(createPinia())
    const { useAuthStore } = await import('../src/stores/auth')
    auth = useAuthStore()
    ;({ setPermissionOverrides } = await import('../src/utils/permissions'))
    ;({ router } = await import('../src/router'))
  })

  afterEach(() => {
    setPermissionOverrides(null)
    router.options.history.destroy()
  })

  function signIn(permissions: Record<string, boolean>) {
    auth.$patch({ userId: 'charles-test', role: 'gm', displayName: 'Charles' })
    setPermissionOverrides(permissions)
  }

  it('opens the score sheet from the monthly list without factory-management permission', async () => {
    signIn({ 'scoring.view': true, 'factories.view': false })

    await router.push('/scoring')
    expect(router.currentRoute.value.path).toBe('/scoring')
    for (const path of [scorePath, monthlyDataPath]) {
      await router.push(path)
      expect(router.currentRoute.value.path).toBe(path)
    }
    expect(router.currentRoute.value.redirectedFrom).toBeUndefined()
  })

  it('allows the score sheet as the initial deep link', async () => {
    signIn({ 'scoring.view': true, 'factories.view': false })

    await router.push(scorePath)
    await router.isReady()

    expect(router.currentRoute.value.path).toBe(scorePath)
    expect(router.currentRoute.value.redirectedFrom).toBeUndefined()
  })

  it('keeps ordinary factory pages blocked when only scoring is authorized', async () => {
    signIn({ 'scoring.view': true, 'factories.view': false })

    for (const path of ['/factories', '/factories/factory123']) {
      await router.push(path)
      expect(router.currentRoute.value.path).toBe('/dashboard')
    }
  })

  it('blocks scoring without its permission while preserving ordinary factory access', async () => {
    signIn({ 'scoring.view': false, 'factories.view': true })

    for (const path of ['/scoring', scorePath, monthlyDataPath]) {
      await router.push(path)
      expect(router.currentRoute.value.path).toBe('/dashboard')
    }
    for (const path of ['/factories', '/factories/factory123']) {
      await router.push(path)
      expect(router.currentRoute.value.path).toBe(path)
    }
  })

  it('redirects an unauthenticated scoring visit to login', async () => {
    for (const path of ['/scoring', scorePath, monthlyDataPath]) {
      await router.push(path)
      expect(router.currentRoute.value.path).toBe('/login')
    }
  })
})
