// 来料领料单分次出库弹窗(对照老系统 web/src/pages/materials/MaterialIssueOutboundDrawer.tsx):
// 申请数量=装配部填报,已出数量=累计出库;本次出库默认=未领,可改小或填 0 跳过;
// 只提交 本次出库>0 的行,提交后立即扣库存;全部出完时单据自动「已审核(完成)」。
// 与工具条「审核(出库)」(整单出库)并存,共用后端 已出数量 口径(老 MaterialDocPage 领料单口径)。
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Export } from "@phosphor-icons/react";
import { materialIssueApi } from "@/api/endpoints";
import type { MaterialDocLine, MaterialIssueOutboundResult } from "@/api/types";
import { txt } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { DocError } from "@/components/doc/DocError";
import { PickerDialog, pickerThCls } from "@/components/doc/PickerDialog";

const 未领 = (l: MaterialDocLine) => Math.max(0, (l.数量 ?? 0) - (l.已出数量 ?? 0));
const num = (v?: number | null) => v ?? 0;

export function MaterialIssueOutboundDialog({
  单号,
  open,
  onClose,
  onToast,
  onDone,
}: {
  单号: string | null;
  open: boolean;
  onClose: () => void;
  // 提示统一走页面 DocToast(对照老系统 message.success/info/error)
  onToast: (text: string, tone: "ok" | "err") => void;
  // 出库成功后交父级:重取明细 + 失效列表/跨页缓存
  onDone: (r: MaterialIssueOutboundResult) => void;
}) {
  const [saving, setSaving] = useState(false);
  // 本次出库草稿:按 单号 归属,未改的行回落默认=未领(渲染期派生,不用 effect 置初值)
  const [draft, setDraft] = useState<{ no: string; map: Record<number, string> } | null>(null);

  // 打开时重取整单(拿到最新 已出数量),queryKey 独立避免与查看态 detail 互踩
  const detailQuery = useQuery({
    queryKey: ["material-issue", "outbound", 单号],
    queryFn: () => materialIssueApi.get(单号!),
    enabled: open && !!单号,
  });
  const lines = detailQuery.data?.明细 ?? [];

  const qtyOf = (l: MaterialDocLine) => {
    const id = l.ID ?? 0;
    const v = draft && draft.no === 单号 ? draft.map[id] : undefined;
    return v ?? String(未领(l));
  };
  // 输入即钳制到 [0, 未领](对照老系统 InputNumber min=0 max=未领)
  const setQty = (l: MaterialDocLine, raw: string) => {
    const id = l.ID ?? 0;
    const n = Number(raw);
    const clamped = raw === "" || Number.isNaN(n) ? 0 : Math.min(Math.max(0, n), 未领(l));
    setDraft({
      no: 单号!,
      map: { ...(draft?.no === 单号 ? draft.map : {}), [id]: String(clamped) },
    });
  };

  const submit = async () => {
    if (!单号) return;
    const payload = lines
      .map((l) => ({ 行ID: l.ID ?? 0, 数量: Number(qtyOf(l)) || 0 }))
      .filter((x) => x.数量 > 0);
    if (payload.length === 0) {
      onToast("没有需要出库的行(本次出库均为 0)", "err");
      return;
    }
    setSaving(true);
    try {
      const r = await materialIssueApi.outbound(单号, payload);
      onToast(
        r.完成
          ? `出库完成:${r.出库行数} 行已全部出完,单据已自动审核`
          : `部分出库:${r.出库行数} 行已出库,剩余可再次出库`,
        "ok",
      );
      setDraft(null);
      onClose();
      onDone(r);
    } catch (e) {
      onToast(e instanceof Error ? e.message : "出库失败", "err");
    } finally {
      setSaving(false);
    }
  };

  return (
    <PickerDialog
      open={open}
      onClose={onClose}
      title={`领料出库 ${单号 ?? ""}`}
      width="sm:max-w-[900px]"
      footer={
        <>
          <span className="text-sm text-[#5f6b7d]">提交后立即扣库存;全部出完时单据自动审核</span>
          <button
            type="button"
            className="f-btn f-btn-cyan h-10 px-5 text-sm"
            disabled={saving || !detailQuery.data}
            onClick={() => void submit()}
          >
            <Export className="h-4 w-4" />
            确认出库
          </button>
        </>
      }
    >
      <p className="mb-3 text-sm text-[#5f6b7d]">
        申请数量=装配部填报，已出数量=累计出库；本次出库默认未领数量，可改小或填 0 跳过；提交后立即扣库存。
      </p>
      {detailQuery.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-11 w-full bg-black/5" />
          ))}
        </div>
      ) : detailQuery.isError ? (
        <DocError message="领料单加载失败,请重试" onRetry={() => detailQuery.refetch()} />
      ) : (
        <table className="w-full min-w-[760px] text-[15px]">
          <thead>
            <tr>
              {["物料编号", "物料名称", "颜色", "单位", "申请数量", "已出数量", "未领", "本次出库"].map(
                (h) => (
                  <th
                    key={h}
                    className={cn(
                      pickerThCls,
                      (h === "申请数量" || h === "已出数量" || h === "未领" || h === "本次出库") &&
                        "text-right",
                    )}
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const owed = 未领(l);
              return (
                <tr key={l.ID ?? i} className="h-11 border-b border-black/6 last:border-0">
                  <td className="f-mono px-3 py-2 whitespace-nowrap text-[#1a2330]">{txt(l.物料编号)}</td>
                  <td className="px-3 py-2 text-[#3d4a5c]">{txt(l.物料名称)}</td>
                  <td className="px-3 py-2 text-[#3d4a5c]">{txt(l.颜色)}</td>
                  <td className="px-3 py-2 text-[#3d4a5c]">{txt(l.单位)}</td>
                  <td className="f-mono px-3 py-2 text-right text-[#1a2330]">{num(l.数量)}</td>
                  <td className="f-mono px-3 py-2 text-right text-[#3d4a5c]">{num(l.已出数量)}</td>
                  <td className="f-mono px-3 py-2 text-right text-[#3d4a5c]">{owed}</td>
                  <td className="px-3 py-2 text-right">
                    <Input
                      type="number"
                      min={0}
                      max={owed}
                      step="0.01"
                      aria-label="本次出库"
                      disabled={owed <= 0}
                      className="f-mono ml-auto h-9 w-24 border-black/10 bg-black/[0.04] text-right text-[15px] text-[#1a2330]"
                      value={qtyOf(l)}
                      onChange={(e) => setQty(l, e.target.value)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </PickerDialog>
  );
}
