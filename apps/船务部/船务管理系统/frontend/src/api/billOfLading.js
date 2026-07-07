import api from './auth'

/** 搜索匹配的提单（按货号/合同号/邮件主题等） */
export async function searchBL(params) {
  const { data } = await api.post('/shipments/bl/search/', params)
  return data.groups || []
}

/** 保存提单记录 */
export async function saveBL(payload) {
  const { data } = await api.post('/shipments/bl/save/', payload)
  return data
}

/** 获取所有已保存提单列表 */
export async function listBL() {
  const { data } = await api.get('/shipments/bl/')
  return data.records || []
}

/** 获取提单详情 */
export async function getBL(id) {
  const { data } = await api.get(`/shipments/bl/${id}/`)
  return data
}

/** 删除提单记录 */
export async function deleteBL(id) {
  await api.delete(`/shipments/bl/${id}/`)
}

/** 核对提单（与当前出货单实时比对） */
export async function verifyBL(id) {
  const { data } = await api.post(`/shipments/bl/${id}/verify/`)
  return data
}

/** 将已导入邮件的解析数据与出货单智能匹配 */
export async function matchFromEmail(emailRecordId, dateFrom = '2025-10-01', dateTo = '2026-03-31') {
  const { data } = await api.post('/shipments/bl/match-from-email/', {
    email_record_id: emailRecordId,
    date_from: dateFrom,
    date_to: dateTo,
  })
  return data
}
