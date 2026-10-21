// Operational probe only. Mount as the only hook in an isolated, disposable PB container.
// Never mount production pb_data/migrations. No raw upstream body/error may be returned or logged.
routerAdd('POST', '/probe', e => {
  const started = Date.now()
  const finish = (success, status, model) => e.json(200, {success, status, model, elapsedMs: Date.now() - started})
  const nonce = $os.getenv('AI_PROBE_NONCE')
  if ($os.getenv('AI_PROBE_ALLOW_ONCE') !== 'true' || nonce.length < 32 || e.request.header.get('X-Probe-Nonce') !== nonce) return finish(false, 'probe_not_authorized', '')
  const provider = $os.getenv('FACTORY_REVIEW_AI_PROVIDER')
  const model = $os.getenv('FACTORY_REVIEW_AI_MODEL')
  const base = $os.getenv('FACTORY_REVIEW_AI_BASE_URL').replace(/\/$/, '')
  const apiKey = $os.getenv('FACTORY_REVIEW_AI_API_KEY')
  // Pins are deliberate: this probe is approved only for the existing company Beijing Qwen service.
  if (provider !== 'qwen' || model !== 'qwen3.8-max' || base !== 'https://dashscope.aliyuncs.com/compatible-mode/v1' || !apiKey) return finish(false, 'configuration_mismatch', '')
  try {
    e.app.db().newQuery('CREATE TABLE IF NOT EXISTS "_ai_single_probe" ("slot" INTEGER PRIMARY KEY CHECK ("slot" = 1))').execute()
    e.app.db().newQuery('INSERT INTO "_ai_single_probe" ("slot") VALUES (1)').execute()
  } catch (_) { return finish(false, 'probe_already_used_or_local_db_error', model) }
  const helpers = require('/pb/pb_hooks/lib/analysis_ai.js')
  const evidence = [{id:'orders:synthetic000001',factory:'F1',type:'订单',shortened:false,fields:{delivery_date:'2026-10-01',actual_delivery_date:'',status:'delayed',quantity:100,delay_reason:'纯合成测试记录：交付状态待核实，不代表任何真实工厂。'}}]
  const dataset = {start:'2026-10-01',end:'2026-10-02',coverage:[{source:'订单',status:'已读取',count:1}],notes:'仅一条完全合成的验收数据，不读取数据库业务记录。',evidence}
  const payload = helpers.request(model, dataset, '请仅依据这一条合成订单指出需要核实的交付状态，返回一条有证据引用的发现；不要推断产能或真实工厂情况。', provider)
  let response
  try {
    response = $http.send({url:base + '/chat/completions',method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer ' + apiKey},body:JSON.stringify(payload),timeout:45})
  } catch (_) { return finish(false, 'connection_or_timeout', model) }
  if (response.statusCode !== 200) return finish(false, 'upstream_http_' + response.statusCode, model)
  try {
    const report = helpers.parseResponse(response.json, evidence, provider)
    if (report.findings.length !== 1 || report.findings[0].evidence_ids[0] !== evidence[0].id) return finish(false, 'synthetic_evidence_expectation_not_met', model)
  } catch (_) { return finish(false, 'output_validation_failed', model) }
  return finish(true, 'validated', model)
}, $apis.bodyLimit(1))
