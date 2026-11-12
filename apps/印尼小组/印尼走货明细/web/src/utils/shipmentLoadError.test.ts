import { expect, it } from 'vitest'
import { shipmentLoadError } from './shipmentLoadError'

it('没有响应的Network Error不伪装成500，并指出失败请求阶段', () => {
  const message = shipmentLoadError({ code: 'ERR_NETWORK', message: 'Network Error' }, 'metadata')
  expect(message).toContain('物料资料')
  expect(message).toContain('Network Error')
  expect(message).not.toContain('500')
})
it('服务器错误显示状态与可用业务原因，不暴露任意响应正文', () => {
  expect(shipmentLoadError({ response: { status: 500, data: { error: '服务读取失败' } } }, 'detail')).toContain('走货详情加载失败（HTTP 500）：服务读取失败')
  expect(shipmentLoadError({ response: { status: 502, data: '<html>hidden body</html>' } }, 'detail')).not.toContain('hidden body')
})
it('解析失败、超时及未知错误均提供可保留的文字', () => {
  expect(shipmentLoadError(new Error('invalid snapshot'), 'parse')).toContain('走货资料解析')
  expect(shipmentLoadError({ code: 'ECONNABORTED' }, 'detail')).toContain('超时')
  expect(shipmentLoadError(null, 'detail')).toContain('未知错误')
})
