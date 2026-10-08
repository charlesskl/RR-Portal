// 采购物料设置页:对照老系统 PurchaseMaterialSettingsPage 场景。
// 重点:列表渲染+已设置徽章(id 归一化为 ID)、双击选中后编辑/删除、
// 编辑弹窗保存 PUT 载荷(trim+空串转 null)、删除仅已设置行、校验(损耗率 0-100)。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import PurchaseMaterialSettingsPage from "@/pages/PurchaseMaterialSettingsPage";

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

const PERMS_FULL = [
  { 组: "物料管理", 菜单: "采购物料设置", 打开: true, 保存: true, 删除: true },
];

const ROWS = {
  items: [
    // 后端按 camelCase 序列化 id,前端归一化为 ID(已设置判断)
    { id: 7, 物料编号: "M1", 物料名称: "彩盒", 规格: "大", 单位: "PCS", 默认供应商: "供应商甲", 最小订量: 100, 采购损耗率: 5, 备注: "加急" },
    { id: null, 物料编号: "M2", 物料名称: "说明书", 规格: "", 单位: "PCS", 默认供应商: null, 最小订量: null, 采购损耗率: null, 备注: null },
  ],
  total: 2,
};

type Call = { url: string; method: string; body?: string };

function installFetch(perms: unknown = PERMS_FULL) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET", body: init?.body as string });
      const p = new URL(url, "http://test").pathname;
      if (p.endsWith("/me/permissions")) return json(permRowsToMap(perms));
      if (p === "/api/purchase-material-settings") return json(ROWS);
      if (p === "/api/purchase-material-settings/M1") {
        if (init?.method === "PUT") return json({});
        if (init?.method === "DELETE") return json({});
      }
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

describe("PurchaseMaterialSettingsPage", () => {
  it("列表渲染:已设置徽章(是/否),未选中行时 编辑/删除 禁用", async () => {
    installFetch();
    renderWithProviders(<PurchaseMaterialSettingsPage />, "/purchase-material-settings");
    await screen.findByText("彩盒");
    expect(screen.getByText("是")).toBeInTheDocument();
    expect(screen.getByText("否")).toBeInTheDocument();
    expect(screen.getByText("共 2 条")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "删除" })).toBeDisabled();
  });

  it("双击选中行 -> 编辑弹窗带出原值 -> 保存 PUT(trim+数字化,空备注转 null)", async () => {
    const calls = installFetch();
    renderWithProviders(<PurchaseMaterialSettingsPage />, "/purchase-material-settings");
    const row = (await screen.findByText("彩盒")).closest("tr")!;
    fireEvent.doubleClick(row);
    await screen.findByText("已选中:M1");
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    const dlg = await screen.findByRole("dialog", { name: /采购物料设置 - M1 彩盒/ });
    expect(within(dlg).getByLabelText("默认供应商")).toHaveValue("供应商甲");
    expect(within(dlg).getByLabelText("采购损耗率")).toHaveValue(5);

    fireEvent.change(within(dlg).getByLabelText("默认供应商"), { target: { value: " 供应商乙 " } });
    fireEvent.change(within(dlg).getByLabelText("最小订量"), { target: { value: "200" } });
    fireEvent.change(within(dlg).getByLabelText("设置备注"), { target: { value: "" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url === "/api/purchase-material-settings/M1" && c.method === "PUT"),
      ).toBe(true),
    );
    const put = calls.find((c) => c.url.endsWith("/M1") && c.method === "PUT")!;
    expect(JSON.parse(put.body!)).toEqual({
      默认供应商: "供应商乙",
      最小订量: 200,
      采购损耗率: 5,
      备注: null,
    });
    await screen.findByText("物料 [M1] 采购设置已保存");
  });

  it("校验:采购损耗率超出 0-100 拦截不发请求", async () => {
    const calls = installFetch();
    renderWithProviders(<PurchaseMaterialSettingsPage />, "/purchase-material-settings");
    const row = (await screen.findByText("彩盒")).closest("tr")!;
    fireEvent.doubleClick(row);
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    const dlg = await screen.findByRole("dialog", { name: /采购物料设置 - M1/ });
    fireEvent.change(within(dlg).getByLabelText("采购损耗率"), { target: { value: "120" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "保存" }));
    await screen.findByText("采购损耗率须在 0-100 之间");
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("删除:未设置行(M2)删除禁用;已设置行确认后 DELETE 并提示", async () => {
    const calls = installFetch();
    renderWithProviders(<PurchaseMaterialSettingsPage />, "/purchase-material-settings");
    // M2 未设置:删除禁用
    const row2 = (await screen.findByText("说明书")).closest("tr")!;
    fireEvent.doubleClick(row2);
    await screen.findByText("已选中:M2");
    expect(screen.getByRole("button", { name: "删除" })).toBeDisabled();

    // M1 已设置:确认弹窗 -> DELETE
    const row1 = screen.getByText("彩盒").closest("tr")!;
    fireEvent.doubleClick(row1);
    await screen.findByText("已选中:M1");
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    const dlg = await screen.findByRole("dialog");
    expect(dlg).toHaveTextContent("确认删除物料 [M1] 的采购设置?");
    fireEvent.click(within(dlg).getByRole("button", { name: "删除" }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url === "/api/purchase-material-settings/M1" && c.method === "DELETE"),
      ).toBe(true),
    );
    await screen.findByText("物料 [M1] 采购设置已删除");
  });

  it("关键字查询:查询按钮带 keyword 参数重查", async () => {
    const calls = installFetch();
    renderWithProviders(<PurchaseMaterialSettingsPage />, "/purchase-material-settings");
    await screen.findByText("彩盒");
    fireEvent.change(screen.getByLabelText("关键字"), { target: { value: "彩盒" } });
    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.startsWith("/api/purchase-material-settings?") && decodeURIComponent(c.url).includes("keyword=彩盒")),
      ).toBe(true),
    );
  });
});
