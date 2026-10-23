const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../frontend/workbench.js'),'utf8');
const context=vm.createContext({});
vm.runInContext(source.slice(source.indexOf('function syncMoldFromParts('),source.indexOf('function addManualMoldGroup(')),context);
const {expandEngineeringMolds}=require('../backend/services/engineeringMolds');

test('adding a part to a manual mold preserves entered data and downstream part rows',()=>{
  const mold={name:'底座',mold_no:'P05',cavity:'2*2',weight_g:1.23456789,material:'ABS',sets:2,price_rmb:500,product_group_id:'a',images:['base.png']};
  const added=context.addMoldPart(mold);
  assert.equal(mold.parts.length,2);
  assert.equal(mold.parts[0].name,'底座');assert.equal(mold.parts[0].cavity,'2*2');
  assert.equal(mold.parts[0].weight_g,1.23456789);assert.equal(mold.parts[0].images[0],'base.png');
  assert.notEqual(mold.parts[0].images,mold.images);
  added.name='支架';added.cavity='1';added.weight_g=.7654;added.images.push('bracket.png');
  context.syncMoldFromParts(mold);
  assert.equal(mold.name,'底座/支架');assert.equal(mold.cavity,'5');assert.equal(mold.price_rmb,500);
  const saved=JSON.parse(JSON.stringify({molds:[mold]}));
  const rows=expandEngineeringMolds(saved.molds);
  assert.equal(rows.length,2);assert.equal(rows[0].name,'底座');assert.equal(rows[1].name,'支架');
  assert.equal(rows[0].weight_g,1.23456789);assert.equal(rows[1].weight_g,.7654);
  for(const row of rows){assert.equal(row.mold_no,'P05');assert.equal(row.product_group_id,'a');assert.equal(row.material,'ABS');assert.equal(row.sets,2);}
});

test('blank molds can add parts; removing all parts clears stale summaries',()=>{
  const mold={images:[]};context.addMoldPart(mold);
  assert.equal(mold.parts.length,2);assert.equal(mold.parts[0].name,'');
  mold.parts[0].name='旧配件';mold.parts[0].cavity='2';mold.parts[0].weight_g=1;mold.parts[0].images=['old.png'];
  context.syncMoldFromParts(mold);mold.parts.length=0;context.syncMoldFromParts(mold);
  assert.equal(mold.name,'');assert.equal(mold.cavity,'');assert.equal(mold.weight_g,null);assert.equal(mold.images.length,0);
  context.addMoldPart(mold);assert.equal(mold.parts[0].name,'');assert.equal(mold.parts[0].images.length,0);
});
