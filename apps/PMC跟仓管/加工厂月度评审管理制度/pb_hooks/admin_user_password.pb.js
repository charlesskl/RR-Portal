// pb_hooks/admin_user_password.pb.js
// 管理员专用接口：重置某用户密码(超管上下文,绕过 oldPassword 限制)。仅 role=admin 可调用。
routerAdd('POST', '/api/admin/set-user-password', (e) => {
  const caller = e.auth
  if (!caller || caller.get('role') !== 'admin') {
    throw new ForbiddenError('仅管理员可操作')
  }
  const b = e.requestInfo().body
  const userId = b.userId
  const password = b.password
  if (!userId || !password) throw new BadRequestError('缺少 userId 或 password')
  if (String(password).length < 8) throw new BadRequestError('密码至少 8 位')
  const rec = $app.findRecordById('users', userId)
  rec.setPassword(password)
  $app.save(rec)
  return e.json(200, { ok: true })
}, $apis.requireAuth())
