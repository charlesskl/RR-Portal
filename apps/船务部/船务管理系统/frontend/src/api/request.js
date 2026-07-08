import axios from 'axios'

export const APP_BASE = (import.meta.env.BASE_URL || '/').replace(/\/$/, '')

export function appPath(path = '/') {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return APP_BASE ? `${APP_BASE}${normalized}` : normalized
}

export function apiPath(path = '/') {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return appPath(normalized.startsWith('/api') ? normalized : `/api${normalized}`)
}

function normalizeUrl(url) {
  if (!url || /^https?:\/\//i.test(url)) return url
  if (url.startsWith('/api')) return appPath(url)
  return url
}

// 进行中的刷新（避免并发请求同时多次刷新 token）
let refreshing = null

async function refreshAccessToken() {
  if (refreshing) return refreshing
  refreshing = (async () => {
    const refresh = localStorage.getItem('refresh_token')
    if (!refresh) throw new Error('no refresh token')
    // 用全新的裸 axios 避免拦截器递归
    const { data } = await axios.post(apiPath('/auth/token/refresh/'), { refresh })
    localStorage.setItem('token', data.access)
    if (data.refresh) localStorage.setItem('refresh_token', data.refresh)
    return data.access
  })().finally(() => { refreshing = null })
  return refreshing
}

function gotoLogin() {
  localStorage.removeItem('token')
  localStorage.removeItem('refresh_token')
  localStorage.removeItem('user')
  const loginPath = appPath('/login')
  if (location.pathname !== loginPath) {
    location.href = loginPath
  }
}

// 给任意 axios 实例（含全局 axios）安装 token 注入 + 401 自动刷新
export function installInterceptors(instance) {
  instance.interceptors.request.use(config => {
    config.url = normalizeUrl(config.url)
    const token = localStorage.getItem('token')
    if (token) config.headers.Authorization = `Bearer ${token}`
    return config
  })
  instance.interceptors.response.use(
    res => res,
    async err => {
      const orig = err.config || {}
      const status = err.response?.status
      const code = err.response?.data?.code
      const isAuthExpired = status === 401 && (code === 'token_not_valid' || !code)
      // 跳过 refresh 端点本身（避免无限循环）
      const isRefreshEndpoint = orig.url && orig.url.includes('/auth/token/refresh/')
      if (isAuthExpired && !orig._retried && !isRefreshEndpoint) {
        orig._retried = true
        try {
          const newToken = await refreshAccessToken()
          orig.headers = orig.headers || {}
          orig.headers.Authorization = `Bearer ${newToken}`
          return instance.request(orig)
        } catch (e) {
          gotoLogin()
          throw err
        }
      }
      // refresh token 自己过期 → 跳登录
      if (isRefreshEndpoint && status === 401) {
        gotoLogin()
      }
      throw err
    }
  )
}

// 共享 axios 实例（baseURL /shipping/api in production）
const request = axios.create({ baseURL: apiPath('/') })
installInterceptors(request)
export default request
