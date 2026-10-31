const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {DatabaseSync}=require('node:sqlite'),{createRequire}=require('node:module');
const {sectionRevision}=require('../backend/services/verificationSectionSave');
function fixture(t){
 const native=new DatabaseSync(':memory:');native.exec(fs.readFileSync(path.join(__dirname,'../backend/db/schema.sql'),'utf8'));t.after(()=>native.close());
 native.exec("INSERT INTO factories(code,name_cn) VALUES('qingxi','清溪'),('other','其他');");
 ['sales','engineering','electronic','molding','painting','slush','sewing','assembly'].forEach((d,i)=>native.prepare('INSERT INTO departments(code,name_cn,sort_order,pin_staff,pin_supervisor) VALUES(?,?,?,?,?)').run(d,d,i,'unused','unused'));
 native.exec("INSERT INTO users(id,username,password_hash,display_name,dept,role,factory_code) VALUES(1,'test','unused','测试','sales','admin','qingxi');INSERT INTO user_customers(user_id,customer) VALUES(1,'ToyMonster');");
 native.prepare("INSERT INTO factory_ref_tables(factory_code,key,data_json) VALUES('qingxi','costing_basis',?)").run(JSON.stringify({exchange:{rmb_hkd:.87,hkd_usd:7.8}}));
 let failAudit=false;
 const db={prepare(sql){if(failAudit&&sql.includes("'verification_direct_create'"))throw Error('audit failure');return native.prepare(sql);},transaction:fn=>async()=>{native.exec('BEGIN');try{const r=await fn();native.exec('COMMIT');return r;}catch(e){native.exec('ROLLBACK');throw e;}}};
 function moduleAt(rel,overrides={}){const file=path.join(__dirname,'../backend',rel),real=createRequire(file),module={exports:{}};vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,require:id=>id==='../db'?db:Object.hasOwn(overrides,id)?overrides[id]:real(id)});return module.exports;}
 const auth=moduleAt('middleware/auth.js');
 const routes={};const router={use(){},get(p,...f){routes['GET '+p]=f.at(-1);},post(p,...f){routes['POST '+p]=f.at(-1);},put(p,...f){routes['PUT '+p]=f.at(-1);},patch(){},delete(){}};
 moduleAt('routes/verifications.js',{'express':{Router:()=>router},'../middleware/auth':auth});
 const quoteRoutes={};const quoteRouter={...router,get(p,...f){quoteRoutes['GET '+p]=f.at(-1);},post(){},put(){}};
 moduleAt('routes/quotes.js',{'express':{Router:()=>quoteRouter},'../middleware/auth':auth,'./mixedQuotes':{}});
 const catalog=require('../backend/permissions/menu_catalog');
 const admin={id:1,name:'测试',dept:'sales',role:'admin',active_factory_code:'qingxi',perms:{'账号管理':{can_admin:true},'报价单详情':{can_view:true,can_edit:true},[catalog.DEPT_TO_MENU.sales]:{can_view:true,can_edit:true}}};
 const call=async(key,{body={},params={},user=admin,quote=false}={})=>{const res={statusCode:200,status(n){this.statusCode=n;return this;},json(data){this.body=data;return this;}};await (quote?quoteRoutes:routes)[key]({body,params,user,query:{}},res);return res;};
 return {native,call,admin,input:{quote_no:'DIRECT-1',product_name:'直接核价产品',customer:'ToyMonster',qty:5000},setFailAudit(v){failAudit=v;}};
}
test('直接新建八部门V1使用当前基准，不生成客价确认且仅进入核价列表',async t=>{
 const f=fixture(t),created=await f.call('POST /',{body:{...f.input,quote_type:'mixed'}});assert.equal(created.statusCode,201);const id=created.body.id;
 assert.equal(f.native.prepare('SELECT count(*) n FROM quote_customer_confirmations').get().n,0);
 const detail=await f.call('GET /:quoteId',{params:{quoteId:id}});assert.equal(detail.statusCode,200);assert.equal(detail.body.quote.verification_origin,'direct');assert.equal(detail.body.sections.length,8);
 const sales=JSON.parse(detail.body.sections.find(s=>s.dept==='sales').payload_json);assert.equal(sales.header.fx_rmb_hkd,.87);assert.equal(sales.mixed_quote.enabled,true);assert.ok(detail.body.sections.every(s=>s.status==='empty'));
 const revision=require('../backend/services/verificationMetadata').payloadRevision(detail.body.sections.find(s=>s.dept==='sales'));
 assert.equal((await f.call('PUT /workshops',{body:{version_ids:[created.body.version_id],workshop:'兴信A',expected_revisions:{[created.body.version_id]:revision}}})).statusCode,400);
 assert.equal((await f.call('PUT /workshops',{body:{version_ids:[created.body.version_id],workshop:'河源',expected_revisions:{[created.body.version_id]:revision}}})).statusCode,400);
 const list=await f.call('GET /');assert.equal(list.body.rows.length,1);assert.equal(list.body.rows[0].workshop,'华登');assert.equal((await f.call('GET /',{quote:true})).body.length,0);
 const section=detail.body.sections.find(s=>s.dept==='sales');
 const saved=await f.call('PUT /versions/:versionId/sections/:sectionId',{params:{versionId:created.body.version_id,sectionId:section.id},body:{payload:sales,base_revision:sectionRevision(section),submit:true}});
 assert.equal(saved.statusCode,200);assert.equal(f.native.prepare('SELECT status FROM quote_verification_sections WHERE id=?').get(section.id).status,'filled');
});
test('权限、客户、厂区、输入和重复保护；创建失败整体回滚',async t=>{
 const f=fixture(t);
 for(const [user,body,status] of [[{...f.admin,role:'staff',dept:'sewing',perms:{}},f.input,403],[{...f.admin,role:'staff',perms:{}},{...f.input,customer:'不可见'},403],[f.admin,{...f.input,qty:-1},400],[f.admin,{...f.input,qty:1.2},400],[f.admin,{...f.input,quote_no:' '},400]])assert.equal((await f.call('POST /',{user,body})).statusCode,status);
 f.setFailAudit(true);await assert.rejects(()=>f.call('POST /',{body:f.input}),/audit failure/);assert.equal(f.native.prepare('SELECT count(*) n FROM quotes').get().n,0);
 f.setFailAudit(false);assert.equal((await f.call('POST /',{body:f.input})).statusCode,201);assert.equal((await f.call('POST /',{body:f.input})).statusCode,409);
 assert.equal((await f.call('GET /:quoteId',{params:{quoteId:1},user:{...f.admin,perms:{},role:'staff',active_factory_code:'other'}})).statusCode,403);
});
test('未确认报价仍被拦截；直接核价完成后可按新基准复制且保留已完成版本',async t=>{
 const f=fixture(t);f.native.exec("INSERT INTO quotes(quote_no,product_name,customer,factory_code) VALUES('PENDING','未确认','ToyMonster','qingxi')");assert.equal((await f.call('GET /:quoteId',{params:{quoteId:1}})).statusCode,409);
 const created=await f.call('POST /',{body:f.input}),id=created.body.id,version=created.body.version_id;
 f.native.prepare("UPDATE quote_verification_versions SET status='completed' WHERE id=?").run(version);const before=f.native.prepare('SELECT * FROM quote_verification_sections WHERE version_id=?').all(version);
 f.native.prepare('UPDATE factory_ref_tables SET data_json=?').run(JSON.stringify({exchange:{rmb_hkd:.9,hkd_usd:7.8}}));
 const next=await f.call('POST /:quoteId/versions',{params:{quoteId:id},body:{source_type:'version',source_version_id:version}});assert.equal(next.statusCode,200);
 assert.equal(JSON.parse(f.native.prepare("SELECT payload_json FROM quote_verification_sections WHERE version_id=? AND dept='sales'").get(next.body.id).payload_json).header.fx_rmb_hkd,.9);
 assert.deepEqual(f.native.prepare('SELECT * FROM quote_verification_sections WHERE version_id=?').all(version),before);assert.equal(f.native.prepare('SELECT count(*) n FROM quote_customer_confirmations').get().n,0);
});

test('Sky Castle任务只能分配华登，列表同步显示且拒绝其他车间不写入',async t=>{
 const f=fixture(t),created=await f.call('POST /',{body:{...f.input,customer:'Sky Castle'}});assert.equal(created.statusCode,201);
 const section=f.native.prepare("SELECT * FROM quote_verification_sections WHERE version_id=? AND dept='sales'").get(created.body.version_id);
 const rev=require('../backend/services/verificationMetadata').payloadRevision(section);
 const denied=await f.call('PUT /workshops',{body:{version_ids:[created.body.version_id],workshop:'兴信B',expected_revisions:{[created.body.version_id]:rev}}});
 assert.equal(denied.statusCode,400);assert.deepEqual(f.native.prepare('SELECT * FROM quote_verification_sections WHERE id=?').get(section.id),section);
 const allowed=await f.call('PUT /workshops',{body:{version_ids:[created.body.version_id],workshop:'华登',expected_revisions:{[created.body.version_id]:rev}}});
 assert.equal(allowed.statusCode,200);assert.equal((await f.call('GET /')).body.rows[0].workshop,'华登');
});
