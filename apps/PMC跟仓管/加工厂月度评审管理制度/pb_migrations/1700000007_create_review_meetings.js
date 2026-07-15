// pb_migrations/1700000007_create_review_meetings.js
migrate((app) => {
  const usersId = app.findCollectionByNameOrId('users').id
  const c = new Collection({
    type: 'base',
    name: 'review_meetings',
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.role = "admin"',
  })
  c.fields.add(new TextField({ name: 'year_month', required: true }))
  // { [craft]: { factory_count, grade_dist:{A,B,C,D}, avg_score, total_output } }
  c.fields.add(new JSONField({ name: 'summary_by_craft', maxSize: 200000 }))
  c.fields.add(new EditorField({ name: 'optimization_suggestions' }))
  c.fields.add(new JSONField({ name: 'participants', maxSize: 50000 }))
  c.fields.add(new DateField({ name: 'meeting_date' }))
  c.fields.add(new RelationField({ name: 'approved_by', maxSelect: 1, collectionId: usersId }))
  c.fields.add(new SelectField({ name: 'status', required: true, maxSelect: 1, values: ['draft', 'approved'] }))
  c.indexes = ['CREATE UNIQUE INDEX idx_review_month ON review_meetings (year_month)']
  app.save(c)
}, (app) => {
  app.delete(app.findCollectionByNameOrId('review_meetings'))
})
