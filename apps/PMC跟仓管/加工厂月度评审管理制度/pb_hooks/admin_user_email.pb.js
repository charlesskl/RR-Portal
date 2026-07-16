// pb_hooks/admin_user_email.pb.js
// 管理员专用接口：设置某用户的邮箱（并设为可见）。
// 普通用户改邮箱受 PocketBase 保护，这里用 $app.save() 以超管上下文保存绕过该限制。
// 仅 role=admin 可调用。
routerAdd('POST', '/api/admin/set-user-email', (e) => {
  const caller = e.auth
  if (!caller || caller.get('role') !== 'admin') {
    throw new ForbiddenError('仅管理员可操作')
  }
  const body = e.requestInfo().body
  const userId = body.userId
  const email = body.email
  if (!userId || !email) {
    throw new BadRequestError('缺少 userId 或 email')
  }
  const rec = $app.findRecordById('users', userId)
  rec.set('email', email)
  rec.set('emailVisibility', true)
  $app.save(rec)
  return e.json(200, { ok: true, email: email })
}, $apis.requireAuth())
