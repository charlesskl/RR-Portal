(function(root,factory){ const api=factory(); if(typeof module==='object'&&module.exports)module.exports=api; if(root)root.JazwaresFreight=api; })(typeof globalThis!=='undefined'?globalThis:this,function(){
  function calculate(settings={},carton={},header={}) {
    const n=v=>Number.isFinite(Number(v))?Number(v):0;
    const fx=n(header.fx_rmb_hkd??0.85), usd=n(settings.usd_rate??7.75), divisor=n(settings.divisor??0.98), markup=n(settings.markup??1.25);
    const dimensions=[carton.cl,carton.cw,carton.ch].map(n);
    const cuft=dimensions.every(v=>v>0)?dimensions.reduce((a,b)=>a*b,1)/1728:n(carton.cuft);
    const cbm=cuft>0?cuft/35.32:null, pcs=n(carton.qty), unitCbm=cbm&&pcs>0?cbm/pcs:null;
    const capacity=n(settings.capacity_cbm??10);
    const regions=[['zhejiang','浙江',3500],['guangdong','广东省',1700]].map(([key,name,fee])=>{
      const rmb=n(settings[key+'_rmb']??fee), quantity=n(settings[key+'_quantity']??6000);
      const hkd=fx>0&&rmb>=0?rmb/fx:null;
      const perPiece=hkd!==null&&quantity>0?hkd/quantity:null;
      const usdPlain=perPiece!==null&&usd>0&&divisor>0?perPiece/divisor/usd:null;
      return {key,name,rmb,quantity,hkd,perPiece,usdPlain,usdMarkup:usdPlain!==null&&markup>=0?usdPlain*markup:null};
    });
    return {fx,usd,divisor,markup,capacity,cbm,pcs,unitCbm,theoreticalQuantity:unitCbm&&capacity>0?capacity/unitCbm:null,regions};
  }
  function matches(customer){return /jazwares/i.test(String(customer||''));}
  return {calculate,matches};
});
