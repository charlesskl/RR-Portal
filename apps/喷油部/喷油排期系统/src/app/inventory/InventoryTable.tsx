"use client";

export type StepStock = {
  stepNo: number;
  craft: string;
  totalGood: number;
  backlog: number;
};

export type InventoryRow = {
  productId: number;
  productNo: string;
  itemName: string;
  partName: string;
  orderNos: string;
  steps: StepStock[];
  wipTotal: number;
  finishedStock: number;
  workshopStock: number;
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
            key={`${r.productId}-${r.itemName}-${r.partName}`}
            className="odd:bg-[#F9F9F9] hover:bg-[#F0F7FF] transition-colors"
          >
            <td className={`${TD} font-mono font-semibold`}>{r.productNo}</td>
            <td className={TD}>{r.partName}</td>
            <td className={`${TD} min-w-[360px]`}>
              <div className="flex flex-wrap gap-x-5 gap-y-1">
                {r.steps.map((step, index) => (
                  <span key={step.stepNo} className="whitespace-nowrap">
                    <span className="text-text-secondary">{step.craft || `工序${step.stepNo}`}</span>
                    <strong className="ml-2 tabular-nums">{step.backlog.toLocaleString()}</strong>
                    <span className="ml-1 text-text-secondary">(完成{step.totalGood.toLocaleString()})</span>
                    {index === r.steps.length - 1 && (
                      <span className="ml-2 text-orange-500">待入库</span>
                    )}
                  </span>
                ))}
                {r.steps.length === 0 && <span className="text-text-secondary">暂无工序实绩</span>}
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
            <td className={`${TD} text-text-secondary`}>{r.orderNos || "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
