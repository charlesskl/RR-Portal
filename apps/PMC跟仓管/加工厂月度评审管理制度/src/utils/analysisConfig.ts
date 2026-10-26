export function configErrorMessage(error: any): string {
  const status = Number(error?.status || error?.response?.status || 0)
  if (status === 401) return '登录状态已失效，请重新登录后读取AI配置。'
  if (status === 403) return '当前账号无AI分析权限，请联系管理员检查账号权限。'
  if (status === 404) return 'AI配置接口不存在，请管理员检查后端版本和代理地址。'
  if (status === 429) return '配置查询过于频繁，请稍后重试。'
  if (status >= 500) return 'AI配置服务暂不可用，请稍后重试；若持续失败，请管理员检查后端服务。'
  return 'AI配置请求超时或网络连接失败，请检查网络后重试。'
}
export interface AnalysisConfig { enabled: boolean; model: string; reason: string; dailyLimit: number }
export function isAnalysisConfig(value: any): value is AnalysisConfig {
  return !!value && typeof value === 'object' && typeof value.enabled === 'boolean' && typeof value.model === 'string' && typeof value.reason === 'string' && typeof value.dailyLimit === 'number'
}
