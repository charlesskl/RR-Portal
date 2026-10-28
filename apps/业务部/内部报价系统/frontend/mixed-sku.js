(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./mixed-molds'));else root.MixedSku=factory(root.MixedMolds);})(typeof globalThis!=='undefined'?globalThis:this,function(molds){
  const serial=value=>/^\d+$/.test(String(value??'').trim())?String(Number(value)).padStart(2,'0'):String(value??'').trim();
  function productSerial(p){return serial(p.source_number || (/^\d+$/.test(String(p.code))?p.code:/^number_(\d+)_*$/.exec(p.id||'')?.[1] || /-(\d+)$/.exec(p.code||'')?.[1] || p.code));}
  const normalizedCode = value => String(value ?? '').normalize('NFKC').replace(/\s+/g,'').toUpperCase();
  // NO. is spreadsheet ordering metadata. Numbered mold parts use the official SKU.
  function productPartNumber(product) {
    const code = normalizedCode(product.code);
    if (/^\d+$/.test(code)) return serial(code);
    // EXCL qualifies the official SKU; it does not replace its numeric part.
    // Never fall back to spreadsheet NO. when a nonempty official code exists.
    const official = /-(\d+)(?:-EXCL)?$/.exec(code);
    return official ? serial(official[1]) : code || productSerial(product);
  }
  function partProductCodes(part) {
    const raw=String(part?.source_product_code ?? '').normalize('NFKC').trim();
    if(!raw)return [];
    const codes=raw.split(/[、,，;；/／\n&＆+＋]+/).map(normalizedCode).filter(Boolean);
    if(!codes.length || codes.some(code=>!/^[-A-Z0-9_]+$/.test(code)))throw Error(`零件${part.name || ''}的小产品货号格式无效`);
    return [...new Set(codes)];
  }
  function productsForPartCode(config, code, sourceNumber) {
    const official=normalizedCode(code);
    if (/^\d+$/.test(official)) return config.products.filter(p=>productPartNumber(p)===serial(official));
    const exact=config.products.filter(p=>normalizedCode(p.code)===official);
    return exact.length ? exact : config.products.filter(p=>
      /^\d+$/.test(String(p.code)) && productPartNumber(p)===productPartNumber({code:official,source_number:sourceNumber}));
  }
  function validateNumberedTargets(config, codes) {
    const claims=new Map();
    for (const value of codes) {
      const official=normalizedCode(typeof value==='object' ? value.code : value);
      if (/^\d+$/.test(official) || config.products.some(p=>normalizedCode(p.code)===official)) continue;
      for (const p of productsForPartCode(config,official,value.source_number)) {
        const previous=claims.get(p.id);
        if (previous && previous!==official) throw Error(`占位产品 ${p.code} 对应多个正式货号，请先核对`);
        claims.set(p.id,official);
      }
    }
  }
  function repairNumberedSelections(config, selections, parts, {missingTargetIds = null} = {}) {
    const allowedMissing = missingTargetIds == null ? null : new Set(missingTargetIds);
    const next=JSON.parse(JSON.stringify(selections || {})), changes=[], unresolved=[];
    const catalog=new Map(parts.map(part=>[part.id,part])), handled=new Set();
    for(const product of config.products) for(const ref of selections?.[product.id] || []) {
      const part=catalog.get(ref.part_id);
      const official=partProductCodes(part);
      if(official.length) {
        if(handled.has(part.id))continue;
        handled.add(part.id);
        const matches=official.map(code=>productsForPartCode(config,code));
        if(matches.some(rows=>rows.length!==1)){unresolved.push(`${part.name}：正式货号${official.join('、')}未找到或不唯一`);continue;}
        const targets=matches.map(rows=>rows[0]);
        const targetIds=new Set(targets.map(p=>p.id));
        const sources=config.products.flatMap(p=>(selections?.[p.id] || []).filter(r=>r.part_id===part.id).map(r=>({product:p,ref:r})));
        // An explicit SKU list describes eligible owners, not consent to undo
        // a manual deselection during an unrelated product/ratio update.
        const wrongOwner=sources.some(source=>!targetIds.has(source.product.id));
        const missing=targets.filter(p=>!(next[p.id] || []).some(r=>r.part_id===part.id) &&
          (allowedMissing === null || allowedMissing.has(p.id) || wrongOwner));
        const missingIds=new Set(missing.map(p=>p.id));
        if(missing.length && new Set(sources.map(s=>Number(s.ref.usage))).size>1)throw Error(`${part.name}的现有用量不同，无法确定新增共用关系的用量`);
        for(const source of sources.filter(s=>!targetIds.has(s.product.id)))for(const target of targets){
          const duplicate=(next[target.id] || []).find(r=>r.part_id===part.id);
          if(duplicate && Number(duplicate.usage)!==Number(source.ref.usage))throw Error(`${part.name}已被${target.code}选用且用量不同，请核对导入资料`);
        }
        for(const target of targets){
          const duplicate=(next[target.id] || []).find(r=>r.part_id===part.id);
          next[target.id] ||= [];
          if(!duplicate && missingIds.has(target.id)){next[target.id].push({...ref});changes.push({part_id:part.id,name:part.name,from:product.code,to:target.code});}
        }
        for(const source of sources.filter(s=>!targetIds.has(s.product.id))){
          next[source.product.id]=next[source.product.id].filter(r=>r.part_id!==part.id);
          for(const target of targets)changes.push({part_id:part.id,name:part.name,from:source.product.code,to:target.code});
        }
        continue;
      }
      const prefix=/^(\d+)\s*[-－–—:：]\s*\S/.exec(String(part?.name || '').normalize('NFKC').trim());
      if(!prefix)continue;
      const number=serial(prefix[1]);
      // Repair only the old NO.-based links; retain explicit manual/shared links.
      if(productSerial(product)!==number || productPartNumber(product)===number)continue;
      const matches=config.products.filter(p=>productPartNumber(p)===number);
      if(matches.length!==1){unresolved.push(`${part.name}：正式货号${number}未找到或不唯一`);continue;}
      const target=matches[0];
      const duplicate=(next[target.id] || []).find(r=>r.part_id===ref.part_id);
      if(duplicate && Number(duplicate.usage)!==Number(ref.usage))throw Error(`${part.name}已被${target.code}选用且用量不同，请手动核对`);
      next[product.id]=next[product.id].filter(r=>r.part_id!==ref.part_id);
      next[target.id] ||= [];
      if(!duplicate)next[target.id].push({...ref});
      changes.push({part_id:ref.part_id,name:part.name,from:product.code,to:target.code});
    }
    return {selections:next,changes,unresolved};
  }
  function apply(config,records){
    const next=JSON.parse(JSON.stringify(config)),seen=new Set(),codes=new Set(),updatedIds=new Set();let matched=0,added=0;
    validateNumberedTargets(config,records);
    const withRatios=records.some(r=>Object.hasOwn(r,'na_ratio'));
    if(withRatios && records.some(r=>typeof r.na_ratio!=='number'||!Number.isFinite(r.na_ratio)||r.na_ratio<0)) throw Error('Ratio per capsule 缺失或无效');
    for(const r of records){
      const number=serial(r.source_number);
      if(!number||!r.code||!r.name||seen.has(number)||codes.has(normalizedCode(r.code)))throw Error('配比表序号或货号缺失、重复');
      seen.add(number);codes.add(normalizedCode(r.code));
      const matches=productsForPartCode(next,r.code,r.source_number);
      if(matches.length>1)throw Error(`序号 ${number} 匹配多个产品，请先核对`);
      if(matches.length){updatedIds.add(matches[0].id);Object.assign(matches[0],{code:r.code,name:r.name,brand:r.brand,source_number:number,...(withRatios?{na_ratio:r.na_ratio}:{})});matched++;}
      else {let id=`sku_${number}`;while(next.products.some(p=>p.id===id))id+='_';updatedIds.add(id);next.products.push({id,code:r.code,name:r.name,brand:r.brand,source_number:number,ratio:1,...(withRatios?{na_ratio:r.na_ratio}:next.na_direct?{na_ratio:0}:{})});added++;}
    }
    if(withRatios){
      const missing=next.products.filter(p=>!updatedIds.has(p.id));
      if(!next.na_direct && missing.length) throw Error('首次导入NA比例需覆盖全部现有产品，缺少：'+missing.map(p=>p.code).join('、'));
      next.na_direct=true;
      if(!next.products.map(p=>molds.ratioValue(p.na_ratio ?? p.ratio)).some(value=>value>0)) throw Error('NA比例合计必须大于零');
    }
    if(new Set(next.products.map(p=>normalizedCode(p.code))).size!==next.products.length)throw Error('导入后货号重复');
    // NO. controls presentation order only. Product IDs (and department data)
    // still follow the official SKU even when the sheet order changes.
    const imported = next.products.filter(product=>updatedIds.has(product.id))
      .sort((a,b)=>Number(a.source_number)-Number(b.source_number));
    next.products = [...imported, ...next.products.filter(product=>!updatedIds.has(product.id))];
    return {config:next,matched,added,unmatched:next.products.filter(p=>!updatedIds.has(p.id)).map(p=>p.code)};
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
      // Beauty Mini is the supplier's spelling of the official BEAUTYM SKU family.
      // The numeric suffix is a SKU number, never the reordered spreadsheet NO.
      const exact=code?config.products.filter(p=>normalize(p.code)===code):[];
      const sourceNumber=/^BEAUTYMINI[_-]S3-(\d+)$/.exec(code)?.[1];
      const officialCode=sourceNumber?`BEAUTYM-S3-${String(Number(sourceNumber)).padStart(3,'0')}`:'';
      const official=officialCode?config.products.filter(p=>normalize(p.code)===officialCode):[];
      const qualified=sourceNumber?config.products.filter(p=>{
        const number=/^BEAUTYM-S3-(\d+)(?:-EXCL)?$/.exec(normalize(p.code))?.[1];
        return number!=null && Number(number)===Number(sourceNumber);
      }):[];
      const matches=exact.length?exact:official.length?official:qualified;
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
  return {serial,productSerial,productPartNumber,partProductCodes,productsForPartCode,validateNumberedTargets,repairNumberedSelections,apply,planPainting,planSupplier,planAssembly};
});
