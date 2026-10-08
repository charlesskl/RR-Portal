// 加工厂选择弹窗(塑胶加工采购订单 选加工厂用;对照老系统 web/src/pages/plastics/FactoryPicker.tsx:
// 加工厂资料关键字查询,点行返回整行,带 加工厂类别 供明细按厂类别过滤)。
import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { factoriesApi } from "@/api/endpoints";
import type { FactoryRow } from "@/api/types";
import { PickerDialog, pickerThCls } from "./PickerDialog";
import { Input } from "@/components/ui/input";

const inputCls =
  "h-10 border-black/10 bg-black/[0.04] text-[15px] text-[#1a2330] placeholder:text-disabled";

export function FactoryPickerDialog({
  open,
  onPick,
  onClose,
}: {
  open: boolean;
  onPick: (row: FactoryRow) => void;
  onClose: () => void;
}) {
  const [kwInput, setKwInput] = useState("");
  const [keyword, setKeyword] = useState("");

  const query = useQuery({
    queryKey: ["factory-picker", keyword],
    queryFn: () => factoriesApi.list(1, 300, keyword || ""),
    placeholderData: keepPreviousData,
    enabled: open,
  });
  const rows = query.data?.items ?? [];

  return (
    <PickerDialog open={open} onClose={onClose} title="选择加工厂" width="sm:max-w-[720px]">
      <form
        className="mb-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setKeyword(kwInput.trim());
        }}
      >
        <Input
          className={inputCls}
          placeholder="加工厂编号/名称"
          aria-label="加工厂搜索"
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
            {["加工厂编号", "加工厂名称", "加工厂类别"].map((h) => (
              <th key={h} className={pickerThCls}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((f, i) => (
            <tr
              key={f.加工厂编号 ?? i}
              className="h-11 cursor-pointer border-b border-black/6 transition-colors last:border-0 hover:bg-black/[0.04]"
              onClick={() => {
                onPick(f);
                onClose();
              }}
            >
              <td className="f-mono px-3 py-2 whitespace-nowrap text-[#1a2330]">{f.加工厂编号}</td>
              <td className="px-3 py-2 text-[#3d4a5c]">{f.加工厂名称}</td>
              <td className="px-3 py-2 text-[#3d4a5c]">{f.加工厂类别 ?? ""}</td>
            </tr>
          ))}
          {query.isSuccess && rows.length === 0 && (
            <tr>
              <td colSpan={3} className="px-3 py-4 text-center text-sm text-disabled">
                没有匹配的加工厂
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </PickerDialog>
  );
}
