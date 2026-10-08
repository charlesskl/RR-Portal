// 原料采购分析表「生成采购单」弹窗:
// 候选行 = 有需求驱动(安全库存+生产需求>0)的行;可购数量>0 默认勾选,可购<=0 默认不勾并标注原因
// (在途 N 未到已抵扣 / 库存够用),可手动强制勾选;提交时若有自动跳过行,先出确认页列明跳过原因再生成。
import { useMemo, useState } from "react";
import { rawPurchaseOrderApi } from "@/api/endpoints";
import type { RawPurchaseAnalysisRow, SupplierRow } from "@/api/types";
import { SupplierPickerDialog } from "@/components/doc/SupplierPickerDialog";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

const inputCls =
  "h-10 border-black/10 bg-black/[0.04] text-[15px] text-[#1a2330] placeholder:text-disabled";
const thCls = "px-3 py-2 text-left text-sm font-semibold text-[#5f6b7d] whitespace-nowrap";

interface Candidate {
  row: RawPurchaseAnalysisRow;
  可购: number;
  autoSkip: boolean;
  skipReason: string;
}

function fmt(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

export default function RawPurchaseGenerateDialog({
  open,
  rows,
  onClose,
  onDone,
}: {
  open: boolean;
  rows: RawPurchaseAnalysisRow[];
  onClose: () => void;
  onDone: (单号: string) => void;
}) {
  // 候选:有需求驱动(安全库存+生产需求>0)的行;纯库存过剩行不进弹窗
  const candidates = useMemo<Candidate[]>(
    () =>
      rows
        .filter((r) => Number(r.安全库存 ?? 0) + Number(r.生产需求 ?? 0) > 0)
        .map((r) => {
          const 可购 = Number(r.可购数量 ?? 0);
          const 在途 = Number(r.在途数量 ?? 0);
          const autoSkip = 可购 <= 0;
          return {
            row: r,
            可购,
            autoSkip,
            skipReason: autoSkip
              ? 在途 > 0
                ? `在途 ${fmt(在途)} 未到,已抵扣`
                : "库存够用,无需采购"
              : "",
          };
        }),
    [rows],
  );

  const [checked, setChecked] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(candidates.map((x) => [x.row.原料编号 ?? "", !x.autoSkip])),
  );
  const [qty, setQty] = useState<Record<string, string>>(() =>
    Object.fromEntries(candidates.map((x) => [x.row.原料编号 ?? "", fmt(Math.max(x.可购, 0))])),
  );
  const [supplier, setSupplier] = useState<SupplierRow | null>(null);
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [交货日期, set交货日期] = useState("");
  const [备注, set备注] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const key = (r: RawPurchaseAnalysisRow) => r.原料编号 ?? "";
  const picked = candidates.filter((x) => checked[key(x.row)]);
  const skipped = candidates.filter((x) => x.autoSkip && !checked[key(x.row)]);

  const submit = async () => {
    if (!supplier) {
      setError("请先选择供应商");
      return;
    }
    if (picked.length === 0) {
      setError("没有勾选任何行");
      return;
    }
    const lines = picked.map((x) => ({
      原料编号: x.row.原料编号,
      原料名称: x.row.原料名称,
      规格: x.row.规格,
      单位: x.row.单位,
      订货数量: Number(qty[key(x.row)] || 0),
    }));
    const bad = lines.find((l) => !(l.订货数量 > 0));
    if (bad) {
      setError(`「${bad.原料编号}」订货数量必须大于 0`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await rawPurchaseOrderApi.create({
        供应商编号: supplier.供应商编号,
        供应商名称: supplier.供应商名称,
        交货日期: 交货日期 || undefined,
        备注: 备注.trim() || undefined,
        明细: lines,
      });
      onDone(res.单号);
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成采购单失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[1100px]">
        <DialogHeader>
          <DialogTitle>{confirming ? "确认生成采购单" : "从采购分析生成采购单"}</DialogTitle>
        </DialogHeader>

        {!confirming ? (
          <>
            <div className="mb-3 flex flex-wrap items-end gap-3">
              <div className="w-64 space-y-1.5">
                <label className="f-label block">供应商</label>
                <div className="flex gap-2">
                  <Input
                    className={inputCls}
                    readOnly
                    placeholder="点「选择」挑供应商"
                    value={supplier?.供应商名称 ?? ""}
                  />
                  <button
                    type="button"
                    className="f-btn h-10 shrink-0 px-4 text-sm"
                    onClick={() => setSupplierOpen(true)}
                  >
                    选择
                  </button>
                </div>
              </div>
              <div className="w-44 space-y-1.5">
                <label htmlFor="rpg-date" className="f-label block">
                  交货日期
                </label>
                <Input
                  id="rpg-date"
                  type="date"
                  className={inputCls}
                  value={交货日期}
                  onChange={(e) => set交货日期(e.target.value)}
                />
              </div>
              <div className="min-w-56 flex-1 space-y-1.5">
                <label htmlFor="rpg-note" className="f-label block">
                  备注
                </label>
                <Input
                  id="rpg-note"
                  className={inputCls}
                  placeholder="选填"
                  value={备注}
                  onChange={(e) => set备注(e.target.value)}
                />
              </div>
            </div>

            <div className="max-h-[46vh] overflow-auto rounded-lg border border-black/8">
              <table className="w-full text-[15px]">
                <thead className="sticky top-0 bg-[#f6f7f9]">
                  <tr>
                    <th className={thCls}></th>
                    <th className={thCls}>原料编号</th>
                    <th className={thCls}>原料名称</th>
                    <th className={cn(thCls, "text-right")}>当前库存</th>
                    <th className={cn(thCls, "text-right")}>生产需求</th>
                    <th className={cn(thCls, "text-right")}>在途未到</th>
                    <th className={cn(thCls, "text-right")}>可购数量</th>
                    <th className={cn(thCls, "text-right")}>订货数量</th>
                    <th className={thCls}>说明</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((x) => {
                    const k = key(x.row);
                    const on = !!checked[k];
                    return (
                      <tr
                        key={k}
                        className={cn(
                          "border-b border-black/6 last:border-0",
                          x.autoSkip && !on && "opacity-60",
                        )}
                      >
                        <td className="px-3 py-2">
                          <Checkbox
                            aria-label={`勾选 ${k}`}
                            className="h-5 w-5 border-black/20 data-[state=checked]:border-[#16a34a] data-[state=checked]:bg-[#16a34a] data-[state=checked]:text-[#ffffff]"
                            checked={on}
                            onCheckedChange={(v) => setChecked({ ...checked, [k]: v === true })}
                          />
                        </td>
                        <td className="f-mono px-3 py-2 whitespace-nowrap font-semibold text-[#15803d]">
                          {x.row.原料编号}
                        </td>
                        <td className="px-3 py-2 text-[#3d4a5c]">{x.row.原料名称}</td>
                        <td className="f-mono px-3 py-2 text-right">{x.row.当前库存 ?? 0}</td>
                        <td className="f-mono px-3 py-2 text-right">{x.row.生产需求 ?? 0}</td>
                        <td className="f-mono px-3 py-2 text-right">{x.row.在途数量 ?? 0}</td>
                        <td
                          className={cn(
                            "f-mono px-3 py-2 text-right",
                            x.可购 > 0 ? "font-semibold text-[#dc2626]" : "text-[#1a2330]",
                          )}
                        >
                          {fmt(x.可购)}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <Input
                            aria-label={`${k} 订货数量`}
                            className="f-mono h-9 w-28 border-black/10 bg-black/[0.04] text-right text-[15px]"
                            disabled={!on}
                            value={qty[k] ?? ""}
                            onChange={(e) => setQty({ ...qty, [k]: e.target.value })}
                          />
                        </td>
                        <td className="px-3 py-2 text-sm whitespace-nowrap">
                          {x.autoSkip && (
                            <span className="inline-flex rounded-full border border-amber-500/50 bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                              {x.skipReason}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {candidates.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-3 py-6 text-center text-sm text-disabled">
                        当前筛选结果没有需要采购的原料
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="space-y-3">
            <p className="text-[15px] text-[#1a2330]">
              将向「{supplier?.供应商名称}」生成 {picked.length} 行采购明细。
            </p>
            {skipped.length > 0 && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
                <p className="mb-2 text-sm font-semibold text-amber-800">
                  以下 {skipped.length} 行本次不会采购:
                </p>
                <ul className="space-y-1 text-sm text-amber-800">
                  {skipped.map((x) => (
                    <li key={key(x.row)}>
                      <span className="f-mono font-semibold">{x.row.原料编号}</span>{" "}
                      {x.row.原料名称} —— {x.skipReason}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-amber-700">
                  若在途采购单无法到货,请返回手动勾选该行。
                </p>
              </div>
            )}
          </div>
        )}

        {error && <p className="mt-2 text-sm text-[#dc2626]">{error}</p>}

        <DialogFooter>
          {!confirming ? (
            <>
              <button type="button" className="f-btn px-5" onClick={onClose}>
                取消
              </button>
              <button
                type="button"
                className="f-btn f-btn-cyan px-5"
                disabled={busy || picked.length === 0}
                onClick={() => {
                  setError("");
                  if (skipped.length > 0) setConfirming(true);
                  else void submit();
                }}
              >
                生成采购单({picked.length} 行)
              </button>
            </>
          ) : (
            <>
              <button type="button" className="f-btn px-5" onClick={() => setConfirming(false)}>
                返回修改
              </button>
              <button
                type="button"
                className="f-btn f-btn-cyan px-5"
                disabled={busy}
                onClick={() => void submit()}
              >
                {busy ? "生成中…" : "确认生成"}
              </button>
            </>
          )}
        </DialogFooter>

        <SupplierPickerDialog
          open={supplierOpen}
          onPick={setSupplier}
          onClose={() => setSupplierOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
