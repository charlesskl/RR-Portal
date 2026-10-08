// 排期状态变更审核弹窗:待审核/已通过/已驳回 三个页签;
// 经理(含 admin)可对待审申请「通过」(状态落到排期行)/「驳回」(状态不变);
// 非经理只读查看(后端仍双重校验,非经理点审核会 409)。
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { schedulingApi } from "@/api/endpoints";
import { ApiError } from "@/lib/api";
import { txt } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PickerDialog } from "@/components/doc/PickerDialog";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusTag } from "./ScheduleImportDialog";

const TABS = ["待审核", "已通过", "已驳回"] as const;

const fmtDt = (v?: string) => (v ? v.slice(0, 16).replace("T", " ") : "-");

export default function ScheduleStatusReviewDialog({
  open,
  isManager,
  onClose,
}: {
  open: boolean;
  isManager: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<(typeof TABS)[number]>("待审核");
  const [err, setErr] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  const listQuery = useQuery({
    queryKey: ["scheduling-status-changes", tab],
    queryFn: () => schedulingApi.statusChanges(tab),
    enabled: open,
  });
  const rows = listQuery.data ?? [];

  const review = async (id: number, action: "approve" | "reject") => {
    setBusyId(id);
    setErr("");
    try {
      if (action === "approve") await schedulingApi.approveStatusChange(id);
      else await schedulingApi.rejectStatusChange(id);
      void qc.invalidateQueries({ queryKey: ["scheduling-status-changes"] });
      void qc.invalidateQueries({ queryKey: ["scheduling-status-pending"] });
      void qc.invalidateQueries({ queryKey: ["scheduling-list"] });
      void qc.invalidateQueries({ queryKey: ["scheduling-summary"] });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "操作失败,请检查网络后重试");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <PickerDialog open={open} onClose={onClose} title="排期状态变更审核" width="sm:max-w-[860px]">
      <div className="mb-3 flex items-center gap-1">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "h-8 rounded-lg px-3.5 text-sm transition-colors",
              tab === t
                ? "bg-[#16a34a]/12 font-semibold text-[#15803d]"
                : "text-[#5f6b7d] hover:text-[#3d4a5c]",
            )}
          >
            {t}
          </button>
        ))}
        {!isManager && (
          <span className="ml-auto text-xs text-[#5f6b7d]">仅经理可审核,当前为只读查看</span>
        )}
      </div>
      {err && <div className="mb-2 text-sm text-[#dc2626]">{err}</div>}
      <div className="max-h-[55vh] overflow-auto rounded-lg border border-black/8">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/8 bg-black/[0.03]">
              {["排期客户", "货号", "品名", "PO号", "状态变更", "申请人", "申请日期"].map((h) => (
                <th
                  key={h}
                  className="f-label sticky top-0 z-10 bg-[#f7faf8] px-3 py-2 text-left font-medium whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
              {tab === "待审核" && isManager && (
                <th className="f-label sticky top-0 z-10 bg-[#f7faf8] px-3 py-2 text-left font-medium whitespace-nowrap">
                  操作
                </th>
              )}
              {tab !== "待审核" && (
                <th className="f-label sticky top-0 z-10 bg-[#f7faf8] px-3 py-2 text-left font-medium whitespace-nowrap">
                  审核人 / 日期
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {listQuery.isLoading ? (
              <tr>
                <td colSpan={8} className="p-4">
                  <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-8 w-full bg-black/5" />
                    ))}
                  </div>
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-disabled">
                  暂无{tab}的状态变更申请
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.ID} className="border-b border-black/6 last:border-0">
                  <td className="px-3 py-2 text-[#3d4a5c]">{txt(r.排期客户)}</td>
                  <td className="f-mono px-3 py-2 font-semibold text-[#1a2330]">{txt(r.货号)}</td>
                  <td className="max-w-36 truncate px-3 py-2 text-[#3d4a5c]">{txt(r.品名)}</td>
                  <td className="f-mono px-3 py-2 text-[#3d4a5c]">{txt(r.PO号)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <StatusTag 状态={r.原状态} />
                    <span className="mx-1 text-disabled">→</span>
                    <StatusTag 状态={r.新状态} />
                  </td>
                  <td className="px-3 py-2 text-[#3d4a5c]">{txt(r.申请人)}</td>
                  <td className="f-mono px-3 py-2 text-[#5f6b7d]">{fmtDt(r.申请日期)}</td>
                  {tab === "待审核" && isManager && (
                    <td className="px-3 py-2 whitespace-nowrap">
                      <button
                        type="button"
                        className="mr-3 text-sm font-medium text-[#15803d] hover:underline disabled:opacity-50"
                        disabled={busyId === r.ID}
                        onClick={() => void review(r.ID, "approve")}
                      >
                        通过
                      </button>
                      <button
                        type="button"
                        className="text-sm font-medium text-[#dc2626] hover:underline disabled:opacity-50"
                        disabled={busyId === r.ID}
                        onClick={() => void review(r.ID, "reject")}
                      >
                        驳回
                      </button>
                    </td>
                  )}
                  {tab !== "待审核" && (
                    <td className="px-3 py-2 text-[#5f6b7d]">
                      {txt(r.审核人)} / {fmtDt(r.审核日期)}
                      {r.审核备注 ? ` · ${r.审核备注}` : ""}
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </PickerDialog>
  );
}
