// Read-only reminder feed. Never infer delivery from how long an order is overdue.
routerAdd('GET', '/api/factory-review/delivery-reminders', e => {
  const helpers = require(__hooks + '/lib/analysis_ai.js')
  let user, scope
  try {
    user = { role: e.auth.getString('role'), permissions: JSON.parse(e.auth.getString('permissions') || 'null'), crafts: JSON.parse(e.auth.getString('crafts') || 'null'), craft: e.auth.getString('craft') }
    scope = helpers.permissions(user)
  } catch (_) { throw new ForbiddenError('权限配置无效') }
  const overrides = user.permissions
  const editable = overrides && Object.prototype.hasOwnProperty.call(overrides, 'orders.edit') ? overrides['orders.edit'] === true : user.role !== 'quality_qc'
  if (!scope.modules.includes('orders') || !editable) throw new ForbiddenError('没有货期登记权限')
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
  const name = e.auth.getString('display_name').trim()
  const matches = name ? e.app.findRecordsByFilter('users', 'display_name = {:name}', '', 2, 0, { name }) : []
  const uniqueName = matches.length === 1 && matches[0].id === e.auth.id
  const ownership = uniqueName ? '(pmc = {:name} || (pmc = "" && created_by = {:owner}))' : '(pmc = "" && created_by = {:owner})'
  const filter = ownership + ' && delivery_date != "" && delivery_date <= {:end} && actual_delivery_date = "" && is_deleted != true && status != "voided" && status != "delivered" && status != "cancelled" && status != "returned"'
  const info = e.requestInfo(), items = [], factoryCache = {}
  let hasMore = false
  for (let offset = 0; ; offset += 500) {
    const rows = e.app.findRecordsByFilter('orders', filter, '-delivery_date,id', 500, offset, { name, owner: e.auth.id, end: today + ' 23:59:59.999Z' })
    for (const r of rows) {
      const factoryId = r.getString('factory')
      let f = factoryCache[factoryId]
      if (!f) { try { f = e.app.findRecordById('factories', factoryId); factoryCache[factoryId] = f } catch (_) { continue } }
      const craft = f.getString('craft'), region = r.getString('region') || f.getString('region') || 'dongguan'
      if (!scope.crafts.includes(craft) || !scope.regions.includes(region) || !e.app.canAccessRecord(r, info, r.collection().viewRule) || !e.app.canAccessRecord(f, info, f.collection().viewRule)) continue
      if (items.length === 500) { hasMore = true; break }
      items.push({ id: r.id, factoryName: f.getString('name'), craft, region, orderNo: r.getString('order_no'), product: r.getString('product'), dueDate: r.getString('delivery_date').slice(0, 10) })
    }
    if (hasMore || rows.length < 500) break
  }
  return e.json(200, { today, items, hasMore, nameAmbiguous: !!name && !uniqueName })
}, $apis.requireAuth('users'))
