// 装配物料跟踪表页:场景对照老系统 web/src/pages/assembly/AssemblyMaterialTrackingPage.tsx
// (截止统计/收货仓库/日期区间筛选,双击跳装配加工采购单,无权访问)。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router";
import { useEffect } from "react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import AssemblyMaterialTrackingPage from "@/pages/AssemblyMaterialTrackingPage";

// SearchSelect 下拉选择:点触发钮 → 点选项(portal 到 body)
const pickOption = (label: string, option: string) => {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(screen.getByRole("option", { name: option }));
};

type Call = { url: string; method: string };

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

const PERMS_FULL = [{ 组: "基础资料", 菜单: "款号资料", 打开: true }];

const ROWS = [
  {
    订购日期: "2026-09-05", 订单单号: "ZP 12/3", 收货仓库: "半成品仓",
    加工厂编号: "F01", 加工厂名称: "龙昌加工厂", 产品货号: "DS2609", 产品名称: "恐龙",
    配件编号: "PT-1", 产品装配名称: "恐龙套装", 装配方式: "组装半成品", 生产单号: "MO-1",
    物料编号: "MAT-1", 物料名称: "彩盒", 规格: "S", 材料: "纸品", 颜色: "白", 单位: "盒",
    单件用量: 1, 加工数量: 1000, 需求数量: 1000, 已入仓数量: 400, 未入仓数量: 600, 审核: "1",
  },
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
      if (p === "/api/assembly-purchase-query/tracking") return json(rows);
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
        <Route path="/assembly-material-tracking" element={<AssemblyMaterialTrackingPage />} />
        <Route path="/assembly-purchases" element={<div>装配加工采购单STUB</div>} />
      </Routes>
    </>,
    "/assembly-material-tracking",
  );
  return calls;
};

const waitList = () => waitFor(() => expect(screen.getByText("恐龙套装")).toBeInTheDocument());

beforeEach(() => {
  lastLoc = "";
  localStorage.setItem("web2.user", "tester");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("装配物料跟踪表", () => {
  it("渲染行:订单单号/加工厂/物料/数量列;审核=1 显示已审核", async () => {
    setup();
    await waitList();
    expect(screen.getByText("ZP 12/3")).toBeInTheDocument();
    expect(screen.getByText("彩盒")).toBeInTheDocument();
    // 1,000 同时落 加工数量/需求数量 两列,断言用 getAllByText
    expect(screen.getAllByText("1,000").length).toBeGreaterThan(0);
    const table = screen.getByRole("table");
    expect(within(table).getByText("已审核")).toBeInTheDocument();
    expect(screen.getByText("共 1 条")).toBeInTheDocument();
  });

  it("按第二日期截止统计勾选后 截止统计=true 下发", async () => {
    const calls = setup();
    await waitList();
    fireEvent.click(screen.getByLabelText("按第二日期截止统计"));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.includes("%E6%88%AA%E6%AD%A2%E7%BB%9F%E8%AE%A1=true")),
      ).toBe(true),
    );
  });

  it("收货仓库筛选进查询参数;全部不下发", async () => {
    const calls = setup();
    await waitList();
    // 默认 全部:不下发 收货仓库
    const first = calls.find((c) => c.url.includes("/tracking?"));
    expect(first?.url).not.toContain("%E6%94%B6%E8%B4%A7%E4%BB%93%E5%BA%93=");
    pickOption("收货仓库", "半成品仓");
    await waitFor(() =>
      expect(
        calls.some((c) =>
          c.url.includes("%E6%94%B6%E8%B4%A7%E4%BB%93%E5%BA%93=%E5%8D%8A%E6%88%90%E5%93%81%E4%BB%93"),
        ),
      ).toBe(true),
    );
  });

  it("双击行跳装配加工采购单整单(单号编码)", async () => {
    setup();
    await waitList();
    fireEvent.doubleClick(screen.getByText("恐龙套装"));
    await waitFor(() => expect(lastLoc).toBe("/assembly-purchases?单号=ZP%2012%2F3"));
  });

  it("无 打开 权限:显示无权访问", async () => {
    setup([]);
    await waitFor(() =>
      expect(screen.getByText("无权访问 装配物料跟踪表")).toBeInTheDocument(),
    );
  });
});
