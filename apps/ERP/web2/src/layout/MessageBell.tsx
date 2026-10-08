import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Checks } from "@phosphor-icons/react";
import { messagesApi } from "@/api/endpoints";
import type { MessageRow } from "@/api/types";
import { cn } from "@/lib/utils";

// 消息铃铛 + 下拉消息面板(接真实 /api/messages 数据):
// 点铃铛切换开关,点外部/Esc 关闭;角标为真实未读数(60s 轮询);
// 未读高亮(绿点+加粗),点未读消息标记已读;头部「只看未读」切换,底部「查看全部」跳消息中心页。
const rowId = (m: MessageRow) => m.ID ?? m.id ?? 0;
const isUnread = (m: MessageRow) => m.已读 !== "1";

function fmtTime(v?: string): string {
  if (!v) return "-";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function MessageBell() {
  const [open, setOpen] = useState(false);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const countQuery = useQuery({
    queryKey: ["messages-unread-count"],
    queryFn: () => messagesApi.unreadCount(),
    refetchInterval: 60_000,
  });
  const unread = countQuery.data?.count ?? 0;

  const listQuery = useQuery({
    queryKey: ["messages-panel", onlyUnread],
    queryFn: () => messagesApi.list(1, 20, onlyUnread),
    enabled: open,
  });

  const readMutation = useMutation({
    mutationFn: (id: number) => messagesApi.markRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["messages-unread-count"] });
      queryClient.invalidateQueries({ queryKey: ["messages-panel"] });
    },
  });

  // 点外部 / Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const items = listQuery.data?.items ?? [];

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        title="消息"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
          open
            ? "bg-[#16a34a]/10 text-[#15803d]"
            : "text-[#5f6b7d] hover:bg-black/5 hover:text-[#3d4a5c]",
        )}
      >
        <Bell className="h-5 w-5" weight={open ? "fill" : "regular"} />
        {unread > 0 && (
          <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#dc2626] px-1 text-[10px] font-semibold text-[#ffffff]">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute top-11 right-0 z-50 flex max-h-[70vh] w-[380px] flex-col overflow-hidden rounded-xl border border-[#e3eae4] bg-white shadow-[0_12px_32px_-8px_rgb(26_35_48/0.18)]">
          {/* 头部 */}
          <div className="flex shrink-0 items-center gap-2 border-b border-[#e3eae4] px-4 py-3">
            <span className="text-[15px] font-semibold text-[#1a2330]">消息</span>
            {unread > 0 && (
              <span className="rounded-full bg-[#16a34a]/10 px-2 py-0.5 text-xs font-semibold text-[#15803d]">
                未读 {unread} 条
              </span>
            )}
            <button
              type="button"
              onClick={() => setOnlyUnread((v) => !v)}
              className="ml-auto rounded-lg px-2 py-1 text-xs font-medium text-[#5f6b7d] transition-colors hover:bg-black/5 hover:text-[#15803d]"
            >
              {onlyUnread ? "查看全部" : "只看未读"}
            </button>
          </div>

          {/* 列表 */}
          <div className="min-h-0 flex-1 overflow-auto">
            {listQuery.isLoading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-14 animate-pulse rounded-lg bg-black/5" />
                ))}
              </div>
            ) : listQuery.isError ? (
              <div className="px-4 py-10 text-center text-sm text-[#dc2626]">
                消息加载失败
                <button
                  type="button"
                  className="mt-2 block w-full text-[#15803d]"
                  onClick={() => listQuery.refetch()}
                >
                  重试
                </button>
              </div>
            ) : items.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <Checks className="mx-auto mb-2 h-6 w-6 text-disabled" />
                <div className="text-sm text-[#5f6b7d]">
                  {onlyUnread ? "没有未读消息" : "暂无消息"}
                </div>
              </div>
            ) : (
              items.map((m) => {
                const un = isUnread(m);
                return (
                  <button
                    key={rowId(m)}
                    type="button"
                    onClick={() => un && readMutation.mutate(rowId(m))}
                    className="flex w-full items-start gap-2.5 border-b border-black/6 px-4 py-3 text-left transition-colors last:border-0 hover:bg-black/[0.03]"
                  >
                    <span
                      className={cn(
                        "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                        un ? "bg-[#16a34a]" : "bg-black/15",
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span
                          className={cn(
                            "truncate text-sm",
                            un ? "font-semibold text-[#1a2330]" : "text-[#3d4a5c]",
                          )}
                        >
                          {m.标题 || "(无标题)"}
                        </span>
                        {m.类型 && (
                          <span className="shrink-0 rounded-full bg-black/6 px-2 py-0.5 text-[11px] text-[#5f6b7d]">
                            {m.类型}
                          </span>
                        )}
                      </span>
                      {m.内容 && (
                        <span className="mt-0.5 line-clamp-2 block text-[13px] leading-snug text-[#5f6b7d]">
                          {m.内容}
                        </span>
                      )}
                      <span className="mt-1 block text-xs text-disabled tabular-nums">
                        {fmtTime(m.创建时间)}
                        {m.单号 ? ` · ${m.单号}` : ""}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {/* 底部:跳消息中心页(Task 11) */}
          <div className="shrink-0 border-t border-[#e3eae4] px-4 py-2.5">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                navigate("/messages");
              }}
              className="w-full rounded-lg py-1.5 text-center text-sm font-medium text-[#15803d] transition-colors hover:bg-[#16a34a]/8"
            >
              查看全部
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
