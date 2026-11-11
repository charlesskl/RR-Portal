'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const test=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'server.js'),'utf8');
const block=source.slice(source.indexOf('const OCR_READ_PROMPT ='),source.indexOf('/* ── 记录表列顺序'));
function runtime(fetch, extras={}) {
  const ctx=vm.createContext({AI:{ready:true,baseURL:'https://synthetic.invalid/v1',apiKey:'synthetic',ocrModel:'synthetic'},
    console:{warn(){}},setTimeout,AbortSignal,...extras,fetch});
  vm.runInContext(block+';globalThis.extract=aiVisionExtract;',ctx);
  return()=>ctx.extract('data:image/png;base64,c3ludGhldGlj');
}
for(const stage of ['headers','body']) {
  test('provider '+stage+' cannot hold recognition forever or trigger a retry after timeout',async t=>{
    let calls=0;
    // AbortSignal timeout timers are unref'ed; this bounded handle keeps the
    // isolated test alive, without waiting the production 30-second deadline.
    const keepAlive=setTimeout(()=>{},1000);t.after(()=>clearTimeout(keepAlive));
    const extract=runtime(async(_url,{signal})=>{
      calls++;
      const stalled=()=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
      return stage==='headers'?stalled():{status:200,text:stalled};
    },{AbortSignal:{timeout:ms=>{assert.ok(ms>0&&ms<=30000);return AbortSignal.timeout(10);},any:AbortSignal.any}});
    await assert.rejects(extract(),error=>error.code==='OCR_TIMEOUT'&&/超时/.test(error.message));
    assert.equal(calls,1);
  });
}
test('the shared 60-second budget also bounds permission retries',async()=>{
  let now=1000,calls=0;
  class Clock extends Date {static now(){return now;}}
  const extract=runtime(async()=>{
    calls++;now+=60000;return{status:403,text:async()=>'AccessDenied'};
  },{Date:Clock,setTimeout:fn=>fn()});
  await assert.rejects(extract(),error=>error.code==='OCR_TIMEOUT');assert.equal(calls,1);
});
