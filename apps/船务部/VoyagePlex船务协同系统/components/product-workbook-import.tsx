"use client";

import { useRef, useState } from "react";

type Row = {filename:string;rowNumber:number;customer:string;productCode:string;productName:string;quantityPerBox:number|null;toyCategory:string;grossWeightPerBox:number|null;netWeightPerBox:number|null;warnings:string[];existingId:number|null;existingProduct?:{customer:string;productName:string;toyCategory:string;grossWeightPerBox:number|null;netWeightPerBox:number|null};updateExisting:boolean;selected:boolean};

export function ProductWorkbookImport({onClose,onSaved}:{onClose:()=>void;onSaved:()=>void}) {
  const input=useRef<HTMLInputElement>(null);
  const [rows,setRows]=useState<Row[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  async function preview(files:FileList|null) {
    if(!files?.length)return;
    setBusy(true);setMessage("");setRows([]);
    const body=new FormData();Array.from(files).forEach(file=>body.append("files",file));
    try {const response=await fetch("/api/product-infos/workbooks/preview",{method:"POST",body});const result=await response.json();if(!response.ok)throw new Error(result.error||"解析失败");setRows((result.rows as Row[]).map(row=>({...row,selected:!row.existingId&&!row.warnings.length,updateExisting:false})));if(!result.rows.length)setMessage("未找到货物明细");}
    catch(error){setMessage(error instanceof Error?error.message:"解析失败");}
    finally{setBusy(false);if(input.current)input.current.value="";}
  }
  function change(index:number,values:Partial<Row>){setRows(current=>current.map((row,position)=>position===index?{...row,...values}:row));}
  async function commit(){const selected=rows.filter(row=>row.selected);if(!selected.length){setMessage("请选择要写入的产品");return;}if(selected.some(row=>!row.productCode.trim()||!row.quantityPerBox||row.quantityPerBox<=0)){setMessage("选中行必须填写货号和每箱个数");return;}setBusy(true);setMessage("");try{const response=await fetch("/api/product-infos/workbooks/commit",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({rows:selected.map(({selected:_selected,...row})=>row)})});const result=await response.json();if(!response.ok)throw new Error(result.error||"保存失败");setMessage(`已新增 ${result.added} 条、更新 ${result.updated} 条、跳过 ${result.skipped} 条`);setRows([]);onSaved();}catch(error){setMessage(error instanceof Error?error.message:"保存失败");}finally{setBusy(false);}}
  const selectedCount=rows.filter(row=>row.selected).length;
  return <div className="mapping-modal-backdrop" onMouseDown={onClose}><div className="product-workbook-modal" onMouseDown={event=>event.stopPropagation()}>
    <div className="product-workbook-head"><div><h2>从走柜表提取产品信息</h2><p>上传已生成的走柜表，核对后写入；备注不会导入。</p></div><button className="ghost-button" onClick={onClose}>关闭</button></div>
    <div className="product-workbook-actions"><input ref={input} hidden multiple type="file" accept=".xlsx" onChange={event=>void preview(event.target.files)}/><button className="ghost-button" disabled={busy} onClick={()=>input.current?.click()}>选择走柜表（可多选）</button><span>已有产品默认不选中，勾选后更新。</span></div>
    {message&&<div className="notice mapping-message">{message}</div>}
    {rows.length>0&&<><div className="product-workbook-table"><table><thead><tr><th>写入</th><th>来源</th><th>客户</th><th>货号</th><th>货名</th><th>每箱个数</th><th>类别</th><th>每箱毛重</th><th>每箱净重</th><th>状态</th></tr></thead><tbody>{rows.map((row,index)=><tr key={`${row.filename}-${row.rowNumber}-${index}`}>
      <td><input aria-label={`选择第 ${index+1} 行`} type="checkbox" checked={row.selected} onChange={event=>change(index,{selected:event.target.checked,updateExisting:!!row.existingId&&event.target.checked})}/></td>
      <td>{row.filename}<small>第 {row.rowNumber} 行</small></td>
      <td><input value={row.customer} onChange={event=>change(index,{customer:event.target.value})}/></td>
      <td><input value={row.productCode} onChange={event=>change(index,{productCode:event.target.value})}/></td>
      <td><input value={row.productName} onChange={event=>change(index,{productName:event.target.value})}/></td>
      <td><input type="number" min="1" step="1" value={row.quantityPerBox??""} onChange={event=>change(index,{quantityPerBox:event.target.value?Number(event.target.value):null})}/></td>
      <td><input value={row.toyCategory} onChange={event=>change(index,{toyCategory:event.target.value})}/></td>
      <td><input type="number" min="0.001" step="0.001" value={row.grossWeightPerBox??""} onChange={event=>change(index,{grossWeightPerBox:event.target.value?Number(event.target.value):null})}/></td>
      <td><input type="number" min="0.001" step="0.001" value={row.netWeightPerBox??""} onChange={event=>change(index,{netWeightPerBox:event.target.value?Number(event.target.value):null})}/></td>
      <td>{row.existingId?<><strong>已有，勾选后更新</strong><small>库中：{row.existingProduct?.customer} / {row.existingProduct?.productName||"无货名"}</small><small>类别 {row.existingProduct?.toyCategory||"—"}；每箱毛重 {row.existingProduct?.grossWeightPerBox??"—"}；净重 {row.existingProduct?.netWeightPerBox??"—"}</small></>:"新增"}{row.warnings.map(warning=><small key={warning}>{warning}</small>)}</td>
    </tr>)}</tbody></table></div><div className="product-workbook-footer"><span>共 {rows.length} 行，已选 {selectedCount} 行</span><button className="primary-button" disabled={busy||selectedCount===0} onClick={()=>void commit()}>{busy?"处理中…":"确认写入产品库"}</button></div></>}
  </div></div>;
}
