"use client";
import { useComplaintData } from "@/components/data-provider";
import { DataTable, KpiCard, PageTitle, StatusBadge } from "@/components/ui";
import { percent } from "@/lib/stats";

export default function AIClassification(){
  const {records,primarySeriesLabel}=useComplaintData();const pending=records.filter(record=>!record.issueType);const classified=records.length-pending.length;
  return <><PageTitle title="AI 分类审核" description="展示已导入投诉中的待分类记录；接入 AI 前不会生成虚构建议。" action="审核下一条"/><div className="mb-4 grid gap-3 sm:grid-cols-3"><KpiCard label="等待分类" value={String(pending.length)} tone="accent" detail="来自已导入投诉"/><KpiCard label="已人工分类" value={String(classified)} tone="good" detail="已有问题类型"/><KpiCard label="分类覆盖率" value={percent(classified,records.length)} detail={`${classified} / ${records.length} 条`}/></div><div className="mb-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900"><b>人工确认控制：</b>AI 分类尚未接入。未来生成的建议必须经过人工确认或修改后，才能保存并进入统计。</div><DataTable columns={["投诉编号","英文投诉原文","主要系列","AI 建议","置信度","状态"]} rows={pending.map(record=>[record.sourceSubmissionId||record.id.slice(0,8),<span className="block max-w-xl whitespace-pre-wrap break-words" key="message">{record.complaintMessageOriginal}</span>,primarySeriesLabel(record.primarySeries),<StatusBadge key="suggestion" tone="neutral">等待 AI 建议</StatusBadge>,"—",<StatusBadge key="status" tone="warning">待人工处理</StatusBadge>])}/></>
}
