(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SupplierMaterialSync = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const normalize = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toUpperCase();
  const compact = value => normalize(value).replace(/\s/g, '').replace(/[×＊*]/g, 'X');
  const supplierId = row => normalize(row.supplier_id || row.supplier_name);
  const supplierName = row => String(row.supplier_name || row.supplier_id || '').trim();
  const code = value => compact(value).replace(/^BEAUTYMINI[_-]S3-(\d+)$/, (_, n) => `BEAUTYM-S3-${String(Number(n)).padStart(3, '0')}`);
  const key = (row, byCode) => JSON.stringify([byCode ? code(row.product_code) : '',
    row.material_code ? ['code', compact(row.material_code)] : ['name', compact(row.name), compact(row.spec)]]);
  const legacyToken = (id, index) => JSON.stringify([id, index]);
  const isDetail = row => !row.is_subtotal && !row.children?.length;
  function suppliers(batches) {
    const known = new Map();
    for (const batch of batches) for (const row of batch.existing || []) {
      const id = supplierId(row);
      if (id && !known.has(id)) known.set(id, { id, name: supplierName(row) });
    }
    return [...known.values()].sort((a,b) => a.name.localeCompare(b.name, 'zh-CN'));
  }
  function plan({supplier, batches, legacyClaims = [], sourceFile = '', sourceSheet = ''}) {
    const name = String(supplier?.name || '').trim();
    const id = normalize(supplier?.id || (name ? 'name:' + name : ''));
    if (!name || !id) throw Error('请先选择或填写本次供应商');
    if (name.length > 100) throw Error('供应商名称请控制在100字以内');
    if (!batches.reduce((n,b) => n + b.items.length, 0)) throw Error('未识别到本次报价物料，不能据此删除旧资料');
    const ids = new Set(), claims = new Set(legacyClaims), validClaims = new Set();
    const changes = [], counts = {updated:0, added:0, deleted:0, claimed:0, legacyKept:0, otherKept:0, legacyConflicts:0};
    const output = batches.map(batch => {
      if (ids.has(batch.id)) throw Error('同步范围重复，请重新选择文件');
      ids.add(batch.id);
      const old = batch.existing || [], positions = new Map(), owned = new Set(), replacements = new Map(), removed = new Set(), additions = [];
      old.forEach((row,index) => {
        const claim = claims.has(legacyToken(batch.id,index));
        const owner = supplierId(row);
        if (claim) {
          if (owner || !isDetail(row)) throw Error('旧物料归属选择已失效，请重新核对');
          validClaims.add(legacyToken(batch.id,index)); counts.claimed++;
        }
        if (owner !== id && !claim) { counts[owner ? 'otherKept' : 'legacyKept']++; return; }
        if (!isDetail(row)) throw Error(`${row.name || '供应商物料'} 含分组或小计，请拆为明细后再同步`);
        owned.add(index);
        const identity = key(row,batch.byCode);
        if (!positions.has(identity)) positions.set(identity,[]);
        positions.get(identity).push(index);
      });
      const seen = new Set();
      for (const item of batch.items) {
        if (!compact(item.name) || !isDetail(item)) throw Error('物料名称缺失或不是明细，不能同步供应商资料');
        if (supplierId(item) && supplierId(item) !== id && normalize(item.supplier_name) !== normalize(name)) throw Error(`${item.name} 标注了其他供应商，请按供应商分开上传`);
        const identity = key(item,batch.byCode);
        if (seen.has(identity)) throw Error(`${item.product_code || ''} ${item.name} 在本次文件中重复，请核对后再同步`);
        seen.add(identity);
        counts.legacyConflicts += old.filter((row,index) => !supplierId(row) && !owned.has(index) && isDetail(row) && key(row,batch.byCode) === identity).length;
        const matches = positions.get(identity) || [];
        const incoming = {...item, supplier_id:id, supplier_name:name, source_file:sourceFile, source_sheet:item.source_sheet || sourceSheet};
        if (matches.length) {
          const index = matches[0], replacement = {...old[index],...incoming};
          for (const field of ['qty','unit_price_rmb','unit_price_usd','unit_price']) {
            if (Object.hasOwn(incoming,field) && !Object.hasOwn(incoming,field+'_raw')) delete replacement[field+'_raw'];
          }
          replacements.set(index,replacement);counts.updated++;
          changes.push({type:'更新',batchId:batch.id,batchLabel:batch.label,before:old[index],after:replacement});
          matches.slice(1).forEach(i => removed.add(i));
        } else {
          additions.push(incoming);counts.added++;
          changes.push({type:'新增',batchId:batch.id,batchLabel:batch.label,before:null,after:incoming});
        }
      }
      for (const index of owned) if (!replacements.has(index)) removed.add(index);
      for (const index of removed) {
        counts.deleted++;
        changes.push({type:'删除',batchId:batch.id,batchLabel:batch.label,before:old[index],after:null});
      }
      return {id:batch.id,changed:!!(replacements.size || removed.size || additions.length),rows:old.flatMap((row,index)=>removed.has(index)?[]:[replacements.get(index)||row]).concat(additions)};
    });
    if ([...claims].some(token=>!validClaims.has(token))) throw Error('旧物料归属选择已失效，请重新核对');
    return {supplier:{id,name},batches:output,changes,counts};
  }
  return {normalize,supplierId,supplierName,suppliers,key,legacyToken,isDetail,plan};
});
