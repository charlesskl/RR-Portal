// 装配物料汇总表(装配部报表群;老系统 web/src/pages/assembly/AssemblyMaterialSummaryPage.tsx 重写):
// 汇总/明细双页签(一次请求同时返回) + 筛选(日期类型+区间/客户/装配方式/完成情况/关键字)
// + 行点击查看详情弹窗(产品信息 + 汇总/物料信息 + 同产品物料明细) + 导出 CSV + 打印。
// 「生成装配采购单」老系统为禁用占位,新版同(未开放)。
// 权限菜单=款号资料(MenuCatalog 实证:基础资料组;后端 AssemblyMaterialSummaryController.cs:15)。
import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { Printer, Prohibit } from "@phosphor-icons/react";
import { assemblyMaterialSummaryApi, customersApi } from "@/api/endpoints";
import type { AssemblyMaterialDetailRow, AssemblyMaterialSummaryRow } from "@/api/types";
import { usePerms } from "@/hooks/usePerms";
import { lastMonthToToday, shiftRange, type DateRange } from "@/lib/assemblyReports";
import { downloadCsv, printTable, type ExportCol } from "@/lib/tableExport";
import { cn } from "@/lib/utils";
import { DensitySwitch, QueryTable } from "@/components/doc/QueryTable";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { PickerDialog, pickerThCls } from "@/components/doc/PickerDialog";
import { SearchSelect } from "@/components/doc/SearchSelect";

const MENU = "款号资料";
const ALL = "全部";

// 编号+名称 组合显示(照抄老系统 codeName:编号与名称相同/名称为空时只显示编号)
const codeName = (编号?: string | null, 名称?: string | null): string => {
  const c = (编号 ?? "").trim();
  const n = (名称 ?? "").trim();
  if (!n || n === c) return c;
  return c ? `${c} ${n}` : n;
};

const fmtDate = (v?: string) => {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v).slice(0, 10);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
};
const fmtNum = (v?: number | null) => (v == null ? "" : Number(v));
const display = (v: unknown) => (v == null || v === "" ? "-" : String(v));
const monoCls = "f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]";
const numCls = "f-mono px-3 py-2 text-right text-[#1a2330]";

const sumCol = createColumnHelper<AssemblyMaterialSummaryRow>();
const summaryColumns = [
  sumCol.display({ id: "序号", header: "序号", size: 5, cell: (c) => c.row.index + 1 }),
  sumCol.accessor("客户", { header: "客户", size: 8 }),
  sumCol.accessor("产品货号", { header: "产品货号", size: 9, meta: { tdClass: monoCls } }),
  sumCol.accessor("产品名称", { header: "产品名称", size: 11 }),
  sumCol.accessor("配件编号", { header: "配件编号", size: 8 }),
  sumCol.accessor("产品装配名称", { header: "产品装配名称", size: 11 }),
  sumCol.accessor("日期", { header: "日期", size: 8, cell: (c) => fmtDate(c.getValue()), meta: { tdClass: monoCls } }),
  sumCol.accessor("加工厂名称", { header: "加工厂名称", size: 10 }),
  sumCol.accessor("装配方式", { header: "装配方式", size: 9 }),
  sumCol.accessor("对比相差", { header: "对比相差", size: 7, cell: (c) => fmtNum(c.getValue()), meta: { align: "right", tdClass: numCls } }),
  sumCol.accessor("相关比例", { header: "相关比例", size: 7 }),
  sumCol.accessor("仓库位置", { header: "仓库位置", size: 10 }),
  sumCol.accessor("需求用量", { header: "需求用量", size: 7, cell: (c) => fmtNum(c.getValue()), meta: { align: "right", tdClass: numCls } }),
  sumCol.accessor("操作员", { header: "操作员", size: 7 }),
  sumCol.accessor("备注", { header: "备注", size: 11 }),
];

const detCol = createColumnHelper<AssemblyMaterialDetailRow>();
const detailColumns = [
  detCol.accessor("客户", { header: "客户", size: 8 }),
  detCol.accessor("产品货号", { header: "产品货号", size: 9, meta: { tdClass: monoCls } }),
  detCol.accessor("产品名称", { header: "产品名称", size: 11 }),
  detCol.accessor("配件编号", { header: "配件编号", size: 8 }),
  detCol.accessor("产品装配名称", { header: "产品装配名称", size: 11 }),
  detCol.accessor("日期", { header: "日期", size: 8, cell: (c) => fmtDate(c.getValue()), meta: { tdClass: monoCls } }),
  detCol.accessor("装配方式", { header: "装配方式", size: 9 }),
  detCol.accessor("物料编号", { header: "物料编号", size: 8, meta: { tdClass: monoCls } }),
  detCol.accessor("物料名称", { header: "物料名称", size: 11 }),
  detCol.accessor("规格", { header: "规格", size: 9 }),
  detCol.accessor("材料", { header: "材料", size: 8 }),
  detCol.accessor("颜色", { header: "颜色", size: 7 }),
  detCol.accessor("单位", { header: "单位", size: 5 }),
  detCol.accessor("用量", { header: "用量", size: 6, cell: (c) => fmtNum(c.getValue()), meta: { align: "right", tdClass: numCls } }),
  detCol.accessor("备注", { header: "备注", size: 10 }),
  detCol.accessor("操作员", { header: "操作员", size: 7 }),
];

const summaryExportCols: ExportCol[] = [
  { title: "客户", key: "客户" },
  { title: "产品货号", key: "产品货号" },
  { title: "产品名称", key: "产品名称" },
  { title: "配件编号", key: "配件编号" },
  { title: "产品装配名称", key: "产品装配名称" },
  { title: "日期", key: "日期", fmt: (v) => fmtDate(v as string) },
  { title: "加工厂名称", key: "加工厂名称" },
  { title: "装配方式", key: "装配方式" },
  { title: "对比相差", key: "对比相差" },
  { title: "相关比例", key: "相关比例" },
  { title: "仓库位置", key: "仓库位置" },
  { title: "需求用量", key: "需求用量" },
  { title: "操作员", key: "操作员" },
  { title: "备注", key: "备注" },
];
const detailExportCols: ExportCol[] = [
  { title: "客户", key: "客户" },
  { title: "产品货号", key: "产品货号" },
  { title: "产品名称", key: "产品名称" },
  { title: "配件编号", key: "配件编号" },
  { title: "产品装配名称", key: "产品装配名称" },
  { title: "日期", key: "日期", fmt: (v) => fmtDate(v as string) },
  { title: "装配方式", key: "装配方式" },
  { title: "物料编号", key: "物料编号" },
  { title: "物料名称", key: "物料名称" },
  { title: "规格", key: "规格" },
  { title: "材料", key: "材料" },
  { title: "颜色", key: "颜色" },
  { title: "单位", key: "单位" },
  { title: "用量", key: "用量" },
  { title: "备注", key: "备注" },
  { title: "操作员", key: "操作员" },
];

type ViewingRow =
  | { type: "summary"; row: AssemblyMaterialSummaryRow }
  | { type: "detail"; row: AssemblyMaterialDetailRow }
  | null;

// 详情弹窗描述行(对照老系统 Descriptions 字段)
function DescItem({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="flex gap-2 border-b border-black/6 px-3 py-2 text-sm">
      <span className="w-24 shrink-0 text-[#5f6b7d]">{label}</span>
      <span className="min-w-0 flex-1 text-[#1a2330]">{display(value)}</span>
    </div>
  );
}

export default function AssemblyMaterialSummaryPage() {
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");

  const [activeTab, setActiveTab] = useState<"summary" | "detail">("summary");
  const [dateType, setDateType] = useState<"不选择" | "日期">("不选择");
  const [range, setRange] = useState<DateRange>(lastMonthToToday);
  const [customer, setCustomer] = useState(ALL);
  const [category, setCategory] = useState(ALL); // 老系统该筛选未下发(仅界面态),新版保持口径
  const [method, setMethod] = useState(ALL);
  const [completion, setCompletion] = useState(ALL);
  const [kwInput, setKwInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [viewing, setViewing] = useState<ViewingRow>(null);

  const customersQuery = useQuery({
    queryKey: ["customers", "pick"],
    queryFn: () => customersApi.list(1, 500, ""),
    staleTime: 5 * 60_000,
    enabled: !permsLoading && canOpen,
  });
  const customerOptions = useMemo(
    () =>
      (customersQuery.data?.items ?? [])
        .filter((c) => c.客户编号)
        .map((c) => codeName(c.客户编号, c.客户名称)),
    [customersQuery.data],
  );

  const useDate = dateType === "日期";
  const params = {
    启用日期: useDate,
    起: useDate ? range.起 : undefined,
    止: useDate ? range.止 : undefined,
    客户: customer === ALL ? undefined : customer,
    装配方式: method === ALL ? undefined : method,
    完成情况: completion === ALL ? undefined : completion,
    keyword: keyword || undefined,
  };

  const q = useQuery({
    queryKey: ["asm-material-summary", params],
    queryFn: () => assemblyMaterialSummaryApi.list(params),
    placeholderData: keepPreviousData,
    enabled: !permsLoading && canOpen,
  });
  const summaryRows = useMemo(() => q.data?.汇总 ?? [], [q.data]);
  const detailRows = useMemo(() => q.data?.明细 ?? [], [q.data]);

  const activeRows = activeTab === "summary" ? summaryRows : detailRows;
  const activeExportCols = activeTab === "summary" ? summaryExportCols : detailExportCols;
  const activeTitle = activeTab === "summary" ? "装配物料汇总表" : "装配物料明细表";

  const viewingRow = viewing?.row;
  const viewingDetails = useMemo(() => {
    const no = viewingRow?.产品货号;
    if (!no) return [];
    return detailRows.filter((r) => r.产品货号 === no);
  }, [detailRows, viewingRow?.产品货号]);

  if (!permsLoading && !canOpen) {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问 装配物料汇总表"
            description="缺少「款号资料·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="f-page flex h-full flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">装配物料汇总表</h1>
        <DensitySwitch className="ml-auto" />
      </div>

      <div className="f-panel flex shrink-0 flex-wrap items-end gap-x-3 gap-y-3 p-5">
        <div className="flex gap-1">
          <button type="button" className="f-btn h-10 px-3.5 text-sm" onClick={() => setRange((r) => shiftRange(r, -1))}>
            上月
          </button>
          <button type="button" className="f-btn h-10 px-3.5 text-sm" onClick={() => setRange(lastMonthToToday())}>
            本月
          </button>
          <button type="button" className="f-btn h-10 px-3.5 text-sm" onClick={() => setRange((r) => shiftRange(r, 1))}>
            下月
          </button>
        </div>
        <div className="space-y-1.5">
          <label className="f-label block">
            客户
          </label>
          <SearchSelect
            ariaLabel="客户"
            className="w-44"
            value={customer}
            options={[ALL, ...customerOptions].map((v) => ({ value: v, label: v }))}
            placeholder="全部"
            onChange={(v) => setCustomer(v)}
          />
        </div>
        <div className="space-y-1.5">
          <label className="f-label block">
            类别
          </label>
          <SearchSelect
            ariaLabel="类别"
            className="w-36"
            value={category}
            options={[ALL, "成品", "半成品", "未包装半成品"].map((v) => ({ value: v, label: v }))}
            placeholder="全部"
            onChange={(v) => setCategory(v)}
          />
        </div>
        <div className="space-y-1.5">
          <label className="f-label block">
            装配方式
          </label>
          <SearchSelect
            ariaLabel="装配方式"
            className="w-40"
            value={method}
            options={[ALL, "包装(已装箱)", "组装半成品"].map((v) => ({ value: v, label: v }))}
            placeholder="全部"
            onChange={(v) => setMethod(v)}
          />
        </div>
        <div className="space-y-1.5">
          <label className="f-label block">
            完成情况
          </label>
          <SearchSelect
            ariaLabel="完成情况"
            className="w-30"
            value={completion}
            options={[ALL, "已审核", "未审核", "已完成", "未完成"].map((v) => ({ value: v, label: v }))}
            placeholder="全部"
            onChange={(v) => setCompletion(v)}
          />
        </div>
        <div className="space-y-1.5">
          <label className="f-label block">
            日期
          </label>
          <SearchSelect
            ariaLabel="日期"
            className="w-26"
            value={dateType}
            options={["不选择", "日期"].map((v) => ({ value: v, label: v }))}
            placeholder="不选择"
            onChange={(v) => setDateType(v as typeof dateType)}
          />
        </div>
        <div className="space-y-1.5">
          <span className="f-label block">区间</span>
          <div className="flex items-center gap-2">
            <input
              type="date"
              aria-label="起"
              className="f-input w-38"
              disabled={!useDate}
              value={range.起}
              onChange={(e) => setRange((r) => ({ ...r, 起: e.target.value }))}
            />
            <span className="text-[#5f6b7d]">~</span>
            <input
              type="date"
              aria-label="止"
              className="f-input w-38"
              disabled={!useDate}
              value={range.止}
              onChange={(e) => setRange((r) => ({ ...r, 止: e.target.value }))}
            />
          </div>
        </div>
        <div className="w-64 space-y-1.5">
          <label htmlFor="ams-kw" className="f-label block">
            关键字
          </label>
          <input
            id="ams-kw"
            className="f-input"
            placeholder="产品货号 / 产品名称 / 配件编号 / 物料"
            value={kwInput}
            onChange={(e) => setKwInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setKeyword(kwInput.trim())}
          />
        </div>
        <button type="button" className="f-btn f-btn-cyan px-5" onClick={() => setKeyword(kwInput.trim())}>
          查询
        </button>
        <button type="button" className="f-btn px-4" onClick={() => setKeyword(kwInput.trim())}>
          精确查询
        </button>
        <button
          type="button"
          className="f-btn px-4"
          disabled={!activeRows.length}
          onClick={() =>
            downloadCsv(`${activeTitle}.csv`, activeExportCols, activeRows as unknown as Record<string, unknown>[])
          }
        >
          导出EXCEL
        </button>
        <button
          type="button"
          className="f-btn px-4"
          disabled={!activeRows.length}
          onClick={() =>
            printTable(activeTitle, activeExportCols, activeRows as unknown as Record<string, unknown>[])
          }
        >
          <Printer className="h-4.5 w-4.5" />
          打印
        </button>
        {/* 生成装配采购单:老系统为禁用占位,新版同样未开放 */}
        <button type="button" className="f-btn px-4" disabled title="暂未开放">
          生成装配采购单
        </button>
      </div>

      {/* 汇总/明细子页签 */}
      <div className="flex w-fit items-center gap-1 rounded-xl border border-black/8 bg-black/[0.03] p-1">
        {[
          { key: "summary" as const, label: "装配物料汇总表" },
          { key: "detail" as const, label: "装配物料明细表" },
        ].map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActiveTab(t.key)}
            className={cn(
              "h-9 rounded-lg px-4 text-sm transition-colors",
              activeTab === t.key
                ? "bg-[#16a34a]/12 font-semibold text-[#15803d]"
                : "text-[#5f6b7d] hover:text-[#3d4a5c]",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "summary" ? (
        <QueryTable
          columns={summaryColumns}
          rows={summaryRows}
          isLoading={q.isLoading}
          isError={q.isError}
          onRetry={() => q.refetch()}
          errorMessage="加载装配物料汇总表失败,请重试"
          emptyTitle="暂无数据"
          emptyDescription="当前筛选条件下没有汇总记录"
          onRowDoubleClick={(r) => setViewing({ type: "summary", row: r })}
          rowTitle={() => "双击查看详情"}
          fill
          minWidth={1900}
          footer={<span>共 {summaryRows.length} 条,双击行查看详情</span>}
        />
      ) : (
        <QueryTable
          columns={detailColumns}
          rows={detailRows}
          isLoading={q.isLoading}
          isError={q.isError}
          onRetry={() => q.refetch()}
          errorMessage="加载装配物料汇总表失败,请重试"
          emptyTitle="暂无数据"
          emptyDescription="当前筛选条件下没有明细记录"
          onRowDoubleClick={(r) => setViewing({ type: "detail", row: r })}
          rowTitle={() => "双击查看详情"}
          fill
          minWidth={2100}
          footer={<span>共 {detailRows.length} 条,双击行查看详情</span>}
        />
      )}

      {/* 行详情(对照老系统 Drawer:产品信息 + 汇总/物料信息 + 同产品物料明细) */}
      <PickerDialog
        open={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing?.type === "detail" ? "装配物料明细详情" : "装配物料汇总详情"}
        width="sm:max-w-[980px]"
      >
        {viewing && (
          <div className="space-y-4">
            <div>
              <div className="mb-1.5 text-sm font-semibold text-[#1a2330]">产品信息</div>
              <div className="grid grid-cols-1 rounded-lg border border-black/8 sm:grid-cols-2 lg:grid-cols-3">
                <DescItem label="客户" value={viewing.row.客户} />
                <DescItem label="产品货号" value={viewing.row.产品货号} />
                <DescItem label="产品名称" value={viewing.row.产品名称} />
                <DescItem label="配件编号" value={viewing.row.配件编号} />
                <DescItem label="产品装配名称" value={viewing.row.产品装配名称} />
                <DescItem label="日期" value={fmtDate(viewing.row.日期)} />
                <DescItem label="装配方式" value={viewing.row.装配方式} />
                <DescItem label="操作员" value={viewing.row.操作员} />
                <DescItem label="备注" value={viewing.row.备注} />
              </div>
            </div>
            {viewing.type === "summary" && (
              <div>
                <div className="mb-1.5 text-sm font-semibold text-[#1a2330]">汇总信息</div>
                <div className="grid grid-cols-1 rounded-lg border border-black/8 sm:grid-cols-2 lg:grid-cols-3">
                  <DescItem label="加工厂名称" value={(viewing.row as AssemblyMaterialSummaryRow).加工厂名称} />
                  <DescItem label="对比相差" value={fmtNum((viewing.row as AssemblyMaterialSummaryRow).对比相差)} />
                  <DescItem label="相关比例" value={(viewing.row as AssemblyMaterialSummaryRow).相关比例} />
                  <DescItem label="仓库位置" value={(viewing.row as AssemblyMaterialSummaryRow).仓库位置} />
                  <DescItem label="需求用量" value={fmtNum((viewing.row as AssemblyMaterialSummaryRow).需求用量)} />
                </div>
              </div>
            )}
            {viewing.type === "detail" && (
              <div>
                <div className="mb-1.5 text-sm font-semibold text-[#1a2330]">物料信息</div>
                <div className="grid grid-cols-1 rounded-lg border border-black/8 sm:grid-cols-2 lg:grid-cols-3">
                  <DescItem label="物料编号" value={(viewing.row as AssemblyMaterialDetailRow).物料编号} />
                  <DescItem label="物料名称" value={(viewing.row as AssemblyMaterialDetailRow).物料名称} />
                  <DescItem label="规格" value={(viewing.row as AssemblyMaterialDetailRow).规格} />
                  <DescItem label="材料" value={(viewing.row as AssemblyMaterialDetailRow).材料} />
                  <DescItem label="颜色" value={(viewing.row as AssemblyMaterialDetailRow).颜色} />
                  <DescItem label="单位" value={(viewing.row as AssemblyMaterialDetailRow).单位} />
                  <DescItem label="用量" value={fmtNum((viewing.row as AssemblyMaterialDetailRow).用量)} />
                </div>
              </div>
            )}
            <div>
              <div className="mb-1.5 text-sm font-semibold text-[#1a2330]">同产品物料明细</div>
              <div className="max-h-[40vh] overflow-auto rounded-lg border border-black/8">
                <table data-freeze className="w-full text-sm" style={{ minWidth: 1400 }}>
                  <thead>
                    <tr>
                      {["客户", "产品货号", "产品名称", "配件编号", "产品装配名称", "日期", "装配方式", "物料编号", "物料名称", "规格", "材料", "颜色", "单位", "用量", "备注", "操作员"].map(
                        (h) => (
                          <th key={h} className={pickerThCls}>
                            {h}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {viewingDetails.length === 0 ? (
                      <tr>
                        <td colSpan={16} className="px-3 py-8 text-center text-disabled">
                          暂无同产品物料明细
                        </td>
                      </tr>
                    ) : (
                      viewingDetails.map((r, i) => (
                        <tr key={`${r.产品货号 ?? "p"}-${r.物料编号 ?? "m"}-${i}`} className="border-b border-black/6">
                          <td className="px-3 py-2">{r.客户 ?? ""}</td>
                          <td className="f-mono px-3 py-2 whitespace-nowrap">{r.产品货号 ?? ""}</td>
                          <td className="px-3 py-2">{r.产品名称 ?? ""}</td>
                          <td className="px-3 py-2">{r.配件编号 ?? ""}</td>
                          <td className="px-3 py-2">{r.产品装配名称 ?? ""}</td>
                          <td className="f-mono px-3 py-2 whitespace-nowrap">{fmtDate(r.日期)}</td>
                          <td className="px-3 py-2">{r.装配方式 ?? ""}</td>
                          <td className="f-mono px-3 py-2 whitespace-nowrap">{r.物料编号 ?? ""}</td>
                          <td className="px-3 py-2">{r.物料名称 ?? ""}</td>
                          <td className="px-3 py-2">{r.规格 ?? ""}</td>
                          <td className="px-3 py-2">{r.材料 ?? ""}</td>
                          <td className="px-3 py-2">{r.颜色 ?? ""}</td>
                          <td className="px-3 py-2">{r.单位 ?? ""}</td>
                          <td className="f-mono px-3 py-2 text-right">{fmtNum(r.用量)}</td>
                          <td className="px-3 py-2">{r.备注 ?? ""}</td>
                          <td className="px-3 py-2">{r.操作员 ?? ""}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <div className="mt-2 text-sm text-[#5f6b7d]">共 {viewingDetails.length} 条</div>
            </div>
          </div>
        )}
      </PickerDialog>
    </div>
  );
}
