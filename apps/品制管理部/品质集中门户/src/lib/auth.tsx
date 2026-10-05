// ============================================================
// 认证上下文 + SSO 票据签发 + 审计日志（localStorage 模拟）
// 正式环境：login 换成后端接口，issueTicket 由认证中心用私钥签名
// ============================================================
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { USERS, APPS, defaultLevel, SSO_SECRET, APP_FEATURES, QMS_COMPANIES } from '@/config'
import type { FeatureLevel, PermissionLevel, PortalApp, PortalUser } from '@/config'

export interface SessionUser {
  username: string
  displayName: string
  role: 'admin' | 'employee'
  department: string
}

export interface AuditEntry {
  time: string
  user: string
  action: 'login' | 'logout' | 'enter_app'
  target?: string
  detail?: string
}

const SESSION_KEY = 'portal.session'
const AUDIT_KEY = 'portal.audit'
const PERMS_KEY = 'portal.perms'
const FEATURE_PERMS_KEY = 'portal.featurePerms'
const COMPANY_PERMS_KEY = 'portal.companyPerms'
const EXTRA_USERS_KEY = 'portal.extraUsers'

// 权限覆盖表：{ [username]: { [appId]: PermissionLevel } }
export type PermOverrides = Record<string, Record<string, PermissionLevel>>

// 功能权限覆盖表：{ [username]: { [appId]: { [featureKey]: FeatureLevel } } }
export type FeaturePermOverrides = Record<string, Record<string, Record<string, FeatureLevel>>>

// 厂区权限覆盖表：{ [username]: { [appId]: string[] } }（仅多厂区系统使用）
export type CompanyPermOverrides = Record<string, Record<string, string[]>>

// 新增账号表单
export interface NewUserInput {
  username: string
  password: string
  displayName: string
  department: string
  role: 'admin' | 'employee'
}

function readExtraUsers(): PortalUser[] {
  try {
    return JSON.parse(localStorage.getItem(EXTRA_USERS_KEY) || '[]')
  } catch {
    return []
  }
}

interface AuthContextValue {
  user: SessionUser | null
  login: (username: string, password: string) => string | null
  logout: () => void
  allUsers: PortalUser[]
  addUser: (input: NewUserInput) => string | null
  removeUser: (username: string) => void
  enterApp: (appId: string, appName: string, baseUrl: string) => void
  jumpApp: (appId: string) => Promise<string | null>
  auditLog: AuditEntry[]
  overrides: PermOverrides
  setLevel: (username: string, appId: string, level: PermissionLevel) => void
  effectiveLevel: (u: Pick<SessionUser, 'username' | 'role'>, app: PortalApp) => PermissionLevel
  featurePerms: FeaturePermOverrides
  setFeatureLevel: (username: string, appId: string, featureKey: string, level: FeatureLevel) => void
  effectiveFeatureLevel: (
    u: Pick<SessionUser, 'username' | 'role'>,
    app: PortalApp,
    featureKey: string,
  ) => FeatureLevel
  companyPerms: CompanyPermOverrides
  setCompanies: (username: string, appId: string, companies: string[]) => void
  effectiveCompanies: (username: string, appId: string) => string[]
}

const AuthContext = createContext<AuthContextValue | null>(null)

function readAudit(): AuditEntry[] {
  try {
    return JSON.parse(localStorage.getItem(AUDIT_KEY) || '[]')
  } catch {
    return []
  }
}

function appendAudit(entry: AuditEntry) {
  const log = [entry, ...readAudit()].slice(0, 200)
  localStorage.setItem(AUDIT_KEY, JSON.stringify(log))
}

function readOverrides(): PermOverrides {
  try {
    return JSON.parse(localStorage.getItem(PERMS_KEY) || '{}')
  } catch {
    return {}
  }
}

function readFeaturePerms(): FeaturePermOverrides {
  try {
    return JSON.parse(localStorage.getItem(FEATURE_PERMS_KEY) || '{}')
  } catch {
    return {}
  }
}

function readCompanyPerms(): CompanyPermOverrides {
  try {
    return JSON.parse(localStorage.getItem(COMPANY_PERMS_KEY) || '{}')
  } catch {
    return {}
  }
}

// ── JWT（HS256）签发 ──
function b64url(bytes: Uint8Array): string {
  let s = ''
  bytes.forEach((b) => (s += String.fromCharCode(b)))
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlJson(obj: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(obj)))
}

async function hmacSha256(secret: string, msg: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg))
  return b64url(new Uint8Array(sig))
}

// 生成一次性 SSO 票据（JWT，HS256 签名，5 分钟有效；perms 为功能权限清单，companies 为可访问厂区）
async function issueTicket(
  user: SessionUser,
  appId: string,
  perms: Record<string, FeatureLevel>,
  companies?: string[],
): Promise<string> {
  const header = b64urlJson({ alg: 'HS256', typ: 'JWT' })
  const payload = b64urlJson({
    sub: user.username,
    name: user.displayName,
    dept: user.department,
    app: appId,
    perms,
    companies,
    iat: Date.now(),
    exp: Date.now() + 5 * 60 * 1000,
  })
  const sig = await hmacSha256(SSO_SECRET, `${header}.${payload}`)
  return `${header}.${payload}.${sig}`
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(() => {
    try {
      const raw = localStorage.getItem(SESSION_KEY)
      return raw ? (JSON.parse(raw) as SessionUser) : null
    } catch {
      return null
    }
  })
  const [auditLog, setAuditLog] = useState<AuditEntry[]>(readAudit)
  const [overrides, setOverrides] = useState<PermOverrides>(readOverrides)
  const [featurePerms, setFeaturePerms] = useState<FeaturePermOverrides>(readFeaturePerms)
  const [companyPerms, setCompanyPerms] = useState<CompanyPermOverrides>(readCompanyPerms)
  const [extraUsers, setExtraUsers] = useState<PortalUser[]>(readExtraUsers)

  // 全部账号 = 配置文件内置 + 页面上新增的
  const allUsers = useMemo(() => [...USERS, ...extraUsers], [extraUsers])

  // 新增账号（页面「权限管理」里调用），返回错误信息或 null（成功）
  const addUser = useCallback(
    (input: NewUserInput): string | null => {
      const username = input.username.trim()
      if (!username) return '请填写登录账号'
      if (!/^[a-zA-Z0-9_.-]+$/.test(username)) return '账号只能包含字母、数字、_ . -'
      if (!input.displayName.trim()) return '请填写姓名'
      if (!input.password) return '请填写密码'
      if (input.password.length < 6) return '密码至少 6 位'
      if (allUsers.some((u) => u.username.toLowerCase() === username.toLowerCase())) return '该账号已存在'
      const nu: PortalUser = {
        username,
        password: input.password,
        displayName: input.displayName.trim(),
        role: input.role,
        department: input.department.trim() || '未分配',
      }
      setExtraUsers((prev) => {
        const next = [...prev, nu]
        localStorage.setItem(EXTRA_USERS_KEY, JSON.stringify(next))
        return next
      })
      return null
    },
    [allUsers],
  )

  // 删除页面上新增的账号（内置账号不可删），同时清掉它的权限设置
  const removeUser = useCallback((username: string) => {
    setExtraUsers((prev) => {
      const next = prev.filter((u) => u.username !== username)
      localStorage.setItem(EXTRA_USERS_KEY, JSON.stringify(next))
      return next
    })
    for (const key of [PERMS_KEY, FEATURE_PERMS_KEY, COMPANY_PERMS_KEY]) {
      try {
        const table = JSON.parse(localStorage.getItem(key) || '{}')
        if (table[username]) {
          delete table[username]
          localStorage.setItem(key, JSON.stringify(table))
        }
      } catch { /* 忽略损坏数据 */ }
    }
    setOverrides(readOverrides())
    setFeaturePerms(readFeaturePerms())
    setCompanyPerms(readCompanyPerms())
  }, [])

  useEffect(() => {
    if (user) localStorage.setItem(SESSION_KEY, JSON.stringify(user))
    else localStorage.removeItem(SESSION_KEY)
  }, [user])

  const record = useCallback((entry: AuditEntry) => {
    appendAudit(entry)
    setAuditLog(readAudit())
  }, [])

  const login = useCallback(
    (username: string, password: string): string | null => {
      const found: PortalUser | undefined = allUsers.find(
        (u) => u.username === username.trim() && u.password === password,
      )
      if (!found) return '账号或密码错误'
      const session: SessionUser = {
        username: found.username,
        displayName: found.displayName,
        role: found.role,
        department: found.department,
      }
      setUser(session)
      record({ time: new Date().toLocaleString('zh-CN'), user: session.displayName, action: 'login' })
      return null
    },
    [record, allUsers],
  )

  const logout = useCallback(() => {
    if (user) record({ time: new Date().toLocaleString('zh-CN'), user: user.displayName, action: 'logout' })
    setUser(null)
  }, [user, record])

  // 可访问厂区 = 账号单独设置 ?? 全部厂区（仅多厂区系统使用）
  const effectiveCompanies = useCallback(
    (username: string, appId: string): string[] => {
      return companyPerms[username]?.[appId] ?? QMS_COMPANIES.map((c) => c.id)
    },
    [companyPerms],
  )

  const setCompanies = useCallback((username: string, appId: string, companies: string[]) => {
    setCompanyPerms((prev) => {
      const next: CompanyPermOverrides = {
        ...prev,
        [username]: { ...(prev[username] ?? {}), [appId]: companies },
      }
      localStorage.setItem(COMPANY_PERMS_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  const enterApp = useCallback(
    (appId: string, appName: string, baseUrl: string) => {
      if (!user) return
      // 组装该账号对目标系统的功能权限清单（未单独设置的功能默认全给；none 也随票下发）
      const perms: Record<string, FeatureLevel> = {}
      for (const f of APP_FEATURES[appId] ?? []) {
        perms[f.key] = featurePerms[user.username]?.[appId]?.[f.key] ?? 'full'
      }
      // 多厂区系统附带可访问厂区清单
      const companies = appId === 'xingxin-qms' ? effectiveCompanies(user.username, appId) : undefined
      void issueTicket(user, appId, perms, companies).then((ticket) => {
        record({
          time: new Date().toLocaleString('zh-CN'),
          user: user.displayName,
          action: 'enter_app',
          target: appName,
          detail: `sso_ticket 已签发（JWT · 5 分钟有效）`,
        })
        window.open(`${baseUrl}?sso_ticket=${encodeURIComponent(ticket)}`, '_blank', 'noopener')
      })
    },
    [user, record, featurePerms, effectiveCompanies],
  )

  // 系统内切换：签发票据后在当前标签页直达目标系统（供 /#/jump 中转页使用）
  const jumpApp = useCallback(
    async (appId: string): Promise<string | null> => {
      if (!user) return '请先登录门户'
      const app = APPS.find((a) => a.id === appId)
      if (!app) return '目标系统不存在'
      if (app.status !== 'online') return '目标系统维护中'
      if ((overrides[user.username]?.[appId] ?? defaultLevel(user.role, app)) !== 'enter')
        return '当前账号无权进入该系统'
      const perms: Record<string, FeatureLevel> = {}
      for (const f of APP_FEATURES[appId] ?? []) {
        perms[f.key] = featurePerms[user.username]?.[appId]?.[f.key] ?? 'full'
      }
      const companies = appId === 'xingxin-qms' ? effectiveCompanies(user.username, appId) : undefined
      const ticket = await issueTicket(user, appId, perms, companies)
      record({
        time: new Date().toLocaleString('zh-CN'),
        user: user.displayName,
        action: 'enter_app',
        target: app.name,
        detail: `系统内切换 · sso_ticket 已签发（JWT · 5 分钟有效）`,
      })
      window.location.replace(`${app.url}?sso_ticket=${encodeURIComponent(ticket)}`)
      return null
    },
    [user, record, overrides, featurePerms, effectiveCompanies],
  )

  // 管理员设置某账号对某系统的权限档位，立即持久化
  const setLevel = useCallback((username: string, appId: string, level: PermissionLevel) => {
    setOverrides((prev) => {
      const next: PermOverrides = { ...prev, [username]: { ...(prev[username] ?? {}), [appId]: level } }
      localStorage.setItem(PERMS_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  // 有效权限 = 账号单独设置 ?? 角色默认值
  const effectiveLevel = useCallback(
    (u: Pick<SessionUser, 'username' | 'role'>, app: PortalApp): PermissionLevel => {
      return overrides[u.username]?.[app.id] ?? defaultLevel(u.role, app)
    },
    [overrides],
  )

  // 设置某账号在某系统的某个功能上的权限档位
  const setFeatureLevel = useCallback(
    (username: string, appId: string, featureKey: string, level: FeatureLevel) => {
      setFeaturePerms((prev) => {
        const next: FeaturePermOverrides = {
          ...prev,
          [username]: {
            ...(prev[username] ?? {}),
            [appId]: { ...(prev[username]?.[appId] ?? {}), [featureKey]: level },
          },
        }
        localStorage.setItem(FEATURE_PERMS_KEY, JSON.stringify(next))
        return next
      })
    },
    [],
  )

  // 有效功能权限 = 账号单独设置 ?? 按系统级权限推导（可进入→全部操作，仅可见→仅查看）
  const effectiveFeatureLevel = useCallback(
    (u: Pick<SessionUser, 'username' | 'role'>, app: PortalApp, featureKey: string): FeatureLevel => {
      const ov = featurePerms[u.username]?.[app.id]?.[featureKey]
      if (ov) return ov
      const appLevel = effectiveLevel(u, app)
      return appLevel === 'enter' ? 'full' : appLevel === 'view' ? 'view' : 'none'
    },
    [featurePerms, effectiveLevel],
  )

  return (
    <AuthContext.Provider
      value={{
        user,
        login,
        logout,
        allUsers,
        addUser,
        removeUser,
        enterApp,
        jumpApp,
        auditLog,
        overrides,
        setLevel,
        effectiveLevel,
        featurePerms,
        setFeatureLevel,
        effectiveFeatureLevel,
        companyPerms,
        setCompanies,
        effectiveCompanies,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
