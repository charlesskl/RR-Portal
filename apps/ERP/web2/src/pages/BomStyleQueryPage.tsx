// BOM货号查询(工程部;老系统 web/src/pages/production/BomStyleQueryPage.tsx 重写):
// 筛选(款号/款式) + 共享查询表 + 按格式打印(货 号 资 料 查 询,printStyleQuery 契约
// 对照 web/src/__tests__/printStyleQuery.test.ts,web2 同名测试已移植)。
// 点款号跳 /bom-setup?款号=(BOM物料设置页打开该货号)。
// 权限菜单=生产制单(MenuCatalog 实证:业务单据组);单价列按「单价」位脱敏。
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { useNavigate } from "react-router";
import { MagnifyingGlass, Printer, Prohibit } from "@phosphor-icons/react";
import { bomQueryApi } from "@/api/endpoints";
import type { BomStyleRow } from "@/api/types";
import { usePerms } from "@/hooks/usePerms";
import { printStyleQuery } from "@/lib/printStyleQuery";
import { DensitySwitch, QueryTable } from "@/components/doc/QueryTable";
import { DocEmpty } from "@/components/doc/DocEmpty";

const MENU = "生产制单";

const col = createColumnHelper<BomStyleRow>();

export default function BomStyleQueryPage() {
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const priceHidden = !can(MENU, "单价");
  const navigate = useNavigate();

  const [kwInput, setKwInput] = useState("");
  const [keyword, setKeyword] = useState("");

  const q = useQuery({
    queryKey: ["bom-style-query", keyword],
    queryFn: () => bomQueryApi.bomStyles(keyword || undefined),
    enabled: !permsLoading && canOpen,
  });
  const rows = useMemo(() => q.data ?? [], [q.data]);

  const go = (款号?: string) => {
    if (款号) navigate(`/bom-setup?款号=${encodeURIComponent(款号)}`);
  };

  const columns = useMemo(
    () => [
      col.accessor("款号", {
        header: "款号",
        size: 180,
        cell: (c) => (
          <button
            type="button"
            className="f-mono font-semibold text-[#1d4ed8] hover:underline"
            onClick={() => go(c.getValue())}
          >
            {c.getValue()}
          </button>
        ),
      }),
      col.accessor("款式", {
        header: "款式",
        size: 280,
        cell: (c) => <span className="block truncate" title={c.getValue()}>{c.getValue() ?? ""}</span>,
      }),
      ...(priceHidden
        ? []
        : [
            col.accessor("单价", {
              header: "单价",
              size: 120,
              meta: { align: "right" },
              cell: (c) => <span className="f-mono block text-right">{c.getValue() ?? ""}</span>,
            }),
          ]),
      col.accessor("物料项数", {
        header: "物料项数",
        size: 110,
        meta: { align: "right" },
        cell: (c) => <span className="f-mono block text-right">{c.getValue()}</span>,
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [priceHidden],
  );

  if (!permsLoading && !canOpen) {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问 BOM货号查询"
            description="缺少「生产制单·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="f-page flex h-full flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">BOM货号查询</h1>
        <DensitySwitch className="ml-auto" />
      </div>

      <div className="f-panel flex shrink-0 flex-wrap items-end gap-3 p-5">
        <div className="w-72 space-y-1.5">
          <label htmlFor="bsq-kw" className="f-label block">
            关键字
          </label>
          <input
            id="bsq-kw"
            className="f-input"
            placeholder="款号 / 款式"
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
          onClick={() => printStyleQuery(rows, { hidePrice: priceHidden })}
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
        errorMessage="加载 BOM货号查询 失败,请重试"
        emptyTitle="暂无数据"
        emptyDescription="当前关键字下没有已做 BOM 的款号"
        onRowDoubleClick={(r) => go(r.款号)}
        rowTitle={(r) => (r.款号 ? `双击打开 ${r.款号} 的 BOM` : undefined)}
        fill
        defaultTdClass="truncate px-4 text-[#3d4a5c]"
        footer={<span>共 {rows.length} 条</span>}
      />
    </div>
  );
}
