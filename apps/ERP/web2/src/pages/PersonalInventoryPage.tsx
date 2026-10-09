import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { ArrowClockwise, Export, Money, Package, Rows, Users } from "@phosphor-icons/react";
import { personalInventoryApi } from "@/api/endpoints";
import type { PersonalInventoryBatchRow } from "@/api/types";
import { fmtNum, txt } from "@/lib/format";
import { downloadCsv, type ExportCol } from "@/lib/tableExport";
import { QueryTable } from "@/components/doc/QueryTable";
import { cn } from "@/lib/utils";

// 个人库存金额表:当前剩余库存按「谁下单归谁」拆分(批次倒推 FIFO,先进先出消耗)。
// 期初/盘点盈余等无批次的结余归「期初结余」。

interface PersonRow {
  下单人: string;
  物料种数: number;
  批次数: number;
  剩余数量: number;
  库存金额: number | null;
}

const SCOPES = ["全部", "来料", "塑胶", "半成品"] as const;

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="f-panel flex min-w-52 flex-1 items-center gap-4 px-5 py-4">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#16a34a]/30 bg-[#16a34a]/10 text-[#15803d]">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="f-label">{label}</div>
        <div className="f-mono mt-1 truncate text-[26px] leading-8 font-bold text-[#1a2330]">
          {value}
        </div>
      </div>
    </div>
  );
}

const personCol = createColumnHelper<PersonRow>();
const personColumns = [
  personCol.accessor("下单人", {
    header: "下单人",
    size: 140,
    cell: (c) => <span className="font-semibold text-[#1a2330]">{txt(c.getValue())}</span>,
  }),
  personCol.accessor("物料种数", {
    header: "物料种数",
    size: 90,
    cell: (c) => <span className="f-mono">{fmtNum(c.getValue())}</span>,
  }),
  personCol.accessor("批次数", {
    header: "批次数",
    size: 90,
    cell: (c) => <span className="f-mono">{fmtNum(c.getValue())}</span>,
  }),
  personCol.accessor("剩余数量", {
    header: "剩余数量",
    size: 120,
    cell: (c) => <span className="f-mono">{fmtNum(c.getValue())}</span>,
  }),
  personCol.accessor("库存金额", {
    header: "库存金额",
    size: 140,
    cell: (c) => (
      <span className="f-mono font-semibold text-[#15803d]">
        {c.getValue() == null ? "—" : fmtNum(c.getValue()!, 2)}
      </span>
    ),
  }),
];

const batchCol = createColumnHelper<PersonalInventoryBatchRow>();
const batchColumns = [
  batchCol.accessor("范围", { header: "范围", size: 70, cell: (c) => txt(c.getValue()) }),
  batchCol.accessor("物料编号", {
    header: "物料编号",
    size: 110,
    cell: (c) => <span className="f-mono">{txt(c.getValue())}</span>,
  }),
  batchCol.accessor("物料名称", { header: "物料名称", size: 180, cell: (c) => txt(c.getValue()) }),
  batchCol.accessor("规格", { header: "规格", size: 110, cell: (c) => txt(c.getValue()) }),
  batchCol.accessor("颜色", { header: "颜色", size: 90, cell: (c) => txt(c.getValue()) }),
  batchCol.accessor("单位", { header: "单位", size: 60, cell: (c) => txt(c.getValue()) }),
  batchCol.accessor("批次数量", {
    header: "批次数量",
    size: 100,
    cell: (c) => <span className="f-mono">{fmtNum(c.getValue())}</span>,
  }),
  batchCol.accessor("剩余数量", {
    header: "剩余数量",
    size: 100,
    cell: (c) => (
      <span className="f-mono font-semibold text-[#1a2330]">{fmtNum(c.getValue())}</span>
    ),
  }),
  batchCol.accessor("单价", {
    header: "单价",
    size: 90,
    cell: (c) => (
      <span className="f-mono">{c.getValue() == null ? "—" : fmtNum(c.getValue()!, 4)}</span>
    ),
  }),
  batchCol.accessor("金额", {
    header: "金额",
    size: 110,
    cell: (c) => (
      <span className="f-mono font-semibold text-[#15803d]">
        {c.getValue() == null ? "—" : fmtNum(c.getValue()!, 2)}
      </span>
    ),
  }),
  batchCol.accessor("入仓单号", {
    header: "入仓单号",
    size: 140,
    cell: (c) => <span className="f-mono">{txt(c.getValue())}</span>,
  }),
  batchCol.accessor("订单单号", {
    header: "订单单号",
    size: 140,
    cell: (c) => <span className="f-mono">{txt(c.getValue())}</span>,
  }),
  batchCol.accessor("日期", {
    header: "入仓日期",
    size: 110,
    cell: (c) => {
      const v = c.getValue();
      return <span className="f-mono">{v ? v.slice(0, 10) : ""}</span>;
    },
  }),
  batchCol.accessor("仓库", { header: "仓库", size: 90, cell: (c) => txt(c.getValue()) }),
];

const exportCols: ExportCol[] = [
  { title: "范围", key: "范围" },
  { title: "下单人", key: "下单人" },
  { title: "物料编号", key: "物料编号" },
  { title: "物料名称", key: "物料名称" },
  { title: "规格", key: "规格" },
  { title: "颜色", key: "颜色" },
  { title: "单位", key: "单位" },
  { title: "批次数量", key: "批次数量", fmt: (v) => fmtNum(typeof v === "number" ? v : null, 2) },
  { title: "剩余数量", key: "剩余数量", fmt: (v) => fmtNum(typeof v === "number" ? v : null, 2) },
  { title: "单价", key: "单价", fmt: (v) => fmtNum(typeof v === "number" ? v : null, 4) },
  { title: "金额", key: "金额", fmt: (v) => fmtNum(typeof v === "number" ? v : null, 2) },
  { title: "入仓单号", key: "入仓单号" },
  { title: "订单单号", key: "订单单号" },
  { title: "入仓日期", key: "日期", fmt: (v) => (typeof v === "string" ? v.slice(0, 10) : "") },
  { title: "仓库", key: "仓库" },
];

export default function PersonalInventoryPage({ scope: fixedScope }: { scope?: string }) {
  const [scopeState, setScope] = useState<(typeof SCOPES)[number]>("全部");
  const scope = fixedScope ?? scopeState;
  const [person, setPerson] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["personal-inventory", scope],
    queryFn: () => personalInventoryApi.list(scope === "全部" ? undefined : scope),
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(() => q.data ?? [], [q.data]);

  const persons = useMemo<PersonRow[]>(() => {
    const map = new Map<string, PersonRow>();
    for (const r of rows) {
      let p = map.get(r.下单人);
      if (!p) {
        p = { 下单人: r.下单人, 物料种数: 0, 批次数: 0, 剩余数量: 0, 库存金额: null };
        map.set(r.下单人, p);
      }
      p.批次数 += 1;
      p.剩余数量 += r.剩余数量;
      if (r.金额 != null) p.库存金额 = (p.库存金额 ?? 0) + r.金额;
    }
    for (const p of map.values()) {
      p.物料种数 = new Set(rows.filter((r) => r.下单人 === p.下单人).map((r) => r.物料编号)).size;
    }
    return [...map.values()].sort((a, b) => (b.库存金额 ?? 0) - (a.库存金额 ?? 0));
  }, [rows]);

  const detail = useMemo(
    () => (person ? rows.filter((r) => r.下单人 === person) : rows),
    [rows, person],
  );

  const totalAmount = rows.reduce((s, r) => s + (r.金额 ?? 0), 0);
  const hasAmount = rows.some((r) => r.金额 != null);

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-lg font-bold text-[#1a2330]">
          {fixedScope ? `${fixedScope}个人库存金额表` : "个人库存金额表"}
        </h1>
        {!fixedScope && SCOPES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => { setScope(s); setPerson(null); }}
            className={cn(
              "rounded-full border px-3 py-1 text-sm",
              scope === s
                ? "border-[#16a34a] bg-[#16a34a]/10 font-semibold text-[#15803d]"
                : "border-[#e2e8f0] text-[#5a6472] hover:bg-[#f1f5f4]",
            )}
          >
            {s}
          </button>
        ))}
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={() => downloadCsv("个人库存金额表.csv", exportCols, detail as unknown as Record<string, unknown>[])}
            disabled={!detail.length}
            className="f-btn-ghost flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm"
          >
            <Export size={15} /> 导出
          </button>
          <button
            type="button"
            onClick={() => q.refetch()}
            className="f-btn-ghost flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm"
          >
            <ArrowClockwise size={15} /> 刷新
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <StatCard icon={<Money size={22} />} label="库存总金额" value={hasAmount ? fmtNum(totalAmount, 2) : "—"} />
        <StatCard icon={<Users size={22} />} label="涉及人数" value={fmtNum(persons.length)} />
        <StatCard icon={<Rows size={22} />} label="剩余批次数" value={fmtNum(rows.length)} />
        <StatCard icon={<Package size={22} />} label="物料种数" value={fmtNum(new Set(rows.map((r) => r.物料编号)).size)} />
      </div>

      <QueryTable
        columns={personColumns}
        rows={persons}
        isLoading={q.isLoading}
        isError={q.isError}
        onRetry={() => q.refetch()}
        emptyIcon={<Users size={40} />}
        emptyTitle="暂无库存归属数据"
        emptyDescription="当前没有剩余库存的入仓批次"
        onRowDoubleClick={(r) => setPerson((cur) => (cur === r.下单人 ? null : r.下单人))}
        rowTitle={(r) => `双击查看 ${r.下单人} 的批次明细`}
        maxHeight="32vh"
        minWidth={640}
      />

      <div className="flex min-h-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2 text-sm text-[#5a6472]">
          <span className="font-semibold text-[#1a2330]">批次明细</span>
          {person && (
            <>
              <span>
                只看 <b className="text-[#15803d]">{person}</b>
              </span>
              <button type="button" className="text-[#2563eb] underline" onClick={() => setPerson(null)}>
                清除筛选
              </button>
            </>
          )}
          <span className="ml-auto f-mono">{detail.length} 行</span>
        </div>
        <QueryTable
          columns={batchColumns}
          rows={detail}
          isLoading={q.isLoading}
          isError={q.isError}
          onRetry={() => q.refetch()}
          emptyIcon={<Package size={40} />}
          emptyTitle="没有批次明细"
          fill
          minWidth={1400}
        />
      </div>
    </div>
  );
}

// 按仓固定范围的包装页(三个菜单入口各看各仓;权限菜单同名:来料/塑胶/半成品个人库存金额表)
export const PersonalInventoryReceivePage = () => <PersonalInventoryPage scope="来料" />;
export const PersonalInventoryPlasticPage = () => <PersonalInventoryPage scope="塑胶" />;
export const PersonalInventorySemiPage = () => <PersonalInventoryPage scope="半成品" />;
