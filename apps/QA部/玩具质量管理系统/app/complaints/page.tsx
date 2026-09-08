"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDownTrayIcon,
  ChevronDownIcon,
  PencilSquareIcon,
  TrashIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { useComplaintData } from "@/components/data-provider";
import { useAuth } from "@/components/auth-provider";
import { DataTable, Filters, KpiCard, PageTitle } from "@/components/ui";
import {
  customerOf,
  filterComplaints,
  groupCount,
  parseFilters,
  queryFor,
  statusOf,
  type ComplaintFilters,
} from "@/lib/stats";
import { duplicateKeyOf, translationSourceHashOf } from "@/lib/excel";
import type {
  ComplaintRecord,
  ComplaintUpdate,
  ComplaintWorkflowStatus,
  SeriesDefinition,
} from "@/lib/types";

function uniqueIssueTypes(
  issueTypes: string[],
  issueTypeLabel: (name: string) => string,
  preferred?: string | null,
) {
  const byLabel = new Map<string, string>();
  for (const type of issueTypes) {
    const label = issueTypeLabel(type).trim() || type;
    if (!byLabel.has(label) || type === preferred) byLabel.set(label, type);
  }
  return [...byLabel].map(([label, value]) => ({ value, label }));
}

type ComplaintExportRow = {
  来源编号: string;
  联络日期: string;
  客户: string;
  主要系列: string;
  次要系列: string;
  SKU: string;
  产品: string;
  投诉内容: string;
  问题类型: string;
  状态: string;
  国家: string;
  商店: string;
};
const exportHeaders: (keyof ComplaintExportRow)[] = [
  "来源编号",
  "联络日期",
  "客户",
  "主要系列",
  "次要系列",
  "SKU",
  "产品",
  "投诉内容",
  "问题类型",
  "状态",
  "国家",
  "商店",
];
const exportDate = () => new Date().toISOString().slice(0, 10);
const downloadBlob = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character] || character,
  );

export default function Complaints() {
  const router = useRouter();
  const {can}=useAuth();const canManage=can("manage_complaints"),canClassify=can("manage_classification"),canDelete=can("delete_complaints"),canImport=can("import_data"),canExport=can("export_reports");
  const {
    records,
    issueTypes,
    primarySeriesDefinitions,
    secondarySeriesDefinitions,
    issueTypeLabel,
    primarySeriesLabel,
    secondarySeriesLabel,
    setComplaintIssue,
    updateComplaint,
    updateComplaintStatuses,
    updateComplaintTranslation,
    deleteComplaints,
    confirmImport,
  } = useComplaintData();
  const initialFilters = useRef<ComplaintFilters | null>(null);
  if (initialFilters.current === null)
    initialFilters.current =
      typeof window === "undefined"
        ? parseFilters("")
        : parseFilters(window.location.search);
  const [filters, setFilters] = useState<ComplaintFilters>(
    initialFilters.current,
  );
  const setFilter = (key: keyof ComplaintFilters, value: string) =>
    setFilters((current) => ({ ...current, [key]: value }));
  const search = filters.q,
    issue = filters.issue,
    series = filters.series,
    store = filters.customer;
  const [country, setCountry] = useState("");
  const [year, setYear] = useState("");
  const [month, setMonth] = useState("");
  const [messageMode, setMessageMode] = useState<"zh" | "en" | "bilingual">(
    "zh",
  );
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState<"xlsx" | "pdf" | null>(null);
  const [batchStatus, setBatchStatus] =
    useState<ComplaintWorkflowStatus>("待处理");
  const [batchStatusBusy, setBatchStatusBusy] = useState(false);
  const [fullMessage, setFullMessage] = useState<ComplaintRecord | null>(null);
  const [editingRecord, setEditingRecord] = useState<ComplaintRecord | null>(
    null,
  );
  const [adding, setAdding] = useState(false);
  const [newIssueRecord, setNewIssueRecord] = useState<ComplaintRecord | null>(
    null,
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteStep, setDeleteStep] = useState<0 | 1 | 2>(0);
  const [deleteScope, setDeleteScope] = useState<"page" | "all">("page");
  const [deleting, setDeleting] = useState(false);
  const [tablePage, setTablePage] = useState(1);
  const [notice, setNotice] = useState("");
  const pageSize = 20;
  const unclassified = records.filter((r) => !r.issueType).length;
  const countries = groupCount(records, (r) => r.country).length;
  const seriesValues = groupCount(records, (r) => r.primarySeries).map(
    (x) => x.name,
  );
  const countryValues = groupCount(records, (r) => r.country).map(
    (x) => x.name,
  );
  const yearValues = useMemo(
    () =>
      [
        ...new Set(
          records.map((r) => r.contactDate.slice(0, 4)).filter(Boolean),
        ),
      ].sort((a, b) => b.localeCompare(a)),
    [records],
  );
  const monthValues = useMemo(
    () =>
      [
        ...new Set(
          records
            .filter((r) => !year || r.contactDate.startsWith(`${year}-`))
            .map((r) => r.contactDate.slice(5, 7))
            .filter(Boolean),
        ),
      ].sort((a, b) => Number(a) - Number(b)),
    [records, year],
  );
  const storeValues = useMemo(
    () =>
      [
        ...new Set(
          records
            .map((r) => r.store?.trim())
            .filter((value): value is string => Boolean(value)),
        ),
      ].sort((a, b) => a.localeCompare(b, "zh-CN")),
    [records],
  );
  const filtered = useMemo(
    () =>
      filterComplaints(records, {
        ...filters,
        from: filters.from || (year ? `${year}-${month || "01"}-01` : ""),
        to: filters.to || (year ? `${year}-${month || "12"}-31` : ""),
      }).filter((record) => !country || record.country === country),
    [records, filters, country, year, month],
  );
  useEffect(() => {
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${queryFor(filters)}`,
    );
  }, [filters]);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("action") === "new") {
      setAdding(true);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);
  useEffect(
    () =>
      setSelectedIds(
        (current) =>
          new Set(
            [...current].filter((id) =>
              records.some((record) => record.id === id),
            ),
          ),
      ),
    [records],
  );
  useEffect(() => setTablePage(1), [filters, country, year, month]);
  const displayedRecords = filtered;
  const currentPageRecords = displayedRecords.slice(
    (tablePage - 1) * pageSize,
    tablePage * pageSize,
  );
  const allFilteredSelected =
    filtered.length > 0 &&
    filtered.every((record) => selectedIds.has(record.id));
  const allPageSelected =
    currentPageRecords.length > 0 &&
    currentPageRecords.every((record) => selectedIds.has(record.id));
  const toggleAllResults = () =>
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allFilteredSelected)
        filtered.forEach((record) => next.delete(record.id));
      else filtered.forEach((record) => next.add(record.id));
      return next;
    });
  const toggleCurrentPage = () =>
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allPageSelected)
        currentPageRecords.forEach((record) => next.delete(record.id));
      else currentPageRecords.forEach((record) => next.add(record.id));
      return next;
    });
  const toggleOne = (id: string) =>
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const flash = (text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice(""), 2400);
  };
  async function applyBatchStatus() {
    if (!selectedIds.size) return;
    setBatchStatusBusy(true);
    try {
      const { updated, skipped } = await updateComplaintStatuses(
        [...selectedIds],
        batchStatus,
      );
      setSelectedIds(new Set());
      flash(
        `已将 ${updated} 条投诉设为${batchStatus}${skipped ? `，跳过 ${skipped} 条待分类记录` : ""}`,
      );
    } catch (reason) {
      flash(reason instanceof Error ? reason.message : "批量设置状态失败");
    } finally {
      setBatchStatusBusy(false);
    }
  }
  async function performDelete() {
    setDeleting(true);
    try {
      const count = await deleteComplaints([...selectedIds]);
      setSelectedIds(new Set());
      flash(`已删除 ${count} 条投诉`);
    } catch (reason) {
      flash(reason instanceof Error ? reason.message : "删除失败，请重试");
    } finally {
      setDeleting(false);
      setDeleteStep(0);
    }
  }
  async function confirmFirstDelete() {
    const removesAll =
      records.length > 0 &&
      records.every((record) => selectedIds.has(record.id));
    const removesWholePage =
      currentPageRecords.length > 0 &&
      currentPageRecords.every((record) => selectedIds.has(record.id));
    if (removesAll || removesWholePage) {
      setDeleteScope(removesAll ? "all" : "page");
      setDeleteStep(2);
      return;
    }
    await performDelete();
  }
  const exportRows = (): ComplaintExportRow[] =>
    displayedRecords.map((record) => ({
      来源编号: record.sourceSubmissionId || "",
      联络日期: record.contactDate,
      客户: customerOf(record),
      主要系列: primarySeriesLabel(record.primarySeries),
      次要系列: secondarySeriesLabel(
        record.secondarySeries,
        record.primarySeries,
      ),
      SKU: record.productSku,
      产品: record.productName || "",
      投诉内容: record.complaintMessageOriginal,
      问题类型: issueTypeLabel(record.issueType),
      状态: statusOf(record),
      国家: record.country,
      商店: record.store || "",
    }));
  function exportCsv() {
    const rows = exportRows();
    const escape = (value: unknown) =>
      `"${String(value ?? "").replaceAll('"', '""')}"`;
    const csv =
      "\uFEFF" +
      [
        exportHeaders.map(escape).join(","),
        ...rows.map((row) =>
          exportHeaders.map((header) => escape(row[header])).join(","),
        ),
      ].join("\n");
    downloadBlob(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
      `ToyQMS-投诉数据-${exportDate()}.csv`,
    );
    setExportOpen(false);
    flash(`已导出CSV，共 ${rows.length} 条记录`);
  }
  async function exportExcel() {
    const rows = exportRows();
    setExportOpen(false);
    setExporting("xlsx");
    try {
      const XLSX = await import("xlsx");
      const sheet = XLSX.utils.json_to_sheet(rows, { header: exportHeaders });
      sheet["!cols"] = [14, 12, 18, 16, 18, 13, 18, 52, 16, 12, 14, 18].map(
        (width) => ({ wch: width }),
      );
      sheet["!autofilter"] = { ref: `A1:L${Math.max(1, rows.length + 1)}` };
      (sheet as typeof sheet & { "!freeze"?: unknown })["!freeze"] = {
        xSplit: 0,
        ySplit: 1,
      };
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, "投诉数据");
      XLSX.writeFile(book, `ToyQMS-投诉数据-${exportDate()}.xlsx`, {
        compression: true,
      });
      flash(`已导出Excel，共 ${rows.length} 条记录`);
    } catch (reason) {
      flash(
        reason instanceof Error
          ? `Excel导出失败：${reason.message}`
          : "Excel导出失败",
      );
    } finally {
      setExporting(null);
    }
  }
  async function exportPdf() {
    const rows = exportRows();
    setExportOpen(false);
    setExporting("pdf");
    const host = document.createElement("div");
    host.style.cssText =
      "position:fixed;left:-20000px;top:0;width:1120px;background:#fff;z-index:-1";
    document.body.appendChild(host);
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ]);
      await document.fonts.ready;
      const reportRows = rows.length
        ? rows
        : [
            {
              来源编号: "暂无数据",
              联络日期: "",
              客户: "",
              主要系列: "",
              次要系列: "",
              SKU: "",
              产品: "",
              投诉内容: "当前筛选没有投诉记录",
              问题类型: "",
              状态: "",
              国家: "",
              商店: "",
            },
          ];
      // Keep the rendered rows fully inside the fixed A4 landscape canvas.
      // The previous 12-row layout visually clipped rows 10-12 while the next
      // page still started at row 13, which made those records appear missing.
      const perPage = 10;
      const pages = Math.ceil(reportRows.length / perPage);
      const pdf = new jsPDF({
        orientation: "landscape",
        unit: "mm",
        format: "a4",
        compress: true,
      });
      for (let page = 0; page < pages; page++) {
        const chunk = reportRows.slice(page * perPage, (page + 1) * perPage);
        const section = document.createElement("section");
        section.style.cssText =
          "box-sizing:border-box;width:1120px;height:790px;padding:34px 38px;background:#fff;color:#171717;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif";
        section.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #f36b21;padding-bottom:12px"><div><div style="font-size:25px;font-weight:800">ToyQMS 投诉数据</div><div style="margin-top:5px;font-size:12px;color:#666">当前筛选结果 · 共 ${rows.length} 条 · 导出日期 ${exportDate()}</div></div><div style="font-size:12px;color:#777">第 ${page + 1} / ${pages} 页</div></div><table style="margin-top:18px;width:100%;border-collapse:collapse;table-layout:fixed;font-size:11px"><colgroup><col style="width:5%"><col style="width:9%"><col style="width:12%"><col style="width:13%"><col style="width:9%"><col style="width:12%"><col style="width:13%"><col style="width:27%"></colgroup><thead><tr style="height:36px;background:#f36b21;color:white"><th style="padding:8px 6px;text-align:center;vertical-align:middle">序号</th><th style="padding:8px 6px;text-align:left;vertical-align:middle">日期</th><th style="padding:8px 6px;text-align:left;vertical-align:middle">客户</th><th style="padding:8px 6px;text-align:left;vertical-align:middle">主要系列</th><th style="padding:8px 6px;text-align:left;vertical-align:middle">SKU</th><th style="padding:8px 6px;text-align:left;vertical-align:middle">问题类型</th><th style="padding:8px 6px;text-align:left;vertical-align:middle">国家／商店</th><th style="padding:8px 6px;text-align:left;vertical-align:middle">投诉内容</th></tr></thead><tbody>${chunk.map((row, index) => `<tr style="height:56px;background:${index % 2 ? "#fafafa" : "#fff"}"><td style="border-bottom:1px solid #ddd;padding:7px 6px;text-align:center;vertical-align:top">${page * perPage + index + 1}</td><td style="border-bottom:1px solid #ddd;padding:7px 6px;text-align:left;vertical-align:top">${escapeHtml(row["联络日期"])}</td><td style="border-bottom:1px solid #ddd;padding:7px 6px;text-align:left;vertical-align:top;overflow:hidden">${escapeHtml(row["客户"])}</td><td style="border-bottom:1px solid #ddd;padding:7px 6px;text-align:left;vertical-align:top;overflow:hidden">${escapeHtml(row["主要系列"])}</td><td style="border-bottom:1px solid #ddd;padding:7px 6px;text-align:left;vertical-align:top">${escapeHtml(row["SKU"])}</td><td style="border-bottom:1px solid #ddd;padding:7px 6px;text-align:left;vertical-align:top;overflow:hidden">${escapeHtml(row["问题类型"])}</td><td style="border-bottom:1px solid #ddd;padding:7px 6px;text-align:left;vertical-align:top;overflow:hidden">${escapeHtml(row["国家"])}<br><span style="color:#888">${escapeHtml(row["商店"])}</span></td><td style="border-bottom:1px solid #ddd;padding:7px 6px;text-align:left;vertical-align:top;line-height:1.35;overflow:hidden">${escapeHtml(row["投诉内容"].slice(0, 125))}</td></tr>`).join("")}</tbody></table>`;
        host.replaceChildren(section);
        void section.offsetHeight;
        await new Promise<void>((resolve) =>
          window.requestAnimationFrame(() =>
            window.requestAnimationFrame(() => resolve()),
          ),
        );
        const canvas = await html2canvas(section, {
          scale: 1.35,
          width: 1120,
          height: 790,
          windowWidth: 1120,
          windowHeight: 790,
          scrollX: 0,
          scrollY: 0,
          backgroundColor: "#ffffff",
          logging: false,
          useCORS: true,
        });
        if (page) pdf.addPage("a4", "landscape");
        pdf.addImage(
          canvas.toDataURL("image/jpeg", 0.88),
          "JPEG",
          0,
          0,
          297,
          210,
          undefined,
          "FAST",
        );
        host.replaceChildren();
        await new Promise<void>((resolve) =>
          window.requestAnimationFrame(() => resolve()),
        );
      }
      pdf.save(`ToyQMS-投诉数据-${exportDate()}.pdf`);
      flash(`已导出PDF，共 ${rows.length} 条记录`);
    } catch (reason) {
      flash(
        reason instanceof Error
          ? `PDF导出失败：${reason.message}`
          : "PDF导出失败",
      );
    } finally {
      host.remove();
      setExporting(null);
    }
  }
  const exportMenu = (
    <div className="relative">
      <button
        type="button"
        disabled={Boolean(exporting)}
        onClick={() => setExportOpen((value) => !value)}
        className="btn-secondary"
      >
        <ArrowDownTrayIcon className="h-4 w-4" />
        {exporting === "xlsx"
          ? "正在生成Excel…"
          : exporting === "pdf"
            ? "正在生成PDF…"
            : "导出当前筛选"}
        <ChevronDownIcon className="h-3.5 w-3.5" />
      </button>
      {exportOpen && (
        <div className="absolute right-0 top-11 z-[70] w-52 overflow-hidden rounded-xl border border-line bg-white p-1.5 shadow-xl">
          <button
            type="button"
            onClick={exportCsv}
            className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-orange-50"
          >
            <b>CSV</b>
            <span className="ml-2 text-xs text-neutral-400">系统兼容</span>
          </button>
          <button
            type="button"
            onClick={() => void exportExcel()}
            className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-orange-50"
          >
            <b>Excel</b>
            <span className="ml-2 text-xs text-neutral-400">.xlsx</span>
          </button>
          <button
            type="button"
            onClick={() => void exportPdf()}
            className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-orange-50"
          >
            <b>PDF</b>
            <span className="ml-2 text-xs text-neutral-400">横向分页</span>
          </button>
        </div>
      )}
    </div>
  );
  return (
    <>
      <PageTitle
        action={canManage?"新增投诉":undefined}
        onAction={canManage?()=>setAdding(true):undefined}
        secondaryContent={canExport?exportMenu:undefined}
      />
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <KpiCard
          className="border-sky-200 bg-sky-100"
          label="已导入记录"
          value={String(records.length)}
        />
        <KpiCard
          className="border-amber-200 bg-amber-100"
          label="待分类"
          value={String(unclassified)}
          tone="accent"
        />
        <KpiCard
          className="border-emerald-200 bg-emerald-100"
          label="问题类型库"
          value={String(issueTypes.length)}
          tone="good"
        />
      </div>
      <div className="sticky top-14 z-20 -mx-1 bg-[#f5f5f3] px-1 pt-1">
        <Filters
          singleRow
          searchValue={search}
          onSearch={(value) => setFilter("q", value)}
          onFilter={(i, v) => {
            if (i === 0) setFilter("issue", v);
            if (i === 1) setFilter("series", v);
            if (i === 2) setCountry(v);
            if (i === 3) {
              setYear(v);
              setMonth("");
            }
            if (i === 4) setMonth(v);
            if (i === 5) setFilter("customer", v);
          }}
          placeholder="搜索编号、客户、系列、SKU、问题或内容…"
          groups={[
            {
              label: "全部问题类型",
              options: [
                { value: "未分类", label: "未分类" },
                ...uniqueIssueTypes(issueTypes, issueTypeLabel),
              ],
            },
            {
              label: "全部系列",
              options: seriesValues.map((value) => ({
                value,
                label: primarySeriesLabel(value),
              })),
            },
            { label: "全部国家", values: countryValues },
            {
              label: "全部年度",
              options: yearValues.map((value) => ({
                value,
                label: `${value} 年`,
              })),
            },
            {
              label: "全部月份",
              options: monthValues.map((value) => ({
                value,
                label: `${Number(value)} 月`,
              })),
            },
            {
              label: "全部客户/商店",
              options: [
                { value: "未设置", label: "未设置" },
                ...storeValues.map((value) => ({ value, label: value })),
              ],
            },
          ]}
        />
        <div className="mb-2 flex flex-wrap gap-2">
          <input
            aria-label="开始日期"
            type="date"
            value={filters.from}
            onChange={(event) => setFilter("from", event.target.value)}
            className="field"
          />
          <input
            aria-label="结束日期"
            type="date"
            value={filters.to}
            onChange={(event) => setFilter("to", event.target.value)}
            className="field"
          />
          <input
            aria-label="SKU 筛选"
            value={filters.sku}
            onChange={(event) => setFilter("sku", event.target.value)}
            className="field w-36"
            placeholder="SKU 精确筛选"
          />
          <select
            aria-label="状态筛选"
            value={filters.status}
            onChange={(event) => setFilter("status", event.target.value)}
            className="field"
          >
            <option value="">全部状态</option>
            <option>待分类</option>
            <option>待处理</option>
            <option>处理中</option>
            <option>已关闭</option>
            <option>未设置状态</option>
          </select>
          <select
            aria-label="分类状态筛选"
            value={filters.classified}
            onChange={(event) => setFilter("classified", event.target.value)}
            className="field"
          >
            <option value="">全部分类状态</option>
            <option value="yes">已分类</option>
            <option value="no">未分类</option>
          </select>
          <select
            aria-label="排序方式"
            value={filters.sort}
            onChange={(event) => setFilter("sort", event.target.value)}
            className="field"
          >
            <option value="date-desc">日期降序</option>
            <option value="date-asc">日期升序</option>
            <option value="series">系列排序</option>
            <option value="sku">SKU 排序</option>
          </select>
          <button
            className="btn-secondary"
            onClick={() => {
              setFilters(parseFilters(""));
              setCountry("");
              setYear("");
              setMonth("");
            }}
          >
            重置
          </button>
          {canImport&&<button
            className="btn-secondary"
            onClick={() => router.push("/import")}
          >
            导入数据
          </button>}
        </div>
        <div className="mb-2 flex min-h-8 flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-neutral-500">
            当前显示 {filtered.length} / {records.length} 条 · 已选择{" "}
            {selectedIds.size} 条 · 共 {countries} 个国家/市场
          </span>
          <div className="flex flex-wrap gap-2">
            <select
              aria-label="投诉内容显示方式"
              value={messageMode}
              onChange={(event) =>
                setMessageMode(event.target.value as typeof messageMode)
              }
              className="field h-8 min-w-32 text-xs"
            >
              <option value="zh">显示中文</option>
              <option value="en">显示英文</option>
              <option value="bilingual">中英对照</option>
            </select>
            {canManage&&<>
            <button
              onClick={toggleAllResults}
              disabled={!filtered.length}
              className="btn-secondary h-8 text-xs"
            >
              {allFilteredSelected ? "取消全部结果" : "全选全部结果"}
            </button>
            <select
              aria-label="批量处理状态"
              value={batchStatus}
              onChange={(event) =>
                setBatchStatus(event.target.value as ComplaintWorkflowStatus)
              }
              className="field h-8 min-w-28 text-xs"
            >
              {workflowStatuses.map((status) => (
                <option key={status}>{status}</option>
              ))}
            </select>
            <button
              onClick={() => void applyBatchStatus()}
              disabled={!selectedIds.size || batchStatusBusy}
              className="btn-accent h-8 text-xs disabled:cursor-not-allowed disabled:opacity-40"
            >
              {batchStatusBusy
                ? "正在设置…"
                : `应用状态（${selectedIds.size}）`}
            </button></>}
            {canDelete&&<button
              onClick={() => setDeleteStep(1)}
              disabled={!selectedIds.size}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-red-600 px-3 text-xs font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-35"
            >
              <TrashIcon className="h-4 w-4" />
              删除所选（{selectedIds.size}）
            </button>}
          </div>
        </div>
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none sticky top-[12.25rem] z-20 -mb-2 h-2 bg-[#f5f5f3]"
      />
      <DataTable
        page={tablePage}
        onPageChange={setTablePage}
        pageSize={pageSize}
        rowKeys={displayedRecords.map((record) => record.id)}
        extendedPagination
        headerTone="accent"
        stickyHeader
        stickyHeaderTop="12.75rem"
        columns={[
          <input
            key="all"
            aria-label="全选当前页面"
            type="checkbox"
            disabled={!currentPageRecords.length}
            checked={allPageSelected}
            onChange={toggleCurrentPage}
          />,
          "序号",
          "来源编号",
          "联络日期",
          "主要/次要系列",
          "SKU",
          "投诉内容",
          "问题类型",
          "处理状态",
          "操作",
          "数据来源",
        ]}
        rows={displayedRecords.map((r, index) => [
          <input
            key="select"
            aria-label={`选择投诉 ${r.sourceSubmissionId || r.id.slice(0, 8)}`}
            type="checkbox"
            checked={selectedIds.has(r.id)}
            onChange={() => toggleOne(r.id)}
          />,
          <span key="index" className="tabular-nums text-neutral-500">
            {index + 1}
          </span>,
          <span key="id">{r.sourceSubmissionId || r.id.slice(0, 8)}</span>,
          <span key="date" className="whitespace-nowrap">
            {r.contactDate}
          </span>,
          <span key="series">
            <b>{primarySeriesLabel(r.primarySeries)}</b>
            <br />
            <small className="text-neutral-400">
              {secondarySeriesLabel(r.secondarySeries, r.primarySeries)}
            </small>
          </span>,
          r.productSku,
          <ComplaintText
            key="msg"
            record={r}
            mode={messageMode}
            onOpen={setFullMessage}
          />,
          canClassify?<InlineIssueSelect
            key="issue"
            record={r}
            issueTypes={issueTypes}
            issueTypeLabel={issueTypeLabel}
            save={setComplaintIssue}
            addNew={() => setNewIssueRecord(r)}
          />:<span key="issue-readonly">{r.issueType?issueTypeLabel(r.issueType):"未分类"}</span>,
          canManage?<InlineStatusSelect
            key="status"
            record={r}
            save={async (value) =>
              updateComplaint(r.id, { workflowStatus: value })
            }
          />:<span key="status-readonly">{statusOf(r)}</span>,
          canManage?<button
            key="edit"
            onClick={() => setEditingRecord(r)}
            className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold hover:border-accent hover:text-accent"
          >
            <PencilSquareIcon className="h-4 w-4" />
            编辑
          </button>:<span key="readonly" className="text-xs text-neutral-400">只读</span>,
          <span className="block min-w-40 text-xs" key="source">
            {r.sourceFileName}
            <br />
            {r.sourceWorksheetName} · 第 {r.sourceRowNumber} 行
          </span>,
        ])}
      />
      {fullMessage && (
        <MessageModal
          record={fullMessage}
          primarySeriesLabel={primarySeriesLabel}
          close={() => setFullMessage(null)}
        />
      )}
      {adding && (
        <AddComplaintModal
          close={() => setAdding(false)}
          save={async (input) => {
            const now = new Date().toISOString();
            const record: ComplaintRecord = {
              id: crypto.randomUUID(),
              sourceSubmissionId: input.sourceSubmissionId || null,
              sourceFileName: "手工新增",
              sourceWorksheetName: "手工录入",
              sourceRowNumber: 1,
              importBatchId: `manual-${Date.now()}`,
              primarySeries: input.primarySeries,
              secondarySeries: null,
              contactDate: input.contactDate,
              productSku: input.productSku,
              productName: input.productName || null,
              complaintMessageOriginal: input.message,
              sourceLanguage: "zh",
              complaintMessageZhMachine: input.message,
              complaintMessageZhFinal: input.message,
              translationStatus: "reviewed",
              translationSourceHash: translationSourceHashOf(input.message),
              translationProvider: "manual-local",
              translationModel: null,
              translatedAt: now,
              reviewedAt: now,
              country: input.country,
              store: input.store || null,
              batchCode: null,
              issueType: input.issueType || null,
              status: input.issueType ? "Imported" : "Needs classification",
              capIds: [],
              duplicateKey: "",
              importedAt: now,
              updatedAt: now,
              rawData: { 录入方式: "手工新增" },
            };
            record.duplicateKey = duplicateKeyOf(record);
            await confirmImport({
              fileName: "手工新增",
              batchId: record.importBatchId,
              worksheets: ["手工录入"],
              totalRows: 1,
              newRows: [record],
              duplicateRows: [],
              invalidRows: [],
            });
            setAdding(false);
            flash("投诉已新增并同步统计");
          }}
        />
      )}
      {editingRecord && (
        <ComplaintEditor
          record={editingRecord}
          issueTypes={issueTypes}
          primarySeriesDefinitions={primarySeriesDefinitions}
          secondarySeriesDefinitions={secondarySeriesDefinitions}
          issueTypeLabel={issueTypeLabel}
          primarySeriesLabel={primarySeriesLabel}
          secondarySeriesLabel={secondarySeriesLabel}
          close={() => setEditingRecord(null)}
          save={async (changes, translation) => {
            await updateComplaint(editingRecord.id, changes);
            const cleanTranslation = translation.trim();
            await updateComplaintTranslation(editingRecord.id, {
              complaintMessageZhMachine: cleanTranslation || null,
              complaintMessageZhFinal: cleanTranslation || null,
              translationStatus: cleanTranslation ? "reviewed" : "pending",
              translationProvider: cleanTranslation ? "manual-local" : null,
              translationModel: null,
            });
            setEditingRecord(null);
          }}
        />
      )}
      {newIssueRecord && (
        <NewIssueTypeModal
          record={newIssueRecord}
          existingLabels={issueTypes.map(issueTypeLabel)}
          close={() => setNewIssueRecord(null)}
          save={async (name) => {
            await setComplaintIssue(newIssueRecord.id, name);
            setNewIssueRecord(null);
          }}
        />
      )}
      {deleteStep > 0 && (
        <DeleteConfirm
          step={deleteStep as 1 | 2}
          scope={deleteScope}
          count={selectedIds.size}
          busy={deleting}
          close={() => setDeleteStep(0)}
          confirm={deleteStep === 1 ? confirmFirstDelete : performDelete}
        />
      )}
      {notice && (
        <div className="fixed right-6 top-20 z-[60] rounded-lg bg-ink px-4 py-3 text-sm text-white shadow-xl">
          {notice}
        </div>
      )}
    </>
  );
}

function AddComplaintModal({
  close,
  save,
}: {
  close: () => void;
  save: (input: {
    sourceSubmissionId: string;
    contactDate: string;
    primarySeries: string;
    productSku: string;
    productName: string;
    message: string;
    country: string;
    store: string;
    issueType: string;
  }) => Promise<void>;
}) {
  const [form, setForm] = useState({
    sourceSubmissionId: "",
    contactDate: new Date().toISOString().slice(0, 10),
    primarySeries: "",
    productSku: "",
    productName: "",
    message: "",
    country: "",
    store: "",
    issueType: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const update = (key: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  async function submit() {
    if (
      !form.contactDate ||
      !form.primarySeries.trim() ||
      !form.productSku.trim() ||
      !form.message.trim() ||
      !form.country.trim()
    ) {
      setError("请填写日期、主要系列、SKU、投诉内容和国家/市场。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await save({
        ...form,
        primarySeries: form.primarySeries.trim(),
        productSku: form.productSku.trim(),
        message: form.message.trim(),
        country: form.country.trim(),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "新增失败");
      setBusy(false);
    }
  }
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4"
      onClick={close}
    >
      <section
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="label">新增投诉</div>
            <h2 className="mt-1 text-lg font-bold">手工录入投诉记录</h2>
          </div>
          <button aria-label="关闭" onClick={close}>
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <EditField label="来源编号">
            <input
              className="field w-full"
              value={form.sourceSubmissionId}
              onChange={(event) =>
                update("sourceSubmissionId", event.target.value)
              }
            />
          </EditField>
          <EditField label="联络日期 *">
            <input
              type="date"
              className="field w-full"
              value={form.contactDate}
              onChange={(event) => update("contactDate", event.target.value)}
            />
          </EditField>
          <EditField label="主要系列 *">
            <input
              className="field w-full"
              value={form.primarySeries}
              onChange={(event) => update("primarySeries", event.target.value)}
            />
          </EditField>
          <EditField label="SKU *">
            <input
              className="field w-full"
              value={form.productSku}
              onChange={(event) => update("productSku", event.target.value)}
            />
          </EditField>
          <EditField label="产品名称">
            <input
              className="field w-full"
              value={form.productName}
              onChange={(event) => update("productName", event.target.value)}
            />
          </EditField>
          <EditField label="问题类型">
            <input
              className="field w-full"
              value={form.issueType}
              onChange={(event) => update("issueType", event.target.value)}
            />
          </EditField>
          <EditField label="国家/市场 *">
            <input
              className="field w-full"
              value={form.country}
              onChange={(event) => update("country", event.target.value)}
            />
          </EditField>
          <EditField label="客户/购买商店">
            <input
              className="field w-full"
              value={form.store}
              onChange={(event) => update("store", event.target.value)}
            />
          </EditField>
        </div>
        <label className="mt-4 block">
          <span className="mb-2 block text-sm font-semibold">投诉内容 *</span>
          <textarea
            rows={5}
            className="w-full rounded-lg border border-line p-3 text-sm outline-none focus:border-accent"
            value={form.message}
            onChange={(event) => update("message", event.target.value)}
          />
        </label>
        {error && (
          <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-secondary" onClick={close} disabled={busy}>
            取消
          </button>
          <button
            className="btn-accent"
            onClick={() => void submit()}
            disabled={busy}
          >
            {busy ? "正在保存…" : "保存投诉"}
          </button>
        </div>
      </section>
    </div>
  );
}

function ComplaintText({
  record,
  mode,
  onOpen,
}: {
  record: ComplaintRecord;
  mode: "zh" | "en" | "bilingual";
  onOpen: (r: ComplaintRecord) => void;
}) {
  const chinese =
    record.complaintMessageZhFinal || record.complaintMessageZhMachine;
  const displayed =
    mode === "en"
      ? record.complaintMessageOriginal
      : chinese || record.complaintMessageOriginal;
  return (
    <div className="min-w-[260px] max-w-xl">
      {mode === "bilingual" ? (
        <>
          <div className="clamp-3 whitespace-pre-wrap break-words leading-6">
            {chinese || <span className="text-neutral-400">暂无中文译文</span>}
          </div>
          <div className="my-1 border-t border-dashed border-line" />
          <div className="clamp-3 whitespace-pre-wrap break-words text-xs leading-5 text-neutral-500">
            {record.complaintMessageOriginal}
          </div>
        </>
      ) : (
        <>
          <p className="clamp-3 whitespace-pre-wrap break-words leading-6">
            {displayed}
          </p>
          {mode === "zh" && !chinese && (
            <span className="mt-1 block text-[10px] text-amber-700">
              待翻译 · 暂显示英文
            </span>
          )}
        </>
      )}
      {record.complaintMessageOriginal.length > 100 ||
      (chinese?.length || 0) > 100 ? (
        <button
          onClick={() => onOpen(record)}
          className="mt-1 text-xs font-semibold text-accent hover:underline"
        >
          ……查看完整内容
        </button>
      ) : null}
    </div>
  );
}
function MessageModal({
  record,
  primarySeriesLabel,
  close,
}: {
  record: ComplaintRecord;
  primarySeriesLabel: (name: string) => string;
  close: () => void;
}) {
  const chinese =
    record.complaintMessageZhFinal || record.complaintMessageZhMachine;
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4"
      onClick={close}
    >
      <section
        className="max-h-[80vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="label">完整投诉内容 · 中英对照</div>
            <h2 className="mt-1 text-lg font-bold">
              {record.sourceSubmissionId || record.productSku}
            </h2>
            <p className="mt-1 text-xs text-neutral-500">
              {primarySeriesLabel(record.primarySeries)} · {record.contactDate}{" "}
              · {record.country}
            </p>
          </div>
          <button onClick={close} aria-label="关闭">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-6 grid gap-4">
          <section>
            <div className="mb-2 text-xs font-bold text-accent">中文译文</div>
            <div className="whitespace-pre-wrap break-words rounded-xl bg-orange-50 p-5 text-sm leading-7">
              {chinese || (
                <span className="text-neutral-400">
                  暂无中文译文，请前往翻译中心录入。
                </span>
              )}
            </div>
          </section>
          <section>
            <div className="mb-2 text-xs font-bold text-neutral-500">
              英文原文（永久保留）
            </div>
            <div className="whitespace-pre-wrap break-words rounded-xl bg-neutral-50 p-5 text-sm leading-7">
              {record.complaintMessageOriginal}
            </div>
          </section>
        </div>
        <div className="mt-5 flex justify-end">
          <button onClick={close} className="btn-primary">
            关闭
          </button>
        </div>
      </section>
    </div>
  );
}
function InlineIssueSelect({
  record,
  issueTypes,
  issueTypeLabel,
  save,
  addNew,
}: {
  record: ComplaintRecord;
  issueTypes: string[];
  issueTypeLabel: (name: string) => string;
  save: (id: string, value: string | null) => Promise<void>;
  addNew: () => void;
}) {
  const [value, setValue] = useState(record.issueType || "");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => setValue(record.issueType || ""), [record.issueType]);
  const classified = Boolean(value);
  async function change(next: string) {
    if (next === "__new__") {
      addNew();
      return;
    }
    const previous = value;
    const scrollTop = window.scrollY;
    setValue(next);
    setBusy(true);
    setFailed(false);
    try {
      await save(record.id, next || null);
    } catch {
      setValue(previous);
      setFailed(true);
    } finally {
      setBusy(false);
      window.requestAnimationFrame(() =>
        window.scrollTo({
          top: Math.min(
            scrollTop,
            Math.max(
              0,
              document.documentElement.scrollHeight - window.innerHeight,
            ),
          ),
          behavior: "auto",
        }),
      );
    }
  }
  return (
    <div className="relative inline-flex max-w-[9rem] items-center">
      <select
        aria-label={`设置投诉 ${record.sourceSubmissionId || record.id.slice(0, 8)} 的问题类型`}
        value={value}
        disabled={busy}
        onChange={(event) => void change(event.target.value)}
        title={failed ? "保存失败，请重试" : "直接选择问题类型"}
        className={`h-7 max-w-full cursor-pointer appearance-none rounded-full border py-1 pl-2.5 pr-7 text-xs font-semibold outline-none transition focus:ring-2 disabled:cursor-wait disabled:opacity-60 ${failed ? "border-red-400 bg-red-50 text-red-700 focus:ring-red-100" : classified ? "border-blue-100 bg-blue-50 text-blue-700 focus:border-blue-300 focus:ring-blue-100" : "border-orange-100 bg-orange-50 text-orange-700 focus:border-orange-300 focus:ring-orange-100"}`}
      >
        <option value="">未分类</option>
        {uniqueIssueTypes(issueTypes, issueTypeLabel, record.issueType).map(
          (option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ),
        )}
        <option value="__new__">＋ 新增分类…</option>
      </select>
      <ChevronDownIcon
        className={`pointer-events-none absolute right-2 h-3.5 w-3.5 ${failed ? "text-red-500" : classified ? "text-blue-500" : "text-orange-500"}`}
      />
    </div>
  );
}

const workflowStatuses: ComplaintWorkflowStatus[] = [
  "待处理",
  "处理中",
  "已关闭",
  "未设置状态",
];
const workflowTone: Record<string, string> = {
  待分类: "border-orange-200 bg-orange-50 text-orange-700",
  待处理: "border-amber-200 bg-amber-50 text-amber-700",
  处理中: "border-blue-200 bg-blue-50 text-blue-700",
  已关闭: "border-emerald-200 bg-emerald-50 text-emerald-700",
  未设置状态: "border-neutral-200 bg-neutral-100 text-neutral-600",
};
function InlineStatusSelect({
  record,
  save,
}: {
  record: ComplaintRecord;
  save: (value: ComplaintWorkflowStatus) => Promise<void>;
}) {
  const derived = statusOf(record);
  const [value, setValue] = useState(derived);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => setValue(statusOf(record)), [record]);
  async function change(next: ComplaintWorkflowStatus) {
    const previous = value,
      scrollTop = window.scrollY;
    setValue(next);
    setBusy(true);
    setFailed(false);
    try {
      await save(next);
    } catch {
      setValue(previous);
      setFailed(true);
    } finally {
      setBusy(false);
      window.requestAnimationFrame(() =>
        window.scrollTo({
          top: Math.min(
            scrollTop,
            Math.max(
              0,
              document.documentElement.scrollHeight - window.innerHeight,
            ),
          ),
          behavior: "auto",
        }),
      );
    }
  }
  if (!record.issueType)
    return (
      <span
        className={`inline-flex h-7 items-center whitespace-nowrap rounded-full border px-2.5 text-xs font-semibold ${workflowTone["待分类"]}`}
      >
        待分类
      </span>
    );
  return (
    <select
      aria-label={`设置投诉 ${record.sourceSubmissionId || record.id.slice(0, 8)} 的处理状态`}
      value={value}
      disabled={busy}
      onChange={(event) =>
        void change(event.target.value as ComplaintWorkflowStatus)
      }
      title={failed ? "保存失败，请重试" : "直接设置处理状态"}
      className={`h-7 min-w-[6.5rem] cursor-pointer rounded-full border px-2 text-xs font-semibold outline-none transition focus:ring-2 disabled:cursor-wait disabled:opacity-60 ${failed ? "border-red-400 bg-red-50 text-red-700" : workflowTone[value] || workflowTone["未设置状态"]}`}
    >
      {workflowStatuses.map((status) => (
        <option key={status} value={status}>
          {status}
        </option>
      ))}
    </select>
  );
}

function NewIssueTypeModal({
  record,
  existingLabels,
  close,
  save,
}: {
  record: ComplaintRecord;
  existingLabels: string[];
  close: () => void;
  save: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    const clean = name.trim();
    if (!clean) {
      setError("请输入分类名称。");
      return;
    }
    if (
      existingLabels.some(
        (label) =>
          label.trim().toLocaleLowerCase("zh-CN") ===
          clean.toLocaleLowerCase("zh-CN"),
      )
    ) {
      setError("该分类已存在，请直接从列表中选择。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await save(clean);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法新增分类");
      setBusy(false);
    }
  }
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4"
      onClick={close}
    >
      <section
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="label">新增问题分类</div>
            <h2 className="mt-1 text-lg font-bold">创建并应用新分类</h2>
            <p className="mt-1 text-xs text-neutral-500">
              将应用到投诉 {record.sourceSubmissionId || record.productSku}
              ，并同步保存到问题类型库。
            </p>
          </div>
          <button onClick={close} disabled={busy} aria-label="关闭新增分类">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
        <label className="mt-5 block">
          <span className="mb-2 block text-sm font-semibold">分类名称</span>
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit();
            }}
            className="field w-full"
            placeholder="例如：电池问题"
            maxLength={50}
          />
        </label>
        {error && (
          <div className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={close} disabled={busy} className="btn-secondary">
            取消
          </button>
          <button
            onClick={() => void submit()}
            disabled={busy}
            className="btn-accent"
          >
            {busy ? "正在保存…" : "新增并应用"}
          </button>
        </div>
      </section>
    </div>
  );
}

function ComplaintEditor({
  record,
  issueTypes,
  primarySeriesDefinitions,
  secondarySeriesDefinitions,
  issueTypeLabel,
  primarySeriesLabel,
  secondarySeriesLabel,
  close,
  save,
}: {
  record: ComplaintRecord;
  issueTypes: string[];
  primarySeriesDefinitions: SeriesDefinition[];
  secondarySeriesDefinitions: SeriesDefinition[];
  issueTypeLabel: (name: string) => string;
  primarySeriesLabel: (name: string) => string;
  secondarySeriesLabel: (
    name: string | null,
    primary?: string | null,
  ) => string;
  close: () => void;
  save: (changes: ComplaintUpdate, translation: string) => Promise<void>;
}) {
  const [form, setForm] = useState({
    contactDate: record.contactDate,
    productSku: record.productSku,
    productName: record.productName || "",
    primarySeries: record.primarySeries,
    secondarySeries: record.secondarySeries || "",
    country: record.country,
    store: record.store || "",
    batchCode: record.batchCode || "",
    issueType: record.issueType || "",
    workflowStatus: (record.workflowStatus ||
      (statusOf(record) === "待分类"
        ? "未设置状态"
        : statusOf(record))) as ComplaintWorkflowStatus,
    translation:
      record.complaintMessageZhFinal || record.complaintMessageZhMachine || "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const secondaryOptions = secondarySeriesDefinitions.filter(
    (item) => item.primarySeriesName === form.primarySeries,
  );
  const field = (name: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [name]: value }));
  async function submit() {
    if (
      !form.contactDate ||
      !form.productSku.trim() ||
      !form.primarySeries ||
      !form.country.trim()
    ) {
      setError("联络日期、SKU、主要系列和国家为必填字段。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { translation, ...complaintChanges } = form;
      await save(
        {
          ...complaintChanges,
          productName: complaintChanges.productName || null,
          secondarySeries: complaintChanges.secondarySeries || null,
          store: complaintChanges.store || null,
          batchCode: complaintChanges.batchCode || null,
          issueType: complaintChanges.issueType || null,
        },
        translation,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法保存投诉记录");
      setBusy(false);
    }
  }
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4"
      onClick={close}
    >
      <section
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="label">编辑投诉记录</div>
            <h2 className="mt-1 text-lg font-bold">
              {record.sourceSubmissionId || record.id.slice(0, 8)}
            </h2>
          </div>
          <button onClick={close} aria-label="关闭编辑">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <EditField label="联络日期">
            <input
              type="date"
              value={form.contactDate}
              onChange={(event) => field("contactDate", event.target.value)}
              className="field w-full"
            />
          </EditField>
          <EditField label="产品 SKU">
            <input
              value={form.productSku}
              onChange={(event) => field("productSku", event.target.value)}
              className="field w-full"
            />
          </EditField>
          <EditField label="产品名称">
            <input
              value={form.productName}
              onChange={(event) => field("productName", event.target.value)}
              className="field w-full"
            />
          </EditField>
          <EditField label="国家/市场">
            <input
              value={form.country}
              onChange={(event) => field("country", event.target.value)}
              className="field w-full"
            />
          </EditField>
          <EditField label="主要系列">
            <select
              value={form.primarySeries}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  primarySeries: event.target.value,
                  secondarySeries: "",
                }))
              }
              className="field w-full"
            >
              {primarySeriesDefinitions.map((item) => (
                <option key={item.name} value={item.name}>
                  {primarySeriesLabel(item.name)}
                </option>
              ))}
            </select>
          </EditField>
          <EditField label="次要系列">
            <select
              value={form.secondarySeries}
              onChange={(event) => field("secondarySeries", event.target.value)}
              className="field w-full"
            >
              <option value="">无次要系列</option>
              {secondaryOptions.map((item) => (
                <option
                  key={`${item.primarySeriesName}-${item.name}`}
                  value={item.name}
                >
                  {secondarySeriesLabel(item.name, item.primarySeriesName)}
                </option>
              ))}
            </select>
          </EditField>
          <EditField label="店铺">
            <input
              value={form.store}
              onChange={(event) => field("store", event.target.value)}
              className="field w-full"
            />
          </EditField>
          <EditField label="批次代码">
            <input
              value={form.batchCode}
              onChange={(event) => field("batchCode", event.target.value)}
              className="field w-full"
            />
          </EditField>
          <EditField label="问题类型">
            <select
              value={form.issueType}
              onChange={(event) => field("issueType", event.target.value)}
              className="field w-full"
            >
              <option value="">未分类</option>
              {uniqueIssueTypes(
                issueTypes,
                issueTypeLabel,
                record.issueType,
              ).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </EditField>
          <EditField label="处理状态">
            <select
              value={form.workflowStatus}
              disabled={!form.issueType}
              onChange={(event) => field("workflowStatus", event.target.value)}
              className="field w-full disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400"
            >
              {workflowStatuses.map((status) => (
                <option key={status}>{status}</option>
              ))}
            </select>
            {!form.issueType && (
              <small className="mt-1 block text-neutral-400">
                未选择问题类型时自动显示为待分类
              </small>
            )}
          </EditField>
        </div>
        <label className="mt-4 block">
          <span className="text-sm font-semibold">中文译文</span>
          <textarea
            value={form.translation}
            onChange={(event) => field("translation", event.target.value)}
            rows={5}
            className="mt-2 w-full resize-y rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm leading-6 outline-none focus:border-accent focus:ring-2 focus:ring-orange-100"
            placeholder="可在此录入或修改中文译文"
          />
          <span className="mt-1 block text-xs text-neutral-500">
            保存后将作为已人工确认的最终中文译文。
          </span>
        </label>
        <label className="mt-4 block">
          <span className="text-sm font-semibold">英文投诉原文</span>
          <textarea
            value={record.complaintMessageOriginal}
            readOnly
            rows={5}
            className="mt-2 w-full resize-none rounded-lg border border-line bg-neutral-50 p-3 text-sm leading-6 text-neutral-600"
          />
          <span className="mt-1 block text-xs text-neutral-500">
            英文投诉原文按业务规则永久保留，不能在此覆盖。
          </span>
        </label>
        {error && (
          <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={close} className="btn-secondary">
            取消
          </button>
          <button
            disabled={busy}
            onClick={() => void submit()}
            className="btn-accent"
          >
            {busy ? "正在保存…" : "保存修改"}
          </button>
        </div>
      </section>
    </div>
  );
}

function EditField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label>
      <span className="mb-2 block text-sm font-semibold">{label}</span>
      {children}
    </label>
  );
}

function DeleteConfirm({
  step,
  scope,
  count,
  busy,
  close,
  confirm,
}: {
  step: 1 | 2;
  scope: "page" | "all";
  count: number;
  busy: boolean;
  close: () => void;
  confirm: () => Promise<void>;
}) {
  const second = step === 2;
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4"
      onClick={close}
    >
      <section
        className={`w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl ${second ? "ring-2 ring-red-500" : ""}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="grid h-11 w-11 place-items-center rounded-full bg-red-50 text-red-600">
          <TrashIcon className="h-5 w-5" />
        </div>
        <div className="mt-4 text-xs font-bold uppercase tracking-wider text-red-600">
          {second ? "第二次安全确认" : "删除确认"}
        </div>
        <h2 className="mt-1 text-lg font-bold">
          {second
            ? scope === "all"
              ? "警告：将删除全部投诉数据"
              : "警告：将删除当前整页数据"
            : `确认删除 ${count} 条投诉？`}
        </h2>
        <p className="mt-2 text-sm leading-6 text-neutral-500">
          {second
            ? `本次操作将删除 ${count} 条记录，且所选范围覆盖${scope === "all" ? "全部投诉内容" : "当前页面的全部记录"}。请再次确认。`
            : `即将删除 ${count} 条投诉记录。删除后，仪表盘、系列分析和问题类型统计会立即更新。`}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={close} disabled={busy} className="btn-secondary">
            取消
          </button>
          <button
            onClick={() => void confirm()}
            disabled={busy}
            className="inline-flex h-9 items-center justify-center rounded-lg bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            {busy ? "正在删除…" : second ? `再次确认删除 ${count} 条` : "继续"}
          </button>
        </div>
      </section>
    </div>
  );
}
