import api from './auth'

export async function listUsers() {
  const { data } = await api.get('/accounts/users/')
  return data
}

export async function createUser(payload) {
  const { data } = await api.post('/accounts/users/create/', payload)
  return data
}

export async function updateUser(id, payload) {
  const { data } = await api.patch(`/accounts/users/${id}/`, payload)
  return data
}

export async function deleteUser(id) {
  await api.delete(`/accounts/users/${id}/`)
}

export async function resetPassword(id, newPassword) {
  const { data } = await api.post(`/accounts/users/${id}/password/`, { new_password: newPassword })
  return data
}

export async function changeMyPassword(newPassword) {
  const { data } = await api.post('/accounts/users/me/password/', { new_password: newPassword })
  return data
}
