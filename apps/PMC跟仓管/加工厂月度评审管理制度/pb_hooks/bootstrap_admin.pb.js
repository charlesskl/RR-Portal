routerAdd('GET', '/api/factory-review/health', (e) => {
  const email = String($os.getenv('FACTORY_REVIEW_ADMIN_EMAIL') || '').trim()
  const password = String($os.getenv('FACTORY_REVIEW_ADMIN_PASSWORD') || '')
  if (!email || password.length < 12) {
    return e.json(503, { status: 'error', message: 'initial admin credentials are not configured' })
  }

  try {
    e.app.findAuthRecordByEmail('users', email)
    return e.json(200, { status: 'ok' })
  } catch (_) {
    // The account is created only on the first boot of an empty data directory.
  }

  const record = new Record(e.app.findCollectionByNameOrId('users'))
  record.set('email', email)
  record.set('emailVisibility', true)
  record.set('verified', true)
  record.setPassword(password)
  record.set('display_name', '系统管理员')
  record.set('role', 'admin')
  e.app.save(record)
  return e.json(200, { status: 'ok' })
})
