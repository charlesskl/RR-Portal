onRecordCreateRequest((e) => {
  const auth = e.requestInfo().auth
  const role = auth ? auth.get('role') : ''
  if (role !== 'finance_cost' && role !== 'admin') {
    throw new ApiError(403, '仅财务成本会计可录入/修改加工产值')
  }
  return e.next()
}, 'monthly_output')

onRecordUpdateRequest((e) => {
  const auth = e.requestInfo().auth
  const role = auth ? auth.get('role') : ''
  if (role !== 'finance_cost' && role !== 'admin') {
    throw new ApiError(403, '仅财务成本会计可录入/修改加工产值')
  }
  return e.next()
}, 'monthly_output')
