import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "@/test/setup";
import PlasticRawMaterialDemandPage from "@/pages/PlasticRawMaterialDemandPage";
import PlasticRawMaterialMasterPage from "@/pages/PlasticRawMaterialMasterPage";
import PlasticRawMaterialStockIssuePage from "@/pages/PlasticRawMaterialStockIssuePage";
import { EmployeePickerDialog } from "@/components/doc/EmployeePickerDialog";
import { rawIssueQuantitySummary } from "@/lib/rawIssueQuantity";
import { MessageBell } from "@/layout/MessageBell";
import MessagesPage from "@/pages/MessagesPage";
import { useLocation, useNavigate } from "react-router";
import type { RawIssueSourceDetail } from "@/api/types";

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
const menus = ["原料生产需求表", "原料生产需求汇总", "原料采购分析表", "原料采购订单", "原料出库表", "塑胶原料资料表"];
function install(handler: (path: string, init?: RequestInit) => Response | Promise<Response> | undefined, save = true) {
  const calls: { path: string; method: string }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = decodeURIComponent(new URL(String(input), "http://test").pathname); calls.push({ path, method: init?.method ?? "GET" });
    if (path.endsWith("/plastic-raw-material-stock-issue/access")) return json({ isAdmin: true, canSupervisor: true, canManager: true, canWarehousePost: true, canReverse: true });
    if (path.endsWith("/me/permissions")) return json(permRowsToMap(menus.map(菜单 => ({ 菜单, 打开: true, 保存: save, 审核: true, 反审核: true, 删除: true, 打印: true }))));
    return await handler(path, init) ?? json({ 消息: `未定义 ${path}` }, 404);
  }));
  return calls;
}
beforeEach(() => localStorage.setItem("web2.user", "P113-user"));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

it("默认自动显示SP冻结净量，待审仅查看；历史查询保留原数量且无手工创建", async () => {
  const calls = install(path => {
    if (path.endsWith("/molding-sources")) return json({ items: [{ 单号: "P113-SP-A", 需求数量KG: 28, 原料种数: 1, 审核: "0", 可采购: false, 限制原因: "源单尚未终审" }], total: 1 });
    if (path.endsWith("/molding-sources/P113-SP-A")) return json({ 单头: { 单号: "P113-SP-A", 需求数量KG: 28, 原料种数: 1, 审核: "0", 可采购: false }, 明细: [{ 原料编号: "P113-R", 原料名称: "冻结原料", 需求数量KG: 28, 库存单位: "包", 每库存单位KG: 25, 需求库存数量: 1.12 }] });
    if (path === "/api/plastic-raw-material-demand") return json({ items: [{ id: 1, 单号: "P113-YLX", 数量KG: 93, 数量包: 7 }], total: 1 });
    if (path.endsWith("/P113-YLX")) return json({ 单头: { id: 1, 单号: "P113-YLX", 制单人: "旧制单人" }, 明细: [{ 原料编号: "OLD-R", 需求数量KG: 93, 需求数量包: 7 }] });
  });
  renderWithProviders(<PlasticRawMaterialDemandPage />, "/plastic-raw-material-demand");
  await screen.findByText("P113-SP-A");
  expect(screen.getByText("源单尚未终审")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "新建" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "查看原料" }));
  const sourceDialog = await screen.findByRole("dialog", { name: /P113-SP-A/ });
  expect(await within(sourceDialog).findByText("冻结原料")).toBeInTheDocument();
  expect(within(sourceDialog).getByText("1.12")).toBeInTheDocument();
  fireEvent.keyDown(sourceDialog, { key: "Escape" });
  fireEvent.click(screen.getByRole("tab", { name: "历史手工需求" }));
  await screen.findByText("P113-YLX"); fireEvent.click(screen.getByRole("button", { name: "查看原单" }));
  const history = await screen.findByRole("dialog", { name: /P113-YLX/ });
  expect(await within(history).findByText("OLD-R")).toBeInTheDocument();
  expect(within(history).getByText("93")).toBeInTheDocument(); expect(within(history).getByText("7")).toBeInTheDocument();
  expect(calls.every(c => c.method === "GET")).toBe(true);
});

it("常用原料人工勾选保存为布尔值，重新打开仍保留；包重不填不猜默认", async () => {
  let common: boolean | null = null;
  const bodies: Record<string, unknown>[] = [];
  install((path, init) => {
    const row = { ID: 113, 物料编号: "P113-R", 物料名称: "测试原料", 单位: "KG", 常用原料: common, 每包重量: null };
    if (path.endsWith("/categories")) return json([]);
    if (path === "/api/plastic-raw-material-master") return json({ items: [row], total: 1 });
    if (path === "/api/master/plastic-raw-materials/113") {
      if (init?.method === "PUT") { const body = JSON.parse(String(init.body)); bodies.push(body); common = body.常用原料; return json({}); }
      return json(row);
    }
  });
  renderWithProviders(<PlasticRawMaterialMasterPage />, "/plastic-raw-material-master");
  fireEvent.click(await screen.findByRole("button", { name: "编辑 P113-R" }));
  const checkbox = await screen.findByRole("checkbox", { name: "常用原料" }); expect(checkbox).not.toBeChecked();
  expect(screen.getByRole("spinbutton", { name: "每包重量" })).toHaveValue(null);
  fireEvent.click(checkbox); fireEvent.click(screen.getByRole("button", { name: "确定" }));
  await waitFor(() => expect(bodies).toHaveLength(1)); expect(bodies[0].常用原料).toBe(true); expect(bodies[0].每包重量).toBeUndefined();
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "编辑塑胶原料" })).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "编辑 P113-R" })); expect(await screen.findByRole("checkbox", { name: "常用原料" })).toBeChecked();
});

const source: RawIssueSourceDetail = { 单号: "P113-SP", 明细: [{ 原料编号: "P113-R", 原料名称: "冻结原料", 单位: "包", 每包重量: 25, 每库存单位KG: 25, 需求数量KG: 28, 需求数量: 1.12, 已申请数量: .12, 可申请数量: 1 }] };
async function openSources() { fireEvent.click(await screen.findByRole("button", { name: "按啤机采购单领料" })); return screen.findByRole("dialog", { name: "按已审核啤机采购单领料" }); }
it("已审SP按剩余净量调入，重复调入不复制也不覆盖已修改草稿", async () => {
  install(path => {
    if (path.endsWith("/sources")) return json({ items: [{ 单号: source.单号, 原料种数: 1 }], total: 1 });
    if (path.endsWith(`/sources/${source.单号}`)) return json(source);
  });
  renderWithProviders(<PlasticRawMaterialStockIssuePage />, "/plastic-raw-material-stock-issue");
  let dialog = await openSources(); fireEvent.click(await within(dialog).findByRole("button", { name: "查看净量" }));
  await within(dialog).findByText("冻结原料"); fireEvent.click(within(dialog).getByRole("button", { name: "带入剩余净量" }));
  await waitFor(() => expect(screen.getByRole("spinbutton", { name: "数量" })).toHaveValue(1));
  expect(screen.getByRole("textbox", { name: "原料编号" })).toBeDisabled();
  expect(screen.getByRole("textbox", { name: "啤机外发单号" })).toHaveValue("P113-SP");
  fireEvent.change(screen.getByRole("spinbutton", { name: "数量" }), { target: { value: ".5" } });
  dialog = await openSources(); fireEvent.click(await within(dialog).findByRole("button", { name: "查看净量" }));
  await waitFor(() => expect(within(dialog).getByRole("button", { name: "带入剩余净量" })).toBeEnabled());
  fireEvent.click(within(dialog).getByRole("button", { name: "带入剩余净量" }));
  expect(screen.getAllByRole("spinbutton", { name: "数量" })).toHaveLength(1); expect(screen.getByRole("spinbutton", { name: "数量" })).toHaveValue(.5);
});

it("连续选择来源时迟到A响应不替换B净量，也不改写草稿", async () => {
  let release: (() => void) | undefined;
  install(path => {
    if (path.endsWith("/sources")) return json({ items: [{ 单号: "P113-A", 原料种数: 1 }, { 单号: "P113-B", 原料种数: 1 }], total: 2 });
    if (path.endsWith("/sources/P113-A")) return new Promise<Response>(resolve => { release = () => resolve(json({ ...source, 单号: "P113-A" })); });
    if (path.endsWith("/sources/P113-B")) return json({ 单号: "P113-B", 明细: [{ ...source.明细[0], 原料编号: "P113-B-R", 原料名称: "B原料", 可申请数量: .6 }] });
  });
  renderWithProviders(<PlasticRawMaterialStockIssuePage />, "/plastic-raw-material-stock-issue");
  const dialog = await openSources(); await within(dialog).findByText("P113-B");
  fireEvent.click(within(within(dialog).getByText("P113-A").closest("tr")!).getByRole("button")); await waitFor(() => expect(release).toBeDefined());
  fireEvent.click(within(within(dialog).getByText("P113-B").closest("tr")!).getByRole("button")); await within(dialog).findByText("B原料");
  await act(async () => release!()); expect(within(dialog).queryByText("冻结原料")).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "带入剩余净量" }));
  expect(screen.getByRole("textbox", { name: "原料编号" })).toHaveValue("P113-B-R"); expect(screen.getByRole("spinbutton", { name: "数量" })).toHaveValue(.6);
});

it("无保存权限看不到领料调入入口，经理通知失败不冒称审核成功", async () => {
  install(path => {
    if (path.endsWith("/YCK-P113")) return json({ 单头: { id: 1, 单号: "YCK-P113", 主管审核: "1", 经理审核: "0", 审核: "0" }, 明细: [] });
    if (path.endsWith("/manager-approve")) return json({ 消息: "未找到有权接收的原料仓负责人，请管理员配置原料仓仓管岗位后重试" }, 409);
  }, false);
  renderWithProviders(<PlasticRawMaterialStockIssuePage />, "/plastic-raw-material-stock-issue?open=YCK-P113");
  await screen.findByRole("heading", { name: /YCK-P113/ });
  expect(screen.queryByRole("button", { name: "按啤机采购单领料" })).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: "经理审核" }));
  expect(await screen.findByText(/未找到有权接收的原料仓负责人/)).toBeInTheDocument();
  expect(screen.queryByText("啤机审核完成，已通知原料仓负责人确认出库")).not.toBeInTheDocument();
});


function RawMessageSurface({ center }: { center: boolean }) {
  const location = useLocation(); const navigate = useNavigate();
  return <><MessageBell /><output data-testid="raw-route">{location.pathname}</output><button onClick={() => navigate(center ? "/messages" : "/")}>返回原料消息</button>{center && location.pathname === "/messages" && <MessagesPage />}<section aria-label="原料消息目标页" hidden={location.pathname !== "/plastic-raw-material-stock-issue"}><PlasticRawMaterialStockIssuePage /></section></>;
}
it.each([false, true])("原料待出库消息从铃铛/消息中心 %s 打开真实出库单，连续换单不误跳来料", async center => {
  const messages = [{ id: 11301, 类型: "原料领料待出库", 单号: "LL-RAW-A", 标题: "原料待出库甲", 已读: "1" }, { id: 11302, 类型: "原料领料待出库", 单号: "SC-RAW-B", 标题: "原料待出库乙", 已读: "1" }];
  const calls = install(path => {
    if (path === "/api/messages") return json({ items: messages, total: 2 });
    if (path.endsWith("/messages/unread-count")) return json({ count: 0 });
    const no = path.split("/").at(-1);
    if (["LL-RAW-A", "SC-RAW-B"].includes(no ?? "")) return json({ 单头: { id: no === "LL-RAW-A" ? 1 : 2, 单号: no, 主管审核: "1", 经理审核: "1", 审核: "0" }, 明细: [{ 原料编号: no === "LL-RAW-A" ? "R-A" : "R-B", 数量: no === "LL-RAW-A" ? 1.25 : 2.5, 单位: "KG" }] });
  });
  renderWithProviders(<RawMessageSurface center={center} />, center ? "/messages" : "/");
  for (const message of messages) {
    if (center) fireEvent.click(within((await screen.findByText(message.标题)).closest("tr")!).getByRole("button", { name: "查看" }));
    else { fireEvent.click(screen.getByTitle("消息")); fireEvent.click(await screen.findByRole("button", { name: new RegExp(message.标题) })); }
    await waitFor(() => expect(screen.getByTestId("raw-route")).toHaveTextContent("/plastic-raw-material-stock-issue"));
    await within(screen.getByRole("region", { name: "原料消息目标页" })).findByRole("heading", { name: new RegExp(message.单号) });
    fireEvent.click(screen.getByRole("button", { name: "返回原料消息" }));
  }
  expect(calls.some(c => c.path.startsWith("/api/material-issues"))).toBe(false);
});


it("领料汇总按单位分别显示最多8位，浮点尾差不影响原行净量", async () => {
  expect(rawIssueQuantitySummary([{ 单位: "包", 数量: 1.12 }, { 单位: "KG", 数量: 12 }])).toBe("1.12 包；12 KG");
  expect(rawIssueQuantitySummary([{ 单位: "KG", 数量: .1 }, { 单位: "公斤", 数量: .2 }, { 单位: "KG", 数量: .00000001 }])).toBe("0.30000001 KG");
  install(() => undefined);
  renderWithProviders(<PlasticRawMaterialStockIssuePage />, "/plastic-raw-material-stock-issue");
  await screen.findByRole("button", { name: "保存" });
  for (const [index, line] of [{ unit: "包", qty: "1.12" }, { unit: "KG", qty: "12" }].entries()) {
    fireEvent.click(screen.getByRole("button", { name: "加一行" }));
    fireEvent.change(screen.getAllByRole("textbox", { name: "单位" })[index], { target: { value: line.unit } });
    fireEvent.change(screen.getAllByRole("spinbutton", { name: "数量" })[index], { target: { value: line.qty } });
  }
  expect(screen.getByText("数量合计:")).toHaveTextContent("1.12 包；12 KG");
  expect(screen.getAllByRole("spinbutton", { name: "数量" })[0]).toHaveValue(1.12);
});

it("原料制单人用专用最小选人接口，选择直接啤机文员保存真实账号", async () => {
  const writes: Record<string, unknown>[] = [];
  const calls = install((path, init) => {
    if (path === "/api/organization/raw-issue-maker-options") return json([{ kind: "account", key: "account:113", accountName: "P113-06-clerk", personnelName: "啤机文员显示名", departmentCode: "06", positionName: "文员" }]);
    if (path === "/api/plastic-raw-material-stock-issue" && init?.method === "POST") { writes.push(JSON.parse(String(init.body))); return json({ 单号: "YCK-P113-MAKER" }); }
    if (path.endsWith("/YCK-P113-MAKER")) return json({ 单头: { id: 1, 单号: "YCK-P113-MAKER", 制单人: "P113-06-clerk" }, 明细: [] });
  });
  renderWithProviders(<PlasticRawMaterialStockIssuePage />, "/plastic-raw-material-stock-issue");
  await screen.findByRole("button", { name: "保存" });
  fireEvent.click(screen.getByRole("button", { name: "选择" }));
  const picker = await screen.findByRole("dialog", { name: "选择原料领料制单人" });
  fireEvent.click(await within(picker).findByText("啤机文员显示名"));
  expect(screen.getByRole("textbox", { name: "制单人" })).toHaveValue("P113-06-clerk");
  fireEvent.click(screen.getByRole("button", { name: "加一行" }));
  fireEvent.change(screen.getByRole("textbox", { name: "原料编号" }), { target: { value: "P113-R" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: "数量" }), { target: { value: "1.12" } });
  fireEvent.click(screen.getByRole("button", { name: /^保存$/ }));
  await waitFor(() => expect(writes).toHaveLength(1)); expect(writes[0].制单人).toBe("P113-06-clerk");
  expect(calls.some(c => c.path === "/api/organization/personnel-options")).toBe(false);
});

it("其他业务的通用人员选择器仍使用原接口", async () => {
  const pick = vi.fn();
  const calls = install(path => path === "/api/master/employees" ? json({ items: [{ 编号: "E113", 姓名: "原手工人员", 部门编号: "05" }], total: 1 }) : undefined);
  renderWithProviders(<EmployeePickerDialog open onPick={pick} onClose={() => {}} />);
  fireEvent.click(await screen.findByText("原手工人员"));
  expect(pick).toHaveBeenCalledWith("原手工人员");
  expect(calls.some(c => c.path === "/api/organization/raw-issue-maker-options")).toBe(false);
});
