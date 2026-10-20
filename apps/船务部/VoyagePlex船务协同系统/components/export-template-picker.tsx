"use client";

import { templateLayoutLabel, templateWeightLabel } from "@/lib/export-template-display";
import * as Dialog from "@radix-ui/react-dialog";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
const apiFetch = (path: string, init?: RequestInit) => fetch(`${basePath}${path}`, init);
import { useEffect, useState } from "react";

type Template = { id:number; company:string; name:string; shipmentMode:string; purpose:string; layoutKey:string; weightRule:string; version:string; isDefault:boolean };
export function ExportTemplatePicker({purpose,company,mode,special,busy,onClose,onConfirm}:{
  purpose:"Shipping"|"Warehouse"|null; company:string; mode:string; special:boolean; busy:boolean;
  onClose:()=>void; onConfirm:(id:number,warehouse:boolean)=>Promise<boolean>;
}) {
  const [templates,setTemplates]=useState<Template[]>([]);
  const [selected,setSelected]=useState(""); const [loading,setLoading]=useState(false); const [error,setError]=useState("");
  useEffect(()=>{
    if(!purpose)return;
    const controller=new AbortController();
    setLoading(true);setError("");setSelected("");setTemplates([]);
    void (async()=>{
      try {
        const response=await apiFetch(`/api/export-templates/available?purpose=${purpose}`,{cache:"no-store",signal:controller.signal});
        const data=await response.json();
        if(!response.ok)throw new Error(data.error||"模板读取失败");
        if(!Array.isArray(data))throw new Error("模板数据格式异常");
        const available=(data as Template[]).filter(item=>item.company===company&&item.purpose===purpose);
        setTemplates(available);
        const recommended=available.find(item=>special&&item.layoutKey==="SkyCastle")||available.find(item=>item.shipmentMode===mode&&item.isDefault);
        if(recommended)setSelected(String(recommended.id));
      }catch(reason){if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:"模板读取失败");}
      finally{if(!controller.signal.aborted)setLoading(false);}
    })();
    return()=>controller.abort();
  },[purpose,company,mode,special]);
  const template=templates.find(item=>String(item.id)===selected);
  return <Dialog.Root open={purpose!==null} onOpenChange={open=>{if(!open&&!busy)onClose();}}><Dialog.Portal><Dialog.Overlay className="mail-preview-overlay"/><Dialog.Content className="panel mail-preview-dialog" aria-describedby="export-template-description"><Dialog.Title>确认导出模板</Dialog.Title><Dialog.Description id="export-template-description">{company==="Huadeng"?"华登":"兴信"} · {purpose==="Warehouse"?"仓务":"船务"}。请核对交仓／做柜类型；仅本次导出使用所选模板。</Dialog.Description>
    {error&&<div className="form-error" role="alert">{error}</div>}
    <label className="form-grid"><span>导出模板</span><select aria-label="导出模板" disabled={loading||busy} value={selected} onChange={event=>setSelected(event.target.value)}><option value="">{loading?"正在读取模板…":"请选择模板"}</option>{templates.map(item=><option key={item.id} value={item.id}>{item.company==="Huadeng"?item.name:<>{item.name} · {item.shipmentMode==="Warehouse"?"交仓（车）":"做柜（柜）"} · {templateWeightLabel(item.weightRule,item.company)} · {item.version}</>}</option>)}</select></label>
    {template&&<p>{templateLayoutLabel(template.layoutKey)}；毛净重公式：{templateWeightLabel(template.weightRule,template.company)}。请先核对明细中的每箱毛重、每箱净重。</p>}
    {!loading&&!error&&!templates.length&&<p>当前厂区暂无此用途的已启用模板，请在模板管理中配置。</p>}
    <div className="panel-actions"><button className="ghost-button" disabled={busy} onClick={onClose}>取消</button><button className="primary-button" disabled={busy||loading||!template} onClick={()=>{if(template){setError("");void onConfirm(template.id,purpose==="Warehouse").then(ok=>{if(ok)onClose();else setError("导出未成功，请关闭弹窗查看任务中的错误提示。");});}}}>{busy?"正在生成…":"确认模板并导出"}</button></div>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
