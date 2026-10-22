const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn}=require('node:child_process');
const M=require('../frontend/mixed-molds');
test('真实保存接口保留同模机型啤次：草稿、重新读取、工程更新、提交审核和混装汇总一致',{timeout:30000},async t=>{
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'molding-parameters-'));
 const socket=net.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
 const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
 const child=spawn(process.execPath,['backend/server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,NODE_ENV:'test',DB_DRIVER:'sqlite',DB_FILE:path.join(temporary,'test.db'),DATABASE_URL:'',HOST:'127.0.0.1',PORT:String(port),SESSION_SECRET:'parameters-test-only-secret',COOKIE_SECURE:'0',ADMIN_INITIAL_PASSWORD:'parameters-test-only'},stdio:['ignore','pipe','pipe']});
 let logs='';child.stderr.on('data',chunk=>logs+=chunk);
 t.after(async()=>{if(child.exitCode===null){const ended=new Promise(resolve=>child.once('exit',resolve));child.kill();await ended;}fs.rmSync(temporary,{recursive:true,force:true});});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('start timeout: '+logs)),15000);child.stdout.on('data',chunk=>{if(String(chunk).includes('listening on')){clearTimeout(timer);resolve();}});child.once('exit',code=>{clearTimeout(timer);reject(Error('server exited '+code+': '+logs));});});
 let cookie='';
 async function api(url,method='GET',body,status=200){
  const r=await fetch(`http://127.0.0.1:${port}/api${url}`,{method,headers:{'Content-Type':'application/json',Cookie:cookie},body:body?JSON.stringify(body):undefined});
  if(r.headers.getSetCookie().length)cookie=r.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');
  const data=await r.json();assert.equal(r.status,status,JSON.stringify(data));return data;
 }
 await api('/auth/login','POST',{username:'admin',password:'parameters-test-only'});
 const quote=await api('/quotes','POST',{quote_no:'PARAM-TEST',product_name:'同模参数测试',customer:'TEST',qty:1000,quote_type:'mixed'});
 const read=()=>api('/quotes/'+quote.id);let data=await read();
 const config={...data.mixed_quote,products:[{id:'a',code:'SKU-001',name:'一',ratio:1},{id:'b',code:'SKU-002',name:'二',ratio:1}]};
 await api('/quotes/'+quote.id+'/mixed','PUT',{config,expected_config:data.mixed_quote});data=await read();
 const get=dept=>data.sections.find(s=>s.dept===dept);
 const engineering={mixed_imported_parts:[{id:'cap',name:'01-盖',mold_no:'M1',material:'ABS',weight_g:1,cavity:2,production_demand:4000,machine_model:'10A',machine:'120T',target:2400},{id:'body',name:'02-身',mold_no:'M1',material:'ABS',weight_g:2,cavity:4,production_demand:4000,machine_model:'10A',machine:'120T',target:2400}],mixed_part_selections:{a:[{part_id:'cap',usage:1}],b:[{part_id:'body',usage:1}]}};
 await api('/sections/'+get('engineering').id,'PUT',{payload:engineering,base_filled_at:get('engineering').filled_at});data=await read();
 const root=M.engineeringCatalog({machine_prices:[{model:'10A',normal:'120T',price:1000},{model:'14A',normal:'150T',price:1200}]},engineering);
 M.updateCatalogMoldField(root,root.parts_catalog.parts[0],'machine_model','14A');M.updateCatalogMoldField(root,root.parts_catalog.parts[0],'target',3600);
 const expected=M.catalogRows(root,config,1000).resolved.get('cap').shot_cost;
 const first=await api('/sections/'+get('molding').id,'PUT',{payload:root,base_filled_at:get('molding').filled_at});data=await read();
 function verify(){const payload=JSON.parse(get('molding').payload_json);for(const p of payload.parts_catalog.parts){assert.equal(p.machine_model,'14A');assert.equal(p.machine,'150T');assert.equal(p.target,3600);}assert.equal(M.catalogRows(payload,config,1000).resolved.get('cap').shot_cost,expected);return payload;}
 verify();
 // Engineering continues to update its own fields and default parameters.
 engineering.mixed_imported_parts.forEach(p=>{p.weight_g+=1;p.target=2800;p.machine_model='10A';});
 await api('/sections/'+get('engineering').id,'PUT',{payload:engineering,base_filled_at:get('engineering').filled_at});data=await read();
 const loaded=M.engineeringCatalog(verify(),engineering);assert.equal(loaded.parts_catalog.parts[0].weight_g,2);
 await api('/sections/'+get('molding').id,'PUT',{payload:loaded,submit:true,base_filled_at:get('molding').filled_at});data=await read();verify();assert.equal(get('molding').status,'filled');
 const summary=await api('/quotes/'+quote.id+'/mixed');assert.equal(summary.enabled,true);
 const persisted=JSON.parse(get('molding').payload_json);
 assert.equal(M.engineeringCatalog(persisted,engineering).parts_catalog.parts[0].target,3600);
 // The obsolete version still cannot overwrite a newly saved section.
 await api('/sections/'+get('molding').id,'PUT',{payload:root,base_filled_at:first.filled_at},409);
});
