// Batch 0B 批量审核:对照老系统逐张调审核接口的口径
// (web/src/pages/materials/MaterialDocPage.tsx、plastics/PlasticIssueFormPage.tsx、
// plastics/PlasticReceiptFormPage.tsx 的 batchApprove),覆盖四种单据:
// 采购入仓单 / 采购退仓单 / 塑胶领料单 / 塑胶入仓单。
// 场景:多选 2 张未审核单 -> 批量审核 -> 端点调用断言 + 已审核单不入选;外加部分失败与无权限入口。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import PurchaseReceiptPage, { PurchaseReturnsPage } from "@/pages/PurchaseReceiptPage";
import PlasticIssuePage from "@/pages/PlasticIssuePage";
import PlasticReceiptPage from "@/pages/PlasticReceiptPage";

// ---------- 测试基建:fetch 路由桩 ----------

type Call = { url: string; method: string; body?: Record<string, unknown> };

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const noContent = () => new Response(null, { status: 204 });

const PERMS_FULL = [
  { 组: "物料管理", 菜单: "采购入仓单", 打开: true, 保存: true, 删除: true, 打印: true, 单价: true, 金额: true, 审核: true, 反审核: true, 功能: true },
  { 组: "物料管理", 菜单: "采购退仓单", 打开: true, 保存: true, 删除: true, 打印: true, 单价: true, 金额: true, 审核: true, 反审核: true, 功能: true },
  { 组: "塑胶仓储", 菜单: "塑胶领料单", 打开: true, 保存: true, 删除: true, 打印: true, 单价: true, 金额: true, 审核: true, 反审核: true, 功能: true },
  { 组: "塑胶仓储", 菜单: "塑胶入仓单", 打开: true, 保存: true, 删除: true, 打印: true, 单价: true, 金额: true, 审核: true, 反审核: true, 功能: true },
];
const PERMS_NO_AUDIT = PERMS_FULL.map((r) => ({ ...r, 审核: false }));

// 每种单据:两张未审核(U1/U2) + 一张已审核(A1,不应入选)
const RCPT_U1 = { id: 1, 单号: "SH-U1", 日期: "2026-09-15", 供应商编号: "S1", 供应商名称: "供应商A", 仓库: "来料仓", 数量: 10, 金额: 100, 操作员: "admin", 审核: "0" };
const RCPT_U2 = { ...RCPT_U1, id: 2, 单号: "SH-U2" };
const RCPT_A1 = { ...RCPT_U1, id: 3, 单号: "SH-A1", 审核: "1", 审核人: "admin" };

const RET_U1 = { id: 1, 单号: "CT-U1", 日期: "2026-09-15", 入仓单号: "SH-U1", 供应商编号: "S1", 供应商名称: "供应商A", 仓库: "来料仓", 数量: 5, 金额: 50, 操作员: "admin", 审核: "0" };
const RET_U2 = { ...RET_U1, id: 2, 单号: "CT-U2" };
const RET_A1 = { ...RET_U1, id: 3, 单号: "CT-A1", 审核: "1", 审核人: "admin" };

const PI_U1 = { id: 1, 单号: "LL-U1", 日期: "2026-09-15", 领料部门: "注塑部", 领料人: "张三", 仓库: "塑胶仓", 数量: 30, 金额: null, 操作员: "admin", 审核: "0", 主管审核: "1", 经理审核: "1" };
const PI_U2 = { ...PI_U1, id: 2, 单号: "LL-U2" };
const PI_A1 = { ...PI_U1, id: 3, 单号: "LL-A1", 审核: "1", 审核人: "admin" };

const PR_U1 = { id: 1, 单号: "SR-U1", 日期: "2026-09-15", 供应商编号: "S-01", 供应商名称: "兴发塑胶", 仓库: "塑胶仓", 数量: 30, 金额: 75, 操作员: "admin", 审核: "0" };
const PR_U2 = { ...PR_U1, id: 2, 单号: "SR-U2" };
const PR_A1 = { ...PR_U1, id: 3, 单号: "SR-A1", 审核: "1", 审核人: "admin" };

interface Cfg {
  perms: unknown;
  onCall?: (c: Call) => Response | undefined;
}

function installFetch(cfg: Cfg) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : undefined;
      const call: Call = { url, method, body };
      calls.push(call);
      const custom = cfg.onCall?.(call);
      if (custom) return custom;
      const u = new URL(url, "http://test");
      const p = u.pathname;
      if (p.endsWith("/me/permissions")) return json(permRowsToMap(cfg.perms));
      // 四种单据:列表(2 未审 + 1 已审) / 详情(空明细即可) / 审核 / 反审核 / 删除
      for (const [res, items] of [
        ["purchase-receipts", [RCPT_U1, RCPT_U2, RCPT_A1]],
        ["purchase-returns", [RET_U1, RET_U2, RET_A1]],
        ["plastic-issues", [PI_U1, PI_U2, PI_A1]],
        ["plastic-receipts", [PR_U1, PR_U2, PR_A1]],
      ] as const) {
        if (p === `/api/${res}` && method === "GET") {
          // onlyUnapproved=true(塑胶入仓单批量审核):模拟服务端过滤,只回未审核单
          const its =
            u.searchParams.get("onlyUnapproved") === "true"
              ? items.filter((i) => i.审核 !== "1")
              : items;
          return json({ items: its, total: its.length });
        }
        if (new RegExp(`^/api/${res}/[^/]+/(supervisor-approve|manager-approve|approve|unapprove)$`).test(p))
          return noContent();
        if (new RegExp(`^/api/${res}/[^/]+$`).test(p) && method === "GET")
          return json({ 单头: items[0], 明细: [] });
        if (new RegExp(`^/api/${res}/[^/]+$`).test(p) && method === "DELETE") return noContent();
      }
      // 塑胶领料页库存参考 / 塑胶入仓页仓库下拉(首进即触发)
      if (p === "/api/plastic-inventory") return json([]);
      if (p === "/api/master/warehouse-locations/options") return json([]);
      return json({ 消息: `unhandled ${method} ${p}` }, 404);
    }),
  );
  return calls;
}

// 审核端点调用(POST .../approve,不含 supervisor/manager-approve)
const approveCalls = (calls: Call[], res: string) =>
  calls
    .filter((c) => c.method === "POST" && new RegExp(`/api/${res}/[^/]+/approve$`).test(c.url))
    .map((c) => decodeURIComponent(new RegExp(`/api/${res}/([^/]+)/approve$`).exec(c.url)![1]));

// 打开批量审核弹窗并勾选两张未审核单,返回对话框对象
async function openBatchAndSelect(u1: string, u2: string) {
  fireEvent.click(screen.getByRole("button", { name: "批量审核" }));
  const dlg = await screen.findByRole("dialog");
  await waitFor(() => expect(within(dlg).getByLabelText(`选择 ${u1}`)).toBeInTheDocument());
  fireEvent.click(within(dlg).getByLabelText(`选择 ${u1}`));
  fireEvent.click(within(dlg).getByLabelText(`选择 ${u2}`));
  return dlg;
}

beforeEach(() => {
  localStorage.setItem("web2.user", "tester");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

// ---------- 采购入仓单 ----------

describe("采购入仓单·批量审核", () => {
  it("多选 2 张未审核单 -> 批量审核:逐张调 approve;已审核单不入选", async () => {
    const calls = installFetch({ perms: PERMS_FULL });
    renderWithProviders(<PurchaseReceiptPage />, "/purchase-receipts");
    await waitFor(() => expect(screen.getByText("SH-U1")).toBeInTheDocument());

    const dlg = await openBatchAndSelect("SH-U1", "SH-U2");
    // 已审核单不入选(只列未审核)
    expect(within(dlg).queryByText("SH-A1")).not.toBeInTheDocument();
    expect(within(dlg).getByText("已选 2 张", { exact: false })).toBeInTheDocument();

    fireEvent.click(within(dlg).getByRole("button", { name: "批量审核" }));
    await waitFor(() => expect(screen.getByText("已审核 2 张")).toBeInTheDocument());
    expect(approveCalls(calls, "purchase-receipts").sort()).toEqual(["SH-U1", "SH-U2"]);
  });

  it("无审核权限:工具条不渲染批量审核入口", async () => {
    installFetch({ perms: PERMS_NO_AUDIT });
    renderWithProviders(<PurchaseReceiptPage />, "/purchase-receipts");
    await waitFor(() => expect(screen.getByText("SH-U1")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "批量审核" })).not.toBeInTheDocument();
  });
});

// ---------- 采购退仓单 ----------

describe("采购退仓单·批量审核", () => {
  it("多选 2 张未审核单 -> 批量审核:逐张调 approve;已审核单不入选", async () => {
    const calls = installFetch({ perms: PERMS_FULL });
    renderWithProviders(<PurchaseReturnsPage />, "/purchase-returns");
    await waitFor(() => expect(screen.getByText("CT-U1")).toBeInTheDocument());

    const dlg = await openBatchAndSelect("CT-U1", "CT-U2");
    expect(within(dlg).queryByText("CT-A1")).not.toBeInTheDocument();

    fireEvent.click(within(dlg).getByRole("button", { name: "批量审核" }));
    await waitFor(() => expect(screen.getByText("已审核 2 张")).toBeInTheDocument());
    expect(approveCalls(calls, "purchase-returns").sort()).toEqual(["CT-U1", "CT-U2"]);
  });
});

// ---------- 塑胶领料单(终审=出库;未走完三级流转的单计入失败) ----------

describe("塑胶领料单·批量审核", () => {
  it("多选 2 张未审核单 -> 批量审核:逐张调 approve(终审);已审核单不入选", async () => {
    const calls = installFetch({ perms: PERMS_FULL });
    renderWithProviders(<PlasticIssuePage />, "/plastic-issues");
    await waitFor(() => expect(screen.getByText("LL-U1")).toBeInTheDocument());

    const dlg = await openBatchAndSelect("LL-U1", "LL-U2");
    expect(within(dlg).queryByText("LL-A1")).not.toBeInTheDocument();

    fireEvent.click(within(dlg).getByRole("button", { name: "批量审核" }));
    await waitFor(() => expect(screen.getByText("已审核 2 张")).toBeInTheDocument());
    expect(approveCalls(calls, "plastic-issues").sort()).toEqual(["LL-U1", "LL-U2"]);
  });

  it("部分失败:提示汇总(已审核 N 张,失败 M 张),弹窗保留", async () => {
    const calls = installFetch({
      perms: PERMS_FULL,
      onCall: (c) => {
        if (c.method === "POST" && c.url.includes("/plastic-issues/LL-U2/approve"))
          return json({ 消息: "请先完成经理审核" }, 400);
        return undefined;
      },
    });
    renderWithProviders(<PlasticIssuePage />, "/plastic-issues");
    await waitFor(() => expect(screen.getByText("LL-U1")).toBeInTheDocument());

    const dlg = await openBatchAndSelect("LL-U1", "LL-U2");
    fireEvent.click(within(dlg).getByRole("button", { name: "批量审核" }));
    await waitFor(() =>
      expect(screen.getByText("已审核 1 张,失败 1 张(请先完成经理审核)")).toBeInTheDocument(),
    );
    expect(approveCalls(calls, "plastic-issues").sort()).toEqual(["LL-U1", "LL-U2"]);
    // 弹窗保留(失败的单还在列表里),全量成功才关
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

// ---------- 塑胶入仓单 ----------

describe("塑胶入仓单·批量审核", () => {
  it("多选 2 张未审核单 -> 批量审核:逐张调 approve;只拉未审核且成功后弹窗保留", async () => {
    const calls = installFetch({ perms: PERMS_FULL });
    renderWithProviders(<PlasticReceiptPage />, "/plastic-receipts");
    await waitFor(() => expect(screen.getByText("SR-U1")).toBeInTheDocument());

    const dlg = await openBatchAndSelect("SR-U1", "SR-U2");
    // 服务端只列未审核(请求带 onlyUnapproved=true),已审核单不出现
    expect(within(dlg).queryByText("SR-A1")).not.toBeInTheDocument();
    expect(
      calls.some(
        (c) => c.url.startsWith("/api/plastic-receipts?") && c.url.includes("onlyUnapproved=true"),
      ),
    ).toBe(true);

    fireEvent.click(within(dlg).getByRole("button", { name: "批量审核" }));
    await waitFor(() => expect(screen.getByText("已审核 2 张")).toBeInTheDocument());
    expect(approveCalls(calls, "plastic-receipts").sort()).toEqual(["SR-U1", "SR-U2"]);
    // 全部成功弹窗也不关:后面页的未审核单前移,可继续勾选下一批
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
