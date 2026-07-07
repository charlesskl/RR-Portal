import { apiPath } from './request'

export function getDownloadUrl(shipmentId) {
  return apiPath(`/generator/${shipmentId}/generate/`)
}
