// pb_migrations/1700000009_seed_score_templates.js
// 注入默认通用 70 分评分项（工艺专项 30 分由 admin 在后台配置）
migrate((app) => {
  const col = app.findCollectionByNameOrId('score_templates')
  const seeds = [
    { name: '证件齐全有效', module: 'qualification', max_score: 10, scoring_role: 'buyer', sort_order: 1 },
    { name: '交期准时率', module: 'delivery', max_score: 20, scoring_role: 'buyer', sort_order: 2 },
    { name: '整改响应配合度', module: 'cooperation', max_score: 10, scoring_role: 'buyer', sort_order: 3 },
    { name: '月度综合不良率', module: 'defect_rate', max_score: 15, scoring_role: 'quality_qc', sort_order: 4 },
    { name: '制程检验通过率', module: 'process', max_score: 10, scoring_role: 'quality_qc', sort_order: 5 },
    { name: '5S现场评分', module: '5s', max_score: 5, scoring_role: 'quality_qc', sort_order: 6 },
  ]
  for (const s of seeds) {
    const rec = new Record(col)
    rec.set('name', s.name)
    rec.set('module', s.module)
    rec.set('max_score', s.max_score)
    rec.set('scoring_role', s.scoring_role)
    rec.set('craft_filter', '')
    rec.set('is_active', true)
    rec.set('sort_order', s.sort_order)
    app.save(rec)
  }
}, (app) => {
  const recs = app.findRecordsByFilter('score_templates', 'craft_filter = ""', '', 0, 0)
  for (const r of recs) app.delete(r)
})
