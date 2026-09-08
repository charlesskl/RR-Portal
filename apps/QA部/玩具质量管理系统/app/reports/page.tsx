"use client";
import { useMemo, useState } from "react";
import { utils, writeFile } from "xlsx";
import { DataTable, KpiCard, PageTitle, StatusBadge } from "@/components/ui";
import { useComplaintData } from "@/components/data-provider";
import { useAuth } from "@/components/auth-provider";
import type { CAPRecord, ComplaintRecord } from "@/lib/types";

const isOverdue=(cap:CAPRecord)=>cap.stage!=="已关闭"&&Boolean(cap.dueDate)&&cap.dueDate<new Date().toISOString().slice(0,10);
const topValue=(values:string[])=>Object.entries(values.reduce<Record<string,number>>((map,value)=>({...map,[value]:(map[value]||0)+1}),{})).sort((a,b)=>b[1]-a[1])[0]?.[0]||"暂无";
export default function Reports(){
  const {can}=useAuth();
  const {records,capRecords,issueTypeLabel,primarySeriesLabel}=useComplaintData();const current=new Date();
  const [year,setYear]=useState(String(current.getFullYear())),[month,setMonth]=useState(String(current.getMonth()+1));
  const years=useMemo(()=>[...new Set([String(current.getFullYear()),...records.map(record=>record.contactDate.slice(0,4)),...capRecords.map(cap=>cap.createdAt.slice(0,4))])].filter(Boolean).sort().reverse(),[records,capRecords,current]);
  const complaints=records.filter(record=>record.contactDate.startsWith(`${year}-${month.padStart(2,"0")}`));
  const caps=capRecords.filter(cap=>cap.createdAt.startsWith(`${year}-${month.padStart(2,"0")}`));const closed=caps.filter(cap=>cap.stage==="已关闭").length;
  const overview=[["统计期间",`${year} 年 ${month} 月`],["投诉总数",complaints.length],["已分类投诉数",complaints.filter(r=>r.issueType).length],["待分类投诉数",complaints.filter(r=>!r.issueType).length],["已关闭投诉数",complaints.filter(r=>r.capIds.some(id=>capRecords.find(cap=>cap.id===id)?.stage==="已关闭")).length],["CAP 总数",caps.length],["进行中 CAP 数",caps.length-closed],["逾期 CAP 数",caps.filter(isOverdue).length],["CAP 关闭率",`${caps.length?(closed/caps.length*100).toFixed(2):"0.00"}%`],["主要投诉类型",topValue(complaints.map(r=>issueTypeLabel(r.issueType)))],["主要产品系列",topValue(complaints.map(r=>primarySeriesLabel(r.primarySeries)))]];
  function exportExcel(){const book=utils.book_new();utils.book_append_sheet(book,utils.aoa_to_sheet([["指标","数值"],...overview]),"报告概览");utils.book_append_sheet(book,utils.json_to_sheet(complaints.map(record=>complaintRow(record,issueTypeLabel,primarySeriesLabel))),"投诉明细");utils.book_append_sheet(book,utils.json_to_sheet(caps.map(cap=>capRow(cap))),"CAP清单");writeFile(book,`ToyQMS-${year}-${month.padStart(2,"0")}-投诉与CAP报告.xlsx`)}
  return <><PageTitle title="报告中心" description="按年月汇总真实投诉与 CAP 数据，并导出标准 Excel 报告。" action={can("export_reports")?"导出当前报告":undefined} onAction={can("export_reports")?exportExcel:undefined}/>
    <div className="mb-5 flex flex-wrap gap-3"><select className="field" value={year} onChange={e=>setYear(e.target.value)}>{years.map(value=><option key={value} value={value}>{value} 年</option>)}</select><select className="field" value={month} onChange={e=>setMonth(e.target.value)}>{Array.from({length:12},(_,i)=>String(i+1)).map(value=><option key={value} value={value}>{value} 月</option>)}</select></div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><KpiCard label="投诉总数" value={String(complaints.length)}/><KpiCard label="已分类" value={String(complaints.filter(r=>r.issueType).length)} tone="good"/><KpiCard label="CAP 总数" value={String(caps.length)} tone="accent"/><KpiCard label="CAP 关闭率" value={`${caps.length?(closed/caps.length*100).toFixed(2):"0.00"}%`} tone="good"/></div>
    <div className="mt-5"><DataTable columns={["指标","数值"]} rows={overview.map(([label,value])=>[label,<b key={String(label)}>{value}</b>])}/></div>
    <div className="mt-5"><DataTable columns={["CAP 编号","问题描述","负责人","阶段","关联投诉","到期日"]} rows={caps.map(cap=>[cap.capNumber,cap.problemDescription,cap.owner,<StatusBadge key={cap.id} tone={cap.stage==="已关闭"?"good":isOverdue(cap)?"bad":"warning"}>{isOverdue(cap)?"已逾期":cap.stage}</StatusBadge>,cap.complaintIds.length,cap.dueDate])}/></div>
  </>;
}
function complaintRow(record:ComplaintRecord,issue:(name:string|null)=>string,series:(name:string)=>string){return {投诉ID:record.sourceSubmissionId||record.id,联络日期:record.contactDate,SKU:record.productSku,产品名称:record.productName||"",主要系列:series(record.primarySeries),问题类型:issue(record.issueType),国家:record.country,投诉内容:record.complaintMessageZhFinal||record.complaintMessageZhMachine||record.complaintMessageOriginal,关联CAP:record.capIds.join(", ")}}
function capRow(cap:CAPRecord){return {CAP编号:cap.capNumber,问题描述:cap.problemDescription,问题类型:cap.issueType,负责人:cap.owner,阶段:cap.stage,到期日:cap.dueDate,原因分析:cap.rootCauseAnalysis,纠正措施:cap.correctiveAction,预防措施:cap.preventiveAction,有效性验证:cap.effectivenessVerification,关联投诉数:cap.complaintIds.length,创建时间:cap.createdAt,更新时间:cap.updatedAt}}
