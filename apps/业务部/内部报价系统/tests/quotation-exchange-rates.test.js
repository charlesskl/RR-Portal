const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../frontend/workbench.js'),'utf8');
const ctx=vm.createContext({});
vm.runInContext(source.slice(source.indexOf('const sectionDraftPayloads ='),source.indexOf('const shippingSummarySavers =')),ctx);
const rates=(sections,exposed)=>JSON.parse(JSON.stringify(ctx.quotationExchangeRates(sections,exposed)));
const sales=header=>({dept:'sales',payload_json:JSON.stringify(header?{header}:{})});

test('unset business header displays the same historical fallback as server calculations',()=>{
  const section=sales();
  assert.deepEqual(rates([section],{fx_rmb_hkd:.85,fx_hkd_usd:7.8}),{rmb_hkd:.85,hkd_usd:7.8});
  assert.equal(ctx.sectionDraft(section).header,undefined);
  assert.deepEqual(rates([{dept:'sales',payload_json:null}],{fx_rmb_hkd:.87,fx_hkd_usd:7.9}),{rmb_hkd:.87,hkd_usd:7.9});
});

test('saved rates and shared draft updates override stale rates supplied at page load',()=>{
  const section=sales({fx_rmb_hkd:.87,fx_hkd_usd:7.8});
  assert.equal(rates([section],{fx_rmb_hkd:.85}).rmb_hkd,.87);
  ctx.sectionDraft(section).header.fx_rmb_hkd=.89;
  ctx.sectionDraft(section).header.fx_hkd_usd=7.9;
  assert.deepEqual(rates([section],{fx_rmb_hkd:.85}),{rmb_hkd:.89,hkd_usd:7.9});
});

test('both observed hardware totals agree with backend using actual respective rates',()=>{
  const {calculateSingleQuoteCosts}=require('../backend/services/quoteCostSummary');
  const hardware=[
    {qty:1,source_currency:'USD',unit_price_usd:.00337},
    {qty:1,source_currency:'USD',unit_price_usd:.00716},
    {qty:1,source_currency:'USD',unit_price_usd:.01171},
    {qty:12,source_currency:'RMB',unit_price_rmb:.0215},
    {qty:2,source_currency:'RMB',unit_price_rmb:.0357},
  ];
  for(const [header,expected] of [[null,'0.5610'],[{fx_rmb_hkd:.87,fx_hkd_usd:7.8},'0.5521']]){
    const sections=[sales(header),{dept:'engineering',payload_json:JSON.stringify({hardware})}];
    const fx=rates(sections);
    const preview=hardware.reduce((sum,row)=>sum+row.qty*(row.source_currency==='USD'?row.unit_price_usd*fx.hkd_usd:row.unit_price_rmb/fx.rmb_hkd),0);
    assert.equal(preview.toFixed(4),expected);
    assert.equal(calculateSingleQuoteCosts({qty:5000},sections).components.hardware,preview);
  }
});

function moldingRateRefreshFixture(status) {
  const body = {
    preview: null, native: null,
    set innerHTML(_value) { this.preview = null; this.native = null; },
    querySelector(selector) {
      if (selector === 'h3') return { insertAdjacentHTML: () => {
        this.preview = { dataset: { act: 'auto-shot' }, onclick: null };
      } };
      return selector === '#btn-auto-shot' ? this.native : null;
    },
  };
  const panel = {
    querySelector: selector => selector === '.ro-body' ? body : { set outerHTML(_value) {} },
    querySelectorAll: () => body.preview ? [body.preview] : [],
  };
  const sales = { dept: 'sales', payload_json: JSON.stringify({ header: { fx_rmb_hkd: .85, fx_hkd_usd: 7.8 } }) };
  const alerts = [], renders = [];
  let nativeClicks = 0;
  const context = vm.createContext({
    c: panel, s: { id: 13, dept: 'molding', status }, sectionPayload: {},
    sections: [sales], data: { quotation_rates: { fx_rmb_hkd: .85, fx_hkd_usd: 7.8 }, engineering_molds: [] },
    quote: { qty: 10 }, me: { role: 'staff' }, id: 1, mayEdit: true,
    rateRefreshers: new Map(), saveHandlers: new Map(),
    markDirty() {}, clearDirty() {}, installDepartmentExport() {},
    renderHeader: () => '<h2>fixture</h2>', renderBar: () => '<div class="wb-bar"></div>',
    alert: message => alerts.push(message),
    renderMolding(host, _payload, edit, _changed, _molds, rate) {
      renders.push({ edit, rate });
      if (edit) host.native = { click: () => { nativeClicks++; } };
    },
  });
  vm.runInContext(source.slice(source.indexOf('const sectionDraftPayloads ='), source.indexOf('const shippingSummarySavers =')), context);
  const cleanupStart = source.indexOf('function cleanupMoldNumberObservers(');
  const cleanupEnd = source.indexOf('\nfunction renderMolds(', cleanupStart);
  assert.ok(cleanupStart >= 0 && cleanupEnd > cleanupStart);
  vm.runInContext(source.slice(cleanupStart, cleanupEnd), context);
  const start = source.indexOf("      const body = c.querySelector('.ro-body');");
  const end = source.indexOf('      host.appendChild(c);', start);
  assert.ok(start >= 0 && end > start, 'use the actual other-department rendering, rate-refresh and action callbacks');
  vm.runInContext('let inEdit = false;\n' + source.slice(start, end), context);
  return { body, sales, alerts, renders, context, nativeClicks: () => nativeClicks };
}

for (const status of ['filled', 'approved']) test(`rate redraw rebinds the actual molding preview action (${status})`, async () => {
  const f = moldingRateRefreshFixture(status);
  const original = f.body.preview;
  assert.equal(typeof original.onclick, 'function');
  f.context.sectionDraft(f.sales).header.fx_rmb_hkd = .87;
  f.context.rateRefreshers.get('molding')();
  const refreshed = f.body.preview;
  assert.notEqual(refreshed, original, 'rate redraw creates a replacement preview control');
  assert.equal(typeof refreshed.onclick, 'function', 'replacement action must receive the actual bindActs handler');
  assert.equal(f.renders.at(-1).rate, .87);
  await refreshed.onclick();
  if (status === 'approved') {
    assert.equal(f.nativeClicks(), 0);
    assert.equal(f.renders.at(-1).edit, false);
    assert.match(f.alerts[0], /已审核.*解除审核/);
  } else {
    assert.equal(f.renders.at(-1).edit, true);
    assert.equal(f.nativeClicks(), 1, 'preview event enters edit and invokes the existing native auto-shot action');
    assert.deepEqual(f.alerts, []);
  }
});
