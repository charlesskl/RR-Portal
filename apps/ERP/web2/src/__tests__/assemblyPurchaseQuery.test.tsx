// 装配采购查询页:场景对照老系统 web/src/pages/assembly/AssemblyPurchaseQueryPage.tsx
// (汇总/明细双页签,日期/收货仓库/审核情况筛选,双击跳装配加工采购单,导出/打印,无权访问)。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router";
import { useEffect } from "react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import AssemblyPurchaseQueryPage from "@/pages/AssemblyPurchaseQueryPage";

// SearchSelect 下拉选择:点触发钮 → 点选项(portal 到 body)
const pickOption = (label: string, option: string) => {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(screen.getByRole("option", { name: option }));
};

type Call = { url: string; method: string };

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

const PERMS_FULL = [{ 组: "基础资料", 菜单: "款号资料", 打开: true }];

const SUMMARY = [
  {
    单号: "ZP20260905001", 收货仓库: "成品仓", 产品货号: "DS2609", 配件编号: "PT-1",
    产品装配名称: "恐龙套装", 装配方式: "包装(已装箱)", 生产单号: "MO-1", 加工数量: 1000,
  },
];
const DETAIL = [
  {
    开单日期: "2026-09-05", 单号: "ZP20260905001", 完成日期: "2026-09-20", 收货仓库: "成品仓",
    供应商编号: "SUP-1", 供应商名称: "龙昌加工厂", 产品货号: "DS2609", 配件编号: "PT-1",
    产品装配名称: "恐龙套装", 装配方式: "包装(已装箱)", 生产单号: "MO-1", 货币: "HK$",
    数量: 1000, 备注: "赶货", 审核: "1",
  },
];

function installFetch(perms: unknown = PERMS_FULL) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET" });
      const p = new URL(url, "http://test").pathname;
      if (p.endsWith("/me/permissions")) return json(permRowsToMap(perms));
      if (p === "/api/assembly-purchase-query/summary") return json(SUMMARY);
      if (p === "/api/assembly-purchase-query/detail") return json(DETAIL);
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

const setup = (perms?: unknown) => {
  const calls = installFetch(perms);
  renderWithProviders(
    <>
      <Probe />
      <Routes>
        <Route path="/assembly-purchase-query" element={<AssemblyPurchaseQueryPage />} />
        <Route path="/assembly-purchases" element={<div>装配加工采购单STUB</div>} />
      </Routes>
    </>,
    "/assembly-purchase-query",
  );
  return calls;
};

const waitSummary = () => waitFor(() => expect(screen.getByText("恐龙套装")).toBeInTheDocument());

beforeEach(() => {
  lastLoc = "";
  localStorage.setItem("web2.user", "tester");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("装配采购查询", () => {
  it("默认汇总页签渲染,带本月起止参数", async () => {
    const calls = setup();
    await waitSummary();
    expect(screen.getByText("包装(已装箱)")).toBeInTheDocument();
    expect(screen.getByText("共查询到记录数:1")).toBeInTheDocument();
    const hit = calls.find((c) => c.url.includes("/api/assembly-purchase-query/summary?"));
    expect(hit?.url).toContain("%E8%B5%B7=20"); // 起=2026-..
  });

  it("切明细页签查明细接口,审核列映射 已审核", async () => {
    const calls = setup();
    await waitSummary();
    fireEvent.click(screen.getByText("明细查询"));
    await waitFor(() => expect(screen.getByText("龙昌加工厂")).toBeInTheDocument());
    expect(calls.some((c) => c.url.includes("/api/assembly-purchase-query/detail?"))).toBe(true);
    const table = screen.getByRole("table");
    expect(within(table).getByText("已审核")).toBeInTheDocument();
  });

  it("收货仓库/审核情况/关键字进查询参数", async () => {
    const calls = setup();
    await waitSummary();
    pickOption("收货仓库", "半成品仓");
    pickOption("审核情况", "已审核");
    fireEvent.change(screen.getByLabelText("关键字"), { target: { value: "DS2609" } });
    fireEvent.click(screen.getByText("查询"));
    await waitFor(() => {
      const hit = calls.find(
        (c) => c.url.includes("keyword=DS2609") && c.url.includes("summary"),
      );
      expect(hit?.url).toContain("%E6%94%B6%E8%B4%A7%E4%BB%93%E5%BA%93=%E5%8D%8A%E6%88%90%E5%93%81%E4%BB%93");
      expect(hit?.url).toContain("%E5%AE%A1%E6%A0%B8%E6%83%85%E5%86%B5=%E5%B7%B2%E5%AE%A1%E6%A0%B8");
    });
  });

  it("双击行跳装配加工采购单整单", async () => {
    setup();
    await waitSummary();
    fireEvent.doubleClick(screen.getByText("恐龙套装"));
    await waitFor(() =>
      expect(lastLoc).toBe("/assembly-purchases?单号=ZP20260905001"),
    );
  });

  it("无 打开 权限:显示无权访问", async () => {
    setup([]);
    await waitFor(() =>
      expect(screen.getByText("无权访问 装配采购查询")).toBeInTheDocument(),
    );
  });
});
