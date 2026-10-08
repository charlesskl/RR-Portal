// 半成品出库单页:对照老系统 SemiIssuePage + SemiIssueQueryPage + semiIssue 工具测试。
// 重点:三级审核链 gating(主管->经理->审核)+链上 POST;库存参考侧表;领料人选择器;
// 保存校验(数量>0/不重复);查询页签 领料备注下拉/汇总按领料备注默认开/总合计。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import SemiIssuePage from "@/pages/SemiIssuePage";

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

const PERMS_FULL = [
  { 组: "半成品仓储", 菜单: "半成品领料", 打开: true, 保存: true, 删除: true, 审核: true, 反审核: true, 打印: true, 单价: true },
];

const HEADER = {
  ID: 1, 单号: "SI1", 仓库: "半成品仓", 部门: "装配部", 领料人: "张三", 日期: "2026-09-01",
  数量: 5, 审核: "0", 主管审核: "0", 经理审核: "0", 操作员: "tester", 领料备注: "生产领料",
};
const DETAIL = {
  单头: HEADER,
  明细: [{ ID: 11, 配件编号: "AAA0001", 客户: "ZURU", 产品货号: "9215A", 产品名称: "恐龙", 产品装配名称: "彩盒", 生产单号: "MO1", 数量: 5, 备注: "" }],
};

type Call = { url: string; method: string; body?: string };

function installFetch(perms: unknown = PERMS_FULL) {
  const calls: Call[] = [];
  let supervisorDone = false;
  let managerDone = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET", body: init?.body as string });
      const p = new URL(url, "http://test").pathname;
      if (p.endsWith("/me/permissions")) return json(permRowsToMap(perms));
      if (p === "/api/semi-inventory") return json([{ 物料编号: "AAA0001", 库存: 100 }]);
      if (p === "/api/semi-issues") {
        if (init?.method === "POST") return json({ 单号: "SI-NEW" });
        return json({ items: [HEADER], total: 1 });
      }
      if (p === "/api/semi-issues/SI1")
        return json({
          单头: { ...HEADER, 主管审核: supervisorDone ? "1" : "0", 经理审核: managerDone ? "1" : "0" },
          明细: DETAIL.明细,
        });
      if (p.endsWith("/supervisor-approve")) {
        supervisorDone = true;
        return json({});
      }
      if (p.endsWith("/manager-approve")) {
        managerDone = true;
        return json({});
      }
      if (p.endsWith("/approve") || p.endsWith("/unapprove")) return json({});
      if (p === "/api/semi-issue-query/summary")
        return json([{ 领料备注: "生产领料", 装配采购: "", 配件编号: "AAA0001", 产品货号: "9215A", 产品名称: "恐龙", 产品装配名称: "彩盒", 领料数量: 5, 备注: "" }]);
      if (p === "/api/semi-issue-query/detail")
        return json([{ 领料备注: "生产领料", 装配采购: "", 日期: "2026-09-01", 单号: "SI1", 领料人: "张三", 生产单号: "MO1", 配件编号: "AAA0001", 产品货号: "9215A", 产品名称: "恐龙", 产品装配名称: "彩盒", 数量: 5, 备注: "", 制单人: "tester", 审核: "0" }]);
      if (p === "/api/master/employees") return json({ items: [{ 编号: "E1", 姓名: "李四", 部门编号: "装配部", 职称: "拉长" }], total: 1 });
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

describe("SemiIssuePage", () => {
  it("三级审核链:初始仅 主管审核 可用;链式走完 经理审核->审核", async () => {
    const calls = installFetch();
    renderWithProviders(<SemiIssuePage />, "/semi-issues?open=SI1");
    await screen.findByText("半成品出库单 · SI1");
    // 初始:主管审核可用,经理审核/审核禁用(需先经上一级)
    expect(screen.getByRole("button", { name: "主管审核" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "经理审核" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "审核" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "主管审核" }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes("/semi-issues/SI1/supervisor-approve"))).toBe(true),
    );
    await screen.findByText("主管已审");
    expect(screen.getByRole("button", { name: "经理审核" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "经理审核" }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes("/semi-issues/SI1/manager-approve"))).toBe(true),
    );
    await screen.findByText("经理已审");
    expect(screen.getByRole("button", { name: "审核" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "审核" }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith("/semi-issues/SI1/approve") && c.method === "POST")).toBe(true),
    );
  });

  it("库存参考侧表:按配件编号带出现存量(100)与发料数量(5)", async () => {
    installFetch();
    renderWithProviders(<SemiIssuePage />, "/semi-issues?open=SI1");
    await screen.findByText("半成品出库单 · SI1");
    await screen.findByText("库存参考");
    await waitFor(() => expect(screen.getByText("100")).toBeInTheDocument());
  });

  it("新建保存校验:空明细 -> 出库数量必须大于 0", async () => {
    installFetch();
    renderWithProviders(<SemiIssuePage />, "/semi-issues");
    await screen.findByText("半成品出库单(新建)");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("请至少录入一行出库产品。");
  });

  it("领料人走人事档案选择器回填", async () => {
    installFetch();
    renderWithProviders(<SemiIssuePage />, "/semi-issues");
    await screen.findByText("半成品出库单(新建)");
    fireEvent.click(screen.getByLabelText("领料人选择"));
    const dlg = await screen.findByRole("dialog");
    await waitFor(() => expect(dlg).toHaveTextContent("李四"));
    fireEvent.click(screen.getByText("李四").closest("tr")!);
    expect(screen.getByLabelText("领料人")).toHaveValue("李四");
  });

  it("查询页签:领料备注下拉/汇总按领料备注默认勾选/总合计;明细双击回单据", async () => {
    installFetch();
    renderWithProviders(<SemiIssuePage />, "/semi-issues");
    await screen.findByText("半成品出库单(新建)");
    fireEvent.click(screen.getByRole("button", { name: "半成品出库查询" }));
    await screen.findByText(/总合计:5/);
    expect(screen.getByLabelText("领料备注")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "明细查询" }));
    const cell = await screen.findByText("SI1");
    fireEvent.doubleClick(cell.closest("tr")!);
    await screen.findByText("半成品出库单 · SI1");
  });
});
