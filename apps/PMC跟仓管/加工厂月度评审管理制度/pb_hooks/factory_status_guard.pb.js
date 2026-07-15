// pb_hooks/factory_status_guard.pb.js
// 合作状态(status)只有 sc_manager/admin 能直接改；其他角色只能提报到 status_pending。
onRecordUpdateRequest((e) => {
  const auth = e.requestInfo().auth
  const role = auth ? auth.get('role') : ''
  if (role === 'admin' || role === 'sc_manager') {
    return e.next() // 经理审批：放行
  }

  // 取数据库中的原值
  const original = $app.findRecordById('factories', e.record.id)
  const oldStatus = original.get('status')
  const newStatus = e.record.get('status')

  if (oldStatus !== newStatus) {
    // 非经理擅自改 status：回退，并把意图写入 status_pending
    e.record.set('status', oldStatus)
    e.record.set('status_pending', newStatus)
  }
  return e.next()
}, 'factories')
