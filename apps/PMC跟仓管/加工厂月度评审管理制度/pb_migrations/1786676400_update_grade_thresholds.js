// 按新评级线重算历史月度评分：A >= 90，B >= 70，C >= 50，D < 50。
migrate((app) => {
  const records = app.findRecordsByFilter('monthly_scores', 'id != ""', '', 0, 0)
  for (const record of records) {
    const total = Number(record.get('total_score')) || 0
    const grade = total >= 90 ? 'A' : total >= 70 ? 'B' : total >= 50 ? 'C' : 'D'
    record.set('grade', grade)
    app.save(record)
  }
}, (app) => {
  const records = app.findRecordsByFilter('monthly_scores', 'id != ""', '', 0, 0)
  for (const record of records) {
    const total = Number(record.get('total_score')) || 0
    const grade = total >= 90 ? 'A' : total >= 80 ? 'B' : total >= 70 ? 'C' : 'D'
    record.set('grade', grade)
    app.save(record)
  }
})
