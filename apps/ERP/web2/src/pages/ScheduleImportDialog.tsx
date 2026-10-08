// 客户排期 Excel 导入弹窗:选 xlsx/xls/csv -> 逐工作表解析(状态按表名推定) -> 预览 -> 确认导入 -> 显示结果
// 行为照抄老系统 web/src/pages/scheduling/ScheduleImportModal.tsx;
// 一个文件多个工作表(总排期/已走货/取消单…),全部解析;跳过无表头/临时筛选页。
import { useRef, useState } from "react";
import { UploadSimple } from "@phosphor-icons/react";
import type * as XLSXT from "xlsx";
import type { ScheduleImportResult } from "@/api/types";
import {
  decodeCsvBuffer,
  guessScheduleCustomer,
  parseScheduleGrid,
  splitDelimited,
  yearFromFileName,
  type ScheduleImportRowData,
  type ScheduleSheetParseResult,
} from "@/lib/schedulingImport";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onImport: (
    排期客户: string,
    文件名: string,
    rows: Record<string, unknown>[],
  ) => Promise<ScheduleImportResult>;
  onClose: () => void;
  onDone: () => void; // 导入成功后刷新列表
}

const MAX_COLS = 60; // 排期表真实数据在前 ~20 列;Excel 整表格式可能把范围撑到 16384 列,必须截断
const errMsg = (e: unknown, fallback: string) =>
  e instanceof Error && e.message ? e.message : fallback;

// 有界读取工作表:按 !ref 范围截断到 MAX_COLS 列,逐格取稀疏单元格,避免巨大空白区域撑爆内存
function sheetToGrid(XLSX: typeof XLSXT, ws: XLSXT.WorkSheet): unknown[][] {
  const ref = ws["!ref"];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  range.e.c = Math.min(range.e.c, range.s.c + MAX_COLS - 1);
  const grid: unknown[][] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const cells: unknown[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      cells.push(cell ? cell.v : "");
    }
    grid.push(cells);
  }
  return grid;
}

const STATUS_STYLE: Record<string, string> = {
  在排: "border-info/50 bg-info/10 text-info-foreground",
  已走货: "border-[#16a34a]/50 bg-[#16a34a]/10 text-[#15803d]",
  已取消: "border-[#dc2626]/50 bg-[#dc2626]/10 text-[#dc2626]",
};

export function StatusTag({ 状态 }: { 状态?: string }) {
  if (!状态) return null;
  // 兼容 "在排 3" 这类带计数的展示文本:按首词取色
  const key = 状态.split(" ")[0];
  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
        STATUS_STYLE[key] ?? "border-black/15 bg-black/5 text-[#5f6b7d]",
      )}
    >
      {状态}
    </span>
  );
}

export default function ScheduleImportDialog({ open, onImport, onClose, onDone }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [排期客户, set排期客户] = useState("");
  const [sheets, setSheets] = useState<ScheduleSheetParseResult[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ScheduleImportResult | null>(null);
  const [error, setError] = useState("");

  const reset = () => {
    setFileName("");
    set排期客户("");
    setSheets([]);
    setSkipped([]);
    setResult(null);
    setError("");
  };
  const handleClose = () => {
    reset();
    onClose();
  };

  const readFile = async (file: File) => {
    reset();
    try {
      const buf = await file.arrayBuffer();
      let parsed: ScheduleSheetParseResult[];
      const 默认年份 = yearFromFileName(file.name);
      if (file.name.toLowerCase().endsWith(".csv")) {
        parsed = [parseScheduleGrid(splitDelimited(decodeCsvBuffer(buf)), "CSV", 默认年份)];
      } else {
        // xlsx 库较大,解析文件时才按需加载(不进首屏包);cellDates 让日期格直接给 Date
        const XLSX: typeof XLSXT = await import("xlsx");
        const wb = XLSX.read(buf, { cellDates: true });
        parsed = wb.SheetNames.map((n) =>
          parseScheduleGrid(sheetToGrid(XLSX, wb.Sheets[n]), n, 默认年份),
        );
      }
      const ok = parsed.filter((p) => p.hasHeader && p.rows.length > 0);
      if (ok.length === 0) {
        setError("未解析到排期数据(找不到含 货号/PO号/数量 的表头行)");
        return;
      }
      setFileName(file.name);
      set排期客户(guessScheduleCustomer(file.name));
      setSheets(ok);
      setSkipped(parsed.filter((p) => !p.hasHeader || p.rows.length === 0).map((p) => p.工作表));
      setResult(null);
    } catch (e) {
      setError(errMsg(e, "文件解析失败,请确认是 xlsx / xls / csv 文件"));
    }
  };

  const allRows = sheets.flatMap((s) => s.rows);
  const validCount = allRows.filter((r) => !r.错误).length;

  const confirm = async () => {
    const cust = 排期客户.trim();
    if (!cust) {
      setError("请填写排期客户(如 ZURU / TOMY)");
      return;
    }
    setImporting(true);
    setError("");
    try {
      const payload = allRows
        .filter((r) => !r.错误)
        .map((r) => {
          const copy: Record<string, unknown> = { ...r };
          delete copy.错误;
          if (copy.原始数据) copy.原始数据 = JSON.stringify(copy.原始数据);
          return copy;
        });
      const res = await onImport(cust, fileName, payload);
      setResult(res);
      if (res.新增 > 0 || res.更新 > 0) onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "导入失败");
    } finally {
      setImporting(false);
    }
  };

  const PREVIEW_COLS: { key: keyof ScheduleImportRowData; label: string; num?: boolean }[] = [
    { key: "行号", label: "行号" },
    { key: "状态", label: "状态" },
    { key: "来源工作表", label: "工作表" },
    { key: "PO号", label: "PO号" },
    { key: "货号", label: "货号" },
    { key: "品名", label: "品名" },
    { key: "数量", label: "数量", num: true },
    { key: "走货期", label: "走货期" },
    { key: "错误", label: "错误" },
  ];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden border-black/10 bg-white text-[#1a2330] sm:max-w-[980px]">
        <DialogHeader>
          <DialogTitle>导入客户排期表</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              aria-label="排期文件"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void readFile(f);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className="f-btn h-10 px-4"
              onClick={() => fileRef.current?.click()}
            >
              <UploadSimple className="h-4.5 w-4.5" />
              选择 xlsx / xls / csv 文件
            </button>
            {fileName && <span className="text-sm text-[#5f6b7d]">{fileName}</span>}
            {fileName && (
              <label className="flex items-center gap-2 text-sm text-[#3d4a5c]">
                排期客户：
                <input
                  className="f-input h-9 w-44"
                  aria-label="导入排期客户"
                  placeholder="如 ZURU / TOMY"
                  value={排期客户}
                  onChange={(e) => set排期客户(e.target.value)}
                />
              </label>
            )}
          </div>

          {error && <p className="text-sm text-[#dc2626]">{error}</p>}

          {sheets.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#5f6b7d]">
              {sheets.map((s) => (
                <span key={s.工作表} className="inline-flex items-center gap-1.5">
                  {s.工作表}
                  <StatusTag 状态={s.状态} />
                  {s.rows.length} 行
                </span>
              ))}
              {skipped.length > 0 && (
                <span>跳过工作表:{skipped.join("、")}(无排期表头或为临时筛选页)</span>
              )}
              <span>
                共 {allRows.length} 行,可导入 {validCount} 行
                {allRows.length - validCount > 0 ? `,${allRows.length - validCount} 行有误` : ""}
              </span>
            </div>
          )}

          {allRows.length > 0 && (
            <div className="f-panel max-h-[46vh] overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-black/8 bg-black/[0.03]">
                    {PREVIEW_COLS.map((c) => (
                      <th
                        key={c.key}
                        className={cn(
                          "f-label sticky top-0 z-10 bg-[#f7faf8] px-3 py-2 text-left font-medium whitespace-nowrap",
                          c.num && "text-right",
                        )}
                      >
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {allRows.map((r) => (
                    <tr
                      key={`${r.来源工作表}-${r.行号}`}
                      className={cn(
                        "border-b border-black/6 last:border-0",
                        r.错误 && "bg-[#dc2626]/[0.06]",
                      )}
                    >
                      {PREVIEW_COLS.map((c) => (
                        <td
                          key={c.key}
                          className={cn(
                            "max-w-44 truncate px-3 py-1.5 text-[#3d4a5c]",
                            c.num && "f-mono text-right",
                            c.key === "错误" && "text-[#dc2626]",
                          )}
                        >
                          {c.key === "状态" ? (
                            <StatusTag 状态={r.状态} />
                          ) : (
                            String(r[c.key] ?? "")
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {result && (
            <div
              className={cn(
                "rounded-xl border px-4 py-3 text-sm",
                result.失败 > 0
                  ? "border-[#d97706]/40 bg-[#d97706]/[0.08] text-[var(--warning,#d97706)]"
                  : "border-[#16a34a]/40 bg-[#16a34a]/[0.08] text-[#15803d]",
              )}
            >
              <p className="font-semibold">
                导入完成:新增 {result.新增} 条,更新 {result.更新} 条(重复导入同步状态/日期),失败{" "}
                {result.失败} 条
              </p>
              {result.失败明细.length > 0 && (
                <div className="mt-2 max-h-40 overflow-auto">
                  {result.失败明细.map((f, i) => (
                    <div key={f.行号 ?? i}>
                      第 {f.行号} 行{f.物料编号 ? `(${f.物料编号})` : ""}:{f.原因}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <button type="button" className="f-btn h-10 px-4" onClick={handleClose}>
            取消
          </button>
          <button
            type="button"
            className="f-btn f-btn-cyan h-10 px-4"
            disabled={validCount === 0 || result !== null || importing}
            onClick={() => void confirm()}
          >
            确认导入
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
