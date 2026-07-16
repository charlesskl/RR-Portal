// pb_hooks/kpi_logger.pb.js
// 在关键业务动作成功后写一条 kpi_logs，并按 SLA 截止日判定是否按时。
// SLA（默认）：产值=每月5日, 评分提交=每月4日, 汇总=每月6日（针对 target_month 的「次月」该日）。
//
// PB 0.23 JSVM 坑：
// 1) 钩子体内不能调用自定义命名函数（即使传纯数据也会崩溃返回400），逻辑必须完全内联。
// 2) 完成时刻用 new Date().toISOString()（动作成功即完成时刻）；
//    e.record.get('updated') 在 After*Success 里 '' 拼接会得到 "[object Object]"。
// 3) 按 (factory, target_month, action_type) 去重，避免评分单被二次更新时重复记 KPI。

// 产值录入（finance_cost） SLA 次月5日
onRecordAfterCreateSuccess((e) => {
  const uid = e.record.get('entered_by')
  const tm = e.record.get('year_month')
  const fid = e.record.get('factory')
  if (uid && tm) {
    const dup = $app.findRecordsByFilter('kpi_logs',
      'action_type = "output_entered" && factory = {:f} && target_month = {:m}', '', 1, 0, { f: fid, m: tm })
    if (!dup.length) {
      const parts = ('' + tm).split('-')
      const y = parseInt(parts[0], 10), m = parseInt(parts[1], 10)
      const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1
      const deadline = ny + '-' + ('0' + nm).slice(-2) + '-05'
      const completed = new Date().toISOString()
      const col = $app.findCollectionByNameOrId('kpi_logs')
      const rec = new Record(col)
      rec.set('user', uid)
      rec.set('action_type', 'output_entered')
      rec.set('target_month', tm)
      rec.set('factory', fid)
      rec.set('deadline', deadline)
      rec.set('completed_at', completed)
      rec.set('is_on_time', completed.slice(0, 10) <= deadline)
      $app.save(rec)
    }
  }
}, 'monthly_output')

// 评分提交（status=submitted） SLA 次月4日
onRecordAfterUpdateSuccess((e) => {
  if (e.record.get('status') === 'submitted') {
    const uid = e.record.get('submitted_by')
    const tm = e.record.get('year_month')
    const fid = e.record.get('factory')
    if (uid && tm) {
      const dup = $app.findRecordsByFilter('kpi_logs',
        'action_type = "score_submitted" && factory = {:f} && target_month = {:m}', '', 1, 0, { f: fid, m: tm })
      if (!dup.length) {
        const parts = ('' + tm).split('-')
        const y = parseInt(parts[0], 10), m = parseInt(parts[1], 10)
        const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1
        const deadline = ny + '-' + ('0' + nm).slice(-2) + '-04'
        const completed = new Date().toISOString()
        const col = $app.findCollectionByNameOrId('kpi_logs')
        const rec = new Record(col)
        rec.set('user', uid)
        rec.set('action_type', 'score_submitted')
        rec.set('target_month', tm)
        rec.set('factory', fid)
        rec.set('deadline', deadline)
        rec.set('completed_at', completed)
        rec.set('is_on_time', completed.slice(0, 10) <= deadline)
        $app.save(rec)
      }
    }
  }
}, 'monthly_scores')

// 汇总存档（review_meetings 有 summary_by_craft） SLA 次月6日（按 month 去重）
onRecordAfterUpdateSuccess((e) => {
  const summary = e.record.get('summary_by_craft')
  const hasSummary = summary && summary.length
  if (hasSummary) {
    const uid = e.record.get('summary_by')
    const tm = e.record.get('year_month')
    if (uid && tm) {
      const dup = $app.findRecordsByFilter('kpi_logs',
        'action_type = "summary_done" && target_month = {:m}', '', 1, 0, { m: tm })
      if (!dup.length) {
        const parts = ('' + tm).split('-')
        const y = parseInt(parts[0], 10), m = parseInt(parts[1], 10)
        const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1
        const deadline = ny + '-' + ('0' + nm).slice(-2) + '-06'
        const completed = new Date().toISOString()
        const col = $app.findCollectionByNameOrId('kpi_logs')
        const rec = new Record(col)
        rec.set('user', uid)
        rec.set('action_type', 'summary_done')
        rec.set('target_month', tm)
        rec.set('deadline', deadline)
        rec.set('completed_at', completed)
        rec.set('is_on_time', completed.slice(0, 10) <= deadline)
        $app.save(rec)
      }
    }
  }
}, 'review_meetings')
