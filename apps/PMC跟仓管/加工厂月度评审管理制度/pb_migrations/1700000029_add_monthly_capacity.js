// pb_migrations/1700000029_add_monthly_capacity.js
// 新增「月产能」字段（工厂每月产能，数值）。与「年生意额 annual_revenue」分开。
migrate((app) => {
  const c = app.findCollectionByNameOrId('factories')
  c.fields.add(new NumberField({ name: 'monthly_capacity' }))
  app.save(c)
}, (app) => {
  const c = app.findCollectionByNameOrId('factories')
  const f = c.fields.find((x) => x.name === 'monthly_capacity')
  if (f) c.fields.removeById(f.id)
  app.save(c)
})
