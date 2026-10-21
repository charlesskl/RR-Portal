// One explicitly authorized synthetic call. Disposable DB/hooks only; never business volumes.
// Diagnostics contain only fixed enums/booleans; no upstream text, key, body or exception text.
routerAdd('POST', '/probe', e => {
  const started = Date.now()
  const diag = {responseJsonType:'not_checked',hasChoices:false,hasFirstChoice:false,finishReason:'not_checked',contentType:'not_checked',contentLengthClass:'not_checked',hasRefusal:false,hasReasoningContent:false,jsonParsed:false,reportType:'not_checked',summaryValid:false,findingsArray:false,findingsCountClass:'not_checked',limitationsValid:false,invalidTitle:false,invalidRisk:false,invalidAnalysis:false,invalidActions:false,invalidCitations:false,validationClass:'not_checked'}
  const finish = (success, status, model) => e.json(200, {success, status, model, elapsedMs:Date.now()-started,diagnostics:diag})
  const nonce = $os.getenv('AI_PROBE_NONCE')
  if ($os.getenv('AI_PROBE_ALLOW_ONCE') !== 'true' || nonce.length < 32 || e.request.header.get('X-Probe-Nonce') !== nonce) return finish(false,'probe_not_authorized','')
  const provider=$os.getenv('FACTORY_REVIEW_AI_PROVIDER'),model=$os.getenv('FACTORY_REVIEW_AI_MODEL'),base=$os.getenv('FACTORY_REVIEW_AI_BASE_URL').replace(/\/$/,''),apiKey=$os.getenv('FACTORY_REVIEW_AI_API_KEY')
  if (provider!=='qwen'||model!=='qwen3.8-max'||base!=='https://dashscope.aliyuncs.com/compatible-mode/v1'||!apiKey) return finish(false,'configuration_mismatch','')
  try {
    e.app.db().newQuery('CREATE TABLE IF NOT EXISTS "_ai_single_probe" ("slot" INTEGER PRIMARY KEY CHECK ("slot" = 1))').execute()
    e.app.db().newQuery('INSERT INTO "_ai_single_probe" ("slot") VALUES (1)').execute()
  } catch (_) { return finish(false,'probe_already_used_or_local_db_error',model) }
  const helpers=require('/pb/pb_hooks/lib/analysis_ai.js')
  const evidence=[{id:'orders:synthetic000001',factory:'F1',type:'订单',shortened:false,fields:{delivery_date:'2026-10-01',actual_delivery_date:'',status:'delayed',quantity:100,delay_reason:'纯合成测试记录：交付状态待核实，不代表任何真实工厂。'}}]
  const dataset={start:'2026-10-01',end:'2026-10-02',coverage:[{source:'订单',status:'已读取',count:1}],notes:'仅一条完全合成的验收数据，不读取数据库业务记录。',evidence}
  const payload=helpers.request(model,dataset,'请仅依据这一条合成订单指出需要核实的交付状态，返回一条有证据引用的发现；不要推断产能或真实工厂情况。',provider)
  let response
  try { response=$http.send({url:base+'/chat/completions',method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+apiKey},body:JSON.stringify(payload),timeout:45}) }
  catch (_) { return finish(false,'connection_or_timeout',model) }
  if (response.statusCode!==200) return finish(false,'upstream_http_'+response.statusCode,model)
  const kind=v=>v===undefined?'missing':v===null?'null':Array.isArray(v)?'array':['object','string','boolean','number'].includes(typeof v)?typeof v:'other'
  const text=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.length<=max
  const raw=response.json,choice=raw&&raw.choices&&raw.choices[0],message=choice&&choice.message,content=message&&message.content
  diag.responseJsonType=kind(raw);diag.hasChoices=!!(raw&&Array.isArray(raw.choices)&&raw.choices.length);diag.hasFirstChoice=!!choice
  diag.finishReason=!choice||choice.finish_reason===undefined?'missing':['stop','length','content_filter','tool_calls','function_call'].includes(choice.finish_reason)?choice.finish_reason:'other'
  diag.contentType=kind(content);diag.contentLengthClass=typeof content!=='string'?'not_string':content.length===0?'empty':content.length<=16384?'one_to_16384':content.length<=65536?'up_to_65536':'larger'
  diag.hasRefusal=!!(message&&message.refusal);diag.hasReasoningContent=!!(message&&typeof message.reasoning_content==='string'&&message.reasoning_content.length)
  try {
    const data=JSON.parse(content);diag.jsonParsed=true;diag.reportType=kind(data)
    diag.summaryValid=!!(data&&text(data.summary,2000));diag.findingsArray=!!(data&&Array.isArray(data.findings));diag.findingsCountClass=!diag.findingsArray?'not_array':data.findings.length===0?'empty':data.findings.length<=8?'one_to_eight':'more_than_eight'
    diag.limitationsValid=!!(data&&Array.isArray(data.limitations)&&data.limitations.length<=12&&!data.limitations.some(v=>!text(v,1000)))
    if(diag.findingsArray)for(const f of data.findings){diag.invalidTitle=diag.invalidTitle||!f||!text(f.title,200);diag.invalidRisk=diag.invalidRisk||!f||!['high','medium','low'].includes(f.risk);diag.invalidAnalysis=diag.invalidAnalysis||!f||!text(f.analysis,2400);diag.invalidActions=diag.invalidActions||!f||!Array.isArray(f.actions)||!f.actions.length||f.actions.length>3||f.actions.some(v=>!text(v,1000));diag.invalidCitations=diag.invalidCitations||!f||!Array.isArray(f.evidence_ids)||!f.evidence_ids.length||f.evidence_ids.length>12||f.evidence_ids.some(id=>id!==evidence[0].id)}
  } catch (_) { /* Deliberately no raw text or parser message. */ }
  try {
    const report=helpers.parseResponse(raw,evidence,provider);diag.validationClass='valid'
    if(report.findings.length!==1||report.findings[0].evidence_ids[0]!==evidence[0].id)return finish(false,'synthetic_evidence_expectation_not_met',model)
  } catch(err) {
    switch(err&&err.message){
      case 'AI未完成分析，请缩小范围或稍后重试':diag.validationClass='incomplete_response';break
      case 'AI未能回答此问题，请调整问题':diag.validationClass='refused_response';break
      case 'AI返回格式异常，请重试':diag.validationClass='malformed_json';break
      case 'AI返回内容不完整，请重试':diag.validationClass='invalid_report_shape';break
      case 'AI结论缺少有效证据，已停止展示，请重试':diag.validationClass='invalid_finding_or_evidence';break
      default:diag.validationClass='unexpected_exception'
    }
    return finish(false,'output_validation_failed',model)
  }
  return finish(true,'validated',model)
},$apis.bodyLimit(1))
