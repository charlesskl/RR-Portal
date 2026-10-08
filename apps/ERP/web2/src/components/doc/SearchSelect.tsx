import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CaretDown, Check, MagnifyingGlass } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

export interface SearchSelectOption {
  value: string;
  label: string;
}

// 选项超过 8 个才显示搜索框;小列表直接键盘 ↑↓/Enter 选择
export const SEARCHABLE_MIN = 8;

// 可搜索下拉(替代原生 select):选项多时原生只能向下无限拉长、超屏;
// 本组件固定高度+内部滚动+打字过滤(选项 ≤8 隐藏搜索框),下方空间不足自动向上展开,
// Esc/点外部关闭;全系统表单/筛选下拉统一用它。
export function SearchSelect({
  ariaLabel,
  value,
  options,
  placeholder = "请选择",
  clearLabel,
  disabled,
  className,
  style,
  onChange,
}: {
  ariaLabel: string;
  value: string; // 当前值(""=未选)
  options: SearchSelectOption[];
  placeholder?: string;
  clearLabel?: string; // 传了才显示「清空/可选」行
  disabled?: boolean;
  className?: string; // 触发钮附加类
  style?: React.CSSProperties; // 触发钮内联样式(如 ch 宽)
  onChange: (v: string) => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // 打开时触发钮的视口位置:外部滚动后比对,锚点没动=伪滚动事件,不关
  const anchorRef = useRef<{ top: number; left: number } | null>(null);
  const [open, setOpen] = useState(false);
  const [kw, setKw] = useState("");
  const [hi, setHi] = useState(0);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; width: number } | null>(null);

  const searchable = options.length > SEARCHABLE_MIN;
  const current = options.find((o) => o.value === value);
  const filtered = options.filter(
    (o) =>
      !kw.trim() ||
      o.label.toLowerCase().includes(kw.trim().toLowerCase()) ||
      o.value.toLowerCase().includes(kw.trim().toLowerCase()),
  );
  // 列表项:未输入关键字时带清空行 + 过滤结果
  const items: SearchSelectOption[] =
    clearLabel && !kw.trim() ? [{ value: "", label: clearLabel }, ...filtered] : filtered;

  const openDrop = () => {
    if (disabled) return;
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    anchorRef.current = { top: r.top, left: r.left };
    const dropH = 280;
    const up = window.innerHeight - r.bottom < dropH && r.top > dropH;
    setPos({
      left: r.left,
      width: Math.max(r.width, 200),
      ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
    });
    setKw("");
    setHi(0);
    setOpen(true);
  };

  const choose = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi((h) => Math.min(h + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (items[hi]) choose(items[hi].value);
    }
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest?.("[data-searchselect]")) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // capture 阶段先拦截:radix 弹窗在 document bubble 阶段也听 Esc,不能连带关弹窗
        e.stopPropagation();
        setOpen(false);
      }
    };
    const onScroll = (e: Event) => {
      // 下拉列表内部滚动(鼠标滚轮)不关闭
      if ((e.target as HTMLElement | null)?.closest?.("[data-searchselect]")) return;
      // 锚点未移动的滚动事件是伪滚动(如聚焦引发的容器滚动、布局抖动),不关闭;
      // 触发钮真被滚动了才关闭(否则浮层会和触发钮脱节)
      const a = anchorRef.current;
      const r = btnRef.current?.getBoundingClientRect();
      if (a && r && Math.abs(r.top - a.top) < 1 && Math.abs(r.left - a.left) < 1) return;
      setOpen(false);
    };
    const onResize = () => setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  // radix 模态弹窗在 document 监听 focusin(焦点陷阱)/pointerdown(外部点按关闭),
  // 且锁 body 指针事件;下拉 portal 在弹窗 DOM 之外,React 合成事件 stopPropagation
  // 挡不住 document 级原生监听,必须在浮层根上挂原生拦截(指针事件由 CSS pointer-events-auto 解封)
  useEffect(() => {
    const root = rootRef.current;
    if (!open || !root) return;
    const stop = (e: Event) => e.stopPropagation();
    // 用户点击搜索框/选项时,浏览器默认动作会把焦点移进下拉;
    // radix FocusScope 的 focusout 监听会把焦点拽回弹窗(relatedTarget 在容器外)。
    // 默认动作执行前先把弹窗内焦点 blur 掉(relatedTarget=null 提前返回),焦点才留得住
    const blurFirst = (e: Event) => {
      const ae = document.activeElement as HTMLElement | null;
      if (ae && e.target !== ae && !root.contains(ae)) ae.blur();
    };
    root.addEventListener("focusin", stop);
    root.addEventListener("pointerdown", stop);
    root.addEventListener("mousedown", blurFirst);
    root.addEventListener("mousedown", stop);
    return () => {
      root.removeEventListener("focusin", stop);
      root.removeEventListener("pointerdown", stop);
      root.removeEventListener("mousedown", blurFirst);
      root.removeEventListener("mousedown", stop);
    };
  }, [open]);

  // 打开后聚焦(搜索框/列表容器吃键盘事件);必须排在上面的屏蔽监听挂上之后。
  // radix FocusScope 在 document 听 focusout:若原焦点(触发钮)在弹窗内、新焦点在下拉里,
  // relatedTarget 不在容器内 → 焦点被拽回弹窗。所以先把当前焦点 blur 掉(relatedTarget=null 提前返回),
  // 再聚焦目标;随后的 focusin 由浮层根上的原生拦截挡在 document 之外
  const blurThenFocus = (target: HTMLElement | null) => {
    if (!target) return;
    const ae = document.activeElement as HTMLElement | null;
    if (ae && ae !== target && !rootRef.current?.contains(ae)) ae.blur();
    target.focus();
  };
  useEffect(() => {
    if (!open) return;
    blurThenFocus(searchable ? inputRef.current : rootRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, searchable]);

  // 高亮项保持可见
  useEffect(() => {
    if (open) listRef.current?.querySelector<HTMLElement>('[data-hi="1"]')?.scrollIntoView?.({ block: "nearest" });
  }, [hi, open]);

  return (
    <div className="relative" data-searchselect>
      <button
        ref={btnRef}
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        disabled={disabled}
        className={cn("f-input f-input-slim flex w-full items-center justify-between gap-2 text-left", className)}
        style={style}
        onClick={() => (open ? setOpen(false) : openDrop())}
      >
        <span className={cn("truncate", current ? "text-[#1a2330]" : "text-disabled")}>
          {current?.label ?? placeholder}
        </span>
        <CaretDown className="h-4 w-4 shrink-0 text-[#5f6b7d]" />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={rootRef}
            data-searchselect
            role="listbox"
            aria-label={ariaLabel}
            tabIndex={-1}
            // pointer-events-auto:radix 模态弹窗锁 body 指针事件,浮层自身解封
            className="pointer-events-auto fixed z-50 overflow-hidden rounded-lg border border-black/10 bg-white shadow-[0_12px_32px_-8px_rgb(26_35_48/0.28)] outline-none"
            style={pos}
            onKeyDown={searchable ? undefined : onListKeyDown}
          >
            {searchable && (
              <div className="flex items-center gap-1.5 border-b border-black/8 px-2.5 py-2">
                <MagnifyingGlass className="h-4 w-4 shrink-0 text-[#5f6b7d]" />
                <input
                  ref={inputRef}
                  aria-label={`${ariaLabel}搜索`}
                  className="w-full bg-transparent text-sm outline-none placeholder:text-disabled"
                  placeholder="输入关键字过滤"
                  value={kw}
                  onChange={(e) => {
                    setKw(e.target.value);
                    setHi(0);
                  }}
                  onKeyDown={onListKeyDown}
                />
              </div>
            )}
            <div ref={listRef} className="max-h-56 overflow-auto overscroll-contain py-1">
              {items.length === 0 && (
                <div className="px-3 py-3 text-sm text-disabled">无匹配项</div>
              )}
              {items.map((o, idx) => (
                <div
                  key={o.value || "__empty__"}
                  role="option"
                  aria-selected={o.value === value}
                  data-hi={idx === hi ? 1 : 0}
                  className={cn(
                    "flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-sm",
                    idx === hi ? "bg-black/[0.06]" : "hover:bg-black/[0.04]",
                    o.value === value && "font-medium text-[#15803d]",
                  )}
                  onMouseEnter={() => setHi(idx)}
                  onClick={() => choose(o.value)}
                >
                  <span className="truncate">{o.label}</span>
                  {o.value === value && <Check className="h-4 w-4 shrink-0" />}
                </div>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
