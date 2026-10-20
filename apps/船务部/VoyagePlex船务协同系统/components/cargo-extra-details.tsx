"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { hasSpecialCargoDetails } from "@/lib/cargo-extra-details";

const identity={product_code:"货号",product_name:"货名",contract_number:"合同号",customer_po:"客户 PO"};
const special={customer_item_number:"客户 ITEM",order_total_quantity:"每单总数量（箱唛尺寸版）",net_net_weight:"净净重（产品）",net_net_weight_per_box:"每箱净净重",box_dimensions:"箱尺寸（cm）",brand:"品牌",measurement_per_box:"每箱尺码（立方英尺）",production_line:"拉"};
const numeric=new Set(["gross_weight","net_weight","net_net_weight","gross_weight_per_box","net_weight_per_box","net_net_weight_per_box","order_total_pieces","order_total_quantity"]);
export function hasLegacyUnitWeights(item:Record<string,unknown>){
  return ["gross_weight","net_weight"].some(key=>item[`${key}_per_box`]==null||item[`${key}_per_box`]==="" ? item[key]!=null&&item[key]!=="" : false);
}
export function CargoExtraDetails({item,specialTemplate=false,disabled=false,onChange}:{item:Record<string,unknown>;company?:string;specialTemplate?:boolean;disabled?:boolean;onChange:(key:string,value:string)=>void}){
  const legacy=hasLegacyUnitWeights(item);
  const specialDetails=hasSpecialCargoDetails(item,specialTemplate);
  if(!specialDetails&&!legacy)return null;
  const labels:Record<string,string>=specialDetails?special:{};
  return <Dialog.Root><Dialog.Trigger asChild><button type="button" className="ghost-button">{specialDetails?"更多资料":"核对旧重量"}</button></Dialog.Trigger><Dialog.Portal><Dialog.Overlay className="mail-preview-overlay"/><Dialog.Content className="panel cargo-extra-dialog" aria-describedby={undefined}><div className="panel-title"><Dialog.Title>货物补充资料</Dialog.Title><Dialog.Close className="ghost-button">完成</Dialog.Close></div><dl className="cargo-extra-identity">{Object.entries(identity).map(([key,label])=><div key={key}><dt>{label}</dt><dd>{String(item[key]||"—")}</dd></div>)}</dl>{legacy&&<div className="notice"><p>旧重量字段的含义需人工核对。仅当原值确实为每箱重量时，才确认代入；若为整批总重，请在主表填写正确的每箱重量。</p>{([['gross_weight','毛重'],['net_weight','净重']] as const).map(([key,label])=>item[key]!=null&&item[key]!==""&&(item[`${key}_per_box`]==null||item[`${key}_per_box`]==="")?<p key={key}>原{label}：{String(item[key])} <button type="button" className="ghost-button" disabled={disabled} onClick={()=>onChange(`${key}_per_box`,String(item[key]))}>确认原{label}为每箱{label}</button></p>:null)}</div>}<div className="cargo-extra-fields">{Object.entries(labels).map(([key,label])=><label key={key}><span>{label}</span><input aria-label={label} type={numeric.has(key)?"number":"text"} min={numeric.has(key)?0:undefined} step={numeric.has(key)?"any":undefined} disabled={disabled} value={String(item[key]??"")} onChange={event=>onChange(key,event.target.value)}/></label>)}</div></Dialog.Content></Dialog.Portal></Dialog.Root>;
}
