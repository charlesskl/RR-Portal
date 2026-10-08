// 按排期表(文件)分类视图:一张表 = 一个排期文件(批次),展开可见该文件里的货号明细;
// 关键字可按 货号/品名/PO号/文件名 反查"哪些货号在哪些排期表"。
// 照抄老系统 web/src/pages/scheduling/ScheduleFilesView.tsx(antd Table -> 原生表)
import { useState } from "react";
import { CaretDown, CaretRight, MagnifyingGlass } from "@phosphor-icons/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { schedulingApi } from "@/api/endpoints";
import type { ScheduleRow } from "@/api/types";
import { fmtNum, txt } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SearchSelect } from "@/components/doc/SearchSelect";
import { StatusTag } from "./ScheduleImportDialog";

const fmtDate = (v?: string) => (v ? v.slice(0, 10) : "-");
const fmtTime = (v?: string) => v?.replace("T", " ").slice(0, 19) ?? "-";

// 展开行:该排期表(批次)的货号明细
function BatchRows({ 批次ID }: { 批次ID: number }) {
  const q = useQuery({
    queryKey: ["scheduling-batch-rows", 批次ID],
    queryFn: () => schedulingApi.list({ 批次ID, page: 1, size: 1000 }),
  });
  const rows: ScheduleRow[] = q.data?.items ?? [];
  const COLS = ["状态", "货号", "品名", "数量", "走货期", "客户名称", "PO号", "工作表"];
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-black/8 bg-black/[0.03]">
          {COLS.map((c) => (
            <th
              key={c}
              className={cn(
                "f-label px-3 py-2 text-left font-medium whitespace-nowrap",
                c === "数量" && "text-right",
              )}
            >
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {q.isLoading ? (
          <tr>
            <td colSpan={COLS.length} className="px-3 py-6 text-center text-sm text-disabled">
              加载中…
            </td>
          </tr>
        ) : rows.length === 0 ? (
          <tr>
            <td colSpan={COLS.length} className="px-3 py-6 text-center text-sm text-disabled">
              该排期表没有明细行
            </td>
          </tr>
        ) : (
          rows.map((r) => (
            <tr key={r.ID} className="border-b border-black/6 last:border-0">
              <td className="px-3 py-1.5">
                <StatusTag 状态={r.状态} />
              </td>
              <td className="f-mono max-w-36 truncate px-3 py-1.5 font-semibold text-[#1a2330]">
                {txt(r.货号)}
              </td>
              <td className="max-w-44 truncate px-3 py-1.5 text-[#3d4a5c]" title={r.品名}>
                {txt(r.品名)}
              </td>
              <td className="f-mono px-3 py-1.5 text-right text-[#3d4a5c]">{fmtNum(r.数量, 0)}</td>
              <td className="f-mono px-3 py-1.5 whitespace-nowrap text-[#3d4a5c]">
                {fmtDate(r.走货期)}
              </td>
              <td className="max-w-44 truncate px-3 py-1.5 text-[#3d4a5c]" title={r.客户名称}>
                {txt(r.客户名称)}
              </td>
              <td className="f-mono max-w-36 truncate px-3 py-1.5 text-[#3d4a5c]" title={r.PO号}>
                {txt(r.PO号)}
              </td>
              <td className="max-w-24 truncate px-3 py-1.5 text-[#3d4a5c]">{txt(r.来源工作表)}</td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

export default function ScheduleFilesView({ customers }: { customers: string[] }) {
  const [排期客户, set排期客户] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const q = useQuery({
    queryKey: ["scheduling-files", 排期客户, keyword],
    queryFn: () => schedulingApi.files(排期客户 || undefined, keyword || undefined),
    placeholderData: keepPreviousData,
  });
  const rows = q.data ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-44">
          <SearchSelect
            ariaLabel="排期客户(文件视图)"
            className="h-10"
            value={排期客户}
            options={customers.map((c) => ({ value: c, label: c }))}
            placeholder="全部排期客户"
            clearLabel="全部排期客户"
            onChange={(v) => set排期客户(v)}
          />
        </div>
        <div className="w-72">
          <input
            className="f-input h-10 w-full"
            aria-label="反查排期表"
            placeholder="按 货号/品名/PO号/文件名 反查排期表"
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setKeyword(keywordInput.trim())}
          />
        </div>
        <button
          type="button"
          className="f-btn f-btn-cyan h-10 px-4"
          onClick={() => setKeyword(keywordInput.trim())}
        >
          <MagnifyingGlass className="h-4.5 w-4.5" />
          查询
        </button>
        <span className="text-xs text-[#5f6b7d]">展开某张排期表可看里面的货号明细</span>
      </div>

      <div className="f-panel min-h-0 flex-1 overflow-auto">
        <table className="w-full text-[15px]">
          <thead>
            <tr className="border-b border-black/8 bg-black/[0.03]">
              <th className="w-10 px-3 py-3" />
              {["排期客户", "排期表(文件名)", "行数", "货号数", "状态分布", "导入时间"].map((c) => (
                <th
                  key={c}
                  className={cn(
                    "f-label sticky top-0 z-10 bg-[#f7faf8] px-4 py-3 text-left font-medium whitespace-nowrap",
                    (c === "行数" || c === "货号数") && "text-right",
                  )}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {q.isLoading ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-sm text-disabled">
                  加载中…
                </td>
              </tr>
            ) : q.isError ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-sm">
                  <span className="text-[#dc2626]">加载排期表分类失败</span>
                  <button
                    type="button"
                    className="f-btn ml-3 h-9 px-3 text-sm"
                    onClick={() => q.refetch()}
                  >
                    重试
                  </button>
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-sm text-disabled">
                  暂无排期表,先导入一份客户排期
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <FileRow
                  key={r.ID}
                  row={r}
                  expanded={expandedId === r.ID}
                  onToggle={() => setExpandedId((id) => (id === r.ID ? null : r.ID))}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="f-mono shrink-0 text-sm text-[#5f6b7d]">共 {rows.length} 张排期表</div>
    </div>
  );
}

function FileRow({
  row: r,
  expanded,
  onToggle,
}: {
  row: import("@/api/types").ScheduleFile;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className="cursor-pointer border-b border-black/6 transition-colors hover:bg-black/[0.04]"
        onClick={onToggle}
      >
        <td className="px-3 py-2.5 text-disabled">
          {expanded ? <CaretDown className="h-4 w-4" /> : <CaretRight className="h-4 w-4" />}
        </td>
        <td className="px-4 py-2.5 text-[#3d4a5c]">{txt(r.排期客户)}</td>
        <td className="max-w-72 truncate px-4 py-2.5 text-[#1a2330]" title={r.文件名}>
          {txt(r.文件名)}
        </td>
        <td className="f-mono px-4 py-2.5 text-right text-[#3d4a5c]">{r.行数}</td>
        <td className="f-mono px-4 py-2.5 text-right text-[#3d4a5c]">{r.货号数}</td>
        <td className="px-4 py-2.5">
          <span className="flex gap-1.5 whitespace-nowrap">
            <StatusTag 状态={`在排 ${r.在排}`} />
            <StatusTag 状态={`已走货 ${r.已走货}`} />
            <StatusTag 状态={`已取消 ${r.已取消}`} />
          </span>
        </td>
        <td className="f-mono px-4 py-2.5 whitespace-nowrap text-[#3d4a5c]">
          {fmtTime(r.导入日期)}
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-black/6">
          <td colSpan={7} className="bg-black/[0.02] p-3">
            <BatchRows 批次ID={r.ID} />
          </td>
        </tr>
      )}
    </>
  );
}
