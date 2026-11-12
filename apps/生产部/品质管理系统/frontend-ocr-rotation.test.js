'use strict';
// Actual app + AI dispatch functions and button handlers in a synthetic VM DOM.
// Image/Canvas/HTTP are deterministic local doubles, not browser/pixel acceptance.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const source = name => fs.readFileSync(path.join(__dirname, name), 'utf8');
const batch = source('ocr-batch.test.js');
const browserStart = batch.indexOf('function browser(');
const browserEnd = batch.indexOf("test('mixed continue");
assert.ok(browserStart > 0 && browserEnd > browserStart);
const harness = { vm, source: name => name === 'ai-ocr.js' ? '' : source(name) };
vm.runInNewContext(batch.slice(browserStart, browserEnd) + ';this.make=browser;', harness);
const tick = () => new Promise(resolve => setImmediate(resolve));
const data = text => 'data:image/png;base64,' + Buffer.from(text).toString('base64');
const valid = (sku = 'SYNTHETIC-01') => ({ ok: true, fields: { supplier: 'Test Supplier', date: '2026-11-03',
  items: [{ productNo: sku, productName: 'Synthetic part', qty: '12' }] }, rawText: 'Synthetic transcript' });
const empty = angle => ({ ok: true, needRotate: angle, fields: { items: [] }, rawText: 'Synthetic unreadable response' });
function fixture(options = {}) {
  const b = harness.make({backend: options.backend === true}), pendingImages = [], pendingReaders = [], canvasCalls = [], requests = [], handlers = {};
  b.json = expression => JSON.parse(b.run('JSON.stringify(' + expression + ')'));
  const config = { width: 100, height: 200, ...options };
  let serial = 0;
  for (const id of ['ocrPreview','ocrStatus','ocrRawText','ocrItemsPreview','btnStartOcr','btnRotateOcr','btnApplyOcrToForm','btnParseOcrText']) {
    const node = { src: '', value: '', style: {}, textContent: '', disabled: false,
      addEventListener(event, fn) { handlers[id + ':' + event] = fn; } };
    b.elements.set(id, node);
  }
  b.ctx.__QC_AUTH = { user: { username: options.backend ? 'fixture-admin' : 'synthetic-ui-admin', enabled: true, role: 'admin' }, company: config.company || 'synthetic-company', csrfToken: 'synthetic-csrf' };
  b.ctx.__QC_COMPANY = config.company || 'synthetic-company';
  b.ctx.location.href = 'http://127.0.0.1:18361/index.html';
  b.ctx.AbortController = AbortController;
  b.ctx.FileReader = class {
    readAsDataURL(file) {
      const finish = () => this.onload({ target: { result: file.dataUrl } });
      if (config.deferReaders) pendingReaders.push(finish); else finish();
    }
  };
  b.ctx.Image = class {
    constructor() { this.width = config.width; this.height = config.height; }
    set src(value) {
      this._src = value;
      const finish = () => config.failDecode ? this.onerror() : this.onload();
      if (config.deferImages) pendingImages.push(finish); else finish();
    }
    get src() { return this._src; }
  };
  b.ctx.URL = { createObjectURL: file => file.dataUrl, revokeObjectURL() {} };
  b.ctx.document.createElement = type => {
    assert.equal(type, 'canvas');
    const row = { width: 0, height: 0, angle: 0, white: false, source: '' };
    const canvas = { width: 0, height: 0 };
    canvasCalls.push(row);
    canvas.getContext = () => config.noContext ? null : {
      fillStyle: '', fillRect() { row.white = true; }, translate() {},
      rotate(radians) { row.angle = Math.round(radians * 180 / Math.PI); },
      drawImage(image) { row.source = image.src; row.width = canvas.width; row.height = canvas.height; },
      getImageData() { return { data: new Uint8ClampedArray(4) }; }, putImageData() {},
    };
    canvas.toDataURL = () => {
      if (config.encodeThrows) throw new Error('Synthetic encoding failure');
      return config.invalidOutput || 'data:image/jpeg;base64,' + Buffer.from('synthetic-output-' + (++serial)).toString('base64');
    };
    canvas.toBlob = callback => callback({ type: 'image/png', syntheticSource: row.source, width: row.width, height: row.height });
    return canvas;
  };
  const responses = [];
  b.ctx.__QC_REQUEST = async (route, request) => {
    if (route === '/api/session') return { ok: true, status: 200, json: async () => ({ user: {...b.ctx.__QC_AUTH.user}, companies: [b.ctx.__QC_COMPANY], csrfToken: b.ctx.__QC_AUTH.csrfToken }) };
    if (route === '/api/ai/status') return { ok: true, status: 200, json: async () => ({ ready: !config.local }) };
    requests.push({ route, ...request, body: JSON.parse(request.body) });
    if (config.post) return config.post(route, request);
    const response = responses.length ? responses.shift() : valid();
    return { ok: true, status: 200, json: async () => response };
  };
  const unpatchedStart = b.ctx.startOcr;
  vm.runInContext(source('ai-ocr.js'), b.ctx);
  const upload = (label = 'first') => {
    const file = { type: 'image/png', size: 100, dataUrl: data(label), label };
    b.ctx.handleOcrFile(file); return file;
  };
  const rotate = () => handlers['btnRotateOcr:click']({ preventDefault() {} });
  const value = id => b.elements.get(id).value;
  const preview = () => b.elements.get('ocrPreview').src;
  const status = () => b.elements.get('ocrStatus').textContent;
  const controls = () => ['btnStartOcr','btnRotateOcr','btnApplyOcrToForm'].map(id => b.elements.get(id).disabled);
  return { b, config, responses, pendingImages, pendingReaders, canvasCalls, requests, upload, rotate, value, preview, status, controls, unpatchedStart };
}

test('manual rotations are bounded, white-backed, use the immutable original and commit the actual local input', async () => {
  const x = fixture({ width: 16000, height: 12000 });
  const file = x.upload();
  for (const angle of [90,180,270,0]) {
    await x.rotate();
    const row = x.canvasCalls.at(-1);
    assert.equal(row.source, file.dataUrl); assert.equal(row.angle, angle);
    assert.ok(row.width > 0 && row.height > 0 && row.width <= 2000 && row.height <= 2000);
    assert.equal(row.white, true);
    assert.equal(x.b.run('_ocrImageFile'), x.preview());
    assert.equal(x.b.ctx.__QC_OCR_IMAGE.snapshot().angle, angle);
  }
  assert.deepEqual(x.controls(), [false,false,false]);
});

test('AI retries use distinct absolute directions from the original, and no-items exhaustion preserves edits and queue', async () => {
  for (const [hint,angles] of [[90,[0,270,90]],[270,[0,90,270]],[180,[0,180]]]) {
    const x = fixture(); const file = x.upload();
    x.b.elements.get('ocrProductNo').value = 'CORRECTED';
    x.b.elements.get('ocrQty').value = '111';
    const prior = { common: { supplier: 'Test Supplier' }, items: [{ productNo: 'CORRECTED', qty: '111' }] };
    const queue = { items: [{ productNo: 'QUEUE' }], idx: 0 };
    x.b.ctx.__qcAiResult = prior; x.b.ctx.__qcQueue = queue;
    x.responses.push(empty(hint),empty(hint),empty(hint));
    await x.b.ctx.startOcr();
    assert.deepEqual(x.canvasCalls.map(row => row.angle), angles);
    assert.ok(x.canvasCalls.every(row => row.source === file.dataUrl));
    assert.equal(x.requests.length, angles.length);
    assert.equal(x.value('ocrProductNo'), 'CORRECTED'); assert.equal(x.value('ocrQty'), '111');
    assert.equal(x.b.ctx.__qcAiResult, prior); assert.equal(x.b.ctx.__qcQueue, queue); assert.equal(queue.idx, 0);
    assert.equal(x.preview(), file.dataUrl); assert.match(x.status(), /未识别到货品/);
    assert.ok(!x.b.messages.some(message => message.type === 'success'));
  }
});

test('successful auto-rotation commits the same image sent to AI and preserves manual-review rows without fake success', async () => {
  const x = fixture(); x.upload();
  x.responses.push(empty(90), { ok: true, needsManualReview: true, rawText: 'FULL SYNTHETIC RAW', fields: {
    supplier: 'Test Supplier', items: [{ productNo: '', productName: '待核对原行：Synthetic', qty: '', quantityNeedsReview: true }],
  } });
  x.b.ctx.openAddModal(); await x.b.ctx.startOcr();
  assert.equal(x.b.ctx.__QC_OCR_IMAGE.snapshot().angle, 270);
  assert.equal(x.preview(), x.requests.at(-1).body.image);
  assert.equal(x.value('ocrRawText'), 'FULL SYNTHETIC RAW'); assert.match(x.status(), /人工核对/);
  x.b.ctx.applyOcrToForm();
  assert.equal(x.b.ctx.saveRecord(), false); assert.deepEqual(x.b.json('state.records'), []);
  assert.equal(x.value('ocrProductName'), '');
  assert.equal(x.value('f_productName'), '');
  x.b.elements.get('f_productName').value = '人工核对配件';
  x.b.elements.get('f_qty').value = '12';
  assert.equal(x.b.ctx.saveRecord(), true);
  assert.deepEqual(x.b.json('state.records.map(r=>[r.productName,r.qty,r.status])'), [['人工核对配件',12,'pending']]);
});

test('normal recognized rows still replace missing metadata and persist all queue items once', async () => {
  const x = fixture(); x.upload();
  for (const id of ['ocrDate','ocrOrderNo','ocrDeliveryNo']) x.b.elements.get(id).value = 'STALE';
  x.responses.push({ok:true,fields:{supplier:'Test Supplier',items:[
    {productNo:'0012',productName:'',qty:'20',orderNo:'PO-A'},
    {productNo:'0013',productName:'Synthetic B',qty:'30',orderNo:'PO-B'},
  ]}});
  x.b.ctx.openAddModal(); await x.b.ctx.startOcr();
  for (const id of ['ocrDate','ocrDeliveryNo']) assert.equal(x.value(id),'');
  assert.equal(x.value('ocrOrderNo'),'PO-A');
  x.b.ctx.applyOcrToForm();
  assert.equal(x.b.ctx.saveRecord(),true); assert.equal(x.b.ctx.saveRecord(),true);
  assert.deepEqual(x.b.json('state.records.map(r=>[r.productNo,r.productName,r.qty,r.orderNo,r.date])'),
    [['0012','',20,'PO-A','2026-10-21'],['0013','Synthetic B',30,'PO-B','2026-10-21']]);
  assert.equal(x.b.ctx.__qcQueue,null);
});

test('rotation failure never changes the image, fields or success status', async () => {
  for (const config of [{failDecode:true},{width:0},{height:NaN},{noContext:true},{invalidOutput:'data:,'},{encodeThrows:true}]) {
    const x = fixture(config); const original = x.upload();
    x.b.elements.get('ocrProductNo').value = 'KEEP';
    await x.rotate();
    assert.equal(x.preview(), original.dataUrl); assert.equal(x.value('ocrProductNo'),'KEEP');
    assert.match(x.status(), /旋转失败/); assert.ok(!/已旋转/.test(x.status()));
    assert.equal(x.b.ctx.__QC_OCR_IMAGE.snapshot().angle,0); assert.deepEqual(x.controls(),[false,false,false]);
  }
});

test('rapid rotation clicks are serialized; upload and clear invalidate pending image completions', async () => {
  const x = fixture({deferImages:true}); x.upload();
  const old = x.rotate(); await x.rotate();
  assert.equal(x.pendingImages.length,1); assert.deepEqual(x.controls(),[true,true,true]);
  const fresh = x.upload('fresh');
  const newer = x.rotate(); assert.equal(x.pendingImages.length,2);
  x.pendingImages.shift()(); await old;
  assert.equal(x.preview(),fresh.dataUrl); assert.deepEqual(x.controls(),[true,true,true]);
  x.b.ctx.clearOcr(); x.pendingImages.shift()(); await newer;
  assert.equal(x.preview(),''); assert.deepEqual(x.controls(),[false,false,false]);
  assert.equal(x.canvasCalls.length,0);
});

test('out-of-order upload readers cannot overwrite the accepted new image or cross login/company', () => {
  const x = fixture({deferReaders:true}); x.upload('old'); const fresh = x.upload('fresh');
  x.pendingReaders[1](); x.pendingReaders[0](); assert.equal(x.preview(),fresh.dataUrl);
  x.upload('other-user'); x.b.ctx.__QC_AUTH = {user:{username:'another-user'}}; x.pendingReaders[2]();
  assert.equal(x.preview(),''); assert.equal(x.b.ctx.__QC_OCR_IMAGE.snapshot(),null);
  x.upload('other-company'); x.b.ctx.__QC_COMPANY = 'other-company'; x.pendingReaders[3]();
  assert.equal(x.preview(),''); assert.equal(x.b.ctx.__QC_OCR_IMAGE.snapshot(),null);
});

test('closed modal, changed login and changed company reject delayed manual rotation', async () => {
  for (const change of [x=>x.b.ctx.closeModalDirect(), x=>{x.b.ctx.__QC_AUTH={user:{username:'other'}};}, x=>{x.b.ctx.__QC_COMPANY='other';}]) {
    const x = fixture({deferImages:true}); const original = x.upload();
    const op = x.rotate(); change(x); x.pendingImages.shift()(); await op;
    assert.equal(x.preview(),original.dataUrl); assert.equal(x.canvasCalls.length,0);
    assert.ok(!/已旋转/.test(x.status())); assert.deepEqual(x.controls(),[false,false,false]);
  }
});

test('obsolete status and POST completions never publish old fields or enable a newer operation', async () => {
  const x = fixture(); x.upload('old'); let finishOld;
  x.config.post = () => new Promise(resolve => {finishOld=resolve;});
  const old = x.b.ctx.startOcr(); await tick();
  assert.equal(x.requests.length,1);
  const oldSignal=x.requests[0].signal;
  const fresh = x.upload('fresh'); x.config.deferImages=true;
  assert.equal(oldSignal.aborted,true);
  const newer = x.rotate();
  finishOld({ok:true,status:200,json:async()=>valid('OLD-USER-SKU')}); await old;
  assert.equal(x.value('ocrProductNo'),''); assert.equal(x.preview(),fresh.dataUrl);
  assert.deepEqual(x.controls(),[true,true,true]);
  x.pendingImages.shift()(); await newer;
  assert.deepEqual(x.controls(),[false,false,false]);
});

test('POST failure and pure empty response preserve the same-image manual correction', async () => {
  for (const failure of ['http','empty','invalid-angle']) {
    const x = fixture(); x.upload(); x.b.elements.get('ocrProductNo').value='MANUAL';
    if (failure === 'http') x.config.post=async()=>({ok:false,status:503,json:async()=>({error:'Synthetic unavailable'})});
    else x.responses.push(empty(failure==='invalid-angle'?45:0));
    await x.b.ctx.startOcr();
    assert.equal(x.value('ocrProductNo'),'MANUAL'); assert.equal(x.requests.length,1);
    assert.match(x.status(), /识别失败/); assert.deepEqual(x.controls(),[false,false,false]);
  }
});

test('an unready server never invokes browser OCR and preserves the rotated image, edits and queue', async () => {
  const x=fixture({local:true}); x.upload(); await x.rotate();
  const rotated=x.preview(), queue={items:[{productNo:'KEEP'}],idx:0};
  x.b.ctx.__qcQueue=queue; x.b.elements.get('ocrRawText').value='KEEP RAW';
  x.b.elements.get('ocrProductNo').value='MANUAL'; let localCalls=0;
  x.b.ctx.Tesseract={recognize:async()=>{localCalls++;throw new Error('Browser engine must not run');}};
  x.b.ctx.__origStartOcr=()=>{localCalls++;};
  await x.b.ctx.startOcr();
  assert.equal(localCalls,0); assert.equal(x.requests.length,0);
  assert.equal(x.preview(),rotated); assert.equal(x.value('ocrRawText'),'KEEP RAW');
  assert.equal(x.value('ocrProductNo'),'MANUAL'); assert.equal(x.b.ctx.__qcQueue,queue);
  assert.match(x.status(),/识别服务暂不可用/); assert.deepEqual(x.controls(),[false,false,false]);
});


test('server recovery retries through the same endpoint and result application stays within its login', async () => {
  const x=fixture({local:true}); x.upload(); await x.b.ctx.startOcr();
  assert.equal(x.requests.length,0);
  x.config.local=false; x.responses.push(valid()); await x.b.ctx.startOcr();
  assert.equal(x.requests.length,1); assert.equal(x.requests[0].route,'/api/ai/ocr-extract');
  assert.equal(x.value('ocrProductNo'),'SYNTHETIC-01');
  x.b.ctx.__QC_AUTH={user:{username:'other'}};
  const before=x.value('f_productNo'); assert.equal(x.b.ctx.applyOcrToForm(),false); assert.equal(x.value('f_productNo'),before);
  assert.match(x.b.messages.at(-1).message,/登录已改变/);
});


test('delayed AI availability check is discarded before sending an obsolete image', async () => {
  const x=fixture(); x.upload('old'); let statusResponse;
  const original=x.b.ctx.__QC_REQUEST;
  x.b.ctx.__QC_REQUEST=route=>route==='/api/ai/status'
    ? new Promise(resolve=>{statusResponse=resolve;}) : original(route);
  const op=x.b.ctx.startOcr();
  const fresh=x.upload('fresh');
  statusResponse({ok:true,status:200,json:async()=>({ready:true})}); await op;
  assert.equal(x.requests.length,0); assert.equal(x.preview(),fresh.dataUrl);
  assert.equal(x.value('ocrProductNo'),''); assert.deepEqual(x.controls(),[false,false,false]);
});

test('late POST or JSON parsing across logout/company/close cannot mutate fields or queue', async () => {
  for (const change of [x=>{x.b.ctx.__QC_AUTH=null;},x=>{x.b.ctx.__QC_COMPANY='other';},x=>x.b.ctx.closeModalDirect()]) {
    const x=fixture(); x.upload(); let complete;
    x.config.post=async()=>({ok:true,status:200,json:()=>new Promise(resolve=>{complete=resolve;})});
    x.b.elements.get('ocrProductNo').value='MANUAL';
    const queue={items:[{productNo:'Q'}],idx:0}; x.b.ctx.__qcQueue=queue;
    const op=x.b.ctx.startOcr(); await tick(); change(x);
    const expectedQueue=x.b.ctx.__qcQueue;
    complete(valid('SHOULD-NOT-APPLY')); await op;
    assert.equal(x.value('ocrProductNo'),'MANUAL'); assert.equal(x.b.ctx.__qcQueue,expectedQueue);
    assert.equal(queue.idx,0); assert.deepEqual(x.controls(),[false,false,false]);
  }
});

test('apply during processing or after an empty new upload cannot clear the existing quantity review guard', async () => {
  const x=fixture({deferImages:true}); x.upload();
  x.b.elements.get('f_qty').value=''; x.b.ctx._markOcrQuantity('待核对');
  const op=x.rotate();
  assert.equal(x.b.ctx.applyOcrToForm(),false);
  assert.equal(x.b.elements.get('f_qty').dataset.ocrNeedsReview,'1');
  x.b.ctx.clearOcr(); x.pendingImages.shift()(); await op;
  assert.equal(x.b.ctx.applyOcrToForm(),false);
  assert.equal(x.b.elements.get('f_qty').dataset.ocrNeedsReview,'1');
});

test('an obsolete server response cannot clear the newer upload result', async () => {
  const x=fixture(); x.upload('old'); let finish;
  x.config.post=()=>new Promise(resolve=>{finish=resolve;});
  const old=x.b.ctx.startOcr(); await tick(); x.upload('new');
  x.config.post=null; x.responses.push(valid('NEW-SKU')); await x.b.ctx.startOcr();
  finish({ok:true,status:200,json:async()=>valid('OLD-SKU')}); await old;
  assert.equal(x.requests.length,2); assert.equal(x.value('ocrProductNo'),'NEW-SKU');
  assert.deepEqual(x.controls(),[false,false,false]);
});


test('unusable mixed/empty payloads do not silently drop rows or apply partial fields', async () => {
  for (const items of [[{}],[{productNo:'GOOD',qty:'12'},null]]) {
    const x=fixture(); x.upload(); x.b.elements.get('ocrProductNo').value='KEEP';
    x.responses.push({ok:true,fields:{items}}); await x.b.ctx.startOcr();
    assert.equal(x.value('ocrProductNo'),'KEEP'); assert.match(x.status(),/识别失败/);
    assert.equal(x.b.ctx.__qcAiResult,null);
  }
});


test('decode timeout releases controls and an eventual onload cannot commit a failed rotation', async () => {
  const x=fixture({deferImages:true}); const original=x.upload(); let timeout;
  x.b.ctx.setTimeout=(fn,delay)=>{if(delay===15000)timeout=fn;};
  const op=x.rotate(); assert.equal(typeof timeout,'function'); timeout(); await op;
  assert.match(x.status(),/解码超时/); assert.equal(x.preview(),original.dataUrl);
  assert.deepEqual(x.controls(),[false,false,false]);
  x.pendingImages.shift()(); await tick();
  assert.equal(x.preview(),original.dataUrl); assert.equal(x.canvasCalls.length,0);
});

test('applying a new image replaces all OCR-source fields and saves none of the previous document identity', async () => {
  const x=fixture(); x.b.ctx.openAddModal(); x.upload('A');
  x.responses.push({ok:true,fields:{supplier:'Test Supplier',date:'2026-11-01',orderNo:'PO-OLD',deliveryNo:'DN-OLD',
    items:[{productNo:'OLD',productName:'OLD NAME',qty:'12'}]}});
  await x.b.ctx.startOcr(); x.b.elements.get('ocrRemark').value='OLD REMARK'; x.b.ctx.applyOcrToForm();
  x.b.elements.get('f_inspDate').value='2026-10-31';
  x.b.elements.get('f_client').value='MANUAL-CLIENT'; x.b.run("getCustomerOptions=()=>['MANUAL-CLIENT'];");
  x.upload('B'); x.responses.push({ok:true,fields:{supplier:'Test Supplier',items:[{productNo:'NEW',productName:'',qty:'34'}]}});
  await x.b.ctx.startOcr(); x.b.ctx.applyOcrToForm();
  assert.equal(x.b.ctx.saveRecord(),true);
  assert.deepEqual(x.b.json('state.records.map(r=>[r.productNo,r.productName,r.orderNo,r.deliveryNo,r.qty,r.date,r.remark,r.client,r.inspDate])'),
    [['NEW','','','',34,x.b.run('todayStr()'),'','MANUAL-CLIENT','2026-10-31']]);
});

async function appliedQueue(x) {
  x.upload('queue');
  x.responses.push({ok:true,fields:{supplier:'Test Supplier',date:'2026-11-03',items:[
    {productNo:'A-1',productName:'A one',qty:'12'}, {productNo:'A-2',productName:'A two',qty:'34'},
  ]}});
  await x.b.ctx.startOcr(); x.b.ctx.applyOcrToForm(); return x.b.ctx.__qcQueue;
}

test('an applied multi-item OCR queue cannot write or advance after logout, identity or company changes', async () => {
  for (const change of [x=>{x.b.ctx.__QC_AUTH=null;},x=>{x.b.ctx.__QC_AUTH={user:{username:'user-B'},company:'synthetic-company'};},
    x=>{x.b.ctx.__QC_COMPANY='other-company';}]) {
    const x=fixture(),q=await appliedQueue(x),before=x.b.store.get('xingxin_qms_test_records');
    change(x);
    assert.equal(x.b.ctx.saveRecord(),false); assert.equal(x.b.ctx.saveRecord({continueEntry:true}),false);
    assert.equal(q.idx,0); assert.equal(x.b.ctx.__qcQueue,q); assert.equal(x.value('f_productNo'),'A-1');
    assert.deepEqual(x.b.json('state.records'),[]); assert.equal(x.b.store.get('xingxin_qms_test_records'),before);
  }
});

test('an applied single OCR record cannot be saved under a later login or company', async () => {
  for (const change of [x=>{x.b.ctx.__QC_AUTH={user:{username:'user-B'}};},x=>{x.b.ctx.__QC_COMPANY='other-company';}]) {
    const x=fixture(); x.b.ctx.openAddModal(); x.upload(); await x.b.ctx.startOcr(); x.b.ctx.applyOcrToForm();
    change(x); assert.equal(x.b.ctx.saveRecord(),false); assert.deepEqual(x.b.json('state.records'),[]);
    assert.equal(x.value('f_productNo'),'SYNTHETIC-01');
  }
});

test('same-identity ordinary save advances an OCR queue despite close cleanup, then continuation finishes it exactly once', async () => {
  const x=fixture(),q=await appliedQueue(x),owner=q.context;
  assert.equal(x.b.ctx.saveRecord(),true); assert.equal(q.idx,1); assert.equal(x.b.ctx.__qcQueue,q);
  assert.equal(x.b.ctx.__qcOcrFormContext,owner); assert.equal(x.value('f_productNo'),'A-2');
  assert.equal(x.b.ctx.saveRecord({continueEntry:true}),true); assert.equal(x.b.ctx.__qcQueue,null);
  assert.deepEqual(x.b.json('state.records.map(r=>[r.productNo,r.qty])'),[['A-1',12],['A-2',34]]);
  assert.ok(x.b.json('state.records.every(r=>!("context" in r)&&!("auth" in r))'));
});

test('identity change during a user confirmation is rechecked before actual record persistence', async () => {
  const x=fixture(),q=await appliedQueue(x);
  x.b.elements.get('f_sampleQty').value='999'; x.b.elements.get('f_sampleQty').dataset.manualEdit='1';
  x.b.ctx.confirm=()=>{x.b.ctx.__QC_AUTH={user:{username:'user-B'}};return true;};
  assert.equal(x.b.ctx.saveRecord(),false); assert.deepEqual(x.b.json('state.records'),[]);
  assert.equal(q.idx,0); assert.equal(x.b.ctx.__qcQueue,q); assert.equal(x.value('f_productNo'),'A-1');
});

test('closing a suspended OCR form and starting a deliberate manual record clears only the old OCR owner guard', async () => {
  const x=fixture(); await appliedQueue(x); x.b.ctx.__QC_AUTH={user:{username:'user-B'}};
  x.b.ctx.closeModalDirect(); x.b.ctx.openAddModal();
  x.b.elements.get('f_supplier').value='Test Supplier'; x.b.elements.get('f_productNo').value='MANUAL-NEW';
  x.b.elements.get('f_qty').value='12';
  assert.equal(x.b.ctx.saveRecord(),true);
  assert.deepEqual(x.b.json('state.records.map(r=>r.productNo)'),['MANUAL-NEW']);
});


test('a real same-session refresh preserves the applied queue after synchronization, while a new CSRF session is rejected', async () => {
  const x=fixture({backend:true,company:'dg-xingxin'}),q=await appliedQueue(x);
  assert.equal(x.b.ctx.saveRecord(),true); assert.equal(q.idx,1);
  await x.b.ctx.__QC_SYNC_NOW();
  const previous=x.b.ctx.__QC_AUTH;
  await x.b.ctx.__QC_REFRESH_SESSION();
  assert.notEqual(x.b.ctx.__QC_AUTH,previous); assert.equal(x.b.ctx.__QC_AUTH.csrfToken,previous.csrfToken);
  assert.equal(x.b.ctx.saveRecord(),true); assert.equal(q.idx,2); assert.equal(x.b.ctx.__qcQueue,null);
  await x.b.ctx.__QC_SYNC_NOW();
  assert.deepEqual(x.b.json('state.records.map(r=>r.productNo)'),['A-1','A-2']);
  assert.ok(x.b.requests.some(r=>r.body.records.some(row=>row.productNo==='A-2')));
  const second=fixture({backend:true,company:'dg-xingxin'}),oldQueue=await appliedQueue(second);
  second.b.ctx.__QC_AUTH={...second.b.ctx.__QC_AUTH,csrfToken:'new-login-csrf'};
  assert.equal(second.b.ctx.saveRecord(),false);assert.equal(oldQueue.idx,0);assert.deepEqual(second.b.json('state.records'),[]);
});

test('same-session refresh during rotation/recognition is accepted, but same username with a new CSRF token is obsolete', async () => {
  const x=fixture({backend:true,company:'dg-xingxin',deferImages:true}); x.upload();
  const rotating=x.rotate(); await x.b.ctx.__QC_REFRESH_SESSION();
  x.pendingImages.shift()(); await rotating; assert.match(x.status(),/已旋转/);
  x.config.deferImages=false; let complete;
  x.config.post=async()=>({ok:true,status:200,json:()=>new Promise(resolve=>{complete=resolve;})});
  const recognizing=x.b.ctx.startOcr(); await tick(); await x.b.ctx.__QC_REFRESH_SESSION();
  complete(valid('AFTER-REFRESH')); await recognizing; assert.equal(x.value('ocrProductNo'),'AFTER-REFRESH');
  x.upload('second');const obsolete=x.b.ctx.startOcr();await tick();
  x.b.ctx.__QC_AUTH={...x.b.ctx.__QC_AUTH,csrfToken:'different-login'};
  complete(valid('SHOULD-NOT-APPLY'));await obsolete;assert.equal(x.value('ocrProductNo'),'');
});


test('manual fallback keeps the exact original response image and angle after every hinted orientation fails', async () => {
  const x=fixture();x.upload();
  const pending={ok:true,needRotate:90,rawText:'COMPLETE FIRST ORIENTATION RAW',fields:{supplier:'Test Supplier',
    items:[{productNo:'',productName:'待核对原文：complete source row',qty:'',quantityNeedsReview:true}]}};
  x.responses.push(pending,empty(90),empty(90));
  await x.b.ctx.startOcr();
  assert.deepEqual(x.canvasCalls.map(r=>r.angle),[0,270,90]);assert.equal(x.requests.length,3);
  assert.equal(x.preview(),x.requests[0].body.image);assert.notEqual(x.preview(),x.requests.at(-1).body.image);
  assert.equal(x.b.ctx.__QC_OCR_IMAGE.snapshot().angle,0);assert.equal(x.value('ocrRawText'),pending.rawText);
  assert.match(x.status(),/人工核对/);assert.equal(x.b.ctx.__qcAiResult.items[0].productName,pending.fields.items[0].productName);
  x.b.ctx.openAddModal();x.b.ctx.applyOcrToForm();assert.equal(x.b.ctx.saveRecord(),false);
  x.b.elements.get('f_productName').value='人工核对配件';
  x.b.elements.get('f_qty').value='12';assert.equal(x.b.ctx.saveRecord(),true);
  assert.equal(x.b.json('state.records[0].qty'),12);assert.deepEqual(x.controls(),[false,false,false]);
});

test('an explicit manual result without a rotation hint is retained without inventing another model call', async () => {
  const x=fixture();x.upload();const pending={ok:true,needsManualReview:true,rawText:'EXPLICIT MANUAL RAW',fields:{
    supplier:'Test Supplier',items:[{productName:'待核对原文：unpositioned supplier row',qty:'',quantityNeedsReview:true}]}};
  x.responses.push(empty(90),pending,valid('MUST-NOT-REPLACE-MANUAL'));
  await x.b.ctx.startOcr();assert.equal(x.requests.length,2);assert.equal(x.preview(),x.requests[1].body.image);
  assert.equal(x.b.ctx.__QC_OCR_IMAGE.snapshot().angle,270);assert.equal(x.value('ocrRawText'),pending.rawText);
  assert.equal(x.b.ctx.__qcAiResult.items.length,1);assert.match(x.status(),/人工核对/);
});

test('valid and manual rows remain together after a successful rotation instead of dropping the uncertain row', async () => {
  const x=fixture();x.upload();x.responses.push(empty(90),{ok:true,rawText:'BOTH FULL ROWS',fields:{supplier:'Test Supplier',items:[
    {productNo:'EXACT',productName:'exact row',qty:'12'},
    {productNo:'',productName:'待核对原行：uncertain row',qty:'',quantityNeedsReview:true},
  ]}});
  await x.b.ctx.startOcr();assert.equal(x.requests.length,2);assert.equal(x.b.ctx.__qcAiResult.items.length,2);
  assert.equal(x.b.ctx.__qcAiResult.items[1].quantityNeedsReview,true);assert.match(x.status(),/人工核对/);
});

test('an unavailable or malformed AI status never silently invokes the local OCR engine', async () => {
  for (const failure of ['network','auth','maintenance','invalid']) {
    const x=fixture();x.upload();await tick();let localCalls=0;
    x.b.elements.get('ocrProductNo').value='KEEP-CORRECTION';
    x.b.ctx.Tesseract={recognize:async()=>{localCalls++;return{data:{text:'数量：999'}};}};
    x.b.ctx.__QC_REQUEST=async()=>{
      if(failure==='network')throw new TypeError('Failed to fetch');
      if(failure==='invalid')return{ok:true,status:200,json:async()=>({})};
      return{ok:false,status:failure==='auth'?401:503};
    };
    await x.b.ctx.startOcr();
    assert.equal(localCalls,0);assert.equal(x.requests.length,0);
    assert.equal(x.value('ocrProductNo'),'KEEP-CORRECTION');
    assert.match(x.status(),/无法检查 AI/);
    assert.ok(!x.b.messages.some(message=>message.type==='success'));
  }
});
test('missing server integration cannot activate a browser engine through the app entry', async () => {
  const x=fixture(); x.upload(); let localCalls=0;
  x.b.ctx.Tesseract={recognize:async()=>{localCalls++;}};
  x.b.elements.get('ocrProductNo').value='MANUAL'; x.b.elements.get('ocrRawText').value='KEEP RAW';
  await x.unpatchedStart();
  assert.equal(localCalls,0); assert.equal(x.requests.length,0);
  assert.equal(x.value('ocrProductNo'),'MANUAL'); assert.equal(x.value('ocrRawText'),'KEEP RAW');
  assert.match(x.status(),/识别服务未加载/);
  assert.ok(!source('index.html').includes('vendor/tesseract/tesseract.min.js'));
});


test('reparsing existing text uses only the server parser without any image/model request', async()=>{
  const x=fixture(); x.upload();
  const original='订单号 货号 型号 配件名称 颜色 数量 单位 本单送货数/\n本单欠数 箱数 备注\nPO-A 9298 MODEL–01 配件上壳 蓝 80 PCS 120 6';
  x.b.elements.get('ocrRawText').value=original;
  x.b.ctx.__QC_REQUEST=async(route,options)=>{
    assert.equal(route,'/api/ai/ocr-parse');assert.deepEqual(JSON.parse(options.body),{text:original});
    return{ok:true,json:async()=>({ok:true,fields:{deliveryNo:'3000123',items:[{orderNo:'PO-A',productNo:'9298',model:'MODEL-01',productName:'配件上壳',color:'蓝',qty:'80',unit:'PCS'}]}})};
  };
  assert.equal(await x.b.ctx.reparseOcrText(),true);
  assert.equal(x.requests.length,0);assert.equal(x.canvasCalls.length,0);
  assert.equal(x.value('ocrProductNo'),'9298');assert.equal(x.value('ocrProductName'),'配件上壳');
  assert.equal(x.value('ocrOrderNo'),'PO-A');assert.equal(x.value('ocrQty'),'80');
  assert.match(x.value('ocrRemark'),/MODEL-01.*蓝/);assert.equal(x.value('ocrRawText'),original);
  x.b.ctx.invalidateOcrText();assert.equal(x.b.ctx.applyOcrToForm(),false);
});
test('a text response from an older image or login cannot replace fields', async()=>{
  for(const invalidate of [x=>x.upload('another'),x=>{x.b.ctx.__QC_AUTH=null;}]) {
    const x=fixture();x.upload();let finish;
    x.b.elements.get('ocrRawText').value='合成原文';
    x.b.ctx.__QC_REQUEST=()=>new Promise(resolve=>{finish=resolve;});
    const pending=x.b.ctx.reparseOcrText();invalidate(x);
    finish({ok:true,json:async()=>({ok:true,fields:{items:[{productNo:'OLD',productName:'old',qty:'80'}]}})});
    assert.equal(await pending,false);assert.notEqual(x.value('ocrProductNo'),'OLD');
  }
});


test('editing the original text invalidates a pending server recognition without losing the correction', async () => {
  const x=fixture(); x.upload(); let finish;
  x.config.post=()=>new Promise(resolve=>{finish=resolve;});
  const pending=x.b.ctx.startOcr(); await tick();
  x.b.elements.get('ocrRawText').value='MANUAL NEW TEXT';
  x.b.elements.get('ocrProductNo').value='MANUAL-SKU'; x.b.ctx.invalidateOcrText();
  finish({ok:true,status:200,json:async()=>valid('STALE-SKU')}); await pending;
  assert.equal(x.value('ocrRawText'),'MANUAL NEW TEXT'); assert.equal(x.value('ocrProductNo'),'MANUAL-SKU');
  assert.equal(x.b.ctx.__qcOcrTextNeedsParsing,true); assert.match(x.status(),/原文已修改/);
  assert.equal(x.b.ctx.applyOcrToForm(),false);
});


test('maintenance cancellation invalidates server OCR and permits a fresh result after recovery', async () => {
  const x=fixture(); x.upload(); let finish;
  x.config.post=()=>new Promise(resolve=>{finish=resolve;});
  const pending=x.b.ctx.startOcr(); await tick();
  x.b.elements.get('ocrRawText').value='KEEP ORIGINAL'; x.b.elements.get('ocrProductNo').value='KEEP-SKU';
  const originalImage=x.preview();
  x.b.ctx.window.addEventListener=()=>{}; x.b.ctx.document.addEventListener=()=>{};
  x.b.ctx.setInterval=()=>1; x.b.ctx.fetch=async()=>({ok:true,json:async()=>({enabled:true})});
  vm.runInContext(source('maintenance.js'),x.b.ctx); await tick();
  assert.equal(x.b.ctx.__QC_MAINTENANCE.blocked,true);
  finish({ok:true,status:200,json:async()=>valid('STALE-SKU')}); await pending;
  assert.equal(x.value('ocrRawText'),'KEEP ORIGINAL'); assert.equal(x.value('ocrProductNo'),'KEEP-SKU');
  assert.equal(x.preview(),originalImage);
  x.b.ctx.__QC_MAINTENANCE.blocked=false; x.b.ctx.invalidateOcrText();
  x.config.post=null; x.responses.push(valid('FRESH-SKU')); await x.b.ctx.startOcr();
  assert.equal(x.value('ocrProductNo'),'FRESH-SKU'); assert.equal(x.b.ctx.__qcOcrTextNeedsParsing,false);
  assert.match(x.status(),/AI 识别完成/);
});


test('different browser engine availability renders identical server columns for identical raw text', async () => {
  const fields={deliveryNo:'DN-SYNTH',items:[
    {orderNo:'PO-SYNTH',productNo:'SKU-SYNTH',productName:'甲身体',qty:'40',unit:'PCS',color:'',deliveryBalance:'',cartons:'4',remark:'4*10'},
    {orderNo:'PO-SYNTH',productNo:'SKU-SYNTH',productName:'乙身体',qty:'16',unit:'PCS',color:'',deliveryBalance:'',cartons:'1',remark:''}
  ]};
  const rawText='|订单号|货号|配件名称|颜色|数量|单位|本单送货数/本单欠数|箱数|备注|\n|PO-SYNTH|SKU-SYNTH|甲身体||40|PCS||4|4*10|\n|||乙身体||16|PCS||1||';
  const previews=[];
  for(const enginePresent of [true,false]) {
    const x=fixture(); x.upload();
    x.b.ctx.Tesseract=enginePresent?{recognize:()=>{throw new Error('Browser OCR must not run');}}:undefined;
    x.responses.push({ok:true,fields:JSON.parse(JSON.stringify(fields)),rawText}); await x.b.ctx.startOcr();
    assert.equal(x.requests.length,1); assert.equal(x.requests[0].route,'/api/ai/ocr-extract');
    assert.equal(x.value('ocrRawText'),rawText);
    const firstPreview=x.b.elements.get('ocrItemsPreview').innerHTML;
    x.b.ctx.__QC_REQUEST=async(route,options)=>{
      assert.equal(route,'/api/ai/ocr-parse'); assert.deepEqual(JSON.parse(options.body),{text:rawText});
      return{ok:true,json:async()=>({ok:true,fields:JSON.parse(JSON.stringify(fields))})};
    };
    await x.b.ctx.reparseOcrText();
    assert.equal(x.b.elements.get('ocrItemsPreview').innerHTML,firstPreview);
    assert.match(firstPreview,/<td>40<\/td><td>PCS<\/td><td>—<\/td><td>4<\/td><td>4\*10<\/td>/);
    assert.match(firstPreview,/<td>16<\/td><td>PCS<\/td><td>—<\/td><td>1<\/td><td>—<\/td>/);
    previews.push(firstPreview);
  }
  assert.equal(previews[0],previews[1]);
});

for(const stalledAt of ['status','fetch','body']) {
  test('a stalled '+stalledAt+' times out, preserves edits and queue, and ignores late completion after a retry', async()=>{
    const x=fixture(); x.upload(); let timeout, finish;
    const image=x.preview(), queue={items:[{productNo:'QUEUED'}],idx:0};
    x.b.ctx.__qcQueue=queue; x.b.elements.get('ocrProductNo').value='MANUAL';
    x.b.elements.get('ocrRawText').value='KEEP RAW';
    x.b.ctx.setTimeout=(fn,delay)=>{if(delay===90000)timeout=fn;};
    if(stalledAt==='status') {
      const request=x.b.ctx.__QC_REQUEST;
      x.b.ctx.__QC_REQUEST=(route,options)=>route==='/api/ai/status'
        ?new Promise(resolve=>{finish=resolve;}):request(route,options);
    } else x.config.post=stalledAt==='fetch'
      ?()=>new Promise(resolve=>{finish=resolve;})
      :async()=>({ok:true,status:200,json:()=>new Promise(resolve=>{finish=resolve;})});
    const request=x.b.ctx.__QC_REQUEST;
    const pending=x.b.ctx.startOcr(); await tick(); assert.equal(typeof timeout,'function');
    timeout(); await pending;
    assert.match(x.status(),/等待超时/); assert.deepEqual(x.controls(),[false,false,false]);
    assert.equal(x.preview(),image); assert.equal(x.value('ocrProductNo'),'MANUAL');
    assert.equal(x.value('ocrRawText'),'KEEP RAW'); assert.equal(x.b.ctx.__qcQueue,queue);
    if(stalledAt==='status') {
      x.b.ctx.__QC_REQUEST=async(route,options)=>route==='/api/ai/status'
        ?{ok:true,status:200,json:async()=>({ready:true})}:request(route,options);
    }
    x.config.post=null; x.responses.push(valid('RETRIED-SKU')); await x.b.ctx.startOcr();
    assert.equal(x.value('ocrProductNo'),'RETRIED-SKU');
    finish(stalledAt==='status'?{ok:true,json:async()=>({ready:true})}:
      stalledAt==='fetch'?{ok:true,status:200,json:async()=>valid('STALE-SKU')}:valid('STALE-SKU'));
    await tick(); assert.equal(x.value('ocrProductNo'),'RETRIED-SKU');
    assert.deepEqual(x.controls(),[false,false,false]);
  });
}

test('bilingual document PO and delivery numbers stay separate when the server result enters the single-record form',async()=>{
  const server=source('server/server.js'),context=vm.createContext({});
  vm.runInContext(server.slice(server.indexOf('const OCR_READ_PROMPT ='),server.indexOf('/* ── 记录表列顺序'))+';this.parse=parseDeliveryNote;',context);
  const rawText='客户订单\n编号PO.NO: PO2026/S019\n送货单号\nNO: 20261112HD0123\n|货号|品名|数量|单位|\n|SKU001|合成甲零件|80|KG|\n|SKU002|合成乙零件|100|KG|';
  const fields=JSON.parse(JSON.stringify(context.parse(rawText)));
  const x=fixture();x.upload();x.responses.push({ok:true,fields,rawText});await x.b.ctx.startOcr();
  assert.equal(x.value('ocrDeliveryNo'),'20261112HD0123');assert.equal(x.value('ocrOrderNo'),'PO2026/S019');
  x.b.ctx.applyOcrToForm();
  assert.equal(x.value('f_deliveryNo'),'20261112HD0123');assert.equal(x.value('f_orderNo'),'PO2026/S019');
  assert.equal(x.value('f_qty'),'80');assert.equal(x.value('f_productNo'),'SKU001');
});

test('six wrapped contract numbers remain complete and row-specific through save-and-continue',async()=>{
  const server=source('server/server.js'),context=vm.createContext({});
  vm.runInContext(server.slice(server.indexOf('const OCR_READ_PROMPT ='),server.indexOf('/* ── 记录表列顺序'))+';this.parse=parseDeliveryNote;',context);
  const rawText='|NO|合同编号|客户订单号|品名规格|物料编号|单位|数量|备品数|重量kg|\n'+
    Array.from({length:6},(_,i)=>'|'+(i+1)+'|PO202600'+(i<3?'1<br>7-01':'2<br>1-01')+'||合成吊牌|SKU00'+i+'|PCS|'+(i?'10000':'20000')+'|100|20|').join('\n');
  const fields=JSON.parse(JSON.stringify(context.parse(rawText)));fields.supplier='Test Supplier';
  const x=fixture();x.upload();x.responses.push({ok:true,fields,rawText});await x.b.ctx.startOcr();x.b.ctx.applyOcrToForm();
  const expected=['PO20260017-01','PO20260017-01','PO20260017-01','PO20260021-01','PO20260021-01','PO20260021-01'];
  for(let i=0;i<6;i++) {
    assert.equal(x.value('f_orderNo'),expected[i]);assert.equal(x.value('f_productNo'),'SKU00'+i);
    assert.equal(x.value('f_qty'),i?'10000':'20000');x.b.ctx.saveRecord({continueEntry:true});
  }
  assert.deepEqual(x.b.json('state.records.map(r=>r.orderNo)'),expected);
  assert.equal(x.b.ctx.__qcQueue,null);
});

test('unresolved truncated contract PO cannot be silently saved or advance the queue; manual correction or explicit NA is preserved',async()=>{
  const fields={supplier:'Test Supplier',date:'2026-11-12',items:[0,1].map(i=>({productNo:'SKU00'+i,productName:'合成吊牌',qty:'1000',unit:'PCS',orderNo:'FDJA2026123',orderNoNeedsReview:true}))};
  const x=fixture();x.upload();x.responses.push({ok:true,fields,rawText:'合成原文',needsManualReview:true});await x.b.ctx.startOcr();
  assert.match(x.b.elements.get('ocrItemsPreview').innerHTML,/需核对完整编号/);x.b.ctx.applyOcrToForm();
  assert.equal(x.b.ctx.saveRecord({continueEntry:true}),false);assert.equal(x.b.ctx.__qcQueue.idx,0);
  assert.equal(x.b.json('state.records.length'),0);assert.match(x.b.messages.at(-1).message,/PO.*缺少换行/);
  x.b.elements.get('f_orderNo').value='FDJA20261237-01';assert.equal(x.b.ctx.saveRecord({continueEntry:true}),true);
  assert.equal(x.b.ctx.__qcQueue.idx,1);assert.equal(x.b.ctx.saveRecord(),false);
  x.b.elements.get('f_orderNo').value='NA';assert.equal(x.b.ctx.saveRecord(),true);
  assert.deepEqual(x.b.json('state.records.map(r=>r.orderNo)'),['FDJA20261237-01','NA']);
  x.b.ctx.closeModalDirect();x.b.ctx.openAddModal();assert.equal(x.b.ctx.__qcOcrOrderReview,null);
});
test('a single unresolved contract PO also requires correction before saving',async()=>{
  const x=fixture();x.upload();x.responses.push({ok:true,needsManualReview:true,rawText:'合成原文',fields:{supplier:'Test Supplier',date:'2026-11-12',items:[{productNo:'SKU001',productName:'合成吊牌',qty:'1000',orderNo:'FDJA2026123',orderNoNeedsReview:true}]}});
  await x.b.ctx.startOcr();x.b.ctx.applyOcrToForm();assert.equal(x.b.ctx.saveRecord(),false);
  x.b.elements.get('f_orderNo').value='FDJA20261237-01';assert.equal(x.b.ctx.saveRecord(),true);
  assert.equal(x.b.json('state.records[0].orderNo'),'FDJA20261237-01');
});
