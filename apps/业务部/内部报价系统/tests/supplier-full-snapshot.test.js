'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const ExcelJS=require('exceljs');
const parser=require('../backend/services/parseHardwareSheet');
const legacyHeader=['零件名称','用量','单价RMB'];
async function workbook(sheets){const wb=new ExcelJS.Workbook();for(const input of sheets){const ws=wb.addWorksheet(input.name);ws.addRows(input.rows);}return Buffer.from(await wb.xlsx.writeBuffer());}
const full=async sheets=>parser.parseWorkbook(await workbook(sheets),{allSheets:true,targetQty:5000});

test('full snapshot rejects a second quotation-like sheet with missing price header rather than deleting its material',async()=>{
 const sheets=[{name:'已报价包装',rows:[legacyHeader,['纸袋',1,.2]]},{name:'缺价包装',rows:[['零件名称','用量'],['彩盒',1]]}];
 const actual=await full(sheets);assert.match(actual.error||'',/表头字段不完整/);assert.equal(actual.complete_sheet_scan,undefined);
 const compatible=await parser.parseWorkbook(await workbook(sheets));assert.deepEqual(compatible.items.map(r=>r.name),['纸袋']);
});
test('single-sheet full snapshot reads actual material rows after subtotal while ordinary import keeps its previous behavior',async()=>{
 const sheets=[{name:'分组包装报价',rows:[legacyHeader,['纸袋',1,.2],['小计',null,.2],['彩盒',2,.3]]}];
 const actual=await full(sheets);assert.equal(actual.error,undefined);assert.equal(actual.complete_sheet_scan,true);assert.deepEqual(actual.items.map(r=>[r.name,r.qty,r.unit_price_rmb,r.source_sheet]),[['纸袋',1,.2,'分组包装报价'],['彩盒',2,.3,'分组包装报价']]);
 const compatible=await parser.parseWorkbook(await workbook(sheets));assert.deepEqual(compatible.items.map(r=>r.name),['纸袋']);
});
test('full snapshot reads multiple subtotals and grand totals without treating them as products',async()=>{
 const actual=await full([{name:'报价',rows:[legacyHeader,['纸袋',1,.1],['小计',null,.1],['彩盒',1,.2],['合计',null,.3],['收缩膜',1,0],['总计',null,.3]]}]);
 assert.equal(actual.error,undefined);assert.deepEqual(actual.items.map(r=>r.name),['纸袋','彩盒','收缩膜']);assert.equal(actual.unpriced_items.length,0);
});
test('full snapshot keeps missing unit price explicit as null and names the incomplete material; explicit zero remains valid',async()=>{
 const actual=await full([{name:'报价',rows:[legacyHeader,['纸袋',1,.1],['缺价彩盒',2,null],['免费膜',0,0]]}]);
 assert.equal(actual.complete_sheet_scan,true);assert.deepEqual(actual.unpriced_items.map(r=>r.name),['缺价彩盒']);assert.equal(actual.items.find(r=>r.name==='缺价彩盒').unit_price_rmb,null);assert.equal(actual.items.find(r=>r.name==='免费膜').unit_price_rmb,0);assert.equal(actual.items.find(r=>r.name==='免费膜').qty,0);
});
test('full snapshot accepts cover and text-only terms while scanning every identifiable quotation sheet',async()=>{
 const actual=await full([{name:'封面',rows:[['供应商最新报价'],['说明：以下报价按合同结算']]},{name:'五金',rows:[legacyHeader,['螺丝',1,.1]]},{name:'说明',rows:[['交期说明'],['付款条件：月结']]},{name:'包装',rows:[legacyHeader,['纸袋',1,.2]]}]);
 assert.equal(actual.error,undefined);assert.equal(actual.complete_sheet_scan,true);assert.deepEqual(actual.items.map(r=>[r.name,r.source_sheet]),[['螺丝','五金'],['纸袋','包装']]);assert.deepEqual(actual.sheets_used,['五金','包装']);
});
test('full snapshot rejects an unhandled subsequent quotation header instead of claiming a complete parse',async()=>{
 const actual=await full([{name:'多表头报价',rows:[legacyHeader,['纸袋',1,.2],legacyHeader,['彩盒',2,.3]]}]);
 assert.match(actual.error||'',/后续报价表头/);assert.equal(actual.complete_sheet_scan,undefined);
});
test('full snapshot rejects legacy detail after an explicit appendix stop',async()=>{
 const actual=await full([{name:'附注后明细',rows:[legacyHeader,['纸袋',1,.2],['附：说明'],['彩盒',2,.3]]}]);
 assert.match(actual.error||'',/附注后仍有可能的报价明细/);assert.equal(actual.complete_sheet_scan,undefined);
});
test('full snapshot rejects supplier-template detail after a footer stop',async()=>{
 const actual=await full([{name:'供应商页',rows:[['产品名称','MOQ','单价(元)不含税'],['纸袋','5K',.2],['备注说明'],['彩盒','5K',.3]]}]);
 assert.match(actual.error||'',/附注后仍有可能的报价明细/);assert.equal(actual.complete_sheet_scan,undefined);
});
test('empty quotation tables do not become a complete deletion snapshot',async()=>{
 const actual=await full([{name:'空报价',rows:[legacyHeader]}]);assert.match(actual.error||'',/未解析到/);assert.equal(actual.complete_sheet_scan,undefined);
});
