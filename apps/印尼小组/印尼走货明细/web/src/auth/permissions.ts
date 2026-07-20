export type ModuleKey = 'products' | 'customers' | 'schedules' | 'purchase' | 'quotes' | 'molding' | 'outbound' | 'shipments'

export interface PermissionModule {
  key: ModuleKey
  name: string
  path: string
  positions: number[]
}

export const PERMISSION_MODULES: PermissionModule[] = [
  { key: 'customers', name: '客户管理', path: '/customers', positions: [2] },
  { key: 'products', name: '货号库（含物料、字典）', path: '/products', positions: [0, 1] },
  { key: 'quotes', name: '报价', path: '/quotes', positions: [5] },
  { key: 'purchase', name: '采购订单', path: '/purchase', positions: [4] },
  { key: 'molding', name: '生产单', path: '/molding-pos', positions: [6] },
  { key: 'schedules', name: '排期', path: '/schedules', positions: [3] },
  { key: 'shipments', name: '走货明细', path: '/shipments', positions: [8] },
  { key: 'outbound', name: '出库', path: '/outbound', positions: [7] },
]

export interface AuthSession {
  token: string
  displayName: string
  userbqrpower: string
  usereditpower: string
}

const STORAGE_KEY = 'indo_auth'

export function getStoredSession(): AuthSession | null {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    return v?.token ? v as AuthSession : null
  } catch { return null }
}

export function saveSession(v: AuthSession | null) {
  if (v) localStorage.setItem(STORAGE_KEY, JSON.stringify(v))
  else localStorage.removeItem(STORAGE_KEY)
}

export function hasBits(bits: string | undefined, positions: number[]) {
  return positions.every(p => bits?.[p] === '1')
}

export function isAdminSession(v: AuthSession | null) {
  return v?.userbqrpower === '111111111' && v?.usereditpower === '111111111'
}

export function moduleForPath(pathname: string) {
  if (pathname.startsWith('/dictionaries')) return PERMISSION_MODULES.find(x => x.key === 'products')
  return PERMISSION_MODULES.find(x => pathname.startsWith(x.path))
}
