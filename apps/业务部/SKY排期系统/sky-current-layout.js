const XLSX = require('xlsx');
const rows = sheet => XLSX.utils.sheet_to_json(sheet, {header:1, blankrows:true});
function column(header, label) {
  const hits = [];
  header.forEach((v,index)=>{if(String(v ?? '').trim()===label) hits.push(index+1);});
  if(hits.length!==1) throw Error('无法唯一定位列：'+label);
  return hits[0];
}
function fill(row,header,label,value,date=false) {
  if(value==null || value==='') return;
  const cell=row.getCell(column(header,label));
  if(date){
    const ms=Date.parse(value+'T00:00:00Z');
    if(!Number.isFinite(ms) || new Date(ms).toISOString().slice(0,10) !== value)throw Error('日期无法解析：'+value);
    cell.value=ms/86400000+25569;cell.numFmt='yyyy/mm/dd';
  } else cell.value=value;
}
function writeCurrentLayout(wb,raw,orders) {
  const master=new Map();
  if (!raw.Sheets['名称']) throw Error('排期缺少货号与系列对应的名称表');
  const [head,...items]=rows(raw.Sheets['名称']);
  const skuColumn = column(head, '货号') - 1;
  for(const r of items){
    const sku=String(r[skuColumn] ?? '').trim();if(!sku)continue;
    const refs=master.get(sku)||[];refs.push(r);master.set(sku,refs);
  }
  const queues=new Map();
  function prepare(name){
    if(!raw.Sheets[name])throw Error('原排期缺少 '+name);
    const [h1,h2]=rows(raw.Sheets[name]);
    const sheet=wb.addWorksheet(name+'-粘贴用');
    queues.set(name,{sheet,h1,h2});
    return queues.get(name);
  }
  const order=prepare('总接单');
  const schedNames=['一二代排期','三代排期','四代排期','蛋糕系列'];
  for(const n of schedNames)if(raw.Sheets[n])prepare(n);
  const moneyCols=['单价USD','金额USD','金额HKD'];
  const seriesSheet={'一代':'一二代排期','二代':'一二代排期','一二代':'一二代排期','三代':'三代排期','四代':'四代排期','蛋糕':'蛋糕系列','蛋糕系列':'蛋糕系列'};
  for(const po of orders)for(const item of po.items){
    const hits=master.get(item.partNo)||[];
    if(hits.length!==1)throw Error(item.partNo+' 在名称表中没有唯一的完整货号');
    const info=Object.fromEntries(head.map((key,i)=>[key,hits[0][i]]));
    const target=queues.get(seriesSheet[info['系列']]);
    if(!target)throw Error(item.partNo+' 缺少对应的系列排期：'+info['系列']);
    const deliveryDate = item.dueDate || po.shippingDate;
    if (!deliveryDate) throw Error(po.poNumber + ' 缺少出货日期');
    for(const [table,isOrder] of [[order,true],[target,false]]){
      const row=table.sheet.addRow([]);
      const header=isOrder?table.h2:table.h1;
      const put=(label,val,date)=>fill(row,header,label,val,date);
      const dateCols = [];
      put('PO号',po.poNumber);put('货号',item.partNo);put('数量',item.quantity);
      put('CUSTOMER PO',po.customerPO);put('接单期',po.creationDate,true);
      put(isOrder?'出货期':'计划出货期',deliveryDate,true);
      dateCols.push(column(header,isOrder?'出货期':'计划出货期'));
      if (!isOrder) {
        put('计划验货期',deliveryDate,true);
        dateCols.push(column(header,'计划验货期'));
      }
      row.skyDateColumns=dateCols;
      const usd=item.amount;
      for(const [i,v] of [item.unitPrice,usd,Math.round(usd*7.75*100)/100].entries())fill(row,table.h1,moneyCols[i],v);
      const revisions=[column(header,'数量'),...dateCols,...moneyCols.map(k=>column(table.h1,k))];
      if(isOrder){
        put('包装版本',po.packaging);put('系列',info['系列']);
        const candidates=[];
        table.h2.forEach((val,i)=>{if(String(val||'').split('/').map(s=>s.trim()).includes(item.partNo))candidates.push(i+1);});
        if(candidates.length>1)throw Error('产品数量栏重复：'+item.partNo);
        if(candidates.length){row.getCell(candidates[0]).value=item.quantity;revisions.push(candidates[0]);}
      }else{
        put('系列',info['系列']);
        const country=table.h1.indexOf('国家');if(country>=0 && item.country)row.getCell(country+1).value=item.country;
        const customer=table.h1.indexOf('客名');if(customer>=0 && po.customerName)row.getCell(customer+1).value=po.customerName;
        put('产品名称',info['名称']||item.description);
        put('贴纸用量',info['贴纸用量']);if(info['贴纸用量'])put('总贴纸用量',item.quantity*info['贴纸用量']);
        put('外箱',info['装箱数']);if(info['装箱数'])put('总箱数',Math.ceil(item.quantity/info['装箱数']));
        put('生产车间',info['车间']);put('备注',item.remark);
      }
      row.skyRevisionColumns=revisions;
    }
  }
}
module.exports={writeCurrentLayout};
