// 顶栏在线徽章+成员抽屉(借鉴 RR 中台成员目录):
//  - 徽章显示实时在线人数,账号管理·打开 权限门(无权限不渲染)
//  - 抽屉:搜索过滤 + 状态页签(全部/在线/忙线/离线) + 成员行三色,底部「查看全部」跳 /online-users
// 首页卡片待办数:补料/来料领料/采购订单/装配加工采购 四张卡显示 N 单待审核(与生产通知单同口径)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/setup";
import { OnlineBadge } from "@/layout/OnlineBadge";
import HomePage from "@/pages/HomePage";

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const PERMS = { 账号管理: { 打开: true } };
const ACCOUNTS = [
  { 用户: "admin", 在线状态: "在线" },
  { 用户: "op1", 在线状态: "忙线" },
  { 用户: "op2", 在线状态: "离线" },
  { 用户: "op3", 在线状态: "离线" },
];

function stubFetch(perms: unknown = PERMS, accounts: unknown = ACCOUNTS) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/auth/me/permissions")) return json(perms);
      if (url.includes("/api/admin/accounts")) return json(accounts);
      if (url.includes("/api/messages/unread-count")) return json({ count: 0 });
      return json(null, 404);
    }),
  );
}

beforeEach(() => {
  localStorage.setItem("web2.token", "t");
  localStorage.setItem("web2.user", "admin");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("顶栏在线徽章", () => {
  it("显示在线人数;无 账号管理 权限不渲染", async () => {
    stubFetch();
    renderWithProviders(<OnlineBadge onNavigate={() => {}} />);
    await waitFor(() => expect(screen.getByText("1")).toBeTruthy());
    expect(screen.getByText("在线")).toBeTruthy();
    cleanup();
    stubFetch({});
    renderWithProviders(<OnlineBadge onNavigate={() => {}} />);
    await waitFor(() => expect(screen.queryByText("在线")).toBeNull());
  });

  it("抽屉:搜索过滤+状态页签+查看全部跳转", async () => {
    stubFetch();
    const nav = vi.fn();
    renderWithProviders(<OnlineBadge onNavigate={nav} />);
    await userEvent.click(await screen.findByTitle("在线人员"));
    const dlg = await screen.findByRole("dialog", { name: "在线人员" });
    await waitFor(() => expect(dlg).toHaveTextContent("1 人在线 · 共 4 个账号"));
    expect(dlg).toHaveTextContent("op3");

    // 状态页签:忙线 只剩 op1
    await userEvent.click(screen.getByRole("button", { name: "忙线" }));
    expect(dlg).toHaveTextContent("op1");
    expect(dlg).not.toHaveTextContent("op3");

    // 搜索:全部 + 关键字 op 过滤掉 admin
    await userEvent.click(screen.getByRole("button", { name: "全部" }));
    await userEvent.type(screen.getByPlaceholderText("搜索账号"), "op");
    expect(dlg).not.toHaveTextContent("admin");
    expect(dlg).toHaveTextContent("op2");

    // 查看全部 → /online-users
    await userEvent.clear(screen.getByPlaceholderText("搜索账号"));
    await userEvent.click(screen.getByRole("button", { name: /查看全部/ }));
    expect(nav).toHaveBeenCalledWith("/online-users");
  });
});

describe("首页卡片待办数", () => {
  it("补料/领料/采购订单/装配加工采购 四卡显示 N 单待审核", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const headers = (n: number) => ({
          items: [
            ...Array.from({ length: n }, () => ({ 审核: "0" })),
            { 审核: "1" },
          ],
          total: n + 1,
        });
        if (url.includes("/api/auth/me/permissions")) return json({});
        if (url.includes("/api/production?")) return json(headers(2));
        if (url.includes("/api/replenishments?")) return json(headers(3));
        if (url.includes("/api/material-issues?")) return json(headers(0));
        if (url.includes("/api/purchase-orders?")) return json(headers(5));
        if (url.includes("/api/assembly-purchase-orders?")) return json(headers(1));
        if (url.includes("/api/material-inventory")) return json([]);
        if (url.includes("/api/messages/unread-count")) return json({ count: 0 });
        return json(null, 404);
      }),
    );
    renderWithProviders(<HomePage dept="all" onNavigate={() => {}} />);
    await waitFor(() => expect(screen.getByText("3 单待审核")).toBeTruthy());
    expect(screen.getByText("5 单待审核")).toBeTruthy();
    expect(screen.getByText("1 单待审核")).toBeTruthy();
    // 生产通知单在菜单只有业务部一张卡,2 单待审核
    expect(screen.getAllByText("2 单待审核").length).toBe(1);
    // 领料单 0 待审核 → 无待审核单据(两张卡同文案:领料+库存无负库存)
    expect(screen.getAllByText(/无待审核单据|无负库存/).length).toBeGreaterThan(0);
  });
});
