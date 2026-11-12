export type ShipmentLoadStage = 'detail' | 'metadata' | 'parse'

/** Persist a useful request-stage error without printing response bodies/tokens. */
export function shipmentLoadError(error: unknown, stage: ShipmentLoadStage) {
  const value = error as { message?: string; code?: string; response?: { status?: number; data?: { error?: string; message?: string } } } | null
  const label = { detail: '走货详情', metadata: '物料资料', parse: '走货资料解析' }[stage]
  const status = value?.response?.status
  if (!status && (value?.code === 'ERR_NETWORK' || value?.message === 'Network Error'))
    return `${label}请求未取得有效响应（Network Error）。请重试；若反复出现，需要核对该接口的服务器日志。`
  if (value?.code === 'ECONNABORTED' || value?.code === 'ETIMEDOUT') return `${label}请求超时，请重试。`
  const detail = value?.response?.data?.error || value?.response?.data?.message || value?.message
  return `${label}加载失败${status ? `（HTTP ${status}）` : ''}：${typeof detail === 'string' ? detail.slice(0, 300) : '未知错误，请重试'}`
}
