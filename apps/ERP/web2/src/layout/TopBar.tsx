import { useEffect, useState } from "react";
import { CaretDown, House, Key, MagnifyingGlass, SignOut, UsersThree } from "@phosphor-icons/react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MENU_TREE } from "@/nav/menu";
import { getUser, logout } from "@/lib/auth";
import { authApi } from "@/api/endpoints";
import { usePerms } from "@/hooks/usePerms";
import { MessageBell } from "./MessageBell";
import { MyPermissionsDialog } from "./MyPermissionsDialog";
import { OnlineBadge } from "./OnlineBadge";

// Ctrl+K 命令面板(浅色弹层,shadcn 变量在 future 作用域已覆盖)。
function Palette({
  open,
  onOpenChange,
  onNavigate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onNavigate: (path: string) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="搜索菜单..." />
      <CommandList>
        <CommandEmpty>没有匹配的菜单项</CommandEmpty>
        {MENU_TREE.map((g) => (
          <CommandGroup key={g.key} heading={g.label}>
            {g.children.map((leaf) => (
              <CommandItem
                key={g.key + leaf.label}
                value={`${g.label} ${leaf.label}`}
                disabled={!leaf.path}
                className="h-11 text-[15px]"
                onSelect={() => {
                  if (!leaf.path) return;
                  // http 开头 = 外部系统入口,新标签打开
                  if (leaf.path.startsWith("http")) {
                    window.open(leaf.path, "_blank", "noopener,noreferrer");
                  } else {
                    onNavigate(leaf.path);
                  }
                  onOpenChange(false);
                }}
              >
                <span className={leaf.path ? "" : "text-[#5f6b7d]"}>{leaf.label}</span>
                {!leaf.path && <span className="ml-auto text-xs text-disabled">未开放</span>}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}

// 顶栏:品牌(点 logo 回宫格首页)+ 首页按钮、加宽搜索、
// 消息铃铛(真实未读数 + 下拉消息面板)、用户菜单。
export function TopBar({
  paletteOpen,
  onPaletteChange,
  onNavigate,
  onHome,
}: {
  paletteOpen: boolean;
  onPaletteChange: (v: boolean) => void;
  onNavigate: (path: string) => void;
  onHome: () => void;
}) {
  const user = getUser() || "未登录";
  const { can } = usePerms();
  const [myPermsOpen, setMyPermsOpen] = useState(false);

  return (
    <header className="relative z-10 flex h-14 shrink-0 items-center gap-3 border-b border-black/8 bg-black/[0.03] px-5 backdrop-blur-md">
      <button
        type="button"
        onClick={onHome}
        title="回到首页"
        className="flex h-10 items-center gap-2.5 rounded-lg px-2 transition-colors hover:bg-black/5"
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#16a34a] shadow-[inset_0_1px_0_rgb(255_255_255/0.35)]">
          <span className="text-xs font-bold text-[#ffffff]">W</span>
        </div>
        <div className="leading-tight">
          <div className="text-left text-sm font-semibold text-[#1a2330]">WebpageERP</div>
          <div className="f-label">生产管理系统</div>
        </div>
      </button>
      <button
        type="button"
        onClick={onHome}
        className="flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium text-[#3d4a5c] transition-colors hover:bg-black/5 hover:text-[#15803d]"
      >
        <House className="h-4.5 w-4.5" />
        首页
      </button>
      <button
        type="button"
        onClick={() => onPaletteChange(true)}
        className="flex h-10 w-72 items-center gap-2.5 rounded-lg border border-black/10 bg-black/[0.04] px-3.5 text-sm text-[#5f6b7d] transition-colors hover:border-black/20 hover:text-[#3d4a5c]"
      >
        <MagnifyingGlass className="h-4.5 w-4.5" />
        <span className="flex-1 text-left">搜索菜单...</span>
        <kbd className="rounded-md border border-black/10 bg-black/5 px-1.5 py-0.5 text-[11px] font-medium text-[#5f6b7d]">
          Ctrl K
        </kbd>
      </button>

      <div className="flex-1" />

      <MessageBell />

      <OnlineBadge onNavigate={onNavigate} />

      <DropdownMenu>
        <DropdownMenuTrigger className="flex h-10 items-center gap-2.5 rounded-lg px-2.5 transition-colors hover:bg-black/5">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#16a34a] text-xs font-bold text-[#ffffff]">
            {user.slice(0, 1).toUpperCase()}
          </span>
          <span className="text-sm font-medium text-[#3d4a5c]">{user}</span>
          <CaretDown className="h-3.5 w-3.5 text-[#5f6b7d]" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel className="text-xs text-[#5f6b7d]">
            当前账号:{user}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="h-10 text-sm" onSelect={() => setMyPermsOpen(true)}>
            <Key className="mr-2 h-4.5 w-4.5" />
            我的权限
          </DropdownMenuItem>
          {can("账号管理", "打开") && (
            <DropdownMenuItem className="h-10 text-sm" onSelect={() => onNavigate("/accounts")}>
              <UsersThree className="mr-2 h-4.5 w-4.5" />
              账号权限管理
            </DropdownMenuItem>
          )}
          {can("账号管理", "打开") && (
            <DropdownMenuItem className="h-10 text-sm" onSelect={() => onNavigate("/online-users")}>
              <UsersThree className="mr-2 h-4.5 w-4.5" />
              在线人员
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="h-10 text-sm"
            onSelect={() => {
              void authApi.logout().catch(() => {});
              logout();
              location.assign(`${import.meta.env.BASE_URL}login`);
            }}
          >
            <SignOut className="mr-2 h-4.5 w-4.5" />
            退出登录
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <MyPermissionsDialog open={myPermsOpen} onClose={() => setMyPermsOpen(false)} />

      <Palette
        open={paletteOpen}
        onOpenChange={onPaletteChange}
        onNavigate={onNavigate}
      />
    </header>
  );
}
