import { cn } from "@/lib/utils";

// 轻提示:右下角浮层,ok 绿 / err 红,显隐与计时由调用方控制
export function DocToast({ text, tone }: { text: string; tone: "ok" | "err" }) {
  return (
    <div
      className={cn(
        "fixed right-6 bottom-6 z-[70] rounded-xl border px-4 py-2.5 text-sm font-medium shadow-[0_12px_32px_-8px_rgb(26_35_48/0.2)]",
        tone === "ok"
          ? "border-[#16a34a]/30 bg-white text-[#15803d]"
          : "border-[#dc2626]/30 bg-white text-[#dc2626]",
      )}
    >
      {text}
    </div>
  );
}
