// pb_migrations/1700000011_add_kpi_factory.js
// 给 kpi_logs 增加 factory（可空），用于按 (factory, target_month, action_type) 去重，
// 防止评分单被二次更新（如红黄牌审批）时重复记 score_submitted。
migrate((app) => {
  const factoriesId = app.findCollectionByNameOrId('factories').id
  const c = app.findCollectionByNameOrId('kpi_logs')
  c.fields.add(new RelationField({ name: 'factory', maxSelect: 1, collectionId: factoriesId }))
  app.save(c)
}, (app) => {
  const c = app.findCollectionByNameOrId('kpi_logs')
  const f = c.fields.find((x) => x.name === 'factory')
  if (f) c.fields.removeById(f.id)
  app.save(c)
})
