import api from './request'

/**
 * 上传 EML 文件触发 AI 解析
 * @param {File} file - EML 文件对象
 * @returns {Promise} 带置信度的解析结果
 */
export async function aiParseEmail(file) {
  const formData = new FormData()
  formData.append('eml_file', file)
  const { data } = await api.post('/emails/ai-parse/', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  })
  return data
}

/**
 * 用户审核确认后创建出货单
 * @param {Object} reviewedData - 已审核的字段和明细
 * @returns {Promise} { shipment_id }
 */
export async function aiParseConfirm(reviewedData) {
  const { data } = await api.post('/emails/ai-parse/confirm/', reviewedData)
  return data
}

/**
 * 保存未知目的港映射
 * @param {string} portName - 原始目的港文本
 * @param {string} countryCn - 中文国家名
 */
export async function saveDestinationPort(portName, countryCn) {
  const { data } = await api.post('/master-data/destination-ports/', {
    port_name: portName,
    country_cn: countryCn,
  })
  return data
}
