// BOM货号查询页:场景对照老系统 web/src/pages/production/BomStyleQueryPage.tsx;
// 打印契约纯函数(printStyleQuery)另有 printStyleQuery.test.ts 覆盖。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router";
import { useEffect } from "react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import BomStyleQueryPage from "@/pages/BomStyleQueryPage";

type Call = { url: string; method: string };

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

const PERMS_FULL = [{ 组: "业务单据", 菜单: "生产制单", 打开: true, 单价: true }];

const ROWS = [
  { 款号: "K001", 款式: "毛绒熊", 单价: 12.5, 物料项数: 2, 审核: "1", 明细: [] },
  { 款号: "K002", 款式: "塑料车", 单价: null, 物料项数: 0, 审核: "0", 明细: [] },
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
      if (p === "/api/production-reports/bom-styles") return json(rows);
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
        <Route path="/bom-style-query" element={<BomStyleQueryPage />} />
        <Route path="/bom-setup" element={<div>BOM设置页STUB</div>} />
      </Routes>
    </>,
    "/bom-style-query",
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

describe("BOM货号查询", () => {
  it("渲染行:款号/款式/单价/物料项数", async () => {
    setup();
    await waitList();
    expect(screen.getByText("毛绒熊")).toBeInTheDocument();
    expect(screen.getByText("12.5")).toBeInTheDocument();
    expect(screen.getByText("共 2 条")).toBeInTheDocument();
  });

  it("查询:关键字进入查询参数", async () => {
    const calls = setup();
    await waitList();
    fireEvent.change(screen.getByLabelText("关键字"), { target: { value: "K001" } });
    fireEvent.click(screen.getByText("查询"));
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes("/api/production-reports/bom-styles?keyword=K001"))).toBe(true),
    );
  });

  it("点款号跳 BOM物料设置 打开该货号", async () => {
    setup();
    await waitList();
    fireEvent.click(screen.getByText("K001"));
    await waitFor(() => expect(lastLoc).toBe("/bom-setup?款号=K001"));
  });

  it("无 单价 权限位:单价列不渲染", async () => {
    setup([{ 组: "业务单据", 菜单: "生产制单", 打开: true, 单价: false }]);
    await waitList();
    expect(screen.queryByText("单价")).not.toBeInTheDocument();
    expect(screen.queryByText("12.5")).not.toBeInTheDocument();
  });

  it("无 打开 权限:显示无权访问", async () => {
    setup([]);
    await waitFor(() => expect(screen.getByText("无权访问 BOM货号查询")).toBeInTheDocument());
  });

  it("打印:按当前行集调 printStyleQuery(开窗写 HTML)", async () => {
    setup();
    await waitList();
    const opened: { html: string }[] = [];
    const fakeWin = {
      document: {
        write: (h: string) => opened.push({ html: h }),
        close: () => {},
      },
      focus: () => {},
      print: () => {},
    };
    vi.stubGlobal("open", vi.fn(() => fakeWin));
    fireEvent.click(screen.getByText("打印"));
    expect(opened).toHaveLength(1);
    expect(opened[0].html).toContain("货 号 资 料 查 询");
    expect(opened[0].html).toContain("K001");
  });
});
