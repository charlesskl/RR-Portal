'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const echarts = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../vendor/echarts.min.js'),'utf8'),
  { exports:echarts, module:{exports:echarts}, setTimeout, clearTimeout, console });
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const helper = source.slice(source.indexOf('function dashboardPieLabelOptions()'), source.indexOf('/* 2. 判定结果饼图'));
const result = source.slice(source.indexOf('function chartResultPie(data)'), source.indexOf('/* 3. 供应商批次'));
const client = source.slice(source.indexOf('function chartClientPie(data)'), source.indexOf('/* 6. 本周批次'));
function chart(width, kind, rows) {
  const instance = echarts.init(null, null, { renderer:'svg', ssr:true, width, height:240 });
  const context = vm.createContext({
    _cc:()=>({textHi:'#111827',text:'#374151',labelLine:'#94a3b8',tt:{}}),
    makeChart:()=>instance,
    isPass:r=>r.result==='PASS', isFail:r=>r.result==='REJ',
    groupBy:(data,key)=>data.reduce((groups,row)=>{(groups[row[key]] ||= []).push(row);return groups},{}),
  });
  vm.runInContext(helper + result + client, context);
  instance.setOption({ animation:false });
  context[kind](rows);
  return instance;
}
function assertLabelsAndLines(instance, width) {
  const data = instance.getModel().getSeriesByIndex(0).getData();
  for (let i=0;i<data.count();i++) {
    const name = data.getName(i), slice = data.getItemGraphicEl(i);
    const text = slice.getTextContent(), line = slice.getTextGuideLine();
    assert.ok(text && !text.ignore, name+' label is visible');
    assert.ok(line && !line.ignore && !line.invisible, name+' guide line is visible');
    const points = line.shape.points;
    assert.ok(points.length>=3, name+' has a bent guide line');
    assert.ok(Math.hypot(points.at(-1)[0]-points.at(-2)[0],points.at(-1)[1]-points.at(-2)[1])>=8, name+' horizontal guide segment has space');
    const guideLength = points.slice(1).reduce((length, point, index) =>
      length + Math.hypot(point[0]-points[index][0], point[1]-points[index][1]), 0);
    assert.ok(guideLength<=110, name+' guide line stays near the ring even in wide charts');
    const box = text.getBoundingRect().clone();box.applyTransform(text.getComputedTransform());
    const closestX = Math.max(box.x,Math.min(slice.shape.cx,box.x+box.width));
    const closestY = Math.max(box.y,Math.min(slice.shape.cy,box.y+box.height));
    assert.ok(Math.hypot(closestX-slice.shape.cx,closestY-slice.shape.cy)>=slice.shape.r-1, name+' label stays outside the ring');
    assert.ok(box.x>=-1 && box.x+box.width<=width+1 && box.y>=-1 && box.y+box.height<=241, name+' label fits the chart');
  }
}
for (const width of [240,280,500,1000]) {
  test('94/3/3 result labels keep their guide lines at width '+width,()=>{
    const rows=Array.from({length:100},(_,i)=>({result:i<94?'PASS':i<97?'REJ':'COND'}));
    const instance=chart(width,'chartResultPie',rows);
    try { assertLabelsAndLines(instance,width); } finally { instance.dispose(); }
  });
}
test('four result slices with small neighboring labels keep all lines',()=>{
  const rows=Array.from({length:100},(_,i)=>({result:i<90?'PASS':i<93?'REJ':i<97?'COND':'HOLD'}));
  const instance=chart(280,'chartResultPie',rows);
  try { assertLabelsAndLines(instance,280); } finally { instance.dispose(); }
});
test('a single result keeps its outside label and guide line',()=>{
  const instance=chart(240,'chartResultPie',[{result:'PASS'}]);
  try { assertLabelsAndLines(instance,240); } finally { instance.dispose(); }
});
test('customer labels use the same connected outside layout',()=>{
  const shares=[['Zuru',77],['TOMY',10],['John Adams',7],['其他',6]];
  const rows=shares.flatMap(([client,count])=>Array.from({length:count},()=>({client})));
  const instance=chart(280,'chartClientPie',rows);
  try { assertLabelsAndLines(instance,280); } finally { instance.dispose(); }
});

test('rounded 97/2/2 result labels stay close on a wide card',()=>{
  const rows=Array.from({length:1000},(_,i)=>({result:i<965?'PASS':i<982?'REJ':'COND'}));
  const instance=chart(1200,'chartResultPie',rows);
  try { assertLabelsAndLines(instance,1200); } finally { instance.dispose(); }
});
