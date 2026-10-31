'use strict';
const template=require('./verificationWorkshopTemplate.json');
const Excel=require('../../frontend/excel-formulas');
const norm=v=>String(v??'').replace(/\s/g,'').replace(/（/g,'(').replace(/）/g,')').toUpperCase();
const customer=v=>({'ZANZOON(嘉苏)':'ZANZOON'}[norm(v)]||norm(v));
const sku=v=>norm(v).replace(/\(+汇率[\d.]+\)*$/,'');
const names={A:'兴信A',B:'兴信B',C:'华登',XINGXIN_A:'兴信A',XINGXIN_B:'兴信B',HUADENG:'华登',HEYUAN:'河源',兴信A:'兴信A',兴信B:'兴信B',华登:'华登',河源:'河源',待分配车间:'待分配车间'};
const workshopName=v=>names[norm(v)]||names[norm(v).replace(/车间$/,'')]||null;
const fixedWorkshop=quote=>customer(quote?.customer)==='TOYMONSTER'?'华登':null;
function resolveWorkshop(quote,sections,records=template.records){
  const fixed=fixedWorkshop(quote);
  if(fixed)return {workshop:fixed,workshop_source:'ToyMonster 核价统一分配华登'};
  const result=resolveOriginalWorkshop(quote,sections,records);
  return result.workshop==='河源'?{workshop:'待分配车间',workshop_source:'已取消河源分配；'+result.workshop_source}:result;
}
function resolveOriginalWorkshop(quote,sections,records=template.records){
  const p=JSON.parse(sections.find(s=>s.dept==='sales')?.payload_json||'{}'),legacy=p.legacy_import||{};
  // Only explicit current verification fields override the historical mapping.
  // Importer's blanket confirmation default (huadeng) is not an assignment.
  const explicit=p.workshop_assignment?.name??p.header?.workshop??legacy.workshop;
  if(explicit!=null&&explicit!=='')return {workshop:workshopName(explicit)||'待分配车间',workshop_source:'当前核价车间字段'};
  const m=legacy.excel_model,found=[];
  if(m){
    const overrides=Object.assign({},...sections.map(s=>JSON.parse(s.payload_json||'{}').excel_native?.inputs||{}));
    const evaluator=Excel.createEvaluator(m,overrides);
    const owned=new Set((m.groups||[]).flatMap(g=>(g.rows||[]).flat()));
    for(const [id,cell] of Object.entries(m.cells||{})){
      const [sheet,address]=Excel.split(id);
      if(sheet!==m.sheet||!owned.has(id)||!['车间','生产车间','所属车间','实际生产车间'].includes(norm(cell.v)))continue;
      // A label beside an explicit value is safe; free text or another product's
      // section in a multi-product sheet is not used as a default.
      const col=address.match(/^[A-Z]+/)[0],row=Number(address.match(/\d+$/)[0]);
      let ci=0;for(const c of col)ci=ci*26+c.charCodeAt(0)-64;
      let next='',v=ci+1;while(v){v--;next=String.fromCharCode(65+v%26)+next;v=Math.floor(v/26);}
      for(const ref of [`${next}${row}`,`${col}${row+1}`])try{const w=workshopName(evaluator.value(Excel.key(sheet,ref)));if(w)found.push({w,id:Excel.key(sheet,ref)});}catch{}
    }
    const ws=[...new Set(found.map(x=>x.w))];
    if(ws.length===1)return {workshop:ws[0],workshop_source:`当前核价 ${found.map(x=>x.id).join('、')}`};
    if(ws.length>1)return {workshop:'待分配车间',workshop_source:'当前核价存在多个车间，需明确分配'};
  }
  const candidates=records.filter(r=>customer(r.customer)===customer(quote.customer));
  let matches=candidates.filter(r=>sku(r.sku)===sku(quote.quote_no));
  if(!matches.length){
    // Product suffixes added to distinguish duplicate SKUs do not change the
    // assignment if every matching base SKU belongs to the same workshop.
    const base=sku(quote.quote_no).replace(/\([^()]+\)$/,'');
    matches=candidates.filter(r=>sku(r.sku)===base);
  }
  const ws=[...new Set(matches.map(r=>r.workshop))];
  return ws.length===1?{workshop:ws[0],workshop_source:`${template.source} / ${matches.map(r=>r.source).join('、')}`}:
    {workshop:'待分配车间',workshop_source:ws.length?'原附件同货号存在多个车间，需明确分配':'原附件未匹配到客户＋货号的车间'};
}
module.exports={resolveWorkshop,workshopName,fixedWorkshop};
