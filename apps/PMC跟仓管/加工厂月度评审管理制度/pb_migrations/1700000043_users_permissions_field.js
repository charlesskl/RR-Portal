// pb_migrations/1700000043_users_permissions_field.js
// 给 users 增加 permissions(JSON) 字段：逐账号权限覆盖项（相对角色默认值的差异）。
// 为空/不存在 = 完全按角色默认。幂等：已存在则跳过。
migrate((app) => {
  const users = app.findCollectionByNameOrId('users')
  if (!users.fields.find((x) => x.name === 'permissions')) {
    users.fields.add(new JSONField({ name: 'permissions', required: false, maxSize: 20000 }))
    app.save(users)
  }
}, (app) => {
  const users = app.findCollectionByNameOrId('users')
  const f = users.fields.find((x) => x.name === 'permissions')
  if (f) { users.fields.removeById(f.id); app.save(users) }
})
