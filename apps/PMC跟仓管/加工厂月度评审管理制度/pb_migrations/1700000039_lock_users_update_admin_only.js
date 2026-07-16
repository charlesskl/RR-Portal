// pb_migrations/1700000039_lock_users_update_admin_only.js
// 用户信息仅系统管理员可修改:去掉「本人可改自己记录」,防止普通用户自行改角色提权。
// (改邮箱/改密码/建用户仍走 admin 专用 hook 的 superuser 上下文,不受此规则影响。)
migrate((app) => {
  const c = app.findCollectionByNameOrId('users')
  c.updateRule = '@request.auth.role = "admin"'
  app.save(c)
}, (app) => {
  const c = app.findCollectionByNameOrId('users')
  c.updateRule = '@request.auth.role = "admin" || id = @request.auth.id'
  app.save(c)
})
