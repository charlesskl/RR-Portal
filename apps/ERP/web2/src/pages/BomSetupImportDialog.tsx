// BOM 物料设置「导入」弹窗:粘贴 Excel(TSV) / 上传 CSV → 解析校验 → 预览 → 填入明细网格。
// 照抄老系统 BomSetupPage 内联导入弹窗;解析/校验纯函数在 @/lib/bomImport(测试对照
// web/src/__tests__/bomImport.test.ts,web2 同名测试已移植)。
import { useEffect, useState } from "react";
import { UploadSimple } from "@phosphor-icons/react";
import { masterDataApi } from "@/api/endpoints";
import {
  decodeCsvBuffer,
  parseBomImport,
  validateBomImportRows,
  type BomImportCheckedRow,
  type BomImportMaterial,
} from "@/lib/bomImport";
import { PickerDialog, pickerThCls } from "@/components/doc/PickerDialog";
import { DocToast } from "@/components/doc/DocToast";
import { cn } from "@/lib/utils";

export interface BomImportApplyRow {
  物料编号: string;
  物料名称: string;
  工模编号: string;
  规格: string;
  材料: string;
  颜色: string;
  单位: string;
  用量?: number;
}

const errMsg = (e: unknown, fallback: string) =>
  e instanceof Error && e.message ? e.message : fallback;

export default function BomSetupImportDialog({
  open,
  款号,
  onClose,
  onApply,
}: {
  open: boolean;
  款号: string;
  onClose: () => void;
  // mode: append=追加到现有明细 / replace=替换全部明细(由父级落行)
  onApply: (rows: BomImportApplyRow[], mode: "append" | "replace") => void;
}) {
  const [tab, setTab] = useState<"paste" | "file">("paste");
  const [text, setText] = useState("");
  const [rows, setRows] = useState<BomImportCheckedRow[]>([]);
  const [hasHeader, setHasHeader] = useState(false);
  const [mode, setMode] = useState<"append" | "replace">("append");
  const [master, setMaster] = useState<Map<string, BomImportMaterial> | null>(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  // 打开时重置并一次性全量拉取物料档案建 Map 供逐行校验
  useEffect(() => {
    if (!open) return;
    setTab("paste");
    setText("");
    setRows([]);
    setHasHeader(false);
    setMode("append");
    if (master) return;
    setLoading(true);
    void (async () => {
      try {
        const r = await masterDataApi("materials").list(1, 1000, "");
        const map = new Map<string, BomImportMaterial>();
        for (const m of r.items) {
          const code = String(m.物料编号 ?? "").replace(/\s/g, "");
          if (code && !map.has(code)) map.set(code, m as BomImportMaterial);
        }
        setMaster(map);
      } catch (e) {
        setToast({ text: errMsg(e, "加载物料档案失败,无法校验导入数据"), tone: "err" });
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const applyText = (t: string) => {
    if (!t.trim()) {
      setRows([]);
      setHasHeader(false);
      return;
    }
    const { rows: parsed, hasHeader: hh } = parseBomImport(t);
    setHasHeader(hh);
    setRows(validateBomImportRows(parsed, master ?? new Map()));
  };

  const readFile = async (file: File) => {
    try {
      const t = decodeCsvBuffer(await file.arrayBuffer());
      setText(t);
      applyText(t);
    } catch (e) {
      setToast({ text: errMsg(e, "读取文件失败"), tone: "err" });
    }
  };

  const validCount = rows.filter((r) => !r.错误).length;

  const doImport = () => {
    const valid = rows.filter((r) => !r.错误);
    const skipped = rows.length - valid.length;
    if (!valid.length) {
      setToast({ text: "没有可导入的有效行", tone: "err" });
      return;
    }
    onApply(
      valid.map((r) => ({
        物料编号: r.物料编号,
        物料名称: r.material?.物料名称 ?? r.物料名称 ?? "",
        工模编号: r.material?.工模编号 ?? "",
        规格: r.material?.规格 ?? r.规格 ?? "",
        材料: r.material?.材料 ?? r.material?.物料类别 ?? "",
        颜色: r.material?.颜色 ?? r.颜色 ?? "",
        单位: r.material?.单位 ?? r.单位 ?? "",
        用量: r.使用数量,
      })),
      mode,
    );
    setToast({
      text: `已导入 ${valid.length} 行${skipped ? `,跳过 ${skipped} 行无效数据` : ""},请检查后保存`,
      tone: "ok",
    });
    onClose();
  };

  return (
    <PickerDialog
      open={open}
      onClose={onClose}
      title={`导入物料明细 · ${款号}`}
      width="sm:max-w-[900px]"
      footer={
        <>
          <button type="button" className="f-btn h-10 px-4" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="f-btn f-btn-cyan h-10 px-4"
            disabled={!validCount}
            onClick={doImport}
          >
            确定导入
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex gap-1 rounded-xl border border-black/8 bg-black/[0.03] p-1">
          {(
            [
              ["paste", "粘贴 Excel 内容"],
              ["file", "上传 CSV 文件"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={cn(
                "h-9 flex-1 rounded-lg px-4 text-sm transition-colors",
                tab === k
                  ? "bg-[#16a34a]/12 font-semibold text-[#15803d]"
                  : "text-[#5f6b7d] hover:text-[#3d4a5c]",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "paste" ? (
          <div className="space-y-2">
            <textarea
              aria-label="粘贴Excel内容"
              rows={6}
              className="f-input h-auto w-full py-2 font-mono text-sm"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                "从 Excel 复制后直接粘贴(支持带表头)。\n表头列:物料编号(必填)、物料名称、规格、颜色、单位、使用数量;无表头时第1列=物料编号、第2列=使用数量。"
              }
            />
            <button
              type="button"
              className="f-btn h-9 px-4 text-sm"
              disabled={loading}
              onClick={() => applyText(text)}
            >
              解析
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <label className="f-btn h-9 cursor-pointer px-4 text-sm">
              <UploadSimple className="h-4 w-4" />
              选择 CSV / TXT 文件
              <input
                type="file"
                accept=".csv,.txt"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void readFile(f);
                  e.target.value = "";
                }}
              />
            </label>
            <span className="text-sm text-disabled">
              支持 UTF-8 / GBK 编码;xlsx 请先在 Excel 中另存为 CSV。
            </span>
          </div>
        )}

        <div className="text-sm text-[#5f6b7d]">
          共 {rows.length} 行,有效 {validCount} 行,跳过 {rows.length - validCount} 行
          {rows.length > 0 &&
            (hasHeader ? "(已按表头列名映射)" : "(无表头,按第1列=物料编号、第2列=使用数量)")}
        </div>

        <div className="max-h-[38vh] overflow-auto rounded-lg border border-black/8">
          <table className="w-full text-sm">
            <thead>
              <tr>
                {["行号", "物料编号", "使用数量", "物料名称", "规格", "颜色", "单位", "校验"].map(
                  (h) => (
                    <th key={h} className={pickerThCls}>
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-disabled">
                    请先粘贴数据或选择文件后解析
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.行号} className="border-b border-black/6">
                    <td className="f-mono px-3 py-1.5">{r.行号}</td>
                    <td
                      className={cn("f-mono px-3 py-1.5", r.错误 && "text-[#dc2626]")}
                    >
                      {r.物料编号}
                    </td>
                    <td className="f-mono px-3 py-1.5">{r.使用数量 ?? ""}</td>
                    <td className="px-3 py-1.5">
                      {r.material?.物料名称 ?? r.物料名称 ?? ""}
                    </td>
                    <td className="px-3 py-1.5">{r.material?.规格 ?? r.规格 ?? ""}</td>
                    <td className="px-3 py-1.5">{r.material?.颜色 ?? r.颜色 ?? ""}</td>
                    <td className="px-3 py-1.5">{r.material?.单位 ?? r.单位 ?? ""}</td>
                    <td className="px-3 py-1.5">
                      {r.错误 ? (
                        <span className="text-[#dc2626]">{r.错误}</span>
                      ) : (
                        <span className="rounded-full bg-[#059669]/10 px-2 py-0.5 text-xs font-medium text-[#059669]">
                          有效
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex gap-5 text-[15px] text-[#3d4a5c]">
          {(
            [
              ["append", "追加到现有明细"],
              ["replace", "替换全部明细"],
            ] as const
          ).map(([v, label]) => (
            <label key={v} className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="bom-import-mode"
                checked={mode === v}
                onChange={() => setMode(v)}
                className="h-4 w-4 accent-[#16a34a]"
              />
              {label}
            </label>
          ))}
        </div>
      </div>
      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </PickerDialog>
  );
}
