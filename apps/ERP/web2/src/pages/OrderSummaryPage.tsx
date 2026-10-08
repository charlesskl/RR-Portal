// 货号接单汇总表(装配部报表群;老系统 web/src/pages/production/OrderSummaryPage.tsx 重写):
// 关键字(货号/款式) + 共享查询表;货号点击/行双击跳 BOM物料设置 打开该货号(货号即款号)。
// 权限菜单=生产制单(MenuCatalog 实证:业务单据组;后端 ProductionReportController.cs:17)。
import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { useNavigate } from "react-router";
import { MagnifyingGlass, Printer, Prohibit } from "@phosphor-icons/react";
import { productionReportApi } from "@/api/endpoints";
import type { OrderSummaryRow } from "@/api/types";
import { usePerms } from "@/hooks/usePerms";
import { downloadCsv, printTable, type ExportCol } from "@/lib/tableExport";
import { DensitySwitch, QueryTable } from "@/components/doc/QueryTable";
import { DocEmpty } from "@/components/doc/DocEmpty";

const MENU = "生产制单";

const col = createColumnHelper<OrderSummaryRow>();

const exportCols: ExportCol[] = [
  { title: "货号", key: "货号" },
  { title: "款式", key: "款式" },
  { title: "接单数量", key: "接单数量" },
  { title: "订单数", key: "订单数" },
];

export default function OrderSummaryPage() {
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const navigate = useNavigate();

  const [kwInput, setKwInput] = useState("");
  const [keyword, setKeyword] = useState("");

  const q = useQuery({
    queryKey: ["order-summary", keyword],
    queryFn: () => productionReportApi.orderSummary(keyword || undefined),
    placeholderData: keepPreviousData,
    enabled: !permsLoading && canOpen,
  });
  const rows = useMemo(() => q.data ?? [], [q.data]);

  const go = (货号?: string) => {
    if (货号) navigate(`/bom-setup?款号=${encodeURIComponent(货号)}`);
  };

  const columns = useMemo(
    () => [
      col.accessor("货号", {
        header: "货号",
        size: 10,
        cell: (c) => (
          <button
            type="button"
            className="f-mono font-semibold text-[#1d4ed8] hover:underline"
            onClick={() => go(c.getValue())}
          >
            {c.getValue() ?? ""}
          </button>
        ),
      }),
      col.accessor("款式", { header: "款式", size: 14 }),
      col.accessor("接单数量", {
        header: "接单数量",
        size: 6,
        cell: (c) => c.getValue() ?? "",
        meta: { align: "right", tdClass: "f-mono px-3 py-2 text-right text-[#1a2330]" },
      }),
      col.accessor("订单数", {
        header: "订单数",
        size: 5,
        cell: (c) => c.getValue(),
        meta: { align: "right", tdClass: "f-mono px-3 py-2 text-right text-[#1a2330]" },
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  if (!permsLoading && !canOpen) {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问 货号接单汇总表"
            description="缺少「生产制单·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="f-page flex h-full flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">货号接单汇总表</h1>
        <DensitySwitch className="ml-auto" />
      </div>

      <div className="f-panel flex shrink-0 flex-wrap items-end gap-3 p-5">
        <div className="w-72 space-y-1.5">
          <label htmlFor="os-kw" className="f-label block">
            关键字
          </label>
          <input
            id="os-kw"
            className="f-input"
            placeholder="货号 / 款式"
            value={kwInput}
            onChange={(e) => setKwInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setKeyword(kwInput.trim())}
          />
        </div>
        <button
          type="button"
          className="f-btn f-btn-cyan px-5"
          onClick={() => setKeyword(kwInput.trim())}
        >
          <MagnifyingGlass className="h-4.5 w-4.5" />
          查询
        </button>
        <button
          type="button"
          className="f-btn px-5"
          disabled={!rows.length}
          onClick={() => downloadCsv("货号接单汇总表.csv", exportCols, rows as unknown as Record<string, unknown>[])}
        >
          导出EXCEL
        </button>
        <button
          type="button"
          className="f-btn px-5"
          disabled={!rows.length}
          onClick={() => printTable("货号接单汇总表", exportCols, rows as unknown as Record<string, unknown>[])}
        >
          <Printer className="h-4.5 w-4.5" />
          打印
        </button>
      </div>

      <QueryTable
        columns={columns}
        rows={rows}
        isLoading={q.isLoading}
        isError={q.isError}
        onRetry={() => q.refetch()}
        errorMessage="加载 货号接单汇总表 失败,请重试"
        emptyTitle="暂无数据"
        emptyDescription="当前关键字下没有接单记录"
        onRowDoubleClick={(r) => go(r.货号)}
        rowTitle={(r) => (r.货号 ? `双击打开 ${r.货号} 的 BOM物料设置` : undefined)}
        fill
        footer={<span>共 {rows.length} 条</span>}
      />
    </div>
  );
}
