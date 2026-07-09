import api from './auth'
import { apiPath } from './request'
import axios from 'axios'

export async function importEmail(uploadFile) {
  // uploadFile 是 el-upload 的文件对象（含 .raw 和预读的 ._buffer）
  const fileName = uploadFile._name || uploadFile.raw?.name || 'email.eml'
  const token = localStorage.getItem('token')
  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {}

  // 优先用预读缓存，避免 Foxmail 临时文件被删后无法读取
  let buffer = uploadFile._buffer
  if (!buffer && uploadFile.raw) {
    try {
      buffer = await uploadFile.raw.arrayBuffer()
    } catch (_) {
      buffer = null
    }
  }

  if (!buffer) {
    throw new Error('无法读取文件，请关闭 Foxmail 后重新拖入或点击上传')
  }

  const formData = new FormData()
  formData.append('eml_file', new Blob([buffer], { type: 'message/rfc822' }), fileName)
  const { data } = await axios.post(apiPath('/emails/import/'), formData, {
    headers: authHeaders,
    timeout: 300000,
  })
  return data
}

export async function listEmails(params = {}) {
  const { data } = await api.get('/emails/', { params })
  return data
}

export async function getEmail(id) {
  const { data } = await api.get(`/emails/${id}/`)
  return data
}

export async function deleteEmail(id) {
  await api.delete(`/emails/${id}/`)
}

// ── 新版邮箱配置 / 搜索 / 导入 ──────────────────────────────────────────────

export async function getMailboxConfig() {
  const { data } = await api.get('/emails/mailbox/config/')
  return data
}

export async function saveMailboxConfigApi(form) {
  const { data } = await api.post('/emails/mailbox/config/', form)
  return data
}

export async function searchMailboxApi(params) {
  const { data } = await api.post('/emails/mailbox/search/', params, { timeout: 60000 })
  return data
}

export async function importMailboxApi(payload) {
  const { data } = await api.post('/emails/mailbox/import/', payload, { timeout: 300000 })
  return data
}
