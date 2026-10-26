// Real PocketBase DateFields and candidate caps; every record and model is synthetic.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, copyFile, rm } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { createServer as httpServer } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import PocketBase from 'pocketbase'

test('AI review boundaries use real dates and never present truncated counts', {timeout: 90000}, async t => {
  assert.ok(process.env.POCKETBASE_BINARY)
  const dir=await mkdtemp(join(tmpdir(),'analysis-ai-review-')),migrations=join(dir,'migrations'),hooks=join(dir,'hooks')
  const pass=randomBytes(18).toString('hex'),factory='factory00000001'
  await mkdir(migrations);await mkdir(join(hooks,'lib'),{recursive:true})
  await writeFile(join(migrations,'1700000000_fixture.js'),`migrate(app=>{
    const users=app.findCollectionByNameOrId('users');users.fields.add(new TextField({name:'role'}));users.fields.add(new JSONField({name:'permissions'}));app.save(users);
    const user=new Record(users);user.setEmail('review@fixture.invalid');user.setPassword('${pass}');user.set('role','admin');user.set('permissions',{'quality.view':false,'scoring.view':false,'output.view':false});app.save(user);
    const factories=new Collection({name:'factories',type:'base',listRule:'@request.auth.id != ""',viewRule:'@request.auth.id != ""'});for(const name of ['name','region','craft'])factories.fields.add(new TextField({name}));app.save(factories);
    const f=new Record(factories);f.set('id','${factory}');f.set('name','fixture');f.set('region','hunan');f.set('craft','assembly');app.save(f);
    const orders=new Collection({name:'orders',type:'base',listRule:'@request.auth.id != ""',viewRule:'@request.auth.id != ""'});orders.fields.add(new RelationField({name:'factory',collectionId:factories.id,maxSelect:1}));for(const name of ['order_date','delivery_date'])orders.fields.add(new DateField({name}));orders.fields.add(new TextField({name:'region'}));app.save(orders);
    const add=(id,placed,delivery)=>{const r=new Record(orders);if(id)r.set('id',id);r.set('factory',f.id);r.set('order_date',placed);r.set('delivery_date',delivery);app.save(r)};
    add('before000000001','2026-09-30 23:59:59.999Z','2026-10-10 00:00:00.000Z');
    add('first0000000001','2026-10-01 00:00:00.000Z','2026-09-30 00:00:00.000Z');
    add('last00000000001','2026-10-20 23:59:59.999Z','2026-10-10 00:00:00.000Z');
    add('after0000000001','2026-10-21 00:00:00.000Z','2026-10-10 00:00:00.000Z');
    add('empty0000000001','','2026-10-10 00:00:00.000Z');
    for(const [day,count]of [['01',2000],['02',1],['03',500],['04',501]])for(let i=0;i<count;i++)add(null,'2026-09-'+day+' 00:00:00.000Z','2026-11-01 00:00:00.000Z');
  },()=>{})`)
  await copyFile(new URL('../pb_migrations/1792454500_create_analysis_ai_usage.js',import.meta.url),join(migrations,'1792454500_create_analysis_ai_usage.js'))
  for(const name of ['analysis_ai.pb.js','lib/analysis_ai.js'])await copyFile(new URL('../pb_hooks/'+name,import.meta.url),join(hooks,name))
  const flags=['--dir='+join(dir,'data'),'--migrationsDir='+migrations,'--hooksDir='+hooks]
  const run=args=>{const r=spawnSync(process.env.POCKETBASE_BINARY,[...args,...flags],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.doesNotMatch(r.stdout+r.stderr,/^Error:/m)}
  let child,upstream,log=''
  t.after(async()=>{if(child?.exitCode===null){const stopped=once(child,'exit');child.kill();await stopped}if(upstream)await new Promise(r=>upstream.close(r));await rm(dir,{recursive:true,force:true})})
  run(['migrate','up']);run(['superuser','upsert','super@fixture.invalid',pass])
  const calls=[]
  upstream=httpServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;calls.push(JSON.parse(raw));res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({summary:'本地证据已核对',findings:[],limitations:['本地模型桩']})}]}]}))})
  upstream.listen(0,'127.0.0.1');await once(upstream,'listening')
  const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(r=>socket.close(r))
  const base='http://127.0.0.1:'+port
  child=spawn(process.env.POCKETBASE_BINARY,['serve','--http=127.0.0.1:'+port,...flags],{env:{...process.env,FACTORY_REVIEW_AI_ENABLED:'true',FACTORY_REVIEW_AI_PROVIDER:'openai',FACTORY_REVIEW_AI_API_KEY:'synthetic-key',FACTORY_REVIEW_AI_MODEL:'synthetic-model',FACTORY_REVIEW_AI_BASE_URL:'http://127.0.0.1:'+upstream.address().port+'/v1',FACTORY_REVIEW_AI_LOCAL_TEST:'true'},stdio:['ignore','pipe','pipe']})
  child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b)
  const client=new PocketBase(base),admin=new PocketBase(base)
  for(let n=0;n<100;n++){try{await client.health.check();break}catch{await new Promise(r=>setTimeout(r,50))}}
  assert.equal(child.exitCode,null,log)
  await client.collection('users').authWithPassword('review@fixture.invalid',pass);await admin.collection('_superusers').authWithPassword('super@fixture.invalid',pass)
  const request=(extra={})=>client.send('/api/factory-review/analysis-ai',{method:'POST',body:{start:'2026-10-01',end:'2026-10-20',question:'核对范围',...extra}})
  const usage=()=>admin.collection('analysis_ai_usage').getFullList()
  await t.test('real DateField day endpoints are inclusive, blank and neighboring dates excluded',async()=>{
    const placed=await request({preview:true,orderDateBasis:'order_date'})
    assert.equal(placed.total,2);assert.equal(placed.coverage.find(c=>c.source==='订单').count,2)
    assert.equal((await request({preview:true,orderDateBasis:'delivery_date'})).total,4)
    assert.equal((await request({preview:true})).total,4)
    assert.equal(calls.length,0);assert.equal((await usage()).length,0)
    const result=await request({orderDateBasis:'order_date'})
    assert.deepEqual(new Set(result.evidence.map(e=>e.recordId)),new Set(['first0000000001','last00000000001']))
    const dataset=JSON.parse(calls[0].input).dataset
    assert.equal(dataset.orderDateBasis,'order_date')
    assert.ok(dataset.evidence.every(e=>typeof e.fields.order_date==='string'))
    assert.equal(calls.length,1)
    for(const row of await usage())await admin.collection('analysis_ai_usage').delete(row.id)
  })
  await t.test('500 and 501 counts stay complete and overflowing generation never calls a model',async()=>{
    const before=calls.length
    for(const [day,count]of [['03',500],['04',501]]){
      const stats=await request({start:'2026-09-'+day,end:'2026-09-'+day,preview:true,orderDateBasis:'order_date'})
      assert.equal(stats.total,count);assert.equal(stats.coverage.find(c=>c.source==='订单').count,count)
    }
    await assert.rejects(request({start:'2026-09-04',end:'2026-09-04',orderDateBasis:'order_date'}),e=>e.status===400&&e.response.message.includes('订单 501条'))
    assert.equal(calls.length,before);assert.equal((await usage()).length,0)
  })
  await t.test('exactly 2000 candidates are complete; 2001 rejects preview explicitly',async()=>{
    const before=calls.length
    assert.equal((await request({start:'2026-09-01',end:'2026-09-01',preview:true,orderDateBasis:'order_date'})).total,2000)
    for(const preview of [true,false])await assert.rejects(request({start:'2026-09-01',end:'2026-09-02',preview,orderDateBasis:'order_date'}),e=>e.status===400&&e.response.message.includes('订单候选记录超过2000条，统计未完成'))
    assert.equal(calls.length,before);assert.equal((await usage()).length,0)
  })
})
