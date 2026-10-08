// 物料资料选择弹窗:服务端关键字分页查询 物料资料,点行返回该物料。
// 半成品设置「加一行」等场景的选料入口(样式对照 MaterialLabelOrderPage 的 MaterialPickDialog)。
// 传入 货号 时:物料资料+塑胶物料资料双源拉全量(塑胶货号=款号,塑胶件如 5700 开头件在此),
// 按「货号-」前缀规则(含 92119/92125 共用料)过滤,关键字/分页走客户端;同编号以物料资料为准。
// 含塑胶半成品=true(不传 货号)时:顶部「物料资料/塑胶半成品」源切换,两源各自服务端关键字分页;
// 切源清空已选。multi=true 时为多选模式(实单 BOM「选物料」/委托加工单选料):行/表头勾选,底部 已选 N + 确定。
import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { masterDataApi, plasticMaterialMasterApi } from "@/api/endpoints";
import type { MasterRow, PlasticMaterialRow } from "@/api/types";
import { PickerDialog, pickerThCls } from "@/components/doc/PickerDialog";
import { Checkbox } from "@/components/ui/checkbox";
import { matchPrefix, 货号前缀 } from "@/lib/materialMatch";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

// 塑胶物料资料行 -> 通用物料行(半成品/塑胶件与包材同构入网格)
const plasticToMaster = (p: PlasticMaterialRow): MasterRow => ({
  ID: p.ID ?? p.id,
  塑胶货号: p.款号 ?? "",
  物料编号: p.物料编号 ?? "",
  物料名称: p.物料名称 ?? "",
  物料类别: p.物料类别 ?? "塑胶",
  规格: p.规格 ?? "",
  颜色: p.颜色 ?? "",
  单位: p.单位 ?? "个",
});

export function MaterialMasterPickDialog({
  open,
  onPick,
  onPickMany,
  onClose,
  货号,
  multi = false,
  含塑胶半成品 = false,
}: {
  open: boolean;
  onPick?: (row: MasterRow) => void;
  // 多选模式确定回调(按过滤后列表顺序返回勾选项)
  onPickMany?: (rows: MasterRow[]) => void;
  onClose: () => void;
  货号?: string;
  multi?: boolean;
  // 双源切换(委托加工单选料:包材物料 + 塑胶半成品);仅不传 货号 时生效
  含塑胶半成品?: boolean;
}) {
  const [kwInput, setKwInput] = useState("");
  const [kw, setKw] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]); // 多选:物料编号
  const [src, setSrc] = useState<"material" | "plastic">("material");
  const filter货号 = 货号?.trim() || "";
  const dualSource = 含塑胶半成品 && !filter货号;
  const query = useQuery({
    queryKey: filter货号
      ? ["master-material-pick", "by货号", filter货号]
      : ["master-material-pick", dualSource ? src : "material", page, kw],
    queryFn: async () => {
      if (!filter货号) {
        // 塑胶半成品源:塑胶物料资料服务端关键字分页,行形状对齐物料资料
        if (dualSource && src === "plastic") {
          const r = await plasticMaterialMasterApi.list(undefined, kw, page, PAGE_SIZE);
          return { items: r.items.map(plasticToMaster), total: r.total };
        }
        return masterDataApi("materials").list(page, PAGE_SIZE, kw);
      }
      // 货号模式:物料资料 + 塑胶物料资料(按款号模糊,服务端过滤;挂不上时仅物料资料)
      const [ms, plastics] = await Promise.all([
        masterDataApi("materials").list(1, 1000, ""),
        plasticMaterialMasterApi
          .list(undefined, undefined, 1, 1000, undefined, undefined, 货号前缀(filter货号))
          .then((r) => r.items)
          .catch(() => [] as PlasticMaterialRow[]),
      ]);
      const seen = new Set(ms.items.map((m) => String(m.物料编号 ?? "")));
      const extra = plastics
        .filter((p) => !seen.has(String(p.物料编号 ?? "")))
        .map(plasticToMaster);
      return { items: [...ms.items, ...extra], total: ms.total + extra.length };
    },
    placeholderData: keepPreviousData,
    enabled: open,
  });
  // 货号模式:只留该货号(含共用)物料,再在结果内按关键字过滤
  const rows = useMemo(() => {
    const fetched = query.data?.items ?? [];
    if (!filter货号) return fetched;
    const keyword = kw.trim().toLowerCase();
    return fetched
      .filter((m) =>
        matchPrefix({ 款号: m.款号, 塑胶货号: m.塑胶货号, 物料名称: m.物料名称 }, filter货号),
      )
      .filter(
        (m) =>
          !keyword ||
          `${m.物料编号 ?? ""} ${m.物料名称 ?? ""} ${m.规格 ?? ""} ${m.颜色 ?? ""}`
            .toLowerCase()
            .includes(keyword),
      );
  }, [query.data, filter货号, kw]);
  const total = filter货号 ? rows.length : (query.data?.total ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageRows = filter货号 ? rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : rows;

  // 多选:全选=当前过滤结果全部(货号模式为内存全量;分页模式为本页)
  const allKeys = rows.map((m) => String(m.物料编号 ?? ""));
  const allChecked = allKeys.length > 0 && allKeys.every((k) => selected.includes(k));
  const toggleAll = () =>
    setSelected((ks) => (allChecked ? ks.filter((k) => !allKeys.includes(k)) : [...new Set([...ks, ...allKeys])]));
  const toggle = (code: string, v: boolean) =>
    setSelected((ks) => (v ? [...new Set([...ks, code])] : ks.filter((k) => k !== code)));
  const confirmMulti = () => {
    const picked = rows.filter((m) => selected.includes(String(m.物料编号 ?? "")));
    if (picked.length === 0) return;
    onPickMany?.(picked);
    close();
  };

  // 关闭即重置条件(不走 effect),避免重开闪现旧条件
  const close = () => {
    setKwInput("");
    setKw("");
    setPage(1);
    setSelected([]);
    setSrc("material");
    onClose();
  };

  return (
    <PickerDialog
      open={open}
      onClose={close}
      title={filter货号 ? `选择物料 · ${filter货号}` : "选择物料"}
      width="sm:max-w-[860px]"
      footer={
        multi ? (
          <>
            <span className="f-mono mr-auto text-sm text-[#5f6b7d]">已选 {selected.length} 项</span>
            <button type="button" className="f-btn h-10 px-4" onClick={close}>
              取消
            </button>
            <button
              type="button"
              className="f-btn f-btn-cyan h-10 px-4"
              disabled={selected.length === 0}
              onClick={confirmMulti}
            >
              确定
            </button>
          </>
        ) : undefined
      }
    >
      {dualSource && (
        <div className="mb-3 flex w-fit gap-1 rounded-xl border border-black/8 bg-black/[0.03] p-1">
          {(
            [
              ["material", "物料资料"],
              ["plastic", "塑胶半成品"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => {
                setSrc(v);
                setPage(1);
                setSelected([]);
              }}
              className={cn(
                "h-8 rounded-lg px-3.5 text-sm transition-colors",
                src === v
                  ? "bg-[#16a34a]/12 font-semibold text-[#15803d]"
                  : "text-[#5f6b7d] hover:text-[#3d4a5c]",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <form
        className="mb-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setKw(kwInput.trim());
        }}
      >
        <input
          aria-label="物料搜索"
          className="f-input f-input-slim flex-1"
          placeholder="物料编号/名称/规格/颜色"
          value={kwInput}
          onChange={(e) => setKwInput(e.target.value)}
        />
        <button type="submit" className="f-btn h-9 shrink-0 px-4 text-sm">
          查询
        </button>
      </form>
      <div className="max-h-[46vh] overflow-auto rounded-lg border border-black/8">
        <table className="w-full text-sm">
          <thead>
            <tr>
              {multi && (
                <th className={pickerThCls} style={{ width: 40 }}>
                  <Checkbox
                    aria-label="全选"
                    className="h-4.5 w-4.5 border-black/20 data-[state=checked]:border-[#16a34a] data-[state=checked]:bg-[#16a34a] data-[state=checked]:text-white"
                    checked={allChecked}
                    onCheckedChange={() => toggleAll()}
                  />
                </th>
              )}
              {["物料编号", "物料名称", "类别", "规格", "颜色", "单位"].map((h) => (
                <th key={h} className={pickerThCls}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((m) => {
              const code = String(m.物料编号 ?? "");
              const checked = selected.includes(code);
              return (
                <tr
                  key={String(m.ID ?? m.物料编号)}
                  className="cursor-pointer border-b border-black/6 transition-colors last:border-0 hover:bg-black/[0.04]"
                  onClick={() => {
                    if (multi) toggle(code, !checked);
                    else {
                      onPick?.(m);
                      close();
                    }
                  }}
                >
                  {multi && (
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        aria-label={`勾选 ${code}`}
                        className="h-4.5 w-4.5 border-black/20 data-[state=checked]:border-[#16a34a] data-[state=checked]:bg-[#16a34a] data-[state=checked]:text-white"
                        checked={checked}
                        onCheckedChange={(v) => toggle(code, v === true)}
                      />
                    </td>
                  )}
                  <td className="f-mono px-3 py-2 font-semibold whitespace-nowrap">
                    {code}
                  </td>
                  <td className="px-3 py-2">{String(m.物料名称 ?? "")}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{String(m.物料类别 ?? "")}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{String(m.规格 ?? "")}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{String(m.颜色 ?? "")}</td>
                  <td className="px-3 py-2">{String(m.单位 ?? "")}</td>
                </tr>
              );
            })}
            {query.isSuccess && pageRows.length === 0 && (
              <tr>
                <td colSpan={multi ? 7 : 6} className="px-3 py-4 text-center text-sm text-disabled">
                  没有匹配的物料
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="f-mono mt-3 flex items-center justify-between text-sm text-[#5f6b7d]">
        <span>
          共 {total} 条,第 {page} / {totalPages} 页
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
