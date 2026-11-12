'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server/server.js'), 'utf8');
const ai = fs.readFileSync(path.join(root, 'ai-ocr.js'), 'utf8');
const ctx = vm.createContext({});
vm.runInContext(server.slice(server.indexOf('const OCR_READ_PROMPT ='), server.indexOf('/* ── 记录表列顺序')), ctx);
const parse = text => JSON.parse(JSON.stringify(ctx.parseDeliveryNote(text)));
const header = '订单号 货号 配件名称 颜色 数量 单位 本单送货数/本单欠数 箱数 备注';
const rows = ['BP2026123-PN001 666玩具公仔 大身前后 兰 1981 PCS 1981/2019 8',
  'BP2026123-PN001 666玩具公仔 右脚 兰 630 PCS 630/3370 1'];
const documentText = content => '合成供应商有限公司\n送货单\nNO: 3000123\n2026年11月9日\n' + content;

test('component sheet splits PO, alphanumeric/CJK SKU, component name and exact current quantity', () => {
  const result = parse(documentText([header, ...rows, '钙箱: 9', '收货人: 测试'].join('\n')));
  assert.equal(result.deliveryNo, '3000123');
  assert.equal(result.orderNo, 'BP2026123-PN001');
  assert.deepEqual(result.items, [
    {orderNo:'BP2026123-PN001',productNo:'666玩具公仔',productName:'大身前后',qty:'1981',unit:'PCS',color:'兰',deliveryBalance:'1981/2019',cartons:'8',remark:''},
    {orderNo:'BP2026123-PN001',productNo:'666玩具公仔',productName:'右脚',qty:'630',unit:'PCS',color:'兰',deliveryBalance:'630/3370',cartons:'1',remark:''},
  ]);
});
test('a positioned table of the same layout keeps the quantity column apart from owed quantity and cartons', () => {
  const result = parse(documentText('|订单号|货号|配件名称|颜色|数量|单位|本单送货数/本单欠数|箱数|备注|\n|BP2026123-PN001|666玩具公仔|右脚|兰|630|PCS|630/3370|1||'));
  assert.equal(result.items.length,1);
  assert.equal(result.items[0].productNo,'666玩具公仔');
  assert.equal(result.items[0].productName,'右脚');
  assert.equal(result.items[0].qty,'630');
});
test('conflicting quantity or missing columns keeps complete source instead of guessing from owed/carton numbers', () => {
  for (const row of [rows[0].replace('1981/2019', '1982/2019'), rows[0].replace('1981 PCS', 'unreadable PCS'), rows[0].replace('666玩具公仔 ', '')]) {
    const result = parse(documentText(header + '\n' + row));
    assert.equal(result.items.length,1);
    assert.equal(result.items[0].quantityNeedsReview,true);
    assert.equal(result.items[0].qty,'');
    assert.equal(result.items[0].productName,'待核对原文：'+row);
  }
});
test('different row orders do not leak the first order into the whole sheet', () => {
  const result = parse(documentText(header+'\n'+rows[0]+'\n'+rows[1].replace('BP2026123-PN001','BP2026123-PN002')));
  assert.equal(result.orderNo,'');
  assert.deepEqual(result.items.map(row=>row.orderNo),['BP2026123-PN001','BP2026123-PN002']);
});
function fn(name) {
  const start=ai.indexOf('  function '+name+'(');
  const end=ai.indexOf('\n  function ', start+1);
  return ai.slice(start,end);
}
test('manual source text stays in the review result and never becomes the product name in preview or queued form', () => {
  const values={}, item={productName:'待核对原行：complete synthetic row',qty:'',quantityNeedsReview:true};
  const s={window:{},setV:(k,v)=>{values[k]=v;},canonName:(_t,v)=>v,toast(){},setT(){},canSaveOcr:()=>true,
    document:{getElementById:()=>null}};
  vm.createContext(s);vm.runInContext(fn('weightRemark')+'\n'+fn('applyFields')+'\n'+fn('loadQueueItem'),s);
  s.applyFields({supplier:'synthetic',items:[item]});
  assert.equal(values.ocrProductName,'');
  assert.match(s.window.__qcAiResult.items[0].productName,/待核对原行/);
  s.loadQueueItem({idx:0,items:[item],common:{}});
  assert.equal(values.f_productName,'');
  assert.equal(values.f_qty,'');
});
test('network failure reports a connection problem and leaves edited fields untouched', () => {
  const values={ocrProductName:'corrected'}, messages=[];
  const s={stillCurrent:()=>true,setT:(k,v)=>{values[k]=v;},toast:v=>messages.push(v)};
  vm.createContext(s);vm.runInContext(fn('operationFailure'),s);
  s.operationFailure({},new TypeError('Failed to fetch'),'AI 识别失败');
  assert.match(values.ocrStatus,/无法连接识别服务/);
  assert.equal(values.ocrProductName,'corrected');
  assert.equal(messages.length,1);
});

test('model-column layout uses the actual quantity, preserving model separately from SKU and component name', () => {
  const head=header.replace('货号 配件名称','货号 型号 配件名称');
  const text=documentText(head+'\nCB2026123-BU001 9298 MODEL-A01 配件上壳 87275-粉红色 80 PCS 120 6 15*6\nCB2026123-BU001 9298 MODEL-A01 配件下壳 87275-粉红色 80 PCS 120 4 20*4\nCB2026123-BU001 9298 MODEL-B02 左耳朵 珠光白 120 PCS 80 12 12*10\n胶箱：22');
  const result=parse(text);
  assert.equal(result.items.length,3);
  assert.equal(result.items[0].deliveryBalance,'120');assert.equal(result.items[0].cartons,'6');assert.equal(result.items[0].remark,'15*6');
  assert.deepEqual(result.items.map(item=>[item.productNo,item.model,item.productName,item.qty]),[
    ['9298','MODEL-A01','配件上壳','80'],['9298','MODEL-A01','配件下壳','80'],['9298','MODEL-B02','左耳朵','120'],
  ]);
});

test('wrapped header and typographic code dashes preserve seven goods rows, not footer or remark fragments', () => {
  const names=['配件上壳','配件下壳','蛋形下壳','杯下壳','圆圈上壳','左耳朵','右耳朵'];
  for(const dash of ['-','–','－']) {
    const body=names.map((name,i)=>`CB2026123${dash}BU001 9298 MODEL${dash}02M${dash}01 ${name} 87275${dash}粉红色 ${i<5?9000:21000} PCS ${i<5?21000:9000} 6 1500*6`).join('\n');
    const raw=documentText('订单号 货号 型号 配件名称 颜色 数量 单位 本单送货数/\n本单欠数 箱数 备注\n'+body+'\n0\n胶箱：65 钙箱：纸箱：\n平卡：胶袋：\n收货人：QC：送货人：合成姓名');
    const parsed=parse(raw);
    assert.equal(parsed.items.length,7);
    assert.deepEqual(parsed.items.map(row=>[row.orderNo,row.productNo,row.model,row.productName,row.qty]),names.map((name,i)=>['CB2026123-BU001','9298','MODEL-02M-01',name,String(i<5?9000:21000)]));
    assert.ok(parsed.items.every(row=>!row.quantityNeedsReview));
  }
});

test('mold-number headers map all seven rows and exclude wrapped headers and packing footers', () => {
  for (const modelHeader of ['模号', '模號', '型号', '型號']) {
    const names=['配件上壳','配件下壳','蛋形下壳','杯下壳','圆圈上壳','左耳朵','右耳朵'];
    const rows=names.map((name,i)=>`CB2026123-BU001 9298 MODEL-02M-01 ${name} 87275-粉红色 ${i<5?9000:21000} PCS ${i<5?21000:9000} ${i<5?6:21} ${i<5?'1500*6':'21*1000'}`);
    const result=parse(documentText(`订单号 货号 ${modelHeader} 配件名称 颜色 数量 单位 本单送货数/\n本单欠数 箱数 备注\n${rows.join('\n')}\n胶箱: 65 钙箱: 纸箱:\n平卡: 胶袋: 卡板: 吸塑:\n收货人: QC: 送货人: 合成姓名`));
    assert.equal(result.items.length,7,modelHeader);
    assert.deepEqual(result.items.map(item=>[item.orderNo,item.productNo,item.model,item.productName,item.color,item.qty,item.unit,item.deliveryBalance,item.cartons,item.remark]),names.map((name,i)=>['CB2026123-BU001','9298','MODEL-02M-01',name,'87275-粉红色',i<5?'9000':'21000','PCS',i<5?'21000':'9000',i<5?'6':'21',i<5?'1500*6':'21*1000']),modelHeader);
    assert.ok(result.items.every(item=>!item.quantityNeedsReview),modelHeader);
  }
});
