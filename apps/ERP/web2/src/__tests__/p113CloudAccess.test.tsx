import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RawWorkflowRoleDialog } from "@/components/doc/RawWorkflowRoleDialog";
import PlasticRawMaterialStockIssuePage from "@/pages/PlasticRawMaterialStockIssuePage";
import { MessageBell } from "@/layout/MessageBell";
import { permRowsToMap, renderWithProviders } from "@/test/setup";

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
beforeEach(() => localStorage.setItem("web2.user", "cloud-p113"));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

it("原料岗位保持未绑定，手动保存只发送岗位，不改菜单权限；失败保留选择可重试", async () => {
  const writes: { path: string; body: unknown }[] = []; let fails = true;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = decodeURIComponent(new URL(String(input), "http://test").pathname);
    if (path.endsWith("/me/permissions")) return json(permRowsToMap([{ 菜单: "账号管理", 打开: true, 保存: true }]));
    if (path.endsWith("/raw-workflow-role")) {
      if (init?.method === "PUT") { writes.push({ path, body: JSON.parse(String(init.body)) }); return fails ? json({ 消息: "目标账号已停用，请先核对账号。" }, 409) : new Response(null, { status: 204 }); }
      return json({ accountName: "clerk-one", departmentCode: null, positionCode: null, warehouse: null });
    }
    return json({}, 404);
  }));
  const close = vi.fn();
  renderWithProviders(<RawWorkflowRoleDialog account="clerk-one" onClose={close} />);
  const picker = await screen.findByRole("combobox", { name: "原料流程岗位" });
  expect(picker).toHaveValue(""); expect(writes).toHaveLength(0);
  expect(screen.getByText(/岗位仅限定原料流程职责，仍需相应菜单权限/)).toBeInTheDocument();
  fireEvent.change(picker, { target: { value: "06-clerk" } }); fireEvent.click(screen.getByRole("button", { name: "保存岗位" }));
  await screen.findByText("目标账号已停用，请先核对账号。"); expect(picker).toHaveValue("06-clerk"); expect(close).not.toHaveBeenCalled();
  fails = false; fireEvent.click(screen.getByRole("button", { name: "保存岗位" }));
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  expect(writes).toEqual([1, 2].map(() => ({ path: "/api/admin/accounts/clerk-one/raw-workflow-role", body: { positionCode: "06-clerk" } })));
});

it("账号管理没有保存位不能修改原料岗位", async () => {
  const writes = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "PUT") writes();
    return String(input).includes("permissions") ? json(permRowsToMap([{ 菜单: "账号管理", 打开: true, 保存: false }])) : json({ accountName: "clerk-one", positionCode: null });
  }));
  renderWithProviders(<RawWorkflowRoleDialog account="clerk-one" onClose={() => {}} />);
  await screen.findByRole("combobox", { name: "原料流程岗位" });
  expect(screen.getByRole("button", { name: "保存岗位" })).toBeDisabled(); expect(writes).not.toHaveBeenCalled();
});

it("菜单审核位不足以确认出库，原料阶段能力明确允许后才可用", async () => {
  let warehouse = false; const writes: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), "http://test").pathname;
    if (path.endsWith("permissions")) return json(permRowsToMap([{ 菜单: "原料出库表", 打开: true, 审核: true, 反审核: true }]));
    if (path.endsWith("/access")) return json({ isAdmin: false, canSupervisor: false, canManager: false, canWarehousePost: warehouse, canReverse: false });
    if (init?.method === "POST") { writes.push(path); return new Response(null, { status: 204 }); }
    return json({ 单头: { id: 1, 单号: "YCK-CLOUD", 主管审核: "1", 经理审核: "1", 审核: "0" }, 明细: [] });
  }));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={["/plastic-raw-material-stock-issue?open=YCK-CLOUD"]}><PlasticRawMaterialStockIssuePage /></MemoryRouter></QueryClientProvider>);
  await screen.findByRole("heading", { name: /YCK-CLOUD/ });
  expect(screen.getByRole("button", { name: "仓管确认出库" })).toBeDisabled();
  warehouse = true; await act(async () => { await queryClient.invalidateQueries({ queryKey: ["raw-stock-issue", "access"] }); });
  await waitFor(() => expect(screen.getByRole("button", { name: "仓管确认出库" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "仓管确认出库" }));
  await waitFor(() => expect(writes).toEqual(["/api/plastic-raw-material-stock-issue/YCK-CLOUD/approve"]));
});

function RouteProbe() { const location = useLocation(); return <output data-testid="route">{location.pathname + location.search}</output>; }
it("云端 /erp basename 下铃铛跳真实原料单且仅编码一次", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).includes("unread-count") ? json({ count: 0 }) : json({ items: [{ id: 1, 类型: "原料领料待出库", 单号: "YCK 甲/1", 标题: "云端原料出库", 已读: "1" }], total: 1 })));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><MemoryRouter basename="/erp" initialEntries={["/erp/"]}><MessageBell /><RouteProbe /></MemoryRouter></QueryClientProvider>);
  fireEvent.click(screen.getByTitle("消息")); fireEvent.click(await screen.findByRole("button", { name: /云端原料出库/ }));
  await waitFor(() => expect(screen.getByTestId("route")).toHaveTextContent("/plastic-raw-material-stock-issue?open=YCK%20%E7%94%B2%2F1"));
});
