// 塑胶类型客户统计页:对照老系统 web/src/pages/plastics/PlasticCustomerTypeStatsPage.tsx。
// 纯函数(collectTypes/pivotCustomerType/exportCols/exportRows 透视口径)+ 页面
// (两级表头/金额位显隐/总合计行/客户关键字「查询」触发/无权访问)。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import {
  collectTypes,
  exportCols,
  exportRows,
  pivotCustomerType,
} from "@/lib/plasticCustomerType";
import PlasticCustomerTypeStatsPage from "@/pages/PlasticCustomerTypeStatsPage";

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

describe("塑胶类型客户统计·透视纯函数", () => {
  it("collectTypes:空类型归「未分类」,去重排序", () => {
    expect(
      collectTypes([
        { 客户: "A", 类型: "电镀", 数量: 1 },
        { 客户: "A", 类型: undefined, 数量: 1 },
        { 客户: "A", 类型: "印喷", 数量: 1 },
        { 客户: "A", 类型: "电镀", 数量: 1 },
      ]),
    ).toEqual(["印喷", "未分类", "电镀"].sort((a, b) => a.localeCompare(b)));
  });

  it("pivotCustomerType:客户 x 类型汇总,总数量/总金额累加,客户排序", () => {
    const pivot = pivotCustomerType([
      { 客户: "B客户", 类型: "电镀", 数量: 10, 金额: 100 },
      { 客户: "A客户", 类型: "电镀", 数量: 5, 金额: 50 },
      { 客户: "A客户", 类型: "印喷", 数量: 2, 金额: 20.55 },
    ]);
    expect(pivot.map((r) => r.客户)).toEqual(["A客户", "B客户"]);
    expect(pivot[0]).toMatchObject({ 总数量: 7, 总金额: 70.55 });
    expect(pivot[0].cells["电镀"]).toEqual({ 数量: 5, 金额: 50 });
    expect(pivot[1].cells["印喷"]).toBeUndefined();
  });

  it("exportCols/exportRows:金额位显隐;透视平铺为 类型__q/类型__a", () => {
    const types = ["电镀", "印喷"];
    const colsFull = exportCols(types, false);
    expect(colsFull.map((c) => c.title)).toEqual([
      "客户", "电镀-数量", "电镀-金额", "印喷-数量", "印喷-金额", "总数量", "总金额",
    ]);
    const colsNoAmt = exportCols(types, true);
    expect(colsNoAmt.map((c) => c.title)).toEqual(["客户", "电镀-数量", "印喷-数量", "总数量"]);
    const rows = exportRows(
      [{ 客户: "A", cells: { 电镀: { 数量: 5, 金额: 50 } }, 总数量: 5, 总金额: 50 }],
      types,
    );
    expect(rows[0]).toMatchObject({ 客户: "A", 电镀__q: 5, 电镀__a: 50, 印喷__q: 0, 总数量: 5 });
  });
});

// ---------- 页面 ----------

const STATS = [
  { 客户: "B客户", 类型: "电镀", 数量: 10, 金额: 100 },
  { 客户: "A客户", 类型: "电镀", 数量: 5, 金额: 50 },
  { 客户: "A客户", 类型: "印喷", 数量: 2, 金额: 20.5 },
];

const PERMS = [{ 组: "塑胶报表", 菜单: "塑胶类型客户统计", 打开: true, 金额: true }];
const PERMS_NO_AMT = [{ 组: "塑胶报表", 菜单: "塑胶类型客户统计", 打开: true }];

type Call = { url: string };

function installFetch(perms: unknown) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push({ url });
      const p = new URL(url, "http://test").pathname;
      if (p.endsWith("/me/permissions")) return json(permRowsToMap(perms));
      if (p === "/api/plastic-customer-type-stats") return json(STATS);
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

describe("PlasticCustomerTypeStatsPage", () => {
  it("透视表:类型两级表头 + 客户行 + 总合计行(有「金额」位出金额列)", async () => {
    installFetch(PERMS);
    renderWithProviders(<PlasticCustomerTypeStatsPage />, "/plastic-customer-type-stats");
    await screen.findByText("A客户");
    expect(screen.getByText("B客户")).toBeInTheDocument();
    expect(screen.getByText("电镀")).toBeInTheDocument();
    expect(screen.getByText("印喷")).toBeInTheDocument();
    // 金额 1 位小数
    expect(screen.getAllByText("70.5").length).toBeGreaterThan(0); // A客户 总金额 + 总合计总金额
    // 总合计:数量 17
    expect(screen.getAllByText("17").length).toBeGreaterThan(0);
    expect(screen.getByText("共 2 客户")).toBeInTheDocument();
  });

  it("无「金额」位:不出金额列(表头/数据/合计)", async () => {
    installFetch(PERMS_NO_AMT);
    renderWithProviders(<PlasticCustomerTypeStatsPage />, "/plastic-customer-type-stats");
    await screen.findByText("A客户");
    expect(screen.queryByText("本月金额")).not.toBeInTheDocument();
    expect(screen.queryByText("总金额")).not.toBeInTheDocument();
    expect(screen.getAllByText("本月数量").length).toBe(2); // 电镀/印喷 两类型各一列
  });

  it("客户关键字由「查询」触发,带 起/止/客户 参数", async () => {
    const calls = installFetch(PERMS);
    renderWithProviders(<PlasticCustomerTypeStatsPage />, "/plastic-customer-type-stats");
    await screen.findByText("A客户");
    const before = calls.filter((c) => c.url.includes("customer-type-stats?")).length;
    fireEvent.change(screen.getByLabelText("客户"), { target: { value: "A客户" } });
    expect(calls.filter((c) => c.url.includes("customer-type-stats?")).length).toBe(before);
    fireEvent.click(screen.getByRole("button", { name: /查询/ }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.url.includes("customer-type-stats?") && c.url.includes("%E5%AE%A2%E6%88%B7"),
        ),
      ).toBe(true),
    );
  });

  it("无「打开」权限:整页无权提示", async () => {
    installFetch([]);
    renderWithProviders(<PlasticCustomerTypeStatsPage />, "/plastic-customer-type-stats");
    await screen.findByText("无权访问该页面");
  });
});
