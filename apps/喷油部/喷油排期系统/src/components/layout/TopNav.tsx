"use client";
import { apiFetch } from "@/lib/apiFetch";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const NAV_ITEMS = [
  { href: "/",          label: "仪表盘",     allowed: ["admin", "clerk", "viewer"], ready: true },
  { href: "/orders",    label: "订单总览",   allowed: ["admin", "clerk"],           ready: true },
  { href: "/schedule",  label: "排期",       allowed: ["admin", "clerk"],           ready: true  },
  { href: "/recording", label: "实绩录入",   allowed: ["admin", "clerk"],           ready: true },
  { href: "/products",  label: "产品核价表", allowed: ["admin", "clerk"],           ready: true },
  { href: "/inventory", label: "库存",       allowed: ["admin", "clerk", "viewer"], ready: true },
  { href: "/basic",     label: "基础数据库", allowed: ["admin", "clerk"],           ready: true },
  { href: "/users",     label: "用户管理",   allowed: ["admin"],                    ready: true },
];

export default function TopNav({ username, role }: { username: string; role: string }) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await apiFetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <header className="h-16 bg-white border-b border-app-border sticky top-0 z-20 flex items-center gap-4 px-8 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      {/* 左：品牌 */}
      <div className="shrink-0 mr-2">
        <span className="text-mint-700 font-bold text-lg">🎨 喷油部排期系统</span>
      </div>
      {/* 菜单：紧跟品牌后、左对齐 */}
      <nav className="flex items-center gap-1 flex-wrap">
        {NAV_ITEMS.filter((i) => i.allowed.includes(role)).map((item) => {
          // 未建模块：渲染为不可点的灰色 span，防止 404
          if (!item.ready) {
            return (
              <span
                key={item.href}
                title="模块开发中"
                className="px-4 py-2 rounded-[10px] text-sm text-text-tertiary/60 cursor-not-allowed select-none"
              >
                {item.label}
              </span>
            );
          }
          // 已建模块：渲染为可点击的 Link，保持 active/hover 样式
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`px-4 py-2 rounded-[10px] text-sm transition-colors ${
                active
                  ? "bg-mint-50 text-mint-700 font-semibold"
                  : "text-[#6b7280] hover:bg-[#f3f4f6] hover:text-[#1f2937]"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      {/* 右：用户 */}
      <div className="flex items-center gap-3 shrink-0 ml-auto">
        <div className="w-8 h-8 rounded-full bg-mint-400 text-white flex items-center justify-center text-sm font-semibold">
          {username.charAt(0).toUpperCase()}
        </div>
        <div className="text-sm leading-tight">
          <div className="text-text">{username}</div>
          <div className="text-[11px] text-text-tertiary">{role}</div>
        </div>
        <button
          onClick={handleLogout}
          className="text-sm text-text-secondary border border-app-border rounded-btn px-3 py-1 hover:bg-[#f3f4f6]"
        >
          退出
        </button>
      </div>
    </header>
  );
}
