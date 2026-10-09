"use client";

import { useState } from "react";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
const apiFetch = (path: string, init?: RequestInit) => fetch(`${basePath}${path}`, init);

type Cabinet = {fields:Record<string,unknown>;items:Record<string,unknown>[]};
export function ContainerSplitPreview({payload}:{payload:object}) {
  const [result,setResult]=useState<{source:string;cabinets:Cabinet[]}|null>(null);
  const [error,setError]=useState("");
  const [working,setWorking]=useState(false);
  const source=JSON.stringify(payload);
  async function preview(){
    setWorking(true);setError("");
    try{
      const response=await apiFetch("/api/imports/email/split-preview",{method:"POST",headers:{"content-type":"application/json"},body:source});
      const raw=await response.text();
      let value:{error?:string;cabinets?:Cabinet[]};
      try{value=JSON.parse(raw);}catch{throw new Error("分柜预览服务暂时不可用");}
      if(!response.ok||!value.cabinets)throw new Error(value.error||"无法生成分柜预览");
      setResult({source,cabinets:value.cabinets});
    }catch(error){setError(error instanceof Error?error.message:"无法生成分柜预览");}
    finally{setWorking(false);}
  }
  return <div><button className="secondary-button" disabled={working} onClick={()=>void preview()}>{working?"正在计算…":"预览分柜数量"}</button>{error&&<p className="form-error">{error}</p>}{result?.source===source&&result.cabinets.map((cabinet,index)=><div key={index} className="notice"><strong>第{index+1}柜 · {String(cabinet.fields.so_number||"")}</strong><span>{cabinet.items.length?cabinet.items.map(item=>`${String(item.product_code||"待填货号")}：${String(item.pieces)}箱 / ${String(item.quantity??"待填")}个`).join("；"):"产品资料待填写"}</span></div>)}</div>;
}
