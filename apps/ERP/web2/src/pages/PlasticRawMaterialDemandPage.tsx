import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";
import { rawMaterialDemandApi } from "@/api/endpoints";
import type { RMDHeader } from "@/api/types";
import { usePageSearchParams } from "@/hooks/usePageSearchParams";
import { usePerms } from "@/hooks/usePerms";
import { date10, printRawDoc } from "@/lib/rawDocs";
import { RawMoldingDemandPanel } from "@/components/doc/RawMoldingDemandPanel";
import { QueryTable } from "@/components/doc/QueryTable";
import { PickerDialog } from "@/components/doc/PickerDialog";

const MENU = "原料生产需求表";
const col = createColumnHelper<RMDHeader>();
const columns: ColumnDef<RMDHeader, any>[] = [
  col.accessor("单号", { header: "历史需求单号" }),
  col.accessor("啤机生产单号", { header: "原啤机生产单号" }),
  col.accessor("开单日期", { header: "日期", cell: c => date10(c.getValue()) }),
  col.accessor("制单人", { header: "制单人" }),
  col.accessor("生产车间", { header: "生产车间" }),
  col.accessor("数量KG", { header: "原需求（KG）" }),
  col.accessor("审核", { header: "原审核状态", cell: c => c.getValue() === "1" ? "已审核" : "未审核" }),
];

export default function PlasticRawMaterialDemandPage() {
  const { can, loading } = usePerms();
  const [params, setParams] = usePageSearchParams("/plastic-raw-material-demand");
  const [mode, setMode] = useState<"auto" | "history">("auto");
  const [selected, setSelected] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [input, setInput] = useState("");
  const open = params.get("open");
  useEffect(() => {
    if (!open) return;
    // 旧显式需求单链接继续读取原单，不按编号猜SP来源。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode("history"); setSelected(open);
    const next = new URLSearchParams(params); next.delete("open"); setParams(next, { replace: true });
  }, [open, params, setParams]);
  const allowed = !loading && can(MENU, "打开");
  const list = useQuery({ queryKey: ["raw-demand", "history", page, keyword], queryFn: () => rawMaterialDemandApi.list(page, 20, keyword), enabled: allowed && mode === "history" });
  const detail = useQuery({ queryKey: ["raw-demand", "history-detail", selected], queryFn: () => rawMaterialDemandApi.get(selected!), enabled: allowed && !!selected });
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / 20));
  if (!loading && !allowed) return <div className="p-7" role="alert">缺少「原料生产需求表·打开」权限，请联系管理员。</div>;
  return <div className="f-page space-y-4 p-5">
    <h1 className="text-2xl font-bold text-[#1a2330]">原料生产需求表</h1>
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="需求来源"><button role="tab" aria-selected={mode === "auto"} className="f-btn px-4" onClick={() => setMode("auto")}>啤机采购自动需求</button><button role="tab" aria-selected={mode === "history"} className="f-btn px-4" onClick={() => setMode("history")}>历史手工需求</button></div>
    {mode === "auto" ? <RawMoldingDemandPanel menu={MENU} /> : <>
      <p className="text-sm text-[#5f6b7d]">历史手工需求按原记录查询，不计入新的啤机采购自动需求，不重新换算历史数量。</p>
      <form className="flex flex-wrap gap-3" onSubmit={e => { e.preventDefault(); setPage(1); setKeyword(input.trim()); }}><input aria-label="历史需求关键字" className="f-input" placeholder="历史单号 / 生产车间" value={input} onChange={e => setInput(e.target.value)} /><button className="f-btn px-4" type="submit">查询历史</button></form>
      <QueryTable columns={[...columns, col.display({ id: "detail", header: "明细", cell: c => <button className="f-btn px-3" onClick={() => setSelected(c.row.original.单号 ?? null)}>查看原单</button> })]} rows={list.data?.items ?? []} isLoading={list.isLoading} isError={list.isError} onRetry={() => void list.refetch()} errorMessage="历史需求读取失败" emptyTitle="暂无历史需求" minWidth={900} footer={<div className="flex items-center gap-3"><span>共 {list.data?.total ?? 0} 单</span><button className="f-btn px-3" disabled={page <= 1 || list.isFetching} onClick={() => setPage(p => p - 1)}>上一页</button><span>{page} / {pages}</span><button className="f-btn px-3" disabled={page >= pages || list.isFetching} onClick={() => setPage(p => p + 1)}>下一页</button></div>} />
    </>}
    <PickerDialog open={!!selected} onClose={() => setSelected(null)} title={`历史需求原单 · ${selected ?? ""}`} width="sm:max-w-[1000px]">
      {detail.isLoading && <p role="status">正在读取原单…</p>}
      {detail.isError && <div role="alert">读取原单失败。<button className="f-btn px-3" onClick={() => void detail.refetch()}>重试</button></div>}
      {detail.data && <><p className="mb-3 text-sm">制单人：{detail.data.单头?.制单人} · 生产车间：{detail.data.单头?.生产车间} · {detail.data.单头?.备注}</p><div className="overflow-auto"><table className="w-full min-w-[700px] text-sm"><thead><tr>{["原料编号", "原料名称", "每包重量", "单位", "原需求（KG）", "原需求（包）", "备注"].map(h => <th className="px-3 py-2 text-left" key={h}>{h}</th>)}</tr></thead><tbody>{detail.data.明细.map((l, i) => <tr className="border-t border-black/8" key={l.id ?? i}><td className="px-3 py-2">{l.原料编号}</td><td>{l.原料名称}</td><td>{l.每包重量 ?? "—"}</td><td>{l.单位}</td><td>{l.需求数量KG}</td><td>{l.需求数量包}</td><td>{l.备注}</td></tr>)}</tbody></table></div>{can(MENU, "打印") && <button className="f-btn mt-4 px-4" onClick={() => printRawDoc(`历史原料需求 ${selected}`, detail.data! as unknown as { 单头: Record<string, unknown>; 明细: Record<string, unknown>[] }, { headItems: [["单号", "单号"], ["制单人", "制单人"]], lineCols: [["原料编号", "原料编号"], ["原料名称", "原料名称"], ["需求KG", "需求数量KG"], ["需求包", "需求数量包"], ["备注", "备注"]] })}>打印历史原单</button>}</>}
    </PickerDialog>
  </div>;
}
