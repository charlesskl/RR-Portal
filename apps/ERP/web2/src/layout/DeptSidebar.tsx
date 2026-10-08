import { useState } from "react";
import { CaretLeft, CaretRight, SquaresFour } from "@phosphor-icons/react";
import { MENU_TREE } from "@/nav/menu";
import { cn } from "@/lib/utils";

const COLLAPSE_KEY = "web2.deptCollapsed";

// 部门窄侧栏(所有页面保留):只列部门。
// 在任意页面点部门 = 回宫格首页并只显示该部门的卡片(标签页保留);
// 「全部」显示所有部门分组(默认选中)。长部门名省略号截断 + title 提示。
// 可折叠:收起后变成 56px 图标窄轨(只显示部门图标,点击仍可选部门),
// 折叠状态写 localStorage,刷新后保持。
export function DeptSidebar({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (key: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSE_KEY) === "1",
  );
  const toggle = () =>
    setCollapsed((v) => {
      localStorage.setItem(COLLAPSE_KEY, v ? "0" : "1");
      return !v;
    });

  return (
    <aside
      className={cn(
        "relative z-10 flex h-full shrink-0 flex-col border-r border-black/7 bg-black/[0.03] transition-[width] duration-200",
        collapsed ? "w-14" : "w-[168px]",
      )}
    >
      {/* 顶部:标签 + 折叠/展开开关 */}
      <div
        className={cn(
          "flex items-center pt-3 pb-2",
          collapsed ? "justify-center px-1" : "justify-between px-3",
        )}
      >
        {!collapsed && <span className="f-label">部门</span>}
        <button
          type="button"
          onClick={toggle}
          title={collapsed ? "展开部门栏" : "收起部门栏"}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-[#15803d] transition-colors hover:bg-[#16a34a]/10"
        >
          {collapsed ? (
            <CaretRight className="h-4 w-4" weight="bold" />
          ) : (
            <CaretLeft className="h-4 w-4" weight="bold" />
          )}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-3">
        <div className="space-y-1 rounded-xl border border-[#e3eae4] bg-white p-1.5 shadow-[0_1px_2px_rgb(26_35_48/0.05)]">
          <DeptItem
            icon={<SquaresFour className="h-5 w-5" weight="duotone" />}
            label="全部"
            active={selected === "all"}
            collapsed={collapsed}
            onClick={() => onSelect("all")}
          />
          {MENU_TREE.map((g) => {
            const Icon = g.icon;
            return (
              <DeptItem
                key={g.key}
                icon={<Icon className="h-5 w-5" weight="duotone" />}
                label={g.label}
                active={selected === g.key}
                collapsed={collapsed}
                onClick={() => onSelect(g.key)}
              />
            );
          })}
        </div>
      </nav>
    </aside>
  );
}

function DeptItem({
  icon,
  label,
  active,
  collapsed,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={cn(
        "flex h-11 w-full items-center rounded-lg border text-[15px] transition-all",
        collapsed ? "justify-center px-0" : "gap-2 px-2.5",
        active
          ? "border-[#16a34a]/50 bg-[#16a34a]/10 font-semibold text-[#15803d]"
          : "border-transparent font-medium text-[#3d4a5c] hover:border-black/10 hover:bg-black/[0.04]",
      )}
    >
      <span className={cn("shrink-0", active ? "text-[#15803d]" : "text-[#5f6b7d]")}>
        {icon}
      </span>
      {!collapsed && <span className="truncate whitespace-nowrap">{label}</span>}
    </button>
  );
}
