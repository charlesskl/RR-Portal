const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
async function load(file){
 const source=fs.readFileSync(path.join(__dirname,'../src',file),'utf8');
 const out=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 return import('data:text/javascript;base64,'+Buffer.from(out).toString('base64'));
}

test('dashboard counts actual file presence, sorts updates, does not infer approval',async()=>{
 const {loadDashboard}=await load('lib/dashboard.ts');
 const source={overview:async()=>({clients:[{name:'Fixture'}]}),list:async()=>({entries:[{kind:'dir',name:'2026'},{kind:'dir',name:'other'}]}),
 projects:async()=>({projects:[{name:'B',path:'Fixture/2026/B',mtime:2},{name:'A',path:'Fixture/2026/A',mtime:3}]}),
 doctypes:async p=>({items:[{name:'One',existing:'one.xlsx'},{name:'Two',existing:p.endsWith('/A')?'two.xlsx':null}]})};
 const r=await loadDashboard(source);assert.deepEqual(r.stats,{projects:2,complete:1,incomplete:1,readiness:75});assert.equal(r.projects[0].project,'A');assert.deepEqual(r.docTypes,['One','Two']);assert.equal(r.projects[1].done,1);assert.equal('approved'in r.stats,false);
});

test('dashboard empty library has no invented completion/NaN',async()=>{
 const {loadDashboard}=await load('lib/dashboard.ts');const r=await loadDashboard({overview:async()=>({clients:[]})});
 assert.deepEqual(r.stats,{projects:0,complete:0,incomplete:0,readiness:0});assert.equal(r.projects.length,0);
});

test('dashboard partial source failure rejects instead of returning false counters',async()=>{
 const {loadDashboard}=await load('lib/dashboard.ts');
 await assert.rejects(loadDashboard({overview:async()=>({clients:[{name:'A'}]}),list:async()=>{throw Error('unavailable')}}),/unavailable/);
});

test('dashboard limits each scan stage to four concurrent requests',async()=>{
 const {loadDashboard}=await load('lib/dashboard.ts');let active=0,maximum=0;
 const step=async v=>{active++;maximum=Math.max(active,maximum);await new Promise(r=>setImmediate(r));active--;return v};
 const r=await loadDashboard({overview:async()=>({clients:Array.from({length:9},(_,i)=>({name:String(i)}))}),
 list:()=>step({entries:[{kind:'dir',name:'2026'}]}),projects:(c)=>step({projects:[{name:c,path:c+'/2026/'+c,mtime:0}]}),doctypes:()=>step({items:[]})});
 assert.equal(r.projects.length,9);assert.ok(maximum<=4);assert.equal(r.stats.complete,0);
});


test('dashboard relative times and weekly window use its existing scan timestamp without a render clock',()=>{
 const vm=require('node:vm');
 const source=fs.readFileSync(path.join(__dirname,'../src/sections/DashboardView.tsx'),'utf8');
 const tree=ts.createSourceFile('dashboard.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const fn=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='timeAgo');
 assert.ok(fn);
 const compiled=ts.transpileModule(fn.getText(tree),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const ctx=vm.createContext({Date:{now:()=>{throw Error('render clock is forbidden')}}});
 vm.runInContext(compiled,ctx);
 const scan=9*86400000;
 assert.equal(ctx.timeAgo(scan-60000,scan),'1 分钟前');
 assert.equal(ctx.timeAgo(scan-3600000,scan),'1 小时前');
 assert.equal(ctx.timeAgo(scan-2*86400000,scan),'2 天前');
 assert.equal(ctx.timeAgo(0,scan),'-');
 let week;
 const visit=n=>{if(ts.isVariableDeclaration(n)&&n.name.getText(tree)==='weekAgo')week=n.initializer.getText(tree);ts.forEachChild(n,visit)};
 visit(tree);assert.ok(week);
 assert.equal(vm.runInNewContext(week,{data:{scannedAt:scan},Date:{now:()=>{throw Error('render clock is forbidden')}}}),2*86400000);
 assert.equal((source.match(/timeAgo\([^)]*data.scannedAt\)/g)||[]).length,2);
});