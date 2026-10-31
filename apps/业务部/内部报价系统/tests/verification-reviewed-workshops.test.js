const test=require('node:test');
const assert=require('node:assert/strict');
const {resolveWorkshop}=require('../backend/services/verificationWorkshops');
const template=require('../backend/services/verificationWorkshopTemplate.json');
const workshop=(customer,quote_no,sections=[])=>resolveWorkshop({customer,quote_no},sections).workshop;

test('reviewed workshop mappings resolve imported customer aliases and SKU variants',()=>{
  assert.equal(workshop('JAZWARES','JWC6099(减价）'),'待分配车间');
  assert.equal(workshop('Tokidos','8281'),'华登');
  assert.equal(workshop('ToyMonster','T01685'),'华登');
  assert.equal(workshop('PWP（多美）','142BT'),'兴信A');
  assert.equal(workshop('John Adams','12091'),'兴信A');
  assert.equal(workshop('John Adams','12092_01'),'兴信A');
});

test('unconfirmed products and unreviewed suffixes stay pending',()=>{
  for(const sku of ['T03190、T03191、T03192','T03349','T03900']){
    assert.equal(workshop('ToyMonster',sku),'华登');
  }
  assert.equal(workshop('John Adams','12092_02'),'待分配车间');
  assert.equal(workshop('Other customer','12091'),'待分配车间');
});

test('current explicit assignment overrides reviewed historical workshop',()=>{
  const sections=[{dept:'sales',payload_json:JSON.stringify({workshop_assignment:{name:'兴信B'}})}];
  assert.equal(workshop('John Adams','12091',sections),'兴信B');
});

test('reviewed records have evidence and no conflicting customer/SKU assignments',()=>{
  const reviewed=template.records.filter(r=>r.reviewed_on==='2026-10-22');
  assert.equal(reviewed.length,152);
  const keys=new Set();
  for(const r of reviewed){
    const key=JSON.stringify([r.customer,r.sku]);
    assert.ok(!keys.has(key),key);keys.add(key);
    assert.ok(r.evidence.length>0);
    for(const e of r.evidence){assert.match(e.sha256,/^[a-f0-9]{64}$/);assert.ok(e.file&&e.sheet&&e.cell);}
    assert.equal(workshop(r.customer,r.sku),r.customer.toUpperCase()==='TOYMONSTER'?'华登':r.workshop==='河源'?'待分配车间':r.workshop,key);
  }
});

test('ToyMonster全部任务统一华登，其余河源分配取消且原始核价资料不改写',()=>{
 const sections=[{dept:'sales',payload_json:JSON.stringify({workshop_assignment:{name:'河源'},amount:123})}];const before=JSON.stringify(sections);
 for(const name of ['ToyMonster','TOYMONSTER','Toy Monster']) assert.equal(workshop(name,'UNKNOWN',sections),'华登');
 assert.equal(workshop('John Adams','12091',sections),'待分配车间');assert.equal(JSON.stringify(sections),before);
});
