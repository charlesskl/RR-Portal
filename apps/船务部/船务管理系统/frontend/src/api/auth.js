import api from './request'

export async function login(username, password) {
  const { data } = await api.post('/auth/login/', { username, password })
  return data
}

export default api
