import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, MagnifyingGlass, UsersThree, X } from "@phosphor-icons/react";
import { accountApi } from "@/api/endpoints";
import { usePerms } from "@/hooks/usePerms";
import { cn } from "@/lib/utils";

// 顶栏在线徽章+成员抽屉(借鉴 RR 中台成员目录):
// 徽章显示实时在线人数,点击右侧滑出抽屉——搜索+状态页签过滤,底部「查看全部」进 /online-users 整页。
// 数据门与在线人员页同键:账号管理·打开(账号列表接口本身有该权限门)。
// 抽屉必须 portal 到 body:顶栏 header 带 backdrop-blur,backdrop-filter 会把 fixed 后代的包含块
// 变成 header(56px),导致抽屉被压扁、页面内容从遮罩下透出。
const MENU = "账号管理";

const STATUS_STYLE: Record<string, string> = {
  在线: "text-[#15803d]",
  忙线: "text-[#b45309]",
  离线: "text-[#5f6b7d]",
};
const STATUS_DOT: Record<string, string> = {
  在线: "bg-[#16a34a]",
  忙线: "bg-[#d97706]",
  离线: "bg-[#9aa4b2]",
};
const TABS = ["全部", "在线", "忙线", "离线"] as const;

export function OnlineBadge({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { can, loading: permsLoading } = usePerms();
  const canOpen = can(MENU, "打开");
  const [open, setOpen] = useState(false);
  const [kw, setKw] = useState("");
  const [tab, setTab] = useState<(typeof TABS)[number]>("全部");
  const q = useQuery({
    queryKey: ["online-users"],
    queryFn: () => accountApi.list(""),
    enabled: !permsLoading && canOpen,
    refetchInterval: 30 * 1000,
  });
  const rows = q.data ?? [];
  const onlineCount = rows.filter((r) => r.在线状态 === "在线").length;

  if (permsLoading || !canOpen) return null;

  const filtered = rows.filter(
    (r) =>
      (tab === "全部" || (r.在线状态 ?? "离线") === tab) &&
      (!kw.trim() || (r.用户 ?? "").toLowerCase().includes(kw.trim().toLowerCase())),
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="在线人员"
        className="flex h-10 items-center gap-1.5 rounded-lg px-2.5 text-sm text-[#3d4a5c] transition-colors hover:bg-black/5"
      >
        <UsersThree className="h-4.5 w-4.5 text-[#15803d]" />
        <span className="font-semibold text-[#15803d]">{onlineCount}</span>
        <span className="text-[#5f6b7d]">在线</span>
      </button>

      {open &&
        createPortal(
          <div className="fixed inset-0 z-50" role="dialog" aria-label="在线人员">
          <div className="absolute inset-0 bg-black/20" onClick={() => setOpen(false)} />
          <div className="absolute top-0 right-0 flex h-full w-[360px] flex-col bg-[#ffffff] shadow-2xl">
            <div className="flex items-center justify-between border-b border-black/8 px-5 py-4">
              <div>
                <div className="text-base font-semibold text-[#1a2330]">在线人员</div>
                <div className="mt-0.5 text-xs text-[#5f6b7d]">
                  {onlineCount} 人在线 · 共 {rows.length} 个账号
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-[#5f6b7d] hover:bg-black/5"
                aria-label="关闭"
              >
                <X className="h-4.5 w-4.5" />
              </button>
            </div>

            <div className="border-b border-black/8 px-5 py-3">
              <div className="flex h-9 items-center gap-2 rounded-lg border border-black/10 bg-black/[0.03] px-3">
                <MagnifyingGlass className="h-4 w-4 text-[#5f6b7d]" />
                <input
                  value={kw}
                  onChange={(e) => setKw(e.target.value)}
                  placeholder="搜索账号"
                  className="w-full bg-transparent text-sm text-[#1a2330] outline-none placeholder:text-[#9aa4b2]"
                />
              </div>
              <div className="mt-2.5 flex gap-1.5">
                {TABS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTab(t)}
                    className={cn(
                      "h-7 rounded-md px-2.5 text-xs transition-colors",
                      tab === t
                        ? "bg-[#16a34a]/10 font-semibold text-[#15803d]"
                        : "text-[#5f6b7d] hover:bg-black/5",
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-2">
              {filtered.length === 0 && (
                <div className="py-10 text-center text-sm text-[#5f6b7d]">没有匹配的账号</div>
              )}
              {filtered.map((r) => {
                const status = r.在线状态 ?? "离线";
                return (
                  <div
                    key={r.用户}
                    className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-black/[0.03]"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#16a34a]/10 text-xs font-bold text-[#15803d]">
                      {(r.用户 ?? "?").slice(0, 1).toUpperCase()}
                    </span>
                    <span className="flex-1 text-sm font-medium text-[#1a2330]">{r.用户}</span>
                    <span
                      className={cn(
                        "flex items-center gap-1.5 text-xs font-semibold",
                        STATUS_STYLE[status],
                      )}
                    >
                      <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[status])} />
                      {status}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="border-t border-black/8 p-4">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onNavigate("/online-users");
                }}
                className="flex h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-[#16a34a] text-sm font-semibold text-[#ffffff] transition-colors hover:bg-[#15803d]"
              >
                查看全部
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
