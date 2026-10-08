// 采购订单进度表页:对照老系统 web/src/pages/production/OrderProgressPage.tsx +
// web/src/__tests__/orderProgressSummary.test.ts(summarizeOrderProgress 纯函数逐条移植)。
// 场景:整单视图汇总/展开物料明细、完成情况映射、欠数红色、明细视图列、
// 只看欠数/供应商/日期区间进参数(点「查询」才发)、点单号跳采购订单整单、无权访问。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router";
import { useEffect } from "react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import { summarizeOrderProgress } from "@/lib/orderProgress";
import type { PurchaseOrderProgressRow } from "@/api/types";
import OrderProgressPage from "@/pages/OrderProgressPage";

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

const PERMS_FULL = [{ 组: "物料管理", 菜单: "采购订单", 打开: true }];

const PROGRESS: PurchaseOrderProgressRow[] = [
  { 订购日期: "2026-09-01", 交货日期: "2026-09-20", 采购单号: "PO1", 生产单号: "MO-1", 款号: "K-1", 物料编号: "M-001", 物料名称: "布料", 物料类别: "面料", 规格: "S", 颜色: "红", 单位: "米", 订购数量: 100, 入仓数量: 60, 欠数: 40, 供应商名称: "恒科", 操作员: "op1", 审核: "1" },
  { 订购日期: "2026-09-01", 交货日期: "2026-09-20", 采购单号: "PO1", 生产单号: "MO-1", 款号: "K-1", 物料编号: "M-002", 物料名称: "拉链", 物料类别: "辅料", 规格: "5#", 颜色: "黑", 单位: "条", 订购数量: 50, 入仓数量: 50, 欠数: 0, 供应商名称: "恒科", 操作员: "op1", 审核: "1" },
  { 订购日期: "2026-09-03", 交货日期: null as never, 采购单号: "PO2", 生产单号: "MO-2", 款号: "K-2", 物料编号: "M-003", 物料名称: "纽扣", 物料类别: "辅料", 规格: "", 颜色: "", 单位: "粒", 订购数量: 10, 入仓数量: 0, 欠数: 10, 供应商名称: "龙昌", 操作员: "op2", 审核: "0" },
];

type Call = { url: string; method: string };

function installFetch(perms: unknown = PERMS_FULL) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET" });
      const p = new URL(url, "http://test").pathname;
      if (p.endsWith("/me/permissions")) return json(permRowsToMap(perms));
      if (p === "/api/purchase-orders/progress") return json(PROGRESS);
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
  const calls = installFetch(perms ?? PERMS_FULL);
  renderWithProviders(
    <>
      <Probe />
      <Routes>
        <Route path="/order-progress" element={<OrderProgressPage />} />
        <Route path="/purchase-orders" element={<div>采购订单STUB</div>} />
      </Routes>
    </>,
    "/order-progress",
  );
  return calls;
};

beforeEach(() => {
  lastLoc = "";
  localStorage.clear();
  localStorage.setItem("web2.user", "tester");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ---------- 纯函数(对照 web/src/__tests__/orderProgressSummary.test.ts) ----------

describe("订单进度·整单汇总", () => {
  const line = (over: Partial<PurchaseOrderProgressRow>): PurchaseOrderProgressRow => ({
    采购单号: "PO1", 订购日期: "2026-09-01", 供应商名称: "供应商A", 审核: "1",
    订购数量: 0, 入仓数量: 0, 欠数: 0, ...over,
  });

  it("同一张订单的多行明细汇总成一行", () => {
    const rows = [
      line({ 生产单号: "MO1", 订购数量: 100, 入仓数量: 60, 欠数: 40 }),
      line({ 生产单号: "MO1", 订购数量: 50, 入仓数量: 50, 欠数: 0 }),
      line({ 采购单号: "PO2", 生产单号: "MO2", 订购数量: 10, 入仓数量: 0, 欠数: 10 }),
    ];
    const sum = summarizeOrderProgress(rows);
    expect(sum).toHaveLength(2);
    const po1 = sum.find((s) => s.采购单号 === "PO1")!;
    expect(po1.订购数量).toBe(150);
    expect(po1.入仓数量).toBe(110);
    expect(po1.欠数).toBe(40);
    expect(po1.完成情况).toBe("部分入仓");
  });

  it("完成情况:欠数=0 -> 已完成;无入仓 -> 未入仓", () => {
    const rows = [
      line({ 采购单号: "PO-DONE", 订购数量: 100, 入仓数量: 100, 欠数: 0 }),
      line({ 采购单号: "PO-NONE", 订购数量: 100, 入仓数量: 0, 欠数: 100 }),
    ];
    const sum = summarizeOrderProgress(rows);
    expect(sum.find((s) => s.采购单号 === "PO-DONE")!.完成情况).toBe("已完成");
    expect(sum.find((s) => s.采购单号 === "PO-NONE")!.完成情况).toBe("未入仓");
  });

  it("一张订单挂多个生产单号时顿号连接且去重", () => {
    const rows = [line({ 生产单号: "MO1" }), line({ 生产单号: "MO2" }), line({ 生产单号: "MO1" })];
    expect(summarizeOrderProgress(rows)[0].生产单号).toBe("MO1、MO2");
  });

  it("空输入返回空数组", () => {
    expect(summarizeOrderProgress([])).toEqual([]);
  });
});

// ---------- 页面 ----------

describe("OrderProgressPage", () => {
  it("整单视图:两行订单汇总(数量/欠数/完成情况),点行展开物料明细", async () => {
    setup();
    await screen.findByText("PO1");
    expect(screen.getByText("PO2")).toBeInTheDocument();
    expect(screen.getByText("部分入仓")).toBeInTheDocument();
    expect(screen.getByText("未入仓")).toBeInTheDocument();
    expect(screen.getByText("共 2 张订单")).toBeInTheDocument();
    // 欠数 40 红色加粗
    expect(screen.getByText("40").className).toContain("text-[#dc2626]");
    // 展开 PO1 明细:两条物料行
    fireEvent.click(screen.getByText("PO1").closest("tr")!);
    await screen.findByText("拉链");
    expect(screen.getByText("布料")).toBeInTheDocument();
    // 再点收起
    fireEvent.click(screen.getByText("PO1").closest("tr")!);
    await waitFor(() => expect(screen.queryByText("拉链")).not.toBeInTheDocument());
  });

  it("筛选默认不发新请求;点「查询」带 供应商/起止/只看欠数 参数", async () => {
    const calls = setup();
    await screen.findByText("PO1");
    const before = calls.filter((c) => c.url.includes("/progress")).length;
    fireEvent.change(screen.getByLabelText("供应商"), { target: { value: "恒科" } });
    fireEvent.change(screen.getByLabelText("起"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText("止"), { target: { value: "2026-09-30" } });
    fireEvent.click(screen.getByRole("checkbox"));
    // 未点查询前不发新请求(对照老系统:故意不随筛选自动刷新)
    expect(calls.filter((c) => c.url.includes("/progress")).length).toBe(before);
    fireEvent.click(screen.getByRole("button", { name: /查询/ }));
    await waitFor(() => {
      const hit = calls.find(
        (c) => c.url.includes("/progress?") && c.url.includes("onlyOwed=true"),
      );
      expect(hit).toBeTruthy();
      const u = new URL(hit!.url, "http://test");
      expect(u.searchParams.get("供应商")).toBe("恒科");
      expect(u.searchParams.get("起")).toBe("2026-09-01");
      expect(u.searchParams.get("止")).toBe("2026-09-30");
    });
  });

  it("明细视图:一行一条采购明细,材料列与欠数列", async () => {
    setup();
    await screen.findByText("PO1");
    fireEvent.click(screen.getByRole("button", { name: "明细" }));
    await screen.findByText("M-001");
    expect(screen.getByText("M-002")).toBeInTheDocument();
    expect(screen.getByText("M-003")).toBeInTheDocument();
    expect(screen.getByText("面料")).toBeInTheDocument();
    expect(screen.getByText(`共 3 条`)).toBeInTheDocument();
  });

  it("整单视图点采购单号:跳采购订单整单", async () => {
    setup();
    await screen.findByText("PO1");
    fireEvent.click(screen.getByRole("button", { name: "PO1" }));
    await waitFor(() => {
      expect(lastLoc).toBe("/purchase-orders?" + "单号=PO1");
    });
    await screen.findByText("采购订单STUB");
  });

  it("无「打开」权限:整页无权提示,不发请求", async () => {
    const calls = setup([]);
    await screen.findByText("无权访问该页面");
    expect(calls.some((c) => c.url.includes("/progress"))).toBe(false);
  });
});
