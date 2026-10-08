// 塑胶加工订单制作(/plastic-process-order-make;喷油部「喷油加工订单」;权限菜单=塑胶加工订单制作,
// MenuCatalog.cs:19 实证:发外加工组)。对照老系统 web/src/pages/plastics/PlasticProcessOrderMakePage.tsx:
// 上/本/下月 + 起止日期 + 关键字;主表 BOM 需求视图(可带入已接收喷油采购单,订购数量=订单数量);
// 「已下喷油订单」收件表(已审核塑胶采购订单中供应商含「喷油」的单,接收状态按单跨行合并);
// 「接收订单」弹窗按采购单号聚合,未接收可「接收并带入」。价格列按「单价」位裁剪。
// 30s 轮询+聚焦刷新对照老系统 useAutoReload(新下/新审核的喷油单自动出现)。
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MagnifyingGlass, Prohibit, TrayArrowDown, X } from "@phosphor-icons/react";
import { plasticProcessOrderMakeApi } from "@/api/endpoints";
import type { PlasticProcessOrderMakeRow } from "@/api/types";
import { monthRange, thisMonthRange } from "@/lib/purchaseReceipt";
import {
  bringSprayRows,
  groupSprayOrders,
  sprayRowSpanGroups,
} from "@/lib/processDocs";
import { downloadCsv, printTable, type ExportCol } from "@/lib/tableExport";
import { usePerms } from "@/hooks/usePerms";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { DocToast } from "@/components/doc/DocToast";
import { PickerDialog } from "@/components/doc/PickerDialog";
import { QueryTable, DensitySwitch } from "@/components/doc/QueryTable";
import { SearchSelect } from "@/components/doc/SearchSelect";
import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";

const MENU = "塑胶加工订单制作";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "操作失败");
const d10 = (v?: string) => (v ? v.slice(0, 10) : "");

const inputCls =
  "h-10 border-black/10 bg-black/[0.04] text-[15px] text-[#1a2330] placeholder:text-disabled";
// 表头四律:sticky + 不透明白底 + z-10 + nowrap(收件表为自定义表格:接收状态列跨行合并)
const thCls =
  "f-label sticky top-0 z-10 border-b border-black/8 bg-white px-3 py-2.5 text-left font-medium whitespace-nowrap normal-case";

const col = createColumnHelper<PlasticProcessOrderMakeRow>();

// 导出/打印列规格(对照老系统 exportCols;价格列按「单价」位裁剪)
function exportCols(priceHidden: boolean): ExportCol[] {
  return [
    { title: "单据日期", key: "单据日期", fmt: (v) => String(v ?? "").slice(0, 10) },
    { title: "生产单号", key: "生产单号" },
    { title: "款号", key: "款号" },
    { title: "塑胶货号", key: "塑胶货号" },
    { title: "工模编号", key: "工模编号" },
    { title: "物料编号", key: "物料编号" },
    { title: "物料名称", key: "物料名称" },
    { title: "颜色", key: "颜色" },
    { title: "色粉号", key: "色粉号" },
    { title: "加工内容", key: "加工内容" },
    { title: "二次加工类别", key: "二次加工类别" },
    { title: "加工次序", key: "加工次序" },
    { title: "加工字母", key: "加工字母" },
    { title: "用料名称", key: "用料名称" },
    { title: "单位", key: "单位" },
    { title: "用量", key: "用量" },
    { title: "计划数量", key: "计划数量" },
    { title: "订购数量", key: "订购数量" },
    ...(priceHidden
      ? []
      : ([{ title: "加工单价", key: "加工单价" }, { title: "金额", key: "金额" }] as ExportCol[])),
  ];
}

export default function PlasticProcessOrderMakePage() {
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const priceHidden = !can(MENU, "单价");

  const [range, setRange] = useState<{ 起: string; 止: string }>(thisMonthRange);
  const [kwInput, setKwInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [次序, set次序] = useState(""); // 加工次序列过滤(对照老系统 antd 列筛选:第一次/第二次)
  const [spo, setSpo] = useState<string | null>(null); // 带入的喷油采购单号
  const [recvOpen, setRecvOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const queryParams = { 起: range.起, 止: range.止, keyword: keyword || undefined };
  // 30s 轮询+聚焦刷新(对照老系统 useAutoReload)
  const mainQuery = useQuery({
    queryKey: ["process-order-make", queryParams],
    queryFn: () => plasticProcessOrderMakeApi.list(queryParams),
    enabled: canOpen && !permsLoading,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const recvQuery = useQuery({
    queryKey: ["process-order-make-recv", queryParams],
    queryFn: () => plasticProcessOrderMakeApi.received(queryParams),
    enabled: canOpen && !permsLoading,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const rows = useMemo(() => mainQuery.data ?? [], [mainQuery.data]);
  const recvRows = useMemo(() => recvQuery.data ?? [], [recvQuery.data]);

  // 带入已接收的喷油采购单:带入后展示该单明细(订购数量=订单数量),清除回到 BOM 需求视图
  const demandRows = useMemo<PlasticProcessOrderMakeRow[]>(
    () => (spo ? bringSprayRows(recvRows, spo) : rows),
    [spo, recvRows, rows],
  );
  const shownRows = useMemo(
    () => (次序 ? demandRows.filter((r) => (r.加工次序 ?? "") === 次序) : demandRows),
    [demandRows, 次序],
  );

  const recvGroups = useMemo(() => sprayRowSpanGroups(recvRows), [recvRows]);
  const spoGroups = useMemo(() => groupSprayOrders(recvRows), [recvRows]);

  // 接收(未接收时)并把该单带入上方制作表
  const receiveAndBring = async (g: { 单号: string; 接收?: string }) => {
    if (g.接收 !== "1") {
      try {
        await plasticProcessOrderMakeApi.receive(g.单号);
        setToast({ text: `已接收 ${g.单号}`, tone: "ok" });
      } catch (e) {
        setToast({ text: errMsg(e) || "接收失败", tone: "err" });
        return;
      }
    }
    setSpo(g.单号);
    setRecvOpen(false);
    void recvQuery.refetch();
  };

  const search = () => setKeyword(kwInput.trim());

  const columns = useMemo<ColumnDef<PlasticProcessOrderMakeRow, any>[]>(() => {
    const numCell = (v?: number | null) => (
      <span className="f-mono">{v ?? ""}</span>
    );
    return [
      col.accessor("单据日期", { header: "单据日期", size: 8, cell: (c) => d10(c.getValue()) }),
      col.accessor("生产单号", {
        header: "生产单号",
        size: 10,
        cell: (c) => <span className="f-mono font-semibold text-[#1a2330]">{c.getValue()}</span>,
      }),
      col.accessor("款号", { header: "款号", size: 8 }),
      col.accessor("塑胶货号", { header: "塑胶货号", size: 8 }),
      col.accessor("工模编号", { header: "工模编号", size: 8 }),
      col.accessor("物料编号", { header: "物料编号", size: 9 }),
      col.accessor("物料名称", { header: "物料名称", size: 10 }),
      col.accessor("颜色", { header: "颜色", size: 8 }),
      col.accessor("色粉号", { header: "色粉号", size: 8 }),
      col.accessor("加工内容", { header: "加工内容", size: 9 }),
      col.accessor("二次加工类别", { header: "二次加工类别", size: 8, cell: (c) => c.getValue() ?? "" }),
      col.accessor("加工次序", { header: "加工次序", size: 7, cell: (c) => c.getValue() ?? "" }),
      col.accessor("加工字母", { header: "加工字母", size: 6, cell: (c) => c.getValue() ?? "" }),
      col.accessor("用料名称", { header: "用料名称", size: 9 }),
      col.accessor("单位", { header: "单位", size: 5 }),
      col.accessor("用量", { header: "用量", size: 7, cell: (c) => numCell(c.getValue()), meta: { align: "right" } }),
      col.accessor("计划数量", { header: "计划数量", size: 7, cell: (c) => numCell(c.getValue()), meta: { align: "right" } }),
      col.accessor("订购数量", { header: "订购数量", size: 7, cell: (c) => numCell(c.getValue()), meta: { align: "right" } }),
      ...(priceHidden
        ? []
        : [
            col.accessor("加工单价", { header: "加工单价", size: 8, cell: (c) => numCell(c.getValue()), meta: { align: "right" } }),
            col.accessor("金额", {
              header: "金额",
              size: 8,
              cell: (c) => {
                const v = c.getValue();
                return <span className="f-mono">{v == null ? "" : Number(v).toFixed(2)}</span>;
              },
              meta: { align: "right" },
            }),
          ]),
    ] as ColumnDef<PlasticProcessOrderMakeRow, any>[];
  }, [priceHidden]);

  if (!permsLoading && !canOpen) {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问该页面"
            description="缺少「塑胶加工订单制作·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="f-page mx-auto max-w-[1500px] space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">塑胶加工订单制作</h1>
        <DensitySwitch className="ml-auto" />
      </div>

      {/* 筛选栏(对照老系统 Space 工具行) */}
      <div className="f-panel flex shrink-0 flex-wrap items-end gap-3 p-5">
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
          <span className="f-label block">单据日期</span>
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
        <div className="w-60 space-y-1.5">
          <label htmlFor="pom-kw" className="f-label block">
            关键字
          </label>
          <Input
            id="pom-kw"
            className={inputCls}
            placeholder="生产单号/款号/物料"
            value={kwInput}
            onChange={(e) => setKwInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
          />
        </div>
        <button type="button" className="f-btn f-btn-cyan px-5" onClick={search}>
          <MagnifyingGlass className="h-4.5 w-4.5" />
          查询
        </button>
        <div className="space-y-1.5">
          <span className="f-label block">加工次序</span>
          <SearchSelect
            ariaLabel="加工次序筛选"
            className="w-28"
            value={次序}
            options={["第一次", "第二次"].map((v) => ({ value: v, label: v }))}
            placeholder="全部"
            clearLabel="全部"
            onChange={(v) => set次序(v)}
          />
        </div>
        <button
          type="button"
          className="f-btn f-btn-cyan px-5"
          onClick={() => setRecvOpen(true)}
        >
          <TrayArrowDown className="h-4.5 w-4.5" />
          接收订单
        </button>
        {spo && (
          <span className="inline-flex items-center gap-2 rounded-full border border-[#2563eb]/50 bg-[#2563eb]/10 px-3 py-1.5 text-sm font-semibold text-[#2563eb]">
            已带入 {spo}
            <button type="button" aria-label="清除带入" onClick={() => setSpo(null)}>
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        )}
        <button
          type="button"
          className="f-btn px-5"
          disabled={shownRows.length === 0}
          onClick={() =>
            downloadCsv(
              "塑胶加工订单制作.csv",
              exportCols(priceHidden),
              shownRows as unknown as Record<string, unknown>[],
            )
          }
        >
          导出EXCEL
        </button>
        <button
          type="button"
          className="f-btn px-5"
          disabled={shownRows.length === 0}
          onClick={() =>
            printTable(
              "塑胶加工订单制作",
              exportCols(priceHidden),
              shownRows as unknown as Record<string, unknown>[],
            )
          }
        >
          打印
        </button>
        <span className="text-sm text-[#5f6b7d]">共 {shownRows.length} 条</span>
      </div>

      {/* 制作表(BOM 需求视图 / 带入喷油单明细) */}
      <QueryTable
        columns={columns}
        rows={shownRows}
        isLoading={mainQuery.isLoading}
        isError={mainQuery.isError}
        onRetry={() => void mainQuery.refetch()}
        errorMessage="加载塑胶加工订单制作失败"
        emptyTitle="暂无数据"
        emptyDescription="本月没有塑胶加工需求;可点「接收订单」带入已下喷油订单"
        minWidth={1900}
      />

      {/* 已下喷油订单(收件;接收状态按采购单号跨行合并) */}
      <div className="f-panel overflow-hidden">
        <div className="border-b border-black/8 px-4 py-2.5 text-sm font-semibold text-[#1a2330]">
          已下喷油订单({recvRows.length})
        </div>
        <div className="overflow-auto" style={{ maxHeight: "40vh" }}>
          <table data-freeze className="w-full min-w-[1700px] text-[15px]">
            <thead>
              <tr>
                {[
                  "采购单号",
                  "单据日期",
                  "交货日期",
                  "供应商",
                  "生产单号",
                  "款号",
                  "物料编号",
                  "物料名称",
                  "模具编号",
                  "颜色",
                  "色粉号",
                  "用料名称",
                  "数量",
                  "加工内容",
                  "备注",
                  "接收状态",
                ].map((h) => (
                  <th key={h} className={cn(thCls, h === "数量" && "text-right")}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recvQuery.isLoading ? (
                <tr>
                  <td colSpan={16} className="px-3 py-6 text-center text-sm text-[#5f6b7d]">
                    加载中...
                  </td>
                </tr>
              ) : recvQuery.isError ? (
                <tr>
                  <td colSpan={16} className="px-3 py-6 text-center text-sm text-[#dc2626]">
                    加载已下喷油订单失败
                  </td>
                </tr>
              ) : recvRows.length === 0 ? (
                <tr>
                  <td colSpan={16} className="px-3 py-6 text-center text-sm text-disabled">
                    暂无已下喷油订单
                  </td>
                </tr>
              ) : (
                recvRows.map((r, i) => {
                  const g = recvGroups.get(r.采购单号 ?? "");
                  const isFirst = g?.first === i;
                  return (
                    <tr key={`${r.采购单号 ?? ""}|${r.生产单号 ?? ""}|${r.物料编号 ?? ""}|${r.颜色 ?? ""}`} className="border-b border-black/6 last:border-0">
                      <td className="f-mono px-3 py-2 font-semibold whitespace-nowrap text-[#1a2330]">
                        {r.采购单号}
                      </td>
                      <td className="f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]">
                        {d10(r.单据日期)}
                      </td>
                      <td className="f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]">
                        {d10(r.交货日期)}
                      </td>
                      <td className="px-3 py-2 text-[#3d4a5c]">{r.供应商名称 ?? ""}</td>
                      <td className="f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]">
                        {r.生产单号}
                      </td>
                      <td className="px-3 py-2 text-[#3d4a5c]">{r.款号}</td>
                      <td className="f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]">
                        {r.物料编号}
                      </td>
                      <td className="px-3 py-2 text-[#3d4a5c]">{r.物料名称}</td>
                      <td className="px-3 py-2 text-[#3d4a5c]">{r.模具编号}</td>
                      <td className="px-3 py-2 text-[#3d4a5c]">{r.颜色}</td>
                      <td className="px-3 py-2 text-[#3d4a5c]">{r.色粉号}</td>
                      <td className="px-3 py-2 text-[#3d4a5c]">{r.用料名称}</td>
                      <td className="f-mono px-3 py-2 text-right text-[#3d4a5c]">
                        {r.数量 ?? ""}
                      </td>
                      <td className="px-3 py-2 text-[#3d4a5c]">{r.加工内容}</td>
                      <td className="px-3 py-2 text-[#3d4a5c]">{r.备注}</td>
                      {isFirst && (
                        <td rowSpan={g!.count} className="border-l border-black/6 px-3 py-2 align-middle">
                          {r.喷油接收 === "1" ? (
                            <span className="inline-flex rounded-full border border-[#16a34a]/50 bg-[#16a34a]/10 px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-[#15803d]">
                              已接收 {r.喷油接收人 ?? ""}{" "}
                              {r.喷油接收时间?.slice(0, 16).replace("T", " ") ?? ""}
                            </span>
                          ) : (
                            <span className="inline-flex rounded-full border border-[#b45309]/40 bg-[#b45309]/10 px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-[#b45309]">
                              待接收
                            </span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 接收订单弹窗(塑胶仓已审核的喷油采购单按单聚合;未接收可「接收并带入」) */}
      <PickerDialog
        open={recvOpen}
        onClose={() => setRecvOpen(false)}
        title="接收订单(塑胶仓已审核的喷油采购单)"
        width="sm:max-w-[860px]"
      >
        <table className="w-full text-[15px]">
          <thead>
            <tr>
              {["采购单号", "供应商", "单据日期", "交货日期", "行数", "数量合计", "状态", "操作"].map(
                (h) => (
                  <th
                    key={h}
                    className={cn(thCls, (h === "行数" || h === "数量合计") && "text-right")}
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {spoGroups.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-sm text-disabled">
                  暂无喷油采购单
                </td>
              </tr>
            ) : (
              spoGroups.map((g) => (
                <tr key={g.单号} className="border-b border-black/6 last:border-0">
                  <td className="f-mono px-3 py-2 font-semibold whitespace-nowrap text-[#1a2330]">
                    {g.单号}
                  </td>
                  <td className="px-3 py-2 text-[#3d4a5c]">{g.供应商名称 ?? ""}</td>
                  <td className="f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]">
                    {d10(g.单据日期)}
                  </td>
                  <td className="f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]">
                    {d10(g.交货日期)}
                  </td>
                  <td className="f-mono px-3 py-2 text-right text-[#3d4a5c]">{g.行数}</td>
                  <td className="f-mono px-3 py-2 text-right text-[#3d4a5c]">{g.数量合计}</td>
                  <td className="px-3 py-2">
                    {g.接收 === "1" ? (
                      <span className="inline-flex rounded-full border border-[#16a34a]/50 bg-[#16a34a]/10 px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-[#15803d]">
                        已接收 {g.接收人 ?? ""}
                      </span>
                    ) : (
                      <span className="inline-flex rounded-full border border-[#b45309]/40 bg-[#b45309]/10 px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-[#b45309]">
                        待接收
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      className="text-sm whitespace-nowrap text-[#15803d] hover:underline"
                      onClick={() => void receiveAndBring(g)}
                    >
                      {g.接收 === "1" ? "带入" : "接收并带入"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="mt-2 text-xs text-[#5f6b7d]">
          接收=喷油部确认收到该订单;带入=把该单明细显示到上方制作表
        </div>
      </PickerDialog>

      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </div>
  );
}
