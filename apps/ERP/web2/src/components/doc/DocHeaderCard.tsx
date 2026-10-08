import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// 单头字段:caps 小灰标签 + 大字值;mono 用等宽数字字体,strong 为特大号关键字段
export interface HeaderField {
  label: string;
  value: ReactNode;
  mono?: boolean;
  strong?: boolean;
}

function Field({ label, value, mono, strong }: HeaderField) {
  return (
    <div className="min-w-0">
      <div className="f-label">{label}</div>
      <div
        className={cn(
          "mt-1.5 truncate",
          mono && "f-mono",
          strong
            ? "text-[22px] leading-7 font-bold text-[#1a2330]"
            : "text-[16px] font-medium text-[#1a2330]",
        )}
        title={typeof value === "string" ? value : undefined}
      >
        {value}
      </div>
    </div>
  );
}

// 单头玻璃卡:主字段栅格 + 可折叠的扩展字段区(extra 存在时渲染展开/收起按钮)
export function DocHeaderCard({
  fields,
  extra,
}: {
  fields: HeaderField[];
  extra?: HeaderField[];
}) {
  const [showMore, setShowMore] = useState(false);
  return (
    <div className="f-panel p-6">
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-3 lg:grid-cols-5">
        {fields.map((f) => (
          <Field key={f.label} {...f} />
        ))}
      </div>
      {extra && extra.length > 0 && showMore && (
        <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-black/8 pt-5 md:grid-cols-3 lg:grid-cols-5">
          {extra.map((f) => (
            <Field key={f.label} {...f} />
          ))}
        </div>
      )}
      {extra && extra.length > 0 && (
        <button
          type="button"
          onClick={() => setShowMore((v) => !v)}
          className="mt-5 flex h-10 items-center rounded-lg px-2 text-sm font-medium text-[#15803d] transition-colors hover:bg-[#16a34a]/10"
        >
          {showMore ? "收起更多字段" : "展开更多字段"}
        </button>
      )}
    </div>
  );
}
