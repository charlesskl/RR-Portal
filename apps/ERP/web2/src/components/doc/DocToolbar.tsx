import { useLocation } from "react-router";
import type { Icon } from "@phosphor-icons/react";
import { usePerms } from "@/hooks/usePerms";
import { MENU_TREE } from "@/nav/menu";
import { cn } from "@/lib/utils";

// 单据操作按钮定义。perm 对应 9 个权限功能位(与后端 MenuPermRow 字段同名),
// 声明后由 DocToolbar 按当前用户权限过滤:无权限的按钮不渲染。
export interface DocAction {
  key: string;
  label: string;
  icon?: Icon;
  perm?: "打开" | "保存" | "删除" | "打印" | "单价" | "金额" | "审核" | "反审核" | "功能";
  primary?: boolean; // 实心绿主操作
  danger?: boolean; // 红字危险操作
  disabled?: boolean;
  // 禁用时 hover 提示的状态原因(如「先打开单据」「单据已审核」);不传则不显示 title
  disabledTitle?: string;
  onClick: () => void;
  success?: boolean; // 绿字正向操作(扩展位,需求书签名之外的可选项)
}

// 由当前路由推导权限菜单名:菜单树叶子 label 即 MenuPermRow.菜单
function menuKeyForPath(path: string): string {
  for (const g of MENU_TREE) {
    for (const leaf of g.children) {
      if (leaf.path === path) return leaf.label;
    }
  }
  return "";
}

function toneClass(a: DocAction): string {
  if (a.danger) return "text-[#dc2626]";
  if (a.success) return "text-[#059669]";
  if (a.primary) return "text-[#15803d]";
  return "text-[#3d4a5c]";
}

// 单个操作按钮:白底灰绿描边;主操作(primary 且可用)实心绿
function ActionButton({ action }: { action: DocAction }) {
  const icon = action.icon ? <action.icon className="h-5 w-5" /> : null;
  if (action.primary && !action.disabled) {
    return (
      <button type="button" onClick={action.onClick} className="f-btn f-btn-cyan">
        {icon}
        {action.label}
      </button>
    );
  }
  return (
    <button
      type="button"
      disabled={action.disabled}
      title={action.disabled ? action.disabledTitle : undefined}
      onClick={action.onClick}
      className={cn("f-btn", toneClass(action))}
    >
      {icon}
      {action.label}
    </button>
  );
}

// 单据操作栏:按 actions 顺序渲染按钮,声明了 perm 的动作先做权限过滤。
// menuKey 默认取当前路由对应的菜单名,也可显式传入。
export function DocToolbar({
  actions,
  menuKey,
}: {
  actions: DocAction[];
  menuKey?: string;
}) {
  const { pathname } = useLocation();
  const { can } = usePerms();
  const mk = menuKey ?? menuKeyForPath(pathname);
  const visible = actions.filter((a) => can(mk, a.perm));
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {visible.map((a) => (
        <ActionButton key={a.key} action={a} />
      ))}
    </div>
  );
}
