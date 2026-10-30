(function () {
  'use strict';
  // crypto.randomUUID 仅在安全上下文（HTTPS/localhost）可用；
  // 内网 HTTP 部署下用 getRandomValues 生成 UUIDv4 降级（该 API 非安全上下文也可用）。
  const uuid = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = value => Number(value || 0).toFixed(4);
  const ratioPercent = value => Number.isFinite(value * 100) ? `${value * 100}%` : `比值 ${value}`;
  const ratioDisplay = value => {
    try { return window.MixedMolds.ratioValue(value).toFixed(4); }
    catch (_) { return String(value ?? ''); }
  };
  const config = () => window.__data?.mixed_quote;
  const nested = new WeakSet();
  // Shared mold allocations are display-only; never copy them into saved injection rows.
  const moldingContexts = new WeakMap();
  const engineeringContexts = new WeakMap();
  const engineeringHosts = new WeakMap();
  const summaryRequests = new WeakMap();
  function refreshEngineeringSharedMolds(host) {
    host.querySelectorAll('#wb-molds-shared').forEach(box => {
      const payload = engineeringHosts.get(box);
      if (payload) renderEngineeringSharedMolds(box, payload);
    });
  }
  function hasExistingEngineeringMoldCosts(payload) {
    // Historical product fees still contribute to the final quote. Keep their
    // editor available; moving them to shared costs would change ratio pricing.
    const mc = payload.mold_costs;
    return !!(mc && ((mc.items || []).some(item => Number(item.price_rmb) !== 0 && item.price_rmb != null && item.price_rmb !== '') ||
      ['customer_subsidy_usd','prototype_fee_usd','prototype_fee_rmb','testing_fee_usd','testing_fee_rmb'].some(key => Number(mc[key]) !== 0 && mc[key] != null && mc[key] !== '')));
  }
  function showsEngineeringMoldCosts(payload) {
    const context = engineeringContexts.get(payload);
    return !context || context.productId === '__shared__' || hasExistingEngineeringMoldCosts(payload);
  }
  function renderEngineeringSharedMolds(host, payload) {
    engineeringHosts.set(host, payload);
    const context = engineeringContexts.get(payload);
    if (!context) { host.innerHTML = ''; return; }
    const { cfg, productId } = context;
    const section = window.__data.sections.find(s => s.dept === 'molding');
    const molds = JSON.parse(section?.payload_json || '{}').mixed_molds || [];
    const rows = molds.flatMap(m => (m.parts || []).filter(p => p.product_id === productId).map(p => ({ mold: m, part: p })));
    host.innerHTML = rows.length ? `<section class="mixed-injection-allocation"><h4>共用模具 <span class="mixed-tag">啤机部同步</span></h4>
      <div class="mixed-scroll"><table aria-label="本款共用模具"><thead><tr><th>模号 / 本款零件</th><th>本款出模数<br>件/啤</th><th>每款用量</th><th>同模小产品及出模数</th></tr></thead><tbody>${rows.map(({ mold: m, part: p }) => `<tr><td>${esc(m.mold_no || '未填写模号')}<br><small>${esc(p.name || '未命名零件')}</small></td><td>${esc(p.cavity ?? '待填写')}</td><td>${esc(p.usage ?? '待填写')}</td><td>${m.parts.map(x => `${esc(cfg.products.find(product => product.id === x.product_id)?.code || '未选择')} · ${esc(x.name || '未命名零件')}：${esc(x.cavity ?? '待填写')} 出`).join('<br>')}</td></tr>`).join('')}</tbody></table></div>
      <p class="muted">与啤机部共模拆价使用同一份资料，保存啤机部草稿后同步。此处仅展示共模结构，模具制作费用在“每包装共有费用”中填写。</p></section>` : '';
  }
  function renderMoldingAllocation(host, payload) {
    const context = moldingContexts.get(payload);
    if (!context) { host.innerHTML = ''; return { amount: 0, hasRows: false }; }
    try {
      const { cfg, root, productId } = context;
      const result = window.MixedMolds.calculate(cfg, root.mixed_molds || [], window.__data.quote.qty);
      const rows = result.molds.flatMap(m => m.parts.filter(p => p.product_id === productId).map(p => ({ ...p, mold_no: m.mold_no })));
      const amount = result.productCosts[productId] || 0;
      host.innerHTML = rows.length ? `<section class="mixed-injection-allocation"><h4>共模啤价分摊 <span class="mixed-tag">自动计入本款</span></h4>
        <div class="mixed-scroll"><table aria-label="本款共模啤价分摊"><thead><tr><th>模号 / 零件</th><th>出模数<br>件/啤</th><th>每款用量</th><th>零件啤价<br>HK$/件</th><th>计入本款<br>HK$</th></tr></thead><tbody>${rows.map(p => `<tr><td>${esc(p.mold_no || '未填写模号')}<br><small>${esc(p.name || '未命名零件')}</small></td><td>${p.cavity}</td><td>${p.usage}</td><td>${fmt(p.unit_labor)}</td><td><strong>${fmt(p.product_labor)}</strong></td></tr>`).join('')}</tbody></table></div>
        <p class="muted">已包含在下方“啤价 总”中。修改请切换至“共用模具 · 拆分啤价”。</p></section>` : '';
      return { amount, hasRows: rows.length > 0 };
    } catch (error) {
      host.innerHTML = `<p class="mixed-error">共模啤价待完善：${esc(error.message)}。注塑总金额暂无法确定。</p>`;
      return { amount: 0, hasRows: true, error: error.message };
    }
  }
  async function request(path, options = {}) {
    const response = await fetch('./api' + path, { ...options, headers: { 'Content-Type': 'application/json' } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '操作失败');
    return data;
  }
  async function uploadResult(path, file) {
    const body = new FormData(); body.append('file', file);
    const response = await fetch(path, { method: 'POST', credentials: 'include', body });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || `解析失败（HTTP ${response.status}），请重新选择文件重试`);
    if (!data) throw new Error('服务器返回的解析结果无效，请重新选择文件重试');
    return data;
  }
  function assemblyImportState(root, cfg) {
    const groups = list => (list || []).map(({ _open, ...group }) => group);
    return JSON.stringify({ config: cfg, products: [...cfg.products.map(p => p.id), '__shared__'].map(id => {
      const payload = id === '__shared__' ? root.mixed_shared : root.mixed_products[id];
      return [id, groups(payload?.assembly_step_groups), groups(payload?.packaging_step_groups), payload?.assembly_std_time ?? 11];
    }) });
  }
  const input = (key, value, edit, type = 'number') => `<input data-field="${key}" type="${type}" value="${esc(value)}" ${edit ? '' : 'disabled'} ${type === 'number' ? 'step="any" min="0"' : ''}>`;
  function renderAllMolds(host, root, cfg, selectProduct) {
    const groups = new Map();
    const add = (no, row) => { const key = String(no || '').trim() || '未填写模号'; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row); };
    const products = [...cfg.products, { id: '__shared__', code: '共有费用', name: '每包装计一次' }];
    let allocation = [], error = '';
    try { allocation = window.MixedMolds.calculate(cfg, root.mixed_molds || [], window.__data.quote.qty).molds; }
    catch (e) { error = e.message; }
    for (const product of products) {
      const payload = product.id === '__shared__' ? root.mixed_shared : root.mixed_products[product.id];
      for (const part of payload?.injection || []) {
        const shared = allocation.flatMap(m => m.parts.map(p => ({ ...p, mold_no: m.mold_no }))).find(p => p.product_id === product.id && p.mold_no === part.mold_no && p.name === part.name);
        add(part.mold_no, { product, part, labor: Number(part.shot_price || 0) + (root.parts_catalog ? 0 : Number(shared?.product_labor || 0)), mode: shared ? '含共模分摊' : '明细啤价' });
      }
    }
    for (const mold of root.parts_catalog ? [] : root.mixed_molds || []) for (const part of mold.parts || []) {
      if ((root.mixed_products[part.product_id]?.injection || []).some(p => p.mold_no === mold.mold_no && p.name === part.name)) continue;
      const product = cfg.products.find(p => p.id === part.product_id) || { id: part.product_id, code: '未选择', name: '' };
      const calculated = allocation.find(m => m.mold_no === mold.mold_no)?.parts.find(p => p.product_id === part.product_id && p.name === part.name);
      add(mold.mold_no, { product, part, labor: calculated?.product_labor, mode: '共模分摊' });
    }
    host.innerHTML = `<h3>全部模具 · 按模号查看</h3><p class="muted">同一模号集中显示各零件及所属小产品。共用零件按各款引用列出，出模数不累加；本页不重复计费。未填模号的零件列在末尾。</p>${error ? `<p class="mixed-error">共模计算待完善：${esc(error)}</p>` : ''}
      <div class="mixed-scroll"><table aria-label="全部模具总览"><thead><tr><th>模号</th><th>零件名称</th><th>所属小产品</th><th>材质</th><th>出模数</th><th>净重 g</th><th>计入本款啤工 HKD</th><th>来源</th><th></th></tr></thead><tbody>${[...groups].sort(([a],[b]) => a === '未填写模号' ? 1 : b === '未填写模号' ? -1 : a.localeCompare(b, 'zh', { numeric: true })).map(([no, rows]) => rows.map((r, i) => `<tr>${i === 0 ? `<th rowspan="${rows.length}" scope="rowgroup">${esc(no)}</th>` : ''}<td>${esc(r.part.name)}</td><td>${esc(r.product.code)} · ${esc(r.product.name)}</td><td>${esc(r.part.material || '—')}</td><td>${esc(r.part.cavity ?? '—')}</td><td>${esc(r.part.catalog_raw_weight ?? r.part.weight_g ?? '—')}</td><td>${error ? '待核对' : r.labor == null ? '—' : fmt(r.labor)}</td><td>${esc(r.mode)}</td><td><button type="button" class="mini" data-open-product="${esc(r.product.id)}">查看明细</button></td></tr>`).join('')).join('') || '<tr><td colspan="9">暂无模具明细</td></tr>'}</tbody></table></div>`;
    host.querySelectorAll('[data-open-product]').forEach(button => button.onclick = () => selectProduct(button.dataset.openProduct));
  }
  function renderAllEngineeringMolds(host, root, cfg, selectProduct) {
    let molding = JSON.parse(window.__data.sections.find(s => s.dept === 'molding')?.payload_json || '{}');
    molding = window.MixedMolds.engineeringCatalog(molding, root);
    if (molding.parts_catalog) {
      if (root.mixed_part_selections) molding.parts_catalog.selections = root.mixed_part_selections;
      molding = window.MixedMolds.applyCatalog(molding, cfg, window.__data.quote.qty);
    }
    const groups = new Map();
    const add = (no, row) => { no = String(no || '').trim() || '未填写模号'; if (!groups.has(no)) groups.set(no, []); groups.get(no).push(row); };
    for (const product of [...cfg.products, { id: '__shared__', code: '共有费用', name: '每包装计一次' }]) {
      const payload = product.id === '__shared__' ? root.mixed_shared : root.mixed_products[product.id];
      const seen = new Set();
      for (const mold of molding.parts_catalog ? [] : payload?.molds || []) for (const part of mold.parts?.length ? mold.parts : [mold]) {
        const no = mold.mold_no || part.mold_no;
        seen.add(`${no || ''}|${part.name || ''}`);
        add(no, { product, part: { ...mold, ...part }, source: '工程模具明细' });
      }
      const injection = product.id === '__shared__' ? molding.mixed_shared?.injection : molding.mixed_products?.[product.id]?.injection;
      for (const part of injection || []) if (!seen.has(`${part.mold_no || ''}|${part.name || ''}`)) {
        seen.add(`${part.mold_no || ''}|${part.name || ''}`);
        add(part.mold_no, { product, part, source: '啤机部已保存明细' });
      }
      for (const mold of molding.parts_catalog ? [] : molding.mixed_molds || []) for (const part of mold.parts || []) if (part.product_id === product.id && !seen.has(`${mold.mold_no || ''}|${part.name || ''}`)) {
        add(mold.mold_no, { product, part, source: '啤机部共模结构' });
      }
    }
    host.innerHTML = `<h3>一、模具部分 · 全部模具</h3><p class="muted">按模号集中展示工程明细，并补充啤机部已保存的零件。共用零件按各款引用列出，出模数不累加。点击查看明细可进入对应小产品的工程资料。</p><div class="mixed-scroll"><table aria-label="工程全部模具"><thead><tr><th>模号</th><th>零件名称</th><th>所属小产品</th><th>材质</th><th>出模数</th><th>净重 g</th><th>资料来源</th><th></th></tr></thead><tbody>${[...groups].sort(([a],[b]) => a === '未填写模号' ? 1 : b === '未填写模号' ? -1 : a.localeCompare(b, 'zh', { numeric: true })).map(([no, rows]) => rows.map((r,i) => `<tr>${i === 0 ? `<th scope="rowgroup" rowspan="${rows.length}">${esc(no)}</th>` : ''}<td>${esc(r.part.name)}</td><td>${esc(r.product.code)} · ${esc(r.product.name)}</td><td>${esc(r.part.material || '—')}</td><td>${esc(r.part.cavity ?? '—')}</td><td>${esc(r.part.catalog_raw_weight ?? r.part.weight_g ?? '—')}</td><td>${esc(r.source)}</td><td><button type="button" class="mini" data-open-product="${esc(r.product.id)}">查看明细</button></td></tr>`).join('')).join('') || '<tr><td colspan="8">暂无模具明细</td></tr>'}</tbody></table></div>`;
    host.querySelectorAll('[data-open-product]').forEach(button => button.onclick = () => selectProduct(button.dataset.openProduct));
  }
  function renderCatalogReferences(host, root, edit, changed) {
    root.material_prices ||= JSON.parse(JSON.stringify(window.__refs?.material_prices?.length ? window.__refs.material_prices : window.MixedMolds.DEFAULT_MATERIAL_PRICES));
    root.machine_prices ||= JSON.parse(JSON.stringify(window.__refs?.machine_prices?.length ? window.__refs.machine_prices : window.MixedMolds.DEFAULT_MACHINE_PRICES));
    host.innerHTML = `<details class="ref-tables"><summary>参考表（料价 / 机型价）</summary><p class="muted">${edit ? '可修改本报价参考价，保存本部门草稿后生效。' : '进入本部门编辑模式后可修改参考价。'}</p><h4>料价表 HKD/磅</h4><div data-material-table></div><h4>机型价表 HKD/台班</h4><div data-machine-table></div></details>`;
    window.renderTable(host.querySelector('[data-material-table]'), [{key:'name',label:'料名'},{key:'model',label:'型号'},{key:'price',label:'HKD/磅',type:'number'},{key:'per_g',label:'HKD/g',readonly:true,calc:r=>Number(r.price || 0)/454}], root.material_prices, {readonly:!edit,onChange:changed});
    window.renderTable(host.querySelector('[data-machine-table]'), [{key:'model',label:'机型'},{key:'normal',label:'普通机'},{key:'price',label:'HKD/台班',type:'number'}], root.machine_prices, {readonly:!edit,onChange:changed});
  }
  function renderCatalog(host, root, cfg, edit, changed, productId) {
    const catalog = root.parts_catalog;
    if (!catalog) {
      host.innerHTML = '<h3>统一零件与产品组成</h3><p>将现有零件整理为统一明细，保留现有各款费用和共模分摊来源。</p>' + (edit ? '<button type="button">启用统一零件编辑</button>' : '<p>进入编辑后可启用。</p>');
      host.querySelector('button')?.addEventListener('click', () => { window.MixedMolds.enableCatalog(root, cfg, window.__data.quote.qty); changed(); renderCatalog(host, root, cfg, edit, changed, productId); });
      return;
    }
    let resolved = new Map(), error = '';
    try { resolved = window.MixedMolds.catalogRows(root, cfg, window.__data.quote.qty).resolved; } catch (e) { error = e.message; }
    const selectionMode = productId && productId !== '__catalog__';
    const materialPrices = root.material_prices?.length ? root.material_prices : (window.__refs?.material_prices?.length ? window.__refs.material_prices : window.MixedMolds.DEFAULT_MATERIAL_PRICES);
    const materialSelect = part => {
      const current = String(part.material || '');
      const choices = [...new Set([current, ...materialPrices.map(p => String(p.name || '').trim())].filter(Boolean))];
      return `<select data-field="material" aria-label="${esc(part.name)} 材质" ${edit ? '' : 'disabled'}><option value="">请选择</option>${choices.map(value => `<option value="${esc(value)}" ${value === current ? 'selected' : ''}>${esc(value)}</option>`).join('')}</select>`;
    };
    const fields = [['name','零件名称','text'],['images','图片','images'],['mold_no','模号','text'],['material','材质','text'],['weight_g','单份净重 g'],['loss_pct','料损 %'],['material_unit_price','料价 HKD/g'],['machine_model','机型','text'],['machine','机台'],['machine_price','机台日费用 HKD'],['target','日产啤次'],['cavity','出模数'],['production_demand','生产需求量（导入/手填）']];
    const lossRates = [...new Set(catalog.parts.map(p => Number(p.loss_pct ?? 3)))];
    const uniformLoss = lossRates.length === 1 ? lossRates[0] : catalog.parts.length ? '' : (root.catalog_loss_pct ?? 3);
    const selection = catalog.selections[productId] || [];
    const moldKey = p => String(p.mold_no || '').trim();
    const orderedParts = [...catalog.parts].sort((a,b) => {
      if (selectionMode) return Number(selection.some(r => r.part_id === b.id)) - Number(selection.some(r => r.part_id === a.id));
      const x = moldKey(a), y = moldKey(b);
      return !x ? (!y ? 0 : 1) : !y ? -1 : x.localeCompare(y, 'zh', { numeric: true });
    });
    const sharedMachineFields = new Set(['machine_model','machine','target']);
    function catalogCell(part, key, type, group, groupStart) {
      const shared = !selectionMode && moldKey(part) && sharedMachineFields.has(key);
      if (shared && !groupStart) return '';
      const state = shared && key !== 'machine' ? window.MixedMolds.catalogMoldField(root, part, key) : null;
      const value = state ? state.value : part[key] ?? '';
      let content;
      if (key === 'images') content = '<div data-catalog-images></div>';
      else if (key === 'machine') {
        const machines = [...new Set((shared ? group : [part]).map(p => window.MixedMolds.catalogMachineReference(root, p)?.normal || p.machine || '—'))];
        content = esc(machines.join(' / '));
      }
      else if (key === 'loss_pct') content = `<span data-loss-weight title="净重 ×（1＋${Number(part.loss_pct ?? 3)}%）">${fmt(Number(part.weight_g || 0) * (1 + Number(part.loss_pct ?? 3) / 100))}</span>`;
      else if (key === 'machine_price' && (part.machine_price == null || part.machine_price === '')) content = `<span>${window.MixedMolds.catalogMachinePrice(root, part) != null ? fmt(window.MixedMolds.catalogMachinePrice(root, part)) : '待补机型'}</span><small class="muted">（自动）</small>`;
      else if (selectionMode) content = esc(part[key] ?? '—');
      else if (key === 'material') content = materialSelect(part);
      else content = input(key, key === 'production_demand' ? window.MixedMolds.productionDemand(root, part) : key === 'material_unit_price' ? window.MixedMolds.catalogMaterialPrice(root, part) : value, edit, type || 'number') + (state?.conflict ? '<small class="muted">原值不同，请统一填写</small>' : '');
      return `<td data-catalog-cell="${key}"${shared ? ` rowspan="${group.length}" data-mold-shared="${esc(moldKey(part))}"` : ''} class="${sharedMachineFields.has(key) ? 'mixed-machine-column' : ''}">${content}</td>`;
    }
    host.innerHTML = `<h3>${selectionMode ? '选择本款包含的零件' : '统一填写注塑零件'}</h3><p class="muted">${selectionMode ? '勾选零件并填写每款用量，材料和啤工一起乘用量。共有费用按每包装计一次。' : '按模号填写零件，关联小产品自动同步。'} 完成后保存草稿。</p>${selectionMode ? '' : `<details style="margin:0 0 12px"><summary class="muted" style="cursor:pointer">计算说明</summary><ul class="muted"><li>同一模号共用机型、机台和日产啤次，合并单元格填写一次；机台按机型自动匹配。未填写模号的零件独立填写，搜索时保留整模。</li><li>每啤价＝机台日费用÷日产啤次；按出模数分摊，达到需求量后封穴，后续费用由仍在生产的零件分摊。原表啤价不参与计算。</li><li>小产品零件的生产需求量使用手填或导入值；仅用于共有费用的零件，啤工＝机台日费用÷日产啤次÷出模数，不需要生产需求量。</li><li>料价留空时匹配料价表，HKD/磅÷454，保留5位小数；已有单价保留，可重新套用料价表。</li><li>机台费用留空时按机型价表取值。</li></ul></details>`}<p class="mixed-error" data-catalog-error ${error ? '' : 'hidden'}>${esc(error)}</p>${edit && !selectionMode ? '<button type="button" data-material-reference>重新套用料价表</button>' : ''}<label>查找零件或模号 <input type="search" data-part-search placeholder="输入名称或模号"></label><div class="mixed-scroll mixed-injection-parts" role="region" aria-label="啤机部零件明细，可上下左右滚动" tabindex="0"><table aria-label="统一零件编辑"><thead><tr>${selectionMode ? '<th>选用</th><th>每款用量</th>' : ''}${fields.map(([key,label]) => key === 'loss_pct' ? `<th><label style="display:flex;align-items:center;gap:4px;white-space:nowrap">料损 <input type="number" data-catalog-loss aria-label="统一料损百分比" min="0" step="any" value="${uniformLoss}" placeholder="多种" style="width:65px;min-width:0;padding:4px 6px" ${edit && !selectionMode ? '' : 'disabled'}> %</label><small class="muted">含料损重量 g</small></th>` : `<th data-catalog-header="${key}" class="${['machine','machine_model','target'].includes(key) ? 'mixed-machine-column' : ''}">${esc(label)}</th>`).join('')}<th>计算方式</th><th>每啤价 HKD</th><th>零件啤工 HKD/件</th>${selectionMode ? '' : '<th>选用产品</th><th></th>'}</tr></thead><tbody>${orderedParts.map((part, index) => {
      const ref = selection.find(r => r.part_id === part.id);
      const owners = Object.entries(catalog.selections).filter(([,rows]) => rows.some(r => r.part_id === part.id)).map(([id]) => id === '__shared__' ? '共有费用' : cfg.products.find(p => p.id === id)?.code || id);
      const group = orderedParts.filter(p => moldKey(p) === moldKey(part));
      const groupStart = !selectionMode && (index === 0 || moldKey(orderedParts[index - 1]) !== moldKey(part));
      const models = [...new Set(group.map(p => String(p.machine_model || '待填')))];
      const targets = [...new Set(group.map(p => String(p.target || '待填')))];
      const heading = groupStart ? `<tr data-mold-heading="${esc(moldKey(part))}"><th colspan="${fields.length + 5}" style="text-align:left;background:#edf3fa;padding:10px 12px">${esc(moldKey(part) || '未填写模号')} · ${group.length} 个零件　<span style="font-weight:normal">机型：${esc(models.join(' / '))}　日产啤次：${esc(targets.join(' / '))}${moldKey(part) && (models.length > 1 || targets.length > 1) ? '　⚠ 同模参数不一致，请核对' : ''}</span></th></tr>` : '';
      return `${heading}<tr data-part-id="${esc(part.id)}">${selectionMode ? `<td><input type="checkbox" aria-label="选用 ${esc(part.name)}" data-pick ${ref ? 'checked' : ''} ${edit ? '' : 'disabled'}></td><td><input type="number" aria-label="${esc(part.name)} 用量" data-usage min="0.000001" step="any" value="${esc(ref?.usage ?? 1)}" ${edit && ref ? '' : 'disabled'}></td>` : ''}${fields.map(([key,,type]) => catalogCell(part, key, type, group, groupStart)).join('')}<td>${resolved.get(part.id)?.direct_labor ? '直接计算' : '完成后封穴'}</td><td data-shot-cost>${resolved.has(part.id) ? fmt(resolved.get(part.id).shot_cost) : '待补参数'}</td><td data-shot-price>${resolved.has(part.id) ? fmt(resolved.get(part.id).shot_price) : '待补参数'}</td>${selectionMode ? '' : `<td>${esc(owners.join('、') || '未选用')}</td><td>${edit ? '<button type="button" data-delete>删除</button>' : ''}</td>`}</tr>`;
    }).join('')}</tbody></table></div>${edit && !selectionMode ? '<button type="button" data-add>＋ 新增零件</button>' : ''}`;
    host.querySelectorAll('[data-part-id]').forEach(row => {
      const part = catalog.parts.find(p => p.id === row.dataset.partId);
      window.renderImageCell(row.querySelector('[data-catalog-images]'), part, false, () => {});
    });
    const lossControl = host.querySelector('[data-catalog-loss]');
    if (lossControl && edit && !selectionMode) {
      lossControl.oninput = () => {
        const value = Number(lossControl.value);
        if (lossControl.value === '' || !Number.isFinite(value) || value < 0) { lossControl.setCustomValidity('请输入大于等于 0 的料损率'); return; }
        lossControl.setCustomValidity('');
        root.catalog_loss_pct = value;
        catalog.parts.forEach(p => { p.loss_pct = value; });
        host.querySelectorAll('[data-part-id]').forEach(row => {
          const p = catalog.parts.find(p => p.id === row.dataset.partId);
          const cell = row.querySelector('[data-loss-weight]');
          cell.textContent = fmt(Number(p.weight_g || 0) * (1 + value / 100));
          cell.title = `净重 ×（1＋${value}%）`;
        });
        changed();
      };
    }
    host.querySelector('[data-material-reference]')?.addEventListener('click', async () => {
      try {
        const prices = root.material_prices?.length ? root.material_prices : (window.__refs?.material_prices?.length ? window.__refs.material_prices : window.MixedMolds.DEFAULT_MATERIAL_PRICES);
        root.material_prices = JSON.parse(JSON.stringify(prices));
        const misses = [];
        catalog.parts.forEach(part => {
          const match = window.MixedMolds.lookupMaterialPrice(part.material, part.material_grade, prices);
          if (match) { part.material_unit_price = window.MixedMolds.materialPricePerGram(match); part.material_grade = match.model || ''; }
          else misses.push(part.name);
        });
        changed(); redraw();
        if (misses.length) alert('以下零件没有匹配料价，保留原值：' + misses.join('、'));
      } catch(e) { alert('套用料价失败：' + e.message); }
    });
    host.querySelector('[data-part-search]').oninput = event => {
      const term = event.target.value.trim().toLowerCase();
      const hits = catalog.parts.filter(p => `${p.name} ${p.mold_no || ''}`.toLowerCase().includes(term));
      const molds = new Set(hits.map(moldKey).filter(Boolean));
      host.querySelectorAll('[data-part-id]').forEach(row => {
        const part = catalog.parts.find(p => p.id === row.dataset.partId);
        row.hidden = !hits.includes(part) && !(moldKey(part) && molds.has(moldKey(part)));
      });
      host.querySelectorAll('[data-mold-heading]').forEach(row => {
        row.hidden = !hits.some(p => moldKey(p) === row.dataset.moldHeading);
      });
    };
    function refreshCalculations() {
      let calculated = new Map();
      let calculationError = '';
      try { calculated = window.MixedMolds.catalogRows(root, cfg, window.__data.quote.qty).resolved; } catch (error) { calculationError = error.message; }
      const notice = host.querySelector('[data-catalog-error]');
      notice.textContent = calculationError; notice.hidden = !calculationError;
      host.querySelectorAll('[data-part-id]').forEach(row => {
        const p = catalog.parts.find(p => p.id === row.dataset.partId);
        const value = calculated.get(p.id);
        row.querySelector('[data-shot-cost]').textContent = value ? fmt(value.shot_cost) : '待补参数';
        row.querySelector('[data-shot-price]').textContent = value ? fmt(value.shot_price) : '待补参数';
        const weight = row.querySelector('[data-loss-weight]');
        weight.textContent = fmt(Number(p.weight_g || 0) * (1 + Number(p.loss_pct ?? 3) / 100));
        const machineCell = row.querySelector('[data-catalog-cell="machine"]');
        if (machineCell) {
          const group = !selectionMode && moldKey(p) ? window.MixedMolds.catalogMoldParts(root, p) : [p];
          machineCell.textContent = [...new Set(group.map(peer => window.MixedMolds.catalogMachineReference(root, peer)?.normal || peer.machine || '—'))].join(' / ');
        }
        const priceCell = row.querySelector('[data-catalog-cell="machine_price"]');
        if (priceCell.querySelector('span') && !priceCell.querySelector('input')) {
          const price = window.MixedMolds.catalogMachinePrice(root, p);
          priceCell.querySelector('span').textContent = price == null ? '待补机型' : fmt(price);
        }
      });
      host.querySelectorAll('[data-mold-heading]').forEach(row => {
        const group = catalog.parts.filter(p => moldKey(p) === row.dataset.moldHeading);
        const models = [...new Set(group.map(p => String(p.machine_model || '待填')))];
        const targets = [...new Set(group.map(p => String(p.target || '待填')))];
        row.querySelector('span').textContent = `机型：${models.join(' / ')}　日产啤次：${targets.join(' / ')}${models.length > 1 || targets.length > 1 ? '　⚠ 同模参数不一致，请核对' : ''}`;
      });
    }
    const redraw = () => {
      const scroll = host.querySelector('.mixed-scroll');
      const left = scroll?.scrollLeft || 0, top = scroll?.scrollTop || 0;
      const pageX = window.scrollX, pageY = window.scrollY;
      const search = host.querySelector('[data-part-search]').value;
      renderCatalog(host, root, cfg, edit, changed, productId);
      const next = host.querySelector('.mixed-scroll');
      if (next) { next.scrollLeft = left; next.scrollTop = top; }
      const filter = host.querySelector('[data-part-search]'); filter.value = search; filter.oninput({target:filter});
      window.scrollTo(pageX, pageY);
    };
    host.querySelectorAll('[data-part-id]').forEach(row => {
      const part = catalog.parts.find(p => p.id === row.dataset.partId);
      row.querySelectorAll('[data-field]').forEach(el => {
        const update = () => {
          const key = el.dataset.field;
          const value = el.type === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value;
          if (['machine_model','target'].includes(key)) window.MixedMolds.updateCatalogMoldField(root, part, key, value);
          else part[key] = value;
          el.parentElement?.querySelector('small')?.remove();
          if (key === 'material') {
            part.material_grade = '';
            const match = window.MixedMolds.lookupMaterialPrice(part.material, part.material_grade, materialPrices);
            part.material_unit_price = match ? window.MixedMolds.materialPricePerGram(match) : null;
            if (match) part.material_grade = match.model || '';
            changed(); redraw();
          } else if (key === 'mold_no') { changed(); }
          else { changed(); refreshCalculations(); }
        };
        if (el.tagName === 'SELECT') el.onchange = update;
        else el.oninput = update;
        if (el.dataset.field === 'mold_no') el.onchange = redraw;
      });
      row.querySelector('[data-pick]')?.addEventListener('change', event => {
        catalog.selections[productId] ||= [];
        if (event.target.checked) catalog.selections[productId].push({ part_id: part.id, usage: 1 });
        else catalog.selections[productId] = catalog.selections[productId].filter(r => r.part_id !== part.id);
        changed(); redraw();
      });
      row.querySelector('[data-usage]')?.addEventListener('change', event => { catalog.selections[productId].find(r => r.part_id === part.id).usage = Number(event.target.value); changed(); });
      row.querySelector('[data-delete]')?.addEventListener('click', () => {
        if (Object.values(catalog.selections).some(rows => rows.some(r => r.part_id === part.id))) { alert('该零件已有产品选用，请先取消选用。'); return; }
        catalog.parts = catalog.parts.filter(p => p.id !== part.id); changed(); redraw();
      });
    });
    host.querySelector('[data-add]')?.addEventListener('click', () => { catalog.parts.push({ id: `part_${Date.now()}`, name: '新零件', mold_no: '', material: 'PVC', weight_g: 0, material_unit_price: 0, shot_price: 0, loss_pct: root.catalog_loss_pct ?? 3, cavity: 1 }); changed(); redraw(); });
  }
  function moldImportMode(numbered = false) {
    const name = `mold-import-${uuid()}`;
    return `<fieldset class="mixed-import-options"><legend>选择导入方式</legend><div class="mixed-import-choices">
      <label class="mixed-import-choice"><input type="radio" name="${name}" data-import-mode value="append" checked><span><strong>追加 / 更新同名零件 <small>默认</small></strong><span>保留旧零件；同模号、同名称的零件更新工程资料，保留啤机价格和已有用量。</span></span></label>
      <label class="mixed-import-choice"><input type="radio" name="${name}" data-import-mode value="replace"><span><strong>完全替换模具与零件</strong><span>移除全部旧模具、零件及选用关系，按本次文件重新建立。${numbered ? '小产品清单同步更新；新文件中没有的产品及其部门明细将移除。' : ''}</span></span></label>
      </div><p class="muted">${numbered ? '追加保留原产品；完全替换保留同编号产品资料，移除其余产品明细并保存备份。' : '保留小产品清单、包装资料及其他部门资料。'}选择后点击下方按钮确认导入。</p></fieldset>`;
  }
  function bindMoldImportMode(preview, buttonSelector, numbered = false) {
    const button = preview.querySelector(buttonSelector);
    const update = () => {
      const replace = preview.querySelector('[data-import-mode]:checked').value === 'replace';
      button.textContent = `${replace ? '完全替换' : '追加更新'}${numbered ? '并按编号分配' : '模具与零件'}`;
      button.classList.toggle('mixed-import-replace', replace);
    };
    preview.querySelectorAll('[data-import-mode]').forEach(input => input.addEventListener('change', update));
    update();
  }
  function showNumberedImport(preview, result, file, root) {
    const groups = result.product_groups;
    if (!groups?.product_count || !config()?.enabled) return false;
    preview.innerHTML = `<section class="mixed-config"><h4>识别到 ${groups.product_count} 个小产品、${groups.part_count} 个配件</h4>
      <p>优先按“产品 Item＃”列的完整货号分配零件；填写多个货号的共用零件同时分配，每款默认用量为 1。旧表未填货号时按配件名称前的编号匹配。</p>
      <div class="mixed-scroll"><table><thead><tr><th>小产品货号 / 编号</th><th>所需配件</th><th>配件数</th></tr></thead><tbody>${groups.products.map(p=>`<tr><td>${esc(p.code)}</td><td>${p.parts.map(esc).join('、')}</td><td>${p.parts.length}</td></tr>`).join('')}</tbody></table></div>
      ${groups.unmatched.length ? `<p class="mixed-error">未识别归属，保留为待分配配件：${groups.unmatched.map(esc).join('、')}</p>` : ''}
      <p>导入将保存当前工程草稿，并按正式货号建立小产品归属；未填货号时按配件编号匹配。包装数量及现有比例不变。</p>
      ${moldImportMode(true)}<button type="button" data-numbered-apply>导入并按序号分配</button> <button type="button" data-numbered-cancel>取消</button><p data-numbered-status role="status"></p></section>`;
    bindMoldImportMode(preview, '[data-numbered-apply]', true);
    preview.querySelector('[data-numbered-cancel]').onclick = () => {preview.innerHTML='';};
    preview.querySelector('[data-numbered-apply]').onclick = async event => {
      const status = preview.querySelector('[data-numbered-status]');
      const mode = preview.querySelector('[data-import-mode]:checked').value;
      if (mode === 'replace') {
        const codes = new Set(groups.products.map(p => String(p.code)));
        const removed = config().products.filter(p => !codes.has(p.code) && !codes.has(window.MixedSku.productPartNumber(p)));
        if (!confirm(`完全替换全部模具和零件，并按文件重建为 ${groups.product_count} 个小产品？\n将移除 ${removed.length} 个旧产品及其各部门明细${removed.length ? '：' + removed.map(p => p.code).join('、') : ''}。\n同编号产品资料保留；移除前保存备份。`)) return;
      }
      const dirty = [...document.querySelectorAll('.dept-tab[title="有未保存修改"]')].some(tab=>tab.dataset.dept!=='engineering');
      if (dirty) {status.textContent='请先保存其他部门的修改，再执行导入。';return;}
      const button = event.currentTarget; button.disabled = true;
      try {
        const section = window.__data.sections.find(s=>s.dept==='engineering');
        const response = await fetch(`./api/quotes/${window.__data.quote.id}/mixed/import-molds`, {
          method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({mode,expected_sections:Object.fromEntries(window.__data.sections.map(s => [s.id,s.filled_at || ''])),molds:result.molds,source_file:file.name,engineering:root,base_filled_at:section.filled_at,expected_config:config()}),
        });
        const imported = await response.json();
        if (!response.ok) throw new Error(imported.error || '保存失败');
        status.textContent=`已保存：共 ${imported.total_products} 个小产品，新增 ${imported.added} 个配件、${imported.assigned} 个引用。`;
        location.reload();
      } catch(error) {status.textContent=error.message;button.disabled=false;}
    };
    return true;
  }
  function previewNumberedImport(preview, result, file, payload) {
    const context = engineeringContexts.get(payload);
    return context ? showNumberedImport(preview,result,file,context.root) : false;
  }

  function unifiedMoldUpload(host, root, edit, changed, redraw) {
    if (!edit) return;
    const box = document.createElement('section'); box.className = 'mixed-upload-card';
    box.innerHTML = `<div class="mixed-upload-top"><div class="mixed-upload-title"><span class="mixed-upload-icon" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 14h8M8 17h5"/></svg></span><div><h3>统一上传模具报价单</h3><p>一次导入模具，按小产品分配零件</p></div></div><label class="mixed-upload-button"><svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 16V3m-5 5 5-5 5 5M4 16v4h16v-4"/></svg>选择报价单<input type="file" accept=".xlsx,.xls" aria-label="统一上传模具报价单"></label></div><div class="mixed-upload-meta"><span class="mixed-upload-format">XLSX / XLS</span><span data-file-name>支持 Excel 模具报价单</span></div><ol class="mixed-upload-steps"><li><b>1</b>上传并预览</li><li><b>2</b>选择产品零件</li><li><b>3</b>填写料价与啤工</li></ol><p class="mixed-upload-footnote">模具原价保留在导入资料中，模费摊销另行填写。</p><div data-preview aria-live="polite"></div>`;
    host.prepend(box);
    box.querySelector('input').onchange = async event => {
      const file = event.target.files[0]; if (!file) return;
      box.querySelector('[data-file-name]').textContent = file.name;
      const preview = box.querySelector('[data-preview]'); preview.textContent = '正在解析…';
      try {
        const fd = new FormData(); fd.append('file', file);
        const response = await fetch('./api/uploads/mold-sheet', { method: 'POST', credentials: 'include', body: fd });
        const result = await response.json(); if (!response.ok) throw new Error(result.error || '解析失败');
        if (!result.molds?.length) throw new Error('没有识别到模具明细');
        if (showNumberedImport(preview,result,file,root)) return;
        preview.innerHTML = `<p>识别到 ${result.molds.length} 行模具资料（${esc(result.sheet_used || file.name)}）</p><div class="mixed-scroll"><table><thead><tr><th>模号</th><th>名称</th><th>零件数</th><th>模价 RMB</th><th>模价 USD</th><th>模价 HKD</th></tr></thead><tbody>${result.molds.map(m => `<tr><td>${esc(m.mold_no)}</td><td>${esc(m.name)}</td><td>${m.parts?.length || 1}</td><td>${esc(m.price_rmb ?? '—')}</td><td>${esc(m.price_usd ?? '—')}</td><td>${esc(m.price_hkd ?? '—')}</td></tr>`).join('')}</tbody></table></div>${moldImportMode()}<button type="button" data-apply>确认导入模具与零件</button><button type="button" data-cancel>取消</button>`;
        bindMoldImportMode(preview, '[data-apply]');
        preview.querySelector('[data-cancel]').onclick = () => { preview.innerHTML = ''; };
        preview.querySelector('[data-apply]').onclick = () => {
          let molding = JSON.parse(window.__data.sections.find(s => s.dept === 'molding')?.payload_json || '{}');
          molding = window.MixedMolds.engineeringCatalog(molding, root);
          const mode = preview.querySelector('[data-import-mode]:checked').value;
          if (mode === 'replace' && !confirm('完全替换当前全部模具和零件？保存工程草稿后生效，旧零件选用关系将移除。')) return;
          const previousParts = molding.parts_catalog?.parts || [];
          Object.assign(root, window.MixedMolds.prepareMoldImport(root, previousParts, mode));
          const existing = mode === 'replace' ? [] : previousParts;
          root.mixed_imported_parts ||= []; root.mixed_imported_molds ||= [];
          let added = 0;
          for (const mold of result.molds) {
            root.mixed_imported_molds.push({ ...mold, source_file: file.name });
            for (const part of mold.parts?.length ? mold.parts : [mold]) {
              const name = part.name || mold.name || '未命名零件', moldNo = mold.mold_no || part.mold_no || '';
              const previous = [...root.mixed_imported_parts, ...existing].find(p => p.name === name && p.mold_no === moldNo);
              if (previous) {
                const updated = window.MixedMolds.updateEngineeringFields(previous, {...window.MixedMolds.inheritMoldFields(part, mold), name, mold_no:moldNo, source_file:file.name});
                const index = root.mixed_imported_parts.findIndex(p => p.id === previous.id);
                if (index < 0) root.mixed_imported_parts.push(updated);
                else root.mixed_imported_parts[index] = updated;
                continue;
              }
              root.mixed_imported_parts.push({ ...window.MixedMolds.inheritMoldFields(part, mold), source_file: file.name, id: `upload_${Date.now()}_${root.mixed_imported_parts.length}`, name, mold_no: moldNo, material: part.material || mold.material || '', weight_g: Number(part.weight_g || 0), cavity: Number(part.cavity || 1), material_unit_price: null, shot_price: 0, loss_pct: 3, note: part.note || '' }); added++;
            }
          }
          root.mixed_part_selections ||= JSON.parse(JSON.stringify(molding.parts_catalog?.selections || {}));
          changed(); redraw();
          const notice = document.createElement('p'); notice.className = 'mixed-note'; notice.textContent = `已${mode === 'replace' ? '替换为' : '追加'} ${added} 个可选零件；同模号同名称的零件已更新工程资料，保留啤机价格。请保存工程草稿后到啤机部填写价格。`; host.prepend(notice);
        };
      } catch (e) { preview.textContent = `导入失败：${e.message}`; }
    };
  }
  function editEngineeringMolds(host, root, catalogRoot, changed, redraw, fxRmbHkd, fxHkdUsd) {
    const rmbRate = Number(fxRmbHkd) > 0 ? Number(fxRmbHkd) : .85;
    const usdRate = Number(fxHkdUsd) > 0 ? Number(fxHkdUsd) : 7.8;
    const moldHkd = part => (Number(part.price_rmb) || 0) / rmbRate + (Number(part.price_usd) || 0) * usdRate;
    const parts = [...(catalogRoot.parts_catalog?.parts || [])].sort((a,b) => String(a.mold_no || '').localeCompare(String(b.mold_no || ''), 'zh', {numeric:true}));
    const fields = [['mold_no','模号'],['name','零件名称'],['images','图片','images'],['material','材质'],['mold_type','模胚类型'],['cavity','出模数','number'],['sets','套数','number'],['weight_g','净重 g','number'],['cycle_sec','周期 秒','number'],['target','日产啤次','number'],['daily_capacity','日产能 件','number'],['machine','机台'],['mold_size','模具尺寸'],['price_rmb','模价 RMB','number'],['price_usd','模价 USD','number'],['price_hkd','模价 HKD','calculated'],['note','备注']];
    host.innerHTML = `<p class="muted">可直接填写、增删零件；保存工程草稿后同步啤机部。删除零件会同时移除其产品选用关系。模价按业务部报价参数汇率自动换算：HKD＝RMB ÷ ${rmbRate} ＋ USD × ${usdRate}。</p><div class="mixed-scroll mixed-engineering-molds" role="region" aria-label="全部模具明细，可上下左右滚动" tabindex="0"><table><thead><tr>${fields.map(f=>`<th>${f[1]}</th>`).join('')}<th>操作</th></tr></thead><tbody>${parts.map(p=>`<tr data-engineering-part="${esc(p.id)}">${fields.map(([key,,type])=>`<td>${type === 'images' ? '<div data-mold-images></div>' : type === 'calculated' ? `<span data-mold-hkd>${fmt(moldHkd(p))}</span>` : input(key,p[key] ?? '',true,type || 'text')}</td>`).join('')}<td class="mixed-mold-actions"><div class="mixed-mold-action-buttons"><button type="button" data-copy-part>复制</button><button type="button" data-remove>删除</button></div></td></tr>`).join('')}</tbody></table></div><button type="button" data-new>＋ 新增模具零件</button>`;
    host.querySelectorAll('[data-engineering-part]').forEach(row=>{
      const id=row.dataset.engineeringPart;
      const imagePart = {...parts.find(p=>p.id===id)};
      imagePart.images = [...(imagePart.images || [])];
      window.renderImageCell(row.querySelector('[data-mold-images]'), imagePart, true, () => {
        root.mixed_part_edits ||= {}; root.mixed_part_edits[id] ||= {};
        root.mixed_part_edits[id].images = [...imagePart.images];
        changed();
      });
      row.querySelectorAll('[data-field]').forEach(el=>el.onchange=()=>{
        root.mixed_part_edits ||= {}; root.mixed_part_edits[id] ||= {};
        root.mixed_part_edits[id][el.dataset.field]=el.type==='number' ? (el.value==='' ? null : Number(el.value)) : el.value;
        row.querySelector('[data-mold-hkd]').textContent = fmt(moldHkd({...parts.find(p=>p.id===id), ...root.mixed_part_edits[id]}));
        changed();
      });
      row.querySelector('[data-copy-part]').onclick=()=>{
        const original = parts.find(p=>p.id===id);
        const copy = JSON.parse(JSON.stringify({...original, ...(root.mixed_part_edits?.[id] || {})}));
        copy.id = 'manual_' + uuid().replace(/-/g,'');
        copy.name = (copy.name || '零件') + '（副本）';
        delete copy.shared_source;
        delete copy.source_row;
        delete copy.source_labor_formula;
        copy.shot_price = 0;
        root.mixed_imported_parts ||= [];
        root.mixed_imported_parts.push(copy);
        changed(); redraw();
      };
      row.querySelector('[data-remove]').onclick=()=>{
        root.mixed_deleted_part_ids=[...new Set([...(root.mixed_deleted_part_ids || []),id])];
        root.mixed_imported_parts=(root.mixed_imported_parts || []).filter(p=>p.id!==id);
        for(const refs of Object.values(root.mixed_part_selections || {})) { const i=refs.findIndex(r=>r.part_id===id); if(i>=0)refs.splice(i,1); }
        changed(); redraw();
      };
    });
    host.querySelector('[data-new]').onclick=()=>{
      root.mixed_imported_parts ||= [];
      root.mixed_imported_parts.push({id:'manual_'+Date.now(),name:'新零件',mold_no:'',weight_g:0,cavity:1,loss_pct:3});
      changed(); redraw();
    };
  }
  function renderGroupedNativeMolds(host, molds, ...rates) {
    const groups = new Map();
    molds.forEach((m, i) => {
      const key = String(m.mold_no || '').trim() || `未填写模号-${i + 1}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(m);
    });
    const ordered = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, 'zh-CN', { numeric: true }));
    const flat = ordered.flatMap(([, rows]) => rows.map(m => ({ ...m, product_group_id: '' })));
    window.renderMolds(host, flat, () => {}, false, ...rates);
    const body = host.querySelector('tbody');
    if (!body) return;
    const rows = [...body.rows];
    let offset = 0;
    ordered.forEach(([code, parts], groupIndex) => {
      const first = rows[offset];
      if (!first) return;
      const heading = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = first.cells.length;
      cell.textContent = `${code} · ${parts.length} 个零件`;
      cell.style.cssText = 'background:#eef3f8;color:#294766;font-weight:600;padding:10px 14px;border-top:2px solid #cbd5e1';
      heading.appendChild(cell); body.insertBefore(heading, first);
      first.cells[0].textContent = groupIndex + 1;
      first.cells[0].rowSpan = parts.length;
      first.cells[1].rowSpan = parts.length;
      first.cells[1].style.verticalAlign = 'middle';
      for (let i = 1; i < parts.length; i++) {
        rows[offset + i].deleteCell(1);
        rows[offset + i].deleteCell(0);
      }
      offset += parts.length;
    });
  }
  function nativeCatalogData(root, cfg, productId, engineeringOnly = false) {
    // 工程展示不依赖尚未填写的机型、日产啤次或啤工价格。
    const { resolved, rows } = engineeringOnly
      ? window.MixedMolds.engineeringCatalogRows(root)
      : window.MixedMolds.catalogRows(root, cfg, window.__data.quote.qty);
    const all = productId === '__all_molds__';
    const injection = all ? [...resolved.values()].map(p => ({ ...p, weight_g: p.weight_g * (1 + p.loss_pct / 100), catalog_raw_weight: p.weight_g })) : rows[productId] || [];
    injection.sort((a, b) => String(a.mold_no || '').trim().localeCompare(String(b.mold_no || '').trim(), 'zh-CN', { numeric: true }));
    const molds = injection.map(p => ({ ...p, mold_type: p.mold_type || '—', weight_g: p.catalog_raw_weight ?? p.weight_g,
      product_group_name: all ? Object.entries(root.parts_catalog.selections).filter(([,refs]) => refs.some(r => r.part_id === (p.catalog_part_id || p.id))).map(([id]) => cfg.products.find(x => x.id === id)?.code || '共有费用').join('、') : cfg.products.find(x => x.id === productId)?.code || '共有费用',
      note: `${p.note || ''}${p.catalog_usage ? `；本款用量 ${p.catalog_usage}` : ''}` }));
    return { injection, molds };
  }
  function applyAssemblyBaseRate(root, cfg, value) {
    if (String(value ?? '').trim() === '' || !Number.isFinite(Number(value)) || Number(value) < 0) {
      throw new Error('请输入大于等于0的有效基数');
    }
    const base = Number(value);
    root.mixed_products ||= {};
    for (const product of cfg.products) {
      const payload = root.mixed_products[product.id] ||= {};
      payload.assembly_base_rate = base;
    }
    root.mixed_shared ||= {};
    root.mixed_shared.assembly_base_rate = base;
    return base;
  }
  function applyAssemblyTarget(root, cfg, value) {
    if (String(value ?? '').trim() === '' || !Number.isFinite(Number(value)) || Number(value) <= 0) {
      throw new Error('请输入大于0的有效目标数');
    }
    const target = Number(value);
    const payloads = [...cfg.products.map(product => root.mixed_products?.[product.id]), root.mixed_shared];
    const groups = payloads.flatMap(payload => [...(payload?.assembly_step_groups || []), ...(payload?.packaging_step_groups || [])]);
    if (!groups.length) throw new Error('请先导入或填写装工、包装工序，再统一修改目标数');
    groups.forEach(group => { group.qty = target; });
    return target;
  }
  function engineeringDetailsHtml(records, fxRmbHkd, fxHkdUsd) {
    const value = v => v == null || v === '' ? '—' : esc(v);
    const number = v => Number(v) || 0;
    const sum = (rows, get) => rows.reduce((total,row) => total + get(row),0);
    const link = product => `<button type="button" class="mixed-product-link" data-open-engineering-product="${esc(product.id)}">${esc(product.code)}</button>`;
    const cells = values => values.map(v => `<td>${v}</td>`).join('');
    const row = (record,values,subtotal=false) => `<tr data-engineering-product="${esc(record.product.id)}"${subtotal ? ' class="mixed-detail-subtotal"' : ''}>${cells([link(record.product),...values,esc(record.product.name)])}</tr>`;
    const footer = (width,label,amount) => `<tfoot><tr><th colspan="${width}">${label}：${amount}</th></tr></tfoot>`;
    const group = (key,title,headers,body,total) => `<section data-engineering-category="${key}"><h4>${title}</h4><table class="wb-table"><thead><tr>${['货号',...headers,'产品名称'].map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${body || `<tr><td colspan="${headers.length+2}" class="muted">暂无明细</td></tr>`}</tbody>${footer(headers.length+2,'当前产品分类合计',total)}</table></section>`;
    const material = (key,title) => {
      let amount=0,freight=0;
      const body=records.map(record=>{
        const rows=record.payload[key] || [];
        if (!rows.length) return '';
        let subtotal=0,indo=0;
        const html=rows.map(item=>{
          const cost=window.freeAmountHkd(item,fxRmbHkd,fxHkdUsd);
          const ship=cost*number(record.payload.indo_pct)/100;
          subtotal+=cost;indo+=ship;
          const usd=window.usesFreeUsdPrice(item);
          const currency=usd?'USD':window.hasFreeRmbPrice(item)?'RMB':'HKD';
          const unit=usd?window.freeUsdSourcePrice(item):currency==='RMB'?item.unit_price_rmb:item.unit_price;
          return row(record,[value(item.name),value(item.spec),value(item.category),item.is_subtotal?'原表小计':value(item.qty_raw ?? item.qty),
            item.is_subtotal?'—':currency,item.is_subtotal?'—':value(item[usd?'unit_price_usd_raw':currency==='RMB'?'unit_price_rmb_raw':'unit_price_raw'] ?? unit),
            item.is_subtotal?'—':fmt(window.freeUnitHkd(item,fxRmbHkd,fxHkdUsd)),fmt(cost),value(record.payload.indo_pct),fmt(ship),value(item.tax_pct),
            value(item.moq ?? item.selected_moq),value(item.note),value(item.source_file)]);
        }).join('');
        amount+=subtotal;freight+=indo;
        return html+row(record,[`本款小计（${rows.length} 条）`,'','','','','','',fmt(subtotal),'',fmt(indo),'','','',''],true);
      }).join('');
      return group(key,title,['物料名称','规格','类别','用量 / 公式','币种','原币单价 / 公式','单价 HKD','金额 HKD','印尼运费 %','印尼运费 HKD','税点 %','MOQ','备注','来源文件'],body,`${fmt(amount)} HKD；印尼运费 ${fmt(freight)} HKD`);
    };
    const molds=records.map(record=>{
      if(record.moldError) return row(record,[esc(record.moldError)]);
      const parts=record.molds.flatMap(mold=>(mold.parts?.length?mold.parts:[mold]).map(part=>({...mold,...part,parts:undefined})));
      return parts.map((part,index)=>row(record,[value(part.mold_no),value(part.name),value(part.mold_type),value(part.material),value(part.color),value(part.cavity),value(part.sets),
        value(part.weight_g),value(part.cycle_sec),value(part.mold_size),`<span data-engineering-images="${esc(record.product.id)}:${index}"></span>`,value(part.price_rmb),value(part.price_usd),
        part.price_rmb == null && part.price_usd == null ? '—' : fmt(number(part.price_rmb)/(number(fxRmbHkd)||.85)+number(part.price_usd)*(number(fxHkdUsd)||7.8)),
        value(part.catalog_usage ?? part.usage),value(part.machine_model),value(part.machine),value(part.target),value(part.daily_capacity),value(part.note),value(part.source_file)])).join('')+
        (parts.length?row(record,[`本款小计：${record.moldCount} 个模号，${parts.length} 条零件引用`,...Array(20).fill('')],true):'');
    }).join('');
    const fees=records.filter(record=>record.product.id === '__shared__' || hasExistingEngineeringMoldCosts(record.payload)).map(record=>{
      const mc=record.payload.mold_costs;
      if(!mc)return '';
      const c=window.engineeringMoldCostTotals({...mc,items:mc.items || [],amortization_qty:mc.amortization_qty ?? (window.__data.quote.qty || 1)});
      return (mc.items || []).map(item=>row(record,[value(item.name),fmt(item.price_rmb),fmt(number(item.price_rmb)/.85/c.fx),'','','','','',value(mc.fx_rmb_usd ?? 7.75)])).join('')+
        row(record,['本款模费小计 / 分摊',fmt(c.sumRmb),fmt(c.sumUsd),fmt(c.customerUsd),value(c.qty),fmt(c.perPcsRmb),fmt(c.perPcsUsd),record.product.id === '__shared__' ? '每包装计一次' : '历史本款费用，按本款比例计入',value(c.fx)],true)+
        row(record,['手板费','',fmt(c.prototypeFeeUsd),'',value(c.prototypeQty),fmt(c.prototypePerPcsRmb),fmt(c.prototypePerPcsUsd),'',value(c.fx)])+
        row(record,['测试费','',fmt(c.testingFeeUsd),'',value(c.testingQty),fmt(c.testingPerPcsRmb),fmt(c.testingPerPcsUsd),'',value(c.fx)]);
    }).join('');
    const cartons=records.map(record=>{
      const c=record.payload.carton_calc || {};
      const rows=window.engineeringCartonDetails(c);
      return rows.map(item=>row(record,[value(item.type),value(item.name),value(item.parent),value(item.l),value(item.w),value(item.h),value(item.qty),value(item.ka_label),value(item.rate),
        fmt(item.unit),fmt(item.amount),value(c.pl_mm ?? (c.pl_cm != null ? number(c.pl_cm)*10 : c.pl == null ? null : number(c.pl)*25.4)),value(c.pw_mm ?? (c.pw_cm != null ? number(c.pw_cm)*10 : c.pw == null ? null : number(c.pw)*25.4)),value(c.ph_mm ?? (c.ph_cm != null ? number(c.ph_cm)*10 : c.ph == null ? null : number(c.ph)*25.4))])).join('')+
        (rows.length?row(record,['本款小计','','','','','','','','','',fmt(record.costs.carton),'','',''],true):'');
    }).join('');
    const total=key=>sum(records,r=>r.costs[key]);
    const categories=[['molds','模具'],['mold_costs','模具费用'],['hardware','五金'],['aux_materials','辅助材料'],['packaging_materials','包装材料'],['cartons','纸箱 / 平卡']];
    return `<div class="mixed-engineering-totals"><strong>当前产品原值合计 HKD ${fmt(total('total'))}</strong><span>物料 ${fmt(total('hardware')+total('auxiliary')+total('packaging'))}</span><span>纸箱 / 平卡 ${fmt(total('carton'))}</span><span>印尼运费 ${fmt(total('indo'))}</span><span>模具费用 RMB ${fmt(total('mold_rmb'))}</span></div>
      <nav class="mixed-engineering-nav" aria-label="工程明细分类">${categories.map(([key,label])=>`<button type="button" class="mini" data-jump-engineering="${key}">${label}</button>`).join('')}</nav>
      <div class="mixed-scroll mixed-engineering-detail-book" tabindex="0" role="region" aria-label="全部工程明细和分类合计，可上下左右滚动">
      ${group('molds','一、模具及零件明细',['模号','零件名称','模胚类型','材质','颜色','出模数','套数','净重 g','周期 秒','模具尺寸','图片','模价 RMB','模价 USD','模价 HKD','本款用量','机型','机台','日产啤次','日产能 件','备注','来源文件'],molds,'共用零件按产品列出；模价供参考，不重复计入物料合计')}
      ${group('mold_costs','二、生产模具费用明细',['费用项目','总额 RMB','总额 USD','客补贴 USD','分摊数量','单件 RMB','单件 USD','备注','HKD→USD 汇率'],fees,`${fmt(total('mold_rmb'))} RMB（模费原值，单独列示）`)}
      ${material('hardware','三、五金明细')}${material('aux_materials','四、辅助材料明细')}${material('packaging_materials','五、包装材料明细')}
      ${group('cartons','六、纸箱及平卡明细',['类型','名称','所属纸箱','长 inch','宽 inch','高 inch','装箱数 / 平卡用量','纸质','纸价系数','箱价 / 平卡单价 HKD','金额 HKD/PCS','产品长 mm','产品宽 mm','产品高 mm'],cartons,`${fmt(total('carton'))} HKD`)}
      </div>
      <details class="mixed-engineering-product-totals"><summary>各款分类汇总（当前 ${records.length} 项）</summary><div class="mixed-scroll mixed-engineering-overview"><table class="wb-table"><thead><tr><th>货号</th><th>产品名称</th><th>模具数</th><th>零件数</th><th>模具费用 RMB</th><th>五金 HKD</th><th>辅助材料 HKD</th><th>包装材料 HKD</th><th>纸箱 HKD</th><th>印尼运费 HKD</th><th>工程物料合计 HKD</th></tr></thead><tbody>${records.map(record=>`<tr data-engineering-product="${esc(record.product.id)}">${cells([link(record.product),esc(record.product.name),record.moldError?'待核对':record.moldCount,record.moldError?'待核对':record.partCount,...['mold_rmb','hardware','auxiliary','packaging','carton','indo','total'].map(key=>fmt(record.costs[key]))])}</tr>`).join('')}</tbody></table></div></details>`;
  }
  function wrap(renderer, dept, fixedProductId) {
    return function (host, root, edit, onChange, ...args) {
      const cfg = config();
      if (!cfg?.enabled || nested.has(root) || window.__WORKBENCH_EMBED__) return renderer(host, root, edit, onChange, ...args);
      root.mixed_products ||= {};
      root.mixed_shared ||= {};
      const key = `mixed:${window.__data.quote.id}:${dept}:overall-v1${fixedProductId ? ':' + fixedProductId : ''}`;
      let selected = fixedProductId || sessionStorage.getItem(key) || (dept === 'molding' ? '__catalog__' : '__overall__');
      const savedEngineering = JSON.parse(window.__data.sections.find(s => s.dept === 'engineering')?.payload_json || '{}');
      const importSummary = (dept === 'engineering' ? root : savedEngineering).mixed_import_summary;
      const importedCodes = new Set((importSummary?.products || []).map(p => String(p.code)));
      const importedProducts = cfg.products.filter(p => importedCodes.has(String(p.code)));
      const existingProducts = cfg.products.filter(p => !importedCodes.has(String(p.code)));
      const options = [...importedProducts, ...existingProducts].map(p => [p.id, `${p.code} · ${p.name}`]);
      options.push(['__shared__', '每包装共有费用（计一次）']);
      if (dept === 'engineering') options.unshift(['__all_molds__', '全部模具 · 按模号查看']);
      if (dept === 'molding') {
        options.unshift(['__catalog__', '全部模具 · 统一编辑']);
        if (['__molds__', '__all_molds__'].includes(selected)) selected = '__catalog__';
      }
      if (!fixedProductId && dept !== 'molding') options.unshift(['__overall__', '整体资料 · 全部小产品']);
      if (!options.some(([id]) => id === selected)) selected = options[0][0];
      const optionHtml = ([id, label]) => `<option value="${esc(id)}" ${id === selected ? 'selected' : ''}>${esc(label)}</option>`;
      const productIds = new Set(cfg.products.map(p => p.id));
      const groupedOptions = importedProducts.length ?
        options.filter(([id]) => !productIds.has(id) && id !== '__shared__').map(optionHtml).join('') +
        `<optgroup label="本次导入 · ${importedProducts.length} 个小产品">${options.filter(([id]) => importedProducts.some(p => p.id === id)).map(optionHtml).join('')}</optgroup>` +
        (existingProducts.length ? `<optgroup label="已有产品 · ${existingProducts.length} 个（保留原资料）">${options.filter(([id]) => existingProducts.some(p => p.id === id)).map(optionHtml).join('')}</optgroup>` : '') +
        options.filter(([id]) => id === '__shared__').map(optionHtml).join('') : options.map(optionHtml).join('');
      window.VerificationWorkbench?.cleanupMoldNumberObservers?.(host);
      host.innerHTML = `<div class="mixed-switch"><div><span class="mixed-tag">混装款</span><strong>当前报价对象（共 ${cfg.products.length} 个小产品）</strong></div>
        <select aria-label="选择小产品">${groupedOptions}</select>
        <p class="muted mixed-help"></p></div><div class="mixed-detail"></div>`;
      if (dept === 'painting' && !fixedProductId) selected = '__overall__';
      if (fixedProductId || dept === 'painting') host.querySelector('.mixed-switch').hidden = true;
      const detail = host.querySelector('.mixed-detail');
      let overallSearch = '';
      let overallScroll = {left:0,top:0};
      function openOverviewProduct(id) {
        if (id !== '__shared__' && !cfg.products.some(product => product.id === id)) return;
        const scroll = (dept === 'engineering' ? detail.querySelector('[data-engineering-tables]') : detail)?.querySelector('.mixed-scroll');
        overallScroll = {left:scroll?.scrollLeft || 0,top:scroll?.scrollTop || 0};
        selected = id;
        host.querySelector('select').value = id;
        sessionStorage.setItem(key, id);
        // Use the existing department edit action so permissions, approvals and
        // the current department draft remain under the normal save workflow.
        const enterEdit = !edit && host.closest?.('.section-pane')?.querySelector('button[data-act="enter-edit"]');
        if (enterEdit) { enterEdit.click(); return; }
        draw();
        detail.scrollIntoView?.({block:'start'});
      }
      if (dept === 'engineering' && edit && !fixedProductId) {
        const upload=document.createElement('details');upload.className='mixed-config mixed-supplier-batch';
        upload.innerHTML='<summary>批量导入混装外购报价</summary><p class="muted">使用供应商报价模板，单独增加“货号”列，填写小产品完整货号；每条明细均填写货号（可合并单元格）。选择“每包装共有费用”时，整表导入共用项目、每包装计一次，无需匹配小产品货号；其他视图中，总货号自动归入共有费用，小产品货号分配到对应产品。保留物料名称、MOQ、币种及价格。</p><label>导入类别 <select data-supplier-kind><option value="hardware">五金</option><option value="aux_materials">辅助材料</option><option value="packaging_materials">包装材料</option></select></label> <label>选择报价表 <input data-supplier-file type="file" accept=".xlsx,.xls"></label><div data-supplier-preview></div>';
        host.insertBefore(upload,detail);
        const attach=()=>window.attachSupplierMaterialImportUI(upload,{},edit,onChange,args[0],args[1],window.__data.quote.qty,window.__data.quote.customer,{
          inputId:'[data-supplier-file]',previewId:'[data-supplier-preview]',targetKey:upload.querySelector('[data-supplier-kind]').value,
          label:upload.querySelector('[data-supplier-kind]').selectedOptions[0].textContent,mixedConfig:cfg,mixedRoot:root,getMixedTotalCode:()=>window.__data.quote.quote_no,getMixedImportTarget:()=>selected,onApplied:draw
        });
        upload.querySelector('[data-supplier-kind]').onchange=()=>{upload.querySelector('[data-supplier-preview]').textContent='';upload.querySelector('[data-supplier-file]').value='';attach();};
        attach();
      }
      if (['electronic','slush','sewing'].includes(dept) && edit && !fixedProductId) {
        const upload=document.createElement('section');upload.className='mixed-config';
        upload.dataset.departmentBatchImport=dept;host.insertBefore(upload,detail);
        window.DepartmentBatchImport.attach(upload,{dept,root,config:cfg,getConfig:config,totalCode:window.__data.quote.quote_no,
          onChange,onApplied:draw,buildElectronic:(payload,result)=>window.applyElectronicQuoteImport(payload,result,args[0],args[1])});
      }
      if (dept === 'assembly' && edit && !fixedProductId) {
        const upload = document.createElement('section'); upload.className = 'mixed-config';
        upload.dataset.mixedAssemblyImport = '';
        upload.innerHTML = '<h3>批量导入混装装工</h3><p class="muted">按小产品编号匹配货号，成品包装工序计入每包装共有费用。每款按自身工序人数计算装工，统一目标数自动带入各款生产量，再应用并保存装配部草稿。</p><label class="mixed-upload-button">选择装工报价表<input type="file" accept=".xlsx,.xls" aria-label="选择装工报价表"></label><div data-assembly-preview role="status" aria-live="polite"></div>';
        host.insertBefore(upload, detail);
        let uploadSequence = 0;
        upload.querySelector('input').onchange = async event => {
          const sequence = ++uploadSequence, control = event.target, file = control.files[0];
          const preview = upload.querySelector('[data-assembly-preview]'); preview.textContent = '';
          if (!file) { upload.setAttribute('aria-busy', 'false'); return; }
          const state = assemblyImportState(root, cfg);
          const active = () => sequence === uploadSequence && preview.isConnected !== false;
          const current = () => cfg === config() && state === assemblyImportState(root, cfg);
          preview.textContent = '正在解析装工报价表…'; upload.setAttribute('aria-busy', 'true');
          try {
            const result = await uploadResult('./api/uploads/assembly-sheet?mixed=1', file);
            if (!active()) return;
            if (!current()) throw Error('产品或装工资料已修改，请重新选择文件生成预览');
            const plan = window.MixedSku.planAssembly(cfg, result.groups || []);
            if (plan.unmatched.length) throw Error('以下货号无法唯一匹配，请先核对产品资料：' + plan.unmatched.join('、'));
            if (!plan.groups.length) throw Error('没有可匹配的装工工序');
            const rows = plan.groups.flatMap(g => g.items.map(item => ({product:g.product,item})));
            preview.innerHTML = `<p>工作表：${esc(result.sheet_used || file.name)}，共 ${result.count} 道工序。生产量为空的项目须补填。</p><label>统一补填空白生产量 <input data-bulk-qty type="number" min="1" step="any"></label><button type="button" data-fill-qty>填入空白项</button><div class="mixed-scroll" role="region" aria-label="装工导入预览，可横向滚动" tabindex="0"><table><thead><tr><th>货号</th><th>名称</th><th>类型</th><th>工序数</th><th>工时 H</th><th>生产量</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td>${esc(r.product.code)}</td><td style="white-space:normal;overflow-wrap:anywhere;min-width:140px;max-width:260px">${esc(r.product.name)}</td><td>${r.item.kind === 'packaging' ? '包装' : '组装'}</td><td>${r.item.steps.length}</td><td>${esc(r.item.work_hours ?? '保留原值')}</td><td><input data-assembly-qty="${i}" aria-label="${esc(r.product.code)} ${r.item.kind === 'packaging' ? '包装' : '组装'}生产量 ${i + 1}" type="number" min="1" step="any" required value="${r.item.qty || ''}"></td></tr>`).join('')}</tbody></table></div><button type="button" data-assembly-apply>应用到对应产品</button> <button type="button" class="mini" data-assembly-cancel>取消预览</button>`;
            preview.querySelector('[data-assembly-cancel]').onclick = () => { ++uploadSequence; preview.textContent = ''; control.value = ''; upload.setAttribute('aria-busy', 'false'); };
            preview.querySelector('[data-fill-qty]').onclick = () => {
              const qty = Number(preview.querySelector('[data-bulk-qty]').value);
              if (!(qty > 0) || !Number.isFinite(qty)) return alert('请输入有效生产量');
              preview.querySelectorAll('[data-assembly-qty]').forEach(input => { if (!input.value) input.value = qty; });
            };
            preview.querySelector('[data-assembly-apply]').onclick = () => {
              if (!active()) return;
              if (!current()) { ++uploadSequence; preview.textContent = '产品或装工资料已修改，请重新选择文件生成预览'; control.value = ''; return; }
              const inputs = [...preview.querySelectorAll('[data-assembly-qty]')];
              if (inputs.some(input => !input.checkValidity() || !(Number(input.value) > 0) || !Number.isFinite(Number(input.value)))) return alert('请补齐每项有效生产量');
              const getPayload = id => id === '__shared__' ? root.mixed_shared : root.mixed_products[id];
              const existing = plan.groups.some(g => g.items.some(item => (getPayload(g.product.id)?.[item.kind === 'packaging' ? 'packaging_step_groups' : 'assembly_step_groups'] || []).length));
              if (existing && !confirm('将替换匹配产品的对应装工分组及本次共有包装工序，确认？')) return;
              ++uploadSequence;
              upload.setAttribute('aria-busy', 'false');
              rows.forEach((r,i) => { r.item.qty = Number(inputs[i].value); });
              for (const g of plan.groups) {
                const payload = g.product.id === '__shared__' ? root.mixed_shared : (root.mixed_products[g.product.id] ||= {});
                for (const kind of ['assembly','packaging']) {
                  const items = g.items.filter(item => item.kind === kind); if (!items.length) continue;
                  payload[kind + '_step_groups'] = items.map(item => ({product:item.product,qty:item.qty,team:item.team || 1,steps:item.steps}));
                  if (items[0].work_hours) payload.assembly_std_time = items[0].work_hours;
                }
              }
              onChange(); draw(); preview.textContent = '已应用装工明细，请保存装配部草稿。';
              control.value = '';
            };
          } catch (error) { if (active()) { preview.textContent = error.message; control.value = ''; } }
          finally { if (sequence === uploadSequence) upload.setAttribute('aria-busy', 'false'); }
        };
      }
      if (dept === 'painting' && edit && !fixedProductId) {
        const upload=document.createElement('section');upload.className='mixed-config';
        upload.innerHTML='<h3>批量导入混装喷油</h3><label>选择整份喷油报价表 <input type="file" accept=".xlsx,.xls"></label><div data-paint-preview></div>';
        host.insertBefore(upload,detail);
        upload.querySelector('input').onchange=async event=>{
          const file=event.target.files[0];if(!file)return;
          const preview=upload.querySelector('[data-paint-preview]');preview.textContent='正在解析…';
          try{
            const fd=new FormData();fd.append('file',file);
            const response=await fetch('./api/uploads/painting-sheet',{method:'POST',credentials:'include',body:fd});
            const result=await response.json();if(!response.ok)throw Error(result.error||'解析失败');
            const plan=window.MixedSku.planPainting(cfg,result.items||[]);
            if(plan.unmatched.length)throw Error('以下货号无法唯一匹配，请先导入或核对产品资料：'+plan.unmatched.join('、'));
            if(!plan.groups.length)throw Error('没有可匹配的喷油工序');
            const untouched=cfg.products.length-plan.groups.length;
            preview.innerHTML=`<p>匹配 ${plan.groups.length} 款，共 ${result.count} 条工序。另 ${untouched} 款未匹配到工序，保留已有资料。按各款分别导入，汇总沿用现有混装配比。</p><div class="mixed-scroll"><table><thead><tr><th>货号</th><th>产品名称</th><th>工序行数</th></tr></thead><tbody>${plan.groups.map(g=>`<tr><td>${esc(g.product.code)}</td><td>${esc(g.product.name)}</td><td>${g.items.length}</td></tr>`).join('')}</tbody></table></div><button type="button" data-paint-apply>应用到对应产品</button>`;
            preview.querySelector('[data-paint-apply]').onclick=()=>{
              const existing=plan.groups.filter(g=>(root.mixed_products[g.product.id]?.painting_items||[]).length);
              if(existing.length&&!confirm(`将替换 ${existing.length} 款产品的已有喷油明细，确认？`))return;
              for(const g of plan.groups){root.mixed_products[g.product.id]||={};root.mixed_products[g.product.id].painting_items=g.items;}
              onChange();draw();preview.textContent=`已应用 ${plan.groups.length} 款喷油明细，请保存喷油部草稿。`;
            };
          }catch(error){preview.textContent=error.message;}
        };
      }
      if (dept === 'molding') { const merged = window.MixedMolds.engineeringCatalog(root, savedEngineering); if (merged.parts_catalog) root.parts_catalog = merged.parts_catalog; }
      function draw() {
        sessionStorage.setItem(key, selected);
        window.VerificationWorkbench?.cleanupMoldNumberObservers?.(detail);
        detail.innerHTML = '';
        host.querySelector('.mixed-help').textContent = selected === '__shared__'
          ? `本页费用按每个销售包装填写，只计一次。每包装含 ${cfg.units_per_pack} 个小产品。`
          : selected === '__molds__' ? '按每款穴数和需求量分阶段拆分机台费用，自动计入小产品的完整报价。'
          : '本页数量和费用均按一个小产品填写。切换小产品保留当前输入，完成后保存本部门草稿。';
        if (dept === 'molding' && root.parts_catalog && savedEngineering.mixed_part_selections && !['__catalog__', '__all_molds__', '__molds__'].includes(selected)) host.querySelector('.mixed-help').textContent = '本款零件和用量由工程/业务的模具部分选择；啤机部在“全部模具 · 统一编辑”填写价格。';
        if (dept === 'painting' && selected === '__overall__') {
          const products=[...cfg.products,{id:'__shared__',code:'共有费用',name:'每包装计一次'}];
          const view={mixed_product_options:products,painting_items:products.flatMap(product=>{
            const data=product.id==='__shared__'?root.mixed_shared:root.mixed_products[product.id];
            return (data?.painting_items||[]).map(row=>({...row,mixed_product_id:product.id}));
          })};
          detail.innerHTML='<h3>混装喷油整体明细</h3><p class="muted">全部产品在同一张表编辑，所属产品用于费用归属；报价汇总仍按各款混装配比计算。完成后保存喷油部草稿。</p><div class="mixed-scroll" data-painting-all></div>';
          const refreshSummaries=[];
          window.renderPaintingTable(detail.querySelector('[data-painting-all]'),view,()=>{
            for(const product of products){
              const items=view.painting_items.filter(row=>row.mixed_product_id===product.id).map(row=>{const copy={...row};delete copy.mixed_product_id;return copy;});
              const existing=product.id==='__shared__'?root.mixed_shared:root.mixed_products[product.id];
              if (!items.length && !existing?.painting_items) continue;
              const data=existing || (root.mixed_products[product.id]={});
              data.painting_items=items;
            }
            refreshSummaries.forEach(refresh=>refresh());
            onChange();
          },edit);
          const summaries=document.createElement('section');
          const heading=document.createElement('h3');heading.textContent='各款喷油成本与印尼运费';summaries.appendChild(heading);
          for(const product of products){
            const data=product.id==='__shared__'?root.mixed_shared:(root.mixed_products[product.id] ||= {});
            refreshSummaries.push(window.renderLossSummary(summaries,esc(product.code+' · '+product.name),
              ()=>window.weightedPaintingSum(data),()=>0,args[0],'HKD',{
                host:data,pctKey:'indo_pct',readonly:!edit,onChange,
                label:'印尼运费 <small class="muted">(总价×30%为基数)</small>',
                base:()=>window.weightedPaintingSum(data)*0.3
              }));
          }
          detail.appendChild(summaries);
          return;
        }
        if (dept === 'engineering' && selected === '__overall__') {
          host.querySelector('.mixed-help').textContent = '完整明细按类别集中展示，保留每款小计及分类合计；共有费用只计一次。';
          const products = [...cfg.products, {id:'__shared__',code:'共有费用',name:'每包装计一次'}];
          const molding = JSON.parse(window.__data.sections.find(section => section.dept === 'molding')?.payload_json || '{}');
          const catalog = window.MixedMolds.engineeringCatalog(molding, root);
          const totals = products.map(product => {
            const payload = product.id === '__shared__' ? root.mixed_shared : root.mixed_products[product.id] || {};
            let molds = payload.molds || [], moldError = '';
            if (catalog.parts_catalog) {
              try { molds = nativeCatalogData(catalog, cfg, product.id, true).molds; }
              catch (error) { moldError = error.message; }
            }
            const moldCount = new Set(molds.map((mold,index) => String(mold.mold_no || '').trim() || `unfilled_${index}`)).size;
            return {product,payload,molds,moldCount,partCount:molds.reduce((count,mold) => count + (mold.parts?.length || 1),0),moldError,
              costs:window.engineeringSummaryTotals(payload,args[0],args[1])};
          });
          detail.innerHTML = `<h3>工程/业务整体明细与汇总</h3><p class="muted">全部小产品按类别集中列出完整明细；每款有小计，每类有合计。各款为未乘比例的原值，共有费用只列一次；最终报价仍按混装比例汇总。点击货号可修改对应资料。</p>
            <input type="search" data-engineering-search placeholder="查找货号或品名" aria-label="查找工程明细与汇总"><div data-engineering-tables></div>`;
          const search = detail.querySelector('[data-engineering-search]');
          const tables = detail.querySelector('[data-engineering-tables]');
          search.value = overallSearch;
          const paintTables = () => {
            const query = overallSearch.trim().toLowerCase();
            const visible = totals.filter(record => `${record.product.code} ${record.product.name}`.toLowerCase().includes(query)).map(record => ({...record,costs:window.engineeringSummaryTotals(record.payload,args[0],args[1])}));
            tables.innerHTML = engineeringDetailsHtml(visible,args[0],args[1]);
            tables.querySelectorAll('[data-open-engineering-product]').forEach(button => {
              button.onclick = () => openOverviewProduct(button.dataset.openEngineeringProduct);
            });
            tables.querySelectorAll('[data-jump-engineering]').forEach(button => {
              button.onclick = () => {
                const book = tables.querySelector('.mixed-engineering-detail-book');
                const section = tables.querySelector(`[data-engineering-category="${button.dataset.jumpEngineering}"]`);
                book.scrollTop += section.getBoundingClientRect().top - book.getBoundingClientRect().top;
                book.scrollLeft = 0;
              };
            });
            tables.querySelectorAll('[data-engineering-images]').forEach(cell => {
              const marker = cell.dataset.engineeringImages;
              const split = marker.lastIndexOf(':');
              const id = marker.slice(0,split), index = marker.slice(split+1);
              const record = visible.find(item => item.product.id === id);
              const parts = record.molds.flatMap(mold => (mold.parts?.length ? mold.parts : [mold]).map(part => ({...mold,...part})));
              window.renderImageCell?.(cell,{images:[...(parts[Number(index)]?.images || [])]},false,()=>{});
            });
          };
          search.oninput = event => { overallSearch = event.target.value; paintTables(); };
          paintTables();
          const scroll = tables.querySelector('.mixed-scroll');
          scroll.scrollLeft = overallScroll.left; scroll.scrollTop = overallScroll.top;
          return;
        }
        if (dept === 'assembly' && selected === '__overall__') {
          host.querySelector('.mixed-help').textContent = '点击货号可直接进入对应装工明细修改。成品包装列在共有费用，只计一次。';
          const products = [...[...cfg.products].sort((a, b) => String(a.code || '').localeCompare(String(b.code || ''), 'en', {numeric:true, sensitivity:'base'})), {id:'__shared__',code:'共有费用',name:'成品包装（每包装计一次）'}];
          const number = value => Number(value) || 0;
          const bases = [...new Set(products.map(product => {
            const payload = product.id === '__shared__' ? root.mixed_shared : root.mixed_products[product.id];
            return number(payload?.assembly_base_rate ?? defaultAssemblyBaseRateForFactory());
          }))];
          const bulkBase = bases.length === 1 ? bases[0] : '';
          const targetValues = [...new Set(products.flatMap(product => {
            const payload = product.id === '__shared__' ? root.mixed_shared : root.mixed_products[product.id];
            return [...(payload?.assembly_step_groups || []), ...(payload?.packaging_step_groups || [])].map(group => number(group.qty));
          }))];
          const bulkTarget = targetValues.length === 1 && targetValues[0] > 0 ? targetValues[0] : '';
          const rows = products.map(product => {
            const payload = product.id === '__shared__' ? root.mixed_shared : (root.mixed_products[product.id] || {});
            const assembly = payload.assembly_step_groups || [];
            const packaging = payload.packaging_step_groups || [];
            const groups = [...assembly, ...packaging];
            const base = number(payload.assembly_base_rate ?? defaultAssemblyBaseRateForFactory());
            const legacyTotal = key => (payload[key] || []).reduce((total,row) => total + number(row.qty) * number(row.unit_price), 0);
            const assemblyCost = assemblyGroupsTotal(assembly,base) + legacyTotal('assembly_labor');
            const packagingCost = assemblyGroupsTotal(packaging,base) + legacyTotal('packaging_labor');
            const people = groups.reduce((total,g) => total + (g.steps || []).reduce((n,step) => n + number(step.count),0) * (number(g.team ?? 1) || 1),0);
            const targets = [...new Set(groups.map(g => g.qty))].map(qty => esc(qty ?? '—')).join(' / ') || '—';
            const steps = groups.reduce((total,g) => total + (g.steps || []).length,0);
            return `<tr data-assembly-product="${esc(product.id)}"${product.id === '__shared__' ? ' class="hi"' : ''}><td><button type="button" class="mixed-product-link" data-open-assembly-product="${esc(product.id)}" aria-label="打开 ${esc(product.code)} 的装工明细">${esc(product.code)}</button></td><td style="white-space:normal;overflow-wrap:anywhere;min-width:140px;max-width:260px">${esc(product.name)}</td><td>${steps}</td><td>${people}</td><td>${targets}</td><td>${esc(payload.assembly_std_time ?? 11)}</td><td>${fmt(base)}</td><td>${fmt(assemblyCost)}</td><td>${fmt(packagingCost)}</td><td><strong>${fmt(assemblyCost + packagingCost)}</strong></td></tr>`;
          });
          detail.innerHTML = `<h3>混装装工汇总</h3><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:12px 0">
            <label>统一基数 HKD/人 <input data-assembly-bulk-base aria-label="统一装工基数 HKD/人" type="number" min="0" step="any" value="${esc(bulkBase)}" placeholder="当前多种基数" style="width:110px" ${edit ? '' : 'disabled'}></label>
            <button type="button" data-apply-assembly-base ${edit ? '' : 'disabled'}>应用到全部</button>
            <label>统一目标数 <input data-assembly-bulk-target aria-label="统一装工目标数" type="number" min="0.000001" step="any" value="${esc(bulkTarget)}" placeholder="当前多种目标数" style="width:120px" ${edit ? '' : 'disabled'}></label>
            <button type="button" data-apply-assembly-target ${edit ? '' : 'disabled'}>应用目标数到全部</button>
            <span class="muted">全部小产品及共有包装工序，不受搜索筛选影响。</span>
          </div><p data-assembly-base-status role="status" class="muted"></p><p data-assembly-target-status role="status" class="muted"></p><input type="search" placeholder="查找货号或品名" aria-label="查找装工汇总"><div class="mixed-scroll" role="region" aria-label="混装装工汇总，可横向滚动" tabindex="0"><table class="wb-table"><thead><tr><th>货号</th><th>产品名称</th><th>工序数</th><th>人数</th><th>目标数</th><th>工时 H</th><th>基数 HKD/人</th><th>半成品装工 HKD/PCS</th><th>成品包装 HKD/PCS</th><th>合计 HKD/PCS</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
          detail.querySelector('input[type="search"]').oninput = event => {
            const query = event.target.value.trim().toLowerCase();
            overallSearch = event.target.value;
            detail.querySelectorAll('[data-assembly-product]').forEach((row,i) => { row.hidden = !`${products[i].code} ${products[i].name}`.toLowerCase().includes(query); });
          };
          const searchControl = detail.querySelector('input[type="search"]');
          searchControl.value = overallSearch; searchControl.oninput({target:searchControl});
          const scroll = detail.querySelector('.mixed-scroll');
          scroll.scrollLeft = overallScroll.left; scroll.scrollTop = overallScroll.top;
          detail.querySelectorAll('[data-open-assembly-product]').forEach(button => {
            button.onclick = () => openOverviewProduct(button.dataset.openAssemblyProduct);
          });
          if (edit) detail.querySelector('[data-apply-assembly-base]').onclick = () => {
            const input = detail.querySelector('[data-assembly-bulk-base]');
            let base;
            try { base = applyAssemblyBaseRate(root, cfg, input.value); }
            catch (error) { detail.querySelector('[data-assembly-base-status]').textContent = error.message; return; }
            onChange(); draw();
            detail.querySelector('[data-assembly-base-status]').textContent = `已将全部小产品及共有包装基数更新为 ${fmt(base)} HKD/人；请保存装配部草稿后更新报价汇总。`;
          };
          if (edit) detail.querySelector('[data-apply-assembly-target]').onclick = () => {
            let target;
            try { target = applyAssemblyTarget(root, cfg, detail.querySelector('[data-assembly-bulk-target]').value); }
            catch (error) { detail.querySelector('[data-assembly-target-status]').textContent = error.message; return; }
            const search = detail.querySelector('input[type="search"]').value;
            onChange(); draw();
            const filter = detail.querySelector('input[type="search"]');
            filter.value = search; filter.oninput({target:filter});
            detail.querySelector('[data-assembly-target-status]').textContent = `已将全部小产品及共有包装工序的目标数更新为 ${target}，装工金额已重算；请保存装配部草稿后更新报价汇总。`;
          };
          return;
        }
        if (selected === '__overall__') {
          host.querySelector('.mixed-help').textContent = '在同一页填写全部资料，各区显示产品归属；保存本部门草稿后，汇总自动收集对应金额。共有费用单独计一次。';
          const search = document.createElement('input'); search.type = 'search'; search.placeholder = '查找货号或品名'; search.setAttribute('aria-label', '查找整体资料'); detail.appendChild(search);
          const panels = [];
          for (const product of [...cfg.products, { id: '__shared__', code: '共有费用', name: '每包装计一次' }]) {
            const panel = document.createElement('section'); panel.className = 'mixed-config';
            const heading = document.createElement('h3'); heading.textContent = `${product.code} · ${product.name}`; panel.appendChild(heading);
            const body = document.createElement('div'); panel.appendChild(body); detail.appendChild(panel);
            panels.push({panel, product});
            wrap(renderer, dept, product.id)(body, root, edit, onChange, ...args);
          }
          search.oninput = () => { const q = search.value.trim().toLowerCase(); panels.forEach(({panel,product}) => panel.hidden = !`${product.code} ${product.name}`.toLowerCase().includes(q)); };
          return;
        }
        if (dept === 'molding' && selected === '__catalog__') {
          const catalogHost = document.createElement('div'), refsHost = document.createElement('div');
          detail.append(catalogHost, refsHost);
          renderCatalog(catalogHost, root, cfg, edit, onChange, selected);
          renderCatalogReferences(refsHost, root, edit, () => {
            onChange(); renderCatalog(catalogHost, root, cfg, edit, onChange, selected);
          });
          return;
        }
        if (dept === 'molding' && root.parts_catalog && selected !== '__molds__') {
          const data = nativeCatalogData(root, cfg, selected);
          const saved = selected === '__shared__' ? root.mixed_shared : root.mixed_products[selected] || {};
          const refs = root.parts_catalog.selections?.[selected] || [];
          const targetParts = root.parts_catalog.parts.filter(part => selected === '__all_molds__' || refs.some(ref => ref.part_id === part.id));
          const losses = [...new Set(targetParts.map(part => Number(part.loss_pct ?? 3)))];
          const uniformLoss = losses.length === 1 ? losses[0] : null;
          const injection = uniformLoss == null ? data.injection : data.injection.map(row => ({ ...row, weight_g: row.weight_g / (1 + uniformLoss / 100) }));
          const view = { ...JSON.parse(JSON.stringify(saved)), injection, mixed_group_by_mold: true, injection_loss_pct: uniformLoss ?? 0 };
          nested.add(view);
          view.material_prices = root.material_prices;
          view.machine_prices = root.machine_prices;
          view.mixed_reference_editable = edit;
          renderer(detail, view, false, () => {
            root.material_prices = view.material_prices;
            root.machine_prices = view.machine_prices;
            onChange();
          }, [], ...args.slice(1));
          const note = document.createElement('p'); note.className = 'mixed-note';
          note.textContent = selected === '__all_molds__' ? '全部零件沿用单品注塑明细格式，每个零件列一次。下方合计仅为零件清单合计，混装报价请看汇总。统一填写价格请切换“全部模具 · 统一编辑”。' : '仅显示本款已选零件，金额已计入用量和共模啤工。修改产品组成请到工程页，修改价格请到统一零件明细。';
          detail.prepend(note);
          const lossInput = detail.querySelector('#inj-loss');
          if (lossInput) {
            lossInput.disabled = !edit || !targetParts.length;
            lossInput.min = '0';
            lossInput.value = uniformLoss == null ? '' : String(uniformLoss);
            lossInput.placeholder = '多种';
            lossInput.title = selected === '__all_molds__' ? '统一调整全部零件料损；保存部门草稿后生效' : '调整本款引用零件料损；共用零件同步影响其他引用产品';
            lossInput.onchange = () => {
              const value = Number(lossInput.value);
              if (lossInput.value.trim() === '' || !Number.isFinite(value) || value < 0) { lossInput.setCustomValidity('请输入大于等于0的料损百分比'); lossInput.reportValidity(); return; }
              lossInput.setCustomValidity('');
              targetParts.forEach(part => { part.loss_pct = value; });
              onChange(); draw();
            };
            lossInput.oninput = () => lossInput.setCustomValidity('');
          }
          note.textContent += ' 料损可在此统一调整，修改后保存部门草稿；共用零件的料损同步影响引用它的产品。';
          detail.querySelectorAll('th').forEach(th => {
            if (th.textContent.trim() === '啤净重(g)') th.textContent = uniformLoss == null ? '折算重量(g，含各零件料损及用量)' : '净重(g，含用量)';
            if (uniformLoss == null && th.textContent.trim() === '料损耗 0%') th.textContent = '含各零件料损重量(g)';
          });
          return;
        }
        if (selected === '__all_molds__') {
          host.querySelector('.mixed-help').textContent = '先查看全部模具，再进入对应小产品明细。';
          if (dept === 'engineering') {
            const catalogRoot = window.MixedMolds.engineeringCatalog(JSON.parse(window.__data.sections.find(s => s.dept === 'molding')?.payload_json || '{}'), root);
            if (catalogRoot.parts_catalog || edit) {
              detail.innerHTML = '<h3>一、模具部分 · 全部模具明细</h3><div class="mixed-native-molds"></div>';
              if (edit) editEngineeringMolds(detail.querySelector('.mixed-native-molds'), root, catalogRoot, onChange, draw, ...args.slice(0,2));
              else renderGroupedNativeMolds(detail.querySelector('.mixed-native-molds'), nativeCatalogData(catalogRoot, cfg, selected, true).molds, ...args.slice(0,2));
              unifiedMoldUpload(detail, root, edit, onChange, draw); return;
            }
          }
          const displayRoot = dept === 'molding' && root.parts_catalog ? window.MixedMolds.applyCatalog(root, cfg, window.__data.quote.qty) : root;
          (dept === 'engineering' ? renderAllEngineeringMolds : renderAllMolds)(detail, displayRoot, cfg, id => { selected = id; host.querySelector('select').value = id; draw(); });
          if (dept === 'engineering') unifiedMoldUpload(detail, root, edit, onChange, draw);
          return;
        }
        if (selected === '__molds__') return renderMolds(detail, root, edit, onChange, cfg);
        const payload = selected === '__shared__' ? root.mixed_shared : (root.mixed_products[selected] ||= {});
        if (['assembly','engineering'].includes(dept) && !fixedProductId) {
          const back = document.createElement('div'); back.className = 'wb-bar';
          back.innerHTML = dept === 'assembly' ? '<button type="button" class="mini" data-return-assembly-summary>← 返回混装装工汇总</button>' : '<button type="button" class="mini" data-return-engineering-summary>← 返回工程汇总</button>';
          back.querySelector('button').onclick = () => {
            selected = '__overall__'; host.querySelector('select').value = selected; draw();
          };
          detail.appendChild(back);
        }
        nested.add(payload);
        const next = [...args];
        if (dept === 'molding') {
          next[0] = window.__data.mixed_engineering_molds?.[selected] || [];
          if (selected === '__shared__') moldingContexts.delete(payload);
          else moldingContexts.set(payload, { cfg, root, productId: selected });
        }
        if (dept === 'engineering') {
          engineeringContexts.set(payload, { cfg, root, productId: selected });
        }
        if (dept === 'engineering') {
          const moldingRoot = window.MixedMolds.engineeringCatalog(JSON.parse(window.__data.sections.find(s => s.dept === 'molding')?.payload_json || '{}'), root);
          if (moldingRoot.parts_catalog) {
            moldingRoot.parts_catalog.selections = root.mixed_part_selections || moldingRoot.parts_catalog.selections;
            const compositionPanel = document.createElement('details'); compositionPanel.className = 'mixed-config'; compositionPanel.innerHTML = '<summary>配置产品组成（选择零件及用量）</summary>'; detail.appendChild(compositionPanel);
            const composition = document.createElement('section'); compositionPanel.appendChild(composition);
            renderCatalog(composition, moldingRoot, cfg, edit, () => {
              root.mixed_part_selections = JSON.parse(JSON.stringify(moldingRoot.parts_catalog.selections)); onChange();
              const table = detail.querySelector('#wb-molds');
              if (table) renderGroupedNativeMolds(table, nativeCatalogData(moldingRoot, cfg, selected, true).molds, ...args.slice(0,2));
            }, selected);
          }
        }
        const editor = document.createElement('div'); detail.appendChild(editor);
        renderer(editor, payload, edit, onChange, ...next);
        if (dept === 'engineering') {
          const catalogRoot = window.MixedMolds.engineeringCatalog(JSON.parse(window.__data.sections.find(s => s.dept === 'molding')?.payload_json || '{}'), root);
          if (catalogRoot.parts_catalog && editor.querySelector('#wb-molds')) {
            renderGroupedNativeMolds(editor.querySelector('#wb-molds'), nativeCatalogData(catalogRoot, cfg, selected, true).molds, ...args.slice(0,2));
            const shared = editor.querySelector('#wb-molds-shared'); if (shared) shared.innerHTML = '';
          }
        }
        if (dept === 'molding') {
          const note = document.createElement('p'); note.className = 'mixed-note';
          note.textContent = '共模拆价只计算啤工。共模零件的材料费仍在本款注塑明细填写，该行啤工价填 0，避免重复计费。';
          try {
            const amount = window.MixedMolds.calculate(cfg, root.mixed_molds || [], window.__data.quote.qty).productCosts[selected];
            if (amount != null) note.textContent += ` 本款共模啤价 HK$ ${fmt(amount)}，已列入下方分摊明细和成本汇总。`;
          } catch { /* 共模编辑区会显示具体的未完成项。 */ }
          detail.prepend(note);
        }
      }
      host.querySelector('select').onchange = event => { selected = event.target.value; draw(); };
      draw();
    };
  }
  function renderMolds(host, root, edit, changed, cfg) {
    root.mixed_molds ||= [];
    function draw() {
      host.innerHTML = `<h3>共模啤价拆分</h3><p class="muted">整模每啤成本＝机台日价 ÷ 日啤次。出模数指该零件每啤实际出多少件。每阶段按有效出模数分摊；先完成的零件堵穴，剩余零件承担后续费用。需求量留空时按出货包装数 × 每包件数 × 混装比例 × 每款用量计算。</p><p class="mixed-note">本表适用于可以分阶段堵穴生产的共模。零件单价已按出模数和需求量分摊，乘每款用量后计入小产品报价，无需再除出模数；同模整机费用只计算一次。</p>
        <div class="mixed-mold-list"></div>${edit ? '<button type="button" class="mini mixed-add-mold">＋ 新增共用模具</button>' : ''}<div class="mixed-mold-result"></div>`;
      root.mixed_molds.forEach((m, mi) => {
        const card = document.createElement('section'); card.className = 'mixed-mold-card';
        card.innerHTML = `<div class="mixed-fields"><label>模号${input('mold_no', m.mold_no, edit, 'text')}</label>
          <label>机台日价（HKD）${input('machine_price', m.machine_price, edit)}</label><label>日产啤次${input('target', m.target, edit)}</label>
          ${edit ? '<button type="button" class="mini danger mixed-remove-mold">删除此模具</button>' : ''}</div>
          <div class="mixed-scroll"><table><thead><tr><th>所属小产品</th><th>零件名称</th><th>出模数（件/啤）</th><th>每款用量</th><th>零件需求量（可选）</th><th></th></tr></thead><tbody></tbody></table></div>
          ${edit ? '<button type="button" class="mini mixed-add-part">＋ 新增零件</button>' : ''}`;
        card.querySelectorAll('.mixed-fields input').forEach(el => el.onchange = () => { m[el.dataset.field] = el.type === 'number' ? el.value === '' ? '' : Number(el.value) : el.value; changed(); calculate(); });
        (m.parts ||= []).forEach((p, pi) => {
          const tr = document.createElement('tr');
          tr.innerHTML = `<td><select aria-label="所属小产品" ${edit ? '' : 'disabled'}>${cfg.products.map(product => `<option value="${esc(product.id)}" ${p.product_id === product.id ? 'selected' : ''}>${esc(product.code)} · ${esc(product.name)}</option>`).join('')}</select></td>
            <td>${input('name', p.name, edit, 'text')}</td><td>${input('cavity', p.cavity, edit)}</td><td>${input('usage', p.usage, edit)}</td><td>${input('demand', p.demand ?? '', edit)}</td><td>${edit ? '<button type="button" class="mini danger">删除</button>' : ''}</td>`;
          tr.querySelector('select').onchange = event => { p.product_id = event.target.value; changed(); calculate(); };
          tr.querySelectorAll('input').forEach(el => el.onchange = () => { p[el.dataset.field] = el.type === 'number' ? el.value === '' ? '' : Number(el.value) : el.value; changed(); calculate(); });
          tr.querySelector('button')?.addEventListener('click', () => { m.parts.splice(pi, 1); changed(); draw(); });
          card.querySelector('tbody').appendChild(tr);
        });
        card.querySelector('.mixed-add-part')?.addEventListener('click', () => { m.parts.push({ product_id: cfg.products[0].id, name: '', cavity: 1, usage: 1 }); changed(); draw(); });
        card.querySelector('.mixed-remove-mold')?.addEventListener('click', () => { if (confirm('删除此共模及其零件拆价？')) { root.mixed_molds.splice(mi, 1); changed(); draw(); } });
        host.querySelector('.mixed-mold-list').appendChild(card);
      });
      host.querySelector('.mixed-add-mold')?.addEventListener('click', () => {
        root.mixed_molds.push({ mold_no: '', machine_price: '', target: '', parts: cfg.products.slice(0, 2).map(p => ({ product_id: p.id, name: '', cavity: 1, usage: 1 })) });
        changed(); draw();
      });
      calculate();
    }
    function calculate() {
      const box = host.querySelector('.mixed-mold-result');
      try {
        const result = window.MixedMolds.calculate(cfg, root.mixed_molds, window.__data.quote.qty);
        box.innerHTML = result.molds.map(m => `<h4>${esc(m.mold_no)} · 每啤 HK$ ${fmt(m.shot_cost)}</h4><p class="muted">${m.stages.map((s, i) => `阶段 ${i + 1}：${fmt(s.cycles)} 啤 × ${s.cavities} 有效穴`).join(' → ')}</p>
          <div class="mixed-scroll"><table><thead><tr><th>小产品</th><th>零件</th><th>出模数（件/啤）</th><th>零件需求量</th><th>啤工 HKD/零件</th><th>每款用量</th><th>计入小产品啤价 HKD</th><th>分摊总金额 HKD</th></tr></thead><tbody>${m.parts.map(p => `<tr><td>${esc(cfg.products.find(x => x.id === p.product_id)?.code)}</td><td>${esc(p.name)}</td><td>${p.cavity}</td><td>${fmt(p.demand)}</td><td>${fmt(p.unit_labor)}</td><td>${p.usage}</td><td>${fmt(p.product_labor)}</td><td>${fmt(p.labor_total)}</td></tr>`).join('')}</tbody></table></div><p>本模机台费用合计：HK$ ${fmt(m.total_cost)}（与全部零件分摊金额合计一致）</p>`).join('');
      } catch (error) { box.innerHTML = `<p class="mixed-error">${esc(error.message)}。可保存草稿，补齐后提交。</p>`; }
    }
    draw();
  }
  function salesPanel(host, payload, quote, edit, sections, changed, saveSection) {
    const saved = payload.mixed_quote || null;
    const cfg = JSON.parse(JSON.stringify(saved || { enabled: true, version: 1, mode: 'equal', units_per_pack: 1,
      products: [] }));
    const panel = document.createElement('section'); panel.className = 'mixed-config'; host.appendChild(panel);
    let expanded = !!saved?.enabled;
    let productImport = false;
    const locked = sections.some(s => s.status === 'approved');
    let skuUploadSequence = 0;
    function draw() {
      ++skuUploadSequence;
      panel.innerHTML = `${edit && !locked ? `<label>报价类型 <select class="mixed-type" aria-label="报价类型"><option value="single" ${!expanded ? 'selected' : ''}>单品报价</option><option value="mixed" ${expanded ? 'selected' : ''}>混装报价</option></select></label>` : ''}<h3>${saved?.enabled ? '混装产品配置' : '报价类型：单品报价'}</h3>${!expanded ? `<p>支持多个小产品独立报价、共用模具拆价及混装平均价。</p>${edit && !locked ? '<button type="button" class="mixed-enable">设置为混装报价</button>' : '<p class="muted">解除审核后可设置混装报价。</p>'}` : `
        <p class="muted">不预设小产品；可在工程/业务导入模具报价单，按配件序号建立小产品，也可手动添加。在此维护小产品和每包装数量。啤工需求量在啤机部手填，报价比例可从配比表 Ratio per capsule 列导入，也可在汇总页填写。</p>
        <div class="mixed-fields"><label>每包装小产品数量${input('units_per_pack', cfg.units_per_pack, edit && !locked)}</label></div>
        ${edit && !locked ? `<label>导入产品资料（配比表）<input type="file" class="mixed-sku-file" accept=".xlsx"></label><div class="mixed-sku-preview"></div>` : ''}
        <div class="mixed-scroll"><table><thead><tr><th>小产品货号</th><th>小产品名称</th><th></th></tr></thead><tbody>${cfg.products.map((p, i) => `<tr data-product="${i}"><td>${input('code', p.code, edit && !locked, 'text')}</td><td>${input('name', p.name, edit && !locked, 'text')}</td><td>${edit && !locked ? '<button type="button" class="mini mixed-remove">移除</button>' : ''}</td></tr>`).join('')}</tbody></table></div>
        ${edit && !locked ? `<div class="wb-bar"><button type="button" class="mini mixed-add">＋ 添加小产品</button>${!saved?.enabled ? '<button type="button" class="mini mixed-cancel">取消设置</button>' : ''}<button type="button" class="mixed-save-config">${saved ? '保存混装配置并刷新' : '保存并启用（现有明细归入首款）'}</button></div><p class="muted">修改配置后，各部门需重新提交审核。移除小产品后保存时需确认，将一并删除该产品的部门明细与零件选用关系，保留共用零件和其他小产品。</p>` : '<p class="muted">修改混装构成前请先解除各部门审核。</p>'}<p class="mixed-message" role="status"></p>`}`;
      panel.querySelector('.mixed-enable')?.addEventListener('click', () => { cfg.enabled = true; expanded = true; draw(); });
      panel.querySelector('[data-field="units_per_pack"]')?.addEventListener('input', event => { cfg.units_per_pack = Number(event.target.value); });
      panel.querySelectorAll('[data-product]').forEach(row => {
        const index = Number(row.dataset.product);
        row.querySelectorAll('input').forEach(el => el.oninput = () => { cfg.products[index][el.dataset.field] = el.type === 'number' ? Number(el.value) : el.value; });
        row.querySelector('.mixed-remove')?.addEventListener('click', () => { cfg.products.splice(index, 1); draw(); });
      });
      panel.querySelector('.mixed-sku-file')?.addEventListener('change', async event => {
        const sequence=++skuUploadSequence,control=event.target,file=control.files[0];
        const preview=panel.querySelector('.mixed-sku-preview');preview.textContent='';
        if(!file){preview.setAttribute('aria-busy','false');return;}
        const state=JSON.stringify(cfg),active=()=>sequence===skuUploadSequence&&preview.isConnected!==false;
        preview.setAttribute('role','status');preview.setAttribute('aria-live','polite');preview.setAttribute('aria-busy','true');preview.textContent='正在解析产品资料…';
        try {
          const result=await uploadResult('./api/uploads/mixed-sku-sheet',file);
          if(!active())return;
          if(state!==JSON.stringify(cfg))throw Error('产品配置已修改，请重新选择配比表生成预览');
          const applied=window.MixedSku.apply(cfg,result.records);
          preview.innerHTML=`<p>按正式货号匹配 ${applied.matched} 款，新增 ${applied.added} 款。按配比表 NO. 顺序排列，未匹配的现有产品保留在末尾。按正式货号关联，已有模具和部门资料保留；${result.records.some(r=>r.na_ratio!=null)?'同步导入 Ratio per capsule 为比例；各款乘比例求和，共有费用只计一次。':'本次更新货号、名称和品牌，保留原有比例。'}</p>${applied.unmatched.length?`<p>未匹配的现有产品保留：${applied.unmatched.map(esc).join('、')}</p>`:''}<div class="mixed-scroll"><table><thead><tr><th>序号</th><th>货号</th><th>品牌</th><th>产品名称</th><th>比例（Ratio per capsule）</th></tr></thead><tbody>${result.records.map(r=>`<tr><td>${esc(r.source_number)}</td><td>${esc(r.code)}</td><td>${esc(r.brand)}</td><td>${esc(r.name)}</td><td>${r.na_ratio==null?'保留原值':esc(r.na_ratio)+'（'+esc(ratioPercent(r.na_ratio))+'）'}</td></tr>`).join('')}</tbody></table></div><button type="button" data-sku-apply>应用产品资料</button>`;
          preview.querySelector('[data-sku-apply]').onclick=()=>{
            if(!active())return;
            if(state!==JSON.stringify(cfg)){++skuUploadSequence;preview.textContent='产品配置已修改，请重新选择配比表生成预览';control.value='';return;}
            try{const latest=window.MixedSku.apply(cfg,result.records);cfg.products=latest.config.products;cfg.na_direct=latest.config.na_direct;productImport=true;draw();panel.querySelector('.mixed-message').textContent='产品资料及比例已应用，请点击保存混装配置，同步更新汇总。';}
            catch(error){preview.textContent=error.message;control.value='';}
          };
        } catch(error){if(active()){preview.textContent=error.message;control.value='';}}
        finally{if(sequence===skuUploadSequence)preview.setAttribute('aria-busy','false');}
      });
      panel.querySelector('.mixed-add')?.addEventListener('click', () => { cfg.products.push({ id: `p_${uuid()}`, code: '', name: '', ratio: 1 }); draw(); });
      panel.querySelector('.mixed-cancel')?.addEventListener('click', () => { expanded = false; draw(); });
      panel.querySelector('.mixed-type')?.addEventListener('change', async event => {
        if (event.target.value === 'mixed') { cfg.enabled = true; expanded = true; draw(); return; }
        if (!saved?.enabled) { expanded = false; draw(); return; }
        const button = event.target, message = panel.querySelector('.mixed-message');
        try {
          if (document.querySelector('.dept-tab[title="有未保存修改"]')) throw new Error('请先保存或取消当前部门修改，再取消混装');
          if (!window.confirm('恢复单品报价后，将使用各部门原有单品明细计算。混装小产品、共用资料会保留，但不参与单品计算，重新启用时可继续使用。是否继续？')) return;
          button.disabled = true;
          await request(`/quotes/${quote.id}/mixed`, { method: 'PUT', body: JSON.stringify({ config: { enabled: false }, expected_config: saved }) });
          location.reload();
        } catch (error) { message.textContent = error.message; message.className = 'mixed-message mixed-error'; }
        finally { button.disabled = false; button.value = 'mixed'; }
      });
      panel.querySelector('.mixed-save-config')?.addEventListener('click', async event => {
        const button = event.target, message = panel.querySelector('.mixed-message');
        if (button.disabled) return;
        try {
          window.MixedMolds.validateConfig(cfg);
          if (productImport && [...document.querySelectorAll('.dept-tab[title="有未保存修改"]')].some(tab => tab.dataset.dept !== 'sales')) throw new Error('请先保存其他部门的修改，再导入产品资料');
          const removed = (saved?.products || []).filter(p => !cfg.products.some(next => next.id === p.id));
          if (removed.length && [...document.querySelectorAll('.dept-tab[title="有未保存修改"]')].some(tab => tab.dataset.dept !== 'sales')) throw new Error('请先保存其他部门的修改，再删除小产品');
          if (removed.length && !window.confirm(`确认删除 ${removed.map(p => p.code).join('、')}？\n将删除这些小产品的全部部门明细和零件选用关系。共用零件及其他小产品会保留。`)) return;
          button.disabled = true;
          const section = sections.find(s => s.dept === 'sales');
          // Use the same queue/version object as draft and shortcut saves. A successful
          // draft must advance its version even when the config request later fails.
          if (typeof saveSection !== 'function') throw new Error('保存组件未同步，请保留输入后重新打开报价单');
          await saveSection(section, payload, false);
          section.payload_json = JSON.stringify(payload);
          await request(`/quotes/${quote.id}/mixed`, { method: 'PUT', body: JSON.stringify({ config: cfg, expected_config: saved, product_import: productImport, confirmed_removed_ids: removed.map(p => p.id), expected_sections: Object.fromEntries(sections.filter(s => s.dept !== 'sales').map(s => [s.id, s.filled_at || ''])) }) });
          location.reload();
        } catch (error) { message.textContent = error.message; message.className = 'mixed-message mixed-error'; button.disabled = false; }
      });
    }
    draw();
  }

  function detailedSummary(result) {
    const sections = window.__data.sections;
    const engineering = JSON.parse(sections.find(s => s.dept === 'engineering')?.payload_json || '{}');
    const sales = JSON.parse(sections.find(s => s.dept === 'sales')?.payload_json || '{}');
    const breakdowns = result.products.map(item => ({ item, breakdown: window.MixedMolds.dynamicCostBreakdown(item.components, engineering.mixed_products?.[item.id], sales.header) }));
    const commonBreakdown = window.MixedMolds.dynamicCostBreakdown(result.common_components, engineering.mixed_shared, sales.header);
    const allBreakdowns = [...breakdowns.map(entry => entry.breakdown), commonBreakdown];
    const columns = [['imp_mat','进口料'],['dom_mat','国内料'],['injection_labor','啤工'],['painting_labor','喷工'],['paint_material','油漆'],['assembly_labor','装工＋入纸袋／包装']];
    const materials = new Map();
    for (const breakdown of allBreakdowns) for (const [key, name] of Object.entries(breakdown.labels)) materials.set(key, name);
    columns.push(...materials);
    if (allBreakdowns.some(b => Math.abs(b.columns.other || 0) > 1e-10)) columns.push(['other','其他费用']);
    const cell = value => `<td class="${Math.abs(value || 0) > 1e-10 ? 'has-cost' : ''}">${Math.abs(value || 0) > 1e-10 ? fmt(value) : ''}</td>`;
    const row = (item, eng, common) => {
      const breakdown = common ? commonBreakdown : breakdowns.find(entry => entry.item.id === item.id).breakdown;
      return `<tr${common ? ' class="mixed-common-row"' : ''}><th scope="row">${esc(item.code)}</th><td>${esc(item.name)}</td>${columns.map(([key]) => cell(breakdown.columns[key])).join('')}<td class="mixed-cost-total">${fmt(breakdown.total)}</td><td>${common ? '每包装一次' : `<input type="text" data-na-product="${esc(item.id)}" aria-label="${esc(item.code)} 比例" value="${esc(ratioDisplay(result.config.products.find(p => p.id === item.id)?.na_ratio ?? result.config.products.find(p => p.id === item.id)?.ratio ?? ''))}" placeholder="例如 =1/6" style="width:110px;min-width:90px"><small class="muted" data-na-share="${esc(item.id)}">${(item.weight * 100).toFixed(2)}%</small>`}</td><td class="mixed-cost-total" ${common ? '' : `data-na-total="${esc(item.id)}" data-na-cost="${breakdown.total}"`}>${common ? '—' : fmt(breakdown.total * item.weight)}</td></tr>`;
    };
    const weightedCell = (key, offset = 0) => {
      const values = Object.fromEntries(breakdowns.map(e => [e.item.id, key === 'total' ? e.breakdown.total : e.breakdown.columns[key] || 0]));
      const value = breakdowns.reduce((sum, e) => sum + values[e.item.id] * e.item.weight, offset);
      return `<td data-na-weighted="${esc(JSON.stringify(values))}" data-na-offset="${offset}" class="${key === 'total' ? 'mixed-cost-total' : ''}">${fmt(value)}</td>`;
    };
    const aggregateRow = (average) => {
      const sum = getter => breakdowns.reduce((total, entry) => total + getter(entry) * (average ? entry.item.weight : 1), 0);
      const label = average ? (result.config?.na_direct || result.config?.mode === 'ratio' ? '全部小产品比例合计' : '全部小产品平均价') : '小产品合计';
      const note = average ? (result.config?.na_direct ? '各款分类金额 × 手填比例，再求和' : result.config?.mode === 'ratio' ? '各款分类金额 × 归一化生产配比，再求和' : `各款合计 ÷ ${result.products.length} 款`) : `${result.products.length} 款，不含共有费用`;
      return `<tr class="mixed-average-row ${average ? 'mixed-na-average-row' : ''}"><th scope="row">${label}</th><td>${note}</td>${columns.map(([key]) => average ? weightedCell(key) : `<td>${fmt(sum(e => e.breakdown.columns[key] || 0))}</td>`).join('')}${average ? weightedCell('total') : `<td class="mixed-cost-total">${fmt(sum(e => e.breakdown.total))}</td>`}<td>${average ? '每个小产品' : '—'}</td><td class="mixed-cost-total" ${average ? 'data-na-total-sum' : ''}>${average ? fmt(sum(e => e.breakdown.total)) : '—'}</td></tr>`;
    };
    const aggregateRows = result.products.length ? aggregateRow(false) + aggregateRow(true) : '';
    const combined = key => (key === 'total' ? commonBreakdown.total : commonBreakdown.columns[key] || 0) + breakdowns.reduce((sum, e) => sum + (key === 'total' ? e.breakdown.total : e.breakdown.columns[key] || 0) * e.item.weight, 0);
    const combinedRow = `<tr class="mixed-combined-row"><th scope="row">合计</th><td>比例合计＋共有费用</td>${columns.map(([key]) => weightedCell(key, commonBreakdown.columns[key] || 0)).join('')}<td class="mixed-cost-total" data-na-combined data-common-cost="${commonBreakdown.total}">${fmt(combined('total'))}</td><td>—</td><td class="mixed-cost-total" data-na-combined data-common-cost="${commonBreakdown.total}">${fmt(combined('total'))}</td></tr>`;

    return `<h3>各小产品报价（未乘比例）</h3><p class="muted">各分类及成本合计显示原始金额；右侧合计＝成本合计 × 比例，底部汇总各款结果。</p><p class="muted">物料金额按五金及工程明细的分类归集，同类合并；产品利宝和彩盒利宝分别列示；金额为 HKD，无费用留空。成本合计未加码点，右侧显示乘比例后的成本合计。共有费用单列，每包装计一次。</p><div class="mixed-scroll mixed-cost-matrix"><table aria-label="各小产品费用明细"><thead><tr><th>货号</th><th>品名</th>${columns.map(([,label]) => `<th>${esc(label)}</th>`).join('')}<th>成本合计 HKD</th><th>比例</th><th>比例后合计 HKD</th></tr></thead><tbody>${result.products.map(item => row(item, engineering.mixed_products?.[item.id], false)).join('')}${aggregateRows}${result.common_components ? row({ code: '共有费用', name: '每包装共有项目', components: result.common_components, price_hkd: result.common_usd * result.pricing.fx, price_usd: result.common_usd }, engineering.mixed_shared, true) : ''}${combinedRow}</tbody></table></div>`;
  }
  function shippingSummary(host, result, sales, salesSection, quote, me) {
    const p = result.pricing, c = result.components;
    const editable = ['sales', 'engineering'].includes(me?.dept) && me?.perms?.['报价单详情']?.can_edit && me?.perms?.['业务部']?.can_edit && me?.perms?.['汇总分析']?.can_edit && salesSection?.status !== 'approved';
    const fields = { surtax_markup_x: sales.shipping?.surtax_markup_x ?? p.markup, markup_x: p.markup, sew_markup_x: sales.shipping?.sew_markup_x ?? p.markup, elec_markup_x: sales.shipping?.elec_markup_x ?? p.markup, divisor: p.divisor, fx_hkd_usd: p.fx, amortization_usd: Number(sales.mixed_pricing?.amortization_usd || 0), surtax_pct: p.surtax_pct, target_usd: Number(sales.shipping?.target_usd || 0) };
    const nonnegative = new Set(['amortization_usd', 'surtax_pct', 'surtax_markup_x', 'target_usd']);
    const validFields = () => Object.entries(fields).every(([key, value]) => Number.isFinite(value) && (nonnegative.has(key) ? value >= 0 : value > 0));
    const field = (key, label) => `${label} <input aria-label="${label}" data-price-key="${key}" type="number" min="${nonnegative.has(key) ? 0 : 0.000001}" step="any" value="${esc(fields[key])}" ${editable ? '' : 'disabled'} style="width:84px">`;
    const sewing = (c.sewing_hair || 0) + (c.sewing_cloth || 0), electronic = c.electronic || 0;
    const main = Object.entries(c).reduce((sum, [key, value]) => sum + (['abs_material','sewing_hair','sewing_cloth','electronic','freight','cabinet'].includes(key) ? 0 : value), 0);
    const commonMain = Object.entries(result.common_components || {}).reduce((sum, [key, value]) => sum + (['abs_material','sewing_hair','sewing_cloth','electronic','freight','cabinet'].includes(key) ? 0 : value), 0);
    const productMain = main - commonMain;
    const freight = (c.freight || 0) + (c.cabinet || 0);
    const amortization = result.amortization_usd + result.products.reduce((sum, item) => sum + item.amortization_usd * item.weight * (result.cost_units ?? result.units_per_pack), 0);
    let containerKey = result.selected_container || 'factory';
    const scenarios = result.freight_scenarios || [];
    const choices = scenarios.filter(s => s.key !== 'factory');
    const viewKey = `mixed-shipping-columns:${quote.id}`;
    let savedColumns = [];
    try { savedColumns = JSON.parse(localStorage.getItem(viewKey) || '[]'); } catch (_) {}
    const chosen = [...new Set([...savedColumns, containerKey, ...choices.map(s => s.key)].filter(key => choices.some(s => s.key === key)))].slice(0, 2);
    const visible = [scenarios.find(s => s.key === 'factory'), ...chosen.map(key => scenarios.find(s => s.key === key))].filter(Boolean);
    const selector = (s, index) => `<select data-compare-column="${index}" aria-label="对比运输方式${index}">${choices.map(option => `<option value="${esc(option.key)}" ${option.key === s.key ? 'selected' : ''}>${esc(option.name)}${option.valid ? '' : '（待补资料）'}</option>`).join('')}</select>`;

    const row = (label, key, highlight = '') => `<tr class="${highlight}"><td>${label}</td>${visible.map((s, index) => `<td data-compare-cell="${index}" data-price-value="${key}" data-price-scenario="${esc(s.key)}"></td>`).join('')}</tr>`;
    host.innerHTML = `<h3>🚚 出货价算价</h3><p class="muted">主体小计＝上方“比例合计＋共有费用”合计－车缝－电子；主体、车缝、电子分别乘码点，合计后统一除找数。</p>
      <label>报客场景 <select data-container ${editable ? '' : 'disabled'}>${scenarios.map(s => `<option value="${esc(s.key)}" ${s.key === containerKey ? 'selected' : ''} ${s.valid ? '' : 'disabled'}>${esc(s.name)}${s.valid ? '' : '（待补资料）'}</option>`).join('')}</select></label>
      <div class="mixed-scroll"><table class="wb-table ship-table" aria-label="出货价算价"><thead><tr><th>项</th>${visible.map((s, index) => `<th>${s.key === 'factory' ? esc(s.name) : selector(s, index)}</th>`).join('')}</tr></thead><tbody>
      ${row('主体小计 HK$（不含车缝、电子）','main')}${row('运费 HK$','transport')}${row('吊柜费 HK$','cabinet')}${row('含运 HK$','withFreight','hi')}
      ${row(field('markup_x','码点 ×'),'marked')}${row('TOTAL 主体 (HK$)','marked','hi')}
      ${row('车缝','sewing')}${row(field('sew_markup_x','码点 ×'),'sewMarked')}${row('TOTAL 车缝 (HK$)','sewMarked','hi')}
      ${row('电子','electronic')}${row(field('elec_markup_x','码点 ×'),'elecMarked')}${row('TOTAL 电子 (HK$)','elecMarked','hi')}
      ${row('码点后合计 (HK$)','markedTotal','hi')}${row(field('divisor','统一找数 ÷'),'hkd')}${row('TOTAL (HK$)','hkd','hi')}${row(field('fx_hkd_usd','(USD)＝HK$ ÷'),'usd')}
      ${row('模具、手办及测试摊费 (USD)','engineeringAmortization')}${row(field('amortization_usd','额外摊费 (USD)'),'extraAmortization')}
      ${row('TOTAL (USD)','before','mixed-usd-subtotal')}${row(field('surtax_pct','附加税 %'),'taxBase','mixed-surtax-row')}${row(field('surtax_markup_x','附加税码点 ×'),'taxMarked')}${row('找数 ÷ <span data-tax-divisor></span>','surcharge')}${row('TOTAL (USD)','final','hi')}
      </tbody></table></div><div class="ship-foot mixed-ship-foot"><label>报客货价 (USD) <input data-customer-price disabled style="width:110px;background:#f0f9ff;font-weight:600"></label><label>${field('target_usd','目标价 (USD)')}</label><label>相差 % <input data-target-diff disabled style="width:100px;background:#fff3cd"></label></div>${editable ? '<button type="button" data-save-price style="margin-top:12px">保存算价参数并更新汇总</button>' : ''}<p data-price-status role="status" class="muted"></p>`;
    host.querySelector('[data-container]').onchange = event => { containerKey = event.target.value; recalc(); };
    const status = host.querySelector('[data-price-status]');
    const syncCompareOptions = () => {
      host.querySelectorAll('[data-compare-column]').forEach(select => {
        const index = Number(select.dataset.compareColumn);
        [...select.options].forEach(option => option.disabled = visible.some((s, i) => i !== index && s.key === option.value));
      });
    };
    host.querySelectorAll('[data-compare-column]').forEach(select => select.onchange = () => {
      const index = Number(select.dataset.compareColumn);
      visible[index] = scenarios.find(s => s.key === select.value);
      host.querySelectorAll('[data-compare-cell]').forEach(cell => {
        if (Number(cell.dataset.compareCell) === index) cell.dataset.priceScenario = select.value;
      });
      try { localStorage.setItem(viewKey, JSON.stringify(visible.filter(s => s.key !== 'factory').map(s => s.key))); } catch (_) {}
      syncCompareOptions(); recalc();
    });
    syncCompareOptions();

    function recalc() {
      host.querySelector('[data-tax-divisor]').textContent = fields.divisor;
      host.querySelector('[data-customer-price]').value = '—';
      host.querySelector('[data-target-diff]').value = '—';
      const valid = validFields();
      host.querySelector('[data-save-price]')?.toggleAttribute('disabled', !valid);
      if (!valid) { status.textContent = '码点、找数和汇率必须大于 0，摊费和附加费不能为负数。'; host.querySelectorAll('[data-price-value]').forEach(cell => { cell.textContent = '—'; }); return; }
      if (fields.fx_hkd_usd !== p.fx) { host.querySelectorAll('[data-price-value]').forEach(cell => { cell.textContent = '待保存重算'; }); status.textContent = '货柜或汇率已修改，保存后更新完整报价。'; return; }
      const updatedAmortization = amortization - Number(sales.mixed_pricing?.amortization_usd || 0) + fields.amortization_usd;
      for (const scenario of scenarios) {
        const cells = [...host.querySelectorAll('[data-price-scenario]')].filter(cell => cell.dataset.priceScenario === scenario.key);
        if (!scenario.valid) { cells.forEach(cell => cell.textContent = '待补资料'); continue; }
        const transport = scenario.freight || 0, cabinet = scenario.cabinet || 0;
        const withFreight = main + transport + cabinet, marked = withFreight * fields.markup_x;
        const mainPrice = marked / fields.divisor;
        const sewMarked = sewing * fields.sew_markup_x, elecMarked = electronic * fields.elec_markup_x;
        const sewPrice = sewMarked / fields.divisor, elecPrice = elecMarked / fields.divisor;
        const markedTotal = marked + sewMarked + elecMarked;
        const hkd = markedTotal / fields.divisor, usd = hkd / fields.fx_hkd_usd, before = usd + updatedAmortization;
        const taxBase = before * fields.surtax_pct / 100, taxMarked = taxBase * fields.surtax_markup_x, surcharge = taxMarked / fields.divisor;
        const values = { main, transport, cabinet, withFreight, marked, mainPrice, sewing, sewMarked, sewPrice, electronic, elecMarked, elecPrice, markedTotal, hkd, usd,
          engineeringAmortization: updatedAmortization - fields.amortization_usd, extraAmortization: fields.amortization_usd, before, taxBase, taxMarked, surcharge, final: before + surcharge };
        cells.forEach(cell => cell.textContent = fmt(values[cell.dataset.priceValue]));
        if (scenario.key === containerKey) {
          host.querySelector('[data-customer-price]').value = fmt(values.final);
          host.querySelector('[data-target-diff]').value = fields.target_usd > 0 ? ((values.final - fields.target_usd) / fields.target_usd * 100).toFixed(2) + '%' : '—';
        }

      }

    }
    recalc();
    host.querySelectorAll('[data-price-key]').forEach(el => el.oninput = () => { fields[el.dataset.priceKey] = el.value === '' ? NaN : Number(el.value); recalc(); if (containerKey === result.selected_container && fields.fx_hkd_usd === p.fx && validFields()) status.textContent = '试算已更新，保存后同步上方报价和下方减税汇总。'; });
    const save = host.querySelector('[data-save-price]');
    if (save) save.onclick = async () => {
      if (!validFields()) return;
      save.disabled = true; status.textContent = '正在保存…';
      try {
        const latest = await request(`/quotes/${quote.id}`);
        const section = latest.sections.find(s => s.dept === 'sales');
        const payload = JSON.parse(section.payload_json || '{}');
        if (JSON.stringify(payload.shipping || {}) !== JSON.stringify(sales.shipping || {}) || JSON.stringify(payload.mixed_pricing || {}) !== JSON.stringify(sales.mixed_pricing || {}) || JSON.stringify(payload.header || {}) !== JSON.stringify(sales.header || {})) {
          throw new Error('算价参数已在其他窗口更新，本次未覆盖。请保留输入，刷新核对后再保存。');
        }
        const { fx_hkd_usd, amortization_usd, surtax_pct, ...shippingFields } = fields;
        payload.mixed_pricing = { ...payload.mixed_pricing, amortization_usd, tax_mode: 'percent', fixed_charge_hkd: 0, surtax_pct };
        payload.shipping = { ...payload.shipping, ...shippingFields, container_key: containerKey };
        payload.header = { ...payload.header, fx_hkd_usd };
        await request(`/sections/${section.id}`, { method: 'PUT', body: JSON.stringify({ payload, submit: false, base_filled_at: section.filled_at }) });
        section.payload_json = JSON.stringify(payload);
        window.__data.sections = latest.sections;
        await summary(host.parentElement, quote, me);
      } catch (error) { status.textContent = `保存失败：${error.message}`; save.disabled = false; }
    };
  }
  async function summary(host, quote, me) {
    const requestToken = {};
    summaryRequests.set(host, requestToken);
    host.innerHTML = '<h3>混装报价汇总</h3><p>正在汇总各小产品的已保存明细…</p>';
    try {
      const result = await request(`/quotes/${quote.id}/mixed`);
      if (!host.isConnected || summaryRequests.get(host) !== requestToken) return;
      if (!result.enabled) return;
      const p = result.pricing;
      const salesSection = window.__data.sections.find(section => section.dept === 'sales');
      const sales = JSON.parse(salesSection?.payload_json || '{}');
      host.innerHTML = `<h3>混装报价汇总 · ${esc(quote.product_name)}</h3><p class="muted">${result.config?.na_direct ? '按手填比例求和' : result.config?.mode === 'ratio' ? '按比例平均' : '等量平均'} · 每包装 ${result.units_per_pack || '—'} 个小产品 · 金额按完整精度计算，显示 4 位小数</p>
        ${result.errors.length ? `<div class="mixed-error"><strong>待补齐，以下为试算结果</strong><ul>${result.errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
        ${detailedSummary(result)}
        <div style="margin:12px 0"><button type="button" data-save-na>保存比例并重新汇总</button> <span class="muted">支持 1/6、=1/6、=(1+2)/6、百分数；直接按填写值相乘求和，不除以比例合计。</span><p data-na-status role="status"></p></div>
        ${p ? `
        <section data-mixed-shipping></section>
        <details class="mixed-pricing-detail"><summary>各款码点及摊费计算</summary><div class="mixed-scroll"><table aria-label="各款报价计算"><thead><tr><th>货号</th><th>品名</th><th>主体码点</th><th>电子码点</th><th>车缝码点</th><th>码点后金额 HKD</th><th>除数</th><th>摊费 USD</th><th>报价 USD</th></tr></thead><tbody>${result.products.map(item => `<tr><td>${esc(item.code)}</td><td>${esc(item.name)}</td><td>${p.markup}</td><td>${esc(sales.shipping?.elec_markup_x ?? p.markup)}</td><td>${esc(sales.shipping?.sew_markup_x ?? p.markup)}</td><td>${fmt(item.base_hkd)}</td><td>${p.divisor}</td><td>${fmt(item.amortization_usd)}</td><td>${fmt(item.price_usd)}</td></tr>`).join('')}</tbody></table></div><p class="muted">各款报价 USD＝码点后金额 ÷ 除数 ÷ 汇率 ＋ 本款摊费。参数统一在上方出货价算价表修改。</p></details>
        <section class="mixed-tax-summary"><p class="muted">以下按每包装成本汇总：小产品按保存的比例计入，共有费用计一次。减税沿用单品规则，不再从上方报客价重复扣减。</p><div data-mixed-tax></div></section>` : ''}
        `;
      const naInputs = [...host.querySelectorAll('[data-na-product]')];
      const naStatus = host.querySelector('[data-na-status]');
      const naSave = host.querySelector('[data-save-na]');
      // The rounded text is a display value. Preserve the saved full-precision
      // number/expression until the user actually changes this particular field.
      const ratioFields = new Map(naInputs.map(el => {
        const product = result.config.products.find(p => p.id === el.dataset.naProduct);
        return [el, {value:product.na_ratio ?? product.ratio, display:el.value.trim()}];
      }));
      const naConfig = () => ({ ...result.config, na_direct: true, products: result.config.products.map(product => {
        const el = naInputs.find(input => input.dataset.naProduct === product.id), field = ratioFields.get(el);
        return {...product, na_ratio:el.value.trim() === field.display ? field.value : el.value.trim()};
      }) });
      naInputs.forEach(el => el.onblur = () => {
        const field = ratioFields.get(el);
        if (el.value.trim() !== field.display) field.value = el.value.trim();
        try {
          const display = window.MixedMolds.ratioValue(field.value).toFixed(4);
          el.value = display; field.display = display;
        } catch (_) { /* Keep invalid input visible for correction. */ }
      });
      naInputs.forEach(el => el.oninput = () => {
        ratioFields.set(el, {value:el.value.trim(), display:el.value.trim()});
        try {
          const shares = window.MixedMolds.pricingWeights(naConfig());
          const weighted = [...host.querySelectorAll('[data-na-weighted]')].map(node => {
            const values = JSON.parse(node.dataset.naWeighted);
            return [node, Object.entries(values).reduce((sum, [id, value]) => sum + value * shares[id], Number(node.dataset.naOffset))];
          });
          const totals = [...host.querySelectorAll('[data-na-total]')].map(node => [node, Number(node.dataset.naCost) * shares[node.dataset.naTotal]]);
          const naTotal = totals.reduce((sum, [, value]) => sum + value, 0);
          const combined = [...host.querySelectorAll('[data-na-combined]')].map(node => [node, naTotal + Number(node.dataset.commonCost)]);
          if (![...weighted, ...totals, ...combined, [null, naTotal]].every(([, value]) => Number.isFinite(value))) {
            throw new Error('报价金额超出有效计算范围，请核对比例、成本和汇率');
          }
          host.querySelectorAll('[data-na-share]').forEach(node => {
            const value = shares[node.dataset.naShare];
            node.textContent = Number.isFinite(value * 100) ? (value * 100).toFixed(2) + '%' : ratioPercent(value);
          });
          [...weighted, ...totals, ...combined].forEach(([node, value]) => node.textContent = fmt(value));
          const totalCell = host.querySelector('[data-na-total-sum]');
          if (totalCell) totalCell.textContent = fmt(naTotal);
          naStatus.textContent = '比例试算已更新，保存后重新计算报价。'; naSave.disabled = false;
        } catch (error) { naStatus.textContent = error.message; naSave.disabled = true; }
      });
      naSave.onclick = async () => {
        try {
          const config = naConfig(); window.MixedMolds.validateConfig(config);
          naSave.disabled = true; naStatus.textContent = '正在保存…';
          await request(`/quotes/${quote.id}/mixed`, { method: 'PUT', body: JSON.stringify({ config, expected_config: result.config }) });
          location.reload();
        } catch (error) { naStatus.textContent = error.message; naSave.disabled = false; }
      };
      if (p) shippingSummary(host.querySelector('[data-mixed-shipping]'), result, sales, salesSection, quote, me);
      if (p && window.renderTaxDeductionBlock) {
        window.renderTaxDeductionBlock(host.querySelector('[data-mixed-tax]'), {}, null, null, {
          ...result.components,
          sewing_taxable: result.sewing_taxable,
          base_price: result.final_hkd * p.divisor,
          misc: (result.components.misc || 0) + result.surcharge_usd * p.fx,
        });
      }
    } catch (error) {
      if (!host.isConnected || summaryRequests.get(host) !== requestToken) return;
      host.innerHTML = `<p class="mixed-error">混装汇总失败：${esc(error.message)}</p>`;
    }
  }
  const componentNames = { injection_labor: '啤工', assembly_labor: '装配人工', painting_labor: '喷油人工', paint_material: '油料', imp_mat: '进口塑胶', dom_mat: '国产塑胶', blow: '吹气', slush: '搪胶', sewing_hair: '车发', sewing_cloth: '车衣', hardware: '五金', electronic: '电子', motor: '马达', suction: '吸塑', glue_bag: '胶袋', color_box: '彩盒/内咭', battery: '电池', libao: '利宝', plating: '电镀', flocking: '植绒', other_buy: '其他外购', carton: '纸箱', freight: '运费', cabinet: '吊柜', misc: '印尼运费', abs_material: '其中 ABS 材料' };
  window.MixedQuotation = { showsEngineeringMoldCosts, applyAssemblyTarget, applyAssemblyBaseRate, previewNumberedImport, wrap, salesPanel, summary, componentNames, renderMoldingAllocation, renderEngineeringSharedMolds, refreshEngineeringSharedMolds };
})();
