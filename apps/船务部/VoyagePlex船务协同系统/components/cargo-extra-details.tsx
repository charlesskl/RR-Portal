"use client";

import * as Dialog from "@radix-ui/react-dialog";

const identity={product_code:"货号",product_name:"货名",contract_number:"合同号",customer_po:"客户 PO"};
const special={net_net_weight:"净净重（产品）",net_net_weight_per_box:"每箱净净重",box_dimensions:"箱尺寸（cm）",brand:"品牌",measurement_per_box:"每箱尺码（立方英尺）",production_line:"拉"};
const numeric=new Set(["gross_weight","net_weight","net_net_weight","gross_weight_per_box","net_weight_per_box","net_net_weight_per_box","order_total_pieces"]);
export function CargoExtraDetails({item,specialTemplate=false,disabled=false,onChange}:{item:Record<string,unknown>;specialTemplate?:boolean;disabled?:boolean;onChange:(key:string,value:string)=>void}){
  if(!specialTemplate)return null;
  const labels:Record<string,string>=special;
  return <Dialog.Root><Dialog.Trigger asChild><button type="button" className="ghost-button">更多资料</button></Dialog.Trigger><Dialog.Portal><Dialog.Overlay className="mail-preview-overlay"/><Dialog.Content className="panel cargo-extra-dialog" aria-describedby={undefined}><div className="panel-title"><Dialog.Title>货物补充资料</Dialog.Title><Dialog.Close className="ghost-button">完成</Dialog.Close></div><dl className="cargo-extra-identity">{Object.entries(identity).map(([key,label])=><div key={key}><dt>{label}</dt><dd>{String(item[key]||"—")}</dd></div>)}</dl><div className="cargo-extra-fields">{Object.entries(labels).map(([key,label])=><label key={key}><span>{label}</span><input aria-label={label} type={numeric.has(key)?"number":"text"} min={numeric.has(key)?0:undefined} step={numeric.has(key)?"any":undefined} disabled={disabled} value={String(item[key]??"")} onChange={event=>onChange(key,event.target.value)}/></label>)}</div></Dialog.Content></Dialog.Portal></Dialog.Root>;
}
