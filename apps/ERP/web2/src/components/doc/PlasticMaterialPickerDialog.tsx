// 塑胶物料选择弹窗(Batch 4 塑胶仓群共用:采购订单明细/共用物料表/报废单/退仓单;
// 对照老系统 web/src/pages/plastics/PlasticMaterialPicker.tsx:搜塑胶物料资料,点行返回整行)。
import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { plasticMaterialMasterApi } from "@/api/endpoints";
import type { PlasticMaterialRow } from "@/api/types";
import { PickerDialog, pickerThCls } from "./PickerDialog";
import { Input } from "@/components/ui/input";

const inputCls =
  "h-10 border-black/10 bg-black/[0.04] text-[15px] text-[#1a2330] placeholder:text-disabled";

export function PlasticMaterialPickerDialog({
  open,
  onPick,
  onClose,
}: {
  open: boolean;
  onPick: (row: PlasticMaterialRow) => void;
  onClose: () => void;
}) {
  const [kwInput, setKwInput] = useState("");
  const [keyword, setKeyword] = useState("");

  const materialsQuery = useQuery({
    queryKey: ["plastic-material-picker", keyword],
    queryFn: () => plasticMaterialMasterApi.list(undefined, keyword || undefined, 1, 50),
    placeholderData: keepPreviousData,
    enabled: open,
  });
  const rows = materialsQuery.data?.items ?? [];

  return (
    <PickerDialog open={open} onClose={onClose} title="选择塑胶物料" width="sm:max-w-[860px]">
      <form
        className="mb-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setKeyword(kwInput.trim());
        }}
      >
        <Input
          className={inputCls}
          placeholder="物料编号/名称/规格/颜色"
          aria-label="物料搜索"
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
            {["物料编号", "物料名称", "规格", "颜色", "仓位号", "单位"].map((h) => (
              <th key={h} className={pickerThCls}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((m, i) => (
            <tr
              key={m.ID ?? i}
              className="h-11 cursor-pointer border-b border-black/6 transition-colors last:border-0 hover:bg-black/[0.04]"
              onClick={() => {
                onPick(m);
                onClose();
              }}
            >
              <td className="f-mono px-3 py-2 whitespace-nowrap text-[#1a2330]">{m.物料编号}</td>
              <td className="px-3 py-2 text-[#3d4a5c]">{m.物料名称}</td>
              <td className="px-3 py-2 text-[#3d4a5c]">{m.规格}</td>
              <td className="px-3 py-2 text-[#3d4a5c]">{m.颜色}</td>
              <td className="px-3 py-2 text-[#3d4a5c]">{m.仓位号}</td>
              <td className="px-3 py-2 text-[#3d4a5c]">{m.单位}</td>
            </tr>
          ))}
          {materialsQuery.isSuccess && rows.length === 0 && (
            <tr>
              <td colSpan={6} className="px-3 py-4 text-center text-sm text-disabled">
                没有匹配的塑胶物料
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </PickerDialog>
  );
}
