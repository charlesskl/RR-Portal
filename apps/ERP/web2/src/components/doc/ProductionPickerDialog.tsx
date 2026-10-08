// 生产制单选择弹窗(Batch 4 塑胶仓群共用:塑胶采购订单明细/报废单明细/采购分析发外需求;
// 对照老系统 web/src/pages/materials/ProductionPicker.tsx:仅列已审核生产单,点行返回整行)。
import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { productionReportApi } from "@/api/endpoints";
import type { ProductionTrackingRow } from "@/api/types";
import { PickerDialog, pickerThCls } from "./PickerDialog";
import { Input } from "@/components/ui/input";

const inputCls =
  "h-10 border-black/10 bg-black/[0.04] text-[15px] text-[#1a2330] placeholder:text-disabled";

export function ProductionPickerDialog({
  open,
  onPick,
  onClose,
}: {
  open: boolean;
  onPick: (row: ProductionTrackingRow) => void;
  onClose: () => void;
}) {
  const [kwInput, setKwInput] = useState("");
  const [keyword, setKeyword] = useState("");

  const prodQuery = useQuery({
    queryKey: ["production-picker", keyword],
    queryFn: () => productionReportApi.tracking(keyword || undefined, "1"),
    placeholderData: keepPreviousData,
    enabled: open,
  });
  const rows = prodQuery.data ?? [];

  return (
    <PickerDialog
      open={open}
      onClose={onClose}
      title="选择生产制单(仅列已审核)"
      width="sm:max-w-[860px]"
    >
      <form
        className="mb-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setKeyword(kwInput.trim());
        }}
      >
        <Input
          className={inputCls}
          placeholder="生产单号/款号/款式/客户"
          aria-label="生产单搜索"
          value={kwInput}
          onChange={(e) => setKwInput(e.target.value)}
        />
        <button type="submit" className="f-btn h-10 shrink-0 px-4 text-sm">
          查询
        </button>
      </form>
      <table className="w-full text-[15px]">
        <thead>
          <tr>
            {["生产单号", "款号", "款式", "客户名称", "计划数量", "交货日期"].map((h) => (
              <th key={h} className={pickerThCls}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={r.生产单号 ?? i}
              className="h-11 cursor-pointer border-b border-black/6 transition-colors last:border-0 hover:bg-black/[0.04]"
              onClick={() => {
                onPick(r);
                onClose();
              }}
            >
              <td className="f-mono px-3 py-2 whitespace-nowrap font-semibold text-[#15803d]">
                {r.生产单号}
                {r.关联MA货号 && (
                  <span
                    title={`货号已关联MA单:${r.关联MA货号};塑胶不能对该实单下单`}
                    className="ml-1.5 rounded-full bg-[#d97706]/10 px-1.5 py-0.5 text-xs font-medium text-[#d97706]"
                  >
                    已关联MA
                  </span>
                )}
              </td>
              <td className="f-mono px-3 py-2 text-[#3d4a5c]">{r.款号}</td>
              <td className="px-3 py-2 text-[#3d4a5c]">{r.款式}</td>
              <td className="px-3 py-2 text-[#3d4a5c]">{r.客户名称}</td>
              <td className="f-mono px-3 py-2 text-right text-[#3d4a5c]">{r.计划数量 ?? ""}</td>
              <td className="f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]">
                {r.交货日期 ? String(r.交货日期).slice(0, 10) : ""}
              </td>
            </tr>
          ))}
          {prodQuery.isSuccess && rows.length === 0 && (
            <tr>
              <td colSpan={6} className="px-3 py-4 text-center text-sm text-disabled">
                没有匹配的已审核生产单
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </PickerDialog>
  );
}
