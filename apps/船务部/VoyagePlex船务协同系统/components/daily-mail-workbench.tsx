"use client";

import Link from "next/link";
import { CargoExtraDetails } from "@/components/cargo-extra-details";
import { ContainerSplitPreview } from "@/components/container-split-preview";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
const apiFetch = (path: string, init?: RequestInit) => fetch(`${basePath}${path}`, init);

type WorkCategory = "Unclassified"|"Shipment"|"Change"|"FollowUp"|"Other";
type Cargo = Record<string,unknown>;
type WarehouseGroup = {warehouse:string;references:string[];items:Cargo[];container_type?:string};
type MailItem = {id:number;mailSubject:string;mailSender:string;mailReceivedAt:string;mailReceivedDate:string;workCategory:WorkCategory;shipmentMode:string;status:string;error:string;handlingStatus:string;handlingOutcome:string;needsClassificationReview:boolean;taskIdsJson:string};
type ContainerPlan = {group_key:string;so_number:string;container_type:string;vessel_name?:string;si_deadline?:string;cutoff_date?:string;capacity_boxes?:string};
type Parsed = {shipment_groups?:ContainerPlan[];fields?:Record<string,string>;items?:Cargo[];warehouse_groups?:WarehouseGroup[];so_numbers?:string[];message?:{body_text?:string};attachments?:Array<{filename:string}>;warnings?:string[]};
type Detail = MailItem & {duplicateTaskIds?:number[];parsed?:Parsed;relatedTasks?:Array<{id:number;soNumber:string;plannedShipDate?:string;containerType:string;cutoffDate:string;siDeadline:string;port:string}>};
type Day = {date:string;total:number;pending:number};
type Dates = {startDate:string;days:Day[]};
type Page = {total:number;page:number;pageSize:number;items:MailItem[]};
const categoryLabels:Record<WorkCategory,string>={Unclassified:"待判断",Shipment:"新增",Change:"变更",FollowUp:"待跟进",Other:"其他"};
const modeLabels:Record<string,string>={Warehouse:"交仓",Container:"整柜",Unknown:"方式待识别"};
const fieldLabels:Record<string,string>={so_number:"SO号",container_type:"柜型",ship_date:"计划走货日期",si_deadline:"SI截止",cutoff_date:"截数期",port:"装货港",destination_country:"收货国家",special_requirements:"特殊要求"};
const cargoLabels:Record<string,string>={product_code:"货号",product_name:"货名",spec:"规格",contract_number:"合同号",customer_po:"客户PO",quantity:"数量",pieces:"件数",volume:"体积",pallet_count:"卡板",supplier:"生产工厂"};
function chinaToday(){return new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Shanghai"}).format(new Date());}
function taskIds(item:MailItem){try{const value:unknown=JSON.parse(item.taskIdsJson||"[]");return Array.isArray(value)?value.filter((id):id is number=>typeof id==="number"&&id>0):[];}catch{return [];}}
function canConfirm(item:MailItem){return item.handlingStatus==="Pending"&&item.status==="pending"&&!item.needsClassificationReview&&(item.workCategory==="Shipment"||item.workCategory==="Change");}
async function readResponse<T>(response:Response):Promise<T>{
  const raw=await response.text();let value:T & {error?:string};
  try{value=JSON.parse(raw);}catch{throw new Error("服务返回无效数据，请稍后重试");}
  if(!response.ok)throw new Error(value.error||"操作失败，请稍后重试");
  return value;
}

export function DailyMailWorkbench({route=""}:{route?:string}){
  const [dates,setDates]=useState<Dates>({startDate:"2026-10-08",days:[]});
  const [date,setDate]=useState(chinaToday);
  const [query,setQuery]=useState("");const [search,setSearch]=useState("");const [modalOpen,setModalOpen]=useState(false);
  const [filter,setFilter]=useState("All");const [handling,setHandling]=useState("");const [page,setPage]=useState(1);
  const [result,setResult]=useState<Page>({total:0,page:1,pageSize:50,items:[]});
  const [detail,setDetail]=useState<Detail>();const [selectedId,setSelectedId]=useState<number>();
  const [selected,setSelected]=useState<Set<number>>(new Set());
  const [refresh,setRefresh]=useState(0);const [loading,setLoading]=useState(true);const [detailLoading,setDetailLoading]=useState(false);
  const [working,setWorking]=useState(false);const [dirty,setDirty]=useState(false);const [error,setError]=useState("");const [notice,setNotice]=useState("");
  const [syncText,setSyncText]=useState("正在读取同步状态…");
  useEffect(()=>{const timer=setTimeout(()=>{setSearch(query.trim());setPage(1);},300);return()=>clearTimeout(timer);},[query]);
  useEffect(()=>{
    const controller=new AbortController();
    async function load(){try{
      const days=await readResponse<Dates>(await apiFetch("/api/mail/dates",{signal:controller.signal,cache:"no-store"}));
      setDates(days);setDate(current=>Number(route.split("/")[2])?current:current<days.startDate?days.startDate:current);
      const sync=await readResponse<{lastSuccessAt?:string;lastError?:string}>(await apiFetch("/api/imports/email/mailbox",{signal:controller.signal,cache:"no-store"}));
      setSyncText(sync.lastError?`读取异常：${sync.lastError}`:sync.lastSuccessAt?`上次读取 ${new Date(sync.lastSuccessAt).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"})}`:"等待首次读取");
    }catch(reason){if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:"读取日期失败");}}
    void load();return()=>controller.abort();
  },[refresh,route]);
  useEffect(()=>{
    const controller=new AbortController();const requested=Number(route.split("/")[2]);if(!requested)return()=>controller.abort();
    void apiFetch(`/api/imports/email/mailbox/items/${requested}`,{signal:controller.signal,cache:"no-store"}).then(readResponse<Detail>).then(item=>{setDate(item.mailReceivedDate||chinaToday());setSelectedId(item.id);setModalOpen(true);}).catch(reason=>{if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:"读取来源邮件失败");});
    return()=>controller.abort();
  },[route]);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setSelected(new Set());setError("");
    const params=new URLSearchParams({date,page:String(page)});
    if(filter==="Warehouse"||filter==="Container")params.set("mode",filter);else if(filter!=="All")params.set("category",filter);
    if(handling)params.set("handling",handling);
    if(search)params.set("q",search);
    void apiFetch(`/api/imports/email/mailbox/items?${params}`,{signal:controller.signal,cache:"no-store"}).then(readResponse<Page>).then(value=>{
      setResult(value);
    }).catch(reason=>{if(!controller.signal.aborted){setResult({total:0,page,pageSize:50,items:[]});setSelectedId(undefined);setError(reason instanceof Error?reason.message:"读取邮件失败");}}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[date,filter,handling,page,refresh,route,search]);
  useEffect(()=>{
    const controller=new AbortController();setDetail(undefined);setDirty(false);if(!selectedId){setDetailLoading(false);return()=>controller.abort();}setDetailLoading(true);
    void apiFetch(`/api/imports/email/mailbox/items/${selectedId}`,{signal:controller.signal,cache:"no-store"}).then(readResponse<Detail>).then(setDetail).catch(reason=>{if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:"读取详情失败");}).finally(()=>{if(!controller.signal.aborted)setDetailLoading(false);});
    return()=>controller.abort();
  },[selectedId,refresh]);
  function discardEdits(){return !dirty||window.confirm("当前核对资料尚未保存，是否放弃修改？");}
  function chooseDate(value:string){if(!discardEdits())return;setModalOpen(false);setDate(value);setPage(1);setSelectedId(undefined);setNotice("");}
  function toggle(id:number,checked:boolean){setSelected(previous=>{const next=new Set(previous);checked?next.add(id):next.delete(id);return next;});}
  function editField(key:string,value:string){setDetail(current=>current?{...current,parsed:{...current.parsed,fields:{...current.parsed?.fields,[key]:value}}}:current);setDirty(true);}
  function editCargo(index:number,key:string,value:string){setDetail(current=>current?{...current,parsed:{...current.parsed,items:current.parsed?.items?.map((item,i)=>i===index?{...item,[key]:value}:item)}}:current);setDirty(true);}
  function editContainer(index:number,value:string){setDetail(current=>current?{...current,parsed:{...current.parsed,shipment_groups:current.parsed?.shipment_groups?.map((group,i)=>i===index?{...group,capacity_boxes:value}:group)}}:current);setDirty(true);}
  function addCargo(){setDetail(current=>current?{...current,parsed:{...current.parsed,items:[...(current.parsed?.items||[]),{product_code:"",spec:"",quantity:"",pieces:"",customer_po:"",contract_number:""}]}}:current);setDirty(true);}
  async function save(){if(!detail||!dirty)return;setWorking(true);setError("");try{
    await readResponse(await apiFetch(`/api/mail/candidates/${detail.id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({fields:detail.parsed?.fields||{},items:detail.parsed?.items||[],warehouseGroups:detail.parsed?.warehouse_groups||[],shipmentGroups:detail.parsed?.shipment_groups||[]})}));
    setDirty(false);setNotice("核对资料已保存，可勾选确认。");setRefresh(value=>value+1);
  }catch(reason){setError(reason instanceof Error?reason.message:"保存失败");}finally{setWorking(false);}}
  async function act(action:"confirm"|"acknowledge",ids:number[]){
    if(!ids.length)return;
    if(dirty){setError("请先保存当前核对资料，再确认处理。");return;}
    const chosen=result.items.filter(item=>ids.includes(item.id));
    if(action==="confirm"){
      let checks:Detail[];try{checks=await Promise.all(ids.map(async id=>readResponse<Detail>(await apiFetch(`/api/imports/email/mailbox/items/${id}`,{cache:"no-store"}))));}catch(reason){setError(reason instanceof Error?reason.message:"检查关联任务失败");return;}
      const duplicateIds=Array.from(new Set(checks.flatMap(item=>item.duplicateTaskIds||[])));
      const duplicateNotice=duplicateIds.length?`\n同一邮件已建立任务 ${duplicateIds.map(id=>`#${id}`).join("、")}，对应邮件将关联已有任务，不重复建立。`:"";
      const creates=chosen.filter(item=>item.workCategory==="Shipment").length;const changes=chosen.filter(item=>item.workCategory==="Change").length;
      if(!window.confirm(`将确认 ${ids.length} 封邮件：${creates} 封新增资料、${changes} 封变更资料。有修改权限的相关任务会更新；未找到任务的变更邮件会提示核对。${duplicateNotice}继续吗？`))return;
    }
    setWorking(true);setError("");setNotice("");try{
      const value=await readResponse<{processed:number;taskIds:number[]}>(await apiFetch(`/api/mail/candidates/batch/${action}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({ids})}));
      setNotice(action==="acknowledge"?`${value.processed} 封邮件已确认，无需建任务。`:`已确认 ${value.processed} 封邮件，关联 ${value.taskIds.length} 个走柜任务。`);
      setSelected(new Set());setRefresh(value=>value+1);
    }catch(reason){setError(reason instanceof Error?reason.message:"确认失败");}finally{setWorking(false);}
  }
  async function sync(){if(dirty){setError("请先保存当前核对资料，再读取邮件。");return;}setWorking(true);setError("");try{
    const value=await readResponse<{configured:boolean;imported:number;waitingUntil?:string}>(await apiFetch("/api/imports/email/mailbox/sync",{method:"POST"}));
    setNotice(value.waitingUntil?`将从 ${value.waitingUntil} 开始读取。`:value.configured?`读取完成，本次新增 ${value.imported} 封；邮件按各自收件日期归档。`:"邮箱尚未配置，请联系管理员。");setRefresh(current=>current+1);
  }catch(reason){setError(reason instanceof Error?reason.message:"读取失败");}finally{setWorking(false);}}
  const pending=result.items.filter(item=>item.handlingStatus==="Pending");const chosen=result.items.filter(item=>selected.has(item.id));
  const days=Array.from(new Set([dates.startDate,...(chinaToday()>=dates.startDate?[chinaToday()]:[]),...dates.days.map(day=>day.date)])).sort().reverse();
  const summary=dates.days.find(day=>day.date===date);const parsed=detail?.parsed;const editable=!!detail&&canConfirm(detail);
  const visibleCargoLabels=cargoLabels;
  const relatedFieldKeys:Record<string,string>={ship_date:"plannedShipDate",container_type:"containerType",cutoff_date:"cutoffDate",si_deadline:"siDeadline",port:"port"};
  return <section className="daily-mail">
    {(error||notice)&&<div className={error?"form-error":"notice"} role={error?"alert":"status"}>{error||notice}</div>}
    <div className="daily-mail-layout"><aside className="panel daily-mail-dates"><h2>收件日期</h2><input type="date" aria-label="选择收件日期" min={dates.startDate} value={date} disabled={working} onChange={event=>{if(event.target.value)chooseDate(event.target.value);}}/>{days.map(day=>{const count=dates.days.find(value=>value.date===day);return <button key={day} disabled={working} className={date===day?"active":""} onClick={()=>chooseDate(day)}><strong>{day.slice(5).replace("-"," 月 ")} 日{day===chinaToday()?" · 今天":""}</strong><small>{count?.total||0} 封 · 待确认 {count?.pending||0}</small></button>;})}</aside>
    <div className="daily-mail-main"><section className="panel daily-mail-inbox"><div className="daily-mail-title"><h2>{date} 收到的邮件</h2><span>{summary?.total||0} 封 · 待确认 {summary?.pending||0}</span><button className="secondary-button" disabled={working} onClick={()=>void sync()}><RefreshCw size={16}/>{working?"处理中…":"立即读取"}</button></div><p className="daily-mail-sync">{syncText}{chinaToday()<dates.startDate?` · 将于 ${dates.startDate} 开始读取`:""}</p>
    <label className="filter-input mail-search"><input aria-label="搜索邮件" maxLength={100} value={query} onChange={event=>setQuery(event.target.value)} placeholder="搜索当天邮件主题、发件人、SO、PO" /></label><div className="daily-mail-filters">{([['All','全部'],['Shipment','新增'],['Change','变更'],['Warehouse','交仓'],['Container','整柜'],['Unclassified','待判断']] as const).map(([key,label])=><button disabled={working} className={filter===key?"active":""} key={key} onClick={()=>{if(!discardEdits())return;setFilter(key);setPage(1);}}>{label}</button>)}<select aria-label="处理状态" value={handling} disabled={working} onChange={event=>{if(!discardEdits())return;setHandling(event.target.value);setPage(1);}}><option value="">全部状态</option><option value="Pending">待确认</option><option value="Processed">已确认</option><option value="Ignored">已忽略</option></select></div>
    <div className="daily-mail-list">{loading?<div className="mail-workbench-empty">正在读取当天邮件…</div>:!result.items.length?<div className="mail-workbench-empty">{chinaToday()<dates.startDate?`尚未开始读取，将于 ${dates.startDate} 启用。`:"当天没有符合条件的邮件"}</div>:result.items.map(item=><article className={`daily-mail-row ${item.id===selectedId?"active":""}`} key={item.id}><input type="checkbox" aria-label={`勾选 ${item.mailSubject}`} checked={selected.has(item.id)} disabled={working||item.handlingStatus!=="Pending"} onChange={event=>toggle(item.id,event.target.checked)}/><button className="daily-mail-open" disabled={working} onClick={()=>{if(item.id===selectedId||discardEdits()){setSelectedId(item.id);setModalOpen(true);}}}><strong>{item.mailSubject||"（无主题）"}</strong><span className="daily-mail-tags"><i>{categoryLabels[item.workCategory]}</i>{item.shipmentMode!=="Unknown"&&<i>{modeLabels[item.shipmentMode]}</i>}<small>系统分类</small></span><small>{item.mailReceivedAt?new Date(item.mailReceivedAt).toLocaleTimeString("zh-CN",{timeZone:"Asia/Shanghai",hour:"2-digit",minute:"2-digit"}):"—"} · {item.mailSender||"未知发件人"}{item.status==="failed"?" · 解析失败":item.status==="duplicate"?" · 重复邮件":""}</small></button><div className="daily-mail-handling"><span>{item.handlingStatus==="Pending"?"待确认":item.handlingStatus==="Ignored"?"已忽略":"已确认"}</span><small>{item.handlingOutcome==="NoTask"?"无需建任务":item.handlingOutcome==="Task"?"已关联任务":"尚未建任务"}</small>{taskIds(item).map(id=><Link href={`/shipments/${id}`} key={id}>任务 #{id}</Link>)}</div></article>)}</div>
    <div className="daily-mail-actions"><label><input type="checkbox" checked={pending.length>0&&pending.every(item=>selected.has(item.id))} disabled={loading||working||!pending.length} onChange={event=>setSelected(event.target.checked?new Set(pending.map(item=>item.id)):new Set())}/> 勾选本页待确认</label><span>已选 {selected.size} 封</span><button className="secondary-button" disabled={working||loading||!selected.size} onClick={()=>void act("acknowledge",Array.from(selected))}>已确认，无需建任务</button><button className="primary-button" disabled={working||loading||!selected.size||chosen.some(item=>!canConfirm(item))||dirty} onClick={()=>void act("confirm",Array.from(selected))}><Check size={16}/>确认建立／更新任务</button></div>
    {result.total>result.pageSize&&<div className="daily-mail-pagination"><button className="ghost-button" disabled={working||dirty||page===1} onClick={()=>setPage(value=>value-1)}>上一页</button><span>第 {page} / {Math.ceil(result.total/result.pageSize)} 页 · 共 {result.total} 封</span><button className="ghost-button" disabled={working||dirty||page*result.pageSize>=result.total} onClick={()=>setPage(value=>value+1)}>下一页</button></div>}</section>
    <Dialog.Root open={modalOpen} onOpenChange={open=>{if(working)return;if(open){setModalOpen(true);return;}if(discardEdits()){setModalOpen(false);if(dirty){setDirty(false);setRefresh(value=>value+1);}}}}><Dialog.Portal><Dialog.Overlay className="mail-preview-overlay"/><Dialog.Content className="panel preview-panel daily-mail-detail mail-preview-dialog" aria-describedby="mail-preview-description"><div className="panel-title"><div><Dialog.Title>邮件解析结果预览</Dialog.Title><Dialog.Description id="mail-preview-description">核对邮件信息及货物明细后确认，已确认邮件可打开关联任务。</Dialog.Description></div><Dialog.Close className="ghost-button" disabled={working} aria-label="关闭邮件预览">关闭</Dialog.Close></div>{(error||notice)&&<div className={error?"form-error":"notice"} role={error?"alert":"status"}>{error||notice}</div>}{detailLoading?<div className="mail-workbench-empty">正在读取邮件详情…</div>:detail?<><div className="mail-meta"><span><b>主题</b>{detail.mailSubject||"（无主题）"}</span><span><b>发件人</b>{detail.mailSender}</span><span><b>收件时间</b>{detail.mailReceivedAt?new Date(detail.mailReceivedAt).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"}):detail.mailReceivedDate}</span></div>
      {detail.error&&<div className="form-error">{detail.error}</div>}
      {detail.needsClassificationReview&&<div className="notice">系统未识别出任务类型；暂不能建立任务。如不需要任务，可确认无需建任务。</div>}
      {detail.status==="duplicate"&&<div className="notice">重复邮件不会再次建立任务，可确认无需建任务。</div>}
      {!!detail.duplicateTaskIds?.length&&<div className="notice">同一邮件已建立任务 {detail.duplicateTaskIds.map(id=>`#${id}`).join("、")}，确认时将关联已有任务，不会重复建立。</div>}
      {detail.relatedTasks?.map(task=><div className="daily-mail-related" key={task.id}><Link href={`/shipments/${task.id}`}>关联任务 #{task.id} · SO {task.soNumber}</Link>{detail.workCategory==="Change"&&Object.entries(relatedFieldKeys).map(([field,key])=>{const previous=String(task[key as keyof typeof task]??"");const current=parsed?.fields?.[field];return current&&current!==previous?<p key={field}>{fieldLabels[field]}：<del>{previous||"空"}</del> → <strong>{current}</strong></p>:null;})}</div>)}
      <div className="form-grid">{Object.entries(fieldLabels).map(([key,label])=><label key={key} className={key==="special_requirements"?"full-width":""}><span>{label}</span>{key==="special_requirements"?<textarea rows={4} value={parsed?.fields?.[key]||""} disabled={!editable||working} onChange={event=>editField(key,event.target.value)}/>:<input value={parsed?.fields?.[key]||""} disabled={!editable||working} onChange={event=>editField(key,event.target.value)}/>}</label>)}</div>
      {parsed?.fields?.multi_container==="true"&&<div className="review-section"><h3>分柜安排 · {parsed.shipment_groups?.length} 个任务</h3><p>同款产品优先集中装柜；同柜型容量留空时按总箱数均衡分配。没有产品资料时只建立柜安排，导出普通模板。</p>{parsed.shipment_groups?.map((group,index)=><label className="cargo-scope-row" key={group.group_key}><span>{index+1}. {group.so_number} · {group.container_type} · {group.vessel_name} · SI {group.si_deadline} · 截关 {group.cutoff_date}</span><input aria-label={`柜${index+1}容量箱数`} type="number" min="1" step="1" disabled={!editable||working} value={group.capacity_boxes||""} placeholder="可装箱数（选填）" onChange={event=>editContainer(index,event.target.value)}/></label>)}{editable&&<button className="secondary-button" disabled={working} onClick={addCargo}>补充整批产品</button>}<ContainerSplitPreview payload={parsed}/></div>}
      {!!parsed?.warehouse_groups?.length&&<div className="warehouse-grid">{parsed.warehouse_groups.map((group,index)=><article key={index}><strong>{group.warehouse||"仓库待识别"}</strong><small>{group.container_type} · {group.references?.join("、")||"—"} · {group.items.length} 条明细</small></article>)}</div>}
      {!!parsed?.items?.length&&<div className="review-section"><h3>货物明细 <small>共 {parsed.items.length} 条，可在确认前修改</small></h3><div className="review-items editable"><div>{Object.values(visibleCargoLabels).map(label=><b key={label}>{label}</b>)}{parsed.fields?.export_template==="sky-castle-multi"&&<b>补充资料</b>}</div>{parsed.items.map((item,index)=><div key={index}>{Object.keys(visibleCargoLabels).map(key=><input key={key} aria-label={`${visibleCargoLabels[key]} ${index+1}`} value={String(item[key]??"")} disabled={!editable||working} onChange={event=>editCargo(index,key,event.target.value)}/>)}<CargoExtraDetails item={item} specialTemplate={parsed.fields?.export_template==="sky-castle-multi"} disabled={!editable||working} onChange={(key,value)=>editCargo(index,key,value)}/></div>)}</div></div>}
      {parsed?.fields?.cargo_split_required==="true"&&<div className="review-section"><h3>本次出运 / 等待通知分配</h3>{parsed.items?.map((item,index)=><label className="cargo-scope-row" key={index}><span>{String(item.product_code||"")} · {String(item.customer_po||"")} · {String(item.quantity||0)} 个</span><select disabled={!editable||working} value={String(item.shipment_scope||"unassigned")} onChange={event=>editCargo(index,"shipment_scope",event.target.value)}><option value="unassigned">请选择</option><option value="current">本次出运</option><option value="waiting">剩余散货，等待客户通知</option></select></label>)}</div>}
      {!!parsed?.warnings?.length&&<div className="notice">{parsed.warnings.join("；")}</div>}
      <details className="daily-mail-body"><summary>邮件正文及附件（{parsed?.attachments?.length||0}）</summary><pre>{parsed?.message?.body_text||"无正文"}</pre>{parsed?.attachments?.map((attachment,index)=><p key={index}>{attachment.filename}</p>)}</details>
      <div className="daily-mail-actions">{dirty&&<span>资料尚未保存</span>}{editable&&<button className="secondary-button" disabled={working||!dirty} onClick={()=>void save()}>保存核对资料</button>}{detail.handlingStatus==="Pending"&&<><button className="secondary-button" disabled={working||dirty} onClick={()=>void act("acknowledge",[detail.id])}>已确认，无需建任务</button><button className="primary-button" disabled={!editable||working||dirty} onClick={()=>void act("confirm",[detail.id])}>{detail.workCategory==="Change"?"确认更新任务":"确认建立任务"}</button></>}{taskIds(detail).map(id=><Link className="secondary-button" href={`/shipments/${id}`} key={id}>查看任务 #{id}</Link>)}</div>
    </>:<div className="mail-workbench-empty">选择当天邮件，查看系统识别的资料</div>}</Dialog.Content></Dialog.Portal></Dialog.Root></div></div>
  </section>;
}
