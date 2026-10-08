// 宽表冻结列·全局管理器(table[data-freeze]):钉注入/冻结套用/取消/持久化/React 重渲染后重套/手工版跳过。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTableFreeze } from "@/lib/tableFreeze";

const tick = () => new Promise((r) => setTimeout(r, 0));

function makeTable(html = ""): HTMLTableElement {
  document.body.innerHTML =
    html ||
    `<div class="overflow-auto"><table data-freeze class="w-full min-w-[1200px]">
      <thead><tr><th>货号</th><th>品名</th><th>状态</th></tr></thead>
      <tbody><tr><td>A1</td><td>公仔</td><td>在排</td></tr></tbody>
    </table></div>`;
  return document.querySelector("table")!;
}

const ths = (t: HTMLTableElement) => Array.from(t.tHead!.rows[0].cells) as HTMLElement[];
const tds = (t: HTMLTableElement) => Array.from(t.tBodies[0].rows[0].cells) as HTMLElement[];
const pins = (t: HTMLTableElement) => t.querySelectorAll<HTMLButtonElement>("button.fz-pin");

describe("tableFreeze 全局管理器", () => {
  let stop: (() => void) | undefined;
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    stop?.();
    stop = undefined;
    document.body.innerHTML = "";
    localStorage.clear();
  });

  it("启动后表头每列注入冻结钉(aria-label 冻结到 X 列),不冻结时不设 sticky", async () => {
    const t = makeTable();
    stop = startTableFreeze();
    await tick();
    expect(pins(t)).toHaveLength(3);
    expect(pins(t)[1].getAttribute("aria-label")).toBe("冻结到 品名 列");
    expect(ths(t)[0].style.position).not.toBe("sticky");
  });

  it("点第 2 列钉:前 2 列 sticky+fz 类+边界分隔,第 3 列不冻,选择持久化", async () => {
    const t = makeTable();
    stop = startTableFreeze();
    await tick();
    pins(t)[1].click();
    await tick();
    for (const el of [ths(t)[0], ths(t)[1], tds(t)[0], tds(t)[1]])
      expect(el.style.position).toBe("sticky");
    expect(ths(t)[2].style.position).not.toBe("sticky");
    expect(tds(t)[2].style.position).not.toBe("sticky");
    expect(tds(t)[1].classList.contains("fz-bd")).toBe(true);
    expect(tds(t)[0].classList.contains("fz-bd")).toBe(false);
    expect(tds(t)[0].classList.contains("fz-td")).toBe(true);
    expect(ths(t)[0].classList.contains("fz-th")).toBe(true);
    expect(pins(t)[1].classList.contains("fz-pin-on")).toBe(true);
    const key = Object.keys(localStorage).find((k) => k.startsWith("web2.freeze."))!;
    expect(localStorage.getItem(key)).toBe("2");
    // 再点边界列 = 取消
    pins(t)[1].click();
    await tick();
    expect(ths(t)[0].style.position).not.toBe("sticky");
    expect(localStorage.getItem(key)).toBe("0");
  });

  it("持久化:localStorage 已有计数,新表挂载即按计数冻结", async () => {
    // 先冻一次拿到 key
    let t = makeTable();
    stop = startTableFreeze();
    await tick();
    pins(t)[0].click();
    await tick();
    stop();
    document.body.innerHTML = "";
    // 重新挂载同形表(同 key)→ 自动冻结第 1 列
    t = makeTable();
    stop = startTableFreeze();
    await tick();
    expect(ths(t)[0].style.position).toBe("sticky");
    expect(ths(t)[1].style.position).not.toBe("sticky");
  });

  it("React 重渲染(替换 tbody)后,冻结样式自动重套到新单元格", async () => {
    const t = makeTable();
    stop = startTableFreeze();
    await tick();
    pins(t)[1].click();
    await tick();
    // 模拟 React 用新数据重建 tbody 行
    t.tBodies[0].innerHTML = "<tr><td>B2</td><td>新车</td><td>已走货</td></tr>";
    await tick();
    await tick();
    const cells = tds(t);
    expect(cells[0].textContent).toBe("B2");
    expect(cells[0].style.position).toBe("sticky");
    expect(cells[1].style.position).toBe("sticky");
    expect(cells[2].style.position).not.toBe("sticky");
  });

  it("colSpan>1 的格(展开详情/空态)不冻结", async () => {
    const t = makeTable(
      `<table data-freeze class="min-w-[1200px]">
        <thead><tr><th>货号</th><th>品名</th><th>状态</th></tr></thead>
        <tbody>
          <tr><td>A1</td><td>公仔</td><td>在排</td></tr>
          <tr><td colspan="3">展开详情</td></tr>
        </tbody>
      </table>`,
    );
    stop = startTableFreeze();
    await tick();
    pins(t)[0].click();
    await tick();
    const detail = t.tBodies[0].rows[1].cells[0] as HTMLElement;
    expect(detail.style.position).not.toBe("sticky");
  });

  it("已手工接线的表(表头已有冻结钉)不接管、不重复注入", async () => {
    const t = makeTable(
      `<table data-freeze class="min-w-[1200px]">
        <thead><tr><th>货号<button aria-label="冻结到 货号 列">📌</button></th><th>品名</th></tr></thead>
        <tbody><tr><td>A1</td><td>公仔</td></tr></tbody>
      </table>`,
    );
    stop = startTableFreeze();
    await tick();
    expect(pins(t)).toHaveLength(0);
  });

  it("运行时插入的新表(innerHTML)也会被 body 级观察器接管", async () => {
    stop = startTableFreeze();
    await tick();
    makeTable();
    await tick();
    expect(pins(document.querySelector("table")!).length).toBe(3);
  });
});
