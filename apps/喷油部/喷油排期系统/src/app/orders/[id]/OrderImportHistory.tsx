export type ImportReceipt = { id: number; sourceFactoryId: string | null; factoryId: string; acceptedQty: number; pendingDetails: boolean;
  createdBy: string; createdAt: string; parts: { productNo: string; partName: string; qty: number }[] };
const factory = (id: string | null) => id === "HUADENG" ? "华登" : id === "XINGXIN" ? "兴信" : "未确认";
export default function OrderImportHistory({ receipts }: { receipts?: ImportReceipt[] }) {
  if (!receipts?.length) return null;
  return <section aria-label="来源及承接记录" className="my-4 rounded-lg border border-app-border bg-white p-4 text-sm">
    <h2 className="mb-2 font-semibold text-mint-700">来源及承接记录</h2>
    <p className="mb-2 text-xs text-text-secondary">按每次导入记录承接的部位数量合计；后续更正订单数量不改写这些历史记录。</p>
    {receipts.map(receipt => <details key={receipt.id} className="border-t p-2">
      <summary className="cursor-pointer">来源：{factory(receipt.sourceFactoryId)} → 导入厂区：{factory(receipt.factoryId)} · {receipt.pendingDetails ? "承接数量待补明细确认" : `本次承接 ${receipt.acceptedQty.toLocaleString("zh-CN")} 件`} · {receipt.createdBy} · {new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "short", timeStyle: "short" }).format(new Date(receipt.createdAt))}</summary>
      <ul className="mt-2 space-y-1">{receipt.parts.map((part, i) => <li key={i}>{part.productNo} · {part.partName}：{part.qty.toLocaleString("zh-CN")} 件</li>)}</ul>
    </details>)}
  </section>;
}
