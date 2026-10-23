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
