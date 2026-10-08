import { useState } from "react";

// 首进自动打开最新一单(查看态):渲染期 setState 引用比对模式。
// 新 data 引用到达且当前未开单时执行一次 open(firstNo);
// 同一 data 引用不重复触发(用户关掉单据回到列表后不会被重新顶开)。
// 原为 6 个单据页逐字复制,Batch 0E 收敛为 hook,行为不变。
export function useFirstDoc<TData>(
  data: TData | undefined,
  firstNo: string | undefined,
  canOpen: boolean,
  open: (no: string) => void,
): void {
  const [seen, setSeen] = useState<TData | undefined>(undefined);
  if (canOpen && firstNo && data !== seen) {
    setSeen(data);
    open(firstNo);
  }
}
