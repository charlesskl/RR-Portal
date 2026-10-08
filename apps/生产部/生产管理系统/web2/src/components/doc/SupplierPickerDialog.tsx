// 供应商选择弹窗(Batch 4 塑胶仓群共用:塑胶采购订单/退仓单/报废单;
// 对照老系统 web/src/pages/plastics/SupplierPicker.tsx:搜供应商资料,点行返回 编号+名称)。
import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { suppliersApi } from "@/api/endpoints";
import type { SupplierRow } from "@/api/types";
import { PickerDialog, pickerThCls } from "./PickerDialog";
import { Input } from "@/components/ui/input";

const inputCls =
  "h-10 border-black/10 bg-black/[0.04] text-[15px] text-[#1a2330] placeholder:text-disabled";

export function SupplierPickerDialog({
  open,
  onPick,
  onClose,
}: {
  open: boolean;
  onPick: (row: SupplierRow) => void;
  onClose: () => void;
}) {
  const [kwInput, setKwInput] = useState("");
  const [keyword, setKeyword] = useState("");

  const suppliersQuery = useQuery({
    queryKey: ["supplier-picker", keyword],
    queryFn: () => suppliersApi.list(1, 500, keyword || undefined),
    placeholderData: keepPreviousData,
    enabled: open,
  });
  const rows = suppliersQuery.data?.items ?? [];

  return (
    <PickerDialog open={open} onClose={onClose} title="选择供应商" width="sm:max-w-[640px]">
      <form
        className="mb-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setKeyword(kwInput.trim());
        }}
      >
        <Input
          className={inputCls}
          placeholder="编号/名称"
          aria-label="供应商搜索"
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
            <th className={pickerThCls}>供应商编号</th>
            <th className={pickerThCls}>供应商名称</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={r.供应商编号 ?? i}
              className="h-11 cursor-pointer border-b border-black/6 transition-colors last:border-0 hover:bg-black/[0.04]"
              onClick={() => {
                onPick(r);
                onClose();
              }}
            >
              <td className="f-mono px-3 py-2 whitespace-nowrap text-[#1a2330]">{r.供应商编号}</td>
              <td className="px-3 py-2 text-[#3d4a5c]">{r.供应商名称}</td>
            </tr>
          ))}
          {suppliersQuery.isSuccess && rows.length === 0 && (
            <tr>
              <td colSpan={2} className="px-3 py-4 text-center text-sm text-disabled">
                没有匹配的供应商
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </PickerDialog>
  );
}
