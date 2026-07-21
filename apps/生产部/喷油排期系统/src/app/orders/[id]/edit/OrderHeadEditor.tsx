// src/app/orders/[id]/edit/OrderHeadEditor.tsx
// 订单头编辑表单（客户名 / 下单日 / 交货日 / 状态 / MA 标记 / 备注）
// 明细（子件×颜色×数量）不在此编辑，留 V2
"use client";
import { apiFetch } from "@/lib/apiFetch";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ACTIVE_STATUSES, STATUS_META } from "@/lib/orderStatus";

type Head = {
  orderDate: string;
  deliveryDate: string;
  remark: string;
  isMA: boolean;
  isUrgent: boolean;
  status: string;
};

export default function OrderHeadEditor({
  id,
  externalOrderNo,
  productNo,
  init,
}: {
  id: number;
  externalOrderNo: string;
  productNo: string;
  init: Head;
}) {
  const router = useRouter();
  const [h, setH] = useState<Head>(init);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // 局部更新状态字段
  const set = (patch: Partial<Head>) => setH((c) => ({ ...c, ...patch }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await apiFetch(`/api/orders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderDate: h.orderDate || undefined,    // 空串不传，保留原值
        deliveryDate: h.deliveryDate || null,   // 空串传 null，清空交货日
        remark: h.remark,
        isMA: h.isMA,
        isUrgent: h.isUrgent,
        status: h.status,
      }),
    });
    if (res.ok) {
      router.push("/orders");
      router.refresh();
    } else {
      const b = await res.json().catch(() => ({}));
      setError(b.error || "保存失败");
      setLoading(false);
    }
  }

  // 状态下拉：正常 4 态 + 作废 + 当前值（用 Set 去重，保证已是 archived 也能显示）
  const statusOptions = Array.from(new Set([...ACTIVE_STATUSES, "archived", h.status]));

  return (
    <div className="max-w-2xl">
      <h1 className="text-lg font-semibold text-text border-l-4 border-mint-400 pl-3 mb-5">
        ✏️ 编辑订单 {externalOrderNo}
      </h1>
      <form
        onSubmit={save}
        className="bg-white p-6 rounded-card border border-app-border space-y-4"
      >
        {/* 款号只读，不可修改 */}
        <L label="款号（不可改）">
          <input
            className={inp + " bg-[#f9fafb] text-text-secondary"}
            value={productNo}
            readOnly
          />
        </L>

        <div className="grid grid-cols-2 gap-4">
          <L label="下单日期">
            <input
              className={inp}
              type="date"
              value={h.orderDate}
              onChange={(e) => set({ orderDate: e.target.value })}
            />
          </L>
          <L label="交货日期">
            <input
              className={inp}
              type="date"
              value={h.deliveryDate}
              onChange={(e) => set({ deliveryDate: e.target.value })}
            />
          </L>
        </div>

        <L label="状态">
          <select
            className={inp}
            value={h.status}
            onChange={(e) => set({ status: e.target.value })}
          >
            {statusOptions.map((s) => (
              <option key={s} value={s}>
                {STATUS_META[s]?.text ?? s}
              </option>
            ))}
          </select>
        </L>

        {/* MA 标记复选框 */}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={h.isMA}
            onChange={(e) => set({ isMA: e.target.checked })}
          />
          <span>标记为 MA（非正式单）</span>
        </label>

        {/* 急单标记复选框：原计划外、临时插入的单 */}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={h.isUrgent}
            onChange={(e) => set({ isUrgent: e.target.checked })}
          />
          <span>标记为急单（原计划外、临时插入的单）</span>
        </label>

        <L label="备注">
          <input
            className={inp}
            value={h.remark}
            onChange={(e) => set({ remark: e.target.value })}
          />
        </L>

        {error && <p className="text-rose text-sm">{error}</p>}

        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={() => router.push("/orders")}
            className="px-4 py-2 border border-app-border rounded-btn text-sm"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={loading}
            className="bg-mint-400 hover:bg-mint-700 text-white px-4 py-2 rounded-btn text-sm"
          >
            {loading ? "保存中..." : "💾 保存"}
          </button>
        </div>
      </form>
    </div>
  );
}

// 公共输入框样式
const inp =
  "w-full border border-app-border rounded-btn px-3 py-2 text-sm focus:outline-none focus:border-mint-400";

// 表单字段包装组件（label + 内容）
function L({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs text-text-secondary mb-1">{label}</label>
      {children}
    </div>
  );
}
