// 成品库存(/finished-inventory)。对照老系统 web/src/pages/warehouse/FinishedInventoryPage.tsx:
// 仓库关键字查询(默认成品仓);库存表 客户/配件编号/产品货号/产品名称/产品装配名称/库存数量(负数红);
// 点配件编号开出入库流水弹窗(日期/单号/类型/入库/出库,结存按返回顺序累计 入-出,负红);
// 30s 轮询 + 窗口聚焦自动刷新(对照老系统 useAutoReload)。
// 权限菜单=成品库存(MenuCatalog.cs:28 实证:成品仓储组)。
import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";
import { MagnifyingGlass, Prohibit } from "@phosphor-icons/react";
import { finishedInventoryApi } from "@/api/endpoints";
import type { FinishedStockLedgerRow, FinishedStockRow } from "@/api/types";
import { usePerms } from "@/hooks/usePerms";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { DensitySwitch, QueryTable } from "@/components/doc/QueryTable";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { PickerDialog, pickerThCls } from "@/components/doc/PickerDialog";

const MENU = "成品库存";

type LedgerViewRow = FinishedStockLedgerRow & { 结存: number };

const col = createColumnHelper<FinishedStockRow>();

export default function FinishedInventoryPage() {
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const [kwInput, setKwInput] = useState("");
  const [仓库, set仓库] = useState("成品仓");
  const [ledgerKey, setLedgerKey] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ["finished-inventory", 仓库],
    queryFn: () => finishedInventoryApi.list(仓库),
    placeholderData: keepPreviousData,
    enabled: canOpen && !permsLoading && !!仓库,
    // 对照老系统 useAutoReload:切回本页/窗口聚焦/30秒轮询 自动刷新
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const rows = useMemo(() => listQuery.data ?? [], [listQuery.data]);

  const ledgerQuery = useQuery({
    queryKey: ["finished-inventory-ledger", 仓库, ledgerKey],
    queryFn: () => finishedInventoryApi.ledger(仓库, ledgerKey!),
    enabled: ledgerKey !== null,
  });
  // 结存:按返回顺序(后端已按 日期,单号 排序)累计 入-出(照抄老系统 ledgerView)
  const ledgerView = useMemo<LedgerViewRow[]>(() => {
    const out: LedgerViewRow[] = [];
    (ledgerQuery.data ?? []).forEach((r, i) => {
      const prev = i === 0 ? 0 : out[i - 1].结存;
      out.push({ ...r, 结存: prev + (r.入库数量 ?? 0) - (r.出库数量 ?? 0) });
    });
    return out;
  }, [ledgerQuery.data]);

  const columns: ColumnDef<FinishedStockRow, any>[] = [
    col.accessor("客户", { header: "客户", size: 10 }),
    col.accessor("配件编号", {
      header: "配件编号",
      size: 12,
      cell: (c) => (
        <button
          type="button"
          className="f-mono font-semibold text-[#15803d] hover:underline"
          onClick={() => setLedgerKey(c.getValue())}
        >
          {c.getValue()}
        </button>
      ),
      meta: { tdClass: "px-3 py-2 whitespace-nowrap" },
    }),
    col.accessor("产品货号", {
      header: "产品货号",
      size: 13,
      meta: { tdClass: "f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]" },
    }),
    col.accessor("产品名称", { header: "产品名称", size: 15 }),
    col.accessor("产品装配名称", { header: "产品装配名称", size: 16 }),
    col.accessor("库存数量", {
      header: "库存数量",
      size: 9,
      cell: (c) => (
        <span
          className={cn(
            "f-mono font-semibold",
            Number(c.getValue()) < 0 ? "text-[#dc2626]" : "text-[#1a2330]",
          )}
        >
          {Number(c.getValue() ?? 0).toLocaleString()}
        </span>
      ),
      meta: { align: "right", tdClass: "px-3 py-2 text-right whitespace-nowrap" },
    }),
  ];

  if (!permsLoading && !canOpen) {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问该页面"
            description="缺少「成品库存·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="f-page flex h-full flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">成品库存</h1>
        <span className="text-sm text-[#15803d]">查询记录:{rows.length}</span>
        <span className="rounded-full bg-black/6 px-2.5 py-1 text-xs font-semibold text-[#5f6b7d]">
          仓库:{仓库 || "(未指定)"}
        </span>
        <DensitySwitch className="ml-auto" />
      </div>

      <div className="f-panel flex shrink-0 flex-wrap items-end gap-3 p-5">
        <div className="w-56 space-y-1.5">
          <label htmlFor="fi-kw" className="f-label block">
            仓库
          </label>
          <Input
            id="fi-kw"
            className="h-10 border-black/10 bg-black/[0.04] text-[15px] text-[#1a2330] placeholder:text-disabled"
            placeholder="输入仓库查询"
            value={kwInput}
            onChange={(e) => setKwInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && set仓库(kwInput.trim())}
          />
        </div>
        <button
          type="button"
          className="f-btn f-btn-cyan px-5"
          onClick={() => set仓库(kwInput.trim())}
        >
          <MagnifyingGlass className="h-4.5 w-4.5" />
          查询
        </button>
      </div>

      <QueryTable
        columns={columns}
        rows={rows}
        isLoading={listQuery.isLoading}
        isError={listQuery.isError}
        onRetry={() => listQuery.refetch()}
        errorMessage="加载成品库存失败,请重试"
        emptyTitle="暂无数据"
        emptyDescription="当前仓库没有成品库存记录"
        fill
        minWidth={900}
        footer={
          <>
            <span>共 {rows.length} 条</span>
            <span>点配件编号可查看出入库流水</span>
          </>
        }
      />

      {/* 出入库流水弹窗(对照老系统 Modal;结存前端累计) */}
      <PickerDialog
        open={ledgerKey !== null}
        onClose={() => setLedgerKey(null)}
        title={`出入库流水 - ${ledgerKey ?? ""}(${仓库})`}
        width="sm:max-w-[760px]"
      >
        <div className="max-h-[60vh] overflow-auto rounded-lg border border-black/8">
          <table className="w-full text-sm">
            <thead>
              <tr>
                {["日期", "单号", "类型", "入库数量", "出库数量", "结存"].map((h) => (
                  <th
                    key={h}
                    className={cn(
                      pickerThCls,
                      (h === "入库数量" || h === "出库数量" || h === "结存") && "text-right",
                    )}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ledgerQuery.isLoading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-disabled">
                    加载中...
                  </td>
                </tr>
              ) : ledgerView.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-disabled">
                    暂无流水
                  </td>
                </tr>
              ) : (
                ledgerView.map((r, i) => (
                  <tr key={`${r.单号}|${r.类型}|${i}`} className="border-b border-black/6 last:border-0">
                    <td className="f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]">
                      {String(r.日期 ?? "").slice(0, 10)}
                    </td>
                    <td className="f-mono px-3 py-2 whitespace-nowrap font-semibold text-[#15803d]">
                      {r.单号 ?? ""}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-[#3d4a5c]">{r.类型}</td>
                    <td className="f-mono px-3 py-2 text-right text-[#1a2330]">
                      {(r.入库数量 ?? 0).toLocaleString()}
                    </td>
                    <td className="f-mono px-3 py-2 text-right text-[#1a2330]">
                      {(r.出库数量 ?? 0).toLocaleString()}
                    </td>
                    <td
                      className={cn(
                        "f-mono px-3 py-2 text-right font-semibold",
                        r.结存 < 0 ? "text-[#dc2626]" : "text-[#1a2330]",
                      )}
                    >
                      {r.结存.toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-2 px-1 text-sm text-[#5f6b7d]">共 {ledgerView.length} 条</div>
      </PickerDialog>
    </div>
  );
}
