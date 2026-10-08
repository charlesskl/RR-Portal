// 排期导入批次管理弹窗:批次列表 + 删除(级联删明细)
// 照抄老系统 web/src/pages/scheduling/ScheduleBatchesDrawer.tsx(Drawer -> Dialog)
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash } from "@phosphor-icons/react";
import { schedulingApi } from "@/api/endpoints";
import type { ScheduleBatch } from "@/api/types";
import { usePerms } from "@/hooks/usePerms";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DocToast } from "@/components/doc/DocToast";
import { ConfirmDialog } from "@/components/doc/ConfirmDialog";
import { DocEmpty } from "@/components/doc/DocEmpty";

// 权限菜单名:与后端 SchedulingController Menu 常量一致(不是菜单树叶子 label)
const MENU = "生产排期";

const fmtTime = (v?: string) => v?.replace("T", " ").slice(0, 19) ?? "-";
const errMsg = (e: unknown, fallback: string) =>
  e instanceof Error && e.message ? e.message : fallback;

export default function ScheduleBatchesDialog({
  open,
  onClose,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { can } = usePerms();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["scheduling-batches"],
    queryFn: () => schedulingApi.batches(),
    enabled: open,
  });
  const rows = q.data ?? [];
  const loading = q.isLoading;
  const [delTarget, setDelTarget] = useState<ScheduleBatch | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const remove = async (row: ScheduleBatch) => {
    setDelTarget(null);
    try {
      await schedulingApi.removeBatch(row.ID);
      qc.setQueryData<ScheduleBatch[]>(["scheduling-batches"], (rs) =>
        (rs ?? []).filter((x) => x.ID !== row.ID),
      );
      setToast({ text: "批次已删除", tone: "ok" });
      onChanged();
    } catch (e) {
      setToast({ text: errMsg(e, "删除失败"), tone: "err" });
    }
  };

  const COLS = ["批次", "排期客户", "文件名", "导入时间", "行数", "新增", "更新", "操作员", "操作"];

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden border-black/10 bg-white text-[#1a2330] sm:max-w-[880px]">
          <DialogHeader>
            <DialogTitle>排期导入批次</DialogTitle>
            <DialogDescription className="text-[#5f6b7d]">
              删除批次会级联删除该批次的全部排期行
            </DialogDescription>
          </DialogHeader>
          <div className="f-panel min-h-0 flex-1 overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-black/8 bg-black/[0.03]">
                  {COLS.map((c) => (
                    <th
                      key={c}
                      className={cn(
                        "f-label sticky top-0 z-10 bg-[#f7faf8] px-3 py-2.5 text-left font-medium whitespace-nowrap",
                        ["行数", "新增", "更新"].includes(c) && "text-right",
                      )}
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={COLS.length} className="px-3 py-8 text-center text-sm text-disabled">
                      加载中…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={COLS.length}>
                      <DocEmpty title="暂无导入批次" description="导入排期后这里会出现批次记录" />
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.ID} className="border-b border-black/6 last:border-0">
                      <td className="f-mono px-3 py-2 text-[#3d4a5c]">{r.ID}</td>
                      <td className="px-3 py-2 text-[#3d4a5c]">{r.排期客户 ?? "-"}</td>
                      <td className="max-w-56 truncate px-3 py-2 text-[#3d4a5c]" title={r.文件名}>
                        {r.文件名 ?? "-"}
                      </td>
                      <td className="f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]">
                        {fmtTime(r.导入日期)}
                      </td>
                      <td className="f-mono px-3 py-2 text-right text-[#3d4a5c]">{r.行数}</td>
                      <td className="f-mono px-3 py-2 text-right text-[#15803d]">{r.新增}</td>
                      <td className="f-mono px-3 py-2 text-right text-[#3d4a5c]">{r.更新}</td>
                      <td className="px-3 py-2 text-[#3d4a5c]">{r.操作员 ?? "-"}</td>
                      <td className="px-3 py-2">
                        {can(MENU, "删除") && (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-sm font-medium text-[#dc2626] hover:underline"
                            onClick={() => setDelTarget(r)}
                          >
                            <Trash className="h-3.5 w-3.5" />
                            删除
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>

      {/* 删除确认(老系统 Popconfirm) */}
      <ConfirmDialog
        open={delTarget !== null}
        onClose={() => setDelTarget(null)}
        title={`删除批次 #${delTarget?.ID} 及其全部 ${delTarget?.行数} 行排期?`}
        description="删除后不可恢复"
        onConfirm={() => delTarget && void remove(delTarget)}
      />
      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </>
  );
}
