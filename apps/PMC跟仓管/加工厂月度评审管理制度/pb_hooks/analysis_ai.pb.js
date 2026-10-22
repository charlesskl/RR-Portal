routerAdd('GET','/api/factory-review/analysis-ai/config', e => {
  const helpers=require(__hooks+'/lib/analysis_ai.js')
  let user
  try { user={role:e.auth.getString('role'),permissions:JSON.parse(e.auth.getString('permissions')||'null'),crafts:JSON.parse(e.auth.getString('crafts')||'null'),craft:e.auth.getString('craft')} } catch(_){throw new ForbiddenError('权限配置无效')}
  const scope=helpers.permissions(user)
  if(!scope.modules.length)throw new ForbiddenError('没有分析数据查看权限')
  const provider=$os.getenv('FACTORY_REVIEW_AI_PROVIDER')||'openai'
  const enabled=$os.getenv('FACTORY_REVIEW_AI_ENABLED')==='true'
  const configured=['openai','qwen'].includes(provider)&&!!$os.getenv('FACTORY_REVIEW_AI_API_KEY')&&!!$os.getenv('FACTORY_REVIEW_AI_MODEL')
  return e.json(200,{provider,enabled:enabled&&configured,model:enabled&&configured?$os.getenv('FACTORY_REVIEW_AI_MODEL'):'',reason:!enabled?'AI服务尚未启用，请管理员完成配置':!configured?'AI模型或密钥尚未配置':'',dailyLimit:20,modules:scope.modules})
},$apis.requireAuth('users'))

routerAdd('POST','/api/factory-review/analysis-ai', e => {
  const helpers=require(__hooks+'/lib/analysis_ai.js')
  function authSnapshot(record){return JSON.stringify([record.getString('role'),record.getString('permissions'),record.getString('crafts'),record.getString('craft'),record.tokenKey()])}
  const originalAuth=authSnapshot(e.auth)
  let scope,input
  const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10)
  try {
    scope=helpers.permissions({role:e.auth.getString('role'),permissions:JSON.parse(e.auth.getString('permissions')||'null'),crafts:JSON.parse(e.auth.getString('crafts')||'null'),craft:e.auth.getString('craft')})
    input=helpers.validateInput(e.requestInfo().body,today)
  } catch(err){throw new BadRequestError(String(err.message))}
  if(!scope.modules.length||!scope.crafts.length||!scope.regions.length)throw new ForbiddenError('没有可分析的数据权限')
  const apiKey=$os.getenv('FACTORY_REVIEW_AI_API_KEY'),model=$os.getenv('FACTORY_REVIEW_AI_MODEL')
  if($os.getenv('FACTORY_REVIEW_AI_ENABLED')!=='true'||!apiKey||!model)throw new ApiError(503,'AI服务尚未配置，规则预警仍可使用')
  const provider=$os.getenv('FACTORY_REVIEW_AI_PROVIDER')||'openai'
  if(!['openai','qwen'].includes(provider))throw new ApiError(503,'AI服务提供商配置无效')
  const base=($os.getenv('FACTORY_REVIEW_AI_BASE_URL')||(provider==='qwen'?'https://dashscope.aliyuncs.com/compatible-mode/v1':'https://api.openai.com/v1')).replace(/\/$/,'')
  // Only server configuration controls the destination. Loopback is for the isolated integration harness.
  if(!/^https:\/\/[^\s?#@]+$/.test(base)&&!($os.getenv('FACTORY_REVIEW_AI_LOCAL_TEST')==='true'&&/^http:\/\/127\.0\.0\.1:\d+\/v1$/.test(base)))throw new ApiError(503,'AI服务地址配置无效')
  const info=e.requestInfo(),factoryMap={},factories=[]
  const all=e.app.findRecordsByFilter('factories',input.factory?'id = {:factory}':'','id',2001,0,{factory:input.factory})
  if(all.length>2000)throw new BadRequestError('工厂数量过多，请选择单个工厂分析')
  all.forEach(f=>{if(scope.crafts.includes(f.getString('craft'))&&e.app.canAccessRecord(f,info,f.collection().viewRule)){factoryMap[f.id]=f;factories.push(f)}})
  if(input.factory&&!factoryMap[input.factory])throw new ForbiddenError('没有该工厂的查看权限')
  if(!factories.length)throw new BadRequestError('没有可分析的工厂')
  const aliases={};factories.forEach((f,i)=>aliases[f.id]='F'+(i+1))
  const evidence=[],refs=[],coverage=[],checked=[]
  function valueOf(record,src,key){
    // Optional patrol counts are JSON fields: JSVM exposes their JSONRaw bytes.
    if(src.collection==='quality_patrols'&&['staff','lines','area'].includes(key))return JSON.parse(record.getString(key)||'null')
    return record.get(key)
  }
  for(const src of helpers.sources){
    if(!scope.modules.includes(src.module)){coverage.push({source:src.label,status:'未授权，未读取',count:0});continue}
    const monthly=src.date==='year_month',start=monthly?input.start.slice(0,7):input.start,end=monthly?input.end.slice(0,7):input.end+' 23:59:59.999Z'
    // PocketBase limits filter expressions. Keep each disjoint factory batch below
    // that limit, but enforce the source record cap across all batches together.
    const rows=[]
    for(let offset=0;offset<factories.length;offset+=100){
      const params={start,end}
      const clause=factories.slice(offset,offset+100).map((f,i)=>{params['f'+i]=f.id;return 'factory = {:f'+i+'}'}).join(' || ')
      let filter='('+clause+') && '+src.date+' >= {:start} && '+src.date+' <= {:end}'
      if(src.collection==='monthly_scores')filter+=' && status != "draft"'
      const batch=e.app.findRecordsByFilter(src.collection,filter,src.date+',id',2001-rows.length,0,params)
      batch.forEach(r=>rows.push(r))
      if(rows.length>2000)throw new BadRequestError('范围内记录过多，请缩短时间或选择工厂后重试')
    }
    let count=0
    for(const r of rows){
      const f=factoryMap[r.getString('factory')],region=src.collection==='orders'?(r.getString('region')||f.getString('region')||'dongguan'):(f.getString('region')||'dongguan')
      if(!scope.regions.includes(region)||!e.app.canAccessRecord(r,info,r.collection().viewRule))continue
      const fields={};let shortened=false
      src.fields.forEach(key=>{let value=valueOf(r,src,key);if(typeof value==='string'&&value.length>800){value=value.slice(0,800);shortened=true}fields[key]=value})
      const id=src.collection+':'+r.id
      evidence.push({id,factory:aliases[f.id],type:src.label,fields,shortened})
      refs.push({id,factoryCode:aliases[f.id],factoryId:f.id,factoryName:f.getString('name'),source:src.collection,recordId:r.id,date:r.getString(src.date).slice(0,10),craft:f.getString('craft'),region})
      checked.push({collection:src.collection,id:r.id,factory:f.id,source:src,region:r.getString('region'),snapshot:JSON.stringify(src.fields.map(key=>valueOf(r,src,key)))});count++
      if(evidence.length>500)throw new BadRequestError('分析明细超过500条，请缩短时间或选择工厂；系统不会截取部分数据冒充全局结论')
    }
    coverage.push({source:src.label,status:count?'已读取':'范围内无可见记录',count})
  }
  if(!evidence.length)throw new BadRequestError('所选范围没有可分析的记录，请调整日期或工厂')
  const dataset={start:input.start,end:input.end,coverage,notes:'订单按约定交期、巡查按检查日期、检验按送货日期筛选；月度数据按范围涉及的整月，未包含范围外记录和无日期记录。工厂代号仅本次有效。',evidence}
  if(JSON.stringify(dataset).length>160000)throw new BadRequestError('分析内容过多，请缩小范围')
  function stillAuthorized(){
    const latest=e.app.findRecordById('users',e.auth.id)
    if(authSnapshot(latest)!==originalAuth)throw new ForbiddenError('账号权限已变化，请重新分析')
    for(const item of checked){
      const r=e.app.findRecordById(item.collection,item.id),f=e.app.findRecordById('factories',item.factory)
      if(r.getString('factory')!==item.factory||r.getString('region')!==item.region||JSON.stringify(item.source.fields.map(key=>valueOf(r,item.source,key)))!==item.snapshot||f.getString('craft')!==factoryMap[f.id].getString('craft')||f.getString('region')!==factoryMap[f.id].getString('region')||!e.app.canAccessRecord(r,info,r.collection().viewRule)||!e.app.canAccessRecord(f,info,f.collection().viewRule))throw new ForbiddenError('数据或访问权限已变化，请重新分析')
    }
  }
  stillAuthorized()
  // Transaction reserves rate quota before the outbound request; concurrent requests cannot bypass it.
  const started=new Date().toISOString(),dayStart=today+'T00:00:00+08:00'
  e.app.runInTransaction(tx=>{
    const recent=tx.findRecordsByFilter('analysis_ai_usage','owner = {:owner} && started_at >= {:since}','-started_at',21,0,{owner:e.auth.id,since:new Date(Date.parse(dayStart)).toISOString()})
    if(recent.length>=20)throw new ApiError(429,'今天已达到20次分析额度，请明天再试')
    if(recent.some(r=>Date.now()-Date.parse(r.getString('started_at'))<60000))throw new ApiError(429,'请间隔60秒再发起分析')
    const row=new Record(tx.findCollectionByNameOrId('analysis_ai_usage'));row.set('owner',e.auth.id);row.set('started_at',started);row.set('minute_key',e.auth.id+':'+Math.floor(Date.now()/60000));tx.save(row)
  })
  let response
  try{response=$http.send({url:base+(provider==='qwen'?'/chat/completions':'/responses'),method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+apiKey},body:JSON.stringify(helpers.request(model,dataset,input.question,provider)),timeout:45})}
  catch(_){throw new ApiError(502,'AI服务连接失败或超时，请稍后重试；规则预警仍可使用')}
  if(response.statusCode!==200)throw new ApiError(502,'AI服务暂不可用，请管理员检查模型权限、额度及配置')
  let report
  try{report=helpers.parseResponse(response.json,evidence,provider)}catch(err){throw new ApiError(502,String(err.message))}
  stillAuthorized()
  return e.json(200,{report,evidence:refs,coverage,model,generatedAt:new Date().toISOString(),start:input.start,end:input.end})
},$apis.requireAuth('users'),$apis.bodyLimit(8192))

cronAdd('analysis-ai-quota-cleanup','17 3 * * *',()=>{
  const cutoff=new Date(Date.now()-30*86400000).toISOString()
  const rows=$app.findRecordsByFilter('analysis_ai_usage','started_at < {:cutoff}','',1000,0,{cutoff})
  rows.forEach(r=>$app.delete(r))
})
