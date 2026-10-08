// 半成品产品选择弹窗(标签单/入仓/出库/报废/盘点共用;
// 对照老系统 web/src/pages/semi/SemiFinishedLabelProductPicker.tsx):
// 字段+关键字模糊/精确查询(服务端分页 50/页);checkbox 多选跨页保留 + 全选/反选(本页);
// 双击行=单选该行直接带回;加工单价/库存单价按 permMenu 的「单价」位遮蔽 ***。
import { useCallback, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Check, MagnifyingGlass } from "@phosphor-icons/react";
import type { SemiProductRow } from "@/api/types";
import { usePerms } from "@/hooks/usePerms";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { PickerDialog, pickerThCls } from "./PickerDialog";
import { SearchSelect } from "./SearchSelect";

const FIELDS = ["产品货号", "产品名称", "配件编号", "客户", "产品装配名称"];
const PAGE_SIZE = 50;

const productKey = (row: SemiProductRow): string =>
  String(row.ID ?? `${row.配件编号}-${row.产品货号}`);

const inputCls =
  "h-10 border-black/10 bg-black/[0.04] text-[15px] text-[#1a2330] placeholder:text-disabled";

export function SemiProductPickerDialog({
  open,
  onPick,
  onClose,
  loadProducts,
  permMenu,
  title = "选择半成品标签产品",
  goodsTitle = "产品货号",
  nameTitle = "产品名称",
}: {
  open: boolean;
  onPick: (rows: SemiProductRow[]) => void;
  onClose: () => void;
  loadProducts: (q: SemiProductQueryArgs) => Promise<{ items: SemiProductRow[]; total: number }>;
  permMenu: string; // 单价权限位所属菜单(调用方单据菜单)
  title?: string;
  goodsTitle?: string;
  nameTitle?: string;
}) {
  const { can } = usePerms();
  const canSeePrice = can(permMenu, "单价");
  const [field, setField] = useState("产品货号");
  const [kwInput, setKwInput] = useState("");
  const [applied, setApplied] = useState<{ field: string; keyword: string; exact: boolean }>({
    field: "产品货号",
    keyword: "",
    exact: false,
  });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Map<string, SemiProductRow>>(new Map());

  const query = useQuery({
    queryKey: ["semi-product-picker", applied, page],
    queryFn: () => loadProducts({ ...applied, page, size: PAGE_SIZE }),
    placeholderData: keepPreviousData,
    enabled: open,
  });
  const rows = query.data?.items ?? [];
  const totalPages = query.data ? Math.max(1, Math.ceil(query.data.total / PAGE_SIZE)) : 1;

  // 关闭时重置选择(对照老系统 closePicker);渲染期比对前次 open(避免 effect 内 setState)
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) {
      setSelected(new Map());
      setPage(1);
    }
  }

  const search = useCallback(
    (exact: boolean) => {
      setApplied({ field, keyword: kwInput.trim(), exact });
      setPage(1);
    },
    [field, kwInput],
  );

  const toggleOne = (row: SemiProductRow) => {
    const key = productKey(row);
    setSelected((cur) => {
      const next = new Map(cur);
      if (next.has(key)) next.delete(key);
      else next.set(key, row);
      return next;
    });
  };
  const pageKeys = rows.map(productKey);
  const allChecked = pageKeys.length > 0 && pageKeys.every((k) => selected.has(k));
  const toggleAll = () =>
    setSelected((cur) => {
      const next = new Map(cur);
      if (allChecked) pageKeys.forEach((k) => next.delete(k));
      else rows.forEach((r) => next.set(productKey(r), r));
      return next;
    });
  const invert = () =>
    setSelected((cur) => {
      const next = new Map(cur);
      for (const r of rows) {
        const k = productKey(r);
        if (next.has(k)) next.delete(k);
        else next.set(k, r);
      }
      return next;
    });

  const confirm = (rowsToPick: SemiProductRow[]) => {
    if (rowsToPick.length === 0) return;
    onPick(rowsToPick);
    onClose();
  };

  const priceCell = (v?: number | null) =>
    canSeePrice ? (v ?? "") : "***";

  return (
    <PickerDialog
      open={open}
      onClose={onClose}
      title={title}
      width="sm:max-w-[1080px]"
      footer={
        <>
          <span className="mr-auto text-sm text-[#5f6b7d]">
            已选 <span className="f-mono font-semibold text-[#15803d]">{selected.size}</span> 项
          </span>
          <button
            type="button"
            className="f-btn f-btn-cyan px-5"
            disabled={selected.size === 0}
            onClick={() => confirm([...selected.values()])}
          >
            <Check className="h-4.5 w-4.5" />
            选择
          </button>
          <button type="button" className="f-btn px-5" onClick={onClose}>
            关闭
          </button>
        </>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchSelect
          ariaLabel="查询字段"
          className={cn(inputCls, "w-36 rounded-md border px-2")}
          value={field}
          options={FIELDS.map((f) => ({ value: f, label: f }))}
          onChange={(v) => setField(v)}
        />
        <Input
          className={cn(inputCls, "w-64")}
          aria-label="产品搜索"
          placeholder="输入查询内容"
          value={kwInput}
          onChange={(e) => setKwInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search(false)}
        />
        <button type="button" className="f-btn f-btn-cyan h-10 px-4 text-sm" onClick={() => search(false)}>
          <MagnifyingGlass className="h-4.5 w-4.5" />
          查询
        </button>
        <button type="button" className="f-btn h-10 px-4 text-sm" onClick={() => search(true)}>
          精确查询
        </button>
        <button type="button" className="f-btn h-10 px-4 text-sm" disabled={rows.length === 0} onClick={toggleAll}>
          全选
        </button>
        <button type="button" className="f-btn h-10 px-4 text-sm" disabled={rows.length === 0} onClick={invert}>
          反选
        </button>
      </div>
      <table className="w-full text-[15px]">
        <thead>
          <tr>
            <th className={cn(pickerThCls, "w-10 text-center")}>
              <Checkbox
                aria-label="全选本页"
                checked={allChecked}
                onCheckedChange={toggleAll}
              />
            </th>
            {["配件编号", "产品装配名称", "客户", goodsTitle, nameTitle, "加工单价", "库存单价"].map((h) => (
              <th key={h} className={cn(pickerThCls, (h === "加工单价" || h === "库存单价") && "text-right")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const key = productKey(r);
            return (
              <tr
                key={key}
                className="h-11 cursor-pointer border-b border-black/6 transition-colors last:border-0 hover:bg-black/[0.04]"
                onClick={() => toggleOne(r)}
                onDoubleClick={() => confirm([r])}
              >
                <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    aria-label={`选择 ${r.配件编号}`}
                    checked={selected.has(key)}
                    onCheckedChange={() => toggleOne(r)}
                  />
                </td>
                <td className="f-mono px-3 py-2 whitespace-nowrap font-semibold text-[#15803d]">{r.配件编号}</td>
                <td className="px-3 py-2 text-[#3d4a5c]">{r.产品装配名称 ?? ""}</td>
                <td className="px-3 py-2 text-[#3d4a5c]">{r.客户 ?? ""}</td>
                <td className="f-mono px-3 py-2 whitespace-nowrap text-[#1a2330]">{r.产品货号}</td>
                <td className="px-3 py-2 text-[#3d4a5c]">{r.产品名称 ?? ""}</td>
                <td className="f-mono px-3 py-2 text-right text-[#3d4a5c]">{priceCell(r.加工单价)}</td>
                <td className="f-mono px-3 py-2 text-right text-[#3d4a5c]">{priceCell(r.库存单价)}</td>
              </tr>
            );
          })}
          {query.isSuccess && rows.length === 0 && (
            <tr>
              <td colSpan={8} className="px-3 py-4 text-center text-sm text-disabled">
                没有匹配的产品
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="f-mono mt-3 flex items-center justify-between text-sm text-[#5f6b7d]">
        <span>
          共 {query.data?.total ?? 0} 条,第 {page} / {totalPages} 页
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            className="f-btn h-9 px-3.5 text-sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            上一页
          </button>
          <button
            type="button"
            className="f-btn h-9 px-3.5 text-sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </button>
        </div>
      </div>
    </PickerDialog>
  );
}

export interface SemiProductQueryArgs {
  field?: string;
  keyword?: string;
  exact?: boolean;
  page?: number;
  size?: number;
}
