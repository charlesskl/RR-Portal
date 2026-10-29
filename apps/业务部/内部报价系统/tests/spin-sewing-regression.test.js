const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const source = path.join(__dirname, '..');
const Tax = require(path.join(source, 'frontend/sewing-tax'));
const { buildVerificationRow } = require(path.join(source, 'backend/services/verificationSummary'));
const sections = payloads => Object.entries(payloads).map(([dept,payload]) => ({dept,payload_json:JSON.stringify(payload)}));
const sewing = {sewing_groups:[{category:'车衣',product_qty:1,labor_amount:0,items:[
 {fabric:'布料',usage:1,mat_price:5},
 {fabric:'人工',usage:1,mat_price:5}
]}]};
function originalSheetModel() {
 const cells={},groups=[];
 const add=(title,row,labels,values)=>{
  const headers=labels.map((_,i)=>'s!'+String.fromCharCode(65+i)+row);
  const amounts=headers.map(id=>id.replace(String(row),String(row+1)));
  headers.forEach((id,i)=>cells[id]={v:labels[i]});
  amounts.forEach((id,i)=>cells[id]={v:values[i]});
  groups.push({title,rows:[headers,amounts]});
 };
 add('货价与材料',1,['货价','车衣'],[30,10]);
 add('包装与外购',4,['纸箱'],[0]);
 add('人工与成本',7,['总成本','不含人工成本'],[10,10]);
 add('减税与税后结果',10,['车衣类13%'],[.115]);
 groups[3].rows.push(['s!A13']);cells['s!A13']={v:1.15};
 cells['s!K1']={v:1.15};cells['s!K2']={v:8.85};
 return {cells,groups,metrics:{price:'s!A2',total:'s!A8',no_labor:'s!B8',deduction:'s!K1',after_cost:'s!K2'}};
}
test('SPIN embedded 人工 without explicit tax setting triggers correction',()=>{
 assert.equal(Tax.fractions(sewing,'SPIN').sewing_cloth,.5);
 assert.equal(Tax.hasSetting(sewing,'SPIN'),true);
 assert.equal(Tax.hasSetting(sewing,'TOMY'),false);
});
test('SPIN original-sheet summary excludes embedded 人工 without changing cost',()=>{
 const quote={id:1,quote_no:'SEW-EDGE',product_name:'test',customer:'SPIN',qty:100,factory_code:'qingxi'};
 const ss=sections({sales:{legacy_import:{excel_model:originalSheetModel()}},sewing});
 const row=buildVerificationRow(quote,{id:1,label:'V1',status:'drafting'},ss,[{customer:'SPIN',sku:'SEW-EDGE',qty:100,source:'local-synthetic-test'}]);
 assert.equal(row.values.BM,10);
 assert.equal(row.values.CW,5);
 assert.ok(Math.abs(row.values.BN-9.425)<1e-9);
 assert.ok(Math.abs(row.values.CY-.575)<1e-9);
});
