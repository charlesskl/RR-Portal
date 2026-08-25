"use client";

export type InventoryRow = {
  productId: number;
  productNo: string;
  itemName: string;
  partName: string;
  finishedInStock: number;
  workshopStock: number;
  looseAvailable: number;
};

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
          <th className={TH}>子件</th>
          <th className={TH}>部位</th>
          <th className={THC}>成品在库</th>
          <th className={THC}>车间存数</th>
          <th className={THC}>散件可用</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={`${r.productId}-${r.itemName}-${r.partName}`}
            className="odd:bg-[#F9F9F9] hover:bg-[#F0F7FF] transition-colors"
          >
            <td className={`${TD} font-mono font-semibold`}>{r.productNo}</td>
            <td className={TD}>{r.itemName || "—"}</td>
            <td className={TD}>{r.partName}</td>
            <td className={`${TDC} font-semibold text-green-600`}>
              {r.finishedInStock.toLocaleString()}
            </td>
            <td className={`${TDC} font-semibold text-orange-500`}>
              {r.workshopStock.toLocaleString()}
            </td>
            <td className={`${TDC} font-semibold text-blue-600`}>
              {r.looseAvailable.toLocaleString()}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
