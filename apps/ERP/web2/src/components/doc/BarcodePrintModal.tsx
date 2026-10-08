// 条码批量打印:搜物料 → 加入打印列表 → 设份数 → 预览 → 打印。
// 照抄老系统 web/src/components/scan/BarcodePrintModal.tsx;
// 打印用 CSS 只输出标签区(visibility 方案),自包含,可从任意页打开。
import { useCallback, useState } from "react";
import { Plus, Printer, Trash } from "@phosphor-icons/react";
import { materialMasterApi } from "@/api/endpoints";
import type { MasterMaterialRow } from "@/api/types";
import { PickerDialog } from "@/components/doc/PickerDialog";
import { DocToast } from "@/components/doc/DocToast";
import BarcodeLabel from "./BarcodeLabel";

interface PrintItem {
  物料编号: string;
  物料名称?: string;
  规格?: string;
  份数: number;
}

const errMsg = (e: unknown, fallback: string) =>
  e instanceof Error && e.message ? e.message : fallback;

export default function BarcodePrintModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [kw, setKw] = useState("");
  const [searchRows, setSearchRows] = useState<MasterMaterialRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [items, setItems] = useState<PrintItem[]>([]);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(null);

  const search = useCallback(async () => {
    const q = kw.trim();
    if (!q) {
      setToast({ text: "输入物料编号/名称再搜", tone: "err" });
      return;
    }
    setSearching(true);
    try {
      setSearchRows((await materialMasterApi.list(undefined, q, 1, 20)).items);
    } catch (e) {
      setToast({ text: errMsg(e, "搜索物料失败"), tone: "err" });
    } finally {
      setSearching(false);
    }
  }, [kw]);

  const add = (m: MasterMaterialRow) => {
    const code = (m.物料编号 ?? "").trim();
    if (!code) return;
    // 条码仅支持英文数字符号,含中文直接提示
    if (!/^[\x20-\x7E]+$/.test(code)) {
      setToast({ text: `编号 ${code} 含中文/特殊字符,无法生成条码`, tone: "err" });
      return;
    }
    setItems((prev) => {
      const i = prev.findIndex((x) => x.物料编号 === code);
      if (i >= 0) return prev.map((x, j) => (j === i ? { ...x, 份数: x.份数 + 1 } : x));
      return [...prev, { 物料编号: code, 物料名称: m.物料名称, 规格: m.规格, 份数: 1 }];
    });
  };

  const setQty = (code: string, n: number) =>
    setItems((prev) =>
      prev.map((x) => (x.物料编号 === code ? { ...x, 份数: Math.max(1, n) } : x)),
    );
  const remove = (code: string) => setItems((prev) => prev.filter((x) => x.物料编号 !== code));

  // 展开份数:每个标签按份数重复
  const labels = items.flatMap((x) => Array.from({ length: x.份数 }, () => x));

  return (
    <PickerDialog open={open} onClose={onClose} title="条码标签打印" width="sm:max-w-[900px]">
      {/* 打印样式:只输出标签区 */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #barcode-print-area, #barcode-print-area * { visibility: visible !important; }
          #barcode-print-area { position: absolute; left: 0; top: 0; width: 100%; }
        }
      `}</style>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          aria-label="搜索物料"
          className="f-input f-input-slim w-64"
          placeholder="搜物料编号/名称/规格"
          value={kw}
          onChange={(e) => setKw(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void search()}
        />
        <button
          type="button"
          className="f-btn h-9 px-4 text-sm"
          disabled={searching}
          onClick={() => void search()}
        >
          搜索
        </button>
        <span className="text-xs text-disabled">点搜索结果加入打印列表</span>
      </div>

      {searchRows.length > 0 && (
        <div className="mb-3 max-h-44 overflow-auto rounded-lg border border-black/8">
          <table className="w-full text-sm">
            <tbody>
              {searchRows.map((m, i) => (
                <tr key={m.ID ?? i} className="border-b border-black/6">
                  <td className="f-mono px-3 py-1.5 font-semibold">{m.物料编号}</td>
                  <td className="px-3 py-1.5">{m.物料名称 ?? ""}</td>
                  <td className="px-3 py-1.5">{m.规格 ?? ""}</td>
                  <td className="px-3 py-1.5 text-right">
                    <button
                      type="button"
                      aria-label={`加入 ${m.物料编号}`}
                      className="rounded-md p-1.5 text-[#15803d] hover:bg-black/6"
                      onClick={() => add(m)}
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex gap-4">
        <div className="w-72 shrink-0">
          <div className="mb-2 flex items-center font-semibold text-[#1a2330]">
            打印列表({items.length} 种 / 共 {labels.length} 张)
            {items.length > 0 && (
              <button
                type="button"
                className="ml-2 text-sm font-normal text-[#5f6b7d] hover:underline"
                onClick={() => setItems([])}
              >
                清空
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <div className="py-6 text-sm text-disabled">尚未添加物料</div>
          ) : (
            <ul className="space-y-1">
              {items.map((x) => (
                <li key={x.物料编号} className="flex items-center gap-2 border-b border-black/6 py-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="f-mono font-semibold">{x.物料编号}</div>
                    <div className="truncate text-xs text-disabled">{x.物料名称}</div>
                  </div>
                  <input
                    type="number"
                    min={1}
                    max={999}
                    aria-label={`份数 ${x.物料编号}`}
                    className="f-input f-input-slim w-16"
                    value={x.份数}
                    onChange={(e) => setQty(x.物料编号, Number(e.target.value || 1))}
                  />
                  <button
                    type="button"
                    aria-label={`移除 ${x.物料编号}`}
                    className="rounded-md p-1.5 text-[#dc2626] hover:bg-black/6"
                    onClick={() => remove(x.物料编号)}
                  >
                    <Trash className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center gap-3">
            <button
              type="button"
              className="f-btn f-btn-cyan h-9 px-4 text-sm"
              disabled={labels.length === 0}
              onClick={() => window.print()}
            >
              <Printer className="h-4 w-4" />
              打印({labels.length} 张)
            </button>
            <span className="text-xs text-disabled">预览如下,打印只输出标签</span>
          </div>
          <div
            id="barcode-print-area"
            className="flex max-h-[380px] flex-wrap gap-2 overflow-y-auto rounded-lg bg-black/[0.04] p-2"
          >
            {labels.map((x, i) => (
              <BarcodeLabel
                key={`${x.物料编号}-${i}`}
                value={x.物料编号}
                title={x.物料名称}
                subtitle={x.规格}
              />
            ))}
            {labels.length === 0 && <div className="p-6 text-disabled">暂无标签</div>}
          </div>
        </div>
      </div>
      {toast && <DocToast text={toast.text} tone={toast.tone} />}
    </PickerDialog>
  );
}
