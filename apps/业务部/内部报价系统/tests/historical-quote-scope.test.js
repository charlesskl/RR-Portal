const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {DatabaseSync}=require('node:sqlite');
const source=fs.readFileSync(path.join(__dirname,'../backend/routes/summary.js'),'utf8');
function setup(){
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE quotes(id INTEGER PRIMARY KEY,quote_no TEXT,customer TEXT,factory_code TEXT,deleted_at TEXT);
 CREATE TABLE quote_sections(quote_id INTEGER,dept TEXT,payload_json TEXT);
 CREATE TABLE quote_verifications(quote_id INTEGER,origin TEXT);
 CREATE TABLE user_customers(user_id INTEGER,customer TEXT);
 INSERT INTO quotes VALUES (1,'ORDINARY-A','A','qingxi',NULL),(2,'HISTORY-A','A','qingxi',NULL),(3,'ORDINARY-B','B','qingxi',NULL),(4,'DIRECT-A','A','qingxi',NULL);
 INSERT INTO quote_verifications VALUES(4,'direct');
 INSERT INTO quote_sections VALUES (1,'sales','{}'),(2,'sales','{"legacy_import":{"summary_only":true}}'),(3,'sales','{}');
 INSERT INTO user_customers VALUES (1,'A');`);
 const ctx=vm.createContext({db});
 vm.runInContext(source.slice(source.indexOf('const HIDE_IMPORTED_VERIFICATIONS'),source.indexOf('async function workshopOptions')),ctx);
 vm.runInContext(source.slice(source.indexOf('async function accessibleQuoteRows'),source.indexOf('async function loadRows')),ctx);
 return {db,ctx};
}
test('quotation summary excludes historical valuation imports for administrators',async()=>{
 const {db,ctx}=setup();try{assert.deepEqual((await ctx.accessibleQuoteRows({role:'admin',active_factory_code:'qingxi'})).map(r=>r.quote_no),['ORDINARY-A','ORDINARY-B']);}finally{db.close();}
});
test('quotation summary preserves employee customer scope while excluding historical imports',async()=>{
 const {db,ctx}=setup();try{assert.deepEqual((await ctx.accessibleQuoteRows({id:1,role:'staff',active_factory_code:'qingxi'})).map(r=>r.quote_no),['ORDINARY-A']);}finally{db.close();}
});
