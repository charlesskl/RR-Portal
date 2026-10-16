(() => {
  'use strict';
  const $=id=>document.getElementById(id), esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let data={rows:[],columns:[],customers:[]},customer='',loading=null;
  const format=(v,percent=false)=>typeof v==='number'&&Number.isFinite(v)?(percent?(v*100).toFixed(2)+'%':v.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})):v==null?'—':esc(v);
  const filters=()=>({customer,status:$('vs-status').value,search:$('vs-search').value.trim(),workshop:$('vs-workshop').value});
  function selectedRows(){const f=filters();return data.rows.filter(r=>(!f.customer||r.values.A===f.customer)&&(!f.status||r.status===f.status)&&(!f.workshop||G.workshop(r)===f.workshop)&&(!f.search||`${r.values.A} ${r.values.B} ${r.values.C}`.toLowerCase().includes(f.search.toLowerCase())));}
  const G=VerificationReportGroups;
  // Display the complete report by default, including template-hidden columns.
  $('vs-all').checked=true;
  let mode='customer-detail';
  const quantityDrafts=new Map(),quantityPending=new Set(),quantityMessages=new Map();
  let draftRevision=0;
  function readQuantityResponse(response){
    return response.text().then(raw=>{
      let body;try{body=JSON.parse(raw);}catch{throw new Error(`保存接口返回异常（HTTP ${response.status}），数量草稿已保留，请稍后重试。`);}
      if(!response.ok)throw new Error(body?.error||`保存失败（HTTP ${response.status}），数量草稿已保留。`);
      return body;
    });
  }
  const modes={'customer-detail':'各客分车间明细','workshop-summary':'总表分车间','customer-summary':'总表不分车间','all-details':'不分车间核价明细'};
  function alignFrozenColumns(){
    const table=$('vs-detail'),first=table.querySelector?.('thead th');
    if(first)table.style.setProperty('--vs-customer-width',`${first.getBoundingClientRect().width}px`);
  }
  function quantityInputs(shown,cols){
    if(!data.can_edit_quantity)return;
    const index=cols.findIndex(c=>c.key==='D');
    if(index<0)return;
    const trs=$('vs-detail').querySelectorAll('tbody tr');
    shown.forEach((r,i)=>{
      if(r.kind==='heading'||r.kind==='total')return;
      const value=quantityDrafts.has(r.version_id)?quantityDrafts.get(r.version_id).value:(typeof r.values.D==='number'?String(r.values.D):'');
      trs[i].cells[index].innerHTML=`<div class="vs-quantity"><input type="number" min="0" step="1" aria-label="${esc(r.values.B)} 接单数量" value="${esc(value)}" placeholder="未填写"><button type="button" class="mini" data-quantity-save="${r.version_id}" ${quantityPending.has(r.version_id)||!r.quantity_revision?'disabled':''}>保存</button>${quantityDrafts.has(r.version_id)&&!quantityPending.has(r.version_id)?`<button type="button" class="mini" data-quantity-reset="${r.version_id}" title="放弃草稿并读取最新数量">重读</button>`:''}<span role="status">${esc(quantityPending.has(r.version_id)?'保存中…':quantityMessages.get(r.version_id)||(!r.quantity_revision?'缺少业务核价信息':''))}</span></div>`;
    });
    $('vs-detail').querySelectorAll('thead th')[index].textContent='接单数量（可填写）';
  }
  if(typeof ResizeObserver!=='undefined')new ResizeObserver(alignFrozenColumns).observe($('vs-detail'));
  function render(){
    const rows=selectedRows(),cols=data.columns.filter(c=>$('vs-all').checked||!c.hidden);
    $('vs-count').textContent=`${rows.length} 款核价`;
    $('vs-reports').innerHTML=Object.entries(modes).map(([key,title])=>`<button class="mini ${mode===key?'active':''}" data-mode="${key}">${title}</button>`).join('');
    $('vs-tabs').innerHTML=['',...data.customers.map(c=>c.customer)].map(c=>`<button class="mini ${c===customer?'active':''}" data-customer="${esc(c)}">${esc(c||'全部客户')}</button>`).join('');
    const shown=G.reportRows(rows,mode);
    $('vs-detail').innerHTML=`<thead><tr>${cols.map(c=>`<th>${esc(c.key==='D'?'接单数量（原文件期间）':c.label)}</th>`).join('')}<th>车间</th><th>核价版本</th><th>审核状态</th><th>生成提示</th></tr></thead><tbody>${shown.map(r=>{
      if(r.kind==='heading')return `<tr class="vs-group"><td colspan="${cols.length+4}">${esc(r.title)}</td></tr>`;
      const total=r.kind==='total';
      return `<tr class="${total?'vs-total':''}">${cols.map(c=>`<td class="${r.values[c.key]==null?'vs-missing':''}" title="${esc(r.sources[c.key]||r.formulas[c.key]||(r.values[c.key]==null?'缺少来源或计算参数':''))}">${c.key==='B'&&!total?`<a href="./verification.html?quote_id=${encodeURIComponent(r.id)}">${format(r.values[c.key])}</a>`:format(r.values[c.key],c.percent)}</td>`).join('')}<td title="${esc(r.workshop_source||'')}">${esc(total?r.workshop:G.workshop(r))}</td><td>${esc(r.version)}</td><td>${esc(r.status_label)}</td><td class="vs-warning">${total?`${r.quantity_count}/${r.count}款有数量`:esc((G.workshop(r)===G.pending?[r.workshop_source,...r.issues]:r.issues).filter(Boolean).join('；'))}</td></tr>`;
    }).join('')}</tbody>`;
    $('vs-overview').innerHTML=`<table><thead><tr>${['客名','核价款数','数量匹配','接单数量','总生产金额 HK$','总生产成本 HK$','减税金额 HK$','税后毛利 HK$','税后利润 HK$'].map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${G.group(rows,r=>r.values.A).map(([c,rs])=>{const t=G.aggregate(rs,c,'');return `<tr><td>${esc(c)}</td><td>${rs.length}</td><td>${t.quantity_count}/${rs.length}</td>${['D','DI','DJ','DU','DX','DZ'].map(k=>`<td>${format(t.values[k])}</td>`).join('')}</tr>`;}).join('')}</tbody></table>`;
    quantityInputs(shown,cols);
    alignFrozenColumns();
    const pending=rows.filter(r=>G.workshop(r)===G.pending).length;
    $('vs-message').textContent=`${modes[mode]}；${pending}款待分配车间。单价栏合计为各款之和，金额按数量计算，占比由合计重算；缺项不计成0。导出包含各客车间明细、总表及打印版，与筛选一致。`;
  }
  async function load(force=false){
    while(loading){if(force!==true)return loading;await loading;}
    const request=(async()=>{
    $('vs-export').disabled=true;$('vs-message').classList.remove('vs-error');
    $('vs-message').textContent='正在按当前核价明细生成汇总…';
    let loaded=false;
    try{
      const r=await fetch('/api/verification-summary');
      if(r.status===401){location.href='./index.html';return;}
      const raw=await r.text();let body;
      try{body=JSON.parse(raw);}catch{
        throw new Error(r.status===404?'当前服务尚未加载核价汇总接口，请更新服务后刷新。':`汇总接口返回格式异常（HTTP ${r.status}），请稍后刷新或联系管理员。`);
      }
      if(!r.ok)throw new Error(body?.error||`读取失败（HTTP ${r.status}）`);
      if(!body||!Array.isArray(body.rows)||!Array.isArray(body.columns)||!Array.isArray(body.customers))throw new Error('汇总数据格式不完整，请刷新后重试。');
      data=body;const selected=$('vs-workshop').value;$('vs-workshop').innerHTML='<option value="">全部车间</option>'+[...new Set(data.rows.map(G.workshop))].map(w=>`<option value="${esc(w)}">${esc(w)}</option>`).join('');$('vs-workshop').value=selected;render();loaded=true;
    }catch(e){$('vs-message').textContent=e.message;$('vs-message').classList.add('vs-error');}
    finally{$('vs-export').disabled=!loaded;}
    return loaded;
    })();
    loading=request;
    try{return await request;}finally{if(loading===request)loading=null;}
  }
  $('vs-tabs').addEventListener('click',e=>{const b=e.target.closest('[data-customer]');if(b){customer=b.dataset.customer;render();}});
  for(const id of ['vs-search','vs-status','vs-all','vs-workshop'])$(id).addEventListener('input',render);
  $('vs-reports').addEventListener('click',e=>{const b=e.target.closest('[data-mode]');if(b){mode=b.dataset.mode;render();}});
  $('vs-print').addEventListener('click',()=>window.print());
  $('vs-detail').addEventListener('input',e=>{
    if(!e.target.matches('.vs-quantity input'))return;
    const id=Number(e.target.parentElement.querySelector('button').dataset.quantitySave);
    quantityDrafts.set(id,{value:e.target.value,revision:++draftRevision,base:quantityDrafts.get(id)?.base||data.rows.find(row=>row.version_id===id)?.quantity_revision});
    quantityMessages.delete(id);
  });
  $('vs-detail').addEventListener('click',async e=>{
    const reset=e.target.closest('[data-quantity-reset]');
    if(reset){
      const id=Number(reset.dataset.quantityReset);
      if(quantityPending.has(id)||!confirm('将放弃此数量草稿并读取最新已保存数量，确认继续？'))return;
      quantityDrafts.delete(id);quantityMessages.delete(id);await load(true);return;
    }
    const button=e.target.closest('[data-quantity-save]');if(!button)return;
    const id=Number(button.dataset.quantitySave),row=data.rows.find(r=>r.version_id===id);
    if(quantityPending.has(id)||!row?.quantity_revision)return;
    const input=button.parentElement.querySelector('input'),quantity=input.value.trim()===''?null:Number(input.value);
    const show=text=>{quantityMessages.set(id,text);render();};
    if(input.validity.badInput||!(quantity===null||(Number.isSafeInteger(quantity)&&quantity>=0))){show('请输入非负整数');return;}
    // Keep the exact submitted draft; later typing or changing reports must not
    // be consumed by an older save response.
    const draft=quantityDrafts.get(id)||{value:input.value,revision:++draftRevision,base:row.quantity_revision};
    quantityDrafts.set(id,draft);quantityPending.add(id);quantityMessages.delete(id);render();
    try{
      const response=await fetch('/api/verification-summary/quantity',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({version_id:id,quantity,expected_revision:draft.base})});
      const result=await readQuantityResponse(response);
      row.quantity_revision=result.quantity_revision;
      const current=quantityDrafts.get(id);
      if(current?.base===draft.base)current.base=result.quantity_revision;
      const refreshed=await load(true);
      if(refreshed&&quantityDrafts.get(id)?.revision===draft.revision)quantityDrafts.delete(id);
      quantityMessages.set(id,refreshed?(quantityDrafts.has(id)?'已保存提交值；新修改待保存':'已保存'):'已保存；汇总读取失败，请刷新');
    }catch(error){quantityMessages.set(id,error.message);}
    finally{quantityPending.delete(id);render();}
  });
  globalThis.addEventListener?.('beforeunload',event=>{
    if(!quantityDrafts.size&&!quantityPending.size)return;
    event.preventDefault();event.returnValue='';
  });
  $('vs-refresh').addEventListener('click',load);
  $('vs-export').addEventListener('click',()=>{
    // A normal attachment URL also works in embedded browsers that do not
    // support downloading a renderer-created blob URL.
    const base=location.pathname.replace(/\/[^/]*$/,''),a=document.createElement('a');
    a.href=`${base}/api/verification-summary/export?${new URLSearchParams(filters())}`;
    a.download='各客核价汇总.xlsx';document.body.appendChild(a);a.click();a.remove();
  });
  load();
})();
