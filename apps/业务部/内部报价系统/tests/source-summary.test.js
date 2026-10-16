const test=require('node:test'),assert=require('node:assert/strict');
const {buildSourceRow,unifiedFromSource}=require('../backend/services/sourceSummary');
const source={fingerprint:'abc',sheet:'总表',rows:[{row:2,sku:'A1'}],columns:[{key:'B',label:'货号'},{key:'D',label:'2026接单数量'},{key:'F',label:'货价(HK$)'},{key:'G',label:'金额'},{key:'H',label:'占比'}],cells:{'总表!B2':{v:'A1'},'总表!D2':{v:3},'总表!F2':{v:4,f:'明细!A1*2'},'总表!G2':{v:12,f:'F2*D2'},'总表!H2':{v:7,t:'e',f:'1/0'},'明细!A1':{v:2}}};
function sections(value=2){return [{dept:'sales',payload_json:JSON.stringify({legacy_import:{source_fingerprint:'abc',source_file:'test.xlsx',excel_model:{cells:{'明细!A1':{v:value}}}}})}];}
test('source summaries recalculate from imported detail, preserving source constants and formula provenance',()=>{
  const n=buildSourceRow({quote_no:'A1'},sections(),[source]);assert.equal(n.current.G,12);assert.equal(n.compared,2);assert.equal(n.differences.length,0);assert.equal(n.errors[0].original,'#DIV/0!');assert.equal(n.current.H,null);assert.ok(n.inputs.includes('D'));
  const changed=buildSourceRow({quote_no:'A1'},sections(5),[source]);assert.equal(changed.current.G,30);assert.equal(changed.differences.length,2);assert.equal(changed.differences[0].sourceRecalculated,4);assert.match(changed.differences[0].reason,/系统导入/);assert.equal(source.cells['明细!A1'].v,2);
});
test('source header mapping handles shifted columns and source quantities',()=>{
  const n=buildSourceRow({quote_no:'A1'},sections(),[source]);const mapped=unifiedFromSource(n,[{key:'D',label:'实际接单数量'},{key:'E',label:'货价(HK$)'}]);assert.deepEqual(mapped.values,{D:3,E:4});assert.equal(mapped.sourceColumns.E,'F');
  assert.equal(buildSourceRow({quote_no:'absent'},sections(),[source]).available,false);
});
test('stale saved results are distinguished from imported-data discrepancies',()=>{
  const stale=structuredClone(source);stale.cells['总表!F2'].v=9;
  const n=buildSourceRow({quote_no:'A1'},sections(),[stale]);assert.match(n.differences[0].reason,/原文件现有公式/);
});
