export type ExcessDetail = {
  orderNo: string; partName: string; stepNo: number; demand: number; produced: number; unreportedPlanned: number; excess: number;
  plans: { id: number; date: string; originalDate: string; lineName: string; plannedQty: number; countedQty: number; recorded: boolean; actualFallback: boolean; adjusted: boolean }[];
};
const number = (value: number) => value.toLocaleString("zh-CN");

export default function ExcessScheduleDetails({ details }: { details: ExcessDetail[] }) {
  return <section aria-label="超排数量明细" className="mb-4 space-y-4 rounded-lg border border-red-200 bg-white p-4 text-sm">
    <h2 className="font-bold text-red-700">超排数量明细（按当前草稿）</h2>
    <p className="text-text-secondary">统计同厂区、同订单、部位和工序的全部日期及拉别，包含当前筛选范围外的计划。超出数量 = 已生产 + 调整后未报工计划 − 订单需求。以下调整尚未保存。</p>
    {details.map(detail => <div key={`${detail.orderNo}/${detail.partName}/${detail.stepNo}`}>
      <h3 className="mb-2 font-bold">{detail.orderNo} / {detail.partName} · 第{detail.stepNo}道</h3>
      <dl className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        {[["订单需求", detail.demand], ["已生产", detail.produced], ["调整后未报工计划", detail.unreportedPlanned], ["超出数量", detail.excess]].map(([label, value]) => <div key={label} className={`rounded p-2 ${label === "超出数量" ? "bg-red-50 text-red-700" : "bg-slate-50"}`}><dt>{label}</dt><dd className="text-lg font-bold">{number(value as number)} 件</dd></div>)}
      </dl>
      <div className="max-h-80 overflow-auto"><table className="w-full min-w-[650px] border-collapse text-left">
        <caption className="sr-only">{detail.orderNo} {detail.partName} 涉及日期及计划数量</caption>
        <thead className="sticky top-0 bg-mint-50"><tr>{["日期", "拉别", "计划", "调整后计划数", "计入合计数量", "状态"].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead>
        <tbody>{detail.plans.map(plan => <tr key={plan.id} className={`border-b ${plan.adjusted ? "bg-amber-50" : ""}`}>
          <td className="p-2">{plan.date}{plan.originalDate !== plan.date && <small className="block">原日期 {plan.originalDate}</small>}</td><td className="p-2">{plan.lineName}</td>
          <td className="p-2">{plan.id < 0 ? "新增草稿" : `#${plan.id}`}</td><td className="p-2">{number(plan.plannedQty)}</td><td className="p-2">{number(plan.countedQty)}</td>
          <td className="p-2">{plan.recorded ? "已报工（计入已生产）" : "未报工"}{plan.adjusted ? " · 本次调整" : ""}{plan.actualFallback && <small className="block">未填良品数，按员工报数或原计划计入</small>}</td>
        </tr>)}</tbody>
      </table></div>
    </div>)}
  </section>;
}
