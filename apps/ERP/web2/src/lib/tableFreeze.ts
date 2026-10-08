// 宽表冻结列·全局管理器(类 Excel 冻结窗格):给 <table data-freeze> 自动加冻结能力,页面只需在
// table 标签上加一个 data-freeze 属性,无需改列定义/单元格。
//
// 工作原理:
//  - body 级 MutationObserver 发现新挂载的 table[data-freeze] → enhance(钉按钮注入表头每列);
//  - 冻结 = 前 N 列(含点钉列)设 position:sticky,left=左侧各列累计宽(按表头 offsetWidth 实测,
//    自动布局表格列宽随内容变,ResizeObserver 监听表格尺寸重测);
//  - 冻结格加 fz-td/fz-th/fz-bd class(index.css 配不透明背景与边界分隔线),colSpan>1 的格跳过
//    (加载/空态/展开详情行不冻);
//  - React 重渲染会重建单元格 → 表级 MutationObserver 去抖后重新套用(applying 标记防自触发);
//  - 冻结选择按 路径+表宽+首列名 持久化 localStorage。
// 注:客户排期表是早期手工接线版(components 内嵌钉按钮),本管理器检测已有钉则跳过,两套可共存。
//
// 钉图标:SVG path 取自 @phosphor-icons/react dist/defs(PushPin/PushPinSlash regular)。

const PIN_PATH =
  "M235.32,81.37,174.63,20.69a16,16,0,0,0-22.63,0L98.37,74.49c-10.66-3.34-35-7.37-60.4,13.14a16,16,0,0,0-1.29,23.78L85,159.71,42.34,202.34a8,8,0,0,0,11.32,11.32L96.29,171l48.29,48.29A16,16,0,0,0,155.9,224c.38,0,.75,0,1.13,0a15.93,15.93,0,0,0,11.64-6.33c19.64-26.1,17.75-47.32,13.19-60L235.33,104A16,16,0,0,0,235.32,81.37ZM224,92.69h0l-57.27,57.46a8,8,0,0,0-1.49,9.22c9.46,18.93-1.8,38.59-9.34,48.62L48,100.08c12.08-9.74,23.64-12.31,32.48-12.31A40.13,40.13,0,0,1,96.81,91a8,8,0,0,0,9.25-1.51L163.32,32,224,92.68Z";
const UNPIN_PATH =
  "M53.92,34.62A8,8,0,1,0,42.08,45.38L67.37,73.2A69.82,69.82,0,0,0,38,87.63a16,16,0,0,0-1.29,23.78L85,159.71,42.34,202.34a8,8,0,0,0,11.32,11.32L96.29,171l48.29,48.29A16,16,0,0,0,155.9,224c.38,0,.75,0,1.13,0a15.93,15.93,0,0,0,11.64-6.33,89.75,89.75,0,0,0,11.58-20.27l21.84,24a8,8,0,1,0,11.84-10.76ZM155.9,208,48,100.08C58.23,91.83,69.2,87.72,80.66,87.81l87.16,95.88C165.59,193.56,160.24,202.23,155.9,208Zm79.42-104-44.64,44.79a8,8,0,1,1-11.33-11.3L224,92.7,163.32,32,122.1,73.35a8,8,0,0,1-11.33-11.29L152,20.7a16,16,0,0,1,22.63,0l60.69,60.68A16,16,0,0,1,235.32,104Z";

const SVG_NS = "http://www.w3.org/2000/svg";
const PIN_CLS = "fz-pin";

interface FreezeState {
  key: string;
  count: number;
  applying: boolean;
  scheduled: boolean;
}

const states = new WeakMap<HTMLTableElement, FreezeState>();

function storageKey(t: HTMLTableElement): string {
  const mw = /min-w-\[(\d+)px\]/.exec(t.className)?.[1] ?? "";
  const first = (t.tHead?.rows?.[0]?.cells?.[0]?.textContent ?? "").trim().slice(0, 8);
  return `web2.freeze.${location.pathname}:${mw}:${first}`;
}

function pinIcon(slash: boolean): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 256 256");
  svg.setAttribute("width", "13");
  svg.setAttribute("height", "13");
  const p = document.createElementNS(SVG_NS, "path");
  p.setAttribute("d", slash ? UNPIN_PATH : PIN_PATH);
  p.setAttribute("fill", "currentColor");
  svg.appendChild(p);
  return svg;
}

// 表头单元格(只取第一行;rowspan 多行头按第一行算)
function headCells(t: HTMLTableElement): HTMLTableCellElement[] {
  const r = t.tHead?.rows?.[0];
  return r ? Array.from(r.cells) : [];
}

function collectRows(t: HTMLTableElement): HTMLTableRowElement[] {
  const rows: HTMLTableRowElement[] = [];
  if (t.tHead) rows.push(...Array.from(t.tHead.rows));
  for (const tb of Array.from(t.tBodies)) rows.push(...Array.from(tb.rows));
  if (t.tFoot) rows.push(...Array.from(t.tFoot.rows));
  return rows;
}

function apply(t: HTMLTableElement, s: FreezeState): void {
  s.applying = true;
  try {
    const hs = headCells(t);
    const count = Math.min(s.count, hs.length);
    // 量左侧各列累计宽
    const lefts: number[] = [];
    let acc = 0;
    for (let i = 0; i < count; i++) {
      lefts.push(acc);
      acc += hs[i].offsetWidth;
    }
    // 钉按钮:注入缺失的;刷新激活态(边界列=绿色取消钉)
    hs.forEach((th, i) => {
      let pin = th.querySelector<HTMLButtonElement>(`:scope > .${PIN_CLS}`);
      const label = (th.textContent ?? "").trim() || `第${i + 1}列`;
      if (!pin) {
        pin = document.createElement("button");
        pin.type = "button";
        pin.className = PIN_CLS;
        pin.tabIndex = -1;
        pin.addEventListener("click", (e) => {
          e.stopPropagation();
          e.preventDefault();
          const cur = states.get(t);
          if (!cur) return;
          cur.count = cur.count === i + 1 ? 0 : i + 1;
          try {
            localStorage.setItem(cur.key, String(cur.count));
          } catch {
            /* 私密模式写不进就算了 */
          }
          scheduleApply(t);
        });
        th.appendChild(pin);
      }
      pin.setAttribute("aria-label", `冻结到 ${label} 列`);
      pin.title = count === i + 1 ? "取消冻结列" : `冻结到「${label}」列(横拉时左侧各列固定不动)`;
      pin.classList.toggle("fz-pin-on", count > 0 && i === count - 1);
      // 图标状态没变就不换 DOM(replaceChildren 会触发表级 MutationObserver,防无限回环)
      const on = count > 0 && i === count - 1 ? "1" : "0";
      if (pin.dataset.on !== on) {
        pin.dataset.on = on;
        pin.replaceChildren(pinIcon(on === "1"));
      }
    });
    // 逐行套冻结样式(colSpan>1 的格跳过)
    for (const row of collectRows(t)) {
      const isHead = row.parentElement?.tagName === "THEAD";
      let col = 0;
      for (const cell of Array.from(row.cells)) {
        const span = cell.colSpan;
        if (span === 1 && col < count) {
          cell.style.position = "sticky";
          cell.style.left = `${lefts[col]}px`;
          cell.style.zIndex = isHead ? "30" : "20";
          if (isHead) {
            cell.style.top = cell.style.top || "0";
            cell.classList.add("fz-th");
            cell.classList.remove("fz-td");
          } else {
            cell.classList.add("fz-td");
            cell.classList.remove("fz-th");
          }
          cell.classList.toggle("fz-bd", col === count - 1);
        } else if (span === 1) {
          cell.style.position = "";
          cell.style.left = "";
          cell.style.zIndex = "";
          cell.classList.remove("fz-td", "fz-th", "fz-bd");
        }
        col += span;
      }
    }
  } finally {
    s.applying = false;
  }
}

function scheduleApply(t: HTMLTableElement): void {
  const s = states.get(t);
  if (!s || s.scheduled) return;
  s.scheduled = true;
  queueMicrotask(() => {
    s.scheduled = false;
    if (t.isConnected) apply(t, s);
  });
}

function enhance(t: HTMLTableElement): void {
  if (states.has(t)) return;
  // 已有手工接线的冻结钉(客户排期表)→ 不接管
  if (t.querySelector('[aria-label^="冻结到"]')) return;
  const key = storageKey(t);
  const s: FreezeState = {
    key,
    count: Number(localStorage.getItem(key) ?? 0) || 0,
    applying: false,
    scheduled: false,
  };
  states.set(t, s);
  apply(t, s);
  // React 重渲染重建单元格 → 重新套用(只盯 childList,自身 class/style 改动不会回环)
  const mo = new MutationObserver(() => {
    if (!s.applying) scheduleApply(t);
  });
  mo.observe(t, { childList: true, subtree: true });
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => scheduleApply(t));
    ro.observe(t);
  }
}

function scan(root: ParentNode): void {
  if (root instanceof HTMLTableElement && root.hasAttribute("data-freeze")) enhance(root);
  root.querySelectorAll?.("table[data-freeze]").forEach((t) => enhance(t as HTMLTableElement));
}

// 启动全局管理器(MainLayout 挂载时调一次);返回停止函数(测试用)
export function startTableFreeze(root: ParentNode = document.body): () => void {
  scan(root);
  const mo = new MutationObserver((recs) => {
    for (const r of recs)
      r.addedNodes.forEach((n) => {
        if (n instanceof HTMLElement) scan(n);
      });
  });
  mo.observe(root, { childList: true, subtree: true });
  return () => mo.disconnect();
}
