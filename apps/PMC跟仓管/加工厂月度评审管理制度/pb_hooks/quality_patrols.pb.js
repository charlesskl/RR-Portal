// Keep the handler self-contained: PocketBase runs it in an isolated JSVM.
function validatePatrol(e) {
  const auth = e.requestInfo().auth
  if (!auth) throw new ApiError(403, '请先登录')
  let permissions = {}
  try { permissions = JSON.parse(auth.getString('permissions') || '{}') || {} } catch (_) {}
  if (permissions['quality.view'] === false || !auth.getBool('quality_edit')) throw new ApiError(403, '没有品质管理编辑权限')
  let crafts = auth.get('crafts')
  if (!Array.isArray(crafts) || !crafts.length) crafts = auth.getString('craft') ? [auth.getString('craft')] : []
  // Check both the original and replacement factory on edits.
  const ids = [e.record.getString('factory'), e.record.original().getString('factory')].filter(Boolean)
  for (const id of ids) {
    const factory = $app.findRecordById('factories', id)
    if (permissions['region.' + (factory.getString('region') || 'dongguan')] === false || (crafts.length && !crafts.includes(factory.getString('craft')))) throw new ApiError(403, '没有该厂区或部门的编辑权限')
  }
  for (const key of ['staff', 'lines', 'area']) {
    const value = JSON.parse(e.record.getString(key) || 'null')
    if (value != null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (key !== 'area' && !Number.isInteger(value)))) throw new ApiError(400, '人数、拉线及面积必须为有效的非负数字，人数和拉线须为整数')
  }
  const previous = e.record.getString('previous_date')
  if (previous && previous >= e.record.getString('check_date')) throw new ApiError(400, '上次评级日期必须早于检查日期')
  if (e.record.getBool('below_standard') && e.record.getString('grade') !== 'A') throw new ApiError(400, '黄色人数标记仅适用于A级工厂')
  return e.next()
}
onRecordCreateRequest(validatePatrol, 'quality_patrols')
onRecordUpdateRequest(validatePatrol, 'quality_patrols')
onRecordDeleteRequest(validatePatrol, 'quality_patrols')
