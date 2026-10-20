// Server-only quota ledger: no prompts, business facts, API keys or AI responses.
migrate(app => {
  const c = new Collection({name:'analysis_ai_usage', type:'base'})
  c.fields.add(new RelationField({name:'owner', required:true, maxSelect:1, collectionId:app.findCollectionByNameOrId('users').id, cascadeDelete:true}))
  c.fields.add(new TextField({name:'minute_key', required:true, max:80}))
  c.fields.add(new DateField({name:'started_at', required:true}))
  c.indexes = ['CREATE UNIQUE INDEX idx_analysis_ai_minute ON analysis_ai_usage (minute_key)', 'CREATE INDEX idx_analysis_ai_owner_date ON analysis_ai_usage (owner, started_at)']
  app.save(c)
}, app => app.delete(app.findCollectionByNameOrId('analysis_ai_usage')))
