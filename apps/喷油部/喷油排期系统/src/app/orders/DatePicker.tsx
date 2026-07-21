// src/app/orders/DatePicker.tsx
// 弹出式日历日期框（替代浏览器原生 date）：年/月切换，选中日经典蓝实心圆。
// value/onChange 使用 'YYYY-MM-DD' 字符串；空串表示未选。
"use client";
import { useState, useRef, useEffect } from "react";

const pad = (n: number) => String(n).padStart(2, "0");
const WD = ["日", "一", "二", "三", "四", "五", "六"];

export default function DatePicker({
  value, onChange, placeholder,
}: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const today = new Date();
  const [open, setOpen] = useState(false);
  const [vy, setVy] = useState(today.getFullYear());
  const [vm, setVm] = useState(today.getMonth());
  const ref = useRef<HTMLDivElement>(null);

  // 点组件外部关闭
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, []);

  function toggle() {
    if (!open) {
      const b = value ? value.split("-").map(Number) : null;
      setVy(b ? b[0] : today.getFullYear());
      setVm(b ? b[1] - 1 : today.getMonth());
    }
    setOpen((o) => !o);
  }
  function nav(delta: number) {
    const total = vy * 12 + vm + delta;
    setVy(Math.floor(total / 12));
    setVm(((total % 12) + 12) % 12);
  }
  function pick(ds: string) { onChange(ds); setOpen(false); }

  // 构造日历格
  const startDow = new Date(vy, vm, 1).getDay();
  const dim = new Date(vy, vm + 1, 0).getDate();
  const prevDim = new Date(vy, vm, 0).getDate();
  const tStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const cells: { key: string; label: number; ds?: string; other?: boolean }[] = [];
  for (let i = 0; i < startDow; i++) cells.push({ key: `p${i}`, label: prevDim - startDow + 1 + i, other: true });
  for (let d = 1; d <= dim; d++) cells.push({ key: `d${d}`, label: d, ds: `${vy}-${pad(vm + 1)}-${pad(d)}` });
  const trail = (7 - (cells.length % 7)) % 7;
  for (let i = 1; i <= trail; i++) cells.push({ key: `n${i}`, label: i, other: true });

  return (
    <div ref={ref} className="relative inline-block">
      <input
        readOnly value={value} placeholder={placeholder} onClick={toggle}
        className="w-32 h-[34px] border border-app-border rounded-btn px-2 text-sm cursor-pointer bg-white focus:outline-none focus:border-mint-400"
      />
      {open && (
        <div className="absolute z-50 mt-1 w-[276px] bg-white border border-app-border rounded-card shadow-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="cursor-pointer text-text-secondary px-2 hover:text-[#2563EB]" onClick={() => nav(-12)}>«</span>
            <span className="cursor-pointer text-text-secondary px-2 hover:text-[#2563EB]" onClick={() => nav(-1)}>‹</span>
            <span className="font-semibold text-sm">{vy} 年 {vm + 1} 月</span>
            <span className="cursor-pointer text-text-secondary px-2 hover:text-[#2563EB]" onClick={() => nav(1)}>›</span>
            <span className="cursor-pointer text-text-secondary px-2 hover:text-[#2563EB]" onClick={() => nav(12)}>»</span>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center mb-1">
            {WD.map((w) => <span key={w} className="text-xs text-text-tertiary py-1">{w}</span>)}
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center">
            {cells.map((c) =>
              c.other ? (
                <span key={c.key} className="h-8 flex items-center justify-center text-sm text-[#ccc]">{c.label}</span>
              ) : (
                <span key={c.key}
                  onClick={() => pick(c.ds!)}
                  className={`h-8 w-8 mx-auto flex items-center justify-center rounded-full text-sm cursor-pointer ${
                    c.ds === value ? "bg-[#2563EB] text-white"
                    : c.ds === tStr ? "text-[#2563EB] font-bold hover:bg-[#E1ECF7]"
                    : "text-text hover:bg-[#E1ECF7]"
                  }`}>{c.label}</span>
              )
            )}
          </div>
          <div className="text-right mt-2">
            <span className="text-xs text-text-tertiary cursor-pointer hover:text-rose" onClick={() => pick("")}>清除</span>
          </div>
        </div>
      )}
    </div>
  );
}
