import { CheckCircle } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

// 大步骤条:绿色节点 + 发光连线。
// i < current 为已完成(实心绿底 + 对勾),i === current 为当前步(绿色描边高亮)。
export function FlowSteps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex items-center">
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={s} className="flex items-center">
            <div className="flex items-center gap-2.5">
              <span
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold",
                  done &&
                    "bg-[#16a34a] text-[#ffffff] shadow-[0_0_10px_-2px_rgb(22_163_74/0.6)]",
                  active &&
                    "border-2 border-[#16a34a] bg-[#16a34a]/10 text-[#15803d] shadow-[inset_0_0_8px_rgb(22_163_74/0.25)]",
                  !done && !active && "border border-black/12 bg-black/[0.03] text-disabled",
                )}
              >
                {done ? <CheckCircle className="h-4.5 w-4.5" weight="fill" /> : i + 1}
              </span>
              <span
                className={cn(
                  "text-sm",
                  active
                    ? "font-semibold text-[#1a2330]"
                    : done
                      ? "font-medium text-[#5f6b7d]"
                      : "text-disabled",
                )}
              >
                {s}
              </span>
            </div>
            {i < steps.length - 1 && (
              <span
                className={cn(
                  "mx-3.5 h-px w-12",
                  i < current
                    ? "bg-[#16a34a] shadow-[0_0_6px_rgb(22_163_74/0.5)]"
                    : "bg-black/10",
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
