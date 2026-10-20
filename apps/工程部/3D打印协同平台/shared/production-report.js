(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.PrintLinkReport=factory();})(globalThis,function(){
 const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 function day(data,date){
 const S={machines:21,elecPerMachine:1.5,laborPerDay:220,resinQuotePerGram:0.8,resinElecPerDay:50,resinLaborPerDay:250,lossRate:1.2,profitRate:40,...data.settings};
 const materials=data.materials||[],records=data.records||{};
const MACHINE_COUNT_HISTORY = [
  {from:'0000-01-01', count:12},
  {from:'2026-07-17', count:15},
  {from:'2026-07-22', count:20},
  {from:'2026-08-04', count:21},
];
function getMachineCountForDate(date){
  const target=date||today();
  let count=MACHINE_COUNT_HISTORY[0].count;
  MACHINE_COUNT_HISTORY.forEach(item=>{ if(target>=item.from) count=item.count; });
  return count;
}

function calcMaterialCost(materialName, weightG){
  const mat = materials.find(m=>m.name===materialName);
  if(!mat||!weightG) return 0;
  return (weightG * S.lossRate * mat.priceKg) / 1000;
}

function calcRawMaterialCost(materialName, weightG){
  const mat=materials.find(m=>m.name===materialName);
  if(!mat||!weightG) return 0;
  return (weightG*mat.priceKg)/1000;
}

function calcRecordMaterialCost(item, qty=1){
  return (Number(item.machine)===21?calcRawMaterialCost(item.material,item.weight):calcMaterialCost(item.material,item.weight))*qty;
}

function isResinQuote(machineOrProcess){
  return Number(machineOrProcess)===21 || machineOrProcess==='resin';
}

function getResinQuoteRate(){
  return Number.isFinite(Number(S.resinQuotePerGram))?Number(S.resinQuotePerGram):0.8;
}
function getResinElecPerDay(){
  return Number.isFinite(Number(S.resinElecPerDay))?Number(S.resinElecPerDay):50;
}
function getResinLaborPerDay(){
  return Number.isFinite(Number(S.resinLaborPerDay))?Number(S.resinLaborPerDay):250;
}

// FDM 使用原有成本加利润公式；光固化客户报价按克计价，实际成本在日报中独立核算。
function calcUnitPrice(materialName, weightG, timeH, qty, machineCount=S.machines, machineOrProcess='fdm'){
  qty = qty || 1;
  const resin = isResinQuote(machineOrProcess);
  const matCost = (resin?calcRawMaterialCost(materialName,weightG):calcMaterialCost(materialName,weightG))*qty;
  const totalTimeH = timeH * qty;
  const elecCost = resin ? 0 : (totalTimeH / 12) * S.elecPerMachine;
  const fdmMachineCount = Math.max(1, Math.min(20, machineCount||20));
  const laborCost = resin ? 0 : (totalTimeH / 12) * (S.laborPerDay / fdmMachineCount);
  const totalCost = matCost + elecCost + laborCost;
  const resinQuotePerGram=getResinQuoteRate();
  return { matCost, elecCost, laborCost, totalCost, price: resin?weightG*qty*resinQuotePerGram:totalCost*(1+S.profitRate/100), resin };
}

function getDaySummary(date){
  const machineCount=getMachineCountForDate(date);
  const day = records[date];
  if(!day||day.off) return {revenue:0, materialCost:0, elecCost:0, laborCost:0, otherCost:0, totalCost:0, balance:0, runningMachines:0, utilization:0, machineCount, isOff:day&&day.off};
  const items = (day.items||[]).filter(i=>!i._deleted);
  const running = new Set(items.filter(i=>i.status==='running').map(i=>i.machine));
  const runCount = running.size;
  const revenue = items.filter(i=>i.status==='running').reduce((s,i)=>{
    const qty = i.qty||1;
    const c = calcUnitPrice(i.material, i.weight||0, i.time||0, qty, machineCount, i.machine);
    const base = c.price > 0 ? c.price : (i.price||0)*qty;
    return s + base + (+i.designFee||0);
  },0);
  const matCost = items.filter(i=>i.status==='running').reduce((s,i)=>s+calcRecordMaterialCost(i,i.qty||1),0);
  const elecCost = items.filter(i=>i.status==='running').reduce((s,i)=>{
    const c=calcUnitPrice(i.material,i.weight||0,i.time||0,i.qty||1,machineCount,i.machine);
    return s+c.elecCost;
  },0);
  const hasFdmRunning = items.some(i=>i.status==='running' && Number(i.machine)!==21);
  // 光固化电费和人工属于生产日固定支出：当天 #21 只要有生产就各计一次，
  // 不按耗时折算，同一天有多条记录也不能重复计费。
  const hasResinRunning=items.some(i=>i.status==='running'&&Number(i.machine)===21);
  const resinElecCost=hasResinRunning?getResinElecPerDay():0;
  const resinLaborCost=hasResinRunning?getResinLaborPerDay():0;
  const laborCost = (hasFdmRunning ? S.laborPerDay : 0) + resinLaborCost;
  const totalElecCost=elecCost+resinElecCost;
  const totalCost = matCost + totalElecCost + laborCost;
  const balance = revenue - totalCost;
  const machineHours = {};
  for(let i=1;i<=machineCount;i++) machineHours[i]={running:0,idle:0,fault:0};
  items.forEach(i=>{
    const mn = parseInt(i.machine);
    if(machineHours[mn]){
      if(i.status==='running') machineHours[mn].running += (i.time||0)*(i.qty||1);
      else if(i.status==='idle') machineHours[mn].idle = 12;
      else if(i.status==='fault') machineHours[mn].fault = 12;
    }
  });
  let totalUtil=0;
  for(let i=1;i<=machineCount;i++){
    const h=machineHours[i];
    const total=h.running+h.idle+h.fault;
    if(total>0) totalUtil+=h.running/12;
  }
  return {revenue, materialCost:matCost, elecCost:totalElecCost, laborCost, totalCost, balance, runningMachines:runCount, utilization:machineCount>0?totalUtil/machineCount:0, machineCount, machineHours, isOff:false};
}

 return getDaySummary(date);
 }
 return {day,today,version:1};
});
