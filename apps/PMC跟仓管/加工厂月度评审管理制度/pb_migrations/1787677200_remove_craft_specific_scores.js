// 评分模板统一为 100 分：取消部门专项 15 分，分别增加 IP 管控 10 分、制程检验通过率 5 分。
function setModuleScore(app, module, score) {
  const records = app.findRecordsByFilter('score_templates', 'module = {:module}', '', 0, 0, { module })
  for (const record of records) {
    record.set('max_score', score)
    app.save(record)
  }
}

const specialties = [
  ['毛绒专项-车缝牢度', 'sewing'],
  ['装配专项-功能良率', 'assembly'],
  ['喷油专项-色差附着力', 'painting'],
  ['注塑专项-尺寸稳定性', 'injection'],
]

migrate((app) => {
  setModuleScore(app, 'ip_control', 15)
  setModuleScore(app, 'process', 10)
  const records = app.findRecordsByFilter('score_templates', 'module = "craft_specific" || craft_filter != ""', '', 0, 0)
  for (const record of records) app.delete(record)
}, (app) => {
  setModuleScore(app, 'ip_control', 5)
  setModuleScore(app, 'process', 5)
  const collection = app.findCollectionByNameOrId('score_templates')
  for (const [name, craft] of specialties) {
    const record = new Record(collection)
    record.set('name', name)
    record.set('module', 'craft_specific')
    record.set('max_score', 15)
    record.set('scoring_role', 'quality_qc')
    record.set('craft_filter', craft)
    record.set('is_active', true)
    record.set('sort_order', 10)
    app.save(record)
  }
})
