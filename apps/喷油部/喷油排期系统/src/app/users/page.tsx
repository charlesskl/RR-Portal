// 用户管理列表页（仅主管 admin 可访问）
// 防御纵深三层：
//   1) Sidebar（Task 10）—— 非主管不显示菜单入口（UI 层）
//   2) 本页服务端检查 —— 非主管直接 redirect 到 /（路由层）
//   3) /api/users 接口 —— 非主管返回 403（数据层）
import Link from "next/link";
import { redirect } from "next/navigation";
import { dotnetGet } from "@/lib/dotnet";
import { getSession } from "@/lib/session";

// .NET GET /api/users 列表项结构（camelCase，对应 UserListItem record）
// 含 createdAt（本页未用到，但保留以 1:1 对齐接口返回）
type UserListItemDto = {
  id: number;
  username: string;
  displayName: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
};

export default async function UsersPage() {
  // 路由层鉴权：仅主管可见，其余角色重定向回仪表盘
  const session = await getSession();
  if (session.role !== "admin") redirect("/");

  // 改调已迁移的 .NET 接口 GET /api/users（按 id 升序、不含 passwordHash），替代原 prisma 查询
  // dotnetGet 会自动带上 JWT cookie 并禁用缓存
  const users = await dotnetGet<UserListItemDto[]>("/api/users");

  // 角色英文 → 中文显示映射（与 prisma/schema.prisma 中的注释保持一致)
  const ROLE_LABEL: Record<string, string> = {
    admin: "主管", clerk: "文员/拉长", viewer: "统计组",
  };

  return (
    // §6.4 白卡片包裹：整页内容置于一张白卡片内，提供视觉层次感
    <div className="bg-white rounded-card border border-app-border p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      {/* 卡片标题行：左侧薄荷绿竖线 + 标题，右侧主操作按钮 */}
      <div className="flex justify-between items-center mb-5">
        <h1 className="text-lg font-semibold text-text border-l-4 border-mint-400 pl-3">👥 用户管理</h1>
        <Link href="/users/new" className="bg-mint-400 hover:bg-mint-700 text-white px-4 py-2 rounded-btn text-sm font-semibold shadow-[0_2px_8px_rgba(52,211,153,0.30)]">
          + 新建用户
        </Link>
      </div>

      {/* 表格已在白卡片内，去掉自身的 bg/rounded/border，只保留宽度；保留原有 thead 和斑马纹 */}
      <table className="w-full">
        <thead className="bg-[#f0fdf4] text-[#047857] text-xs">
          <tr>
            <th className="px-4 py-3 text-left">用户名</th>
            <th className="px-4 py-3 text-left">显示名</th>
            <th className="px-4 py-3 text-left">角色</th>
            <th className="px-4 py-3 text-left">状态</th>
            <th className="px-4 py-3 text-left">最近登录</th>
            <th className="px-4 py-3 text-left">操作</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u, i) => (
            <tr key={u.id} className={i % 2 ? "bg-[#F9F9F9]" : ""}>
              <td className="px-4 py-3 font-mono">{u.username}</td>
              <td className="px-4 py-3">{u.displayName}</td>
              <td className="px-4 py-3">{ROLE_LABEL[u.role] ?? u.role}</td>
              <td className="px-4 py-3">
                {u.isActive
                  ? <span className="text-mint-700">✅ 启用</span>
                  : <span className="text-text-tertiary">⊘ 停用</span>}
              </td>
              <td className="px-4 py-3 text-sm text-text-secondary">
                {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString("zh-CN") : "—"}
              </td>
              <td className="px-4 py-3">
                <Link href={`/users/${u.id}`} className="text-sky hover:underline text-sm">编辑</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
