// keep-alive 标签隔离回归(终审 Critical 修复):
// MainLayout 把 /purchase-receipts 与 /purchase-returns 映射到两个固定 kind 的薄包装组件,
// 页面禁止从全局 location 推导身份。本测试在真实 MainLayout 下:
//   开入仓标签 -> 新建并改表单 -> 开退仓标签 -> 切回入仓标签,断言表单值还在。
// 修复前入仓实例会因 location 变化重算 kind=RETURN、DocPage key 变化整体重挂载,表单销毁。
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { Route, Routes, useNavigate } from "react-router";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import MainLayout from "@/layout/MainLayout";

type Call = { url: string; method: string };

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
const RET = {
  id: 2,
  单号: "CT20260915001",
  日期: "2026-09-15",
  入仓单号: "SH20260915001",
  供应商编号: "S1",
  供应商名称: "供应商A",
  仓库: "来料仓",
  数量: 10,
  金额: 50,
  操作员: "admin",
  审核: "0",
};

function installFetch() {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method });
      const p = new URL(url, "http://test").pathname;
      if (p.endsWith("/me/permissions")) return json(permRowsToMap(PERMS));
      if (p === "/api/messages/unread-count") return json({ count: 0 });
      if (p === "/api/messages") return json({ items: [], total: 0 });
      if (p === "/api/purchase-receipts") return json({ items: [RCPT], total: 1 });
      if (p === "/api/purchase-receipts/SH20260915001")
        return json({ 单头: RCPT, 明细: [] });
      if (p === "/api/purchase-returns") return json({ items: [RET], total: 1 });
      if (p === "/api/purchase-returns/CT20260915001")
        return json({ 单头: RET, 明细: [] });
      return json({ 消息: `unhandled ${method} ${p}` }, 404);
    }),
  );
  return calls;
}

// 路由探针:捕获 navigate,测试里模拟「打开退仓标签」的真实路由跳转
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

describe("keep-alive 标签隔离(入仓/退仓)", () => {
  it("开入仓标签改表单 -> 开退仓标签 -> 切回入仓,表单值不丢", async () => {
    installFetch();
    renderWithProviders(
      <>
        <NavProbe />
        <Routes>
          <Route path="/*" element={<MainLayout />} />
        </Routes>
      </>,
      "/purchase-receipts",
    );

    // 入仓页自动打开最新一单(查看态),点 新建 进编辑态
    const newBtn = await screen.findByText("新建", undefined, { timeout: 5000 });
    fireEvent.click(newBtn);
    const input = await screen.findByLabelText("送货单号");
    fireEvent.change(input, { target: { value: "SH-KEEP-0001" } });
    expect((input as HTMLInputElement).value).toBe("SH-KEEP-0001");

    // 开退仓标签:真实路由跳转(修复前这一刻入仓实例 kind 翻转、整体重挂载)
    await act(async () => {
      nav("/purchase-returns");
    });
    // 退仓页挂载出自己的内容(表头 入仓单号 为退仓独有)
    await screen.findByText("入仓单号", undefined, { timeout: 5000 });

    // 切回入仓标签(TabBar 真实标签按钮)
    const tab = screen
      .getAllByText("采购入仓单")
      .find((el) => el.closest(".group"))!;
    fireEvent.click(tab);

    // 入仓实例未被重挂载:新建态与表单值都还在
    const back = await screen.findByLabelText("送货单号");
    expect((back as HTMLInputElement).value).toBe("SH-KEEP-0001");
    // 反向也成立:退仓标签保持退仓身份(再切回去仍是退仓页)
    const retTab = screen
      .getAllByText("采购退仓单")
      .find((el) => el.closest(".group"))!;
    fireEvent.click(retTab);
    await waitFor(() =>
      expect(screen.getByText("入仓单号")).toBeInTheDocument(),
    );
  });
});
