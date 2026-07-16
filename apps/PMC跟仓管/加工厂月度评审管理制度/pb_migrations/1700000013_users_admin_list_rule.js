// pb_migrations/1700000013_users_admin_list_rule.js
// 内置 users 默认 list/view 仅限本人(id = @request.auth.id)，导致：
//  - 管理员「用户管理」页只看到自己
//  - KPI 看板 expand=user 取不到他人姓名
// 调整：admin 可列出全部用户；任意登录用户可 view 用户记录(用于 expand 显示姓名)。
// 仍保持 create/update/delete 由 admin 控制(在前端 + 这里收紧 update/delete 到 admin 或本人)。
migrate((app) => {
  const u = app.findCollectionByNameOrId('users')
  u.listRule = '@request.auth.role = "admin"'
  u.viewRule = '@request.auth.id != ""'
  // 创建：仅 admin（用户管理页建号）；更新：admin 或本人；删除：仅 admin
  u.createRule = '@request.auth.role = "admin"'
  u.updateRule = '@request.auth.role = "admin" || id = @request.auth.id'
  u.deleteRule = '@request.auth.role = "admin"'
  app.save(u)
}, (app) => {
  const u = app.findCollectionByNameOrId('users')
  u.listRule = 'id = @request.auth.id'
  u.viewRule = 'id = @request.auth.id'
  u.createRule = ''
  u.updateRule = 'id = @request.auth.id'
  u.deleteRule = 'id = @request.auth.id'
  app.save(u)
})
