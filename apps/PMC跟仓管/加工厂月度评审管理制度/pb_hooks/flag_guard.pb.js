// pb_hooks/flag_guard.pb.js
// 红黄牌(flag)的最终生效仅 sc_manager/admin；品质QC 可写 flag_reason 出依据但不能定级。
onRecordUpdateRequest((e) => {
  const auth = e.requestInfo().auth
  const role = auth ? auth.get('role') : ''
  if (role === 'sc_manager' || role === 'admin') return e.next()

  const original = $app.findRecordById('monthly_scores', e.record.id)
  const oldFlag = original.get('flag')
  const newFlag = e.record.get('flag')
  if (oldFlag !== newFlag) {
    e.record.set('flag', oldFlag) // 非经理不得改 flag，回退
  }
  return e.next()
}, 'monthly_scores')
