(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DepartmentBatchImport = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const normalize = value => String(value ?? '').normalize('NFKC').replace(/[‐‑–—]/g, '-').replace(/\s+/g, '').toUpperCase();
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const labels = {electronic:'电子', slush:'搪胶', sewing:'车缝'};
  function codeIn(text, code) {
    const pattern = normalize(code).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return pattern && new RegExp(`(^|[^A-Z0-9])${pattern}(?=$|[^A-Z0-9])`).test(normalize(text));
  }
  function match(config, totalCode, explicit, hints) {
    const targets = [...config.products, {id:'__shared__',code:totalCode,name:'每包装共有费用'}];
    // A filled official item code is authoritative. Never fall back to row order
    // or a file name when that code is absent from the product list.
    if (explicit) {
      const exact = targets.filter(p => normalize(p.code) === normalize(explicit));
      return exact.length === 1 ? exact[0].id : '';
    }
    const hits = targets.filter(p => hints.some(hint => codeIn(hint, p.code)));
    if (hits.length) return hits.length === 1 ? hits[0].id : '';
    const named = targets.filter(p => hints.some(hint => normalize(hint) === normalize(p.name)));
    return named.length === 1 ? named[0].id : '';
  }
  function entriesFor(dept, files, config, totalCode) {
    const entries = [];
    for (const file of files) {
      const data = file.data;
      const items = dept === 'electronic' ? [data] : dept === 'slush' ? data.items : data.groups;
      if (!Array.isArray(items) || !items.length) throw Error(`${file.name}：没有可导入的明细`);
      for (const item of items) {
        const explicit = dept === 'electronic' ? item.meta?.product_no : item.item_code || item.product_code || item.code;
        const name = dept === 'electronic' ? item.meta?.product || item.meta?.product_name : item.name;
        const hints = [name, file.name, data.sheet_used, item.source_sheet].filter(Boolean);
        entries.push({file:file.name, name:name || explicit || '未命名', data:{...clone(item),source_file:file.name},
          target:match(config,totalCode,explicit,hints), explicit:explicit || '',
          count:dept === 'electronic' ? item.count || item.parts?.length || 0 : dept === 'sewing' ? item.items?.length || 0 : 1});
      }
    }
    return entries;
  }
  function apply(root, dept, entries, config, buildElectronic) {
    if (!labels[dept] || !entries.length) throw Error('没有可应用的报价明细');
    const targets = new Set([...config.products.map(p => p.id),'__shared__']);
    const grouped = new Map();
    for (const entry of entries) {
      if (!targets.has(entry.target)) throw Error(`${entry.file}：请先选择对应的正式货号`);
      if (!grouped.has(entry.target)) grouped.set(entry.target, []);
      grouped.get(entry.target).push(entry);
    }
    if (dept === 'electronic' && [...grouped.values()].some(rows => rows.length > 1)) {
      throw Error('同一货号有多份电子报价，请只保留本次采用的一份，避免覆盖或重复计价');
    }
    const next = clone(root);
    next.mixed_products ||= {}; next.mixed_shared ||= {};
    for (const [id, rows] of grouped) {
      const payload = id === '__shared__' ? next.mixed_shared : (next.mixed_products[id] ||= {});
      if (dept === 'electronic') buildElectronic(payload, clone(rows[0].data));
      if (dept === 'slush') payload.slush_items = rows.map(row => ({...clone(row.data),images:row.data.images || [],qty:row.data.qty ?? 1}));
      if (dept === 'sewing') payload.sewing_groups = rows.map(row => {
        const group = row.data;
        return {name:group.name,source_file:row.file,product_qty:group.product_qty ?? 1,category:group.category || '车衣',
          ...(group.tax_label ? {tax_label:group.tax_label}:{}),labor_amount:group.labor_amount ?? 0,
          items:(group.items || []).map(item => ({fabric:item.material || '',part:item.part || '',pieces:1,
            craft:/电绣|绣花|embroider/i.test(`${item.material || ''} ${item.note || ''}`) ? '电绣':'',
            usage:item.qty ?? 0,mat_price:item.unit_price ?? 0,markup:item.markup ?? 1,note:item.note || ''}))};
      });
    }
    return {next, count:grouped.size};
  }
  function attach(host, {dept,root,config,totalCode,onChange,onApplied,buildElectronic}) {
    if (!labels[dept]) return;
    const label = labels[dept];
    host.innerHTML = `<h3>批量导入混装${label}报价</h3><p class="muted">可一次选择多份 Excel，按表内正式货号匹配；未填写货号时参考产品名称和文件名。总货号归入共有费用。应用前逐项核对，只替换选中货号的本部门明细，完成后保存草稿。</p>
      ${dept === 'electronic' ? '<label>报价格式 <select data-batch-format><option value="electronic-sheet">登信</option><option value="electronic-lianxiang-sheet">联翔</option></select></label> ' : ''}
      <label class="mixed-upload-button">选择${label}报价单（可多选）<input type="file" multiple accept=".xlsx,.xls" aria-label="批量选择${label}报价单"></label><div data-batch-preview role="status" aria-live="polite"></div>`;
    const input = host.querySelector('input'), preview = host.querySelector('[data-batch-preview]');
    let sequence = 0;
    const fingerprint = () => JSON.stringify({products:root.mixed_products,shared:root.mixed_shared,config});
    input.onchange = async () => {
      const request = ++sequence, files = [...input.files];
      if (!files.length) {preview.textContent='';return;}
      if (files.length > 20 || files.reduce((n,f)=>n+f.size,0) > 100*1024*1024) {preview.textContent='每批最多 20 个文件、合计不超过 100 MB。';return;}
      const original = fingerprint(), parsed = [], failures = [];
      const endpoint = dept === 'electronic' ? host.querySelector('[data-batch-format]').value : `${dept}-sheet`;
      input.disabled = true;
      try {
        for (const [i,file] of files.entries()) {
          if (request !== sequence) return;
          preview.textContent = `正在解析 ${i+1}/${files.length}：${file.name}`;
          try {
            const body = new FormData();body.append('file',file);
            const response = await fetch(`/api/uploads/${endpoint}`,{method:'POST',credentials:'include',body});
            const data = await response.json();
            if (!response.ok || data.error) throw Error(data.error || '解析失败');
            parsed.push({name:file.name,data});
          } catch (error) {failures.push(`${file.name}：${error.message}`);}
        }
        if (request !== sequence) return;
        if (failures.length) {
          preview.textContent = `${failures.length} 份未成功，本批尚未应用任何资料。请修正后重新选择：${failures.join('；')}`;
          return;
        }
        const entries = entriesFor(dept,parsed,config,totalCode);
        const targets = [...config.products,{id:'__shared__',code:totalCode,name:'每包装共有费用'}];
        preview.innerHTML = `<p>已解析 ${files.length} 份文件、${entries.length} 项报价。请核对货号；无法唯一匹配的项目须手动选择。</p><div class="mixed-scroll"><table class="wb-table"><thead><tr><th>来源文件</th><th>产品 / 项目</th><th>明细数</th><th>对应正式货号</th>${dept==='electronic'?'<th>币种</th>':''}</tr></thead><tbody>${entries.map((entry,i)=>`<tr><td>${escape(entry.file)}</td><td>${escape(entry.name)}${entry.explicit?`<br><small>表内货号：${escape(entry.explicit)}</small>`:''}</td><td>${entry.count}</td><td><select data-batch-target="${i}" aria-label="第${i+1}项对应货号"><option value="">请选择对应货号</option>${targets.map(p=>`<option value="${escape(p.id)}" ${p.id===entry.target?'selected':''}>${escape(p.code)} · ${escape(p.name)}</option>`).join('')}</select></td>${dept==='electronic'?`<td><select data-batch-currency="${i}" aria-label="第${i+1}项币种">${['RMB','USD','HKD'].map(c=>`<option ${c===(entry.data.source_currency||'RMB')?'selected':''}>${c}</option>`).join('')}</select>${entry.data.validation?.ok===false?'<strong>金额校验不一致，请核对原表</strong>':''}</td>`:''}</tr>`).join('')}</tbody></table></div><button data-batch-apply type="button">应用到对应产品</button> <button data-batch-cancel type="button" class="mini">取消预览</button><p data-batch-message></p>`;
        preview.querySelector('[data-batch-cancel]').onclick=()=>{sequence++;preview.textContent='';input.value='';};
        preview.querySelector('[data-batch-apply]').onclick=()=>{
          const message=preview.querySelector('[data-batch-message]');
          try {
            if (fingerprint()!==original) throw Error('本部门资料或产品配置已变化，请重新选择文件预览，避免覆盖新修改');
            preview.querySelectorAll('[data-batch-target]').forEach(select=>{entries[Number(select.dataset.batchTarget)].target=select.value;});
            preview.querySelectorAll('[data-batch-currency]').forEach(select=>{entries[Number(select.dataset.batchCurrency)].data.source_currency=select.value;});
            const result=apply(root,dept,entries,config,buildElectronic);
            if (!confirm(`将更新 ${result.count} 个货号的${label}明细，已选货号的原明细会替换；确认应用？`)) return;
            root.mixed_products=result.next.mixed_products;root.mixed_shared=result.next.mixed_shared;
            onChange();onApplied();input.value='';preview.textContent=`已应用 ${result.count} 个货号的${label}报价，请保存本部门草稿。`;
          } catch(error) {message.textContent=error.message;}
        };
      } catch(error) {if(request===sequence)preview.textContent=error.message;}
      finally {input.disabled=false;}
    };
    host.querySelector('[data-batch-format]')?.addEventListener('change',()=>{sequence++;preview.textContent='';input.value='';});
  }
  return {match,entriesFor,apply,attach};
});
