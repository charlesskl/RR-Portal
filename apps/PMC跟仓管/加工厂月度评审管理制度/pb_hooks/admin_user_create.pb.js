// pb_hooks/admin_user_create.pb.js
// 管理员专用接口：创建用户。
// 普通用户(含 role=admin 的业务管理员，非超级管理员)创建 auth 记录时
// 无法设置 verified / emailVisibility 等受保护字段，故用 $app.save() 以超管上下文创建。
// 仅 role=admin 可调用。
routerAdd('POST', '/api/admin/create-user', (e) => {
  const caller = e.auth
  if (!caller || caller.get('role') !== 'admin') {
    throw new ForbiddenError('仅管理员可操作')
  }
  const b = e.requestInfo().body
  if (!b.email || !b.password || !b.role) {
    throw new BadRequestError('缺少 邮箱/密码/角色')
  }
  const col = $app.findCollectionByNameOrId('users')
  const rec = new Record(col)
  rec.set('email', b.email)
  rec.set('emailVisibility', true)
  rec.set('verified', true)
  rec.setPassword(b.password)
  rec.set('display_name', b.display_name || '')
  rec.set('role', b.role)
  if (b.craft) rec.set('craft', b.craft)
  if (Array.isArray(b.crafts)) rec.set('crafts', b.crafts)
  if (b.permissions && typeof b.permissions === 'object') rec.set('permissions', b.permissions)
  $app.save(rec)
  return e.json(200, { ok: true, id: rec.id })
}, $apis.requireAuth())
