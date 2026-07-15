// pb_migrations/1700000042_orders_qc_readonly.js
// 货期管理(orders)品质QC只读:create/update 排除 quality_qc(仍可 list/view)。
migrate((app) => {
  const c = app.findCollectionByNameOrId('orders')
  c.createRule = '@request.auth.id != "" && @request.auth.role != "quality_qc"'
  c.updateRule = '@request.auth.id != "" && @request.auth.role != "quality_qc"'
  app.save(c)
}, (app) => {
  const c = app.findCollectionByNameOrId('orders')
  c.createRule = '@request.auth.id != ""'
  c.updateRule = '@request.auth.id != ""'
  app.save(c)
})
