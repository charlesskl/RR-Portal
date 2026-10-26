import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import PocketBase from 'pocketbase'
import { pb } from '../src/pb'
import { useAuthStore } from '../src/stores/auth'

const captured = vi.hoisted(() => ({ guard: null as any }))
vi.mock('vue-router', () => ({
  createWebHistory: vi.fn(),
  createRouter: () => ({ beforeEach: (fn: any) => { captured.guard = fn }, onError: vi.fn() }),
}))
import '../src/router'

const now = Date.parse('2026-10-26T00:00:00Z')
function token(exp: number) {
  return [btoa('{"alg":"HS256"}'), btoa(JSON.stringify({ type: 'auth', exp })), 'synthetic-signature'].join('.')
}
function identity(overrides = {}) {
  return { id: 'synthetic-user', collectionName: 'users', role: 'admin', display_name: 'Cached administrator',
    crafts: ['injection'], permissions: {}, ...overrides }
}
function login(exp = now / 1000 + 60, record: any = identity()) {
  pb.authStore.save(token(exp), record)
  return useAuthStore()
}
function route(path = '/analysis', params = {}, query = {}, meta = {}) {
  return { path, params, query, meta }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(now)
  localStorage.clear()
  pb.authStore.clear()
  setActivePinia(createPinia())
})
afterEach(() => {
  pb.authStore.clear()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('route expiry with real PocketBase LocalAuthStore and Pinia identity', () => {
  it('clears cached administrator identity and persisted credentials when the token has expired', () => {
    const auth = login(now / 1000 - 1)
    expect(auth.isLoggedIn).toBe(true)
    expect(auth.role).toBe('admin')
    expect(auth.displayName).toBe('Cached administrator')
    expect(pb.authStore.isValid).toBe(false)
    const changed = vi.fn()
    const unsubscribe = pb.authStore.onChange(changed)
    expect(captured.guard(route())).toBe('/login')
    expect(auth.userId).toBeNull()
    expect(auth.role).toBeNull()
    expect(auth.displayName).toBe('')
    expect(auth.crafts).toEqual([])
    expect(auth.isLoggedIn).toBe(false)
    expect(pb.authStore.record).toBeNull()
    expect(pb.authStore.token).toBe('')
    expect(localStorage.getItem('pocketbase_auth')).toBeNull()
    expect(changed).toHaveBeenCalledWith('', null)
    // A new SDK instance simulates a reload reading the same browser storage.
    expect(new PocketBase('http://127.0.0.1/fixture').authStore.record).toBeNull()
    unsubscribe()
  })

  it('rechecks the actual exp boundary on each navigation', () => {
    const auth = login(now / 1000 + 60)
    expect(captured.guard(route())).toBe(true)
    vi.setSystemTime(now + 60_000)
    expect(pb.authStore.isValid).toBe(false)
    expect(captured.guard(route())).toBe('/login')
    expect(auth.isLoggedIn).toBe(false)
  })

  it('rejects a malformed persisted token even when the cached user record exists', () => {
    pb.authStore.save('not-a-jwt', identity())
    const auth = useAuthStore()
    expect(auth.isLoggedIn).toBe(true)
    expect(captured.guard(route())).toBe('/login')
    expect(pb.authStore.token).toBe('')
  })

  it('rejects a valid token without a cached account record', () => {
    login(now / 1000 + 60, null)
    expect(pb.authStore.isValid).toBe(true)
    expect(captured.guard(route())).toBe('/login')
    expect(pb.authStore.token).toBe('')
  })

  it('allows a valid session and leaves its identity and storage intact', () => {
    const auth = login()
    const before = localStorage.getItem('pocketbase_auth')
    expect(captured.guard(route())).toBe(true)
    expect(auth.userId).toBe('synthetic-user')
    expect(localStorage.getItem('pocketbase_auth')).toBe(before)
  })

  it('keeps the public login route reachable with an expired cached session', () => {
    const auth = login(now / 1000 - 1)
    const logout = vi.spyOn(auth, 'logout')
    expect(captured.guard(route('/login', {}, {}, { public: true }))).toBe(true)
    expect(logout).not.toHaveBeenCalled()
  })

  it('preserves role view restrictions for valid sessions', () => {
    login(undefined, identity({ role: 'finance_cost' }))
    expect(captured.guard(route('/admin/users'))).toBe('/dashboard')
    expect(captured.guard(route('/monthly-output'))).toBe(true)
  })

  it('preserves authorized craft restrictions after the expiry check', () => {
    login()
    expect(captured.guard(route('/orders/dept/painting', { craft: 'painting' }))).toBe('/dashboard')
    expect(captured.guard(route('/orders/dept/injection', { craft: 'injection' }))).toBe(true)
  })

  it('preserves explicit region restrictions and module overrides', () => {
    login(undefined, identity({ permissions: { 'region.hunan': false, 'orders.view': false } }))
    expect(captured.guard(route('/orders'))).toBe('/dashboard')
    expect(captured.guard(route('/quality', {}, { region: 'hunan' }))).toBe('/dashboard')
    expect(captured.guard(route('/quality', {}, { region: 'dongguan' }))).toBe(true)
  })
})
