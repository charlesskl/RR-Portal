(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./mixed-molds'));else root.MixedSku=factory(root.MixedMolds);})(typeof globalThis!=='undefined'?globalThis:this,function(molds){
  const serial=value=>/^\d+$/.test(String(value??'').trim())?String(Number(value)).padStart(2,'0'):String(value??'').trim();
  function productSerial(p){return serial(p.source_number || (/^\d+$/.test(String(p.code))?p.code:/^number_(\d+)_*$/.exec(p.id||'')?.[1] || /-(\d+)$/.exec(p.code||'')?.[1] || p.code));}
  function apply(config,records){
    const next=JSON.parse(JSON.stringify(config)),seen=new Set(),codes=new Set();let matched=0,added=0;
    const withRatios=records.some(r=>Object.hasOwn(r,'na_ratio'));
    if(withRatios && records.some(r=>typeof r.na_ratio!=='number'||!Number.isFinite(r.na_ratio)||r.na_ratio<0)) throw Error('Ratio per capsule 缺失或无效');
    for(const r of records){
      const number=serial(r.source_number);
      if(!number||!r.code||!r.name||seen.has(number)||codes.has(r.code))throw Error('配比表序号或货号缺失、重复');
      seen.add(number);codes.add(r.code);
      const matches=next.products.filter(p=>p.code===r.code||productSerial(p)===number);
      if(matches.length>1)throw Error(`序号 ${number} 匹配多个产品，请先核对`);
      if(matches.length){Object.assign(matches[0],{code:r.code,name:r.name,brand:r.brand,source_number:number,...(withRatios?{na_ratio:r.na_ratio}:{})});matched++;}
      else {let id=`sku_${number}`;while(next.products.some(p=>p.id===id))id+='_';next.products.push({id,code:r.code,name:r.name,brand:r.brand,source_number:number,ratio:1,...(withRatios?{na_ratio:r.na_ratio}:next.na_direct?{na_ratio:0}:{})});added++;}
    }
    if(withRatios){
      const missing=next.products.filter(p=>!seen.has(productSerial(p)));
      if(!next.na_direct && missing.length) throw Error('首次导入NA比例需覆盖全部现有产品，缺少：'+missing.map(p=>p.code).join('、'));
      next.na_direct=true;
      if(!next.products.map(p=>molds.ratioValue(p.na_ratio ?? p.ratio)).some(value=>value>0)) throw Error('NA比例合计必须大于零');
    }
    if(new Set(next.products.map(p=>p.code)).size!==next.products.length)throw Error('导入后货号重复');
    return {config:next,matched,added,unmatched:next.products.filter(p=>!seen.has(productSerial(p))).map(p=>p.code)};
  }
  function planPainting(config,items){
    const groups=new Map(),unmatched=new Set();
    for(const item of items){
      const code=String(item.source_product_code||'').replace(/\s+/g,'').toUpperCase();
      if(!code){unmatched.add('缺少货号');continue;}
      const matches=config.products.filter(p=>String(p.code).replace(/\s+/g,'').toUpperCase()===code ||
        (item.source_product_number && productSerial(p)===serial(item.source_product_number)));
      if(matches.length!==1){unmatched.add(code+(matches.length?'（匹配多款）':''));continue;}
      const product=matches[0];if(!groups.has(product.id))groups.set(product.id,{product,items:[]});
      const row={...item,name:product.name,images:item.images||[]};
      delete row.product_group_id;delete row.product_group_name;delete row.product_ratio;
      groups.get(product.id).items.push(row);
    }
    return {groups:[...groups.values()],unmatched:[...unmatched]};
  }
  function planSupplier(config,items,totalCode){
    const normalize=value=>String(value||'').normalize('NFKC').replace(/\s+/g,'').toUpperCase();
    const groups=new Map(),unmatched=new Set(),sharedItems=[];
    const total=normalize(totalCode);
    for(const item of items){
      const code=normalize(item.product_code);
      if(total && code===total){sharedItems.push({...item});continue;}
      // Supplier BeautyMini codes use the SKU list serial, including exclusive SKUs.
      // Prefer an exact official code; only this known alias may fall back to serial.
      const exact=code?config.products.filter(p=>normalize(p.code)===code):[];
      const sourceNumber=/^BEAUTYMINI[_-]S3-(\d+)$/.exec(code)?.[1];
      const matches=exact.length?exact:(sourceNumber?config.products.filter(p=>productSerial(p)===serial(sourceNumber)):[]);
      if(matches.length!==1){unmatched.add(code?(code+(matches.length?'（匹配多款）':'（未找到）')):'缺少货号');continue;}
      const product=matches[0];
      if(!groups.has(product.id))groups.set(product.id,{product,items:[]});
      groups.get(product.id).items.push({...item});
    }
    return {groups:[...groups.values()],unmatched:[...unmatched],sharedItems};
  }
  function planAssembly(config, rows) {
    const groups = new Map(), unmatched = new Set();
    const normalize = value => String(value || '').normalize('NFKC').replace(/\s+/g, '').toUpperCase();
    for (const row of rows) {
      const code = normalize(row.source_product_code);
      const matches = row.shared ? [{id:'__shared__',code:'共有费用',name:'每包装计一次'}] : config.products.filter(p => normalize(p.code) === code && code);
      if (matches.length !== 1) { unmatched.add((code || '缺少货号') + (matches.length ? '（匹配多款）' : '（未找到）')); continue; }
      const product = matches[0];
      if (!groups.has(product.id)) groups.set(product.id, {product, items:[]});
      const group = groups.get(product.id);
      // The department payload has one work-hours field per product. Never
      // silently replace an earlier lane's hours when normalized codes match.
      if (row.work_hours != null && group.items.some(item=>item.work_hours != null && Number(item.work_hours)!==Number(row.work_hours))) {
        unmatched.add(product.code + '（同一产品工时冲突）');
        continue;
      }
      group.items.push(JSON.parse(JSON.stringify(row)));
    }
    return {groups:[...groups.values()],unmatched:[...unmatched]};
  }
  return {serial,productSerial,apply,planPainting,planSupplier,planAssembly};
});
