// Personal follow-up state stores only an opaque issue key, not business evidence.
migrate((app) => {
  const owner = '@request.auth.id != "" && @request.auth.collectionName = "users" && owner = @request.auth.id'
  const c = new Collection({ name: 'analysis_followups', type: 'base', listRule: owner, viewRule: owner,
    createRule: owner, updateRule: owner + ' && (@request.body.owner:isset = false || @request.body.owner = owner) && (@request.body.issue_key:isset = false || @request.body.issue_key = issue_key)', deleteRule: owner })
  c.fields.add(new RelationField({ name: 'owner', required: true, maxSelect: 1, collectionId: app.findCollectionByNameOrId('users').id, cascadeDelete: true }))
  c.fields.add(new TextField({ name: 'issue_key', required: true, max: 250 }))
  c.fields.add(new SelectField({ name: 'status', required: true, maxSelect: 1, values: ['pending', 'following', 'resolved'] }))
  c.indexes = ['CREATE UNIQUE INDEX idx_analysis_followup_owner_key ON analysis_followups (owner, issue_key)']
  app.save(c)
}, (app) => app.delete(app.findCollectionByNameOrId('analysis_followups')))
