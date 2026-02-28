"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";
import { parseScheduleExcel, parseMAFromScheduleExcel } from "@/lib/parseExcel";
import { parseQuotationExcel, QuotationItem } from "@/lib/parseQuotation";
import { SchedulePORow, MARecord, SCHEDULE_PACKAGING_COLUMNS } from "@/lib/data";
import {
  getScheduleRows,
  saveScheduleRows,
  getQuotationItems,
  saveQuotationItems,
  getMARecords,
  saveMARecords,
} from "@/lib/store";

export default function ImportSchedule({
  onImported,
}: {
  onImported: () => void;
}) {
  const [scheduleRows, setScheduleRows] = useState<SchedulePORow[]>([]);
  const [quotationItems, setQuotationItems] = useState<QuotationItem[]>([]);
  const [maRecords, setMARecords] = useState<MARecord[]>([]);
  const [importing, setImporting] = useState<"schedule" | "quotation" | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setScheduleRows(getScheduleRows());
    setQuotationItems(getQuotationItems());
    setMARecords(getMARecords());
  }, []);

  const handleScheduleFile = useCallback(async (file: File) => {
    setImporting("schedule");
    setError("");
    try {
      const buffer = await file.arrayBuffer();
      const parsed = parseScheduleExcel(buffer);
      if (parsed.length === 0) {
        setError("未能从排期表读取有效 PO 数据。请确认是 9565 排期表。");
        setImporting(null);
        return;
      }
      saveScheduleRows(parsed);
      setScheduleRows(parsed);

      // Also parse MA records from 包材MA sheet
      const maRecs = parseMAFromScheduleExcel(buffer);
      if (maRecs.length > 0) {
        saveMARecords(maRecs);
        setMARecords(maRecs);
      }
    } catch (err) {
      setError(`排期表解析失败: ${err instanceof Error ? err.message : String(err)}`);
    }
    setImporting(null);
  }, []);

  const handleQuotationFile = useCallback(async (file: File) => {
    setImporting("quotation");
    setError("");
    try {
      const buffer = await file.arrayBuffer();
      const parsed = parseQuotationExcel(buffer);
      if (parsed.length === 0) {
        setError("未能从报价表读取有效阶梯价数据。请确认文件格式。");
        setImporting(null);
        return;
      }
      saveQuotationItems(parsed);
      setQuotationItems(parsed);
    } catch (err) {
      setError(`报价表解析失败: ${err instanceof Error ? err.message : String(err)}`);
    }
    setImporting(null);
  }, []);

  const uniquePOs = new Set(scheduleRows.map((r) => r.poNumber)).size;
  const bothImported = scheduleRows.length > 0 && quotationItems.length > 0;

  return (
    <div className="space-y-6">
      {/* Two upload cards side by side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Schedule Upload */}
        <UploadCard
          title="1. 排期表"
          subtitle="9565 松鼠生产排期表 (.xlsx)"
          description="系统会读取 PO 数据（AH-AV 列）及包材MA记录"
          isLoaded={scheduleRows.length > 0}
          loadedText={`已载入 ${scheduleRows.length} 行 PO，共 ${uniquePOs} 个 PO${maRecords.length > 0 ? ` | ${maRecords.length} 条 MA 记录` : ""}`}
          isLoading={importing === "schedule"}
          onFile={handleScheduleFile}
        />

        {/* Quotation Upload */}
        <UploadCard
          title="2. 报价表"
          subtitle="ZURU 9565 松鼠报价 Quotation (.xls/.xlsx)"
          description="系统会读取每个 Item 的包装物料阶梯价（标记「有阶梯价」的项目）"
          isLoaded={quotationItems.length > 0}
          loadedText={`已载入 ${quotationItems.length} 个 Item 报价`}
          isLoading={importing === "quotation"}
          onFile={handleQuotationFile}
        />
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-2">
          <AlertTriangle size={18} className="text-destructive mt-0.5 shrink-0" />
          <span className="text-sm text-red-800">{error}</span>
        </div>
      )}

      {/* Ready to proceed */}
      {bothImported && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CheckCircle2 size={20} className="text-success shrink-0" />
            <div>
              <p className="text-sm font-medium text-green-900">
                两份表格都已载入，可以开始计算差价
              </p>
              <p className="text-xs text-green-700 mt-0.5">
                {scheduleRows.length} 行排期 × {quotationItems.length} 个 Item 报价
              </p>
            </div>
          </div>
          <button
            onClick={onImported}
            className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors"
          >
            前往 PO 差价计算
            <ArrowRight size={16} />
          </button>
        </div>
      )}

      {/* Quotation items preview */}
      {quotationItems.length > 0 && (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <h3 className="text-base font-semibold text-foreground">
              报价表：已识别的阶梯价物料
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50">
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Item (Sheet)</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">匹配 Item 代码</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">阶梯价物料</th>
                  <th className="text-right px-4 py-2 font-medium text-muted-foreground">最高价</th>
                  <th className="text-right px-4 py-2 font-medium text-muted-foreground">最低价</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {quotationItems.map((qi) =>
                  qi.tieredMaterials.map((mat, idx) => (
                    <tr key={`${qi.sheetName}-${idx}`} className="hover:bg-muted/30">
                      {idx === 0 ? (
                        <td
                          className="px-4 py-2 font-medium"
                          rowSpan={qi.tieredMaterials.length}
                        >
                          {qi.sheetName}
                        </td>
                      ) : null}
                      {idx === 0 ? (
                        <td
                          className="px-4 py-2 font-mono text-xs text-muted-foreground"
                          rowSpan={qi.tieredMaterials.length}
                        >
                          {qi.itemPatterns.join(", ")}
                        </td>
                      ) : null}
                      <td className="px-4 py-2">{mat.name}</td>
                      <td className="px-4 py-2 text-right font-mono">
                        ${Math.max(...mat.tierPrices.filter((p) => p > 0)).toFixed(3)}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-success">
                        ${Math.min(...mat.tierPrices.filter((p) => p > 0)).toFixed(3)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Schedule preview */}
      {scheduleRows.length > 0 && (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <h3 className="text-base font-semibold text-foreground">
              排期表预览（前 30 行）
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50">
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">PO</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">ITEM#</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground">PO 数量</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">包装物料</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {scheduleRows.slice(0, 30).map((row) => (
                  <tr key={row.rowNum} className="hover:bg-muted/30">
                    <td className="px-3 py-2 font-mono text-xs">{row.poNumber}</td>
                    <td className="px-3 py-2">{row.itemNumber}</td>
                    <td className="px-3 py-2 text-right font-mono">
                      {row.poQuantity.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {Object.entries(row.packagingQty)
                        .map(
                          ([col, qty]) =>
                            `${SCHEDULE_PACKAGING_COLUMNS[col] || col}: ${qty.toLocaleString()}`
                        )
                        .join(" | ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Upload Card Component ---
function UploadCard({
  title,
  subtitle,
  description,
  isLoaded,
  loadedText,
  isLoading,
  onFile,
}: {
  title: string;
  subtitle: string;
  description: string;
  isLoaded: boolean;
  loadedText: string;
  isLoading: boolean;
  onFile: (file: File) => void;
}) {
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) onFile(file);
    },
    [onFile]
  );

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) onFile(file);
    },
    [onFile]
  );

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      className={`rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
        isLoaded
          ? "bg-green-50/50 border-green-300"
          : "bg-card border-border hover:border-primary/50"
      }`}
    >
      <div className="flex flex-col items-center gap-3">
        {isLoaded ? (
          <CheckCircle2 size={32} className="text-success" />
        ) : (
          <Upload size={32} className="text-muted-foreground" />
        )}
        <div>
          <h3 className="text-base font-semibold text-foreground">{title}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
        </div>
        {isLoaded ? (
          <p className="text-sm text-green-700 font-medium">{loadedText}</p>
        ) : (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
        <label className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium cursor-pointer hover:bg-primary/90 transition-colors">
          <FileSpreadsheet size={14} />
          {isLoading ? "解析中..." : isLoaded ? "重新上传" : "选择文件"}
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={handleInput}
            className="hidden"
            disabled={isLoading}
          />
        </label>
      </div>
    </div>
  );
}
