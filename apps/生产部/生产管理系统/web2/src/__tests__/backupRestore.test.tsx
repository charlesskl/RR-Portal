// 备份数据页 + 还原数据页:对照老系统 web/src/pages/system/{BackupPage,RestorePage}.tsx。
// 备份:「备份数据·功能」位控制按钮/确认弹窗后 POST /admin/backup/成功展示备份文件路径/失败透出后端消息;
// 还原:纯指引静态页,无接口调用(老系统同)。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import BackupPage from "@/pages/BackupPage";
import RestorePage from "@/pages/RestorePage";

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

const PERMS_OK = [{ 组: "系统管理", 菜单: "备份数据", 打开: true, 功能: true }];
const PERMS_NO = [{ 组: "系统管理", 菜单: "备份数据", 打开: true, 功能: false }];

type Call = { url: string; method: string };

function installFetch(perms: unknown = PERMS_OK, fail = false) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method });
      const p = new URL(url, "http://test").pathname;
      if (p.endsWith("/me/permissions")) return json(permRowsToMap(perms));
      if (p === "/api/admin/backup" && method === "POST")
        return fail
          ? json({ 消息: "备份目录未配置" }, 400)
          : json({ 文件: "D:\\bak\\erp_20260918_120000.bak", 消息: "备份完成" });
      return json({ 消息: `unhandled ${method} ${p}` }, 404);
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

describe("BackupPage", () => {
  it("确认弹窗后 POST /admin/backup,展示备份文件路径", async () => {
    const calls = installFetch();
    renderWithProviders(<BackupPage />, "/system/backup");
    const btn = await screen.findByRole("button", { name: /立即备份/ });
    expect(calls.some((c) => c.url.includes("/admin/backup"))).toBe(false);
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByText("确认立即备份数据库?")).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("button", { name: "立即备份" }).at(-1)!);
    await waitFor(() => {
      expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/admin/backup"))).toBe(true);
    });
    await waitFor(() =>
      expect(screen.getByText(/erp_20260918_120000\.bak/)).toBeInTheDocument(),
    );
    expect(screen.getByText("备份完成")).toBeInTheDocument();
  });

  it("无「功能」位:显示无权限提示,无备份按钮", async () => {
    const calls = installFetch(PERMS_NO);
    renderWithProviders(<BackupPage />, "/system/backup");
    await waitFor(() =>
      expect(screen.getByText("当前账号无「备份数据·功能」权限")).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: /立即备份/ })).not.toBeInTheDocument();
    expect(calls.some((c) => c.url.includes("/admin/backup"))).toBe(false);
  });

  it("备份失败透出后端消息", async () => {
    installFetch(PERMS_OK, true);
    renderWithProviders(<BackupPage />, "/system/backup");
    fireEvent.click(await screen.findByRole("button", { name: /立即备份/ }));
    await waitFor(() => expect(screen.getByText("确认立即备份数据库?")).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("button", { name: "立即备份" }).at(-1)!);
    await waitFor(() => expect(screen.getByText("备份目录未配置")).toBeInTheDocument());
  });
});

describe("RestorePage", () => {
  it("纯指引页:渲染五步 DBA 指引,不发任何接口请求", async () => {
    const calls = installFetch();
    renderWithProviders(<RestorePage />, "/system/restore");
    expect(screen.getByText("还原数据")).toBeInTheDocument();
    expect(screen.getByText(/还原会覆盖当前全部业务数据/)).toBeInTheDocument();
    for (const t of ["备份当前库", "确认备份文件", "踢出在线连接", "执行 RESTORE", "验证并恢复服务"]) {
      expect(screen.getByText(t)).toBeInTheDocument();
    }
    // 静态页不拉权限也不调接口
    expect(calls.length).toBe(0);
  });
});
