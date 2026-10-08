// 网格单元格输入框(公共):宽度随内容;列统一宽度传 widthCh。
// 内容超过 CELL_CAP_LEN 的字段不再撑宽列——截断显示,点击(聚焦)浮层完整展示
// (portal 到 body 不被滚动容器裁剪;上方空间不足改到下方;pointer-events-none 不挡输入);
// 值被截断时悬停另有 title tooltip。宽度规则见 @/lib/cellWidth。
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CELL_CAP_CH, visualLen } from "@/lib/cellWidth";

export function CellInput({
  ariaLabel,
  value,
  onChange,
  disabled,
  placeholder,
  widthCh,
  list,
}: {
  ariaLabel: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  // 列统一宽度(ch);不传则按本行内容自适应
  widthCh?: number;
  // datalist id(下拉建议,如行级客户/货号)
  list?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [rect, setRect] = useState<{ top: number; left: number; width: number; up: boolean } | null>(null);
  // 宽度随内容(空值按 placeholder);+3 覆盖内边距与光标余量;封顶 CELL_CAP_CH
  const w = Math.min(widthCh ?? Math.max(visualLen(value || placeholder || "") + 3, 6), CELL_CAP_CH);
  return (
    <>
      <input
        ref={ref}
        aria-label={ariaLabel}
        className="f-input f-input-slim shrink-0"
        style={{ width: `${w}ch` }}
        disabled={disabled}
        placeholder={placeholder}
        list={list}
        title={value}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => {
          const el = ref.current;
          if (!el || !el.value || el.scrollWidth <= el.clientWidth + 1) return;
          const r = el.getBoundingClientRect();
          setRect({ top: r.top, left: r.left, width: r.width, up: r.top > 140 });
        }}
        onBlur={() => setRect(null)}
      />
      {rect &&
        createPortal(
          <div
            className="pointer-events-none fixed z-50 max-w-96 rounded-lg border border-black/10 bg-white px-3 py-2 text-sm break-all whitespace-pre-wrap text-[#1a2330] shadow-[0_8px_24px_-6px_rgb(26_35_48/0.25)]"
            style={{
              left: rect.left,
              width: Math.max(rect.width, 180),
              ...(rect.up ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.top + 34 }),
            }}
          >
            {value}
          </div>,
          document.body,
        )}
    </>
  );
}
