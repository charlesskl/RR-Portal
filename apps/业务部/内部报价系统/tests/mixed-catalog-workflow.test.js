const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
test('统一模具上传、产品组成、共享改价、用量、审核及导出模拟流程', { timeout: 60000 }, async t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mixed-quotation-'));
  const socket = net.createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const child = spawn(process.execPath, ['backend/server.js'], { cwd: path.join(__dirname, '..'), env: {
    ...process.env, NODE_ENV: 'test', DB_DRIVER: 'sqlite', DB_FILE: path.join(temporary, 'test.db'),
    DATABASE_URL: '', PORT: String(port), HOST: '127.0.0.1', SESSION_SECRET: 'mixed-test-only-secret', COOKIE_SECURE: '0', ADMIN_INITIAL_PASSWORD: 'mixed-test-only',
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; child.stderr.on('data', data => { logs += data; });
  t.after(async () => { child.kill(); await new Promise(resolve => child.once('exit', resolve)); fs.rmSync(temporary, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server start timed out: ' + logs)), 15000);
    child.stdout.on('data', data => { if (String(data).includes('listening on')) { clearTimeout(timer); resolve(); } });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${logs}`)); });
  });
  let cookie = '';
  async function api(url, method = 'GET', body, status = 200) {
    const res = await fetch(`http://127.0.0.1:${port}/api${url}`, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
    if (res.headers.getSetCookie().length) cookie = res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    const json = (res.headers.get('content-type') || '').includes('json');
    const data = json ? await res.json() : Buffer.from(await res.arrayBuffer());
    assert.equal(res.status, status, `${method} ${url}: ${JSON.stringify(data)}`); return data;
  }
  await api('/auth/login', 'POST', { username: 'admin', password: 'mixed-test-only' });
  const output=path.join(__dirname,'../outputs/catalog-simulation');fs.mkdirSync(output,{recursive:true});
  const ExcelJS=require('exceljs'), wb=new ExcelJS.Workbook(), sheet=wb.addWorksheet('模具报价');
  sheet.addRow(['模号','零件名称','材质','出模数','套数','净重(g)','模价RMB']);
  for(const row of [['M1','共用盒子','PP',4,4,2,1000],['M2','A主体','PVC',2,2,1,2000],['M3','B主体','PVC',6,6,3,3000],['M4','球壳','PP',2,2,5,4000]])sheet.addRow(row);
  const file=await wb.xlsx.writeBuffer();fs.writeFileSync(path.join(output,'模拟模具报价单.xlsx'),file);
  const fd=new FormData();fd.append('file',new Blob([file]),'simulation.xlsx');
  const upload=await fetch(`http://127.0.0.1:${port}/api/uploads/mold-sheet`,{method:'POST',headers:{Cookie:cookie},body:fd});
  assert.equal(upload.status,200);const parsed=await upload.json();assert.equal(parsed.molds.length,4);
  const created=await api('/quotes','POST',{quote_no:'SIM-CATALOG-WORKFLOW',product_name:'两款共用零件＋球壳模拟',customer:'TEST',qty:1000,quote_type:'mixed'});
  let data=await api('/quotes/'+created.id);const config={...data.mixed_quote,units_per_pack:2,products:[{id:'p1',code:'A',name:'产品A'},{id:'p2',code:'B',name:'产品B'}]};
  await api('/quotes/'+created.id+'/mixed','PUT',{config,expected_config:data.mixed_quote});
  const section=dept=>data.sections.find(s=>s.dept===dept);
  const sales={mixed_quote:config,header:{fx_rmb_hkd:.9,fx_hkd_usd:7.75},shipping:{markup_x:1.1,divisor:.99},mixed_pricing:{surtax_pct:0}};
  const parts=parsed.molds.map((m,i)=>({id:'part'+i,name:m.name,mold_no:m.mold_no,material:m.material,weight_g:m.weight_g,cavity:m.cavity,loss_pct:i===3?0:3,material_unit_price:0,shot_price:0,price_pending:true}));
  const eng={mixed_imported_molds:parsed.molds,mixed_imported_parts:parts,mixed_part_selections:{p1:[{part_id:'part0',usage:1},{part_id:'part1',usage:1}],p2:[{part_id:'part0',usage:1},{part_id:'part2',usage:2}],__shared__:[{part_id:'part3',usage:1}]}};
  await api('/sections/'+section('engineering').id,'PUT',{payload:eng});
  await api('/sections/'+section('sales').id,'PUT',{payload:sales});
  let mold={mixed_products:{},mixed_shared:{},parts_catalog:{version:1,parts:parts.map((p,i)=>({...p,material_unit_price:[.1,.2,.1,.1][i],shot_price:999,machine_price:[.1,.2,.3,.1][i]*100*Number(p.cavity),target:'',production_demand:100})),selections:eng.mixed_part_selections}};
  await api('/sections/'+section('molding').id,'PUT',{payload:mold});
  assert.equal((await api('/quotes/'+created.id+'/mixed')).valid,false,'上传缺少日产啤次不得完成报价');
  await api('/sections/'+section('sales').id,'PUT',{payload:sales,submit:true},400);
  mold.parts_catalog.parts.forEach(p=>{p.price_pending=false;p.target=100;});
  await api('/sections/'+section('molding').id,'PUT',{payload:mold});
  const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
  const expectedA=.206+.1+.206+.2,expectedB=.206+.1+(.309+.3)*2,common=.5+.1;
  let result=await api('/quotes/'+created.id+'/mixed');assert.equal(result.valid,true);
  near(result.products[0].price_hkd,expectedA*1.1/.99);near(result.products[1].price_hkd,expectedB*1.1/.99);
  near(result.final_usd,(expectedA+expectedB+common)*1.1/.99/7.75);
  const baseline=result;
  // Unified edit propagates to both owners once, without double charging common shell.
  mold.parts_catalog.parts[0].machine_price*=2;
  await api('/sections/'+section('molding').id,'PUT',{payload:mold});
  result=await api('/quotes/'+created.id+'/mixed');near(result.products[0].price_hkd-baseline.products[0].price_hkd,.1*1.1/.99);near(result.products[1].price_hkd-baseline.products[1].price_hkd,.1*1.1/.99);near(result.common_usd,baseline.common_usd);
  eng.mixed_part_selections.p2[1].usage=1;
  await api('/sections/'+section('engineering').id,'PUT',{payload:eng});
  result=await api('/quotes/'+created.id+'/mixed');near(result.products[1].price_hkd,(expectedB+.1-.609)*1.1/.99);
  eng.mixed_part_selections.p1=eng.mixed_part_selections.p1.filter(p=>p.part_id!=='part0');
  await api('/sections/'+section('engineering').id,'PUT',{payload:eng});result=await api('/quotes/'+created.id+'/mixed');near(result.products[0].price_hkd,.406*1.1/.99);
  const bad=structuredClone(eng);bad.mixed_part_selections.p1=[{part_id:'missing',usage:1}];await api('/sections/'+section('engineering').id,'PUT',{payload:bad},400);
  // Restore scenario, then submit and review every department.
  eng.mixed_part_selections.p1=[{part_id:'part0',usage:1},{part_id:'part1',usage:1}];eng.mixed_part_selections.p2[1].usage=2;mold.parts_catalog.parts[0].machine_price/=2;
  await api('/sections/'+section('engineering').id,'PUT',{payload:eng});await api('/sections/'+section('molding').id,'PUT',{payload:mold});
  data=await api('/quotes/'+created.id);
  for(const s of data.sections){await api('/sections/'+s.id,'PUT',{payload:JSON.parse(s.payload_json||'{}'),submit:true});await api('/reviews/'+s.id,'POST',{action:'approve'});}
  result=await api('/quotes/'+created.id+'/mixed');near(result.final_usd,baseline.final_usd);
  for(const suffix of ['export','export-vq','export-department/molding']){const buffer=await api('/quotes/'+created.id+'/'+suffix);fs.writeFileSync(path.join(output,suffix.replaceAll('/','-')+'.xlsx'),buffer);const excel=new ExcelJS.Workbook();await excel.xlsx.load(buffer);assert.ok(excel.worksheets.length);if(suffix==='export-vq'){const row=excel.worksheets[0].getSheetValues().find(r=>r?.[1]==='每包装最终报价 USD');near(row[2].result,result.final_usd);}}
  await api('/sections/'+section('molding').id,'PUT',{payload:mold},409);
  fs.writeFileSync(path.join(output,'核对报告.json'),JSON.stringify({scenario:{productA_cost:expectedA,productB_cost:expectedB,shell_cost:common,units_per_pack:2},checks:['上传解析4副模具','工程选择共用零件及用量','未核价阻止提交','各款材料及啤工独立核算','共享改价同时更新两款','工程改用量同步汇总','取消选用不再计费','无效引用被拒绝','8部门提交审核','导出3份及客户价格核对','审核后禁止修改'],result},null,2));
});
