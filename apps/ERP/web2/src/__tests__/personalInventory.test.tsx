// 个人库存金额表页:按下单人汇总(剩余批次 FIFO 归属)/双击汇总行筛选该人批次明细/范围切换带查询参数。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import PersonalInventoryPage from "@/pages/PersonalInventoryPage";

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

const ROWS = [
  {
    范围: "来料", 下单人: "张三", 入仓单号: "PIRK2", 订单单号: "POT-PI1", 日期: "2026-02-01",
    仓库: "来料仓", 物料编号: "PI-M1", 物料名称: "面料一", 规格: "规格A", 颜色: null,
    单位: "米", 批次数量: 50, 剩余数量: 30, 单价: 2.5, 金额: 75,
  },
  {
    范围: "塑胶", 下单人: "张三", 入仓单号: "SJRK1", 订单单号: "SP01", 日期: "2026-03-01",
    仓库: "塑胶仓", 物料编号: "PI-M9", 物料名称: "胶件九", 规格: null, 颜色: "红",
    单位: "个", 批次数量: 20, 剩余数量: 20, 单价: 1, 金额: 20,
  },
  {
    范围: "来料", 下单人: "期初结余", 入仓单号: null, 订单单号: null, 日期: null,
    仓库: null, 物料编号: "PI-M2", 物料名称: "面料二", 规格: "规格B", 颜色: null,
    单位: "米", 批次数量: 10, 剩余数量: 10, 单价: 5, 金额: 50,
  },
];

const PERMS_FULL = [{ 组: "来料仓", 菜单: "个人库存金额表", 打开: true, 单价: true, 金额: true }];

type Call = { url: string; method: string };

function installFetch() {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method });
      const u = new URL(url, "http://test");
      if (u.pathname.endsWith("/me/permissions")) return json(permRowsToMap(PERMS_FULL));
      if (u.pathname === "/api/personal-inventory") return json(ROWS);
      return json({ 消息: `unhandled ${method} ${u.pathname}` }, 404);
    }),
  );
  return calls;
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PersonalInventoryPage", () => {
  it("汇总:按下单人分组合计金额,期初结余单独成行", async () => {
    installFetch();
    renderWithProviders(<PersonalInventoryPage />, "/personal-inventory");
    // 汇总行:张三 3 行→2 批次 95 元;期初结余 50 元
    await waitFor(() => expect(screen.getByText("张三")).toBeInTheDocument());
    expect(screen.getByText("期初结余")).toBeInTheDocument();
    expect(screen.getByText("95")).toBeInTheDocument();
    // 统计卡:涉及人数 2、剩余批次数 3
    expect(screen.getByText("涉及人数")).toBeInTheDocument();
    expect(screen.getByText("剩余批次数")).toBeInTheDocument();
  });

  it("双击汇总行:批次明细只显示该人;清除筛选恢复全部", async () => {
    installFetch();
    renderWithProviders(<PersonalInventoryPage />, "/personal-inventory");
    await waitFor(() => expect(screen.getByText("张三")).toBeInTheDocument());
    fireEvent.doubleClick(screen.getByText("张三"));
    await waitFor(() => expect(screen.getByText("清除筛选")).toBeInTheDocument());
    // 张三的明细:面料一/胶件九在,面料二(期初结余)被过滤
    expect(screen.getByText("面料一")).toBeInTheDocument();
    expect(screen.getByText("胶件九")).toBeInTheDocument();
    expect(screen.queryByText("面料二")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("清除筛选"));
    await waitFor(() => expect(screen.getByText("面料二")).toBeInTheDocument());
  });

  it("范围切换:点「塑胶」请求带 范围=塑胶 参数", async () => {
    const calls = installFetch();
    renderWithProviders(<PersonalInventoryPage />, "/personal-inventory");
    await waitFor(() => expect(screen.getByText("张三")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "塑胶" }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.includes("/api/personal-inventory") && c.url.includes("%E8%83%B6")),
      ).toBe(true),
    );
    // 半成品页签同样带参
    fireEvent.click(screen.getByRole("button", { name: "半成品" }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes("%E5%8D%8A%E6%88%90%E5%93%81"))).toBe(true),
    );
  });
});
