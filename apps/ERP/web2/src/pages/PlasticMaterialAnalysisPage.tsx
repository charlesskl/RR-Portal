// 塑胶采购分析(/plastic-material-analysis;权限菜单=塑胶物料单,MenuCatalog.cs:45 实证:塑胶采购组)。
// 对照老系统 web/src/pages/plastics/PlasticMaterialAnalysisPage.tsx:
// 上半区「生产单列表」(下啤机单):上/本/下月+起止+关键字,服务端分页 50,未保存/已保存分组;
//   点行(或「下啤机单」按钮)开塑胶采购订单新建抽屉;生产通知单必须已审核才能下单(未审核 toast 拦截);
// 下半区「加工件发外需求」(与啤机单同时下,不用等物料回来):选已审核生产单 -> 计算发外需求 -> 勾选需发数量>0 的行
//   (每行手填加工厂/单价,无「单价」位不出单价列)-> 生成加工采购单(已有加工单的行后端跳过)。
import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Calculator, MagnifyingGlass, Prohibit } from "@phosphor-icons/react";
import {
  factoriesApi,
  plasticMaterialDocApi,
  plasticProcessDemandApi,
  productionApi,
} from "@/api/endpoints";
import type { FactoryRow, PlasticOrderRow, PlasticProcessDemandRow } from "@/api/types";
import { monthRange, thisMonthRange } from "@/lib/purchaseReceipt";
import { shotsOf } from "@/lib/plasticPurchase";
import { usePerms } from "@/hooks/usePerms";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { DocToast } from "@/components/doc/DocToast";
import { SearchSelect } from "@/components/doc/SearchSelect";
import PlasticPurchaseOrderDrawer from "./PlasticPurchaseOrderDrawer";

const MENU = "塑胶物料单";
const PAGE_SIZE = 50;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "操作失败");
const d10 = (v?: string) => (v ? v.slice(0, 10) : "");

const inputCls =
  "h-10 border-black/10 bg-black/[0.04] text-[15px] text-[#1a2330] placeholder:text-disabled";
const thCls =
  "f-label sticky top-0 z-10 border-b border-black/8 bg-white px-3 py-2.5 text-left font-medium whitespace-nowrap normal-case";

// 需求行 + 每行手填的加工厂/单价(对照老系统 DemandRow)
type DemandRow = PlasticProcessDemandRow & { 加工厂编号?: string; 单价?: number | null };

export default function PlasticMaterialAnalysisPage() {
  const qc = useQueryClient();
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const canSave = can(MENU, "保存");
  const priceHidden = !can(MENU, "单价");

  const [range, setRange] = useState<{ 起: string; 止: string }>(thisMonthRange);
  const [kwInput, setKwInput] = useState("");
  const [applied, setApplied] = useState<{ keyword?: string; 起?: string; 止?: string }>({});
  const [page, setPage] = useState(1);
  // 下单情况分组:未保存(默认,待下单工作队列)/已保存(已下过采购单,可再开抽屉追加下单,行级防重)
  const [下单Tab, set下单Tab] = useState<"未下单" | "已下单">("未下单");
  const [drawerMo, setDrawerMo] = useState<string | undefined>(undefined);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // 加工件发外需求区块
  const [需求单号, set需求单号] = useState("");
  const [demandRows, setDemandRows] = useState<DemandRow[]>([]);
  const [demandLoading, setDemandLoading] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<number>>(new Set());
  const [creating, setCreating] = useState(false);

  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  // 生产单列表(塑胶采购分析;服务端分页;按下单情况分 未保存/已保存 两组)
  const ordersQuery = useQuery({
    queryKey: ["plastic-analysis", "orders", page, applied, 下单Tab],
    queryFn: () =>
      plasticMaterialDocApi.orders(applied.起, applied.止, applied.keyword, page, PAGE_SIZE, 下单Tab),
    enabled: canOpen && !permsLoading,
  });
  const orders = ordersQuery.data?.items ?? [];
  const total = ordersQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // 首屏默认本月(对照老系统 thisMonth 默认 + 首进加载)
  useEffect(() => {
    if (!canOpen || permsLoading) return;
    setApplied((a) => (a.起 ? a : { 起: range.起, 止: range.止 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canOpen, permsLoading]);

  // 已审核生产通知单(发外需求单号来源)+ 加工厂
  const processOrdersQuery = useQuery({
    queryKey: ["plastic-analysis", "process-orders"],
    queryFn: async () => (await productionApi.list(1, 200)).items.filter((o) => o.审核 === "1"),
    enabled: canOpen && !permsLoading,
  });
  const factoriesQuery = useQuery({
    queryKey: ["plastic-analysis", "factories"],
    queryFn: () => factoriesApi.list(1, 500),
    enabled: canOpen && !permsLoading,
  });
  const factories: FactoryRow[] = factoriesQuery.data?.items ?? [];

  // 计算加工件发外需求
  const calcDemand = useCallback(async () => {
    if (!需求单号) {
      setToast({ text: "请先选择生产单号", tone: "err" });
      return;
    }
    setDemandLoading(true);
    try {
      const rs = await plasticProcessDemandApi.demand(需求单号);
      setDemandRows(rs);
      setSelectedKeys(new Set());
    } catch (e) {
      setToast({ text: errMsg(e) || "计算发外需求失败", tone: "err" });
    } finally {
      setDemandLoading(false);
    }
  }, [需求单号]);

  const setDemandRow = (i: number, patch: Partial<DemandRow>) =>
    setDemandRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  // 生成加工采购单(仅提交勾选中需发数量>0 的行)
  const createOrders = async () => {
    if (!需求单号) return;
    const picked = demandRows.filter((_, i) => selectedKeys.has(i));
    const lines = picked.filter((r) => Number(r.需发数量) > 0);
    if (lines.length === 0) {
      setToast({ text: "请勾选需发数量大于 0 的行", tone: "err" });
      return;
    }
    const noFactory = lines.find((r) => !r.加工厂编号);
    if (noFactory) {
      setToast({ text: `物料 ${noFactory.物料编号 ?? ""} 未选择加工厂`, tone: "err" });
      return;
    }
    setCreating(true);
    try {
      const res = await plasticProcessDemandApi.createOrders(
        需求单号,
        lines.map((r) => ({
          款号: r.款号,
          物料编号: r.物料编号,
          物料名称: r.物料名称,
          颜色: r.颜色,
          工模编号: r.工模编号,
          加工内容: r.加工内容,
          加工次序: r.加工次序,
          加工字母: r.加工字母,
          数量: Math.round(Number(r.需发数量)),
          加工厂编号: String(r.加工厂编号),
          加工厂名称: factories.find((f) => String(f.加工厂编号) === String(r.加工厂编号))
            ?.加工厂名称,
          单价: r.单价 ?? null,
        })),
      );
      setToast({
        text:
          `已生成加工采购单:${res.单号列表.join("、") || "无"}` +
          (res.跳过 > 0 ? `,跳过 ${res.跳过} 行(已有加工单)` : ""),
        tone: "ok",
      });
      await calcDemand(); // 成功后重新计算需求
    } catch (e) {
      setToast({ text: errMsg(e) || "生成加工采购单失败", tone: "err" });
    } finally {
      setCreating(false);
    }
  };

  const search = () => {
    setPage(1);
    // 有关键字时不限日期(生产单可能在上月/更早,按单号找单不该被本月范围滤掉)
    const kw = kwInput.trim() || undefined;
    setApplied({
      keyword: kw,
      起: kw ? undefined : range.起 || undefined,
      止: kw ? undefined : range.止 || undefined,
    });
  };

  // 点行开采购下单抽屉;分析门:生产通知单必须已审核(对照老系统 openDrawer);
  // 已下过采购单的生产单可再开抽屉 追加/并行下单(订单同时进行,不用等物料回来;
  // 行级 已订数量 默认不勾+重复下单确认 防重复采购)
  const openDrawer = (r: PlasticOrderRow) => {
    if (!r.生产单号) return;
    if (r.审核 !== "1") {
      setToast({ text: `生产通知单 ${r.生产单号} 未审核,审核后才能采购下单`, tone: "err" });
      return;
    }
    setDrawerMo(r.生产单号);
    setDrawerOpen(true);
  };

  const numCell = (v?: number | null) => v ?? 0;

  if (!permsLoading && !canOpen) {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问该页面"
            description="缺少「塑胶物料单·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="f-page mx-auto flex max-w-[1500px] flex-col space-y-4 p-5">
      <div className="order-0">
        <h1 className="px-1 text-2xl font-bold text-[#1a2330]">塑胶采购分析</h1>
        <p className="mt-1 px-1 text-sm text-[#5f6b7d]">
          下方按生产单筛选下啤机单,需要加工的件在「加工件发外需求」发外——啤机/加工/来料可同时下单,不用等物料回来
        </p>
      </div>

      {/* 加工件发外需求:按已审核生产通知单计算,可勾选生成加工采购单(order-3:视觉放在最后) */}
      <div className="f-panel order-3 p-5">
        <div className="mb-3 text-sm font-semibold text-[#1a2330]">
          加工件发外需求(与啤机单同时下,不用等物料回来)
        </div>
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <div className="w-72 space-y-1.5">
            <label className="f-label block">
              生产单号(已审核)
            </label>
            <SearchSelect
              ariaLabel="生产单号(已审核)"
              value={需求单号}
              options={(processOrdersQuery.data ?? []).map((o) => ({
                value: String(o.生产单号),
                label: `${o.生产单号} ${o.款号 ?? ""}/${o.客户名称 ?? ""}`,
              }))}
              placeholder="请选择"
              clearLabel="请选择"
              onChange={(v) => set需求单号(v)}
            />
          </div>
          <button
            type="button"
            className="f-btn f-btn-cyan px-5"
            disabled={demandLoading}
            onClick={() => void calcDemand()}
          >
            <Calculator className="h-4.5 w-4.5" />
            计算发外需求
          </button>
          {canSave && (
            <button
              type="button"
              className="f-btn px-5"
              disabled={selectedKeys.size === 0 || creating}
              onClick={() => void createOrders()}
            >
              {creating ? "生成中..." : "生成加工采购单"}
            </button>
          )}
        </div>
        <div className="overflow-auto" style={{ maxHeight: "40vh" }}>
          <table data-freeze className="w-full min-w-[1250px] text-sm">
            <thead>
              <tr>
                <th className={cn(thCls, "w-10 text-center")} />
                {[
                  "工模编号",
                  "物料编号",
                  "物料名称",
                  "颜色",
                  "加工内容",
                  "加工次序",
                  "加工字母",
                  "需求量",
                  "白件库存",
                  "已发未回",
                  "需发数量",
                  "啤数",
                  "加工厂",
                  ...(priceHidden ? [] : ["单价"]),
                ].map((h) => (
                  <th
                    key={h}
                    className={cn(
                      thCls,
                      (h === "需求量" ||
                        h === "白件库存" ||
                        h === "已发未回" ||
                        h === "需发数量" ||
                        h === "啤数" ||
                        h === "单价") &&
                        "text-right",
                    )}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {demandLoading ? (
                <tr>
                  <td colSpan={priceHidden ? 14 : 15} className="px-3 py-6 text-center text-sm text-[#5f6b7d]">
                    计算中...
                  </td>
                </tr>
              ) : demandRows.length === 0 ? (
                <tr>
                  <td colSpan={priceHidden ? 14 : 15} className="px-3 py-6 text-center text-sm text-disabled">
                    选生产单号后点「计算发外需求」
                  </td>
                </tr>
              ) : (
                demandRows.map((r, i) => (
                  <tr key={`${r.物料编号 ?? ""}|${r.工模编号 ?? ""}`} className="border-b border-black/6 last:border-0">
                    <td className="px-3 py-1.5 text-center">
                      <Checkbox
                        aria-label={`选择 ${r.物料编号 ?? i + 1}`}
                        className="h-4.5 w-4.5 border-black/20 data-[state=checked]:border-[#16a34a] data-[state=checked]:bg-[#16a34a] data-[state=checked]:text-[#ffffff]"
                        checked={selectedKeys.has(i)}
                        onCheckedChange={() =>
                          setSelectedKeys((prev) => {
                            const next = new Set(prev);
                            if (next.has(i)) next.delete(i);
                            else next.add(i);
                            return next;
                          })
                        }
                      />
                    </td>
                    <td className="f-mono px-3 py-1.5 whitespace-nowrap text-[#3d4a5c]">{r.工模编号}</td>
                    <td className="f-mono px-3 py-1.5 font-semibold whitespace-nowrap text-[#1a2330]">
                      {r.物料编号}
                    </td>
                    <td className="px-3 py-1.5 text-[#3d4a5c]">{r.物料名称}</td>
                    <td className="px-3 py-1.5 text-[#3d4a5c]">{r.颜色}</td>
                    <td className="px-3 py-1.5 text-[#3d4a5c]">{r.加工内容}</td>
                    <td className="px-3 py-1.5 text-[#3d4a5c]">{r.加工次序 ?? ""}</td>
                    <td className="px-3 py-1.5 text-[#3d4a5c]">{r.加工字母}</td>
                    <td className="f-mono px-3 py-1.5 text-right text-[#3d4a5c]">{numCell(r.需求量)}</td>
                    <td className="f-mono px-3 py-1.5 text-right text-[#3d4a5c]">{numCell(r.白件库存)}</td>
                    <td className="f-mono px-3 py-1.5 text-right text-[#3d4a5c]">{numCell(r.已发未回)}</td>
                    <td className="f-mono px-3 py-1.5 text-right font-bold text-[#dc2626]">
                      {r.需发数量 != null ? numCell(Math.round(Number(r.需发数量))) : numCell(r.需发数量)}
                    </td>
                    <td className="f-mono px-3 py-1.5 text-right text-[#3d4a5c]">
                      {shotsOf(r.需发数量 ?? 0, r.出模数) ?? ""}
                    </td>
                    <td className="px-2 py-1.5">
                      <SearchSelect
                        ariaLabel={`加工厂 ${r.物料编号 ?? i + 1}`}
                        className="h-8 w-44 rounded-md border border-black/10 bg-black/[0.04] px-2 text-sm text-[#1a2330]"
                        value={r.加工厂编号 ?? ""}
                        options={factories.map((f) => ({
                          value: String(f.加工厂编号),
                          label: `${f.加工厂编号} ${f.加工厂名称 ?? ""}`,
                        }))}
                        placeholder="加工厂"
                        clearLabel="加工厂"
                        onChange={(v) => setDemandRow(i, { 加工厂编号: v || undefined })}
                      />
                    </td>
                    {!priceHidden && (
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          min={0}
                          aria-label={`单价 ${r.物料编号 ?? i + 1}`}
                          className="h-8 w-24 rounded-md border border-black/10 bg-black/[0.04] px-2 text-right text-sm text-[#1a2330]"
                          value={r.单价 ?? ""}
                          onChange={(e) =>
                            setDemandRow(i, {
                              单价: e.target.value === "" ? null : Number(e.target.value),
                            })
                          }
                        />
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 生产单列表(order-1 最前:点行或「下啤机单」按钮开采购下单抽屉;未审核拦截;已保存拦截重复下单) */}
      <div className="f-panel order-1 flex shrink-0 flex-wrap items-end gap-3 p-5">
        {/* 下单情况分组:未保存=还没下过采购单(可下单);已保存=已下过(可点行/追加下单 再开抽屉,行级已订防重) */}
        <div className="flex items-center gap-1 rounded-xl border border-black/8 bg-black/[0.03] p-1">
          {(["未下单", "已下单"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => {
                set下单Tab(v);
                setPage(1);
              }}
              className={cn(
                "h-9 rounded-lg px-4 text-sm transition-colors",
                下单Tab === v
                  ? "bg-[#16a34a]/12 font-semibold text-[#15803d]"
                  : "text-[#5f6b7d] hover:text-[#3d4a5c]",
              )}
            >
              {v === "未下单" ? "未保存" : "已保存"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-black/8 bg-black/[0.03] p-1">
          {[
            { label: "上月", off: -1 },
            { label: "本月", off: 0 },
            { label: "下月", off: 1 },
          ].map((b) => (
            <button
              key={b.label}
              type="button"
              className="h-9 rounded-lg px-4 text-sm text-[#5f6b7d] transition-colors hover:text-[#3d4a5c]"
              onClick={() => setRange(monthRange(b.off))}
            >
              {b.label}
            </button>
          ))}
        </div>
        <div className="space-y-1.5">
          <span className="f-label block">制单日期</span>
          <div className="flex items-center gap-2">
            <input
              type="date"
              aria-label="起"
              className="f-input w-38"
              value={range.起}
              onChange={(e) => setRange((r) => ({ ...r, 起: e.target.value }))}
            />
            <span className="text-[#5f6b7d]">~</span>
            <input
              type="date"
              aria-label="止"
              className="f-input w-38"
              value={range.止}
              onChange={(e) => setRange((r) => ({ ...r, 止: e.target.value }))}
            />
          </div>
        </div>
        <div className="w-64 space-y-1.5">
          <label htmlFor="pma-kw" className="f-label block">
            关键字(带关键字时不限日期)
          </label>
          <Input
            id="pma-kw"
            className={inputCls}
            placeholder="生产单号/款号/款式/客户/合同号"
            value={kwInput}
            onChange={(e) => setKwInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
          />
        </div>
        <button type="button" className="f-btn f-btn-cyan px-5" onClick={search}>
          <MagnifyingGlass className="h-4.5 w-4.5" />
          查询
        </button>
      </div>

      <div className="f-panel order-2 flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-auto">
          <table data-freeze className="w-full min-w-[1150px] text-[15px]">
            <thead>
              <tr>
                {["制单日期", "交货日期", "生产单号", "款号", "款式", "客户", "合同号", "计划数量", "审核", "下单"].map(
                  (h) => (
                    <th
                      key={h}
                      className={cn(thCls, h === "计划数量" && "text-right", (h === "审核" || h === "下单") && "text-center")}
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {ordersQuery.isLoading ? (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-sm text-[#5f6b7d]">
                    加载中...
                  </td>
                </tr>
              ) : ordersQuery.isError ? (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-sm text-[#dc2626]">
                    加载生产单失败
                  </td>
                </tr>
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-sm text-disabled">
                    暂无数据
                  </td>
                </tr>
              ) : (
                orders.map((r) => (
                  <tr
                    key={r.ID}
                    className="cursor-pointer border-b border-black/6 transition-colors last:border-0 hover:bg-black/[0.04]"
                    onClick={() => openDrawer(r)}
                    title={
                      r.已下单
                        ? `已保存采购单${r.采购单号 ? `:${r.采购单号}` : ""},点行可追加下单(行级已订防重)`
                        : r.审核 === "1"
                          ? `点击开塑胶采购订单(${r.生产单号})`
                          : "未审核,审核后才能采购下单"
                    }
                  >
                    <td className="f-mono px-3 py-2.5 whitespace-nowrap text-[#3d4a5c]">{d10(r.日期)}</td>
                    <td className="f-mono px-3 py-2.5 whitespace-nowrap text-[#3d4a5c]">{d10(r.交货日期)}</td>
                    <td className="f-mono px-3 py-2.5 font-semibold whitespace-nowrap text-[#15803d]">
                      {r.生产单号}
                    </td>
                    <td className="f-mono px-3 py-2.5 text-[#3d4a5c]">{r.款号}</td>
                    <td className="px-3 py-2.5 text-[#3d4a5c]">{r.款式}</td>
                    <td className="px-3 py-2.5 text-[#3d4a5c]">{r.客户名称}</td>
                    <td className="f-mono px-3 py-2.5 text-[#3d4a5c]">{r.合同号}</td>
                    <td className="f-mono px-3 py-2.5 text-right text-[#1a2330]">{r.计划数量 ?? 0}</td>
                    <td className="px-3 py-2.5 text-center">
                      {r.审核 === "1" ? (
                        <span className="inline-flex rounded-full border border-[#16a34a]/50 bg-[#16a34a]/10 px-2.5 py-1 text-xs font-semibold text-[#15803d]">
                          已审核
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-black/6 px-2.5 py-1 text-xs font-semibold text-[#5f6b7d]">
                          未审核
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {r.已下单 ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="inline-flex rounded-full border border-[#2563eb]/50 bg-[#2563eb]/10 px-2.5 py-1 text-xs font-semibold text-[#1d4ed8]"
                            title={r.采购单号 ? `采购单号:${r.采购单号}` : undefined}
                          >
                            已保存
                          </span>
                          {r.审核 === "1" && (
                            <button
                              type="button"
                              className="f-btn h-8 px-3 text-xs"
                              title={`对 ${r.生产单号} 追加下单(订单可并行,不用等物料回来)`}
                              onClick={(e) => {
                                e.stopPropagation();
                                openDrawer(r);
                              }}
                            >
                              追加下单
                            </button>
                          )}
                        </span>
                      ) : r.审核 === "1" ? (
                        <button
                          type="button"
                          className="f-btn f-btn-cyan h-8 px-3 text-xs"
                          title={`对 ${r.生产单号} 下啤机单`}
                          onClick={(e) => {
                            e.stopPropagation();
                            openDrawer(r);
                          }}
                        >
                          下啤机单
                        </button>
                      ) : (
                        <span
                          className="inline-flex rounded-full bg-black/6 px-2.5 py-1 text-xs font-semibold text-[#5f6b7d]"
                          title="未审核,审核后才能采购下单"
                        >
                          未保存
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="f-mono flex shrink-0 items-center justify-between border-t border-black/8 bg-black/[0.03] px-4 py-2.5 text-sm text-[#5f6b7d]">
          <span>共 {total} 条</span>
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

      {/* 塑胶采购订单新建抽屉(与采购订单页「二次加工下单」共用) */}
      <PlasticPurchaseOrderDrawer
        open={drawerOpen}
        生产单号={drawerMo}
        onClose={() => setDrawerOpen(false)}
        onSaved={() => {
          void qc.invalidateQueries({ queryKey: ["plastic-analysis"] });
        }}
      />

      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </div>
  );
}
