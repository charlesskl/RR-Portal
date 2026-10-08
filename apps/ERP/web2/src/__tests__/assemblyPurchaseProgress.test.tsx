// 装配采购进度表页:场景对照老系统 web/src/pages/assembly/AssemblyPurchaseProgressPage.tsx
// (数据源=采购查询明细映射进度行,默认不选择日期走宽区间,到货情况/3天内交货客户端过滤,
// 双击跳装配加工采购单,无权访问)。映射/过滤纯函数另由 assemblyReports.test.ts 覆盖。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router";
import { useEffect } from "react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import AssemblyPurchaseProgressPage from "@/pages/AssemblyPurchaseProgressPage";

// SearchSelect 下拉选择:点触发钮 → 点选项(portal 到 body)
const pickOption = (label: string, option: string) => {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(screen.getByRole("option", { name: option }));
};

type Call = { url: string; method: string };

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

const PERMS_FULL = [{ 组: "基础资料", 菜单: "款号资料", 打开: true }];

const DETAIL = [
  { 开单日期: "2026-09-05", 单号: "ZP001", 完成日期: "2026-09-20", 供应商名称: "龙昌加工厂", 产品装配名称: "恐龙套装", 数量: 1000, 货币: "HK$", 生产单号: "MO-1" },
  { 开单日期: "2026-09-06", 单号: "ZP002", 完成日期: "2026-09-21", 供应商名称: "永恒加工厂", 产品装配名称: "塑料车套装", 数量: 0, 货币: "RMB", 生产单号: "MO-2" },
];

function installFetch(perms: unknown = PERMS_FULL, rows: unknown = DETAIL) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET" });
      const p = new URL(url, "http://test").pathname;
      if (p.endsWith("/me/permissions")) return json(permRowsToMap(perms));
      if (p === "/api/assembly-purchase-query/detail") return json(rows);
      return json({ 消息: `unhandled ${p}` }, 404);
    }),
  );
  return calls;
}

let lastLoc = "";
function Probe() {
  const l = useLocation();
  useEffect(() => {
    lastLoc = l.pathname + l.search;
  }, [l]);
  return null;
}

const setup = (perms?: unknown, rows?: unknown) => {
  const calls = installFetch(perms, rows);
  renderWithProviders(
    <>
      <Probe />
      <Routes>
        <Route path="/assembly-purchase-progress" element={<AssemblyPurchaseProgressPage />} />
        <Route path="/assembly-purchases" element={<div>装配加工采购单STUB</div>} />
      </Routes>
    </>,
    "/assembly-purchase-progress",
  );
  return calls;
};

beforeEach(() => {
  lastLoc = "";
  localStorage.setItem("web2.user", "tester");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("装配采购进度表", () => {
  it("默认不选择日期:宽区间 2000-01-01 起;默认到货情况=未到 只显示欠数行", async () => {
    const calls = setup();
    // 恐龙套装 同时落 产品名称/产品装配名称 两列(照抄老系统映射),断言用 getAllByText
    await waitFor(() => expect(screen.getAllByText("恐龙套装").length).toBeGreaterThan(0));
    const hit = calls.find((c) => c.url.includes("/api/assembly-purchase-query/detail?"));
    expect(hit?.url).toContain("%E8%B5%B7=2000-01-01");
    // ZP002 数量 0 → 已到,默认(未到)过滤掉
    expect(screen.queryByText("塑料车套装")).not.toBeInTheDocument();
    expect(screen.getByText("共 1 条,双击行打开装配加工单")).toBeInTheDocument();
  });

  it("到货情况=全部:两行都显示", async () => {
    setup();
    await waitFor(() => expect(screen.getAllByText("恐龙套装").length).toBeGreaterThan(0));
    pickOption("到货情况", "全部");
    await waitFor(() => expect(screen.getAllByText("塑料车套装").length).toBeGreaterThan(0));
    expect(screen.getByText("共 2 条,双击行打开装配加工单")).toBeInTheDocument();
  });

  it("点 本月 启用订购日期区间并带起止参数", async () => {
    const calls = setup();
    await waitFor(() => expect(screen.getAllByText("恐龙套装").length).toBeGreaterThan(0));
    calls.length = 0;
    fireEvent.click(screen.getByText("本月"));
    await waitFor(() => {
      const hit = calls.find((c) => c.url.includes("/api/assembly-purchase-query/detail?"));
      expect(hit?.url).not.toContain("2000-01-01");
      expect(hit?.url).toContain("%E8%B5%B7=20");
    });
    expect(screen.getByLabelText("起")).not.toBeDisabled();
  });

  it("双击行跳装配加工采购单整单", async () => {
    setup();
    await waitFor(() => expect(screen.getAllByText("恐龙套装").length).toBeGreaterThan(0));
    fireEvent.doubleClick(screen.getAllByText("恐龙套装")[0]);
    await waitFor(() => expect(lastLoc).toBe("/assembly-purchases?单号=ZP001"));
  });

  it("无 打开 权限:显示无权访问", async () => {
    setup([]);
    await waitFor(() =>
      expect(screen.getByText("无权访问 装配采购进度表")).toBeInTheDocument(),
    );
  });
});
