// 货号接单汇总表页:场景对照老系统 web/src/pages/production/OrderSummaryPage.tsx
// (关键字查询,货号点击/行双击跳 BOM物料设置 打开该货号,无权访问)。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router";
import { useEffect } from "react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import OrderSummaryPage from "@/pages/OrderSummaryPage";

type Call = { url: string; method: string };

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

const PERMS_FULL = [{ 组: "业务单据", 菜单: "生产制单", 打开: true }];

const ROWS = [
  { 货号: "K001", 款式: "毛绒熊", 接单数量: 1200, 订单数: 3 },
  { 货号: "K002", 款式: "塑料车", 接单数量: 500, 订单数: 1 },
];

function installFetch(perms: unknown = PERMS_FULL, rows: unknown = ROWS) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET" });
      const p = new URL(url, "http://test").pathname;
      if (p.endsWith("/me/permissions")) return json(permRowsToMap(perms));
      if (p === "/api/production-reports/order-summary") return json(rows);
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
        <Route path="/order-summary" element={<OrderSummaryPage />} />
        <Route path="/bom-setup" element={<div>BOM设置页STUB</div>} />
      </Routes>
    </>,
    "/order-summary",
  );
  return calls;
};

const waitList = () => waitFor(() => expect(screen.getByText("K001")).toBeInTheDocument());

beforeEach(() => {
  lastLoc = "";
  localStorage.setItem("web2.user", "tester");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("货号接单汇总表", () => {
  it("渲染行:货号/款式/接单数量/订单数", async () => {
    setup();
    await waitList();
    expect(screen.getByText("毛绒熊")).toBeInTheDocument();
    expect(screen.getByText("1200")).toBeInTheDocument();
    expect(screen.getByText("共 2 条")).toBeInTheDocument();
  });

  it("查询:关键字进入查询参数", async () => {
    const calls = setup();
    await waitList();
    fireEvent.change(screen.getByLabelText("关键字"), { target: { value: "K001" } });
    fireEvent.click(screen.getByText("查询"));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.includes("/api/production-reports/order-summary?keyword=K001")),
      ).toBe(true),
    );
  });

  it("点货号跳 BOM物料设置 打开该货号", async () => {
    setup();
    await waitList();
    fireEvent.click(screen.getByText("K001"));
    await waitFor(() => expect(lastLoc).toBe("/bom-setup?款号=K001"));
  });

  it("双击行同样跳 BOM物料设置", async () => {
    setup();
    await waitList();
    fireEvent.doubleClick(screen.getByText("K002"));
    await waitFor(() => expect(lastLoc).toBe("/bom-setup?款号=K002"));
  });

  it("无 打开 权限:显示无权访问", async () => {
    setup([]);
    await waitFor(() =>
      expect(screen.getByText("无权访问 货号接单汇总表")).toBeInTheDocument(),
    );
  });
});
