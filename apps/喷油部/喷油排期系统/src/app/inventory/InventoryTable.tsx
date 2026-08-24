"use client";

import type { InventoryRow } from "@/lib/inventory";

const TH = "px-3 py-2 text-left text-xs font-semibold text-white bg-mint-400";
const THC = "px-3 py-2 text-center text-xs font-semibold text-white bg-mint-400";
const TD = "px-3 py-2 text-sm border-b border-app-border";
const TDC = "px-3 py-2 text-sm border-b border-app-border text-center tabular-nums";

export function InventoryTable({ rows }: { rows: InventoryRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-center text-text-secondary py-8">
        暂无库存数据（请先录入排期实绩）
      </p>
    );
  }

  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr>
          <th className={TH}>货号</th>
          <th className={TH}>部位</th>
          <th className={TH}>工序积压明细</th>
          <th className={THC}>半成品合计</th>
          <th className={THC}>成品库存</th>
          <th className={THC}>车间存数</th>
          <th className={TH}>关联单号</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={`${r.productId}-${r.partName}`}
            className="odd:bg-[#F9F9F9] hover:bg-[#F0F7FF] transition-colors"
          >
            <td className={`${TD} font-mono font-semibold`}>{r.productNo}</td>
            <td className={TD}>{r.partName}</td>
            <td className={TD}>
              <div className="space-y-1">
                {r.steps.map((s, idx) => {
                  const isLast = idx === r.steps.length - 1;
                  return (
                    <div key={s.stepNo} className="flex items-center gap-2 text-xs">
                      <span className="inline-block w-14 font-medium text-text-secondary">
                        {s.craft || `工序${s.stepNo}`}
                      </span>
                      <span className="font-semibold tabular-nums">
                        {s.backlog.toLocaleString()}
                      </span>
                      <span className="text-gray-400">
                        (完成{s.totalGood.toLocaleString()})
                      </span>
                      {isLast && (
                        <span className="text-xs text-orange-500 ml-1">待入库</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </td>
            <td className={`${TDC} font-semibold text-blue-600`}>
              {r.wipTotal.toLocaleString()}
            </td>
            <td className={`${TDC} font-semibold text-green-600`}>
              {r.finishedStock.toLocaleString()}
            </td>
            <td className={`${TDC} font-semibold text-orange-500`}>
              {r.workshopStock.toLocaleString()}
            </td>
            <td className={`${TD} text-xs text-text-secondary max-w-[180px] truncate`}>
              {r.orderNos || "-"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
