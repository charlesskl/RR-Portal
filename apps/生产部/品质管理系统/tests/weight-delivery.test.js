'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
const start = source.indexOf('function _parseGrounding('), end = source.indexOf('/* 调用视觉模型', start);
const context = vm.createContext({});
vm.runInContext(source.slice(start, end) + '\nthis.parse = parseDeliveryNote;', context);
const parse = (s, opts) => JSON.parse(JSON.stringify(context.parse(s, opts)));
const prefix = `测试供应商贸易有限公司
补货单
客户名称：测试客户塑胶制品有限公司
客户订单编号PO.NO: TEST2026/P017
送货单号 NO: 20261110DN8033
送货日期 DELIVERY DATE 2026年11月10日\n`;
const head = '| 序号 | 产品名称 | 物料编号 | 数量/KG | 累计/KG | 备注 |\n|---|---|---|---|---|---|\n';
const rows = `| 1 | 合成蓝色轻泥299C | Example Brand—蛋糕系列 | 160 | 160 | 20KG*8箱 |
| 2 | 合成黄色轻泥109C | Example Brand—蛋糕系列 | 220 | 220 | 20KG*11箱 |
| 3 | 合成粉色轻泥232C | Example Brand—蛋糕系列 | 240 | 240 | 20KG*12箱 |
| 4 | 合成浅蓝色轻泥3265C | Example Brand—蛋糕系列 | 120 | 120 | 20KG*6箱 |
| 5 | 遮挡待核对375C | Example Brand—蛋糕系列 | 200 | 200 | 20KG*10箱 |
| 6 | 合成白色（遮挡待核对） | Example Brand—蛋糕系列 | 220 | 220 | 20KG*11箱 |`;
test('补货单准确映射表头及六条重量，需人工确认计数', () => {
 const r = parse(prefix + head + rows);
 assert.equal(r.supplier, '测试供应商贸易有限公司');
 assert.equal(r.date, '2026-11-10'); assert.equal(r.deliveryNo, '20261110DN8033'); assert.equal(r.orderNo, 'TEST2026/P017');
 assert.equal(r.items.length, 6); assert.deepEqual(r.items.map(i => i.qty), ['160','220','240','120','200','220']);
 assert.equal(r.items[0].productName, '合成蓝色轻泥299C'); assert.equal(r.items[0].productNo, 'Example Brand—蛋糕系列');
 assert.equal(r.items[0].sourceRemark, '20KG*8箱'); assert.ok(r.items.every(i => i.unit === 'KG' && i.quantityNeedsReview));
});
test('缺失数量或错列时不把累计和箱数当作数量', () => {
 const r=parse(prefix+head+'| 1 | 测试品 | 系列 |  | 160 | 20KG*8箱 |\n| 2 | 测试品2 | 系列 | 220 | 220 |');
 assert.equal(r.items.length,2); assert.ok(r.items.every(i=>!i.qty && i.quantityNeedsReview));
});
test('HTML 表格也可识别，空行不丢失后续明细', () => {
 const r=parse(prefix+'<table><tr><th>序号</th><th>产品名称</th><th>物料编号</th><th>数量/KG</th><th>累计/KG</th><th>备注</th></tr><tr><td>1</td><td>轻泥</td><td>系列</td><td>160</td><td>999</td><td>20KG*8箱</td></tr></table>');
 assert.equal(r.items[0].qty,'160'); assert.equal(r.items[0].unit,'KG');
});
test('普通单据保持原有规则', () => {
 const r=parse('测试塑胶有限公司\n送货单号: DN1234\n| 序号 | 货号 | 品名 | 数量 | 单位 |\n| 1 | A123 | 纸盒 | 500 | 个 |');
 assert.equal(r.deliveryNo,'DN1234'); assert.equal(r.items[0].qty,'500'); assert.equal(r.items[0].unit,'个');
});
test('截断的内容不当作完整单据', () => {
 const r=parse(prefix+head+rows,{truncated:true}); assert.equal(r.manualReviewRequired,true); assert.equal(r.items[0].qty,'');
});
test('公斤单据逐条应用时重量进入备注，计数留空并要求核对', () => {
 const ui = fs.readFileSync(path.join(__dirname,'../ai-ocr.js'),'utf8');
 const helper = ui.slice(ui.indexOf('  function weightRemark('), ui.indexOf('  function applyFields('));
 const queue = ui.slice(ui.indexOf('  function loadQueueItem('),ui.indexOf('  function startQueue('));
 const values = {}, calls = [];
 const fake = vm.createContext({window:{openAddModal(){}, _markOcrQuantity(v){calls.push(v)}, onQtyChange(){}, onProductNoChange(){}},
   setV(k,v){values[k]=v},setT(k,v){values[k]=v},canSaveOcr(){return true}});
 vm.runInContext(helper + queue + '\nthis.loadQueueItem = loadQueueItem;',fake);
 fake.loadQueueItem({idx:0,context:{},common:{},items:[{productNo:'系列',productName:'轻泥',qty:'160',unit:'KG',sourceRemark:'20KG*8箱',quantityNeedsReview:true}]});
 assert.equal(values.f_qty,''); assert.match(values.f_remark,/160 KG/); assert.match(values.f_remark,/20KG\*8箱/); assert.equal(calls[0],'待核对');
});
test('重量表头缺少必要列时整份保留原文，不猜测', () => {
 const r=parse(prefix+'| 序号 | 产品名称 | 数量/KG | 备注 |\n| 1 | 轻泥 | 160 | 20KG*8箱 |');
 assert.equal(r.manualReviewRequired,true); assert.equal(r.items[0].qty,''); assert.match(r.items[0].productName,/待核对原文/);
});
const plainHeader = `测试供应商贸易有限公司
补货单
客户名称
CUSTCMER: 测试客户塑胶制品有限公司
客户订单
编号PO.NO: TEST2026/P017
电话
TEL:
送货单号
NO: 20261110DN8033
送货日期: DELIVERY
DATE 2026年11月10日
序号 产品名称 物料编号 数量/KG 累计/KG 备注\n`;
test('模型实际返回的分行表头和纯文本明细可解析', () => {
 const input=plainHeader+`1 合成蓝色轻泥299C Example Brand--蛋糕系列 160 160 20KG*8箱
2 合成黄色轻泥109C Example Brand--蛋糕系列 220 220 20KG*11箱
3 合成粉色轻泥232C Example Brand--蛋糕系列 240 240 20KG*12箱
4 合成浅蓝色轻泥3265C Example Brand--蛋糕系列 120 120 20KG*6箱
5 合成粉色轻泥375C Example Brand--蛋糕系列 200 200 20KG*10箱
6 合成白色轻泥 Example Brand--蛋糕系列 220 220 20KG*11箱`;
 const r=parse(input); assert.equal(r.weightDocument,true); assert.equal(r.customer,'测试客户塑胶制品有限公司');
 assert.equal(r.supplier,'测试供应商贸易有限公司'); assert.equal(r.deliveryNo,'20261110DN8033'); assert.equal(r.orderNo,'TEST2026/P017');
 assert.equal(r.date,'2026-11-10'); assert.equal(r.items.length,6); assert.deepEqual(r.items.map(x=>x.qty),['160','220','240','120','200','220']);
 assert.equal(r.items[0].productName,'合成蓝色轻泥299C'); assert.equal(r.items[0].productNo,'Example Brand--蛋糕系列');
});
test('无法确定纯文本明细的列界时保留原行而非猜测', () => {
 const r=parse(plainHeader+'1 品名 未知系列 160 160 20KG*8箱'); assert.equal(r.items.length,1); assert.equal(r.items[0].qty,''); assert.match(r.items[0].productName,/待核对原文/);
});
