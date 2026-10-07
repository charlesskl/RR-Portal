'use strict';
const { createHash, randomUUID } = require('node:crypto');
const { inheritMoldFields, validateConfig, prepareMoldImport, isNonMoldPart, updateEngineeringFields } = require('../../frontend/mixed-molds');
const canonical = value => /^\d+$/.test(String(value).trim()) ? String(Number(value)).padStart(2, '0') : String(value).trim();
function productNumbers(name) {
  const text = String(name || '').normalize('NFKC').trim();
  // P-prefixed product codes may touch the Chinese part name (P48千层饼下件).
  // A slash-separated shared part can belong to multiple products.
  if (/^P\s*\d+(?![A-Za-z0-9])/i.test(text)) {
    const codes = [...text.matchAll(/(?:^|[、,，/／&＆+＋])\s*P\s*(\d+)(?![A-Za-z0-9])/gi)]
      .map(match => `P${canonical(match[1])}`);
    return [...new Set(codes)];
  }
  const match = text.match(/^(\d+(?:\s*[、,，/／&＆+＋]\s*\d+)*)\s*[-－–—:：]\s*\S/);
  return match ? [...new Set(match[1].split(/[、,，/／&＆+＋]/).map(canonical))] : [];
}
function importedParts(molds) {
  if (!Array.isArray(molds) || !molds.length || molds.length > 2000) throw new Error('模具导入资料无效');
  return molds.flatMap(mold => (mold.parts?.length ? mold.parts : [mold]).map(part => ({
    ...inheritMoldFields(part, mold), name: String(part.name || mold.name || '').trim(),
    mold_no: String(mold.mold_no || part.mold_no || ''), material: part.material || mold.material || '',
  }))).filter(part => !isNonMoldPart(part) && part.name && !/^(制表|审核|批准|签名)\s*[:：]?$/.test(part.name));
}
function summarize(molds) {
  const parts = importedParts(molds), groups = new Map(), unmatched = [];
  for (const part of parts) {
    const codes = productNumbers(part.name);
    if (!codes.length) unmatched.push(part.name);
    for (const code of codes) { if (!groups.has(code)) groups.set(code, []); groups.get(code).push(part.name); }
  }
  return { product_count: groups.size, part_count: parts.length, unmatched,
    products: [...groups].sort(([a],[b]) => a.localeCompare(b, 'en', {numeric:true})).map(([code,names]) => ({code, parts:names})) };
}
const identity = part => JSON.stringify([part.mold_no || '', part.name || '', part.material || '', part.color || '']);
// Only remove untouched legacy placeholders; shared catalogs and real products survive.
function unusedPlaceholders(config, payloads) {
  const empty = value => value == null || value === '' || (typeof value === 'object' && Object.values(value).every(empty));
  return config.products.filter(p => /^p[12]$/.test(p.id) && p.code === p.id.toUpperCase()
    && p.name === `小产品 ${p.id.slice(1)}` && Number(p.ratio) === 1 && p.na_ratio == null
    && payloads.every(root => empty(root.mixed_products?.[p.id])
      && empty(root.mixed_part_selections?.[p.id]) && empty(root.parts_catalog?.selections?.[p.id])
      && empty(root.mixed_pricing?.[p.id])
      && !(root.mixed_molds || []).some(m => m.parts?.some(part => part.product_id === p.id))))
    .map(p => p.id);
}
function importParts(config, engineering, molds, { replacePlaceholders = false, sourceFile = '', existingParts = [], placeholderIds = [], mode = 'append' } = {}) {
  const summary = summarize(molds);
  if (!summary.product_count) throw new Error('没有识别到配件名称前的产品序号');
  const next = structuredClone(config);
  let root = prepareMoldImport(engineering, existingParts, mode);
  const removedProducts = mode === 'replace' ? next.products.filter(p => !summary.products.some(group => canonical(p.code) === group.code)) : [];
  if (removedProducts.length) {
    const removedIds = new Set(removedProducts.map(p => p.id));
    next.products = next.products.filter(p => !removedIds.has(p.id));
    root = require('./removeMixedProducts').removeMixedProducts(root, [...removedIds]);
  }
  if (mode === 'replace') existingParts = [];
  if (summary.product_count >= 2) {
    const removed = new Set(replacePlaceholders ? next.products.map(p => p.id) : placeholderIds);
    for (const id of removed) { delete root.mixed_products?.[id]; delete root.mixed_part_selections?.[id]; }
    next.products = next.products.filter(p => !removed.has(p.id));
  }
  for (const group of summary.products) {
    const matches = next.products.filter(p => canonical(p.code) === group.code);
    if (matches.length > 1) throw new Error(`序号 ${group.code} 对应多个现有小产品，请先整理货号`);
    if (!matches.length) {
      let id = `number_${group.code}`;
      while (next.products.some(p => p.id === id)) id += '_';
      next.products.push({ id, code:group.code, name:`小产品 ${group.code}`, ratio:1, ...(next.na_direct ? {na_ratio:0} : {}) });
    }
  }
  validateConfig(next);
  root.mixed_imported_parts ||= []; root.mixed_imported_molds ||= []; root.mixed_part_selections ||= {};
  const known = new Map([...existingParts, ...root.mixed_imported_parts].map(p => [identity(p),p]));
  let added = 0, assigned = 0, demandsFilled = 0;
  for (const part of importedParts(molds)) {
    const key = identity(part);
    let stored = known.get(key);
    if (!stored) {
      const matches = [...known.values()].filter(p => p.mold_no === part.mold_no && p.name === part.name && (!sourceFile || !p.source_file || p.source_file === sourceFile));
      if (matches.length === 1) stored = matches[0];
    }
    if (!stored) {
      const id = 'numbered_' + (mode === 'replace' ? randomUUID().replace(/-/g, '') : createHash('sha256').update(key).digest('hex').slice(0,24));
      if ([...known.values()].some(p => p.id === id)) throw new Error('零件标识冲突');
      stored = {...part, id, source_file:sourceFile, material_unit_price:null, shot_price:0, loss_pct:3};
      root.mixed_imported_parts.push(stored); known.set(key,stored); added++;
    }
    else {
      const updated = updateEngineeringFields(stored, {...part, source_file:sourceFile});
      Object.assign(stored, updated);
      const index = root.mixed_imported_parts.findIndex(p => p.id === stored.id);
      if (index < 0) root.mixed_imported_parts.push({...stored});
      else root.mixed_imported_parts[index] = {...stored};
    }
    if ((stored.production_demand == null || stored.production_demand === '') && part.production_demand != null) {
      stored.production_demand = part.production_demand; demandsFilled++;
      if (!root.mixed_imported_parts.some(p => p.id === stored.id)) root.mixed_imported_parts.push({...stored});
    }
    root.mixed_deleted_part_ids = (root.mixed_deleted_part_ids || []).filter(id => id !== stored.id);
    for (const code of productNumbers(part.name)) {
      const product = next.products.find(p => canonical(p.code) === code);
      const refs = root.mixed_part_selections[product.id] ||= [];
      if (!refs.some(r => r.part_id === stored.id)) { refs.push({part_id:stored.id,usage:1}); assigned++; }
    }
  }
  for (const mold of molds) {
    if (!root.mixed_imported_molds.some(m => JSON.stringify(m) === JSON.stringify({...mold,source_file:sourceFile}))) root.mixed_imported_molds.push({...mold,source_file:sourceFile});
  }
  root.mixed_import_summary = {...summary, source_file:sourceFile};
  return { config:next, engineering:root, summary:{...summary,added,assigned,demands_filled:demandsFilled,total_products:next.products.length,removed_product_ids:removedProducts.map(p => p.id)} };
}
module.exports = { productNumbers, summarize, importParts, unusedPlaceholders };
