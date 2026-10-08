// 物料档案 Excel 导入弹窗:选 xlsx/csv → 解析预览 → 确认导入 → 显示结果(来料/塑胶两页共用)。
// 照抄老系统 web/src/components/MaterialImportModal.tsx;
// 解析纯函数在 @/lib/materialImport(测试对照 web/src/__tests__/materialImport.test.ts,web2 同名已移植)。
import { useState } from "react";
import { UploadSimple } from "@phosphor-icons/react";
import type { ImportResult } from "@/api/types";
import { decodeCsvBuffer, splitDelimited } from "@/lib/bomImport";
import {
  parseMaterialGrid,
  type MaterialImportParsedRow,
  type MaterialImportSpec,
} from "@/lib/materialImport";
import { PickerDialog, pickerThCls } from "@/components/doc/PickerDialog";
import { DocToast } from "@/components/doc/DocToast";
import { cn } from "@/lib/utils";

const errMsg = (e: unknown, fallback: string) =>
  e instanceof Error && e.message ? e.message : fallback;

export default function MaterialImportModal({
  open,
  title,
  spec,
  onImport,
  onClose,
  onDone,
}: {
  open: boolean;
  title: string;
  spec: MaterialImportSpec;
  onImport: (rows: Record<string, unknown>[]) => Promise<ImportResult>;
  onClose: () => void;
  onDone: () => void; // 导入成功后刷新列表/类别树
}) {
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<MaterialImportParsedRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);

  const reset = () => {
    setFileName("");
    setRows([]);
    setResult(null);
  };
  const handleClose = () => {
    reset();
    onClose();
  };

  const readFile = async (file: File) => {
    reset();
    try {
      const buf = await file.arrayBuffer();
      let grid: unknown[][];
      if (file.name.toLowerCase().endsWith(".csv")) {
        grid = splitDelimited(decodeCsvBuffer(buf));
      } else {
        // xlsx 库较大,解析文件时才按需加载(不进首屏包)
        const XLSX = await import("xlsx");
        const wb = XLSX.read(buf);
        grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], {
          header: 1,
          raw: true,
          defval: "",
        });
      }
      const parsed = parseMaterialGrid(grid, spec);
      if (!parsed.hasHeader || parsed.rows.length === 0) {
        setToast({ text: "未解析到数据(找不到含「物料编号」的表头行)", tone: "err" });
        return;
      }
      setFileName(file.name);
      setRows(parsed.rows);
      setResult(null);
    } catch (e) {
      setToast({ text: errMsg(e, "文件解析失败,请确认是 xlsx 或 csv 文件"), tone: "err" });
    }
  };

  const validCount = rows.filter((r) => !r.错误).length;

  const confirm = async () => {
    setImporting(true);
    try {
      const payload = rows.filter((r) => !r.错误).map((r) => ({ 行号: r.行号, ...r.数据 }));
      const res = await onImport(payload);
      setResult(res);
      if (res.新增 > 0) onDone();
    } catch (e) {
      setToast({ text: errMsg(e, "导入失败"), tone: "err" });
    } finally {
      setImporting(false);
    }
  };

  const cell = (r: MaterialImportParsedRow, k: string) => {
    const v = r.数据[k];
    return v == null ? "" : String(v);
  };

  return (
    <PickerDialog
      open={open}
      onClose={handleClose}
      title={title}
      width="sm:max-w-[960px]"
      footer={
        <>
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
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="f-btn h-9 cursor-pointer px-4 text-sm">
            <UploadSimple className="h-4 w-4" />
            选择 xlsx / csv 文件
            <input
              type="file"
              accept=".xlsx,.csv"
              aria-label="选择导入文件"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void readFile(f);
                e.target.value = "";
              }}
            />
          </label>
          {fileName && <span className="text-sm text-disabled">{fileName}</span>}
          {rows.length > 0 && (
            <span className="text-sm text-disabled">
              共 {rows.length} 行,可导入 {validCount} 行
              {rows.length - validCount > 0 ? `,${rows.length - validCount} 行有误` : ""}
            </span>
          )}
        </div>

        {rows.length > 0 && (
          <div className="max-h-[42vh] overflow-auto rounded-lg border border-black/8">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  {["行号", "物料编号", "物料名称", "规格", "颜色", "单位", "单价", "备注", "错误"].map(
                    (h) => (
                      <th key={h} className={pickerThCls}>
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.行号}
                    className={cn("border-b border-black/6", r.错误 && "bg-[#dc2626]/6")}
                  >
                    <td className="f-mono px-3 py-1.5">{r.行号}</td>
                    <td className="f-mono px-3 py-1.5">{cell(r, "物料编号")}</td>
                    <td className="px-3 py-1.5">{cell(r, "物料名称")}</td>
                    <td className="px-3 py-1.5">{cell(r, "规格")}</td>
                    <td className="px-3 py-1.5">{cell(r, "颜色")}</td>
                    <td className="px-3 py-1.5">{cell(r, "单位")}</td>
                    <td className="f-mono px-3 py-1.5 text-right">{cell(r, "单价")}</td>
                    <td className="max-w-48 truncate px-3 py-1.5" title={cell(r, "备注")}>
                      {cell(r, "备注")}
                    </td>
                    <td className="px-3 py-1.5 text-[#dc2626]">{r.错误 ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {result && (
          <div
            className={cn(
              "rounded-lg border px-4 py-3 text-sm",
              result.失败 > 0
                ? "border-[#d97706]/30 bg-[#d97706]/8 text-[#92400e]"
                : "border-[#059669]/30 bg-[#059669]/8 text-[#065f46]",
            )}
          >
            <div className="font-semibold">
              导入完成:新增 {result.新增} 条,跳过 {result.跳过} 条(编号已存在),失败{" "}
              {result.失败} 条
            </div>
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
      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </PickerDialog>
  );
}
