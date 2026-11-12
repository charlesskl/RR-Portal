'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path'), vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../report_export.js'),'utf8');
const exportCode=src.slice(src.indexOf('async function exportIQCReport('),src.indexOf('/* ── 构建 IQC 画布 ── */'));
function createHarness(id,name,afterCanvas) {
  let selected=id, heading, saved=false, messages=[];
  const window={__QC_AUTH:{company:id,csrfToken:'session-one',user:{username:'fixture',enabled:true}},jspdf:{jsPDF:class {
    constructor(){this.internal={pageSize:{getWidth:()=>210,getHeight:()=>297}};}
    addImage(){} save(){saved=true;}
  }}};
  const c=vm.createContext({window,QC_COMPANIES:name ? [{id,name}] : [],getCompany:()=>selected,
    _rptCheckDeps:()=>[],_getData:()=>[{id:1,supplier:'test',date:'2026-01-01'}],
    _rptShowOverlay(){},_rptHideOverlay(){},_rptUpdateOverlay(){},_todayStr:()=> '2026-01-01',
    showToast:msg=>messages.push(msg),requestAnimationFrame:fn=>fn(),setTimeout:fn=>fn(),console:{error(){}},
    document:{body:{appendChild(){},removeChild(){}},getElementById:()=>null},
    _buildIQCCanvas:(_r,n)=>{heading=n;return {offsetWidth:794,scrollWidth:794,offsetHeight:1000}},
    html2canvas:async()=>{if(typeof afterCanvas==='function'){afterCanvas(window);}else if(afterCanvas){selected='other';window.__QC_AUTH={company:'other',user:{username:'fixture',enabled:true}};}return {width:794,height:1000,toDataURL:()=>''};},
  });
  vm.runInContext(exportCode,c);
  return {run:()=>c.exportIQCReport(1),heading:()=>heading,saved:()=>saved,messages};
}
test('IQC report follows active company, removing factory letter only',async()=>{
 for(const [id,name,expected] of [['dg-xingxin','东莞兴信','东莞兴信塑胶制品有限公司'],['dg-huadeng-a','东莞华登A','东莞华登塑胶制品有限公司'],['hy-huadeng','河源华登','河源华登塑胶制品有限公司'],['hy-huakang-d','华康D','华康塑胶制品有限公司']]) {
  const h=createHarness(id,name);await h.run();assert.equal(h.heading(),expected);assert.equal(h.saved(),true);
 }
});
test('switching company during rendering cancels the export',async()=>{
 const h=createHarness('dg-huadeng-a','东莞华登A',true);await h.run();assert.equal(h.saved(),false);assert.ok(h.messages.some(s=>s.includes('切换')));
});
test('an unrecognized company cannot produce a report',async()=>{
 const h=createHarness('unknown','');await h.run();assert.equal(h.saved(),false);
});
test('same username in a replaced session cannot finish the previous export',async()=>{
 const h=createHarness('dg-xingxin','东莞兴信',w=>{w.__QC_AUTH={...w.__QC_AUTH,user:{...w.__QC_AUTH.user}};});
 await h.run();assert.equal(h.saved(),false);assert.ok(h.messages.some(s=>s.includes('切换')));
});
test('changed CSRF token or user identity on the same auth object cancels export',async()=>{
 for(const change of [w=>{w.__QC_AUTH.csrfToken='session-two';},w=>{w.__QC_AUTH.user={...w.__QC_AUTH.user};},w=>{w.__QC_AUTH=null;}]) {
   const h=createHarness('dg-xingxin','东莞兴信',change);await h.run();assert.equal(h.saved(),false);
 }
});
