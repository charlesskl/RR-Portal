// 标签切回刷新回归:keep-alive 隐藏页保持挂载(查询仍 active),
// 全局 refetchOnWindowFocus=false;MainLayout 在 active 标签变化时 invalidateQueries,
// 切回标签后该页列表必须重新拉取(不刷新则会一直显示旧数据)。
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { Route, Routes, useNavigate } from "react-router";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import MainLayout from "@/layout/MainLayout";

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const PERMS = [
  { 组: "物料管理", 菜单: "采购入仓单", 打开: true, 保存: true, 删除: true, 打印: true, 单价: true, 金额: true, 审核: true, 反审核: true, 功能: true },
  { 组: "物料管理", 菜单: "采购退仓单", 打开: true, 保存: true, 删除: true, 打印: true, 单价: true, 金额: true, 审核: true, 反审核: true, 功能: true },
];

const RCPT = {
  id: 1,
  单号: "SH20260915001",
  日期: "2026-09-15",
  供应商编号: "S1",
  供应商名称: "供应商A",
  仓库: "来料仓",
  数量: 80,
  金额: 400,
  操作员: "admin",
  审核: "0",
};

function installFetch() {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const p = new URL(url, "http://test").pathname;
      if (method === "GET") calls.push(p);
      if (p.endsWith("/me/permissions")) return json(permRowsToMap(PERMS));
      if (p === "/api/messages/unread-count") return json({ count: 0 });
      if (p === "/api/messages") return json({ items: [], total: 0 });
      if (p === "/api/purchase-receipts") return json({ items: [RCPT], total: 1 });
      if (p === "/api/purchase-receipts/SH20260915001") return json({ 单头: RCPT, 明细: [] });
      if (p === "/api/purchase-returns") return json({ items: [], total: 0 });
      return json({ 消息: `unhandled ${method} ${p}` }, 404);
    }),
  );
  return calls;
}

// 路由探针:捕获 navigate,模拟真实路由跳转开标签
let nav: ReturnType<typeof useNavigate>;
function NavProbe() {
  const n = useNavigate();
  useEffect(() => {
    nav = n;
  }, [n]);
  return null;
}

beforeEach(() => {
  localStorage.setItem("web2.user", "tester");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("keep-alive 标签切回刷新", () => {
  it("切到别的标签再切回,入仓单列表重新拉取", async () => {
    const calls = installFetch();
    renderWithProviders(
      <>
        <NavProbe />
        <Routes>
          <Route path="/*" element={<MainLayout />} />
        </Routes>
      </>,
      "/purchase-receipts",
    );

    // 入仓页加载完成(自动打开最新一单)
    await screen.findByText("新建", undefined, { timeout: 5000 });
    const listCalls = () => calls.filter((p) => p === "/api/purchase-receipts").length;
    const before = listCalls();
    expect(before).toBeGreaterThan(0);

    // 开退仓标签,再点回入仓标签(TabBar 真实标签按钮)
    await act(async () => {
      nav("/purchase-returns");
    });
    await waitFor(() =>
      expect(
        screen.getAllByText("采购退仓单").some((el) => el.closest(".group")),
      ).toBe(true),
    );
    const tab = screen
      .getAllByText("采购入仓单")
      .find((el) => el.closest(".group"))!;
    fireEvent.click(tab);

    // 切回后 invalidate 触发重拉:列表接口调用次数增加
    await waitFor(() => expect(listCalls()).toBeGreaterThan(before));
  });
});
