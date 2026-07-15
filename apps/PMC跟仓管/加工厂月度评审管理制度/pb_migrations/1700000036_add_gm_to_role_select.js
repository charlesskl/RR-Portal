// pb_migrations/1700000036_add_gm_to_role_select.js
// users.role 选项新增「总经理 gm」。
migrate((app) => {
  const c = app.findCollectionByNameOrId('users')
  const f = c.fields.find((x) => x.name === 'role')
  if (f && f.values.indexOf('gm') === -1) {
    f.values = ['admin', 'gm', 'sc_manager', 'buyer_injection', 'buyer_painting', 'buyer_assembly', 'buyer_sewing', 'finance_cost', 'finance_mgr', 'quality_qc', 'sc_clerk']
    app.save(c)
  }
}, (app) => {
  const c = app.findCollectionByNameOrId('users')
  const f = c.fields.find((x) => x.name === 'role')
  if (f) {
    f.values = f.values.filter((v) => v !== 'gm')
    app.save(c)
  }
})
