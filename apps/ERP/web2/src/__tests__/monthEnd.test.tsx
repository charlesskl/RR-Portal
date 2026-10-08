// 库存月报表页:对照老系统 web/src/pages/warehouse/MonthEnd.tsx +
// web/src/__tests__/monthEnd.test.ts(dimColumns/moneyColumns/toYearMonth 纯函数逐条移植)。
// 场景:已结月份行、维度列按口径切换(物料口径多金额列)、结存负数红、
// 执行月结/反月结按权限位(功能/删除)显隐、确认后 POST 载荷(年月/口径/仓库)。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import { dimColumns, moneyColumns, toYearMonth } from "@/lib/monthEnd";
import MonthEndPage from "@/pages/MonthEndPage";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (opts: { count: number; estimateSize: () => number }) => {
    const size = opts.estimateSize();
    return {
      getTotalSize: () => opts.count * size,
      getVirtualItems: () =>
        Array.from({ length: opts.count }, (_, i) => ({ index: i, start: i * size, size, key: i })),
      measure: () => {},
    };
  },
}));

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

const PERMS_FULL = [{ 组: "月结管理", 菜单: "库存月结", 打开: true, 功能: true, 删除: true }];
const PERMS_RO = [{ 组: "月结管理", 菜单: "库存月结", 打开: true }];

const REPORT_FG = [
  { 年月: "202608", 仓库: "成品仓", 口径: "成品", 款号: "DS2609", 色号: "01", 颜色: "红", 尺码: "均码", 期初: 10, 本期入: 5, 本期出: 3, 结存: 12 },
  { 年月: "202608", 仓库: "成品仓", 口径: "成品", 款号: "DS2608", 色号: "02", 颜色: "蓝", 尺码: "均码", 期初: 2, 本期入: 0, 本期出: 5, 结存: -3 },
];
const REPORT_MAT = [
  { 年月: "202608", 仓库: "来料仓", 口径: "物料", 物料编号: "M-001", 物料名称: "布料", 规格: "S", 单位: "米", 期初: 100, 本期入: 20, 本期出: 30, 结存: 90, 加权单价: 2.5, 期初金额: 250, 本期入金额: 50, 本期出金额: 75, 结存金额: 225 },
];

type Call = { url: string; method: string; body?: string };

function installFetch(perms: unknown = PERMS_FULL) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET", body: init?.body as string | undefined });
      const u = new URL(url, "http://test");
      const p = u.pathname;
      if (p.endsWith("/me/permissions")) return json(permRowsToMap(perms));
      if (p === "/api/month-end/periods") return json(["202607", "202608"]);
      if (p === "/api/month-end")
        return json(u.searchParams.get("口径") === "物料" ? REPORT_MAT : REPORT_FG);
      if (p === "/api/month-end/close") return json({ 结数: 2, 仓库: ["成品仓"] });
      if (p === "/api/month-end/reopen") return json({ 删数: 2 });
      return json({ 消息: `unhandled ${p}` }, 404);
    }),
  );
  return calls;
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("web2.user", "tester");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ---------- 纯函数(对照 web/src/__tests__/monthEnd.test.ts) ----------

describe("月结工具", () => {
  it("dimColumns 按口径切换维度列", () => {
    const fg = dimColumns("成品").map((c) => c.key);
    expect(fg).toContain("款号");
    expect(fg).not.toContain("物料编号");
    const sf = dimColumns("半成品").map((c) => c.key);
    expect(sf).toContain("物料编号");
    expect(sf).not.toContain("款号");
    const mat = dimColumns("物料").map((c) => c.key);
    expect(mat).toContain("物料编号");
    expect(mat).toContain("单位");
    expect(mat).not.toContain("款号");
    expect(mat).not.toContain("颜色");
  });
  it("toYearMonth 月份输入(YYYY-MM)转 yyyyMM,非法/空回空串", () => {
    expect(toYearMonth("2026-06")).toBe("202606");
    expect(toYearMonth("2026-01")).toBe("202601");
    expect(toYearMonth("")).toBe("");
    expect(toYearMonth(null)).toBe("");
    expect(toYearMonth("202608")).toBe("");
  });
  it("moneyColumns 仅物料口径有金额列", () => {
    const m = moneyColumns("物料").map((c) => c.key);
    expect(m).toContain("加权单价");
    expect(m).toContain("结存金额");
    expect(moneyColumns("成品")).toHaveLength(0);
    expect(moneyColumns("半成品")).toHaveLength(0);
  });
});

// ---------- 页面 ----------

describe("MonthEndPage", () => {
  it("渲染已结月份 + 成品口径报表行;结存负数红色", async () => {
    installFetch();
    renderWithProviders(<MonthEndPage />, "/month-end");
    await screen.findByText("DS2609");
    expect(screen.getByText(/已结月份:202607、202608/)).toBeInTheDocument();
    const neg = screen.getByText("-3");
    expect(neg.className).toContain("text-[#dc2626]");
    // 成品口径无金额列
    expect(screen.queryByText("加权单价")).not.toBeInTheDocument();
  });

  it("切物料口径:多 5 个金额列,请求带 口径=物料", async () => {
    const calls = installFetch();
    renderWithProviders(<MonthEndPage />, "/month-end");
    await screen.findByText("DS2609");
    fireEvent.click(screen.getByLabelText("口径"));
    fireEvent.click(screen.getByRole("option", { name: "物料" }));
    await screen.findByText("M-001");
    expect(screen.getByText("加权单价")).toBeInTheDocument();
    expect(screen.getByText("结存金额")).toBeInTheDocument();
    expect(screen.getByText("225")).toBeInTheDocument();
    expect(
      calls.some((c) => new URL(c.url, "http://test").searchParams.get("口径") === "物料"),
    ).toBe(true);
  });

  it("执行月结:确认弹窗后 POST close(年月/口径),提示 结数", async () => {
    const calls = installFetch();
    renderWithProviders(<MonthEndPage />, "/month-end");
    await screen.findByText("DS2609");
    fireEvent.change(screen.getByLabelText("月份"), { target: { value: "2026-08" } });
    fireEvent.click(screen.getByRole("button", { name: /执行月结/ }));
    await screen.findByText(/确认月结 202608 成品\?/);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "执行月结" }));
    await waitFor(() => {
      const post = calls.find((c) => c.url === "/api/month-end/close" && c.method === "POST");
      expect(post).toBeTruthy();
      expect(JSON.parse(post!.body!)).toMatchObject({ 年月: "202608", 口径: "成品" });
    });
    await screen.findByText(/月结完成:仓库 1 个,明细 2 行/);
  });

  it("反月结:POST reopen 提示删除行数", async () => {
    const calls = installFetch();
    renderWithProviders(<MonthEndPage />, "/month-end");
    await screen.findByText("DS2609");
    fireEvent.click(screen.getByRole("button", { name: /反月结/ }));
    await screen.findByText(/确认反月结/);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "反月结" }));
    await waitFor(() => {
      expect(calls.some((c) => c.url === "/api/month-end/reopen" && c.method === "POST")).toBe(true);
    });
    await screen.findByText(/反月结完成:删除 2 行/);
  });

  it("无 功能/删除 位:不渲染 执行月结/反月结(只读查看)", async () => {
    installFetch(PERMS_RO);
    renderWithProviders(<MonthEndPage />, "/month-end");
    await screen.findByText("DS2609");
    expect(screen.queryByRole("button", { name: /执行月结/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /反月结/ })).not.toBeInTheDocument();
  });

  it("仓库筛选进请求参数", async () => {
    const calls = installFetch();
    renderWithProviders(<MonthEndPage />, "/month-end");
    await screen.findByText("DS2609");
    fireEvent.change(screen.getByLabelText("仓库(空=全部)"), { target: { value: "成品仓" } });
    await waitFor(() => {
      expect(
        calls.some(
          (c) =>
            c.url.startsWith("/api/month-end?") &&
            new URL(c.url, "http://test").searchParams.get("仓库") === "成品仓",
        ),
      ).toBe(true);
    });
  });
});
