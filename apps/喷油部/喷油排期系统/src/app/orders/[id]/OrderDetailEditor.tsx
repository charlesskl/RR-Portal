// 订单详情 = 查看 + 就地编辑（合并原 [id]/page 与 [id]/edit）
// 可改：下单/交货日期、备注、急单、MA、各部位数量（数量仅「已接单」可改，用于修正导入识别错误）。
// 状态只读（系统自动流转，不可手动改）。子件明细两列并排，减少翻页长度。
"use client";
import { apiFetch } from "@/lib/apiFetch";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { lineTotalQty, orderTotalQty, lineUnitPrice } from "@/lib/order";
import { STATUS_META } from "@/lib/orderStatus";

// 与 .NET GET /api/orders/{id} 详情对齐的类型
type PartQtyDto = { id: number; partName: string; sourcePartId: number | null; qty: number; partOrder: number };
type LineDto = { id: number; itemName: string; sourceItemId: number | null; lineOrder: number; partQtys: PartQtyDto[] };
type ProductPartDto = { id: number; partName: string; unitCost: number; laborPrice: number; paintCost: number; quotedPrice: number };
type ProductItemDto = { id: number; itemName: string; parts: ProductPartDto[] };
type OrderProductDto = { id: number; productNo: string; items: ProductItemDto[] };
export type OrderDetailDto = {
  id: number; externalOrderNo: string; productId: number | null;
  orderDate: string; deliveryDate: string | null; status: string; isMA: boolean; isUrgent: boolean;
  remark: string | null; createdBy: string;
  product: OrderProductDto | null; lines: LineDto[];
  qtyEditable: boolean;   // 后端算好：received 且 无排期计划 才可改数量
};

// 本地时区 yyyy-MM-dd（避免 toISOString 的 UTC 偏差导致日期少一天）
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (s: string | null) => {
  if (!s) return "";
  const x = new Date(s);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
};

export default function OrderDetailEditor({ order }: { order: OrderDetailDto }) {
  const router = useRouter();
  const product = order.product!;
  const partsByItem = new Map(product.items.map((it) => [it.itemName, it.parts]));

  // 数量是否可改：由后端给出（received 且无排期计划）。与 PATCH 校验同口径，避免"能改却存不上"。
  const qtyEditable = order.qtyEditable;

  // 可编辑头部字段
  const [orderDate, setOrderDate] = useState(ymd(order.orderDate));
  const [deliveryDate, setDeliveryDate] = useState(ymd(order.deliveryDate));
  const [remark, setRemark] = useState(order.remark ?? "");
  const [isMA, setIsMA] = useState(order.isMA);
  const [isUrgent, setIsUrgent] = useState(order.isUrgent);
  // 各部位数量：以 partQtyId 为 key 的可变副本
  const [qtys, setQtys] = useState<Record<number, number>>(
    () => Object.fromEntries(order.lines.flatMap((l) => l.partQtys.map((q) => [q.id, q.qty])))
  );

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [savedTip, setSavedTip] = useState(false);
  const [unscheduling, setUnscheduling] = useState(false);

  // 是否可撤销排期：订单已排期/在产时才有意义
  const canUnschedule = order.status === "scheduled" || order.status === "in_production";

  // 撤销排期：删除该订单全部排期计划，订单退回已接单（已录实绩的后端会拒绝）
  async function unschedule() {
    if (!confirm(`确定撤销订单 ${order.externalOrderNo} 的全部排期吗？\n\n撤销后该订单退回「已接单」，已排的计划将全部删除（已录实绩的无法撤销）。`)) return;
    setUnscheduling(true);
    setError("");
    const res = await apiFetch(`/api/schedule/orders/${order.id}/unschedule`, { method: "POST" });
    if (res.ok) {
      router.refresh();
    } else {
      const b = await res.json().catch(() => ({}));
      setError(b.error || "撤销排期失败");
    }
    setUnscheduling(false);
  }

  const setQty = (id: number, v: string) => {
    const n = Math.max(0, Math.floor(Number(v) || 0));
    setQtys((c) => ({ ...c, [id]: n }));
  };

  async function save() {
    setLoading(true);
    setError("");
    setSavedTip(false);
    // 组装明细数量（仅可改时提交，避免对已排期单误触发后端拒绝）
    const lines = qtyEditable
      ? order.lines.map((l) => ({ partQtys: l.partQtys.map((q) => ({ id: q.id, qty: qtys[q.id] ?? q.qty })) }))
      : undefined;
    const res = await apiFetch(`/api/orders/${order.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderDate: orderDate || undefined,
        deliveryDate: deliveryDate || null,
        remark,
        isMA,
        isUrgent,
        lines,
      }),
    });
    if (res.ok) {
      setSavedTip(true);
      router.refresh();
      setTimeout(() => setSavedTip(false), 2500);
    } else {
      const b = await res.json().catch(() => ({}));
      setError(b.error || "保存失败");
    }
    setLoading(false);
  }

  // 用本地 qtys 实时算行合计/整单总数
  const lineQtys = (l: LineDto) => l.partQtys.map((q) => ({ ...q, qty: qtys[q.id] ?? q.qty }));

  return (
    <div className="max-w-6xl">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-text border-l-4 border-mint-400 pl-3">
          📋 订单 {order.externalOrderNo}
        </h1>
        <div className="flex items-center gap-3">
          {canUnschedule && (
            <button
              type="button"
              onClick={unschedule}
              disabled={unscheduling}
              className="text-rose border border-rose/40 hover:bg-rose/10 rounded-btn px-3 py-1 text-sm disabled:opacity-60"
              title="删除该订单全部排期，退回已接单"
            >
              {unscheduling ? "撤销中..." : "🗑 撤销排期"}
            </button>
          )}
          {/* 状态只读：由系统自动流转（接单→排期→在产→完工），不可手动改 */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-secondary">状态</span>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${STATUS_META[order.status]?.cls ?? "bg-[#f3f4f6] text-[#9ca3af]"}`}>
              {STATUS_META[order.status]?.text ?? order.status}
            </span>
          </div>
        </div>
      </div>

      {/* 订单头：左侧基本信息（款号/日期/备注），右侧急单·MA 勾选（截图红框位置） */}
      <div className="bg-white p-5 rounded-card border border-app-border mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <Field label="款号（不可改）">
            <div className="font-mono py-2">{product.productNo}</div>
          </Field>
          <Field label="下单日期">
            <input className={inp} type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
          </Field>
          <Field label="交货日期">
            <input className={inp} type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm mt-4">
          <div className="md:col-span-2">
            <Field label="备注">
              <input className={inp} value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="—" />
            </Field>
          </div>
          {/* 急单 / MA 单勾选 —— 放备注右侧空白处 */}
          <div className="flex flex-col justify-end gap-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={isUrgent} onChange={(e) => setIsUrgent(e.target.checked)} />
              <span className="text-sm">急单（计划外临时插入）</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={isMA} onChange={(e) => setIsMA(e.target.checked)} />
              <span className="text-sm">MA 单（非正式单）</span>
            </label>
          </div>
        </div>
      </div>

      {/* 明细：子件卡片两列并排，减少翻页长度 */}
      {!qtyEditable && (
        <p className="text-xs text-text-secondary mb-2">ℹ️ 该订单已排期或进入生产，数量已锁定不可修改（仅「已接单且未排期」的订单可改数量，用于修正导入识别错误）。</p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
        {order.lines.map((ln) => {
          const base = partsByItem.get(ln.itemName) || [];
          const unit = lineUnitPrice(base);
          return (
            <div key={ln.id} className="bg-white rounded-card border border-app-border overflow-hidden self-start">
              <div className="flex items-center gap-3 px-4 py-2 bg-[#f0fdf4] text-sm">
                <span className="font-semibold text-[#047857]">{ln.itemName}</span>
                <span className="text-xs text-text-secondary">单件综合价 {unit.toFixed(4)}</span>
                <span className="ml-auto text-xs text-text-secondary">
                  行合计 <b className="text-text">{lineTotalQty(lineQtys(ln)).toLocaleString("zh-CN")}</b>
                </span>
              </div>
              <table className="w-full text-sm">
                <thead className="text-xs text-text-secondary">
                  <tr><th className="px-4 py-1.5 text-left">部位</th><th className="px-4 py-1.5 text-right">数量</th></tr>
                </thead>
                <tbody>
                  {ln.partQtys.map((q, i) => (
                    <tr key={q.id} className={i % 2 ? "bg-[#fafdfb]" : ""}>
                      <td className="px-4 py-1.5">{q.partName}</td>
                      <td className="px-4 py-1.5 text-right">
                        {qtyEditable ? (
                          <input
                            type="number"
                            min={0}
                            className="w-28 border border-app-border rounded-btn px-2 py-1 text-right focus:outline-none focus:border-mint-400"
                            value={qtys[q.id] ?? q.qty}
                            onChange={(e) => setQty(q.id, e.target.value)}
                          />
                        ) : (
                          (qtys[q.id] ?? q.qty).toLocaleString("zh-CN")
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>

      <div className="text-right text-sm mb-4">
        整单总数 <span className="font-bold text-mint-700">{orderTotalQty(order.lines.map((l) => ({ partQtys: lineQtys(l) }))).toLocaleString("zh-CN")}</span>
      </div>

      {error && <p className="text-rose text-sm text-right mb-2">{error}</p>}
      {savedTip && <p className="text-mint-700 text-sm text-right mb-2">✓ 已保存</p>}

      <div className="flex items-center justify-between">
        <Link href="/orders" className="text-sky hover:underline text-sm">← 返回订单列表</Link>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => router.refresh()}
            className="px-4 py-2 border border-app-border rounded-btn text-sm"
          >
            撤销修改
          </button>
          <button
            type="button"
            onClick={save}
            disabled={loading}
            className="bg-mint-400 hover:bg-mint-700 text-white px-4 py-2 rounded-btn text-sm disabled:opacity-60"
          >
            {loading ? "保存中..." : "💾 保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

const inp =
  "w-full border border-app-border rounded-btn px-3 py-2 text-sm focus:outline-none focus:border-mint-400";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-text-secondary mb-1">{label}</div>
      {children}
    </div>
  );
}
