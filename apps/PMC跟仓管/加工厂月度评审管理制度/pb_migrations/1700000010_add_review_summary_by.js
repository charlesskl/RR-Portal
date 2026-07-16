// pb_migrations/1700000010_add_review_summary_by.js
// 给 review_meetings 增加 summary_by（谁存档了大盘汇总），供 KPI 钩子归属 summary_done。
migrate((app) => {
  const usersId = app.findCollectionByNameOrId('users').id
  const c = app.findCollectionByNameOrId('review_meetings')
  c.fields.add(new RelationField({ name: 'summary_by', maxSelect: 1, collectionId: usersId }))
  app.save(c)
}, (app) => {
  const c = app.findCollectionByNameOrId('review_meetings')
  const f = c.fields.find((x) => x.name === 'summary_by')
  if (f) c.fields.removeById(f.id)
  app.save(c)
})
