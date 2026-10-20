const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Exercise real handlers, controlling asynchronous completion and stale DOM callbacks.
class Element {
  constructor() { this.nodes = {}; this.value = ''; this.isConnected = true; this.dataset = {}; }
  set innerHTML(value) {
    this.html = value; this.nodes = {};
    const node = key => (this.nodes[key] = new Element());
    if (value.includes('data-batch-preview')) { node('input'); node('[data-batch-preview]'); node('[data-batch-format]').value = 'electronic-sheet'; }
    if (value.includes('data-batch-apply')) {
      node('[data-batch-apply]'); node('[data-batch-cancel]'); node('[data-batch-message]');
      this.targets = [...value.matchAll(/data-batch-target="(\d+)"[^>]*>[\s\S]*?<\/select>/g)].map(m => {
        const n = new Element(); n.dataset.batchTarget = m[1]; n.value = /value="([^"]+)" selected/.exec(m[0])?.[1] || ''; return n;
      });
    }
  }
  get innerHTML() { return this.html || ''; }
  set textContent(value) { this.text = value; this.nodes = {}; }
  get textContent() { return this.text || ''; }
  querySelector(key) { return this.nodes[key] || null; }
  querySelectorAll(key) { return key === '[data-batch-target]' ? this.targets || [] : []; }
  addEventListener(event, handler) { this[event] = handler; }
}
function setup(dept = 'slush') {
  const cfg = {products:[{id:'p',code:'SKU-1',name:'产品'},{id:'q',code:'SKU-2',name:'其他产品'}]};
  let config = cfg, changes = 0, applied = 0, confirmAction = () => true;
  const root = {mixed_products:{p:{note:'keep',slush_items:[{name:'原明细'}]},q:{note:'保留其他产品'}},mixed_shared:{note:'共有'}};
  const pending = new Map();
  const context = {module:{exports:{}},FormData:class {append(k,v){this[k]=v;}},
    fetch:(url, options) => new Promise(resolve => pending.set(options.body.file.name,{resolve,url})),confirm:() => confirmAction()};
  vm.runInNewContext(fs.readFileSync(require.resolve('../frontend/department-batch-import'),'utf8'), context);
  const host = new Element();
  context.module.exports.attach(host,{dept,root,config:cfg,getConfig:()=>config,totalCode:'TOTAL',onChange:()=>changes++,onApplied:()=>applied++,
    buildElectronic:(p,d)=>{p.electronics_doc=d;}});
  const input = host.querySelector('input'), preview = host.querySelector('[data-batch-preview]');
  const start = (...names) => {input.files=names.map(name=>({name,size:100}));input.value=names.join(',');return input.onchange();};
  const result = (name = '新明细') => dept==='electronic' ? {meta:{product_no:'SKU-1'},parts:[{name}],source_currency:'USD'} : {items:[{item_code:'SKU-1',name,qty:0}]};
  const finish = (name,data=result(),status=200) => pending.get(name).resolve({ok:status===200,status,json:async()=>data});
  return {root,host,input,preview,pending,start,result,finish,get changes(){return changes;},get applied(){return applied;},set config(v){config=v;},cfg,set confirmAction(v){confirmAction=v;}};
}
test('cancel and disconnected hosts invalidate captured apply callbacks',async()=>{
  for(const action of [s=>s.preview.querySelector('[data-batch-cancel]').onclick(),s=>{s.host.isConnected=false;}]) {
    const s=setup(), request=s.start('A.xlsx');s.finish('A.xlsx');await request;
    const old=s.preview.querySelector('[data-batch-apply]'),before=JSON.stringify(s.root);action(s);old.onclick();
    assert.equal(s.changes,0);assert.equal(JSON.stringify(s.root),before);assert.equal(s.input.disabled,false);
  }
});
test('latest asynchronous result alone may apply; stale completion cannot release its busy control',async()=>{
  const s=setup(),a=s.start('A.xlsx'),b=s.start('B.xlsx');s.finish('A.xlsx',s.result('旧'));await a;
  assert.equal(s.input.disabled,true);assert.equal(s.preview.querySelector('[data-batch-apply]'),null);
  s.finish('B.xlsx',s.result('新'));await b;
  const apply=s.preview.querySelector('[data-batch-apply]');apply.onclick();apply.onclick();
  assert.equal(s.changes,1);assert.equal(s.applied,1);assert.equal(s.root.mixed_products.p.slush_items[0].name,'新');
  assert.equal(s.root.mixed_products.p.note,'keep');assert.equal(s.root.mixed_products.q.note,'保留其他产品');
});
test('edits during parsing or preview and configuration replacement block stale apply',async()=>{
  for(const timing of ['parse','preview','config']) {
    const s=setup(),p=s.start('A.xlsx');
    if(timing==='parse')s.root.mixed_products.p.note='手动新修改';
    s.finish('A.xlsx');await p;
    if(timing==='preview')s.root.mixed_products.p.note='手动新修改';
    if(timing==='config')s.config={products:[{id:'changed',code:'NEW'}]};
    const before=JSON.stringify(s.root);s.preview.querySelector('[data-batch-apply]').onclick();
    assert.equal(s.changes,0);assert.equal(JSON.stringify(s.root),before);
    assert.match(s.preview.querySelector('[data-batch-message]').textContent,/已变化/);
  }
});
test('changes during confirmation also prevent overwrite',async()=>{
  const s=setup(),p=s.start('A.xlsx');s.finish('A.xlsx');await p;
  s.confirmAction=()=>{s.root.mixed_products.p.note='确认时的修改';return true;};s.preview.querySelector('[data-batch-apply]').onclick();
  assert.equal(s.root.mixed_products.p.note,'确认时的修改');assert.equal(s.changes,0);
});
test('a partial parsing failure never applies any earlier successful workbook',async()=>{
  const s=setup(),before=JSON.stringify(s.root),p=s.start('A.xlsx','B.xlsx');s.finish('A.xlsx');await new Promise(setImmediate);
  s.finish('B.xlsx',{error:'文件格式错误'},400);await p;
  assert.match(s.preview.textContent,/本批尚未应用任何资料/);assert.equal(s.preview.querySelector('[data-batch-apply]'),null);
  assert.equal(JSON.stringify(s.root),before);assert.equal(s.input.disabled,false);
});
test('format selection invalidates in-flight response and keeps newer upload busy',async()=>{
  const s=setup('electronic'),a=s.start('A.xlsx');s.host.querySelector('[data-batch-format]').value='electronic-lianxiang-sheet';
  s.host.querySelector('[data-batch-format]').change();assert.equal(s.input.disabled,false);
  const b=s.start('B.xlsx');assert.match(s.pending.get('B.xlsx').url,/electronic-lianxiang-sheet/);
  s.finish('A.xlsx');await a;assert.equal(s.input.disabled,true);
  s.finish('B.xlsx');await b;s.preview.querySelector('[data-batch-apply]').onclick();assert.equal(s.changes,1);
});
test('HTML gateway errors recover the file control and show HTTP context',async()=>{
  const s=setup(),p=s.start('A.xlsx');s.pending.get('A.xlsx').resolve({ok:false,status:502,json:async()=>{throw Error('HTML');}});await p;
  assert.match(s.preview.textContent,/HTTP 502/);assert.equal(s.input.disabled,false);assert.equal(s.changes,0);
});
