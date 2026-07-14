import api from './auth'

export async function createShipmentFromEmail(emailRecordId, parsedData) {
  const { data } = await api.post('/shipments/from-email/', { email_record_id: emailRecordId, parsed_data: parsedData })
  return data
}

export async function listShipments(params = {}) {
  const { data } = await api.get('/shipments/', { params })
  return data
}

export async function getShipment(id) {
  const { data } = await api.get(`/shipments/${id}/`)
  return data
}

export async function updateShipment(id, payload) {
  const { data } = await api.patch(`/shipments/${id}/`, payload)
  return data
}

// 混合装子行 API
export async function listSubItems(itemId) {
  const { data } = await api.get(`/shipments/items/${itemId}/sub-items/`)
  return data.results || data
}

export async function createSubItem(itemId, payload) {
  const { data } = await api.post(`/shipments/items/${itemId}/sub-items/`, payload)
  return data
}

export async function updateSubItem(itemId, subItemId, payload) {
  const { data } = await api.patch(`/shipments/items/${itemId}/sub-items/${subItemId}/`, payload)
  return data
}

export async function deleteSubItem(itemId, subItemId) {
  await api.delete(`/shipments/items/${itemId}/sub-items/${subItemId}/`)
}

export async function deleteShipment(id) {
  await api.delete(`/shipments/${id}/`)
}

export async function updateShipmentItem(shipmentId, itemId, payload) {
  const { data } = await api.patch(`/shipments/${shipmentId}/items/${itemId}/`, payload)
  return data
}

export async function bulkUpdateShipmentItems(shipmentId, items) {
  const { data } = await api.patch(`/shipments/${shipmentId}/items/bulk-update/`, { items })
  return data
}

export async function deleteShipmentItem(shipmentId, itemId) {
  await api.delete(`/shipments/${shipmentId}/items/${itemId}/`)
}
