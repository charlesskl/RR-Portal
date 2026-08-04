// 将品质编辑权限同步为可供 PocketBase 规则直接校验的布尔字段。
function canEditQuality(record) {
  const role = record.getString('role')
  const defaultsToEdit = !role.startsWith('buyer_')
  const permissions = record.get('permissions') || {}
  return Object.prototype.hasOwnProperty.call(permissions, 'quality.edit')
    ? !!permissions['quality.edit']
    : defaultsToEdit
}

migrate((app) => {
  const users = app.findCollectionByNameOrId('users')
  if (!users.fields.find((field) => field.name === 'quality_edit')) {
    users.fields.add(new BoolField({ name: 'quality_edit', required: false }))
    app.save(users)
  }

  for (const record of app.findAllRecords('users')) {
    record.set('quality_edit', canEditQuality(record))
    app.save(record)
  }

  for (const name of ['quality_5s_checks', 'quality_inspections']) {
    const collection = app.findCollectionByNameOrId(name)
    collection.deleteRule = '@request.auth.quality_edit = true'
    app.save(collection)
  }
}, (app) => {
  for (const name of ['quality_5s_checks', 'quality_inspections']) {
    const collection = app.findCollectionByNameOrId(name)
    collection.deleteRule = '@request.auth.role = "admin"'
    app.save(collection)
  }

  const users = app.findCollectionByNameOrId('users')
  const field = users.fields.find((item) => item.name === 'quality_edit')
  if (field) users.fields.removeById(field.id)
  app.save(users)
})
