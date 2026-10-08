import type { ReactNode } from "react";

// 空态:图标 + 标题 + 描述 + 可选动作按钮
export function DocEmpty({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      {icon && (
        <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-full bg-black/5 text-[#5f6b7d]">
          {icon}
        </div>
      )}
      <div className="text-sm font-medium text-[#3d4a5c]">{title}</div>
      {description && (
        <p className="max-w-xs text-sm leading-relaxed text-[#5f6b7d]">{description}</p>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
