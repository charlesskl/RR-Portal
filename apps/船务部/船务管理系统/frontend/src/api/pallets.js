import api from './auth'

export async function exportPalletReport(payload) {
  const resp = await api.post('/pallets/export/', payload, { responseType: 'blob' })
  return resp.data
}
