const $ = s => document.querySelector(s);
const app = $('#app'), overlay = $('#overlay');
const paths = {
 feedback:'M21 11a8 8 0 0 1-8 8H7l-5 3 2-6a8 8 0 0 1-1-5 8 8 0 0 1 8-8h2a8 8 0 0 1 8 8M7 9h10M7 13h6',
 cube:'m12 3 9 5v9l-9 5-9-5V8zm0 0v10m-9-5 9 5 9-5m-9 5v9',
 grid:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
 orders:'M7 3h10v3H7zM7 5H4v16h16V5h-3M8 11h8M8 16h6',
 folder:'M3 7V5h6l2 2h10v13H3z',
 users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m18 0v-2a4 4 0 0 0-3-3.87M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8m7 0a4 4 0 0 1 0 8',
 help:'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3m.1 4h.01M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20',
 plus:'M12 5v14M5 12h14', close:'m6 6 12 12M6 18 18 6', search:'M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15m5.5 13 5 5',
 arrow:'M5 12h14m-5-5 5 5-5 5', chevron:'m9 5 7 7-7 7', down:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
 clock:'M12 8v5l3 2M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20', check:'m7 12 3 3 7-7M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20',
 printer:'M6 9V3h12v6M6 17H3V9h18v8h-3M6 14h12v7H6zM17 12h.01',
 upload:'M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5', shield:'m12 2 9 4v6c0 6-9 10-9 10S3 18 3 12V6zm-4 10 3 3 5-6',
 cloud:'M7 18a5 5 0 1 1 0-10 7 7 0 0 1 13 3 3.5 3.5 0 0 1-1 7H7',
 file:'M14 2H5v20h14V7zm0 0v5h5M8 12h8M8 16h6', logout:'M9 3H3v18h6M8 12h13m-5-5 5 5-5 5', pin:'M12 22s8-8 8-13a8 8 0 0 0-16 0c0 5 8 13 8 13m0-17a4 4 0 1 0 0 8 4 4 0 0 0 0-8'
};
const icon = (name, cls='') => `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name]||paths.file}"/></svg>`;
const esc = v => String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const size = n => n<1024*1024 ? `${(n/1024).toFixed(1)} KB` : `${(n/1024/1024).toFixed(1)} MB`;
const displayDate = d => d ? d.replaceAll('-','.') : '待确认';
const displayTime = d => new Date(d).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
let state={me:null,orders:[],view:'dashboard',factory:'全部厂区',filter:'全部',search:'',page:1,users:[]}, selectedFiles=[], busy=false, returnFocus=null;
const navLabels={dashboard:'首页',orders:'订单',files:'文件',feedback:'反馈',users:'用户',help:'使用指南'};
const viewLabels={dashboard:'工作台',orders:'打印订单',files:'文件中心',feedback:'交付反馈',users:'用户管理',help:'使用指南'};
const steps=['待接单','待排产','打印中','待交付','已完成'];
const nextStatus={'待接单':'待排产','待排产':'打印中','打印中':'待交付','待交付':'已完成'};
async function api(url,options={}) {
  const headers={'X-CSRF-Token':state.me?.csrf||'',...options.headers};
  if(options.body && typeof options.body==='string') headers['Content-Type']='application/json';
  const res=await fetch(url,{...options,headers}); let data; try {data=await res.json();} catch {throw Error('连接中断，请重试');}
  if(!res.ok) {if(res.status===401 && !url.endsWith('/login')){overlay.innerHTML='';renderLogin();} throw Error(data.error||'请求失败');} return data;
}
let toastTimer;
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),4000);}
const brand = `<div class="brand"><svg class="brand-mark" viewBox="0 0 40 44" fill="none" aria-hidden="true"><path d="m20 2 17 10v20L20 42 3 32V12zm0 0v20M3 12l17 10 17-10M20 22v20" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"/></svg><div><strong>PrintLink<span style="color:#678bd9">.</span></strong><small>3D 打印协同平台</small></div></div>`;
const printerArt = `<svg class="hero-art" viewBox="0 0 290 220" fill="none" aria-hidden="true"><defs><linearGradient id="body" x1="73" y1="31" x2="230" y2="185" gradientUnits="userSpaceOnUse"><stop stop-color="#f8fbff"/><stop offset="1" stop-color="#b5c8e9"/></linearGradient><linearGradient id="glass" x1="97" y1="49" x2="210" y2="155" gradientUnits="userSpaceOnUse"><stop stop-color="#c7dafa" stop-opacity=".7"/><stop offset="1" stop-color="#7b9bcc" stop-opacity=".3"/></linearGradient><linearGradient id="object" x1="110" y1="117" x2="165" y2="163" gradientUnits="userSpaceOnUse"><stop stop-color="#8bb3fa"/><stop offset="1" stop-color="#3369d5"/></linearGradient></defs><path d="m11 166 126-72 144 83M36 191l126-73M86 219l126-73M34 146l151 85M79 121l151 85" stroke="#9fbce9" stroke-opacity=".17"/><ellipse cx="157" cy="190" rx="88" ry="13" fill="#517cbd" opacity=".1"/><path d="m67 46 59-30 118 36-58 30z" fill="#eaf2ff" stroke="#a8bfe2"/><path d="m67 46 119 36v113L67 158z" fill="url(#body)" stroke="#a7bfdf"/><path d="m186 82 58-30v112l-58 31z" fill="#8da9cf" stroke="#88a7cf"/><path d="m79 57 95 29v79l-95-29z" fill="url(#glass)" stroke="#a3bade"/><path d="m194 88 40-22v83l-40 20z" fill="#6c89b4"/><path d="m84 133 45-25 97 29-46 25z" fill="#d8e6fa" stroke="#9fb7db"/><path d="M100 70v66m61-48v66" stroke="#8ba6d1" stroke-width="3"/><path d="m88 90 80 24" stroke="#c4d6f0" stroke-width="7"/><path d="m123 89 16 5v19l-16-5z" fill="#4876bd"/><path d="m127 108 7 2v10l-4 3-3-5z" fill="#244e8d"/><path d="m108 133 20-10 32 10-20 11z" fill="#b7d2ff"/><path d="m108 133 32 11v22l-32-11z" fill="url(#object)"/><path d="m140 144 20-11v22l-20 11z" fill="#4d80d8"/><path d="m112 140 23 7m-23-2 23 7m-23-2 23 7" stroke="#afd0ff" stroke-opacity=".7"/><path d="m79 150 95 29v10l-95-29z" fill="#c2d2e9"/><path d="m145 175 22 7v8l-22-7z" fill="#456ba1"/><path d="m149 179 9 3" stroke="#b5f2ec" stroke-width="2"/><circle cx="218" cy="34" r="18" fill="#e1ecfc" stroke="#b5cbed"/><circle cx="218" cy="34" r="10" stroke="#b0c7e9" stroke-width="5"/><path d="M217 49v11" stroke="#7695c5" stroke-width="3"/><path d="m69 162 8 3v13l-8-3m103 21 11 3v12l-11-3m52-37 10-5v12l-10 5" fill="#829bc0"/><circle cx="43" cy="85" r="3" fill="#90afe0" opacity=".5"/><path d="M251 108h12m-6-6v12M39 126h9m-4.5-4.5v9" stroke="#8aace0" opacity=".45"/></svg>`;
function scopedOrders(){return state.orders.filter(o=>state.factory==='全部厂区'||o.factory===state.factory);}
function filteredOrders(){return scopedOrders().filter(o=>(state.filter==='全部'||(state.filter==='处理中'?['待排产','打印中','待交付'].includes(o.status):o.status===state.filter))&&[o.number,o.product,o.sku,o.customer,o.engineer,o.follower].join(' ').toLowerCase().includes(state.search.toLowerCase()));}
const badge = s => `<span class="badge" data-status="${esc(s)}">${esc(s)}</span>`;
function renderShell(){
  const user=state.me.user;
  app.innerHTML=`<aside class="sidebar">${brand}<div class="nav-label">工作空间 / WORKSPACE</div><nav>${user.role==='admin'?'<a class="nav-btn" href="/platform"><span>⚙</span><span>生产协同</span></a>':''}${Object.entries(navLabels).filter(([v])=>v!=='help'&&(v!=='users'||user.role==='admin')).map(([v,label])=>`<button class="nav-btn ${v===state.view?'active':''}" data-view="${v}" aria-label="${label}" title="${label}">${icon({dashboard:'grid',orders:'orders',files:'folder',feedback:'feedback',users:'users'}[v])}<span>${label}</span>${v==='orders'?`<span class="count">${state.orders.length}</span>`:''}</button>`).join('')}</nav><div class="sidebar-bottom"><div class="plant-info">${icon('cloud')}<strong>连接每一份制造需求</strong>统一申请 · 协同交付<div class="plant-dots">${state.me.factories.map(f=>`<span><i class="dot"></i>${esc(f)}厂区</span>`).join('')}</div></div><button class="nav-btn ${state.view==='help'?'active':''}" data-view="help">${icon('help')}<span>使用指南</span></button><div class="profile"><div class="avatar">${esc(user.name.slice(-2))}</div><div><strong>${esc(user.name)}</strong><small>${user.role==='admin'?'跨厂区管理员':user.factories.join('、')+'成员'}</small></div>${!state.me.demo?`<button class="icon-btn" data-action="logout" title="退出登录">${icon('logout')}</button>`:''}</div></div></aside><div class="workspace"><header class="topbar"><div class="crumb">工作空间 ${icon('chevron')}<b>${viewLabels[state.view]}</b></div><div class="top-actions"><span class="local-tag">${state.me.demo?'本地验收 · 示例数据':'企业工作空间'}</span><select id="factory-filter" aria-label="筛选厂区">${(user.factories.length>1?['全部厂区',...user.factories]:user.factories).map(f=>`<option ${state.factory===f?'selected':''}>${f}</option>`).join('')}</select><button class="icon-btn" data-view="help" title="使用指南">${icon('help')}</button><button class="avatar" data-view="${user.role==='admin'?'users':'help'}" title="账号与厂区">${esc(user.name.slice(-1))}</button>${!state.me.demo?`<button class="icon-btn" data-action="logout" title="退出登录">${icon('logout')}</button>`:''}</div></header><main class="main" id="main"></main></div>`;
  renderView();
}
function heading(title,subtitle,action=true){return `<div class="heading"><div><p class="eyebrow">${state.view==='dashboard'?'MANUFACTURING WORKSPACE':'PRINTLINK / '+({orders:'ORDERS',files:'FILES',feedback:'FEEDBACK',users:'TEAM',help:'GUIDE'}[state.view]||'')}</p><h1>${title}</h1><p class="subtext">${subtitle}</p></div>${action?`<button class="btn primary" data-action="new">${icon('plus')}新建打印申请</button>`:''}</div>`;}
function renderView(){
  const main=$('#main');
  if(state.view==='dashboard'||state.view==='orders') {
    const list=scopedOrders();
    const metrics=[['全部订单',list.length,'累计提交的打印申请','orders','全部'],['待接单',list.filter(o=>o.status==='待接单').length,'等待工程师确认需求','clock','待接单'],['处理中',list.filter(o=>['待排产','打印中','待交付'].includes(o.status)).length,'排产、打印与交付中的订单','printer','处理中'],['已完成',list.filter(o=>o.status==='已完成').length,'已完成交付的打印订单','check','已完成']];
    main.innerHTML=heading(state.view==='dashboard'?'让想法，从这里成型。':'打印订单',state.view==='dashboard'?'连接厂区与制造，让每一次打印都有迹可循。':'统一查看打印申请，跟进每一份订单的交付进度。')+(state.view==='dashboard'?`<section class="hero"><div><div class="hero-kicker">FROM DESIGN TO REALITY</div><h2>从一份设计，到触手可及。</h2><p>上传模型，提交需求，让制造协作更简单。<br>${state.me.factories.map(esc).join(' · ')}，共享一个打印工作空间。</p><div class="hero-links"><span>${icon('cube')}多格式模型</span><span>${icon('cloud')}跨厂区协同</span><span>${icon('shield')}订单全程追踪</span></div></div>${printerArt}</section>`:'')+`<section class="metrics">${metrics.map(([title,value,foot,ico,filter])=>`<button class="metric ${state.filter===filter&&filter!=='全部'?'active':''}" data-filter="${filter}"><div class="metric-title">${title}</div><div class="metric-icon">${icon(ico)}</div><div class="metric-value">${value}<small>单</small></div><div class="metric-foot">${foot}</div></button>`).join('')}</section><section class="panel"><div class="panel-title"><h2>${state.view==='dashboard'?'最近打印订单':'全部打印订单'}<small>每一份需求，都在有序推进</small></h2><button class="btn small" data-action="export">${icon('down')}导出订单</button></div><div class="table-tools"><div class="tabs">${['全部','待接单','待排产','打印中','待交付','已完成'].map(s=>`<button class="tab ${state.filter===s?'active':''}" data-filter="${s}">${s}${s==='全部'?`<small>${list.length}</small>`:''}</button>`).join('')}<button class="tab ${state.filter==='已取消'?'active':''}" data-filter="已取消">已取消</button></div><label class="search">${icon('search')}<input id="search" value="${esc(state.search)}" placeholder="搜索订单、货号或产品名称" aria-label="搜索订单"></label></div><div id="order-table"></div></section>${state.view==='dashboard'?`<section class="bottom-grid"><div class="panel mini-panel"><h3>简单四步，完成一次打印</h3><div class="workflow">${[['orders','提交申请'],['check','确认 · 排产'],['printer','打印制作'],['cube','交付完成']].map(([ico,text],i)=>`${i?'<span class="workflow-line"></span>':''}<div class="workflow-step"><div class="workflow-icon">${icon(ico)}</div>${text}</div>`).join('')}</div></div><div class="panel mini-panel"><h3>让文件与需求，一起到位</h3><div class="file-types"><div class="file-type"><div class="file-tile">3D</div><div><b>三维模型</b><small>STL / STEP / OBJ / 3MF</small></div></div><div class="file-type"><div class="file-tile">IMG</div><div><b>参考图片</b><small>JPG / PNG / WEBP</small></div></div><div class="file-type"><div class="file-tile">ZIP</div><div><b>打包附件</b><small>ZIP / RAR / 7Z</small></div></div></div><p class="mini-note">单个文件最大 200 MB，每单最多 10 个文件，总大小不超过 500 MB。</p></div></section>`:''}<footer class="footer"><span>PrintLink · 让制造协作，更进一步。</span><span>${state.me.demo?'本地验收环境 · 示例订单不代表实际生产进度':'厂区数据按账号权限展示'} · ${new Date().getFullYear()}</span></footer>`;
    renderTable();
  } else if(state.view==='files') renderFiles();
  else if(state.view==='feedback') renderFeedback();
  else if(state.view==='users') renderUsers();
  else renderHelp();
}
function renderTable(){
  const list=filteredOrders(), pages=Math.max(1,Math.ceil(list.length/6)); state.page=Math.min(state.page,pages);
  const rows=list.slice((state.page-1)*6,state.page*6);
  $('#order-table').innerHTML=rows.length?`<div class="table-scroll"><table><thead><tr><th>产品 / 订单编号</th><th>所属厂区</th><th>客名 / 货号</th><th>打印需求</th><th>需交板时间</th><th>订单状态</th><th>跟进工程师</th><th>操作</th></tr></thead><tbody>${rows.map(o=>`<tr data-order="${o.id}" tabindex="0" aria-label="查看 ${esc(o.product)} 订单"><td><div class="product">${esc(o.product)}${o.priority==='加急'?'<span class="urgent">加急</span>':''}</div><div class="number">${esc(o.number)}</div></td><td><span class="factory-pill">${esc(o.factory)}厂区</span></td><td>${esc(o.customer)}<div class="number">${esc(o.sku)}</div></td><td>${o.quantity} 件 · ${esc(o.material)}<div class="number">${esc(o.color)}${o.files.length?' · '+o.files.length+' 个附件':''}</div></td><td>${displayDate(o.dueDate)}</td><td>${badge(o.status)}</td><td><div class="person"><span class="person-circle">${esc(o.engineer.slice(-1))}</span>${esc(o.engineer)}</div></td><td><button class="btn text small" data-order="${o.id}">查看 ${icon('chevron')}</button></td></tr>`).join('')}</tbody></table></div><div class="table-footer"><span>共 ${list.length} 条订单 · 第 ${(state.page-1)*6+1}–${Math.min(state.page*6,list.length)} 条</span><div class="pagination"><button data-page="${state.page-1}" ${state.page===1?'disabled':''} aria-label="上一页">‹</button><button class="current">${state.page}</button><span>/ ${pages}</span><button data-page="${state.page+1}" ${state.page===pages?'disabled':''} aria-label="下一页">›</button></div></div>`:`<div class="empty">${icon('orders')}<div>没有找到符合条件的订单</div><p><button class="btn text" data-action="reset-filters">清除筛选</button><button class="btn primary" data-action="new">新建申请</button></p></div>`;
}
function renderFiles(){const files=scopedOrders().flatMap(o=>o.files.map(f=>({...f,order:o})));$('#main').innerHTML=heading('文件中心','模型、图片与压缩包，随订单一起归档。',false)+`<div class="file-library">${files.map(f=>`<article class="panel library-card"><div class="info-row"><div class="file-tile">${esc(f.name.split('.').pop().toUpperCase())}</div><span class="factory-pill">${esc(f.order.factory)}厂区</span></div><strong>${esc(f.name)}</strong><small>${size(f.size)}<br>${esc(f.order.product)} · ${esc(f.order.number)}</small><div class="info-row"><a href="/api/files/${f.id}" download>${icon('down')} 下载文件</a><button class="btn text small" data-order="${f.order.id}">查看订单</button></div></article>`).join('')}</div>${files.length?'':'<div class="panel empty">提交申请并上传附件后，文件会自动归档到这里。</div>'}`;}
async function renderUsers(){
  $('#main').innerHTML=heading('用户管理','管理员可编辑用户资料、角色及厂区权限，修改后点击该行“保存”。',false)+`<div class="heading"><p class="subtext">管理员拥有全部厂区权限；厂区成员可访问获授权的一个或多个厂区。</p><button class="btn primary" data-action="add-user">${icon('plus')}添加成员</button></div><div id="user-list" class="panel users-table-wrap"><div class="empty">正在加载用户…</div></div>`;
  try{state.users=await api('/api/users');if(!$('#user-list'))return;$('#user-list').innerHTML=`<table class="users-table"><thead><tr><th>姓名</th><th>登录账号 / 邮箱</th><th>角色</th><th>厂区权限</th><th>操作</th></tr></thead><tbody>${state.users.map(userRow).join('')}</tbody></table>`;}catch(e){if($('#user-list'))$('#user-list').innerHTML='<div class="empty">加载失败，请重新打开用户页面。</div>';toast(e.message);}
}
function userRow(u){
  const fixed=state.me.demo&&u.username==='demo';
  return `<tr data-user-id="${u.id}"><td data-label="姓名"><input name="name" aria-label="姓名：${esc(u.username)}" value="${esc(u.name)}" maxlength="40" required></td><td data-label="登录账号 / 邮箱"><input name="username" aria-label="登录账号：${esc(u.username)}" value="${esc(u.username)}" maxlength="80" required ${fixed?'readonly title="演示账号不可更改"':''}></td><td data-label="角色"><select name="role" aria-label="角色：${esc(u.username)}" ${fixed?'disabled':''}><option value="admin" ${u.role==='admin'?'selected':''}>管理员</option><option value="member" ${u.role==='member'?'selected':''}>厂区成员</option></select></td><td data-label="厂区权限">${factoryPicker(u.factories||[u.factory],u.role==='admin')}</td><td data-label="操作"><div class="user-actions"><button class="btn small" data-permissions-user="${u.id}">权限</button><button class="btn small" data-save-user="${u.id}">保存</button><button class="btn small" data-password-user="${u.id}">重置密码</button></div><p class="error user-row-error" role="alert"></p></td></tr>`;
}
function factoryPicker(selected,admin=false){
  const values=admin?state.me.factories:selected;
  return `<fieldset class="factory-picker" data-admin="${admin}"><legend>厂区权限（可多选）</legend><label class="factory-choice all"><input type="checkbox" data-all-factories ${values.length===state.me.factories.length?'checked':''} ${admin?'disabled':''}>所有厂区</label><div class="factory-options">${state.me.factories.map(f=>`<label class="factory-choice"><input type="checkbox" name="factories" value="${esc(f)}" ${values.includes(f)?'checked':''} ${admin?'disabled':''}>${esc(f)}</label>`).join('')}</div>${admin?'<small>管理员拥有所有厂区权限</small>':''}</fieldset>`;
}
function selectedFactories(container){return [...container.querySelectorAll('[name=factories]:checked')].map(el=>el.value);}
function syncUserFactory(container){
  const role=container.querySelector('[name=role]').value, picker=container.querySelector('.factory-picker');
  if(picker)picker.outerHTML=factoryPicker(selectedFactories(container),role==='admin'||role==='管理员');
}
function editPermissions(id){
  const row=document.querySelector(`[data-user-id="${id}"]`);if(!row)return;
  const u=state.users.find(x=>x.id===id), role=row.querySelector('[name=role]').value, factories=selectedFactories(row);
  openModal(`<div class="modal-header"><div><h2 id="modal-title">编辑权限</h2><p>${esc(u.name)} · ${esc(u.username)}</p></div><button class="icon-btn" data-action="close" aria-label="关闭">${icon('close')}</button></div><form id="permissions-form" data-id="${id}" class="modal-body"><div class="help-box">管理员可管理全部厂区的订单、反馈与用户。厂区成员只能查看和下单至勾选的厂区。修改权限后，该用户需要重新登录；历史订单仍保留原厂区。</div><div class="form-grid">${field('角色','role',{choices:['管理员','厂区成员'],value:role==='admin'?'管理员':'厂区成员'})}<div class="full">${factoryPicker(factories,role==='admin')}</div></div><p class="subtext">可勾选多个厂区，也可勾选“所有厂区”。管理员始终拥有全部厂区权限。</p><p class="error" id="permissions-error" role="alert"></p></form><div class="modal-footer"><button class="btn" data-action="close">取消</button><button class="btn primary" type="submit" form="permissions-form">保存权限</button></div>`,true);
  if(state.me.demo&&u.username==='demo')overlay.querySelector('[name=role]').disabled=true;
}
async function saveUser(id,permissions){
  if(busy)return;const row=document.querySelector(`[data-user-id="${id}"]`);if(!row)return;
  const data=Object.fromEntries([...row.querySelectorAll('input[name=name],input[name=username],select[name=role]')].map(el=>[el.name,el.value]));data.factories=selectedFactories(row);if(permissions)Object.assign(data,permissions);
  const error=permissions?$('#permissions-error'):row.querySelector('.user-row-error');error.textContent='';
  if(!data.factories.length){error.textContent='请至少选择一个厂区';return;}
  if(!data.name.trim()||!data.username.trim()){error.textContent='姓名和登录账号不能为空';return;}
  busy=true;const buttons=[...row.querySelectorAll('button'),...overlay.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
  try{const result=await api('/api/users/'+id,{method:'PATCH',body:JSON.stringify(data)});state.users=state.users.map(u=>u.id===id?result.user:u);busy=false;if(permissions)closeModal();
    if(result.signedOut){state.me=null;state.users=[];state.orders=[];renderLogin();toast('权限或账号已更新，请重新登录');return;}
    if(id===state.me.user.id){state.me.user=result.user;renderShell();}else{row.outerHTML=userRow(result.user);}
    toast(result.accessChanged?'已保存，该用户需要重新登录':'用户资料已保存');
  }catch(e){if(error.isConnected)error.textContent=e.message;}finally{busy=false;buttons.forEach(b=>b.disabled=false);}
}
function renderHelp(){$('#main').innerHTML=heading('使用指南','从提交申请到打印交付，每一步都清晰可见。',false)+`<article class="panel guide"><h2>一份申请，连接各个厂区</h2><p>点击“新建打印申请”，选择厂区并填写申请表。电脑和手机浏览器使用同一套页面；部署到云服务器后，同事可通过同一个地址登录。</p><h3>01 · 填写打印需求</h3><p>表单完整保留原 Excel 的车间、客名、货号、产品名称、数量、下单时间、耗材、颜色、需交板时间、复交板时间、跟进工程师、3D 跟进人和备注。下单时间由系统自动记录。复交板时间是打印方回复的预计交期，在接单时填写。</p><h3>02 · 上传文件并提交</h3><p>支持 STL、STP / STEP、OBJ、3MF、IGS / IGES、PLY 模型，JPG、PNG、WEBP、GIF 图片，以及 ZIP、RAR、7Z 压缩包。每单 1–10 个附件，单个不超过 200 MB、合计不超过 500 MB。图片可在详情中预览；模型和压缩包可下载查看。</p><h3>03 · 跟进处理进度</h3><p>管理员在订单详情填写 3D 跟进人、复交板时间，然后依次更新“待接单 → 待排产 → 打印中 → 待交付 → 已完成”。所有更新均记录操作人和时间。待接单、待排产订单可取消。</p><h3>04 · 管理厂区与成员</h3><p>管理员可创建厂区账号。成员只能查看本厂区的订单与文件，管理员可跨厂区管理。订单列表支持搜索、状态筛选和 CSV 导出，可使用 Excel 打开。</p><h3>关于本地验收</h3><p>${state.me.demo?'当前为本地演示模式，自动使用演示管理员。第一条订单参考申请表，其厂区、状态和优先级为演示设置；其他订单为虚构示例。所有新提交的订单与附件会保存到本机。':'当前为生产模式，必须登录才能访问订单和文件。'} 原始 Excel 和附件保持不变。云端上线使用独立空数据库，不会导入演示订单。</p><button class="btn primary" data-action="new">${icon('plus')}开始第一份申请</button></article>`;}
function openModal(html,narrow=false){returnFocus=document.activeElement;overlay.innerHTML=`<div class="modal-backdrop"><section class="modal ${narrow?'narrow':''}" role="dialog" aria-modal="true" aria-labelledby="modal-title">${html}</section></div>`;document.body.style.overflow='hidden';setTimeout(()=>overlay.querySelector('input:not([type=file]),select,button')?.focus(),20);}
function closeModal(){if(busy)return;overlay.innerHTML='';document.body.style.overflow='';selectedFiles=[];returnFocus?.focus();}
const draftKey=()=>`printlink-draft-${state.me.user.id}`;
function readDraft(){try{return JSON.parse(localStorage.getItem(draftKey())||'{}');}catch{return {};}}
function field(label,name,options={}){
  const {required=false,type='text',value='',choices,placeholder='',full=false}=options;
  const input=choices?`<select name="${name}" ${required?'required':''}>${choices.map(c=>`<option ${c===value?'selected':''}>${esc(c)}</option>`).join('')}</select>`:type==='textarea'?`<textarea name="${name}" maxlength="2000" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`:`<input name="${name}" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${required?'required':''} ${type==='number'?'min="1" max="100000" step="1"':'maxlength="120"'}>`;
  return `<label class="field ${full?'full':''}"><span>${label} ${required?'<span class="req">*</span>':''}</span>${input}</label>`;
}
function newOrder(){
  const d=readDraft(), u=state.me.user; selectedFiles=[];
  openModal(`<div class="modal-header"><div><h2 id="modal-title">新建打印申请</h2><p>填写需求，上传附件，开启一次新的制造协作。</p></div><button class="icon-btn" data-action="close" aria-label="关闭">${icon('close')}</button></div><form id="order-form" class="modal-body"><div class="form-section"><h3><span class="section-num">01</span>申请信息</h3><div class="form-grid">${field('所属厂区','factory',{required:true,value:d.factory||(state.factory==='全部厂区'?u.factory:state.factory),choices:u.factories})}${field('车间','workshop',{required:true,value:d.workshop,placeholder:'如 A 车间'})}${field('客名','customer',{required:true,value:d.customer,placeholder:'请输入客户名称'})}${field('跟进工程师','engineer',{required:true,value:d.engineer,placeholder:'工程师姓名'})}${field('3D 跟进人','follower',{value:d.follower,placeholder:'可由打印方接单时填写'})}${field('优先级','priority',{value:d.priority,choices:['普通','加急']})}</div></div><div class="form-section"><h3><span class="section-num">02</span>打印需求</h3><div class="form-grid">${field('产品名称','product',{required:true,value:d.product,placeholder:'如 呼吸灯外壳'})}${field('货号','sku',{required:true,value:d.sku,placeholder:'如 OHM-LS1'})}${field('数量（件）','quantity',{required:true,type:'number',value:d.quantity||1})}${field('耗材','material',{required:true,value:d.material||'硬胶',choices:['硬胶','软胶','PLA','ABS','PETG','尼龙','光敏树脂','其他（备注说明）']})}${field('颜色','color',{required:true,value:d.color,placeholder:'如 白色 / 潘通色号'})}${field('需交板时间','dueDate',{required:true,type:'date',value:d.dueDate})}${field('备注 / 工艺要求','notes',{type:'textarea',value:d.notes,full:true,placeholder:'如 光固化、表面处理、尺寸公差、组装要求等'})}</div></div><div class="form-section"><h3><span class="section-num">03</span>模型与参考附件 <span class="req">*</span></h3><div class="dropzone" id="dropzone"><div class="upload-icon">${icon('upload')}</div><p>拖拽文件到此处，或 <span style="color:var(--blue)">点击上传</span></p><small>3D 模型、参考图片、ZIP / RAR / 7Z 压缩包<br>单个 ≤ 200 MB · 最多 10 个 · 合计 ≤ 500 MB</small><input id="file-input" type="file" multiple accept=".stl,.stp,.step,.obj,.3mf,.iges,.igs,.ply,.png,.jpg,.jpeg,.webp,.gif,.zip,.rar,.7z" aria-label="选择模型和参考附件"></div><div id="selected-files"></div></div><p class="error" id="form-error" role="alert"></p></form><div class="modal-footer"><span class="hint">下单时间自动记录 · 复交板时间由打印方确认</span><button class="btn" data-action="save-draft">保存草稿</button><button class="btn primary" type="submit" form="order-form" id="submit-order">提交申请 ${icon('arrow')}</button></div>`);
  const drop=$('#dropzone');
  drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('dragging');});drop.addEventListener('dragleave',()=>drop.classList.remove('dragging'));drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('dragging');addFiles(e.dataTransfer.files);});
}
function addFiles(files){
  const supported=/\.(stl|stp|step|obj|3mf|iges|igs|ply|png|jpe?g|webp|gif|zip|rar|7z)$/i;
  for(const f of files){if(!supported.test(f.name)){toast(`不支持的格式：${f.name}`);continue;}if(!f.size||f.size>200*1024*1024){toast('文件不能为空，单个大小不能超过 200 MB');continue;}if(selectedFiles.length>=10){toast('每单最多 10 个附件');break;}if(selectedFiles.reduce((a,f)=>a+f.size,0)+f.size>500*1024*1024){toast('附件合计不能超过 500 MB');break;}if(!selectedFiles.some(x=>x.name===f.name&&x.size===f.size))selectedFiles.push(f);}
  renderSelected();
}
function renderSelected(){$('#selected-files').innerHTML=selectedFiles.map((f,i)=>`<div class="file-row"><div class="file-tile">${esc(f.name.split('.').pop().toUpperCase())}</div><div class="file-details"><strong>${esc(f.name)}</strong><small>${size(f.size)} · 待提交上传</small></div><button type="button" class="icon-btn" data-remove-file="${i}" aria-label="移除 ${esc(f.name)}">${icon('close')}</button></div>`).join('');}
async function submitOrder(form){
  if(busy)return;if(!selectedFiles.length){$('#form-error').textContent='请至少上传一个模型、图片或压缩包。';return;}
  const data=Object.fromEntries(new FormData(form)); data.fileIds=[];busy=true;$('#form-error').textContent='';$('#submit-order').disabled=true;
  overlay.querySelectorAll('input,select,textarea,button').forEach(el=>el.disabled=true);
  try{for(let i=0;i<selectedFiles.length;i++){const f=selectedFiles[i];$('#submit-order').textContent=`上传附件 ${i+1} / ${selectedFiles.length}…`;if(!f.uploadId){const uploaded=await api('/api/uploads',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(f.name)},body:f});f.uploadId=uploaded.id;}data.fileIds.push(f.uploadId);}
    $('#submit-order').textContent='正在提交…'; const order=await api('/api/orders',{method:'POST',body:JSON.stringify(data)});try{localStorage.removeItem(draftKey());}catch{}
    busy=false;closeModal();state.orders.unshift(order);state.filter='全部';state.search='';state.page=1;state.view='orders';state.factory=order.factory;renderShell();toast(`申请提交成功：${order.number}`);openOrder(order.id);
  }catch(e){if($('#form-error')){$('#form-error').textContent=e.message;overlay.querySelectorAll('input,select,textarea,button').forEach(el=>el.disabled=false);$('#submit-order').textContent='重新提交申请';}}finally{busy=false;}
}
function openOrder(id){
  const o=state.orders.find(x=>x.id===id);if(!o)return;
  const entries=[['所属厂区',o.factory+'厂区'],['车间',o.workshop],['客名',o.customer],['货号',o.sku],['数量',o.quantity+' 件'],['耗材',o.material],['颜色',o.color],['需交板时间',displayDate(o.dueDate)],['复交板时间',displayDate(o.replyDate)],['跟进工程师',o.engineer],['3D 跟进人',o.follower||'待分配'],['下单时间',displayTime(o.created)]];
  const canUpdate=state.me.user.role==='admin'&&nextStatus[o.status];
  openModal(`<div class="modal-header"><div><h2 id="modal-title">打印订单详情</h2><p>${esc(o.number)}</p></div><button class="icon-btn" data-action="close" aria-label="关闭">${icon('close')}</button></div><div class="modal-body"><div class="detail-top"><div><h3>${esc(o.product)}</h3><small>${esc(o.sku)} · ${o.priority==='加急'?'加急申请':'普通申请'}${o.sample?' · 示例订单':''}</small></div>${badge(o.status)}</div><div class="form-section"><h3>申请信息</h3><dl class="detail-grid">${entries.map(([k,v])=>`<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}<div class="full"><dt>备注 / 工艺要求</dt><dd>${esc(o.notes||'无')}</dd></div></dl></div><div class="form-section"><h3>附件 <span class="sample-note">${o.files.length} 个文件</span></h3>${o.files.length?o.files.map(f=>`<div class="file-row">${/\.(png|jpe?g|webp|gif)$/i.test(f.name)?`<a href="/api/files/${f.id}?preview=1" target="_blank" rel="noopener" title="查看图片"><img src="/api/files/${f.id}?preview=1" alt="参考图片"></a>`:`<div class="file-tile">${esc(f.name.split('.').pop().toUpperCase())}</div>`}<div class="file-details"><strong>${esc(f.name)}</strong><small>${size(f.size)}</small></div><a class="btn small" href="/api/files/${f.id}" download>${icon('down')}下载</a></div>`).join(''):'<p class="subtext">本示例没有附件。</p>'}</div>${canUpdate?`<form id="update-form" data-id="${o.id}" class="form-section"><h3>打印方处理</h3><div class="form-grid">${field('3D 跟进人','follower',{value:o.follower,placeholder:'请输入跟进人'})}${field('复交板时间','replyDate',{type:'date',value:o.replyDate})}${field('订单状态','status',{value:o.status,choices:[o.status,nextStatus[o.status],...(['待接单','待排产'].includes(o.status)?['已取消']:[])]})}</div><p class="error" id="update-error" role="alert"></p><button class="btn primary" type="submit">保存处理结果</button></form>`:''}${o.status==='已完成'?`<div class="form-section"><h3>交付反馈</h3><p class="subtext">${(o.feedback||[]).length} 条反馈 · 下单人可反馈质量问题、体验或建议。</p>${o.owner===state.me.user.id?`<button class="btn primary" data-feedback-order="${o.id}">填写反馈</button>`:''}<button class="btn text" data-action="view-feedback">查看反馈记录</button></div>`:''}<div class="form-section"><h3>订单动态</h3><ol class="timeline">${o.events.map(e=>`<li>${esc(e.text)}<small>${esc(e.actor)} · ${displayTime(e.created)}</small></li>`).join('')}</ol></div></div><div class="modal-footer"><button class="btn" data-action="close">关闭详情</button></div>`);
}
function newUser(){openModal(`<div class="modal-header"><h2 id="modal-title">添加厂区成员</h2><button class="icon-btn" data-action="close" aria-label="关闭">${icon('close')}</button></div><form class="modal-body" id="user-form"><div class="help-box">厂区成员可访问所勾选厂区的订单与附件。管理员可访问全部厂区。</div><div class="form-grid">${field('姓名','name',{required:true})}${field('登录账号','username',{required:true,placeholder:'字母 / 数字'})}<div class="full">${factoryPicker([state.me.factories[0]])}</div>${field('角色','role',{choices:['厂区成员','管理员']})}${field('初始密码（至少 8 位）','password',{type:'password',required:true,full:true})}</div><p class="error" id="user-error" role="alert"></p></form><div class="modal-footer"><button class="btn" data-action="close">取消</button><button class="btn primary" type="submit" form="user-form">创建账号</button></div>`,true);}
function exportOrders(){
  const list=filteredOrders();if(!list.length){toast('没有可导出的订单');return;}
  const cols=[['订单编号','number'],['厂区','factory'],['车间','workshop'],['客名','customer'],['货号','sku'],['产品名称','product'],['数量','quantity'],['下单时间','created'],['耗材','material'],['颜色','color'],['需交板时间','dueDate'],['复交板时间','replyDate'],['跟进工程师','engineer'],['3D跟进人','follower'],['备注','notes'],['状态','status']];
  const cell=v=>{let s=String(v??'');if(/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
  const csv='\ufeff'+[cols.map(c=>cell(c[0])).join(','),...list.map(o=>cols.map(([,k])=>cell(o[k])).join(','))].join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));const a=document.createElement('a');a.href=url;a.download=`打印订单-${new Date().toISOString().slice(0,10)}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast(`已导出 ${list.length} 条订单，可使用 Excel 打开`);
}
function renderLogin(){
  document.body.style.overflow='';app.innerHTML=`<div class="login"><form id="login-form" class="login-card">${brand}<h1>欢迎回到制造工作空间</h1><p>登录后，查看您的厂区订单与打印进度。</p>${field('账号','username',{required:true,placeholder:'请输入账号'})}${field('密码','password',{required:true,type:'password',placeholder:'请输入密码'})}<p class="error" id="login-error" role="alert"></p><button class="btn primary" type="submit">登录工作空间 ${icon('arrow')}</button><p>如需开通账号，请联系管理员。</p></form></div>`;
}
async function load(){try{state.me=await api('/api/me');state.orders=await api('/api/orders');state.factory=state.me.user.factories.length>1?'全部厂区':state.me.user.factories[0];renderShell();const linkedOrder=new URLSearchParams(location.search).get('order');if(linkedOrder&&state.orders.some(o=>o.id===linkedOrder))openOrder(linkedOrder);}catch(e){if(!$('#login-form'))app.innerHTML=`<div class="initial"><p>无法连接服务：${esc(e.message)}</p><button class="btn" data-action="retry">重新连接</button></div>`;}}
document.addEventListener('click',async e=>{
  const target=e.target.closest('button,[data-order]');if(!target)return;
  if(target.dataset.feedbackOrder){newFeedback(target.dataset.feedbackOrder);return;}
  if(target.dataset.saveUser){saveUser(target.dataset.saveUser);return;}
  if(target.dataset.permissionsUser){editPermissions(target.dataset.permissionsUser);return;}
  if(target.dataset.passwordUser){changePassword(target.dataset.passwordUser);return;}
  if(target.dataset.replyFeedback){replyFeedback(target.dataset.replyFeedback);return;}
  if(target.dataset.view){state.view=target.dataset.view;state.search='';state.filter='全部';state.page=1;renderShell();return;}
  if(target.dataset.order){openOrder(target.dataset.order);return;}
  if(target.dataset.filter){state.filter=target.dataset.filter;state.page=1;renderView();return;}
  if(target.dataset.page){state.page=Number(target.dataset.page);renderTable();return;}
  if(target.dataset.removeFile!==undefined){selectedFiles.splice(Number(target.dataset.removeFile),1);renderSelected();return;}
  switch(target.dataset.action){
    case 'new':newOrder();break;case 'close':closeModal();break;case 'export':exportOrders();break;case 'add-user':newUser();break;
    case 'save-draft':try{localStorage.setItem(draftKey(),JSON.stringify(Object.fromEntries(new FormData($('#order-form')))));toast('表单草稿已保存在此浏览器，附件需重新选择');closeModal();}catch{toast('浏览器无法保存草稿，请直接提交申请');}break;
    case 'reset-filters':state.filter='全部';state.search='';state.page=1;renderView();break;
    case 'logout':try{await api('/api/logout',{method:'POST'});state.me=null;renderLogin();}catch(e){toast(e.message);}break;
    case 'feedback':newFeedback();break;
    case 'view-feedback':closeModal();state.view='feedback';renderShell();break;
    case 'retry':load();break;
  }
});
document.addEventListener('change',e=>{if(e.target.matches('.users-table select[name=role],#user-form select[name=role],#permissions-form select[name=role]'))syncUserFactory(e.target.closest('tr,form'));if(e.target.matches('.factory-picker input')){const picker=e.target.closest('.factory-picker');if(e.target.hasAttribute('data-all-factories'))picker.querySelectorAll('[name=factories]').forEach(c=>c.checked=e.target.checked);const chosen=selectedFactories(picker).length;const all=picker.querySelector('[data-all-factories]');all.checked=chosen===state.me.factories.length;all.indeterminate=chosen>0&&chosen<state.me.factories.length;}if(e.target.id==='factory-filter'){state.factory=e.target.value;state.page=1;renderView();}if(e.target.id==='file-input'){addFiles(e.target.files);e.target.value='';}});
document.addEventListener('input',e=>{if(e.target.id==='search'){state.search=e.target.value;state.page=1;renderTable();}});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&overlay.firstChild)closeModal();
  if(e.key==='Enter'&&e.target.matches('tr[data-order]'))openOrder(e.target.dataset.order);
  if(e.key==='Tab'&&overlay.firstChild){const els=[...overlay.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled])')];const first=els[0],last=els.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}
});
document.addEventListener('submit',async e=>{
  e.preventDefault();const form=e.target;
  if(form.id==='permissions-form'){const d=Object.fromEntries(new FormData(form));return saveUser(form.dataset.id,{role:(d.role||'管理员')==='管理员'?'admin':'member',factories:selectedFactories(form)});}
  if(form.id==='password-form')return submitPassword(form);
  if(form.id==='feedback-form'||form.id==='reply-form')return submitFeedback(form);
  if(form.id==='order-form')return submitOrder(form);
  const data=Object.fromEntries(new FormData(form));
  if(form.id==='login-form'){const b=form.querySelector('button[type=submit]');b.disabled=true;try{await api('/api/login',{method:'POST',body:JSON.stringify(data)});await load();}catch(e){$('#login-error').textContent=e.message;}finally{b.disabled=false;}}
  if(form.id==='update-form'){const b=form.querySelector('button[type=submit]');b.disabled=true;busy=true;try{const o=await api('/api/orders/'+form.dataset.id,{method:'PATCH',body:JSON.stringify(data)});state.orders=state.orders.map(x=>x.id===o.id?o:x);renderView();openOrder(o.id);toast('订单处理结果已保存');}catch(e){$('#update-error').textContent=e.message;b.disabled=false;}finally{busy=false;}}
  if(form.id==='user-form'){const b=overlay.querySelector('[form=user-form]');b.disabled=true;data.role=data.role==='管理员'?'admin':'member';data.factories=selectedFactories(form);if(!data.factories.length){$('#user-error').textContent='请至少选择一个厂区';b.disabled=false;return;}busy=true;try{await api('/api/users',{method:'POST',body:JSON.stringify(data)});busy=false;closeModal();renderUsers();toast('成员账号已创建');}catch(e){$('#user-error').textContent=e.message;b.disabled=false;}finally{busy=false;}}
});
// Keep multiple open browsers in sync without disrupting active forms.
setInterval(async()=>{if(document.hidden||overlay.firstChild||!state.me||state.view==='users')return;try{const orders=await api('/api/orders');if(JSON.stringify(orders)!==JSON.stringify(state.orders)){state.orders=orders;renderView();}}catch{}},30000);
function changePassword(id){
  const u=state.users.find(x=>x.id===id);if(!u)return;
  openModal(`<div class="modal-header"><div><h2 id="modal-title">更改密码</h2><p>${esc(u.name)} · ${esc(u.username)}</p></div><button class="icon-btn" data-action="close" aria-label="关闭">${icon('close')}</button></div><form id="password-form" data-id="${u.id}" class="modal-body"><div class="help-box">保存后，该用户所有已登录会话将失效，需要使用新密码重新登录。${u.id===state.me.user.id?(state.me.demo?'当前演示环境仍会自动登录演示管理员。':'您正在修改自己的密码，保存后将返回登录页。'):''}</div><div class="form-grid">${field('新密码（至少 8 位）','password',{type:'password',required:true,full:true})}${field('确认新密码','confirmation',{type:'password',required:true,full:true})}</div><p class="error" id="password-error" role="alert"></p></form><div class="modal-footer"><button class="btn" data-action="close">取消</button><button class="btn primary" type="submit" form="password-form">保存新密码</button></div>`,true);
  overlay.querySelectorAll('input[type=password]').forEach(el=>{el.minLength=8;el.maxLength=256;el.autocomplete='new-password';});
}
async function submitPassword(form){
  if(busy)return;const d=Object.fromEntries(new FormData(form));
  if(d.password!==d.confirmation){$('#password-error').textContent='两次输入的密码不一致';return;}
  busy=true;const button=overlay.querySelector('button[type=submit]');button.disabled=true;
  try {const result=await api(`/api/users/${form.dataset.id}/password`,{method:'PATCH',body:JSON.stringify(d)});busy=false;closeModal();if(result.signedOut){state.me=null;state.users=[];state.orders=[];renderLogin();}toast(result.signedOut?'密码已更新，请使用新密码登录':'密码已更新，该用户需重新登录');}
  catch(e){if($('#password-error'))$('#password-error').textContent=e.message;button.disabled=false;}finally{busy=false;}
}
let feedbackFilter='全部';
function feedbackItems(){return scopedOrders().flatMap(o=>(o.feedback||[]).map(f=>({...f,order:o}))).sort((a,b)=>b.created.localeCompare(a.created));}
function renderFeedback(){
  const all=feedbackItems(), items=all.filter(f=>feedbackFilter==='全部'||f.status===feedbackFilter);
  const mine=scopedOrders().filter(o=>o.status==='已完成'&&o.owner===state.me.user.id);
  $('#main').innerHTML=heading('交付反馈','收集下单人的真实体验，让每一次交付成为下一次改进的起点。',false)+`<div class="heading"><p class="subtext">质量问题、改进建议和使用体验，均可关联已完成订单反馈。</p><button class="btn primary" data-action="feedback" ${mine.length?'':'disabled'}>${icon('plus')}填写反馈</button></div><section class="panel"><div class="panel-title"><h2>反馈记录 <small>共 ${all.length} 条</small></h2></div><div class="table-tools"><div class="tabs">${['全部','待处理','处理中','已处理'].map(s=>`<button class="tab ${feedbackFilter===s?'active':''}" data-feedback-filter="${s}">${s} <small>${s==='全部'?all.length:all.filter(f=>f.status===s).length}</small></button>`).join('')}</div></div><div class="feedback-list">${items.length?items.map(f=>`<article class="feedback-card"><div class="info-row"><div><span class="factory-pill">${esc(f.order.factory)}</span> <strong>${esc(f.category)}</strong> <span class="sample-note">评价：${esc(f.rating)}</span></div><span class="badge" data-status="${f.status}">${esc(f.status)}</span></div><p class="feedback-content">${esc(f.content)}</p><div class="feedback-meta">${esc(f.authorName)} · ${displayTime(f.created)} · ${esc(f.order.product)} / ${esc(f.order.number)}</div>${f.reply?`<div class="feedback-reply"><strong>处理回复</strong><p class="feedback-content">${esc(f.reply)}</p><small>${esc(f.responder)} · ${displayTime(f.updated)}</small></div>`:''}<div class="feedback-actions"><button class="btn text small" data-order="${f.order.id}">查看订单</button>${state.me.user.role==='admin'?`<button class="btn small" data-reply-feedback="${f.id}">${f.reply?'更新处理':'回复并处理'}</button>`:''}</div></article>`).join(''):`<div class="empty">${icon('feedback')}<p>${all.length?'当前状态下暂无反馈':'暂无交付反馈'}</p><p class="subtext">${mine.length?'选择一份您已完成的订单，分享质量情况或改进建议。':'您的订单完成后，即可在此提交反馈。'}</p></div>`}</div></section>`;
  document.querySelectorAll('[data-feedback-filter]').forEach(b=>b.addEventListener('click',()=>{feedbackFilter=b.dataset.feedbackFilter;renderFeedback();}));
}
function newFeedback(orderId){
  const orders=scopedOrders().filter(o=>o.status==='已完成'&&o.owner===state.me.user.id);
  if(!orders.length){toast('暂无您下单且已完成的订单');return;}
  openModal(`<div class="modal-header"><div><h2 id="modal-title">填写交付反馈</h2><p>反馈将关联订单，下单人身份由系统自动记录。</p></div><button class="icon-btn" data-action="close" aria-label="关闭">${icon('close')}</button></div><form id="feedback-form" class="modal-body"><div class="form-grid"><label class="field full"><span>已完成订单 <span class="req">*</span></span><select name="orderId" required>${orders.map(o=>`<option value="${o.id}" ${o.id===orderId?'selected':''}>${esc(o.product)} · ${esc(o.number)} · ${esc(o.factory)}</option>`).join('')}</select></label>${field('反馈类型','category',{choices:['质量问题','改进建议','使用体验','其他反馈']})}${field('交付评价','rating',{choices:['满意','一般','不满意']})}${field('反馈内容','content',{type:'textarea',full:true,placeholder:'请描述具体问题、使用效果或建议，例如尺寸偏差、表面质量、材料表现，以及希望如何改进。'})}</div><p class="subtext">最多 2000 字。管理员的回复与处理进度会显示在反馈记录中。</p><p class="error" id="feedback-error" role="alert"></p></form><div class="modal-footer"><button class="btn" data-action="close">取消</button><button class="btn primary" type="submit" form="feedback-form">提交反馈</button></div>`,true);
  overlay.querySelector('[name=content]').required=true;
}
function replyFeedback(id){
  const f=feedbackItems().find(f=>f.id===id);if(!f)return;
  openModal(`<div class="modal-header"><h2 id="modal-title">处理交付反馈</h2><button class="icon-btn" data-action="close" aria-label="关闭">${icon('close')}</button></div><form id="reply-form" data-id="${id}" class="modal-body"><div class="help-box"><strong>${esc(f.category)} · ${esc(f.order.product)}</strong><p class="feedback-content">${esc(f.content)}</p></div><div class="form-grid">${field('处理状态','status',{choices:['待处理','处理中','已处理'],value:f.status})}${field('处理回复','reply',{type:'textarea',full:true,value:f.reply,placeholder:'请说明处理措施、改进计划或最终结果。'})}</div><p class="error" id="feedback-error" role="alert"></p></form><div class="modal-footer"><button class="btn" data-action="close">取消</button><button class="btn primary" type="submit" form="reply-form">保存处理结果</button></div>`,true);
  overlay.querySelector('[name=reply]').required=true;
}
async function submitFeedback(form){
  if(busy)return;const d=Object.fromEntries(new FormData(form)), isNew=form.id==='feedback-form';
  if(!(isNew?d.content:d.reply).trim()){$('#feedback-error').textContent='请填写具体内容。';return;}
  busy=true;const button=overlay.querySelector('button[type=submit]');button.disabled=true;
  try {const o=await api(isNew?`/api/orders/${d.orderId}/feedback`:`/api/feedback/${form.dataset.id}`,{method:isNew?'POST':'PATCH',body:JSON.stringify(d)});state.orders=state.orders.map(x=>x.id===o.id?o:x);busy=false;closeModal();state.view='feedback';feedbackFilter='全部';renderShell();toast(isNew?'反馈已提交，感谢您的建议':'反馈处理结果已保存');}
  catch(e){if($('#feedback-error'))$('#feedback-error').textContent=e.message;button.disabled=false;}finally{busy=false;}
}
load();
