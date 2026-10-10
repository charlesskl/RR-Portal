import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('startup reconciles only completed printing orders, records once and rolls back on failure',()=>{
 const moduleURL=new URL('../cloud/integration.mjs',import.meta.url).href;
 // A separate process owns the in-memory database and unref'ed synchronization timers.
 const script=`
  import assert from 'node:assert/strict';
  import {DatabaseSync} from 'node:sqlite';
  import {integration} from ${JSON.stringify(moduleURL)};
  const db=new DatabaseSync(':memory:');
  db.exec("CREATE TABLE orders(id TEXT PRIMARY KEY,status TEXT,updated TEXT); CREATE TABLE events(order_id TEXT,actor TEXT,text TEXT)");
  const context={db,recordEvent:(id,actor,text)=>db.prepare('INSERT INTO events VALUES (?,?,?)').run(id,actor,text),DEMO:true};
  integration(context);
  const cases=[['repair','待质检','打印中','待交付'],['delivered','待质检','已完成','已完成'],['cancelled','待质检','已取消','已取消'],['printing','打印中','打印中','打印中'],['waiting','待打印','打印中','打印中'],['ready','待质检','待交付','待交付']];
  for(const [index,[id,jobStatus,orderStatus]] of cases.entries()){
   db.prepare('INSERT INTO orders VALUES (?,?,?)').run(id,orderStatus,'original');
   db.prepare('INSERT INTO production_jobs(id,order_id,station,machine,payload,status,created) VALUES (?,?,?,?,?,?,?)').run(id,id,'test-station',String(index+1),'{}',jobStatus,'original');
  }
  integration(context);
  for(const [id,jobStatus,,expected] of cases){
   const order=db.prepare('SELECT * FROM orders WHERE id=?').get(id);
   assert.equal(order.status,expected,id);
   assert.equal(db.prepare('SELECT status FROM production_jobs WHERE id=?').get(id).status,(['repair','ready'].includes(id)?'待交付':jobStatus),id+' migrated stage');
   if(!['repair','ready'].includes(id))assert.equal(order.updated,'original',id+' remains untouched');
  }
  assert.equal(db.prepare('SELECT count(*) AS n FROM events').get().n,2);
  assert.equal(db.prepare('SELECT order_id FROM events').get().order_id,'repair');
  integration(context);
  assert.equal(db.prepare('SELECT count(*) AS n FROM events').get().n,2,'restart is idempotent');
  db.prepare("UPDATE orders SET status='打印中',updated='original' WHERE id='repair'").run();
  db.prepare("UPDATE production_jobs SET status='待质检' WHERE id='repair'").run();
  assert.throws(()=>integration({...context,recordEvent:()=>{throw Error('audit write failed')}}),/audit write failed/);
  assert.equal(db.prepare("SELECT status FROM orders WHERE id='repair'").get().status,'打印中','failed reconciliation rolls back');
  assert.equal(db.prepare("SELECT updated FROM orders WHERE id='repair'").get().updated,'original');
  assert.equal(db.prepare('SELECT count(*) AS n FROM events').get().n,2);
  db.close();
 `;
 const child=spawnSync(process.execPath,['--input-type=module','-e',script],{
  encoding:'utf8',timeout:10000,
  env:{...process.env,COLLECTOR_STATIONS:JSON.stringify([{id:'test-station',name:'Test',factories:['清溪'],machines:['1','2','3','4','5','6'],token:'test-token-'.repeat(4)}])},
 });
 assert.equal(child.status,0,child.stderr||child.error?.message);
});
