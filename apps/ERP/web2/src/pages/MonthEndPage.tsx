// 库存月报表(库存月结;/month-end)。对照老系统 web/src/pages/warehouse/MonthEnd.tsx:
// 口径(成品/半成品/物料) + 月份 + 仓库筛选;执行月结/反月结(权限位 库存月结·功能/删除,
// MenuCatalog 实证:月结管理组「库存月结」);已结月份列表;维度列按口径切换,物料口径多 5 个金额列。
import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";
import { LockKey, LockKeyOpen, Prohibit } from "@phosphor-icons/react";
import { monthEndApi } from "@/api/endpoints";
import type { MonthEndRow } from "@/api/types";
import {
  currentMonthValue,
  dimColumns,
  moneyColumns,
  toYearMonth,
  type MonthEndKind,
} from "@/lib/monthEnd";
import { usePerms } from "@/hooks/usePerms";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/doc/ConfirmDialog";
import { DensitySwitch, QueryTable } from "@/components/doc/QueryTable";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { DocToast } from "@/components/doc/DocToast";
import { SearchSelect } from "@/components/doc/SearchSelect";

const MENU = "库存月结";
const KINDS: MonthEndKind[] = ["成品", "半成品", "物料"];

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "操作失败");

const col = createColumnHelper<MonthEndRow>();

export default function MonthEndPage() {
  const qc = useQueryClient();
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const canClose = can(MENU, "功能");
  const canReopen = can(MENU, "删除");

  const [kind, setKind] = useState<MonthEndKind>("成品");
  const [month, setMonth] = useState(currentMonthValue);
  const [仓库, set仓库] = useState("");
  const [confirm, setConfirm] = useState<"close" | "reopen" | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const 年月 = toYearMonth(month);

  const periodsQuery = useQuery({
    queryKey: ["month-end", "periods", kind],
    queryFn: () => monthEndApi.periods(kind),
    enabled: !permsLoading && canOpen,
  });

  const reportQuery = useQuery({
    queryKey: ["month-end", "report", 年月, kind, 仓库],
    queryFn: () => monthEndApi.report(年月, kind, 仓库.trim() || undefined),
    placeholderData: keepPreviousData,
    enabled: !permsLoading && canOpen && !!年月,
  });
  const rows = useMemo(() => reportQuery.data ?? [], [reportQuery.data]);

  // 列:维度列按口径切换 + 公共数量列 + 物料口径金额列(结存负数红;金额 null 显示 -)
  const columns = useMemo<ColumnDef<MonthEndRow, any>[]>(() => {
    const dims = dimColumns(kind).map((d) =>
      col.accessor((r) => r[d.key as keyof MonthEndRow], {
        id: d.key,
        header: d.title,
        size: d.key === "仓库" ? 8 : 9,
        cell: (c) => {
          const v = c.getValue();
          return v == null || v === "" ? "-" : String(v);
        },
        meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]" },
      }),
    );
    const nums: ColumnDef<MonthEndRow, any>[] = (
      [
        ["期初", "期初"],
        ["本期入", "本期入"],
        ["本期出", "本期出"],
        ["结存", "结存"],
      ] as const
    ).map(([id, title]) =>
      col.accessor(id as keyof MonthEndRow, {
        id,
        header: title,
        size: 7,
        cell: (c) => {
          const v = c.getValue() as number;
          return (
            <span
              className={cn(
                "f-mono",
                id === "结存" && "font-semibold",
                id === "结存" && v < 0 && "text-[#dc2626]",
              )}
            >
              {v}
            </span>
          );
        },
        meta: { align: "right", tdClass: "px-3 py-2 text-right whitespace-nowrap text-[#1a2330]" },
      }),
    );
    const moneys = moneyColumns(kind).map((m) =>
      col.accessor((r) => r[m.key as keyof MonthEndRow], {
        id: m.key,
        header: m.title,
        size: 8,
        cell: (c) => {
          const v = c.getValue();
          return v == null ? "-" : String(v);
        },
        meta: { align: "right", tdClass: "f-mono px-3 py-2 text-right whitespace-nowrap text-[#3d4a5c]" },
      }),
    );
    return [...dims, ...nums, ...moneys];
  }, [kind]);

  const doClose = async () => {
    if (!年月) return;
    setBusy(true);
    try {
      const r = await monthEndApi.close({ 年月, 口径: kind, 仓库: 仓库.trim() || undefined });
      setToast({ text: `月结完成:仓库 ${r.仓库.length} 个,明细 ${r.结数} 行`, tone: "ok" });
      setConfirm(null);
      void qc.invalidateQueries({ queryKey: ["month-end"] });
    } catch (e) {
      setToast({ text: errMsg(e) || "月结失败", tone: "err" });
    } finally {
      setBusy(false);
    }
  };
  const doReopen = async () => {
    if (!年月) return;
    setBusy(true);
    try {
      const r = await monthEndApi.reopen({ 年月, 口径: kind, 仓库: 仓库.trim() || undefined });
      setToast({ text: `反月结完成:删除 ${r.删数} 行`, tone: "ok" });
      setConfirm(null);
      void qc.invalidateQueries({ queryKey: ["month-end"] });
    } catch (e) {
      setToast({ text: errMsg(e) || "反月结失败", tone: "err" });
    } finally {
      setBusy(false);
    }
  };

  if (!permsLoading && !canOpen) {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问 库存月报表"
            description="缺少「库存月结·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="f-page flex h-full flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">库存月结</h1>
        <DensitySwitch className="ml-auto" />
      </div>

      {/* 筛选栏 + 月结操作 */}
      <div className="f-panel flex shrink-0 flex-wrap items-end gap-3 p-5">
        <div className="w-32 space-y-1.5">
          <label className="f-label block">
            口径
          </label>
          <SearchSelect
            ariaLabel="口径"
            value={kind}
            options={KINDS.map((k) => ({ value: k, label: k }))}
            onChange={(v) => setKind(v as MonthEndKind)}
          />
        </div>
        <div className="w-44 space-y-1.5">
          <label htmlFor="me-month" className="f-label block">
            月份
          </label>
          <input
            id="me-month"
            type="month"
            className="f-input"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </div>
        <div className="w-44 space-y-1.5">
          <label htmlFor="me-wh" className="f-label block">
            仓库(空=全部)
          </label>
          <input
            id="me-wh"
            className="f-input"
            placeholder="仓库(空=全部)"
            value={仓库}
            onChange={(e) => set仓库(e.target.value)}
          />
        </div>
        {canClose && (
          <button
            type="button"
            className="f-btn f-btn-cyan px-5"
            disabled={busy || !年月}
            onClick={() => setConfirm("close")}
          >
            <LockKey className="h-4.5 w-4.5" />
            执行月结
          </button>
        )}
        {canReopen && (
          <button
            type="button"
            className="f-btn px-5 text-[#dc2626]"
            disabled={busy || !年月}
            onClick={() => setConfirm("reopen")}
          >
            <LockKeyOpen className="h-4.5 w-4.5" />
            反月结
          </button>
        )}
        <span className="text-sm text-[#5f6b7d]">
          已结月份:{(periodsQuery.data ?? []).join("、") || "(无)"}
        </span>
      </div>

      {/* 月报表(共享查询表:虚拟滚动 + 密度三档 + sticky 表头内置) */}
      <QueryTable
        columns={columns}
        rows={rows}
        isLoading={reportQuery.isLoading}
        isError={reportQuery.isError}
        onRetry={() => reportQuery.refetch()}
        errorMessage="加载月报失败,请重试"
        emptyTitle="暂无数据"
        emptyDescription="该月份/口径下没有月结数据,可换月份或先「执行月结」"
        fill
        minWidth={1100}
        footer={<span>共 {rows.length} 条</span>}
      />

      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm === "close" ? `确认月结 ${年月} ${kind}?` : `确认反月结 ${年月} ${kind}?`}
        description={
          confirm === "close"
            ? "按当前口径与仓库快照库存,月结后该期间单据将被锁定"
            : "反月结将删除该期间的月结快照"
        }
        confirmLabel={busy ? "处理中..." : confirm === "close" ? "执行月结" : "反月结"}
        onConfirm={() => void (confirm === "close" ? doClose() : doReopen())}
      />

      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </div>
  );
}
