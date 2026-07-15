// pb_migrations/1700000030_cert_status_text.js
// 「环评/消防/安监资质」从布尔 has_certs 改为可自由填写的文本 cert_status。
// 新增文本字段，并把旧的 是/否 回填为文本（是→「是」，否→空）。
migrate((app) => {
  const c = app.findCollectionByNameOrId('factories')
  c.fields.add(new TextField({ name: 'cert_status' }))
  app.save(c)
  // 回填旧数据
  const recs = app.findAllRecords('factories')
  for (const r of recs) {
    r.set('cert_status', r.getBool('has_certs') ? '是' : '')
    app.save(r)
  }
}, (app) => {
  const c = app.findCollectionByNameOrId('factories')
  const f = c.fields.find((x) => x.name === 'cert_status')
  if (f) c.fields.removeById(f.id)
  app.save(c)
})
