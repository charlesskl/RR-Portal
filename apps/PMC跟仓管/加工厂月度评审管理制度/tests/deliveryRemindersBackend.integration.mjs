import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, writeFile, copyFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import PocketBase from 'pocketbase'
const id = s => s.padEnd(15,'0')
test('delivery reminders match the responsible account and enforce scope without changing orders', {timeout:60000},async t=>{
  const binary=process.env.POCKETBASE_BINARY;assert.ok(binary)
  const dir=await mkdtemp(join(tmpdir(),'delivery-reminder-')), migrations=join(dir,'migrations'), hooks=join(dir,'hooks')
  await mkdir(migrations);await mkdir(join(hooks,'lib'),{recursive:true})
  let child,log=''
  t.after(async()=>{if(child&&child.exitCode===null){const done=once(child,'exit');child.kill();await done}await rm(dir,{recursive:true,force:true})})
  const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10)
  const later=new Date(Date.parse(today)+86400000).toISOString().slice(0,10)
  const users=[['pmca','PMC甲',{}],['pmcb','PMC乙',{}],['dupa','同名',{}],['dupb','同名',{}],['denied','禁止查看',{'orders.view':false}],['readonly','只读',{'orders.edit':false}]]
  const fixture=`migrate(app=>{
    const users=app.findCollectionByNameOrId('users');for(const name of ['display_name','role','craft'])users.fields.add(new TextField({name}));for(const name of ['permissions','crafts'])users.fields.add(new JSONField({name}));app.save(users);
    for(const [name,display,permissions] of ${JSON.stringify(users)}){const r=new Record(users);r.set('id',name.padEnd(15,'0'));r.setEmail(name+'@fixture.invalid');r.setPassword('Synthetic-Reminder-1234');r.set('display_name',display);r.set('role','buyer_assembly');r.set('crafts',['assembly']);r.set('permissions',Object.assign({'region.heyuan':false},permissions));app.save(r)}
    const f=new Collection({name:'factories',type:'base',viewRule:'@request.auth.id != ""'});for(const name of ['name','region','craft'])f.fields.add(new TextField({name}));app.save(f);
    for(const [name,region,craft] of [['allowed','hunan','assembly'],['region','heyuan','assembly'],['craft','hunan','sewing']]){const r=new Record(f);r.set('id',name.padEnd(15,'0'));r.set('name',name);r.set('region',region);r.set('craft',craft);app.save(r)}
    const c=new Collection({name:'orders',type:'base',viewRule:'@request.auth.id != "" && product != "hidden"'});c.fields.add(new RelationField({name:'factory',maxSelect:1,collectionId:f.id}));c.fields.add(new RelationField({name:'created_by',maxSelect:1,collectionId:users.id}));for(const name of ['pmc','status','region','product','order_no','secret'])c.fields.add(new TextField({name}));for(const name of ['delivery_date','actual_delivery_date'])c.fields.add(new DateField({name}));app.save(c);
    const seed=(name,fields)=>{const r=new Record(c);r.set('id',name.padEnd(15,'0'));const value=Object.assign({factory:'allowed'.padEnd(15,'0'),pmc:'PMC甲',created_by:'pmcb'.padEnd(15,'0'),status:'placed',delivery_date:'${today}',product:name,secret:'DO-NOT-RETURN'},fields);for(const key in value)r.set(key,value[key]);app.save(r)};
    seed('today',{});seed('historical',{delivery_date:'2025-01-01'});seed('future',{delivery_date:'${later}'});seed('nodate',{delivery_date:''});
    seed('delivered',{status:'delivered'});seed('dated',{actual_delivery_date:'${today}'});seed('cancelled',{status:'cancelled'});seed('returned',{status:'returned'});
    seed('otherpmc',{pmc:'PMC乙',created_by:'pmca'.padEnd(15,'0')});seed('creator',{pmc:'',created_by:'pmca'.padEnd(15,'0')});seed('unknown',{pmc:'未匹配PMC',created_by:'pmca'.padEnd(15,'0')});
    seed('duplicate',{pmc:'同名',created_by:'dupa'.padEnd(15,'0')});seed('region',{factory:'region'.padEnd(15,'0')});seed('managed',{region:'heyuan'});seed('craft',{factory:'craft'.padEnd(15,'0')});seed('hidden',{product:'hidden'});
  },()=>{})`
  await writeFile(join(migrations,'1700000000_fixture.js'),fixture)
  for(const file of ['delivery_reminders.pb.js','lib/analysis_ai.js'])await copyFile(new URL('../pb_hooks/'+file,import.meta.url),join(hooks,file))
  const flags=['--dir='+join(dir,'data'),'--migrationsDir='+migrations,'--hooksDir='+hooks]
  const run=args=>{const r=spawnSync(binary,[...args,...flags],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.doesNotMatch(r.stdout+r.stderr,/^Error:/m)}
  run(['migrate','up']);run(['superuser','upsert','super@fixture.invalid','Synthetic-Reminder-1234'])
  const sock=createServer();sock.listen(0,'127.0.0.1');await once(sock,'listening');const port=sock.address().port;await new Promise(r=>sock.close(r))
  const base='http://127.0.0.1:'+port
  child=spawn(binary,['serve','--http='+base.slice(7),...flags],{stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b)
  let ready=false;for(let n=0;n<100;n++){try{await new PocketBase(base).health.check();ready=true;break}catch{await new Promise(r=>setTimeout(r,50))}}assert.ok(ready,log)
  const clients={};for(const [name] of users){const c=new PocketBase(base);await c.collection('users').authWithPassword(name+'@fixture.invalid','Synthetic-Reminder-1234');clients[name]=c}
  const endpoint='/api/factory-review/delivery-reminders'
  const superuser=new PocketBase(base);await superuser.collection('_superusers').authWithPassword('super@fixture.invalid','Synthetic-Reminder-1234')
  const before=await superuser.collection('orders').getFullList()
  await t.test('due today and old unresolved records belong to unique PMC, not import creator',async()=>{
    const r=await clients.pmca.send(endpoint,{method:'GET'});assert.equal(r.today,today)
    assert.deepEqual(r.items.map(o=>o.id).sort(),['today','historical','creator'].map(id).sort());assert.equal(r.hasMore,false)
    assert.ok(r.items.every(o=>o.craft==='assembly'&&o.region==='hunan'));assert.ok(!JSON.stringify(r).includes('DO-NOT-RETURN'))
    const other=await clients.pmcb.send(endpoint,{method:'GET'});assert.deepEqual(other.items.map(o=>o.id),[id('otherpmc')])
  })
  await t.test('ambiguous names never guess which account owns an order',async()=>{
    for(const name of ['dupa','dupb']){const r=await clients[name].send(endpoint,{method:'GET'});assert.equal(r.nameAmbiguous,true);assert.deepEqual(r.items,[])}
  })
  await t.test('authentication, view/edit permissions and record rules apply',async()=>{
    for(const c of [new PocketBase(base),clients.denied,clients.readonly])await assert.rejects(c.send(endpoint,{method:'GET'}),e=>[401,403].includes(e.status))
    assert.deepEqual(await superuser.collection('orders').getFullList(),before)
  })
  await t.test('registration stops reminders and changed account permissions take effect',async()=>{
    await superuser.collection('orders').update(id('today'),{actual_delivery_date:today})
    assert.ok(!(await clients.pmca.send(endpoint,{method:'GET'})).items.some(r=>r.id===id('today')))
    await superuser.collection('users').update(id('pmca'),{permissions:{'orders.view':false}})
    await assert.rejects(clients.pmca.send(endpoint,{method:'GET'}),e=>e.status===403)
  })
})
