import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";
import { rawMaterialDemandApi } from "@/api/endpoints";
import type { RawMoldingDemandSource } from "@/api/types";
import { usePerms } from "@/hooks/usePerms";
import { date10, printRawDoc } from "@/lib/rawDocs";
import { QueryTable } from "@/components/doc/QueryTable";
import { PickerDialog } from "@/components/doc/PickerDialog";

const col = createColumnHelper<RawMoldingDemandSource>();
const columns: ColumnDef<RawMoldingDemandSource, any>[] = [
  col.accessor("单号", { header: "啤机采购单号", size: 180 }),
  col.accessor("日期", { header: "订购日期", cell: c => date10(c.getValue()), size: 120 }),
  col.accessor("供应商名称", { header: "供应商", size: 180 }),
  col.accessor("需求数量KG", { header: "冻结净需求（KG）", cell: c => c.row.original.快照有效 === false ? "快照待完善" : c.getValue(), size: 160 }),
  col.accessor("原料种数", { header: "原料种数", size: 100 }),
  col.accessor("审核", { header: "源单状态", cell: c => c.getValue() === "1" ? "已审核" : "待审核", size: 110 }),
  col.accessor("限制原因", { header: "采购状态", cell: c => c.row.original.可采购 ? "可参与采购分析" : c.getValue() || "暂不可采购", size: 250 }),
];

export function RawMoldingDemandPanel({ menu }: { menu: string }) {
  const { can, loading } = usePerms();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [input, setInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [approvedOnly, setApprovedOnly] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const allowed = !loading && can(menu, "打开");
  const list = useQuery({ queryKey: ["raw-demand", "molding-sources", page, keyword, approvedOnly], queryFn: () => rawMaterialDemandApi.moldingSources(page, 20, keyword, approvedOnly), enabled: allowed });
  const detail = useQuery({ queryKey: ["raw-demand", "molding-source", selected], queryFn: () => rawMaterialDemandApi.moldingSource(selected!), enabled: allowed && !!selected });
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / 20));
  if (!loading && !allowed) return <p role="alert">缺少「{menu}·打开」权限，请联系管理员。</p>;
  return <div className="space-y-4">
    <p className="text-sm text-[#5f6b7d]">需求自动读取啤机采购单保存的原料净量。待审来源可查看，审核后参与采购；采购备料量不增加生产需求或领料净量。</p>
    <form className="f-panel flex flex-wrap items-end gap-3 p-4" onSubmit={e => { e.preventDefault(); setPage(1); setKeyword(input.trim()); }}>
      <label className="space-y-1"><span className="f-label block">啤机采购单 / 供应商 / 原料</span><input aria-label="自动需求关键字" className="f-input" value={input} onChange={e => setInput(e.target.value)} /></label>
      <label className="flex h-10 items-center gap-2 text-sm"><input type="checkbox" checked={approvedOnly} onChange={e => { setApprovedOnly(e.target.checked); setPage(1); }} />只看已审核</label>
      <button className="f-btn px-4" type="submit">查询</button>
      <button className="f-btn px-4" type="button" onClick={() => void list.refetch()}>刷新需求</button>
      {can("原料采购分析表", "打开") && <button className="f-btn f-btn-cyan px-4" type="button" onClick={() => navigate("/plastic-raw-material-purchase-analysis")}>查看库存与采购缺口</button>}
    </form>
    <QueryTable columns={[...columns, col.display({ id: "detail", header: "明细", cell: c => <button type="button" className="f-btn h-8 px-3" onClick={() => setSelected(c.row.original.单号)}>查看原料</button> })]} rows={list.data?.items ?? []} isLoading={list.isLoading} isError={list.isError} errorMessage="自动需求读取失败，请重试" onRetry={() => void list.refetch()} emptyTitle="暂无自动需求" emptyDescription="啤机采购单保存原料计算结果后，会自动显示在这里。" minWidth={1100} footer={<div className="flex items-center gap-3"><span>共 {list.data?.total ?? 0} 单</span><button className="f-btn px-3" disabled={page <= 1 || list.isFetching} onClick={() => setPage(p => p - 1)}>上一页</button><span>{page} / {pages}</span><button className="f-btn px-3" disabled={page >= pages || list.isFetching} onClick={() => setPage(p => p + 1)}>下一页</button></div>} />
    <PickerDialog open={!!selected} onClose={() => setSelected(null)} title={`啤机采购原料净需求 · ${selected ?? ""}`} width="sm:max-w-[1000px]">
      {detail.isLoading && <p role="status">正在读取保存的原料净量…</p>}
      {detail.isError && <div role="alert"><p>读取原料需求失败，未显示其他单据的明细。</p><button className="f-btn px-3" onClick={() => void detail.refetch()}>重试</button></div>}
      {detail.data && <>
        <p className="mb-3 text-sm text-[#5f6b7d]">{detail.data.单头.供应商名称} · {detail.data.单头.审核 === "1" ? "已审核" : "待审核"} · {detail.data.单头.限制原因 || "以下为源单保存的原料快照"}</p>
        <div className="overflow-auto"><table className="w-full min-w-[720px] text-sm"><thead><tr>{["原料编号", "原料名称", "净需求（KG）", "库存单位", "每库存单位（KG）", "库存单位数量"].map(h => <th className="px-3 py-2 text-left" key={h}>{h}</th>)}</tr></thead><tbody>{detail.data.明细.map(l => <tr key={l.原料编号} className="border-t border-black/8"><td className="px-3 py-2">{l.原料编号}</td><td>{l.原料名称}</td><td>{l.需求数量KG}</td><td>{l.库存单位 ?? "—"}</td><td>{l.每库存单位KG ?? "—"}</td><td>{l.需求库存数量 ?? "—"}</td></tr>)}</tbody></table></div>
        {can(menu, "打印") && <button type="button" className="f-btn mt-4 px-4" onClick={() => printRawDoc(`原料净需求 ${selected}`, { 单头: detail.data!.单头 as unknown as Record<string, unknown>, 明细: detail.data!.明细 as unknown as Record<string, unknown>[] }, { headItems: [["啤机采购单号", "单号"], ["供应商", "供应商名称"]], lineCols: [["原料编号", "原料编号"], ["原料名称", "原料名称"], ["净需求（KG）", "需求数量KG"], ["库存单位", "库存单位"], ["库存单位数量", "需求库存数量"]] })}>打印需求明细</button>}
      </>}
    </PickerDialog>
  </div>;
}
