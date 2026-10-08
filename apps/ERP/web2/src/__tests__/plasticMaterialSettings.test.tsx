// 塑胶物料设置页:对照老系统 web/src/pages/plastics/PlasticMaterialSettingsPage.tsx。
// 场景:列表渲染/已设置徽章、双击选中后编辑弹窗回填+保存 PUT 载荷、删除确认、
// 损耗率 0-100 校验、无权访问。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import PlasticMaterialSettingsPage from "@/pages/PlasticMaterialSettingsPage";

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

const PERMS_FULL = [{ 组: "塑胶采购", 菜单: "塑胶物料设置", 打开: true, 保存: true, 删除: true }];

const LIST = {
  items: [
    { id: 5, 物料编号: "M-001", 物料名称: "齿轮", 规格: "S", 单位: "个", 默认仓库: "塑胶仓", 损耗率: 2, 备注: "备注1" },
    { id: null, 物料编号: "M-002", 物料名称: "胶盖", 规格: null, 单位: "个", 默认仓库: null, 损耗率: null, 备注: null },
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
      if (p === "/api/plastic-material-settings") return json(LIST);
      if (p.startsWith("/api/plastic-material-settings/")) {
        if (init?.method === "PUT") return json({});
        if (init?.method === "DELETE") return json({});
      }
      return json({ 消息: `unhandled ${p}` }, 404);
    }),
  );
  return calls;
}

const setup = (perms?: unknown) => {
  const calls = installFetch(perms ?? PERMS_FULL);
  renderWithProviders(<PlasticMaterialSettingsPage />, "/plastic-material-settings");
  return calls;
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("web2.user", "tester");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PlasticMaterialSettingsPage", () => {
  it("列表渲染:物料编号/默认仓库/损耗率/已设置徽章(ID 空=否)", async () => {
    setup();
    await screen.findByText("M-001");
    expect(screen.getByText("M-002")).toBeInTheDocument();
    expect(screen.getByText("塑胶仓")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("是")).toBeInTheDocument();
    expect(screen.getByText("否")).toBeInTheDocument();
    expect(screen.getByText("共 2 条")).toBeInTheDocument();
  });

  it("双击行选中 -> 编辑弹窗回填 -> 保存 PUT 载荷(空串转 null)", async () => {
    const calls = setup();
    await screen.findByText("M-001");
    fireEvent.doubleClick(screen.getByText("M-001").closest("tr")!);
    await screen.findByText("已选中:M-001");
    fireEvent.click(screen.getByRole("button", { name: /编辑/ }));
    const dlg = await screen.findByRole("dialog");
    expect(dlg).toHaveTextContent("塑胶物料设置 - M-001 齿轮");
    expect(screen.getByLabelText("默认仓库")).toHaveValue("塑胶仓");
    expect(screen.getByLabelText("损耗率")).toHaveValue(2);
    fireEvent.change(screen.getByLabelText("默认仓库"), { target: { value: "二仓" } });
    fireEvent.change(screen.getByLabelText("备注"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      const put = calls.find((c) => c.method === "PUT" && c.url.includes("/plastic-material-settings/M-001"));
      expect(put).toBeTruthy();
      expect(JSON.parse(put!.body!)).toEqual({ 默认仓库: "二仓", 损耗率: 2, 备注: null });
    });
    await screen.findByText("塑胶物料 [M-001] 设置已保存");
  });

  it("损耗率超界(>100)拦截不发 PUT", async () => {
    const calls = setup();
    await screen.findByText("M-001");
    fireEvent.doubleClick(screen.getByText("M-001").closest("tr")!);
    fireEvent.click(screen.getByRole("button", { name: /编辑/ }));
    await screen.findByRole("dialog");
    fireEvent.change(screen.getByLabelText("损耗率"), { target: { value: "120" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("损耗率须在 0-100 之间");
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("删除:仅已设置行可删;确认后 DELETE 并刷新", async () => {
    const calls = setup();
    await screen.findByText("M-002");
    // 未设置行(ID 空)删除按钮禁用
    fireEvent.doubleClick(screen.getByText("M-002").closest("tr")!);
    await screen.findByText("已选中:M-002");
    expect(screen.getByRole("button", { name: /删除/ })).toBeDisabled();
    // 已设置行可删
    fireEvent.doubleClick(screen.getByText("M-001").closest("tr")!);
    await screen.findByText("已选中:M-001");
    fireEvent.click(screen.getByRole("button", { name: /删除/ }));
    await screen.findByText("确认删除塑胶物料 [M-001] 的设置?");
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === "DELETE" && c.url.includes("M-001"))).toBe(true),
    );
    await screen.findByText("塑胶物料 [M-001] 设置已删除");
  });

  it("无「打开」权限:整页无权提示", async () => {
    setup([]);
    await screen.findByText("无权访问该页面");
  });
});
