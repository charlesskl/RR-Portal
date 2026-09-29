(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MixedMolds = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const number = (value, label, positive = false) => {
    const n = Number(value);
    if (value === '' || value == null || !Number.isFinite(n) || (positive ? n <= 0 : n < 0)) throw new Error(`${label}必须为${positive ? '正' : '非负'}数`);
    return n;
  };
  // Parse arithmetic only; never execute user-entered formula text.
  function ratioValue(value) {
    const source = String(value ?? '').trim().replace(/^=/, '').replace(/\s+/g, '');
    if (!source || source.length > 200) throw new Error('NA比例请输入数字、分数或算式');
    const tokens = source.match(/(?:\d+(?:\.\d*)?|\.\d+)|[()+*/%\-]/g) || [];
    if (tokens.join('') !== source) throw new Error('NA比例仅支持数字及 + - * / ( ) %');
    let i = 0;
    function atom() {
      let v;
      if (tokens[i] === '+' || tokens[i] === '-') { const sign = tokens[i++]; v = atom() * (sign === '-' ? -1 : 1); }
      else if (tokens[i] === '(') { i++; v = add(); if (tokens[i++] !== ')') throw new Error('NA比例括号不完整'); }
      else { const t = tokens[i++]; if (!t || !/^(?:\d|\.)/.test(t)) throw new Error('NA比例算式不完整'); v = Number(t); }
      if (tokens[i] === '%') { i++; v /= 100; }
      return v;
    }
    function multiply() { let v = atom(); while (tokens[i] === '*' || tokens[i] === '/') { const op = tokens[i++], r = atom(); if (op === '/' && r === 0) throw new Error('NA比例分母不能为零'); v = op === '*' ? v * r : v / r; } return v; }
    function add() { let v = multiply(); while (tokens[i] === '+' || tokens[i] === '-') { const op = tokens[i++], r = multiply(); v = op === '+' ? v + r : v - r; } return v; }
    const result = add();
    if (i !== tokens.length || !Number.isFinite(result) || result < 0) throw new Error('NA比例必须计算为非负数，分母不能为零');
    return result;
  }
  function validateConfig(config) {
    if (!config?.enabled) return;
    if (!['equal', 'ratio'].includes(config.mode)) throw new Error('请选择等量平均或按比例平均');
    const units = number(config.units_per_pack, '每包装小产品数量', true);
    if (!Number.isInteger(units)) throw new Error('每包装小产品数量必须为整数');
    if (!Array.isArray(config.products) || config.products.length < 2 || config.products.length > 200) throw new Error('混装款需要 2–200 个小产品');
    const ids = new Set(), codes = new Set();
    config.products.forEach(p => {
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(p.id) || ['__proto__', 'constructor', 'prototype'].includes(p.id) || ids.has(p.id)) throw new Error('小产品标识无效或重复');
      if (!String(p.name || '').trim() || !String(p.code || '').trim()) throw new Error('每个小产品必须填写货号和名称');
      if (codes.has(String(p.code).trim())) throw new Error('小产品货号不能重复');
      ids.add(p.id); codes.add(String(p.code).trim());
      if (config.mode === 'ratio') ratioValue(p.ratio);
      if (config.na_direct) ratioValue(p.na_ratio ?? p.ratio);
    });
    if (config.mode === 'ratio' && !config.products.some(p => ratioValue(p.ratio) > 0)) throw new Error('NA比例合计必须大于零');
    if (config.na_direct && !config.products.some(p => ratioValue(p.na_ratio ?? p.ratio) > 0)) throw new Error('NA比例合计必须大于零');
  }
  function weights(config) {
    validateConfig(config);
    const total = config.products.reduce((n, p) => n + (config.mode === 'equal' ? 1 : ratioValue(p.ratio)), 0);
    if (!(total > 0)) throw new Error('NA比例合计必须大于零');
    return Object.fromEntries(config.products.map(p => [p.id, (config.mode === 'equal' ? 1 : ratioValue(p.ratio)) / total]));
  }
  function pricingWeights(config) {
    validateConfig(config);
    if (!config.na_direct) return weights(config);
    return Object.fromEntries(config.products.map(p => [p.id, ratioValue(p.na_ratio ?? p.ratio)]));
  }
  // 每一阶段仅对仍在生产的穴数分摊机台费用。报价允许非整数啤次，与参考核价表一致。
  function calculate(config, molds, orderQty) {
    const shares = weights(config);
    const productCosts = Object.fromEntries(config.products.map(p => [p.id, 0]));
    const results = (molds || []).map((mold, mi) => {
      const label = mold.mold_no || `共模 ${mi + 1}`;
      const shotCost = number(mold.machine_price, `${label} 机台日价`, true) / number(mold.target, `${label} 日啤次`, true);
      if (!Array.isArray(mold.parts) || !mold.parts.length) throw new Error(`${label} 至少需要一个零件`);
      const parts = mold.parts.map((p, pi) => {
        if (!Object.hasOwn(shares, p.product_id)) throw new Error(`${label} 零件 ${pi + 1} 未选择有效的小产品`);
        const cavity = number(p.cavity, `${label} 穴数`, true);
        if (!Number.isInteger(cavity)) throw new Error(`${label} 穴数必须为整数`);
        const usage = number(p.usage, `${label} 单款用量`, true);
        const demand = p.demand === '' || p.demand == null
          ? number(orderQty, '出货包装数量', true) * Number(config.units_per_pack) * shares[p.product_id] * usage
          : number(p.demand, `${label} 零件需求量`, true);
        return { ...p, cavity, usage, demand, cycles: demand / cavity, labor_total: 0 };
      });
      const endpoints = [...new Set(parts.map(p => p.cycles))].sort((a, b) => a - b);
      const stages = [];
      let previous = 0;
      endpoints.forEach(end => {
        const active = parts.filter(p => p.cycles > previous);
        const cavities = active.reduce((n, p) => n + p.cavity, 0);
        const cycles = end - previous;
        active.forEach(p => { p.labor_total += cycles * shotCost * p.cavity / cavities; });
        stages.push({ cycles, cavities, cost: cycles * shotCost });
        previous = end;
      });
      parts.forEach(p => {
        p.unit_labor = p.labor_total / p.demand;
        p.product_labor = p.unit_labor * p.usage;
        productCosts[p.product_id] += p.product_labor;
      });
      return { ...mold, parts, stages, shot_cost: shotCost, total_cost: previous * shotCost };
    });
    return { molds: results, productCosts };
  }
  function enableCatalog(root, config, qty) {
    if (root.parts_catalog) return;
    const allocation = calculate(config, root.mixed_molds || [], qty);
    const parts = [], selections = {}, keys = new Map();
    for (const id of [...config.products.map(p => p.id), '__shared__']) {
      const payload = id === '__shared__' ? root.mixed_shared || {} : root.mixed_products?.[id] || {};
      selections[id] = [];
      for (const row of payload.injection || []) {
        const shared = allocation.molds.flatMap(m => m.parts.map(p => ({ ...p, mold_no: m.mold_no }))).find(p => p.product_id === id && p.mold_no === row.mold_no && p.name === row.name);
        const part = { ...JSON.parse(JSON.stringify(row)), loss_pct: payload.injection_loss_pct ?? 3 };
        if (shared) part.shared_source = { product_id: id, mold_no: shared.mold_no, name: shared.name };
        // Only identical specifications/prices are combined; differing quotations stay separate.
        const key = JSON.stringify([part.mold_no, part.name, part.material, part.weight_g, part.material_unit_price, part.shot_price, part.loss_pct, part.shared_source, part.cavity]);
        let partId = keys.get(key);
        if (!partId) { partId = `part_${parts.length + 1}`; keys.set(key, partId); parts.push({ ...part, id: partId }); }
        const existing = selections[id].find(p => p.part_id === partId);
        if (existing) existing.usage++; else selections[id].push({ part_id: partId, usage: 1 });
      }
    }
    root.parts_catalog = { version: 1, parts, selections };
  }
  const DEFAULT_MACHINE_PRICES = [
  { model: '4A-6A',     normal: '80T',    price: 940 },
  { model: '7A-9A',     normal: '60-80T', price: 1050 },
  { model: '10A-12A',   normal: '120T',   price: 1160 },
  { model: '14A-16A',   normal: '150T',   price: 1490 },
  { model: '20A',       normal: '200T',   price: 1920 },
  { model: '24A',       normal: '260T',   price: 1920 },
  { model: '32A',       normal: '320T',   price: 2220 },
  { model: '44A',       normal: '490T',   price: 2500 },
  { model: '46A-49.9A', normal: '',       price: 2800 },
  { model: '60A',       normal: '500T',   price: 3090 },
  { model: '80A',       normal: '',       price: 3590 },
  { model: '81.3A',     normal: '',       price: 3600 },
  { model: '105A',      normal: '800T',   price: 4500 },
];
const DEFAULT_MATERIAL_PRICES = [
  { name: 'ABS', model: '750SW', price: 6.50 },
  { name: '透明ABS', model: 'TR558/920', price: 10.00 },
  { name: 'HIPS', model: 'HI425', price: 6.00 },
  { name: 'GP', model: 'MW-1', price: 6.80 },
  { name: '1#PP', model: 'JM350/K8009', price: 5.80 },
  { name: '1#PP', model: '7032 E3', price: 5.80 },
  { name: '透明PP', model: '5090T', price: 6.50 },
  { name: 'POM', model: 'F3003/M9044', price: 13.50 },
  { name: 'POM', model: 'PM820/DM220', price: 18.00 },
  { name: 'PVC', model: '普通透明', price: 7.20 },
  { name: 'PVC', model: '普通本白', price: 6.20 },
  { name: 'LDPE', model: 'G812', price: 6.50 },
  { name: 'HDPE', model: 'HMA016', price: 6.90 },
  { name: 'TPR', model: '本白橡胶料', price: 13.80 },
  { name: 'TPR', model: '透明橡胶料', price: 16.10 },
  { name: 'K料', model: 'KR-03NW', price: 12.50 },
  { name: 'PC料', model: '2605', price: 10.80 },
];

// 料型列在注塑主表中隐藏：有料型时优先精确匹配；无匹配时按材质取参考表首条默认价。
function lookupMaterialPrice(material, grade, prices) {
  if (!prices || !prices.length) return null;
  if (!material) return null;
  const normalizeMaterial = value => String(value || '')
    .replace(/\s+/g, '').replace(/^1#/, '').replace(/料$/, '').toUpperCase();
  const m = normalizeMaterial(material);
  const g = String(grade || '').replace(/\s+/g, '').toUpperCase();
  const candidates = prices.filter(p => normalizeMaterial(p.name) === m);
  if (!candidates.length) return null;
  const exact = g && candidates.find(p => {
    const pm = String(p.model || '').replace(/\s+/g, '').toUpperCase();
    return pm === g;
  });
  return exact || candidates[0];
}

  function materialPricePerGram(price) {
    return +(number(price.price, '参考料价') / 454).toFixed(5);
  }
  function catalogMaterialPrice(root, part) {
    if (part.material_unit_price !== '' && part.material_unit_price != null && !(part.price_pending && Number(part.material_unit_price) === 0))
      return number(part.material_unit_price, '料价');
    const matched = lookupMaterialPrice(part.material, part.material_grade,
      root.material_prices?.length ? root.material_prices : DEFAULT_MATERIAL_PRICES);
    return matched ? materialPricePerGram(matched) : 0;
  }
  function productionDemand(root, part) {
    if (Object.hasOwn(part, 'production_demand')) return part.production_demand;
    const ref = part.shared_source;
    if (!ref) return '';
    return (root.mixed_molds || []).find(m => m.mold_no === ref.mold_no)?.parts?.find(p =>
      p.product_id === ref.product_id && p.name === ref.name)?.demand ?? '';
  }
  function catalogMachineReference(root, part) {
    const model = parseFloat(part.machine_model);
    const match = (root.machine_prices?.length ? root.machine_prices : DEFAULT_MACHINE_PRICES).find(r => {
      const range = String(r.model).match(/^([\d.]+)A?-([\d.]+)A?$/i);
      return range ? model >= +range[1] && model <= +range[2] : model === parseFloat(r.model);
    });
    return match;
  }
  function catalogMachinePrice(root, part) {
    if (part.machine_price != null && part.machine_price !== '') return Number(part.machine_price);
    const match = catalogMachineReference(root, part);
    return match?.price ?? (root.mixed_molds || []).find(m => m.mold_no === part.mold_no)?.machine_price;
  }
  function automaticCatalogLabor(root, config, qty) {
    const groups = new Map(), result = new Map();
    const catalog = root.parts_catalog;
    for (const part of catalog.parts) {
      const key = String(part.mold_no || '').trim() || part.id;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(part);
    }
    for (const [key, parts] of groups) {
      const source = (root.mixed_molds || []).find(m => m.mold_no === key);
      const rates = root.machine_prices?.length ? root.machine_prices : DEFAULT_MACHINE_PRICES;
      const jobs = parts.map(part => {
        const model = String(part.machine_model || '').replace(/\s+/g, '').toUpperCase();
        const matched = rates.find(r => {
          const text = String(r.model).toUpperCase();
          const range = text.match(/^([\d.]+)A?-([\d.]+)A?$/);
          return range ? parseFloat(model) >= +range[1] && parseFloat(model) <= +range[2] : parseFloat(model) === parseFloat(text);
        });
        const price = number((part.machine_price === '' ? null : part.machine_price) ?? matched?.price ?? source?.machine_price, part.name + ' 机台日费用（待补参数）', true);
        const target = number(part.target ?? source?.target, part.name + ' 日产啤次（待补参数）', true);
        const cavity = number(part.cavity, part.name + ' 出模数（待补参数）', true);
        if (!Number.isInteger(cavity)) throw new Error(part.name + ' 出模数必须为整数');
        const specified = productionDemand(root, part);
        const sharedRef = catalog.selections?.__shared__?.find(r => r.part_id === part.id);
        const usedByProduct = Object.entries(catalog.selections || {}).some(([id, refs]) =>
          id !== '__shared__' && refs.some(r => r.part_id === part.id));
        if (sharedRef && !usedByProduct) {
          result.set(part.id, { unit_labor: price / target / cavity, shot_cost: price / target,
            machine_price: price, demand: 0, direct_labor: true });
          return null;
        }
        if (specified === '' || specified == null) throw new Error(part.name + ' 未填写生产需求量；请在啤机部手填生产需求量');
        const demand = number(specified, part.name + ' 生产需求量', true);
        return { part, price, target, cavity, demand, cycles: demand / cavity, total: 0 };
      }).filter(Boolean);
      if (!jobs.length) continue;
      if (jobs.some(j => j.price !== jobs[0].price || j.target !== jobs[0].target)) throw new Error(key + ' 同模具的机台费用和日产啤次必须一致');
      const shot = jobs[0].price / jobs[0].target;
      let previous = 0;
      for (const end of [...new Set(jobs.map(j => j.cycles).filter(n => n > 0))].sort((a,b) => a-b)) {
        const active = jobs.filter(j => j.cycles > previous);
        const cavities = active.reduce((n,j) => n+j.cavity,0);
        active.forEach(j => { j.total += (end-previous)*shot*j.cavity/cavities; });
        previous = end;
      }
      jobs.forEach(j => result.set(j.part.id, { unit_labor: j.demand ? j.total/j.demand : 0, shot_cost: shot, machine_price: j.price, demand: j.demand }));
    }
    return result;
  }

  function catalogRows(root, config, qty) {
    const catalog = root.parts_catalog;
    if (!catalog || catalog.version !== 1 || !Array.isArray(catalog.parts)) throw new Error('统一零件资料无效');
    const automatic = automaticCatalogLabor(root, config, qty);
    const ids = new Set(), resolved = new Map();
    for (const part of catalog.parts) {
      if (!/^[a-zA-Z0-9_-]+$/.test(part.id) || ids.has(part.id)) throw new Error('零件标识无效或重复');
      ids.add(part.id);
      if (!String(part.name || '').trim()) throw new Error('请填写零件名称');
      const calculated = automatic.get(part.id);
      const labor = calculated.unit_labor;
      resolved.set(part.id, { ...part, machine: catalogMachineReference(root, part)?.normal || part.machine || '', note: String(part.note || '').replace(/啤工沿用原表核定值[^。]*。?/g, '').replace(/啤工由共模分摊自动计入。?/g, '').replace(/按原表K\d+材料价、J\d+啤工[^。]*。?/g, '') + '；啤工按需求完成后封穴自动计算，原表啤价不参与。', shot_price: labor, shot_cost: calculated.shot_cost, effective_machine_price: calculated.machine_price, labor_demand: calculated.demand, direct_labor: !!calculated.direct_labor, production_demand: productionDemand(root, part),
        weight_g: number(part.weight_g ?? 0, `${part.name} 重量`),
        material_unit_price: catalogMaterialPrice(root, part),
        loss_pct: number(part.loss_pct ?? 3, `${part.name} 料损`) });
    }
    const validProducts = new Set([...config.products.map(p => p.id), '__shared__']);
    for (const id of Object.keys(catalog.selections || {})) if (!validProducts.has(id)) throw new Error('零件选用引用了已删除的小产品');
    const rows = {};
    for (const id of validProducts) {
      const selected = new Set();
      rows[id] = (catalog.selections?.[id] || []).map(ref => {
        const part = resolved.get(ref.part_id);
        if (!part || selected.has(ref.part_id)) throw new Error('零件引用不存在或重复');
        selected.add(ref.part_id);
        const usage = number(ref.usage, `${part.name} 用量`, true);
        return { ...part, catalog_part_id: part.id, catalog_usage: usage, catalog_raw_weight: part.weight_g,
          weight_g: part.weight_g * usage * (1 + part.loss_pct / 100), shot_price: part.shot_price * usage };
      });
    }
    return { rows, resolved };
  }
  function cleanImportedMoldNote(note) {
    return String(note || '').replace(/来源：[\s\S]*?；料价与啤工待啤机部填写。/g, '').trim();
  }
  function inheritMoldFields(part, mold) {
    const result = {...part, note: cleanImportedMoldNote(part.note)};
    for (const key of ['sets','cycle_sec','machine','machine_model','target','daily_capacity','mold_type','mold_size','price_rmb','price_usd']) {
      if (result[key] == null || result[key] === '') result[key] = mold?.[key] ?? mold?.detail?.[key] ?? result[key];
    }
    return result;
  }
  function engineeringCatalog(root, engineering) {
    const copy = JSON.parse(JSON.stringify(root));
    if (!copy.parts_catalog && engineering?.mixed_imported_parts?.length) copy.parts_catalog = { version: 1, parts: [], selections: {} };
    if (copy.parts_catalog) {
      for (const part of engineering?.mixed_imported_parts || []) {
        const mold = (engineering.mixed_imported_molds || []).find(m => m.mold_no === part.mold_no && (!part.source_file || m.source_file === part.source_file) && (m.parts || []).some(p => p.name === part.name));
        const inherited = inheritMoldFields(part, mold);
        const existing = copy.parts_catalog.parts.find(p => p.id === part.id);
        if (!existing) copy.parts_catalog.parts.push(JSON.parse(JSON.stringify(inherited)));
        else Object.assign(existing, inheritMoldFields(existing, inherited));
      }
      if (engineering?.mixed_part_selections) copy.parts_catalog.selections = JSON.parse(JSON.stringify(engineering.mixed_part_selections));
      const deleted = new Set(engineering?.mixed_deleted_part_ids || []);
      copy.parts_catalog.parts = copy.parts_catalog.parts.filter(p => !deleted.has(p.id)).map(p => ({...p, ...(engineering?.mixed_part_edits?.[p.id] || {})}));
      copy.parts_catalog.parts.forEach(p => { p.note = cleanImportedMoldNote(p.note); });
      for (const id of Object.keys(copy.parts_catalog.selections || {})) copy.parts_catalog.selections[id] = copy.parts_catalog.selections[id].filter(r => !deleted.has(r.part_id));
    }
    return copy;
  }
  function engineeringCatalogRows(root) {
    const resolved = new Map((root.parts_catalog?.parts || []).map(p => [p.id, {
      ...p, weight_g: Number(p.weight_g || 0), loss_pct: Number(p.loss_pct ?? 3)
    }]));
    const rows = {};
    for (const [id, refs] of Object.entries(root.parts_catalog?.selections || {})) {
      rows[id] = refs.flatMap(ref => {
        const p = resolved.get(ref.part_id);
        return p ? [{ ...p, catalog_part_id: p.id, catalog_usage: ref.usage,
          catalog_raw_weight: p.weight_g }] : [];
      });
    }
    return { resolved, rows };
  }
  function applyCatalog(root, config, qty) {
    if (!root.parts_catalog) return root;
    const { rows } = catalogRows(root, config, qty);
    const copy = JSON.parse(JSON.stringify(root));
    copy.mixed_products ||= {}; copy.mixed_shared ||= {};
    for (const [id, injection] of Object.entries(rows)) {
      const payload = id === '__shared__' ? copy.mixed_shared : (copy.mixed_products[id] ||= {});
      payload.injection = injection;
      payload.injection_loss_pct = 0; // Each catalog row already carries its own loss.
    }
    return copy;
  }
  function costBreakdown(components, engineering, rates = {}) {
    const c = components || {}, cols = { imp_mat: c.imp_mat || 0, dom_mat: c.dom_mat || 0, injection_labor: c.injection_labor || 0,
      painting_labor: c.painting_labor || 0, paint_material: c.paint_material || 0, assembly_labor: c.assembly_labor || 0,
      shrink: 0, sticker: 0, box: 0, uv_bottle: 0, uv_glue: 0, silicone: 0, paper_bag: 0, card: 0, printed_bag: 0, foil: 0, fixture: 0, other: 0 };
    const unit = r => r.source_currency === 'USD' || (r.unit_price_usd != null && r.unit_price_rmb == null)
      ? Number(r.unit_price_usd ?? r.unit_price_usd_raw ?? 0) * (rates.fx_hkd_usd || 7.8)
      : r.unit_price_rmb != null ? Number(r.unit_price_rmb) / (rates.fx_rmb_hkd || .85) : Number(r.unit_price || 0);
    const amount = r => r.is_subtotal ? Number(r.amount || 0) : r.children?.length ? r.children.reduce((n,x) => n + Number(x.qty || 0) * unit(x), 0) : Number(r.qty || 0) * unit(r);
    const rules = [['uv_bottle', /UV.*瓶/i], ['uv_glue', /UV.*胶/i], ['silicone', /硅胶/], ['shrink', /收缩膜/], ['sticker', /贴纸|说明书|利宝|sticker/i], ['paper_bag', /纸袋/], ['card', /卡纸|内咭|内卡/], ['printed_bag', /印刷胶袋/], ['foil', /铝箔|铝膜/], ['fixture', /夹具/], ['box', /彩盒/]];
    for (const r of [...(engineering?.packaging_materials || []), ...(engineering?.aux_materials || [])]) {
      const rule = rules.find(([,pattern]) => pattern.test(String(r.name || '')));
      if (rule) cols[rule[0]] += amount(r);
    }
    const total = Object.entries(c).reduce((n,[key,value]) => n + (key === 'abs_material' ? 0 : Number(value || 0)), 0);
    cols.other = total - Object.values(cols).reduce((n,x) => n + x, 0);
    if (Math.abs(cols.other) < 1e-10) cols.other = 0;
    return { columns: cols, total };
  }
  function dynamicCostBreakdown(components, engineering, rates = {}) {
    const base = costBreakdown(components, {}, rates);
    const columns = Object.create(null), labels = Object.create(null);
    for (const key of ['imp_mat','dom_mat','injection_labor','painting_labor','paint_material','assembly_labor']) columns[key] = base.columns[key];
    const unit = row => row.source_currency === 'USD' || (row.unit_price_usd != null && row.unit_price_rmb == null)
      ? Number(row.unit_price_usd ?? row.unit_price_usd_raw ?? 0) * (rates.fx_hkd_usd || 7.8)
      : row.unit_price_rmb != null ? Number(row.unit_price_rmb) / (rates.fx_rmb_hkd || .85) : Number(row.unit_price || 0);
    const amount = row => row.is_subtotal ? Number(row.amount || 0) : row.children?.length
      ? row.children.reduce((sum, child) => sum + Number(child.qty || 0) * unit(child), 0) : Number(row.qty || 0) * unit(row);
    const categoryLabels = {hardware:'五金', motor:'马达', suction:'吸塑', glue_bag:'胶袋', color_box:'彩盒/内咭', battery:'电池', product_libao:'产品利宝', box_libao:'彩盒利宝', plating:'电镀', other_buy:'其他外购', carton:'纸箱', electronic:'电子', blow:'吹气', slush:'搪胶', sewing_hair:'车发', sewing_cloth:'车衣'};
    // 金额直接取与算价一致的分类成本；利宝按明细分类拆开，合计保持不变。
    let boxLibao = 0;
    for (const row of [...(engineering?.packaging_materials || []), ...(engineering?.aux_materials || [])]) {
      const valid = ['吸塑','胶袋','彩盒/内咭','电池','产品利宝','彩盒利宝','电镀','其他外购','利宝'];
      const text = String(row.name || '') + ' ' + String(row.spec || '');
      const category = valid.includes(row.category) ? row.category
        : /吸塑|blister|胶袋|胶代|poly\s?bag|pe\s?bag|opp\s?bag|电池|battery/i.test(text) ? ''
        : /利宝|贴纸|libao|sticker/i.test(text) && /彩盒|彩卡|内咭|内卡|背卡|包装|package|box/i.test(text) ? '彩盒利宝' : '';
      if (category === '彩盒利宝') boxLibao += amount(row);
    }
    for (const [key, label] of Object.entries(categoryLabels)) {
      labels[key] = label;
      columns[key] = key === 'box_libao' ? boxLibao : key === 'product_libao'
        ? Number(components?.libao || 0) - boxLibao : Number(components?.[key] || 0);
    }
    columns.other = base.total - Object.values(columns).reduce((sum, value) => sum + value, 0);
    if (Math.abs(columns.other) < 1e-10) columns.other = 0;
    return { columns, labels, total: base.total };
  }
  return { pricingWeights, ratioValue, catalogMachineReference, DEFAULT_MACHINE_PRICES, catalogMachinePrice, inheritMoldFields, engineeringCatalogRows, DEFAULT_MATERIAL_PRICES, lookupMaterialPrice, materialPricePerGram, catalogMaterialPrice, productionDemand, automaticCatalogLabor, validateConfig, weights, calculate, number, enableCatalog, catalogRows, applyCatalog, engineeringCatalog, costBreakdown, dynamicCostBreakdown };
});
