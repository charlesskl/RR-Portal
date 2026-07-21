// 仪表盘（控制台）—— UI_STYLE_GUIDE §6.3
import Link from "next/link";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import { dotnetGet } from "@/lib/dotnet";
import type { GanttOrder } from "@/lib/scheduleData";
import GanttView from "@/app/schedule/gantt/GanttView";

// .NET 仪表盘统计接口返回结构（字段为 .NET 默认 camelCase 序列化）
// 对应 server/.../Dashboard/DashboardController.cs 的 DashboardStats 记录。
type DashboardStats = {
  ordersTotal: number;
  ordersActive: number;
  overdue: number;
  productsCount: number;
};

export default async function Dashboard() {
  const session = await getSession();
  if (!session.userId) redirect("/login");

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  // 取数已迁移到 .NET：
  //  - 4 个统计卡 → GET /api/dashboard（口径与原 Prisma count 1:1 对齐）
  //  - 甘特图数据 → GET /api/schedule?today=YYYY-MM-DD（替代原 buildGanttData(now)，
  //    today 沿用页面本地日期字符串以保持 expectedOutDate 计算口径一致）
  const [stats, ganttOrders] = await Promise.all([
    dotnetGet<DashboardStats>("/api/dashboard"),
    dotnetGet<GanttOrder[]>(`/api/schedule?today=${todayStr}`),
  ]);
  const { ordersTotal, ordersActive, overdue, productsCount } = stats;

  const dateStr = now.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
  const weekday = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][now.getDay()];

  const STATS = [
    { label: "订单总数（张）",   value: ordersTotal,   dot: "bg-mint-400" },
    { label: "在产订单（张）",   value: ordersActive,  dot: "bg-sky",     hint: "状态=已确认" },
    { label: "已逾期订单（张）", value: overdue,       dot: "bg-rose",    hint: "交货日已过且未作废" },
    { label: "产品款数（款）",   value: productsCount, dot: "bg-purple" },
  ];

  const CARDS = [
    { href: "/orders/new", icon: "📝", chips: ["订单", "录入"], title: "新建订单",     desc: "选款号→按子件的部位填数量", ready: true },
    { href: "/schedule",   icon: "📅", chips: ["排期"],         title: "订单排期",     desc: "选日期+拉别 → 机台联动指派 → 填计划数 → 生成待录单", ready: true },
    { href: "/recording",  icon: "✏️", chips: ["实绩"],         title: "每日实绩录入", desc: "填实际生产数 → 算产值 / 余下数 / 完工 → 导出明细表", ready: true },
    { href: "/products",   icon: "📇", chips: ["产品", "核价"], title: "产品核价表",   desc: "款号→子件→部位 4 价 下钻维护",       ready: true },
    { href: "/inventory",  icon: "📦", chips: ["库存"],         title: "库存查询",     desc: "成品在库 / 散件可用 · 按款号子件部位查",        ready: true },
    { href: "/basic",      icon: "🗂️", chips: ["基础", "数据"], title: "基础数据库",   desc: "拉别 / 机台 / 节假日 维护",                     ready: true },
  ];

  return (
    <div className="space-y-9">
      {/* 标题区 */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-[28px] font-bold text-[#0f172a]">喷油部 控制台</h1>
          <p className="text-sm text-text-secondary mt-1">
            欢迎回来，<strong className="text-text">{session.username}</strong> · {session.role}
          </p>
        </div>
        <div className="text-right text-sm text-text-tertiary">
          <div>{dateStr}</div>
          <div>{weekday}</div>
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-4 gap-4">
        {STATS.map((s) => (
          <div key={s.label} className="bg-white rounded-card border border-app-border p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            <div className="flex items-center gap-2 text-sm text-text-secondary mb-2">
              <span className={`w-2 h-2 rounded-full ${s.dot}`} />
              {s.label}
            </div>
            <div className="text-4xl font-bold text-[#0f172a]">{s.value.toLocaleString("zh-CN")}</div>
            {s.hint && <div className="text-xs text-text-tertiary mt-1">{s.hint}</div>}
          </div>
        ))}
      </div>

      {/* 日常操作 功能卡片 */}
      <div>
        <h2 className="text-lg font-semibold text-text border-l-4 border-mint-400 pl-3 mb-4">📋 日常操作</h2>
        <div className="grid grid-cols-3 gap-4">
          {CARDS.map((c) => {
            const inner = (
              <>
                <div className="text-2xl mb-3">{c.icon}</div>
                <div className="flex gap-1 mb-2">
                  {c.chips.map((ch) => (
                    <span key={ch} className="text-[11px] px-2 py-0.5 rounded-full bg-mint-50 text-mint-700">{ch}</span>
                  ))}
                </div>
                <div className="font-semibold text-text mb-1">{c.title}</div>
                <div className="text-xs text-text-tertiary leading-relaxed">{c.desc}</div>
              </>
            );
            return c.ready ? (
              <Link
                key={c.title}
                href={c.href}
                className="bg-white rounded-card border border-app-border p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:shadow-[0_8px_20px_rgba(0,0,0,0.06)] hover:-translate-y-0.5 transition-all block"
              >
                {inner}
              </Link>
            ) : (
              <div
                key={c.title}
                title="模块开发中"
                className="bg-white rounded-card border border-app-border p-5 opacity-50 cursor-not-allowed select-none"
              >
                {inner}
              </div>
            );
          })}
        </div>
      </div>

      {/* 排期甘特图（订单总览的甘特图视图，标题已在组件外去除） */}
      <div>
        <GanttView orders={ganttOrders} today={todayStr} />
      </div>
    </div>
  );
}
