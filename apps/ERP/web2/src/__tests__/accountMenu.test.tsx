// 账号下拉菜单:我的权限弹窗 + 账号权限管理入口
//  - 「我的权限」所有人可见:弹窗按菜单分组列出当前账号已授予的功能位(数据源 /auth/me/permissions)
//  - 「账号权限管理」仅 账号管理·打开 权限可见,点击经 onNavigate 跳 /accounts(MENU_PATHS 裁决在 MainLayout)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/setup";
import { TopBar } from "@/layout/TopBar";

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), {
    status,
    headers: { "Content-Type": "application/json" },
  });

// /auth/me/permissions 响应形状:菜单 -> 功能位 map
const PERM_MAP = {
  生产制单: { 打开: true, 保存: true, 审核: true, 反审核: false },
  账号管理: { 打开: true },
  物料资料: { 打开: true, 单价: false },
};
const PERM_MAP_NO_ADMIN = {
  生产制单: { 打开: true, 保存: true },
};

function stubFetch(map: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/auth/me/permissions")) return json(map);
      if (url.includes("/api/messages/unread-count")) return json({ count: 0 });
      return json(null, 404);
    }),
  );
}

function renderBar(onNavigate = vi.fn()) {
  renderWithProviders(
    <TopBar
      paletteOpen={false}
      onPaletteChange={() => {}}
      onNavigate={onNavigate}
      onHome={() => {}}
    />,
  );
  return onNavigate;
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

const openMenu = async () => {
  await userEvent.click(await screen.findByText("admin"));
};

describe("账号下拉菜单", () => {
  it("我的权限:弹窗按菜单分组列出已授予功能位,未授予位不显示", async () => {
    stubFetch(PERM_MAP);
    renderBar();
    await openMenu();
    await userEvent.click(await screen.findByText("我的权限"));
    const dlg = await screen.findByRole("dialog");
    await waitFor(() => {
      expect(dlg).toHaveTextContent("生产制单");
      expect(dlg).toHaveTextContent("账号管理");
      expect(dlg).toHaveTextContent("物料资料");
      expect(dlg).toHaveTextContent("保存");
      expect(dlg).toHaveTextContent("审核");
    });
    // 反审核=false 不应出现在生产制单行
    expect(dlg).not.toHaveTextContent("反审核");
  });

  it("有 账号管理·打开 权限:显示 账号权限管理/在线人员 入口,点击分别跳 /accounts 与 /online-users", async () => {
    stubFetch(PERM_MAP);
    const nav = renderBar(vi.fn());
    await openMenu();
    await userEvent.click(await screen.findByText("账号权限管理"));
    expect(nav).toHaveBeenCalledWith("/accounts");
    await openMenu();
    await userEvent.click(await screen.findByText("在线人员"));
    expect(nav).toHaveBeenCalledWith("/online-users");
  });

  it("无 账号管理 权限:不显示管理入口,仍有 我的权限", async () => {
    stubFetch(PERM_MAP_NO_ADMIN);
    renderBar();
    await openMenu();
    await screen.findByText("我的权限");
    await waitFor(() => {
      expect(screen.queryByText("账号权限管理")).toBeNull();
      expect(screen.queryByText("在线人员")).toBeNull();
    });
  });
});
