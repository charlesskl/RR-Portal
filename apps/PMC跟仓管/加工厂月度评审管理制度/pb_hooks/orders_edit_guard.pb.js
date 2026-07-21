function requireOrdersEdit(e) {
  const auth = e.requestInfo().auth
  if (!auth) throw new ApiError(403, '当前账号没有货期管理编辑权限')
  let permissions = {}
  const rawPermissions = auth.getString('permissions')
  if (rawPermissions) {
    try {
      const parsed = JSON.parse(rawPermissions)
      permissions = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch {
      permissions = {}
    }
  }
  if (permissions['orders.edit'] !== undefined) {
    if (permissions['orders.edit'] !== true) {
      throw new ApiError(403, '当前账号没有货期管理编辑权限')
    }
    return e.next()
  }

  if (auth.get('role') === 'quality_qc') {
    throw new ApiError(403, '当前账号没有货期管理编辑权限')
  }
  return e.next()
}

onRecordCreateRequest(requireOrdersEdit, 'orders')
onRecordUpdateRequest(requireOrdersEdit, 'orders')
onRecordDeleteRequest(requireOrdersEdit, 'orders')
