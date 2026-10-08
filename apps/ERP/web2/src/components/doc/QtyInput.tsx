// 用量输入框:支持分数写法(1/6、1/2 = 一张料出 N 个;兼容中文输入法的全角 1／2),失焦时解析入库值;
// 未聚焦显示 formatQty(整数/分数优先),非法输入失焦后回退显示原值。
import { useState, type CSSProperties } from "react";
import { formatQty, parseQtyInput } from "@/lib/fraction";

export function QtyInput({
  value,
  onChange,
  ariaLabel,
  disabled,
  className,
  style,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  // 聚焦时的自由编辑串;null=未聚焦(显示格式化值)
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      aria-label={ariaLabel}
      type="text"
      inputMode="decimal"
      className={className ?? "f-input f-input-slim"}
      style={style ?? { width: "5.5rem" }}
      disabled={disabled}
      value={text ?? formatQty(value)}
      onFocus={() => setText(formatQty(value))}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const t = text;
        setText(null);
        if (t == null) return;
        if (t.trim() === "") {
          if (value !== undefined) onChange(undefined);
          return;
        }
        const n = parseQtyInput(t);
        if (n === undefined) return; // 非法输入:不改值,显示回退
        if (n !== value) onChange(n);
      }}
    />
  );
}
