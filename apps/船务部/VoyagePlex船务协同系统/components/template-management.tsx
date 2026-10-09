"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
const apiFetch = (path: string, init?: RequestInit) => fetch(`${basePath}${path}`, init);

type Template = {
  id:number; company?:string; name:string; shipmentMode:"Container"|"Warehouse";
  purpose:"Shipping"|"Warehouse"; version:string; notes:string; isEnabled:boolean; isDefault:boolean;
};
const empty:Template={id:0,name:"",shipmentMode:"Container",purpose:"Shipping",version:"1.0",notes:"",isEnabled:true,isDefault:false};
async function read<T>(response:Response):Promise<T> {
  const text=await response.text();
  let value: T & {error?:string};
  try { value=text?JSON.parse(text):undefined; }
  catch { throw new Error(response.ok?"模板数据格式异常，请重试":"模板服务返回异常，请重试"); }
  if(!response.ok)throw new Error(value?.error||(response.status===403?"当前账号无权管理导出模板":response.status===401?"登录已失效，请重新登录":"模板操作失败"));
  if(value===undefined)throw new Error("模板服务未返回数据，请重试");
  return value;
}
export function TemplateManagement({onBack}:{onBack:()=>void}) {
  const [templates,setTemplates]=useState<Template[]>([]);
  const [draft,setDraft]=useState<Template>();
  const [loading,setLoading]=useState(true);const [saving,setSaving]=useState(false);
  const [error,setError]=useState("");const [notice,setNotice]=useState("");
  const [mode,setMode]=useState("");const [purpose,setPurpose]=useState("");
  async function load() {
    setLoading(true);
    try{setTemplates(await read<Template[]>(await apiFetch("/api/export-templates",{cache:"no-store"})));}
    catch(reason){setError(reason instanceof Error?reason.message:"读取模板失败");}
    finally{setLoading(false);}
  }
  useEffect(()=>{void load();},[]);
  async function save(value:Template) {
    setSaving(true);setError("");setNotice("");
    try {
      await read<Template>(await apiFetch("/api/export-templates",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(value)}));
      setDraft(undefined);setNotice("模板配置已保存。普通表和Sky Castle多柜特殊表按已识别业务自动导出。");await load();
    }catch(reason){setError(reason instanceof Error?reason.message:"保存失败");}
    finally{setSaving(false);}
  }
  const visible=templates.filter(item=>(!mode||item.shipmentMode===mode)&&(!purpose||item.purpose===purpose));
  return <div className="content">
    <button className="back-button" onClick={onBack}>返回系统设置</button>
    <div className="page-heading"><div><p className="eyebrow">基础配置</p><h1>导出模板管理</h1><p>管理当前公司走柜、交仓及船务、仓务模板；切换公司后分别管理。</p></div><button className="primary-button" disabled={saving} onClick={()=>{setError("");setDraft({...empty});}}>新增模板配置</button></div>
    <div className="notice">已内置普通整柜、交仓表及Sky Castle多柜特殊表，自动匹配；此处继续管理模板配置，其他特殊模板后续增加。</div>
    {(error||notice)&&<div className={error?"form-error":"notice"} role={error?"alert":"status"}>{error||notice}</div>}
    <section className="panel"><div className="filters"><select aria-label="业务类型" value={mode} onChange={event=>setMode(event.target.value)}><option value="">全部业务类型</option><option value="Container">走柜</option><option value="Warehouse">交仓</option></select><select aria-label="表单用途" value={purpose} onChange={event=>setPurpose(event.target.value)}><option value="">全部用途</option><option value="Shipping">船务</option><option value="Warehouse">仓务</option></select></div>
      <div className="template-list">{loading?<p>正在读取模板配置…</p>:!visible.length?<p>暂无模板配置，点击“新增模板配置”开始设置。</p>:visible.map(item=><article className="template-card" key={item.id}><div><h2>{item.name} {item.isDefault&&<small>默认</small>}</h2><p>{item.company==="Huadeng"?"华登":"兴信"} · {item.shipmentMode==="Container"?"走柜":"交仓"} · {item.purpose==="Shipping"?"船务":"仓务"} · 版本 {item.version} · {item.isEnabled?"已启用":"已停用"}</p>{item.notes&&<p>{item.notes}</p>}</div><div className="template-actions"><button className="ghost-button" disabled={saving} onClick={()=>{setError("");setDraft({...item});}}>编辑</button><button className="ghost-button" disabled={saving} onClick={()=>void save({...item,isEnabled:!item.isEnabled,isDefault:item.isEnabled?false:item.isDefault})}>{item.isEnabled?"停用":"启用"}</button>{item.isEnabled&&!item.isDefault&&<button className="secondary-button" disabled={saving} onClick={()=>void save({...item,isDefault:true})}>设为默认</button>}</div></article>)}</div>
    </section>
    <Dialog.Root open={!!draft} onOpenChange={open=>{if(!open&&!saving)setDraft(undefined);}}><Dialog.Portal><Dialog.Overlay className="mail-preview-overlay"/><Dialog.Content className="panel mail-preview-dialog" aria-describedby="template-description"><Dialog.Title>{draft?.id?"编辑模板配置":"新增模板配置"}</Dialog.Title><Dialog.Description id="template-description">所属公司使用当前公司；同一业务类型与用途仅可设置一个默认模板。</Dialog.Description>{error&&<div className="form-error" role="alert">{error}</div>}{draft&&<form onSubmit={event=>{event.preventDefault();void save(draft);}}><fieldset disabled={saving} className="template-form"><div className="form-grid"><label><span>模板名称</span><input autoFocus required maxLength={100} value={draft.name} onChange={event=>setDraft({...draft,name:event.target.value})}/></label><label><span>版本</span><input required maxLength={30} value={draft.version} onChange={event=>setDraft({...draft,version:event.target.value})}/></label><label><span>业务类型</span><select value={draft.shipmentMode} onChange={event=>setDraft({...draft,shipmentMode:event.target.value as Template["shipmentMode"]})}><option value="Container">走柜</option><option value="Warehouse">交仓</option></select></label><label><span>表单用途</span><select value={draft.purpose} onChange={event=>setDraft({...draft,purpose:event.target.value as Template["purpose"]})}><option value="Shipping">船务</option><option value="Warehouse">仓务</option></select></label><label className="full-width"><span>说明</span><textarea rows={3} maxLength={2000} value={draft.notes} onChange={event=>setDraft({...draft,notes:event.target.value})}/></label></div><div className="template-actions"><label><input type="checkbox" checked={draft.isEnabled} onChange={event=>setDraft({...draft,isEnabled:event.target.checked,isDefault:event.target.checked&&draft.isDefault})}/>启用</label><label><input type="checkbox" checked={draft.isDefault} disabled={!draft.isEnabled} onChange={event=>setDraft({...draft,isDefault:event.target.checked})}/>设为默认</label></div><div className="panel-actions"><button type="button" className="ghost-button" disabled={saving} onClick={()=>setDraft(undefined)}>取消</button><button className="primary-button" disabled={saving}>{saving?"保存中…":"保存配置"}</button></div></fieldset></form>}</Dialog.Content></Dialog.Portal></Dialog.Root>
  </div>;
}
