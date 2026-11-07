import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "@/test/setup";
import PlasticRawMaterialPurchaseOrderPage from "@/pages/PlasticRawMaterialPurchaseOrderPage";
import RawPurchaseGenerateDialog from "@/pages/RawPurchaseGenerateDialog";
import type { RawPurchaseAnalysisRow } from "@/api/types";
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
const policy: RawPurchaseAnalysisRow = { 原料编号: "P113-R", 原料名称: "原料甲", 单位: "KG", 常用原料: false, 每包重量: 25, 可购数量: 28, 生产需求: 28, 可购上限: 78, 可购上限KG: 78 };
beforeEach(() => localStorage.setItem("web2.user", "P113-PMC"));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });
function install(failSave = false) {
  const writes: Record<string, unknown>[] = [];
  const reads: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://test"); const path = decodeURIComponent(url.pathname); reads.push(url.pathname + url.search);
    if (path.endsWith("/plastic-raw-material-stock-issue/access")) return json({ isAdmin: true, canSupervisor: true, canManager: true, canWarehousePost: true, canReverse: true });
    if (path.endsWith("/me/permissions")) return json(permRowsToMap([{ 菜单: "原料采购订单", 打开: true, 保存: true }]));
    if (path.endsWith("/purchase-limits")) return json([policy]);
    if (path.endsWith("/master/suppliers")) return json({ items: [{ 供应商编号: "P113-S", 供应商名称: "供应商甲" }], total: 1 });
    if (path === "/api/plastic-raw-material-purchase-order" && init?.method === "POST") {
      writes.push(JSON.parse(String(init.body))); return failSave ? json({ 消息: "最新库存已满足需求，不能重复采购" }, 409) : json({ 单号: "P113-YCD" });
    }
    return json({ 消息: `未定义 ${path}` }, 404);
  }));
  return { writes, reads };
}
async function pickSupplier() { fireEvent.click(screen.getByRole("button", { name: "选择" })); fireEvent.click(await screen.findByText("供应商甲")); }
it("手填采购同原料两行合计超限不POST，减少数量可保存且单位/草稿不被政策覆盖", async () => {
  const { writes } = install();
  renderWithProviders(<PlasticRawMaterialPurchaseOrderPage />, "/plastic-raw-material-purchase-order");
  await screen.findByRole("button", { name: "保存" }); await pickSupplier();
  for (let i = 0; i < 2; i++) {
    fireEvent.click(screen.getByRole("button", { name: "加一行" }));
    fireEvent.change(screen.getAllByRole("textbox", { name: "原料编号" })[i], { target: { value: "P113-R" } });
    fireEvent.change(screen.getAllByRole("textbox", { name: "单位" })[i], { target: { value: "KG" } });
    fireEvent.change(screen.getAllByRole("spinbutton", { name: "订货数量" })[i], { target: { value: "40" } });
  }
  fireEvent.change(screen.getByRole("textbox", { name: /^备注$/ }), { target: { value: "保留这份采购草稿" } });
  fireEvent.click(screen.getByRole("button", { name: /^保存$/ }));
  await screen.findByText(/合计 80 KG，超过采购上限/); expect(writes).toHaveLength(0);
  expect(screen.getByRole("textbox", { name: /^备注$/ })).toHaveValue("保留这份采购草稿");
  fireEvent.change(screen.getAllByRole("spinbutton", { name: "订货数量" })[1], { target: { value: "38" } });
  fireEvent.click(screen.getByRole("button", { name: /^保存$/ }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].明细).toEqual([expect.objectContaining({ 原料编号: "P113-R", 单位: "KG", 订货数量: 40 }), expect.objectContaining({ 原料编号: "P113-R", 单位: "KG", 订货数量: 38 })]);
});
it("生成采购单超额硬拦；服务端冲突时保留数量和供应商并显示真实错误", async () => {
  const { writes } = install(true); const done = vi.fn();
  renderWithProviders(<RawPurchaseGenerateDialog open rows={[policy]} onClose={() => {}} onDone={done} />);
  await pickSupplier();
  fireEvent.change(screen.getByRole("textbox", { name: "P113-R 订货数量" }), { target: { value: "79" } });
  const dialog = screen.getByRole("dialog", { name: "从采购分析生成采购单" });
  fireEvent.click(within(dialog).getByRole("button", { name: /生成采购单/ }));
  await screen.findByText(/超过采购上限/); expect(writes).toHaveLength(0);
  fireEvent.change(screen.getByRole("textbox", { name: "P113-R 订货数量" }), { target: { value: "75" } });
  fireEvent.click(within(dialog).getByRole("button", { name: /生成采购单/ }));
  await screen.findByText("最新库存已满足需求，不能重复采购");
  expect(done).not.toHaveBeenCalled(); expect(screen.getByRole("textbox", { name: "P113-R 订货数量" })).toHaveValue("75");
  expect(screen.getByDisplayValue("供应商甲")).toBeInTheDocument();
});

it("云端 StrictMode 重放后采购直开仍读取当前单，已存单保持查看态", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input), "http://test").pathname;
    if (path.endsWith("permissions")) return json(permRowsToMap([{ 菜单: "原料采购订单", 打开: true, 保存: true }]));
    if (path.endsWith("purchase-limits")) return json([policy]);
    return json({ 单头: { id: 1, 单号: "P113-OPEN", 供应商名称: "已存供应商", 备注: "已存采购备注" }, 明细: [{ 原料编号: "P113-R", 单位: "KG", 订货数量: 28 }] });
  }));
  renderWithProviders(<StrictMode><PlasticRawMaterialPurchaseOrderPage /></StrictMode>, "/plastic-raw-material-purchase-order?open=P113-OPEN");
  await screen.findByRole("heading", { name: "原料采购订单 · P113-OPEN" });
  expect(screen.getByRole("textbox", { name: /^备注$/ })).toHaveValue("已存采购备注");
  expect(screen.getByRole("button", { name: /^保存$/ })).toBeDisabled();
});
