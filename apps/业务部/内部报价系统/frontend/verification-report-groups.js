(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.VerificationReportGroups=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const pending='待分配车间',numeric=v=>typeof v==='number'&&Number.isFinite(v);
  const ratios={K:['J','DI'],O:['N','DI'],S:['R','DI'],X:['W','DI'],Z:['Y','E'],AE:['AD','DI'],AI:['AH','DI'],AM:['AL','DI'],AQ:['AP','DI'],AV:['AU','DI'],AZ:['AY','DI'],BD:['BC','DI'],BH:['BG','DI'],BL:['BK','DI'],BP:['BO','DI'],BT:['BS','DI'],BX:['BW','DI'],CB:['CA','DI'],CG:['CF','DI'],CJ:['CI','E'],CL:['CK','E'],CN:['CM','E'],CO:['E','F'],DA:['E','CZ'],DF:['DE','E'],DH:['DG','E'],DL:['DK','DI'],DN:['DM','DI'],DP:['DO','DI'],DR:['DQ','DI'],DT:['DS','DI'],DW:['DV','DI'],DY:['DX','DI'],EA:['DZ','DI'],EC:['EB','DI'],EE:['ED','DI']};
  const workshop=r=>r.workshop||pending;
  function group(rows,key){const m=new Map();for(const r of rows){const k=key(r);if(!m.has(k))m.set(k,[]);m.get(k).push(r);}return [...m.entries()];}
  function aggregate(rows,customer,workshopName,title='合计'){
    const values={A:customer,B:workshopName||'',C:title},formulas={};
    const keys=[...new Set(rows.flatMap(r=>Object.keys(r.values)))];
    for(const k of keys){if(['A','B','C'].includes(k)||ratios[k])continue;values[k]=rows.length&&rows.every(r=>numeric(r.values[k]))?rows.reduce((s,r)=>s+r.values[k],0):null;}
    for(const [k,[a,b]] of Object.entries(ratios)){values[k]=numeric(values[a])&&numeric(values[b])?(values[b]===0?0:values[a]/values[b]):null;formulas[k]=`IF(${b}1=0,0,${a}1/${b}1)`;}
    return {kind:'total',values,formulas,sources:{},issues:[],missing:[],workshop:workshopName||'',members:rows,count:rows.length,quantity_count:rows.filter(r=>numeric(r.values.D)).length};
  }
  function reportRows(rows,mode='customer-detail'){
    const out=[];
    if(mode==='customer-detail'){
      for(const [customer,rs] of group(rows,r=>r.values.A)){
        for(const [w,items] of group(rs,workshop)){out.push({kind:'heading',title:`${customer} · ${w}`},...items,aggregate(items,customer,w,'车间小计'));}
        out.push(aggregate(rs,customer,'','客户合计'));
      }
    }else if(mode==='workshop-summary'){
      for(const [w,rs] of group(rows,workshop)){
        out.push({kind:'heading',title:w});
        for(const [customer,items] of group(rs,r=>r.values.A))out.push(aggregate(items,customer,w,'客户小计'));
        out.push(aggregate(rs,'全部客户',w,'车间合计'));
      }
      if(rows.length)out.push(aggregate(rows,'全部客户','','总合计'));
    }else if(mode==='customer-summary'){
      for(const [customer,items] of group(rows,r=>r.values.A))out.push(aggregate(items,customer,'','客户合计'));
      if(rows.length)out.push(aggregate(rows,'全部客户','','总合计'));
    }else{
      for(const [customer,rs] of group(rows,r=>r.values.A))out.push({kind:'heading',title:customer},...rs,aggregate(rs,customer,'','客户合计'));
    }
    return out;
  }
  return {pending,numeric,ratios,workshop,group,aggregate,reportRows};
});
