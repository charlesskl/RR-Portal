'use client';

import { ChangeEvent, DragEvent, FormEvent, useCallback, useEffect, useRef, useState } from 'react';

type Page = 'home' | 'import' | 'history' | 'plans' | 'users' | 'workshops' | 'login';
type PlanSite = '兴信'|'湖南'|'华登'|'待分配';
type ImportedInspection = {id:number;site?:string;scheduleSource?:string;scheduleCreatedBatchId?:number|null;inspectionDate?:string;inspectionLocation:string;inspectionParty:string;thirdPartyOrganization:string;thirdPartyInspectionLocation:string;customer:string;contractNumber:string;customerPo:string;itemNumber:string;productName:string;quantity?:number;cartons?:number;packingQuantity?:number;packagingSpec:string;internalResult:string;thirdPartyResult:string;holdRejectReason:string;productionWorkshop:string;productionSupervisor:string;responsibleLineLeader:string;problemSource:string;handlingResult:string;testScrap:string;note:string;workflowStatus:string;importedAt:string};
type InspectionForm = Omit<ImportedInspection,'id'|'quantity'|'cartons'|'packingQuantity'|'workflowStatus'|'importedAt'> & {site:''|'兴信'|'湖南'|'华登';quantity:string;cartons:string;packingQuantity:string};
type SessionUser = {username:string;displayName:string;role:string;dataScope?:string};
type PublicResult = {planId:string;site:string;inspectionDate?:string;customer:string;contractNumber:string;customerPo:string;itemNumber:string;productName:string;internalResult:string;thirdPartyResult:string;holdRejectReason:string;workflowStatus:string};
type InspectionAlertItem={id:number;inspectionRecordId:number;site:string;type:string;summary:string;createdAt:string};
type ApprovalItem={id:number;inspectionRecordId:number;site:string;previousInternalResult:string;previousThirdPartyResult:string;requestedInternalResult:string;requestedThirdPartyResult:string;requestedBy:string;requestedAt:string};
type UserAccount = {id:number;username:string;displayName:string;department:string;role:string;dataScope:string;isActive:boolean;createdAt:string};
type ZuruPreviewRow = {businessKey:string;customer:string;country:string;poNumber:string;customerPo:string;itemNumber:string;productName:string;quantity?:number;cartons?:number;plannedShipDate?:string;plannedInspectionDate?:string;thirdPartyInspectionDate?:string;inspectionLocation?:string;inspectionResult:string;sheet:string;row:number;issues?:string[]};
type ZuruPreviewItem = {row:ZuruPreviewRow;kind:'新增'|'变更'|'无变化'|'待判断'|'已有结果跳过'|'规则跳过';targetSite:string;changes?:string[]};
type ImportPreview = {id:number;fileName:string;parsedCount:number;newCount:number;changedCount:number;unchangedCount:number;completedSkippedCount:number;invalidSkippedCount:number;pendingReviewCount:number;productSheets:number;auxiliarySheetsSkipped:number;importTips:string[];items:ZuruPreviewItem[]};
type ImportedPlanSummary = {kind:'新增'|'变更';planId:string;site:string;customer:string;contractNumber:string;customerPo:string;itemNumber:string;productName:string;inspectionDate?:string;sheet:string;row:number};
type ImportLog = {id:number;uploadedAt:string;confirmedAt?:string;source:string;fileName:string;uploadedBy:string;newCount:number;changedCount:number;actualNewCount:number;actualChangedCount:number;importRange:string;unchangedCount:number;completedSkippedCount:number;invalidSkippedCount:number;pendingReviewCount:number;status:string};

const fieldChanged=(item:ZuruPreviewItem,name:string)=>item.kind==='变更'&&(item.changes??[]).includes(name);
const canSelectPreviewItem=(item:ZuruPreviewItem)=>['新增','变更','待判断'].includes(item.kind)&&
  !(item.row.issues??[]).some(issue=>issue.includes('匹配不唯一')||issue.includes('重复安排')||issue.includes('无法核验字体颜色'));
function ImportPreviewRow({item,selected,onToggle}:{item:ZuruPreviewItem;selected:boolean;onToggle:()=>void}){
  const detail=item.kind==='变更'?(item.changes??[]):(item.row.issues??[]);
  const cell=(name:string,value:React.ReactNode)=><td className={fieldChanged(item,name)?'changed-cell':''} title={typeof value==='string'?value:undefined}>{value}</td>;
  return <tr className={item.kind==='待判断'?'pending-row':item.kind==='变更'?'changed-row':''}>
    <td><input aria-label={`选择${item.row.sheet}第${item.row.row}行`} type="checkbox" disabled={!canSelectPreviewItem(item)} checked={selected} onChange={onToggle}/></td>
    <td><em className={item.kind==='待判断'?'preview-pending':item.kind==='变更'?'preview-change':'preview-new'}>{item.kind}</em></td>
    <td>{item.row.sheet} / {item.row.row}</td>{cell('PO号',item.row.poNumber||'—')}{cell('客户PO',item.row.customerPo||'—')}{cell('ITEM#',item.row.itemNumber||'—')}
    {cell('产品名称',item.row.productName||<strong className="missing">未填写</strong>)}{cell('客户名称',item.row.customer||'—')}
    {cell('计划验货期',item.row.plannedInspectionDate?.slice(0,10)||'—')}{cell('验货地点',item.row.inspectionLocation||'—')}{cell('目标厂区',item.targetSite||'待分配')}{cell('数量',item.row.quantity??'—')}
    <td>{detail.length?<span className="change-tags">{detail.map(value=><em key={value}>{value}</em>)}</span>:'—'}</td>
  </tr>;
}

const apiBase=process.env.NEXT_PUBLIC_QC_API_URL ?? (process.env.NODE_ENV==='production'?'':'http://127.0.0.1:5188');
const accessToken=()=>typeof window==='undefined'?'':localStorage.getItem('qc_access_token')??sessionStorage.getItem('qc_access_token')??'';
const authHeader=()=>({Authorization:`Bearer ${accessToken()}`});
const clearLogin=()=>{localStorage.removeItem('qc_access_token');sessionStorage.removeItem('qc_access_token')};

const groups = [
  { title: '排期导入', icon: '⇧', items: [['import', '导入排期'], ['history', '导入记录']] },
  { title: '验货管理', icon: '✓', items: [['plans', '验货计划']] },
  { title: '系统设置', icon: '⚙', items: [['users', '用户管理'], ['workshops', '字段映射']] },
] as const;

const titles: Record<Page, string> = { home:'首页', import:'导入排期', history:'导入记录', plans:'验货计划', users:'用户管理', workshops:'字段映射', login:'登录' };
const tag = (value: string) => `tag ${value === '待复检' ? 'purple' : value === '日期变更' ? 'amber' : value === '已完成' ? 'green' : 'blue'}`;

export default function Home() {
  const [authenticated, setAuthenticated] = useState(false);
  const [sessionUser,setSessionUser] = useState<SessionUser|null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [page, setPage] = useState<Page>('home');
  const [selectedImportBatchId,setSelectedImportBatchId]=useState<number|null>(null);
  const [query, setQuery] = useState('');
  useEffect(() => {
    const link=new URLSearchParams(window.location.search);
    setQuery(link.get('q')?.trim()??'');
    const token=accessToken();if(!token){setCheckingSession(false);return}

    void fetch(`${apiBase}/api/auth/me`,{headers:authHeader()}).then(async response=>{if(response.ok){const user=await response.json() as SessionUser;setSessionUser(user);setAuthenticated(true);if(user.role==='排期员')setPage('import');else if(link.get('view')==='plans')setPage('plans')}else clearLogin()}).catch(()=>clearLogin()).finally(()=>setCheckingSession(false));
  }, []);
  if (checkingSession) return <main className="login-loading">正在进入QC验货管理系统…</main>;
  if (!authenticated) return <PublicResults onLogin={()=>setPage('login')} onBack={()=>setPage('home')} showLogin={page==='login'} onSuccess={user => {setSessionUser(user);setAuthenticated(true);setPage(user.role==='排期员'?'import':'home')}} />;
  const isQc=['管理员','Admin','QC主管','QC文员'].includes(sessionUser?.role??'');
  const isScheduler=sessionUser?.role==='排期员';
  if(!isQc&&!isScheduler)return <PublicResults onLogin={()=>{clearLogin();setSessionUser(null);setAuthenticated(false);setPage('login')}} onBack={()=>setPage('home')} showLogin={false} onSuccess={user=>{setSessionUser(user);setAuthenticated(true)}}/>;
  return <main className="shell">
    <aside className="side">
      <button className="brand" onClick={() => setPage(isQc?'home':'import')}><span>QC</span><div><b>QC验货管理</b><small>排期 · 验货 · 结果</small></div></button>
      {isQc&&<button className={`home ${page === 'home' ? 'on' : ''}`} onClick={() => setPage('home')}>⌂　首页</button>}
      <nav>{groups.map(group => ({...group,items:group.items.filter(item=>item[0]==='import'||item[0]==='history'?isScheduler||sessionUser?.role==='管理员'||sessionUser?.role==='Admin':item[0]==='users'?sessionUser?.role==='管理员'||sessionUser?.role==='Admin':isQc)})).filter(group=>group.items.length).map(group => <section key={group.title}><h3><i>{group.icon}</i>{group.title}</h3>{group.items.map(item => <button className={page === item[0] ? 'on' : ''} onClick={() => {if(item[0]==='plans')setSelectedImportBatchId(null);setPage(item[0])}} key={item[0]}><i />{item[1]}</button>)}</section>)}</nav>
      <div className="profile"><span>{sessionUser?.displayName?.slice(0,1)||'用'}</span><div><b>{sessionUser?.displayName||'当前用户'}</b><small>{sessionUser?.username||'—'} · {sessionUser?.role||'—'}</small></div></div>
    </aside>
    <section className="work">
      <header><div><h1>{titles[page]}</h1><small>QC验货管理系统</small></div><div className="top">{isQc&&<label>⌕ <input value={query} onChange={event=>setQuery(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){setSelectedImportBatchId(null);setPage('plans')}}} placeholder="搜索订单、客户或货号" /></label>}<span>{sessionUser?.displayName?.slice(0,1)||'用'}</span><button className="logout" onClick={() => { clearLogin(); setSessionUser(null);setAuthenticated(false);setPage('home') }}>退出</button></div></header>
      <div className="content">
        {page === 'home' && isQc && <Dashboard go={setPage} />}
        {page === 'import' && (isScheduler||sessionUser?.role==='管理员'||sessionUser?.role==='Admin') && <Import />}
        {page === 'history' && (isScheduler||sessionUser?.role==='管理员'||sessionUser?.role==='Admin') && <History onViewBatch={isQc?batchId=>{setSelectedImportBatchId(batchId);setPage('plans')}:undefined} />}
        {page === 'plans' && isQc && <Plans query={query} setQuery={setQuery} sessionUser={sessionUser} batchId={selectedImportBatchId} onBatchChange={setSelectedImportBatchId} />}
        {page === 'users' && (sessionUser?.role==='管理员'||sessionUser?.role==='Admin') && <Users />}
        {page === 'workshops' && isQc && <Workshops />}
      </div>
    </section>
  </main>;
}

function PublicResults({onLogin,showLogin,onBack,onSuccess}:{onLogin:()=>void;showLogin:boolean;onBack:()=>void;onSuccess:(user:SessionUser)=>void}){
  const [query,setQuery]=useState('');
  useEffect(()=>{setQuery(new URLSearchParams(window.location.search).get('q')?.trim()??'')},[]);
  if(showLogin)return <><button className="public-back" onClick={onBack}>← 返回验货计划</button><Login onSuccess={onSuccess}/></>;
  return <main className="public-page"><div className="public-wrap">
    <header className="public-head"><div><h1>QC 验货计划</h1><p>无需登录，可查看验货计划和结果</p></div><button onClick={onLogin}>QC / 排期人员登录</button></header>
    <Plans readOnly query={query} setQuery={setQuery} sessionUser={null}/>
  </div></main>;
}

function Login({onSuccess}:{onSuccess:(user:SessionUser)=>void}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [rememberMe,setRememberMe]=useState(true);
  useEffect(()=>{const saved=localStorage.getItem('qc_remembered_username');if(saved)setUsername(saved)},[]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {

      const response = await fetch(`${apiBase}/api/auth/login`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username, password, rememberMe}),
      });
      const data = await response.json().catch(()=>null) as {accessToken?:string;error?:string;user?:SessionUser}|null;
      if (!response.ok || !data?.accessToken) throw new Error(data?.error ?? (response.status===401?'账号或密码不正确':`登录服务异常（${response.status}），请重新启动QC系统`));
      clearLogin();
      if(rememberMe){localStorage.setItem('qc_access_token',data.accessToken);localStorage.setItem('qc_remembered_username',username.trim())}
      else{sessionStorage.setItem('qc_access_token',data.accessToken);localStorage.removeItem('qc_remembered_username')}
      onSuccess(data.user??{username:username.trim(),displayName:username.trim(),role:''});
    } catch (reason) {
      setError(reason instanceof TypeError ? '无法连接QC后台服务，请重新启动QC系统' : reason instanceof Error ? reason.message : '无法连接系统服务');
    } finally {
      setSubmitting(false);
    }
  }
  return <main className="login-page"><section className="login-intro"><div className="login-brand"><span>QC</span><b>QC验货管理系统</b></div><div><small>QUALITY CONTROL</small><h1>从业务排期到验货结果，<br/>集中在一个系统完成。</h1><p>排期导入、验货计划与结果登记集中管理。</p></div><footer>QC与排期人员专用工作入口</footer></section><section className="login-panel"><form onSubmit={submit}><span className="login-mark">QC</span><h2>欢迎登录</h2><p>请使用公司分配的QC系统账号</p><label>账号<input autoFocus autoComplete="username" value={username} onChange={event=>setUsername(event.target.value)} placeholder="请输入账号" required /></label><label>密码<input type="password" autoComplete="current-password" value={password} onChange={event=>setPassword(event.target.value)} placeholder="请输入密码" required /></label><label className="remember-login"><input type="checkbox" checked={rememberMe} onChange={event=>setRememberMe(event.target.checked)}/><span>记住账号并保持登录</span></label>{error&&<div className="login-error">{error}</div>}<button className="login-submit" disabled={submitting}>{submitting?'正在登录…':'登录系统'}</button><small className="login-help">忘记密码请联系系统管理员</small></form></section></main>;
}

function Dashboard({go}:{go:(p:Page)=>void}) {
  const [overview,setOverview]=useState<{totals:Record<string,number>;statusCounts:Record<string,number>;alerts:Record<string,number>}|null>(null);
  const [error,setError]=useState('');
  useEffect(()=>{const base=apiBase;
    void fetch(`${base}/api/inspection-overview`,{headers:authHeader()}).then(async response=>{if(!response.ok)throw new Error('首页数据加载失败');setOverview(await response.json())}).catch(()=>setError('首页数据加载失败，请稍后刷新'));},[]);
  return <><div className="welcome"><div><h2>QC 工作概览</h2><p>当前验货计划与待处理事项。</p></div><button className="primary" onClick={()=>go('plans')}>查看验货计划</button></div>
    {error&&<div className="import-message error">{error}</div>}
    <div className="metrics">{[['待验货',overview?.statusCounts?.['待验货']??0,'blue'],['待复检',overview?.statusCounts?.['待复检']??0,'violet'],['验货日期变更',overview?.alerts?.['验货期变更']??0,'indigo'],['信息变更',overview?.alerts?.['订单信息变更']??0,'cyan']].map(([label,count,color])=><button className={String(color)} key={label} onClick={()=>go('plans')}><small>{label}</small><b>{overview?count:'…'}</b><i>↗</i></button>)}</div>
  </>;
}

function Import(){
  const [preview,setPreview]=useState<ImportPreview|null>(null);const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const [selectedKeys,setSelectedKeys]=useState<string[]>([]);const [source,setSource]=useState('ZURU');const [dragging,setDragging]=useState(false);const [completed,setCompleted]=useState(false);const [importedPlans,setImportedPlans]=useState<ImportedPlanSummary[]>([]);
  const auth=()=>({Authorization:`Bearer ${accessToken()}`});
  async function choose(file:File){const extension=file.name.split('.').pop()?.toLowerCase();if(!extension||!['xlsx','xls','xlsm'].includes(extension)){setMessage('请选择 .xlsx、.xls 或 .xlsm 排期文件');return}if(file.size>30*1024*1024){setMessage('文件不能超过30MB');return}setCompleted(false);setImportedPlans([]);setBusy(true);setMessage('正在解析工作表并识别跳过记录…');setPreview(null);setSelectedKeys([]);try{const body=new FormData();body.append('file',file);const response=await fetch(`${apiBase}/api/schedule-imports/preview?source=${encodeURIComponent(source)}`,{method:'POST',headers:auth(),body});const raw=await response.text();const result=raw?JSON.parse(raw) as ImportPreview&{error?:string}:null;if(!response.ok)throw new Error(result?.error??(response.status===404?'排期导入服务尚未更新，请重新启动QC系统':'排期解析失败，请查看后台日志'));if(!result)throw new Error('排期服务未返回识别结果');setSelectedKeys(result.items.filter(item=>item.kind==='新增'||item.kind==='变更').filter(canSelectPreviewItem).map(item=>item.row.businessKey));setPreview(result);setMessage('解析完成，请检查新增、变更和待人工判断记录。')}catch(reason){setMessage(reason instanceof SyntaxError?'排期服务返回异常，请重新启动QC系统':reason instanceof Error?reason.message:'解析失败')}finally{setBusy(false)}}
  async function confirm(){if(!preview)return;setBusy(true);setMessage('正在写入排期…');try{const response=await fetch(`${apiBase}/api/schedule-imports/${preview.id}/confirm`,{method:'POST',headers:{...auth(),'Content-Type':'application/json'},body:JSON.stringify({selectedKeys})});const raw=await response.text();const result=raw?JSON.parse(raw) as {error?:string;inserted:number;updated:number;pendingImported:number;importedPlans:ImportedPlanSummary[]}:null;if(!response.ok)throw new Error(result?.error??'导入确认失败，请查看后台日志');if(!result)throw new Error('排期服务未返回导入结果');setMessage(`导入完成：写入 ${result.inserted} 条，更新 ${result.updated} 条，待判断中人工保留 ${result.pendingImported} 条。`);setPreview(null);setImportedPlans(result.importedPlans??[]);setCompleted(true)}catch(reason){setMessage(reason instanceof SyntaxError?'排期服务返回异常，请重新启动QC系统':reason instanceof Error?reason.message:'导入失败')}finally{setBusy(false)}}
  function dropFile(event:DragEvent<HTMLLabelElement>){event.preventDefault();setDragging(false);if(busy)return;const file=event.dataTransfer.files?.[0];if(file)void choose(file)}
  const toggleSelected=(key:string)=>setSelectedKeys(current=>current.includes(key)?current.filter(value=>value!==key):[...current,key]);
  const selectable=preview?.items.filter(canSelectPreviewItem)??[];
  const pendingSelectable=selectable.filter(item=>item.kind==='待判断');
  const selectPending=()=>setSelectedKeys(current=>[...new Set([...current,...pendingSelectable.map(item=>item.row.businessKey)])]);
  const clearPending=()=>setSelectedKeys(current=>current.filter(key=>!pendingSelectable.some(item=>item.row.businessKey===key)));
  const toggleAll=()=>setSelectedKeys(current=>selectable.every(item=>current.includes(item.row.businessKey))?[]:selectable.map(item=>item.row.businessKey));
  const sources=['ZURU','TOMY Indonesia','TIGERHEAD','ZANZOON','Toy Monster','JAZ/JWC','Sky Castle','CEPIA','Masterkidz','通用'];
  return <div className="narrow"><div className="heading"><h2>导入验货计划</h2><p>按客户模板解析，仅导入今天至未来 3 周的验货计划，先预览确认，再写入系统。</p></div><div className="card import"><div className="steps"><b>1 <small>选择来源</small></b><i/><b>2 <small>上传文件</small></b><i/><span className={preview?'active':''}>3 <small>预览确认</small></span><i/><span className={completed?'active':''}>4 <small>完成导入</small></span></div><h3>客户来源</h3><div className="sources">{sources.map(x=><button className={source===x?'selected':''} onClick={()=>{setSource(x);setPreview(null);setSelectedKeys([]);setCompleted(false);setMessage('');setImportedPlans([])}} key={x}><span>{x.slice(0,2)}</span><b>{x}</b><small>{x==='ZURU'?'每周验货总表':x==='Sky Castle'?'未来三周验货安排':x==='通用'?'总排期规则':'客户排期规则'}</small></button>)}</div><h3>上传最新版文件</h3><label className={`drop ${busy?'disabled':''} ${dragging?'dragging':''}`} onDragEnter={event=>{event.preventDefault();if(!busy)setDragging(true)}} onDragOver={event=>{event.preventDefault();event.dataTransfer.dropEffect='copy'}} onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setDragging(false)}} onDrop={dropFile}><span>⇧</span><b>{busy?'正在处理…':dragging?'松开鼠标即可上传':'拖放Excel到这里，或点击选择文件'}</b><small>支持 .xlsx / .xls / .xlsm，单个文件不超过30MB</small><strong>选择Excel文件</strong><input type="file" disabled={busy} accept=".xlsx,.xls,.xlsm" onChange={event=>{const file=event.target.files?.[0];if(file)void choose(file);event.target.value=''}}/></label>{message&&<div className={`import-message ${message.includes('失败')||message.includes('无法')||message.includes('请选择')||message.includes('不能')?'error':''}`}>{message}</div>}{preview&&<section className="preview"><div className="preview-head"><div><h3>{preview.fileName}</h3><small>识别 {preview.productSheets} 个有效Sheet，跳过 {preview.auxiliarySheetsSkipped} 个非目标Sheet；待判断记录默认不勾选，可人工选择</small></div><button className="primary" disabled={busy||selectedKeys.length===0} onClick={()=>void confirm()}>确认导入 {selectedKeys.length} 条</button></div><div className="preview-counts">{[['新增',preview.newCount],['变更',preview.changedCount],['待人工判断',preview.pendingReviewCount],['无变化',preview.unchangedCount],['已有结果/规则跳过',preview.completedSkippedCount],['无法识别',preview.invalidSkippedCount]].map(([name,count])=><span key={name}><small>{name}</small><b>{count}</b></span>)}</div><div className="preview-selection"><label><input type="checkbox" checked={selectable.length>0&&selectable.every(item=>selectedKeys.includes(item.row.businessKey))} onChange={toggleAll}/> 全选可导入记录</label><button type="button" onClick={selectPending} disabled={pendingSelectable.length===0}>一键勾选可选待判断</button><button type="button" onClick={clearPending} disabled={pendingSelectable.length===0}>取消待判断勾选</button><span>已选 {selectedKeys.length} 条</span></div><div className="preview-table"><table><thead><tr>{['选择','类型','Sheet/行','PO号','客户PO','ITEM#','产品名称','客户','计划验货期','验货地点','目标厂区','数量','判断依据/变化字段'].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{preview.items.filter(canSelectPreviewItem).map(item=><ImportPreviewRow key={item.row.businessKey} item={item} selected={selectedKeys.includes(item.row.businessKey)} onToggle={()=>toggleSelected(item.row.businessKey)}/>)}</tbody></table>{preview.items.filter(canSelectPreviewItem).length===0&&<p className="preview-empty">本次没有可预览导入的记录</p>}</div></section>}{completed&&<ImportedPlansResult plans={importedPlans}/ >}{preview&&<Tip>{preview.importTips?.length?preview.importTips.join(' '):'本次文件没有需要特别说明的跳过情况。'}</Tip>}</div></div>
}

function ImportedPlansResult({plans}:{plans:ImportedPlanSummary[]}){
  const sites=['兴信','湖南','华登','待分配'];
  return <section className="import-result"><h3>本次导入的计划与厂区</h3><p>新增计划已写入对应厂区；“待分配”表示尚未确定厂区，请先核对。</p><div className="import-result-sites">{sites.map(site=><span key={site}>{site}：{plans.filter(plan=>plan.site===site).length} 条</span>)}</div>{plans.length>0&&<div className="import-result-table"><table><thead><tr>{['类型','厂区','验货日期','PO号','客户PO','货号','产品名称','来源行'].map(head=><th key={head}>{head}</th>)}</tr></thead><tbody>{plans.map(plan=><tr key={plan.planId}><td><em className={plan.kind==='新增'?'preview-new':'preview-change'}>{plan.kind}</em></td><td><strong className={plan.site==='待分配'?'missing':''}>{plan.site}</strong></td><td>{plan.inspectionDate||'—'}</td><td>{plan.contractNumber||'—'}</td><td>{plan.customerPo||'—'}</td><td>{plan.itemNumber||'—'}</td><td>{plan.productName||'—'}</td><td>{plan.sheet} / {plan.row}</td></tr>)}</tbody></table></div>}</section>;
}

function History({onViewBatch}:{onViewBatch?:(id:number)=>void}){
  const [logs,setLogs]=useState<ImportLog[]>([]);const [error,setError]=useState('');const [loading,setLoading]=useState(true);
  useEffect(()=>{
    void fetch(`${apiBase}/api/schedule-imports`,{headers:authHeader()}).then(async response=>{if(!response.ok)throw new Error();setLogs(await response.json())}).catch(()=>setError('导入记录加载失败，请稍后重试')).finally(()=>setLoading(false));},[]);
  const completed=logs.filter(log=>log.status==='已完成');
  return <List title="导入记录" sub="仅显示已完成的排期导入批次和实际写入范围。">
    {loading&&<p>正在加载导入记录…</p>}{error&&<p className="import-message error">{error}</p>}
    {!loading&&!error&&<><div className="summary">{[['已完成批次',completed.length],['实际新增',completed.reduce((sum,x)=>sum+x.actualNewCount,0)],['实际变更',completed.reduce((sum,x)=>sum+x.actualChangedCount,0)]].map(x=><span key={x[0]}><small>{x[0]}</small><b>{x[1]}</b></span>)}</div>
    <div className="tablewrap"><table className="simple import-history"><thead><tr>{['完成时间','来源','文件名称','上传人','实际新增','实际变更','导入范围','操作'].map(head=><th key={head}>{head}</th>)}</tr></thead><tbody>{completed.map(log=><tr key={log.id}><td>{new Date(log.confirmedAt??log.uploadedAt).toLocaleString('zh-CN')}</td><td>{log.source}</td><td title={log.fileName}>{log.fileName}</td><td>{log.uploadedBy}</td><td>{log.actualNewCount}</td><td>{log.actualChangedCount}</td><td className="import-range">{log.importRange||'历史批次暂无范围信息'}</td><td>{onViewBatch&&log.actualNewCount>0?<button className="link" onClick={()=>onViewBatch(log.id)}>查看新增计划</button>:'—'}</td></tr>)}</tbody></table></div>{completed.length===0&&<p className="preview-empty">暂无已完成的导入记录。</p>}</>}
  </List>;
}

function Plans({query,setQuery,sessionUser,readOnly=false,batchId=null,onBatchChange}:{query:string;setQuery:(x:string)=>void;sessionUser:SessionUser|null;readOnly?:boolean;batchId?:number|null;onBatchChange?:(id:number|null)=>void}){
  const [site,setSite] = useState<PlanSite>(()=>sessionUser?.dataScope?.includes('华登')&&!sessionUser?.dataScope?.includes('兴信')?'华登':'兴信');
  useEffect(()=>{const requested=new URLSearchParams(window.location.search).get('site');if(requested==='兴信'||requested==='湖南'||requested==='华登'||requested==='待分配')setSite(requested)},[]);
  const [huadengTable,setHuadengTable] = useState<'普通验货'|'JAZ专用'>('普通验货');
  const [legacyFile,setLegacyFile] = useState('');
  const [importStatus,setImportStatus] = useState('');
  const [importing,setImporting] = useState(false);
  const [exporting,setExporting] = useState(false);
  const [importedRows,setImportedRows] = useState<ImportedInspection[]>([]);
  const [loading,setLoading] = useState(true);
  const [loadError,setLoadError] = useState('');
  const [siteTotals,setSiteTotals] = useState<Partial<Record<PlanSite,number>>>({});
  const [overviewLoaded,setOverviewLoaded] = useState(false);
  const [months,setMonths] = useState<string[]>([]);
  const [selectedMonth,setSelectedMonth] = useState('');
  const [dateFrom,setDateFrom] = useState('');
  const [dateTo,setDateTo] = useState('');
  const [currentPage,setCurrentPage] = useState(1);
  const [totalPages,setTotalPages] = useState(1);
  const [filteredTotal,setFilteredTotal] = useState(0);
  const [latestScheduleBatchId,setLatestScheduleBatchId]=useState<number|null>(null);
  const [selectedStatus,setSelectedStatus] = useState('');
  const [selectedCustomer,setSelectedCustomer] = useState('');
  const [customers,setCustomers] = useState<string[]>([]);
  const loadRequestId=useRef(0);
  const [overview,setOverview]=useState<{alerts:Record<string,number>;pendingApprovals:number}>({alerts:{},pendingApprovals:0});
  const [alertItems,setAlertItems]=useState<InspectionAlertItem[]>([]);
  const [approvalItems,setApprovalItems]=useState<ApprovalItem[]>([]);
  const [workPanel,setWorkPanel]=useState<'alerts'|'approvals'|null>(null);
  const [workPanelTitle,setWorkPanelTitle]=useState('');
  const [inspectionDialog,setInspectionDialog] = useState<'new'|'edit'|'result'|null>(null);
  const [editingRecord,setEditingRecord] = useState<ImportedInspection|null>(null);
  const [saveMessage,setSaveMessage] = useState('');
  const [saving,setSaving] = useState(false);
  const [selectedPlanIds,setSelectedPlanIds] = useState<number[]>([]);
  const [bulkDeleting,setBulkDeleting] = useState(false);
  const [inlineDrafts,setInlineDrafts] = useState<Record<number,InspectionForm>>({});
  const [inlineOriginals,setInlineOriginals] = useState<Record<number,InspectionForm>>({});
  const [savingInline,setSavingInline] = useState(false);
  const editableSite:'兴信'|'湖南'|'华登'=site==='待分配'?'兴信':site;
  const emptyInspection=(targetSite:'兴信'|'湖南'|'华登'='兴信'):InspectionForm=>({site:targetSite,inspectionDate:'',inspectionLocation:'',inspectionParty:'',thirdPartyOrganization:'',thirdPartyInspectionLocation:'',customer:'',contractNumber:'',customerPo:'',itemNumber:'',productName:'',quantity:'',cartons:'',packingQuantity:'',packagingSpec:'',internalResult:'',thirdPartyResult:'',holdRejectReason:'',productionWorkshop:'',productionSupervisor:'',responsibleLineLeader:'',problemSource:'',handlingResult:'',testScrap:'',note:''});
  const formFromRecord=(record:ImportedInspection):InspectionForm=>({site:record.site==='兴信'||record.site==='湖南'||record.site==='华登'?record.site:'',inspectionDate:record.inspectionDate?.slice(0,10)??'',inspectionLocation:record.inspectionLocation,inspectionParty:record.inspectionParty,thirdPartyOrganization:record.thirdPartyOrganization,thirdPartyInspectionLocation:record.thirdPartyInspectionLocation,customer:record.customer,contractNumber:record.contractNumber,customerPo:record.customerPo,itemNumber:record.itemNumber,productName:record.productName,quantity:record.quantity?.toString()??'',cartons:record.cartons?.toString()??'',packingQuantity:record.packingQuantity?.toString()??'',packagingSpec:record.packagingSpec,internalResult:record.internalResult,thirdPartyResult:record.thirdPartyResult,holdRejectReason:record.holdRejectReason,productionWorkshop:record.productionWorkshop,productionSupervisor:record.productionSupervisor,responsibleLineLeader:record.responsibleLineLeader,problemSource:record.problemSource,handlingResult:record.handlingResult,testScrap:record.testScrap,note:record.note});
  const [inspectionForm,setInspectionForm] = useState<InspectionForm>(()=>emptyInspection('兴信'));
  const loadImported=useCallback(async (target:PlanSite,requestedMonth=selectedMonth,requestedPage=currentPage)=>{
    const requestId=++loadRequestId.current;
    setLoading(true);

    const params=new URLSearchParams({site:target,page:String(requestedPage)});if(target==='华登')params.set('template',huadengTable);if(requestedMonth)params.set('month',requestedMonth);if(dateFrom)params.set('from',dateFrom);if(dateTo)params.set('to',dateTo);if(query)params.set('q',query);if(selectedStatus)params.set('status',selectedStatus);if(selectedCustomer)params.set('customer',selectedCustomer);
    const response=await fetch(`${apiBase}${readOnly?'/api/public/plans':'/api/legacy-inspections'}?${params}`,readOnly?{}:{headers:authHeader()}).catch(()=>null);
    if(!response?.ok){if(requestId===loadRequestId.current){setImportedRows([]);setTotalPages(1);setFilteredTotal(0);setLoadError(response?.status===403?'当前账号无权查看该厂区':response?.status===404?'验货计划服务尚未更新，请重新启动QC系统':'验货计划加载失败，请检查QC后台服务');setLoading(false)}return;}
    const result=await response.json() as {total:number;month:string;months:string[];customers:string[];page:number;totalPages:number;latestScheduleBatchId?:number|null;items:ImportedInspection[]};
    if(requestId!==loadRequestId.current)return;
    setLoadError('');
    setLoading(false);
    if(target===site){setImportedRows(result.items);setSelectedPlanIds([]);setMonths(result.months);setCustomers(result.customers);setSelectedMonth(result.month);setCurrentPage(result.page);setTotalPages(result.totalPages);setFilteredTotal(result.total);setLatestScheduleBatchId(result.latestScheduleBatchId??null)}
  },[site,huadengTable,selectedMonth,dateFrom,dateTo,currentPage,query,selectedStatus,selectedCustomer,readOnly]);
  const loadOverview=useCallback(async()=>{

    const response=await fetch(`${apiBase}${readOnly?'/api/public/overview':'/api/inspection-overview?site='+encodeURIComponent(site)}`,readOnly?{}:{headers:authHeader()}).catch(()=>null);if(!response?.ok)return;
    const result=await response.json() as {totals:Record<string,number>;alerts:Record<string,number>;pendingApprovals:number};
    setSiteTotals(result.totals);setOverview({alerts:result.alerts??{},pendingApprovals:result.pendingApprovals??0});setOverviewLoaded(true);
  },[site,readOnly]);
  useEffect(()=>{setImportedRows([]);setTotalPages(1);setFilteredTotal(0)},[site]);
  useEffect(()=>{void loadImported(site)},[site,loadImported]);
  useEffect(()=>{void loadOverview()},[loadOverview]);
  useEffect(()=>{setCurrentPage(1)},[selectedMonth,dateFrom,dateTo,selectedStatus,selectedCustomer,query]);
  useEffect(()=>{if(!selectedMonth){setDateFrom('');setDateTo('');return}const [year,month]=selectedMonth.split('-').map(Number);setDateFrom(`${selectedMonth}-01`);setDateTo(`${selectedMonth}-${String(new Date(year,month,0).getDate()).padStart(2,'0')}`)},[selectedMonth]);
  async function importLegacy(file:File){
    setLegacyFile(`${site}：${file.name}`);setImportStatus('正在解析并导入历史验货记录…');setImporting(true);
    try{
      const body=new FormData();body.append('file',file);

      const params=new URLSearchParams({site});if(site==='华登')params.set('template',huadengTable);
      const response=await fetch(`${apiBase}/api/legacy-inspections/import?${params}`,{method:'POST',headers:{Authorization:`Bearer ${accessToken()}`},body});
      const result=await response.json() as {parsed?:number;inserted?:number;updated?:number;total?:number;error?:string};
      if(!response.ok)throw new Error(result.error??'导入失败');
      setImportStatus(`解析 ${result.parsed??0} 条，新增 ${result.inserted??0} 条，更新 ${result.updated??0} 条；当前共 ${result.total??0} 条。`);
      setCurrentPage(1);setSelectedMonth('');await loadImported(site,'',1);
    }catch(reason){setImportStatus(reason instanceof Error?reason.message:'导入失败，请检查文件');}finally{setImporting(false)}
  }
  async function exportInspections(){
    setExporting(true);
    try{

      const params=new URLSearchParams({site});if(site==='华登')params.set('template',huadengTable);if(selectedMonth)params.set('month',selectedMonth);if(dateFrom)params.set('from',dateFrom);if(dateTo)params.set('to',dateTo);if(query)params.set('q',query);if(selectedStatus)params.set('status',selectedStatus);if(selectedCustomer)params.set('customer',selectedCustomer);
      const response=await fetch(`${apiBase}/api/legacy-inspections/export?${params}`,{headers:{Authorization:`Bearer ${accessToken()}`}});
      if(!response.ok){const result=await response.json().catch(()=>({error:'导出失败'})) as {error?:string};throw new Error(result.error??'导出失败')}
      const blob=await response.blob();const link=document.createElement('a');link.href=URL.createObjectURL(blob);
      link.download=`${site}-${site==='华登'?huadengTable:'验货总结'}-${selectedMonth||'全部'}.xlsx`;document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(link.href);
    }catch(reason){window.alert(reason instanceof Error?reason.message:'导出失败')}finally{setExporting(false)}
  }
  function openInspectionDialog(mode:'new'|'edit'|'result',record?:ImportedInspection){
    const current=record??null;setEditingRecord(current);setSaveMessage('');setInspectionDialog(mode);
    setInspectionForm(current?{site:editableSite,inspectionDate:current.inspectionDate?.slice(0,10)??'',inspectionLocation:current.inspectionLocation,inspectionParty:current.inspectionParty,thirdPartyOrganization:current.thirdPartyOrganization,thirdPartyInspectionLocation:current.thirdPartyInspectionLocation,customer:current.customer,contractNumber:current.contractNumber,customerPo:current.customerPo,itemNumber:current.itemNumber,productName:current.productName,quantity:current.quantity?.toString()??'',cartons:current.cartons?.toString()??'',packingQuantity:current.packingQuantity?.toString()??'',packagingSpec:current.packagingSpec,internalResult:current.internalResult,thirdPartyResult:current.thirdPartyResult,holdRejectReason:current.holdRejectReason,productionWorkshop:current.productionWorkshop,productionSupervisor:current.productionSupervisor,responsibleLineLeader:current.responsibleLineLeader,problemSource:current.problemSource,handlingResult:current.handlingResult,testScrap:current.testScrap,note:current.note}:emptyInspection(editableSite));
  }
  async function saveInspection(event:FormEvent){
    event.preventDefault();setSaving(true);setSaveMessage('');
    try{

      const resultOnly=inspectionDialog==='result';
      const url=resultOnly?`${apiBase}/api/inspections/${editingRecord?.id}/result`:inspectionDialog==='edit'?`${apiBase}/api/inspections/${editingRecord?.id}`:`${apiBase}/api/inspections`;
      const body=resultOnly?{internalResult:inspectionForm.internalResult,thirdPartyResult:inspectionForm.thirdPartyResult,holdRejectReason:inspectionForm.holdRejectReason,note:inspectionForm.note}:{...inspectionForm,quantity:inspectionForm.quantity===''?null:Number(inspectionForm.quantity),cartons:inspectionForm.cartons===''?null:Number(inspectionForm.cartons),packingQuantity:inspectionForm.packingQuantity===''?null:Number(inspectionForm.packingQuantity)};
      const response=await fetch(url,{method:inspectionDialog==='new'?'POST':'PUT',headers:{Authorization:`Bearer ${accessToken()}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
      const responseText=await response.text();let result:{error?:string;pendingApproval?:boolean}={};
      if(responseText){try{result=JSON.parse(responseText) as {error?:string;pendingApproval?:boolean}}catch{result={error:responseText}}}
      if(!response.ok)throw new Error(result.error??(response.status===404?'保存接口尚未加载，请重启QC系统后再试':`保存失败（${response.status}）`));
      setInspectionDialog(null);setCurrentPage(1);await Promise.all([loadImported(site,selectedMonth,1),loadOverview()]);if(result.pendingApproval)window.alert('结果修改已提交，等待主管或管理员审批。');
    }catch(reason){setSaveMessage(reason instanceof Error?reason.message:'保存失败');}finally{setSaving(false)}
  }
  async function deleteInspection(record:ImportedInspection){
    const label=record.itemNumber||record.customerPo||record.contractNumber||`#${record.id}`;
    if(!window.confirm(`确定删除验货计划“${label}”吗？此操作无法撤销。`))return;

    const response=await fetch(`${apiBase}/api/inspections/${record.id}`,{method:'DELETE',headers:{Authorization:`Bearer ${accessToken()}`}});
    if(!response.ok){const text=await response.text();window.alert(text||`删除失败（${response.status}）`);return}
    await loadImported(site,selectedMonth,currentPage);
    await loadOverview();
  }
  async function deleteSelectedInspections(){
    if(selectedPlanIds.length===0)return;
    if(!window.confirm(`确定批量删除选中的 ${selectedPlanIds.length} 条验货计划吗？此操作无法撤销。`))return;
    setBulkDeleting(true);
    try{
      const response=await fetch(`${apiBase}/api/inspections/bulk-delete`,{method:'POST',headers:{Authorization:`Bearer ${accessToken()}`,'Content-Type':'application/json'},body:JSON.stringify({ids:selectedPlanIds})});
      const text=await response.text();let result:{error?:string;deleted?:number}={};if(text){try{result=JSON.parse(text) as {error?:string;deleted?:number}}catch{result={error:text}}}
      if(!response.ok)throw new Error(result.error??(response.status===403?'所选计划中有当前账号无权删除的记录':`批量删除失败（${response.status}）`));
      setSelectedPlanIds([]);await Promise.all([loadImported(site,selectedMonth,currentPage),loadOverview()]);window.alert(`已删除 ${result.deleted??0} 条验货计划。`);
    }catch(reason){window.alert(reason instanceof Error?reason.message:'批量删除失败')}finally{setBulkDeleting(false)}
  }
  const dirtyInlineIds=Object.keys(inlineDrafts).map(Number).filter(id=>JSON.stringify(inlineDrafts[id])!==JSON.stringify(inlineOriginals[id]));
  const hasInlineChanges=dirtyInlineIds.length>0;
  useEffect(()=>{const protect=(event:BeforeUnloadEvent)=>{if(!hasInlineChanges)return;event.preventDefault();event.returnValue=''};window.addEventListener('beforeunload',protect);return()=>window.removeEventListener('beforeunload',protect)},[hasInlineChanges]);
  useEffect(()=>{const protectNavigation=(event:MouseEvent)=>{if(!hasInlineChanges)return;const target=event.target as HTMLElement;if(!target.closest('.side button,.logout'))return;if(!window.confirm('当前有尚未保存的修改，确定放弃并离开吗？')){event.preventDefault();event.stopPropagation()}else{setInlineDrafts({});setInlineOriginals({})}};document.addEventListener('click',protectNavigation,true);return()=>document.removeEventListener('click',protectNavigation,true)},[hasInlineChanges]);
  function beginInlineEdit(record:ImportedInspection){
    if(readOnly||inlineDrafts[record.id])return;
    const form=formFromRecord(record);setInlineDrafts(current=>({...current,[record.id]:form}));setInlineOriginals(current=>({...current,[record.id]:form}));setSelectedPlanIds(current=>current.filter(id=>id!==record.id));
  }
  function updateInline(id:number,key:keyof InspectionForm,value:string){setInlineDrafts(current=>({...current,[id]:{...current[id],[key]:value}}))}
  function confirmDiscardInline(){if(hasInlineChanges&&!window.confirm('当前有尚未保存的修改，确定放弃吗？'))return false;setInlineDrafts({});setInlineOriginals({});return true}
  function discardInlineChanges(){void confirmDiscardInline()}
  async function saveInlineChanges(){
    const changedIds=Object.keys(inlineDrafts).map(Number).filter(id=>JSON.stringify(inlineDrafts[id])!==JSON.stringify(inlineOriginals[id]));
    if(changedIds.length===0){setInlineDrafts({});setInlineOriginals({});return}
    setSavingInline(true);
    try{
      const items=changedIds.map(id=>{const record=importedRows.find(row=>row.id===id)!;const draft=inlineDrafts[id];return{id,expectedImportedAt:record.importedAt,values:{...draft,quantity:draft.quantity===''?null:Number(draft.quantity),cartons:draft.cartons===''?null:Number(draft.cartons),packingQuantity:draft.packingQuantity===''?null:Number(draft.packingQuantity)}}});
      const response=await fetch(`${apiBase}/api/inspections/bulk-update`,{method:'POST',headers:{Authorization:`Bearer ${accessToken()}`,'Content-Type':'application/json'},body:JSON.stringify({items})});
      const text=await response.text();let result:{error?:string;updated?:number}={};if(text){try{result=JSON.parse(text) as {error?:string;updated?:number}}catch{result={error:text}}}
      if(!response.ok)throw new Error(result.error??(response.status===403?'所选修改超出当前账号权限':`保存失败（${response.status}）`));
      setInlineDrafts({});setInlineOriginals({});await Promise.all([loadImported(site,selectedMonth,currentPage),loadOverview()]);window.alert(`已保存 ${result.updated??changedIds.length} 条计划。`);
    }catch(reason){window.alert(reason instanceof Error?reason.message:'保存失败，修改内容已保留')}finally{setSavingInline(false)}
  }
  async function openAlerts(type:string){const response=await fetch(`${apiBase}/api/inspection-alerts?site=${encodeURIComponent(site)}&type=${encodeURIComponent(type)}`,{headers:{Authorization:`Bearer ${accessToken()}`}});if(!response.ok)return;setAlertItems(await response.json() as InspectionAlertItem[]);setWorkPanelTitle(type);setWorkPanel('alerts')}
  async function resolveAlert(id:number){const response=await fetch(`${apiBase}/api/inspection-alerts/${id}/resolve`,{method:'POST',headers:{Authorization:`Bearer ${accessToken()}`}});if(response.ok){setAlertItems(items=>items.filter(item=>item.id!==id));await loadOverview()}}
  async function openApprovals(){const response=await fetch(`${apiBase}/api/inspection-approvals?site=${encodeURIComponent(site)}`,{headers:{Authorization:`Bearer ${accessToken()}`}});if(!response.ok)return;setApprovalItems(await response.json() as ApprovalItem[]);setWorkPanelTitle('结果修改审批');setWorkPanel('approvals')}
  async function reviewApproval(id:number,approved:boolean){const comment=approved?'':window.prompt('请输入驳回原因（可留空）')??'';const response=await fetch(`${apiBase}/api/inspection-approvals/${id}/review`,{method:'POST',headers:{Authorization:`Bearer ${accessToken()}`,'Content-Type':'application/json'},body:JSON.stringify({approved,comment})});if(response.ok){setApprovalItems(items=>items.filter(item=>item.id!==id));await Promise.all([loadOverview(),loadImported(site,selectedMonth,currentPage)])}else window.alert(response.status===403?'只有主管和管理员可以审批':'审批失败')}
  const canDeleteRecord=(record:ImportedInspection)=>!record.internalResult&&!record.thirdPartyResult||sessionUser?.role==='管理员'||sessionUser?.role==='Admin';
  const operationCell=(record:ImportedInspection)=><span className="record-actions">{canDeleteRecord(record)&&<button className="delete-link" disabled={hasInlineChanges} onClick={event=>{event.stopPropagation();void deleteInspection(record)}}>删除</button>}</span>;
  const statusCell=(record:ImportedInspection)=><span className={tag(record.workflowStatus||'待验货')}>{record.workflowStatus||'待验货'}</span>;
  const resultCell=(record:ImportedInspection,text:string)=>readOnly?<span>{text||'—'}</span>:site==='待分配'?<span className="result-unavailable">分配后填写</span>:<button className="result-cell" disabled={hasInlineChanges} onClick={event=>{event.stopPropagation();openInspectionDialog('result',record)}}>{text||'填写结果'}</button>;
  const importActions = <>{site!=='待分配'&&<div className="plan-actions"><label className={`site-import ${importing||hasInlineChanges?'disabled':''}`}>{importing?'正在导入…':`＋${site==='华登'&&huadengTable==='JAZ专用'?'华登JAZ':site}验货表`}<input type="file" disabled={importing||hasInlineChanges} accept=".xlsx,.xls,.xlsm" onChange={event=>{const file=event.target.files?.[0];if(file)void importLegacy(file);event.target.value=''}}/></label><button className="primary" disabled={hasInlineChanges} onClick={()=>openInspectionDialog('new')}>＋ 新建临时计划</button></div>}{inspectionDialog&&<InspectionDialogV2 mode={inspectionDialog} site={editableSite} huadengTable={huadengTable} form={inspectionForm} setForm={setInspectionForm} saving={saving} message={saveMessage} onClose={()=>setInspectionDialog(null)} onSave={saveInspection}/>} {workPanel&&<InspectionWorkPanel mode={workPanel} title={workPanelTitle} alerts={alertItems} approvals={approvalItems} canApprove={sessionUser?.role==='管理员'||sessionUser?.role==='QC主管'} onClose={()=>setWorkPanel(null)} onResolve={resolveAlert} onReview={reviewApproval}/>}</>;
  const hasImported=(siteTotals[site]??0)>0;
  const scope=sessionUser?.dataScope??'';
  const allowedSites=(['兴信','湖南','华登','待分配'] as PlanSite[]).filter(name=>readOnly||sessionUser?.role==='管理员'||sessionUser?.role==='Admin'||scope.includes('全部厂区')||name==='待分配'&&sessionUser?.role==='QC主管'||scope.includes(name));
  const allRecords=importedRows;
  const visibleRecords=site==='华登' ? allRecords.filter(record=>{
    const jaz=record.scheduleSource==='JAZ/JWC'||`${record.customer} ${record.inspectionParty}`.toUpperCase().includes('JAZ');
    return huadengTable==='JAZ专用'?jaz:!jaz;
  }):allRecords;
  const value=(content:string|number|undefined|null)=>content===undefined||content===null||content===''?'—':typeof content==='number'?content.toLocaleString():content;
  const totalCartons=(record:ImportedInspection)=>record.quantity!==undefined&&record.packingQuantity?Math.ceil(record.quantity/record.packingQuantity):record.cartons;
  const columns:{head:string;cell:(record:ImportedInspection,index:number)=>React.ReactNode;className?:string}[]=site==='湖南' ? [
    {head:'日期',cell:r=>value(r.inspectionDate?.slice(0,10)),className:'date'}, {head:'验货地址',cell:r=>value(r.inspectionLocation)}, {head:'客户名称',cell:r=>value(r.customer)},
    {head:'合同编号',cell:r=>value(r.contractNumber),className:'code'}, {head:'客户/PO',cell:r=>value(r.customerPo),className:'code'}, {head:'货号',cell:r=>value(r.itemNumber),className:'code strong'},
    {head:'产品名称',cell:r=>value(r.productName)}, {head:'数量',cell:r=>value(r.quantity)}, {head:'箱数',cell:r=>value(r.cartons)}, {head:'结果',cell:r=>resultCell(r,r.internalResult||r.thirdPartyResult)},
    {head:'HOLD/REJ原因',cell:r=>value(r.holdRejectReason)}, {head:'验货客QC',cell:r=>value(r.inspectionParty)}, {head:'责任主管',cell:r=>value(r.productionSupervisor)}, {head:'责任拉长',cell:r=>value(r.responsibleLineLeader)},
    {head:'问题源头',cell:r=>value(r.problemSource)}, {head:'处理结果',cell:r=>value(r.handlingResult)}, {head:'备注',cell:r=>value(r.note)}, {head:'状态',cell:statusCell}, {head:'操作',cell:operationCell},
  ] : site==='华登'&&huadengTable==='JAZ专用' ? [
    {head:'序号',cell:(_r,i)=>i+1}, {head:'现PO号',cell:r=>value(r.customerPo||r.contractNumber),className:'code'}, {head:'货号',cell:r=>value(r.itemNumber),className:'code strong'},
    {head:'名称',cell:r=>value(r.productName)}, {head:'数量',cell:r=>value(r.quantity)}, {head:'装箱数',cell:r=>value(r.packingQuantity)}, {head:'总箱数',cell:r=>value(totalCartons(r))},
    {head:'第三方验货时间',cell:r=>value(r.inspectionDate?.slice(0,10)),className:'date'}, {head:'包装',cell:r=>value(r.packagingSpec)}, {head:'备注',cell:r=>value(r.note)}, {head:'结果',cell:r=>resultCell(r,r.internalResult||r.thirdPartyResult)}, {head:'状态',cell:statusCell}, {head:'操作',cell:operationCell},
  ] : site==='华登' ? [
    {head:'日期',cell:r=>value(r.inspectionDate?.slice(0,10)),className:'date'}, {head:'验货客户',cell:r=>value(r.inspectionParty)}, {head:'客户名称',cell:r=>value(r.customer)},
    {head:'合同编号',cell:r=>value(r.contractNumber),className:'code'}, {head:'客户/PO',cell:r=>value(r.customerPo),className:'code'}, {head:'货号',cell:r=>value(r.itemNumber),className:'code strong'},
    {head:'产品名称',cell:r=>value(r.productName)}, {head:'数量',cell:r=>value(r.quantity)}, {head:'箱数',cell:r=>value(r.cartons)}, {head:'洋行结果',cell:r=>resultCell(r,r.internalResult)},
    {head:'验货地点',cell:r=>value(r.inspectionLocation)}, {head:'第三方结果',cell:r=>resultCell(r,r.thirdPartyResult)}, {head:'验货地点',cell:r=>value(r.thirdPartyInspectionLocation)},
    {head:'HOLD/REJ原因',cell:r=>value(r.holdRejectReason)}, {head:'生产车间',cell:r=>value(r.productionWorkshop)}, {head:'责任主管',cell:r=>value(r.productionSupervisor)},
    {head:'责任拉长',cell:r=>value(r.responsibleLineLeader)}, {head:'箱数',cell:r=>value(r.cartons)}, {head:'测试报废',cell:r=>value(r.testScrap)}, {head:'状态',cell:statusCell}, {head:'操作',cell:operationCell},
  ] : [
    {head:'验货日期',cell:r=>value(r.inspectionDate?.slice(0,10)),className:'date'}, {head:'验货地点',cell:r=>value(r.inspectionLocation)}, {head:'客户名称',cell:r=>value(r.customer)},
    {head:'验货方',cell:r=>value(r.inspectionParty||r.thirdPartyOrganization)}, {head:'合同编号',cell:r=>value(r.contractNumber),className:'code'}, {head:'客户PO',cell:r=>value(r.customerPo),className:'code'},
    {head:'货号',cell:r=>value(r.itemNumber),className:'code strong'}, {head:'产品名称',cell:r=>value(r.productName)}, {head:'数量',cell:r=>value(r.quantity)}, {head:'箱数',cell:r=>value(r.cartons)},
    {head:'生产车间',cell:r=>value(r.productionWorkshop)}, {head:'生产主管',cell:r=>value(r.productionSupervisor)}, {head:'洋行结果',cell:r=>resultCell(r,r.internalResult)},
    {head:'第三方结果',cell:r=>resultCell(r,r.thirdPartyResult)}, {head:'状态',cell:statusCell}, {head:'操作',cell:operationCell},
  ];
  const pendingColumns:{head:string;cell:(record:ImportedInspection,index:number)=>React.ReactNode;className?:string}[]=[
    {head:'分配厂区',cell:r=>value(r.site)}, {head:'验货日期',cell:r=>value(r.inspectionDate?.slice(0,10)),className:'date'}, {head:'验货地点',cell:r=>value(r.inspectionLocation)},
    {head:'客户名称',cell:r=>value(r.customer)}, {head:'验货方',cell:r=>value(r.inspectionParty||r.thirdPartyOrganization)}, {head:'合同编号',cell:r=>value(r.contractNumber),className:'code'},
    {head:'客户PO',cell:r=>value(r.customerPo),className:'code'}, {head:'货号',cell:r=>value(r.itemNumber),className:'code strong'}, {head:'产品名称',cell:r=>value(r.productName)},
    {head:'数量',cell:r=>value(r.quantity)}, {head:'箱数',cell:r=>value(r.cartons)}, {head:'装箱规格',cell:r=>value(r.packingQuantity)}, {head:'包装规格',cell:r=>value(r.packagingSpec)},
    {head:'生产车间',cell:r=>value(r.productionWorkshop)}, {head:'生产主管',cell:r=>value(r.productionSupervisor)}, {head:'责任拉长',cell:r=>value(r.responsibleLineLeader)},
    {head:'问题源头',cell:r=>value(r.problemSource)}, {head:'处理结果',cell:r=>value(r.handlingResult)}, {head:'第三方验货地点',cell:r=>value(r.thirdPartyInspectionLocation)},
    {head:'测试报废',cell:r=>value(r.testScrap)}, {head:'备注',cell:r=>value(r.note)}, {head:'洋行结果',cell:r=>resultCell(r,r.internalResult)},
    {head:'第三方结果',cell:r=>resultCell(r,r.thirdPartyResult)}, {head:'状态',cell:statusCell},
  ];
  const editableColumns=site==='待分配'?pendingColumns:columns;
  const shownColumns=editableColumns.filter(column=>column.head!=='操作');
  const inlineField=(head:string,index:number,record:ImportedInspection):keyof InspectionForm|undefined=>{
    if(head==='分配厂区')return'site';if(head==='日期'||head==='验货日期'||head==='第三方验货时间')return'inspectionDate';if(head==='验货地址')return'inspectionLocation';
    if(head==='验货地点')return site==='华登'&&index>10?'thirdPartyInspectionLocation':'inspectionLocation';if(head==='第三方验货地点')return'thirdPartyInspectionLocation';if(head==='客户名称')return'customer';if(head==='验货客户'||head==='验货客QC'||head==='验货方')return'inspectionParty';
    if(head==='合同编号')return'contractNumber';if(head==='客户/PO'||head==='客户PO'||head==='现PO号')return'customerPo';if(head==='货号')return'itemNumber';if(head==='产品名称'||head==='名称')return'productName';
    if(head==='数量')return'quantity';if(head==='箱数')return'cartons';if(head==='装箱数'||head==='装箱规格')return'packingQuantity';if(head==='包装'||head==='包装规格')return'packagingSpec';if(head==='生产车间')return'productionWorkshop';if(head==='生产主管'||head==='责任主管')return'productionSupervisor';
    if(head==='责任拉长')return'responsibleLineLeader';if(head==='问题源头')return'problemSource';if(head==='处理结果')return'handlingResult';if(head==='测试报废')return'testScrap';if(head==='备注'&&!record.internalResult&&!record.thirdPartyResult)return'note';return undefined;
  };
  const inlineCell=(record:ImportedInspection,column:typeof columns[number],columnIndex:number,rowIndex:number)=>{
    const draft=inlineDrafts[record.id];const field=inlineField(column.head,columnIndex,record);if(!draft||!field)return column.cell(record,rowIndex);
    const changed=draft[field]!==inlineOriginals[record.id]?.[field];const className=changed?'inline-field changed':'inline-field';
    if(field==='site')return <><input className={className} list="qc-site-options" placeholder="填写厂区" value={draft.site} onChange={event=>updateInline(record.id,field,event.target.value)} onBlur={event=>updateInline(record.id,field,event.target.value.trim())}/><datalist id="qc-site-options"><option value="兴信"/><option value="湖南"/><option value="华登"/></datalist></>;
    const numeric=field==='quantity'||field==='cartons'||field==='packingQuantity';return <input className={className} type={field==='inspectionDate'?'date':numeric?'number':'text'} min={numeric?'0':undefined} step={numeric?'any':undefined} value={String(draft[field]??'')} onChange={event=>updateInline(record.id,field,event.target.value)}/>;
  };
  const deletableVisibleRecords=visibleRecords.filter(canDeleteRecord);
  const allVisibleSelected=deletableVisibleRecords.length>0&&deletableVisibleRecords.every(record=>selectedPlanIds.includes(record.id));
  const toggleAllVisiblePlans=()=>setSelectedPlanIds(allVisibleSelected?[]:deletableVisibleRecords.map(record=>record.id));
  const togglePlan=(id:number)=>setSelectedPlanIds(current=>current.includes(id)?current.filter(value=>value!==id):[...current,id]);
  if(batchId&&!readOnly)return <BatchNewPlans batchId={batchId} onBack={()=>onBatchChange?.(null)}/>;
  return <List title="验货计划" sub="点击任意行即可直接编辑；修改内容统一保存。" action={readOnly?null:importActions}>
    {loadError&&<div className="import-message error">{loadError}</div>}
    <div className="site-tabs">{allowedSites.map(name=><button disabled={savingInline} key={name} className={site===name?'on':''} onClick={()=>{if(!confirmDiscardInline())return;setSite(name);setHuadengTable('普通验货');setImportedRows([]);setSelectedPlanIds([]);setMonths([]);setSelectedMonth('');setSelectedStatus('');setSelectedCustomer('');setCurrentPage(1);setLegacyFile('');setImportStatus('')}}>{name}<small>{siteTotals[name]??(overviewLoaded?0:'…')}</small></button>)}</div>
    {site==='华登'&&<div className="template-tabs"><span>华登验货表</span>{(['普通验货','JAZ专用'] as const).map(name=><button disabled={hasInlineChanges||savingInline} key={name} className={huadengTable===name?'on':''} onClick={()=>{setCurrentPage(1);setHuadengTable(name);setSelectedPlanIds([])}}>{name}</button>)}</div>}
    {!readOnly&&legacyFile&&<div className={`file-selected ${importStatus.includes('失败')||importStatus.includes('没有')?'error':''}`}><b>{legacyFile}</b><span>{importStatus}</span>{!importing&&<button onClick={()=>{setLegacyFile('');setImportStatus('')}}>×</button>}</div>}
    {!readOnly&&<div className="change"><b>!</b><span>待处理：</span><button onClick={()=>void openAlerts('验货期变更')}>验货期变更 {overview.alerts['验货期变更']??0} 单</button><button onClick={()=>void openAlerts('订单信息变更')}>订单信息变更 {overview.alerts['订单信息变更']??0} 单</button><button onClick={()=>void openAlerts('待复检')}>待复检 {overview.alerts['待复检']??0} 单</button><button onClick={()=>void openApprovals()}>待审批 {overview.pendingApprovals} 单</button>{latestScheduleBatchId&&<button className="recent-import-link" disabled={hasInlineChanges} onClick={()=>onBatchChange?.(latestScheduleBatchId)}>查看最近导入的全部新增计划</button>}<em>{site==='华登'?`华登 · ${huadengTable}`:`${site}厂区模板`}</em></div>}
    <Toolbar query={query} setQuery={setQuery} months={months} selectedMonth={selectedMonth} setSelectedMonth={setSelectedMonth} dateFrom={dateFrom} setDateFrom={setDateFrom} dateTo={dateTo} setDateTo={setDateTo} status={selectedStatus} setStatus={setSelectedStatus} customers={customers} customer={selectedCustomer} setCustomer={setSelectedCustomer} onExport={exportInspections} exporting={exporting} readOnly={readOnly} locked={hasInlineChanges||savingInline}/>
    {!readOnly&&<div className="plan-batch-actions"><div className="save-actions"><span>待保存 {dirtyInlineIds.length} 条</span>{Object.keys(inlineDrafts).length>0&&<button onClick={discardInlineChanges} disabled={savingInline}>放弃修改</button>}<button className="save-all" onClick={()=>void saveInlineChanges()} disabled={dirtyInlineIds.length===0||savingInline}>{savingInline?'保存中…':`保存修改（${dirtyInlineIds.length}）`}</button></div><div className="delete-actions"><label><input type="checkbox" disabled={hasInlineChanges} checked={allVisibleSelected} onChange={toggleAllVisiblePlans}/> 全选本页</label><span>已选 {selectedPlanIds.length} 条</span><button disabled={selectedPlanIds.length===0||bulkDeleting||hasInlineChanges} onClick={()=>void deleteSelectedInspections()}>{bulkDeleting?'删除中…':`批量删除（${selectedPlanIds.length}）`}</button></div></div>}
    <div className={`wide plan-table plan-table-${site==='华登'&&huadengTable==='JAZ专用'?'jaz':site}`}><table><thead><tr>{!readOnly&&<th className="select-column">选择</th>}{shownColumns.map((column,index)=><th key={`${column.head}-${index}`}>{column.head}</th>)}</tr></thead><tbody>{visibleRecords.map((record,rowIndex)=><tr onClick={()=>beginInlineEdit(record)} key={record.id} className={`${!readOnly&&latestScheduleBatchId&&record.scheduleCreatedBatchId===latestScheduleBatchId?'new-schedule-row ':''}${inlineDrafts[record.id]?'inline-edit-row':''}`} >{!readOnly&&<td className="select-column" onClick={event=>event.stopPropagation()}><input aria-label={`选择计划${record.itemNumber||record.id}`} type="checkbox" disabled={hasInlineChanges||!canDeleteRecord(record)||Boolean(inlineDrafts[record.id])} checked={selectedPlanIds.includes(record.id)} onChange={()=>togglePlan(record.id)}/></td>}{shownColumns.map((column,columnIndex)=><td className={column.className} key={`${column.head}-${columnIndex}`}>{inlineCell(record,column,columnIndex,rowIndex)}</td>)}</tr>)}</tbody></table></div>
    {loading?<p>正在加载验货计划…</p>:!loadError&&visibleRecords.length===0&&<p>当前条件下暂无验货计划。</p>}
    <div className="pages"><span>{selectedMonth?`${selectedMonth.replace('-','年')}月 · `:''}当前页 {visibleRecords.length} 条{hasImported?`，第 ${(currentPage-1)*100+1}–${Math.min(currentPage*100,filteredTotal)} 条`:''}</span><div><button disabled={currentPage<=1||hasInlineChanges} onClick={()=>setCurrentPage(page=>Math.max(1,page-1))}>‹</button><span className="page-current">{currentPage} / {totalPages}</span><button disabled={currentPage>=totalPages||hasInlineChanges} onClick={()=>setCurrentPage(page=>Math.min(totalPages,page+1))}>›</button></div></div>
  </List>}
function BatchNewPlans({batchId,onBack}:{batchId:number;onBack:()=>void}){
  const [page,setPage]=useState(1);
  const [result,setResult]=useState<{fileName:string;source:string;total:number;totalPages:number;sites:{site:string;count:number}[];items:ImportedInspection[]}|null>(null);
  const [error,setError]=useState('');
  useEffect(()=>{setPage(1)},[batchId]);
  useEffect(()=>{let active=true;setResult(null);setError('');void fetch(`${apiBase}/api/schedule-imports/${batchId}/new-plans?page=${page}`,{headers:authHeader()})
    .then(async response=>{if(!response.ok)throw new Error(response.status===403?'当前账号无权查看本批计划':'本批次新增计划加载失败');return response.json()})
    .then(data=>{if(active)setResult(data)}).catch(reason=>{if(active)setError(reason instanceof Error?reason.message:'加载失败')});return()=>{active=false}},[batchId,page]);
  return <List title="验货计划 · 本批新增" sub="按导入批次查看实际新增的计划，跨厂区、跨月份显示。" action={<button className="link" onClick={onBack}>返回全部验货计划</button>}>
    {error&&<p className="import-message error">{error}</p>}{!result&&!error&&<p className="preview-empty">正在加载本批新增计划…</p>}
    {result&&<><div className="batch-plan-summary"><b>{result.fileName}</b><span>实际新增 {result.total} 条</span>{result.sites.map(item=><span key={item.site}>{item.site} {item.count} 条</span>)}</div>
      <div className="wide batch-plan-table"><table><thead><tr>{['验货日期','厂区','客户名称','合同编号','客户PO','货号','产品名称','数量','验货地点','状态'].map(head=><th key={head}>{head}</th>)}</tr></thead><tbody>{result.items.map(record=><tr className="new-schedule-row" key={record.id}><td>{record.inspectionDate?.slice(0,10)||'—'}</td><td>{record.site||'待分配'}</td><td>{record.customer||'—'}</td><td>{record.contractNumber||'—'}</td><td>{record.customerPo||'—'}</td><td>{record.itemNumber||'—'}</td><td>{record.productName||'—'}</td><td>{record.quantity??'—'}</td><td>{record.inspectionLocation||'—'}</td><td>{record.workflowStatus||'待验货'}</td></tr>)}</tbody></table></div>
      {result.items.length===0&&<p className="preview-empty">本批次暂无可查看的新增计划。</p>}
      <div className="pages"><span>当前页 {result.items.length} 条，共 {result.total} 条</span><div><button disabled={page<=1} onClick={()=>setPage(value=>value-1)}>‹</button><span className="page-current">{page} / {result.totalPages}</span><button disabled={page>=result.totalPages} onClick={()=>setPage(value=>value+1)}>›</button></div></div></>}
  </List>;
}

function InspectionWorkPanel({mode,title,alerts,approvals,canApprove,onClose,onResolve,onReview}:{mode:'alerts'|'approvals';title:string;alerts:InspectionAlertItem[];approvals:ApprovalItem[];canApprove:boolean;onClose:()=>void;onResolve:(id:number)=>void;onReview:(id:number,approved:boolean)=>void}){
  return <div className="modal-backdrop"><section className="inspection-dialog work-panel"><div className="dialog-head"><div><h3>{title}</h3><small>{mode==='alerts'?'确认后将从待处理提醒中移除':'结果修改通过后才会正式生效'}</small></div><button onClick={onClose}>×</button></div><div className="work-items">{mode==='alerts'?(alerts.length?alerts.map(item=><article key={item.id}><div><b>{item.summary}</b><small>{new Date(item.createdAt).toLocaleString('zh-CN')}</small></div><button onClick={()=>onResolve(item.id)}>确认处理</button></article>):<p>当前没有待处理记录</p>):(approvals.length?approvals.map(item=><article key={item.id}><div><b>{item.requestedBy} 提交的结果修改</b><small>洋行：{item.previousInternalResult||'空'} → {item.requestedInternalResult||'空'}　第三方：{item.previousThirdPartyResult||'空'} → {item.requestedThirdPartyResult||'空'}</small></div>{canApprove?<span><button onClick={()=>onReview(item.id,false)}>驳回</button><button className="approve" onClick={()=>onReview(item.id,true)}>通过</button></span>:<em>等待主管审批</em>}</article>):<p>当前没有待审批记录</p>)}</div></section></div>
}

type InspectionDialogProps={mode:'new'|'edit'|'result';site:'兴信'|'湖南'|'华登';huadengTable:'普通验货'|'JAZ专用';form:InspectionForm;setForm:(value:InspectionForm)=>void;saving:boolean;message:string;onClose:()=>void;onSave:(event:FormEvent)=>void};
function InspectionDialogV2({mode,site,huadengTable,form,setForm,saving,message,onClose,onSave}:InspectionDialogProps){
  const field=(key:keyof InspectionForm,value:string)=>setForm({...form,[key]:value});
  const resultOnly=mode==='result';
  const total=form.quantity&&form.packingQuantity?Math.ceil(Number(form.quantity)/Number(form.packingQuantity)):null;
  return <div className="modal-backdrop"><form className="inspection-dialog" onSubmit={onSave}>
    <div className="dialog-head"><div><h3>{resultOnly?'填写验货结果':mode==='new'?'新建临时计划':'编辑验货计划'}</h3><small>{form.site}厂区 · {form.customer||form.itemNumber||'未命名计划'}</small></div><button type="button" onClick={onClose}>×</button></div>
    {resultOnly?<div className="inspection-form">
      <label>内部/洋行结果<select value={form.internalResult} onChange={e=>field('internalResult',e.target.value)}><option value="">未填写</option>{['PASS','HOLD','REJ','待复检','不用验'].map(value=><option key={value}>{value}</option>)}</select></label>
      <label>第三方结果<select value={form.thirdPartyResult} onChange={e=>field('thirdPartyResult',e.target.value)}><option value="">未填写</option>{['PASS','HOLD','REJ','待复检','不用验'].map(value=><option key={value}>{value}</option>)}</select></label>
      <label className="full">HOLD/REJ原因<textarea value={form.holdRejectReason} onChange={e=>field('holdRejectReason',e.target.value)} placeholder="可选填写"/></label>
      <label className="full">备注<textarea value={form.note} onChange={e=>field('note',e.target.value)}/></label>
    </div>:<div className="inspection-form">
      <label>分配厂区<select value={form.site} onChange={e=>field('site',e.target.value)}>{(['兴信','湖南','华登'] as const).map(value=><option key={value}>{value}</option>)}</select></label>
      <label>验货日期<input type="date" required value={form.inspectionDate} onChange={e=>field('inspectionDate',e.target.value)}/></label>
      <label>{form.site==='华登'?'洋行方验货地点':'验货地点'}<input value={form.inspectionLocation} onChange={e=>field('inspectionLocation',e.target.value)}/></label>
      <label>客户名称<input value={form.customer} onChange={e=>field('customer',e.target.value)}/></label>
      <label>验货客户/验货方<input value={form.inspectionParty} onChange={e=>field('inspectionParty',e.target.value)}/></label>
      <label>合同编号<input value={form.contractNumber} onChange={e=>field('contractNumber',e.target.value)}/></label>
      <label>客户PO<input value={form.customerPo} onChange={e=>field('customerPo',e.target.value)}/></label>
      <label>货号<input value={form.itemNumber} onChange={e=>field('itemNumber',e.target.value)}/></label>
      <label>产品名称<input value={form.productName} onChange={e=>field('productName',e.target.value)}/></label>
      <label>数量<input type="number" min="0" step="any" value={form.quantity} onChange={e=>field('quantity',e.target.value)}/></label>
      <label>原表箱数<input type="number" min="0" step="any" value={form.cartons} onChange={e=>field('cartons',e.target.value)}/></label>
      <label>生产车间<input value={form.productionWorkshop} onChange={e=>field('productionWorkshop',e.target.value)}/></label>
      <label>生产主管（选填）<input value={form.productionSupervisor} onChange={e=>field('productionSupervisor',e.target.value)} placeholder="留空将按生产车间自动代入"/></label>
      {(form.site==='湖南'||form.site==='华登')&&<><label>责任拉长<input value={form.responsibleLineLeader} onChange={e=>field('responsibleLineLeader',e.target.value)}/></label><label>问题源头<input value={form.problemSource} onChange={e=>field('problemSource',e.target.value)}/></label><label>处理结果<input value={form.handlingResult} onChange={e=>field('handlingResult',e.target.value)}/></label></>}
      {form.site==='华登'&&<><label>第三方验货地点<input value={form.thirdPartyInspectionLocation} onChange={e=>field('thirdPartyInspectionLocation',e.target.value)}/></label><label>测试报废<input value={form.testScrap} onChange={e=>field('testScrap',e.target.value)}/></label></>}
      {form.site==='华登'&&huadengTable==='JAZ专用'&&<><label>包装规格<input value={form.packagingSpec} onChange={e=>field('packagingSpec',e.target.value)}/></label><label>装箱规格<input type="number" min="0" step="any" value={form.packingQuantity} onChange={e=>field('packingQuantity',e.target.value)}/></label><label>总箱数<input readOnly value={total??''} placeholder="数量 ÷ 装箱规格，尾箱向上取整"/></label></>}
      <label className="full">备注<textarea value={form.note} onChange={e=>field('note',e.target.value)}/></label>
    </div>}
    {message&&<div className="dialog-error">{message}</div>}<div className="dialog-foot"><button type="button" onClick={onClose}>取消</button><button className="primary" disabled={saving}>{saving?'正在保存…':'保存'}</button></div>
  </form></div>
}

function InspectionDialog({mode,site,huadengTable,form,setForm,saving,message,onClose,onSave}:InspectionDialogProps){
  const field=(key:keyof InspectionForm,value:string)=>setForm({...form,[key]:value});
  const resultOnly=mode==='result';
  return <div className="modal-backdrop"><form className="inspection-dialog" onSubmit={onSave}><div className="dialog-head"><div><h3>{resultOnly?'填写验货结果':mode==='new'?'新建临时计划':'编辑验货计划'}</h3><small>{site}厂区 · {form.customer||form.itemNumber||'未命名计划'}</small></div><button type="button" onClick={onClose}>×</button></div>{resultOnly?<div className="inspection-form"><label>内部/洋行结果<select value={form.internalResult} onChange={e=>field('internalResult',e.target.value)}><option value="">未填写</option>{['PASS','HOLD','REJ','待复检'].map(value=><option key={value}>{value}</option>)}</select></label><label>第三方结果<select value={form.thirdPartyResult} onChange={e=>field('thirdPartyResult',e.target.value)}><option value="">未填写</option>{['PASS','HOLD','REJ','待复检'].map(value=><option key={value}>{value}</option>)}</select></label><label className="full">HOLD/REJ原因<textarea value={form.holdRejectReason} onChange={e=>field('holdRejectReason',e.target.value)} placeholder="结果为HOLD或REJ时填写原因"/></label><label className="full">备注<textarea value={form.note} onChange={e=>field('note',e.target.value)}/></label></div>:<div className="inspection-form"><label>验货日期<input type="date" required value={form.inspectionDate} onChange={e=>field('inspectionDate',e.target.value)}/></label><label>验货地点<input value={form.inspectionLocation} onChange={e=>field('inspectionLocation',e.target.value)}/></label><label>客户名称<input value={form.customer} onChange={e=>field('customer',e.target.value)}/></label><label>验货客户/验货方<input value={form.inspectionParty} onChange={e=>field('inspectionParty',e.target.value)}/></label><label>合同编号<input value={form.contractNumber} onChange={e=>field('contractNumber',e.target.value)}/></label><label>客户PO<input value={form.customerPo} onChange={e=>field('customerPo',e.target.value)}/></label><label>货号<input value={form.itemNumber} onChange={e=>field('itemNumber',e.target.value)}/></label><label>产品名称<input value={form.productName} onChange={e=>field('productName',e.target.value)}/></label><label>数量<input type="number" min="0" step="any" value={form.quantity} onChange={e=>field('quantity',e.target.value)}/></label><label>箱数<input type="number" min="0" step="any" value={form.cartons} onChange={e=>field('cartons',e.target.value)}/></label><label>生产车间<input value={form.productionWorkshop} onChange={e=>field('productionWorkshop',e.target.value)}/></label><label>责任主管<input value={form.productionSupervisor} onChange={e=>field('productionSupervisor',e.target.value)}/></label><label>第三方机构/地点<input value={form.thirdPartyOrganization} onChange={e=>field('thirdPartyOrganization',e.target.value)}/></label><label className="full">备注<textarea value={form.note} onChange={e=>field('note',e.target.value)}/></label></div>}{message&&<div className="dialog-error">{message}</div>}<div className="dialog-foot"><button type="button" onClick={onClose}>取消</button><button className="primary" disabled={saving}>{saving?'正在保存…':'保存'}</button></div></form></div>
}

function Users(){
  const empty={username:'',displayName:'',department:'QC部',role:'QC文员',dataScope:'兴信、湖南',password:''};
  const [users,setUsers]=useState<UserAccount[]>([]);
  const [form,setForm]=useState(empty);
  const [editingId,setEditingId]=useState<number|null>(null);
  const [dialog,setDialog]=useState(false);
  const [resetUser,setResetUser]=useState<UserAccount|null>(null);
  const [newPassword,setNewPassword]=useState('');
  const [message,setMessage]=useState('');

  const auth=useCallback(()=>({Authorization:`Bearer ${accessToken()}`,'Content-Type':'application/json'}),[]);
  const load=useCallback(async()=>{const response=await fetch(`${apiBase}/api/users`,{headers:auth()});if(response.ok)setUsers(await response.json() as UserAccount[])},[auth]);
  useEffect(()=>{void load()},[load]);
  function openNew(){setEditingId(null);setForm(empty);setMessage('');setDialog(true)}
  function openEdit(user:UserAccount){setEditingId(user.id);setForm({username:user.username,displayName:user.displayName,department:user.department,role:user.role,dataScope:user.dataScope,password:''});setMessage('');setDialog(true)}
  async function save(event:FormEvent){event.preventDefault();setMessage('');const response=await fetch(editingId?`${apiBase}/api/users/${editingId}`:`${apiBase}/api/users`,{method:editingId?'PUT':'POST',headers:auth(),body:JSON.stringify(editingId?{displayName:form.displayName,department:form.department,role:form.role,dataScope:form.dataScope}:form)});if(!response.ok){const result=await response.json() as {error?:string};setMessage(result.error??'保存失败');return}setDialog(false);await load()}
  async function toggle(user:UserAccount){const response=await fetch(`${apiBase}/api/users/${user.id}/status`,{method:'POST',headers:auth(),body:JSON.stringify({isActive:!user.isActive})});if(!response.ok){const result=await response.json() as {error?:string};setMessage(result.error??'操作失败');return}await load()}
  async function resetPassword(event:FormEvent){event.preventDefault();if(!resetUser)return;const response=await fetch(`${apiBase}/api/users/${resetUser.id}/reset-password`,{method:'POST',headers:auth(),body:JSON.stringify({newPassword})});if(!response.ok){const result=await response.json() as {error?:string};setMessage(result.error??'重置失败');return}setResetUser(null);setNewPassword('');setMessage('密码已重置')}
  return <List title="用户管理" sub="管理账号、角色、厂区权限和启用状态。" action={<button className="primary" onClick={openNew}>＋ 新增用户</button>}><div className="role-note"><b>权限规则</b><span>QC按授权厂区管理计划与结果　·　排期员负责排期导入　·　其他人员免登录查询结果</span></div>{message&&!dialog&&<div className="user-message">{message}</div>}<div className="tablewrap"><table className="simple users-table"><thead><tr>{['姓名','账号','部门','角色','厂区/数据范围','状态','操作'].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{users.map(user=><tr key={user.id}><td><b>{user.displayName}</b></td><td className="code">{user.username}</td><td>{user.department}</td><td><span className="role-tag">{user.role}</span></td><td>{user.dataScope||'—'}</td><td><span className={user.isActive?'status-active':'status-off'}>{user.isActive?'已启用':'已停用'}</span></td><td className="user-actions"><button onClick={()=>openEdit(user)}>编辑</button><button onClick={()=>{setMessage('');setResetUser(user)}}>重置密码</button><button className={user.isActive?'danger':''} onClick={()=>void toggle(user)}>{user.isActive?'停用':'启用'}</button></td></tr>)}</tbody></table></div>{dialog&&<div className="modal-backdrop"><form className="user-dialog" onSubmit={save}><div className="dialog-head"><div><h3>{editingId?'编辑用户':'新增用户'}</h3><small>设置账号资料、角色和可访问的数据范围</small></div><button type="button" onClick={()=>setDialog(false)}>×</button></div><div className="form-grid"><label>姓名<input value={form.displayName} onChange={e=>setForm({...form,displayName:e.target.value})} required/></label><label>登录账号<input value={form.username} disabled={editingId!==null} onChange={e=>setForm({...form,username:e.target.value})} required/></label><label>部门<input value={form.department} onChange={e=>setForm({...form,department:e.target.value})} required/></label><label>角色<select value={form.role} onChange={e=>setForm({...form,role:e.target.value,dataScope:e.target.value==='排期员'?'排期导入与记录':e.target.value==='管理员'?'全部厂区及系统设置':form.dataScope==='排期导入与记录'?'兴信、湖南':form.dataScope})}>{['管理员','QC主管','QC文员','排期员'].map(role=><option key={role}>{role}</option>)}</select></label><label className="full">厂区/数据范围<select value={form.dataScope} onChange={e=>setForm({...form,dataScope:e.target.value})}>{(form.role==='排期员'?['排期导入与记录']:form.role==='管理员'?['全部厂区及系统设置']:['兴信、湖南','华登','全部厂区及系统设置']).map(scope=><option key={scope}>{scope}</option>)}</select></label>{!editingId&&<label className="full">初始密码<input type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} minLength={8} required placeholder="至少8位"/></label>}</div>{message&&<div className="dialog-error">{message}</div>}<div className="dialog-foot"><button type="button" onClick={()=>setDialog(false)}>取消</button><button className="primary">保存用户</button></div></form></div>}{resetUser&&<div className="modal-backdrop"><form className="user-dialog small" onSubmit={resetPassword}><div className="dialog-head"><div><h3>重置密码</h3><small>{resetUser.displayName}（{resetUser.username}）</small></div><button type="button" onClick={()=>setResetUser(null)}>×</button></div><label className="reset-field">新密码<input autoFocus type="password" value={newPassword} onChange={e=>setNewPassword(e.target.value)} minLength={8} required placeholder="至少8位"/></label>{message&&<div className="dialog-error">{message}</div>}<div className="dialog-foot"><button type="button" onClick={()=>setResetUser(null)}>取消</button><button className="primary">确认重置</button></div></form></div>}</List>}
function Workshops(){
  const [rows,setRows]=useState<{id:number;workshop:string;supervisor:string}[]>([]);
  const [editing,setEditing]=useState<number|null>(null);const [workshop,setWorkshop]=useState('');const [supervisor,setSupervisor]=useState('');const [message,setMessage]=useState('');
  const base=apiBase;
  const load=useCallback(async()=>{try{const response=await fetch(`${base}/api/workshop-mappings`,{headers:authHeader()});if(!response.ok)throw new Error();setRows(await response.json())}catch{setMessage('字段映射加载失败')}},[base]);
  useEffect(()=>{void load()},[load]);
  async function save(event:FormEvent){event.preventDefault();setMessage('');const response=await fetch(`${base}/api/workshop-mappings${editing===null?'':`/${editing}`}`,{method:editing===null?'POST':'PUT',headers:{...authHeader(),'Content-Type':'application/json'},body:JSON.stringify({workshop,supervisor})});if(!response.ok){const data=await response.json().catch(()=>({error:'保存失败'}));setMessage(data.error??'保存失败');return}setEditing(null);setWorkshop('');setSupervisor('');await load()}
  async function remove(id:number){if(!window.confirm('确定删除这条映射吗？'))return;const response=await fetch(`${base}/api/workshop-mappings/${id}`,{method:'DELETE',headers:authHeader()});if(!response.ok){setMessage('删除失败');return}await load()}
  return <List title="字段映射" sub="维护车间与默认主管；修改后新建计划将使用最新映射。" action={<button className="primary" onClick={()=>{setEditing(null);setWorkshop('');setSupervisor('')}}>＋ 新增映射</button>}>
    {message&&<p className="import-message error">{message}</p>}
    <form className="public-filters" onSubmit={save}><input aria-label="生产车间" placeholder="生产车间" value={workshop} onChange={event=>setWorkshop(event.target.value)} required/><input aria-label="生产主管" placeholder="生产主管" value={supervisor} onChange={event=>setSupervisor(event.target.value)} required/><button className="primary">{editing===null?'新增映射':'保存修改'}</button></form>
    <div className="tablewrap"><table className="simple"><thead><tr><th>生产车间</th><th>默认生产主管</th><th>操作</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td>{row.workshop}</td><td>{row.supervisor}</td><td><button onClick={()=>{setEditing(row.id);setWorkshop(row.workshop);setSupervisor(row.supervisor)}}>编辑</button><button onClick={()=>void remove(row.id)}>删除</button></td></tr>)}</tbody></table></div>
    {rows.length===0&&!message&&<p>尚未设置车间映射。可在上方填写车间和默认主管。</p>}
  </List>;
}

function Card({title,sub,action,onAction,children}:{title:string,sub:string,action?:string,onAction?:()=>void,children:React.ReactNode}){return <section className="card"><div className="cardhead"><div><h3>{title}</h3><small>{sub}</small></div>{action&&<button onClick={onAction}>{action}</button>}</div>{children}</section>}
function List({title,sub,action,children}:{title:string,sub:string,action?:React.ReactNode,children:React.ReactNode}){return <section className="card list"><div className="listhead"><div><h2>{title}</h2><p>{sub}</p></div>{action&&(typeof action==='string'?<button className="primary">{action}</button>:action)}</div>{children}</section>}
function Tip({children}:{children:React.ReactNode}){return <div className="tip"><b>导入提示</b><p>{children}</p></div>}
type ToolbarProps={query?:string;setQuery?:(value:string)=>void;months:string[];selectedMonth:string;setSelectedMonth:(value:string)=>void;dateFrom:string;setDateFrom:(value:string)=>void;dateTo:string;setDateTo:(value:string)=>void;status:string;setStatus:(value:string)=>void;customers:string[];customer:string;setCustomer:(value:string)=>void;onExport:()=>void;exporting:boolean;readOnly?:boolean;locked?:boolean};
function Toolbar({query='',setQuery,months,selectedMonth,setSelectedMonth,dateFrom,setDateFrom,dateTo,setDateTo,status,setStatus,customers,customer,setCustomer,onExport,exporting,readOnly=false,locked=false}:ToolbarProps){
  const change=(setter:(value:string)=>void)=>(event:ChangeEvent<HTMLSelectElement>)=>{setter(event.target.value)};
  return <div className="toolbar"><div className="date-range"><span>▣</span><input disabled={locked} aria-label="开始日期" type="date" value={dateFrom} onChange={event=>setDateFrom(event.target.value)}/><i>至</i><input disabled={locked} aria-label="结束日期" type="date" min={dateFrom} value={dateTo} onChange={event=>setDateTo(event.target.value)}/></div><select disabled={locked} aria-label="验货月份" value={selectedMonth} onChange={event=>setSelectedMonth(event.target.value)}><option value="">全部月份</option>{months.map(month=><option key={month} value={month}>{month.replace('-','年')}月</option>)}</select><select disabled={locked} aria-label="状态" value={status} onChange={change(setStatus)}><option value="">全部状态</option><option>待验货</option><option>待审批</option><option>已完成</option><option>HOLD</option><option>REJ</option><option>待复检</option><option>不用验</option></select><select disabled={locked} aria-label="客户" value={customer} onChange={change(setCustomer)}><option value="">全部客户</option>{customers.map(value=><option key={value}>{value}</option>)}</select><label>⌕ <input disabled={locked} value={query} onChange={e=>setQuery?.(e.target.value)} placeholder="搜索合同、PO或货号"/></label>{!readOnly&&<button className="export" disabled={exporting||locked} onClick={onExport}>{exporting?'导出中…':'导出'}</button>}</div>
}
function Table({heads,rows}:{heads:string[],rows:string[][]}){return <div className="tablewrap"><table className="simple"><thead><tr>{heads.map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i}>{r.map((x,j)=><td key={j}>{j===r.length-1?<span className={tag(x)}>{x}</span>:x}</td>)}</tr>)}</tbody></table></div>}
