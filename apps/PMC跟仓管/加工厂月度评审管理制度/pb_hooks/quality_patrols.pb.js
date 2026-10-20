// Keep the handler self-contained: PocketBase runs it in an isolated JSVM.
function validatePatrol(e) {
  const info = e.requestInfo()
  const auth = info.auth
  // Keep the native superuser bypass while still validating saved business fields.
  if (!info.hasSuperuserAuth()) {
    if (!auth || auth.collection().name !== 'users' || !auth.getBool('quality_edit')) throw new ApiError(403, '没有品质管理编辑权限')
    // The same SQL policy also protects lists, single records, files and realtime.
    // Check both factories so moving an inaccessible record cannot grant access.
    const ids = [e.record.getString('factory'), e.record.original().getString('factory')].filter(Boolean)
    if (!ids.length) throw new ApiError(400, '请选择加工厂')
    for (const id of ids) {
      const allowed = e.app.findRecordsByFilter('quality_patrol_access', 'user_id = {:user} && factory_id = {:factory}', '', 1, 0, { user: auth.id, factory: id })
      if (!allowed.length) throw new ApiError(403, '没有该厂区或部门的品质管理权限')
    }
  }
  if (info.method === 'DELETE') return e.next()
  const contentType = String(info.headers['content_type'] || '').toLowerCase()
  const formEncoded = contentType.indexOf('multipart/form-data') === 0 || contentType.indexOf('application/x-www-form-urlencoded') === 0
  // PB normalizes numeric JSON strings during form loading. Bind the original
  // JSON body to nullable floats as well, rejecting those strings before save.
  if (!formEncoded) {
    const input = new DynamicModel({ staff: nullFloat(), lines: nullFloat(), area: nullFloat(), processing_fee: nullFloat() })
    e.bindBody(input)
  }
  // requestInfo().body contains already-normalized DateTime wrappers. Bind the
  // original strings so an optional blank is accepted but malformed input is not
  // silently cleared by DateField's normalization.
  const dateInput = new DynamicModel({ check_date: '', previous_date: '', planned_date: '', completed_date: '' })
  e.bindBody(dateInput)
  for (const key of ['staff', 'lines', 'area', 'processing_fee']) {
    // PB exposes JSON fields as JSONRaw bytes, not native JS numbers. Decode
    // those bytes without coercing strings, arrays or booleans into numbers.
    const value = JSON.parse(toString(e.record.get(key)) || 'null')
    if (value != null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (['staff', 'lines'].includes(key) && !Number.isSafeInteger(value)))) throw new ApiError(400, '人数、拉线、面积及加工费必须为有效的非负数字，人数和拉线须为安全整数')
  }
  // DateField accepts timestamps. Store UTC calendar days, including API writes,
  // so same-day uniqueness and the previous-date check match the visible dates.
  for (const key of ['check_date', 'previous_date', 'planned_date', 'completed_date']) {
    const value = e.record.getString(key)
    if (!value) {
      const submitted = dateInput[key]
      if (key === 'check_date' || (submitted != null && submitted !== '')) throw new ApiError(400, '请输入有效日期')
      continue
    }
    const parsed = new Date(value.replace(' ', 'T'))
    if (!Number.isFinite(parsed.getTime())) throw new ApiError(400, '请输入有效日期')
    e.record.set(key, parsed.toISOString().slice(0, 10) + ' 00:00:00.000Z')
  }
  const previous = e.record.getString('previous_date')
  if (previous && previous >= e.record.getString('check_date')) throw new ApiError(400, '上次评级日期必须早于检查日期')
  if (e.record.getBool('below_standard') && e.record.getString('grade') !== 'A') throw new ApiError(400, '黄色人数标记仅适用于A级工厂')
  return e.next()
}
onRecordCreateRequest(validatePatrol, 'quality_patrols')
onRecordUpdateRequest(validatePatrol, 'quality_patrols')
onRecordDeleteRequest(validatePatrol, 'quality_patrols')
