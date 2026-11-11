'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const Auth = require('../server/auth');
const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server/server.js'), 'utf8');
const client = fs.readFileSync(path.join(root, 'maintenance.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

test('a request body cannot pass its write boundary after maintenance is enabled', async () => {
  const start = server.indexOf('function readBody(req)');
  const end = server.indexOf('\nfunction ', start + 1);
  const sandbox = { Auth, maintenanceState: () => ({ enabled: true, message: '系统修复中' }) };
  vm.createContext(sandbox); vm.runInContext(server.slice(start, end), sandbox);
  const req = new EventEmitter();
  const pending = sandbox.readBody(req);
  req.emit('data', Buffer.from('{"records":[]}')); req.emit('end');
  await assert.rejects(pending, error => error.status === 503 && /修复中/.test(error.message));
});

function browser({ initialFailed = false } = {}) {
  const nodes = Object.fromEntries(['qcMaintenance','qcMaintenanceTitle','qcMaintenanceMessage','qcMaintenanceRefresh','appWrapper','loginScreen']
    .map(id => [id, { id, hidden: false, textContent: '', inert: false }]));
  nodes.qcMaintenance.contains = target => Object.values(nodes).some(node =>
    node === target && node.id.startsWith('qcMaintenance'));
  const events = {}, calls = [], warnings = [], storage = { pendingDraft: 'original draft' };
  let enabled = false, failed = initialFailed, response = null, held = false, poll, reloads = 0;
  const s = { console:{warn:(...args)=>warnings.push(args)},window: { addEventListener() {} }, location: { pathname: '/qc/index.html', reload() { reloads++; } },
    AbortController, setTimeout() { return 1; }, clearTimeout() {}, setInterval(fn) { poll = fn; },
    document: { hidden:false,activeElement: null, getElementById: id => nodes[id] || null, addEventListener(name, fn) { (events[name] ||= []).push(fn); } },
    localStorage: { removeItem() { throw new Error('must not clear drafts'); }, getItem: key => storage[key] },
    fetch: async (url, options) => {
      calls.push({url,options}); if (failed) throw new Error('offline');
      if(held) return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));
      return response || {ok:true,json:async()=>({enabled})};
    },
  };
  Object.values(nodes).forEach(node => { node.focus = () => { s.document.activeElement = node; }; });
  vm.createContext(s); vm.runInContext(client, s);
  return { s, nodes, events, storage, calls, warnings,get reloads() {return reloads;},
    set enabled(value) { enabled = value; }, set failed(value) { failed = value; },
    set response(value) { response = value; },
    set held(value) { held = value; },
    poll: () => poll(),
  };
}
test('maintenance locks existing UI, preserves drafts and requires deliberate refresh after recovery', async () => {
  const b = browser(); await tick();
  assert.equal(b.s.window.__QC_MAINTENANCE.blocked, false);
  assert.equal(b.nodes.qcMaintenance.hidden, true);
  b.enabled = true; b.poll(); await tick();
  assert.equal(b.s.window.__QC_MAINTENANCE.blocked, true);
  assert.equal(b.nodes.appWrapper.inert, true);
  assert.equal(b.nodes.loginScreen.inert, true);
  assert.equal(b.nodes.qcMaintenanceTitle.textContent, '系统修复中');
  let prevented = 0;
  for (const name of ['click','submit','keydown']) b.events[name][0]({ target:b.nodes.appWrapper, preventDefault(){prevented++;},stopImmediatePropagation(){} });
  assert.equal(prevented, 3);
  b.enabled = false; b.poll(); await tick();
  assert.equal(b.s.window.__QC_MAINTENANCE.blocked, true);
  assert.equal(b.nodes.qcMaintenanceTitle.textContent, '修复已完成');
  assert.equal(b.nodes.qcMaintenanceRefresh.hidden, false);
  assert.equal(b.reloads, 0);
  assert.equal(b.storage.pendingDraft, 'original draft');
  assert.ok(b.calls.every(call => call.url === '/qc/api/maintenance' && call.options.cache === 'no-store'));
});

test('hiding a page cancels its pending check without reporting disconnection and resumes with a fresh check', async () => {
  const b=browser(); await tick(); b.held=true; b.poll();
  const interrupted=b.calls.at(-1).options.signal;
  b.s.document.hidden=true; b.events.visibilitychange[0](); await tick();
  assert.equal(interrupted.aborted,true);
  assert.equal(b.s.window.__QC_MAINTENANCE.blocked,false);
  assert.equal(b.warnings.length,0);
  const count=b.calls.length; b.poll(); assert.equal(b.calls.length,count);
  b.held=false; b.s.document.hidden=false; b.events.visibilitychange[0](); await tick();
  assert.equal(b.calls.length,count+1);
  assert.equal(b.nodes.qcMaintenance.hidden,true);
  assert.equal(b.storage.pendingDraft,'original draft');
  assert.equal(b.reloads,0);
});

test('real HTTP status failures retain a useful diagnostic without logging form or account data', async () => {
  const b=browser(); await tick(); b.response={ok:false,status:502}; b.poll(); await tick();
  assert.equal(b.warnings.length,1);
  assert.equal(b.warnings[0][1],'http-502');
  assert.equal(b.warnings[0][2],'/qc/api/maintenance');
  assert.equal(b.s.window.__QC_MAINTENANCE.blocked,true);
});

test('returning before cancellation settles starts a fresh check instead of leaving the poll stuck', async () => {
  const b=browser(); await tick();b.held=true;b.poll();
  const count=b.calls.length;
  b.s.document.hidden=true;b.events.visibilitychange[0]();
  b.held=false;b.s.document.hidden=false;b.events.visibilitychange[0]();
  await tick();
  assert.equal(b.calls.length,count+1);
  assert.equal(b.warnings.length,0);
  assert.equal(b.s.window.__QC_MAINTENANCE.blocked,false);
});

test('startup failures stay in the background and recovery restores available actions without reloading', async () => {
  const b = browser({ initialFailed: true });
  assert.equal(b.nodes.qcMaintenance.hidden, true, 'cached HTML is hidden before the first response');
  b.events.DOMContentLoaded.forEach(fn => fn());
  let permissionUpdates = 0;
  b.s.window.applyPermissions = () => {
    assert.equal(b.s.window.__QC_MAINTENANCE.blocked, false);
    permissionUpdates++;
  };
  await tick();
  assert.equal(b.nodes.qcMaintenance.hidden, true);
  assert.equal(b.nodes.loginScreen.inert, false);
  assert.equal(b.s.window.__QC_MAINTENANCE.blocked, true);
  b.failed = false;
  b.poll(); await tick();
  assert.equal(permissionUpdates, 1);
  assert.equal(b.s.window.__QC_MAINTENANCE.blocked, false);
  assert.equal(b.nodes.qcMaintenance.hidden, true);
  assert.equal(b.reloads, 0);
  assert.equal(b.storage.pendingDraft, 'original draft');
});

test('Tab reaches deliberate Refresh after maintenance ends, but does not refresh automatically', async () => {
  const b = browser(); b.events.DOMContentLoaded.forEach(fn => fn()); await tick();
  b.enabled = true; b.poll(); await tick();
  const tab = { target: b.nodes.appWrapper, key: 'Tab', preventDefault() {}, stopImmediatePropagation() {} };
  b.events.keydown[0](tab);
  assert.equal(b.s.document.activeElement, null, 'hidden actions cannot receive focus during maintenance');
  b.enabled = false; b.poll(); await tick();
  b.events.keydown[0](tab);
  assert.equal(b.s.document.activeElement, b.nodes.qcMaintenanceRefresh);
  assert.equal(b.s.window.__QC_MAINTENANCE.blocked, true);
  assert.equal(b.reloads, 0);
  b.nodes.qcMaintenanceRefresh.onclick();
  assert.equal(b.reloads, 1);
  assert.equal(b.storage.pendingDraft, 'original draft');
});

test('gateway maintenance HTML remains a maintenance lock until deliberate refresh after recovery', async () => {
  const b = browser(); await tick();
  b.response={ok:false,status:503,headers:{get:key=>key==='Retry-After'?'60':null},json(){throw new Error('HTML must not be parsed');}};
  b.poll(); await tick();
  assert.equal(b.nodes.qcMaintenanceTitle.textContent,'系统修复中');
  assert.equal(b.nodes.appWrapper.inert,true);
  b.response=null; b.poll(); await tick();
  assert.equal(b.nodes.qcMaintenanceTitle.textContent,'修复已完成');
  assert.equal(b.nodes.qcMaintenanceRefresh.hidden,false);
  assert.equal(b.s.window.__QC_MAINTENANCE.blocked,true);
  assert.equal(b.reloads,0);
});
test('repeated status failures pause writes without masking or intercepting an existing form', async () => {
  const b = browser(); await tick(); b.failed = true; b.poll(); await tick();
  b.poll(); await tick(); b.poll(); await tick();
  assert.equal(b.s.window.__QC_MAINTENANCE.blocked, true);
  assert.equal(b.nodes.qcMaintenance.hidden,true);
  assert.equal(b.nodes.appWrapper.inert,false);
  let prevented=0;
  for (const name of ['click','keydown']) b.events[name][0]({target:b.nodes.appWrapper,preventDefault(){prevented++;},stopImmediatePropagation(){}});
  assert.equal(prevented,0);
  assert.match(b.s.window.__QC_MAINTENANCE.message,/保存已暂停/);
  b.failed = false; b.poll(); await tick();
  assert.equal(b.s.window.__QC_MAINTENANCE.blocked, false);
  assert.equal(b.nodes.qcMaintenance.hidden, true);
  assert.equal(b.reloads,0);
  assert.equal(b.storage.pendingDraft,'original draft');
});

test('confirmed maintenance locks the page after a silent connection failure', async () => {
  const b=browser(); await tick(); b.failed=true; b.poll(); await tick();
  b.failed=false; b.enabled=true; b.poll(); await tick();
  assert.equal(b.nodes.qcMaintenance.hidden,false);
  assert.equal(b.nodes.qcMaintenanceTitle.textContent,'系统修复中');
  assert.equal(b.nodes.appWrapper.inert,true);
  b.failed=true; b.poll(); await tick();
  assert.equal(b.nodes.qcMaintenanceTitle.textContent,'系统修复中');
  assert.equal(b.nodes.qcMaintenance.hidden,false);
});

test('record save stops before reading or changing the form when connection checks have paused writes', () => {
  const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
  const start=app.indexOf('function saveRecord('),end=app.indexOf('\nfunction ',start+1);
  const messages=[],s={window:{__QC_MAINTENANCE:{blocked:true,message:'连接中断，保存已暂停，请重试'}},showToast:m=>messages.push(m)};
  vm.createContext(s);vm.runInContext(app.slice(start,end),s);
  assert.equal(s.saveRecord(),false);
  assert.deepEqual(messages,['连接中断，保存已暂停，请重试']);
});

test('maintenance blocks local persistence and retry before they can overwrite an existing pending draft', async () => {
  const prefix = 'xingxin_qms_dg-xingxin_';
  const store = new Map([[prefix+'records', '{"records":[],"nextId":31}'], [prefix+'pending_records_tester','original pending draft'], [prefix+'users','[]']]);
  const before = [...store], callbacks = [];
  let writes = 0, requests = 0;
  const guard = {blocked:true,activate(){}};
  const s = { window:{__QC_MAINTENANCE:guard,persist(){writes++;}}, location:{pathname:'/qc/'}, console:{log(){},warn(){}},
    localStorage:{getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)},
    document:{getElementById:()=>null,addEventListener:(_name,fn)=>callbacks.push(fn)},setTimeout(){},
    XMLHttpRequest:class {open(){} send(){this.status=503;} getResponseHeader(){return '1';}},
    fetch(){requests++;throw new Error('must not send');},
  };
  vm.createContext(s); vm.runInContext(fs.readFileSync(path.join(root,'qc-backend.js'),'utf8'),s);
  s.window.__QC_AUTH={user:{username:'tester'},company:'dg-xingxin',csrfToken:'synthetic'};
  callbacks.forEach(callback=>callback());
  assert.equal(s.window.persist(),false);
  assert.equal(await s.window.__QC_SYNC_NOW(),false);
  await assert.rejects(s.window.__QC_REQUEST('/api/records',{method:'POST'}),/修复中/);
  assert.equal(writes,0);assert.equal(requests,0);assert.deepEqual([...store],before);
});

for (const staleEnabled of [false, true]) {
  test('hidden cancelled successful response '+staleEnabled+' cannot change protection before a fresh check', async () => {
    const b=browser(); await tick(); b.failed=true;b.poll();await tick();
    assert.equal(b.s.window.__QC_MAINTENANCE.blocked,true);
    let resolveJson, cancelledOcr=0;
    b.s.window.__QC_OCR_CANCEL=()=>cancelledOcr++;
    b.failed=false;b.response={ok:true,json:()=>new Promise(resolve=>{resolveJson=resolve;})};
    b.poll();await tick();
    b.s.document.hidden=true;b.events.visibilitychange[0]();
    resolveJson({enabled:staleEnabled});await tick();
    assert.equal(b.s.window.__QC_MAINTENANCE.blocked,true);
    assert.equal(b.nodes.qcMaintenance.hidden,true);assert.equal(cancelledOcr,0);
    assert.equal(b.warnings.length,1);
    b.response=null;b.s.document.hidden=false;b.events.visibilitychange[0]();await tick();
    assert.equal(b.s.window.__QC_MAINTENANCE.blocked,false);
    assert.equal(b.reloads,0);assert.equal(b.storage.pendingDraft,'original draft');
  });
}
