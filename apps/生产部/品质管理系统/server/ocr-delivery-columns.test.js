'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const test=require('node:test');

// Actual parser/provider dispatch; all documents and provider responses below are synthetic.
// No server start, private configuration, database, real HTTP, or model request.
const app=path.join(__dirname,'..');
const server=fs.readFileSync(path.join(__dirname,'server.js'),'utf8');
const declarations=server.slice(server.indexOf('const OCR_READ_PROMPT ='),server.indexOf('/* ── 记录表列顺序'));
const plain=value=>JSON.parse(JSON.stringify(value));
function runtime(responses=[]) {
  let calls=0;
  const context=vm.createContext({AI:{ready:true,baseURL:'https://synthetic.invalid/v1',apiKey:'synthetic',ocrModel:'synthetic'},
    console:{warn(){}},setTimeout:fn=>fn(),AbortSignal,fetch:async()=>{
      assert.ok(responses.length,'Unexpected additional provider call');calls++;
      return{status:200,text:async()=>JSON.stringify({choices:[{message:{content:responses.shift()}}]})};
    }});
  vm.runInContext(declarations+';globalThis.actual={parseDeliveryNote,aiVisionExtract};',context);
  return{parse:raw=>plain(context.actual.parseDeliveryNote(raw)),extract:async()=>plain(await context.actual.aiVisionExtract('data:image/png;base64,c3ludGhldGlj')),calls:()=>calls};
}
const prefix='序号 订单编号 货号 货品名称 单位 ';
const cases=[
  ['nonempty SKU must not disappear into the name',prefix+'订单数量 交货数量 单价 金额\n1 PO-123456 SKU001 合成零件 PCS 100 34 9.50 323.00'],
  ['a price before quantity columns must not shift the delivered quantity',prefix+'单价 订单数量 交货数量\n1 PO-123456 合成零件 PCS 9.50 100 34'],
  ['an unreadable delivered quantity must not be replaced by the amount',prefix+'订单数量 交货数量 金额\n1 PO-123456 合成零件 PCS 100 unreadable 340'],
  ['a total must not become the current delivered quantity',prefix+'订单数量 总交货数量 交货数量\n1 PO-123456 合成零件 PCS 100 80 34'],
  ['order quantity alone must not become delivered quantity',prefix+'订单数量 未交数量\n1 PO-123456 合成零件 PCS 100 66'],
  ['a numeric SKU must not be appended to the adjacent PO',prefix+'订单数量 交货数量\n1 BBC2025285-0 12 合成零件 PCS 100 34'],
];
function pending(fields,raw) {
  assert.equal(fields.items.length,1);assert.equal(fields.items[0].qty,'');assert.equal(fields.items[0].productNo,'');
  assert.equal(fields.items[0].orderNo,undefined);assert.equal(fields.orderNo,'');assert.equal(fields.items[0].quantityNeedsReview,true);
  assert.equal(fields.items[0].productName,'待核对原文：'+raw);
}
for(const [name,raw]of cases)test('unpositioned delivery layout: '+name,async()=>{
  const r=runtime([raw,'|货号|品名|数量|\n|REPLACEMENT|替换零件|999|']);
  pending(r.parse(raw),raw);const result=await r.extract();
  assert.equal(r.calls(),1);assert.equal(result.rawText,raw);assert.equal(result.needsManualReview,true);pending(result.fields,raw);
});

test('actual line breaks inside a PO remain full manual source, not an invented continuation',()=>{
  const raw='订单号：PO-HEADER\n'+prefix+'订单数量 交货数量\n1 BBC2025285-0\n1 12 合成零件 PCS 100 34';
  pending(runtime().parse(raw),raw);
});

const header=['序号','订单编号','货号','货品名称','单位'];
function table(extra,rows){return'|'+header.concat(extra).join('|')+'|\n'+rows.map(row=>'|'+row.join('|')+'|').join('\n');}

const sparseHeading = '订单号 货号 配件名称 颜色 数量 单位 本单送货数/本单欠数 箱数 备注';
test('flattened component rows retain positioned names and quantities despite empty columns and continuation codes', () => {
  const raw = [sparseHeading, 'PO-26001 SKU1093 2#浅蓝色甲身体 40 PCS 4 4*10',
    '2#浅蓝色乙身体 16 PCS 1', '2#浅蓝色丙身体 42 PCS 3 2*16+10',
    '5#蓝色甲身体 51 PCS 6 5*9+6', '5#蓝色乙身体 12 PCS 1', '5#蓝色丙身体 27 PCS 2 16+11'].join('\n');
  const fields = runtime().parse(raw);
  assert.equal(fields.items.length, 6);
  assert.deepEqual(fields.items.map(row => row.qty), ['40','16','42','51','12','27']);
  assert.ok(fields.items.every(row => row.productNo === 'SKU1093' && row.orderNo === 'PO-26001'));
  assert.equal(fields.items[1].productName, '2#浅蓝色乙身体');
  assert.ok(fields.items.every(row => row.color === '' && row.deliveryBalance === ''));
  assert.deepEqual(fields.items.map(row => row.cartons), ['4','','3','6','','2']);
  assert.deepEqual([0,2,3,5].map(i => fields.items[i].remark), ['4*10','2*16+10','5*9+6','16+11']);
  for (const i of [1,4]) assert.match(fields.items[i].remark, /右侧原文（列位置待核对）：1$/);
  assert.equal(fields.manualReviewRequired, true);
});

test('unverified carton columns and packing equations never convert delivered quantities to carton counts', () => {
  for (const lines of [
    ['PO-26001 SKU1093 甲身体 40 PCS 4 4*11', '乙身体 16 PCS 1'],
    ['PO-26001 SKU1093 甲身体 40 PCS 40 4 4*10', '乙身体 16 PCS 16 1'],
    ['PO-26001 SKU1093 甲身体 40 PCS 4', '乙身体 16 PCS 1'],
  ]) {
    const fields = runtime().parse([sparseHeading, ...lines].join('\n'));
    assert.equal(fields.manualReviewRequired, true);
    assert.ok(fields.items.every(row => !row.cartons));
  }
});

test('packing evidence stays row-local while free-text and bare numeric tails remain for review', () => {
  const fields = runtime().parse([sparseHeading, 'PO-26001 SKU1093 甲身体 40 PCS 4 4*10',
    '乙身体 16 PCS 1 加急', '丙身体 12 PCS 1'].join('\n'));
  assert.deepEqual(fields.items.map(row => row.cartons), ['4','','']);
  assert.equal(fields.items[0].remark, '4*10');
  assert.match(fields.items[1].remark, /右侧原文（列位置待核对）：1 加急$/);
  assert.match(fields.items[2].remark, /右侧原文（列位置待核对）：1$/);
  assert.equal(fields.manualReviewRequired, true);
});

test('markdown cell break tags are normalized without becoming literal PO or product text', () => {
  const raw = table(['订单数量','交货数量'], [['1','PO-<br>26001','SKU001','合成零件<br/>第二行','PCS','100','34']]);
  const fields = runtime().parse(raw);
  assert.equal(fields.items[0].orderNo, 'PO-26001');
  assert.equal(fields.items[0].productName, '合成零件 第二行');
  assert.equal(fields.items[0].qty, '34');
});

test('tab-preserved packaging cells with actual internal newlines keep PO SKU name quantity and blank SKU boundaries', () => {
  const raw = ['订单编号\t物料编号\t品名/规格\t单位\t数量\t单价\t备品\t包装明细',
    'FDHA202505\n51-01\t92104(无手脚\n版)\t合成收缩膜\n0.07*205开口*148mm\t个\t1000\t\t4000个*6件+5000个\n+1000个*2件',
    'FDHA202602\n68-01\t92104(无手脚\n版)\t合成收缩膜\n0.07*205开口*148mm\t个\t200\t\t300',
    'FDHA202604\n55-01\t92104\t合成膜\t个\t30000\t\t包装内容',
    'FDHA202602\n34-01\t11050097\t合成中蛋膜\n0.07*68.5开口*52mm\t个\t20000\t\t100个*2件',
    'FDHA2026/S\n041\t\t合成手链膜\n0.07*88开口*76mm\t个\t10000\t\t合计：',
    '注：合成说明', '经手人：合成人员'].join('\n');
  const fields = runtime().parse(raw);
  assert.equal(fields.items.length, 5);
  assert.deepEqual(fields.items.map(row => row.qty), ['1000','200','30000','20000','10000']);
  assert.deepEqual(fields.items.map(row => row.orderNo), ['FDHA20250551-01','FDHA20260268-01','FDHA20260455-01','FDHA20260234-01','FDHA2026/S041']);
  assert.equal(fields.items[0].productNo, '92104(无手脚版)');
  assert.equal(fields.items[4].productNo, '');
  assert.match(fields.items[0].productName, /合成收缩膜 0.07/);
  assert.ok(fields.items.every(row => !row.quantityNeedsReview));
  assert.match(fields.items[0].remark, /4000个\*6件\+5000个\+1000个\*2件/);
  assert.equal(fields.items[4].remark, '');
});

test('malformed tab cells remain whole-source review instead of shifting a price into quantity', () => {
  const raw = '订单编号\t物料编号\t品名/规格\t单位\t数量\t单价\t备品\t包装明细\nFDHA202505\n51-01\tSKU001\t合成零件\t个\tunknown\t9.5\t100\t包装';
  const fields = runtime().parse(raw);
  assert.equal(fields.items.length, 1); assert.equal(fields.items[0].qty, '');
  assert.equal(fields.items[0].quantityNeedsReview, true);
});

test('space-separated ambiguous PO suffix or numeric SKU retains complete source for explicit review', () => {
  const raw = ['订单编号 物料编号 品名/规格 单位 数量 单价 备品 包装明细',
    'FDHA202505 51-01 92104(无手脚版) 合成收缩膜 0.07*205开口*148mm 个 1000 4000个*6件+5000个',
    '+1000个*2件+300个+200个',
    'FDHA202602 68-01 92104(无手脚版) 合成收缩膜 0.07*205开口*148mm 个 200',
    'FDHA202604 55-01 92104 合成膜 个 30000 300',
    'FDHA202602 34-01 11050097 合成中蛋膜 0.07*68.5开口*52mm 个 20000 32000个*1件',
    'FDHA2026/S 041 合成手链膜SR1033-PROXY版 0.07*88开口*76mm 个 10000 10100个*1件',
    '注：合成说明'].join('\n');
  const fields = runtime().parse(raw);
  assert.equal(fields.items.length, 5);
  assert.ok(fields.items.every(row => row.qty === '' && row.quantityNeedsReview));
  assert.ok(fields.items.every(row => row.productNo === '' && row.productName.startsWith('待核对原文：FDHA')));
  assert.match(fields.items[0].productName, /FDHA202505 51-01 92104/);
  assert.match(fields.items[0].productName, /\+1000个\*2件\+300个\+200个/);
  assert.match(fields.items[4].productName, /FDHA2026\/S 041/);
});

test('component explicit markdown columns stay exact while flattened ambiguous empty columns require row-local review', () => {
  const rows = [['PO-26001','SKU1093','甲身体','','40','PCS','','4','4*10'],
    ['','','乙身体','','16','PCS','','1',''], ['','','丙身体','','42','PCS','','3','2*16+10']];
  const markdown = '|' + sparseHeading.split(' ').join('|') + '|\n' + rows.map(row => '|' + row.join('|') + '|').join('\n');
  const flat = [sparseHeading, ...rows.map(row => row.filter(Boolean).join(' '))].join('\n');
  const pick = fields => fields.items.map(row => [row.productNo,row.productName,row.qty,row.unit,row.cartons,row.remark]);
  const structured = runtime().parse(markdown), flattened = runtime().parse(flat);
  assert.deepEqual(pick(structured).map(row => row.slice(0,4)), pick(flattened).map(row => row.slice(0,4)));
  assert.deepEqual(pick(structured).map(row => row.slice(-2)), [['4','4*10'],['1',''],['3','2*16+10']]);
  assert.equal(flattened.items[1].cartons, '');
  assert.match(flattened.items[1].remark, /右侧原文（列位置待核对）：1$/);
  assert.equal(flattened.manualReviewRequired, true);
  assert.deepEqual([0,2].map(i => pick(flattened)[i].slice(-2)), [['4','4*10'],['3','2*16+10']]);
});

for (const separator of ['胶箱：4', sparseHeading, '无法定位的模糊行']) {
  test('sparse continuation cannot inherit identifiers across a page or ambiguous row: ' + separator, () => {
    const fields = runtime().parse([sparseHeading, 'PO-26001 SKU1093 甲身体 40 PCS 4', separator, '乙身体 16 PCS 1'].join('\n'));
    const row = fields.items.at(-1);
    assert.equal(row.qty, ''); assert.equal(row.productNo, ''); assert.equal(row.quantityNeedsReview, true);
  });
}

test('a sparse row with an explicit new order starts its own continuation group', () => {
  const fields = runtime().parse([sparseHeading, 'PO-26001 SKU1093 甲身体 40 PCS 4',
    'PO-26002 SKU2093 乙身体 16 PCS 1', '丙身体 42 PCS 3'].join('\n'));
  assert.equal(fields.orderNo, '');
  assert.equal(fields.items[2].orderNo, 'PO-26002'); assert.equal(fields.items[2].productNo, 'SKU2093');
});

test('positioned delivery columns preserve actual PO/SKU/name and use the exact delivered column despite price/order/total columns',()=>{
  const raw=table(['单价','订单数量','总交货数量','累计交货数量','本次交货数量','金额'],
    [['1','BBC2025285-0','0012','合成零件','PCS','9.50','100','80','90','34','323.00']]);
  const fields=runtime().parse(raw);
  assert.deepEqual(fields.items,[{productNo:'0012',productName:'合成零件',qty:'34',unit:'PCS',orderNo:'BBC2025285-0'}]);
  assert.equal(fields.orderNo,'BBC2025285-0');
});

for(const label of ['交货数量','本次交货数量','送货数量','实送数量','交貨數量','本次交貨數量','送貨數量','實送數量']) {
  test('a unique explicit delivery header is exact: '+label,()=>{
    const fields=runtime().parse(table(['订单数量',label],[['1','PO-REAL','SKU001','合成零件','PCS','100','34']]));
    assert.equal(fields.items[0].qty,'34');assert.equal(fields.items[0].productNo,'SKU001');
  });
}

for(const columns of [['订单数量','未交数量'],['订单数量','总交货数量'],['订单数量','累计交货数量'],
  ['订单数量','本次交货数量','交货数量'],['交货数量','交货数量']]) {
  test('missing or ambiguous exact delivery columns require whole-source review: '+columns.join('/'),()=>{
    const raw=table(columns,[['1','PO-REAL','SKU001','合成零件','PCS',...columns.map((_c,i)=>String(100-i))]]);
    pending(runtime().parse(raw),raw);
  });
}

test('positioned unreadable or width-mismatched rows keep the complete row instead of shifting a later amount',()=>{
  const rows=[['1','PO-A','SKU001','合成零件','PCS','100','unreadable','340'],['2','PO-B','合成零件','PCS','100','34','340']];
  const raw=table(['订单数量','交货数量','金额'],rows),fields=runtime().parse(raw);
  assert.equal(fields.items.length,2);assert.equal(fields.orderNo,'');
  for(let i=0;i<rows.length;i++) {
    assert.equal(fields.items[i].qty,'');assert.equal(fields.items[i].quantityNeedsReview,true);
    assert.equal(fields.items[i].productName,'待核对原文：|'+rows[i].join('|')+'|');
  }
});

test('structured empty SKU and PO cells remain empty without inheriting another row or gluing a numeric SKU to PO',()=>{
  const raw=table(['订单数量','交货数量'],[
    ['1','BBC2025285-0','12','合成零件A','PCS','100','34'],
    ['2','','','合成零件B','PCS','100','20'],
    ['3','PO-C','SKU003','','PCS','100','10'],
  ]),fields=runtime().parse(raw);
  assert.equal(fields.orderNo,'');assert.deepEqual(fields.items.map(row=>[row.productNo,row.productName,row.orderNo,row.qty]),
    [['12','合成零件A','BBC2025285-0','34'],['','合成零件B','','20'],['SKU003','','PO-C','10']]);
});

test('HTML real cells follow the same exact column contract and retain explicit rowspan PO provenance',()=>{
  const raw='<table><tr>'+header.concat(['单价','订单数量','累计交货数量','交货数量']).map(h=>'<th>'+h+'</th>').join('')+'</tr>'+
    '<tr><td>1</td><td rowspan="2">PO-HTML</td><td>0012</td><td>合成A</td><td>PCS</td><td>9.50</td><td>100</td><td>80</td><td>34</td></tr>'+
    '<tr><td>2</td><td>0013</td><td>合成B</td><td>PCS</td><td>9.50</td><td>100</td><td>80</td><td>0</td></tr></table>';
  const fields=runtime().parse(raw);
  assert.deepEqual(fields.items.map(row=>[row.productNo,row.orderNo,row.qty]),[['0012','PO-HTML','34'],['0013','PO-HTML','0']]);
});

for(const [quantity,unit]of [['0','PCS'],['8.760','KG'],['0.650','KG'],['1.234.567','KG']]) {
  test('the positioned layout retains original zero/decimal/ambiguous number text: '+quantity+' '+unit,()=>{
    const raw=table(['订单数量','交货数量'],[['1','PO-QTY','0012','合成原料',unit,'100',quantity]]);
    const row=runtime().parse(raw).items[0];assert.equal(row.qty,quantity);assert.equal(row.unit,unit);assert.equal(row.productNo,'0012');
  });
}

test('the new source cannot auto-save a guessed count; correction is explicit and parser flags are not persisted',async()=>{
  const front=fs.readFileSync(path.join(app,'frontend-ocr-rotation.test.js'),'utf8');
  const end=front.indexOf("test('manual rotations");assert.ok(end>0);
  const ctx={require,__dirname:app,Buffer,AbortController,setImmediate,console};
  vm.runInNewContext(front.slice(0,end)+';this.make=fixture;',ctx);
  const x=ctx.make(),raw=cases[0][1],fields=runtime().parse(raw);
  x.upload();x.responses.push({ok:true,fields,rawText:raw,needsManualReview:true});x.b.ctx.openAddModal();
  await x.b.ctx.startOcr();x.b.elements.get('ocrSupplier').value='Test Supplier';x.b.ctx.applyOcrToForm();
  assert.equal(x.b.ctx.saveRecord(),false);assert.equal(plain(x.b.json('state.records')).length,0);
  x.b.elements.get('f_qty').value='34';assert.equal(x.b.ctx.saveRecord(),true);
  const saved=plain(x.b.json('state.records[0]'));
  assert.equal(saved.qty,34);assert.equal(saved.productNo,'');assert.equal(saved.orderNo,'');
  assert.equal(saved.productName,'');assert.equal(x.b.elements.get('ocrRawText').value,raw);
  assert.equal('quantityNeedsReview'in saved,false);
});

test('a manual delivery-layout retry never acquires a previous response PO or other metadata',async()=>{
  const raw=cases[1][1],r=runtime(['订单号：PO-PREVIOUS\n日期：2026-11-01\n没有货品行',raw]);
  const result=await r.extract();assert.equal(r.calls(),2);pending(result.fields,raw);
  assert.equal(result.fields.date,'');assert.equal(result.rawText,raw);
});

test('decimal and multi-dot delivery-column values reach the existing real save guard unchanged',async()=>{
  const front=fs.readFileSync(path.join(app,'frontend-ocr-rotation.test.js'),'utf8'),end=front.indexOf("test('manual rotations");
  const ctx={require,__dirname:app,Buffer,AbortController,setImmediate,console};
  vm.runInNewContext(front.slice(0,end)+';this.make=fixture;',ctx);
  for(const quantity of ['8.760','0.650','1.234.567']) {
    const raw=table(['订单数量','交货数量'],[['1','PO-KG','0012','合成原料','KG','100',quantity]]),fields=runtime().parse(raw),x=ctx.make();
    assert.equal(fields.items[0].qty,quantity);x.upload();x.responses.push({ok:true,fields,rawText:raw});x.b.ctx.openAddModal();
    await x.b.ctx.startOcr();x.b.elements.get('ocrSupplier').value='Test Supplier';x.b.ctx.applyOcrToForm();
    assert.equal(x.b.ctx.saveRecord(),false);assert.equal(plain(x.b.json('state.records')).length,0);
    x.b.elements.get('f_qty').value='8760';assert.equal(x.b.ctx.saveRecord(),true);
    const saved=plain(x.b.json('state.records[0]'));assert.equal(saved.qty,8760);assert.equal(saved.productNo,'0012');assert.equal(saved.orderNo,'PO-KG');
  }
});

for (const modelHeader of ['', '模号']) {
  test('component sheets keep every page after packing/signature footers and repeated complete headers' + (modelHeader ? ' with mold column' : ''), () => {
    const heading = ['订单号', '货号', modelHeader, '配件名称', '颜色', '数量', '单位', '本单送货数/本单欠数', '箱数', '备注'].filter(Boolean).join(' ');
    const line = (order, name, qty) => [order, 'SKU1093', modelHeader ? 'MODEL-02M-01' : '', name, '兰', qty, 'PCS', qty + '/200', '1'].filter(Boolean).join(' ');
    const raw = [heading, line('PO-PAGE001', '第一页合成配件', '100'), '胶箱：1', '收货人：第一页合成姓名',
      heading, line('PO-PAGE002', '第二页合成配件', '120'), '胶箱：1', '收货人：第二页合成姓名'].join('\n');
    const fields = runtime().parse(raw);
    assert.equal(fields.orderNo, '');
    assert.deepEqual(fields.items.map(item => [item.orderNo, item.productNo, item.productName, item.qty, item.model || '']), [
      ['PO-PAGE001', 'SKU1093', '第一页合成配件', '100', modelHeader ? 'MODEL-02M-01' : ''],
      ['PO-PAGE002', 'SKU1093', '第二页合成配件', '120', modelHeader ? 'MODEL-02M-01' : ''],
    ]);
  });
}

test('unrecognized text between component pages is retained for review instead of discarded with the footer', () => {
  const heading = '订单号 货号 模号 配件名称 颜色 数量 单位 本单送货数/本单欠数 箱数 备注';
  const unknown = 'PR1093页间未识别内容：数量不清楚，必须保留';
  const raw = [heading, 'PO-PAGE001 SKU1093 MODEL-A 第一页合成配件 兰 100 PCS 100/200 1',
    '胶箱：1', '收货人：合成姓名', unknown, heading,
    'PO-PAGE002 SKU1093 MODEL-B 第二页合成配件 兰 120 PCS 120/180 1', '胶箱：1'].join('\n');
  const fields = runtime().parse(raw);
  assert.equal(fields.items.length, 3);
  assert.deepEqual(fields.items.filter(item => !item.quantityNeedsReview).map(item => [item.orderNo, item.productName, item.qty]), [
    ['PO-PAGE001', '第一页合成配件', '100'], ['PO-PAGE002', '第二页合成配件', '120'],
  ]);
  const unresolved = fields.items[1];
  assert.equal(unresolved.productName, '待核对原文：' + unknown);
  assert.equal(unresolved.qty, '');
  assert.equal(unresolved.quantityNeedsReview, true);
  assert.equal(fields.orderNo, '');
});

const packagingHeading = '订单编号\t物料编号\t品名/规格\t单位\t数量\t单价\t备品\t包装明细';
const packagingRow = (order, qty, name = '合成包装袋') => [order, 'SKU1106', name, '个', String(qty), '', '', qty + '个*1件'].join('\t');
for (const repeatHeader of [false, true]) test('packaging retains every page after totals and signatures, repeated header=' + repeatHeader, () => {
  const raw = [packagingHeading, packagingRow('AB2026001', 100), '合计：100', '经手人：合成名字', '出货专用章',
    ...(repeatHeader ? [packagingHeading] : []), packagingRow('PO-26002', 200), '合计：200'].join('\n');
  const fields = runtime().parse(raw);
  assert.deepEqual(fields.items.map(r => [r.orderNo, r.qty, r.productName, r.remark]), [
    ['AB2026001', '100', '合成包装袋', '100个*1件'], ['PO-26002', '200', '合成包装袋', '200个*1件']]);
  assert.equal(fields.manualReviewRequired, undefined); assert.equal(fields.orderNo, '');
});
for (const order of ['PO-26001', 'X1', 'A/B-123', '12345']) test('positioned packaging rows never disappear for order format ' + order, () => {
  const raw = [packagingHeading, packagingRow(order, 100), packagingRow('FDHA2026002', 200)].join('\n');
  const fields = runtime().parse(raw); assert.equal(fields.items.length, 2);
  if (order === '12345') { assert.equal(fields.items[0].qty, ''); assert.equal(fields.items[0].quantityNeedsReview, true); assert.equal(fields.items[0].productName, '待核对原文：' + packagingRow(order, 100)); }
  else { assert.equal(fields.items[0].orderNo, order); assert.equal(fields.items[0].qty, '100'); }
  assert.equal(fields.items[1].orderNo, 'FDHA2026002'); assert.equal(fields.items[1].qty, '200');
});
for (const unknown of ['模糊的第二条包装资料必须人工核对', '???\tSKU-UNKNOWN\t模糊数量货品\t个\t不清楚\t\t\t原文必须保留']) {
  test('ambiguous packaging content is retained separately and never appended as the previous valid remark: ' + unknown, () => {
    const raw = [packagingHeading, packagingRow('AB2026001', 100), unknown, packagingRow('PO-26002', 200)].join('\n');
    const fields = runtime().parse(raw); assert.equal(fields.items.length, 3);
    assert.equal(fields.items[0].remark, '100个*1件'); assert.equal(fields.items[1].productName, '待核对原文：' + unknown);
    assert.equal(fields.items[1].quantityNeedsReview, true); assert.equal(fields.items[1].qty, ''); assert.equal(fields.items[2].qty, '200');
  });
}

test('flat packaging accepts complete hyphenated PO rows on later pages without inheriting previous row fields', () => {
  const raw = [packagingHeading.replace(/\t/g, ' '), 'AB2026001 SKU1 第一页合成袋 个 100', '合计：100',
    packagingHeading.replace(/\t/g, ' '), 'PO-26002 SKU2 第二页合成袋 个 200'].join('\n');
  assert.deepEqual(runtime().parse(raw).items.map(r => [r.orderNo, r.productNo, r.productName, r.qty]), [
    ['AB2026001', 'SKU1', '第一页合成袋', '100'], ['PO-26002', 'SKU2', '第二页合成袋', '200']]);
});

test('flat packaging never concatenates a three-digit numeric SKU into a hyphenated PO', () => {
  const raw = [packagingHeading.replace(/\t/g, ' '), 'PO-26001 123 合成包装袋 个 100'].join('\n');
  const fields = runtime().parse(raw); assert.equal(fields.items.length, 1);
  assert.equal(fields.items[0].productName, '待核对原文：PO-26001 123 合成包装袋 个 100');
  assert.equal(fields.items[0].quantityNeedsReview, true); assert.equal(fields.items[0].qty, '');
  assert.equal(fields.items[0].productNo, ''); assert.equal(fields.orderNo, '');
});

test('a prior packing equation cannot decide whether a later bare number is delivery count or cartons', () => {
  const rows = [['PO-26001','SKU1093','合成甲','','40','PCS','','4','4*10'],
    ['PO-26001','SKU1093','合成乙','','16','PCS','1','','']];
  const markdown = '|' + sparseHeading.split(' ').join('|') + '|\n' + rows.map(row => '|' + row.join('|') + '|').join('\n');
  const flat = [sparseHeading, ...rows.map(row => row.filter(Boolean).join(' '))].join('\n');
  const explicit = runtime().parse(markdown), ambiguous = runtime().parse(flat);
  assert.equal(explicit.items[1].deliveryBalance, '1'); assert.equal(explicit.items[1].cartons, '');
  assert.equal(ambiguous.items[0].cartons, '4'); assert.equal(ambiguous.items[1].cartons, '');
  assert.equal(ambiguous.items[1].deliveryBalance, ''); assert.equal(ambiguous.items[1].qty, '16');
  assert.match(ambiguous.items[1].remark, /右侧原文（列位置待核对）：1$/); assert.equal(ambiguous.manualReviewRequired, true);
});
