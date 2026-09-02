// pb_hooks/integration_api.pb.js
// 对车缝核价对比系统的只读集成 API（规范：API接口规范 V1.0）。
// 三个接口均要求 Authorization: Bearer <key>，key 从环境变量 INTEGRATION_API_KEY 读取；
// key 未配置或比对失败统一返回 401 {"code":401,"message":"接口密钥无效","data":{}}。
// 注意（JSVM 限制）：handler 必须自包含，不能引用文件顶层函数，
// 因此公共辅助函数在每个 handler 体内各定义一份。

routerAdd('GET', '/api/integration/v1/health', (e) => {
  const checkKey = (request) => {
    const expected = String($os.getenv('INTEGRATION_API_KEY') || '')
    if (!expected) return false
    const header = String(request.header.get('Authorization') || '')
    const prefix = 'Bearer '
    if (header.slice(0, prefix.length) !== prefix) return false
    const actual = header.slice(prefix.length)
    if (actual.length !== expected.length) return false
    let diff = 0
    for (let i = 0; i < actual.length; i++) {
      diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i)
    }
    return diff === 0
  }

  if (!checkKey(e.request)) {
    return e.json(401, { code: 401, message: '接口密钥无效', data: {} })
  }
  return e.json(200, { status: 'ok', service: 'factory-review-integration', version: 'v1' })
})

routerAdd('GET', '/api/integration/v1/factories', (e) => {
  // ---- 公共辅助（自包含） ----
  const checkKey = (request) => {
    const expected = String($os.getenv('INTEGRATION_API_KEY') || '')
    if (!expected) return false
    const header = String(request.header.get('Authorization') || '')
    const prefix = 'Bearer '
    if (header.slice(0, prefix.length) !== prefix) return false
    const actual = header.slice(prefix.length)
    if (actual.length !== expected.length) return false
    let diff = 0
    for (let i = 0; i < actual.length; i++) {
      diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i)
    }
    return diff === 0
  }

  // RFC3339（T 分隔）入参 → PB 存储格式（空格分隔，UTC）
  const toPbDateTime = (value) => {
    if (!value) return null
    const parsed = new Date(value)
    if (isNaN(parsed.getTime())) return false
    return parsed.toISOString().replace('T', ' ')
  }

  // PB 存储格式（空格分隔）→ RFC3339（T 分隔）
  const toRfc3339 = (value) => {
    if (!value) return null
    return String(value).replace(' ', 'T')
  }

  const nullIfEmpty = (value) => {
    if (value === null || value === undefined || value === '') return null
    return value
  }

  const badRequest = (message) => e.json(400, { code: 400, message: message, data: {} })

  // ---- 鉴权 ----
  if (!checkKey(e.request)) {
    return e.json(401, { code: 401, message: '接口密钥无效', data: {} })
  }

  // ---- 参数解析 ----
  const query = e.requestInfo().query || {}
  const updatedAfter = query.updated_after ? String(query.updated_after) : ''
  const cursorId = query.cursor_id ? String(query.cursor_id) : ''

  if (cursorId && !updatedAfter) {
    return badRequest('参数无效：cursor_id 必须与 updated_after 同时传入')
  }

  let pageSize = 100
  if (query.page_size !== undefined && query.page_size !== '') {
    pageSize = parseInt(String(query.page_size), 10)
    if (isNaN(pageSize) || pageSize < 1) {
      return badRequest('参数无效：page_size 必须为 1-200 的整数')
    }
    if (pageSize > 200) pageSize = 200
  }

  let cursorUpdated = null
  if (updatedAfter) {
    cursorUpdated = toPbDateTime(updatedAfter)
    if (cursorUpdated === false) {
      return badRequest('参数无效：updated_after 必须为 RFC3339 时间格式')
    }
  }

  // ---- 查询：仅 craft=sewing 的加工厂 ----
  let filter = 'craft = {:craft}'
  const params = { craft: 'sewing' }
  if (cursorUpdated) {
    filter += ' && (updated > {:u} || (updated = {:u} && id > {:i}))'
    params.u = cursorUpdated
    params.i = cursorId || ''
  }

  const records = e.app.findRecordsByFilter('factories', filter, '+updated,+id', pageSize + 1, 0, params)
  const hasMore = records.length > pageSize
  const page = hasMore ? records.slice(0, pageSize) : records

  const data = []
  for (const rec of page) {
    const status = rec.getString('status') === 'active' ? 'active' : 'inactive'
    data.push({
      id: rec.id,
      name: rec.getString('name'),
      craft: 'sewing',
      contact_person: nullIfEmpty(rec.getString('contact_person')),
      contact_phone: nullIfEmpty(rec.getString('contact_phone')),
      address: nullIfEmpty(rec.getString('address')),
      equipment_qty: nullIfEmpty(rec.get('equipment_qty')),
      staff_count: nullIfEmpty(rec.get('staff_count')),
      monthly_capacity: nullIfEmpty(rec.get('monthly_capacity')),
      cert_status: nullIfEmpty(rec.getString('cert_status')),
      region: nullIfEmpty(rec.getString('region')),
      status: status,
      created_at: toRfc3339(rec.getString('created')),
      updated_at: toRfc3339(rec.getString('updated')),
      is_deleted: rec.getBool('is_deleted'),
      deleted_at: toRfc3339(rec.getString('deleted_at')),
    })
  }

  // ---- 游标 ----
  let nextUpdatedAfter = updatedAfter || null
  let nextCursorId = cursorId || null
  if (page.length > 0) {
    const last = page[page.length - 1]
    nextUpdatedAfter = toRfc3339(last.getString('updated'))
    nextCursorId = last.id
  }

  return e.json(200, {
    data: data,
    next_updated_after: nextUpdatedAfter,
    next_cursor_id: nextCursorId,
    has_more: hasMore,
    page_size: pageSize,
    sort: 'updated_at,id',
  })
})

routerAdd('GET', '/api/integration/v1/orders', (e) => {
  // ---- 公共辅助（自包含） ----
  const checkKey = (request) => {
    const expected = String($os.getenv('INTEGRATION_API_KEY') || '')
    if (!expected) return false
    const header = String(request.header.get('Authorization') || '')
    const prefix = 'Bearer '
    if (header.slice(0, prefix.length) !== prefix) return false
    const actual = header.slice(prefix.length)
    if (actual.length !== expected.length) return false
    let diff = 0
    for (let i = 0; i < actual.length; i++) {
      diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i)
    }
    return diff === 0
  }

  const toPbDateTime = (value) => {
    if (!value) return null
    const parsed = new Date(value)
    if (isNaN(parsed.getTime())) return false
    return parsed.toISOString().replace('T', ' ')
  }

  const toRfc3339 = (value) => {
    if (!value) return null
    return String(value).replace(' ', 'T')
  }

  // PB 日期字段 → YYYY-MM-DD
  const toDateOnly = (value) => {
    if (!value) return null
    return String(value).slice(0, 10)
  }

  const nullIfEmpty = (value) => {
    if (value === null || value === undefined || value === '') return null
    return value
  }

  const badRequest = (message) => e.json(400, { code: 400, message: message, data: {} })

  const emptyPage = (pageSize, updatedAfter, cursorId) => e.json(200, {
    data: [],
    next_updated_after: updatedAfter || null,
    next_cursor_id: cursorId || null,
    has_more: false,
    page_size: pageSize,
    sort: 'updated_at,id',
  })

  // ---- 鉴权 ----
  if (!checkKey(e.request)) {
    return e.json(401, { code: 401, message: '接口密钥无效', data: {} })
  }

  // ---- 参数解析 ----
  const query = e.requestInfo().query || {}
  const updatedAfter = query.updated_after ? String(query.updated_after) : ''
  const cursorId = query.cursor_id ? String(query.cursor_id) : ''

  if (cursorId && !updatedAfter) {
    return badRequest('参数无效：cursor_id 必须与 updated_after 同时传入')
  }

  let pageSize = 100
  if (query.page_size !== undefined && query.page_size !== '') {
    pageSize = parseInt(String(query.page_size), 10)
    if (isNaN(pageSize) || pageSize < 1) {
      return badRequest('参数无效：page_size 必须为 1-200 的整数')
    }
    if (pageSize > 200) pageSize = 200
  }

  let cursorUpdated = null
  if (updatedAfter) {
    cursorUpdated = toPbDateTime(updatedAfter)
    if (cursorUpdated === false) {
      return badRequest('参数无效：updated_after 必须为 RFC3339 时间格式')
    }
  }

  // ---- sewing 加工厂 id 全集（含已软删除的加工厂，其订单仍需返回） ----
  const sewingFactories = e.app.findRecordsByFilter('factories', 'craft = {:craft}', '', 0, 0, { craft: 'sewing' })
  if (sewingFactories.length === 0) {
    return emptyPage(pageSize, updatedAfter, cursorId)
  }

  // PB record filter 不支持 IN，用参数化的 OR 链
  const orParts = []
  const params = {}
  for (let i = 0; i < sewingFactories.length; i++) {
    const key = 'f' + i
    orParts.push('factory.id = {:' + key + '}')
    params[key] = sewingFactories[i].id
  }

  // ---- 查询 ----
  let filter = '(' + orParts.join(' || ') + ')'
  if (cursorUpdated) {
    filter += ' && (updated > {:u} || (updated = {:u} && id > {:i}))'
    params.u = cursorUpdated
    params.i = cursorId || ''
  }

  const records = e.app.findRecordsByFilter('orders', filter, '+updated,+id', pageSize + 1, 0, params)
  const hasMore = records.length > pageSize
  const page = hasMore ? records.slice(0, pageSize) : records

  const data = []
  for (const rec of page) {
    const status = rec.getString('status')
    const updatedAt = toRfc3339(rec.getString('updated'))
    const deletedAt = rec.getString('deleted_at')
    // is_deleted：字段为 true 或状态为 voided 均视为作废
    const isDeleted = rec.getBool('is_deleted') || status === 'voided'

    // price_effective_at 为空时回退为记录最后更新时间
    let priceEffectiveAt = rec.getString('price_effective_at')
    priceEffectiveAt = priceEffectiveAt ? toRfc3339(priceEffectiveAt) : updatedAt

    data.push({
      id: rec.id,
      order_no: rec.getString('order_no'),
      factory_id: rec.getString('factory'),
      item_no: nullIfEmpty(rec.getString('item_no')),
      product: nullIfEmpty(rec.getString('product')),
      quantity: nullIfEmpty(rec.get('quantity')),
      unit: rec.getString('unit') || '件',
      process: nullIfEmpty(rec.getString('process')),
      process_category: nullIfEmpty(rec.getString('process_category')),
      quote_labor_price: nullIfEmpty(rec.get('quote_labor_price')),
      supplier_price: nullIfEmpty(rec.get('supplier_price')),
      unit_price: nullIfEmpty(rec.get('unit_price')),
      unit_price_cny_tax: nullIfEmpty(rec.get('unit_price_cny_tax')),
      tax_point: nullIfEmpty(rec.get('tax_point')),
      price_effective_at: priceEffectiveAt,
      order_date: toDateOnly(rec.getString('order_date')),
      delivery_date: toDateOnly(rec.getString('delivery_date')),
      actual_delivery_date: toDateOnly(rec.getString('actual_delivery_date')),
      status: status,
      progress: rec.get('progress') || 0,
      delay_days: rec.get('delay_days') || 0,
      delay_reason: nullIfEmpty(rec.getString('delay_reason')),
      notes: nullIfEmpty(rec.getString('notes')),
      created_at: toRfc3339(rec.getString('created')),
      updated_at: updatedAt,
      is_deleted: isDeleted,
      // is_deleted 为 true 而 deleted_at 为空时，用 updated_at 兜底
      deleted_at: deletedAt ? toRfc3339(deletedAt) : (isDeleted ? updatedAt : null),
    })
  }

  // ---- 游标 ----
  let nextUpdatedAfter = updatedAfter || null
  let nextCursorId = cursorId || null
  if (page.length > 0) {
    const last = page[page.length - 1]
    nextUpdatedAfter = toRfc3339(last.getString('updated'))
    nextCursorId = last.id
  }

  return e.json(200, {
    data: data,
    next_updated_after: nextUpdatedAfter,
    next_cursor_id: nextCursorId,
    has_more: hasMore,
    page_size: pageSize,
    sort: 'updated_at,id',
  })
})
