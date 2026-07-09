import api from './auth'

/** 获取某出货单的QC验货记录列表 */
export async function listQC(shipmentId) {
  const { data } = await api.get(`/shipments/${shipmentId}/qc/`)
  return data
}

/** 新建验货记录 */
export async function createQC(shipmentId, payload) {
  const { data } = await api.post(`/shipments/${shipmentId}/qc/`, payload)
  return data
}

/** 上传验货照片（返回已上传照片列表） */
export async function uploadPhotos(inspectionId, files) {
  const form = new FormData()
  for (const f of files) form.append('photos', f)
  const { data } = await api.post(`/shipments/qc/${inspectionId}/photos/`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data.photos
}

/** 删除验货照片 */
export async function deletePhoto(photoId) {
  await api.delete(`/shipments/qc/photos/${photoId}/`)
}

/** 推进出货单状态 */
export async function advanceStatus(shipmentId) {
  const { data } = await api.post(`/shipments/${shipmentId}/advance/`)
  return data
}

/** 撤回出货单状态（主管） */
export async function rollbackStatus(shipmentId) {
  const { data } = await api.post(`/shipments/${shipmentId}/rollback/`)
  return data
}

/** 获取通知列表 */
export async function listNotifications() {
  const { data } = await api.get('/shipments/notifications/')
  return data
}

/** 标记已读 ids=[] 时全部已读 */
export async function markRead(ids = []) {
  await api.post('/shipments/notifications/read/', { ids })
}
