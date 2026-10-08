// 塑胶原料选择弹窗(Batch 7 原料仓群共用:生产需求表/采购订单/入仓单/出库表/盘点单 明细行「选」;
// 对照老系统 web/src/pages/plastics/PlasticRawMaterialPicker.tsx:
// 搜塑胶原料资料(服务端分页 50/页),点行返回整行)。
import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { plasticRawMaterialMasterApi } from "@/api/endpoints";
import type { PlasticRawMaterialRow } from "@/api/types";
import { PickerDialog, pickerThCls } from "./PickerDialog";
import { Input } from "@/components/ui/input";

const inputCls =
  "h-10 border-black/10 bg-black/[0.04] text-[15px] text-[#1a2330] placeholder:text-disabled";

const PAGE_SIZE = 50;

export function RawMaterialPickerDialog({
  open,
  onPick,
  onClose,
}: {
  open: boolean;
  onPick: (row: PlasticRawMaterialRow) => void;
  onClose: () => void;
}) {
  const [kwInput, setKwInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);

  const materialsQuery = useQuery({
    queryKey: ["raw-material-picker", keyword, page],
    queryFn: () => plasticRawMaterialMasterApi.list(undefined, keyword || undefined, page, PAGE_SIZE),
    placeholderData: keepPreviousData,
    enabled: open,
  });
  const rows = materialsQuery.data?.items ?? [];
  const total = materialsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <PickerDialog
      open={open}
      onClose={onClose}
      title="选择塑胶原料"
      width="sm:max-w-[860px]"
      footer={
        <>
          <span className="mr-auto text-sm text-[#5f6b7d]">共 {total} 条</span>
          <button
            type="button"
            className="f-btn h-8 px-3 text-sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            上一页
          </button>
          <span className="f-mono text-sm text-[#5f6b7d]">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            className="f-btn h-8 px-3 text-sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </button>
        </>
      }
    >
      <form
        className="mb-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setKeyword(kwInput.trim());
        }}
      >
        <Input
          className={inputCls}
          placeholder="物料编号/名称/规格/商品名称"
          aria-label="原料搜索"
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
            {["物料编号", "物料名称", "规格", "商品名称", "产地", "每包重量", "单位"].map((h) => (
              <th key={h} className={pickerThCls}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {materialsQuery.isLoading ? (
            <tr>
              <td colSpan={7} className="px-3 py-8 text-center text-sm text-disabled">
                加载中...
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-3 py-8 text-center text-sm text-disabled">
                暂无原料
              </td>
            </tr>
          ) : (
            rows.map((m, i) => (
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
                <td className="px-3 py-2 text-[#3d4a5c]">{m.商品名称}</td>
                <td className="px-3 py-2 text-[#3d4a5c]">{m.产地}</td>
                <td className="f-mono px-3 py-2 text-right text-[#3d4a5c]">{m.每包重量 ?? ""}</td>
                <td className="px-3 py-2 text-[#3d4a5c]">{m.单位}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </PickerDialog>
  );
}
