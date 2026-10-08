// 塑胶订单进度表页:对照老系统 web/src/pages/plastics/PlasticPurchaseProgressPage.tsx。
// 场景:整单视图汇总/展开物料明细、完成情况徽章、欠数红色、明细视图列、
// 只看欠数/供应商/日期区间进参数(点「查询」才发)、导出列规格、点单号跳塑胶采购订单整单、无权访问。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router";
import { useEffect } from "react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import type { PlasticPurchaseProgressRow } from "@/api/types";
import PlasticPurchaseProgressPage from "@/pages/PlasticPurchaseProgressPage";

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

const PERMS_FULL = [{ 组: "塑胶采购", 菜单: "塑胶进度表", 打开: true }];

const PROGRESS: PlasticPurchaseProgressRow[] = [
  { 订购日期: "2026-09-01", 交货日期: "2026-09-20", 采购单号: "PO1", 生产单号: "MO-1", 款号: "K-1", 物料编号: "P-001", 物料名称: "胶壳", 模具编号: "MJ-1", 颜色: "黑", 单位: "个", 订购数量: 100, 入仓数量: 60, 欠数: 40, 供应商名称: "恒科", 审核: "1" },
  { 订购日期: "2026-09-01", 交货日期: "2026-09-20", 采购单号: "PO1", 生产单号: "MO-1", 款号: "K-1", 物料编号: "P-002", 物料名称: "胶盖", 模具编号: "MJ-2", 颜色: "白", 单位: "个", 订购数量: 50, 入仓数量: 50, 欠数: 0, 供应商名称: "恒科", 审核: "1" },
  { 订购日期: "2026-09-03", 采购单号: "PO2", 生产单号: "MO-2", 款号: "K-2", 物料编号: "P-003", 物料名称: "齿轮", 模具编号: "", 颜色: "", 单位: "个", 订购数量: 10, 入仓数量: 0, 欠数: 10, 供应商名称: "龙昌", 审核: "0" },
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
      if (p === "/api/plastic-purchase-progress") return json(PROGRESS);
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
        <Route path="/plastic-purchase-progress" element={<PlasticPurchaseProgressPage />} />
        <Route path="/plastic-purchase-orders" element={<div>塑胶采购订单STUB</div>} />
      </Routes>
    </>,
    "/plastic-purchase-progress",
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

describe("PlasticPurchaseProgressPage", () => {
  it("整单视图:两行订单汇总(数量/欠数/完成情况),点行展开物料明细", async () => {
    setup();
    await screen.findByText("PO1");
    expect(screen.getByText("PO2")).toBeInTheDocument();
    expect(screen.getByText("部分入仓")).toBeInTheDocument();
    expect(screen.getByText("未入仓")).toBeInTheDocument();
    expect(screen.getAllByText(/共 2 张订单/).length).toBeGreaterThan(0);
    // 欠数 40 红色加粗
    expect(screen.getByText("40").className).toContain("text-[#dc2626]");
    // 展开 PO1 明细:两条物料行
    fireEvent.click(screen.getByText("PO1").closest("tr")!);
    await screen.findByText("胶盖");
    expect(screen.getByText("胶壳")).toBeInTheDocument();
    fireEvent.click(screen.getByText("PO1").closest("tr")!);
    await waitFor(() => expect(screen.queryByText("胶盖")).not.toBeInTheDocument());
  });

  it("筛选默认不发新请求;点「查询」带 供应商/起止/只看欠数 参数", async () => {
    const calls = setup();
    await screen.findByText("PO1");
    const before = calls.filter((c) => c.url.includes("/plastic-purchase-progress?")).length;
    fireEvent.change(screen.getByLabelText("供应商"), { target: { value: "恒科" } });
    fireEvent.change(screen.getByLabelText("起"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText("止"), { target: { value: "2026-09-30" } });
    fireEvent.click(screen.getByRole("checkbox"));
    expect(calls.filter((c) => c.url.includes("/plastic-purchase-progress?")).length).toBe(before);
    fireEvent.click(screen.getByRole("button", { name: /查询/ }));
    await waitFor(() => {
      const hit = calls.find(
        (c) => c.url.includes("plastic-purchase-progress?") && c.url.includes("onlyOwed=true"),
      );
      expect(hit).toBeTruthy();
      const u = new URL(hit!.url, "http://test");
      expect(u.searchParams.get("供应商")).toBe("恒科");
      expect(u.searchParams.get("起")).toBe("2026-09-01");
      expect(u.searchParams.get("止")).toBe("2026-09-30");
    });
  });

  it("明细视图:一行一条采购明细,模具编号列与欠数列", async () => {
    setup();
    await screen.findByText("PO1");
    fireEvent.click(screen.getByRole("button", { name: "明细" }));
    await screen.findByText("P-001");
    expect(screen.getByText("P-002")).toBeInTheDocument();
    expect(screen.getByText("P-003")).toBeInTheDocument();
    expect(screen.getByText("MJ-1")).toBeInTheDocument();
    expect(screen.getAllByText("共 3 条").length).toBeGreaterThan(0); // 筛选栏 + 底栏各一处
  });

  it("整单视图点采购单号:跳塑胶采购订单整单", async () => {
    setup();
    await screen.findByText("PO1");
    fireEvent.click(screen.getByRole("button", { name: "PO1" }));
    await waitFor(() => expect(lastLoc).toBe("/plastic-purchase-orders?单号=PO1"));
    await screen.findByText("塑胶采购订单STUB");
  });

  it("无「打开」权限:整页无权提示", async () => {
    setup([]);
    await screen.findByText("无权访问该页面");
  });
});
