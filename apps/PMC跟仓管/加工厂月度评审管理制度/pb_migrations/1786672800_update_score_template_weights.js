// 调整月度评审权重：通用 85 分 + 对应部门专项 15 分 = 100 分。
function setModuleScore(app, module, score) {
  const records = app.findRecordsByFilter('score_templates', 'module = {:module}', '', 0, 0, { module })
  for (const record of records) {
    record.set('max_score', score)
    app.save(record)
  }
}

migrate((app) => {
  setModuleScore(app, 'defect_rate', 20)
  setModuleScore(app, 'process', 5)
  setModuleScore(app, '5s', 20)
  setModuleScore(app, 'craft_specific', 15)
}, (app) => {
  setModuleScore(app, 'defect_rate', 15)
  setModuleScore(app, 'process', 10)
  setModuleScore(app, '5s', 5)
  setModuleScore(app, 'craft_specific', 30)
})
