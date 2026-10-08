// BOM订单制作(/material-order-make;来料仓采购管理;权限菜单=生产制单 打开,生成采购订单再校验「采购订单·保存」位;
// MenuCatalog.cs:15/17 实证)。对照老系统 web/src/pages/production/MaterialOrderMakePage.tsx:
// 物料订单制作工作表(需订数量>0 的待采购行),勾选行 + 可改订货数量(默认=需订数量),
// 「生成采购订单」按 生产单x供应商编号 分组逐张创建(缺供应商编号的行跳过并提示);
// 确认弹窗文案逐字;价格列(预算单价)按「采购订单·单价」位裁剪。
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MagnifyingGlass, Prohibit } from "@phosphor-icons/react";
import { productionReportApi, purchaseOrderApi } from "@/api/endpoints";
import type { OrderWorksheetRow } from "@/api/types";
import { usePerms } from "@/hooks/usePerms";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { DocToast } from "@/components/doc/DocToast";
import { ConfirmDialog } from "@/components/doc/ConfirmDialog";
import { DensitySwitch } from "@/components/doc/QueryTable";

const MENU = "生产制单";
const errMsg = (e: unknown, fallback: string) =>
  e instanceof Error && e.message ? e.message : fallback;
const PO_MENU = "采购订单";
const PAGE_SIZE = 50;

const num = (v?: number | null) => (v === null || v === undefined ? "" : v);

const inputCls =
  "h-10 border-black/10 bg-black/[0.04] text-[15px] text-[#1a2330] placeholder:text-disabled";
// 表头四律:sticky + 不透明白底 + z-10 + nowrap(本页为自定义表格:勾选列+可编辑订货数量)
const thCls =
  "f-label sticky top-0 z-10 border-b border-black/8 bg-white px-3 py-2.5 text-left font-medium whitespace-nowrap normal-case";

// 每行用 (生产单号|物料编号|顺位) 唯一键(同生产单同物料可能多行,附加索引;对照老系统 rowKey)
const rowKeyOf = (r: OrderWorksheetRow, i: number) =>
  `${r.生产单号 ?? ""}|${r.物料编号 ?? ""}|${i}`;

export default function MaterialOrderMakePage() {
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const canSavePO = can(PO_MENU, "保存");
  const maskPrice = !can(PO_MENU, "单价");

  const [kwInput, setKwInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [rows, setRows] = useState<OrderWorksheetRow[]>([]);
  const [page, setPage] = useState(1);
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string>>(new Set());
  // 可编辑订货数量:key -> 数量(默认=需订数量)
  const [qtyMap, setQtyMap] = useState<Record<string, number | null>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const listQuery = useQuery({
    queryKey: ["material-order-make", keyword],
    queryFn: () => productionReportApi.orderWorksheet(keyword || undefined),
    enabled: canOpen && !permsLoading,
  });

  // 数据到达后重置勾选与订货数量(对照老系统 load:selectedKeys 清空,qtyMap=需订数量)
  const [hydrated, setHydrated] = useState<OrderWorksheetRow[] | undefined>(undefined);
  if (listQuery.data && listQuery.data !== hydrated) {
    setHydrated(listQuery.data);
    setRows(listQuery.data);
    setSelectedKeys(new Set());
    setPage(1);
    const m: Record<string, number | null> = {};
    listQuery.data.forEach((r, i) => {
      m[rowKeyOf(r, i)] = r.需订数量 ?? null;
    });
    setQtyMap(m);
  }

  const search = () => setKeyword(kwInput.trim());

  const setQty = (key: string, v: number | null) => setQtyMap((prev) => ({ ...prev, [key]: v }));

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const allChecked =
    rows.length > 0 && rows.every((r, i) => selectedKeys.has(rowKeyOf(r, i)));

  // 勾选行按 (生产单号,供应商编号) 分组;缺供应商编号的行跳过并提示(对照老系统 generate)
  const selected = rows
    .map((r, i) => ({ r, key: rowKeyOf(r, i) }))
    .filter((x) => selectedKeys.has(x.key));
  const withSupplier = selected.filter((x) => (x.r.供应商编号 ?? "").trim() !== "");
  const skipped = selected.length - withSupplier.length;
  const groups = new Map<
    string,
    { 生产单号?: string; 供应商编号: string; 供应商名称?: string; rows: typeof withSupplier }
  >();
  for (const x of withSupplier) {
    const gk = `${x.r.生产单号 ?? ""}|${x.r.供应商编号}`;
    let g = groups.get(gk);
    if (!g) {
      g = {
        生产单号: x.r.生产单号,
        供应商编号: x.r.供应商编号!.trim(),
        供应商名称: x.r.供应商名称,
        rows: [],
      };
      groups.set(gk, g);
    }
    g.rows.push(x);
  }

  const generate = () => {
    if (selected.length === 0) {
      setToast({ text: "请先勾选要生成的物料行", tone: "err" });
      return;
    }
    if (withSupplier.length === 0) {
      setToast({ text: "勾选的物料行均缺少供应商编号，无法生成采购订单", tone: "err" });
      return;
    }
    setConfirmOpen(true);
  };

  const doGenerate = async () => {
    setConfirmOpen(false);
    setSubmitting(true);
    try {
      const created: string[] = [];
      for (const g of groups.values()) {
        const res = await purchaseOrderApi.create({
          生产单号: g.生产单号,
          供应商编号: g.供应商编号,
          供应商名称: g.供应商名称,
          明细: g.rows.map((x) => ({
            物料编号: x.r.物料编号 ?? "",
            物料名称: x.r.物料名称,
            规格: x.r.规格,
            颜色: x.r.颜色,
            单位: x.r.单位,
            数量: qtyMap[x.key] ?? x.r.需订数量 ?? 0,
            单价: x.r.预算单价 ?? undefined,
            预算数量: x.r.需订数量 ?? undefined,
          })),
        });
        created.push(res.单号);
      }
      setToast({ text: `已生成 ${created.length} 张采购订单：${created.join("、")}`, tone: "ok" });
      void listQuery.refetch();
    } catch (e) {
      setToast({ text: errMsg(e, "生成采购订单失败"), tone: "err" });
    } finally {
      setSubmitting(false);
    }
  };

  if (!permsLoading && !canOpen) {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问该页面"
            description="缺少「生产制单·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="f-page mx-auto max-w-[1500px] space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">BOM订单制作</h1>
        <DensitySwitch className="ml-auto" />
      </div>

      <div className="f-panel flex shrink-0 flex-wrap items-center gap-3 p-5">
        <div className="w-80">
          <Input
            aria-label="关键字"
            className={inputCls}
            placeholder="生产单号 / 款号 / 物料编号 / 物料名称"
            value={kwInput}
            onChange={(e) => setKwInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
          />
        </div>
        <button type="button" className="f-btn f-btn-cyan px-5" onClick={search}>
          <MagnifyingGlass className="h-4.5 w-4.5" />
          查询
        </button>
        <button
          type="button"
          className="f-btn f-btn-cyan px-5"
          disabled={!canSavePO || selectedKeys.size === 0 || submitting}
          onClick={generate}
        >
          {submitting ? "生成中..." : "生成采购订单"}
        </button>
        <span className="text-sm text-[#5f6b7d]">已选 {selectedKeys.size} 行</span>
      </div>

      <div className="f-panel flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-auto">
          <table data-freeze className="w-full min-w-[1500px] text-[15px]">
            <thead>
              <tr>
                <th className={cn(thCls, "w-10 text-center")}>
                  <Checkbox
                    aria-label="全选"
                    className="h-4.5 w-4.5 border-black/20 data-[state=checked]:border-[#16a34a] data-[state=checked]:bg-[#16a34a] data-[state=checked]:text-[#ffffff]"
                    checked={allChecked}
                    onCheckedChange={(v) =>
                      setSelectedKeys(
                        v ? new Set(rows.map((r, i) => rowKeyOf(r, i))) : new Set(),
                      )
                    }
                  />
                </th>
                {[
                  "生产单号",
                  "款号",
                  "物料编号",
                  "物料名称",
                  "规格",
                  "颜色",
                  "单位",
                  "总数量",
                  "库存数量",
                  "可用库存",
                  "需订数量",
                  "订货数量",
                  ...(maskPrice ? [] : ["预算单价"]),
                  "供应商名称",
                ].map((h) => (
                  <th
                    key={h}
                    className={cn(
                      thCls,
                      ["总数量", "库存数量", "可用库存", "需订数量", "订货数量", "预算单价"].includes(
                        h,
                      ) && "text-right",
                    )}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {listQuery.isLoading ? (
                <tr>
                  <td colSpan={14} className="px-3 py-8 text-center text-sm text-[#5f6b7d]">
                    加载中...
                  </td>
                </tr>
              ) : listQuery.isError ? (
                <tr>
                  <td colSpan={14} className="px-3 py-8 text-center text-sm text-[#dc2626]">
                    加载 物料订单制作 工作表失败
                  </td>
                </tr>
              ) : pageRows.length === 0 ? (
                <tr>
                  <td colSpan={14} className="px-3 py-8 text-center text-sm text-disabled">
                    暂无数据
                  </td>
                </tr>
              ) : (
                pageRows.map((r, pi) => {
                  const i = (page - 1) * PAGE_SIZE + pi;
                  const k = rowKeyOf(r, i);
                  return (
                    <tr key={k} className="border-b border-black/6 last:border-0">
                      <td className="px-3 py-1.5 text-center">
                        <Checkbox
                          aria-label={`选择 ${r.物料编号 ?? i + 1}`}
                          className="h-4.5 w-4.5 border-black/20 data-[state=checked]:border-[#16a34a] data-[state=checked]:bg-[#16a34a] data-[state=checked]:text-[#ffffff]"
                          checked={selectedKeys.has(k)}
                          onCheckedChange={() =>
                            setSelectedKeys((prev) => {
                              const next = new Set(prev);
                              if (next.has(k)) next.delete(k);
                              else next.add(k);
                              return next;
                            })
                          }
                        />
                      </td>
                      <td className="f-mono px-3 py-1.5 font-semibold whitespace-nowrap text-[#1a2330]">
                        {r.生产单号}
                      </td>
                      <td className="f-mono px-3 py-1.5 text-[#3d4a5c]">{r.款号}</td>
                      <td className="f-mono px-3 py-1.5 whitespace-nowrap text-[#3d4a5c]">
                        {r.物料编号}
                      </td>
                      <td className="px-3 py-1.5 text-[#3d4a5c]">{r.物料名称}</td>
                      <td className="px-3 py-1.5 text-[#3d4a5c]">{r.规格}</td>
                      <td className="px-3 py-1.5 text-[#3d4a5c]">{r.颜色}</td>
                      <td className="px-3 py-1.5 text-[#3d4a5c]">{r.单位}</td>
                      <td className="f-mono px-3 py-1.5 text-right text-[#3d4a5c]">{num(r.总数量)}</td>
                      <td className="f-mono px-3 py-1.5 text-right text-[#3d4a5c]">{num(r.库存数量)}</td>
                      <td className="f-mono px-3 py-1.5 text-right text-[#3d4a5c]">{num(r.可用库存)}</td>
                      <td className="f-mono px-3 py-1.5 text-right text-[#3d4a5c]">{num(r.需订数量)}</td>
                      <td className="px-2 py-1.5 text-right">
                        <Input
                          type="number"
                          min={0}
                          className="h-8 w-24 border-black/10 bg-black/[0.04] text-right text-sm"
                          aria-label={`订货数量 ${r.物料编号 ?? i + 1}`}
                          value={qtyMap[k] ?? ""}
                          onChange={(e) =>
                            setQty(k, e.target.value === "" ? null : Number(e.target.value))
                          }
                        />
                      </td>
                      {!maskPrice && (
                        <td className="f-mono px-3 py-1.5 text-right text-[#3d4a5c]">
                          {num(r.预算单价)}
                        </td>
                      )}
                      <td className="px-3 py-1.5 text-[#3d4a5c]">{r.供应商名称}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="f-mono flex shrink-0 items-center justify-between border-t border-black/8 bg-black/[0.03] px-4 py-2.5 text-sm text-[#5f6b7d]">
          <span>共 {rows.length} 条</span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              className="f-btn h-8 px-3 text-sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              上一页
            </button>
            <span>
              {page} / {totalPages}
            </span>
            <button
              type="button"
              className="f-btn h-8 px-3 text-sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
            </button>
          </span>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="生成采购订单"
        description={`将按生产单×供应商分组生成 ${groups.size} 张采购订单（共 ${withSupplier.length} 行物料${skipped > 0 ? `，另有 ${skipped} 行缺供应商编号将跳过` : ""}）。确认生成？`}
        confirmLabel="生成"
        onConfirm={() => void doGenerate()}
      />

      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </div>
  );
}
