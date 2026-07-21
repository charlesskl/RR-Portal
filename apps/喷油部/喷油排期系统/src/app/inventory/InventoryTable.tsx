"use client";

export type InventoryRow = {
  productId: number; productNo: string;
  itemName: string; partName: string;
  finishedInStock: number; workshopStock: number; looseAvailable: number;
};

const TH = "px-3 py-2 text-left text-xs font-semibold text-white bg-mint-400";
const THC = "px-3 py-2 text-center text-xs font-semibold text-white bg-mint-400";

export function InventoryTable({ rows }: { rows: InventoryRow[] }) {
  if (rows.length === 0) return <p className="text-center text-text-secondary py-8">暂无库存数据（成品来自实绩录入，散件来自后续凑套/炒货拆账）</p>;
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr>
          <th className={TH}>款号</th><th className={TH}>子件</th><th className={TH}>部位</th>
          <th className={THC}>成品在库</th><th className={THC}>车间存数</th><th className={THC}>散件可用</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.productId}-${r.itemName}-${r.partName}`} className="border-b border-app-border odd:bg-[#F9F9F9]">
            <td className="px-3 py-2 font-mono">{r.productNo}</td>
            <td className="px-3 py-2">{r.itemName}</td>
            <td className="px-3 py-2">{r.partName}</td>
            <td className="px-3 py-2 text-center font-semibold tabular-nums">{r.finishedInStock.toLocaleString()}</td>
            <td className="px-3 py-2 text-center tabular-nums">{r.workshopStock.toLocaleString()}</td>
            <td className="px-3 py-2 text-center tabular-nums">{r.looseAvailable.toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
