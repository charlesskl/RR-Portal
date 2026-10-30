const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const defaultSource = fs.existsSync(path.join(__dirname, '../frontend/main.js')) ? path.join(__dirname, '../frontend/main.js') : path.join(__dirname, 'fixed/main.js');
const source = fs.readFileSync(process.env.QUOTE_UI_SOURCE || defaultSource, 'utf8');
const section = (start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'actual production handler section exists');
  return source.slice(a, b);
};
function fixture() {
  const ctx = { Set, Number, String, JSON, prompt: () => ' 误点确认 ', confirm: () => true, alerts: [], renders: 0 };
  ctx.window = ctx;
  ctx.alert = text => ctx.alerts.push(text);
  ctx.$ = () => ({ textContent: '', querySelector: () => ({ innerHTML: '' }) });
  ctx.esc = value => String(value);
  ctx.refreshQuoteFilterOptions = () => {};
  ctx.renderQuotes = () => { ctx.renders++; };
  vm.createContext(ctx);
  vm.runInContext(section('function hasPerm(', 'function requestedPageAfterLogin('), ctx);
  vm.runInContext(section('window.__allQuotes = [];', 'function refreshQuoteFilterOptions('), ctx);
  vm.runInContext(section('async function changeQuoteConfirmation(', 'async function deleteQuote('), ctx);
  ctx.__me = { dept: 'sales', role: 'staff', perms: {} };
  const q = { id: 7, customer_confirmation_status: 'confirmed', confirmation_revision: 42 };
  ctx.__allQuotes = [q];
  let revision = 42, status = 'confirmed';
  const calls = [];
  ctx.api = async (url, options) => {
    calls.push({ url, options });
    if (!options) return [{ id: 7, customer_confirmation_status: status, confirmation_revision: revision }];
    status = options.method === 'POST' ? 'pending' : JSON.parse(options.body).status;
    revision++;
    return { ok: true };
  };
  const select = (current = 'confirmed', next = 'pending', rev = '42') => ({ dataset: { id: '7', current, revision: rev, no: 'SYNTHETIC' }, value: next, disabled: false });
  return { ctx, calls, select, q };
}
test('confirmation roles match API without broadening unrelated buttons', () => {
  const {ctx} = fixture();
  for (const [me, expected] of [
    [{dept:'sales',role:'staff'},true], [{dept:'engineering',role:'admin'},true],
    [{dept:'engineering',role:'staff',perms:{'账号管理':{can_admin:true}}},true],
    [{dept:'engineering',role:'staff',perms:{}},false], [null,false],
  ]) { ctx.__me = me; assert.equal(ctx.canConfirmQuotes(), expected); }
});
test('native cancellation and blank reason produce zero writes', async () => {
  for (const reason of [null, '', '  ']) {
    const {ctx,calls,select} = fixture();ctx.prompt=()=>reason;const s=select();
    await ctx.changeQuoteConfirmation(s);assert.equal(calls.length,0);assert.equal(s.value,'confirmed');assert.equal(s.disabled,false);
  }
  const {ctx,calls,select}=fixture();ctx.confirm=()=>false;const s=select('pending','confirmed');
  await ctx.changeQuoteConfirmation(s);assert.equal(calls.length,0);assert.equal(s.value,'pending');
});
test('trim reason 300 accepted, 301 rejected, exact safe revision required', async () => {
  const {ctx,calls,select}=fixture();ctx.prompt=()=> ' '+ 'a'.repeat(300)+' ';
  await ctx.changeQuoteConfirmation(select('confirmed','pending','0'));
  assert.equal(JSON.parse(calls[0].options.body).reason.length,300);assert.equal(JSON.parse(calls[0].options.body).base_confirmation_revision,0);
  for (const rev of ['', '-1', '1.5', '9007199254740993']) {
    const f=fixture();await f.ctx.changeQuoteConfirmation(f.select('confirmed','pending',rev));assert.equal(f.calls.length,0);
  }
  const f=fixture();f.ctx.prompt=()=> 'a'.repeat(301);await f.ctx.changeQuoteConfirmation(f.select());assert.equal(f.calls.length,0);
});
test('re-rendered equivalent control cannot issue another pending mutation', async () => {
  const {ctx,calls,select}=fixture();let finish;
  ctx.api=async(url,options)=>{calls.push({url,options});if(options)await new Promise(r=>finish=r);return options?{ok:true}:[{id:7,customer_confirmation_status:'pending',confirmation_revision:43}];};
  const first=ctx.changeQuoteConfirmation(select());await Promise.resolve();
  await ctx.changeQuoteConfirmation(select());assert.equal(calls.filter(c=>c.options).length,1);
  finish();await first;assert.equal(ctx.__allQuotes[0].customer_confirmation_status,'pending');
});
test('acknowledged write survives read failure and stays guarded until fresh read', async () => {
  const {ctx,calls,select}=fixture();ctx.api=async(url,options)=>{calls.push({url,options});if(!options)throw Error('fixture read failed');return{ok:true};};
  await ctx.changeQuoteConfirmation(select());assert.equal(ctx.__allQuotes[0].customer_confirmation_status,'pending');
  assert.match(ctx.alerts[0],/已撤销.*刷新失败/);await ctx.changeQuoteConfirmation(select('pending','confirmed'));
  assert.equal(calls.filter(c=>c.options).length,1);
  ctx.api=async()=>[{id:7,customer_confirmation_status:'pending',confirmation_revision:43}];await ctx.loadQuotes();
  assert.equal(ctx.__allQuotes[0].confirmation_revision,43);
});
test('failed write is not retried and one fresh read reconciles current version', async () => {
  const {ctx,calls,select}=fixture();ctx.api=async(url,options)=>{calls.push({url,options});if(options)throw Error('状态已更新');return[{id:7,customer_confirmation_status:'pending',confirmation_revision:99}];};
  await ctx.changeQuoteConfirmation(select());assert.equal(calls.length,2);assert.equal(calls.filter(c=>c.options).length,1);
  assert.equal(ctx.__allQuotes[0].confirmation_revision,99);assert.equal(ctx.__allQuotes[0].customer_confirmation_status,'pending');assert.deepEqual(ctx.alerts,['状态已更新']);
});
test('older list success cannot replace newer status and revision', async () => {
  const {ctx}=fixture();let finishOld,call=0;
  ctx.api=async()=>++call===1?await new Promise(r=>finishOld=r):[{id:7,customer_confirmation_status:'pending',confirmation_revision:43}];
  const old=ctx.loadQuotes();await ctx.loadQuotes();finishOld([{id:7,customer_confirmation_status:'confirmed',confirmation_revision:42}]);
  assert.equal(await old,false);assert.equal(ctx.__allQuotes[0].confirmation_revision,43);
});
test('older list error cannot clear newer successful rows', async () => {
  const {ctx}=fixture();let rejectOld,call=0;
  ctx.api=async()=>++call===1?await new Promise((_,r)=>rejectOld=r):[{id:7,customer_confirmation_status:'pending',confirmation_revision:43}];
  const old=ctx.loadQuotes();await ctx.loadQuotes();rejectOld(Error('old failure'));assert.equal(await old,false);assert.equal(ctx.__allQuotes[0].confirmation_revision,43);
});
