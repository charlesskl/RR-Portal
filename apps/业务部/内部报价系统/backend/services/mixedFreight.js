'use strict';
const types=[['factory','出厂价',null],['yt40','YT 40柜','cap_40'],['yt20','YT 20柜','cap_20'],['hk40','HK 40柜','cap_40'],['hk20','HK 20柜','cap_20'],['yt5t','YT 5吨车','cap_5t'],['yt10t','YT 10吨车','cap_10t'],['hk5t','HK 5吨车','cap_5t'],['hk10t','HK 10吨车','cap_10t']];
module.exports=function(sales,engineering){
 const f=sales.freight_calc||{},b=engineering.carton_calc||engineering.mixed_shared?.carton_calc||{};
 const cuft=Number(b.cuft)||Number(b.cl)*Number(b.cw)*Number(b.ch)/1728,pcs=Number(b.qty);
 const fp=Number(sales.shipping?.freight_pct??48),lp=Number(sales.shipping?.lifting_pct??52);
 if(!Number.isFinite(fp)||!Number.isFinite(lp)||fp<0||lp<0||Math.abs(fp+lp-100)>1e-8)throw Error('运费与吊柜费比例合计须为100%');
 return types.map(([key,name,cap])=>{
  if(!cap)return {key,name,boxes:0,freight:0,cabinet:0,total:0,valid:true};
  const boxes=cuft>0?Math.max(Math.round(Number(f[cap])/cuft),1):0;
  const valid=cuft>0&&pcs>0&&Number(f[cap])>0&&Number.isFinite(Number(f[key]))&&Number(f[key])>=0;
  const total=valid?Number(f[key])/boxes/pcs:0;
  return {key,name,boxes,cuft,pcs,freight:total*fp/100,cabinet:total*lp/100,total,valid};
 });
};
