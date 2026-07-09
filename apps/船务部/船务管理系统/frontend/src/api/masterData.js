import api from './auth'

export async function listProductMappings() {
  const { data } = await api.get('/master-data/product-mappings/')
  return data.results || data
}

export async function listFactoryMappings() {
  const { data } = await api.get('/master-data/factory-mappings/')
  return data.results || data
}

export async function listCustomers() {
  const { data } = await api.get('/master-data/customers/')
  return data.results || data
}
