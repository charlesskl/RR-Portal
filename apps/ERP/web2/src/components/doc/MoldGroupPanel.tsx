// 一套模明细面板(塑胶采购订单页 / 塑胶采购订单新建抽屉 共用):
// 按模具编号分组,一行一配件(物料编号/名称/订购数量/出模数/啤数),组级列(模具编号/共啤数/堵模说明)rowspan 合并;
// 啤数=ceil(数量/出模数),同模啤数不齐=先啤够的腔要堵掉(堵模说明列出)。
import { cn } from "@/lib/utils";
import type { MoldGroup } from "@/lib/plasticPurchase";
import { pickerThCls } from "./PickerDialog";

const numTh = "text-right";

export function MoldGroupPanel({ groups }: { groups: MoldGroup[] }) {
  if (groups.length === 0) return null;
  return (
    <div className="f-panel overflow-auto p-4">
      <div className="mb-2 text-sm font-semibold text-[#1a2330]">同模分组(一套模明细 · 啤数/堵模)</div>
      <table className="w-full min-w-[860px] text-[15px]">
        <thead>
          <tr>
            {["模具编号", "物料编号", "物料名称", "订购数量", "出模数", "啤数", "共啤数", "堵模说明"].map(
              (h) => (
                <th
                  key={h}
                  className={cn(
                    pickerThCls,
                    (h === "订购数量" || h === "出模数" || h === "啤数" || h === "共啤数") && numTh,
                  )}
                >
                  {h}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const early = g.lines.filter(
              (l) => l.啤数 != null && g.共啤数 != null && l.啤数 < g.共啤数,
            );
            return g.lines.map((l, i) => (
              <tr key={l.key} className="border-b border-black/6 last:border-0">
                {i === 0 && (
                  <td
                    rowSpan={g.lines.length}
                    className="f-mono px-3 py-2 align-top font-semibold whitespace-nowrap text-[#1a2330]"
                  >
                    {g.模具编号}
                  </td>
                )}
                <td className="f-mono px-3 py-2 whitespace-nowrap text-[#3d4a5c]">{l.物料编号 ?? ""}</td>
                <td className="px-3 py-2 text-[#3d4a5c]">{l.物料名称 ?? ""}</td>
                <td className="f-mono px-3 py-2 text-right text-[#3d4a5c]">{l.数量 ?? ""}</td>
                <td className="f-mono px-3 py-2 text-right text-[#3d4a5c]">{l.出模数 ?? ""}</td>
                <td className="f-mono px-3 py-2 text-right font-semibold text-[#1a2330]">
                  {l.啤数 ?? ""}
                </td>
                {i === 0 && (
                  <td
                    rowSpan={g.lines.length}
                    className="f-mono px-3 py-2 align-top text-right font-semibold text-[#1a2330]"
                  >
                    {g.共啤数 ?? ""}
                  </td>
                )}
                {i === 0 && (
                  <td rowSpan={g.lines.length} className="px-3 py-2 align-top">
                    {g.共啤数 == null ? (
                      <span className="text-xs text-[#5f6b7d]">出模数未填,无法算啤数</span>
                    ) : g.不平衡 ? (
                      <span className="text-xs font-medium text-[#b45309]">
                        {early
                          .map((l) => `${l.物料名称 ?? l.物料编号} 第${l.啤数}啤后堵`)
                          .join(";")}
                      </span>
                    ) : (
                      <span className="text-xs font-medium text-[#15803d]">平衡 · 无需堵模</span>
                    )}
                  </td>
                )}
              </tr>
            ));
          })}
        </tbody>
      </table>
    </div>
  );
}
