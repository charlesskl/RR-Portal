import { useQuery } from "@tanstack/react-query";
import { Prohibit, UsersThree } from "@phosphor-icons/react";
import { accountApi } from "@/api/endpoints";
import { usePerms } from "@/hooks/usePerms";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DocEmpty } from "@/components/doc/DocEmpty";
import { Skeleton } from "@/components/ui/skeleton";

// 在线人员(/online-users):全账号三色在线状态,30s 自动刷新。
// 状态由后端 AccountService 计算:在线(10min 内有操作)/忙线(网页开着但 >10min 无操作)/离线(网页关闭或已退出)。
// 权限门与账号权限管理同键:账号管理·打开(MenuCatalog.cs:112 实证)。
const MENU = "账号管理";

const STATUS_STYLE: Record<string, string> = {
  在线: "text-[#15803d]",
  忙线: "text-[#b45309]",
  离线: "text-[#5f6b7d]",
};

export default function OnlineUsersPage() {
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const q = useQuery({
    queryKey: ["online-users"],
    queryFn: () => accountApi.list(""),
    enabled: !permsLoading && canOpen,
    refetchInterval: 30 * 1000,
    refetchOnWindowFocus: true,
  });
  const rows = q.data ?? [];

  if (!permsLoading && !canOpen) {
    return (
      <div className="mx-auto max-w-7xl p-7">
        <div className="f-panel p-6">
          <DocEmpty
            icon={<Prohibit className="h-5 w-5" />}
            title="无权访问 在线人员"
            description="缺少「账号管理·打开」权限,请联系管理员开通"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="f-page flex h-full flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-3 px-1">
        <h1 className="text-2xl font-bold text-[#1a2330]">在线人员</h1>
        <span className="text-sm text-[#5f6b7d]">
          在线 {rows.filter((r) => r.在线状态 === "在线").length} · 忙线{" "}
          {rows.filter((r) => r.在线状态 === "忙线").length} · 离线{" "}
          {rows.filter((r) => r.在线状态 !== "在线" && r.在线状态 !== "忙线").length}
        </span>
        <span className="ml-auto text-xs text-[#5f6b7d]">每 30 秒自动刷新</span>
      </div>

      <div className="f-panel flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-[#ffffff]">
            <tr className="border-b border-black/8 text-left text-xs text-[#5f6b7d]">
              {["用户", "状态", "上次登录", "最后活动"].map((t) => (
                <th key={t} className="px-4 py-3 font-medium whitespace-nowrap">
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {q.isLoading &&
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i} className="border-b border-black/5">
                  <td colSpan={4} className="px-4 py-3">
                    <Skeleton className="h-4 w-full" />
                  </td>
                </tr>
              ))}
            {q.isError && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-[#dc2626]">
                  加载失败,请稍后重试
                </td>
              </tr>
            )}
            {q.isSuccess && rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-[#5f6b7d]">
                  暂无账号
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.用户} className="border-b border-black/5 last:border-0">
                <td className="px-4 py-2.5 font-medium whitespace-nowrap text-[#1a2330]">
                  <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#16a34a]/10 text-xs text-[#15803d]">
                    <UsersThree className="h-3.5 w-3.5" />
                  </span>
                  {r.用户}
                </td>
                <td
                  className={cn(
                    "px-4 py-2.5 font-semibold whitespace-nowrap",
                    STATUS_STYLE[r.在线状态 ?? "离线"] ?? STATUS_STYLE.离线,
                  )}
                >
                  {r.在线状态 ?? "离线"}
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap text-[#3d4a5c]">
                  {fmtDate(r.上次登录 || r.日期)}
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap text-[#3d4a5c]">
                  {fmtDate(r.最后活动时间)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
