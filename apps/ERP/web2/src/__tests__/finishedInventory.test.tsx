// 成品库存页:对照老系统 web/src/pages/warehouse/FinishedInventoryPage.tsx。
// 列表(默认成品仓)/仓库关键字查询/点配件编号开出入库流水弹窗(结存按序累计 入-出,负红)/无权限态。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import FinishedInventoryPage from "@/pages/FinishedInventoryPage";

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

const PERMS_FULL = [{ 组: "成品仓储", 菜单: "成品库存", 打开: true }];

const STOCK = [
  { 配件编号: "AAA0001", 客户: "ZURU", 产品货号: "9215A", 产品名称: "恐龙", 产品装配名称: "彩盒", 库存数量: 8 },
  { 配件编号: "AAA0002", 客户: "B ", 产品货号: "9215B", 产品名称: "飞机", 产品装配名称: "胶袋", 库存数量: -3 },
];

const LEDGER = [
  { 日期: "2026-09-01", 单号: "FR1", 类型: "成品入仓", 入库数量: 10, 出库数量: 0 },
  { 日期: "2026-09-02", 单号: "FI1", 类型: "成品出仓", 入库数量: 0, 出库数量: 2 },
];

type Call = { url: string; method: string };

function installFetch(perms: unknown = PERMS_FULL) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET" });
      const u = new URL(url, "http://test");
      const p = u.pathname;
      if (p.endsWith("/me/permissions")) return json(permRowsToMap(perms));
      if (p === "/api/finished-inventory/ledger") return json(LEDGER);
      if (p === "/api/finished-inventory") return json(STOCK);
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

describe("FinishedInventoryPage", () => {
  it("默认成品仓列表渲染:客户/货号/库存数量(负数红)", async () => {
    const calls = installFetch();
    renderWithProviders(<FinishedInventoryPage />, "/finished-inventory");
    await screen.findByText("AAA0001");
    expect(
      calls.some((c) => c.url.includes("/api/finished-inventory?") && decodeURIComponent(c.url).includes("仓库=成品仓")),
    ).toBe(true);
    expect(screen.getByText("9215A")).toBeInTheDocument();
    expect(screen.getByText("查询记录:2")).toBeInTheDocument();
    expect(screen.getByText("-3").className).toContain("#dc2626");
  });

  it("仓库关键字查询:按输入仓库重新拉取", async () => {
    const calls = installFetch();
    renderWithProviders(<FinishedInventoryPage />, "/finished-inventory");
    await screen.findByText("AAA0001");
    fireEvent.change(screen.getByLabelText("仓库"), { target: { value: "样板仓" } });
    fireEvent.click(screen.getByRole("button", { name: /查询/ }));
    await waitFor(() =>
      expect(
        calls.some((c) => decodeURIComponent(c.url).includes("仓库=样板仓")),
      ).toBe(true),
    );
  });

  it("点配件编号开出入库流水:结存按序累计(10-2=8)", async () => {
    installFetch();
    renderWithProviders(<FinishedInventoryPage />, "/finished-inventory");
    fireEvent.click(await screen.findByText("AAA0001"));
    const dlg = await screen.findByRole("dialog");
    await waitFor(() => expect(dlg).toHaveTextContent("成品入仓"));
    expect(dlg).toHaveTextContent("出入库流水 - AAA0001(成品仓)");
    expect(dlg).toHaveTextContent("FR1");
    expect(dlg).toHaveTextContent("FI1");
    // 结存累计:第一行 10,第二行 8
    const cells = Array.from(dlg.querySelectorAll("tbody tr td:last-child")).map((td) => td.textContent);
    expect(cells).toEqual(["10", "8"]);
  });

  it("无「打开」位:无权访问提示", async () => {
    installFetch([{ 组: "成品仓储", 菜单: "成品库存" }]);
    renderWithProviders(<FinishedInventoryPage />, "/finished-inventory");
    await screen.findByText("无权访问该页面");
  });
});
