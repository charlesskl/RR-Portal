(() => {
  'use strict';
  const $=id=>document.getElementById(id), esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let data={rows:[],columns:[],customers:[]},customer='',loading=false;
  const format=(v,percent=false)=>typeof v==='number'?(percent?(v*100).toFixed(2)+'%':v.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})):v==null?'—':esc(v);
  const filters=()=>({customer,status:$('vs-status').value,search:$('vs-search').value.trim(),workshop:$('vs-workshop').value});
  function selectedRows(){const f=filters();return data.rows.filter(r=>(!f.customer||r.values.A===f.customer)&&(!f.status||r.status===f.status)&&(!f.workshop||G.workshop(r)===f.workshop)&&(!f.search||`${r.values.A} ${r.values.B} ${r.values.C}`.toLowerCase().includes(f.search.toLowerCase())));}
  const G=VerificationReportGroups;
  // Display the complete report by default, including template-hidden columns.
  $('vs-all').checked=true;
  let mode='customer-detail';
  const quantityDrafts=new Map();
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
      const value=quantityDrafts.has(r.version_id)?quantityDrafts.get(r.version_id):(typeof r.values.D==='number'?r.values.D.toFixed(2):'');
      trs[i].cells[index].innerHTML=`<div class="vs-quantity"><input type="number" min="0" step="1" aria-label="${esc(r.values.B)} 接单数量" value="${esc(value)}" placeholder="未填写"><button type="button" class="mini" data-quantity-save="${r.version_id}">保存</button><span role="status"></span></div>`;
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
      return `<tr class="${total?'vs-total':''}">${cols.map(c=>`<td class="${r.values[c.key]==null?'vs-missing':''}" title="${esc(r.sources[c.key]||r.formulas[c.key]||(r.values[c.key]==null?'缺少来源或计算参数':''))}">${c.key==='B'&&!total?`<a href="./verification.html?quote_id=${r.id}">${format(r.values[c.key])}</a>`:format(r.values[c.key],c.percent)}</td>`).join('')}<td title="${esc(r.workshop_source||'')}">${esc(total?r.workshop:G.workshop(r))}</td><td>${esc(r.version)}</td><td>${esc(r.status_label)}</td><td class="vs-warning">${total?`${r.quantity_count}/${r.count}款有数量`:esc((G.workshop(r)===G.pending?[r.workshop_source,...r.issues]:r.issues).filter(Boolean).join('；'))}</td></tr>`;
    }).join('')}</tbody>`;
    $('vs-overview').innerHTML=`<table><thead><tr>${['客名','核价款数','数量匹配','接单数量','总生产金额 HK$','总生产成本 HK$','减税金额 HK$','税后毛利 HK$','税后利润 HK$'].map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${G.group(rows,r=>r.values.A).map(([c,rs])=>{const t=G.aggregate(rs,c,'');return `<tr><td>${esc(c)}</td><td>${rs.length}</td><td>${t.quantity_count}/${rs.length}</td>${['D','DI','DJ','DU','DX','DZ'].map(k=>`<td>${format(t.values[k])}</td>`).join('')}</tr>`;}).join('')}</tbody></table>`;
    quantityInputs(shown,cols);
    alignFrozenColumns();
    const pending=rows.filter(r=>G.workshop(r)===G.pending).length;
    $('vs-message').textContent=`${modes[mode]}；${pending}款待分配车间。单价栏合计为各款之和，金额按数量计算，占比由合计重算；缺项不计成0。导出包含各客车间明细、总表及打印版，与筛选一致。`;
  }
  async function load(){
    if(loading)return;
    loading=true;$('vs-export').disabled=true;$('vs-message').classList.remove('vs-error');
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
    finally{loading=false;$('vs-export').disabled=!loaded;}
  }
  $('vs-tabs').addEventListener('click',e=>{const b=e.target.closest('[data-customer]');if(b){customer=b.dataset.customer;render();}});
  for(const id of ['vs-search','vs-status','vs-all','vs-workshop'])$(id).addEventListener('input',render);
  $('vs-reports').addEventListener('click',e=>{const b=e.target.closest('[data-mode]');if(b){mode=b.dataset.mode;render();}});
  $('vs-print').addEventListener('click',()=>window.print());
  $('vs-detail').addEventListener('input',e=>{if(e.target.matches('.vs-quantity input'))quantityDrafts.set(Number(e.target.parentElement.querySelector('button').dataset.quantitySave),e.target.value);});
  $('vs-detail').addEventListener('click',async e=>{
    const button=e.target.closest('[data-quantity-save]');if(!button)return;
    const cell=button.parentElement,input=cell.querySelector('input'),message=cell.querySelector('span');
    const quantity=input.value.trim()===''?null:Number(input.value);
    if(input.validity.badInput||!(quantity===null||(Number.isSafeInteger(quantity)&&quantity>=0))){message.textContent='请输入非负整数';return;}
    button.disabled=true;message.textContent='保存中…';
    try{
      const response=await fetch('/api/verification-summary/quantity',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({version_id:Number(button.dataset.quantitySave),quantity})});
      const result=await response.json();if(!response.ok)throw new Error(result.error||'保存失败');
      quantityDrafts.delete(Number(button.dataset.quantitySave));await load();
    }catch(error){message.textContent=error.message;button.disabled=false;}
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
