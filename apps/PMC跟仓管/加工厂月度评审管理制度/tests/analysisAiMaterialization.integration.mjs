// Execute the real hook with observable record getters; no PocketBase/network/model.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

function execute(counts,preview) {
  const helpersContext=vm.createContext({module:{exports:{}}})
  vm.runInContext(readFileSync(new URL('../pb_hooks/lib/analysis_ai.js',import.meta.url),'utf8'),helpersContext)
  const helpers=helpersContext.module.exports,routes=new Map(),detailRecords=new Set(),records=new Map()
  const factory={id:'factory00000001',getString:key=>({name:'fixture',region:'hunan',craft:'assembly'}[key]||''),collection:()=>({viewRule:'fixture'})}
  const auth={id:'user00000000001',getString:key=>({role:'admin',permissions:'{}',crafts:'[]',craft:''}[key]||''),tokenKey:()=> 'synthetic-token-key'}
  let providerCalls=0,quotaWrites=0,response,sent
  for(const [index,src]of helpers.sources.entries()){
    const rows=[]
    for(let n=0;n<counts[index];n++){
      const id=String(n).padStart(15,'0'),key=src.collection+':'+id
      const row={id,collection:()=>({viewRule:'fixture'}),getString:field=>{
        if(field==='factory')return factory.id
        if(field==='region')return 'hunan'
        if(field===src.date)return src.date==='year_month'?'2026-10':'2026-10-16'
        detailRecords.add(key);return 'null'
      },get:field=>{detailRecords.add(key);return field===src.date?(src.date==='year_month'?'2026-10':'2026-10-16'):null}}
      rows.push(row);records.set(key,row)
    }
    records.set(src.collection,rows)
  }
  const app={
    findRecordsByFilter:(name,_filter,_sort,limit)=>name==='factories'?[factory]:name==='analysis_ai_usage'?[]:records.get(name).slice(0,limit),
    canAccessRecord:()=>true,
    findRecordById:(name,id)=>name==='users'?auth:name==='factories'?factory:records.get(name+':'+id),
    findCollectionByNameOrId:()=>({id:'quota'}),save:()=>{quotaWrites++},
  }
  app.runInTransaction=callback=>callback(app)
  class ApiError extends Error {constructor(status,message){super(message);this.status=status}}
  class BadRequestError extends ApiError {constructor(message){super(400,message)}}
  class ForbiddenError extends ApiError {constructor(message){super(403,message)}}
  const context=vm.createContext({
    require:path=>{assert.ok(path.endsWith('/lib/analysis_ai.js'));return helpers},__hooks:'/fixture',
    routerAdd:(method,path,handler)=>routes.set(method+' '+path,handler),cronAdd:()=>{},
    $apis:{requireAuth:()=>()=>{},bodyLimit:()=>()=>{}},BadRequestError,ForbiddenError,ApiError,
    Record:class{set(){}},
    $os:{getenv:key=>({FACTORY_REVIEW_AI_ENABLED:'true',FACTORY_REVIEW_AI_API_KEY:'synthetic-key',FACTORY_REVIEW_AI_MODEL:'synthetic-model',FACTORY_REVIEW_AI_PROVIDER:'openai',FACTORY_REVIEW_AI_BASE_URL:'https://fixture.invalid/v1'}[key]||'')},
    $http:{send:options=>{providerCalls++;sent=JSON.parse(options.body);return{statusCode:200,json:{status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({summary:'本地模型桩',findings:[],limitations:[]})}]}]}}}},
  })
  vm.runInContext(readFileSync(new URL('../pb_hooks/analysis_ai.pb.js',import.meta.url),'utf8'),context)
  let error
  try{routes.get('POST /api/factory-review/analysis-ai')({app,auth,requestInfo:()=>({body:{start:'2026-10-01',end:'2026-10-20',question:'本地分析',preview}}),json:(status,body)=>{response={status,body};return response}})}catch(e){error=e}
  return {error,response,providerCalls,quotaWrites,detailRecords,sent}
}

test('preview counts every authorized source without reading detail fields',()=>{
  const result=execute([2000,1500,1000,10,20],true)
  assert.equal(result.error,undefined)
  assert.equal(result.response.status,200)
  assert.equal(result.response.body.total,4530)
  assert.deepEqual(Array.from(result.response.body.coverage,c=>c.count),[2000,1500,1000,10,20])
  assert.equal(result.detailRecords.size,0)
  assert.equal(result.providerCalls,0);assert.equal(result.quotaWrites,0)
})

test('overflow still counts all sources while materializing at most 500 details',()=>{
  const result=execute([200,100,201,2,3],false)
  assert.equal(result.error.status,400)
  assert.match(result.error.message,/共506条.*巡查 200条.*品质检验 100条.*订单 201条.*月度评分 2条.*月度产值 3条/)
  assert.equal(result.detailRecords.size,500)
  assert.equal(result.providerCalls,0);assert.equal(result.quotaWrites,0)
})

test('the first record above 500 is counted without loading its details',()=>{
  const result=execute([0,0,501,0,0],false)
  assert.equal(result.error.status,400);assert.match(result.error.message,/共501条/)
  assert.equal(result.detailRecords.size,500)
  assert.equal(result.providerCalls,0);assert.equal(result.quotaWrites,0)
})

test('exactly 500 records retain all evidence, snapshots and one explicit model call',()=>{
  const result=execute([100,100,100,100,100],false)
  assert.equal(result.error,undefined)
  assert.equal(result.response.status,200)
  assert.equal(result.response.body.evidence.length,500)
  assert.deepEqual(Array.from(result.response.body.coverage,c=>c.count),[100,100,100,100,100])
  assert.equal(JSON.parse(result.sent.input).dataset.evidence.length,500)
  assert.equal(result.detailRecords.size,500)
  assert.equal(result.providerCalls,1);assert.equal(result.quotaWrites,1)
})
